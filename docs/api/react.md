# @gantt/react

The React Gantt component.

Generated from the TypeScript sources by `npm run docs:api`; do not edit by hand.

33 exports.

## AccessRules

*interface* · [packages/access/src/types.ts](../../packages/access/src/types.ts)

Serialisable rules, shared by the server and the component (L10).

```ts
export interface AccessRules { subject: Subject; rules: Rule[] }
```

## CellProps

*interface* · [packages/react/src/grid.tsx](../../packages/react/src/grid.tsx)

What a cell template receives (G7).

```ts
export interface CellProps { task: Task; placed: PlacedTask; row: RowLayout; model: Model; i18n: I18n }
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

## DetailsProps

*interface* · [packages/react/src/Details.tsx](../../packages/react/src/Details.tsx)

What a custom details panel for a kind of task or link receives: the item, the model, a way to select
another item, whether a field may be edited, and the built-in panel (`Default`) to render or wrap.

```ts
export interface DetailsProps<T> {
  item: T;
  model: Model;
  select: (t: SelectionTarget) => void;
  canEdit: (field: string) => boolean;
  Default: ComponentType;
}
```

## ExportFormat

*type* · [packages/react/src/Gantt.tsx](../../packages/react/src/Gantt.tsx)

The file formats the Export menu offers.

```ts
export type ExportFormat = 'png' | 'pdf' | 'xlsx' | 'csv' | 'mspdi';
```

## Gantt

*const* · [packages/react/src/GanttRoot.tsx](../../packages/react/src/GanttRoot.tsx)

The Gantt. Resolves access first: without `view` nothing is fetched or rendered (L6, L8). Then renders
either the given data (filtered for the user, L12) or the Proposal workflow against a backend.

```ts
const Gantt: React.ForwardRefExoticComponent<GanttRootProps & React.RefAttributes<GanttHandle>>
```

## GanttBackend

*interface* · [packages/service/src/backend.ts](../../packages/service/src/backend.ts)

How the Gantt talks to whatever holds the roadmap (H4). Every method may refuse with a BackendError,
whose message is shown to the user and whose code tells the component how to react.

```ts
export interface GanttBackend {
  readonly userId: string;
  snapshot(): Promise<Snapshot>;
  proposalDocument(id: string): Promise<RoadmapDocument>;
  versionDocument(version: number): Promise<RoadmapDocument>;
  change(proposalId: string | null, changes: ChangeInput[], name?: string): Promise<ProposalSummary>;
  act(id: string, action: LifecycleAction, reason?: string): Promise<ProposalSummary>;
  newFrom(id: string): Promise<ProposalSummary>;
  /** Concurrent changes and overlaps with parallel Proposals (K7, K8). */
  concurrency(id: string): Promise<Concurrency>;
  /** Keep one user's version of a task changed concurrently (K9). */
  pick(id: string, taskId: string, keep: string): Promise<ProposalSummary>;
  /** What a refresh onto the newest Current would do (K17). */
  refreshPreview(id: string, choices: Record<string, RefreshChoice>): Promise<RefreshPreview>;
  refresh(id: string, choices: Record<string, RefreshChoice>): Promise<ProposalSummary>;
  undoRefresh(id: string): Promise<ProposalSummary>;
  /** Saves a baseline of Current (B1); needs `baseline.save`. */
  saveBaseline(name: string, version?: number): Promise<{ id: string; name: string; version: number }>;
  /** Opens a new Proposal that restores an earlier version (K22). */
  restoreVersion(version: number): Promise<ProposalSummary>;
  /** Live events (proposalStale etc.). Returns an unsubscribe function. */
  subscribe(fn: (e: ServiceEvent) => void): () => void;
}
```

## GanttHandle

*interface* · [packages/react/src/Gantt.tsx](../../packages/react/src/Gantt.tsx)

Imperative handle (H3): `const ref = useRef<GanttHandle>(null); <Gantt ref={ref} … />`.

```ts
export interface GanttHandle {
  run: (op: GanttOperation) => Promise<OperationResult>;
  getData: () => RoadmapDocument;
  getSelection: () => SelectionTarget[];
  scrollToTask: (id: string) => void;
  scrollToToday: () => void;
  fit: () => void;
  /** Undo or redo this user's last change (F8). */
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}
```

## GanttKinds

*interface* · [packages/react/src/Details.tsx](../../packages/react/src/Details.tsx)

The kinds a host defines (G7): per kind of row and per kind of link. A task's or link's `kind` field picks one.

```ts
export interface GanttKinds {
  rows?: Record<string, KindDefinition<Task>>;
  links?: Record<string, KindDefinition<Link>>;
}
```

## GanttMessages

*interface* · [packages/react/src/i18n.ts](../../packages/react/src/i18n.ts)

Every text the Gantt shows (G12). A host passes `messages` to override any of them; dates and numbers
are formatted with `Intl` in the host's `locale`, so a translation only needs these strings.

```ts
export interface GanttMessages {
  // states
  loading: string;
  empty: string;
  errorTitle: string;
  errorRetry: string;
  // toolbar
  toolbarLabel: string;
  zoomLabel: string;
  zoomLevel: Record<string, string>;
  today: string;
  fit: string;
  showGrid: string;
  hideGrid: string;
  // grid
  colWbs: string;
  colName: string;
  colStart: string;
  colDays: string;
  expand: string;
  collapse: string;
  loadingChildren: string;
  loadFailed: (reason: string) => string;
  openLane: string;
  closeLane: string;
  laneBars: (n: string) => string;
  laneBarsHint: string;
  resizeGrid: string;
  timeline: string;
  unscheduled: string;
  // chart
  todayMarker: string;
  tipWorkingDays: (n: string) => string;
  tipComplete: (pct: string) => string;
  // announcements
  selected: (name: string) => string;
  selectedMany: (name: string, count: string) => string;
  selectionCleared: string;
  connectorName: (from: string, to: string) => string;
  // operations
  readOnly: string;
  // save indicator
  saving: string;
  saved: string;
  notSaved: (reason: string) => string;
  // details
  details: string;
  noLongerExists: string;
  notVisible: (reason: string) => string;
  insideCollapsed: (parent: string) => string;
  outsideView: string;
  typeLane: string;
  typeMilestone: string;
  typeSummary: string;
  typeTask: string;
  typeConnector: string;
  pastDeadline: string;
  derivedDates: string;
  schedule: string;
  date: string;
  start: string;
  end: string;
  duration: string;
  workingDays: (n: string) => string;
  progress: string;
  constraint: string;
  deadline: string;
  mode: string;
  barsOnRow: string;
  children: string;
  childState: Record<'done' | 'in progress' | 'not started' | 'unscheduled', (n: string) => string>;
  placeInTree: string;
  inside: string;
  topLevel: string;
  dependencies: string;
  after: string;
  before: string;
  people: string;
  owner: string;
  otherFields: string;
  linkSentence: Record<LinkType, (from: string, to: string) => string>;
  linkType: Record<LinkType, string>;
  from: string;
  to: string;
  type: string;
  lag: string;
  lagValue: (n: string, unit: 'day' | 'hour') => string;
  none: string;
  notChecked: string;
  satisfied: string;
  satisfiedSpare: (days: string) => string;
  brokenBy: (days: string) => string;
  selection: string;
  items: (n: string) => string;
  tasks: string;
  connectors: string;
  span: string;
  roadmapVersion: (v: string) => string;
  openProposals: string;
  keyboardHint: string;
  diffAdded: string;
  diffChanged: string;
  editHint: string;
  // access (L6)
  noAccess: string;
  // Proposals (section K)
  proposalBar: string;
  viewLabel: string;
  currentView: (version: string) => string;
  currentNone: string;
  versionView: (version: string, by: string, date: string) => string;
  proposalOption: (name: string, state: string, owner: string) => string;
  state: Record<string, string>;
  expires: (date: string, phase: string) => string;
  phaseName: Record<string, string>;
  changesCount: (n: string) => string;
  stale: string;
  compare: string;
  history: string;
  action: Record<'submit' | 'withdraw' | 'review' | 'approve' | 'return' | 'reject' | 'discard' | 'newFrom', string>;
  reasonLabel: string;
  confirm: string;
  cancel: string;
  chooseTarget: string;
  newProposal: string;
  versionReadOnly: string;
  restoreVersion: string;
  closedReadOnly: (state: string) => string;
  returnedReason: (reason: string) => string;
  historyEntry: (who: string, action: string, date: string) => string;
  /** History steps by action, the reason a Proposal under review is read-only, and the default baseline name. */
  historyAction: Record<'create' | 'change' | 'submit' | 'withdraw' | 'review' | 'approve' | 'return' | 'reject' | 'discard' | 'expire' | 'newFrom' | 'pick' | 'refresh' | 'undoRefresh', string>;
  separationOfDuties: (enforced: boolean) => string;
  lockedForReview: string;
  baselineDefaultName: (version: string) => string;
  // scheduling (Phase 4)
  criticalPath: string;
  scheduleHint: string;
  scheduleUpToDate: string;
  scheduleApplied: (n: string) => string;
  slack: string;
  slackDays: (n: string) => string;
  criticalTask: string;
  drivenBy: string;
  setsDate: string;
  issues: string;
  // editing (Phase 5)
  undo: string;
  redo: string;
  nothingToUndo: string;
  nothingToRedo: string;
  menu: string;
  editDetails: string;
  moveEarlier: string;
  moveLater: string;
  linkFromHere: string;
  linkStart: (name: string) => string;
  linkMade: (from: string, to: string) => string;
  linkCancelled: string;
  linkModeHint: string;
  deleteTask: string;
  deleteDependency: string;
  newTask: string;
  // grid and views (Phase 5 step 2)
  colEnd: string;
  colProgress: string;
  colOwner: string;
  colKind: string;
  colAdd: string;
  addBelow: (name: string) => string;
  addPlaceholder: string;
  addChild: string;
  cut: string;
  copy: string;
  paste: string;
  duplicate: string;
  indent: string;
  outdent: string;
  copied: (n: string) => string;
  pasted: (n: string) => string;
  nothingToPaste: string;
  reorderRow: string;
  reorderNeedsTree: string;
  moved: (name: string) => string;
  sortAsc: string;
  sortDesc: string;
  sortClear: string;
  sortedBy: (col: string, dir: 'asc' | 'desc') => string;
  groupByCol: string;
  groupedBy: (col: string) => string;
  groupLanes: string;
  ungroup: string;
  filterLabel: string;
  filterValues: string;
  filterClear: string;
  filtered: (shown: string, total: string) => string;
  hideColumn: string;
  columns: string;
  columnMenu: (col: string) => string;
  moveLeft: string;
  moveRight: string;
  freezeTo: string;
  resizeColumn: (col: string) => string;
  find: string;
  findPlaceholder: string;
  findCount: (i: string, n: string) => string;
  findNone: string;
  views: string;
  viewDefault: string;
  saveViewAs: string;
  viewName: string;
  deleteView: string;
  compact: string;
  closePanel: string;
  setForAll: (n: string) => string;
  apply: string;
  emptyValue: string;
  selectedBars: (n: string) => string;
  // working together (Phase 6)
  proposals: string;
  colState: string;
  colAge: string;
  colExpires: string;
  colChanges: string;
  colShared: string;
  ageDays: (n: string) => string;
  behind: (n: string) => string;
  refreshProposal: string;
  undoRefresh: string;
  refreshed: (from: string, to: string) => string;
  concurrent: (n: string) => string;
  concurrentTitle: string;
  changedAtOnce: (users: string) => string;
  alsoIn: (name: string) => string;
  anotherProposal: string;
  keepVersion: (user: string) => string;
  groupName: Record<string, string>;
  flagConcurrent: (users: string) => string;
  flagParallel: (name: string) => string;
  flagIncoming: string;
  refreshTitle: (from: string, to: string) => string;
  incomingTitle: string;
  incomingNone: string;
  overlapsTitle: string;
  currentSide: string;
  mineSide: string;
  acceptIncoming: string;
  keepMine: string;
  acceptAll: string;
  keepAll: string;
  perField: string;
  movedTitle: string;
  newIssuesTitle: string;
  backToDraftNote: string;
  confirmRefresh: string;
  deleted: string;
  kindAdded: string;
  kindRemoved: string;
  kindChanged: string;
  undecidedLeft: (n: string) => string;
  // scheduling depth (Phase 7)
  slackShow: string;
  problems: (n: string) => string;
  problemsTitle: string;
  noProblems: string;
  lateBy: (n: string) => string;
  // tracking (Phase 8)
  baselineLabel: string;
  baselineNone: string;
  baselineTip: (name: string, start: string, end: string, diff: string) => string;
  daysLater: (n: string) => string;
  daysEarlier: (n: string) => string;
  sameDates: string;
  progressLine: string;
  statusDate: string;
  progressStatus: Record<'ahead' | 'behind' | 'onTrack', string>;
  rollups: string;
  sCurve: string;
  sCurveTitle: string;
  planned: string;
  actual: string;
  workTotal: (n: string) => string;
  saveBaseline: string;
  baselineName: string;
  baselineSaved: (name: string) => string;
  // resources (Phase 9)
  resourcesShow: string;
  loadTitle: string;
  totalDemand: string;
  unassigned: string;
  defaultDemandNote: string;
  loadTip: (who: string, from: string, demand: string, capacity: string | null, overDays: string) => string;
  levelResources: string;
  levelled: (n: string) => string;
  levelNothing: string;
  levelUnresolved: (names: string) => string;
  noAssignments: string;
  assign: string;
  unassign: (name: string) => string;
  allocationOf: (name: string) => string;
  assigned: (who: string, task: string) => string;
  dragToAssign: string;
  backlog: string;
  backlogHint: string;
  // interchange and platform (Phase 10)
  exportLabel: string;
  /** Toolbar groups (accessible names) and menus. */
  groupHistory: string; groupNavigate: string; groupPlanning: string; groupDisplay: string; groupViewTools: string;
  showMenu: string; fileMenu: string; activeCount: (n: string) => string; taskTable: string;
  groupAnalysis: string; groupTracking: string; groupResources: string; groupLayout: string;
  exportAs: Record<'png' | 'pdf' | 'xlsx' | 'csv' | 'mspdi', string>;
  importLabel: string;
  importHint: string;
  imported: (file: string, n: string) => string;
  importNothing: string;
  importFailed: (file: string, reason: string) => string;
  exportFailed: (reason: string) => string;
  fullscreen: string;
  exitFullscreen: string;
  /** A refusal for a missing permission (L4), and for one on a single field. */
  missingPermission: (permission: string, field?: string) => string;
}
```

## GanttOperation

*type* · [packages/state/src/operations.ts](../../packages/state/src/operations.ts)

Every operation the Gantt accepts: changes to the roadmap and changes to the view.

```ts
export type GanttOperation = DataOperation | ViewOperation;
```

## GanttProps

*interface* · [packages/react/src/GanttRoot.tsx](../../packages/react/src/GanttRoot.tsx)

Props of the public `<Gantt>`: everything the core component takes, plus either `data` (data mode) or a
`backend` (the Proposal workflow), access rules, and callbacks for the workflow's events.

```ts
export interface GanttRootProps extends Omit<GanttProps, 'data'>, EventCallbacks {
  /** Data mode: the roadmap to show. Ignored when `backend` is given. */
  data?: RoadmapDocument;
  /** Proposal mode: Current, Proposals and their lifecycle come from here (H4); every change is a Proposal (K0). */
  backend?: GanttBackend;
  /** Access rules as static data (L3, L11). In data mode `data.access` is used when this is omitted. */
  access?: AccessRules | null;
  /** Access rules from a resolver; its result wins for the fields it returns (L11). */
  resolveAccess?: () => Promise<Partial<AccessRules>>;
  /** Host-registered conditions named in rules. */
  conditions?: Record<string, Condition>;
  /** Shown instead of the Gantt without `view` (L6). */
  noAccess?: ReactNode;
  /** How controls the user may not use appear: disabled with the reason (default), or hidden (L4). */
  deniedControls?: 'disable' | 'hide';
  /** A change could not be saved and was rolled back (H7). */
  onOperationFailed?: (e: { operation: GanttOperation; reason: string }) => void;
  /** Sent once the server configuration is known (section 4). */
  onSeparationOfDutiesStatus?: (e: { enforced: boolean }) => void;
}
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

## GridColumn

*interface* · [packages/react/src/grid.tsx](../../packages/react/src/grid.tsx)

A grid column (D18). Built-in columns cover the common fields; the host adds its own (custom fields)
and may replace any cell with a template (G7).

```ts
export interface GridColumn {
  id: string;
  /** Header text. */
  label: string;
  width: number;
  minWidth?: number;
  align?: 'start' | 'end';
  /** Field used to sort, filter and group by this column (D9–D11); omit when it cannot be. */
  field?: string;
  /** Hidden until the user shows it from the Columns menu. */
  hidden?: boolean;
  /** Cell template (G7). */
  cell?: ComponentType<CellProps>;
  /** Text shown in the cell when there is no template. */
  text?: (c: CellProps) => ReactNode;
}
```

## HOUR_ZOOM

*const* · [packages/state/src/scale.ts](../../packages/state/src/scale.ts)

An hour level for hour-based plans (G4); add it to `zoomLevels` when needed.

```ts
const HOUR_ZOOM: ZoomLevel
```

## KindDefinition

*interface* · [packages/react/src/Details.tsx](../../packages/react/src/Details.tsx)

How one kind of task or link is shown: its label, an optional icon, and optionally its own details panel.

```ts
export interface KindDefinition<T> {
  label: string;
  icon?: ReactNode;
  /** Replace the default details with the host's own component (which may render `Default`). */
  details?: ComponentType<DetailsProps<T>>;
}
```

## OperationContext

*interface* · [packages/state/src/operations.ts](../../packages/state/src/operations.ts)

Who made an operation and how: the user in the UI, the host through the API, or undo/redo.

```ts
export interface OperationContext { by?: string; source: 'user' | 'api' | 'undo' | 'redo' }
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

## Permission

*type* · [packages/access/src/types.ts](../../packages/access/src/types.ts)

One permission name, such as 'view', 'task.modify' or 'proposal.approve'.

```ts
export type Permission = (typeof PERMISSIONS)[number];
```

## Rule

*interface* · [packages/access/src/types.ts](../../packages/access/src/types.ts)

One access rule: allow or deny some permissions, for some roles, within a scope, optionally under a condition.

```ts
export interface Rule {
  effect: 'allow' | 'deny';
  permissions: Permission[];
  /** Limits the rule to subjects with one of these roles or groups. Omitted: applies to the subject. */
  roles?: string[];
  scope?: RuleScope;
  /** Task fields the rule covers (with view.fields or task.modify.*). Omitted: all fields. */
  fields?: string[];
  /** Name of a host-registered condition, evaluated with the request context. */
  condition?: string;
}
```

## SavedView

*interface* · [packages/state/src/view.ts](../../packages/state/src/view.ts)

A named view the user saved.

```ts
export interface SavedView { id: string; name: string; view: GanttViewState }
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

## ToolbarProps

*interface* · [packages/react/src/Gantt.tsx](../../packages/react/src/Gantt.tsx)

What a custom toolbar receives: the zoom and its setter, Today and Fit, critical path and schedule controls.

```ts
export interface ToolbarProps {
  zoom: string; levels: ZoomLevel[]; setZoom: (z: string) => void; scrollToToday: () => void; fit: () => void;
  /** Critical path highlighting (C2). */
  critical: boolean; setCritical: (on: boolean) => void;
  /** Apply the computed schedule to the roadmap (K1); `scheduleWhyNot` explains a disabled button (F14). */
  runSchedule: () => void; scheduleWhyNot: string | null;
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

## defaultMessages

*const* · [packages/react/src/i18n.ts](../../packages/react/src/i18n.ts)

```ts
const defaultMessages: GanttMessages
```

## germanMessages

*const* · [packages/react/src/messages.de.ts](../../packages/react/src/messages.de.ts)

```ts
const germanMessages: GanttMessages
```

## httpBackend

*function* · [packages/service/src/backend.ts](../../packages/service/src/backend.ts)

The reference server over HTTP, with server-sent events for live updates.

```ts
export function httpBackend(baseUrl: string, userId: string, fetchImpl: typeof fetch = fetch): GanttBackend
```

## localeDir

*function* · [packages/react/src/Gantt.tsx](../../packages/react/src/Gantt.tsx)

Right-to-left for Arabic, Hebrew, Persian and Urdu locales (G14); everything else is left-to-right.

```ts
export function localeDir(locale?: string): 'ltr' | 'rtl'
```

## memoryBackend

*function* · [packages/service/src/backend.ts](../../packages/service/src/backend.ts)

The service in the same page: mock mode (M7). Each call is a microtask, like a network round trip.

```ts
export function memoryBackend(service: RoadmapService, userId: string): GanttBackend
```

## scheduleOffThread

*function* · [packages/react/src/engineClient.ts](../../packages/react/src/engineClient.ts)

Runs the scheduling engine in the worker (C11); falls back to the main thread. `ms` is the engine time.

```ts
export async function scheduleOffThread(doc: RoadmapDocument): Promise<{ result: ScheduleResult; ms: number; offThread: boolean }>
```
