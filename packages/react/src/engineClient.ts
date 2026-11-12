import type { RoadmapDocument } from '@gantt/contract';
import { expandPlacement, place, schedule, type CompactPlacement, type Placement, type ScheduleResult, type TaskSchedule } from '@gantt/engine';

/**
 * Places a roadmap's tasks in a shared Web Worker. Falls back to the main thread where workers are
 * unavailable (tests, server rendering) or the worker fails to start.
 */
let worker: Worker | null | undefined;
let seq = 0;
const pending = new Map<number, { resolve: (p: never) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    if (typeof Worker === 'undefined') return (worker = null);
    worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; placement?: CompactPlacement; schedule?: unknown; ms?: number; error?: string }>) => {
      const p = pending.get(e.data.id); if (!p) return;
      pending.delete(e.data.id);
      e.data.ok ? p.resolve((e.data.schedule ? { schedule: e.data.schedule, ms: e.data.ms } : e.data.placement!) as never) : p.reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      e.preventDefault();
      for (const p of pending.values()) p.reject(new Error('engine worker failed'));
      pending.clear(); worker?.terminate(); worker = null;
    };
  } catch { worker = null; }
  return worker;
}

export async function placeOffThread(doc: RoadmapDocument): Promise<Placement> {
  const w = getWorker();
  if (!w) return place(doc);
  const id = ++seq;
  try {
    const c = await new Promise<CompactPlacement>((resolve, reject) => { pending.set(id, { resolve, reject }); w.postMessage({ id, doc }); });
    return expandPlacement(doc, c);
  } catch {
    return place(doc); // worker failed: same engine, main thread
  }
}

/** Runs the scheduling engine in the worker (C11); falls back to the main thread. `ms` is the engine time. */
export async function scheduleOffThread(doc: RoadmapDocument): Promise<{ result: ScheduleResult; ms: number; offThread: boolean }> {
  const w = getWorker();
  if (w) {
    const id = ++seq;
    try {
      const r = await new Promise<{ schedule: Omit<ScheduleResult, 'tasks'> & { tasks: [string, TaskSchedule][] }; ms: number }>((resolve, reject) => {
        pending.set(id, { resolve, reject }); w.postMessage({ id, kind: 'schedule', doc });
      });
      return { result: { ...r.schedule, tasks: new Map(r.schedule.tasks) }, ms: r.ms, offThread: true };
    } catch { /* fall through to the main thread */ }
  }
  const t0 = performance.now();
  const result = schedule(doc);
  return { result, ms: performance.now() - t0, offThread: false };
}
