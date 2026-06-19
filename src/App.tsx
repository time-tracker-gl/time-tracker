import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ChecklistItem, DaySegment, Gap, Project, ReportPeriod, Segment, Tab, TileLayout, Todo, TodoCategory } from './types';
import { C, PALETTE } from './theme';
import { fmtClock, fmtDur, nowMinutes, textOn } from './lib/time';
import { buildReport, PPM } from './lib/report';
import { aggregate, periodRange } from './lib/aggregate';
import { DrawingPad } from './components/DrawingPad';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { Login } from './components/Login';
import {
  loadProjects,
  loadSegments,
  loadSegmentsRange,
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
  draftCode: string;
  draftName: string;
  draftColor: string;
  tab: Tab;
  sheetSegId: string | null;
  tileLayout: TileLayout;
  fillGap: Gap | null;
  reportPeriod: ReportPeriod;
  custFrom: string;
  custTo: string;
}

const SEED_PROJECTS: Project[] = [
  { id: 'p1', code: 'EOS-01', name: 'EOS Rollout', color: '#2B5FAE' },
  { id: 'p2', code: 'E2E-04', name: 'E2E Training', color: '#E8772E' },
  { id: 'p3', code: 'STG-07', name: 'Stahlgruber CRM', color: '#2E8B3D' },
  { id: 'p4', code: 'PMO-02', name: 'PMO & Steering', color: '#B6309A' },
  { id: 'p5', code: 'INT-12', name: 'Intern / Admin', color: '#7B3FB8' },
  { id: 'p6', code: 'AKQ-05', name: 'Akquise / Angebot', color: '#19B3C6' },
];

const SEED_SEGMENTS: Segment[] = [
  { id: 's1', pid: 'p1', start: 8 * 60 + 5, end: 9 * 60 + 20, activity: 'Sprint Planning & Daily' },
  { id: 's2', pid: 'p3', start: 9 * 60 + 25, end: 10 * 60 + 10, activity: 'CRM Datenmodell Review' },
  { id: 's3', pid: 'p2', start: 10 * 60 + 35, end: 12 * 60, activity: 'Workshop-Vorbereitung Modul 2' },
  { id: 's4', pid: 'p1', start: 12 * 60 + 45, end: 14 * 60 + 32, activity: '' },
];

const STORAGE_KEY = 'rpc-zeiterfassung-v1';

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

/** A finished booking still needs the activity-capture sheet only if nothing was
 *  described yet: no description text and no checklist item with content. */
function needsActivity(seg: Segment): boolean {
  return seg.activity.trim() === '' && !(seg.checklist ?? []).some((c) => c.text.trim() !== '');
}

/** Earliest start a booking may have without overlapping the booking to its left:
 *  the latest end among other bookings that lie before `start`. */
function leftBound(segs: Segment[], id: string, start: number): number {
  let lo = 0;
  for (const o of segs) if (o.id !== id && o.end <= start && o.end > lo) lo = o.end;
  return lo;
}
/** Latest end a booking may have without overlapping the booking to its right:
 *  the earliest start among other bookings that lie after `end`. */
function rightBound(segs: Segment[], id: string, end: number): number {
  let hi = 24 * 60;
  for (const o of segs) if (o.id !== id && o.start >= end && o.start < hi) hi = o.start;
  return hi;
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
    p: projects.map((p) => [p.id, p.code, p.name, p.color]),
    s: segments.map((s) => [s.id, s.pid, s.start, s.end, s.activity, s.plannedEnd ?? null, s.checklist ?? [], s.todoId ?? null]),
    t: todos.map((t) => [t.id, t.title, t.category, t.projectId, t.plannedMin, t.urgency, t.importance, t.drawing, t.zug, t.archived, t.checklist ?? []]),
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
    draftCode: '',
    draftName: '',
    draftColor: PALETTE[0],
    tab: 'tasks',
    sheetSegId: null,
    tileLayout: persisted?.tileLayout ?? 'grid',
    fillGap: null,
    reportPeriod: 'heute',
    custFrom: isoDate(new Date(today.getFullYear(), today.getMonth(), 1)),
    custTo: isoDate(today),
  };
}

type Updater = Partial<AppState> | ((prev: AppState) => Partial<AppState>);

export default function App() {
  const [state, setStateRaw] = useState<AppState>(initialState);
  const [vNow, setVNow] = useState<number>(() => nowMinutes());
  const dragMoved = useRef(false);

  // Cloud (Supabase) auth + sync state. In local mode these are pre-satisfied.
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [dataLoaded, setDataLoaded] = useState(!isSupabaseConfigured);
  const lastSyncRef = useRef('');

  // Bookings for the active Reporting range (Woche/Monat/Jahr/Zeitraum). Today's
  // live bookings are merged in at render time, so only past days are fetched here.
  const [reportSegments, setReportSegments] = useState<DaySegment[]>([]);

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
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
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

  // load the bookings for the selected aggregated report range from Supabase
  useEffect(() => {
    if (state.tab !== 'report' || state.reportPeriod === 'heute') return;
    if (!isSupabaseConfigured) {
      setReportSegments([]); // local mode: only today (merged in at render)
      return;
    }
    if (!userEmail || !dataLoaded) return;
    const { from, to } = periodRange(state.reportPeriod, state.custFrom, state.custTo, new Date());
    let active = true;
    (async () => {
      try {
        const segs = await loadSegmentsRange(from, to);
        if (active) setReportSegments(segs);
      } catch (e) {
        console.error('Supabase range load failed', e);
        if (active) setReportSegments([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [state.tab, state.reportPeriod, state.custFrom, state.custTo, userEmail, dataLoaded]);

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

  const proj = (pid: string) => state.projects.find((p) => p.id === pid);

  // ---------- actions ----------
  function tapProject(pid: string) {
    setState((s) => {
      let segments = s.segments.slice();
      let sheetSegId = s.sheetSegId;
      if (s.activeId) {
        const cur = segments.find((g) => g.id === s.activeId);
        if (cur && cur.pid === pid) return s; // already running this project
        if (cur) {
          if (vNow - cur.start >= 1) {
            // keep the finished booking; only prompt for a description if none was entered yet
            segments = segments.map((g) => (g.id === s.activeId ? { ...g, end: vNow } : g));
            if (needsActivity(cur)) sheetSegId = cur.id;
          } else {
            // discard a zero-minute booking from an accidental / too-quick switch
            segments = segments.filter((g) => g.id !== s.activeId);
          }
        }
      }
      const id = 'u' + Date.now();
      segments.push({ id, pid, start: vNow, end: vNow, activity: '', plannedEnd: null, checklist: emptyChecklist(), todoId: null });
      return { segments, activeId: id, paused: false, pausedPid: null, sheetSegId };
    });
  }

  function togglePause() {
    setState((s) => {
      if (s.activeId) {
        const segments = s.segments.map((g) => (g.id === s.activeId ? { ...g, end: vNow } : g));
        const cur = s.segments.find((g) => g.id === s.activeId);
        return { segments, activeId: null, paused: true, pausedPid: cur ? cur.pid : null };
      }
      if (s.paused && s.pausedPid) {
        const id = 'u' + Date.now();
        const segments = s.segments.concat([{ id, pid: s.pausedPid, start: vNow, end: vNow, activity: '', plannedEnd: null, checklist: emptyChecklist(), todoId: null }]);
        return { segments, activeId: id, paused: false, pausedPid: null };
      }
      return s;
    });
  }

  function addProject() {
    setState((s) => {
      const code = s.draftCode.trim();
      const name = s.draftName.trim();
      if (!code || !name) return s;
      const id = 'p' + Date.now();
      return {
        projects: s.projects.concat([{ id, code, name, color: s.draftColor }]),
        draftCode: '',
        draftName: '',
      };
    });
  }

  function updateProject(pid: string, field: 'code' | 'name', v: string) {
    setState((s) => ({ projects: s.projects.map((p) => (p.id === pid ? { ...p, [field]: v } : p)) }));
  }

  function cycleColor(pid: string) {
    setState((s) => {
      const p = s.projects.find((x) => x.id === pid)!;
      const ni = (PALETTE.indexOf(p.color) + 1) % PALETTE.length;
      return { projects: s.projects.map((x) => (x.id === pid ? { ...x, color: PALETTE[ni] } : x)) };
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

  function openSheet(segId: string) {
    const seg = state.segments.find((g) => g.id === segId);
    if (!seg) return;
    setState({ sheetSegId: segId });
  }
  /** Edit the description (activity) of the booking shown in the detail sheet. */
  function setSheetActivity(text: string) {
    setState((s) => ({ segments: s.segments.map((g) => (g.id === s.sheetSegId ? { ...g, activity: text } : g)) }));
  }
  function closeSheet() {
    setState({ sheetSegId: null });
  }
  function deleteSegment(segId: string) {
    setState((st) => ({
      segments: st.segments.filter((g) => g.id !== segId),
      activeId: st.activeId === segId ? null : st.activeId,
      paused: st.activeId === segId ? false : st.paused,
      pausedPid: st.activeId === segId ? null : st.pausedPid,
      sheetSegId: null,
    }));
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
  /** "Erledigt" from the ToDo list: close the task and move it to the archive –
   *  same effect as the booking's "Erledigt" (which archives the linked ToDo). */
  function archiveTodo(id: string) {
    setState((s) => ({ todos: s.todos.map((t) => (t.id === id ? { ...t, archived: true } : t)) }));
  }
  /** Restore an archived task back into the active Daily-Tasks list. */
  function unarchiveTodo(id: string) {
    setState((s) => ({ todos: s.todos.map((t) => (t.id === id ? { ...t, archived: false } : t)) }));
  }
  /** Hand a ToDo over to the Buchungen view: stop the running booking and start a
   *  new one on the ToDo's project, with the ToDo text as the activity (FA). */
  function takeTodoToProject(todo: Todo) {
    if (!todo.projectId) return;
    const pid = todo.projectId;
    setState((s) => {
      let segments = s.segments.slice();
      if (s.activeId) {
        const cur = segments.find((g) => g.id === s.activeId);
        if (cur) {
          if (vNow - cur.start >= 1) segments = segments.map((g) => (g.id === s.activeId ? { ...g, end: vNow } : g));
          else segments = segments.filter((g) => g.id !== s.activeId);
        }
      }
      const id = 'u' + Date.now();
      const plannedEnd = todo.plannedMin > 0 ? Math.min(24 * 60, vNow + todo.plannedMin) : null;
      // carry the ToDo's own activity checklist into the booking detail
      const checklist: ChecklistItem[] = todo.checklist && todo.checklist.length ? todo.checklist.map((c) => ({ ...c })) : emptyChecklist();
      segments.push({ id, pid, start: vNow, end: vNow, activity: todo.title, plannedEnd, checklist, todoId: todo.id });
      return { segments, activeId: id, paused: false, pausedPid: null, sheetSegId: null, fillGap: null, tab: 'track' };
    });
  }

  // ---------- project detail (active booking) ----------
  function patchActiveSeg(patch: Partial<Segment>) {
    setState((s) => ({ segments: s.segments.map((g) => (g.id === s.activeId ? { ...g, ...patch } : g)) }));
  }
  /** Update a booking's checklist and mirror it back to the linked ToDo. */
  function applyChecklist(getId: (s: AppState) => string | null, updater: (cl: ChecklistItem[]) => ChecklistItem[]) {
    setState((s) => {
      const id = getId(s);
      const seg = id ? s.segments.find((g) => g.id === id) : null;
      if (!seg) return s;
      const newCl = updater((seg.checklist ?? []).map((c) => ({ ...c })));
      const segments = s.segments.map((g) => (g.id === id ? { ...g, checklist: newCl } : g));
      const todos = seg.todoId ? s.todos.map((t) => (t.id === seg.todoId ? { ...t, checklist: newCl } : t)) : s.todos;
      return { segments, todos };
    });
  }
  const applyActiveChecklist = (u: (cl: ChecklistItem[]) => ChecklistItem[]) => applyChecklist((s) => s.activeId, u);
  const applySheetChecklist = (u: (cl: ChecklistItem[]) => ChecklistItem[]) => applyChecklist((s) => s.sheetSegId, u);
  function setChecklistText(i: number, text: string) {
    applyActiveChecklist((cl) => {
      if (cl[i]) cl[i] = { ...cl[i], text };
      return cl;
    });
  }
  function toggleChecklistItem(i: number) {
    applyActiveChecklist((cl) => {
      if (cl[i]) cl[i] = { ...cl[i], done: !cl[i].done };
      return cl;
    });
  }
  function addChecklistRow() {
    applyActiveChecklist((cl) => cl.concat([{ text: '', done: false }]));
  }
  function moveChecklistItem(i: number, dir: -1 | 1) {
    applyActiveChecklist((cl) => {
      const j = i + dir;
      if (j < 0 || j >= cl.length) return cl;
      [cl[i], cl[j]] = [cl[j], cl[i]];
      return cl;
    });
  }
  function setPlannedEnd(min: number | null) {
    patchActiveSeg({ plannedEnd: min });
  }
  /** Edit the running booking's start time (clamped to [previous booking's end, now]). */
  function setActiveStart(total: number) {
    setState((s) => ({
      segments: s.segments.map((g) =>
        g.id === s.activeId ? { ...g, start: Math.max(leftBound(s.segments, g.id, g.start), Math.min(total, g.end)) } : g,
      ),
    }));
  }
  /** Edit the running booking's description (activity text). */
  function setActiveActivity(text: string) {
    patchActiveSeg({ activity: text });
  }
  /** "Erledigt": end the active booking, archive its source ToDo, back to ToDo view. */
  function completeBooking() {
    setState((s) => {
      const seg = s.activeId ? s.segments.find((g) => g.id === s.activeId) : null;
      if (!seg) return { tab: 'tasks' };
      const segments = s.segments.map((g) => (g.id === s.activeId ? { ...g, end: vNow } : g));
      const todos = seg.todoId ? s.todos.map((t) => (t.id === seg.todoId ? { ...t, archived: true } : t)) : s.todos;
      return { segments, todos, activeId: null, paused: false, pausedPid: null, sheetSegId: null, fillGap: null, tab: 'tasks' };
    });
  }
  /** "Schließen": end the active booking and return to ToDo view, but keep the ToDo.
   *  Prompt for the activity only if nothing was described yet (empty desc + no subtasks). */
  function closeBooking() {
    setState((s) => {
      if (!s.activeId) return { tab: 'tasks' };
      const seg = s.segments.find((g) => g.id === s.activeId);
      const segments = s.segments.map((g) => (g.id === s.activeId ? { ...g, end: vNow } : g));
      if (seg && vNow - seg.start >= 1 && needsActivity(seg)) {
        return { segments, activeId: null, paused: false, pausedPid: null, sheetSegId: seg.id, fillGap: null, tab: 'tasks' };
      }
      return { segments, activeId: null, paused: false, pausedPid: null, sheetSegId: null, fillGap: null, tab: 'tasks' };
    });
  }

  function setTime(edge: 'start' | 'end', total: number) {
    setState((s) => ({
      segments: s.segments.map((g) => {
        if (g.id !== s.sheetSegId) return g;
        if (edge === 'start') return { ...g, start: Math.max(leftBound(s.segments, g.id, g.start), Math.min(total, g.end - 5)) };
        return { ...g, end: Math.min(rightBound(s.segments, g.id, g.end), Math.max(total, g.start + 5)) };
      }),
    }));
  }

  function startDrag(segId: string, edge: 'start' | 'end', e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const seg0 = state.segments.find((g) => g.id === segId);
    if (!seg0) return;
    const orig = edge === 'start' ? seg0.start : seg0.end;
    // freeze the neighbour limits at drag start so a booking can't cross into the adjacent one
    const lower = edge === 'start' ? leftBound(state.segments, segId, seg0.start) : 0;
    const upper = edge === 'end' ? rightBound(state.segments, segId, seg0.end) : 24 * 60;
    dragMoved.current = false;
    const move = (ev: PointerEvent) => {
      dragMoved.current = true;
      const delta = Math.round((ev.clientY - startY) / PPM / 5) * 5;
      setStateRaw((st) => ({
        ...st,
        segments: st.segments.map((g) => {
          if (g.id !== segId) return g;
          if (edge === 'start') return { ...g, start: Math.max(lower, Math.min(orig + delta, g.end - 5)) };
          return { ...g, end: Math.min(upper, Math.max(orig + delta, g.start + 5)) };
        }),
      }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function openGapFill(start: number, end: number) {
    setState({ fillGap: { start, end } });
  }
  function fillGapWith(pid: string) {
    setState((s) => {
      if (!s.fillGap) return s;
      const id = 'g' + Date.now();
      return {
        segments: s.segments.concat([{ id, pid, start: s.fillGap.start, end: s.fillGap.end, activity: '' }]),
        fillGap: null,
      };
    });
  }

  // ---------- derived ----------
  const s = state;
  const isTrack = s.tab === 'track';
  const isReport = s.tab === 'report';
  const isTasks = s.tab === 'tasks';
  const isAdmin = s.tab === 'admin';
  const isArchiv = s.tab === 'archiv';
  const today = new Date();
  const dateText = today.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long' });
  const clockText = fmtClock(vNow);

  const activeSeg = s.activeId ? s.segments.find((g) => g.id === s.activeId) : null;
  const running = !!activeSeg;
  const bannerPid = running ? activeSeg!.pid : s.pausedPid;
  const bannerProj = bannerPid ? proj(bannerPid) : null;

  const totals: Record<string, number> = {};
  s.projects.forEach((p) => {
    totals[p.id] = s.segments.filter((g) => g.pid === p.id).reduce((a, g) => a + (g.end - g.start), 0);
  });
  const topId = s.projects.slice().sort((a, b) => totals[b.id] - totals[a.id])[0]?.id;

  const sheetSeg = s.sheetSegId ? s.segments.find((g) => g.id === s.sheetSegId) : null;
  const sheetProj = sheetSeg ? proj(sheetSeg.pid) : null;

  // ---------- render ----------
  if (isSupabaseConfigured && !authReady) return <LoadingScreen text="Lädt …" />;
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
          {isTrack && (
            <TrackView
              state={s}
              running={running}
              activeSeg={activeSeg ?? null}
              bannerProj={bannerProj ?? null}
              totals={totals}
              topId={topId}
              onTapProject={tapProject}
              onTogglePause={togglePause}
              onSetLayout={(l) => setState({ tileLayout: l })}
              onChecklistText={setChecklistText}
              onChecklistToggle={toggleChecklistItem}
              onChecklistAdd={addChecklistRow}
              onChecklistMove={moveChecklistItem}
              onSetStart={setActiveStart}
              onSetActivity={setActiveActivity}
              onSetPlannedEnd={setPlannedEnd}
              onComplete={() =>
                setConfirm({
                  message: 'Buchung als erledigt abschließen und (falls verknüpft) die Aufgabe ins Archiv verschieben?',
                  confirmLabel: 'Erledigt',
                  onConfirm: completeBooking,
                })
              }
              onCloseBooking={closeBooking}
            />
          )}

          {isReport && (
            <ReportView
              state={s}
              vNow={vNow}
              today={today}
              clockText={clockText}
              reportSegments={reportSegments}
              onSetPeriod={(p) => setState({ reportPeriod: p })}
              onSetCust={(field, v) => setState({ [field]: v } as Partial<AppState>)}
              onOpenSheet={openSheet}
              onOpenGapFill={openGapFill}
              onStartDrag={startDrag}
              dragMoved={dragMoved}
            />
          )}

          {isTasks && (
            <DailyTasksView
              state={s}
              onAdd={() => setTodoSheet('new')}
              onEdit={(t) => setTodoSheet(t)}
              onTake={takeTodoToProject}
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
              totals={totals}
              onCycleColor={cycleColor}
              onUpdateProject={updateProject}
              onDeleteProject={deleteProject}
              onSetDraft={(field, v) => setState({ [field]: v } as Partial<AppState>)}
              onAddProject={addProject}
              accountEmail={isSupabaseConfigured ? userEmail : null}
              onLogout={logout}
            />
          )}

          {isArchiv && (
            <ArchiveView
              state={s}
              onEdit={(t) => setTodoSheet(t)}
              onRestore={unarchiveTodo}
            />
          )}
        </main>

        {/* Bottom nav */}
        <BottomNav tab={s.tab} onSelect={(t) => setState({ tab: t })} />

        {/* Activity sheet */}
        {sheetSeg && sheetProj && (
          <ActivitySheet
            seg={sheetSeg}
            project={sheetProj}
            onSetStart={(m) => setTime('start', m)}
            onSetEnd={(m) => setTime('end', m)}
            onSetActivity={setSheetActivity}
            onChecklistText={(i, t) => applySheetChecklist((cl) => { if (cl[i]) cl[i] = { ...cl[i], text: t }; return cl; })}
            onChecklistToggle={(i) => applySheetChecklist((cl) => { if (cl[i]) cl[i] = { ...cl[i], done: !cl[i].done }; return cl; })}
            onChecklistAdd={() => applySheetChecklist((cl) => cl.concat([{ text: '', done: false }]))}
            onChecklistMove={(i, dir) => applySheetChecklist((cl) => moveItem(cl, i, dir))}
            onClose={closeSheet}
            onDelete={() => deleteSegment(sheetSeg.id)}
            key={sheetSeg.id}
          />
        )}

        {/* Gap-fill picker */}
        {s.fillGap && (
          <GapFillSheet
            gap={s.fillGap}
            projects={s.projects}
            onPick={fillGapWith}
            onCancel={() => setState({ fillGap: null })}
          />
        )}

        {/* Daily-Task editor */}
        {todoSheet && (
          <TodoSheet
            key={todoSheet === 'new' ? 'new' : todoSheet.id}
            initial={todoSheet === 'new' ? null : todoSheet}
            projects={s.projects}
            onSave={saveTodo}
            onDelete={todoSheet === 'new' ? undefined : () => deleteTodo(todoSheet.id)}
            onTake={
              todoSheet === 'new'
                ? undefined
                : (t) => {
                    takeTodoToProject(t);
                    setTodoSheet(null);
                  }
            }
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

/* ===== shared detail form (Start/Zeit, Beschreibung, Aufgaben) ===== */
/** The editable body of a booking detail: start + a second time field, the
 *  description and the subtask checklist. Rendered both inline for the running
 *  booking (TrackView) and inside the end-of-booking sheet (ActivitySheet),
 *  so both masks look and behave identically. */
function BookingDetailFields(props: {
  seg: Segment;
  textColor: string;
  mutedColor: string;
  secondTimeLabel: string;
  secondTimeValue: number | null;
  secondTimeNullable: boolean;
  onSetStart: (min: number) => void;
  onSetSecondTime: (min: number | null) => void;
  onSetActivity: (text: string) => void;
  onChecklistText: (i: number, text: string) => void;
  onChecklistToggle: (i: number) => void;
  onChecklistAdd: () => void;
  onChecklistMove: (i: number, dir: -1 | 1) => void;
}) {
  const {
    seg, textColor, mutedColor, secondTimeLabel, secondTimeValue, secondTimeNullable,
    onSetStart, onSetSecondTime, onSetActivity,
    onChecklistText, onChecklistToggle, onChecklistAdd, onChecklistMove,
  } = props;
  const timeInput: CSSProperties = { border: 'none', padding: '5px 8px', fontSize: 13, color: C.dk1, background: C.lt1, fontVariantNumeric: 'tabular-nums' };
  const sectionLabel: CSSProperties = { fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', color: mutedColor, fontWeight: 700, margin: '14px 0 8px' };
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: mutedColor }}>Start</span>
          <input
            type="time"
            value={fmtClock(seg.start)}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              const [h, m] = v.split(':').map(Number);
              onSetStart(h * 60 + m);
            }}
            style={timeInput}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: mutedColor }}>{secondTimeLabel}</span>
          <input
            type="time"
            value={secondTimeValue != null ? fmtClock(secondTimeValue) : ''}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return secondTimeNullable ? onSetSecondTime(null) : undefined;
              const [h, m] = v.split(':').map(Number);
              onSetSecondTime(h * 60 + m);
            }}
            style={timeInput}
          />
        </div>
      </div>

      <div style={sectionLabel}>Beschreibung</div>
      <textarea
        value={seg.activity}
        onChange={(e) => onSetActivity(e.target.value)}
        placeholder="Was wird gemacht? …"
        rows={2}
        style={{ width: '100%', resize: 'vertical', border: 'none', padding: '8px 10px', fontSize: 14, lineHeight: 1.4, color: C.dk1, background: C.lt1, outline: 'none', fontFamily: 'inherit' }}
      />

      <div style={sectionLabel}>Aufgaben</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {(seg.checklist ?? []).map((it, i, arr) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={it.done}
              onChange={() => onChecklistToggle(i)}
              style={{ width: 18, height: 18, flex: '0 0 auto' }}
            />
            <input
              type="text"
              value={it.text}
              onChange={(e) => onChecklistText(i, e.target.value)}
              placeholder="Subaktivität …"
              style={{ flex: '1 1 auto', minWidth: 0, border: 'none', padding: '7px 9px', fontSize: 14, color: C.dk1, background: C.lt1, textDecoration: it.done ? 'line-through' : 'none' }}
            />
            <button type="button" onClick={() => onChecklistMove(i, -1)} disabled={i === 0} style={moveBtnStyle(textColor, 'rgba(255,255,255,.18)', i === 0)}>
              ▲
            </button>
            <button type="button" onClick={() => onChecklistMove(i, 1)} disabled={i === arr.length - 1} style={moveBtnStyle(textColor, 'rgba(255,255,255,.18)', i === arr.length - 1)}>
              ▼
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={onChecklistAdd}
        style={{ marginTop: 8, padding: '6px 12px', background: 'rgba(255,255,255,.18)', color: textColor, fontSize: 13, fontWeight: 700 }}
      >
        + Aufgabe
      </button>
    </>
  );
}

/* ======================= BUCHUNGEN ======================= */function TrackView(props: {
  state: AppState;
  running: boolean;
  activeSeg: Segment | null;
  bannerProj: Project | null;
  totals: Record<string, number>;
  topId: string | undefined;
  onTapProject: (pid: string) => void;
  onTogglePause: () => void;
  onSetLayout: (l: TileLayout) => void;
  onChecklistText: (i: number, text: string) => void;
  onChecklistToggle: (i: number) => void;
  onChecklistAdd: () => void;
  onChecklistMove: (i: number, dir: -1 | 1) => void;
  onSetStart: (min: number) => void;
  onSetActivity: (text: string) => void;
  onSetPlannedEnd: (min: number | null) => void;
  onComplete: () => void;
  onCloseBooking: () => void;
}) {
  const { state: s, running, activeSeg, bannerProj, totals, topId, onTapProject, onTogglePause, onSetLayout, onChecklistText, onChecklistToggle, onChecklistAdd, onChecklistMove, onSetStart, onSetActivity, onSetPlannedEnd, onComplete, onCloseBooking } = props;

  // ---- banner ----
  let bannerBg: string;
  let bannerBorder = 'none';
  let bannerLabel: string;
  let bannerLabelColor: string;
  let bannerProject: string;
  let bannerElapsed: string;
  let bannerDot: CSSProperties;
  let pauseLabel = '';
  let pauseStyle: CSSProperties = { display: 'none' };
  let bannerTextColor: string = C.lt1;
  let bannerMutedColor = 'rgba(255,255,255,.6)';

  if (running && activeSeg && bannerProj) {
    bannerBg = bannerProj.color;
    bannerLabel = 'Läuft';
    bannerLabelColor = 'rgba(255,255,255,.85)';
    bannerProject = bannerProj.code + '  ·  ' + bannerProj.name;
    bannerElapsed = fmtDur(activeSeg.end - activeSeg.start);
    bannerDot = { width: 8, height: 8, borderRadius: '50%', background: C.lt1, animation: 'tkPulse 1.4s ease-in-out infinite' };
    pauseLabel = 'Pause';
    pauseStyle = {
      marginTop: 14,
      width: '100%',
      padding: 11,
      background: 'rgba(255,255,255,.16)',
      color: C.lt1,
      fontSize: 13,
      fontWeight: 700,
      letterSpacing: '.06em',
      textTransform: 'uppercase',
    };
  } else if (s.paused && bannerProj) {
    bannerBg = C.dk1;
    bannerLabel = 'Pausiert';
    bannerLabelColor = 'rgba(255,255,255,.7)';
    bannerProject = bannerProj.code + '  ·  ' + bannerProj.name;
    const segp = s.segments.filter((g) => g.pid === bannerProj.id).reduce((a, g) => a + (g.end - g.start), 0);
    bannerElapsed = fmtDur(segp);
    bannerDot = { width: 8, height: 8, borderRadius: '50%', background: C.accent3_60 };
    pauseLabel = 'Fortsetzen';
    pauseStyle = {
      marginTop: 14,
      width: '100%',
      padding: 11,
      background: C.accent3,
      color: C.lt1,
      fontSize: 13,
      fontWeight: 700,
      letterSpacing: '.06em',
      textTransform: 'uppercase',
    };
  } else {
    bannerBg = C.lt2;
    bannerBorder = '1px dashed #B9C4CB';
    bannerLabel = 'Keine Erfassung';
    bannerLabelColor = C.greyFooter;
    bannerProject = 'Kein Projekt aktiv';
    bannerElapsed = '0:00';
    bannerTextColor = C.dk1;
    bannerMutedColor = '#B9C4CB';
    bannerDot = { width: 8, height: 8, borderRadius: '50%', background: '#B9C4CB' };
  }

  const layout = s.tileLayout;
  const layoutDefs: [TileLayout, string, string][] = [
    ['grid', '▦', 'Raster'],
    ['sized', '▤', 'Gewichtet'],
    ['list', '☰', 'Liste'],
  ];

  const trackHint = running
    ? 'Tippe ein anderes Projekt, um zu wechseln – die laufende Buchung wird gestoppt und du erfasst die Tätigkeit.'
    : s.paused
      ? 'Erfassung pausiert. Tippe „Fortsetzen“ oder wähle direkt ein Projekt.'
      : 'Tippe eine Projekt-Kachel, um die Zeiterfassung zu starten.';

  const tileWrap: CSSProperties =
    layout === 'list'
      ? { display: 'flex', flexDirection: 'column', gap: 0, padding: '0 20px' }
      : { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, padding: '0 20px' };

  return (
    <section>
      {/* status banner */}
      <div style={{ margin: '16px 20px 0', padding: '16px 18px', background: bannerBg, border: bannerBorder }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={bannerDot} />
              <span
                style={{
                  fontSize: 11,
                  letterSpacing: '.14em',
                  textTransform: 'uppercase',
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                  color: bannerLabelColor,
                }}
              >
                {bannerLabel}
              </span>
            </div>
            <div
              style={{
                fontSize: 19,
                fontWeight: 700,
                color: bannerTextColor,
                marginTop: 4,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {bannerProject}
            </div>
          </div>
          <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
            <div style={{ fontSize: 34, fontWeight: 300, color: bannerTextColor, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
              {bannerElapsed}
            </div>
            <div style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: bannerMutedColor }}>
              Std : Min
            </div>
          </div>
        </div>
        {pauseStyle.display !== 'none' && (
          <button type="button" onClick={onTogglePause} style={pauseStyle}>
            {pauseLabel}
          </button>
        )}

        {running && activeSeg && (
          <div style={{ marginTop: 14, borderTop: '1px solid rgba(255,255,255,.25)', paddingTop: 12 }}>
            <BookingDetailFields
              seg={activeSeg}
              textColor={bannerTextColor}
              mutedColor={bannerMutedColor}
              secondTimeLabel="Geplantes Ende"
              secondTimeValue={activeSeg.plannedEnd ?? null}
              secondTimeNullable={true}
              onSetStart={onSetStart}
              onSetSecondTime={onSetPlannedEnd}
              onSetActivity={onSetActivity}
              onChecklistText={onChecklistText}
              onChecklistToggle={onChecklistToggle}
              onChecklistAdd={onChecklistAdd}
              onChecklistMove={onChecklistMove}
            />

            {needsActivity(activeSeg) && (
              <div style={{ fontSize: 12, color: bannerMutedColor, marginTop: 14 }}>
                Bitte zuerst eine Beschreibung oder eine Aufgabe erfassen, um die Buchung abzuschließen.
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: needsActivity(activeSeg) ? 8 : 14 }}>
              <button
                type="button"
                onClick={onCloseBooking}
                disabled={needsActivity(activeSeg)}
                style={{ flex: 1, padding: 12, background: 'rgba(255,255,255,.18)', color: bannerTextColor, fontSize: 14, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', opacity: needsActivity(activeSeg) ? 0.4 : 1, cursor: needsActivity(activeSeg) ? 'not-allowed' : 'pointer' }}
              >
                Schließen
              </button>
              <button
                type="button"
                onClick={onComplete}
                disabled={needsActivity(activeSeg)}
                style={{ flex: 1, padding: 12, background: C.lt1, color: C.accent1, fontSize: 14, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', opacity: needsActivity(activeSeg) ? 0.4 : 1, cursor: needsActivity(activeSeg) ? 'not-allowed' : 'pointer' }}
              >
                Erledigt
              </button>
            </div>
          </div>
        )}
      </div>

      {/* layout switcher */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 10px' }}>
        <span style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: C.greyFooter, fontWeight: 700 }}>
          Projekte
        </span>
        <div style={{ display: 'flex', border: '1px solid #D5DBDF', background: C.lt2 }}>
          {layoutDefs.map(([k, icon, title]) => (
            <button
              key={k}
              type="button"
              title={title}
              onClick={() => onSetLayout(k)}
              style={{
                padding: '7px 12px',
                fontSize: 14,
                color: layout === k ? C.lt1 : C.greyFooter,
                background: layout === k ? C.accent1 : 'transparent',
              }}
            >
              {icon}
            </button>
          ))}
        </div>
      </div>

      {/* tiles */}
      <div style={tileWrap}>
        {s.projects.map((p) => {
          const isActive = running && activeSeg!.pid === p.id;
          const isPaused = s.paused && s.pausedPid === p.id;
          const tc = textOn(p.color);
          const tot = totals[p.id];
          const metaText = tot > 0 ? fmtDur(tot) + ' h' : '–';
          const ring: CSSProperties = isActive
            ? { boxShadow: 'inset 0 0 0 3px #FEFFFF, inset 0 0 0 5px ' + p.color }
            : isPaused
              ? { boxShadow: 'inset 0 0 0 2px #7BBEE0' }
              : {};

          if (layout === 'list') {
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onTapProject(p.id)}
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  padding: '15px 16px',
                  background: p.color,
                  color: tc,
                  borderBottom: '1px solid rgba(255,255,255,.14)',
                  ...ring,
                }}
              >
                {isActive && (
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: tc, animation: 'tkPulse 1.4s infinite' }} />
                )}
                <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, textAlign: 'left' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', opacity: 0.7, color: tc }}>
                    {p.code}
                  </span>
                  <span style={{ fontSize: 16, fontWeight: 700, color: tc, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {p.name}
                  </span>
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 300, fontVariantNumeric: 'tabular-nums', color: tc, opacity: 0.9 }}>
                  {metaText}
                </span>
              </button>
            );
          }

          const big = layout === 'sized' && p.id === topId;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onTapProject(p.id)}
              style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                padding: '14px 15px',
                background: p.color,
                color: tc,
                outline: '1px solid rgba(255,255,255,.16)',
                outlineOffset: '-0.5px',
                gridColumn: big ? 'span 2' : undefined,
                minHeight: big ? 108 : 128,
                ...ring,
              }}
            >
              {isActive && (
                <span
                  style={{ position: 'absolute', top: 14, right: 14, width: 9, height: 9, borderRadius: '50%', background: tc, animation: 'tkPulse 1.4s infinite' }}
                />
              )}
              <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, textAlign: 'left' }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', opacity: 0.72, color: tc }}>
                  {p.code}
                </span>
                <span style={{ fontSize: big ? 19 : 16, fontWeight: 700, color: tc, lineHeight: 1.12 }}>{p.name}</span>
              </span>
              <span style={{ fontSize: 13, fontWeight: 300, fontVariantNumeric: 'tabular-nums', color: tc, opacity: 0.9 }}>
                {metaText}
              </span>
            </button>
          );
        })}
      </div>

      <div style={{ padding: '6px 20px 30px' }}>
        <p style={{ fontSize: 12, lineHeight: 1.5, color: C.greyFooter, margin: 0 }}>{trackHint}</p>
      </div>
    </section>
  );
}

/* ======================= REPORTING ======================= */
function ReportView(props: {
  state: AppState;
  vNow: number;
  today: Date;
  clockText: string;
  reportSegments: DaySegment[];
  onSetPeriod: (p: ReportPeriod) => void;
  onSetCust: (field: 'custFrom' | 'custTo', v: string) => void;
  onOpenSheet: (segId: string) => void;
  onOpenGapFill: (start: number, end: number) => void;
  onStartDrag: (segId: string, edge: 'start' | 'end', e: React.PointerEvent) => void;
  dragMoved: React.MutableRefObject<boolean>;
}) {
  const { state: s, vNow, today, clockText, reportSegments, onSetPeriod, onSetCust, onOpenSheet, onOpenGapFill, onStartDrag, dragMoved } = props;
  const period = s.reportPeriod;
  const showTimeline = period === 'heute';
  const showCust = period === 'zeitraum';

  // Merge today's live bookings (state.segments) over the fetched range so
  // unsaved edits show up immediately; out-of-range days are dropped by aggregate.
  const todayKey = localISODate();
  const daySegments: DaySegment[] = [
    ...reportSegments.filter((seg) => seg.day !== todayKey),
    ...s.segments.map((seg) => ({ ...seg, day: todayKey })),
  ];

  const periodDefs: [ReportPeriod, string][] = [
    ['heute', 'Heute'],
    ['woche', 'Woche'],
    ['monat', 'Monat'],
    ['jahr', 'Jahr'],
    ['zeitraum', 'Zeitraum'],
  ];

  const rep = showTimeline
    ? buildReport({ projects: s.projects, segments: s.segments, activeId: s.activeId, vNow, date: today })
    : null;
  const agg = !showTimeline
    ? aggregate({ projects: s.projects, period, custFrom: s.custFrom, custTo: s.custTo, today, daySegments })
    : null;

  const hatch = 'repeating-linear-gradient(135deg,#F3F4F4,#F3F4F4 7px,#E8ECEE 7px,#E8ECEE 14px)';

  return (
    <section style={{ padding: '18px 20px 36px' }}>
      <div style={{ display: 'flex', border: '1px solid #D5DBDF', background: C.lt2, marginBottom: 20, overflow: 'hidden' }}>
        {periodDefs.map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => onSetPeriod(k)}
            style={{
              flex: '1 1 auto',
              padding: '9px 4px',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '.02em',
              textAlign: 'center',
              whiteSpace: 'nowrap',
              color: period === k ? C.lt1 : '#5E7184',
              background: period === k ? C.accent1 : 'transparent',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ---- Tagesansicht (timeline) ---- */}
      {rep && (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
            <div>
              <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: C.greyFooter, fontWeight: 700, whiteSpace: 'nowrap' }}>
                Chronologisch · Heute
              </div>
              <div style={{ fontSize: 13, color: C.greyFooter, marginTop: 3 }}>{rep.reportDate}</div>
            </div>
            <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
              <div style={{ fontSize: 28, fontWeight: 300, color: C.accent1, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                {rep.reportTotal}
              </div>
              <div style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: C.greyFooter }}>Std erfasst</div>
            </div>
          </div>

          <div style={{ display: 'flex', height: 10, margin: '16px 0 12px', background: C.lt2, overflow: 'hidden' }}>
            {rep.shareSegments.map((sh) => (
              <div key={sh.pid} style={{ width: sh.widthPct + '%', background: sh.color }} />
            ))}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', marginBottom: 20 }}>
            {rep.legend.map((lg) => (
              <div key={lg.pid} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ width: 10, height: 10, background: lg.color, flex: '0 0 auto' }} />
                <span style={{ fontSize: 12, color: C.dk1, fontWeight: 500 }}>{lg.name}</span>
                <span style={{ fontSize: 12, color: C.greyFooter, fontVariantNumeric: 'tabular-nums' }}>{lg.dur}</span>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 11, lineHeight: 1.5, color: C.muted, marginBottom: 12 }}>
            Ziehe die Ränder einer Buchung, um Start &amp; Ende anzupassen · tippe eine Lücke, um sie zu füllen · tippe eine Buchung, um die
            Tätigkeit zu bearbeiten
          </div>

          <div style={{ position: 'relative', height: rep.timelineHeight }}>
            {rep.hourMarks.map((hm) => (
              <div key={hm.hour}>
                <div style={{ position: 'absolute', left: 48, right: 0, top: hm.top, borderTop: '1px solid #EDF0F1' }} />
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: hm.top - 7,
                    width: 42,
                    textAlign: 'right',
                    fontSize: 11,
                    color: C.muted,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {hm.label}
                </div>
              </div>
            ))}
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: 48, right: 2 }}>
              {rep.gaps.map((g) => (
                <button
                  key={g.start + '-' + g.end}
                  type="button"
                  onClick={() => onOpenGapFill(g.start, g.end)}
                  style={{
                    position: 'absolute',
                    top: g.top,
                    height: g.height - 2,
                    left: 0,
                    right: 0,
                    background: hatch,
                    border: '1px dashed #B9C4CB',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: C.accent2,
                  }}
                >
                  <span style={{ fontSize: 11, color: C.accent2, fontWeight: 700 }}>+ Lücke füllen · {g.label}</span>
                </button>
              ))}
              {rep.blocks.map((b) => {
                const grip: CSSProperties = { width: 32, height: 4, borderRadius: 2, background: b.textColor, opacity: 0.8, pointerEvents: 'none' };
                const handleBase: CSSProperties = {
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  height: 16,
                  display: b.showHandles ? 'flex' : 'none',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'ns-resize',
                  touchAction: 'none',
                  zIndex: 2,
                };
                return (
                  <div
                    key={b.id}
                    onClick={() => {
                      if (dragMoved.current) {
                        dragMoved.current = false;
                        return;
                      }
                      onOpenSheet(b.id);
                    }}
                    style={{
                      position: 'absolute',
                      top: b.top,
                      height: b.height - 2,
                      left: 'calc(' + b.leftPct + '% + 2px)',
                      width: 'calc(' + b.widthPct + '% - 4px)',
                      background: b.color,
                      color: b.textColor,
                      padding: b.tightPad ? '3px 9px' : '8px 9px',
                      overflow: 'hidden',
                      cursor: 'pointer',
                      outline: b.isRun ? '2px solid #FEFFFF' : undefined,
                      outlineOffset: b.isRun ? -3 : undefined,
                    }}
                  >
                    <span onPointerDown={(e) => onStartDrag(b.id, 'start', e)} style={{ ...handleBase, top: -2 }}>
                      <span style={grip} />
                    </span>
                    {b.showCode && (
                      <span
                        style={{
                          display: 'block',
                          fontSize: 11,
                          fontWeight: 700,
                          letterSpacing: '.06em',
                          color: b.textColor,
                          opacity: 0.85,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {b.code}
                      </span>
                    )}
                    {b.showRange && (
                      <span
                        style={{
                          display: 'block',
                          fontSize: 12,
                          fontWeight: 500,
                          color: b.textColor,
                          fontVariantNumeric: 'tabular-nums',
                          marginTop: 2,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {b.rangeText}
                      </span>
                    )}
                    {b.showAct && (
                      <span
                        style={{
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          fontSize: 11,
                          lineHeight: 1.32,
                          fontWeight: 400,
                          color: b.textColor,
                          opacity: 0.82,
                          marginTop: 4,
                        }}
                      >
                        {b.activity}
                      </span>
                    )}
                    <span onPointerDown={(e) => onStartDrag(b.id, 'end', e)} style={{ ...handleBase, bottom: -2 }}>
                      <span style={grip} />
                    </span>
                  </div>
                );
              })}
            </div>
            <div style={{ position: 'absolute', left: 48, right: 0, top: rep.nowTop, borderTop: '2px dashed #0E1721', pointerEvents: 'none' }} />
            <div
              style={{
                position: 'absolute',
                right: 0,
                top: rep.nowTop + 4,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '.06em',
                textTransform: 'uppercase',
                color: C.dk1,
                pointerEvents: 'none',
              }}
            >
              jetzt {clockText}
            </div>
          </div>
        </>
      )}

      {/* ---- aggregierte Auswertung ---- */}
      {agg && (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14 }}>
            <div>
              <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: C.greyFooter, fontWeight: 700, whiteSpace: 'nowrap' }}>
                Auswertung
              </div>
              <div style={{ fontSize: 13, color: C.greyFooter, marginTop: 3 }}>{agg.rangeLabel}</div>
            </div>
            <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
              <div style={{ fontSize: 28, fontWeight: 300, color: C.accent1, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                {agg.totalText}
              </div>
              <div style={{ fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: C.greyFooter }}>Std gesamt</div>
            </div>
          </div>

          {showCust && (
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: C.greyFooter, fontWeight: 700, marginBottom: 5 }}>
                  Von
                </label>
                <input
                  type="date"
                  value={s.custFrom}
                  onChange={(e) => onSetCust('custFrom', e.target.value)}
                  style={{ width: '100%', border: '1px solid #D5DBDF', padding: '9px 11px', fontSize: 13, color: C.dk1, outline: 'none', background: C.lt2 }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: C.greyFooter, fontWeight: 700, marginBottom: 5 }}>
                  Bis
                </label>
                <input
                  type="date"
                  value={s.custTo}
                  onChange={(e) => onSetCust('custTo', e.target.value)}
                  style={{ width: '100%', border: '1px solid #D5DBDF', padding: '9px 11px', fontSize: 13, color: C.dk1, outline: 'none', background: C.lt2 }}
                />
              </div>
            </div>
          )}

          <div style={{ display: 'flex', height: 10, margin: '16px 0 22px', background: C.lt2, overflow: 'hidden' }}>
            {agg.shareSegments.map((sh) => (
              <div key={sh.pid} style={{ width: sh.widthPct + '%', background: sh.color }} />
            ))}
          </div>

          <div style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: C.greyFooter, fontWeight: 700, marginBottom: 12 }}>
            Verlauf
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 140, paddingBottom: 2, marginBottom: 24, borderBottom: '1px solid #EDF0F1' }}>
            {agg.columnBuckets.map((cb, i) => (
              <div key={i} style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <div style={{ width: '62%', minWidth: 7, maxWidth: 30, height: cb.colHeight, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                  {cb.segments.map((sg, j) => (
                    <div key={j} style={{ width: '100%', height: sg.heightPx, background: sg.color }} />
                  ))}
                </div>
                <div style={{ fontSize: 9, color: C.muted, whiteSpace: 'nowrap' }}>{cb.label}</div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: C.greyFooter, fontWeight: 700, marginBottom: 14 }}>
            Nach Projekt
          </div>
          {agg.rankedBars.length === 0 && (
            <div style={{ fontSize: 13, color: C.muted, padding: '6px 0 4px' }}>
              Keine Buchungen in diesem Zeitraum.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {agg.rankedBars.map((rb) => (
              <div key={rb.pid}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ width: 10, height: 10, flex: '0 0 auto', background: rb.color }} />
                  <span style={{ fontSize: 14, fontWeight: 700, color: C.dk1 }}>{rb.name}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 700, color: C.dk1, fontVariantNumeric: 'tabular-nums' }}>
                    {rb.durText}
                  </span>
                  <span style={{ fontSize: 12, color: C.muted, width: 38, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{rb.pctText}</span>
                </div>
                <div style={{ flex: '1 1 auto', height: 8, background: '#F0F2F3', position: 'relative' }}>
                  <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: rb.fillPct + '%', background: rb.color }} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/* ======================= PFLEGE ======================= */
function AdminView(props: {
  state: AppState;
  totals: Record<string, number>;
  onCycleColor: (pid: string) => void;
  onUpdateProject: (pid: string, field: 'code' | 'name', v: string) => void;
  onDeleteProject: (pid: string) => void;
  onSetDraft: (field: 'draftCode' | 'draftName' | 'draftColor', v: string) => void;
  onAddProject: () => void;
  accountEmail: string | null;
  onLogout: () => void;
}) {
  const { state: s, totals, onCycleColor, onUpdateProject, onDeleteProject, onSetDraft, onAddProject, accountEmail, onLogout } = props;
  const canAdd = !!(s.draftCode.trim() && s.draftName.trim());

  return (
    <section style={{ padding: '18px 20px 36px' }}>
      <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: C.greyFooter, fontWeight: 700, marginBottom: 4 }}>
        Projekte verwalten
      </div>
      <p style={{ fontSize: 12, lineHeight: 1.5, color: C.greyFooter, margin: '0 0 18px' }}>
        Code &amp; Name bearbeiten, Farbe per Tipp auf die Kachel wechseln. Jedes Projekt erscheint als Kachel in der Buchung.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {s.projects.map((p) => {
          const used = totals[p.id] > 0;
          return (
            <div key={p.id} style={{ display: 'flex', alignItems: 'stretch', border: '1px solid #E1E5E8', background: C.lt1 }}>
              <button type="button" title="Farbe wechseln" onClick={() => onCycleColor(p.id)} style={{ flex: '0 0 auto', width: 40, height: 40, background: p.color }} />
              <div style={{ flex: '1 1 auto', minWidth: 0, padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                <input
                  value={p.code}
                  onChange={(e) => onUpdateProject(p.id, 'code', e.target.value)}
                  style={{ border: 'none', outline: 'none', padding: 0, fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: C.greyFooter, background: 'transparent' }}
                />
                <input
                  value={p.name}
                  onChange={(e) => onUpdateProject(p.id, 'name', e.target.value)}
                  style={{ border: 'none', outline: 'none', padding: 0, fontSize: 16, fontWeight: 700, color: C.dk1, background: 'transparent' }}
                />
                <span style={{ fontSize: 11, color: C.muted }}>{used ? fmtDur(totals[p.id]) + ' h heute' : 'noch keine Zeit'}</span>
              </div>
              <button type="button" title="Löschen" onClick={() => onDeleteProject(p.id)} style={{ flex: '0 0 auto', width: 46, color: C.muted, fontSize: 18 }}>
                ×
              </button>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 24, borderTop: '2px solid #074771', paddingTop: 18 }}>
        <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: C.accent1, fontWeight: 700, marginBottom: 14 }}>
          Neues Projekt anlegen
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: '0 0 116px' }}>
            <label style={{ display: 'block', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: C.greyFooter, fontWeight: 700, marginBottom: 5 }}>
              Code
            </label>
            <input
              value={s.draftCode}
              onChange={(e) => onSetDraft('draftCode', e.target.value)}
              placeholder="z. B. NEU-01"
              style={{ width: '100%', border: '1px solid #D5DBDF', padding: '11px 12px', fontSize: 14, color: C.dk1, outline: 'none', background: C.lt2 }}
            />
          </div>
          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
            <label style={{ display: 'block', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: C.greyFooter, fontWeight: 700, marginBottom: 5 }}>
              Name
            </label>
            <input
              value={s.draftName}
              onChange={(e) => onSetDraft('draftName', e.target.value)}
              placeholder="Projektbezeichnung"
              style={{ width: '100%', border: '1px solid #D5DBDF', padding: '11px 12px', fontSize: 14, color: C.dk1, outline: 'none', background: C.lt2 }}
            />
          </div>
        </div>
        <label style={{ display: 'block', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: C.greyFooter, fontWeight: 700, margin: '16px 0 8px' }}>
          Farbe
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onSetDraft('draftColor', c)}
              style={{ width: 30, height: 30, background: c, outline: s.draftColor === c ? '3px solid #0E1721' : '1px solid rgba(0,0,0,.08)', outlineOffset: -1 }}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={onAddProject}
          disabled={!canAdd}
          style={{
            width: '100%',
            marginTop: 14,
            padding: 14,
            background: canAdd ? C.accent1 : '#C7CFD4',
            color: C.lt1,
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: '.04em',
            cursor: canAdd ? 'pointer' : 'not-allowed',
          }}
        >
          Projekt anlegen
        </button>
      </div>

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
    ['track', 'Buchungen', '▣'],
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

/* ======================= ACTIVITY SHEET ======================= */
function ActivitySheet(props: {
  seg: Segment;
  project: Project;
  onSetStart: (min: number) => void;
  onSetEnd: (min: number) => void;
  onSetActivity: (text: string) => void;
  onChecklistText: (i: number, text: string) => void;
  onChecklistToggle: (i: number) => void;
  onChecklistAdd: () => void;
  onChecklistMove: (i: number, dir: -1 | 1) => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const { seg, project, onSetStart, onSetEnd, onSetActivity, onChecklistText, onChecklistToggle, onChecklistAdd, onChecklistMove, onClose, onDelete } = props;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const tc = textOn(project.color);
  const dark = tc === C.dk1;
  const muted = dark ? 'rgba(14,23,33,.6)' : 'rgba(255,255,255,.72)';
  const grab = dark ? 'rgba(14,23,33,.22)' : 'rgba(255,255,255,.45)';
  const blocked = needsActivity(seg); // can't close until a description or subtask exists

  return (
    <div
      onClick={() => { if (!blocked) onClose(); }}
      style={{ position: 'absolute', inset: 0, background: 'rgba(14,23,33,.4)', zIndex: 30, display: 'flex', alignItems: 'flex-end', animation: 'tkFade .18s ease' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxHeight: '92dvh', overflowY: 'auto', background: project.color, padding: '14px 20px 22px', animation: 'tkRise .26s cubic-bezier(.16,.84,.44,1)', boxShadow: '0 -8px 30px rgba(14,23,33,.2)' }}
      >
        <div style={{ width: 38, height: 4, background: grab, margin: '0 auto 14px' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700, color: muted }}>Beendet</div>
            <div style={{ fontSize: 19, fontWeight: 700, color: tc, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {project.code + '  ·  ' + project.name}
            </div>
          </div>
          <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
            <div style={{ fontSize: 34, fontWeight: 300, color: tc, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{fmtDur(seg.end - seg.start)}</div>
            <div style={{ fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: muted }}>Std : Min</div>
          </div>
        </div>

        <div style={{ marginTop: 14, borderTop: '1px solid rgba(255,255,255,.25)', paddingTop: 12 }}>
          <BookingDetailFields
            seg={seg}
            textColor={tc}
            mutedColor={muted}
            secondTimeLabel="Ende"
            secondTimeValue={seg.end}
            secondTimeNullable={false}
            onSetStart={onSetStart}
            onSetSecondTime={(m) => { if (m != null) onSetEnd(m); }}
            onSetActivity={onSetActivity}
            onChecklistText={onChecklistText}
            onChecklistToggle={onChecklistToggle}
            onChecklistAdd={onChecklistAdd}
            onChecklistMove={onChecklistMove}
          />

          {blocked && (
            <div style={{ fontSize: 12, color: muted, marginTop: 14 }}>
              Bitte zuerst eine Beschreibung oder eine Aufgabe erfassen, um die Buchung abzuschließen.
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={blocked}
            style={{ width: '100%', marginTop: blocked ? 8 : 14, padding: 12, background: 'rgba(255,255,255,.18)', color: tc, fontSize: 14, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', opacity: blocked ? 0.4 : 1, cursor: blocked ? 'not-allowed' : 'pointer' }}
          >
            Schließen
          </button>
          {confirmDelete ? (
            <div style={{ marginTop: 10, padding: '12px 13px', background: C.lt1, border: '1px solid ' + C.critical }}>
              <div style={{ fontSize: 13, color: C.dk1, fontWeight: 500, marginBottom: 10 }}>Diese Buchung wirklich löschen?</div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  style={{ flex: 1, padding: 11, background: C.lt2, color: C.dk1, fontSize: 13, fontWeight: 700 }}
                >
                  Abbrechen
                </button>
                <button
                  type="button"
                  onClick={onDelete}
                  style={{ flex: 1, padding: 11, background: C.critical, color: C.lt1, fontSize: 13, fontWeight: 700 }}
                >
                  Löschen
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              style={{ width: '100%', marginTop: 10, padding: 11, background: 'transparent', color: tc, fontSize: 13, fontWeight: 700, letterSpacing: '.04em', opacity: 0.85 }}
            >
              Eintrag löschen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ======================= GAP-FILL PICKER ======================= */
function GapFillSheet(props: { gap: Gap; projects: Project[]; onPick: (pid: string) => void; onCancel: () => void }) {
  const { gap, projects, onPick, onCancel } = props;
  const range = fmtClock(gap.start) + '–' + fmtClock(gap.end) + ' (' + fmtDur(gap.end - gap.start) + ' h)';
  return (
    <div
      onClick={onCancel}
      style={{ position: 'absolute', inset: 0, background: 'rgba(14,23,33,.4)', zIndex: 30, display: 'flex', alignItems: 'flex-end', animation: 'tkFade .18s ease' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', background: C.lt1, padding: '22px 20px 24px', animation: 'tkRise .26s cubic-bezier(.16,.84,.44,1)', boxShadow: '0 -8px 30px rgba(14,23,33,.2)' }}
      >
        <div style={{ width: 38, height: 4, background: '#D5DBDF', margin: '0 auto 18px' }} />
        <div style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: C.greyFooter, fontWeight: 700 }}>Lücke &nbsp;·&nbsp; {range}</div>
        <div style={{ fontSize: 21, fontWeight: 700, color: C.dk1, margin: '6px 0 16px' }}>Welchem Projekt zuordnen?</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {projects.map((p) => {
            const tc = textOn(p.color);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onPick(p.id)}
                style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start', textAlign: 'left', padding: '12px 13px', background: p.color, color: tc }}
              >
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', opacity: 0.75, color: tc }}>{p.code}</span>
                <span style={{ fontSize: 14, fontWeight: 700, color: tc }}>{p.name}</span>
              </button>
            );
          })}
        </div>
        <button type="button" onClick={onCancel} style={{ width: '100%', marginTop: 14, padding: 12, background: C.lt2, color: C.dk1, fontSize: 14, fontWeight: 700 }}>
          Abbrechen
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
  onAdd: () => void;
  onEdit: (t: Todo) => void;
  onTake: (t: Todo) => void;
  onComplete: (id: string) => void;
}) {
  const { state: s, onAdd, onEdit, onTake, onComplete } = props;
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

  const takeButton = (t: Todo) => (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onTake(t);
      }}
      disabled={!t.projectId}
      title={t.projectId ? 'In Projektübersicht übernehmen' : 'Erst ein Projekt auswählen'}
      style={{
        flex: '0 0 auto',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 30,
        height: 30,
        padding: 0,
        border: '1px solid ' + (t.projectId ? C.accent1 : '#E1E5E8'),
        background: t.projectId ? C.lt1 : '#F7F8F9',
        color: t.projectId ? C.accent1 : '#C7CFD4',
        cursor: t.projectId ? 'pointer' : 'not-allowed',
      }}
    >
      <svg width={15} height={15} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 5v14l11-7z" fill="currentColor" />
      </svg>
    </button>
  );

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
                      {takeButton(t)}
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
                    {takeButton(t)}
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
function ArchiveView(props: { state: AppState; onEdit: (t: Todo) => void; onRestore: (id: string) => void }) {
  const { state: s, onEdit, onRestore } = props;
  const archived = s.todos.filter((t) => t.archived);
  return (
    <section style={{ padding: '18px 20px 36px' }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: C.greyFooter, fontWeight: 700 }}>Archiv</div>
        <div style={{ fontSize: 13, color: C.greyFooter, marginTop: 3 }}>Erledigte Aufgaben ({archived.length})</div>
      </div>

      {archived.length === 0 ? (
        <div style={{ fontSize: 13, color: C.muted, padding: '8px 0' }}>Noch keine erledigten Aufgaben.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {archived.map((t) => {
            const items = (t.checklist ?? []).filter((c) => c.text.trim() !== '');
            const done = items.filter((c) => c.done).length;
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
                    {items.length > 0 && <span> &nbsp;·&nbsp; ✓ {done}/{items.length}</span>}
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
  onTake?: (t: Todo) => void;
  onClose: () => void;
}) {
  const { initial, projects, onSave, onDelete, onTake, onClose } = props;
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
                  onChange={() => setChecklist((cl) => cl.map((c, idx) => (idx === i ? { ...c, done: !c.done } : c)))}
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
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setChecklist((cl) => cl.concat([{ text: '', done: false }]))}
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
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.code} · {p.name}</option>
            ))}
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

          {onTake && (
            <button
              type="button"
              onClick={() => onTake(current())}
              disabled={!projectId}
              title={projectId ? 'Buchung auf diesem Projekt starten' : 'Erst ein Projekt auswählen'}
              style={{
                width: '100%',
                marginTop: 10,
                padding: 12,
                border: '1px solid ' + (projectId ? C.accent2 : '#D5DBDF'),
                background: C.lt1,
                color: projectId ? C.accent2 : '#B9C4CB',
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: '.04em',
                cursor: projectId ? 'pointer' : 'not-allowed',
              }}
            >
              In Projektsicht übernehmen
            </button>
          )}

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
