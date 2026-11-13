import { describe, expect, it } from 'vitest';
import { AccessEvaluator, checkChange, type AccessRules } from './index.ts';

// Regression tests for audit findings 2 and 3.
const ev = (r: AccessRules['rules']) => new AccessEvaluator({ subject: { id: 'u' }, rules: r });

describe('review fixes: access', () => {
  it('a create needs the permission of each field it sets (audit 2)', () => {
    const e = ev([{ effect: 'allow', permissions: ['view', 'task.create', 'task.modify.dates'] }]);
    const create = (fields: Record<string, unknown>) => checkChange(e, { entity: 'task', op: 'create', id: 'n', fields }, undefined as never, 'r');
    expect(create({ name: 'N', type: 'task', parent: null, start: '2026-11-02', duration: 1 }).allowed).toBe(true);
    expect(create({ name: 'N', type: 'task', parent: null, resources: [{ id: 'r1' }] })).toEqual({ allowed: false, reason: 'Missing permission: resource.assign for the field “resources”' });
  });
  it('a group-scoped deny applies to every task, a group-scoped allow to none (audit 3)', () => {
    const task = { project: 'r', task: { id: 't', parent: null } };
    expect(ev([{ effect: 'allow', permissions: ['view'] }, { effect: 'deny', permissions: ['view'], scope: { tasks: { groups: ['finance'] } } }]).can('view', task)).toBe(false);
    expect(ev([{ effect: 'allow', permissions: ['view'], scope: { tasks: { groups: ['finance'] } } }]).can('view', task)).toBe(false);
  });
});
