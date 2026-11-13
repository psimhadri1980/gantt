# Code review issues

Review of `main` at `5a62b99`.

Every confirmed issue was checked by reading the code; none was run or reproduced. The automated checks (typecheck, lint, package boundaries) and all 223 tests pass.

Coverage is listed at the end.

## Status: all 18 confirmed issues are fixed

- **Regression tests:** `review-fixes.test.ts` in the service, engine, state, proposals and interchange packages covers issues 1–10. Each test fails on the original code and passes with the fix.
- **Checks:** package boundaries, typecheck, lint, all 234 tests and the end-to-end suite pass.
- **Browser check:** the Show and File menu buttons (16–17) were checked in the demo. A second click now closes the menu, and clicking outside still closes it.
- **No dedicated test:** issues 11–15 and 18 are covered only by the full test and end-to-end suites still passing.

What changed for each fix:

- **1–2:** `newFrom` and `restoreVersion` now run every change through the same permission and visibility checks as a normal edit (`checkChanges`). `newFrom` copies the changes as they stand after picks.
- **3:** `summaryFor` drops tasks the viewer may not see from `changedTasks`, `picks` and the pick history.
- **4:** start-to-start (SS) and start-to-finish (SF) links from a summary no longer set its subtasks' latest finish.
- **5:** delete-undo re-creates a subtask listed before its parent without a parent, then sets the parent once the parent exists.
- **6:** `changesBetween` emits creates, then updates, then deletes. A link is dropped only when one of its own ends is deleted.
- **7:** durations are written in whole minutes, and whole days are recognised with a small tolerance.
- **8:** every `<xf>` counts, with format 0 when it has no `numFmtId`.
- **9:** `t="d"` cells are read as ISO dates.
- **10:** `<rPh>` runs are left out.
- **11:** an end-resize checks `duration`. A move only targets another lane when the user may change `parent`.
- **12:** no zoom anchor is set when the level isn't changing.
- **13:** hiding a frozen column lowers the frozen count.
- **14:** every link that crosses blocks is drawn while either end's block is in range.
- **15:** `groups.length > 0`.
- **16–17:** the menu ignores a press on the button that opened it, so that button's own toggle closes the menu.
- **18:** new messages `lockedForReview`, `historyAction`, `separationOfDuties` and `baselineDefaultName`, in English and German.

The "Worth knowing" items below were not changed.

## Security: permissions skipped in the service

1. **"New Proposal from" skips permission checks**: `packages/service/src/service.ts:539` (`newFrom`).
   - It copies another Proposal's `src.changes` into a new Proposal owned by the caller, without the per-change `checkChange` and task visibility checks that `change()` runs (`service.ts:267-274`).
   - Impact: a user who can view someone else's Proposal can submit edits to tasks or fields they aren't allowed to change.
   - It also copies the raw changes rather than the effective ones, so conflicts someone already resolved (picks) come back.
2. **"Restore version" skips the same checks**: `packages/service/src/service.ts:560` (`restoreVersion`).
   - Every change from `changesBetween` is accepted without `checkChange` or a task visibility check.
   - Impact: the Proposal it creates can rewrite tasks or fields the user may not see or edit.
3. **Proposal summaries leak hidden task ids**: `packages/service/src/service.ts:634` (`summary`).
   - `changedTasks`, `picks` and `history` aren't filtered by `canViewTask`.
   - Impact: hidden task ids reach users through `GET /roadmap` and the event stream, although stale and conflict events already filter them out.

## Wrong results and data loss

4. **Critical-path math is wrong for start-based links from a summary task**: `packages/engine/src/scheduler.ts:207-216`.
   - In the backward pass a summary task's duration counts as 0, so for a start-to-start (SS) or start-to-finish (SF) link its latest finish becomes its latest *start*.
   - Its subtasks inherit that limit, so they show negative slack and are wrongly marked critical.
5. **Undoing a delete can fail**: `packages/state/src/operations.ts:108`.
   - The inverse re-creates the deleted tasks in array order. When a subtask sits before its parent in the array, it fails validation (unknown parent) and the whole undo is refused.
   - How it happens: create X, insert P above it, indent X under P, delete P, then undo.
6. **Restoring a version fails when a kept task was moved out of a deleted parent**: `packages/proposals/src/changes.ts:108` (`changesBetween`).
   - Deletes are emitted before updates, and applying a delete removes the whole subtree (`changes.ts:36-41`).
   - Example: the current version has X under P; the old version has X at the root and no P. Restore emits "delete P" (which also removes X) and then "update X", which fails, so the restore is refused.
   - Links between surviving tasks are lost the same way: they're removed with the subtree but are in both versions, so they're never re-created.
7. **The Microsoft Project export rounds durations to whole hours**: `packages/interchange/src/msproject.ts:41`.
   - `PT${Math.round(hours)}H` drops fractional hours, so a 1.5-hour task comes back as 2 hours.
   - With `hoursPerDay: 7.5`, a 1-day task is written as `PT8H` and comes back as an 8-hour task (import at `:130`).
8. **The Excel import maps cell styles to the wrong number format**: `packages/interchange/src/xlsx.ts:51`.
   - The style list only collects `<xf>` entries that have a `numFmtId` attribute, so one without it shifts every later index.
   - Impact: number cells can import as dates (duration `5` becomes `1900-01-04`) and date cells as raw serial numbers.
9. **The Excel import fails on ISO-date cells**: `packages/interchange/src/xlsx.ts:65`.
   - A cell with `t="d"` and a date style gives `+v` = NaN, and `new Date(NaN).toISOString()` throws `RangeError`.
   - Impact: the whole workbook import fails because of one cell.
10. **The Excel import adds phonetic readings to text**: `packages/interchange/src/xlsx.ts:41` and `:63`.
    - Every `<t>` element is joined, including those inside `<rPh>` (Japanese phonetic readings).
    - Impact: `東京` imports as `東京トウキョウ`, which corrupts task names and ids.

## Interface bugs

11. **The drag permission checks look at the wrong field**: `packages/react/src/drag.ts:84` and `:289`.
    - Resizing a bar's end checks `start` permission but saves `duration`.
    - Moving a bar to another lane saves a new `parent` without checking permission on `parent`.
    - The service's own `checkChange` probably rejects these on save (not traced end to end), but the browser still behaves wrongly.
12. **Zooming to the level already showing leaves a stale scroll position**: `packages/react/src/Gantt.tsx:641-652`.
    - `pendingAnchor` is only cleared when `scale` changes, and later zooms reuse the old anchor.
    - How it happens: press `+` at the closest zoom, or click the active zoom button. The next real zoom jumps back to the old position.
13. **Hiding a frozen column freezes one column too many**: `packages/react/src/Gantt.tsx:1425`.
    - `Math.min(frozen, cols.length - 1)` doesn't lower the frozen count when the hidden column was frozen.
    - Example: with 2 frozen columns, hiding the first leaves 2 frozen, so the next column becomes frozen as well.
14. **Links between adjacent row blocks can vanish while scrolling**: `packages/react/src/Gantt.tsx:1500`. Medium confidence.
    - The chart draws rows in blocks of 32. A link from one block into the next is stored only with the upper block.
    - When the upper block scrolls out of the drawn area, the visible end of the link and its arrowhead aren't drawn.
15. **A stray "0" appears in the refresh dialog**: `packages/react/src/together.tsx:184`.
    - `c.groups.length && …` renders `0` as text, so added or removed tasks read like "Task A · Added0".
    - Fix: `c.groups.length > 0 && …`.
16. **The Show menu button reopens its menu instead of closing it**: `packages/react/src/Gantt.tsx:1552`.
    - The menu's close-on-outside-click (`menu.tsx:39`) fires on pointerdown, before the button's own open/close toggle. By the time the click runs, the menu is already closed, so the button opens it again.
17. **The File menu button has the same problem.** Its toggle uses the same pattern.
18. **Some text stays in English when the app uses the German texts**: `packages/react/src/GanttRoot.tsx`.
    - `:238`: the message explaining that a Submitted or Reviewed Proposal is read-only is a hard-coded English sentence.
    - `:451`: history entries show the raw action name (for example "submit") and end with an English "separation of duties enforced/not enforced". `m.action[...]` exists and could be used for the action.
    - `:435`: the suggested baseline name defaults to the English `Version N`, and accepting it saves that text into the data.

## Worth knowing (not confirmed as bugs)

- **Rules scoped to task groups may never match**: `packages/access/src/document.ts:13`, `packages/service/src/service.ts:201`.
  - Nothing seems to give a task a group, so rules using `scope.tasks.groups` would be silently ignored. Medium confidence.
- **Creating a task checks only the create permission**: `packages/access/src/document.ts:63-77`.
  - The fields set on the new task (dates, resources, constraints, parent) aren't checked against their own permissions.
  - Example: a user allowed to create tasks but not to assign resources could create a task with resources already assigned. Whether that's intended hasn't been checked.
- **Anyone can act as any user without a proxy**: `packages/server/src/server.ts:391`.
  - The server takes the user from a `?user=` URL parameter. That's documented as the host's job, but it's only safe behind an authenticating proxy.
- **Short negative lags in hours round to zero**: `packages/engine/src/scheduler.ts:102`.
  - `Math.ceil` makes a lead of less than one working day have no effect. This may be intended rounding.
- **Schedule and resource levelling work from the drawn data**: `packages/react/src/Gantt.tsx:845` and `:1076`.
  - `runSchedule` and `levelRes` read the rendered data rather than the latest document. That only matters in the short window while the worker is still placing a change.
- **The Microsoft Project Finish date may be off by one day**: `packages/interchange/src/msproject.ts:142`. Whether the end day is inclusive hasn't been checked.

## Dropped after checking

- **`NaN` from the Duration and Progress fields:** blank input is ignored (`Details.tsx:124`), and number inputs give an empty string for anything that isn't a number.
- **Esc during a drag counting as a click:** too uncertain, because browsers differ on whether a click fires after a captured drag.
- **Syntax error in `scripts/profile-zoom.mjs`:** `node --check` parses it fine.

## Coverage

- **Read in full:**
  - all source in the engine, state, contract and proposals packages
  - service, access, server and mock
  - interchange
  - React: everything except `i18n.ts` and `messages.de.ts`, which were only partly read
  - the scripts `api-docs`, `bench`, `check-boundaries`, `profile` and `profile-zoom`
- **German texts:** both text files are typed as the full message set, so the compiler guarantees no key is missing.
- **Not read:** `scripts/e2e.mjs`, `scripts/prof-model.ts` and the test files.
