# @gantt/state

Framework-free view state: row layout, time scale, selection, the operation pipeline with undo, tree edits, and sorting, filtering and grouping.

Generated from the TypeScript sources by `npm run docs:api`; do not edit by hand.

66 exports.

## BarLayout

*interface* · [packages/state/src/layout.ts](../../packages/state/src/layout.ts)

One bar on the chart. On an ordinary row it is the row's own task; on a lane row, one of its children.

```ts
export interface BarLayout {
  taskId: string;
  rowIndex: number;
  /** Track within a lane row (0 on ordinary rows). */
  track: number;
}
```

## BarPos

*interface* · [packages/state/src/links.ts](../../packages/state/src/links.ts)

A bar's vertical position: top (y) and height in pixels.

```ts
export interface BarPos { y: number; h: number }
```

## ColumnState

*interface* · [packages/state/src/view.ts](../../packages/state/src/view.ts)

A grid column's width and visibility as the user left them.

```ts
export interface ColumnState { id: string; width?: number; hidden?: boolean }
```

## DEFAULT_SIZES

*const* · [packages/state/src/layout.ts](../../packages/state/src/layout.ts)

```ts
const DEFAULT_SIZES: RowSizes
```

## DataOperation

*type* · [packages/state/src/operations.ts](../../packages/state/src/operations.ts)

The operation API (H3): the single path for every change. Data operations change the roadmap; view
operations change only what is shown. Permissions (L5), Proposals and undo all hook into this pipeline.

```ts
export type DataOperation =
  | { type: 'task.create'; task: Task; /** Array position to insert at (undo of a delete restores it). */ index?: number }
  | { type: 'task.update'; id: string; fields: Partial<Omit<Task, 'id'>> }
  | { type: 'task.delete'; id: string }
  | { type: 'link.create'; link: Link }
  | { type: 'link.update'; id: string; fields: Partial<Omit<Link, 'id'>> }
  | { type: 'link.delete'; id: string }
  /** Several operations as one: one undo step and one set of Proposal changes (an edit plus the dates it moves). */
  | { type: 'batch'; ops: DataOperation[]; label?: string };
```

## GROUP_PREFIX

*const* · [packages/state/src/view.ts](../../packages/state/src/view.ts)

```ts
const GROUP_PREFIX: '\u0001group:'
```

## GanttOperation

*type* · [packages/state/src/operations.ts](../../packages/state/src/operations.ts)

Every operation the Gantt accepts: changes to the roadmap and changes to the view.

```ts
export type GanttOperation = DataOperation | ViewOperation;
```

## GanttViewState

*interface* · [packages/state/src/view.ts](../../packages/state/src/view.ts)

Everything a user can change about how the roadmap is shown (sorting, filtering, grouping, columns),
kept per user and restorable as a saved view (D9–D11, D19).

```ts
export interface GanttViewState {
  sort?: ViewSort;
  filter?: ViewFilter;
  /** Group leaf tasks by this field's value (D11). */
  groupBy?: string;
  /** Show each group as a lane row (A6). */
  groupLanes?: boolean;
  /** Column order, widths and visibility (D18). */
  columns?: ColumnState[];
  /** Columns frozen at the left of the grid when it scrolls sideways. */
  frozen?: number;
  zoom?: string;
  compact?: boolean;
}
```

## HOUR_ZOOM

*const* · [packages/state/src/scale.ts](../../packages/state/src/scale.ts)

An hour level for hour-based plans (G4); add it to `zoomLevels` when needed.

```ts
const HOUR_ZOOM: ZoomLevel
```

## LANE_PAD

*const* · [packages/state/src/layout.ts](../../packages/state/src/layout.ts)

```ts
const LANE_PAD: 4
```

## LANE_TRACK

*const* · [packages/state/src/layout.ts](../../packages/state/src/layout.ts)

```ts
const LANE_TRACK: 28
```

## Model

*interface* · [packages/state/src/layout.ts](../../packages/state/src/layout.ts)

Everything the view needs to draw a roadmap: the document, its placement, the tree (parents, children,
WBS codes) and indexes by id. Built once per document version by `buildModel`.

```ts
export interface Model {
  doc: RoadmapDocument;
  placement: Placement;
  tasks: Map<string, Task>;
  children: Map<string | null, string[]>;
  linksByTask: Map<string, Link[]>;
  wbs: Map<string, string>;
}
```

## OperationContext

*interface* · [packages/state/src/operations.ts](../../packages/state/src/operations.ts)

Who made an operation and how: the user in the UI, the host through the API, or undo/redo.

```ts
export interface OperationContext { by?: string; source: 'user' | 'api' | 'undo' | 'redo' }
```

## OperationHooks

*interface* · [packages/state/src/operations.ts](../../packages/state/src/operations.ts)

Hooks the host gives the pipeline: interception before an operation, and notifications after it runs or is refused.

```ts
export interface OperationHooks {
  /** Interception: return false or a reason string to refuse. May return a promise (H3). */
  beforeOperation?: (op: GanttOperation, ctx: OperationContext) => boolean | string | void | Promise<boolean | string | void>;
  /** Authorisation hook, called before every data operation (L5). A string refuses with that reason. */
  authorize?: (op: DataOperation, ctx: OperationContext) => boolean | string | Promise<boolean | string>;
  /** Listening: called after an operation has been applied. */
  operation?: (result: Extract<OperationResult, { ok: true }>, ctx: OperationContext) => void;
  /** Called when an operation is refused at any stage. */
  refused?: (result: Extract<OperationResult, { ok: false }>, ctx: OperationContext) => void;
}
```

## OperationPipeline

*class* · [packages/state/src/operations.ts](../../packages/state/src/operations.ts)

Runs operations through interception, authorisation, application and notification, in that order.
Holds no React; the Gantt component and the server both drive one.

```ts
export class OperationPipeline {
  constructor( private readonly getHooks: () => OperationHooks, private readonly applyData: (op: DataOperation) => { inverse: DataOperation[] } | { error: string }, private readonly applyView: (op: ViewOperation) => void, )
  run(op: GanttOperation, ctx: OperationContext = { source: 'api' }): Promise<OperationResult>
}
```

## OperationResult

*type* · [packages/state/src/operations.ts](../../packages/state/src/operations.ts)

The outcome of running an operation: accepted (with the operations that undo it), or refused with the reason
and the stage that refused it (the host's interception, a permission, or validation).

```ts
export type OperationResult =
  | { ok: true; operation: GanttOperation; inverse?: DataOperation[] }
  | { ok: false; operation: GanttOperation; reason: string; stage: 'intercepted' | 'authorization' | 'invalid' };
```

## ROW_HEIGHT

*const* · [packages/state/src/layout.ts](../../packages/state/src/layout.ts)

```ts
const ROW_HEIGHT: 36
```

## RowLayout

*interface* · [packages/state/src/layout.ts](../../packages/state/src/layout.ts)

One visible row: which task, how deep in the tree, its top and height in pixels, and whether it is a lane.

```ts
export interface RowLayout {
  taskId: string;
  depth: number;
  wbs: string;
  hasChildren: boolean;
  /** Has children that have not been loaded yet (H2). */
  unloaded: boolean;
  expanded: boolean;
  lane: boolean;
  top: number;
  height: number;
  bars: BarLayout[];
  tracks: number;
}
```

## RowSizes

*interface* · [packages/state/src/layout.ts](../../packages/state/src/layout.ts)

Row geometry (G1). Bars take the row height minus a margin; lane tracks stack bars within a lane row.

```ts
export interface RowSizes { row: number; laneTrack: number }
```

## SavedView

*interface* · [packages/state/src/view.ts](../../packages/state/src/view.ts)

A named view the user saved.

```ts
export interface SavedView { id: string; name: string; view: GanttViewState }
```

## Scale

*interface* · [packages/state/src/scale.ts](../../packages/state/src/scale.ts)

The time scale of the chart: the day at x = 0 and the zoom, in pixels per day.

```ts
export interface Scale { origin: DayNum; pxPerDay: number }
```

## ScaleUnit

*type* · [packages/state/src/scale.ts](../../packages/state/src/scale.ts)

Units a scale line can count in (G2, G5).

```ts
export type ScaleUnit = 'year' | 'quarter' | 'month' | 'week' | 'day' | 'hour';
```

## SelectionTarget

*type* · [packages/state/src/selection.ts](../../packages/state/src/selection.ts)

What can be selected: a grid row, a bar (one of a task's bars when it has several) or a link.

```ts
export type SelectionTarget =
  | { type: 'row'; taskId: string }
  | { type: 'bar'; taskId: string; bar: string }
  | { type: 'link'; linkId: string };
```

## Tick

*interface* · [packages/state/src/scale.ts](../../packages/state/src/scale.ts)

One label on the time scale: the day it starts, its position and width in pixels, and its text.

```ts
export interface Tick { day: DayNum; x: number; w: number; label: string }
```

## TreeClipboard

*interface* · [packages/state/src/tree.ts](../../packages/state/src/tree.ts)

What copy and cut put on the clipboard (D15): whole subtrees and the links between them.

```ts
export interface TreeClipboard { tasks: Task[]; links: Link[]; roots: string[] }
```

## TreeResult

*type* · [packages/state/src/tree.ts](../../packages/state/src/tree.ts)

Tree editing as data operations (D2, D3, D15, D16). Nothing here changes a document; each function returns
the operations to run, or the reason it cannot be done.

```ts
export type TreeResult = { ops: DataOperation[] } | { error: string };
```

## ViewFilter

*interface* · [packages/state/src/view.ts](../../packages/state/src/view.ts)

What the user filtered by: free text, and for each field the values to keep.

```ts
export interface ViewFilter {
  /** Matches name, id or WBS code, ignoring case. */
  text?: string;
  /** Field → accepted values (compared as text). A task must match every listed field. */
  fields?: Record<string, string[]>;
}
```

## ViewOperation

*type* · [packages/state/src/operations.ts](../../packages/state/src/operations.ts)

Operations that change only what is shown (expanding rows, zoom, selection, scrolling), never the roadmap itself.
They are not saved, not undone and need no permission.

```ts
export type ViewOperation =
  | { type: 'row.expand'; id: string }
  | { type: 'row.collapse'; id: string }
  | { type: 'lane.open'; id: string }
  | { type: 'lane.close'; id: string }
  | { type: 'selection.set'; selection: SelectionTarget[] }
  | { type: 'zoom.set'; zoom: string };
```

## ViewSort

*interface* · [packages/state/src/view.ts](../../packages/state/src/view.ts)

Views (D9, D10, D11, D19, F12): sorting, filtering and grouping change what is shown, never the data.
A view is plain JSON so the host can store and share it (for example in the URL).

```ts
export interface ViewSort { field: string; dir: 'asc' | 'desc' }
```

## ZOOM_LEVELS

*const* · [packages/state/src/scale.ts](../../packages/state/src/scale.ts)

```ts
const ZOOM_LEVELS: ZoomLevel[]
```

## ZoomLevel

*interface* · [packages/state/src/scale.ts](../../packages/state/src/scale.ts)

A zoom level (G1, G2): width of a day and the units of its two scale lines. `format` replaces the label
of a unit (for example fiscal quarters or "Sprint 12"); it gets the tick's day number (fractional for hours).

```ts
export interface ZoomLevel {
  id: string; label: string; pxPerDay: number; major: ScaleUnit; minor: ScaleUnit;
  format?: Partial<Record<ScaleUnit, (day: number, locale?: string) => string>>;
}
```

## applyDataOperation

*function* · [packages/state/src/operations.ts](../../packages/state/src/operations.ts)

Applies a data operation to a document. Returns the new document and the operations that undo it.
The input is never mutated. The result is validated against the contract, so an operation cannot
produce a document that would be refused on load (cycles, dangling ids, bad dates).

```ts
export function applyDataOperation(doc: RoadmapDocument, op: DataOperation): { doc: RoadmapDocument; inverse: DataOperation[] } | { error: string }
```

## barIndex

*function* · [packages/state/src/layout.ts](../../packages/state/src/layout.ts)

Where each visible bar sits vertically: the row's index and centre line.

```ts
export function barIndex(rows: RowLayout[], sizes: RowSizes = DEFAULT_SIZES): Map<string, { row: RowLayout; y: number; h: number }>
```

## buildModel

*function* · [packages/state/src/layout.ts](../../packages/state/src/layout.ts)

`placement` may be passed in when it was computed in an earlier task (staged loading).

```ts
export function buildModel(doc: RoadmapDocument, placement: Placement = place(doc)): Model
```

## copyTasks

*function* · [packages/state/src/tree.ts](../../packages/state/src/tree.ts)

Copies tasks for pasting (D15): each selected subtree once (children of a selected parent come with it),
with the links that run between copied tasks.

```ts
export function copyTasks(m: Model, ids: string[]): TreeClipboard
```

## dateFormat

*function* · [packages/state/src/format.ts](../../packages/state/src/format.ts)

A cached `Intl.DateTimeFormat`: creating one is slow, and the chart formats thousands of dates per frame.

```ts
export function dateFormat(locale: string | undefined, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat
```

## dayAt

*const* · [packages/state/src/scale.ts](../../packages/state/src/scale.ts)

The day at an x position.

```ts
const dayAt: (s: Scale, x: number) => number
```

## duplicateOps

*function* · [packages/state/src/tree.ts](../../packages/state/src/tree.ts)

Duplicate (D15): a copy of each subtree placed just after the original.

```ts
export function duplicateOps(m: Model, ids: string[], newId: () => string): TreeResult & { ids?: string[] }
```

## fieldValue

*function* · [packages/state/src/view.ts](../../packages/state/src/view.ts)

The value of a field for sorting, filtering and grouping: placed dates and progress for the computed fields.

```ts
export function fieldValue(m: Model, id: string, field: string): unknown
```

## findTasks

*function* · [packages/state/src/view.ts](../../packages/state/src/view.ts)

Find (D19): ids whose name contains the text, or whose id or WBS code equals it, in tree order.

```ts
export function findTasks(m: Model, q: string): string[]
```

## flattenOps

*const* · [packages/state/src/operations.ts](../../packages/state/src/operations.ts)

The single operations inside an operation, in order.

```ts
const flattenOps: (op: DataOperation) => DataOperation[]
```

## formatDay

*const* · [packages/state/src/format.ts](../../packages/state/src/format.ts)

Formats a day number in the locale with the given options.

```ts
const formatDay: (day: number, locale: string | undefined, opts: Intl.DateTimeFormatOptions) => string
```

## indentOps

*function* · [packages/state/src/tree.ts](../../packages/state/src/tree.ts)

Indent (D16): each task becomes the last child of the sibling just above it.

```ts
export function indentOps(m: Model, ids: string[]): TreeResult
```

## isDataOperation

*const* · [packages/state/src/operations.ts](../../packages/state/src/operations.ts)

True for operations that change the roadmap (and so go through permissions, Proposals and undo).

```ts
const isDataOperation: (op: GanttOperation) => op is DataOperation
```

## isGroupId

*const* · [packages/state/src/view.ts](../../packages/state/src/view.ts)

True for the id of a group header row (rows made by "group by", not tasks).

```ts
const isGroupId: (id: string) => boolean
```

## isViewActive

*function* · [packages/state/src/view.ts](../../packages/state/src/view.ts)

True when the view changes what is shown (a sort, a group or a non-empty filter), so the UI can offer "Reset view".

```ts
export function isViewActive(v: GanttViewState | undefined): boolean
```

## isWithin

*function* · [packages/state/src/tree.ts](../../packages/state/src/tree.ts)

True when `id` is `ancestor` or below it.

```ts
export function isWithin(m: Model, id: string, ancestor: string): boolean
```

## isoWeek

*function* · [packages/state/src/scale.ts](../../packages/state/src/scale.ts)

ISO 8601 week number of a day: weeks start on Monday, and week 1 is the week containing the year's first Thursday.

```ts
export function isoWeek(d: DayNum): number
```

## layoutRows

*function* · [packages/state/src/layout.ts](../../packages/state/src/layout.ts)

Flattens the tree into visible rows. Lane rows (A6) draw their children as bars on the row itself,
stacked into tracks where they overlap, so rows differ in height. `laneOpen` lists lanes the user has
opened into ordinary rows.

```ts
export function layoutRows(m: Model, collapsed: ReadonlySet<string>, laneOpen: ReadonlySet<string> = new Set(), sizes: RowSizes = DEFAULT_SIZES): RowLayout[]
```

## linkPath

*function* · [packages/state/src/links.ts](../../packages/state/src/links.ts)

Orthogonal connector path for a link (A2). Bars run from the start of their first day to the end
of their last day; a milestone sits at the start of its day.

```ts
export function linkPath(l: Link, p: Placement, pos: Map<string, BarPos>, s: Scale): string | null
```

## localeWeekStart

*function* · [packages/state/src/scale.ts](../../packages/state/src/scale.ts)

First day of the week for a locale (G14): 0 = Sunday, 1 = Monday … 6 = Saturday. Uses `Intl.Locale#getWeekInfo`
(or the older `weekInfo` property) where the runtime has it, and falls back to Monday (ISO 8601).

```ts
export function localeWeekStart(locale?: string): number
```

## matchesText

*function* · [packages/state/src/view.ts](../../packages/state/src/view.ts)

True when the task's name, id or WBS code contains the search text (ignoring case and surrounding spaces).

```ts
export function matchesText(m: Model, id: string, q: string): boolean
```

## mergeChildren

*function* · [packages/state/src/operations.ts](../../packages/state/src/operations.ts)

Merges children loaded on demand (H2) under `parentId`. This is data arriving, not an edit: it does not
go through interception or authorisation and is not undoable. The result is validated like any load.

```ts
export function mergeChildren(doc: RoadmapDocument, parentId: string, loaded: { tasks: Task[]; links?: Link[] }): { doc: RoadmapDocument } | { error: string }
```

## moveOps

*function* · [packages/state/src/tree.ts](../../packages/state/src/tree.ts)

Places `ids` (in that order) under `parent` before the sibling at `index` of the current child list,
numbering the new sibling list with `order`. A task cannot move into itself or its own subtree.

```ts
export function moveOps(m: Model, ids: string[], parent: string | null, index: number): TreeResult
```

## newTaskOps

*function* · [packages/state/src/tree.ts](../../packages/state/src/tree.ts)

A new task (D3, D4) under `parent` at `index`, starting on `start` when given.

```ts
export function newTaskOps(m: Model, parent: string | null, index: number, task: Pick<Task, 'id' | 'name' | 'type'> & Partial<Task>): TreeResult
```

## outdentOps

*function* · [packages/state/src/tree.ts](../../packages/state/src/tree.ts)

Outdent (D16): each task moves up one level, just after its parent.

```ts
export function outdentOps(m: Model, ids: string[]): TreeResult
```

## pasteOps

*function* · [packages/state/src/tree.ts](../../packages/state/src/tree.ts)

Paste (D15): new ids for every task and internal link, roots placed under `parent` at `index`.
Dates and fields are kept; names are kept as they are.

```ts
export function pasteOps(m: Model, clip: TreeClipboard, parent: string | null, index: number, newId: () => string): TreeResult & { ids?: string[] }
```

## rowAt

*function* · [packages/state/src/layout.ts](../../packages/state/src/layout.ts)

Index of the first row whose bottom is below y (binary search over variable heights).

```ts
export function rowAt(rows: RowLayout[], y: number): number
```

## sameTarget

*const* · [packages/state/src/selection.ts](../../packages/state/src/selection.ts)

True when two selection targets point at the same row, bar or link.

```ts
const sameTarget: (a: SelectionTarget, b: SelectionTarget) => boolean
```

## sortTreeOrder

*function* · [packages/state/src/tree.ts](../../packages/state/src/tree.ts)

Sorts ids by their position in the expanded tree.

```ts
export function sortTreeOrder(m: Model, ids: string[]): string[]
```

## targetKey

*const* · [packages/state/src/selection.ts](../../packages/state/src/selection.ts)

A string key for a selection target, used in sets and as React keys.

```ts
const targetKey: (t: SelectionTarget) => string
```

## ticks

*function* · [packages/state/src/scale.ts](../../packages/state/src/scale.ts)

Ticks of one unit covering [from, to], labelled via Intl in the given locale.
Week ticks begin on `weekStart` (0 = Sunday … 6 = Saturday; default Monday). The week number shown is the
ISO week of the Monday inside that week, so a Sunday-start week is numbered like the ISO week that follows it.

```ts
export function ticks(s: Scale, unit: ScaleUnit, from: DayNum, to: DayNum, locale?: string, format?: (day: number, locale?: string) => string, weekStart = 1): Tick[]
```

## topmost

*function* · [packages/state/src/tree.ts](../../packages/state/src/tree.ts)

Of the given ids, those whose ancestors are not also given (moving a parent moves its subtree).

```ts
export function topmost(m: Model, ids: Iterable<string>): string[]
```

## totalHeight

*function* · [packages/state/src/layout.ts](../../packages/state/src/layout.ts)

Total height in pixels of the given rows (the bottom of the last one).

```ts
export function totalHeight(rows: RowLayout[]): number
```

## viewModel

*function* · [packages/state/src/view.ts](../../packages/state/src/view.ts)

The model as the view shows it. Filtering keeps matches and their ancestors; sorting orders siblings;
grouping puts leaf tasks under one synthetic row per value. Returns the same model when no view is active.

```ts
export function viewModel(m: Model, v: GanttViewState | undefined, groupLabel: (field: string, value: string) => string = (_f, val) => val || '—'): { model: Model; matches: Set<string> | null }
```

## xOf

*const* · [packages/state/src/scale.ts](../../packages/state/src/scale.ts)

The x position (in pixels) of the start of a day.

```ts
const xOf: (s: Scale, d: DayNum) => number
```
