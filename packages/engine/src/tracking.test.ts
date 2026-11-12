import { describe, expect, it } from 'vitest';
import type { RoadmapDocument, Task } from '@gantt/contract';
import { generate } from '../../mock/src/generate.ts';
import { place, progressLine, sCurve, takeBaseline, toDay } from './index.ts';

const doc = (tasks: Task[]): RoadmapDocument => ({ contract: 'gantt-roadmap/1', roadmap: { id: 'r', name: 'r', version: 3, timeZone: 'UTC', start: '2026-11-02' }, tasks, links: [] });
const T = (id: string, start: string, duration: number, progress: number, extra: Partial<Task> = {}): Task => ({ id, name: id, type: 'task', parent: null, start, duration, progress, ...extra });

describe('tracking (B1–B3)', () => {
  // Mon 2 – Fri 6 Nov (5 days) and Mon 9 – Fri 13 Nov (5 days); status Wed 4 Nov (3 of 5 days planned on a).
  const d = doc([T('a', '2026-11-02', 5, 0.8), T('b', '2026-11-09', 5, 0.2), T('c', '2026-11-02', 5, 0.2)]);
  const p = place(d);
  const status = toDay('2026-11-04');
  it('a baseline snapshots dates and work without changing the plan', () => {
    const b = takeBaseline(p, { id: 'b1', name: 'Plan', version: 3, savedAt: '', savedBy: 'x' });
    expect(b.tasks.find((t) => t.id === 'a')).toEqual({ id: 'a', start: '2026-11-02', end: '2026-11-06', work: 5 });
  });
  it('the progress line marks tasks ahead, behind and on track', () => {
    const l = progressLine(p, status);
    expect(l.get('a')!.status).toBe('ahead');   // 80 % done, 60 % expected
    expect(l.get('c')!.status).toBe('behind');  // 20 % done, 60 % expected: 2 days behind
    expect(l.get('c')!.variance).toBeCloseTo(-2);
    expect(l.get('b')!.status).toBe('ahead');   // started early
  });
  it('S-curve totals match the data: planned work, earned work, baseline work', () => {
    const b = takeBaseline(place(doc([T('a', '2026-11-02', 4, 0), T('b', '2026-11-09', 5, 0), T('c', '2026-11-02', 5, 0)])), { id: 'b', name: 'b', version: 1, savedAt: '', savedBy: '' });
    const s = sCurve(p, status, b);
    expect(s.totals).toEqual({ planned: 15, actual: 5 * 0.8 + 5 * 0.2 + 5 * 0.2, baseline: 14 });
    expect(s.planned.at(-1)).toBeCloseTo(15);
    expect(s.baseline!.at(-1)).toBeCloseTo(14);
    const i = s.days.indexOf(status);
    expect(s.actual[i]).toBeCloseTo(6);       // all earned work is in by the status date
    expect(s.actual[i + 1]).toBeNull();
    // Monotonic.
    for (let k = 1; k < s.planned.length; k++) expect(s.planned[k]!).toBeGreaterThanOrEqual(s.planned[k - 1]!);
  });
  it('totals match on a large generated roadmap', () => {
    const g = generate({ tasks: 2000, linkDensity: 0.3 });
    const pl = place(g);
    const s = sCurve(pl, toDay(g.roadmap.statusDate ?? g.roadmap.start));
    const parents = new Set(g.tasks.map((t) => t.parent).filter(Boolean));
    const leaves = [...pl.byId.values()].filter((x) => x.scheduled && !parents.has(x.task.id) && x.task.type !== 'summary' && x.task.type !== 'milestone');
    expect(s.totals.planned).toBeCloseTo(leaves.reduce((a, x) => a + (x.duration ?? 0), 0));
    expect(s.planned.at(-1)).toBeCloseTo(s.totals.planned, 6);
    expect(s.totals.actual).toBeCloseTo(leaves.reduce((a, x) => a + (x.duration ?? 0) * x.progress, 0));
  });
});
