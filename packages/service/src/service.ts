import type { ProposalChange, RoadmapDocument } from '@gantt/contract';
import { AccessEvaluator, checkChange, filterDocument, type AccessRules, type Condition, type Permission } from '@gantt/access';
import {
  applyChanges, createProposal, DEFAULT_LIMITS, expireIfDue, isOpen, recordChanges, transition, whyNot,
  type LifecycleAction, type ProposalLimits, type ProposalRecord,
} from '@gantt/proposals';

/** A change as a client sends it; the service stamps who and when. */
export type ChangeInput = Omit<ProposalChange, 'by' | 'at'>;

export interface ServiceConfig {
  separationOfDuties: boolean;
  limits: ProposalLimits;
  /** How long before a phase runs out `proposalExpiring` is sent (K2f; default 1 day). */
  expiringLeadMs: number;
}

export type ServiceEvent =
  | { type: 'proposalCreated' | 'proposalDiscarded' | 'proposalSubmitted' | 'proposalWithdrawn' | 'proposalReviewed' | 'proposalReturned' | 'proposalRejected' | 'proposalApproved' | 'proposalChanged'; proposal: ProposalSummary; actor: string; reason?: string }
  | { type: 'proposalExpiring' | 'proposalExpired'; proposal: ProposalSummary; phase: string; expiresAt: string }
  | { type: 'proposalStale'; proposal: ProposalSummary; approvedBy: string; at: string; newVersion: number; changedTasks: string[]; overlapping: string[] }
  | { type: 'currentChanged'; version: number };

/** What a client sees of a Proposal: everything but the raw change list, which comes with the document. */
export type ProposalSummary = Omit<ProposalRecord, 'changes'> & {
  changeCount: number; stale: boolean; changedTasks: string[];
  /** For the user who asked: null when the action is possible, else the reason it is not (F14, K2b). */
  actions?: Partial<Record<LifecycleAction, string | null>>;
};

export interface Snapshot {
  config: ServiceConfig;
  /** Null when no version has been approved yet (a new roadmap, K0a). */
  current: RoadmapDocument | null;
  version: number;
  versions: { version: number; at: string; by: string; proposal?: string }[];
  proposals: ProposalSummary[];
  /** What the user may do with Proposals in general (F14). */
  can: Partial<Record<Permission, boolean>>;
}

export class ServiceError extends Error {
  constructor(message: string, readonly code: 'noAccess' | 'denied' | 'notFound' | 'invalid' | 'conflict') { super(message); }
}

export interface ServiceOptions {
  /** The first approved version of Current, or null for a roadmap that exists only as Proposals. */
  current: RoadmapDocument | null;
  /** For a new roadmap: its id and name. */
  roadmap?: { id: string; name: string; timeZone?: string; start?: string };
  rulesFor: (userId: string) => AccessRules | null;
  conditions?: Record<string, Condition>;
  separationOfDuties?: boolean;
  limits?: Partial<ProposalLimits>;
  expiringLeadMs?: number;
  now?: () => number;
}

const DAY = 86_400_000;

/**
 * The one place a roadmap changes (K0b): Current is written only by Approve, atomically and checked
 * against the base version (K23). Everything else is a Proposal. Shared by the mock backend (in the
 * browser) and the reference server, so both enforce the same rules.
 */
export class RoadmapService {
  readonly config: ServiceConfig;
  private versions = new Map<number, { doc: RoadmapDocument; at: string; by: string; proposal?: string }>();
  private currentVersion = 0;
  private proposals = new Map<string, ProposalRecord>();
  private warned = new Set<string>();
  private seq = 0;
  private listeners = new Set<(e: ServiceEvent) => void>();
  private readonly now: () => number;
  private readonly roadmapInfo: { id: string; name: string; timeZone: string; start: string };

  constructor(private readonly opts: ServiceOptions) {
    this.now = opts.now ?? Date.now;
    // The safe direction wins: only an explicit false relaxes separation of duties (section 4).
    this.config = { separationOfDuties: opts.separationOfDuties !== false, limits: { ...DEFAULT_LIMITS, ...opts.limits }, expiringLeadMs: opts.expiringLeadMs ?? DAY };
    if (opts.current) {
      this.currentVersion = opts.current.roadmap.version;
      this.versions.set(this.currentVersion, { doc: opts.current, at: new Date(this.now()).toISOString(), by: 'import' });
    }
    const r = opts.current?.roadmap ?? opts.roadmap;
    if (!r) throw new Error('Either current or roadmap is required');
    this.roadmapInfo = { id: r.id, name: r.name, timeZone: r.timeZone ?? 'UTC', start: r.start ?? new Date(this.now()).toISOString().slice(0, 10) };
    for (const p of opts.current?.proposals ?? []) {
      // Proposals carried in the mock file (M2) are loaded as Drafts or as their stated state.
      const rec = createProposal({ id: p.id, name: p.name, roadmapId: this.roadmapInfo.id, owner: p.owner, baseVersion: p.baseVersion, now: Date.parse(p.createdAt), limits: this.config.limits, changes: p.changes });
      this.proposals.set(p.id, rec);
    }
  }

  subscribe(fn: (e: ServiceEvent) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  /** Events for one user only: nothing without view, and only Proposals they may see (L12). */
  subscribeFor(userId: string, fn: (e: ServiceEvent) => void): () => void {
    return this.subscribe((e) => {
      const ev = this.evaluator(userId);
      if (!ev.canView) return;
      if ('proposal' in e) {
        const p = this.proposals.get(e.proposal.id);
        if (!p || !this.canSee(ev, p)) return;
        fn({ ...e, proposal: this.summaryFor(userId, p) } as ServiceEvent);
        return;
      }
      fn(e);
    });
  }
  private emit(e: ServiceEvent) { for (const l of this.listeners) l(e); }

  /** The evaluator for a user; without `view` nothing is returned (L6). */
  evaluator(userId: string): AccessEvaluator {
    return new AccessEvaluator(this.opts.rulesFor(userId), this.opts.conditions);
  }
  private requireView(userId: string) {
    const ev = this.evaluator(userId);
    if (!ev.canView) throw new ServiceError('No access to this roadmap', 'noAccess');
    return ev;
  }
  private require(ev: AccessEvaluator, permission: Permission, p?: ProposalRecord) {
    const d = ev.check(permission, { project: this.roadmapInfo.id, proposal: p && { id: p.id, owner: p.owner } });
    if (!d.allowed) throw new ServiceError(d.reason!, 'denied');
  }
  private canSee(ev: AccessEvaluator, p: ProposalRecord) {
    return p.owner === ev.subject.id || ev.can('proposal.viewOthers', { project: this.roadmapInfo.id, proposal: { id: p.id, owner: p.owner } });
  }

  // ---------- reading ----------

  snapshot(userId: string): Snapshot {
    this.tick();
    const ev = this.requireView(userId);
    const cur = this.versions.get(this.currentVersion);
    const perms: Permission[] = ['proposal.create', 'proposal.edit', 'proposal.submit', 'proposal.review', 'proposal.approve', 'proposal.return', 'proposal.reject', 'proposal.discard', 'proposal.viewOthers', 'view.history'];
    return {
      config: this.config,
      current: cur ? filterDocument(cur.doc, ev) : null,
      version: this.currentVersion,
      versions: ev.can('view.history') ? [...this.versions].map(([version, v]) => ({ version, at: v.at, by: v.by, proposal: v.proposal })) : [],
      proposals: [...this.proposals.values()].filter((p) => this.canSee(ev, p)).map((p) => this.summaryFor(userId, p)),
      can: Object.fromEntries(perms.map((p) => [p, ev.can(p, { project: this.roadmapInfo.id })])),
    };
  }

  /** The roadmap as the Proposal would make it (its base plus its changes), filtered for the user. */
  proposalDocument(userId: string, id: string): RoadmapDocument {
    const ev = this.requireView(userId);
    const p = this.get(id);
    if (!this.canSee(ev, p)) throw new ServiceError('You may not view this Proposal', 'denied');
    return filterDocument(this.build(p), ev);
  }

  versionDocument(userId: string, version: number): RoadmapDocument {
    const ev = this.requireView(userId);
    this.require(ev, 'view.history');
    const v = this.versions.get(version);
    if (!v) throw new ServiceError(`No version ${version}`, 'notFound');
    return filterDocument(v.doc, ev);
  }

  // ---------- changing ----------

  /**
   * Records changes. With no Proposal id a new Proposal is created by this first change (K0c), so Current
   * is never edited. Each change is checked against the user's permissions on the task as it is in the
   * Proposal, and the result must still be a valid roadmap.
   */
  change(userId: string, proposalId: string | null, input: ChangeInput[], name?: string): ProposalSummary {
    this.tick();
    const ev = this.requireView(userId);
    if (!input.length) throw new ServiceError('No changes', 'invalid');
    let p: ProposalRecord;
    if (proposalId) {
      p = this.get(proposalId);
      this.require(ev, 'proposal.edit', p);
      if (!this.canSee(ev, p)) throw new ServiceError('You may not view this Proposal', 'denied');
    } else {
      this.require(ev, 'proposal.create');
      p = createProposal({
        id: `p${++this.seq}-${Math.random().toString(36).slice(2, 6)}`, name: name || `Proposal by ${userId}`, roadmapId: this.roadmapInfo.id,
        owner: userId, baseVersion: this.currentVersion, now: this.now(), limits: this.config.limits,
      });
    }
    const before = this.build(p);
    const byId = new Map(before.tasks.map((t) => [t.id, t]));
    for (const c of input) {
      const task = c.entity === 'task' ? byId.get(c.id) : undefined;
      // A user may not change a task, or a field, they cannot see (L12).
      if (c.entity === 'task' && c.op !== 'create' && (!task || !ev.can('view', { project: this.roadmapInfo.id, task: { id: task.id, type: task.type, owner: task.owner, kind: task.kind, parent: task.parent } }))) {
        throw new ServiceError(`Unknown task "${c.id}"`, 'notFound');
      }
      const d = checkChange(ev, c, task as never, this.roadmapInfo.id);
      if (!d.allowed) throw new ServiceError(d.reason!, 'denied');
    }
    const at = new Date(this.now()).toISOString();
    const changes = input.map((c) => ({ ...c, by: userId, at }));
    const rec = recordChanges(p, changes, userId, this.now());
    if (!rec.ok) throw new ServiceError(rec.reason, 'conflict');
    const applied = applyChanges(this.baseOf(rec.proposal), rec.proposal.changes);
    if (!applied.ok) throw new ServiceError(applied.reason, 'invalid');
    this.proposals.set(rec.proposal.id, rec.proposal);
    this.emit({ type: proposalId ? 'proposalChanged' : 'proposalCreated', proposal: this.summary(rec.proposal), actor: userId });
    return this.summary(rec.proposal);
  }

  /** A lifecycle action, guarded by its permission (K2) and the state table; Approve writes Current. */
  act(userId: string, id: string, action: LifecycleAction, reason?: string): ProposalSummary {
    this.tick();
    const ev = this.requireView(userId);
    const p = this.get(id);
    if (!this.canSee(ev, p)) throw new ServiceError('You may not view this Proposal', 'denied');
    this.require(ev, ACTION_PERMISSION[action], p);
    const ctx = { actor: userId, now: this.now(), limits: this.config.limits, separationOfDuties: this.config.separationOfDuties, reason, currentVersion: this.currentVersion };
    const r = transition(p, action, ctx);
    if (!r.ok) throw new ServiceError(r.reason, 'conflict');
    let next = r.proposal;
    if (action === 'approve') {
      // Atomic: all changes or none, against the version the Proposal was based on (K23).
      const applied = applyChanges(this.baseOf(p), p.changes);
      if (!applied.ok) throw new ServiceError(`The changes no longer apply: ${applied.reason}`, 'conflict');
      const version = this.currentVersion + 1;
      const doc = { ...applied.doc, roadmap: { ...applied.doc.roadmap, version }, proposals: undefined };
      delete (doc as { proposals?: unknown }).proposals;
      this.versions.set(version, { doc, at: new Date(this.now()).toISOString(), by: userId, proposal: p.id });
      this.currentVersion = version;
      next = { ...next, approvedVersion: version };
      this.proposals.set(id, next);
      this.emit({ type: 'proposalApproved', proposal: this.summary(next), actor: userId });
      this.emit({ type: 'currentChanged', version });
      const changedTasks = [...new Set(p.changes.filter((c) => c.entity === 'task').map((c) => c.id))];
      for (const other of this.proposals.values()) {
        if (other.id === id || !isOpen(other.state)) continue;
        const mine = new Set(other.changes.filter((c) => c.entity === 'task').map((c) => c.id));
        this.emit({ type: 'proposalStale', proposal: this.summary(other), approvedBy: userId, at: new Date(this.now()).toISOString(), newVersion: version, changedTasks, overlapping: changedTasks.filter((t) => mine.has(t)) });
      }
      return this.summary(next);
    }
    this.proposals.set(id, next);
    const type = ({ submit: 'proposalSubmitted', withdraw: 'proposalWithdrawn', review: 'proposalReviewed', return: 'proposalReturned', reject: 'proposalRejected', discard: 'proposalDiscarded' } as const)[action];
    this.emit({ type, proposal: this.summary(next), actor: userId, reason });
    return this.summary(next);
  }

  /** Why an action is not possible for this user now, or null. Mirrors act() for explained controls (K2b, F14). */
  whyNot(userId: string, id: string, action: LifecycleAction): string | null {
    const ev = this.evaluator(userId);
    const p = this.proposals.get(id);
    if (!p) return 'Unknown Proposal';
    const d = ev.check(ACTION_PERMISSION[action], { project: this.roadmapInfo.id, proposal: { id: p.id, owner: p.owner } });
    if (!d.allowed) return d.reason!;
    return whyNot(p, action, { actor: userId, separationOfDuties: this.config.separationOfDuties, currentVersion: this.currentVersion, reason: 'x' });
  }

  /**
   * "New Proposal from" a rejected, expired, approved or out-of-date Proposal (section 3a): copies its
   * changes onto the newest Current, with its own clocks and a link back. The changes must still apply.
   */
  newFrom(userId: string, id: string): ProposalSummary {
    const ev = this.requireView(userId);
    const src = this.get(id);
    if (!this.canSee(ev, src)) throw new ServiceError('You may not view this Proposal', 'denied');
    this.require(ev, 'proposal.create');
    const changes = src.changes.map((c) => ({ ...c, by: userId, at: new Date(this.now()).toISOString() }));
    const p = createProposal({
      id: `p${++this.seq}-${Math.random().toString(36).slice(2, 6)}`, name: `${src.name} (new)`, roadmapId: this.roadmapInfo.id, owner: userId,
      baseVersion: this.currentVersion, now: this.now(), limits: this.config.limits, derivedFrom: src.id, changes,
    });
    const applied = applyChanges(this.baseOf(p), p.changes);
    if (!applied.ok) throw new ServiceError(`Its changes do not apply to the newest Current: ${applied.reason}`, 'conflict');
    this.proposals.set(p.id, p);
    this.emit({ type: 'proposalCreated', proposal: this.summary(p), actor: userId });
    return this.summary(p);
  }

  /** Moves the clocks: expires Proposals whose phase ran out and warns before it does (K2e, K2f). */
  tick(): void {
    const now = this.now();
    for (const [id, p] of this.proposals) {
      const e = expireIfDue(p, now);
      if (e !== p) {
        this.proposals.set(id, e);
        this.emit({ type: 'proposalExpired', proposal: this.summary(e), phase: p.phase ?? '', expiresAt: p.expiresAt ?? '' });
        continue;
      }
      if (isOpen(p.state) && p.expiresAt) {
        const key = `${id}|${p.phase}|${p.expiresAt}`;
        if (Date.parse(p.expiresAt) - now <= this.config.expiringLeadMs && !this.warned.has(key)) {
          this.warned.add(key);
          this.emit({ type: 'proposalExpiring', proposal: this.summary(p), phase: p.phase ?? '', expiresAt: p.expiresAt });
        }
      }
    }
  }

  // ---------- internals ----------

  private get(id: string): ProposalRecord {
    const p = this.proposals.get(id);
    if (!p) throw new ServiceError(`Unknown Proposal "${id}"`, 'notFound');
    return p;
  }
  private baseOf(p: ProposalRecord): RoadmapDocument {
    const v = this.versions.get(p.baseVersion);
    if (v) return v.doc;
    // A new roadmap (K0a): an empty document that the Proposal fills.
    const r = this.roadmapInfo;
    return { contract: 'gantt-roadmap/1', roadmap: { id: r.id, name: r.name, version: 0, timeZone: r.timeZone, start: r.start }, tasks: [], links: [] };
  }
  private build(p: ProposalRecord): RoadmapDocument {
    const r = applyChanges(this.baseOf(p), p.changes);
    return r.ok ? r.doc : this.baseOf(p);
  }
  private summaryFor(userId: string, p: ProposalRecord): ProposalSummary {
    const actions = Object.fromEntries((Object.keys(ACTION_PERMISSION) as LifecycleAction[]).map((a) => [a, this.whyNot(userId, p.id, a)]));
    return { ...this.summary(p), actions };
  }
  private summary(p: ProposalRecord): ProposalSummary {
    const { changes, ...rest } = p;
    return { ...rest, changeCount: changes.length, stale: isOpen(p.state) && p.baseVersion !== this.currentVersion, changedTasks: [...new Set(changes.filter((c) => c.entity === 'task').map((c) => c.id))] };
  }
}

export const ACTION_PERMISSION: Record<LifecycleAction, Permission> = {
  submit: 'proposal.submit', withdraw: 'proposal.submit', review: 'proposal.review', approve: 'proposal.approve',
  return: 'proposal.return', reject: 'proposal.reject', discard: 'proposal.discard',
};
