# @gantt/contract

Generated from the TypeScript sources by `npm run docs:api`; do not edit by hand.

24 exports.

## AccessConfig

*interface* · [packages/contract/src/types.ts](../../packages/contract/src/types.ts)

```ts
export interface AccessConfig {
  subject: { id: string; roles: string[] };
  rules: { effect: 'allow' | 'deny'; permissions: string[]; [k: string]: unknown }[];
}
```

## Baseline

*interface* · [packages/contract/src/types.ts](../../packages/contract/src/types.ts)

A snapshot of the plan at a version of Current (B1, K22). Saving one does not change the plan.

```ts
export interface Baseline {
  id: string;
  name: string;
  /** The version of Current it was taken from. */
  version: number;
  savedAt: string;
  savedBy: string;
  tasks: { id: string; start: IsoDate; end: IsoDate; work: number }[];
}
```

## Calendar

*interface* · [packages/contract/src/types.ts](../../packages/contract/src/types.ts)

```ts
export interface Calendar {
  id: string;
  name: string;
  /** ISO weekday numbers, 1 = Monday … 7 = Sunday. */
  workingDays: number[];
  hoursPerDay?: number;
  holidays?: IsoDate[];
}
```

## ConstraintType

*type* · [packages/contract/src/types.ts](../../packages/contract/src/types.ts)

```ts
export type ConstraintType = 'ASAP' | 'SNET' | 'SNLT' | 'FNET' | 'FNLT' | 'MSO' | 'MFO';
```

## CONTRACT_ID

*const* · [packages/contract/src/types.ts](../../packages/contract/src/types.ts)

```ts
const CONTRACT_ID: 'gantt-roadmap/1'
```

## CONTRACT_MAJOR

*const* · [packages/contract/src/types.ts](../../packages/contract/src/types.ts)

```ts
const CONTRACT_MAJOR: 1
```

## CONTRACT_NAME

*const* · [packages/contract/src/types.ts](../../packages/contract/src/types.ts)

Contract `gantt-roadmap/1` (plan section 3b).

```ts
const CONTRACT_NAME: 'gantt-roadmap'
```

## DurationUnit

*type* · [packages/contract/src/types.ts](../../packages/contract/src/types.ts)

```ts
export type DurationUnit = 'day' | 'hour';
```

## isIsoDate

*function* · [packages/contract/src/validate.ts](../../packages/contract/src/validate.ts)

```ts
export function isIsoDate(v: unknown): v is string
```

## IsoDate

*type* · [packages/contract/src/types.ts](../../packages/contract/src/types.ts)

ISO date `YYYY-MM-DD` in the roadmap's time zone.

```ts
export type IsoDate = string;
```

## Issue

*interface* · [packages/contract/src/validate.ts](../../packages/contract/src/validate.ts)

```ts
export interface Issue { path: string; message: string }
```

## Link

*interface* · [packages/contract/src/types.ts](../../packages/contract/src/types.ts)

```ts
export interface Link {
  id: string;
  source: string;
  target: string;
  type: LinkType;
  kind?: string;
  lag?: number;
  lagUnit?: DurationUnit;
}
```

## LinkType

*type* · [packages/contract/src/types.ts](../../packages/contract/src/types.ts)

```ts
export type LinkType = 'FS' | 'SS' | 'FF' | 'SF';
```

## Proposal

*interface* · [packages/contract/src/types.ts](../../packages/contract/src/types.ts)

```ts
export interface Proposal {
  id: string;
  name: string;
  owner: string;
  state: string;
  baseVersion: number;
  createdAt: string;
  submittedAt?: string;
  expiresAt?: string;
  changes: ProposalChange[];
}
```

## ProposalChange

*interface* · [packages/contract/src/types.ts](../../packages/contract/src/types.ts)

```ts
export interface ProposalChange {
  entity: 'task' | 'link' | 'resource' | 'calendar' | 'roadmap';
  op: 'create' | 'update' | 'delete';
  id: string;
  fields?: Record<string, unknown>;
  by: string;
  at: string;
}
```

## Resource

*interface* · [packages/contract/src/types.ts](../../packages/contract/src/types.ts)

```ts
export interface Resource { id: string; name: string; capacityFte?: number; calendar?: string }
```

## ResourceAssignment

*interface* · [packages/contract/src/types.ts](../../packages/contract/src/types.ts)

```ts
export interface ResourceAssignment { id: string; allocation: number }
```

## Roadmap

*interface* · [packages/contract/src/types.ts](../../packages/contract/src/types.ts)

```ts
export interface Roadmap {
  id: string;
  name: string;
  version: number;
  timeZone: string;
  start: IsoDate;
  defaultCalendar?: string;
  statusDate?: IsoDate;
  /** Capacity in FTE that people without resource data are measured against (E7); omit for none. */
  defaultCapacityFte?: number;
}
```

## RoadmapDocument

*interface* · [packages/contract/src/types.ts](../../packages/contract/src/types.ts)

```ts
export interface RoadmapDocument {
  contract: string;
  roadmap: Roadmap;
  calendars?: Calendar[];
  tasks: Task[];
  links: Link[];
  resources?: Resource[];
  proposals?: Proposal[];
  access?: AccessConfig;
  /** Saved plans to compare with (B1): snapshots of a version of Current. */
  baselines?: Baseline[];
}
```

## Task

*interface* · [packages/contract/src/types.ts](../../packages/contract/src/types.ts)

```ts
export interface Task {
  id: string;
  name: string;
  type: TaskType;
  parent: string | null;
  kind?: string;
  lane?: boolean;
  /** Position among siblings, ascending (D2). Tasks without it keep their place in the array. */
  order?: number;
  /** The task has children that are loaded on demand (H2); omit once they are present. */
  hasChildren?: boolean;
  start?: IsoDate;
  duration?: number;
  durationUnit?: DurationUnit;
  end?: IsoDate;
  progress?: number;
  mode?: TaskMode;
  owner?: string;
  resources?: ResourceAssignment[];
  constraint?: { type: ConstraintType; date?: IsoDate };
  deadline?: IsoDate;
  /** Calendar for this task's working time, instead of the roadmap's (C8). */
  calendar?: string;
  /** Split task (D12): after `after` working days of work, a pause of `gap` working days; in order. */
  splits?: { after: number; gap: number }[];
  [extra: string]: unknown;
}
```

## TaskMode

*type* · [packages/contract/src/types.ts](../../packages/contract/src/types.ts)

```ts
export type TaskMode = 'auto' | 'manual' | 'inactive';
```

## TaskType

*type* · [packages/contract/src/types.ts](../../packages/contract/src/types.ts)

```ts
export type TaskType = 'task' | 'summary' | 'milestone';
```

## validate

*function* · [packages/contract/src/validate.ts](../../packages/contract/src/validate.ts)

Validates an unknown value against contract `gantt-roadmap/1` (M3, M4).
Errors carry a path and a reason, e.g. `tasks[12].start: not a date`.
Unknown fields are warnings. Cross-calendar `end` agreement is checked by the engine
(see `checkEnds` in

```ts
export function validate(input: unknown): ValidationResult
```

## ValidationResult

*type* · [packages/contract/src/validate.ts](../../packages/contract/src/validate.ts)

```ts
export type ValidationResult =
  | { ok: true; doc: RoadmapDocument; warnings: Issue[] }
  | { ok: false; errors: Issue[]; warnings: Issue[] };
```
