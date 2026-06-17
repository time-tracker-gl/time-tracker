import { supabase } from './supabase';
import type { ChecklistItem, DaySegment, Project, Segment, Todo, TodoCategory } from '../types';

/** Local (not UTC) date as YYYY-MM-DD, used as the booking "day". */
export function localISODate(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface DbProject {
  id: string;
  code: string;
  name: string;
  color: string;
}
interface DbSegment {
  id: string;
  pid: string;
  start_min: number;
  end_min: number;
  activity: string | null;
  planned_end?: number | null;
  checklist?: ChecklistItem[] | null;
  todo_id?: string | null;
}
interface DbDaySegment extends DbSegment {
  day: string;
}

function mapSegment(s: DbSegment): Segment {
  return {
    id: s.id,
    pid: s.pid,
    start: s.start_min,
    end: s.end_min,
    activity: s.activity ?? '',
    plannedEnd: s.planned_end ?? null,
    checklist: s.checklist ?? [],
    todoId: s.todo_id ?? null,
  };
}

export async function loadProjects(): Promise<Project[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('projects')
    .select('id, code, name, color')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data as DbProject[]).map((p) => ({ id: p.id, code: p.code, name: p.name, color: p.color }));
}

export async function loadSegments(day: string): Promise<Segment[]> {
  if (!supabase) return [];
  // select('*') so newer columns (planned_end, checklist, todo_id) don't break loading
  const { data, error } = await supabase
    .from('segments')
    .select('*')
    .eq('day', day)
    .order('start_min', { ascending: true });
  if (error) throw error;
  return (data as DbSegment[]).map(mapSegment);
}

/** Load all bookings between `fromDay` and `toDay` (inclusive), each tagged
 *  with its `day`. Used by the aggregated Reporting views. */
export async function loadSegmentsRange(fromDay: string, toDay: string): Promise<DaySegment[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('segments')
    .select('*')
    .gte('day', fromDay)
    .lte('day', toDay)
    .order('day', { ascending: true })
    .order('start_min', { ascending: true });
  if (error) throw error;
  return (data as DbDaySegment[]).map((s) => ({ ...mapSegment(s), day: s.day }));
}

export async function seedDefaultProjects(defaults: Project[]): Promise<void> {
  if (!supabase || defaults.length === 0) return;
  const { error } = await supabase
    .from('projects')
    .insert(defaults.map((p) => ({ id: p.id, code: p.code, name: p.name, color: p.color })));
  if (error) throw error;
}

/** Replace the user's projects with the given list (upsert + delete removed). */
export async function syncProjects(projects: Project[]): Promise<void> {
  if (!supabase) return;
  const { data: existing, error: selErr } = await supabase.from('projects').select('id');
  if (selErr) throw selErr;
  const keep = new Set(projects.map((p) => p.id));
  const toDelete = (existing as { id: string }[]).map((r) => r.id).filter((id) => !keep.has(id));
  if (toDelete.length) {
    const { error } = await supabase.from('projects').delete().in('id', toDelete);
    if (error) throw error;
  }
  if (projects.length) {
    const { error } = await supabase
      .from('projects')
      .upsert(projects.map((p) => ({ id: p.id, code: p.code, name: p.name, color: p.color })));
    if (error) throw error;
  }
}

/** Replace the user's bookings for `day` with the given list.
 *  Upsert happens before delete so a failed upsert never loses existing rows. */
export async function syncSegments(day: string, segments: Segment[]): Promise<void> {
  if (!supabase) return;
  if (segments.length) {
    const { error } = await supabase.from('segments').upsert(
      segments.map((s) => ({
        id: s.id,
        pid: s.pid,
        day,
        start_min: s.start,
        end_min: s.end,
        activity: s.activity,
        planned_end: s.plannedEnd ?? null,
        checklist: s.checklist ?? [],
        todo_id: s.todoId ?? null,
      })),
    );
    if (error) throw error;
  }
  const { data: existing, error: selErr } = await supabase.from('segments').select('id').eq('day', day);
  if (selErr) throw selErr;
  const keep = new Set(segments.map((s) => s.id));
  const toDelete = (existing as { id: string }[]).map((r) => r.id).filter((id) => !keep.has(id));
  if (toDelete.length) {
    const { error } = await supabase.from('segments').delete().in('id', toDelete);
    if (error) throw error;
  }
}

interface DbTodo {
  id: string;
  title: string;
  category: string;
  project_id: string | null;
  planned_min: number;
  urgency: number;
  importance: number;
  drawing?: string | null;
  zug?: boolean | null;
  archived?: boolean | null;
}

export async function loadTodos(): Promise<Todo[]> {
  if (!supabase) return [];
  // select('*') so an as-yet-missing `drawing` column doesn't break loading
  const { data, error } = await supabase.from('todos').select('*').order('created_at', { ascending: true });
  if (error) throw error;
  return (data as DbTodo[]).map((t) => ({
    id: t.id,
    title: t.title,
    category: t.category as TodoCategory,
    projectId: t.project_id,
    plannedMin: t.planned_min,
    urgency: t.urgency,
    importance: t.importance,
    drawing: t.drawing ?? null,
    zug: t.zug ?? false,
    archived: t.archived ?? false,
  }));
}

/** Replace the user's todos with the given list (upsert + delete removed). */
export async function syncTodos(todos: Todo[]): Promise<void> {
  if (!supabase) return;
  const { data: existing, error: selErr } = await supabase.from('todos').select('id');
  if (selErr) throw selErr;
  const keep = new Set(todos.map((t) => t.id));
  const toDelete = (existing as { id: string }[]).map((r) => r.id).filter((id) => !keep.has(id));
  if (toDelete.length) {
    const { error } = await supabase.from('todos').delete().in('id', toDelete);
    if (error) throw error;
  }
  if (todos.length) {
    const { error } = await supabase.from('todos').upsert(
      todos.map((t) => ({
        id: t.id,
        title: t.title,
        category: t.category,
        project_id: t.projectId,
        planned_min: t.plannedMin,
        urgency: t.urgency,
        importance: t.importance,
        drawing: t.drawing,
        zug: t.zug,
        archived: t.archived,
      })),
    );
    if (error) throw error;
  }
}
