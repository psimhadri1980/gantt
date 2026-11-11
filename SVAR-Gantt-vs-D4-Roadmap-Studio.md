# SVAR React Gantt (Open-Source and PRO) vs D4 Roadmap Studio

Research date: 2026-11-11
Sources:
- https://svar.dev/react/gantt/ (the `#pro` section of the product page)
- https://svar.dev/react/gantt/pricing/#compare (Open-Source vs PRO table, licences, FAQ)
- D4 code in `~/d4` (commit `1e86f37`): `apps/web/src/pages/Roadmap.tsx`, `packages/core/src/roadmap.ts`, `packages/ui-kit/src/Gantt.tsx`, `packages/render/src/{roadmap,gantt-geometry}.ts`, `apps/web/src/roadmap-export.ts`, `docs/PLAN.md` (§3a–3c, 4d, 4e, F7, P1)

Screenshots are in `screenshots/`:

| File | Content |
|---|---|
| `svar-home-top.png` | Hero: teal gradient, black nav pill, dark demo Gantt |
| `svar-home-full.png` | Full product page (1440 x 9000) |
| `svar-pro-features.png` | The six PRO feature cards plus "Production-ready" block |
| `svar-developer-first.png` | "Developer-First Architecture" section |
| `svar-pricing-plans.png` | The four PRO licence tiers |
| `svar-compare-table.png` | Open-Source vs PRO comparison table |
| `svar-pricing-full.png` | Full pricing page |

Evidence boundary: SVAR facts come from the public pages (observed text, screenshots, computed CSS). D4 facts come from reading its source. I did not run D4, and I did not try the SVAR PRO trial, so I have not verified how any PRO feature behaves.

---

## 1. SVAR Gantt at a glance

- Product: SVAR React Gantt v2.8 (released 2026-10-07). Native React component, not a wrapper. React 18/19, TypeScript, Next.js 14+ with SSR.
- Vendor: XB Software Sp. z o.o., Warsaw. Also sold for Svelte and Vue.
- Install: `npm install @svar-ui/react-gantt`; use `<Gantt tasks links />` inside a `<Willow>` theme wrapper.
- Stats claimed: 360K+ monthly npm downloads, MIT core, 25+ real-life projects.
- Editions: MIT open-source core, and a PRO edition under a perpetual commercial licence.
- Backend: `RestDataProvider` helper, Go backend example, real-time updates, state-management integration (Redux, MobX, Zustand).
- AI: MCP server and AI setup guide. AI assistants are allowed, but the SVAR source must not be used for model training.
- Release trail of PRO features: 2.6 (rollups, slack visualisation), 2.7 (resource planning, task grouping, individual calendars, Excel/CSV import), 2.8 (auto-scheduling for FS/SS/FF/SF, constraints and deadlines, resource-driven scheduling, real-time updates).

## 2. Style and branding

Observed from the live page (computed styles and pixel samples). Pixel values are approximate.

| Aspect | SVAR |
|---|---|
| Typeface | Roboto, sans-serif; mono `ui-monospace, Consolas` |
| Headings | H1 40px / 500 white on hero; H2 32px / 500 `#42454D` |
| Body text | `#42454D`; light text `#595B66`; inverse `#FFF`, inverse-light `#CCC` |
| Link / accent | Teal `#009688`, hover `#00bba8` |
| Primary button | Teal-blue `rgb(8,122,159)` (`#087A9F`), white text, 4px radius, weight 500 |
| Dark surfaces | `#1A1B1E` (buttons), `#23292A` (menu hover), `#1B1E23` (dark demo band) |
| Hero | Vertical teal gradient, about `#218CAC` to `#117898`, with a faint grid |
| Section backgrounds | White alternating with pale `#F2F8FA` |
| PRO marker | Magenta/pink "PRO" badge on each card and a pink "Get Trial" button |
| Framework tints | React `#5ED3F3`, Svelte `#FC6519`, Vue `#41B883` |
| Layout | Max width 1276px; rounded card grid; black rounded nav pill with the SVAR logo |
| Chips | Small tinted pills: "MIT core", "AI coding ready", "v2.8", and a white "PRO Edition" pill with a star |
| Gantt theme (Willow) | Light and Dark variants (toggle on the demo). Blue task bars with a darker progress fill, green/teal summary bars, magenta milestone diamond, red critical path and "Today" flag, light-blue Start marker, grey weekend shading |
| Toolbar | Purple/blue "+ New task" primary button, icon buttons (edit, delete, move, copy, cut, paste, indent, undo, redo) |

## 3. SVAR PRO features, mapped to D4 Roadmap Studio

Legend: ✅ available in D4, 🟡 partial or different approach, ❌ not in D4, ➖ not applicable to D4's model.

### 3.1 The six headline PRO features

| # | SVAR PRO feature | What SVAR does | D4 status | D4 evidence and gap |
|---|---|---|---|---|
| 1 | **Auto-scheduling and critical path** | All four dependency types (FS, SS, FF, SF) with lag. Dates, slack and critical path recalculate when linked tasks change. Manual and inactive task modes. | ✅ core, 🟡 modes | `roadmap.ts`: `DependencyType` has all four types, `lagDays`, forward and backward pass, `slackDays`, `critical`, `criticalPath`, topological order, cycle detection (Tarjan). Gap: D4 does not write the computed dates back (decision D31: the plan stays the user's and pushes are reported as conflicts). No manual/inactive mode toggle. |
| 2 | **Constraints and deadlines** | Six constraint types (e.g. start no earlier than, must finish on). Conflict list with one-click fixes. Deadline flags that warn when late. | 🟡 | The planned date acts as an implicit "not earlier than" constraint. Conflicts are listed: dependency violated ("Planned too early" with a days figure), misses milestone, past due, done before predecessor, change after retirement, duplicate introduction, cycle, missing dates. Gap: no other constraint types (MSO, MFO, SNLT, FNLT), no per-task deadline field, no one-click fix. Clicking a conflict selects and highlights its items. |
| 3 | **Resource planning and workload** | Assign people to tasks. Resource load chart and over-allocation histogram. | ❌ | No resources, capacity or histogram in the roadmap model. D4's graph does hold actors and divisions, so assignment could come from relationships, but nothing is wired. |
| 4 | **Working-time calendars** | Durations respect working days, weekends, holidays. Individual calendars per task and per resource. Resource-driven scheduling. | ❌ | `roadmap.ts` counts whole calendar days (`toDay`/`fromDay`); no calendars. Weekends and holidays are not highlighted. |
| 5 | **Export and import** | Export to PDF, PNG, Excel, MS Project. Import MS Project. (Excel/CSV import is in the open-source core.) | 🟡 | ✅ PDF, PNG, SVG via `createRenderJob` (headless Chromium, A4/A3/fit, 2x PNG); ✅ CSV and Mermaid (`roadmap-export.ts`); ✅ scheduled recurring render reports (Schedule…, PLAN 4e); ✅ spreadsheet import exists for the model (worker, `packages/codecs`). ❌ MS Project import/export. ❌ Roadmap-specific Excel export was not found (the codecs package has Excel for model data, not the roadmap view). |
| 6 | **Baselines and progress tracking** | Baselines versus actual dates. Progress line. S-curve. | 🟡 | ✅ Planned-versus-earliest outline (dashed) shows plan against dependency-driven dates; ✅ status-coloured bars (`st-*` classes); ✅ today line. ❌ No saved baselines, no progress line, no S-curve. Scenario diff is planned in PLAN.md (P1) but not built in the Gantt. |

### 3.2 Other PRO items from the pricing table

| SVAR PRO feature | D4 status | Notes |
|---|---|---|
| Rollups (summary bars showing children) | ❌ | D4 shows lanes as headers, not summary bars rolled up from children. |
| Slack (float) visualisation | 🟡 | Slack is computed and shown in the item panel ("N days" or a critical badge). Not drawn on the chart. |
| Baselines, S-curve, progress line | ❌ | See 3.1 #6. |
| Manual and inactive task modes | ❌ | No such task modes. Retired items are handled by the change-after-retirement conflict. |
| Working-days calendar (non-linear time scale) | ❌ | See 3.1 #4. |
| Placeholder row | ❌ | D4's Gantt is read-only. |
| Task grouping | ✅ | Lanes by initiative, division, status, type, milestone, or none (`LANE_KINDS`). Grouping is derived from graph data rather than user-defined. |
| Individual calendars for tasks and resources | ❌ | None. |
| Split tasks | ❌ | None. |
| WBS codes | ❌ | None. The graph has hierarchy through `CONTAINS`, but no WBS numbering. |
| Assign resources by drag-and-drop | ❌ | See 3.1 #3. |
| Resource load chart / histogram / resource-driven scheduling | ❌ | See 3.1 #3. |
| Sub-grid panel | 🟡 | D4 has a right-hand item details panel (planned/earliest dates, duration, slack, depends on, needed by, changes, conflicts). It is not a sub-grid inside the Gantt. |
| Vertical markers | 🟡 | A "Today" line exists. Milestones are diamonds. No user-defined markers. |
| Undo/Redo | ❌ | No in-chart editing, hence none. D4 does have an event log and change proposals (four-eyes review) at the model level. |
| MS Project import/export | ❌ | See 3.1 #5. |
| Excel export | 🟡 | See 3.1 #5. |

## 4. Open-source (MIT) features, mapped to D4

| SVAR open-source feature | D4 status | Notes |
|---|---|---|
| Summary tasks and milestones | ✅ | Deliverables and milestones; Initiative/Program/Portfolio scope; milestone diamonds. |
| Task dependencies (display and editing) | 🟡 | Displayed as elbow arrows, critical ones highlighted, and typed (FS/SS/FF/SF). Editing happens in the element editor, not on the chart. |
| Hierarchical sub-task view | 🟡 | Lanes, not an expandable tree. |
| Unscheduled tasks | 🟡 | Reported as a "Missing dates" conflict instead of being drawn. |
| Drag and resize bars | ❌ | Read-only SVG. "Drag-to-reschedule" is named in the PLAN (P1) but `Gantt.tsx` has no drag handlers. "Edit dates" opens the element editor. |
| Drag to reorder, action column, backlog drag | ❌ | None. |
| Edit progress and dependencies on the chart | ❌ | None. |
| Inline grid editing, standalone edit form | 🟡 | The edit form is the generic metamodel-driven element editor, reached via a link. |
| Context menu and toolbar | ❌ | Toolbar buttons for exports only. |
| Sorting by column headers, task filtering | 🟡 | No column grid. Scope picker (initiatives, divisions, any element search) filters the content; lanes group it. |
| Tooltips for tasks and links | 🟡 | Native SVG `<title>` tooltips on bars (name, dates, planned dates, slack). None on links. |
| Zooming (default and custom levels) | 🟡 | Week, Month and Quarter presets only. |
| Keyboard shortcuts | 🟡 | Bars are focusable buttons (Tab, Enter/Space to select) with aria-labels. No shortcut set. |
| Resize and hide chart/grid parts | ❌ | Fixed three-pane layout. |
| Compact mode for small screens | ❓ | Not verified in the code I read. |
| Scale and header configuration, custom scales | 🟡 | Via zoom presets and the axis geometry in `@d4/render`. |
| Duration units (hour/day) | ❌ | Whole days only. |
| Highlight weekends and holidays | ❌ | None. |
| Templates for cells and bars | ❌ | Bar styling comes from CSS classes (`gantt-bar`, `critical`, `conflict`, `st-*`). |
| Fullscreen / readonly mode | 🟡 | Always read-only. No fullscreen toggle. |
| Light and dark themes | ✅ | Design tokens in `styles.css` with a dark theme; the Gantt uses CSS classes bound to them. |
| Styling with CSS variables | ✅ | Same tokens; the ui-kit Gantt takes colours from them. |
| Localization | ❓ | Not verified. |
| Fast performance, dynamic loading, large data | ❌/🟡 | No row virtualisation in `Gantt.tsx` (it renders every row as SVG). Large scopes go through the worker for computation (PLAN P4). SVAR demos 100,000 tasks. |
| API to listen, intercept and run data ops | 🟡 | REST and GraphQL for the roadmap; typed SDK; no in-chart event interception. |
| RestDataProvider / backend binding | ✅ | `GET /v1/workspaces/{ws}/roadmap` and GraphQL `Workspace.roadmap`. |
| Real-time updates | ❌ | None. |
| Import from Excel / CSV | 🟡 | Spreadsheet import exists for the model (deliverables could arrive through it), not for the Gantt directly. |
| Export to PDF, PNG, Excel (PRO) | See 3.1 #5 | |

## 5. What D4 Roadmap Studio has that SVAR does not

These are graph-native strengths, and SVAR has nothing comparable:

- Scope derived from the enterprise graph: pick initiatives, divisions or any element, and deliverables are resolved through `CONTAINS`/`CHANGES`/`DEPENDS_ON`, including query-catalog results.
- Change impact per deliverable: the item panel lists elements a deliverable INTRODUCEs, MODIFYs or RETIREs, with their target lifecycle, linking back to the Explorer.
- Model-aware conflict rules: change after retirement, duplicate introduction, misses milestone.
- Shareable view state in the URL (`scope`, `lanes`, `zoom`).
- Server-side picture rendering (PDF/PNG/SVG, paper sizes) and scheduled report delivery with run-date "today" handling.
- Governance around the data: lifecycle states, change proposals with four-eyes review, event log, RBAC.
- The Gantt lives in `@d4/ui-kit` and `@d4/render`, so the same SVG serves the UI and exports.

## 6. Summary scorecard

SVAR PRO has 6 headline features plus the following items from the comparison table. Counting only the PRO-only rows listed in section 3 (headline features and the extra table rows):

| D4 status | Count | Items |
|---|---|---|
| ✅ Available | 1 | Task grouping (as lanes) |
| 🟡 Partial | 7 | Auto-scheduling and critical path (engine yes, no write-back or modes), constraints and deadlines, export, baselines (planned vs earliest only), slack visualisation, sub-grid panel, vertical markers |
| ❌ Missing | 10 | Resource planning and workload, working-time calendars, rollups, split tasks, WBS codes, individual calendars, placeholder row, undo/redo, MS Project import/export, resource-driven scheduling |

Note on counting: the 🟡 and ❌ numbers depend on how rows are grouped (for example, the resource features appear as several separate rows). Treat the counts as a guide, not a measure.

Headline: D4 already matches SVAR PRO on the scheduling engine core (all four dependency types, lag, slack, critical path, cycle detection) and on server-side export, and goes further on graph-derived scope and change impact. It does not yet match PRO on interactivity (it is read-only), calendars, resources, baselines, and MS Project interchange.

## 7. Suggested gap-closing order for D4

Ranked by value for an enterprise change roadmap against effort. These are my recommendations, not something either source states.

1. **Drag-to-reschedule and resize on bars** (already in PLAN P1). It writes planned dates through the existing command pipeline, so change proposals and the event log still apply. This is the largest usability gap against the open-source SVAR core.
2. **Constraints and deadlines.** Add a constraint type and deadline attribute to deliverables in the metamodel, and extend the conflict kinds. This fits the existing "explain, don't rewrite" philosophy (D31), and offers suggested fixes.
3. **Baselines and progress line.** Reuse D4's temporal/scenario resolution to snapshot a roadmap as a baseline, then draw it under the bars. Scenario diff is already on the plan.
4. **Working-time calendars.** Make `roadmap.ts` calendar-aware (workspace calendar first, then per-owner), and shade weekends and holidays on the axis.
5. **Rollups and an expandable hierarchy** using `CONTAINS`, plus row virtualisation for large scopes.
6. **Resource view** driven from actor/team relationships, with a workload histogram. Largest effort, and only valuable if capacity data is modelled in the graph.
7. **MS Project and roadmap Excel export** via `@d4/codecs`, if customers ask for them.

Alternative to building: SVAR PRO could be embedded instead, but it would replace the D4 SVG Gantt and its graph-derived semantics (lanes, change impact, conflicts), and a SaaS deployment needs at least the Application licence ($1,899 for 5 developers, 1 project). The Developer licence forbids SaaS. I would build the gaps in D4 rather than embed, because the value of Roadmap Studio is its graph-derived semantics, but that is a product decision for the team.

## 8. SVAR licensing and pricing (from the compare page)

All PRO licences are perpetual and include 1 year of support and updates, with no deployment fees.

| Tier | Price | Developers | Projects | SaaS | Support |
|---|---|---|---|---|---|
| Developer | $749 | 1 | 1 | No | Standard (10 tickets/yr, 24-48h) |
| Application | $1,899 ($379/dev) | 5 | 1 | Yes | Priority (24h) |
| Team (most popular) | $3,399 ($679/dev) | 5 | Unlimited | Yes | Priority |
| Enterprise | $6,799 ($339/dev) | 20 | Unlimited | Yes | Priority |

- Renewal after year one: 70% of the current price within 2 months of expiry, 80% later.
- You may modify the source, but the modified code cannot be distributed as a competing standalone product and SVAR gets rights to your modifications.
- A 30-day free trial exists (fully functional, SVAR watermark).

## 9. Open questions

- Whether D4's roadmap view should ever write computed dates back (D31 says no).
- Whether D4 supports compact mode or localisation of the Gantt (not verified).
- Whether SVAR's trial matches the marketing screenshots (not tested).
