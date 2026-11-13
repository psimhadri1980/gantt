import { describe, expect, it } from 'vitest';
import type { RoadmapDocument } from '@gantt/contract';
import { applyDataOperation, type DataOperation } from './index.ts';

// Regression test for ISSUES.md issue 5.
const run = (d: RoadmapDocument, op: DataOperation) => { const r = applyDataOperation(d, op); if ('error' in r) throw new Error(r.error); return r; };

describe('review fixes: undo of a delete', () => {
  it('restores a subtree whose subtask is listed before its parent (issue 5)', () => {
    const doc: RoadmapDocument = {
      contract: 'gantt-roadmap/1', roadmap: { id: 'r', name: 'r', version: 1, timeZone: 'UTC', start: '2026-11-02' },
      tasks: [
        { id: 'x', name: 'X', type: 'task', parent: 'p', start: '2026-11-02', duration: 2 },
        { id: 'p', name: 'P', type: 'summary', parent: null },
        { id: 'y', name: 'Y', type: 'task', parent: null, start: '2026-11-02', duration: 1 },
      ],
      links: [{ id: 'l', source: 'x', target: 'y', type: 'FS' }],
    };
    const del = run(doc, { type: 'task.delete', id: 'p' });
    const back = run(del.doc, { type: 'batch', ops: del.inverse });
    expect(back.doc.tasks).toEqual(doc.tasks);
    expect(back.doc.links).toEqual(doc.links);
  });
});
