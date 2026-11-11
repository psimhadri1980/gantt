# Gantt Chart Feature Plan

A vendor-neutral list of the features a full-featured project Gantt chart should offer, with a phased plan for building them.

Revision 5 (2026-11-11). Revision 2 reviewed the plan against the objective below; revision 4 records the decision to build it as a native React component (section 0a), after a Web Component was considered and set aside; revision 5 is a final pass; revision 6 adds selection, the details panel and host-defined kinds (section 3c); revision 7 adds several bars on one row (A6); revision 8 renames Draft to Roadmap Proposal and makes expiry run by phase. The first text is kept in `Gantt-Feature-Plan.v1-original.md`. What changed and why is in section 7. Feature ids from revision 1 are unchanged; new features have new ids.

---

## 0. Objective and how it is measured

**Objective: an extraordinary, flexible and user-intuitive Gantt.** Each word is turned into checks that every phase must pass.

| Quality | What it means here | How it is checked |
|---|---|---|
| Intuitive | The user changes the plan by touching it, sees the result before committing, and is never left guessing | Live preview while dragging (D17); every edit can be undone (F8); every disabled control says why (F14); every pointer action has a keyboard equivalent (F9); save state is always visible (F13); anything visible can be selected and shows its details (F15, F6) |
| Flexible | The host shapes it without forking it | Columns, scales, templates, views, calendars, permissions and Proposal time limits are configuration (D18, F12, G2, G7, L1, K2g); the host defines its own kinds of rows, bars and connectors and what their details show (F16); no hard-coded roles; the scheduling engine is usable without the interface (C11) |
| Extraordinary | It stays fast, safe and accessible at a size where others degrade | Performance budget (Phase 1) kept by every phase; Current can only change through Approve (K0b); WCAG 2.2 AA (F9); conflicts are explained and fixable (C5) |

Assumption: this is a new, reusable component with a small reference server, not an extension of one application's existing chart. "Host" means the consuming application.

## 0a. Technology and packaging (decided)

The Gantt is a **native React component** with TypeScript types. A Web Component with generated wrappers was considered and set aside, because the only consumers are React applications. The reasoning and evidence are in `ADR-001-Web-Component-vs-React.md`.

| Package | Content | Depends on |
|---|---|---|
| engine | Scheduling engine (C11) | nothing |
| access | Rule schema and evaluator (L10) | nothing |
| contract | JSON Schema, types, validation (M3) | nothing |
| proposals | Change sets, the lifecycle state machine, overlap detection and the refresh merge (section K) | contract |
| state | The chart's state and layout calculations (rows, time axis, bar positions), with no rendering | engine, proposals, access, contract |
| react | The `<Gantt>` component: rendering and interaction only | React, state |
| mock | Mock loader, samples, generator (M5); runs the Proposal lifecycle in memory | contract, proposals |
| server | Reference server | engine, proposals, access, contract |

How the component meets its host:
- **Data in by props, changes out by callback props** (for example `onProposalStale`). Each callback event in this plan is one such prop.
- **Interception.** A callback can refuse an operation before it happens; checks that need to wait (the authorisation hook, L5) may return a promise.
- **Custom content** is written as ordinary React components: templates for cells, bars and tooltips (G7), details for each kind of row, bar and connector (F16), and replaceable parts such as the toolbar, the empty state and the no-access state.
- **Styling** is by CSS variables (G11) and prefixed class names. There is no shadow DOM, so the Gantt uses no global selectors and does not depend on the host's CSS reset.
- **Fast paths bypass React.** Scrolling, zooming and dragging move things directly and do not re-render the component tree on every frame.
- **Menus, tooltips and dialogs** open in the browser's top layer, so a host container with clipped overflow cannot cut them off.

The five packages without React (engine, access, contract, proposals, state) hold all the logic. The server uses the same engine, Proposal logic and access evaluator, so the browser and the server cannot disagree, and a second rendering layer for another framework could be built on them if one is ever needed.

Supported: current evergreen browsers; React 18 and 19 (confirmed).

---

## 1. Feature catalogue

### A. Project planning
- A1 Summary tasks and milestones
- A2 Task dependencies, displayed and editable
- A3 Hierarchical tree of sub-tasks (expand and collapse)
- A4 Unscheduled tasks (listed without dates)
- A5 Rollups (children shown on the summary bar)
- A6 Lane rows (several bars on one row): a row can be shown as a lane, where its children are drawn as full bars on the row itself and have no rows of their own (for example one crew's row carrying all its deliverables). Each bar is still its own item, with its own kind, dates, connectors, selection and details. Bars that overlap in time are stacked within the row, which grows taller to fit. The user can open a lane into ordinary rows and close it again. Grouping (D11) can show each group as a lane

### B. Project tracking
- B1 Baselines (planned vs actual vs saved plan)
- B2 S-curve (planned, actual and baseline progress over time)
- B3 Progress line (which tasks are ahead or behind on a chosen date)
- B4 Slack (float) visualisation

### C. Scheduling engine
- C1 Auto-scheduling for all four dependency types (FS, SS, FF, SF) with lag
- C2 Critical path
- C3 Six constraint types (start/finish no earlier than, start/finish no later than, must start on, must finish on), in addition to the default "as soon as possible"
- C4 Deadlines with late warnings
- C5 Conflict list with explanations and one-click fixes (each fix is applied in the Proposal and can be undone)
- C6 Manual and inactive task modes
- C7 Working-day calendar (weekends, holidays; non-linear time scale)
- C8 Individual calendars per task
- C9 Circular dependencies and invalid links (a summary to its own child, a task to itself) are detected and prevented while the link is being drawn, with the reason shown
- C10 Scheduling runs forward from the roadmap start date; tasks default to "as soon as possible"
- C11 One engine, two places: the same engine package runs in the browser (off the main thread, for instant preview) and on the server (authoritative result). It has no interface dependency and can be used on its own
- C12 Summary task dates and progress are derived from their children and cannot be edited directly

### D. Task management and editing
- D1 Drag and resize bars on the chart
- D2 Drag rows in the grid to reorder
- D3 Add tasks through an action column
- D4 Placeholder row for quick entry
- D5 Add tasks by dragging from a backlog
- D6 Edit dependencies and progress directly on the chart
- D7 Inline grid editing and a standalone edit form
- D8 Context menu and toolbar with common operations
- D9 Sort by clicking column headers
- D10 Task filtering
- D11 Task grouping
- D12 Split tasks
- D13 WBS codes
- D14 Multi-select (click, shift, ctrl, lasso) with bulk move, delete and field change
- D15 Copy, cut, paste and duplicate tasks, including their sub-tasks and internal links
- D16 Indent and outdent to change a task's level
- D17 Live drag feedback: the bar snaps to the scale unit, a tooltip shows the new dates, dependent tasks preview their new position, the view scrolls at the edges, and Esc cancels
- D18 Column configuration: show, hide, reorder, resize and freeze columns; host-defined custom fields as columns
- D19 Find a task by name or id and jump to it

### E. Resource management
- E1 Assign resources to tasks
- E2 Assign by drag and drop
- E3 Resource load chart
- E4 Resource histogram highlighting over-allocated people and periods
- E5 Individual resource calendars (days off, part-time)
- E6 Resource-driven scheduling
- E7 Default demand: when no resource data is provided, every task counts as a demand of 1 FTE for its working days. The load chart then shows total demand per period (and per owner or group where known). Over-allocation is highlighted only where a capacity exists: a named resource's capacity, or an optional roadmap-level default capacity

### F. User experience
- F1 Tooltips for tasks and links
- F2 Zoom with default and custom levels
- F3 Keyboard shortcuts
- F4 Resize, hide and show chart and grid
- F5 Compact mode for small screens
- F6 Details panel: a panel beside or below the chart that shows the details of whatever is selected (row, bar or connector) and follows the selection. It does not block the chart. It is read-only for viewers and becomes the edit form (D7) where the user may edit. The Gantt ships a default view for each built-in type (section 3c); with several items selected it shows a summary of them. The host can dock it right or bottom, or switch it off and show its own
- F7 Vertical markers
- F8 Undo and redo: per Proposal and per user; a user undoes only their own operations
- F9 Accessibility to WCAG 2.2 AA: tree-grid semantics for screen readers, a keyboard equivalent for every pointer action (move, resize, link, reorder), managed focus, announced changes, sufficient contrast in both themes, reduced motion respected
- F10 Touch and pen support (tablet): tap, long-press menu, drag handles sized for fingers, pinch zoom
- F11 Navigation: scroll to today, scroll to a task, fit the roadmap to the view, pan by dragging the timeline, zoom with ctrl + wheel around the pointer
- F12 Saved views: filter, grouping, sort, columns and zoom stored as a named view; the host persists them and may share them (for example in the URL)
- F13 Loading, empty and error states, and a save indicator ("Saving", "Saved", "Not saved: reason")
- F15 Selection: a row, a bar or a connector can be selected by click, tap or keyboard. On an ordinary row, the row and its bar are one item and highlight together; on a lane row (A6) each bar is selected on its own, and the row itself is a separate item. A selected connector also marks the two tasks it joins. Selection is separate from keyboard focus, is announced to screen readers, survives scrolling and switching between Current and a Proposal, and is reported to the host (`selectionChanged`). The host can also set it. Connectors, which are hard to reach by pointer or keyboard, have a widened hit area and can also be selected from the dependency list in a task's details
- F16 Kinds: the host defines its own kinds of rows (for example initiative, use-case, milestone, application or platform, crew, task), of bars and of connectors, each with a label, an icon, and its own details. A host can leave the default details, adjust them (add, hide or reorder sections and fields), or replace them with its own component. Kinds are also available to templates, filters and grouping. An item without a kind, or with a kind the host has not defined, gets the default
- F14 Explained controls: a control the user cannot use shows why (missing permission, Proposal is stale, Proposal is locked for review, task is a summary)

### G. Configuration
- G1 Scale width, height and borders
- G2 Custom scale lines and units
- G3 Fixed or flexible scale boundaries
- G4 Duration units: hour and day
- G5 Length units from minute to year
- G6 Highlight weekends and holidays
- G7 Templates for grid cells, task bars and tooltips, written as React components
- G8 Fullscreen mode
- G9 Read-only mode
- G10 Light and dark themes
- G11 Styling with CSS variables and stable, prefixed class names for the pieces a host may restyle
- G12 Localization
- G13 Time zones: each roadmap has one time zone; dates are shown in it for every user; daylight-saving changes do not shift durations
- G14 Locale formats: date and number formats, first day of the week, right-to-left layout

### H. Data handling and performance
- H1 Fast with large data sets (virtualised rows)
- H2 Dynamic loading of sub-tasks
- H3 API to listen to, intercept and run data operations: callback props to listen and to intercept, and an imperative handle (ref) to run
- H4 Helper for binding to a backend
- H5 Real-time updates from the server
- H6 Virtualised time axis and dependency lines: only the visible period and the links that cross it are drawn
- H7 Optimistic updates: an edit shows at once and is rolled back, with the reason, if the server refuses it
- H8 Proposal autosave: every change in a Proposal is saved without a Save button

### I. Import and export
- I1 Import from Excel and CSV
- I2 Export to PDF and PNG
- I3 Export to Excel
- I4 MS Project import and export

### J. Developer platform
- J1 Native React component with TypeScript types
- J2 Server-side rendering support: in a server-rendered React application (for example Next.js) the grid and the first screen of the chart are rendered on the server for a given initial size, and become interactive in the browser without a layout jump
- J3 Integration with state-management libraries (for example Redux, Zustand, MobX): the component is controlled by props and reports changes through callbacks
- J4 Embeddable and reusable: several charts can sit on one page without sharing state
- J5 Structured API reference for AI-assisted coding, generated from the TypeScript types
- J6 Live example gallery built from the bundled mock samples

### K. Roadmap Proposals (scenarios) and their lifecycle

A **Roadmap Proposal** (Proposal for short) is a proposed set of changes to a roadmap, or a proposed new roadmap. It is in the **Draft** state while it is being prepared, and stays a Proposal through submission, review and approval. "Draft" in this plan always means that state, never the thing itself.

**Proposal-first**
- K0 Proposal-first rule: every change starts as a Roadmap Proposal and never alters the existing (Current) roadmap. This covers a brand-new roadmap, any update to tasks, dates, dependencies, resources or settings, auto-scheduling results, and imports
- K0a A new roadmap exists only as a Proposal until approved; it does not appear in the Current view before that
- K0b The Current roadmap is read-only to editing and scheduling actions; the only way to change it is Approve
- K0c A Proposal is created on the first change, not on opening. A user viewing Current who starts to edit gets a new Proposal (or, if they have open Proposals, a choice: continue the most recent, pick another, or start new). The chart shows clearly which Proposal is being edited. Nobody edits Current by accident, and no empty Proposals are left behind: a Proposal whose changes have all been undone is removed when the user leaves it
- K1 Auto-scheduling applies computed dates inside a Proposal

**Lifecycle**
- K2 Lifecycle states: Draft, Submitted, Reviewed, Approved, plus Returned, Rejected and Expired (state table in section 3a). Each transition is guarded by one permission: Draft to Submitted `proposal.submit`; Submitted to Reviewed `proposal.review`; Reviewed to Approved `proposal.approve`, which promotes the Proposal to Current. Review is optional: a Proposal can go from Submitted straight to Approved, and a host may grant `proposal.approve` without `proposal.review`
- K21 A Submitted or Reviewed Proposal is locked: nobody can edit it, so what is approved is exactly what was reviewed. The only things still allowed are the approver's choice between two recorded versions (K9) and a clean refresh (K19). The submitter can Withdraw it (back to Draft) to make changes
- K2d Returned and Rejected: a reviewer (`proposal.return`) or approver (`proposal.reject`, `proposal.return`) can send a Submitted or Reviewed Proposal back. Returned: it goes back to the author as an editable Proposal with the reason attached; the author can fix it and submit again. Rejected: closed with a reason; it cannot be edited, submitted, approved or reopened. Its only use is as the starting point of a new Proposal ("New Proposal from rejected"), which copies its changes, starts its own clocks from its own creation, and keeps a link back. The reason is mandatory and is recorded in the history
- K2e Expiry by phase: a Proposal that is not approved expires when the time limit of the phase it is in runs out. Preparing (states Draft and Returned): the draft lifetime, counted from creation. Review (state Submitted): the review limit, counted from submission; within it the Proposal must be reviewed, or approved where review is skipped. Approval (state Reviewed): the approval limit, counted from the review. Expired Proposals are closed (state Expired), cannot be submitted or approved, stay in the history, and the author can start a new Proposal from them. There is no limit on the number of open Proposals per roadmap or per user
- K2f How the clocks run: the preparing clock is set at creation and is not extended by later changes or by a refresh. It stops while the Proposal is Submitted or Reviewed, and resumes with the time that was left when the Proposal is Returned or Withdrawn. A Returned Proposal gets at least the rework minimum: if less time than that was left, it is given the minimum. A Withdrawn one gets only what was left, because withdrawing is the author's own choice and a minimum there would let a Proposal be kept alive for ever by submitting and withdrawing it. So a Proposal submitted on its last day is not lost while it waits: review and approval have their own time. Each submission starts a fresh review clock and each review a fresh approval clock; a refresh restarts none of them. The date on which the current phase runs out is shown on the Proposal, and the `proposalExpiring` event warns the host before it passes (lead time configurable, default 1 day), saying which phase
- K2g The four limits are configurable by the host in whole days: draft lifetime (default 7), review limit (default 2), approval limit (default 2), rework minimum after a return (default 2). Each must be a positive whole number. A change applies to phases entered afterwards; a phase already running keeps the date it was given
- K2a Separation of duties, controlled by an environment variable (see section 4): when enforced, the user who submitted a Proposal, and any user who made changes in it, cannot review or approve it; when not enforced, the same user may submit and approve, so the lifecycle can be tested quickly with one account
- K2b The check is made by the server (and mirrored in the interface by disabling Approve with the reason), so it cannot be bypassed by calling the API directly
- K2c The Proposal history records who submitted and who approved, and whether the rule was enforced at that moment
- K3 Switch between Current (live plan) and any Proposal at any time
- K4 Side-by-side comparison of Current vs a Proposal (moved bars, changed dates, new conflicts)
- K5 Approve promotes a Proposal to Current; Discard deletes a Proposal that is not yet approved. Until approval the Current roadmap is unchanged and other users keep seeing it
- K23 Approval is atomic and checked against the base version: the server applies all of a Proposal's changes or none, and refuses if Current has moved on since the Proposal's base
- K6 History of who created, changed, submitted, reviewed and approved a Proposal
- K22 Every approval creates a numbered version of Current. Earlier versions can be viewed and compared, and restored only by opening a new Proposal from them
- K14 All notifications are delivered only through host callbacks. The component renders no banners, toasts, emails or messages of its own; it emits events and the host decides how to tell people. The component shows state where the user is working (a "stale" badge, the reason next to a disabled button, a validation message next to a field, the save indicator); these are state, not notifications. An optional, separately imported reference notifier is provided for hosts that want a ready-made one

**Several people, several Proposals**
- K10 Parallel Proposals: any number of Proposals of the same roadmap can be open at the same time, each with its own name, owner and lifecycle state
- K11 A Proposal list per roadmap showing owner, state, age, expiry, number of changes, and number of tasks it shares with other Proposals
- K7 Concurrent-change detection: a task is flagged when two or more users change the same field group of it in one Proposal, or when two or more parallel Proposals change the same field group of it. Field groups are: schedule (start, end, duration, constraint), position (parent and order), and each other field on its own. Changes to different field groups of one task do not conflict and are simply combined. Deleting a task conflicts with any other change to it
- K8 The flag is shown to every user who can see the Proposal. It names the other Proposal or user only to someone allowed to see that Proposal (`proposal.viewOthers`); anyone else sees "another Proposal". It is highlighted on the bar and grid row, and listed in a "Concurrent changes" panel with who changed what and when
- K9 Inside one Proposal, both versions of a flagged task are kept until someone picks one version for that task (no field-by-field merge). Any editor can pick before submission; anything still open must be picked by the approver, and Approve is disabled until none remain. A pick is recorded in the history and does not count as changing the Proposal for separation of duties (K2a). Flags against other Proposals are warnings only: they need no choice, because they are settled when one of the Proposals is approved (K12)
- K12 When a Proposal is approved, every other open Proposal of that roadmap is marked "Current has changed" and its tasks that overlap the approved changes are flagged; the owner is told and must refresh the Proposal before it can be approved
- K13 Approval order decides: Proposals are approved one at a time, and a Proposal that is out of date against Current cannot be approved until refreshed
- K15 When a newer version of Current exists, a `proposalStale` event is emitted for every open Proposal that is now out of date, immediately and without a reload. It carries what changed: who approved, when, which tasks changed, and which of them overlap this Proposal's own changes, limited to what the receiving user may view
- K16 A visible "Refresh Proposal" action (button in the Proposal menu and in the Proposal list, guarded by `proposal.refresh`) brings the Proposal up to the newer Current in one step
- K17 Refresh behaviour: the Proposal's base moves to the newest Current. Incoming changes that the Proposal did not touch are always taken. Where both sides changed the same field group of a task, the two versions are shown side by side ("Current" vs "Your Proposal") and the user picks one per task, or per field if they expand it. A task deleted on one side and changed on the other counts as an overlap. The schedule is then recalculated, and tasks that move or conflict as a result are shown too. The refresh is a preview first, takes effect only on confirmation, and can be cancelled or undone
- K17a Choices in the preview: Accept incoming or Keep mine for each overlap, with Accept all incoming and Keep all mine as shortcuts. Overlaps cannot be left undecided. Incoming changes without overlap are listed for information; they cannot be declined in the refresh (to reverse one, edit the task in the Proposal afterwards, where it is a visible change of its own)
- K17b After the refresh the Proposal is based on the newer Current; a later refresh only shows what is newer than this one
- K17c The preview can be left and resumed with the choices kept, but the refresh is applied in one step, so a Proposal is never half-refreshed
- K18 After refresh the Proposal is marked up to date, the stale status clears, and the history records the refresh (who, from which version to which)
- K19 A stale Proposal can still be viewed, edited and submitted, but not approved; the reason and the Refresh action are shown where Approve would be. A refresh with no overlaps and no new scheduling conflicts keeps the Proposal's lifecycle state (a Submitted Proposal stays Submitted, and anyone with `proposal.refresh` and `proposal.approve` can do it). A refresh that needed a choice or produced a new conflict moves the Proposal back to the Draft state, so its author submits it again
- K20 Several newer versions can arrive in a row; the stale status shows the number of newer versions (and a new `proposalStale` event is emitted for each), and one Refresh brings the Proposal to the latest

### L. Access control, externally configured
- L1 The Gantt takes its access rules from a configuration supplied by the consuming application; the component ships no hard-coded roles
- L2 Fine-grained: named permissions on actions, data and scope (see section 3)
- L3 The rules are plain data and/or come from a callback, so they can come from the host's identity system, a file or a service, and can change at runtime without a rebuild
- L4 The component enforces the configuration in the interface: controls the user cannot use are disabled with the reason (F14) or hidden, as the host chooses; hidden fields are not rendered
- L5 The component calls an authorisation hook before every data operation and passes the result to the host. The host's backend remains the real enforcement point (the interface alone is not security)
- L6 No view permission on the project means no Gantt: nothing is fetched or rendered, and a configurable "no access" state is shown instead
- L7 Denials are reported to the host (event/callback) for audit and messaging
- L8 Safe default: with no configuration supplied, access is denied
- L9 The server is the single source of truth: it evaluates every request against the rules. The component uses the same rules only to decide what to show, and accepts the server's answer when the two differ (the edit is rolled back, H7)
- L10 One schema and one evaluator: the rules are a shared, serialisable schema, and a shared evaluator package is used by both the server and the component, so both reach identical decisions
- L11 Configuration is delivered both ways: as static data (for example a file or a fixed object) and through a resolver callback evaluated per user and per request; when both exist, the resolver's result takes precedence for the fields it returns
- L12 The server filters what it sends: tasks and fields the user may not view never reach the browser, in data, in events and in real-time updates alike
- L13 Decisions are computed once per rule set and cached per task, so permissions do not slow a large chart

### M. Mock data rendering
- M1 The Gantt can render a roadmap from a mock JSON file or object, with no back end, so it can be developed, demonstrated, tested and reviewed on its own
- M2 The JSON follows a predefined, versioned contract (section 3b): roadmap, tasks, links, and optionally Proposals, resources, calendars and the access configuration
- M3 The contract is published as a JSON Schema and TypeScript types; the same schema is used to validate real data, so mock and real data take the same path into the component
- M4 Validation on load: invalid JSON is rejected with clear errors that give the path and the reason (for example `tasks[12].start: not a date`); unknown contract versions are refused
- M5 Mock mode is switched on explicitly and is off by default. The mock loader is a separate import, so a production bundle that does not import it cannot enter mock mode at all. Where a server exists, it must also allow it (`GANTT_ENABLE_MOCK_DATA=true`), and it is refused when the environment is identified as production
- M6 Mock mode still honours the access configuration (M2 allows it in the JSON), so permission scenarios, including "no view means no Gantt", can be demonstrated with mock data
- M7 Proposals and their lifecycle (submit, review, approve, return, reject, expire, stale, refresh) work against the mock data in memory, with the callback events fired as in real use and a clock the test can move, so expiry can be shown; changes are not persisted unless the host asks for an export
- M8 Export the current mock state back to JSON in the same contract
- M9 Bundled sample files: small (about 20 tasks), medium, a large generated set (10,000 or more rows) for the performance benchmark, and ones for conflicts, parallel Proposals, stale Proposals and each permission role
- M10 A generator that produces a large valid file from a few parameters (number of tasks, depth, dependency density)

---

## 2. Phased plan

Phases are ordered so that each one can be used and tested with what came before it. Every catalogue feature belongs to exactly one phase.

**Gate for every phase.** A phase is done only when, in addition to its own criteria: the performance budget holds; the accessibility checks (F9) pass for everything added; each new action has a permission, a test that tries the forbidden action, and an explained disabled state; everything new that can be selected has a default details view; every visible text goes through the localisation layer and every date and number through locale formatting, so Phase 10 only adds translations; the mock samples and the example gallery cover the new features; and the scheduling logic and the interface have automated tests.

### Phase 1: Core chart, mock data and performance
Covers: A1, A2, A3, A4, A6, C7, C12, D13, F1, F2, F4, F6, F7, F9, F11, F13, F15, F16, G1, G6, G9, G10, G11, G13, H1, H2, H3, H6, J1, J4, J6, M1, M2, M3, M4, M5, M9, M10
- A read-only chart worth looking at: tree grid with WBS codes, bars, summaries, milestones, dependency lines, unscheduled rows, tooltips, today marker, zoom and navigation, resizable panes, both themes.
- Mock JSON contract, schema, validation, loader, samples and generator, so every later phase can be built and tested without a back end. The example gallery starts here and grows with each phase.
- Working-time arithmetic (default calendar, weekends, holidays, the roadmap's time zone) and summary spans from children. The contract needs both to place a bar from its start and duration, so they cannot wait for the engine.
- Selection of rows, bars and connectors, the details panel with its default views, and host-defined kinds (section 3c). The panel is read-only here; it gains editing in Phase 3 and a new section with each later phase (Proposal changes, conflicts, baselines, resources).
- Lane rows: several bars on one row, stacked where they overlap. Rows therefore differ in height, and the virtualisation is built for that from the start.
- Virtualised rows, time axis and dependency lines; lazy loading of children.
- The operation and event API (H3) is the single path for every later data change; permissions, Proposals and undo all hook into it.
- Accessibility baseline: tree-grid semantics, keyboard navigation, focus, contrast.
- Choose how bars and lines are drawn (DOM, SVG, canvas or a mix) with a short spike measured against the budget. The spike also proves that scrolling, zooming and dragging can run without re-rendering the React tree on every frame.
- The logic packages are built without React from the start, and the build fails if one of them imports it.
- Performance budget, measured on the 10,000-task, 5,000-link sample on a mid-range laptop, once with one bar per row and once with the same tasks arranged as lanes: first render within 1.5 s of the data arriving; scrolling and zooming at 50 frames per second or better; pointer feedback within 50 ms; no main-thread task over 100 ms. The numbers are confirmed or adjusted once by the spike and then fixed.
- Done when the benchmark meets the budget in an automated run, the small sample can be explored by keyboard alone, including selecting a connector and reading its details; a lane row shows several bars, each selectable with its own details, and stacks the ones that overlap; a sample with host-defined kinds shows the host's details for those kinds and the default for the rest; a 5-working-day task spanning a weekend ends on the correct date, and an invalid mock file is refused with a path and a reason.

### Phase 2: Externalised access control
Covers: L1, L2, L3, L4, L5, L6, L7, L8, L9, L10, L11, L12, L13, M6
- Permission vocabulary, the serialisable rule schema and the shared evaluator (section 3).
- Static configuration and resolver callback; runtime updates.
- Interface gating, the authorisation hook on the operation API, denial events, safe default; reference server that evaluates the same rules and filters data.
- Done when: with no configuration nothing renders; with a configuration lacking view the Gantt does not render and nothing is fetched; each permission that guards something already built has a test that tries the forbidden action through the interface and the API (later permissions get theirs through the phase gate); changing the configuration at runtime updates the interface without reload; the benchmark still meets the budget with task-level and field-level rules.

### Phase 3: Proposal core and lifecycle
Covers: K0, K0a, K0b, K0c, K2, K2a, K2b, K2c, K2d, K2e, K2f, K2g, K3, K4, K5, K6, K14, K21, K22, K23, D7, F14, H4, H7, H8, M7, M8
- Proposal model: a recorded set of changes (create, update, delete of tasks, links, resources and calendars) over a numbered version of Current. A new roadmap is a Proposal with no Current counterpart.
- The write path to Current accepts only Approve, atomically and with the base-version check.
- First editing path, to prove the model: inline grid editing and the edit form (the details panel, now editable), with autosave and optimistic update. Until Phase 4, changing a date does not move dependent tasks; a dependency that is broken is drawn as broken.
- Current/Proposal switcher, comparison view, version history, and Submit, Withdraw, Review, Approve, Return, Reject and Discard, each guarded by its permission; expiry; history; lifecycle events.
- Separation-of-duties check driven by `GANTT_ENFORCE_SEPARATION_OF_DUTIES` (section 4), enforced on the server and mirrored in the interface.
- Several Proposals may already exist side by side; a Proposal that is out of date is refused approval (K23). Until Phase 6 brings Refresh, its remedy is "New Proposal from" it.
- Done when: no operation other than Approve can change Current (proven by tests on every edit path); a new roadmap is invisible in Current until approved; a user can make a change, see the Proposal created, move between Current and the Proposal, compare, submit, withdraw, review and approve it; a locked Proposal refuses edits; Returned, Rejected and Expired behave as in the state table; a Proposal submitted on the last day of its draft lifetime is still open the next day, expires when the review limit passes without a review, and, when returned, has at least the rework minimum to be reworked, while a withdrawn one has only the time that was left; with the variable `true` (or unset) the submitter is refused approval through both the interface and the API, while with `false` the same user can approve; the whole lifecycle runs on mock data.

### Phase 4: Scheduling core
Covers: C1, C2, C9, C10, C11, K1
- Engine as its own package, on the working-time arithmetic from Phase 1: four dependency types with lag, forward and backward pass, critical path, cycle detection. Runs in the browser off the main thread and on the server.
- Auto-scheduling writes computed dates into the active Proposal (K1).
- Built before interactive editing on purpose: dragging a bar must be able to show what happens to its successors.
- Done when: the engine gives identical results in the browser and on the server for every sample; a full recalculation of the benchmark takes under 500 ms off the main thread; a cycle is refused with an explanation; the engine has property-based tests (no successor ever starts before its dependency allows).

### Phase 5: Interactive editing
Covers: D1, D2, D3, D4, D6, D8, D9, D10, D11, D14, D15, D16, D17, D18, D19, F3, F5, F8, F10, F12, G7
- Drag to move and resize with live feedback and successor preview; draw and delete dependencies on the chart; edit type, lag and progress.
- Add tasks (action column, placeholder row), reorder, indent and outdent, multi-select and bulk actions, copy and paste.
- On lane rows: drag a bar along its lane, drag it to another lane (which changes its parent), and add a bar by dragging across an empty stretch of a lane. Bars on a lane have no grid cells, so their other fields are edited in the details panel.
- Context menu, toolbar, shortcuts; sort, filter, group, find; column configuration, templates for cells and bars, and saved views; compact mode; touch. A selected connector's type and lag are edited in its details.
- This is the largest phase. It is delivered in two steps, each usable on its own: first editing on the chart (D1, D6, D17, D8, F3, F8), then the grid and view features.
- Undo and redo. Every edit is made in a Proposal and only where the configuration grants the permission for that task and field.
- Done when a user can reschedule a task and its dependency without leaving the chart, see the successors move before letting go, and undo it; the same can be done with the keyboard only and on a tablet; a first-time user completes "add a task, link it, move it, submit the Proposal" without help in a usability test.

### Phase 6: Working together on Proposals
Covers: K7, K8, K9, K10, K11, K12, K13, K15, K16, K17, K17a, K17b, K17c, K18, K19, K20, H5
- Real-time channel from the server (H5); it carries the stale, concurrent-change and lifecycle events.
- Proposal list with overlap counts; concurrent-change detection by field group, highlighting, and per-task choice.
- Stale status, `proposalStale` event, Refresh with preview, recalculated schedule, atomic apply, history entry.
- Done when: two users changing the same field group of a task in one Proposal both see it flagged and Approve is blocked until a version is picked; two users changing different fields of one task see no flag; two parallel Proposals changing the same task are both warned; approving one marks the other stale without a reload and blocks its approval; the owner runs Refresh, sees incoming changes and overlaps, resolves every overlap, confirms, and the stale status clears; a Submitted Proposal with a clean refresh stays Submitted and can then be approved.

### Phase 7: Scheduling depth and time scale
Covers: C3, C4, C5, C6, C8, B4, D12, G2, G3, G4, G5
- Constraint types, deadlines, manual and inactive modes, per-task calendars, split tasks.
- Conflict list with explanations and suggested fixes (for example "move to", "remove link"). Slack drawn as a bar extension.
- Custom scales, hour and day durations, flexible scale boundaries.
- Done when every constraint type has engine tests, each conflict explains itself and offers a fix that can be undone, and an hour-based task displays correctly at every zoom level.

### Phase 8: Tracking
Covers: B1, B2, B3, A5
- Baselines are snapshots of a version of Current (K22). Saving one does not change the plan, so it is not a Proposal; it needs `baseline.save` and is offered on every approval.
- Progress line on a chosen date; S-curve view; rollup bars on summary rows.
- Done when a baseline renders under the current bars and S-curve totals match the data.

### Phase 9: Resources
Covers: E1, E2, E3, E4, E5, E6, E7, D5
- Default demand first: with no resource data the load chart shows total demand, so the view works from day one.
- Resource assignment, including drag and drop and backlog drag, replaces the default where provided.
- Load chart, over-allocation histogram, resource calendars, resource-driven scheduling.
- Done when a project with no resource data shows its demand per period, and an assigned project shows load per resource with over-allocation highlighted against capacity.

### Phase 10: Interchange and platform
Covers: I1, I2, I3, I4, G8, G12, G14, J2, J3, J5
- PDF, PNG and Excel export; Excel and CSV import; MS Project import and export. Imports always land in a Proposal.
- Fullscreen mode, translations, locale formats and right-to-left.
- Server-side rendering in Next.js; state-management examples; structured API reference.
- Done when a roadmap survives export to and import from each format without loss of the fields that format supports, the interface runs fully in a second language and in a right-to-left locale, and a server-rendered Next.js page shows the chart without an error or a layout jump.

---

## 3. Access control configuration (outline)

Rules are data, so the server and the component can read the same ones. Callbacks and visual elements are component props, kept apart from the rules.

```ts
// Serialisable. Shared by the server and the component.
interface GanttAccessRules {
  // who the rules are for (supplied by the host; the component does not authenticate)
  subject: { id: string; roles?: string[]; groups?: string[] };

  // A request is allowed when at least one 'allow' rule matches and no 'deny' rule matches.
  // Order does not matter. No match means denied.
  rules: Array<{
    effect: 'allow' | 'deny';
    permissions: Permission[];          // what
    scope?: {                           // where
      projects?: string[];
      tasks?: { ids?: string[]; groups?: string[]; types?: string[]; owners?: string[] };
      proposals?: 'own' | 'any' | string[];
    };
    fields?: string[];                  // which task fields (dates, progress, resources, ...)
    condition?: string;                 // name of a host-registered condition, for dynamic cases
  }>;
}

// Component props (not serialised).
interface GanttAccessProps {
  access?: GanttAccessRules;                                           // static data
  resolveAccess?: () => Promise<Partial<GanttAccessRules>>;            // resolver; its result wins for the fields it returns (L11)
  conditions?: Record<string, (ctx: AccessContext) => boolean>;        // same names registered on the server
  authorize?: (operation: GanttOperation) => boolean | Promise<boolean>; // hook before every data operation (L5)
  onDenied?: (event: AccessDenied) => void;
  noAccess?: ReactNode;                                                // what to show without view
  deniedControls?: 'disable' | 'hide';                                 // default 'disable', with the reason shown
}
```

Permission vocabulary (fine-grained, combinable):

| Group | Permissions |
|---|---|
| Visibility | `view` (required for anything), `view.fields`, `view.baselines`, `view.resources`, `view.history` |
| Tasks | `task.create`, `task.modify.dates`, `task.modify.progress`, `task.modify.fields`, `task.reorder`, `task.delete` |
| Dependencies | `link.create`, `link.modify`, `link.delete` |
| Scheduling | `schedule.run`, `constraint.edit`, `calendar.edit` |
| Proposals | `proposal.create`, `proposal.edit`, `proposal.refresh`, `proposal.submit`, `proposal.review`, `proposal.approve`, `proposal.return`, `proposal.reject`, `proposal.discard`, `proposal.viewOthers` |
| Resources | `resource.assign`, `resource.edit` |
| Data | `export`, `import`, `baseline.save` |

Notes:
- `view` is the gate. Without it nothing is fetched or rendered.
- `view.fields` is used with `fields` to limit which task fields a user sees; without a `fields` list it grants all of them.
- Withdraw needs `proposal.submit` and is limited to the submitter. Restoring an earlier version needs `view.history` and `proposal.create`.
- A deny rule always wins over an allow rule, whatever their order, so adding a rule can never widen access by accident.
- Rules can be as coarse as a role list or as fine as one field of one task; the host decides.

### 3a. Proposal states

| State | Can be edited | Actions available | Ends as |
|---|---|---|---|
| Draft | Yes | Submit, Refresh, Discard | |
| Returned | Yes (reason shown) | Submit, Refresh, Discard | |
| Submitted | No (locked) | Review, Approve, Return, Reject, Withdraw, Refresh (clean only) | |
| Reviewed | No (locked) | Approve, Return, Reject, Withdraw, Refresh (clean only) | |
| Approved | No | View, compare, save as baseline | New version of Current |
| Rejected | No | New Proposal from rejected | Closed |
| Expired | No | New Proposal from expired | Closed |

- Any open state (Draft, Returned, Submitted, Reviewed) moves to Expired when the time limit of its phase runs out (K2e).
- A "New Proposal from" a rejected, expired or earlier version is based on the newest Current. Its changes are carried over through the same preview as Refresh, so overlaps with what has since been approved are decided at the start.
- Discard removes the Proposal's content; the history keeps the fact that it existed and who discarded it.

### 3b. Mock data contract (outline)

Illustrative shape of the JSON that the Gantt accepts; the published schema is authoritative.

```json
{
  "contract": "gantt-roadmap/1",
  "roadmap": { "id": "r1", "name": "Platform migration", "version": 12,
               "timeZone": "Europe/Zurich", "start": "2026-11-02",
               "defaultCalendar": "cal1", "statusDate": "2026-11-11" },
  "calendars": [
    { "id": "cal1", "name": "Standard", "workingDays": [1,2,3,4,5],
      "hoursPerDay": 8, "holidays": ["2026-12-25"] }
  ],
  "tasks": [
    { "id": "t1", "name": "Planning", "type": "summary", "kind": "initiative", "parent": null },
    { "id": "t2", "name": "Requirements", "type": "task", "parent": "t1",
      "start": "2026-11-02", "duration": 10, "durationUnit": "day", "end": "2026-11-13",
      "progress": 0.4, "mode": "auto", "owner": "u1",
      "resources": [{ "id": "res1", "allocation": 1.0 }],
      "constraint": { "type": "SNET", "date": "2026-11-02" }, "deadline": "2026-11-30" },
    { "id": "t3", "name": "Sign-off", "type": "milestone", "parent": "t1",
      "start": "2026-11-16", "duration": 0, "durationUnit": "day" }
  ],
  "links": [
    { "id": "l1", "source": "t2", "target": "t3", "type": "FS", "kind": "delivery", "lag": 0, "lagUnit": "day" }
  ],
  "resources": [ { "id": "res1", "name": "Design team", "capacityFte": 1.0, "calendar": "cal1" } ],
  "proposals": [
    { "id": "d1", "name": "Re-plan Q1", "owner": "u2", "state": "Submitted",
      "baseVersion": 12, "createdAt": "2026-11-09T10:00:00Z",
      "submittedAt": "2026-11-10T09:00:00Z", "expiresAt": "2026-11-12T09:00:00Z",
      "changes": [
        { "entity": "task", "op": "update", "id": "t2", "fields": { "start": "2026-11-04" },
          "by": "u2", "at": "2026-11-09T10:05:00Z" }
      ] }
  ],
  "access": { "subject": { "id": "u1", "roles": ["planner"] },
              "rules": [ { "effect": "allow",
                           "permissions": ["view", "proposal.create", "proposal.edit", "proposal.submit"] } ] }
}
```

Contract rules:
- `contract` carries the name and major version; an unknown major version is refused.
- Task dates are ISO dates (`YYYY-MM-DD`), or ISO date-times without offset for hour-based tasks, in the roadmap's `timeZone`. Audit timestamps (`createdAt`, `at`) are ISO date-times in UTC.
- `start` and `duration` (in working time of the task's calendar) define a task. `end` is the last working day of the task, inclusive; it is optional on input and, when given, must agree with `start` and `duration`. A milestone has duration 0. A task with no `start` is unscheduled. Summary dates are derived and ignored on input.
- Ids are unique strings within their collection; `parent`, `source`, `target`, change `id`, calendar references and `resources[].id` must refer to existing ids (checked on load). Links must not form a cycle.
- Task `type` is one of `task`, `summary`, `milestone`; `mode` is `auto` (default), `manual` or `inactive`; link `type` is one of `FS`, `SS`, `FF`, `SF`.
- A summary may carry `"lane": true`: its children are then drawn as bars on its row (A6). A kind can set this as its default.
- A task or a link may carry a `kind`: a free text label defined by the host (section 3c). It is not validated against a list, because the list belongs to the host; an undefined kind gets the default look and details.
- A Proposal change has an `entity` (`task`, `link`, `resource`, `calendar`, `roadmap`), an `op` (`create`, `update`, `delete`), the `id`, the changed `fields`, and who made it and when.
- Resources are optional; a task without them counts as a demand of 1 FTE (E7).
- `proposals`, `calendars`, `resources` and `access` are optional. Without `calendars`, Monday to Friday with no holidays is used. With `access` omitted in mock mode the file is treated as full access for the mock user (the one exception to L8); in any other mode, as no access.
- Fields that arrive with later phases (actual start and end, split segments, a task's own calendar, baselines) are added as optional fields within major version 1.
- Unknown fields are reported as warnings, not errors, so the contract can grow without breaking older files.

### 3c. Selection, kinds and details (outline)

What can be selected, and what the default details show. Sections appear only when they have content and the user may view it (L12).

| Selected | Default details |
|---|---|
| Row or its main bar (task) | Name, kind, WBS code, status marks (critical, in conflict, changed in this Proposal, unscheduled). Schedule: start, end, duration, progress, constraint, deadline, slack. Place in the tree. Predecessors and successors with type and lag; each one can be clicked to select that task or that connector. Resources. Conflicts with their fixes. What this Proposal changed (old and new value, who, when). History. Any other fields the data carries |
| Summary | As a task, with derived dates and progress, and its children counted by state |
| Lane row (A6) | As a summary, with a list of the bars on it; each can be clicked to select that bar |
| Bar on a lane row | As a task: the bar is a task of its own, with its own kind |
| Milestone | Date, deadline, what it waits for |
| A part of a bar (baseline, split segment, rollup marker) | That part's own dates and its difference from the plan, above the details of its task |
| Connector | The two tasks it joins (each can be clicked), the type in words ("Requirements must finish before Sign-off starts"), lag, whether it is satisfied or broken and by how much, whether it is critical, whether it is the link that sets the successor's date, what this Proposal changed. Edit and delete where permitted |
| Several items | How many, the period they span, the values they share |
| Nothing | The roadmap's own summary: dates, progress, number of conflicts, open Proposals |

```ts
type SelectionTarget =
  | { type: 'row';  taskId: string }
  | { type: 'bar';  taskId: string; bar: string }     // taskId: the bar's own task; bar: 'main', 'baseline', a segment id, ...
  | { type: 'link'; linkId: string };

interface GanttSelectionProps {
  selection?: SelectionTarget[];                       // set by the host; omit to let the Gantt keep it
  onSelectionChanged?: (e: { selection: SelectionTarget[]; primary?: SelectionTarget }) => void;
  detailsPanel?: 'right' | 'bottom' | false;           // false: the host shows its own, driven by the event
  kinds?: GanttKinds;
}

interface GanttKinds {
  rows?:  Record<string, KindDefinition<Task>>;        // 'initiative', 'use-case', 'crew', ...
  bars?:  Record<string, KindDefinition<Bar>>;
  links?: Record<string, KindDefinition<Link>>;
}

interface KindDefinition<T> {
  label: string;
  icon?: ReactNode;
  base?: 'task' | 'summary' | 'milestone';             // rows only: how the engine treats this kind
  lane?: boolean;                                      // rows only: draw the children as bars on this row (A6)
  details?:
    | DetailsSection<T>[]                              // adjust the default: add, hide, reorder sections and fields
    | ComponentType<DetailsProps<T>>;                  // or replace it with the host's own component
}

interface DetailsProps<T> {
  item: T;
  related: RelatedItems;                               // predecessors, successors, parent, children, conflicts
  proposal?: ProposalChangeInfo;                             // what the open Proposal changed on this item
  canEdit: (field: string) => boolean;                 // from the access rules
  select: (target: SelectionTarget) => void;           // move the selection, for example to a predecessor
  Default: ComponentType;                              // the default view, to embed and add to
}
```

Rules:
- A kind is a label the host puts on a task or a link (`kind`). The Gantt gives it no meaning except through the definition the host supplies. The built-in types (`task`, `summary`, `milestone`) still decide how an item is scheduled and drawn; a row kind names which of them it behaves as (`base`).
- Every bar belongs to a task and takes that task's kind. On an ordinary row that is the row's own task; on a lane row each bar is a child task with a kind of its own, so one row can carry bars of different kinds. The parts the Gantt draws itself (baseline, split segment, rollup marker) are bar kinds of their own, and a host may define details for them too.
- Three levels, so a host does only as much as it needs: nothing (default view), a list of sections and fields (no code), or its own component (which may embed the default).
- A host component receives only data the user may view, and must use `canEdit` before offering a change. Changes it makes go through the same operations as any other edit, so they land in a Proposal and can be undone.
- Keyboard: arrow keys move focus (left and right step through the bars of a lane row), Space selects, Enter opens the details for editing, Esc clears the selection, and one shortcut moves focus between the chart and the panel. The panel never takes focus on its own.
- On a small screen (F5) the panel opens as a sheet over the chart.
- An item that is selected but hidden by a filter or a collapsed parent stays selected, and the panel says why it is not visible.

---

## 4. Environment configuration

The component itself reads no environment variables: it takes props. The variables below belong to the server, which passes their effective values to the interface through its configuration endpoint. With no server (mock mode in a demo or test), separation of duties comes from a prop and defaults to enforced.

| Variable | Values | Default | Effect |
|---|---|---|---|
| `GANTT_ENABLE_MOCK_DATA` | `true` / `false` | `false` | Allows the Gantt to render from a mock JSON file. Refused when the environment is identified as production. |
| `GANTT_ENFORCE_SEPARATION_OF_DUTIES` | `true` / `false` | `true` | When `true`, the user who submitted a Proposal, or changed anything in it, cannot review or approve it. When `false`, the same user can submit and approve. |

Per environment:

| Environment | `GANTT_ENABLE_MOCK_DATA` | `GANTT_ENFORCE_SEPARATION_OF_DUTIES` |
|---|---|---|
| dev | `true` (one person can render mock data and try every feature without a back end) | `false` (one person can submit and approve, so the whole lifecycle is quick to validate) |
| every other environment (test, staging, UAT, production, and any new one) | `false` (the default) | `true` (the submitter can never approve their own Proposal) |

Rules:
- The safe direction wins for both variables: if a variable is missing, empty or unrecognised, use its default (mock data off, separation of duties enforced). Only an explicit `true` enables mock data, and only an explicit `false` relaxes separation of duties.
- Both are read by the server at startup and reach the interface from the server's configuration endpoint, not from a build-time value, so a build promoted to another environment cannot carry a relaxed setting along. A change needs a restart.
- When the host exposes an environment name and it is production: mock data is refused even if set to `true`, and the server refuses to start with separation of duties set to `false`.
- The interface emits `separationOfDutiesStatus` to the host once the configuration is loaded, with `enforced: true` or `enforced: false`, so the host can show its own message. The server logs a warning on startup when it is `false`.
- `GANTT_ENFORCE_SEPARATION_OF_DUTIES` only controls the same-user restriction. All other permissions (`proposal.submit`, `proposal.review`, `proposal.approve`) are still checked as usual.

### Callback events (the only notification channel)

Each is a callback prop on the component, named `on` plus the event name (`proposalStale` is received through `onProposalStale`).

| Event | When |
|---|---|
| `proposalCreated`, `proposalDiscarded` | A Proposal was opened by a first change, or discarded |
| `proposalSubmitted`, `proposalWithdrawn`, `proposalReviewed`, `proposalReturned`, `proposalRejected`, `proposalApproved` | Lifecycle transitions, with actor and reason |
| `proposalStale` | A newer Current exists; carries who approved, when, changed tasks, overlaps |
| `proposalRefreshed` | A stale Proposal was brought up to date |
| `proposalExpiring`, `proposalExpired` | Warning before, and notice when, the time limit of the current phase runs out; carries the phase |
| `concurrentChange` | Two users or Proposals changed the same field group of a task |
| `selectionChanged` | The selection changed; carries every selected row, bar or connector and the primary one |
| `accessDenied` | An action was refused |
| `operationFailed` | A change could not be saved and was rolled back; carries the reason |
| `separationOfDutiesStatus` | When the configuration is loaded; carries `enforced: true` or `false` |

## 5. Decisions

1. **Write-back policy (decided).** Auto-scheduling applies computed dates in a Proposal, not in the current plan. Users can move between Current and any Proposal.
2. **Resources without data (decided, clarified).** If no resource data is provided, each task is a demand of 1 FTE. Over-allocation needs a capacity to compare against.
3. **Performance first (decided).** Virtualisation is Phase 1 and its benchmark is a standing budget, with numbers, for all later phases.
4. **Accessibility (decided).** WCAG 2.2 AA is a feature (F9) and part of every phase's gate, not a later clean-up.
5. **Concurrent edits (decided).** A task modified by two users in a Proposal is highlighted to everyone who can see the Proposal.
6. **Proposal-first (decided).** Any new roadmap or update is first created as a Proposal without altering the existing roadmap. Current changes only when a Proposal is approved. The Proposal is created on the first change.
7. **Lifecycle permissions (decided).** Review is optional. The steps are three permissions: `proposal.submit`, `proposal.review`, `proposal.approve`. The flow stays light, because every step is just a permission the host grants or withholds.
8. **Separation of duties switch (decided, widened).** `GANTT_ENFORCE_SEPARATION_OF_DUTIES` is `false` in dev and `true` everywhere else. When `true`, neither the submitter nor anyone who changed the Proposal can review or approve it.
9. **Parallel proposals (decided).** Several Proposals of the same roadmap may be open at once. Overlapping changes are flagged across Proposals, and approving one Proposal makes the others out of date until they are refreshed.
10. **Stale proposals (decided, tightened).** Users are notified immediately when a newer version makes their Proposal stale, and have an explicit Refresh action with a preview. Changes without overlap are always taken; overlaps need an explicit choice, per task or field, with accept-all shortcuts; nothing takes effect until confirmed.
11. **Notifications (decided).** All notifications are handled only by callbacks; the component renders none of its own. State shown in place is not a notification.
12. **Expiry and limits (decided, revised).** A Proposal expires by phase: the draft lifetime while it is being prepared (default 7 days from creation), the review limit once submitted (default 2 days), the approval limit once reviewed (default 2 days). A returned Proposal has at least the rework minimum (default 2 days) to be reworked. All four are configurable. There is no limit on open Proposals per roadmap or per user.
13. **Returned and Rejected (decided).** A reviewer or approver can send a Proposal back as Returned (editable, resubmittable) or Rejected (closed). A Rejected Proposal can only be used to open a new Proposal; it is never reopened.
14. **Concurrent change resolution (decided, clarified).** A conflict exists only where the same field group of a task was changed twice. It is settled by picking one version per task.
15. **Rule engine (decided).** The server decides. The component uses the same evaluator only to decide what to show.
16. **Configuration delivery (decided).** Both static data and a resolver callback.
17. **Mock rendering (decided).** The Gantt can render from mock JSON that follows a predefined, versioned contract.
18. **Externalised access control (decided).** Access rules come from configuration supplied by the consuming component, down to action, field, task and Proposal level. Without view access, the Gantt does not render.
19. **Rule evaluation (new).** Deny wins over allow and order does not matter, replacing "first match wins".
20. **Build order (new).** Working-time arithmetic comes with the first chart, the scheduling core comes before interactive editing, and real-time updates come with Proposal collaboration, because each is needed by the phase that follows it.
21. **Locked while under review (new).** A Submitted or Reviewed Proposal cannot be edited; the submitter withdraws it to change it.
22. **Technology (decided).** The Gantt is a native React component. A Web Component built with Lit, with generated wrappers for React, Vue and Angular, was considered and set aside because the only consumers are React applications. Details in section 0a; reasoning in `ADR-001-Web-Component-vs-React.md`.
23. **Framework-free core (decided).** The engine, access evaluator, contract, Proposal logic and chart state are packages that do not import React. The server needs them that way, and it keeps another framework possible later.
24. **Selection and details (decided).** Any row, bar or connector can be selected and shows its details in a panel that does not block the chart. The Gantt ships a default view; the host defines its own kinds (for D4: initiative, use-case, milestone, application or platform, crew, task, and its kinds of bars and connectors) and supplies their details.
25. **Several bars on one row (decided).** A row can be a lane that carries its children as bars. Each bar remains a task of its own, so scheduling, connectors, Proposals and permissions need no second model.
26. **Every connector schedules (decided).** A connector is always a dependency (FS, SS, FF or SF) that moves dates. Its kind changes how it looks and what its details show, never whether it schedules.

27. **Progress updates (decided).** Kept strict: a progress update is a change like any other and goes through a Proposal and approval. No field may be written to Current directly.
28. **Scheduling direction (decided).** Forward from the roadmap start only. Scheduling backward from a finish date is not planned.
29. **Naming (decided).** The thing is a Roadmap Proposal; Draft is the state it is in before submission.

## 6. Open points

1. **Performance numbers.** The budget figures in Phase 1 are accepted as targets. The rendering spike confirms or adjusts them once, and they are then fixed.

## 7. Review log

### Revision 8: Roadmap Proposal, expiry by phase, open points closed

- **Renamed.** What earlier revisions called a Draft is now a Roadmap Proposal (Proposal for short); Draft is only the state before submission. The rename runs through the whole plan, this log included: permissions are `proposal.*`, events are `proposalStale` and so on, the data key is `proposals`, the package is `proposals`.
- **Expiry is now by phase** (K2e to K2g). Before, one clock ran from creation, so a Proposal submitted on day 6 could expire on day 7 with nobody having looked. Now preparing, review and approval each have their own limit (7, 2 and 2 days by default), and the preparing clock stops while a Proposal is under review. A returned Proposal has at least 2 days (the rework minimum) to be reworked; a withdrawn one keeps only the time it had left.
- **Open points closed by decision:** progress updates stay strict (27), forward scheduling only (28), React 18 and 19 confirmed, performance figures accepted as targets for the spike.

### Revision 7: several bars on one row

Revision 6 assumed one bar per row. That was wrong for D4, where a row such as a crew carries several deliverables. Added as lane rows (A6):
- A lane is a row whose children are drawn on it as bars. Nothing new is needed underneath: each bar is still a task with its own dates, connectors, kind, permissions and Proposal changes, and the tree still says which bar belongs to which row.
- Overlapping bars stack, so rows differ in height. The virtualisation is built for that in Phase 1, and the benchmark is run with lanes as well.
- Selection and details: on a lane each bar is selected on its own; the row is a separate item whose details list its bars.
- Editing on lanes (Phase 5): move along a lane, move to another lane, draw a new bar on an empty stretch. Bars on a lane have no grid cells, so the details panel is where their other fields are edited; a lane can also be opened into ordinary rows.
- Open point 6 of revision 6 is closed; decision 25 added.
- Open point 7 of revision 6 is closed as well: every connector schedules (decision 26).

### Revision 6: selection, details and kinds

The plan had tooltips on hover (F1), a vaguely worded "sub-grid panel" (F6) and an edit form for tasks (D7), but no way to select an item and read its details, nothing at all for connectors, and no selection event for the host. Added, after looking at how others do it:
- **F15 Selection** of rows, bars and connectors. Selection is kept apart from keyboard focus and marked for screen readers, as the W3C tree-grid guidance describes.
- **F6 Details panel**, reworded from "sub-grid panel": one panel that follows the selection and does not block the chart, which is what Apple's and SAP's guidance recommend for inspecting items in dense screens, and what Microsoft Project (details pane under the chart) and SVAR (editor as a sidebar) do. It is also the edit form, so there is one place for details, not two.
- **F16 Kinds**: the host defines kinds of rows, bars and connectors and their details, at three levels (default, adjusted, own component). Other products let hosts change editor fields and tabs, and add task types; none found offers details per connector kind, so this goes further than they do.
- Connectors get a default details view and two ways to be selected, because a thin line is hard to hit and has no place in keyboard order.
- All three are in Phase 1, since reading details matters most on a read-only chart; the panel gains editing in Phase 3. F6 moved from Phase 5.
- New section 3c, a `selectionChanged` event, `kind` on tasks and links in the contract, decision 24, and open points 6 and 7.

### Revision 5: final pass

- **Bars could not be placed in Phase 1.** The contract defines a task by start and working-time duration and derives summary dates, but the calendar and summary logic were in Phase 4. Working-time arithmetic, summary spans, weekend shading and time zones (C7, C12, G6, G13) moved to Phase 1; Phase 4 is now the scheduling engine alone.
- **Proposal logic had no home.** Change sets, the state machine, overlap detection and the refresh merge are needed by the browser, the server and mock mode alike. Added as a fifth framework-free package.
- **Localisation was left to the last phase,** where retrofitting every text is expensive. Using the localisation layer is now part of every phase's gate; Phase 10 only adds translations and right-to-left.
- **Templates were last too,** although they are a main part of "flexible". Moved to Phase 5 with column configuration (G7). The example gallery (J6) moved to Phase 1, because the phase gate already relied on it.
- **A locked Proposal could not accept the approver's version pick** (K21 against K9). The pick and a clean refresh are now the stated exceptions, and a pick does not make the approver an author for separation of duties.
- **Conflict flags and stale events could reveal Proposals a user may not see.** Names are now shown only with `proposal.viewOthers`, and events are filtered like data (K8, K15, L12).
- **Deleting or moving a task was not covered by conflict detection.** Position is now a field group, and a delete conflicts with any other change (K7, K17).
- **Undoing the first edit left an empty Proposal,** against K0c. Such a Proposal is now removed.
- **The sample file granted no access** (an empty rule list means denied), so it would have rendered nothing. It now has one allow rule.
- **The access prop could not hold both static rules and a resolver,** as L11 requires. Split into two props.
- Smaller: "assignment" removed as a Proposal change type (assignments live on the task); Phase 2 tests only permissions whose actions exist yet; Phase 3 states that date edits do not move dependants until the engine arrives; Phase 5 is delivered in two steps; mock mode gets a movable clock so expiry can be shown.

### Revision 4: native React

Revision 3 had recorded a Web Component built with Lit, with generated wrappers for React, Vue and Angular. Research (ADR-001) showed that this pays off only if Vue or Angular applications will use the Gantt, and the only consumers are React applications. Revision 4 therefore:
- Restates section 0a for a native React component, and keeps from revision 3 the split into logic packages without a framework and one rendering package.
- Removes the generated wrappers (J7), the per-framework example applications and their clause in the phase gate.
- Returns the access configuration, templates, styling and events to React props and components.
- Restores real server-side rendering as the aim of J2, where revision 3 could promise only a placeholder.
- Adds to Phase 1 a proof that scrolling, zooming and dragging do not re-render the React tree on every frame, the main performance risk of a React chart.

### Revision 2: review against the objective

Reviewed against the objective in section 0. Corrections, grouped by the kind of problem.

**Things that contradicted each other**
- Phase 3 was titled "K0 to K9" but described K10 to K20; Phase 2 covered L1 to L8 and left L9 to L11 with no phase. Every phase now lists its ids.
- 14 features had no phase at all (A1, A2, D7, D11, F7, G1, G9, G10, G11, H4, I2, J1, J3, J4). All are now placed.
- Proposals (old Phase 3) came before any way to edit, so its own "done when" could not be tested. Grid and form editing now arrive with the Proposal core.
- Stale and concurrent-change events had to arrive "immediately and without a reload" in Phase 3, but real-time updates were in Phase 10. Moved together into Phase 6.
- The authorisation hook and lifecycle events were needed from Phase 2, but the event API (H3) was in Phase 10. Moved to Phase 1.
- The hierarchy tree was in Phase 8, yet lazy loading of children (Phase 1), rollups (Phase 7) and column sorting (Phase 4) all need it. Moved to Phase 1.
- The access rules were called serialisable but contained a function and a React element. Split into rules (data) and component properties.
- The component "never decides on its own" (L9) yet hides controls from the rules (L4). Reworded: one shared evaluator, the server has the last word.
- Mock mode needs "no back end" but its switch was read from a server endpoint. The component now takes properties; the variables belong to the server.
- "Emit when the setting changes" for a value read once at startup. Removed; a duplicated rule in section 4 merged.
- The sample JSON pointed at a task (`t2`) that was not in it, breaking its own rule. Fixed.
- "No field-by-field merge" (K9) against "per task or per field" (K17). One definition of an overlap is now used everywhere.
- A rejected Proposal's copy got a "7-day" expiry although the lifetime is configurable.

**Things that would have confused or hurt users**
- A Proposal was created just by opening a roadmap, leaving empty Proposals with expiry clocks. It is now created on the first change.
- A Submitted Proposal could still be edited, so an approver could approve something different from what was reviewed. Now locked, with Withdraw.
- Two people changing different fields of one task were treated as a conflict and one lost their work. Now only the same field group conflicts.
- The approver was asked to choose between this Proposal and another, unapproved Proposal. Cross-Proposal overlaps are now warnings, settled by Refresh.
- In Refresh, "Keep mine" on a change the Proposal never touched would silently reverse someone else's approved work. Such changes are now always taken.
- Refresh could be applied in rounds, leaving a Proposal half on one version and half on another. Choices can be saved, but it applies in one step.
- With several parallel Proposals, every approval sent all the others back through review. A clean refresh now keeps the lifecycle state.
- A stale Proposal could not even be submitted. It can now; only approval waits for the refresh.
- "First match wins" made rule order a security risk. Deny now always wins.
- "100% of 1 FTE per task" could not show over-allocation in any meaningful way. Restated as demand, with an optional capacity.
- Separation of duties covered only the submitter, so a co-author could approve their own changes.
- Task `end` was not defined as inclusive or exclusive, and dates could not express hour-based tasks or a time zone.
- Proposal changes in the contract could only update tasks, not create or delete anything or touch links and resources.

**Things that were missing for the objective**
- Intuitive: live drag feedback (D17), multi-select (D14), copy and paste (D15), indent and outdent (D16), find (D19), navigation (F11), explained controls (F14), states and save indicator (F13), autosave (H8), touch (F10).
- Flexible: column configuration and custom fields (D18), saved views (F12), stand-alone engine (C11), time zones and locale formats (G13, G14), version history and restore (K22).
- Extraordinary: accessibility as a feature with a standard (F9), a performance budget with numbers, virtualised time axis and links (H6), cycle prevention (C9), atomic approval (K23), server-side data filtering (L12), a gate that every phase must pass.
