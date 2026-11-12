import type { Issue, RoadmapDocument } from '@gantt/contract';
import { buildCalendars, WorkCalendar } from './calendar.ts';
import { place, type Placement, type PlacedTask } from './schedule.ts';

/**
 * A placement in transferable form: one slot per task, in document order. Typed arrays move between a
 * worker and the main thread without copying, so only the document itself is cloned (C11).
 */
export interface CompactPlacement {
  start: Float64Array; end: Float64Array; duration: Float64Array; progress: Float64Array;
  /** 1 when scheduled. */
  scheduled: Uint8Array;
  span?: { start: number; end: number };
  /** Rare extras, by task index: pieces of split tasks and partial last days of hour tasks (D12, G4). */
  extra: Record<number, { segments?: [number, number][]; endFraction?: number }>;
  errors: Issue[]; warnings: Issue[];
}

/** Places the roadmap and packs the result into typed arrays, so the worker can transfer it without copying. */
export function placeCompact(doc: RoadmapDocument): CompactPlacement {
  const p = place(doc);
  const n = doc.tasks.length;
  const c: CompactPlacement = {
    start: new Float64Array(n), end: new Float64Array(n), duration: new Float64Array(n), progress: new Float64Array(n),
    scheduled: new Uint8Array(n), span: p.span, errors: p.errors, warnings: p.warnings, extra: {},
  };
  doc.tasks.forEach((t, i) => {
    const x = p.byId.get(t.id)!;
    c.progress[i] = x.progress;
    if (x.scheduled) { c.scheduled[i] = 1; c.start[i] = x.start!; c.end[i] = x.end!; c.duration[i] = x.duration ?? 0; }
    if (x.segments || x.endFraction !== undefined) c.extra[i] = { segments: x.segments, endFraction: x.endFraction };
  });
  return c;
}

/** The array buffers of a compact placement, passed as the transfer list of `postMessage`. */
export const transferList = (c: CompactPlacement): ArrayBuffer[] =>
  [c.start, c.end, c.duration, c.progress, c.scheduled].map((a) => a.buffer as ArrayBuffer);

/** Rebuilds a full Placement from the compact form against the same document. */
export function expandPlacement(doc: RoadmapDocument, c: CompactPlacement): Placement {
  const cals = buildCalendars(doc.calendars);
  const calendar = (doc.roadmap.defaultCalendar && cals.get(doc.roadmap.defaultCalendar)) || new WorkCalendar();
  const byId = new Map<string, PlacedTask>();
  doc.tasks.forEach((task, i) => {
    byId.set(task.id, c.scheduled[i]
      ? { task, start: c.start[i], end: c.end[i], duration: c.duration[i], progress: c.progress[i]!, scheduled: true, ...c.extra[i] }
      : { task, progress: c.progress[i]!, scheduled: false });
  });
  return { byId, calendar, errors: c.errors, warnings: c.warnings, span: c.span };
}
