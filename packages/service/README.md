# @gantt/service

The roadmap service, and the backends the React component reaches it through.

**`RoadmapService`** (`service.ts`) holds Current, its approved versions and every Proposal. Each method takes the
acting user's id, checks their access rules, and throws a `ServiceError` with a code (`noAccess`, `denied`,
`notFound`, `invalid`, `conflict`) when refused. It covers snapshots filtered per user, edits into a Proposal,
lifecycle actions (with separation of duties: by default the submitter cannot approve), concurrency and picks,
refresh and its undo, version history and restore, baselines, and deadline expiry (`tick`). `subscribe` delivers
events (`proposalApproved`, `proposalStale`, `concurrentChange`, …) for live updates.

**Backends** (`backend.ts`) implement `GanttBackend`, the interface the component uses in managed mode:

- `memoryBackend(service, userId)`: calls a service in the same page (demo, tests, single-user tools).
- `httpBackend(baseUrl, userId)`: calls [@gantt/server](../server) over HTTP and receives events over
  server-sent events.

Both fail with the same `BackendError` codes, so the component handles them identically.
