import { describe, expect, it } from 'vitest';
import type { Link, RoadmapDocument, Task } from '@gantt/contract';
import { schedule } from './index.ts';

// Regression test for ISSUES.md issue 4.
const doc = (tasks: Task[], links: Link[]): RoadmapDocument => ({
  contract: 'gantt-roadmap/1', roadmap: { id: 'r', name: 'r', version: 1, timeZone: 'UTC', start: '2026-11-02' }, tasks, links,
});

describe('review fixes: summary start links', () => {
  it('an SS link from a summary does not make its subtasks finish by the successor start (issue 4)', () => {
    const r = schedule(doc([
      { id: 's', name: 'S', type: 'summary', parent: null },
      { id: 'a', name: 'A', type: 'task', parent: 's', start: '2026-11-02', duration: 5 },
      { id: 'b', name: 'B', type: 'task', parent: null, start: '2026-11-02', duration: 10 },
    ], [{ id: 'l', source: 's', target: 'b', type: 'SS' }]));
    expect(r.tasks.get('a')!.slack).toBeGreaterThanOrEqual(0);
  });
});

describe('review fixes: hour leads (audit 6)', () => {
  it('a lead shorter than a day still overlaps by a day', () => {
    const r = schedule(doc([
      { id: 'a', name: 'A', type: 'task', parent: null, start: '2026-11-02', duration: 3 },
      { id: 'b', name: 'B', type: 'task', parent: null, start: '2026-11-02', duration: 1 },
    ], [{ id: 'l', source: 'a', target: 'b', type: 'FS', lag: -4, lagUnit: 'hour' }]));
    expect(r.tasks.get('b')!.start).toBe(r.tasks.get('a')!.end);
  });
});
