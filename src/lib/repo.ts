import { supabase } from './supabase';
import type { Project, Segment } from '../types';

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
