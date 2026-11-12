import type { Baseline } from '@gantt/contract';
import { fromDay, toDay, type DayNum, type WorkCalendar } from './calendar.ts';
import type { Placement, PlacedTask } from './schedule.ts';

/**
 * Tracking (B1–B3): baselines, the progress line on a chosen date, and the S-curve of planned, actual and
 * baseline work over time. Work is counted in working days; an hour-based task counts its fraction.
 */

/** Snapshot of the plan (B1): each scheduled task's dates and work. Saving one does not change the plan. */
export function takeBaseline(placement: Placement, meta: Omit<Baseline, 'tasks'>): Baseline {
  const tasks: Baseline['tasks'] = [];
  for (const p of placement.byId.values()) {
    if (!p.scheduled) continue;
    tasks.push({ id: p.task.id, start: fromDay(p.start!), end: fromDay(p.end!), work: p.task.type === 'milestone' ? 0 : p.duration ?? 0 });
  }
  return { ...meta, tasks };
}

/** Where the progress line passes one task: left of the status date when the task is behind, right when ahead. */
export interface ProgressPoint {
  taskId: string;
  /** Where the line passes on this task's row, as a (fractional) day number. */
  day: number;
  /** Progress the plan expects by the status date (0–1). */
  expected: number;
  /** Working days ahead (positive) or behind (negative). */
  variance: number;
  status: 'ahead' | 'behind' | 'onTrack';
}

/** Working days of a task done by the end of `day` if it follows its plan (0 before it starts). */
function plannedDone(cal: WorkCalendar, p: PlacedTask, day: DayNum): number {
  if (day < p.start!) return 0;
  const total = cal.workingDaysBetween(p.start!, p.end!) || 1;
  return Math.min(1, cal.workingDaysBetween(p.start!, Math.min(day, p.end!)) / total);
}

/**
 * Progress line (B3) on a status date: for every task that has started or should have, the line passes
 * through its progress; tasks neither started nor due keep the line on the status date.
 */
export function progressLine(placement: Placement, statusDay: DayNum, tolerance = 0.5): Map<string, ProgressPoint> {
  const cal = placement.calendar;
  const out = new Map<string, ProgressPoint>();
  const parents = new Set<string>();
  for (const p of placement.byId.values()) if (p.task.parent) parents.add(p.task.parent);
  for (const p of placement.byId.values()) {
    if (!p.scheduled || p.task.mode === 'inactive' || parents.has(p.task.id) || p.task.type === 'summary' || p.task.type === 'milestone') continue;
    const expected = plannedDone(cal, p, statusDay);
    const work = p.duration ?? 1;
    const variance = (p.progress - expected) * work;
    const relevant = expected > 0 || p.progress > 0;
    const day = relevant ? p.start! + p.progress * (p.end! - p.start! + 1) : statusDay + 1;
    out.set(p.task.id, { taskId: p.task.id, day, expected, variance, status: variance > tolerance ? 'ahead' : variance < -tolerance ? 'behind' : 'onTrack' });
  }
  return out;
}

/** Planned versus actual cumulative work over time, for the S-curve chart. */
export interface SCurve {
  /** One entry per calendar day from the first start to the last finish. */
  days: DayNum[];
  /** Cumulative planned work (working days). */
  planned: number[];
  /** Cumulative work done, up to the status date (null after it). */
  actual: (number | null)[];
  /** Cumulative work in the baseline, when one is given. */
  baseline: number[] | null;
  totals: { planned: number; actual: number; baseline: number | null };
}

/**
 * S-curve (B2). The planned curve spreads each leaf task's work over its working days; the actual curve
 * reaches each task's earned work (work × progress) on the status date, following the plan's shape before
 * it; the baseline curve does the same for the saved plan. Totals equal the sums over the data.
 */
export function sCurve(placement: Placement, statusDay: DayNum, baseline?: Baseline): SCurve {
  const cal = placement.calendar;
  const parents = new Set<string>();
  for (const p of placement.byId.values()) if (p.task.parent) parents.add(p.task.parent);
  const leaves = [...placement.byId.values()].filter((p) => p.scheduled && p.task.mode !== 'inactive' && !parents.has(p.task.id) && p.task.type !== 'summary' && p.task.type !== 'milestone');
  const bl = baseline?.tasks.filter((t) => t.work > 0 && !parents.has(t.id)) ?? [];
  let lo = Infinity, hi = -Infinity;
  for (const p of leaves) { lo = Math.min(lo, p.start!); hi = Math.max(hi, p.end!); }
  for (const t of bl) { lo = Math.min(lo, toDay(t.start)); hi = Math.max(hi, toDay(t.end)); }
  if (lo === Infinity) return { days: [], planned: [], actual: [], baseline: baseline ? [] : null, totals: { planned: 0, actual: 0, baseline: baseline ? 0 : null } };
  const n = hi - lo + 1;
  const plannedInc = new Float64Array(n), actualInc = new Float64Array(n), baseInc = new Float64Array(n);
  const spread = (inc: Float64Array, s: DayNum, e: DayNum, amount: number, until = Infinity) => {
    const wd = cal.workingDaysBetween(s, e) || 1;
    for (let d = s; d <= e; d++) if (cal.isWorking(d)) { if (d > until) break; inc[d - lo]! += amount / wd; }
  };
  let tp = 0, ta = 0, tb = 0;
  for (const p of leaves) {
    const work = p.duration ?? 1;
    tp += work; spread(plannedInc, p.start!, p.end!, work);
    const earned = work * p.progress;
    ta += earned;
    if (earned > 0) {
      // Earned work follows the plan's shape up to the status date and is all in by then.
      const doneByStatus = plannedDone(cal, p, statusDay);
      if (doneByStatus > 0 && statusDay >= p.start!) spread(actualInc, p.start!, p.end!, earned / doneByStatus, statusDay);
      else if (statusDay >= lo && statusDay <= hi) actualInc[statusDay - lo]! += earned;
    }
  }
  for (const t of bl) { tb += t.work; spread(baseInc, toDay(t.start), toDay(t.end), t.work); }
  const days: DayNum[] = [], planned: number[] = [], actual: (number | null)[] = [], base: number[] = [];
  let cp = 0, ca = 0, cb = 0;
  for (let i = 0; i < n; i++) {
    cp += plannedInc[i]!; ca += actualInc[i]!; cb += baseInc[i]!;
    days.push(lo + i); planned.push(cp); base.push(cb);
    actual.push(lo + i <= statusDay ? ca : null);
  }
  return { days, planned, actual, baseline: baseline ? base : null, totals: { planned: tp, actual: ta, baseline: baseline ? tb : null } };
}
