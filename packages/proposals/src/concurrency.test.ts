import { describe, expect, it } from 'vitest';
import type { ProposalChange, RoadmapDocument } from '@gantt/contract';
import { applyChanges, concurrentChanges, effectiveChanges, parallelOverlaps, rebase, refreshOverlaps, undecided, versionOf, type Pick } from './index.ts';

const base: RoadmapDocument = {
  contract: 'gantt-roadmap/1', roadmap: { id: 'r', name: 'r', version: 1, timeZone: 'UTC', start: '2026-11-02' },
  tasks: [
    { id: 'a', name: 'A', type: 'task', parent: null, start: '2026-11-02', duration: 3, owner: 'ann' },
    { id: 'b', name: 'B', type: 'task', parent: null, start: '2026-11-09', duration: 2 },
    { id: 'c', name: 'C', type: 'task', parent: null, start: '2026-11-16', duration: 2 },
  ],
  links: [],
};
let t = 0;
const ch = (by: string, id: string, fields: Record<string, unknown> | null, op: ProposalChange['op'] = 'update'): ProposalChange =>
  ({ entity: 'task', op, id, fields: fields ?? undefined, by, at: new Date(Date.UTC(2026, 10, 2) + ++t * 1000).toISOString() });

describe('concurrent changes inside one Proposal (K7, K9)', () => {
  it('flags two users changing the same field group, not different groups', () => {
    const p = { changes: [ch('alice', 'a', { start: '2026-11-03' }), ch('bob', 'a', { duration: 5 }), ch('bob', 'b', { name: 'B2' }), ch('alice', 'b', { owner: 'x' })] };
    const c = concurrentChanges(p);
    expect(c.map((x) => x.taskId)).toEqual(['a']); // start and duration are both "schedule"; name and owner differ
    expect(c[0]!.groups).toEqual(['schedule']);
    expect(c[0]!.users.sort()).toEqual(['alice', 'bob']);
  });
  it('a delete conflicts with any change by someone else', () => {
    const c = concurrentChanges({ changes: [ch('alice', 'c', { name: 'C!' }), ch('bob', 'c', null, 'delete')] });
    expect(c[0]!.groups).toContain('delete');
  });
  it('one user changing a field twice is not a conflict', () => {
    expect(concurrentChanges({ changes: [ch('alice', 'a', { start: '2026-11-03' }), ch('alice', 'a', { start: '2026-11-04' })] })).toEqual([]);
  });
  it('a pick keeps one version for the task and settles the flag', () => {
    const changes = [ch('alice', 'a', { start: '2026-11-04' }), ch('bob', 'a', { start: '2026-11-05', name: 'A by Bob' })];
    const pick: Pick = { taskId: 'a', keep: 'alice', groups: ['schedule'], by: 'carol', at: '', seq: changes.length };
    const p = { changes, picks: [pick] };
    expect(concurrentChanges(p)).toEqual([]);
    const doc = applyChanges(base, effectiveChanges(p));
    if (!doc.ok) throw new Error(doc.reason);
    const a = doc.doc.tasks.find((x) => x.id === 'a')!;
    expect(a.start).toBe('2026-11-04'); // Alice's schedule
    expect(a.name).toBe('A by Bob'); // Bob's name was not in conflict and stays
  });
  it('shows each user’s version side by side', () => {
    const p = { changes: [ch('alice', 'a', { start: '2026-11-04' }), ch('bob', 'a', { start: '2026-11-05' })] };
    expect(versionOf(base, p, 'a', 'alice')!.start).toBe('2026-11-04');
    expect(versionOf(base, p, 'a', 'bob')!.start).toBe('2026-11-05');
  });
  it('a later change by another user raises a new flag after a pick', () => {
    const changes = [ch('alice', 'a', { start: '2026-11-04' }), ch('bob', 'a', { start: '2026-11-05' })];
    const picks: Pick[] = [{ taskId: 'a', keep: 'alice', groups: ['schedule'], by: 'carol', at: '', seq: 2 }];
    const later = [...changes, ch('dave', 'a', { duration: 9 }), ch('erin', 'a', { duration: 4 })];
    expect(concurrentChanges({ changes: later, picks }).map((c) => c.users.sort())).toEqual([['dave', 'erin']]);
  });
});

describe('parallel Proposals (K7, K11)', () => {
  it('two Proposals changing the same group of a task overlap; different groups do not', () => {
    const p1 = { id: 'p1', changes: [ch('alice', 'a', { start: '2026-11-03' }), ch('alice', 'b', { name: 'x' })] };
    const p2 = { id: 'p2', changes: [ch('bob', 'a', { duration: 4 }), ch('bob', 'b', { owner: 'y' })] };
    expect(parallelOverlaps(p1, [p2])).toEqual([{ taskId: 'a', groups: ['schedule'], proposalId: 'p2' }]);
  });
});

describe('refresh onto a newer Current (K17)', () => {
  const current: RoadmapDocument = { ...base, roadmap: { ...base.roadmap, version: 2 }, tasks: [
    { ...base.tasks[0]!, start: '2026-11-05' },          // schedule changed in Current
    { ...base.tasks[1]!, owner: 'zed' },                  // owner changed
  ], links: [] };                                         // c deleted
  const p = { changes: [ch('alice', 'a', { duration: 6 }), ch('alice', 'b', { name: 'B mine' }), ch('alice', 'c', { name: 'C mine' })] };
  it('finds overlaps by field group, and a delete against a change', () => {
    const ov = refreshOverlaps(base, current, p);
    expect(ov.map((o) => `${o.taskId}:${o.groups.join('+')}`).sort()).toEqual(['a:schedule', 'c:delete+name']);
  });
  it('needs a choice for every overlap', () => {
    expect(undecided(refreshOverlaps(base, current, p), { a: 'mine' })).toEqual(['c']);
    expect(rebase(base, current, p, { a: 'mine' })).toMatchObject({ ok: false });
  });
  it('incoming drops my change; mine keeps it; non-overlapping changes always stay', () => {
    const r = rebase(base, current, p, { a: 'incoming', c: 'incoming' });
    if (!r.ok) throw new Error(r.reason);
    const a = r.doc.tasks.find((x) => x.id === 'a')!, b = r.doc.tasks.find((x) => x.id === 'b')!;
    expect(a.start).toBe('2026-11-05'); expect(a.duration).toBe(3); // Current's schedule
    expect(b.name).toBe('B mine'); expect(b.owner).toBe('zed'); // both sides combined
    expect(r.doc.tasks.some((x) => x.id === 'c')).toBe(false);
  });
  it('keeping mine on a task Current deleted re-creates it', () => {
    const r = rebase(base, current, p, { a: 'mine', c: 'mine' });
    if (!r.ok) throw new Error(r.reason);
    expect(r.doc.tasks.find((x) => x.id === 'c')!.name).toBe('C mine');
    expect(r.doc.tasks.find((x) => x.id === 'a')!.duration).toBe(6);
  });
  it('per-group choices when a task is expanded', () => {
    const p2 = { changes: [ch('alice', 'a', { duration: 6, owner: 'me' })] };
    const cur2: RoadmapDocument = { ...base, tasks: [{ ...base.tasks[0]!, start: '2026-11-05', owner: 'them' }, base.tasks[1]!, base.tasks[2]!] };
    const r = rebase(base, cur2, p2, { a: { schedule: 'mine', owner: 'incoming' } });
    if (!r.ok) throw new Error(r.reason);
    const a = r.doc.tasks.find((x) => x.id === 'a')!;
    expect(a.duration).toBe(6); expect(a.owner).toBe('them');
  });
});
