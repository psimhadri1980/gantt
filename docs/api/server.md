# @gantt/server

A reference HTTP server for the roadmap service: JSON API and server-sent events.

Generated from the TypeScript sources by `npm run docs:api`; do not edit by hand.

3 exports.

## ServerEnv

*interface* · [packages/server/src/env.ts](../../packages/server/src/env.ts)

Environment configuration (plan section 4). The safe direction wins for every variable.

```ts
export interface ServerEnv { mockData: boolean; separationOfDuties: boolean; environment: string; port: number }
```

## createGanttServer

*function* · [packages/server/src/server.ts](../../packages/server/src/server.ts)

Reference server (Phase 2 and 3): every request is evaluated against the same rules the component uses,
and every response is filtered for the user (L9, L12). The user comes from the `x-gantt-user` header;
authentication is the host's job, so put this behind your own sign-in.

```ts
export function createGanttServer(service: RoadmapService, opts: { allowOrigin?: string } = {}): Server
```

## readEnv

*function* · [packages/server/src/env.ts](../../packages/server/src/env.ts)

Reads the server's settings from environment variables (GANTT_ENVIRONMENT or NODE_ENV, GANTT_ENABLE_MOCK_DATA,
GANTT_ENFORCE_SEPARATION_OF_DUTIES, PORT). Refuses to start in production with separation of duties turned off;
ignores mock data in production; and returns a warning for every relaxed setting so the log shows it.

```ts
export function readEnv(env: Record<string, string | undefined>): { ok: true; env: ServerEnv; warnings: string[] } | { ok: false; error: string }
```
