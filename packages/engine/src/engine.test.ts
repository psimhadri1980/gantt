import { describe, expect, it } from 'vitest';
import { fromDay, toDay, weekday, WorkCalendar, place } from './index.ts';
import type { RoadmapDocument } from '@gantt/contract';

describe('working-time calendar', () => {
  const cal = new WorkCalendar({ id: 'c', name: 'c', workingDays: [1, 2, 3, 4, 5], holidays: ['2026-12-25'] });
  it('round-trips dates and knows weekdays', () => {
    expect(fromDay(toDay('2026-11-11'))).toBe('2026-11-11');
    expect(weekday(toDay('2026-11-11'))).toBe(3); // Wednesday
  });
  it('a 5-working-day task spanning a weekend ends on the correct date', () => {
    expect(fromDay(cal.endOf(toDay('2026-11-12'), 5))).toBe('2026-11-18'); // Thu → next Wed
  });
  it('skips holidays', () => {
    expect(fromDay(cal.endOf(toDay('2026-12-24'), 2))).toBe('2026-12-28');
  });
  it('a milestone ends on its start', () => {
    expect(fromDay(cal.endOf(toDay('2026-11-16'), 0))).toBe('2026-11-16');
  });
});

describe('place', () => {
  const doc: RoadmapDocument = {
    contract: 'gantt-roadmap/1',
    roadmap: { id: 'r', name: 'r', version: 1, timeZone: 'UTC', start: '2026-11-02' },
    tasks: [
      { id: 's', name: 'S', type: 'summary', parent: null },
      { id: 'a', name: 'A', type: 'task', parent: 's', start: '2026-11-02', duration: 10, progress: 1 },
      { id: 'b', name: 'B', type: 'task', parent: 's', start: '2026-11-16', duration: 10, progress: 0 },
      { id: 'u', name: 'U', type: 'task', parent: null },
    ],
    links: [],
  };
  it('derives summary span and progress from children', () => {
    const p = place(doc);
    const s = p.byId.get('s')!;
    expect(fromDay(s.start!)).toBe('2026-11-02');
    expect(fromDay(s.end!)).toBe('2026-11-27');
    expect(s.progress).toBeCloseTo(0.5);
    expect(p.byId.get('u')!.scheduled).toBe(false);
  });
  it('reports an end that disagrees with start and duration', () => {
    const bad = { ...doc, tasks: [{ id: 'x', name: 'X', type: 'task' as const, parent: null, start: '2026-11-02', duration: 5, end: '2026-11-05' }] };
    expect(place(bad).errors[0]?.message).toMatch(/2026-11-06/);
  });
});

import { expandPlacement, placeCompact } from './index.ts';
describe('compact placement', () => {
  it('round-trips to the same placement', () => {
    const doc: RoadmapDocument = {
      contract: 'gantt-roadmap/1', roadmap: { id: 'r', name: 'r', version: 1, timeZone: 'UTC', start: '2026-11-02' },
      tasks: [{ id: 's', name: 'S', type: 'summary', parent: null }, { id: 'a', name: 'A', type: 'task', parent: 's', start: '2026-11-02', duration: 3, progress: 0.5 }, { id: 'u', name: 'U', type: 'task', parent: null }],
      links: [],
    };
    const direct = place(doc), round = expandPlacement(doc, placeCompact(doc));
    for (const id of ['s', 'a', 'u']) {
      const { task: _a, ...x } = direct.byId.get(id)!; const { task: _b, ...y } = round.byId.get(id)!;
      expect(y).toEqual(x);
    }
    expect(round.span).toEqual(direct.span);
  });
});
