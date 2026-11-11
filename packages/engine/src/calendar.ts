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
