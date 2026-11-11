import type { RoadmapDocument } from '@gantt/contract';
import { expandPlacement, place, type CompactPlacement, type Placement } from '@gantt/engine';

/**
 * Places a roadmap's tasks in a shared Web Worker. Falls back to the main thread where workers are
 * unavailable (tests, server rendering) or the worker fails to start.
 */
let worker: Worker | null | undefined;
let seq = 0;
const pending = new Map<number, { resolve: (p: CompactPlacement) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    if (typeof Worker === 'undefined') return (worker = null);
    worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; placement?: CompactPlacement; error?: string }>) => {
      const p = pending.get(e.data.id); if (!p) return;
      pending.delete(e.data.id);
      e.data.ok ? p.resolve(e.data.placement!) : p.reject(new Error(e.data.error));
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
