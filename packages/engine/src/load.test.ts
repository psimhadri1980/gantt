import { describe, expect, it } from 'vitest';
import type { RoadmapDocument, Task } from '@gantt/contract';
import { applySchedule, levelResources, place, resourceLoad, schedule, toDay } from './index.ts';

const doc = (tasks: Task[], extra: Partial<RoadmapDocument> = {}): RoadmapDocument => ({
  contract: 'gantt-roadmap/1', roadmap: { id: 'r', name: 'r', version: 1, timeZone: 'UTC', start: '2026-11-02' }, tasks, links: [], ...extra,
});
const T = (id: string, start: string, duration: number, extra: Partial<Task> = {}): Task => ({ id, name: id, type: 'task', parent: null, start, duration, ...extra });

describe('default demand without resource data (E7)', () => {
  const d = doc([T('a', '2026-11-02', 5, { owner: 'ann' }), T('b', '2026-11-04', 5, { owner: 'ann' }), T('c', '2026-11-09', 2)]);
  it('every task counts as 1 FTE per working day: a total and a row per owner', () => {
    const l = resourceLoad(d, place(d), { period: 'week' });
    expect(l.defaultDemand).toBe(true);
    expect(l.rows.map((r) => r.label)).toEqual(['Total demand', 'ann']);
    expect(l.rows[0]!.buckets.map((b) => b.demand)).toEqual([8, 4]); // week 1: 5 + 3; week 2: 2 (b) + 2 (c)
    expect(l.rows[0]!.buckets.every((b) => b.capacity === null && b.overDays === 0)).toBe(true); // no capacity, no over-allocation
  });
  it('over-allocation shows only against a roadmap default capacity', () => {
    const d2 = { ...d, roadmap: { ...d.roadmap, defaultCapacityFte: 1 } };
    const ann = resourceLoad(d2, place(d2), { period: 'week' }).rows.find((r) => r.label === 'ann')!;
    expect(ann.buckets[0]).toMatchObject({ demand: 8, capacity: 5, overDays: 3 }); // Wed–Fri both tasks
  });
});

describe('load per resource with capacity and calendars (E3, E4, E5)', () => {
  const resources = [{ id: 'p', name: 'Pat', capacityFte: 1 }, { id: 'q', name: 'Quinn', capacityFte: 0.5, calendar: 'mtw' }];
  const calendars = [{ id: 'mtw', name: 'Mon–Wed', workingDays: [1, 2, 3] }];
  const d = doc([
    T('a', '2026-11-02', 5, { resources: [{ id: 'p', allocation: 1 }] }),
    T('b', '2026-11-04', 2, { resources: [{ id: 'p', allocation: 0.5 }, { id: 'q', allocation: 0.5 }] }),
    T('c', '2026-11-02', 1),
  ], { resources, calendars });
  it('rows per resource, with an Unassigned row; capacity follows the resource calendar', () => {
    const l = resourceLoad(d, place(d), { period: 'week' });
    expect(l.defaultDemand).toBe(false);
    expect(l.rows.map((r) => `${r.label}:${r.buckets[0]!.demand}/${r.buckets[0]!.capacity}`)).toEqual(['Pat:6/5', 'Quinn:1/1.5', 'Unassigned:1/null']);
    expect(l.rows[0]!.buckets[0]!.overDays).toBe(2); // Wed, Thu: 1.5 FTE on Pat
    expect(l.rows[1]!.buckets[0]!.overDays).toBe(1); // Thu is not a working day for Quinn
  });
});

describe('resource levelling (E6)', () => {
  it('delays tasks until no resource is over-allocated, keeping dependencies', () => {
    const d = doc([
      T('a', '2026-11-02', 3, { resources: [{ id: 'p', allocation: 1 }] }),
      T('b', '2026-11-02', 2, { resources: [{ id: 'p', allocation: 1 }] }),
      T('c', '2026-11-02', 1),
    ], { resources: [{ id: 'p', name: 'Pat', capacityFte: 1 }], links: [{ id: 'l', source: 'b', target: 'c', type: 'FS' }] });
    const r = levelResources(d);
    expect(r.unresolved).toEqual([]);
    const after = { ...d, tasks: d.tasks.map((t) => { const ch = r.changes.find((c) => c.id === t.id); return ch ? Object.fromEntries(Object.entries({ ...t, ...ch.fields }).filter(([, v]) => v !== null)) as Task : t; }) };
    const l = resourceLoad(after, place(after), { period: 'day' });
    expect(l.rows[0]!.buckets.every((b) => b.overDays === 0)).toBe(true);
    const s = schedule(after);
    expect(s.issues).toEqual([]);
    expect(s.changes).toEqual([]); // already consistent
    expect(applySchedule(after, s)).toBe(after);
    expect(toDay(after.tasks.find((t) => t.id === 'b')!.start!)).toBeGreaterThan(toDay('2026-11-02'));
  });
});
