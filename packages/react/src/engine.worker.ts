/// <reference lib="webworker" />
// Runs the scheduling engine off the main thread (C11). The engine package itself knows nothing about workers.
import { placeCompact, transferList } from '@gantt/engine';
import type { RoadmapDocument } from '@gantt/contract';

self.onmessage = (e: MessageEvent<{ id: number; doc: RoadmapDocument }>) => {
  try {
    const c = placeCompact(e.data.doc);
    (self as unknown as Worker).postMessage({ id: e.data.id, ok: true, placement: c }, transferList(c));
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: e.data.id, ok: false, error: String(err) });
  }
};
