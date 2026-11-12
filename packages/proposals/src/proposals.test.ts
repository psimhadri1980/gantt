import { describe, expect, it } from 'vitest';
import type { ProposalChange, RoadmapDocument } from '@gantt/contract';
import { applyChanges, createProposal, DEFAULT_LIMITS, diffTasks, expireIfDue, recordChanges, transition, whyNot, type ProposalRecord, type TransitionContext } from './index.ts';

const DAY = 86_400_000, T0 = Date.parse('2026-11-02T09:00:00Z');
const change: ProposalChange = { entity: 'task', op: 'update', id: 'a', fields: { name: 'A2' }, by: 'alice', at: '2026-11-02T09:00:00Z' };
const ctx = (actor: string, now: number, extra: Partial<TransitionContext> = {}): TransitionContext =>
  ({ actor, now, limits: DEFAULT_LIMITS, separationOfDuties: true, currentVersion: 1, ...extra });
const ok = (r: ReturnType<typeof transition>): ProposalRecord => { if (!r.ok) throw new Error(r.reason); return r.proposal; };
function draft(now = T0) {
  const p = createProposal({ id: 'p1', name: 'P', roadmapId: 'r', owner: 'alice', baseVersion: 1, now, limits: DEFAULT_LIMITS });
  return ok(recordChanges(p, [change], 'alice', now));
}

describe('lifecycle', () => {
  it('runs Draft → Submitted → Reviewed → Approved with separation of duties', () => {
    let p = ok(transition(draft(), 'submit', ctx('alice', T0 + DAY)));
    expect(transition(p, 'approve', ctx('alice', T0 + DAY)).ok).toBe(false);
    p = ok(transition(p, 'review', ctx('bob', T0 + DAY)));
    p = ok(transition(p, 'approve', ctx('carol', T0 + DAY)));
    expect(p.state).toBe('Approved');
    expect(p.history.map((h) => h.action)).toEqual(['create', 'change', 'submit', 'review', 'approve']);
    expect(p.history.at(-1)!.separationOfDuties).toBe(true);
  });
  it('lets the submitter approve when separation of duties is off', () => {
    const p = ok(transition(draft(), 'submit', ctx('alice', T0)));
    expect(whyNot(p, 'approve', ctx('alice', T0))).toMatch(/You submitted/);
    expect(ok(transition(p, 'approve', ctx('alice', T0, { separationOfDuties: false }))).state).toBe('Approved');
  });
  it('refuses review or approval by anyone who changed the Proposal', () => {
    let p = ok(recordChanges(draft(), [{ ...change, by: 'bob' }], 'bob', T0));
    p = ok(transition(p, 'submit', ctx('alice', T0)));
    expect(transition(p, 'review', ctx('bob', T0))).toMatchObject({ ok: false, reason: expect.stringMatching(/You changed/) });
  });
  it('locks a submitted Proposal and unlocks it on withdraw by the submitter only', () => {
    let p = ok(transition(draft(), 'submit', ctx('alice', T0)));
    expect(recordChanges(p, [change], 'alice', T0)).toMatchObject({ ok: false, reason: expect.stringMatching(/locked/) });
    expect(transition(p, 'withdraw', ctx('bob', T0)).ok).toBe(false);
    p = ok(transition(p, 'withdraw', ctx('alice', T0)));
    expect(recordChanges(p, [change], 'alice', T0).ok).toBe(true);
  });
  it('requires a reason to return or reject, and a rejected Proposal is closed', () => {
    const p = ok(transition(draft(), 'submit', ctx('alice', T0)));
    expect(transition(p, 'reject', ctx('bob', T0))).toMatchObject({ ok: false, reason: 'A reason is required' });
    const r = ok(transition(p, 'reject', ctx('bob', T0, { reason: 'out of scope' })));
    expect(r.state).toBe('Rejected');
    for (const a of ['submit', 'approve', 'withdraw', 'review'] as const) expect(transition(r, a, ctx('alice', T0)).ok).toBe(false);
    expect(recordChanges(r, [change], 'alice', T0).ok).toBe(false);
  });
  it('refuses approval when Current has moved on (K23)', () => {
    const p = ok(transition(draft(), 'submit', ctx('alice', T0)));
    expect(transition(p, 'approve', ctx('bob', T0, { currentVersion: 2 }))).toMatchObject({ ok: false, reason: expect.stringMatching(/Current has changed/) });
  });
});

describe('clocks (K2e, K2f)', () => {
  it('a Proposal submitted on the last day of its draft lifetime is still open the next day, then expires when the review limit passes', () => {
    const p = ok(transition(draft(), 'submit', ctx('alice', T0 + 7 * DAY - 60_000)));
    expect(expireIfDue(p, T0 + 8 * DAY).state).toBe('Submitted');
    const e = expireIfDue(p, T0 + 7 * DAY + 2 * DAY);
    expect(e.state).toBe('Expired');
    expect(e.history.at(-1)!.reason).toBe('the review limit ran out');
  });
  it('a returned Proposal gets at least the rework minimum; a withdrawn one only the time that was left', () => {
    const late = T0 + 7 * DAY - 3_600_000; // one hour left on the draft clock
    const s = ok(transition(draft(), 'submit', ctx('alice', late)));
    const returned = ok(transition(s, 'return', ctx('bob', late + DAY, { reason: 'fix dates' })));
    expect(Date.parse(returned.expiresAt!) - (late + DAY)).toBe(2 * DAY);
    const withdrawn = ok(transition(s, 'withdraw', ctx('alice', late + DAY)));
    expect(Date.parse(withdrawn.expiresAt!) - (late + DAY)).toBe(3_600_000);
  });
  it('a reviewed Proposal expires when the approval limit passes, and an expired one cannot be approved', () => {
    let p = ok(transition(draft(), 'submit', ctx('alice', T0)));
    p = ok(transition(p, 'review', ctx('bob', T0 + DAY)));
    expect(p.expiresAt).toBe(new Date(T0 + 3 * DAY).toISOString());
    expect(transition(p, 'approve', ctx('carol', T0 + 3 * DAY + 1))).toMatchObject({ ok: false, reason: 'The Proposal has expired' });
  });
});

describe('applyChanges', () => {
  const base: RoadmapDocument = {
    contract: 'gantt-roadmap/1', roadmap: { id: 'r', name: 'R', version: 1, timeZone: 'UTC', start: '2026-11-02' },
    tasks: [{ id: 's', name: 'S', type: 'summary', parent: null }, { id: 'a', name: 'A', type: 'task', parent: 's', start: '2026-11-02', duration: 2 }], links: [],
  };
  it('applies all changes or none', () => {
    const good = applyChanges(base, [change, { ...change, op: 'create', id: 'b', fields: { name: 'B', type: 'task', parent: null } }]);
    expect(good.ok && good.doc.tasks.map((t) => t.name)).toEqual(['S', 'A2', 'B']);
    const bad = applyChanges(base, [change, { ...change, fields: { start: 'soon' } }]);
    expect(bad.ok).toBe(false);
    expect(base.tasks[1]!.name).toBe('A');
  });
  it('reports differences per task (K4)', () => {
    const r = applyChanges(base, [{ ...change, fields: { start: '2026-11-04' } }, { ...change, op: 'delete', id: 's' }]);
    expect(r.ok && diffTasks(base, r.doc)).toEqual([{ id: 's', kind: 'removed', fields: [] }, { id: 'a', kind: 'removed', fields: [] }]);
  });
});
