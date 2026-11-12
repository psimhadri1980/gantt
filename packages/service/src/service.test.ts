import { describe, expect, it } from 'vitest';
import type { AccessRules } from '@gantt/access';
import type { RoadmapDocument } from '@gantt/contract';
import { RoadmapService, ServiceError, type ServiceEvent } from './index.ts';

const DAY = 86_400_000;
const current: RoadmapDocument = {
  contract: 'gantt-roadmap/1', roadmap: { id: 'r1', name: 'R', version: 1, timeZone: 'UTC', start: '2026-11-02' },
  tasks: [
    { id: 'a', name: 'A', type: 'task', parent: null, start: '2026-11-02', duration: 3, owner: 'alice' },
    { id: 'b', name: 'B', type: 'task', parent: null, start: '2026-11-09', duration: 2, owner: 'bob' },
  ],
  links: [],
};
const ALL = ['view', 'view.history', 'task.create', 'task.modify.dates', 'task.modify.progress', 'task.modify.fields', 'task.delete', 'link.create',
  'proposal.create', 'proposal.edit', 'proposal.submit', 'proposal.review', 'proposal.approve', 'proposal.return', 'proposal.reject', 'proposal.discard', 'proposal.viewOthers'] as const;
const users: Record<string, AccessRules> = {
  alice: { subject: { id: 'alice', roles: ['planner'] }, rules: [{ effect: 'allow', permissions: [...ALL] }] },
  bob: { subject: { id: 'bob', roles: ['approver'] }, rules: [{ effect: 'allow', permissions: [...ALL] }] },
  viewer: { subject: { id: 'viewer' }, rules: [{ effect: 'allow', permissions: ['view'] }] },
  progressOnly: { subject: { id: 'progressOnly' }, rules: [{ effect: 'allow', permissions: ['view', 'proposal.create', 'proposal.edit', 'task.modify.progress'] }] },
  nobody: { subject: { id: 'nobody' }, rules: [] },
};
function make(opts: Partial<ConstructorParameters<typeof RoadmapService>[0]> = {}) {
  let now = Date.parse('2026-11-02T09:00:00Z');
  const events: ServiceEvent[] = [];
  const svc = new RoadmapService({ current, rulesFor: (u) => users[u] ?? null, now: () => now, ...opts });
  svc.subscribe((e) => events.push(e));
  return { svc, events, advance: (ms: number) => { now += ms; } };
}
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as ServiceError).code + ': ' + (e as Error).message; } return 'ok'; };

describe('RoadmapService', () => {
  it('only Approve changes Current (K0, K0b, K5)', () => {
    const { svc } = make();
    const p = svc.change('alice', null, [{ entity: 'task', op: 'update', id: 'a', fields: { name: 'A2' } }]);
    expect(p.state).toBe('Draft');
    expect(svc.snapshot('alice').current!.tasks[0]!.name).toBe('A');
    expect(svc.proposalDocument('alice', p.id).tasks[0]!.name).toBe('A2');
    svc.act('alice', p.id, 'submit');
    expect(svc.snapshot('bob').current!.tasks[0]!.name).toBe('A');
    svc.act('bob', p.id, 'approve');
    const snap = svc.snapshot('viewer');
    expect(snap.current!.tasks[0]!.name).toBe('A2');
    expect(snap.version).toBe(2);
  });
  it('without view nothing is returned, and the safe default denies (L6, L8)', () => {
    const { svc } = make();
    expect(code(() => svc.snapshot('nobody'))).toMatch(/^noAccess/);
    expect(code(() => svc.snapshot('stranger'))).toMatch(/^noAccess/);
  });
  it('refuses actions and fields the user lacks permission for (L2, L5)', () => {
    const { svc } = make();
    expect(code(() => svc.change('viewer', null, [{ entity: 'task', op: 'update', id: 'a', fields: { progress: 1 } }]))).toBe('denied: Missing permission: proposal.create');
    expect(code(() => svc.change('progressOnly', null, [{ entity: 'task', op: 'update', id: 'a', fields: { start: '2026-11-03' } }]))).toBe('denied: Missing permission: task.modify.dates for the field “start”');
    expect(code(() => svc.change('progressOnly', null, [{ entity: 'task', op: 'update', id: 'a', fields: { progress: 1 } }]))).toBe('ok');
  });
  it('refuses an invalid result, and edits of a locked Proposal (K21)', () => {
    const { svc } = make();
    expect(code(() => svc.change('alice', null, [{ entity: 'task', op: 'update', id: 'a', fields: { start: 'soon' } }]))).toMatch(/^invalid/);
    const p = svc.change('alice', null, [{ entity: 'task', op: 'update', id: 'a', fields: { progress: 0.5 } }]);
    svc.act('alice', p.id, 'submit');
    expect(code(() => svc.change('alice', p.id, [{ entity: 'task', op: 'update', id: 'a', fields: { progress: 0.6 } }]))).toMatch(/^conflict: The Proposal is locked/);
  });
  it('enforces separation of duties unless explicitly false (K2a, section 4)', () => {
    for (const [sod, expected] of [[undefined, /^conflict: You submitted/], [true, /^conflict: You submitted/], [false, /^ok/]] as const) {
      const { svc } = make({ separationOfDuties: sod });
      const p = svc.change('alice', null, [{ entity: 'task', op: 'update', id: 'a', fields: { progress: 0.5 } }]);
      svc.act('alice', p.id, 'submit');
      expect(code(() => svc.act('alice', p.id, 'approve'))).toMatch(expected);
    }
  });
  it('refuses approving an out-of-date Proposal and offers New Proposal from it (K23)', () => {
    const { svc, events } = make();
    const p1 = svc.change('alice', null, [{ entity: 'task', op: 'update', id: 'a', fields: { progress: 0.5 } }]);
    const p2 = svc.change('alice', null, [{ entity: 'task', op: 'update', id: 'b', fields: { progress: 0.5 } }]);
    svc.act('alice', p1.id, 'submit'); svc.act('alice', p2.id, 'submit');
    svc.act('bob', p1.id, 'approve');
    expect(events.find((e) => e.type === 'proposalStale')).toMatchObject({ proposal: { id: p2.id }, newVersion: 2 });
    expect(code(() => svc.act('bob', p2.id, 'approve'))).toMatch(/Current has changed/);
    const p3 = svc.newFrom('alice', p2.id);
    expect(p3).toMatchObject({ baseVersion: 2, derivedFrom: p2.id, changeCount: 1, state: 'Draft' });
  });
  it('a new roadmap is invisible in Current until approved (K0a)', () => {
    const { svc } = make({ current: null, roadmap: { id: 'new', name: 'New roadmap' } });
    expect(svc.snapshot('viewer').current).toBeNull();
    const p = svc.change('alice', null, [{ entity: 'task', op: 'create', id: 'x', fields: { name: 'First', type: 'task', parent: null, start: '2026-11-02', duration: 1 } }]);
    svc.act('alice', p.id, 'submit');
    expect(svc.snapshot('viewer').current).toBeNull();
    svc.act('bob', p.id, 'approve');
    expect(svc.snapshot('viewer').current!.tasks.map((t) => t.name)).toEqual(['First']);
  });
  it('expires by phase on a movable clock and warns first (K2e, M7)', () => {
    const { svc, events, advance } = make();
    const p = svc.change('alice', null, [{ entity: 'task', op: 'update', id: 'a', fields: { progress: 0.5 } }]);
    advance(6.5 * DAY); svc.tick();
    expect(events.filter((e) => e.type === 'proposalExpiring')).toHaveLength(1);
    advance(DAY); svc.tick();
    expect(events.find((e) => e.type === 'proposalExpired')).toMatchObject({ proposal: { id: p.id, state: 'Expired' }, phase: 'preparing' });
    expect(code(() => svc.act('alice', p.id, 'submit'))).toMatch(/expired|Expired/);
  });
  it('hides Proposals of others without proposal.viewOthers, in lists and events', () => {
    const own: AccessRules = { subject: { id: 'carol' }, rules: [{ effect: 'allow', permissions: ['view', 'proposal.create', 'proposal.edit', 'task.modify.progress'] }] };
    const { svc } = make({ rulesFor: (u) => (u === 'carol' ? own : users[u] ?? null) });
    const seen: ServiceEvent[] = [];
    svc.subscribeFor('carol', (e) => seen.push(e));
    svc.change('alice', null, [{ entity: 'task', op: 'update', id: 'a', fields: { progress: 0.5 } }]);
    const mine = svc.change('carol', null, [{ entity: 'task', op: 'update', id: 'a', fields: { progress: 0.7 } }]);
    expect(svc.snapshot('carol').proposals.map((p) => p.id)).toEqual([mine.id]);
    expect(seen.filter((e) => e.type === 'proposalCreated').map((e) => 'proposal' in e && e.proposal.id)).toEqual([mine.id]);
    // She is warned that another Proposal changes the same task (K7), about her own Proposal only (K8).
    expect(seen.filter((e) => e.type === 'concurrentChange').every((e) => 'proposal' in e && e.proposal.id === mine.id)).toBe(true);
  });
});
