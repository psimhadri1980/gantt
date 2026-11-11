# Gantt Chart Feature Plan

A vendor-neutral list of the features a full-featured project Gantt chart should offer, with a phased plan for building them.

---

## 1. Feature catalogue

### A. Project planning
- A1 Summary tasks and milestones
- A2 Task dependencies, displayed and editable
- A3 Hierarchical tree of sub-tasks (expand and collapse)
- A4 Unscheduled tasks (listed without dates)
- A5 Rollups (children shown on the summary bar)

### B. Project tracking
- B1 Baselines (planned vs actual vs saved plan)
- B2 S-curve (planned, actual and baseline progress over time)
- B3 Progress line (which tasks are ahead or behind on a chosen date)
- B4 Slack (float) visualisation

### C. Scheduling engine
- C1 Auto-scheduling for all four dependency types (FS, SS, FF, SF) with lag
- C2 Critical path
- C3 Six constraint types (start/finish no earlier than, start/finish no later than, must start on, must finish on)
- C4 Deadlines with late warnings
- C5 Conflict list with explanations and one-click fixes
- C6 Manual and inactive task modes
- C7 Working-day calendar (weekends, holidays; non-linear time scale)
- C8 Individual calendars per task

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

### E. Resource management
- E1 Assign resources to tasks
- E2 Assign by drag and drop
- E3 Resource load chart
- E4 Resource histogram highlighting over-allocated people and periods
- E5 Individual resource calendars (days off, part-time)
- E6 Resource-driven scheduling
- E7 Default capacity: when no resource data is provided, every task is assumed to be done by one resource at 100% of 1 FTE

### F. User experience
- F1 Tooltips for tasks and links
- F2 Zoom with default and custom levels
- F3 Keyboard shortcuts
- F4 Resize, hide and show chart and grid
- F5 Compact mode for small screens
- F6 Sub-grid panel for key details
- F7 Vertical markers
- F8 Undo and redo

### G. Configuration
- G1 Scale width, height and borders
- G2 Custom scale lines and units
- G3 Fixed or flexible scale boundaries
- G4 Duration units: hour and day
- G5 Length units from minute to year
- G6 Highlight weekends and holidays
- G7 Templates for grid cells and task bars
- G8 Fullscreen mode
- G9 Read-only mode
- G10 Light and dark themes
- G11 Styling with CSS variables
- G12 Localization

### H. Data handling and performance
- H1 Fast with large data sets (virtualised rows)
- H2 Dynamic loading of sub-tasks
- H3 API to listen to, intercept and run data operations
- H4 Helper for binding to a backend
- H5 Real-time updates from the server

### I. Import and export
- I1 Import from Excel and CSV
- I2 Export to PDF and PNG
- I3 Export to Excel
- I4 MS Project import and export

### J. Developer platform
- J1 Native React component with TypeScript types
- J2 Server-side rendering support
- J3 Integration with state-management libraries
- J4 Embeddable and reusable
- J5 Structured API reference for AI-assisted coding

### K. Drafts (scenarios) and their lifecycle
- K0 Draft-first rule: every change starts as a Draft and never alters the existing (Current) roadmap. This covers a brand-new roadmap, any update to tasks, dates, dependencies, resources or settings, auto-scheduling results, and imports
- K0a A new roadmap exists only as a Draft until approved; it does not appear in the Current view before that
- K0b The Current roadmap is read-only to editing and scheduling actions; the only way to change it is Approve
- K0c Opening a roadmap for editing creates a Draft automatically (or resumes the user's open Draft), so the user never edits Current by accident
- K1 Auto-scheduling applies computed dates inside a Draft
- K2 Lifecycle states: Draft, Submitted, Reviewed, Approved, plus Returned, Rejected and Expired (see K2d, K2e). Each transition is guarded by one permission:
  - Draft to Submitted: `draft.submit`
  - Submitted to Reviewed: `draft.review`
  - Reviewed to Approved: `draft.approve`, which promotes the Draft to Current
  - Review is optional: a Draft can go from Submitted straight to Approved, and a host may grant `draft.approve` without `draft.review`
- K2d Returned and Rejected: a reviewer (`draft.return`) or approver (`draft.reject`, `draft.return`) can send a Submitted or Reviewed Draft back:
  - Returned: goes back to the author as an editable Draft with the reason attached; the author can fix it and submit again
  - Rejected: closed with a reason; it cannot be edited, submitted, approved or reopened. Its only use is as the starting point of a new Draft ("New Draft from rejected"), which copies its changes, gets its own 7-day expiry from its creation, and keeps a link back to the rejected Draft
  - The reason is mandatory and is recorded in the history
- K2e Expiry: every Draft that is not approved expires after the configured draft lifetime (default 7 days) counted from its creation. Later changes, submission, return or refresh do not extend the date. Expired Drafts are closed (state Expired), cannot be submitted or approved, stay in the history, and the author can start a new Draft from them. There is no limit on the number of open Drafts per roadmap or per user
- K2g The draft lifetime is configurable by the host in days; the default is 7. A change applies to Drafts created afterwards, and existing Drafts keep the expiry date they were given. The value must be a positive whole number of days
- K2f The expiry date is fixed at creation (created time + the draft lifetime, default 7 days) and shown on the Draft; the `draftExpiring` event warns the host before it passes. A Returned Draft keeps its original expiry date
- K2a Separation of duties, controlled by an environment variable (see section 4): when enforced, the user who submitted a Draft cannot approve it (and cannot review it); when not enforced, the same user may submit and approve, so the lifecycle can be tested quickly with one account
- K2b The check is made by the server (and mirrored in the interface by hiding or disabling Approve), so it cannot be bypassed by calling the API directly
- K2c The Draft history records who submitted and who approved, and whether the rule was enforced at that moment
- K3 Switch between Current (live plan) and any Draft at any time
- K4 Side-by-side comparison of Current vs a Draft (moved bars, changed dates, new conflicts)
- K5 Approve promotes a Draft to Current; Discard deletes a Draft that is not yet approved. Until approval the Current roadmap is unchanged and other users keep seeing it
- K6 History of who created, changed, submitted, reviewed and approved a Draft
- K7 Concurrent-change detection: when the same task is modified by two or more users in a Draft, or in two or more parallel Drafts, the task is flagged
- K8 The flag is shown to every user who can see the Draft (and names the other Draft or user involved): highlighted on the bar and grid row, and listed in a "Concurrent changes" panel with who changed what and when
- K10 Parallel Drafts: any number of Drafts of the same roadmap can be open at the same time, each with its own name, owner and lifecycle state, all based on the same Current
- K11 A Draft list per roadmap showing owner, state, age, number of changes, and number of tasks it shares with other Drafts
- K12 When a Draft is approved, every other open Draft of that roadmap is marked "Current has changed" and its tasks that overlap the approved changes are flagged; the owner is told and must refresh (rebase) the Draft before submitting or approving it
- K13 Approval order decides: Drafts are approved one at a time, and a Draft that is out of date against Current cannot be approved until refreshed
- K14 All notifications are delivered only through host callbacks. The component renders no banners, toasts, emails or messages of its own; it emits events and the host decides how to tell people. The component only shows state (for example a "stale" status in the Draft list), never notification messages. When a newer version of Current exists (another Draft was approved), a `draftStale` event is emitted for every open Draft that is now out of date, immediately and without a reload
- K15 The event carries what changed: who approved, when, which tasks changed, and which of them overlap this Draft's own changes
- K16 A visible "Refresh Draft" action (button in the Draft menu and in the Draft list, guarded by `draft.refresh`) brings the Draft up to the newer Current in one step
- K17 Refresh behaviour: changes that do not overlap are carried over automatically; tasks changed on both sides are shown side by side ("Current" vs "Your Draft") and the user picks a version per task (or per field); the refresh is a preview first and takes effect only on confirmation, and can be cancelled or undone
- K17a Accept incoming changes: in the refresh preview the user sees every incoming change from the newer Current and can act on each one:
  - Accept incoming: take the newer Current's version of the task (or field)
  - Keep mine: keep the Draft's own version
  - Accept all incoming, Keep all mine, or Accept all non-overlapping (the default selection)
  - Overlaps cannot be left undecided: each needs Accept incoming or Keep mine before the refresh can be confirmed
  - Incoming changes that do not touch the Draft's tasks are accepted by default and shown for information
- K17b Accepted incoming changes become part of the Draft, so the Draft is now based on the newer Current; a later refresh only shows what is newer than this one
- K17c The user can accept incoming changes in several rounds (for example accept some, review, then accept the rest) before confirming the refresh
- K18 After refresh the Draft is marked up to date, the stale status clears, and the history records the refresh (who, from which version to which)
- K19 Until refreshed, a stale Draft can still be viewed and edited but cannot be submitted or approved; the reason and the Refresh action are shown wherever Submit or Approve would be
- K20 Several newer versions can arrive in a row; the stale status shows the number of newer versions (and a new `draftStale` event is emitted for each), and one Refresh brings the Draft to the latest
- K9 Approving a Draft with flagged tasks requires the approver to pick one version per flagged task (no field-by-field merge); the flag is also visible to the reviewer

### L. Access control, externally configured
- L1 The Gantt takes its access rules from a configuration supplied by the consuming application; the component ships no hard-coded roles
- L2 Fine-grained: named permissions on actions, data and scope (see section 3)
- L3 The configuration is plain data and/or a callback, so it can come from the host's identity system, a file or a service, and can change at runtime without a rebuild
- L4 The component enforces the configuration in the interface: controls the user cannot use are hidden or disabled; hidden fields are not rendered
- L5 The component calls an authorisation hook before every data operation and passes the result to the host. The host's backend remains the real enforcement point (the interface alone is not security)
- L6 No view permission on the project means no Gantt: nothing is fetched or rendered, and a configurable "no access" state is shown instead
- L7 Denials are reported to the host (event/callback) for audit and messaging
- L8 Safe default: with no configuration supplied, access is denied
- L9 The rule engine lives in the back end: the host's server evaluates every request against the access configuration and is the single source of truth. The component only mirrors the decisions it is given (hiding or disabling controls) and never decides on its own
- L10 The same configuration schema is shared by the back-end engine and the component, so both read identical rules
- L11 Configuration is delivered both ways: as static data (for example a file or a fixed object) and through a resolver callback evaluated per user and per request; when both exist, the resolver's result takes precedence for the fields it returns

### M. Mock data rendering
- M1 The Gantt can render a roadmap from a mock JSON file or object, with no back end, so it can be developed, demonstrated, tested and reviewed on its own
- M2 The JSON follows a predefined, versioned contract (section 3b): roadmap, tasks, links, and optionally Drafts, resources, calendars and the access configuration
- M3 The contract is published as a JSON Schema and TypeScript types; the same schema is used to validate real data, so mock and real data take the same path into the component
- M4 Validation on load: invalid JSON is rejected with clear errors that give the path and the reason (for example `tasks[12].start: not a date`); unknown contract versions are refused
- M5 Mock mode is switched on explicitly (a property or `GANTT_ENABLE_MOCK_DATA=true`); the default is off, and it is refused when the environment is identified as production
- M6 Mock mode still honours the access configuration (M2 allows it in the JSON), so permission scenarios, including "no view means no Gantt", can be demonstrated with mock data
- M7 Drafts and their lifecycle (submit, review, approve, return, reject, expire, stale, refresh) work against the mock data in memory, with the callback events fired as in real use; changes are not persisted unless the host asks for an export
- M8 Export the current mock state back to JSON in the same contract
- M9 Bundled sample files: small (about 20 tasks), medium, a large generated set (10,000 or more rows) for the performance benchmark, and ones for conflicts, parallel Drafts, stale Drafts and each permission role
- M10 A generator that produces a large valid file from a few parameters (number of tasks, depth, dependency density)

---

## 2. Phased plan

Phases are ordered by value against effort. Each phase ships with automated tests for the scheduling logic and for the user interface.

### Phase 1: Performance foundation and mock data (H1, H2, M1 to M10)
- Row virtualisation: render only visible rows and bars; lazy loading of children.
- Establish a performance budget and benchmark (for example 10,000 rows scrolling smoothly) that every later phase must keep.
- Mock JSON contract, schema, validation, loader and sample files (M1 to M5, M9, M10), so every later phase can be built and tested without a back end. Mock Drafts, access and exports (M6 to M8) follow as those features arrive in Phases 2 and 3.
- Done when the benchmark project (a generated mock file) scrolls and zooms without dropped frames.

### Phase 2: Externalised access control (L1 to L8)
- Define the permission vocabulary and the configuration schema (section 3).
- Provide the configuration through a provider and/or a resolver callback; support runtime updates.
- Interface gating, the authorisation hook before data operations, denial events, safe default.
- Done when: with no configuration nothing renders; with a configuration lacking view the Gantt does not render and nothing is fetched; each permission has a test that tries the forbidden action; changing the configuration at runtime updates the interface without reload.

### Phase 3: Drafts (K0 to K9)
- Draft-first rule: all create, update, import and auto-schedule operations are written to a Draft; the write path to Current accepts only Approve.
- Draft model: a named layer over the current plan holding changed dates and dependencies; a new roadmap is a Draft with no Current counterpart.
- Current/Draft switcher, comparison view, and the Submit, Review, Approve and Discard actions, each guarded by its permission.
- Parallel Drafts (K10, K11): several open Drafts per roadmap, each based on the same Current; a Draft list with overlap counts.
- Concurrent-change detection and highlighting across users and across Drafts, for every user who can see them; per-task choice when approving.
- Out-of-date handling (K12, K13): approving one Draft flags the others, which must be refreshed against the new Current before they can be submitted or approved.
- Stale notification and refresh (K14 to K20): stale status in the Draft list, `draftStale` callback event, Refresh action with a preview, automatic carry-over of non-overlapping changes, Accept incoming or Keep mine for each change (with accept-all shortcuts), history entry.
- Separation-of-duties check driven by `GANTT_ENFORCE_SEPARATION_OF_DUTIES` (section 4), enforced on the server and mirrored in the interface.
- Done when no operation other than Approve can change Current (proven by tests on every edit, import and scheduling path), a new roadmap is invisible in Current until approved, a user can create a Draft, move between Current and the Draft, submit, review and approve it, and when two users editing the same task both see it highlighted and the approver must choose a version for it, and when two parallel Drafts change the same task both are flagged, and approving one marks the other out of date and blocks its approval until it is refreshed, and the host receives the `draftStale` event without a reload, the user can run Refresh from the Draft menu, previews the result, reviews incoming changes and accepts or keeps each one, resolves every overlap and confirms, after which the stale status clears and the Draft can be submitted, and with the variable `true` (or unset) the submitter is refused approval through both the interface and the API, while with `false` the same user can approve.

### Phase 4: Interactive editing (D1, D6, D8, D9, D10, F1, F3, F8)
- Drag to move and resize bars; drag between rows to change group.
- Draw and delete dependencies on the chart; edit type and lag.
- Context menu and toolbar; column sorting; keyboard shortcuts; tooltips on links.
- Undo and redo. Every edit is made in a Draft (one is opened automatically if the user is viewing Current) and never changes Current; and only where the configuration grants the edit permission for that task and field.
- Done when a user can reschedule a task and its dependency without leaving the chart, and undo it.

### Phase 5: Scheduling depth (C1 to C6, B4)
- Constraint type and deadline fields on tasks.
- Engine support for six constraint types, deadline checks, manual and inactive modes.
- Auto-scheduling writes computed dates into the active Draft (K1); the user submits it for review when satisfied.
- Conflict list with suggested fixes (for example "move to", "remove link"). Slack drawn as a bar extension.
- Done when every constraint type has engine tests, auto-schedule output lands in a Draft, and each conflict offers a fix.

### Phase 6: Calendars and time scale (C7, C8, G2 to G6, F2)
- Calendar model: default calendar, then per-task calendars.
- Engine counts working days; weekends and holidays shaded on the axis.
- Custom zoom levels, hour and day durations, flexible scale boundaries.
- Done when a 5-working-day task spanning a weekend ends on the correct date.

### Phase 7: Tracking (B1, B2, B3, A5)
- Save and compare baselines (an approved plan can be saved as a baseline).
- Progress line on a chosen date; S-curve view.
- Rollup bars on summary rows.
- Done when a baseline renders under the current bars and S-curve totals match the data.

### Phase 8: Hierarchy and grid (A3, A4, D2, D3, D4, D12, D13, F4, F5, F6)
- Expandable tree, WBS codes, split tasks, unscheduled rows.
- Resizable and collapsible chart and grid panes; grid with inline editing; sub-grid panel; compact mode.
- Done when the Phase 1 performance budget still holds with the tree and grid in place.

### Phase 9: Resources (E1 to E7, D5)
- Default capacity first: with no resource data, each task is treated as one resource at 100% of 1 FTE, so load and over-allocation views work from day one.
- Resource assignment, including drag and drop and backlog drag, replaces the default where provided.
- Load chart, over-allocation histogram, resource calendars, resource-driven scheduling.
- Done when a project with no resource data shows a sensible load chart and an assigned project overrides the default.

### Phase 10: Interchange and platform (I1, I3, I4, H3, H5, G7, G8, G12, J2, J5)
- Excel export; MS Project import and export; Excel and CSV import.
- In-chart event hooks and real-time updates.
- Templates for bars and cells, fullscreen mode, localization.
- Server-side rendering support and a structured API reference for AI tools.

---

## 3. Access control configuration (outline)

The consuming application passes one configuration object, or a resolver that returns it for the current user. Illustrative shape:

```ts
interface GanttAccessConfig {
  // who the rules are for (supplied by the host; the component does not authenticate)
  subject: { id: string; roles?: string[]; groups?: string[] };

  // permission grants, evaluated top to bottom; first match wins
  rules: Array<{
    effect: 'allow' | 'deny';
    permissions: Permission[];          // what
    scope?: {                           // where
      projects?: string[];
      tasks?: { ids?: string[]; groups?: string[]; types?: string[]; owners?: string[] };
      drafts?: 'own' | 'any' | string[];
    };
    fields?: string[];                  // which task fields (dates, progress, resources, ...)
    when?: (ctx: AccessContext) => boolean;  // optional dynamic condition
  }>;

  onDenied?: (event: AccessDenied) => void;
  noAccess?: ReactNode;                 // what to show without view
}
```

Permission vocabulary (fine-grained, combinable):

| Group | Permissions |
|---|---|
| Visibility | `view` (required for anything), `view.fields`, `view.baselines`, `view.resources`, `view.history` |
| Tasks | `task.create`, `task.modify.dates`, `task.modify.progress`, `task.modify.fields`, `task.reorder`, `task.delete` |
| Dependencies | `link.create`, `link.modify`, `link.delete` |
| Scheduling | `schedule.run`, `constraint.edit`, `calendar.edit` |
| Drafts | `draft.create`, `draft.edit`, `draft.refresh`, `draft.submit`, `draft.review`, `draft.approve`, `draft.return`, `draft.reject`, `draft.discard`, `draft.viewOthers` |
| Resources | `resource.assign`, `resource.edit` |
| Data | `export`, `import`, `baseline.save` |

Notes:
- `view` is the gate. Without it nothing is fetched or rendered.
- Rules can be as coarse as a role list or as fine as one field of one task; the host decides.
- The same configuration schema can be serialised (JSON) so the host's backend can load and enforce identical rules.

### 3b. Mock data contract (outline)

Illustrative shape of the JSON that the Gantt accepts; the published schema is authoritative.

```json
{
  "contract": "gantt-roadmap/1",
  "roadmap": { "id": "r1", "name": "Platform migration", "today": "2026-11-11" },
  "calendar": { "workingDays": [1,2,3,4,5], "holidays": ["2026-12-25"] },
  "tasks": [
    { "id": "t1", "name": "Planning", "type": "summary", "parent": null,
      "start": "2026-11-02", "end": "2026-11-20", "progress": 0.4,
      "owner": "u1", "resources": [{ "id": "res1", "allocation": 1.0 }],
      "constraint": { "type": "SNET", "date": "2026-11-02" }, "deadline": "2026-11-30" }
  ],
  "links": [
    { "id": "l1", "source": "t1", "target": "t2", "type": "FS", "lag": 0 }
  ],
  "resources": [ { "id": "res1", "name": "Design team", "capacityFte": 1.0 } ],
  "drafts": [
    { "id": "d1", "name": "Re-plan Q1", "owner": "u2", "state": "Submitted",
      "baseVersion": 12, "createdAt": "2026-11-09T10:00:00Z",
      "changes": [ { "taskId": "t2", "fields": { "start": "2026-11-16" } } ] }
  ],
  "access": { "subject": { "id": "u1", "roles": ["planner"] }, "rules": [] }
}
```

Contract rules:
- `contract` carries the name and major version; an unknown major version is refused.
- Dates are ISO dates (`YYYY-MM-DD`) and timestamps are ISO date-times in UTC.
- Ids are unique strings within their collection; `parent`, `source`, `target`, `taskId` and `resources[].id` must refer to existing ids (checked on load).
- Task `type` is one of `task`, `summary`, `milestone`; link `type` is one of `FS`, `SS`, `FF`, `SF`.
- Resources are optional; a task without them is treated as one resource at 100% of 1 FTE.
- `drafts`, `calendar`, `resources` and `access` are optional; with `access` omitted in mock mode the file is treated as full access for the mock user, and in any other mode as no access.
- Unknown fields are reported as warnings, not errors, so the contract can grow without breaking older files.

---

## 4. Environment configuration

| Variable | Values | Default | Effect |
|---|---|---|---|
| `GANTT_ENABLE_MOCK_DATA` | `true` / `false` | `false` | Allows the Gantt to render from a mock JSON file. Refused when the environment is identified as production. |
| `GANTT_ENFORCE_SEPARATION_OF_DUTIES` | `true` / `false` | `true` | When `true`, the user who submits a Draft cannot approve (or review) it. When `false`, the same user can submit and approve. |

Per environment:

| Environment | `GANTT_ENABLE_MOCK_DATA` | `GANTT_ENFORCE_SEPARATION_OF_DUTIES` |
|---|---|---|
| dev | `true` (one person can render mock data and try every feature without a back end) | `false` (one person can submit and approve, so the whole lifecycle is quick to validate) |
| every other environment (test, staging, UAT, production, and any new one) | `false` (the default) | `true` (the submitter can never approve their own Draft) |

Rules:
- The safe direction wins for both variables: if a variable is missing, empty or unrecognised, use its default (mock data off, separation of duties enforced). Only an explicit `true` enables mock data, and only an explicit `false` relaxes separation of duties.
- Mock data is refused in production even if `GANTT_ENABLE_MOCK_DATA` is `true`, as long as the host exposes an environment name.
- Like the separation-of-duties value, the mock setting is read by the server at startup and passed to the interface from the server's configuration endpoint, not from a build-time value.
- Read by the server at startup (and by the interface from the server's configuration endpoint, not from a build-time value, so a build promoted to another environment cannot carry `false` along).
- Emit a `separationOfDutiesEnforced` event to the host at startup, and whenever the setting changes, with `enforced: true` or `enforced: false` so the host can show its own message. Log a warning on startup when it is `false`.
- Refuse to start with `false` when the environment is identified as production, if the host exposes an environment name.
- `GANTT_ENFORCE_SEPARATION_OF_DUTIES` only controls the same-user restriction. All other permissions (`draft.submit`, `draft.review`, `draft.approve`) are still checked as usual.

### Callback events (the only notification channel)

| Event | When |
|---|---|
| `draftStale` | A newer Current exists; carries who approved, when, changed tasks, overlaps |
| `draftSubmitted`, `draftReviewed`, `draftReturned`, `draftRejected`, `draftApproved` | Lifecycle transitions, with actor and reason |
| `draftExpiring`, `draftExpired` | Warning before and at the expiry (default 7 days after creation) |
| `draftRefreshed` | A stale Draft was brought up to date |
| `concurrentChange` | Two users or Drafts changed the same task |
| `accessDenied` | An action was refused |
| `separationOfDutiesEnforced` | At startup and on change; carries `enforced: true` or `false` (the environment variable's effective value) |

## 5. Decisions

1. **Write-back policy (decided).** Auto-scheduling applies computed dates in a Draft, not in the current plan. Users can move between Current and any Draft.
2. **Resources without data (decided).** If no resource data is provided, assume 100% of 1 FTE per task.
3. **Performance first (decided).** Row virtualisation is Phase 1 and its benchmark is a standing budget for all later phases.
4. **Accessibility (agreed).** Keep keyboard focus and screen-reader labels working as editing is added.
5. **Concurrent edits (decided).** A task modified by two users in a Draft is highlighted to everyone who can see the Draft.
6. **Draft-first (decided).** Any new roadmap or update is first created as a Draft without altering the existing roadmap. Current changes only when a Draft is approved.
7. **Draft lifecycle permissions (decided).** Review is optional. `draft.apply` is replaced by three permissions: `draft.submit`, `draft.review`, `draft.approve`. This supersedes the earlier decision to remove the approval flow; the flow now exists but stays light, because every step is just a permission the host grants or withholds.
8. **Separation of duties switch (decided).** `GANTT_ENFORCE_SEPARATION_OF_DUTIES` is `false` in dev and `true` everywhere else. When `true`, the person who submits a Draft cannot approve it.
9. **Parallel drafts (decided).** Several Drafts of the same roadmap may be open at once. Overlapping changes are flagged across Drafts, and approving one Draft makes the others out of date until they are refreshed.
10. **Stale drafts (decided).** Users are notified immediately when a newer version makes their Draft stale, and have an explicit Refresh action. Incoming changes are shown in a preview; the user can accept incoming or keep their own, per task or field, with accept-all shortcuts. Non-overlapping changes are accepted by default, overlaps need an explicit choice, and nothing takes effect until confirmed.
11. **Notifications (decided).** All notifications are handled only by callbacks; the component renders none of its own.
12. **Expiry and limits (decided).** All Drafts expire after a configurable lifetime (default 7 days), counted from the Draft's creation. There is no limit on open Drafts per roadmap or per user.
13. **Returned and Rejected (decided).** A reviewer or approver can send a Draft back as Returned (editable, resubmittable) or Rejected (closed). A Rejected Draft can only be used to open a new Draft; it is never reopened.
14. **Concurrent change resolution (decided).** Pick one version per task.
15. **Rule engine (decided).** The rule engine runs in the back end.
16. **Configuration delivery (decided).** Both static data and a resolver callback.
17. **Mock rendering (decided).** The Gantt can render from mock JSON that follows a predefined, versioned contract.
18. **Externalised access control (decided).** Access rules come from configuration supplied by the consuming component, down to action, field, task and Draft level. Without view access, the Gantt does not render.

## 6. Open points
