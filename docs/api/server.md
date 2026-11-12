# @gantt/server

Generated from the TypeScript sources by `npm run docs:api`; do not edit by hand.

3 exports.

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

```ts
export function readEnv(env: Record<string, string | undefined>): { ok: true; env: ServerEnv; warnings: string[] } | { ok: false; error: string }
```

## ServerEnv

*interface* · [packages/server/src/env.ts](../../packages/server/src/env.ts)

Environment configuration (plan section 4). The safe direction wins for every variable.

```ts
export interface ServerEnv { mockData: boolean; separationOfDuties: boolean; environment: string; port: number }
```
