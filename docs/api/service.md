# @gantt/service

The roadmap service (Current, approved versions and Proposals, with access checks) and the in-memory and HTTP backends the React component uses.

Generated from the TypeScript sources by `npm run docs:api`; do not edit by hand.

15 exports.

## ACTION_PERMISSION

*const* · [packages/service/src/service.ts](../../packages/service/src/service.ts)

```ts
const ACTION_PERMISSION: Record<LifecycleAction, 'view' | 'view.fields' | 'view.baselines' | 'view.resources' | 'view.history' | 'task.create' | 'task.modify.dates' | 'task.modify.progress' | 'task.modify.fields' | 'task.reorder' | 'task.delete' | 'link.create' | 'link.modify' | 'link.delete' | 'schedule.run' | 'constraint.edit' | 'calendar.edit' | 'proposal.create' | 'proposal.edit' | 'proposal.refresh' | 'proposal.submi …
```

## BackendError

*class* · [packages/service/src/backend.ts](../../packages/service/src/backend.ts)

A failed backend request, with the service's error code or 'network' when the server could not be reached.

```ts
export class BackendError extends Error {
  constructor(message: string, readonly code: ServiceError['code'] | 'network')
}
```

## ChangeInput

*type* · [packages/service/src/service.ts](../../packages/service/src/service.ts)

A change as a client sends it; the service stamps who and when.

```ts
export type ChangeInput = Omit<ProposalChange, 'by' | 'at'>;
```

## Concurrency

*interface* · [packages/service/src/service.ts](../../packages/service/src/service.ts)

Flags for the chart and the "Concurrent changes" panel (K8).

```ts
export interface Concurrency {
  inProposal: { taskId: string; name: string; groups: string[]; users: string[]; at: string; versions: { user: string; task: Task | null }[] }[];
  /** Other Proposals are named only to someone allowed to see them (`proposal.viewOthers`); else null ("another Proposal"). */
  parallel: { taskId: string; name: string; groups: string[]; proposal: { id: string; name: string; owner: string } | null }[];
}
```

## GanttBackend

*interface* · [packages/service/src/backend.ts](../../packages/service/src/backend.ts)

How the Gantt talks to whatever holds the roadmap (H4). Every method may refuse with a BackendError,
whose message is shown to the user and whose code tells the component how to react.

```ts
export interface GanttBackend {
  readonly userId: string;
  snapshot(): Promise<Snapshot>;
  proposalDocument(id: string): Promise<RoadmapDocument>;
  versionDocument(version: number): Promise<RoadmapDocument>;
  change(proposalId: string | null, changes: ChangeInput[], name?: string): Promise<ProposalSummary>;
  act(id: string, action: LifecycleAction, reason?: string): Promise<ProposalSummary>;
  newFrom(id: string): Promise<ProposalSummary>;
  /** Concurrent changes and overlaps with parallel Proposals (K7, K8). */
  concurrency(id: string): Promise<Concurrency>;
  /** Keep one user's version of a task changed concurrently (K9). */
  pick(id: string, taskId: string, keep: string): Promise<ProposalSummary>;
  /** What a refresh onto the newest Current would do (K17). */
  refreshPreview(id: string, choices: Record<string, RefreshChoice>): Promise<RefreshPreview>;
  refresh(id: string, choices: Record<string, RefreshChoice>): Promise<ProposalSummary>;
  undoRefresh(id: string): Promise<ProposalSummary>;
  /** Saves a baseline of Current (B1); needs `baseline.save`. */
  saveBaseline(name: string, version?: number): Promise<{ id: string; name: string; version: number }>;
  /** Opens a new Proposal that restores an earlier version (K22). */
  restoreVersion(version: number): Promise<ProposalSummary>;
  /** Live events (proposalStale etc.). Returns an unsubscribe function. */
  subscribe(fn: (e: ServiceEvent) => void): () => void;
}
```

## ProposalSummary

*type* · [packages/service/src/service.ts](../../packages/service/src/service.ts)

What a client sees of a Proposal: everything but the raw change list, which comes with the document.

```ts
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
```

## RefreshPreview

*interface* · [packages/service/src/service.ts](../../packages/service/src/service.ts)

What a refresh would do (K17), with the user's choices so far.

```ts
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
```

## RoadmapService

*class* · [packages/service/src/service.ts](../../packages/service/src/service.ts)

The one place a roadmap changes (K0b): Current is written only by Approve, atomically and checked
against the base version (K23). Everything else is a Proposal. Shared by the mock backend (in the
browser) and the reference server, so both enforce the same rules.

```ts
export class RoadmapService {
  readonly config: ServiceConfig;
  constructor(private readonly opts: ServiceOptions)
  subscribe(fn: (e: ServiceEvent) => void): () => void
  subscribeFor(userId: string, fn: (e: ServiceEvent) => void): () => void
  evaluator(userId: string): AccessEvaluator
  snapshot(userId: string): Snapshot
  proposalDocument(userId: string, id: string): RoadmapDocument
  versionDocument(userId: string, version: number): RoadmapDocument
  change(userId: string, proposalId: string | null, input: ChangeInput[], name?: string): ProposalSummary
  act(userId: string, id: string, action: LifecycleAction, reason?: string): ProposalSummary
  whyNot(userId: string, id: string, action: LifecycleAction): string | null
  saveBaseline(userId: string, name: string, version = this.currentVersion): { id: string; name: string; version: number }
  concurrency(userId: string, id: string): Concurrency
  pick(userId: string, id: string, taskId: string, keep: string): ProposalSummary
  refreshPreview(userId: string, id: string, choices: Record<string, RefreshChoice> = {}): RefreshPreview
  refresh(userId: string, id: string, choices: Record<string, RefreshChoice>): ProposalSummary
  undoRefresh(userId: string, id: string): ProposalSummary
  newFrom(userId: string, id: string): ProposalSummary
  restoreVersion(userId: string, version: number): ProposalSummary
  tick(): void
}
```

## ServiceConfig

*interface* · [packages/service/src/service.ts](../../packages/service/src/service.ts)

How this roadmap's Proposal workflow is configured: whether the submitter may also approve, and the time limits.

```ts
export interface ServiceConfig {
  separationOfDuties: boolean;
  limits: ProposalLimits;
  /** How long before a phase runs out `proposalExpiring` is sent (K2f; default 1 day). */
  expiringLeadMs: number;
}
```

## ServiceError

*class* · [packages/service/src/service.ts](../../packages/service/src/service.ts)

A refused request. `code` lets callers (and the HTTP server) tell no access, a missing permission, an unknown id,
invalid input and a conflict with someone else's change apart.

```ts
export class ServiceError extends Error {
  constructor(message: string, readonly code: 'noAccess' | 'denied' | 'notFound' | 'invalid' | 'conflict')
}
```

## ServiceEvent

*type* · [packages/service/src/service.ts](../../packages/service/src/service.ts)

What the service announces to subscribers: a Proposal moved through its lifecycle or changed, a deadline is
near or passed, a Proposal became stale because another one was approved, or two people changed the same task.
The server forwards these to browsers as server-sent events.

```ts
export type ServiceEvent =
  | { type: 'proposalCreated' | 'proposalDiscarded' | 'proposalSubmitted' | 'proposalWithdrawn' | 'proposalReviewed' | 'proposalReturned' | 'proposalRejected' | 'proposalApproved' | 'proposalChanged'; proposal: ProposalSummary; actor: string; reason?: string }
  | { type: 'proposalExpiring' | 'proposalExpired'; proposal: ProposalSummary; phase: string; expiresAt: string }
  | { type: 'proposalStale'; proposal: ProposalSummary; approvedBy: string; at: string; newVersion: number; changedTasks: string[]; overlapping: string[] }
  /** Two users changed the same field group of a task, here or in a parallel Proposal (K7, H5). */
  | { type: 'concurrentChange'; proposal: ProposalSummary; actor: string; taskIds: string[]; parallel: boolean }
  | { type: 'proposalRefreshed'; proposal: ProposalSummary; actor: string; fromVersion: number; toVersion: number }
  | { type: 'currentChanged'; version: number }
  | { type: 'baselineSaved'; baseline: { id: string; name: string; version: number }; actor: string };
```

## ServiceOptions

*interface* · [packages/service/src/service.ts](../../packages/service/src/service.ts)

What a service is created with: the starting roadmap, how to find a user's access rules, and the workflow settings.

```ts
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
```

## Snapshot

*interface* · [packages/service/src/service.ts](../../packages/service/src/service.ts)

What one user may see of the roadmap: the configuration, Current (filtered for them) and the Proposals visible to them.

```ts
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
```

## httpBackend

*function* · [packages/service/src/backend.ts](../../packages/service/src/backend.ts)

The reference server over HTTP, with server-sent events for live updates.

```ts
export function httpBackend(baseUrl: string, userId: string, fetchImpl: typeof fetch = fetch): GanttBackend
```

## memoryBackend

*function* · [packages/service/src/backend.ts](../../packages/service/src/backend.ts)

The service in the same page: mock mode (M7). Each call is a microtask, like a network round trip.

```ts
export function memoryBackend(service: RoadmapService, userId: string): GanttBackend
```
