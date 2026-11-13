# @gantt/engine

Scheduling and placement without UI: working calendars, the scheduler and critical path, bar placement, resource load and levelling, baselines and progress tracking.

Generated from the TypeScript sources by `pnpm run docs:api`; do not edit by hand.

37 exports.

## CompactPlacement

*interface* · [packages/engine/src/transfer.ts](../../packages/engine/src/transfer.ts)

A placement in transferable form: one slot per task, in document order. Typed arrays move between a
worker and the main thread without copying, so only the document itself is cloned (C11).

```ts
export interface CompactPlacement {
  start: Float64Array; end: Float64Array; duration: Float64Array; progress: Float64Array;
  /** 1 when scheduled. */
  scheduled: Uint8Array;
  span?: { start: number; end: number };
  /** Rare extras, by task index: pieces of split tasks and partial last days of hour tasks (D12, G4). */
  extra: Record<number, { segments?: [number, number][]; endFraction?: number }>;
  errors: Issue[]; warnings: Issue[];
}
```

## DEFAULT_CALENDAR

*const* · [packages/engine/src/calendar.ts](../../packages/engine/src/calendar.ts)

```ts
const DEFAULT_CALENDAR: Calendar
```

## DayNum

*type* · [packages/engine/src/calendar.ts](../../packages/engine/src/calendar.ts)

Working-time arithmetic on whole days (C7).
Dates are handled as integer day numbers (days since 1970-01-01) so they are independent
of the browser's time zone; the contract defines dates in the roadmap's time zone.

```ts
export type DayNum = number;
```

## IssueFix

*interface* · [packages/engine/src/scheduler.ts](../../packages/engine/src/scheduler.ts)

One way to resolve a scheduling problem (C5), as data operations the caller runs (and can undo).

```ts
export interface IssueFix {
  label: string;
  ops: ({ type: 'task.update'; id: string; fields: Record<string, unknown> } | { type: 'link.delete'; id: string })[];
}
```

## LoadBucket

*interface* · [packages/engine/src/load.ts](../../packages/engine/src/load.ts)

Demand and capacity of one row in one period (a day, week or month, depending on the zoom).

```ts
export interface LoadBucket {
  start: DayNum; end: DayNum;
  /** Demand in FTE-days. */
  demand: number;
  /** Capacity in FTE-days, or null where none is known (no over-allocation is shown then). */
  capacity: number | null;
  /** Working days in the bucket on which demand exceeds that day's capacity (E4). */
  overDays: number;
}
```

## LoadPeriod

*type* · [packages/engine/src/load.ts](../../packages/engine/src/load.ts)

Resources (E1–E7): load per period against capacity, default demand when there is no resource data,
and resource levelling. Work and capacity are in FTE-days: one person full time for one working day.

```ts
export type LoadPeriod = 'day' | 'week' | 'month';
```

## LoadRow

*interface* · [packages/engine/src/load.ts](../../packages/engine/src/load.ts)

One row of the load chart: a named resource, an owner without resource data, or the total demand.

```ts
export interface LoadRow {
  key: string;
  label: string;
  kind: 'resource' | 'owner' | 'unassigned' | 'total';
  /** FTE per working day, where known. */
  capacityFte: number | null;
  buckets: LoadBucket[];
  /** Tasks that put demand on this row. */
  tasks: string[];
}
```

## PlacedTask

*interface* · [packages/engine/src/schedule.ts](../../packages/engine/src/schedule.ts)

A task with its resolved span. `start`/`end` are inclusive day numbers; absent when unscheduled.

```ts
export interface PlacedTask {
  task: Task;
  start?: DayNum;
  end?: DayNum;
  /** Working days. For summaries, derived from the span on the default calendar. */
  duration?: number;
  progress: number;
  scheduled: boolean;
  /** Pieces of a split task (D12); one piece otherwise. */
  segments?: [DayNum, DayNum][];
  /** Share of the last day the work uses (hour-based tasks, G4); 1 for whole days. */
  endFraction?: number;
}
```

## Placement

*interface* · [packages/engine/src/schedule.ts](../../packages/engine/src/schedule.ts)

The placed roadmap: each task's start, end, duration and progress as drawn, plus the default calendar.

```ts
export interface Placement {
  byId: Map<string, PlacedTask>;
  calendar: WorkCalendar;
  warnings: Issue[];
  errors: Issue[];
  span?: { start: DayNum; end: DayNum };
}
```

## ProgressPoint

*interface* · [packages/engine/src/tracking.ts](../../packages/engine/src/tracking.ts)

Where the progress line passes one task: left of the status date when the task is behind, right when ahead.

```ts
export interface ProgressPoint {
  taskId: string;
  /** Where the line passes on this task's row, as a (fractional) day number. */
  day: number;
  /** Progress the plan expects by the status date (0–1). */
  expected: number;
  /** Working days ahead (positive) or behind (negative). */
  variance: number;
  status: 'ahead' | 'behind' | 'onTrack';
}
```

## ResourceLoad

*interface* · [packages/engine/src/load.ts](../../packages/engine/src/load.ts)

Result of `resourceLoad`: the rows to draw and whether demand was assumed (no assignments at all).

```ts
export interface ResourceLoad {
  rows: LoadRow[];
  /** True when no task has assignments: every task counts as 1 FTE (E7). */
  defaultDemand: boolean;
}
```

## SCurve

*interface* · [packages/engine/src/tracking.ts](../../packages/engine/src/tracking.ts)

Planned versus actual cumulative work over time, for the S-curve chart.

```ts
export interface SCurve {
  /** One entry per calendar day from the first start to the last finish. */
  days: DayNum[];
  /** Cumulative planned work (working days). */
  planned: number[];
  /** Cumulative work done, up to the status date (null after it). */
  actual: (number | null)[];
  /** Cumulative work in the baseline, when one is given. */
  baseline: number[] | null;
  totals: { planned: number; actual: number; baseline: number | null };
}
```

## ScheduleIssue

*interface* · [packages/engine/src/scheduler.ts](../../packages/engine/src/scheduler.ts)

A problem the scheduler found. `kind` says which: a dependency cycle, a link the stored dates break, a constraint
that cannot be met, or a deadline the task finishes after. `taskId`/`linkId` point at what to fix.

```ts
export interface ScheduleIssue {
  kind: 'cycle' | 'brokenDependency' | 'constraint' | 'deadline';
  taskId?: string;
  linkId?: string;
  message: string;
  /** Working days by which it is broken. */
  by?: number;
  /** The date that would satisfy it (a start for dependencies; the actual date for constraints and deadlines). */
  suggest?: string;
  /** Links in a cycle. */
  linkIds?: string[];
}
```

## ScheduleResult

*interface* · [packages/engine/src/scheduler.ts](../../packages/engine/src/scheduler.ts)

What `schedule` returns: the computed dates per task, the edits that would apply them, the problems found,
and the latest finish (undefined for an empty roadmap).

```ts
export interface ScheduleResult {
  tasks: Map<string, TaskSchedule>;
  /** Changes that bring the stored dates in line with the schedule (K1): start, and end dropped. */
  changes: { id: string; start: string }[];
  issues: ScheduleIssue[];
  /** Ids in a dependency cycle, when there is one; nothing is scheduled then. */
  cycle?: string[];
  end?: DayNum;
}
```

## TaskSchedule

*interface* · [packages/engine/src/scheduler.ts](../../packages/engine/src/scheduler.ts)

The scheduling engine (C1, C2, C9, C10, C11): forward and backward pass over the four dependency types
with lag, in working time, giving each task its earliest dates, slack and whether it is critical.
It has no interface dependency and runs in the browser (off the main thread) and on the server.

Rules:
- A task with incoming dependencies starts as soon as they, its constraint and the roadmap start allow
  ("as soon as possible", C10), following its predecessors both later and earlier.
- A task with no incoming dependencies keeps its own start (its planned start), never before the
  roadmap start. Pulling every unlinked task to the roadmap start would discard the plan.
- Manual tasks keep their dates; a dependency they break is reported. Inactive tasks are ignored.
- A dependency into a summary applies to each of its leaf tasks; a dependency from a summary uses the
  summary's span, derived from its children.
- Constraints SNET, FNET, MSO and MFO set an earliest date; SNLT, FNLT and deadlines are reported when broken.

```ts
export interface TaskSchedule {
  start: DayNum;
  end: DayNum;
  /** Latest start and finish that do not delay the end of the roadmap. */
  lateStart: DayNum;
  lateFinish: DayNum;
  /** Total slack in working days (negative when a manual task or constraint forces lateness). */
  slack: number;
  critical: boolean;
  /** The link that sets this task's start, if any (shown in a connector's details). */
  drivenBy?: string;
}
```

## TaskSpan

*interface* · [packages/engine/src/calendar.ts](../../packages/engine/src/calendar.ts)

Where a task's work falls (C8, D12, G4): its pieces in working time on its own calendar, and how much of
the last day it uses (an 8-hour day calendar and a 4-hour task: 0.5). `work` is in working days and may
be fractional for hour-based tasks.

```ts
export interface TaskSpan { start: DayNum; end: DayNum; segments: [DayNum, DayNum][]; endFraction: number; occupied: number }
```

## WorkCalendar

*class* · [packages/engine/src/calendar.ts](../../packages/engine/src/calendar.ts)

Working time of one calendar (C3, G4): which weekdays are worked and which dates are holidays. Every date
computation in the engine goes through it, so a task on a 4-day calendar is placed in its own working time.

```ts
export class WorkCalendar {
  readonly id: string;
  constructor(cal: Calendar = DEFAULT_CALENDAR)
  isHoliday(d: DayNum): boolean
  holidaysBetween(from: DayNum, to: DayNum): DayNum[]
  isWorking(d: DayNum): boolean
  nextWorking(d: DayNum): DayNum
  prevWorking(d: DayNum): DayNum
  endOf(start: DayNum, duration: number): DayNum
  shift(d: DayNum, n: number): DayNum
  workingDaysBetween(start: DayNum, end: DayNum): number
}
```

## applySchedule

*function* · [packages/engine/src/scheduler.ts](../../packages/engine/src/scheduler.ts)

Applies a schedule's changes to a document (K1): new starts; a stored end is dropped so it cannot disagree.

```ts
export function applySchedule(doc: RoadmapDocument, r: ScheduleResult): RoadmapDocument
```

## buildCalendars

*function* · [packages/engine/src/calendar.ts](../../packages/engine/src/calendar.ts)

Builds a `WorkCalendar` for each calendar in the document, keyed by id.

```ts
export function buildCalendars(cals: Calendar[] | undefined): Map<string, WorkCalendar>
```

## expandPlacement

*function* · [packages/engine/src/transfer.ts](../../packages/engine/src/transfer.ts)

Rebuilds a full Placement from the compact form against the same document.

```ts
export function expandPlacement(doc: RoadmapDocument, c: CompactPlacement): Placement
```

## fixesFor

*function* · [packages/engine/src/scheduler.ts](../../packages/engine/src/scheduler.ts)

Explained fixes for an issue (C5): move, remove the cause, or switch to automatic scheduling.

```ts
export function fixesFor(doc: RoadmapDocument, issue: ScheduleIssue): IssueFix[]
```

## fromDay

*function* · [packages/engine/src/calendar.ts](../../packages/engine/src/calendar.ts)

Converts a day number back to an ISO date string.

```ts
export function fromDay(d: DayNum): IsoDate
```

## levelResources

*function* · [packages/engine/src/load.ts](../../packages/engine/src/load.ts)

Resource levelling (E6): tasks with assignments are delayed, in order of their start, until every
assigned resource has capacity on each of their days; dependencies are then re-applied, and this repeats
until nothing moves. Returns the changes (a new start and a start-no-earlier-than constraint) and the
tasks that could not be fitted within a year.

```ts
export function levelResources(doc: RoadmapDocument): { changes: { id: string; fields: Partial<Task> }[]; unresolved: string[] }
```

## periods

*function* · [packages/engine/src/load.ts](../../packages/engine/src/load.ts)

Period boundaries covering [from, to].

```ts
export function periods(from: DayNum, to: DayNum, period: LoadPeriod): [DayNum, DayNum][]
```

## place

*function* · [packages/engine/src/schedule.ts](../../packages/engine/src/schedule.ts)

Places each task from its start and duration in working time, and derives summary dates and
progress from the children (C7, C12). Phase 1 does not schedule from links; that is Phase 4.

```ts
export function place(doc: RoadmapDocument): Placement
```

## placeCompact

*function* · [packages/engine/src/transfer.ts](../../packages/engine/src/transfer.ts)

Places the roadmap and packs the result into typed arrays, so the worker can transfer it without copying.

```ts
export function placeCompact(doc: RoadmapDocument): CompactPlacement
```

## progressLine

*function* · [packages/engine/src/tracking.ts](../../packages/engine/src/tracking.ts)

Progress line (B3) on a status date: for every task that has started or should have, the line passes
through its progress; tasks neither started nor due keep the line on the status date.

```ts
export function progressLine(placement: Placement, statusDay: DayNum, tolerance = 0.5): Map<string, ProgressPoint>
```

## resourceLoad

*function* · [packages/engine/src/load.ts](../../packages/engine/src/load.ts)

Load per resource and period (E3, E4, E5). With assignments: one row per resource (capacity from its
capacityFte on its own calendar) plus "Unassigned" for tasks without any. Without: default demand of
1 FTE per task working day, as a total and per owner, measured against the roadmap's default capacity (E7).

```ts
export function resourceLoad(doc: RoadmapDocument, placement: Placement, opts: { period: LoadPeriod; from?: DayNum; to?: DayNum }): ResourceLoad
```

## sCurve

*function* · [packages/engine/src/tracking.ts](../../packages/engine/src/tracking.ts)

S-curve (B2). The planned curve spreads each leaf task's work over its working days; the actual curve
reaches each task's earned work (work × progress) on the status date, following the plan's shape before
it; the baseline curve does the same for the saved plan. Totals equal the sums over the data.

```ts
export function sCurve(placement: Placement, statusDay: DayNum, baseline?: Baseline): SCurve
```

## schedule

*function* · [packages/engine/src/scheduler.ts](../../packages/engine/src/scheduler.ts)

Computes the schedule of a whole roadmap (C1–C8): every task's earliest start and finish from its own date,
its constraint, its predecessors (with lag, on each task's calendar) and its parent's dates. Summaries span their
children. Tasks in a cycle are reported and left at their stored dates. Pure: the document is not changed.

```ts
export function schedule(doc: RoadmapDocument): ScheduleResult
```

## spanOf

*function* · [packages/engine/src/calendar.ts](../../packages/engine/src/calendar.ts)

Places `work` working days starting at `start` (moved forward to the first working day), honouring planned
interruptions (`splits`: after N working days, pause for `gap` working days). See `TaskSpan` for the result.

```ts
export function spanOf(cal: WorkCalendar, start: DayNum, work: number, splits?: { after: number; gap: number }[]): TaskSpan
```

## takeBaseline

*function* · [packages/engine/src/tracking.ts](../../packages/engine/src/tracking.ts)

Snapshot of the plan (B1): each scheduled task's dates and work. Saving one does not change the plan.

```ts
export function takeBaseline(placement: Placement, meta: Omit<Baseline, 'tasks'>): Baseline
```

## toDay

*function* · [packages/engine/src/calendar.ts](../../packages/engine/src/calendar.ts)

Converts an ISO date ("2026-11-13") to a day number: whole days since 1970-01-01 (UTC, so no time-zone shifts).

```ts
export function toDay(iso: IsoDate): DayNum
```

## transferList

*const* · [packages/engine/src/transfer.ts](../../packages/engine/src/transfer.ts)

The array buffers of a compact placement, passed as the transfer list of `postMessage`.

```ts
const transferList: (c: CompactPlacement) => ArrayBuffer[]
```

## weekday

*function* · [packages/engine/src/calendar.ts](../../packages/engine/src/calendar.ts)

ISO weekday 1 = Monday … 7 = Sunday. Day 0 (1970-01-01) was a Thursday.

```ts
export function weekday(d: DayNum): number
```

## whyNotLink

*function* · [packages/engine/src/scheduler.ts](../../packages/engine/src/scheduler.ts)

Whether a new dependency may be drawn from `source` to `target` (C9): not to itself, not between a
summary and its own descendant, not twice, and not if it would close a cycle. Returns the reason.

```ts
export function whyNotLink(doc: RoadmapDocument, source: string, target: string, type: Kind = 'FS'): string | null
```

## workDays

*function* · [packages/engine/src/calendar.ts](../../packages/engine/src/calendar.ts)

A task's work in working days: hours are divided by the calendar's hours per day (G4).

```ts
export function workDays(t: { type: string; duration?: number; durationUnit?: string }, hoursPerDay: number): number
```
