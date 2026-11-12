# @gantt/proposals

The Proposal model, as pure functions: no storage, no I/O, no clock of its own.

| File | Contents |
| --- | --- |
| `lifecycle.ts` | States and actions, `transition`, `whyNot`, deadlines per phase (`DEFAULT_LIMITS`), `expireIfDue`, history |
| `changes.ts` | `applyChanges` (all or nothing; the result must validate), `changesBetween(from, to)`, `diffTasks` |
| `concurrency.ts` | Field groups, `concurrentChanges` (two people changed the same part of a task), `picks`, `parallelOverlaps` (other open Proposals), `refreshOverlaps` and `rebase` (refresh onto a newer Current) |

A Proposal is a list of changes against a base version of Current. Draft → Submitted → (Reviewed) → Approved;
it can be withdrawn, returned or rejected, a Draft can be discarded, and it expires when a phase's time limit
passes. Approving applies the changes to the latest Current; if Current moved on meanwhile, the Proposal is
refreshed first and any task both sides changed is decided field group by field group.
