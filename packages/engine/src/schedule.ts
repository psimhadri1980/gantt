import type { Issue, RoadmapDocument, Task } from '@gantt/contract';
import { buildCalendars, fromDay, toDay, WorkCalendar, type DayNum } from './calendar.ts';

/** A task with its resolved span. `start`/`end` are inclusive day numbers; absent when unscheduled. */
export interface PlacedTask {
  task: Task;
  start?: DayNum;
  end?: DayNum;
  /** Working days. For summaries, derived from the span on the default calendar. */
  duration?: number;
  progress: number;
  scheduled: boolean;
}

export interface Placement {
  byId: Map<string, PlacedTask>;
  calendar: WorkCalendar;
  warnings: Issue[];
  errors: Issue[];
  span?: { start: DayNum; end: DayNum };
}

/**
 * Places each task from its start and duration in working time, and derives summary dates and
 * progress from the children (C7, C12). Phase 1 does not schedule from links; that is Phase 4.
 */
export function place(doc: RoadmapDocument): Placement {
  const cals = buildCalendars(doc.calendars);
  const calendar = (doc.roadmap.defaultCalendar && cals.get(doc.roadmap.defaultCalendar)) || new WorkCalendar();
  const byId = new Map<string, PlacedTask>();
  const children = new Map<string | null, Task[]>();
  const errors: Issue[] = [];
  const warnings: Issue[] = [];

  doc.tasks.forEach((t, i) => {
    (children.get(t.parent) ?? children.set(t.parent, []).get(t.parent)!).push(t);
    const p: PlacedTask = { task: t, progress: t.progress ?? 0, scheduled: false };
    if (t.type !== 'summary' && t.start) {
      const s = calendar.nextWorking(toDay(t.start));
      let dur = t.type === 'milestone' ? 0 : t.duration;
      if (dur === undefined && t.end) dur = calendar.workingDaysBetween(s, toDay(t.end));
      const e = calendar.endOf(s, dur ?? 1);
      if (t.end && t.type === 'task' && t.duration !== undefined && toDay(t.end) !== e) {
        errors.push({ path: `tasks[${i}].end`, message: `does not agree with start and duration (expected ${fromDay(e)})` });
      }
      if (s !== toDay(t.start)) warnings.push({ path: `tasks[${i}].start`, message: `is not a working day; placed on ${fromDay(s)}` });
      Object.assign(p, { start: s, end: e, duration: dur ?? 1, scheduled: true });
    }
    byId.set(t.id, p);
  });

  // Derive summaries bottom-up (iteratively, deepest first).
  const depth = (t: Task) => { let d = 0, c = t.parent; while (c) { d++; c = byId.get(c)?.task.parent ?? null; } return d; };
  const summaries = doc.tasks.filter((t) => t.type === 'summary' || children.has(t.id)).sort((a, b) => depth(b) - depth(a));
  for (const s of summaries) {
    const p = byId.get(s.id)!;
    let start = Infinity, end = -Infinity, weight = 0, done = 0;
    for (const c of children.get(s.id) ?? []) {
      const cp = byId.get(c.id)!;
      if (!cp.scheduled) continue;
      start = Math.min(start, cp.start!); end = Math.max(end, cp.end!);
      const w = Math.max(cp.duration ?? 0, c.type === 'milestone' ? 0 : 1);
      weight += w; done += w * cp.progress;
    }
    if (start !== Infinity) {
      Object.assign(p, { start, end, scheduled: true, duration: calendar.workingDaysBetween(start, end), progress: weight ? done / weight : 0 });
    }
  }

  let span: Placement['span'];
  for (const p of byId.values()) if (p.scheduled) {
    span = span ? { start: Math.min(span.start, p.start!), end: Math.max(span.end, p.end!) } : { start: p.start!, end: p.end! };
  }
  return { byId, calendar, warnings, errors, span };
}
