import { supabase } from './supabase';
import type { DaySegment, Project, Segment, Todo, TodoCategory } from '../types';

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
}
interface DbDaySegment extends DbSegment {
  day: string;
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
  const { data, error } = await supabase
    .from('segments')
    .select('id, pid, start_min, end_min, activity')
    .eq('day', day)
    .order('start_min', { ascending: true });
  if (error) throw error;
  return (data as DbSegment[]).map((s) => ({
    id: s.id,
    pid: s.pid,
    start: s.start_min,
    end: s.end_min,
    activity: s.activity ?? '',
  }));
}

/** Load all bookings between `fromDay` and `toDay` (inclusive), each tagged
 *  with its `day`. Used by the aggregated Reporting views. */
export async function loadSegmentsRange(fromDay: string, toDay: string): Promise<DaySegment[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('segments')
    .select('id, pid, day, start_min, end_min, activity')
    .gte('day', fromDay)
    .lte('day', toDay)
    .order('day', { ascending: true })
    .order('start_min', { ascending: true });
  if (error) throw error;
  return (data as DbDaySegment[]).map((s) => ({
    id: s.id,
    pid: s.pid,
    day: s.day,
    start: s.start_min,
    end: s.end_min,
    activity: s.activity ?? '',
  }));
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

/** Replace the user's bookings for `day` with the given list. */
export async function syncSegments(day: string, segments: Segment[]): Promise<void> {
  if (!supabase) return;
  const { data: existing, error: selErr } = await supabase.from('segments').select('id').eq('day', day);
  if (selErr) throw selErr;
  const keep = new Set(segments.map((s) => s.id));
  const toDelete = (existing as { id: string }[]).map((r) => r.id).filter((id) => !keep.has(id));
  if (toDelete.length) {
    const { error } = await supabase.from('segments').delete().in('id', toDelete);
    if (error) throw error;
  }
  if (segments.length) {
    const { error } = await supabase.from('segments').upsert(
      segments.map((s) => ({
        id: s.id,
        pid: s.pid,
        day,
        start_min: s.start,
        end_min: s.end,
        activity: s.activity,
      })),
    );
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
}

export async function loadTodos(): Promise<Todo[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('todos')
    .select('id, title, category, project_id, planned_min, urgency, importance')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data as DbTodo[]).map((t) => ({
    id: t.id,
    title: t.title,
    category: t.category as TodoCategory,
    projectId: t.project_id,
    plannedMin: t.planned_min,
    urgency: t.urgency,
    importance: t.importance,
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
      })),
    );
    if (error) throw error;
  }
}
