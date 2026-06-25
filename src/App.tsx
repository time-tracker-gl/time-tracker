import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ChecklistItem, Gap, Project, ReportPeriod, Segment, Tab, TileLayout, Todo, TodoCategory } from './types';
import { C, PALETTE } from './theme';
import { fmtClock, fmtDur, nowMinutes } from './lib/time';
import { periodRange } from './lib/aggregate';
import { DrawingPad } from './components/DrawingPad';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { Login } from './components/Login';
import { SetPassword } from './components/SetPassword';
import {
  loadProjects,
  loadSegments,
  loadTodos,
  localISODate,
  seedDefaultProjects,
  syncProjects,
  syncSegments,
  syncTodos,
} from './lib/repo';

/** Daily-Task option labels (ascending order = ascending value). */
const DURATION_OPTIONS = [2, 5, 15, 20, 30, 45, 60];
const URGENCY_LABELS = ['sofort', 'max 2 Std', 'heute', '2 Tage', 'diese Woche', 'später'];
const IMPORTANCE_LABELS = ['very high', 'high', 'medium', 'low', 'very low'];
const CATEGORY_LABELS: Record<TodoCategory, string> = {
  projekt: 'Projekt',
  akquise: 'Akquise',
  intern: 'Intern',
};


interface AppState {
  projects: Project[];
  segments: Segment[];
  todos: Todo[];
  activeId: string | null;
  paused: boolean;
  pausedPid: string | null;
  tab: Tab;
  sheetSegId: string | null;
  tileLayout: TileLayout;
  fillGap: Gap | null;
  reportPeriod: ReportPeriod;
  custFrom: string;
  custTo: string;
}

const SEED_PROJECTS: Project[] = [
  { id: 'p1', code: 'EOS-01', name: 'EOS Rollout', color: '#2B5FAE', category: 'projekt', sort: 0 },
  { id: 'p2', code: 'E2E-04', name: 'E2E Training', color: '#E8772E', category: 'projekt', sort: 1 },
  { id: 'p3', code: 'STG-07', name: 'Stahlgruber CRM', color: '#2E8B3D', category: 'projekt', sort: 2 },
  { id: 'p4', code: 'PMO-02', name: 'PMO & Steering', color: '#B6309A', category: 'intern', sort: 0 },
  { id: 'p5', code: 'INT-12', name: 'Intern / Admin', color: '#7B3FB8', category: 'intern', sort: 1 },
  { id: 'p6', code: 'AKQ-05', name: 'Akquise / Angebot', color: '#19B3C6', category: 'akquise', sort: 0 },
];

const SEED_SEGMENTS: Segment[] = [
  { id: 's1', pid: 'p1', start: 8 * 60 + 5, end: 9 * 60 + 20, activity: 'Sprint Planning & Daily' },
  { id: 's2', pid: 'p3', start: 9 * 60 + 25, end: 10 * 60 + 10, activity: 'CRM Datenmodell Review' },
  { id: 's3', pid: 'p2', start: 10 * 60 + 35, end: 12 * 60, activity: 'Workshop-Vorbereitung Modul 2' },
  { id: 's4', pid: 'p1', start: 12 * 60 + 45, end: 14 * 60 + 32, activity: '' },
];

const STORAGE_KEY = 'rpc-zeiterfassung-v1';
/** Persists the running focus countdown so it survives reloads / app restarts:
 *  the actually-needed time is measured from this absolute start timestamp. */
const RUN_STORAGE_KEY = 'rpc-zeiterfassung-run-v1';

/** A running focus countdown started from the task list. */
interface RunSession {
  todoId: string;
  /** epoch ms when the countdown was started (basis for the elapsed/actual time) */
  startedAt: number;
}

function loadRun(): RunSession | null {
  try {
    const raw = localStorage.getItem(RUN_STORAGE_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw);
    if (r && typeof r.todoId === 'string' && typeof r.startedAt === 'number') return r;
    return null;
  } catch {
    return null;
  }
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Compact up/down reorder button (used in both checklists). */
function moveBtnStyle(color: string, bg: string, disabled: boolean): CSSProperties {
  return {
    flex: '0 0 auto',
    width: 26,
    height: 30,
    padding: 0,
    fontSize: 11,
    fontWeight: 700,
    border: 'none',
    background: bg,
    color,
    opacity: disabled ? 0.35 : 1,
    cursor: disabled ? 'default' : 'pointer',
  };
}

/** Swap a list item with its neighbour (returns a new array). */
function moveItem<T>(arr: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const next = arr.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Stable reorder of a checklist: open items keep their order at the top, done
 *  items sink to the end (also keeping their relative order). */
function sinkDone(cl: ChecklistItem[]): ChecklistItem[] {
  return [...cl.filter((c) => !c.done), ...cl.filter((c) => c.done)];
}

/** Three empty checklist rows for a fresh project detail view. */
function emptyChecklist(): ChecklistItem[] {
  return [
    { text: '', done: false },
    { text: '', done: false },
    { text: '', done: false },
  ];
}

/** Compact signature of the persisted data, used to avoid redundant cloud writes. */
function dataSignature(projects: Project[], segments: Segment[], todos: Todo[]): string {
  return JSON.stringify({
    p: projects.map((p) => [p.id, p.code ?? '', p.name, p.color, p.category, p.sort]),
    s: segments.map((s) => [s.id, s.pid, s.start, s.end, s.activity, s.plannedEnd ?? null, s.checklist ?? [], s.todoId ?? null]),
    t: todos.map((t) => [t.id, t.title, t.category, t.projectId, t.plannedMin, t.actualMin ?? null, t.completedAt ?? null, t.urgency, t.importance, t.drawing, t.zug, t.archived, t.checklist ?? []]),
  });
}

function loadPersisted(): Pick<AppState, 'projects' | 'segments' | 'tileLayout' | 'todos'> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!Array.isArray(data.projects)) return null;
    return {
      projects: data.projects,
      segments: data.segments ?? [],
      tileLayout: data.tileLayout ?? 'grid',
      todos: data.todos ?? [],
    };
  } catch {
    return null;
  }
}

function initialState(): AppState {
  const persisted = loadPersisted();
  const today = new Date();
  return {
    projects: persisted?.projects ?? SEED_PROJECTS,
    segments: persisted?.segments ?? SEED_SEGMENTS,
    todos: persisted?.todos ?? [],
    activeId: null,
    paused: false,
    pausedPid: null,
    tab: 'tasks',
    sheetSegId: null,
    tileLayout: persisted?.tileLayout ?? 'grid',
    fillGap: null,
    reportPeriod: 'woche',
    custFrom: isoDate(new Date(today.getFullYear(), today.getMonth(), 1)),
    custTo: isoDate(today),
  };
}

type Updater = Partial<AppState> | ((prev: AppState) => Partial<AppState>);

export default function App() {
  const [state, setStateRaw] = useState<AppState>(initialState);
  const [vNow, setVNow] = useState<number>(() => nowMinutes());

  // Cloud (Supabase) auth + sync state. In local mode these are pre-satisfied.
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  // True while the user arrived via a password-recovery link – then we show the
  // "set new password" screen instead of the app, even though a session exists.
  const [recovery, setRecovery] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(!isSupabaseConfigured);
  const lastSyncRef = useRef('');

  // Archive (completed tasks) time-slice filter (Woche/Monat/Jahr).
  const [archivePeriod, setArchivePeriod] = useState<ReportPeriod>('monat');

  // Running focus countdown (started from the task list with the Play button).
  const [run, setRun] = useState<RunSession | null>(loadRun);
  // Daily-Tasks editor sheet: null = closed, 'new' = create, Todo = edit.
  const [todoSheet, setTodoSheet] = useState<Todo | 'new' | null>(null);
  // pending confirmation dialog (e.g. before archiving a task / completing a booking)
  const [confirm, setConfirm] = useState<{ message: string; confirmLabel: string; onConfirm: () => void } | null>(null);

  const setState = (updater: Updater) =>
    setStateRaw((prev) => ({ ...prev, ...(typeof updater === 'function' ? updater(prev) : updater) }));

  // track the current Supabase session
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setUserEmail(data.session?.user?.email ?? null);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      setUserEmail(session?.user?.email ?? null);
      setAuthReady(true);
      if (!session) {
        setDataLoaded(false);
        lastSyncRef.current = '';
      }
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // load this user's projects + today's bookings after sign-in
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !userEmail || dataLoaded) return;
    let active = true;
    (async () => {
      try {
        const day = localISODate();
        let projects = await loadProjects();
        if (projects.length === 0) {
          await seedDefaultProjects(SEED_PROJECTS);
          projects = SEED_PROJECTS;
        }
        const segments = await loadSegments(day);
        // best-effort: the todos table may not exist yet (run schema.sql) – don't
        // let that block loading projects/bookings.
        let todos: Todo[] = [];
        try {
          todos = await loadTodos();
        } catch (e) {
          console.error('Supabase todos load failed (run schema.sql?)', e);
        }
        if (!active) return;
        setStateRaw((prev) => ({
          ...prev,
          projects,
          segments,
          todos,
          activeId: null,
          paused: false,
          pausedPid: null,
          sheetSegId: null,
          fillGap: null,
        }));
        lastSyncRef.current = dataSignature(projects, segments, todos);
      } catch (e) {
        console.error('Supabase load failed', e);
      } finally {
        if (active) setDataLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [userEmail, dataLoaded]);

  // write changes back to Supabase (debounced, skips no-op changes)
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !userEmail || !dataLoaded) return;
    const signature = dataSignature(state.projects, state.segments, state.todos);
    if (signature === lastSyncRef.current) return;
    const t = setTimeout(async () => {
      try {
        await syncProjects(state.projects);
        try {
          await syncSegments(localISODate(), state.segments);
        } catch (e) {
          console.error('Supabase segments sync failed (run schema.sql?)', e);
        }
        try {
          await syncTodos(state.todos);
        } catch (e) {
          console.error('Supabase todos sync failed (run schema.sql?)', e);
        }
        lastSyncRef.current = signature;
      } catch (e) {
        console.error('Supabase sync failed', e);
      }
    }, 1200);
    return () => clearTimeout(t);
  }, [state.projects, state.segments, state.todos, userEmail, dataLoaded]);

  async function logout() {
    if (supabase) await supabase.auth.signOut();
  }

  // live clock; extend the running booking to "now" each tick (FA-07)
  useEffect(() => {
    const tick = () => {
      const m = nowMinutes();
      setVNow(m);
      setStateRaw((prev) =>
        prev.activeId
          ? { ...prev, segments: prev.segments.map((g) => (g.id === prev.activeId ? { ...g, end: m } : g)) }
          : prev,
      );
    };
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  // persist projects, segments, todos and layout
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          projects: state.projects,
          segments: state.segments,
          todos: state.todos,
          tileLayout: state.tileLayout,
        }),
      );
    } catch {
      /* ignore quota / privacy-mode errors */
    }
  }, [state.projects, state.segments, state.todos, state.tileLayout]);

  // persist the running focus countdown (so it survives reloads)
  useEffect(() => {
    try {
      if (run) localStorage.setItem(RUN_STORAGE_KEY, JSON.stringify(run));
      else localStorage.removeItem(RUN_STORAGE_KEY);
    } catch {
      /* ignore quota / privacy-mode errors */
    }
  }, [run]);

  // ---------- actions ----------
  /** Add a new (empty-named) project to a category section, ready to be typed in. */
  function addProject(category: TodoCategory) {
    setState((s) => {
      const id = 'p' + Date.now();
      // colour is no longer shown in the UI; assign one automatically so the
      // (still required) field stays populated.
      const color = PALETTE[s.projects.length % PALETTE.length];
      const inCat = s.projects.filter((p) => p.category === category);
      const sort = inCat.length ? Math.max(...inCat.map((p) => p.sort)) + 1 : 0;
      return { projects: s.projects.concat([{ id, code: '', name: '', color, category, sort }]) };
    });
  }

  function updateProjectName(pid: string, v: string) {
    setState((s) => ({ projects: s.projects.map((p) => (p.id === pid ? { ...p, name: v } : p)) }));
  }

  /** Move a project up/down within its category (normalises sort on each move). */
  function moveProject(pid: string, dir: -1 | 1) {
    setState((s) => {
      const p = s.projects.find((x) => x.id === pid);
      if (!p) return s;
      const ordered = s.projects.filter((x) => x.category === p.category).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'de'));
      const idx = ordered.findIndex((x) => x.id === pid);
      const j = idx + dir;
      if (j < 0 || j >= ordered.length) return s;
      [ordered[idx], ordered[j]] = [ordered[j], ordered[idx]];
      const sortById = new Map(ordered.map((x, i) => [x.id, i]));
      return { projects: s.projects.map((x) => (sortById.has(x.id) ? { ...x, sort: sortById.get(x.id)! } : x)) };
    });
  }

  function deleteProject(pid: string) {
    setState((s) => {
      const cur = s.activeId ? s.segments.find((g) => g.id === s.activeId) : null;
      const clearActive = !!cur && cur.pid === pid;
      return {
        projects: s.projects.filter((p) => p.id !== pid),
        segments: s.segments.filter((g) => g.pid !== pid),
        activeId: clearActive ? null : s.activeId,
        paused: s.pausedPid === pid ? false : s.paused,
        pausedPid: s.pausedPid === pid ? null : s.pausedPid,
      };
    });
  }

  // ---------- daily tasks ----------
  function saveTodo(todo: Todo) {
    setState((s) => {
      const exists = s.todos.some((t) => t.id === todo.id);
      return {
        todos: exists ? s.todos.map((t) => (t.id === todo.id ? todo : t)) : s.todos.concat([todo]),
      };
    });
    setTodoSheet(null);
  }
  function deleteTodo(id: string) {
    setState((s) => ({ todos: s.todos.filter((t) => t.id !== id) }));
    setTodoSheet(null);
  }
  /** "Erledigt" from the ToDo list (without timing): move the task to the archive. */
  function archiveTodo(id: string) {
    setState((s) => ({ todos: s.todos.map((t) => (t.id === id ? { ...t, archived: true, completedAt: localISODate() } : t)) }));
  }
  /** Restore an archived task back into the active Daily-Tasks list (drops its
   *  recorded times so a fresh run can be measured). */
  function unarchiveTodo(id: string) {
    setState((s) => ({ todos: s.todos.map((t) => (t.id === id ? { ...t, archived: false, actualMin: null, completedAt: null } : t)) }));
  }

  // ---------- focus countdown (started from the task list) ----------
  /** Start the focus countdown for a task: shows the planned time counting down. */
  function startCountdown(todo: Todo) {
    setRun({ todoId: todo.id, startedAt: Date.now() });
  }
  /** "Schließen": stop the countdown without completing the task (no time recorded). */
  function cancelCountdown() {
    setRun(null);
  }
  /** "Erledigt" from the countdown: record the actually needed time and archive
   *  the task, so planned vs. actual is documented for better future estimates. */
  function finishCountdown() {
    if (!run) return;
    const actualMin = Math.max(1, Math.round((Date.now() - run.startedAt) / 60000));
    const id = run.todoId;
    setState((s) => ({
      todos: s.todos.map((t) => (t.id === id ? { ...t, archived: true, actualMin, completedAt: localISODate() } : t)),
    }));
    setRun(null);
  }
  /** Toggle a sub-activity of the task currently shown in the countdown. */
  function toggleRunChecklistItem(i: number) {
    if (!run) return;
    const id = run.todoId;
    setState((s) => ({
      todos: s.todos.map((t) =>
        t.id === id ? { ...t, checklist: sinkDone((t.checklist ?? []).map((c, idx) => (idx === i ? { ...c, done: !c.done } : c))) } : t,
      ),
    }));
  }

  // ---------- derived ----------
  const s = state;
  const isReport = s.tab === 'report';
  const isTasks = s.tab === 'tasks';
  const isAdmin = s.tab === 'admin';
  const isArchiv = s.tab === 'archiv';
  const today = new Date();
  const dateText = today.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long' });
  const clockText = fmtClock(vNow);

  // The task whose focus countdown is currently running (if any).
  const runTodo = run ? s.todos.find((t) => t.id === run.todoId && !t.archived) ?? null : null;
  // drop a stale countdown whose task was deleted/archived elsewhere
  useEffect(() => {
    if (run && !runTodo) setRun(null);
  }, [run, runTodo]);

  // ---------- render ----------
  if (isSupabaseConfigured && !authReady) return <LoadingScreen text="Lädt …" />;
  if (isSupabaseConfigured && recovery) return <SetPassword onDone={() => setRecovery(false)} />;
  if (isSupabaseConfigured && !userEmail) return <Login />;
  if (isSupabaseConfigured && !dataLoaded) return <LoadingScreen text="Daten werden geladen …" />;

  return (
    <div
      className="tk-vh"
      style={{
        display: 'flex',
        justifyContent: 'center',
        background: '#DDE3E7',
        fontFamily: "'Roboto Condensed','Roboto',system-ui,sans-serif",
        overflow: 'hidden',
      }}
    >
      <div
        className="tk-vh"
        style={{
          width: '100%',
          maxWidth: 430,
          background: C.lt1,
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          boxShadow: '0 0 40px rgba(14,23,33,.14)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <header
          style={{
            flex: '0 0 auto',
            padding: '18px 20px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: C.lt1,
            borderBottom: '1px solid #EAEDEF',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
            <span style={{ fontWeight: 700, fontSize: 22, letterSpacing: '-.5px', color: C.accent1 }}>rpc</span>
            <span
              style={{
                fontSize: 11,
                letterSpacing: '.14em',
                textTransform: 'uppercase',
                color: C.greyFooter,
                fontWeight: 500,
              }}
            >
              Zeiterfassung
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ textAlign: 'right', lineHeight: 1.2, whiteSpace: 'nowrap' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.dk1, whiteSpace: 'nowrap' }}>{dateText}</div>
              <div style={{ fontSize: 11, color: C.greyFooter, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                {clockText} Uhr
              </div>
            </div>
          </div>
        </header>

        {/* Body */}
        <main className="tk-scroll" style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', background: C.lt1 }}>
          {isReport && (
            <ReportView
              state={s}
              period={s.reportPeriod}
              onSetPeriod={(p) => setState({ reportPeriod: p })}
              today={today}
            />
          )}

          {isTasks && (
            <DailyTasksView
              state={s}
              countdown={
                run && runTodo ? (
                  <CountdownPanel
                    todo={runTodo}
                    startedAt={run.startedAt}
                    onToggleItem={toggleRunChecklistItem}
                    onDone={finishCountdown}
                    onClose={cancelCountdown}
                  />
                ) : null
              }
              runningId={run?.todoId ?? null}
              onAdd={() => setTodoSheet('new')}
              onEdit={(t) => setTodoSheet(t)}
              onStart={startCountdown}
              onComplete={(id) => {
                const t = state.todos.find((x) => x.id === id);
                setConfirm({
                  message: `Aufgabe${t?.title ? ` „${t.title}“` : ''} ins Archiv verschieben?`,
                  confirmLabel: 'Erledigt',
                  onConfirm: () => archiveTodo(id),
                });
              }}
            />
          )}

          {isAdmin && (
            <AdminView
              state={s}
              onUpdateName={updateProjectName}
              onMoveProject={moveProject}
              onDeleteProject={deleteProject}
              onAddProject={addProject}
              accountEmail={isSupabaseConfigured ? userEmail : null}
              onLogout={logout}
            />
          )}

          {isArchiv && (
            <ArchiveView
              state={s}
              period={archivePeriod}
              onSetPeriod={setArchivePeriod}
              today={today}
              onEdit={(t) => setTodoSheet(t)}
              onRestore={unarchiveTodo}
            />
          )}
        </main>

        {/* Bottom nav */}
        <BottomNav tab={s.tab} onSelect={(t) => setState({ tab: t })} />

        {/* Daily-Task editor */}
        {todoSheet && (
          <TodoSheet
            key={todoSheet === 'new' ? 'new' : todoSheet.id}
            initial={todoSheet === 'new' ? null : todoSheet}
            projects={s.projects}
            onSave={saveTodo}
            onDelete={todoSheet === 'new' ? undefined : () => deleteTodo(todoSheet.id)}
            onClose={() => setTodoSheet(null)}
          />
        )}

        {/* Confirmation dialog (archive task / complete booking) */}
        {confirm && (
          <ConfirmDialog
            message={confirm.message}
            confirmLabel={confirm.confirmLabel}
            onConfirm={() => {
              confirm.onConfirm();
              setConfirm(null);
            }}
            onCancel={() => setConfirm(null)}
          />
        )}
      </div>
    </div>
  );
}

/* ======================= CONFIRM DIALOG ======================= */
function ConfirmDialog(props: { message: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void }) {
  const { message, confirmLabel, onConfirm, onCancel } = props;
  return (
    <div
      onClick={onCancel}
      style={{ position: 'absolute', inset: 0, background: 'rgba(14,23,33,.45)', zIndex: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, animation: 'tkFade .18s ease' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 340, background: C.lt1, padding: '20px 20px 18px', boxShadow: '0 10px 40px rgba(14,23,33,.28)' }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: C.dk1, lineHeight: 1.4 }}>{message}</div>
        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button type="button" onClick={onCancel} style={{ flex: 1, padding: 12, background: C.lt2, color: C.dk1, fontSize: 14, fontWeight: 700 }}>
            Abbrechen
          </button>
          <button type="button" onClick={onConfirm} style={{ flex: 1, padding: 12, background: '#2E8B3D', color: C.lt1, fontSize: 14, fontWeight: 700 }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ======================= REPORTING ======================= */
/** Fixed colours for the three task categories in the Reporting charts. */
const CATEGORY_COLORS: Record<TodoCategory, string> = {
  projekt: '#2B5FAE',
  akquise: '#E8772E',
  intern: '#7B3FB8',
};

/** YYYY-MM-DD → local Date at midnight (avoids UTC off-by-one). */
function parseDay(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
/** Monday (local) of the week containing d. */
function mondayOf(d: Date): Date {
  const wd = (d.getDay() + 6) % 7; // 0 = Monday
  return addDays(d, -wd);
}

interface ReportBucket {
  key: string;
  label: string;
  hours: number;
  count: number;
}

/** Group completed tasks into chart buckets: days (Woche), weeks (Monat) or
 *  months (Jahr). Empty buckets are kept so the time axis stays continuous. */
function reportBuckets(tasks: Todo[], period: ReportPeriod, from: string, to: string): ReportBucket[] {
  const buckets: ReportBucket[] = [];
  const idx = new Map<string, number>();
  const fromD = parseDay(from);
  const toD = parseDay(to);

  if (period === 'jahr') {
    const year = fromD.getFullYear();
    const M = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
    for (let m = 0; m < 12; m++) idx.set(`${year}-${String(m + 1).padStart(2, '0')}`, buckets.push({ key: '', label: M[m], hours: 0, count: 0 }) - 1);
    for (const t of tasks) {
      const i = idx.get((t.completedAt ?? '').slice(0, 7));
      if (i != null) { buckets[i].hours += (t.actualMin ?? 0) / 60; buckets[i].count += 1; }
    }
  } else if (period === 'monat') {
    for (let d = mondayOf(fromD); d <= toD; d = addDays(d, 7)) {
      const key = dayKey(d);
      idx.set(key, buckets.push({ key, label: d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }), hours: 0, count: 0 }) - 1);
    }
    for (const t of tasks) {
      const i = idx.get(dayKey(mondayOf(parseDay(t.completedAt!))));
      if (i != null) { buckets[i].hours += (t.actualMin ?? 0) / 60; buckets[i].count += 1; }
    }
  } else {
    // Woche (and any other range): one bucket per day
    for (let d = fromD; d <= toD; d = addDays(d, 1)) {
      const key = dayKey(d);
      idx.set(key, buckets.push({ key, label: d.toLocaleDateString('de-DE', { weekday: 'short' }), hours: 0, count: 0 }) - 1);
    }
    for (const t of tasks) {
      const i = idx.get(t.completedAt!);
      if (i != null) { buckets[i].hours += (t.actualMin ?? 0) / 60; buckets[i].count += 1; }
    }
  }
  return buckets;
}

function ReportView(props: {
  state: AppState;
  period: ReportPeriod;
  onSetPeriod: (p: ReportPeriod) => void;
  today: Date;
}) {
  const { state: s, period, onSetPeriod, today } = props;
  const { from, to } = periodRange(period, s.custFrom, s.custTo, today);

  // completed tasks in the selected slice (legacy ones without a date are ignored
  // here – the Archive still lists them)
  const done = s.todos.filter((t) => t.archived && t.completedAt && t.completedAt >= from && t.completedAt <= to);
  const timed = done.filter((t) => t.actualMin != null);

  const totalPlanned = timed.reduce((a, t) => a + t.plannedMin, 0);
  const totalActual = timed.reduce((a, t) => a + (t.actualMin ?? 0), 0);
  const deviation = totalPlanned > 0 ? Math.round(((totalActual - totalPlanned) / totalPlanned) * 100) : 0;
  // per-task estimate quality (±10 % counts as "im Plan")
  let onPlan = 0, over = 0, under = 0;
  for (const t of timed) {
    const d = (t.actualMin ?? 0) - t.plannedMin;
    const tol = Math.max(2, t.plannedMin * 0.1);
    if (d > tol) over++;
    else if (d < -tol) under++;
    else onPlan++;
  }

  // Ist-time per category
  const catRows = (Object.keys(CATEGORY_LABELS) as TodoCategory[]).map((c) => ({
    cat: c,
    min: timed.filter((t) => t.category === c).reduce((a, t) => a + (t.actualMin ?? 0), 0),
  }));
  const catTotal = catRows.reduce((a, r) => a + r.min, 0);

  const buckets = reportBuckets(done, period, from, to);
  const maxHours = Math.max(0.001, ...buckets.map((b) => b.hours));
  const avgMin = timed.length > 0 ? Math.round(totalActual / timed.length) : 0;

  const periodDefs: [ReportPeriod, string][] = [
    ['woche', 'Woche'],
    ['monat', 'Monat'],
    ['jahr', 'Jahr'],
  ];

  const sectionLabel = (txt: string) => (
    <div style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: C.greyFooter, fontWeight: 700, marginBottom: 12, marginTop: 28 }}>{txt}</div>
  );

  return (
    <section style={{ padding: '18px 20px 36px' }}>
      <div style={{ display: 'flex', border: '1px solid #D5DBDF', background: C.lt2, marginBottom: 20, overflow: 'hidden' }}>
        {periodDefs.map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => onSetPeriod(k)}
            style={{ flex: '1 1 auto', padding: '9px 4px', fontSize: 12, fontWeight: 700, textAlign: 'center', color: period === k ? C.lt1 : '#5E7184', background: period === k ? C.accent1 : 'transparent' }}
          >
            {label}
          </button>
        ))}
      </div>

      {done.length === 0 ? (
        <div style={{ fontSize: 13, color: C.muted, padding: '8px 0' }}>Keine erledigten Aufgaben in diesem Zeitraum.</div>
      ) : (
        <>
          {/* ---- Prognose-Genauigkeit (Plan vs. Ist) ---- */}
          <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: C.greyFooter, fontWeight: 700 }}>Prognose</div>
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <div style={{ flex: 1, border: '1px solid #E1E5E8', background: C.lt1, padding: '12px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 300, color: C.greyFooter, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{fmtDur(totalPlanned)}</div>
              <div style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: C.greyFooter, marginTop: 5 }}>geplant</div>
            </div>
            <div style={{ flex: 1, border: '1px solid #E1E5E8', background: C.lt1, padding: '12px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 300, color: C.dk1, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{fmtDur(totalActual)}</div>
              <div style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: C.greyFooter, marginTop: 5 }}>benötigt</div>
            </div>
            <div style={{ flex: 1, border: '1px solid #E1E5E8', background: C.lt1, padding: '12px 10px', textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 300, color: deviation > 0 ? C.critical : '#2E8B3D', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                {deviation > 0 ? '+' : ''}{deviation}%
              </div>
              <div style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: C.greyFooter, marginTop: 5 }}>Abweichung</div>
            </div>
          </div>
          {timed.length > 0 ? (
            <div style={{ fontSize: 12, color: C.greyFooter, marginTop: 10 }}>
              <span style={{ color: '#2E8B3D', fontWeight: 700 }}>{onPlan}</span> im Plan ·{' '}
              <span style={{ color: C.critical, fontWeight: 700 }}>{over}</span> überzogen ·{' '}
              <span style={{ color: C.accent1, fontWeight: 700 }}>{under}</span> schneller
              <span style={{ color: C.muted }}> &nbsp;(von {timed.length} mit Zeitmessung)</span>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: C.muted, marginTop: 10 }}>Noch keine Aufgabe mit Zeitmessung in diesem Zeitraum.</div>
          )}

          {/* ---- Durchsatz ---- */}
          {sectionLabel('Durchsatz')}
          <div style={{ display: 'flex', gap: 18, marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 24, fontWeight: 300, color: C.accent1, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{done.length}</div>
              <div style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: C.greyFooter, marginTop: 4 }}>erledigt</div>
            </div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 300, color: C.accent1, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{fmtDur(totalActual)}</div>
              <div style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: C.greyFooter, marginTop: 4 }}>Std gesamt</div>
            </div>
            <div>
              <div style={{ fontSize: 24, fontWeight: 300, color: C.accent1, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{fmtDur(avgMin)}</div>
              <div style={{ fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: C.greyFooter, marginTop: 4 }}>Ø / Aufgabe</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 130, paddingBottom: 2, borderBottom: '1px solid #EDF0F1' }}>
            {buckets.map((b, i) => (
              <div key={i} style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <div style={{ width: '62%', minWidth: 7, maxWidth: 30, height: Math.round((b.hours / maxHours) * 110), background: b.hours > 0 ? C.accent1 : '#EDF0F1' }} title={`${fmtDur(Math.round(b.hours * 60))} h`} />
                <div style={{ fontSize: 9, color: C.muted, whiteSpace: 'nowrap' }}>{b.label}</div>
              </div>
            ))}
          </div>

          {/* ---- Kategorie-Verteilung ---- */}
          {sectionLabel('Nach Kategorie')}
          {catTotal === 0 ? (
            <div style={{ fontSize: 13, color: C.muted, padding: '4px 0' }}>Keine gemessene Zeit in diesem Zeitraum.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {catRows.map((r) => {
                const pct = catTotal > 0 ? Math.round((r.min / catTotal) * 100) : 0;
                return (
                  <div key={r.cat}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{ width: 10, height: 10, flex: '0 0 auto', background: CATEGORY_COLORS[r.cat] }} />
                      <span style={{ fontSize: 14, fontWeight: 700, color: C.dk1 }}>{CATEGORY_LABELS[r.cat]}</span>
                      <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 700, color: C.dk1, fontVariantNumeric: 'tabular-nums' }}>{fmtDur(r.min)}</span>
                      <span style={{ fontSize: 12, color: C.muted, width: 38, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
                    </div>
                    <div style={{ flex: '1 1 auto', height: 8, background: '#F0F2F3', position: 'relative' }}>
                      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: pct + '%', background: CATEGORY_COLORS[r.cat] }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/* ======================= PFLEGE ======================= */
function AdminView(props: {
  state: AppState;
  onUpdateName: (pid: string, v: string) => void;
  onMoveProject: (pid: string, dir: -1 | 1) => void;
  onDeleteProject: (pid: string) => void;
  onAddProject: (category: TodoCategory) => void;
  accountEmail: string | null;
  onLogout: () => void;
}) {
  const { state: s, onUpdateName, onMoveProject, onDeleteProject, onAddProject, accountEmail, onLogout } = props;

  const section = (cat: TodoCategory) => {
    const rows = s.projects.filter((p) => p.category === cat).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'de'));
    return (
      <div key={cat} style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: C.accent1, fontWeight: 700, marginBottom: 8 }}>
          {CATEGORY_LABELS[cat]} <span style={{ color: C.muted }}>({rows.length})</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map((p, i, arr) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                value={p.name}
                onChange={(e) => onUpdateName(p.id, e.target.value)}
                placeholder="Projektname …"
                style={{ flex: '1 1 auto', minWidth: 0, border: '1px solid #D5DBDF', padding: '8px 10px', fontSize: 14, color: C.dk1, background: C.lt2, outline: 'none' }}
              />
              <button type="button" onClick={() => onMoveProject(p.id, -1)} disabled={i === 0} style={moveBtnStyle(C.dk1, C.lt2, i === 0)}>
                ▲
              </button>
              <button type="button" onClick={() => onMoveProject(p.id, 1)} disabled={i === arr.length - 1} style={moveBtnStyle(C.dk1, C.lt2, i === arr.length - 1)}>
                ▼
              </button>
              <button type="button" onClick={() => onDeleteProject(p.id)} title="Projekt löschen" style={moveBtnStyle(C.critical, C.lt2, false)}>
                ✕
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => onAddProject(cat)}
          style={{ marginTop: 8, padding: '7px 12px', background: C.lt2, color: C.dk1, fontSize: 12, fontWeight: 700 }}
        >
          + Projekt
        </button>
      </div>
    );
  };

  return (
    <section style={{ padding: '18px 20px 36px' }}>
      <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: C.greyFooter, fontWeight: 700, marginBottom: 4 }}>
        Projekte verwalten
      </div>
      <p style={{ fontSize: 12, lineHeight: 1.5, color: C.greyFooter, margin: '0 0 18px' }}>
        Projekte je Bereich anlegen, umbenennen, sortieren oder löschen.
      </p>

      {(['projekt', 'akquise', 'intern'] as TodoCategory[]).map((c) => section(c))}

      {accountEmail && (
        <div style={{ marginTop: 26, borderTop: '1px solid #EAEDEF', paddingTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: C.greyFooter, fontWeight: 700 }}>Angemeldet als</div>
            <div style={{ fontSize: 13, color: C.dk1, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{accountEmail}</div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            style={{ flex: '0 0 auto', padding: '9px 14px', border: '1px solid #D5DBDF', background: C.lt1, color: C.accent1, fontSize: 12, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' }}
          >
            Abmelden
          </button>
        </div>
      )}
    </section>
  );
}

/* ======================= LOADING ======================= */
function LoadingScreen({ text }: { text: string }) {
  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#DDE3E7',
        fontFamily: "'Roboto Condensed','Roboto',system-ui,sans-serif",
      }}
    >
      <div style={{ fontSize: 13, letterSpacing: '.14em', textTransform: 'uppercase', color: C.greyFooter, fontWeight: 700 }}>{text}</div>
    </div>
  );
}

/* ======================= BOTTOM NAV ======================= */
function BottomNav({ tab, onSelect }: { tab: Tab; onSelect: (t: Tab) => void }) {
  const wrench = (
    <svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
  const checklist = (
    <svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
      <path d="M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" />
    </svg>
  );
  const archiveIcon = (
    <svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
      <path d="M3 4h18v4H3zM5 8v12h14V8M9 12h6" />
    </svg>
  );
  const items: [Tab, string, React.ReactNode][] = [
    ['tasks', 'Daily Tasks', checklist],
    ['report', 'Reporting', '▥'],
    ['archiv', 'Archiv', archiveIcon],
    ['admin', 'Pflege', wrench],
  ];
  return (
    <nav style={{ flex: '0 0 auto', display: 'flex', background: C.lt1, borderTop: '1px solid #EAEDEF' }}>
      {items.map(([k, label, icon]) => {
        const on = tab === k;
        return (
          <button
            key={k}
            type="button"
            onClick={() => onSelect(k)}
            style={{
              flex: 1,
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
              padding: '11px 0 13px',
              color: on ? C.accent1 : C.muted,
              background: C.lt1,
            }}
          >
            <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: on ? C.accent1 : 'transparent' }} />
            <span style={{ fontSize: 19, lineHeight: 1 }}>{icon}</span>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em' }}>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/* ======================= FOCUS COUNTDOWN ======================= */
/** Format a (possibly negative) number of seconds as M:SS / H:MM:SS. */
function fmtCountdown(totalSec: number): string {
  const sign = totalSec < 0 ? '+' : '';
  const sec = Math.abs(totalSec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const ss = sec % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return sign + (h > 0 ? `${h}:${mm}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`);
}

/** The focus-countdown panel shown above the task list while a task runs:
 *  planned time counting down (into overtime when overrun), the task and its
 *  sub-activities, plus "Erledigt" / "Schließen". */
function CountdownPanel(props: {
  todo: Todo;
  startedAt: number;
  onToggleItem: (i: number) => void;
  onDone: () => void;
  onClose: () => void;
}) {
  const { todo, startedAt, onToggleItem, onDone, onClose } = props;
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const elapsedSec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const remainingSec = todo.plannedMin * 60 - elapsedSec;
  const overtime = remainingSec < 0;
  const timeColor = overtime ? C.critical : C.accent1;
  const items = todo.checklist ?? [];

  return (
    <div style={{ border: '1px solid ' + timeColor, borderLeft: '4px solid ' + timeColor, background: C.lt2, padding: '14px 16px', marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', color: timeColor, fontWeight: 700 }}>
            {overtime ? 'Überzeit' : 'Fokus läuft'}
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.dk1, marginTop: 4, wordBreak: 'break-word' }}>
            {todo.title.trim() === '' ? '(ohne Titel)' : todo.title}
          </div>
          <div style={{ fontSize: 11, color: C.greyFooter, marginTop: 3 }}>
            {CATEGORY_LABELS[todo.category]} &nbsp;·&nbsp; geplant {fmtDur(todo.plannedMin)} h
          </div>
        </div>
        <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
          <div style={{ fontSize: 38, fontWeight: 300, color: timeColor, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
            {fmtCountdown(remainingSec)}
          </div>
          <div style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: C.greyFooter }}>
            {overtime ? 'über Plan' : 'verbleibend'}
          </div>
        </div>
      </div>

      {items.some((c) => c.text.trim() !== '') && (
        <div style={{ marginTop: 12, borderTop: '1px solid #E1E5E8', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {items.map((it, i) =>
            it.text.trim() === '' ? null : (
              <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={it.done} onChange={() => onToggleItem(i)} style={{ width: 18, height: 18, flex: '0 0 auto' }} />
                <span style={{ fontSize: 14, color: it.done ? C.muted : C.dk1, textDecoration: it.done ? 'line-through' : 'none', wordBreak: 'break-word' }}>{it.text}</span>
              </label>
            ),
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <button
          type="button"
          onClick={onDone}
          style={{ flex: 2, padding: 12, background: '#2E8B3D', color: C.lt1, fontSize: 14, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase' }}
        >
          Erledigt
        </button>
        <button
          type="button"
          onClick={onClose}
          style={{ flex: 1, padding: 12, background: C.lt1, color: C.dk1, border: '1px solid #D5DBDF', fontSize: 14, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase' }}
        >
          Schließen
        </button>
      </div>
    </div>
  );
}

/* ======================= DAILY TASKS ======================= */
type TaskSortKey = 'title' | 'dauer' | 'urgency' | 'importance' | 'prio';

const taskCellStyle: CSSProperties = {
  padding: '9px 6px',
  fontSize: 12,
  color: C.greyFooter,
  verticalAlign: 'top',
  whiteSpace: 'normal',
  wordBreak: 'break-word',
};
const taskNumCell: CSSProperties = {
  ...taskCellStyle,
  textAlign: 'right',
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
};

function DailyTasksView(props: {
  state: AppState;
  /** the focus-countdown panel, rendered above the list while a task is running */
  countdown: React.ReactNode;
  /** id of the task whose countdown is currently running (null = none) */
  runningId: string | null;
  onAdd: () => void;
  onEdit: (t: Todo) => void;
  onStart: (t: Todo) => void;
  onComplete: (id: string) => void;
}) {
  const { state: s, countdown, runningId, onAdd, onEdit, onStart, onComplete } = props;
  const provisional = s.todos.filter((t) => !t.archived && t.title.trim() === '');
  const [sortKey, setSortKey] = useState<TaskSortKey>('prio');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const keyVal: Record<TaskSortKey, (t: Todo) => number | string> = {
    title: (t) => t.title.toLowerCase(),
    dauer: (t) => t.plannedMin,
    urgency: (t) => t.urgency,
    importance: (t) => t.importance,
    prio: (t) => t.urgency + t.importance,
  };
  const cmp = (a: Todo, b: Todo) => {
    // 2-minute tasks are always pinned to the top, regardless of the chosen sort
    const pa = a.plannedMin === 2 ? 0 : 1;
    const pb = b.plannedMin === 2 ? 0 : 1;
    if (pa !== pb) return pa - pb;
    const va = keyVal[sortKey](a);
    const vb = keyVal[sortKey](b);
    let r = va < vb ? -1 : va > vb ? 1 : 0;
    if (r === 0) r = a.urgency + a.importance - (b.urgency + b.importance); // stable tiebreak
    return sortDir === 'asc' ? r : -r;
  };

  function clickSort(k: TaskSortKey) {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(k);
      setSortDir('asc');
    }
  }

  const th = (label: string, k: TaskSortKey, align: 'left' | 'right') => {
    const on = sortKey === k;
    return (
      <th
        onClick={() => clickSort(k)}
        style={{
          textAlign: align,
          padding: '8px 6px',
          fontSize: 10,
          letterSpacing: '.05em',
          textTransform: 'uppercase',
          color: on ? C.accent1 : C.greyFooter,
          fontWeight: 700,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          borderBottom: '2px solid ' + (on ? C.accent1 : '#E1E5E8'),
          userSelect: 'none',
        }}
      >
        {label}
        <span style={{ opacity: on ? 1 : 0.25 }}>{on ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ▲'}</span>
      </th>
    );
  };

  const startButton = (t: Todo) => {
    const on = runningId === t.id;
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (!on) onStart(t);
        }}
        disabled={on}
        title={on ? 'Countdown läuft' : 'Countdown starten'}
        style={{
          flex: '0 0 auto',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 30,
          height: 30,
          padding: 0,
          border: '1px solid ' + C.accent1,
          background: on ? C.accent1 : C.lt1,
          color: on ? C.lt1 : C.accent1,
          cursor: on ? 'default' : 'pointer',
        }}
      >
        <svg width={15} height={15} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 5v14l11-7z" fill="currentColor" />
        </svg>
      </button>
    );
  };

  const erledigtButton = (t: Todo) => (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onComplete(t.id);
      }}
      title="Erledigt – ins Archiv verschieben"
      style={{
        flex: '0 0 auto',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 30,
        height: 30,
        padding: 0,
        border: '1px solid #2E8B3D',
        background: '#2E8B3D',
        color: C.lt1,
        cursor: 'pointer',
      }}
    >
      <svg width={15} height={15} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 13l4 4L19 7" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );

  // "concrete" tasks (with a title) are grouped by category; title-less ones are provisional
  const categoryTable = (cat: TodoCategory) => {
    const rows = s.todos.filter((t) => !t.archived && t.category === cat && t.title.trim() !== '').sort(cmp);
    return (
      <div key={cat} style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: C.accent1, fontWeight: 700, marginBottom: 8 }}>
          {CATEGORY_LABELS[cat]} <span style={{ color: C.muted }}>({rows.length})</span>
        </div>
        {rows.length === 0 ? (
          <div style={{ fontSize: 12, color: C.muted, padding: '2px 0 4px' }}>Keine Aufgaben.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '30%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '24%' }} />
            </colgroup>
            <thead>
              <tr>
                {th('Titel', 'title', 'left')}
                {th('Dauer', 'dauer', 'right')}
                {th('Frist', 'urgency', 'right')}
                {th('Wicht', 'importance', 'right')}
                {th('Prio', 'prio', 'right')}
                <th style={{ borderBottom: '2px solid #E1E5E8' }} aria-label="Aktionen" />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} onClick={() => onEdit(t)} style={{ cursor: 'pointer', borderBottom: '1px solid #EAEDEF', background: t.zug ? ZUG_ROW_BG : undefined }}>
                  <td style={{ ...taskCellStyle, color: C.dk1, fontWeight: 700 }}>
                    {t.title}
                    {(() => {
                      const items = (t.checklist ?? []).filter((c) => c.text.trim() !== '');
                      if (items.length === 0) return null;
                      const done = items.filter((c) => c.done).length;
                      return (
                        <div style={{ fontSize: 11, fontWeight: 500, color: C.muted, marginTop: 2 }}>
                          ✓ {done}/{items.length}
                        </div>
                      );
                    })()}
                    {t.drawing && (
                      <img
                        src={t.drawing}
                        alt="Skizze"
                        style={{ display: 'block', marginTop: 4, maxWidth: '100%', height: 28, objectFit: 'contain', objectPosition: 'left', border: '1px solid #EAEDEF' }}
                      />
                    )}
                  </td>
                  <td style={taskNumCell}>{fmtDur(t.plannedMin)}</td>
                  <td style={taskNumCell} title={URGENCY_LABELS[t.urgency]}>{t.urgency + 1}</td>
                  <td style={taskNumCell} title={IMPORTANCE_LABELS[t.importance]}>{t.importance + 1}</td>
                  <td style={{ ...taskNumCell, color: C.dk1, fontWeight: 700 }}>{t.urgency + t.importance + 2}</td>
                  <td style={{ ...taskCellStyle, padding: '6px 2px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                      {startButton(t)}
                      {erledigtButton(t)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    );
  };

  return (
    <section style={{ padding: '18px 20px 36px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: C.greyFooter, fontWeight: 700 }}>Daily Tasks</div>
          <div style={{ fontSize: 13, color: C.greyFooter, marginTop: 3 }}>Was möchtest du heute erledigen?</div>
        </div>
        <button type="button" onClick={onAdd} style={{ flex: '0 0 auto', padding: '9px 14px', background: C.accent1, color: C.lt1, fontSize: 12, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
          + Aufgabe
        </button>
      </div>

      {countdown}

      {s.todos.filter((t) => !t.archived).length === 0 ? (
        <div style={{ fontSize: 13, color: C.muted, padding: '8px 0' }}>Noch keine Aufgaben – lege mit „+ Aufgabe" eine an.</div>
      ) : (
        <>
          {(['projekt', 'akquise', 'intern'] as TodoCategory[]).map((c) => categoryTable(c))}

          {provisional.length > 0 && (
            <div style={{ marginBottom: 22 }}>
              <div style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: C.accent1, fontWeight: 700, marginBottom: 8 }}>
                Vorläufig <span style={{ color: C.muted }}>({provisional.length})</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {provisional.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => onEdit(t)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #E1E5E8', background: t.zug ? ZUG_ROW_BG : C.lt1, padding: '8px 10px', cursor: 'pointer' }}
                  >
                    {t.drawing ? (
                      <img src={t.drawing} alt="Skizze" style={{ height: 40, maxWidth: '70%', objectFit: 'contain', objectPosition: 'left' }} />
                    ) : (
                      <span style={{ fontSize: 13, color: C.muted }}>(ohne Titel)</span>
                    )}
                    <span style={{ flex: '1 1 auto' }} />
                    {startButton(t)}
                    {erledigtButton(t)}
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>
                Nur skizziert – tippen, um später zu konkretisieren (Titel, Zeit, Fristigkeit …).
              </div>
            </div>
          )}

          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
            Frist/Wicht: 1 = höchste (Frist 1 = sofort, Wicht 1 = very high) · Prio = Frist + Wicht · Spaltenkopf tippen zum Sortieren · Zeile tippen zum Bearbeiten.
          </div>
        </>
      )}
    </section>
  );
}

/* ======================= ARCHIV ======================= */
/** German short day label from a YYYY-MM-DD key, e.g. "Mi., 17.06.". */
function fmtDayShort(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

function ArchiveView(props: {
  state: AppState;
  period: ReportPeriod;
  onSetPeriod: (p: ReportPeriod) => void;
  today: Date;
  onEdit: (t: Todo) => void;
  onRestore: (id: string) => void;
}) {
  const { state: s, period, onSetPeriod, today, onEdit, onRestore } = props;
  const archived = s.todos.filter((t) => t.archived);

  // Filter by completion day within the selected slice. Legacy tasks without a
  // completion date are always shown (sorted last) so nothing gets lost.
  const { from, to } = periodRange(period, s.custFrom, s.custTo, today);
  const shown = archived.filter((t) => !t.completedAt || (t.completedAt >= from && t.completedAt <= to));
  shown.sort((a, b) => {
    if (a.completedAt && b.completedAt) return a.completedAt < b.completedAt ? 1 : a.completedAt > b.completedAt ? -1 : 0;
    if (a.completedAt) return -1;
    if (b.completedAt) return 1;
    return 0;
  });

  const totalPlanned = shown.reduce((a, t) => a + (t.actualMin != null ? t.plannedMin : 0), 0);
  const totalActual = shown.reduce((a, t) => a + (t.actualMin ?? 0), 0);

  const periodDefs: [ReportPeriod, string][] = [
    ['woche', 'Woche'],
    ['monat', 'Monat'],
    ['jahr', 'Jahr'],
  ];

  return (
    <section style={{ padding: '18px 20px 36px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: C.greyFooter, fontWeight: 700 }}>Archiv</div>
          <div style={{ fontSize: 13, color: C.greyFooter, marginTop: 3 }}>Erledigte Aufgaben ({shown.length})</div>
        </div>
        <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
          <div style={{ fontSize: 28, fontWeight: 300, color: C.accent1, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{fmtDur(totalActual)}</div>
          <div style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: C.greyFooter }}>Benötigt (Plan {fmtDur(totalPlanned)})</div>
        </div>
      </div>

      <div style={{ display: 'flex', border: '1px solid #D5DBDF', background: C.lt2, marginBottom: 20, overflow: 'hidden' }}>
        {periodDefs.map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => onSetPeriod(k)}
            style={{ flex: '1 1 auto', padding: '9px 4px', fontSize: 12, fontWeight: 700, textAlign: 'center', color: period === k ? C.lt1 : '#5E7184', background: period === k ? C.accent1 : 'transparent' }}
          >
            {label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div style={{ fontSize: 13, color: C.muted, padding: '8px 0' }}>Keine erledigten Aufgaben in diesem Zeitraum.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {shown.map((t) => {
            const items = (t.checklist ?? []).filter((c) => c.text.trim() !== '');
            const done = items.filter((c) => c.done).length;
            const timed = t.actualMin != null;
            const diff = timed ? t.actualMin! - t.plannedMin : 0;
            const diffColor = diff > 0 ? C.critical : '#2E8B3D';
            return (
              <div
                key={t.id}
                onClick={() => onEdit(t)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #E1E5E8', background: C.lt1, padding: '10px 12px', cursor: 'pointer' }}
              >
                <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.dk1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {t.title.trim() === '' ? '(ohne Titel)' : t.title}
                  </div>
                  <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                    {CATEGORY_LABELS[t.category]}
                    {t.completedAt && <span> &nbsp;·&nbsp; {fmtDayShort(t.completedAt)}</span>}
                    {items.length > 0 && <span> &nbsp;·&nbsp; ✓ {done}/{items.length}</span>}
                  </div>
                  <div style={{ fontSize: 12, marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
                    <span style={{ color: C.greyFooter }}>Plan {fmtDur(t.plannedMin)}</span>
                    {timed ? (
                      <>
                        <span style={{ color: C.greyFooter }}> &nbsp;·&nbsp; </span>
                        <span style={{ color: C.dk1, fontWeight: 700 }}>Ist {fmtDur(t.actualMin!)}</span>
                        {diff !== 0 && (
                          <span style={{ color: diffColor, fontWeight: 700 }}> &nbsp;({diff > 0 ? '+' : '−'}{fmtDur(Math.abs(diff))})</span>
                        )}
                      </>
                    ) : (
                      <span style={{ color: C.muted }}> &nbsp;·&nbsp; ohne Zeitmessung</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRestore(t.id);
                  }}
                  title="Wiederherstellen – zurück in die Aufgabenliste"
                  style={{ flex: '0 0 auto', padding: '8px 12px', border: '1px solid ' + C.accent1, background: C.lt1, color: C.accent1, fontSize: 12, fontWeight: 700, letterSpacing: '.04em', whiteSpace: 'nowrap' }}
                >
                  Wiederherstellen
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Light tint applied to a whole row when the task is "im Zug erledigbar". */
const ZUG_ROW_BG = '#E1F5F9';

function TaskPill({ text, on, onClick, grow }: { text: string; on: boolean; onClick: () => void; grow?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: grow ? '1 1 0' : '0 0 auto',
        padding: '8px 12px',
        fontSize: 12,
        fontWeight: 700,
        whiteSpace: 'nowrap',
        border: '1px solid ' + (on ? C.accent1 : '#D5DBDF'),
        color: on ? C.lt1 : '#5E7184',
        background: on ? C.accent1 : C.lt1,
        cursor: 'pointer',
      }}
    >
      {text}
    </button>
  );
}

/* ======================= TASK EDITOR ======================= */
function TodoSheet(props: {
  initial: Todo | null;
  projects: Project[];
  onSave: (t: Todo) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const { initial, projects, onSave, onDelete, onClose } = props;
  const [title, setTitle] = useState(initial?.title ?? '');
  const [category, setCategory] = useState<TodoCategory>(initial?.category ?? 'projekt');
  const [projectId, setProjectId] = useState<string | null>(initial?.projectId ?? null);
  const [plannedMin, setPlannedMin] = useState(initial?.plannedMin ?? 30);
  const [urgency, setUrgency] = useState(initial?.urgency ?? 2);
  const [importance, setImportance] = useState(initial?.importance ?? 2);
  const [drawing, setDrawing] = useState<string | null>(initial?.drawing ?? null);
  const [zug, setZug] = useState<boolean>(initial?.zug ?? false);
  const [checklist, setChecklist] = useState<ChecklistItem[]>(
    initial?.checklist && initial.checklist.length ? initial.checklist.map((c) => ({ ...c })) : emptyChecklist(),
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  // a task can be saved as soon as it has a title OR a sketch (drawing-only = provisional)
  const canSave = title.trim().length > 0 || !!drawing;

  function current(): Todo {
    return {
      id: initial?.id ?? 't' + Date.now(),
      title: title.trim(),
      category,
      projectId,
      plannedMin,
      urgency,
      importance,
      drawing,
      zug,
      archived: initial?.archived ?? false,
      checklist,
    };
  }
  function save() {
    if (!canSave) return;
    onSave(current());
  }

  const label = (txt: string) => (
    <div style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: C.greyFooter, fontWeight: 700, margin: '16px 0 8px' }}>{txt}</div>
  );

  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(14,23,33,.4)', zIndex: 30, display: 'flex', alignItems: 'flex-end', animation: 'tkFade .18s ease' }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxHeight: '92vh',
          overflowY: 'auto',
          background: C.lt1,
          animation: 'tkRise .26s cubic-bezier(.16,.84,.44,1)',
          boxShadow: '0 -8px 30px rgba(14,23,33,.2)',
          // prevent iOS word-selection / callout from neighbouring labels while sketching
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
        }}
      >
        <div style={{ background: C.accent1, padding: '14px 20px 16px' }}>
          <div style={{ width: 38, height: 4, background: 'rgba(255,255,255,.45)', margin: '0 auto 14px' }} />
          <div style={{ fontSize: 20, fontWeight: 700, color: C.lt1 }}>{initial ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'}</div>
        </div>
        <div style={{ padding: '4px 20px 24px' }}>
          {label('Skizze (optional)')}
          <DrawingPad value={drawing} onChange={setDrawing} />

          <button
            type="button"
            onClick={save}
            disabled={!canSave}
            style={{ width: '100%', marginTop: 12, padding: 13, background: canSave ? C.accent1 : '#C7CFD4', color: C.lt1, fontSize: 14, fontWeight: 700, cursor: canSave ? 'pointer' : 'not-allowed' }}
          >
            Speichern
          </button>

          {label('Aufgabe')}
          <textarea value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Was ist zu tun? – oder leer lassen und nur skizzieren" style={{ width: '100%', height: 64, resize: 'none', border: '1px solid #D5DBDF', padding: '11px 12px', fontSize: 15, lineHeight: 1.4, color: C.dk1, outline: 'none', background: C.lt2, userSelect: 'text', WebkitUserSelect: 'text' }} />
          <div style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>
            Ohne Titel wird die Aufgabe als „vorläufig" gespeichert und kann später konkretisiert werden.
          </div>

          {label('Aktivitäten')}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {checklist.map((it, i, arr) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={it.done}
                  onChange={() => setChecklist((cl) => sinkDone(cl.map((c, idx) => (idx === i ? { ...c, done: !c.done } : c))))}
                  style={{ width: 18, height: 18, flex: '0 0 auto' }}
                />
                <input
                  type="text"
                  value={it.text}
                  onChange={(e) => setChecklist((cl) => cl.map((c, idx) => (idx === i ? { ...c, text: e.target.value } : c)))}
                  placeholder="Subaktivität …"
                  style={{ flex: '1 1 auto', minWidth: 0, border: '1px solid #D5DBDF', padding: '8px 10px', fontSize: 14, color: C.dk1, background: C.lt2, outline: 'none', textDecoration: it.done ? 'line-through' : 'none', userSelect: 'text', WebkitUserSelect: 'text' }}
                />
                <button type="button" onClick={() => setChecklist((cl) => moveItem(cl, i, -1))} disabled={i === 0} style={moveBtnStyle(C.dk1, C.lt2, i === 0)}>
                  ▲
                </button>
                <button type="button" onClick={() => setChecklist((cl) => moveItem(cl, i, 1))} disabled={i === arr.length - 1} style={moveBtnStyle(C.dk1, C.lt2, i === arr.length - 1)}>
                  ▼
                </button>
                <button type="button" onClick={() => setChecklist((cl) => cl.filter((_, idx) => idx !== i))} title="Subaktivität löschen" style={moveBtnStyle(C.critical, C.lt2, false)}>
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setChecklist((cl) => [{ text: '', done: false }, ...cl])}
            style={{ marginTop: 8, padding: '7px 12px', background: C.lt2, color: C.dk1, fontSize: 12, fontWeight: 700 }}
          >
            + Aktivität
          </button>

          {label('Kategorie')}
          <div style={{ display: 'flex', gap: 8 }}>
            {(Object.keys(CATEGORY_LABELS) as TodoCategory[]).map((c) => (
              <TaskPill key={c} text={CATEGORY_LABELS[c]} on={category === c} onClick={() => setCategory(c)} grow />
            ))}
          </div>

          {label('Projekt (optional)')}
          <select value={projectId ?? ''} onChange={(e) => setProjectId(e.target.value || null)} style={{ width: '100%', border: '1px solid #D5DBDF', padding: '11px 12px', fontSize: 14, color: C.dk1, background: C.lt2, outline: 'none' }}>
            <option value="">— keins —</option>
            {(['projekt', 'akquise', 'intern'] as TodoCategory[]).map((cat) => {
              const ps = projects.filter((p) => p.category === cat).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'de'));
              if (ps.length === 0) return null;
              return (
                <optgroup key={cat} label={CATEGORY_LABELS[cat]}>
                  {ps.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </optgroup>
              );
            })}
          </select>

          {label('Geplante Dauer (Minuten)')}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {DURATION_OPTIONS.map((m) => (
              <TaskPill key={m} text={String(m)} on={plannedMin === m} onClick={() => setPlannedMin(m)} />
            ))}
          </div>

          {label('Fristigkeit')}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {URGENCY_LABELS.map((u, i) => (
              <TaskPill key={u} text={u} on={urgency === i} onClick={() => setUrgency(i)} />
            ))}
          </div>

          {label('Wichtigkeit')}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {IMPORTANCE_LABELS.map((w, i) => (
              <TaskPill key={w} text={w} on={importance === i} onClick={() => setImportance(i)} />
            ))}
          </div>

          {label('Kontext')}
          <button
            type="button"
            onClick={() => setZug(!zug)}
            style={{
              padding: '8px 14px',
              fontSize: 12,
              fontWeight: 700,
              border: '1px solid ' + (zug ? '#19B3C6' : '#D5DBDF'),
              background: zug ? '#19B3C6' : C.lt1,
              color: zug ? '#FFFFFF' : '#5E7184',
              cursor: 'pointer',
            }}
          >
            {zug ? '✓ ' : ''}Im Zug erledigbar
          </button>

          <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
            <button type="button" onClick={onClose} style={{ flex: 1, padding: 13, background: C.lt2, color: C.dk1, fontSize: 14, fontWeight: 700 }}>Abbrechen</button>
            <button type="button" onClick={save} disabled={!canSave} style={{ flex: 2, padding: 13, background: canSave ? C.accent1 : '#C7CFD4', color: C.lt1, fontSize: 14, fontWeight: 700, cursor: canSave ? 'pointer' : 'not-allowed' }}>Speichern</button>
          </div>

          {onDelete &&
            (confirmDelete ? (
              <div style={{ marginTop: 12, padding: '12px 13px', background: '#FBE9F0', border: '1px solid ' + C.critical }}>
                <div style={{ fontSize: 13, color: C.dk1, fontWeight: 500, marginBottom: 10 }}>Diese Aufgabe wirklich löschen?</div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button type="button" onClick={() => setConfirmDelete(false)} style={{ flex: 1, padding: 11, background: C.lt2, color: C.dk1, fontSize: 13, fontWeight: 700 }}>Abbrechen</button>
                  <button type="button" onClick={onDelete} style={{ flex: 1, padding: 11, background: C.critical, color: C.lt1, fontSize: 13, fontWeight: 700 }}>Löschen</button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} style={{ width: '100%', marginTop: 10, padding: 11, background: 'transparent', color: C.critical, fontSize: 13, fontWeight: 700 }}>Aufgabe löschen</button>
            ))}
        </div>
      </div>
    </div>
  );
}
