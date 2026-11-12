import type { Baseline, ProposalChange, RoadmapDocument, Task } from '@gantt/contract';
import { AccessEvaluator, checkChange, filterDocument, type AccessRules, type Condition, type Permission } from '@gantt/access';
import {
  applyChanges, concurrentChanges, createProposal, DEFAULT_LIMITS, effectiveChanges, expireIfDue, incomingChanges, isEditable, isOpen, parallelOverlaps,
  rebase, recordChanges, refreshOverlaps, transition, undecided, versionOf, whyNot,
  type LifecycleAction, type ProposalLimits, type ProposalRecord, type RefreshChoice, type RefreshOverlap,
} from '@gantt/proposals';
import { place, schedule, takeBaseline } from '@gantt/engine';

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
  /** Two users changed the same field group of a task, here or in a parallel Proposal (K7, H5). */
  | { type: 'concurrentChange'; proposal: ProposalSummary; actor: string; taskIds: string[]; parallel: boolean }
  | { type: 'proposalRefreshed'; proposal: ProposalSummary; actor: string; fromVersion: number; toVersion: number }
  | { type: 'currentChanged'; version: number }
  | { type: 'baselineSaved'; baseline: { id: string; name: string; version: number }; actor: string };

/** What a client sees of a Proposal: everything but the raw change list, which comes with the document. */
export type ProposalSummary = Omit<ProposalRecord, 'changes' | 'beforeRefresh'> & {
  changeCount: number; stale: boolean; changedTasks: string[];
  /** Newer versions of Current since this Proposal's base (K20). */
  behind: number;
  /** Tasks two users changed in the same field group here, still waiting for a pick (K9). */
  conflicts: number;
  /** Tasks this Proposal changes that other open Proposals change too (K11). */
  shared: number;
  /** The last refresh can be undone (K17). */
  canUndoRefresh: boolean;
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

/** Flags for the chart and the "Concurrent changes" panel (K8). */
export interface Concurrency {
  inProposal: { taskId: string; name: string; groups: string[]; users: string[]; at: string; versions: { user: string; task: Task | null }[] }[];
  /** Other Proposals are named only to someone allowed to see them (`proposal.viewOthers`); else null ("another Proposal"). */
  parallel: { taskId: string; name: string; groups: string[]; proposal: { id: string; name: string; owner: string } | null }[];
}

/** What a refresh would do (K17), with the user's choices so far. */
export interface RefreshPreview {
  fromVersion: number;
  toVersion: number;
  incoming: { taskId: string; name: string; kind: 'added' | 'removed' | 'changed'; groups: string[]; by?: string }[];
  overlaps: RefreshOverlap[];
  undecided: string[];
  /** Tasks the recalculated schedule moves, and scheduling problems the refresh would add (K17, K19). */
  moved: { taskId: string; name: string; from?: string; to: string }[];
  newIssues: string[];
  /** Whether confirming moves the Proposal back to Draft (K19). */
  backToDraft: boolean;
  /** Reason it cannot be applied as chosen, if any. */
  problem: string | null;
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
  private baselines: Baseline[] = [];
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
    this.baselines = [...(opts.current?.baselines ?? [])];
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
        const out = { ...e, proposal: this.summaryFor(userId, p) } as ServiceEvent;
        // Only tasks this user may view (K15, L12).
        if (out.type === 'proposalStale' || out.type === 'concurrentChange') {
          const cur = this.versions.get(this.currentVersion)?.doc;
          const seen = (id: string) => { const t = cur?.tasks.find((x) => x.id === id) ?? this.build(p).tasks.find((x) => x.id === id); return !t || this.canViewTask(ev, t); };
          if (out.type === 'proposalStale') { out.changedTasks = out.changedTasks.filter(seen); out.overlapping = out.overlapping.filter(seen); }
          else out.taskIds = out.taskIds.filter(seen);
        }
        fn(out);
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
  private canViewTask(ev: AccessEvaluator, t: Task) {
    return ev.can('view', { project: this.roadmapInfo.id, task: { id: t.id, type: t.type, owner: t.owner, kind: t.kind, parent: t.parent } });
  }
  private canSee(ev: AccessEvaluator, p: ProposalRecord) {
    return p.owner === ev.subject.id || ev.can('proposal.viewOthers', { project: this.roadmapInfo.id, proposal: { id: p.id, owner: p.owner } });
  }

  // ---------- reading ----------

  snapshot(userId: string): Snapshot {
    this.tick();
    const ev = this.requireView(userId);
    const cur = this.versions.get(this.currentVersion);
    const perms: Permission[] = ['baseline.save', 'view.baselines', 'proposal.create', 'proposal.edit', 'proposal.refresh', 'proposal.submit', 'proposal.review', 'proposal.approve', 'proposal.return', 'proposal.reject', 'proposal.discard', 'proposal.viewOthers', 'view.history'];
    return {
      config: this.config,
      current: cur ? this.withBaselines(filterDocument(cur.doc, ev), ev) : null,
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
    return this.withBaselines(filterDocument(this.build(p), ev), ev);
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
    const applied = applyChanges(this.baseOf(rec.proposal), effectiveChanges(rec.proposal));
    if (!applied.ok) throw new ServiceError(applied.reason, 'invalid');
    const conflictsBefore = new Set(concurrentChanges(p).map((c) => c.taskId));
    const sharedBefore = new Set(parallelOverlaps(p, this.openOthers(p.id)).map((o) => o.taskId));
    this.proposals.set(rec.proposal.id, rec.proposal);
    this.emit({ type: proposalId ? 'proposalChanged' : 'proposalCreated', proposal: this.summary(rec.proposal), actor: userId });
    // New concurrent changes are announced at once (K7, H5): here, and to each parallel Proposal that shares a task.
    const fresh = concurrentChanges(rec.proposal).map((c) => c.taskId).filter((id) => !conflictsBefore.has(id));
    if (fresh.length) this.emit({ type: 'concurrentChange', proposal: this.summary(rec.proposal), actor: userId, taskIds: fresh, parallel: false });
    const par = parallelOverlaps(rec.proposal, this.openOthers(rec.proposal.id)).filter((o) => !sharedBefore.has(o.taskId));
    if (par.length) {
      this.emit({ type: 'concurrentChange', proposal: this.summary(rec.proposal), actor: userId, taskIds: [...new Set(par.map((o) => o.taskId))], parallel: true });
      for (const pid of new Set(par.map((o) => o.proposalId))) {
        const other = this.proposals.get(pid)!;
        this.emit({ type: 'concurrentChange', proposal: this.summary(other), actor: userId, taskIds: par.filter((o) => o.proposalId === pid).map((o) => o.taskId), parallel: true });
      }
    }
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
    if (action === 'approve') { const open = concurrentChanges(p).length; if (open) throw new ServiceError(conflictReason(open), 'conflict'); }
    const r = transition(p, action, ctx);
    if (!r.ok) throw new ServiceError(r.reason, 'conflict');
    let next = r.proposal;
    if (action === 'approve') {
      // Atomic: all changes or none, against the version the Proposal was based on (K23).
      const applied = applyChanges(this.baseOf(p), effectiveChanges(p));
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
      // Every other open Proposal is now out of date (K12, K15): told at once, with the tasks that overlap its own changes.
      const prev = this.versions.get(version - 1)?.doc ?? this.baseOf(p);
      const changedTasks = incomingChanges(prev, doc).map((c) => c.taskId);
      for (const other of this.proposals.values()) {
        if (other.id === id || !isOpen(other.state)) continue;
        const overlapping = refreshOverlaps(this.baseOf(other), doc, other).map((o) => o.taskId);
        this.emit({ type: 'proposalStale', proposal: this.summary(other), approvedBy: userId, at: new Date(this.now()).toISOString(), newVersion: version, changedTasks, overlapping });
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
    const w = whyNot(p, action, { actor: userId, separationOfDuties: this.config.separationOfDuties, currentVersion: this.currentVersion, reason: 'x' });
    if (w || action !== 'approve') return w;
    const open = concurrentChanges(p).length;
    return open ? conflictReason(open) : null;
  }

  // ---------- tracking (Phase 8) ----------

  /**
   * Saves a baseline of a version of Current (B1, K22): a snapshot, not a change, so no Proposal. Needs
   * `baseline.save`; the newest version unless another is named.
   */
  saveBaseline(userId: string, name: string, version = this.currentVersion): { id: string; name: string; version: number } {
    const ev = this.requireView(userId);
    this.require(ev, 'baseline.save');
    if (!name.trim()) throw new ServiceError('A baseline needs a name', 'invalid');
    const v = this.versions.get(version);
    if (!v) throw new ServiceError(`No version ${version}`, 'notFound');
    const b = takeBaseline(place(v.doc), { id: `b${this.baselines.length + 1}-${Math.random().toString(36).slice(2, 6)}`, name: name.trim(), version, savedAt: new Date(this.now()).toISOString(), savedBy: userId });
    this.baselines.push(b);
    const info = { id: b.id, name: b.name, version };
    this.emit({ type: 'baselineSaved', baseline: info, actor: userId });
    return info;
  }
  /** Baselines go with Current only for users with `view.baselines`, and only for tasks they may view. */
  private withBaselines(doc: RoadmapDocument, ev: AccessEvaluator): RoadmapDocument {
    const { baselines: _drop, ...rest } = doc; void _drop;
    if (!this.baselines.length || !ev.can('view.baselines', { project: this.roadmapInfo.id })) return rest as RoadmapDocument;
    const seen = new Set(doc.tasks.map((t) => t.id));
    return { ...rest, baselines: this.baselines.map((b) => ({ ...b, tasks: b.tasks.filter((t) => seen.has(t.id)) })) } as RoadmapDocument;
  }

  // ---------- working together (Phase 6) ----------

  /** Concurrent changes in a Proposal and overlaps with parallel Proposals, for this user (K7, K8). */
  concurrency(userId: string, id: string): Concurrency {
    const ev = this.requireView(userId);
    const p = this.get(id);
    if (!this.canSee(ev, p)) throw new ServiceError('You may not view this Proposal', 'denied');
    const base = this.baseOf(p), doc = this.build(p);
    const task = (tid: string) => doc.tasks.find((t) => t.id === tid) ?? base.tasks.find((t) => t.id === tid);
    const visible = (tid: string) => { const t = task(tid); return !t || this.canViewTask(ev, t); };
    const name = (tid: string) => task(tid)?.name ?? tid;
    return {
      inProposal: concurrentChanges(p).filter((c) => visible(c.taskId)).map((c) => ({
        taskId: c.taskId, name: name(c.taskId), groups: c.groups, users: c.users, at: c.changes.at(-1)?.at ?? '',
        versions: c.users.map((u) => ({ user: u, task: versionOf(base, p, c.taskId, u) })),
      })),
      parallel: parallelOverlaps(p, this.openOthers(p.id)).filter((o) => visible(o.taskId)).map((o) => {
        const other = this.proposals.get(o.proposalId)!;
        return { taskId: o.taskId, name: name(o.taskId), groups: o.groups, proposal: this.canSee(ev, other) ? { id: other.id, name: other.name, owner: other.owner } : null };
      }),
    };
  }

  /**
   * Keeps one user's version of a task changed concurrently (K9). Any editor may pick before submission; once
   * submitted, the approver picks. A pick is history, not a change: it does not count for separation of duties.
   */
  pick(userId: string, id: string, taskId: string, keep: string): ProposalSummary {
    this.tick();
    const ev = this.requireView(userId);
    const p = this.get(id);
    if (!this.canSee(ev, p)) throw new ServiceError('You may not view this Proposal', 'denied');
    if (isEditable(p.state)) this.require(ev, 'proposal.edit', p);
    else if (p.state === 'Submitted' || p.state === 'Reviewed') this.require(ev, 'proposal.approve', p);
    else throw new ServiceError(`The Proposal is ${p.state}`, 'conflict');
    const c = concurrentChanges(p).find((x) => x.taskId === taskId);
    if (!c) throw new ServiceError('There is nothing to pick for this task', 'invalid');
    if (!c.users.includes(keep)) throw new ServiceError(`${keep} did not change this task`, 'invalid');
    const at = new Date(this.now()).toISOString();
    const next: ProposalRecord = {
      ...p, picks: [...(p.picks ?? []), { taskId, keep, groups: c.groups, by: userId, at, seq: p.changes.length }],
      history: [...p.history, { at, by: userId, action: 'pick', reason: `${taskId}: kept ${keep}'s version` }],
    };
    const applied = applyChanges(this.baseOf(next), effectiveChanges(next));
    if (!applied.ok) throw new ServiceError(`That version no longer applies: ${applied.reason}`, 'conflict');
    this.proposals.set(id, next);
    this.emit({ type: 'proposalChanged', proposal: this.summary(next), actor: userId });
    return this.summary(next);
  }

  /** What refreshing the Proposal onto the newest Current would do, with the choices so far (K16, K17). */
  refreshPreview(userId: string, id: string, choices: Record<string, RefreshChoice> = {}): RefreshPreview {
    const ev = this.requireView(userId);
    const p = this.get(id);
    if (!this.canSee(ev, p)) throw new ServiceError('You may not view this Proposal', 'denied');
    return this.preview(ev, p, choices);
  }

  /**
   * Brings the Proposal up to the newest Current in one step (K17–K19): all overlaps decided, the schedule
   * recalculated, recorded in the history. A clean refresh keeps the lifecycle state; one that needed a
   * choice or adds a scheduling problem moves it back to Draft.
   */
  refresh(userId: string, id: string, choices: Record<string, RefreshChoice>): ProposalSummary {
    this.tick();
    const ev = this.requireView(userId);
    const p = this.get(id);
    if (!this.canSee(ev, p)) throw new ServiceError('You may not view this Proposal', 'denied');
    if (!isOpen(p.state)) throw new ServiceError(`The Proposal is ${p.state}`, 'conflict');
    this.require(ev, 'proposal.refresh', p);
    // Once submitted, someone other than the owner refreshes only as an approver (K19).
    if ((p.state === 'Submitted' || p.state === 'Reviewed') && p.owner !== userId) this.require(ev, 'proposal.approve', p);
    if (p.baseVersion === this.currentVersion) throw new ServiceError('The Proposal is already up to date', 'conflict');
    const pv = this.preview(ev, p, choices);
    if (pv.problem) throw new ServiceError(pv.problem, 'conflict');
    const cur = this.versions.get(this.currentVersion)!.doc;
    const r = rebase(this.baseOf(p), cur, p, choices);
    if (!r.ok) throw new ServiceError(r.reason, 'conflict');
    const at = new Date(this.now()).toISOString();
    // The recalculated schedule goes in as changes of its own, so the Proposal stays consistent (K1).
    const sched = schedule(r.doc);
    const schedChanges: ProposalChange[] = sched.cycle ? [] : sched.changes.map((c) => ({ entity: 'task', op: 'update', id: c.id, fields: { start: c.start, ...(r.doc.tasks.find((t) => t.id === c.id)?.end ? { end: null } : {}) }, by: userId, at }));
    const changes = [...r.changes, ...schedChanges];
    const toDraft = pv.backToDraft && (p.state === 'Submitted' || p.state === 'Reviewed');
    const DAY = 86_400_000;
    const next: ProposalRecord = {
      ...p, changes, picks: [], baseVersion: this.currentVersion,
      beforeRefresh: { changes: p.changes, picks: p.picks, baseVersion: p.baseVersion, state: p.state, phase: p.phase, expiresAt: p.expiresAt, preparingLeftMs: p.preparingLeftMs, historyLength: p.history.length + 1 },
      ...(toDraft ? {
        state: 'Draft' as const, phase: 'preparing' as const, submittedAt: undefined, submittedBy: undefined, reviewedAt: undefined, preparingLeftMs: undefined,
        expiresAt: new Date(this.now() + Math.max(p.preparingLeftMs ?? 0, this.config.limits.reworkMinDays * DAY)).toISOString(),
      } : {}),
      history: [...p.history, { at, by: userId, action: 'refresh', from: p.state, to: toDraft ? 'Draft' : p.state, reason: `from version ${p.baseVersion} to ${this.currentVersion}${r.decided ? `, ${r.decided} overlap${r.decided === 1 ? '' : 's'} decided` : ''}` }],
    };
    const check = applyChanges(this.baseOf(next), next.changes);
    if (!check.ok) throw new ServiceError(`The refresh does not apply: ${check.reason}`, 'conflict');
    this.proposals.set(id, next);
    this.emit({ type: 'proposalRefreshed', proposal: this.summary(next), actor: userId, fromVersion: p.baseVersion, toVersion: this.currentVersion });
    return this.summary(next);
  }

  /** Undoes the last refresh while nothing else has happened since (K17). */
  undoRefresh(userId: string, id: string): ProposalSummary {
    const ev = this.requireView(userId);
    const p = this.get(id);
    if (!this.canSee(ev, p)) throw new ServiceError('You may not view this Proposal', 'denied');
    this.require(ev, 'proposal.refresh', p);
    const b = p.beforeRefresh;
    if (!b || p.history.length !== b.historyLength) throw new ServiceError('There is no refresh to undo', 'conflict');
    const at = new Date(this.now()).toISOString();
    const next: ProposalRecord = {
      ...p, changes: b.changes, picks: b.picks, baseVersion: b.baseVersion, state: b.state, phase: b.phase, expiresAt: b.expiresAt, preparingLeftMs: b.preparingLeftMs,
      beforeRefresh: undefined, history: [...p.history, { at, by: userId, action: 'undoRefresh', to: b.state }],
    };
    this.proposals.set(id, next);
    this.emit({ type: 'proposalChanged', proposal: this.summary(next), actor: userId });
    return this.summary(next);
  }

  private preview(ev: AccessEvaluator, p: ProposalRecord, choices: Record<string, RefreshChoice>): RefreshPreview {
    const base = this.baseOf(p);
    const curV = this.versions.get(this.currentVersion);
    const cur = curV?.doc ?? base;
    const visible = (t: Task | null | undefined) => !t || this.canViewTask(ev, t);
    const incoming = incomingChanges(base, cur).filter((c) => visible(cur.tasks.find((t) => t.id === c.taskId) ?? base.tasks.find((t) => t.id === c.taskId)))
      .map((c) => ({ ...c, by: curV?.by }));
    const overlaps = refreshOverlaps(base, cur, p).filter((o) => visible(o.current ?? o.mine));
    const open = undecided(refreshOverlaps(base, cur, p), choices);
    // Preview with the choices so far; undecided overlaps are shown as "mine" until chosen.
    const filled: Record<string, RefreshChoice> = { ...choices };
    for (const tid of open) filled[tid] = choices[tid] && typeof choices[tid] === 'object' ? { delete: 'mine', ...(choices[tid] as object) } as RefreshChoice : 'mine';
    for (const o of refreshOverlaps(base, cur, p)) if (typeof filled[o.taskId] === 'object') for (const g of o.groups) (filled[o.taskId] as Record<string, 'incoming' | 'mine'>)[g] ??= 'mine';
    const r = rebase(base, cur, p, filled);
    const before = schedule(this.build(p));
    let moved: RefreshPreview['moved'] = [], newIssues: string[] = [], problem: string | null = open.length ? `${open.length} overlapping ${open.length === 1 ? 'task needs' : 'tasks need'} a choice` : null;
    if (!r.ok) problem = r.reason;
    else {
      const after = schedule(r.doc);
      moved = after.changes.filter((c) => visible(r.doc.tasks.find((t) => t.id === c.id))).map((c) => ({ taskId: c.id, name: r.doc.tasks.find((t) => t.id === c.id)?.name ?? c.id, from: r.doc.tasks.find((t) => t.id === c.id)?.start, to: c.start }));
      const had = new Set(before.issues.map((i) => i.message));
      newIssues = after.issues.map((i) => i.message).filter((msg) => !had.has(msg));
      if (after.cycle) problem = after.issues[0]?.message ?? 'The refresh would create a dependency cycle';
    }
    return {
      fromVersion: p.baseVersion, toVersion: this.currentVersion, incoming, overlaps, undecided: open, moved, newIssues,
      backToDraft: overlaps.length > 0 || newIssues.length > 0, problem,
    };
  }
  private openOthers(id: string) { return [...this.proposals.values()].filter((o) => o.id !== id && isOpen(o.state)); }

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
    const r = applyChanges(this.baseOf(p), effectiveChanges(p));
    return r.ok ? r.doc : this.baseOf(p);
  }
  private summaryFor(userId: string, p: ProposalRecord): ProposalSummary {
    const actions = Object.fromEntries((Object.keys(ACTION_PERMISSION) as LifecycleAction[]).map((a) => [a, this.whyNot(userId, p.id, a)]));
    return { ...this.summary(p), actions };
  }
  private summary(p: ProposalRecord): ProposalSummary {
    const { changes, beforeRefresh, ...rest } = p;
    const open = isOpen(p.state);
    return {
      ...rest, changeCount: changes.length, stale: open && p.baseVersion !== this.currentVersion,
      changedTasks: [...new Set(changes.filter((c) => c.entity === 'task').map((c) => c.id))],
      behind: open ? Math.max(0, this.currentVersion - p.baseVersion) : 0,
      conflicts: open ? concurrentChanges(p).length : 0,
      shared: open ? new Set(parallelOverlaps(p, this.openOthers(p.id)).map((o) => o.taskId)).size : 0,
      canUndoRefresh: !!beforeRefresh && p.history.length === beforeRefresh.historyLength,
    };
  }
}

const conflictReason = (n: number) => `${n} ${n === 1 ? 'task was' : 'tasks were'} changed by two people at once; pick a version for ${n === 1 ? 'it' : 'each'} first`;

export const ACTION_PERMISSION: Record<LifecycleAction, Permission> = {
  submit: 'proposal.submit', withdraw: 'proposal.submit', review: 'proposal.review', approve: 'proposal.approve',
  return: 'proposal.return', reject: 'proposal.reject', discard: 'proposal.discard',
};
