import { describe, expect, it } from 'vitest';
import { AccessEvaluator, checkChange, filterDocument, mergeAccess, type AccessRules } from './index.ts';

const doc = {
  roadmap: { id: 'r1' },
  tasks: [
    { id: 's', name: 'S', type: 'summary', parent: null, owner: 'u1' },
    { id: 'a', name: 'A', type: 'task', parent: 's', owner: 'u1', start: '2026-11-02', progress: 0.5, cost: 100 },
    { id: 'b', name: 'B', type: 'task', parent: null, owner: 'u2', start: '2026-11-03', kind: 'secret' },
  ],
  links: [{ id: 'l', source: 'a', target: 'b' }],
};
const rules = (r: AccessRules['rules'], roles = ['planner']): AccessRules => ({ subject: { id: 'u1', roles }, rules: r });

describe('AccessEvaluator', () => {
  it('denies everything with no configuration (safe default, L8)', () => {
    const ev = new AccessEvaluator(null);
    expect(ev.canView).toBe(false);
    expect(filterDocument(doc, ev).tasks).toEqual([]);
  });
  it('deny wins over allow whatever the order (decision 19)', () => {
    const allowThenDeny = new AccessEvaluator(rules([{ effect: 'allow', permissions: ['view', 'task.delete'] }, { effect: 'deny', permissions: ['task.delete'] }]));
    const denyThenAllow = new AccessEvaluator(rules([{ effect: 'deny', permissions: ['task.delete'] }, { effect: 'allow', permissions: ['view', 'task.delete'] }]));
    expect(allowThenDeny.can('task.delete')).toBe(false);
    expect(denyThenAllow.can('task.delete')).toBe(false);
    expect(denyThenAllow.can('view')).toBe(true);
  });
  it('limits rules by role, task scope, own Proposals and conditions', () => {
    const ev = new AccessEvaluator(rules([
      { effect: 'allow', permissions: ['view'] },
      { effect: 'allow', permissions: ['task.modify.dates'], scope: { tasks: { owners: ['$self'] } } },
      { effect: 'allow', permissions: ['proposal.discard'], scope: { proposals: 'own' } },
      { effect: 'allow', permissions: ['export'], roles: ['admin'] },
      { effect: 'allow', permissions: ['task.delete'], condition: 'weekday' },
    ]), { weekday: () => false });
    expect(ev.can('task.modify.dates', { task: { id: 'a', owner: 'u1' } })).toBe(true);
    expect(ev.can('task.modify.dates', { task: { id: 'b', owner: 'u2' } })).toBe(false);
    expect(ev.can('proposal.discard', { proposal: { id: 'p', owner: 'u1' } })).toBe(true);
    expect(ev.can('proposal.discard', { proposal: { id: 'p', owner: 'u9' } })).toBe(false);
    expect(ev.can('export')).toBe(false);
    expect(ev.can('task.delete')).toBe(false);
  });
  it('filters tasks, subtrees, links and fields the user may not view (L12)', () => {
    const ev = new AccessEvaluator(rules([
      { effect: 'allow', permissions: ['view'] },
      { effect: 'deny', permissions: ['view'], scope: { tasks: { kinds: ['secret'] } } },
      { effect: 'allow', permissions: ['view.fields'], fields: ['start', 'progress', 'owner'] },
    ]));
    const f = filterDocument(doc, ev);
    expect(f.tasks.map((t) => t.id)).toEqual(['s', 'a']);
    expect(f.links).toEqual([]);
    expect(f.tasks[1]).not.toHaveProperty('cost');
    expect(f.tasks[1]).toHaveProperty('start');
    const hideParent = new AccessEvaluator(rules([{ effect: 'allow', permissions: ['view'] }, { effect: 'deny', permissions: ['view'], scope: { tasks: { ids: ['s'] } } }]));
    expect(filterDocument(doc, hideParent).tasks.map((t) => t.id)).toEqual(['b']);
  });
  it('maps changes to field-level permissions', () => {
    const ev = new AccessEvaluator(rules([{ effect: 'allow', permissions: ['view', 'task.modify.progress'] }]));
    expect(checkChange(ev, { entity: 'task', op: 'update', id: 'a', fields: { progress: 1 } }, doc.tasks[1]).allowed).toBe(true);
    expect(checkChange(ev, { entity: 'task', op: 'update', id: 'a', fields: { start: '2026-11-04' } }, doc.tasks[1])).toEqual({ allowed: false, reason: 'Missing permission: task.modify.dates for the field “start”' });
  });
  it('lets a resolver result win for the fields it returns (L11)', () => {
    const s = rules([{ effect: 'allow', permissions: ['view'] }]);
    expect(mergeAccess(s, { rules: [] })!.rules).toEqual([]);
    expect(mergeAccess(s, { subject: { id: 'u9' } })!.subject.id).toBe('u9');
    expect(mergeAccess(null, null)).toBeNull();
  });
});
