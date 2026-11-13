# Gantt

A Gantt chart for roadmaps, built as a native React component (see [ADR-001](ADR-001-Web-Component-vs-React.md)).
It shows tens of thousands of tasks smoothly, schedules them with dependencies and working calendars, enforces
access rules supplied by the host, and can run every change through a review workflow ("Proposals") before it
becomes the approved roadmap.

The features and the order they were built in are described in [Gantt-Feature-Plan.md](Gantt-Feature-Plan.md);
the codes in comments (D1, K7, L12 …) refer to entries in that plan.

## What it does

- **Chart**: tree grid and timeline side by side; zoom from years to hours; virtual scrolling for 10,000+ tasks;
  lanes; markers and today line; light and dark themes; full keyboard use and screen-reader support (WCAG 2.2 AA,
  checked with axe in the tests).
- **Editing**: drag to move and resize bars, set progress and draw links; inline cell editing; indent, outdent,
  reorder, copy, paste and duplicate; undo and redo; bulk edits; a details panel for tasks and links.
- **Views**: sort, filter, group, find; column chooser, resizing, reordering and freezing; saved views.
- **Scheduling**: finish-to-start, start-to-start, finish-to-finish and start-to-finish links with lag; constraints
  and deadlines; per-task calendars and holidays; hour-based tasks; split tasks; critical path and slack; a
  Problems list with suggested fixes.
- **Tracking**: baselines, progress line and S-curve.
- **Resources**: assignments, a resource load chart under the timeline, levelling, and a backlog to drag work from.
- **Access control**: the host passes rules (who may view, edit which tasks or fields, approve …); the component
  filters what each user sees and explains every refused action.
- **Proposals**: changes collect in a Proposal that is submitted, reviewed and approved before it changes the
  approved roadmap ("Current"); separation of duties, deadlines, concurrent-change detection, refresh onto a newer
  Current, version history and restore.
- **Interchange**: import and export CSV, Excel (.xlsx) and Microsoft Project XML; export PNG and PDF.
- **Platform**: translations (English and German built in, every text replaceable), right-to-left layout, first
  day of the week from the locale, server rendering, and a full operation API for the host.

## Quick start

Requirements: Node.js 24 (the sources are TypeScript run directly, without a build step), pnpm 12 (the version in
`package.json` `packageManager`; `corepack enable` installs it) and Google Chrome or Chromium for the end-to-end tests.

```bash
pnpm install
```

```bash
pnpm run dev
```

The demo opens at http://127.0.0.1:5180. Use `?sample=` to pick a sample: `small`, `large` (10,000 tasks),
`lanes`, `lazy` (children loaded on demand), `depth` (calendars, hours, splits), `resources`, `proposals`
(the review workflow with several users) and `invalid` (a refused file).

## Using the component

```tsx
import { Gantt, type GanttHandle } from '@gantt/react';

function Roadmap({ doc, save }) {
  const ref = useRef<GanttHandle>(null);
  return (
    <Gantt
      ref={ref}
      data={doc}                       // a RoadmapDocument (see @gantt/contract)
      access={rules}                   // who may do what; without view access nothing is shown
      onDataChanged={(next) => save(next)}
      locale="en-GB"
      height={600}
    />
  );
}
```

The component is controlled: the host owns the roadmap and stores each version `onDataChanged` reports.
[apps/examples](apps/examples) shows this with local state, a reducer and an external store.

For the review workflow, pass a `backend` instead of `data`: `memoryBackend(service, userId)` runs the
service in the page; `httpBackend(url, userId)` talks to [@gantt/server](packages/server).

Every change, from the UI or from the host through `ref.current.run(operation)`, goes through one pipeline:
interception (`onBeforeOperation`), permission checks, then undo history and notifications. The complete
list of props, operations and types is in the generated [API reference](docs/api/README.md).

## Repository layout

pnpm workspace (`pnpm-workspace.yaml`); every package is TypeScript source with `.ts` imports, used directly by Vite, Vitest and Node.

| Package | Purpose |
| --- | --- |
| [packages/contract](packages/contract) | The roadmap document format: types, JSON Schema, validation |
| [packages/engine](packages/engine) | Calendars, scheduling, placement, resource load, tracking |
| [packages/state](packages/state) | View state: layout, scale, selection, operation pipeline, tree edits, views |
| [packages/access](packages/access) | Access rules and the permission evaluator |
| [packages/proposals](packages/proposals) | Proposal lifecycle, changes, concurrency and refresh |
| [packages/service](packages/service) | The roadmap service and the backends the component uses |
| [packages/server](packages/server) | Reference HTTP server for the service |
| [packages/interchange](packages/interchange) | CSV, Excel and Microsoft Project import and export |
| [packages/mock](packages/mock) | Sample data, a generator and the mock-file loader |
| [packages/react](packages/react) | The React component |
| [apps/demo](apps/demo) | Demo application, end-to-end test target and benchmark page |
| [apps/ssr](apps/ssr) | Server rendering example |
| [apps/examples](apps/examples) | State-management examples |

Only `packages/react` and the apps use React; `pnpm run check:boundaries` keeps it that way, so the engine,
state, access and Proposal logic can run anywhere (a worker, a server, a test).

The engine runs in a Web Worker: the main thread only builds indexes and renders, so placing a large
roadmap never blocks scrolling.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm run dev` | Demo with hot reload |
| `pnpm test` | Unit and component tests (Vitest; jsdom for React) |
| `pnpm run e2e` | Builds the demo and drives Chrome headless through every feature; `E2E_ONLY=regex` runs a subset |
| `pnpm run typecheck` | TypeScript, strict (no unused names, no implicit returns, checked index access) |
| `pnpm run lint` | ESLint with typescript-eslint and the rules of hooks; no warnings allowed |
| `pnpm run check:boundaries` | Fails if a framework-free package imports React |
| `pnpm run docs:api` | Regenerates [docs/api](docs/api) from the sources (`-- --check` fails when out of date) |
| `pnpm run bench` | Performance benchmark of the 10,000-task page against the plan's budgets |
| `pnpm run verify` | Boundaries, types, unit tests and end-to-end tests |
| `pnpm run generate --tasks 50000` | Writes a generated roadmap to standard output |

## Continuous integration and security

GitHub Actions ([.github/workflows](.github/workflows)) run on every pull request and every push to `main`:

- **CI**: boundaries, typecheck, lint, API-reference check and unit tests; the end-to-end suite in Chrome
  (a failed test is retried once on CI and reported as such); and a dependency audit (`pnpm audit` failing on
  moderate issues in runtime dependencies and high issues anywhere, plus the lockfile checked against the
  supply-chain policies in `pnpm-workspace.yaml`).
- **CodeQL**: static security analysis with the extended query set, also weekly.
- **Dependency review**: a pull request that adds a dependency with a known vulnerability fails.
- **Dependabot**: weekly update pull requests for npm packages and actions.

`pnpm-workspace.yaml` pins a patched `minimatch` (GHSA-g3hv-75wg-m249) for every package through `overrides`,
until eslint and typescript-eslint depend on one themselves. It also sets the supply-chain policies every install checks: no package whose provenance
was downgraded, and no version younger than a day.

The server in `packages/server` trusts the user id sent in the `x-gantt-user` header: it is a reference for the
API and the tests, not an authentication layer. A deployment must put real authentication in front of it.

## Documentation

- [Gantt-Feature-Plan.md](Gantt-Feature-Plan.md): features, phases, access-control and environment configuration
- [ADR-001](ADR-001-Web-Component-vs-React.md): why a React component rather than a Web Component
- [docs/api](docs/api/README.md): API reference generated from the TypeScript sources
- Each package's README: what it contains and how its parts fit together
