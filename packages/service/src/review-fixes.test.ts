import { describe, expect, it } from 'vitest';
import type { AccessRules } from '@gantt/access';
import type { RoadmapDocument } from '@gantt/contract';
import { RoadmapService, type ServiceError } from './index.ts';

// Regression tests for the permission issues in ISSUES.md (1–3).
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
  alice: { subject: { id: 'alice' }, rules: [{ effect: 'allow', permissions: [...ALL] }] },
  bob: { subject: { id: 'bob' }, rules: [{ effect: 'allow', permissions: [...ALL] }] },
  // May copy and restore, but only change progress.
  copier: { subject: { id: 'copier' }, rules: [{ effect: 'allow', permissions: ['view', 'view.history', 'proposal.create', 'proposal.edit', 'proposal.viewOthers', 'task.modify.progress'] }] },
  // Sees every Proposal, but not task b.
  noB: { subject: { id: 'noB' }, rules: [{ effect: 'allow', permissions: ['view', 'proposal.viewOthers'] }, { effect: 'deny', permissions: ['view'], scope: { tasks: { ids: ['b'] } } }] },
  // May approve, but not view task b.
  approverNoB: { subject: { id: 'approverNoB' }, rules: [{ effect: 'allow', permissions: [...ALL] }, { effect: 'deny', permissions: ['view'], scope: { tasks: { ids: ['b'] } } }] },
};
const make = () => new RoadmapService({ current, rulesFor: (u) => users[u] ?? null, now: () => Date.parse('2026-11-02T09:00:00Z') });
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as ServiceError).code; } return 'ok'; };

describe('review fixes: service permissions', () => {
  it('New Proposal from checks the copied changes against the caller (issue 1)', () => {
    const svc = make();
    const p = svc.change('alice', null, [{ entity: 'task', op: 'update', id: 'a', fields: { start: '2026-11-03' } }]);
    expect(code(() => svc.newFrom('copier', p.id))).toBe('denied');
    const q = svc.change('alice', null, [{ entity: 'task', op: 'update', id: 'a', fields: { progress: 0.5 } }]);
    expect(code(() => svc.newFrom('copier', q.id))).toBe('ok');
  });
  it('Restore version checks its changes against the caller (issue 2)', () => {
    const svc = make();
    const p = svc.change('alice', null, [{ entity: 'task', op: 'update', id: 'a', fields: { start: '2026-11-03' } }]);
    svc.act('alice', p.id, 'submit'); svc.act('bob', p.id, 'approve');
    expect(code(() => svc.restoreVersion('copier', 1))).toBe('denied');
    expect(code(() => svc.restoreVersion('alice', 1))).toBe('ok');
  });
  it('summaries do not list tasks the user may not view (issue 3)', () => {
    const svc = make();
    const p = svc.change('alice', null, [
      { entity: 'task', op: 'update', id: 'a', fields: { progress: 0.5 } },
      { entity: 'task', op: 'update', id: 'b', fields: { progress: 0.5 } },
    ]);
    const mine = svc.snapshot('alice').proposals.find((x) => x.id === p.id)!;
    expect(mine.changedTasks).toEqual(['a', 'b']);
    const theirs = svc.snapshot('noB').proposals.find((x) => x.id === p.id)!;
    expect(theirs.changedTasks).toEqual(['a']);
  });
  it('action responses do not list tasks the user may not view (audit 1)', () => {
    const svc = make();
    const p = svc.change('alice', null, [
      { entity: 'task', op: 'update', id: 'a', fields: { progress: 0.5 } },
      { entity: 'task', op: 'update', id: 'b', fields: { progress: 0.5 } },
    ]);
    svc.act('alice', p.id, 'submit');
    expect(svc.act('approverNoB', p.id, 'approve').changedTasks).toEqual(['a']);
  });
});
