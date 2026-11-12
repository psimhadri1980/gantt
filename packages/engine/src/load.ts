import type { RoadmapDocument, Task } from '@gantt/contract';
import { buildCalendars, fromDay, spanOf, toDay, workDays, WorkCalendar, type DayNum } from './calendar.ts';
import { applySchedule, schedule } from './scheduler.ts';
import { place, type Placement } from './schedule.ts';

/**
 * Resources (E1–E7): load per period against capacity, default demand when there is no resource data,
 * and resource levelling. Work and capacity are in FTE-days: one person full time for one working day.
 */

export type LoadPeriod = 'day' | 'week' | 'month';
/** Demand and capacity of one row in one period (a day, week or month, depending on the zoom). */
export interface LoadBucket {
  start: DayNum; end: DayNum;
  /** Demand in FTE-days. */
  demand: number;
  /** Capacity in FTE-days, or null where none is known (no over-allocation is shown then). */
  capacity: number | null;
  /** Working days in the bucket on which demand exceeds that day's capacity (E4). */
  overDays: number;
}
/** One row of the load chart: a named resource, an owner without resource data, or the total demand. */
export interface LoadRow {
  key: string;
  label: string;
  kind: 'resource' | 'owner' | 'unassigned' | 'total';
  /** FTE per working day, where known. */
  capacityFte: number | null;
  buckets: LoadBucket[];
  /** Tasks that put demand on this row. */
  tasks: string[];
}
/** Result of `resourceLoad`: the rows to draw and whether demand was assumed (no assignments at all). */
export interface ResourceLoad {
  rows: LoadRow[];
  /** True when no task has assignments: every task counts as 1 FTE (E7). */
  defaultDemand: boolean;
}

/** The tasks that carry work: leaves only (summaries would count their children twice), active, and placed. */
const leafTasks = (doc: RoadmapDocument, placement: Placement) => {
  const parents = new Set(doc.tasks.map((t) => t.parent).filter(Boolean));
  return doc.tasks.filter((t) => !parents.has(t.id) && t.type === 'task' && t.mode !== 'inactive' && placement.byId.get(t.id)?.scheduled);
};

/** Days a task works, on its own calendar, with the FTE it needs per day from a given allocation. */
function taskDays(t: Task, placement: Placement, cals: Map<string, WorkCalendar>, hpd: number): { days: DayNum[]; perDay: number } {
  const p = placement.byId.get(t.id)!;
  const cal = (t.calendar && cals.get(t.calendar)) || placement.calendar;
  const work = workDays(t, hpd);
  const sp = spanOf(cal, p.start!, work, t.splits);
  const days: DayNum[] = [];
  for (const [a, b] of sp.segments) for (let d = a; d <= b; d++) if (cal.isWorking(d)) days.push(d);
  // An hour task spreads its fraction over its days.
  return { days, perDay: days.length ? Math.min(1, work / days.length) : 0 };
}

/** Period boundaries covering [from, to]. */
export function periods(from: DayNum, to: DayNum, period: LoadPeriod): [DayNum, DayNum][] {
  const out: [DayNum, DayNum][] = [];
  let s = from;
  if (period === 'week') s = from - (((from + 3) % 7) + 7) % 7;
  if (period === 'month') { const iso = fromDay(from); s = toDay(`${iso.slice(0, 7)}-01`); }
  while (s <= to) {
    let e: DayNum;
    if (period === 'day') e = s;
    else if (period === 'week') e = s + 6;
    else { const iso = fromDay(s); const y = +iso.slice(0, 4), m = +iso.slice(5, 7); e = toDay(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`) - 1; }
    out.push([s, e]); s = e + 1;
  }
  return out;
}

/**
 * Load per resource and period (E3, E4, E5). With assignments: one row per resource (capacity from its
 * capacityFte on its own calendar) plus "Unassigned" for tasks without any. Without: default demand of
 * 1 FTE per task working day, as a total and per owner, measured against the roadmap's default capacity (E7).
 */
export function resourceLoad(doc: RoadmapDocument, placement: Placement, opts: { period: LoadPeriod; from?: DayNum; to?: DayNum }): ResourceLoad {
  const cals = buildCalendars(doc.calendars);
  const hpd = doc.calendars?.find((c) => c.id === doc.roadmap.defaultCalendar)?.hoursPerDay ?? 8;
  const leaves = leafTasks(doc, placement);
  const assigned = leaves.some((t) => t.resources?.length);
  const daily = new Map<string, Map<DayNum, number>>(); // row key → day → FTE
  const rowTasks = new Map<string, Set<string>>();
  const add = (key: string, d: DayNum, v: number, taskId: string) => {
    const m = daily.get(key) ?? daily.set(key, new Map()).get(key)!;
    m.set(d, (m.get(d) ?? 0) + v);
    (rowTasks.get(key) ?? rowTasks.set(key, new Set()).get(key)!).add(taskId);
  };
  let lo = opts.from ?? Infinity, hi = opts.to ?? -Infinity;
  for (const t of leaves) {
    const { days, perDay } = taskDays(t, placement, cals, hpd);
    if (opts.from === undefined) for (const d of days) lo = Math.min(lo, d);
    if (opts.to === undefined) for (const d of days) hi = Math.max(hi, d);
    if (assigned) {
      if (t.resources?.length) for (const a of t.resources) for (const d of days) add(`r:${a.id}`, d, (a.allocation ?? 1) * perDay, t.id);
      else for (const d of days) add('unassigned', d, perDay, t.id);
    } else {
      for (const d of days) { add('total', d, perDay, t.id); if (t.owner) add(`o:${t.owner}`, d, perDay, t.id); }
    }
  }
  if (lo === Infinity) return { rows: [], defaultDemand: !assigned };
  const ps = periods(lo, hi, opts.period);
  const def = doc.roadmap.defaultCapacityFte;
  const makeRow = (key: string, label: string, kind: LoadRow['kind'], capFte: number | null, cal: WorkCalendar): LoadRow => {
    const m = daily.get(key) ?? new Map<DayNum, number>();
    const buckets = ps.map(([s, e]) => {
      let demand = 0, capacity = 0, overDays = 0;
      for (let d = s; d <= e; d++) {
        const v = m.get(d) ?? 0; demand += v;
        const c = capFte === null ? 0 : cal.isWorking(d) ? capFte : 0;
        capacity += c;
        if (capFte !== null && v > c + 1e-9) overDays++;
      }
      return { start: s, end: e, demand, capacity: capFte === null ? null : capacity, overDays };
    });
    return { key, label, kind, capacityFte: capFte, buckets, tasks: [...(rowTasks.get(key) ?? [])] };
  };
  const rows: LoadRow[] = [];
  if (assigned) {
    for (const r of doc.resources ?? []) rows.push(makeRow(`r:${r.id}`, r.name, 'resource', r.capacityFte ?? 1, (r.calendar && cals.get(r.calendar)) || placement.calendar));
    if (daily.has('unassigned')) rows.push(makeRow('unassigned', 'Unassigned', 'unassigned', null, placement.calendar));
  } else {
    rows.push(makeRow('total', 'Total demand', 'total', null, placement.calendar));
    const owners = [...daily.keys()].filter((k) => k.startsWith('o:')).sort();
    for (const k of owners) rows.push(makeRow(k, k.slice(2), 'owner', def ?? null, placement.calendar));
  }
  return { rows, defaultDemand: !assigned };
}

/**
 * Resource levelling (E6): tasks with assignments are delayed, in order of their start, until every
 * assigned resource has capacity on each of their days; dependencies are then re-applied, and this repeats
 * until nothing moves. Returns the changes (a new start and a start-no-earlier-than constraint) and the
 * tasks that could not be fitted within a year.
 */
export function levelResources(doc: RoadmapDocument): { changes: { id: string; fields: Partial<Task> }[]; unresolved: string[] } {
  const cals = buildCalendars(doc.calendars);
  const hpd = doc.calendars?.find((c) => c.id === doc.roadmap.defaultCalendar)?.hoursPerDay ?? 8;
  const res = new Map((doc.resources ?? []).map((r) => [r.id, r]));
  const capOn = (rid: string, d: DayNum, fallback: WorkCalendar) => {
    const r = res.get(rid); const cal = (r?.calendar && cals.get(r.calendar)) || fallback;
    return cal.isWorking(d) ? r?.capacityFte ?? 1 : 0;
  };
  let cur = doc;
  const unresolved = new Set<string>();
  for (let round = 0; round < 8; round++) {
    const s = schedule(cur); if (s.cycle) break;
    cur = applySchedule(cur, s);
    const placement = place(cur);
    const booked = new Map<string, Map<DayNum, number>>();
    const tasks = leafTasks(cur, placement).filter((t) => t.resources?.length && t.mode !== 'manual')
      .sort((a, b) => placement.byId.get(a.id)!.start! - placement.byId.get(b.id)!.start! || a.id.localeCompare(b.id));
    let moved = false;
    const updates = new Map<string, DayNum>();
    for (const t of tasks) {
      const p = placement.byId.get(t.id)!;
      const cal = (t.calendar && cals.get(t.calendar)) || placement.calendar;
      const work = workDays(t, hpd);
      let start = p.start!, fit = false;
      for (let tries = 0; tries < 366; tries++) {
        const sp = spanOf(cal, start, work, t.splits);
        const days: DayNum[] = [];
        for (const [a, b] of sp.segments) for (let d = a; d <= b; d++) if (cal.isWorking(d)) days.push(d);
        const perDay = days.length ? Math.min(1, work / days.length) : 0;
        fit = t.resources!.every((a) => days.every((d) => (booked.get(a.id)?.get(d) ?? 0) + (a.allocation ?? 1) * perDay <= capOn(a.id, d, placement.calendar) + 1e-9));
        if (fit) {
          for (const a of t.resources!) { const m = booked.get(a.id) ?? booked.set(a.id, new Map()).get(a.id)!; for (const d of days) m.set(d, (m.get(d) ?? 0) + (a.allocation ?? 1) * perDay); }
          break;
        }
        start = cal.nextWorking(start + 1);
      }
      if (!fit) { unresolved.add(t.id); continue; }
      if (start !== p.start) { updates.set(t.id, start); moved = true; }
    }
    if (!moved) break;
    cur = { ...cur, tasks: cur.tasks.map((t) => { const st = updates.get(t.id); if (st === undefined) return t; const { end: _e, ...rest } = t; void _e; return { ...rest, start: fromDay(st), constraint: { type: 'SNET' as const, date: fromDay(st) } }; }) };
  }
  const final = applySchedule(cur, schedule(cur));
  const before = new Map(doc.tasks.map((t) => [t.id, t]));
  const changes: { id: string; fields: Partial<Task> }[] = [];
  for (const t of final.tasks) {
    const b = before.get(t.id)!;
    const fields: Partial<Task> = {};
    if (t.start !== b.start) fields.start = t.start;
    if (JSON.stringify(t.constraint) !== JSON.stringify(b.constraint)) fields.constraint = t.constraint;
    if (b.end && !t.end) (fields as Record<string, unknown>).end = null;
    if (Object.keys(fields).length) changes.push({ id: t.id, fields });
  }
  return { changes, unresolved: [...unresolved] };
}
