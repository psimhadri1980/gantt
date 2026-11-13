# @gantt/proposals

The Proposal model: lifecycle and deadlines, applying and comparing changes, concurrent and parallel change detection, and refresh (rebase).

Generated from the TypeScript sources by `pnpm run docs:api`; do not edit by hand.

39 exports.

## ConcurrentChange

*interface* · [packages/proposals/src/concurrency.ts](../../packages/proposals/src/concurrency.ts)

One task changed by two people at once (K11): which field groups clash, and both versions of each.

```ts
export interface ConcurrentChange {
  taskId: string;
  /** Field groups changed by more than one user (or "delete" against any change). */
  groups: string[];
  users: string[];
  changes: { by: string; at: string; op: ProposalChange['op']; fields?: Record<string, unknown> }[];
}
```

## DEFAULT_LIMITS

*const* · [packages/proposals/src/lifecycle.ts](../../packages/proposals/src/lifecycle.ts)

```ts
const DEFAULT_LIMITS: ProposalLimits
```

## DELETE

*const* · [packages/proposals/src/concurrency.ts](../../packages/proposals/src/concurrency.ts)

A delete conflicts with every other change of the task.

```ts
const DELETE: 'delete'
```

## HistoryEntry

*interface* · [packages/proposals/src/lifecycle.ts](../../packages/proposals/src/lifecycle.ts)

One step in a Proposal's history: when, by whom, which action, and the comment given.

```ts
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
  /** For picks: the task picked. */
  taskId?: string;
}
```

## IncomingChange

*interface* · [packages/proposals/src/concurrency.ts](../../packages/proposals/src/concurrency.ts)

```ts
export interface IncomingChange { taskId: string; name: string; kind: 'added' | 'removed' | 'changed'; groups: string[] }
```

## LifecycleAction

*type* · [packages/proposals/src/lifecycle.ts](../../packages/proposals/src/lifecycle.ts)

The actions that move a Proposal through its lifecycle (each needs its own permission).

```ts
export type LifecycleAction = 'submit' | 'withdraw' | 'review' | 'approve' | 'return' | 'reject' | 'discard';
```

## ParallelOverlap

*interface* · [packages/proposals/src/concurrency.ts](../../packages/proposals/src/concurrency.ts)

A task that this Proposal and another open Proposal both change in the same field group.

```ts
export interface ParallelOverlap { taskId: string; groups: string[]; proposalId: string }
```

## Phase

*type* · [packages/proposals/src/lifecycle.ts](../../packages/proposals/src/lifecycle.ts)

Which part of the workflow a Proposal is in; each phase has its own time limit.

```ts
export type Phase = 'preparing' | 'review' | 'approval';
```

## Pick

*interface* · [packages/proposals/src/concurrency.ts](../../packages/proposals/src/concurrency.ts)

A choice between the versions of one task inside a Proposal (K9). Settles the changes made before it.

```ts
export interface Pick {
  taskId: string;
  /** The user whose version is kept. */
  keep: string;
  /** The field groups that were in conflict. */
  groups: string[];
  by: string;
  at: string;
  /** Number of changes in the Proposal when the pick was made: it settles changes before this index. */
  seq: number;
}
```

## ProposalLimits

*interface* · [packages/proposals/src/lifecycle.ts](../../packages/proposals/src/lifecycle.ts)

The four time limits in whole days (K2g).

```ts
export interface ProposalLimits { draftDays: number; reviewDays: number; approvalDays: number; reworkMinDays: number }
```

## ProposalRecord

*interface* · [packages/proposals/src/lifecycle.ts](../../packages/proposals/src/lifecycle.ts)

A Proposal as the service stores it: identity, owner, state, the version it is based on, its changes,
its deadlines and history, and what it looked like before the last refresh (for undoing that refresh).

```ts
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
```

## ProposalState

*type* · [packages/proposals/src/lifecycle.ts](../../packages/proposals/src/lifecycle.ts)

Lifecycle states (plan section 3a).

```ts
export type ProposalState = 'Draft' | 'Returned' | 'Submitted' | 'Reviewed' | 'Approved' | 'Rejected' | 'Expired' | 'Discarded';
```

## RefreshChoice

*type* · [packages/proposals/src/concurrency.ts](../../packages/proposals/src/concurrency.ts)

Per task: one answer for every overlapping group, or one per group when expanded (K17).

```ts
export type RefreshChoice = 'incoming' | 'mine' | Record<string, 'incoming' | 'mine'>;
```

## RefreshOverlap

*interface* · [packages/proposals/src/concurrency.ts](../../packages/proposals/src/concurrency.ts)

A task that a refresh brings in a change for while this Proposal changes it too, with both versions per group.

```ts
export interface RefreshOverlap {
  taskId: string;
  name: string;
  /** Field groups changed on both sides ("delete" when one side deleted the task). */
  groups: string[];
  /** The task in the newer Current, and in the Proposal (null when deleted on that side). */
  current: Task | null;
  mine: Task | null;
}
```

## TaskDiff

*interface* · [packages/proposals/src/changes.ts](../../packages/proposals/src/changes.ts)

How one task differs between two versions: added, removed, or changed (with the changed fields).

```ts
export interface TaskDiff { id: string; kind: 'added' | 'removed' | 'changed'; fields: string[] }
```

## TransitionContext

*interface* · [packages/proposals/src/lifecycle.ts](../../packages/proposals/src/lifecycle.ts)

Who is acting, when, why, and the settings that apply, for one lifecycle transition.

```ts
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
```

## TransitionResult

*type* · [packages/proposals/src/lifecycle.ts](../../packages/proposals/src/lifecycle.ts)

The new Proposal after a transition, or the reason it is not allowed.

```ts
export type TransitionResult = { ok: true; proposal: ProposalRecord } | { ok: false; reason: string };
```

## applyChanges

*function* · [packages/proposals/src/changes.ts](../../packages/proposals/src/changes.ts)

Applies a Proposal's changes to a version of Current, all or nothing (K23): the result must pass the
same validation as any loaded roadmap, or nothing is applied. Deleting a task deletes its subtree and
every link touching it.

```ts
export function applyChanges(base: RoadmapDocument, changes: ProposalChange[]): { ok: true; doc: RoadmapDocument } | { ok: false; reason: string }
```

## changesBetween

*function* · [packages/proposals/src/changes.ts](../../packages/proposals/src/changes.ts)

The changes that turn one version of a roadmap into another, for tasks and links (K22: restoring an
earlier version opens a Proposal with these). Removed fields become null; parents are created before
their children; a deleted subtree is deleted once, at its top.

```ts
export function changesBetween(from: RoadmapDocument, to: RoadmapDocument): Omit<ProposalChange, 'by' | 'at'>[]
```

## checkLimits

*function* · [packages/proposals/src/lifecycle.ts](../../packages/proposals/src/lifecycle.ts)

Checks the configured time limits; returns the problem, or null when every limit is a positive whole number of days.

```ts
export function checkLimits(l: ProposalLimits): string | null
```

## concurrentChanges

*function* · [packages/proposals/src/concurrency.ts](../../packages/proposals/src/concurrency.ts)

Tasks two or more users changed in the same field group inside one Proposal, not yet settled by a pick
(K7). Changes to different field groups of one task are simply combined.

```ts
export function concurrentChanges(p: WithChanges): ConcurrentChange[]
```

## createProposal

*function* · [packages/proposals/src/lifecycle.ts](../../packages/proposals/src/lifecycle.ts)

A new Draft Proposal, with the preparation deadline counted from now.

```ts
export function createProposal(p: { id: string; name: string; roadmapId: string; owner: string; baseVersion: number; now: number; limits: ProposalLimits; derivedFrom?: string; changes?: ProposalChange[] }): ProposalRecord
```

## diffTasks

*function* · [packages/proposals/src/changes.ts](../../packages/proposals/src/changes.ts)

What differs between two versions of a roadmap, per task (K4).

```ts
export function diffTasks(a: RoadmapDocument, b: RoadmapDocument): TaskDiff[]
```

## effectiveChanges

*function* · [packages/proposals/src/concurrency.ts](../../packages/proposals/src/concurrency.ts)

The changes as they take effect: for each pick, the other users' changes to the conflicting groups of that
task (made before the pick) are left out (K9: one version per task, no field-by-field merge).

```ts
export function effectiveChanges(p: WithChanges): ProposalChange[]
```

## expireIfDue

*function* · [packages/proposals/src/lifecycle.ts](../../packages/proposals/src/lifecycle.ts)

Closes an open Proposal whose phase limit has passed (K2e). Returns the same object when nothing changed.

```ts
export function expireIfDue(p: ProposalRecord, now: number): ProposalRecord
```

## fieldGroup

*function* · [packages/proposals/src/changes.ts](../../packages/proposals/src/changes.ts)

Field groups for comparison (K7): schedule, position, and each other field on its own.

```ts
export function fieldGroup(field: string): string
```

## groupsOf

*function* · [packages/proposals/src/concurrency.ts](../../packages/proposals/src/concurrency.ts)

The field groups a change touches. A create touches nothing (only its creator knows the task).

```ts
export function groupsOf(c: ProposalChange): string[]
```

## incomingChanges

*function* · [packages/proposals/src/concurrency.ts](../../packages/proposals/src/concurrency.ts)

What changed in Current between two versions, per task and field group.

```ts
export function incomingChanges(from: RoadmapDocument, to: RoadmapDocument): IncomingChange[]
```

## isEditable

*const* · [packages/proposals/src/lifecycle.ts](../../packages/proposals/src/lifecycle.ts)

True while the owner can still edit the Proposal's changes.

```ts
const isEditable: (s: ProposalState) => s is 'Draft' | 'Returned'
```

## isOpen

*const* · [packages/proposals/src/lifecycle.ts](../../packages/proposals/src/lifecycle.ts)

True while a Proposal can still change state (not approved, rejected or discarded).

```ts
const isOpen: (s: ProposalState) => s is 'Draft' | 'Returned' | 'Submitted' | 'Reviewed'
```

## parallelOverlaps

*function* · [packages/proposals/src/concurrency.ts](../../packages/proposals/src/concurrency.ts)

Tasks this Proposal changes in the same field group as other open Proposals (K7: a warning, K9).

```ts
export function parallelOverlaps(p: WithChanges & { id: string }, others: (WithChanges & { id: string })[]): ParallelOverlap[]
```

## rebase

*function* · [packages/proposals/src/concurrency.ts](../../packages/proposals/src/concurrency.ts)

The Proposal's changes rewritten onto the newer Current (K17): changes without overlap stay; on an overlap
"incoming" drops the Proposal's change to that group and "mine" keeps it. Keeping a change to a task that
Current deleted re-creates the task as the Proposal has it. All or nothing: the result must be valid.

```ts
export function rebase(base: RoadmapDocument, current: RoadmapDocument, p: WithChanges, choices: Record<string, RefreshChoice>):
  { ok: true; changes: ProposalChange[]; doc: RoadmapDocument; decided: number } | { ok: false; reason: string }
```

## recordChanges

*function* · [packages/proposals/src/lifecycle.ts](../../packages/proposals/src/lifecycle.ts)

Records changes in an editable Proposal (K21: a locked one refuses).

```ts
export function recordChanges(p: ProposalRecord, changes: ProposalChange[], actor: string, now: number): TransitionResult
```

## refreshOverlaps

*function* · [packages/proposals/src/concurrency.ts](../../packages/proposals/src/concurrency.ts)

Where the Proposal and the newer Current changed the same field group of a task (K17).

```ts
export function refreshOverlaps(base: RoadmapDocument, current: RoadmapDocument, p: WithChanges): RefreshOverlap[]
```

## touched

*function* · [packages/proposals/src/concurrency.ts](../../packages/proposals/src/concurrency.ts)

The field groups each task is changed in by a Proposal (after picks).

```ts
export function touched(p: WithChanges): Map<string, Set<string>>
```

## transition

*function* · [packages/proposals/src/lifecycle.ts](../../packages/proposals/src/lifecycle.ts)

Applies a lifecycle action, moving the clocks as K2e/K2f describe. Approval itself is applied by the service.

```ts
export function transition(p: ProposalRecord, action: LifecycleAction, ctx: TransitionContext): TransitionResult
```

## undecided

*function* · [packages/proposals/src/concurrency.ts](../../packages/proposals/src/concurrency.ts)

Overlaps that still need an answer (K17a: none may be left undecided).

```ts
export function undecided(overlaps: RefreshOverlap[], choices: Record<string, RefreshChoice>): string[]
```

## versionOf

*function* · [packages/proposals/src/concurrency.ts](../../packages/proposals/src/concurrency.ts)

One user's version of a task in a Proposal (its base plus that user's settled view), for side-by-side display.

```ts
export function versionOf(base: RoadmapDocument, p: WithChanges, taskId: string, user: string): Task | null
```

## whyNot

*function* · [packages/proposals/src/lifecycle.ts](../../packages/proposals/src/lifecycle.ts)

Checks whether an action is possible now, without permissions (the service checks those). Returns the
reason it is not, for explained controls (F14).

```ts
export function whyNot(p: ProposalRecord, action: LifecycleAction, ctx: Omit<TransitionContext, 'limits' | 'now'> & { now?: number }): string | null
```
