/// <reference lib="webworker" />
// Runs the scheduling engine off the main thread (C11). The engine package itself knows nothing about workers.
import { placeCompact, schedule, transferList } from '@gantt/engine';
import type { RoadmapDocument } from '@gantt/contract';

self.onmessage = (e: MessageEvent<{ id: number; kind?: 'place' | 'schedule'; doc: RoadmapDocument }>) => {
  const post = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);
  try {
    if (e.data.kind === 'schedule') {
      const t0 = performance.now();
      const r = schedule(e.data.doc);
      post({ id: e.data.id, ok: true, schedule: { ...r, tasks: [...r.tasks] }, ms: performance.now() - t0 });
      return;
    }
    const c = placeCompact(e.data.doc);
    post({ id: e.data.id, ok: true, placement: c }, transferList(c));
  } catch (err) {
    post({ id: e.data.id, ok: false, error: String(err) });
  }
};
