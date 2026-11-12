import type { Calendar, IsoDate } from '@gantt/contract';

/**
 * Working-time arithmetic on whole days (C7).
 * Dates are handled as integer day numbers (days since 1970-01-01) so they are independent
 * of the browser's time zone; the contract defines dates in the roadmap's time zone.
 */
export type DayNum = number;

export const DEFAULT_CALENDAR: Calendar = { id: '__default', name: 'Monday–Friday', workingDays: [1, 2, 3, 4, 5], hoursPerDay: 8 };

export function toDay(iso: IsoDate): DayNum {
  return Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000);
}
export function fromDay(d: DayNum): IsoDate {
  return new Date(d * 86_400_000).toISOString().slice(0, 10);
}
/** ISO weekday 1 = Monday … 7 = Sunday. Day 0 (1970-01-01) was a Thursday. */
export function weekday(d: DayNum): number {
  return ((((d + 3) % 7) + 7) % 7) + 1;
}

export class WorkCalendar {
  readonly id: string;
  private readonly working = new Set<number>();
  private readonly holidays = new Set<DayNum>();

  constructor(cal: Calendar = DEFAULT_CALENDAR) {
    this.id = cal.id;
    cal.workingDays.forEach((d) => this.working.add(d));
    cal.holidays?.forEach((h) => this.holidays.add(toDay(h)));
    if (this.working.size === 0) throw new Error(`Calendar ${cal.id} has no working days`);
  }

  isHoliday(d: DayNum): boolean { return this.holidays.has(d); }
  holidaysBetween(from: DayNum, to: DayNum): DayNum[] { return [...this.holidays].filter((h) => h >= from && h <= to); }
  isWorking(d: DayNum): boolean {
    return this.working.has(weekday(d)) && !this.holidays.has(d);
  }
  /** The first working day on or after d. */
  nextWorking(d: DayNum): DayNum {
    while (!this.isWorking(d)) d++;
    return d;
  }
  /** The last working day on or before d. */
  prevWorking(d: DayNum): DayNum {
    while (!this.isWorking(d)) d--;
    return d;
  }
  /**
   * Inclusive last working day of a task that starts on `start` and lasts `duration` working days.
   * A non-working start is moved to the next working day first. Duration 0 (milestone) returns the start.
   */
  endOf(start: DayNum, duration: number): DayNum {
    let d = this.nextWorking(start);
    if (duration <= 0) return d;
    let left = Math.ceil(duration) - 1;
    while (left > 0) { d++; if (this.isWorking(d)) left--; }
    return d;
  }
  /**
   * Moves `n` working days from `d`: n = 0 gives the first working day on or after d; n > 0 that many
   * working days later; n < 0 that many earlier (from the last working day on or before d).
   */
  shift(d: DayNum, n: number): DayNum {
    n = Math.trunc(n);
    if (n >= 0) { let x = this.nextWorking(d); while (n-- > 0) { x++; while (!this.isWorking(x)) x++; } return x; }
    let x = this.prevWorking(d);
    while (n++ < 0) { x--; while (!this.isWorking(x)) x--; }
    return x;
  }
  /** Number of working days from start to end, both inclusive. */
  workingDaysBetween(start: DayNum, end: DayNum): number {
    let n = 0;
    for (let d = start; d <= end; d++) if (this.isWorking(d)) n++;
    return n;
  }
}

export function buildCalendars(cals: Calendar[] | undefined): Map<string, WorkCalendar> {
  const m = new Map<string, WorkCalendar>();
  for (const c of cals ?? []) m.set(c.id, new WorkCalendar(c));
  return m;
}

/**
 * Where a task's work falls (C8, D12, G4): its pieces in working time on its own calendar, and how much of
 * the last day it uses (an 8-hour day calendar and a 4-hour task: 0.5). `work` is in working days and may
 * be fractional for hour-based tasks.
 */
export interface TaskSpan { start: DayNum; end: DayNum; segments: [DayNum, DayNum][]; endFraction: number; occupied: number }
export function spanOf(cal: WorkCalendar, start: DayNum, work: number, splits?: { after: number; gap: number }[]): TaskSpan {
  const s0 = cal.nextWorking(start);
  if (work <= 0) return { start: s0, end: s0, segments: [[s0, s0]], endFraction: 1, occupied: 0 };
  const days = Math.max(1, Math.ceil(work - 1e-9));
  const endFraction = Math.min(1, work - (days - 1));
  const segments: [DayNum, DayNum][] = [];
  let s = s0, left = days, occupied = 0;
  for (const sp of splits ?? []) {
    if (sp.after >= left) break;
    const e = cal.endOf(s, sp.after);
    segments.push([s, e]);
    left -= sp.after; occupied += sp.after + sp.gap;
    s = cal.shift(e, sp.gap + 1);
  }
  const e = cal.endOf(s, left);
  segments.push([s, e]);
  occupied += left;
  return { start: s0, end: e, segments, endFraction, occupied };
}

/** A task's work in working days: hours are divided by the calendar's hours per day (G4). */
export function workDays(t: { type: string; duration?: number; durationUnit?: string }, hoursPerDay: number): number {
  if (t.type === 'milestone') return 0;
  if (t.durationUnit === 'hour') return Math.max(1 / hoursPerDay, (t.duration ?? hoursPerDay) / hoursPerDay);
  return Math.max(1, t.duration ?? 1);
}
