import { describe, expect, it } from 'vitest';
import type { RoadmapDocument } from '@gantt/contract';
import { applyChanges, changesBetween } from './index.ts';

// Regression test for ISSUES.md issue 6.
const base = { contract: 'gantt-roadmap/1', roadmap: { id: 'r', name: 'r', version: 1, timeZone: 'UTC', start: '2026-11-02' } } as const;

describe('review fixes: restoring a version', () => {
  it('keeps a task that moves out of a deleted parent, with its links (issue 6)', () => {
    const now: RoadmapDocument = { ...base, tasks: [
      { id: 'p', name: 'P', type: 'summary', parent: null },
      { id: 'x', name: 'X', type: 'task', parent: 'p', start: '2026-11-02', duration: 2 },
      { id: 'y', name: 'Y', type: 'task', parent: null, start: '2026-11-05', duration: 1 },
    ], links: [{ id: 'l', source: 'x', target: 'y', type: 'FS' }] };
    const old: RoadmapDocument = { ...base, tasks: [
      { id: 'x', name: 'X', type: 'task', parent: null, start: '2026-11-02', duration: 2 },
      { id: 'y', name: 'Y', type: 'task', parent: null, start: '2026-11-05', duration: 1 },
    ], links: [{ id: 'l', source: 'x', target: 'y', type: 'FS' }] };
    const changes = changesBetween(now, old).map((c) => ({ ...c, by: 'u', at: '2026-11-02T00:00:00Z' }));
    const r = applyChanges(now, changes);
    if (!r.ok) throw new Error(r.reason);
    expect(r.doc.tasks.map((t) => [t.id, t.parent ?? null])).toEqual([['x', null], ['y', null]]);
    expect(r.doc.links.map((l) => l.id)).toEqual(['l']);
  });
});
