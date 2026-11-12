import type { Task } from '@gantt/contract';
import type { PlacedTask } from '@gantt/engine';
import type { Model } from './layout.ts';

/**
 * Views (D9, D10, D11, D19, F12): sorting, filtering and grouping change what is shown, never the data.
 * A view is plain JSON so the host can store and share it (for example in the URL).
 */
export interface ViewSort { field: string; dir: 'asc' | 'desc' }
export interface ViewFilter {
  /** Matches name, id or WBS code, ignoring case. */
  text?: string;
  /** Field → accepted values (compared as text). A task must match every listed field. */
  fields?: Record<string, string[]>;
}
export interface ColumnState { id: string; width?: number; hidden?: boolean }
export interface GanttViewState {
  sort?: ViewSort;
  filter?: ViewFilter;
  /** Group leaf tasks by this field's value (D11). */
  groupBy?: string;
  /** Show each group as a lane row (A6). */
  groupLanes?: boolean;
  /** Column order, widths and visibility (D18). */
  columns?: ColumnState[];
  /** Columns frozen at the left of the grid when it scrolls sideways. */
  frozen?: number;
  zoom?: string;
  compact?: boolean;
}
export interface SavedView { id: string; name: string; view: GanttViewState }

export const GROUP_PREFIX = '\u0001group:';
export const isGroupId = (id: string) => id.startsWith(GROUP_PREFIX);

/** The value of a field for sorting, filtering and grouping: placed dates and progress for the computed fields. */
export function fieldValue(m: Model, id: string, field: string): unknown {
  const t = m.tasks.get(id);
  if (!t) return undefined;
  const p = m.placement.byId.get(id);
  switch (field) {
    case 'start': return p?.start;
    case 'end': return p?.end;
    case 'duration': return p?.duration;
    case 'progress': return p?.progress;
    case 'wbs': return m.wbs.get(id);
    default: return (t as Record<string, unknown>)[field];
  }
}

const text = (v: unknown) => v === undefined || v === null ? '' : String(v);
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
function compare(a: unknown, b: unknown): number {
  const ae = a === undefined || a === null || a === '', be = b === undefined || b === null || b === '';
  if (ae || be) return ae === be ? 0 : ae ? 1 : -1; // empty values last in either direction
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return collator.compare(text(a), text(b));
}

export function matchesText(m: Model, id: string, q: string): boolean {
  const t = m.tasks.get(id); if (!t) return false;
  const s = q.trim().toLowerCase(); if (!s) return true;
  return t.name.toLowerCase().includes(s) || id.toLowerCase() === s || (m.wbs.get(id) ?? '') === s;
}

/** Find (D19): ids whose name contains the text, or whose id or WBS code equals it, in tree order. */
export function findTasks(m: Model, q: string): string[] {
  if (!q.trim()) return [];
  const out: string[] = [];
  const visit = (id: string | null) => { for (const k of m.children.get(id) ?? []) { if (matchesText(m, k, q)) out.push(k); visit(k); } };
  visit(null);
  return out;
}

export function isViewActive(v: GanttViewState | undefined): boolean {
  return !!v && (!!v.sort || !!v.groupBy || !!v.filter?.text?.trim() || Object.values(v.filter?.fields ?? {}).some((x) => x.length > 0));
}

/**
 * The model as the view shows it. Filtering keeps matches and their ancestors; sorting orders siblings;
 * grouping puts leaf tasks under one synthetic row per value. Returns the same model when no view is active.
 */
export function viewModel(m: Model, v: GanttViewState | undefined, groupLabel: (field: string, value: string) => string = (_f, val) => val || '—'): { model: Model; matches: Set<string> | null } {
  if (!isViewActive(v)) return { model: m, matches: null };
  const view = v!;
  // Filter.
  let keep: Set<string> | null = null, matches: Set<string> | null = null;
  const q = view.filter?.text?.trim() ?? '';
  const fields = Object.entries(view.filter?.fields ?? {}).filter(([, vals]) => vals.length > 0);
  if (q || fields.length) {
    matches = new Set(); keep = new Set();
    for (const id of m.tasks.keys()) {
      if (q && !matchesText(m, id, q)) continue;
      if (fields.some(([f, vals]) => !vals.includes(text(fieldValue(m, id, f))))) continue;
      matches.add(id);
      for (let cur: string | null | undefined = id; cur && !keep.has(cur); cur = m.tasks.get(cur)?.parent) keep.add(cur);
    }
  }
  const sortKids = (kids: string[]): string[] => {
    if (!view.sort) return kids;
    const { field, dir } = view.sort;
    const pos = new Map(kids.map((k, i) => [k, i]));
    return [...kids].sort((a, b) => {
      const c = compare(fieldValue(m, a, field), fieldValue(m, b, field));
      return (c === 0 ? 0 : dir === 'desc' ? -c : c) || pos.get(a)! - pos.get(b)!;
    });
  };

  const tasks = new Map(m.tasks);
  const children = new Map<string | null, string[]>();
  const byId = new Map(m.placement.byId);

  if (view.groupBy) {
    // Leaves (tasks with no children) that pass the filter, grouped by value, in tree order within a group.
    const leaves: string[] = [];
    const visit = (id: string | null) => {
      for (const k of m.children.get(id) ?? []) {
        if (keep && !keep.has(k)) continue;
        const kids = m.children.get(k) ?? [];
        if (kids.length === 0) { if (!matches || matches.has(k)) leaves.push(k); } else visit(k);
      }
    };
    visit(null);
    const groups = new Map<string, string[]>();
    for (const id of leaves) {
      const key = text(fieldValue(m, id, view.groupBy));
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(id);
    }
    const keys = [...groups.keys()].sort((a, b) => compare(a || undefined, b || undefined));
    const top: string[] = [];
    for (const key of keys) {
      const gid = GROUP_PREFIX + key;
      const members = sortKids(groups.get(key)!);
      const g: Task = { id: gid, name: groupLabel(view.groupBy, key), type: 'summary', parent: null, lane: view.groupLanes || undefined };
      tasks.set(gid, g);
      for (const id of members) tasks.set(id, { ...m.tasks.get(id)!, parent: gid });
      children.set(gid, members);
      top.push(gid);
      // The group's bar spans its members.
      let s: number | undefined, e: number | undefined, work = 0, done = 0;
      for (const id of members) {
        const p = m.placement.byId.get(id); if (!p?.scheduled) continue;
        s = s === undefined ? p.start! : Math.min(s, p.start!); e = e === undefined ? p.end! : Math.max(e, p.end!);
        const d = p.duration ?? 1; work += d; done += d * p.progress;
      }
      const placed: PlacedTask = { task: g, start: s, end: e, progress: work ? done / work : 0, scheduled: s !== undefined, duration: undefined };
      byId.set(gid, placed);
    }
    children.set(null, top);
  } else {
    for (const [parent, kids] of m.children) {
      const shown = keep ? kids.filter((k) => keep!.has(k)) : kids;
      children.set(parent, sortKids(shown));
    }
  }
  return { model: { ...m, tasks, children, placement: { ...m.placement, byId } }, matches };
}
