import { describe, expect, it } from 'vitest';
import type { Link, RoadmapDocument, Task } from '@gantt/contract';
import { applySchedule, fromDay, schedule, toDay, whyNotLink, WorkCalendar } from './index.ts';
import { generate } from '../../mock/src/generate.ts';

const doc = (tasks: Task[], links: Link[]): RoadmapDocument => ({
  contract: 'gantt-roadmap/1', roadmap: { id: 'r', name: 'r', version: 1, timeZone: 'UTC', start: '2026-11-02' }, tasks, links,
});
const T = (id: string, start: string, duration: number, extra: Partial<Task> = {}): Task => ({ id, name: id.toUpperCase(), type: 'task', parent: null, start, duration, ...extra });
const startOf = (r: ReturnType<typeof schedule>, id: string) => fromDay(r.tasks.get(id)!.start);
const endOf = (r: ReturnType<typeof schedule>, id: string) => fromDay(r.tasks.get(id)!.end);

describe('dependency types with lag (C1)', () => {
  // A: Mon 2 Nov – Wed 4 Nov (3 days).
  const a = T('a', '2026-11-02', 3);
  it('FS: B starts the working day after A ends, plus lag', () => {
    expect(startOf(schedule(doc([a, T('b', '2026-11-02', 2)], [{ id: 'l', source: 'a', target: 'b', type: 'FS' }])), 'b')).toBe('2026-11-05');
    expect(startOf(schedule(doc([a, T('b', '2026-11-02', 2)], [{ id: 'l', source: 'a', target: 'b', type: 'FS', lag: 2 }])), 'b')).toBe('2026-11-09');
  });
  it('SS: B starts when A starts, plus lag', () => {
    expect(startOf(schedule(doc([a, T('b', '2026-11-02', 2)], [{ id: 'l', source: 'a', target: 'b', type: 'SS', lag: 1 }])), 'b')).toBe('2026-11-03');
  });
  it('FF: B finishes when A finishes', () => {
    const r = schedule(doc([a, T('b', '2026-11-02', 2)], [{ id: 'l', source: 'a', target: 'b', type: 'FF' }]));
    expect(endOf(r, 'b')).toBe('2026-11-04');
    expect(startOf(r, 'b')).toBe('2026-11-03');
  });
  it('SF: B finishes by the day before A starts at the earliest', () => {
    const r = schedule(doc([T('a', '2026-11-09', 3), T('b', '2026-11-02', 2)], [{ id: 'l', source: 'a', target: 'b', type: 'SF' }]));
    expect(endOf(r, 'b')).toBe('2026-11-06');
  });
  it('negative lag lets B overlap A', () => {
    expect(startOf(schedule(doc([a, T('b', '2026-11-02', 2)], [{ id: 'l', source: 'a', target: 'b', type: 'FS', lag: -1 }])), 'b')).toBe('2026-11-04');
  });
  it('a successor follows its predecessor earlier too, but an unlinked task keeps its start (C10)', () => {
    const r = schedule(doc([a, T('b', '2026-11-20', 2), T('c', '2026-11-16', 1)], [{ id: 'l', source: 'a', target: 'b', type: 'FS' }]));
    expect(startOf(r, 'b')).toBe('2026-11-05');
    expect(startOf(r, 'c')).toBe('2026-11-16');
  });
  it('honours the roadmap start and SNET constraints, and reports deadlines', () => {
    const r = schedule(doc([T('x', '2026-10-01', 2), T('y', '2026-11-02', 2, { constraint: { type: 'SNET', date: '2026-11-10' }, deadline: '2026-11-10' })], []));
    expect(startOf(r, 'x')).toBe('2026-11-02');
    expect(startOf(r, 'y')).toBe('2026-11-10');
    expect(r.issues).toContainEqual(expect.objectContaining({ kind: 'deadline', taskId: 'y', by: 1 }));
  });
  it('a manual task keeps its dates and the broken dependency is reported', () => {
    const r = schedule(doc([a, T('m', '2026-11-03', 1, { mode: 'manual' })], [{ id: 'l', source: 'a', target: 'm', type: 'FS' }]));
    expect(startOf(r, 'm')).toBe('2026-11-03');
    expect(r.issues).toContainEqual(expect.objectContaining({ kind: 'brokenDependency', linkId: 'l', by: 2 }));
  });
  it('a dependency into a summary moves its children; one from a summary uses its span', () => {
    const tasks: Task[] = [a, { id: 's', name: 'S', type: 'summary', parent: null }, T('c1', '2026-11-02', 1, { parent: 's' }), T('c2', '2026-11-03', 2, { parent: 's' }), T('z', '2026-11-02', 1)];
    const r = schedule(doc(tasks, [{ id: 'l1', source: 'a', target: 's', type: 'FS' }, { id: 'l2', source: 's', target: 'z', type: 'FS' }]));
    expect(startOf(r, 'c1')).toBe('2026-11-05');
    expect(startOf(r, 'c2')).toBe('2026-11-05');
    expect(startOf(r, 'z')).toBe('2026-11-09');
  });
});

describe('critical path (C2)', () => {
  it('marks the longest chain critical and gives the others slack', () => {
    const r = schedule(doc([T('a', '2026-11-02', 5), T('b', '2026-11-02', 2), T('c', '2026-11-02', 3)],
      [{ id: 'l1', source: 'a', target: 'c', type: 'FS' }, { id: 'l2', source: 'b', target: 'c', type: 'FS' }]));
    expect(r.tasks.get('a')!.critical).toBe(true);
    expect(r.tasks.get('c')!.critical).toBe(true);
    expect(r.tasks.get('b')!.slack).toBe(3);
    expect(r.tasks.get('c')!.drivenBy).toBe('l1');
  });
});

describe('cycles and invalid links (C9)', () => {
  const d = doc([T('a', '2026-11-02', 1), T('b', '2026-11-02', 1), T('c', '2026-11-02', 1)], [{ id: 'l1', source: 'a', target: 'b', type: 'FS' }, { id: 'l2', source: 'b', target: 'c', type: 'FS' }]);
  it('refuses a link that would close a cycle, with the path', () => {
    expect(whyNotLink(d, 'c', 'a')).toMatch(/cycle: (A|B|C) → .* → /);
    expect(whyNotLink(d, 'a', 'a')).toBe('A task cannot depend on itself');
    expect(whyNotLink(d, 'a', 'b')).toBe('A already links to B');
    expect(whyNotLink(d, 'a', 'c')).toBeNull();
  });
  it('detects a cycle through a summary', () => {
    const s = doc([{ id: 's', name: 'S', type: 'summary', parent: null }, T('k', '2026-11-02', 1, { parent: 's' }), T('t', '2026-11-02', 1)],
      [{ id: 'l1', source: 'k', target: 't', type: 'FS' }, { id: 'l2', source: 't', target: 's', type: 'FS' }]);
    const r = schedule(s);
    expect(r.cycle).toBeDefined();
    expect(r.issues[0]!.message).toMatch(/cycle/);
  });
});

describe('properties over random roadmaps', () => {
  const cal = new WorkCalendar();
  for (let seed = 1; seed <= 40; seed++) {
    it(`seed ${seed}: no successor starts before its dependency allows, and scheduling twice changes nothing`, () => {
      const g = generate({ tasks: 120 + seed * 7, depth: 1 + (seed % 3), linkDensity: 0.8, seed });
      let s = seed;
      const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
      const types = ['FS', 'SS', 'FF', 'SF'] as const;
      g.links = g.links.map((l) => ({ ...l, type: types[Math.floor(rnd() * 4)]!, lag: Math.floor(rnd() * 7) - 2 }));
      const r = schedule(g);
      expect(r.cycle).toBeUndefined();
      const sch = applySchedule(g, r);
      const r2 = schedule(sch);
      expect(r2.changes).toEqual([]);
      const tasks = new Map(sch.tasks.map((t) => [t.id, t]));
      const leaf = (id: string) => !sch.tasks.some((t) => t.parent === id);
      for (const l of sch.links) {
        const a = r2.tasks.get(l.source), b = r2.tasks.get(l.target);
        if (!a || !b || !leaf(l.target) || tasks.get(l.target)!.mode === 'manual') continue;
        const pm = tasks.get(l.source)!.type === 'milestone', sm = tasks.get(l.target)!.type === 'milestone';
        const lag = l.lag ?? 0;
        if (l.type === 'FS') expect(b.start).toBeGreaterThanOrEqual(cal.shift(a.end, pm || sm ? lag : 1 + lag));
        if (l.type === 'SS') expect(b.start).toBeGreaterThanOrEqual(cal.shift(a.start, lag));
        if (l.type === 'FF') expect(b.end).toBeGreaterThanOrEqual(cal.shift(a.end, lag));
        if (l.type === 'SF') expect(b.end).toBeGreaterThanOrEqual(cal.shift(a.start, lag - 1));
        expect(b.start).toBeGreaterThanOrEqual(toDay(sch.roadmap.start));
      }
    });
  }
});

describe('performance (Phase 4 done criterion)', () => {
  it('recalculates the 10,000-task benchmark in well under 500 ms', () => {
    const g = generate({ tasks: 10000, linkDensity: 0.55, laneEvery: 3 });
    schedule(g);
    const t = performance.now();
    const r = schedule(g);
    const ms = performance.now() - t;
    expect(r.cycle).toBeUndefined();
    expect(ms).toBeLessThan(250);
  });
});
