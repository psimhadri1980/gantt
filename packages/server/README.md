# @gantt/server

A reference HTTP server for `RoadmapService`: the API `httpBackend` talks to.

```bash
GANTT_ENABLE_MOCK_DATA=true npm start -w @gantt/server
```

It listens on port 8787 (`PORT`) and serves the small sample with the users in `mock/src/samples/roles.json`;
`GANTT_MOCK_FILE` and `GANTT_RULES_FILE` point it at other files. Mock data is its only data source, so it
refuses to start without `GANTT_ENABLE_MOCK_DATA=true`, and always in production.

| Method and path | Service call |
| --- | --- |
| `GET /config` | Workflow configuration |
| `GET /roadmap` | Snapshot for the user (Current, versions, Proposals, permissions) |
| `GET /versions/:v` | An approved version |
| `POST /versions/:v/restore` | New Proposal restoring that version |
| `POST /baselines` | Save a baseline |
| `GET /events` | Server-sent events for the user |
| `POST /proposals` | New Proposal with changes |
| `GET /proposals/:id/document`, `/concurrency` | The Proposal's roadmap; its concurrent changes |
| `POST /proposals/:id/changes`, `/new-from`, `/pick`, `/refresh-preview`, `/refresh`, `/undo-refresh` | Edit, copy, resolve, refresh |
| `POST /proposals/:id/{submit,withdraw,review,approve,return,reject,discard}` | Lifecycle actions |

Errors are JSON `{ error, code }` with status 403 (no access or denied), 404 (not found), 422 (invalid) or 409 (conflict).

Settings (`env.ts`): `GANTT_ENVIRONMENT` (or `NODE_ENV`), `GANTT_ENABLE_MOCK_DATA` (ignored in production),
`GANTT_ENFORCE_SEPARATION_OF_DUTIES` (`false` is refused in production). Every relaxed setting is logged.

**Security:** the acting user is taken from the `x-gantt-user` header (or `?user=`) without authentication.
This server exists to define and test the API; a deployment must authenticate users in front of it and set
that header itself.
