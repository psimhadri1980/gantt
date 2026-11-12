import { describe, expect, it } from 'vitest';
import type { Link, RoadmapDocument, Task } from '@gantt/contract';
import { fixesFor, fromDay, place, schedule, type IssueFix } from './index.ts';

/** Phase 7: every constraint type, deadlines, modes, task calendars, splits, hours, and fixes (C3–C8, D12, G4). */
const doc = (tasks: Task[], links: Link[] = [], extra: Partial<RoadmapDocument> = {}): RoadmapDocument => ({
  contract: 'gantt-roadmap/1', roadmap: { id: 'r', name: 'r', version: 1, timeZone: 'UTC', start: '2026-11-02' }, tasks, links, ...extra,
});
const T = (id: string, start: string, duration: number, extra: Partial<Task> = {}): Task => ({ id, name: id.toUpperCase(), type: 'task', parent: null, start, duration, ...extra });
const s = (r: ReturnType<typeof schedule>, id: string) => fromDay(r.tasks.get(id)!.start);
const e = (r: ReturnType<typeof schedule>, id: string) => fromDay(r.tasks.get(id)!.end);
// A: Mon 2 – Wed 4 Nov; B follows (FS), 2 days.
const a = T('a', '2026-11-02', 3);
const fs: Link = { id: 'l', source: 'a', target: 'b', type: 'FS' };

/** Applies a fix to a document the way the data operations would (null removes a field). */
function apply(d: RoadmapDocument, f: IssueFix): RoadmapDocument {
  let tasks = d.tasks, links = d.links;
  for (const op of f.ops) {
    if (op.type === 'link.delete') links = links.filter((l) => l.id !== op.id);
    else tasks = tasks.map((t) => (t.id === op.id ? Object.fromEntries(Object.entries({ ...t, ...op.fields }).filter(([, v]) => v !== null && v !== undefined)) as Task : t));
  }
  return { ...d, tasks, links };
}

describe('constraint types (C3)', () => {
  it('ASAP: as soon as the dependency allows', () => {
    expect(s(schedule(doc([a, T('b', '2026-11-20', 2, { constraint: { type: 'ASAP' } })], [fs])), 'b')).toBe('2026-11-05');
  });
  it('SNET: not before the date', () => {
    expect(s(schedule(doc([a, T('b', '2026-11-02', 2, { constraint: { type: 'SNET', date: '2026-11-10' } })], [fs])), 'b')).toBe('2026-11-10');
  });
  it('FNET: finishes no earlier than the date', () => {
    expect(e(schedule(doc([a, T('b', '2026-11-02', 2, { constraint: { type: 'FNET', date: '2026-11-13' } })], [fs])), 'b')).toBe('2026-11-13');
  });
  it('MSO: starts on the date, and a dependency it breaks is reported', () => {
    const r = schedule(doc([a, T('b', '2026-11-02', 2, { constraint: { type: 'MSO', date: '2026-11-03' } })], [fs]));
    expect(s(r, 'b')).toBe('2026-11-03');
    expect(r.issues.map((i) => i.kind)).toEqual(['brokenDependency']);
  });
  it('MFO: finishes on the date', () => {
    expect(e(schedule(doc([a, T('b', '2026-11-02', 2, { constraint: { type: 'MFO', date: '2026-11-17' } })], [fs])), 'b')).toBe('2026-11-17');
  });
  it('SNLT: reported when the start is later', () => {
    const r = schedule(doc([a, T('b', '2026-11-02', 2, { constraint: { type: 'SNLT', date: '2026-11-04' } })], [fs]));
    expect(r.issues[0]).toMatchObject({ kind: 'constraint', taskId: 'b', by: 1, suggest: '2026-11-05' });
  });
  it('FNLT: reported when the finish is later', () => {
    const r = schedule(doc([a, T('b', '2026-11-02', 2, { constraint: { type: 'FNLT', date: '2026-11-05' } })], [fs]));
    expect(r.issues[0]).toMatchObject({ kind: 'constraint', taskId: 'b', by: 1, suggest: '2026-11-06' });
  });
});

describe('deadlines and modes (C4, C6)', () => {
  it('a missed deadline is a late warning with the working days late', () => {
    const r = schedule(doc([a, T('b', '2026-11-02', 2, { deadline: '2026-11-04' })], [fs]));
    expect(r.issues[0]).toMatchObject({ kind: 'deadline', by: 2 });
  });
  it('a manual task keeps its dates and reports the dependency it breaks', () => {
    const r = schedule(doc([a, T('b', '2026-11-03', 2, { mode: 'manual' })], [fs]));
    expect(s(r, 'b')).toBe('2026-11-03');
    expect(r.issues[0]!.kind).toBe('brokenDependency');
    expect(r.changes).toEqual([]);
  });
  it('an inactive task is ignored by the schedule', () => {
    const r = schedule(doc([T('a', '2026-11-02', 30, { mode: 'inactive' }), T('b', '2026-11-02', 2)], [fs]));
    expect(r.tasks.has('a')).toBe(false);
    expect(s(r, 'b')).toBe('2026-11-02');
  });
});

describe('task calendars, splits and hours (C8, D12, G4)', () => {
  const sixDay = { id: 'six', name: 'Mon–Sat', workingDays: [1, 2, 3, 4, 5, 6], hoursPerDay: 8 };
  it('a task uses its own calendar', () => {
    const d = doc([T('x', '2026-11-05', 3, { calendar: 'six' })], [], { calendars: [sixDay] });
    expect(e(schedule(d), 'x')).toBe('2026-11-07'); // Thu, Fri, Sat
    expect(fromDay(place(d).byId.get('x')!.end!)).toBe('2026-11-07');
  });
  it('a split task pauses and finishes later; successors follow the end', () => {
    const d = doc([T('x', '2026-11-02', 4, { splits: [{ after: 2, gap: 3 }] }), T('y', '2026-11-02', 1)], [{ id: 'l', source: 'x', target: 'y', type: 'FS' }]);
    const p = place(d).byId.get('x')!;
    expect(p.segments!.map(([a1, b1]) => `${fromDay(a1)}..${fromDay(b1)}`)).toEqual(['2026-11-02..2026-11-03', '2026-11-09..2026-11-10']);
    expect(s(schedule(d), 'y')).toBe('2026-11-11');
  });
  it('an hour task uses part of its last day', () => {
    const p = place(doc([T('h', '2026-11-02', 12, { durationUnit: 'hour' })])).byId.get('h')!;
    expect(fromDay(p.end!)).toBe('2026-11-03');
    expect(p.endFraction).toBe(0.5);
    const q = place(doc([T('h', '2026-11-02', 2, { durationUnit: 'hour' })])).byId.get('h')!;
    expect(q.end).toBe(q.start); expect(q.endFraction).toBe(0.25);
  });
});

describe('conflict fixes (C5)', () => {
  const cases: [string, RoadmapDocument][] = [
    ['broken dependency (manual)', doc([a, T('b', '2026-11-03', 2, { mode: 'manual' })], [fs])],
    ['broken dependency (must start on)', doc([a, T('b', '2026-11-02', 2, { constraint: { type: 'MSO', date: '2026-11-03' } })], [fs])],
    ['start no later than', doc([a, T('b', '2026-11-02', 2, { constraint: { type: 'SNLT', date: '2026-11-04' } })], [fs])],
    ['finish no later than', doc([a, T('b', '2026-11-02', 2, { constraint: { type: 'FNLT', date: '2026-11-05' } })], [fs])],
    ['deadline', doc([a, T('b', '2026-11-02', 2, { deadline: '2026-11-04' })], [fs])],
    ['cycle', doc([a, T('b', '2026-11-02', 2)], [fs, { id: 'back', source: 'b', target: 'a', type: 'FS' }])],
  ];
  for (const [name, d] of cases) {
    it(`every fix for "${name}" explains itself and removes the issue`, () => {
      const issue = schedule(d).issues[0]!;
      const fixes = fixesFor(d, issue);
      expect(fixes.length).toBeGreaterThan(0);
      for (const f of fixes) {
        expect(f.label.length).toBeGreaterThan(5);
        const after = schedule(apply(d, f));
        expect(after.cycle).toBeUndefined();
        expect(after.issues.filter((i) => i.kind === issue.kind && (i.taskId === issue.taskId || issue.kind === 'cycle'))).toEqual([]);
      }
    });
  }
});
