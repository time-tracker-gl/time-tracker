export interface Project {
  id: string;
  code: string;
  name: string;
  color: string;
}

/** A single sub-activity in a running booking's detail checklist. */
export interface ChecklistItem {
  text: string;
  done: boolean;
}

/** A booking ("Buchung"/"Segment"): a contiguous interval on a project.
 *  start/end are minutes since midnight (0…1440). */
export interface Segment {
  id: string;
  pid: string;
  start: number;
  end: number;
  activity: string;
  /** planned end (minutes since midnight) shown in the project detail; null = open */
  plannedEnd?: number | null;
  /** sub-activity checklist for the project detail view */
  checklist?: ChecklistItem[];
  /** the ToDo this booking was started from (for archiving on "Erledigt") */
  todoId?: string | null;
}

/** A booking together with the day it belongs to (YYYY-MM-DD), used for
 *  multi-day aggregation in the Reporting views. */
export interface DaySegment extends Segment {
  day: string;
}

export type Tab = 'track' | 'report' | 'tasks' | 'admin';

export type TodoCategory = 'projekt' | 'akquise' | 'intern';

/** A "Daily Task" / ToDo the user wants to get done today.
 *  urgency 0..5 (sofort … später), importance 0..4 (very high … very low);
 *  the list is sorted ascending by (urgency + importance). */
export interface Todo {
  id: string;
  title: string;
  category: TodoCategory;
  /** optional concrete project this ToDo maps to (used when handing it to the
   *  Buchungen view); null = none picked yet. */
  projectId: string | null;
  /** planned duration in minutes */
  plannedMin: number;
  urgency: number;
  importance: number;
  /** optional hand-drawn sketch as a PNG data URL (no recognition) */
  drawing: string | null;
  /** can be done "on the train" – highlighted in the lists */
  zug: boolean;
  /** archived (e.g. after "Erledigt") – kept in storage but hidden from lists */
  archived: boolean;
}
export type TileLayout = 'grid' | 'sized' | 'list';
export type ReportPeriod = 'heute' | 'woche' | 'monat' | 'jahr' | 'zeitraum';

export interface Gap {
  start: number;
  end: number;
}
