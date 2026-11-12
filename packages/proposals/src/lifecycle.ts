/**
 * The Proposal lifecycle (K2): Draft → Submitted → (Reviewed) → Approved. A submitted Proposal can also be
 * withdrawn (back to Draft), returned for changes or rejected; a Draft can be discarded; and a Proposal that
 * outlives its phase's time limit becomes Expired. Pure functions: each transition returns a new record or the reason it is
 * not allowed; nothing here stores anything.
 */
import type { ProposalChange } from '@gantt/contract';
import type { Pick } from './concurrency.ts';

/** Lifecycle states (plan section 3a). */
export type ProposalState = 'Draft' | 'Returned' | 'Submitted' | 'Reviewed' | 'Approved' | 'Rejected' | 'Expired' | 'Discarded';
/** Which part of the workflow a Proposal is in; each phase has its own time limit. */
export type Phase = 'preparing' | 'review' | 'approval';
/** The actions that move a Proposal through its lifecycle (each needs its own permission). */
export type LifecycleAction = 'submit' | 'withdraw' | 'review' | 'approve' | 'return' | 'reject' | 'discard';

/** The four time limits in whole days (K2g). */
export interface ProposalLimits { draftDays: number; reviewDays: number; approvalDays: number; reworkMinDays: number }
export const DEFAULT_LIMITS: ProposalLimits = { draftDays: 7, reviewDays: 2, approvalDays: 2, reworkMinDays: 2 };
const DAY = 86_400_000;

/**
 * Checks the configured time limits; returns the problem, or null when every limit is a positive whole number of days.
 */
export function checkLimits(l: ProposalLimits): string | null {
  for (const [k, v] of Object.entries(l)) if (!Number.isInteger(v) || v <= 0) return `${k} must be a positive whole number of days`;
  return null;
}

/** One step in a Proposal's history: when, by whom, which action, and the comment given. */
export interface HistoryEntry {
  at: string;
  by: string;
  action: 'create' | 'change' | LifecycleAction | 'expire' | 'newFrom' | 'pick' | 'refresh' | 'undoRefresh';
  from?: ProposalState;
  to?: ProposalState;
  reason?: string;
  /** Whether separation of duties was enforced at that moment (K2c). */
  separationOfDuties?: boolean;
  /** For changes: how many were recorded. */
  count?: number;
}

/**
 * A Proposal as the service stores it: identity, owner, state, the version it is based on, its changes,
 * its deadlines and history, and what it looked like before the last refresh (for undoing that refresh).
 */
export interface ProposalRecord {
  id: string;
  name: string;
  roadmapId: string;
  owner: string;
  state: ProposalState;
  /** Version of Current the changes are based on. 0 for a new roadmap (K0a). */
  baseVersion: number;
  createdAt: string;
  submittedAt?: string;
  submittedBy?: string;
  reviewedAt?: string;
  /** Everyone who recorded a change (K2a). */
  changedBy: string[];
  changes: ProposalChange[];
  /** The phase whose clock is running, and when it runs out (K2e). Absent once closed. */
  phase?: Phase;
  expiresAt?: string;
  /** Time left on the preparing clock while it is paused during review (K2f). */
  preparingLeftMs?: number;
  /** Reason given with the last Return or Reject. */
  reason?: string;
  /** The Proposal this one was started from ("New Proposal from"). */
  derivedFrom?: string;
  /** The version of Current this Proposal produced when approved (K22). */
  approvedVersion?: number;
  /** Versions picked for tasks two users changed in the same field group (K9). */
  picks?: Pick[];
  /** The Proposal as it was before its last refresh, so the refresh can be undone (K17). */
  beforeRefresh?: { changes: ProposalChange[]; picks?: Pick[]; baseVersion: number; state: ProposalState; phase?: Phase; expiresAt?: string; preparingLeftMs?: number; historyLength: number };
  history: HistoryEntry[];
}

/** True while a Proposal can still change state (not approved, rejected or discarded). */
export const isOpen = (s: ProposalState) => s === 'Draft' || s === 'Returned' || s === 'Submitted' || s === 'Reviewed';
/** True while the owner can still edit the Proposal's changes. */
export const isEditable = (s: ProposalState) => s === 'Draft' || s === 'Returned';

/** A timestamp in milliseconds as an ISO string. */
const iso = (ms: number) => new Date(ms).toISOString();

/** A new Draft Proposal, with the preparation deadline counted from now. */
export function createProposal(p: { id: string; name: string; roadmapId: string; owner: string; baseVersion: number; now: number; limits: ProposalLimits; derivedFrom?: string; changes?: ProposalChange[] }): ProposalRecord {
  return {
    id: p.id, name: p.name, roadmapId: p.roadmapId, owner: p.owner, state: 'Draft', baseVersion: p.baseVersion,
    createdAt: iso(p.now), changedBy: p.changes?.length ? [p.owner] : [], changes: p.changes ?? [],
    phase: 'preparing', expiresAt: iso(p.now + p.limits.draftDays * DAY), derivedFrom: p.derivedFrom,
    history: [{ at: iso(p.now), by: p.owner, action: p.derivedFrom ? 'newFrom' : 'create', reason: p.derivedFrom ? `from ${p.derivedFrom}` : undefined }],
  };
}

/** Who is acting, when, why, and the settings that apply, for one lifecycle transition. */
export interface TransitionContext {
  actor: string;
  now: number;
  limits: ProposalLimits;
  /** GANTT_ENFORCE_SEPARATION_OF_DUTIES (K2a). */
  separationOfDuties: boolean;
  /** Required for return and reject. */
  reason?: string;
  /** Version of Current now; approval is refused when the Proposal's base is older (K23). */
  currentVersion: number;
}

/** The new Proposal after a transition, or the reason it is not allowed. */
export type TransitionResult = { ok: true; proposal: ProposalRecord } | { ok: false; reason: string };

const FROM: Record<LifecycleAction, ProposalState[]> = {
  submit: ['Draft', 'Returned'],
  withdraw: ['Submitted', 'Reviewed'],
  review: ['Submitted'],
  approve: ['Submitted', 'Reviewed'],
  return: ['Submitted', 'Reviewed'],
  reject: ['Submitted', 'Reviewed'],
  discard: ['Draft', 'Returned'],
};
const TO: Record<LifecycleAction, ProposalState> = {
  submit: 'Submitted', withdraw: 'Draft', review: 'Reviewed', approve: 'Approved', return: 'Returned', reject: 'Rejected', discard: 'Discarded',
};

/**
 * Checks whether an action is possible now, without permissions (the service checks those). Returns the
 * reason it is not, for explained controls (F14).
 */
export function whyNot(p: ProposalRecord, action: LifecycleAction, ctx: Omit<TransitionContext, 'limits' | 'now'> & { now?: number }): string | null {
  if (!FROM[action].includes(p.state)) return `Not possible while the Proposal is ${p.state}`;
  if (action === 'submit' && p.changes.length === 0) return 'The Proposal has no changes';
  if (action === 'withdraw' && p.submittedBy !== ctx.actor) return 'Only the submitter can withdraw it';
  if ((action === 'return' || action === 'reject') && !ctx.reason?.trim()) return 'A reason is required';
  if ((action === 'review' || action === 'approve') && ctx.separationOfDuties) {
    if (p.submittedBy === ctx.actor) return 'You submitted this Proposal; someone else must review and approve it';
    if (p.changedBy.includes(ctx.actor)) return 'You changed this Proposal; someone else must review and approve it';
  }
  if (action === 'approve' && p.baseVersion !== ctx.currentVersion) {
    const n = ctx.currentVersion - p.baseVersion;
    return `Current has changed since this Proposal was made (${n} newer ${n === 1 ? 'version' : 'versions'}: ${p.baseVersion} → ${ctx.currentVersion}); refresh the Proposal first`;
  }
  return null;
}

/** Applies a lifecycle action, moving the clocks as K2e/K2f describe. Approval itself is applied by the service. */
export function transition(p: ProposalRecord, action: LifecycleAction, ctx: TransitionContext): TransitionResult {
  const expired = expireIfDue(p, ctx.now);
  if (expired !== p) return { ok: false, reason: 'The Proposal has expired' };
  const why = whyNot(p, action, ctx);
  if (why) return { ok: false, reason: why };
  const now = ctx.now, to = TO[action];
  const next: ProposalRecord = { ...p, state: to };
  const entry: HistoryEntry = { at: iso(now), by: ctx.actor, action, from: p.state, to };
  const left = (deadline?: string) => Math.max(0, Date.parse(deadline ?? iso(now)) - now);
  switch (action) {
    case 'submit':
      // The preparing clock stops with the time that was left; a fresh review clock starts (K2f).
      next.preparingLeftMs = left(p.expiresAt);
      next.phase = 'review'; next.expiresAt = iso(now + ctx.limits.reviewDays * DAY);
      next.submittedAt = iso(now); next.submittedBy = ctx.actor; next.reason = undefined;
      break;
    case 'review':
      next.reviewedAt = iso(now); next.phase = 'approval'; next.expiresAt = iso(now + ctx.limits.approvalDays * DAY);
      entry.separationOfDuties = ctx.separationOfDuties;
      break;
    case 'withdraw':
      // Only the time that was left: a minimum here would let a Proposal live for ever (K2f).
      next.phase = 'preparing'; next.expiresAt = iso(now + (p.preparingLeftMs ?? 0)); next.preparingLeftMs = undefined;
      next.submittedAt = undefined; next.submittedBy = undefined; next.reviewedAt = undefined;
      break;
    case 'return':
      next.phase = 'preparing'; next.expiresAt = iso(now + Math.max(p.preparingLeftMs ?? 0, ctx.limits.reworkMinDays * DAY));
      next.preparingLeftMs = undefined; next.reason = ctx.reason; entry.reason = ctx.reason;
      next.submittedAt = undefined; next.submittedBy = undefined; next.reviewedAt = undefined;
      break;
    case 'reject':
      next.phase = undefined; next.expiresAt = undefined; next.reason = ctx.reason; entry.reason = ctx.reason;
      break;
    case 'approve':
      next.phase = undefined; next.expiresAt = undefined; entry.separationOfDuties = ctx.separationOfDuties;
      break;
    case 'discard':
      // The content goes; the fact that it existed stays (section 3a).
      next.phase = undefined; next.expiresAt = undefined; next.changes = [];
      break;
  }
  next.history = [...p.history, entry];
  return { ok: true, proposal: next };
}

/** Closes an open Proposal whose phase limit has passed (K2e). Returns the same object when nothing changed. */
export function expireIfDue(p: ProposalRecord, now: number): ProposalRecord {
  if (!isOpen(p.state) || !p.expiresAt || Date.parse(p.expiresAt) > now) return p;
  return {
    ...p, state: 'Expired', phase: undefined,
    history: [...p.history, { at: p.expiresAt, by: 'system', action: 'expire', from: p.state, to: 'Expired', reason: `the ${p.phase} limit ran out` }],
  };
}

/** Records changes in an editable Proposal (K21: a locked one refuses). */
export function recordChanges(p: ProposalRecord, changes: ProposalChange[], actor: string, now: number): TransitionResult {
  if (expireIfDue(p, now) !== p) return { ok: false, reason: 'The Proposal has expired' };
  if (!isEditable(p.state)) return { ok: false, reason: p.state === 'Submitted' || p.state === 'Reviewed' ? 'The Proposal is locked for review; withdraw it to make changes' : `The Proposal is ${p.state}` };
  return {
    ok: true,
    proposal: {
      ...p, changes: [...p.changes, ...changes],
      changedBy: p.changedBy.includes(actor) ? p.changedBy : [...p.changedBy, actor],
      history: [...p.history, { at: iso(now), by: actor, action: 'change', count: changes.length }],
    },
  };
}
