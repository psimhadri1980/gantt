# @gantt/mock

Generated from the TypeScript sources by `npm run docs:api`; do not edit by hand.

6 exports.

## exportMock

*function* · [packages/mock/src/index.ts](../../packages/mock/src/index.ts)

Export the current state back to JSON in the same contract (M8).

```ts
export function exportMock(doc: RoadmapDocument): string
```

## generate

*function* · [packages/mock/src/generate.ts](../../packages/mock/src/generate.ts)

Deterministic generator for large valid files (M10).

```ts
export function generate(opts: GenerateOptions): RoadmapDocument
```

## GenerateOptions

*interface* · [packages/mock/src/generate.ts](../../packages/mock/src/generate.ts)

```ts
export interface GenerateOptions {
  tasks: number;
  /** Maximum nesting depth of summaries (1 = flat). */
  depth?: number;
  /** Links per leaf task, 0–1+. */
  linkDensity?: number;
  /** Arrange every n-th summary as a lane row. 0 = none. */
  laneEvery?: number;
  seed?: number;
  start?: string;
}
```

## loadMock

*function* · [packages/mock/src/index.ts](../../packages/mock/src/index.ts)

Mock loader (M1, M4, M5). A separate import: a bundle that never imports

```ts
export function loadMock(input: string | unknown): LoadResult
```

## LoadResult

*type* · [packages/mock/src/index.ts](../../packages/mock/src/index.ts)

```ts
export type LoadResult = { ok: true; doc: RoadmapDocument; warnings: Issue[] } | { ok: false; errors: Issue[]; warnings: Issue[] };
```

## splitForLazyLoading

*function* · [packages/mock/src/index.ts](../../packages/mock/src/index.ts)

Splits a roadmap for loading on demand (H2): tasks below `depth` are held back, their parents are marked
`hasChildren: true`, and `loadChildren` returns one level at a time after `delayMs`, like a server would.

```ts
export function splitForLazyLoading(doc: RoadmapDocument, depth = 1, delayMs = 300)
```
