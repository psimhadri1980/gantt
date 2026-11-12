import { describe, expect, it } from 'vitest';
import type { AccessRules } from '@gantt/access';
import type { RoadmapDocument } from '@gantt/contract';
import { RoadmapService, ServiceError, type ServiceEvent } from './index.ts';

/** Phase 6 "done when", against the service (the same rules the server and the mock backend use). */
const current: RoadmapDocument = {
  contract: 'gantt-roadmap/1', roadmap: { id: 'r1', name: 'R', version: 1, timeZone: 'UTC', start: '2026-11-02' },
  tasks: [
    { id: 'a', name: 'A', type: 'task', parent: null, start: '2026-11-02', duration: 3 },
    { id: 'b', name: 'B', type: 'task', parent: null, start: '2026-11-09', duration: 2 },
    { id: 'c', name: 'C', type: 'task', parent: null, start: '2026-11-16', duration: 2 },
  ],
  links: [{ id: 'l1', source: 'a', target: 'b', type: 'FS' }],
};
const ALL = ['view', 'view.history', 'task.create', 'task.modify.dates', 'task.modify.progress', 'task.modify.fields', 'task.delete', 'link.create',
  'proposal.create', 'proposal.edit', 'proposal.refresh', 'proposal.submit', 'proposal.review', 'proposal.approve', 'proposal.return', 'proposal.reject', 'proposal.discard', 'proposal.viewOthers', 'baseline.save', 'view.baselines'] as const;
const rule = (id: string, perms: readonly string[]): AccessRules => ({ subject: { id }, rules: [{ effect: 'allow', permissions: [...perms] as AccessRules['rules'][number]['permissions'] }] });
const users: Record<string, AccessRules> = {
  alice: rule('alice', ALL), bob: rule('bob', ALL), carol: rule('carol', ALL),
  // Sees and edits Proposals but not other people's (K8: other Proposals stay unnamed).
  dan: rule('dan', ALL.filter((p) => p !== 'proposal.viewOthers')),
};
function make() {
  const now = Date.parse('2026-11-02T09:00:00Z');
  const events: ServiceEvent[] = [];
  const svc = new RoadmapService({ current, rulesFor: (u) => users[u] ?? null, now: () => now });
  svc.subscribe((e) => events.push(e));
  return { svc, events };
}
const err = (fn: () => unknown) => { try { fn(); return 'ok'; } catch (e) { return (e as ServiceError).message; } };
const upd = (id: string, fields: Record<string, unknown>) => ({ entity: 'task' as const, op: 'update' as const, id, fields });

describe('working together on Proposals (Phase 6)', () => {
  it('two users changing the same field group of a task in one Proposal are flagged, and Approve waits for a pick (K7, K9)', () => {
    const { svc, events } = make();
    const p = svc.change('alice', null, [upd('a', { start: '2026-11-03' })]);
    svc.change('bob', p.id, [upd('a', { duration: 5 })]);
    expect(events.some((e) => e.type === 'concurrentChange' && e.taskIds.includes('a') && !e.parallel)).toBe(true);
    const cc = svc.concurrency('alice', p.id);
    expect(cc.inProposal.map((x) => x.taskId)).toEqual(['a']);
    expect(cc.inProposal[0]!.versions.map((v) => `${v.user}:${v.task?.start}/${v.task?.duration}`).sort()).toEqual(['alice:2026-11-03/3', 'bob:2026-11-02/5']);
    svc.act('alice', p.id, 'submit');
    expect(svc.whyNot('carol', p.id, 'approve')).toMatch(/pick a version/);
    expect(err(() => svc.act('carol', p.id, 'approve'))).toMatch(/pick a version/);
    // The approver picks; a pick does not count as a change for separation of duties.
    svc.pick('carol', p.id, 'a', 'bob');
    expect(svc.concurrency('carol', p.id).inProposal).toEqual([]);
    svc.act('carol', p.id, 'approve');
    const a = svc.snapshot('carol').current!.tasks.find((t) => t.id === 'a')!;
    expect(a.duration).toBe(5);
    expect(a.start).toBe('2026-11-02'); // Bob's version: Alice's start was not kept
  });

  it('two users changing different fields of one task see no flag (K7)', () => {
    const { svc } = make();
    const p = svc.change('alice', null, [upd('a', { name: 'A!' })]);
    svc.change('bob', p.id, [upd('a', { duration: 4 })]);
    expect(svc.concurrency('alice', p.id).inProposal).toEqual([]);
    expect(svc.snapshot('alice').proposals[0]!.conflicts).toBe(0);
  });

  it('two parallel Proposals changing the same task are both warned; names follow viewOthers (K7, K8, K11)', () => {
    const { svc, events } = make();
    const p1 = svc.change('alice', null, [upd('b', { start: '2026-11-10' })], 'Alice plan');
    const p2 = svc.change('dan', null, [upd('b', { duration: 4 })], 'Dan plan');
    const warned = events.filter((e) => e.type === 'concurrentChange' && e.parallel).map((e) => (e as { proposal: { id: string } }).proposal.id);
    expect(warned.sort()).toEqual([p1.id, p2.id].sort());
    expect(svc.concurrency('alice', p1.id).parallel[0]!.proposal?.name).toBe('Dan plan');
    expect(svc.concurrency('dan', p2.id).parallel[0]!.proposal).toBeNull(); // "another Proposal"
    expect(svc.snapshot('alice').proposals.find((p) => p.id === p1.id)!.shared).toBe(1);
    // A warning only: approval is not blocked by it.
    expect(svc.whyNot('carol', p1.id, 'approve')).not.toMatch(/pick/);
  });

  it('approving one marks the other stale at once and blocks its approval; refresh with overlaps resolves it (K12–K19)', () => {
    const { svc, events } = make();
    const p1 = svc.change('alice', null, [upd('a', { start: '2026-11-04' }), upd('c', { name: 'C mine' })], 'Mine');
    const p2 = svc.change('bob', null, [upd('a', { duration: 6 }), upd('b', { name: 'B new' })], 'Theirs');
    svc.act('bob', p2.id, 'submit'); svc.act('carol', p2.id, 'approve');
    const stale = events.find((e) => e.type === 'proposalStale' && e.proposal.id === p1.id);
    expect(stale && stale.type === 'proposalStale' && stale.overlapping).toEqual(['a']);
    const s1 = svc.snapshot('alice').proposals.find((p) => p.id === p1.id)!;
    expect(s1.stale).toBe(true); expect(s1.behind).toBe(1);
    svc.act('alice', p1.id, 'submit');
    expect(svc.whyNot('carol', p1.id, 'approve')).toMatch(/refresh the Proposal first/);
    // Preview: incoming changes, one overlap (a: schedule) that must be decided.
    const pv = svc.refreshPreview('alice', p1.id);
    expect(pv.overlaps.map((o) => o.taskId)).toEqual(['a']);
    expect(pv.incoming.map((i) => i.taskId).sort()).toEqual(['a', 'b']);
    expect(pv.problem).toMatch(/needs a choice/);
    expect(err(() => svc.refresh('alice', p1.id, {}))).toMatch(/needs a choice/);
    const r = svc.refresh('alice', p1.id, { a: 'mine' });
    expect(r.stale).toBe(false); expect(r.behind).toBe(0);
    expect(r.state).toBe('Draft'); // a refresh that needed a choice goes back to Draft (K19)
    expect(r.history.at(-1)).toMatchObject({ action: 'refresh', by: 'alice' });
    const doc = svc.proposalDocument('alice', p1.id);
    expect(doc.tasks.find((t) => t.id === 'b')!.name).toBe('B new'); // incoming without overlap is taken
    expect(doc.tasks.find((t) => t.id === 'a')!.start).toBe('2026-11-04'); // mine kept
    expect(doc.tasks.find((t) => t.id === 'c')!.name).toBe('C mine');
    // And it can be undone.
    expect(r.canUndoRefresh).toBe(true);
    const u = svc.undoRefresh('alice', p1.id);
    expect(u.stale).toBe(true); expect(u.state).toBe('Submitted');
  });

  it('a Submitted Proposal with a clean refresh stays Submitted and can then be approved (K19)', () => {
    const { svc } = make();
    const p1 = svc.change('alice', null, [upd('c', { name: 'C!' })]);
    const p2 = svc.change('bob', null, [upd('a', { name: 'A!' })]);
    svc.act('alice', p1.id, 'submit');
    svc.act('bob', p2.id, 'submit'); svc.act('carol', p2.id, 'approve');
    // The approver may refresh a submitted Proposal (refresh + approve).
    const r = svc.refresh('carol', p1.id, {});
    expect(r.state).toBe('Submitted');
    svc.act('carol', p1.id, 'approve');
    const cur = svc.snapshot('carol').current!;
    expect(cur.tasks.find((t) => t.id === 'a')!.name).toBe('A!');
    expect(cur.tasks.find((t) => t.id === 'c')!.name).toBe('C!');
  });

  it('several newer versions in a row: one stale event each, one refresh to the latest (K20)', () => {
    const { svc, events } = make();
    const mine = svc.change('alice', null, [upd('c', { name: 'C2' })]);
    for (const n of ['A1', 'A2']) {
      const p = svc.change('bob', null, [upd('a', { name: n })]);
      svc.act('bob', p.id, 'submit'); svc.act('carol', p.id, 'approve');
    }
    expect(events.filter((e) => e.type === 'proposalStale' && e.proposal.id === mine.id)).toHaveLength(2);
    expect(svc.snapshot('alice').proposals.find((p) => p.id === mine.id)!.behind).toBe(2);
    const r = svc.refresh('alice', mine.id, {});
    expect(r.behind).toBe(0);
    expect(svc.proposalDocument('alice', mine.id).tasks.find((t) => t.id === 'a')!.name).toBe('A2');
  });
});

describe('baselines (Phase 8, B1)', () => {
  it('saving a baseline needs baseline.save, does not change the plan, and is shown only with view.baselines', () => {
    const viewer = { subject: { id: 'v' }, rules: [{ effect: 'allow' as const, permissions: ['view' as const] }] };
    const now = Date.parse('2026-11-02T09:00:00Z');
    const svc = new RoadmapService({ current, rulesFor: (u) => (u === 'v' ? viewer : users[u] ?? null), now: () => now });
    expect(() => svc.saveBaseline('v', 'Plan')).toThrow(/baseline.save/);
    const before = svc.snapshot('alice').version;
    const b = svc.saveBaseline('alice', 'Kick-off plan');
    expect(svc.snapshot('alice').version).toBe(before);
    expect(svc.snapshot('alice').proposals).toEqual([]);
    expect(svc.snapshot('alice').current!.baselines!.map((x) => x.name)).toEqual(['Kick-off plan']);
    expect(svc.snapshot('alice').current!.baselines![0]!.tasks.find((t) => t.id === 'a')).toEqual({ id: 'a', start: '2026-11-02', end: '2026-11-04', work: 3 });
    expect(svc.snapshot('v').current!.baselines).toBeUndefined();
    expect(b.version).toBe(1);
  });
});
