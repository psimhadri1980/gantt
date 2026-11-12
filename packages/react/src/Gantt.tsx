import { Component, forwardRef, memo, startTransition, useImperativeHandle, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type ComponentType } from 'react';
import type { Link, RoadmapDocument, Task } from '@gantt/contract';
import {
  applyDataOperation, flattenOps, isDataOperation, mergeChildren, barIndex, buildModel, OperationPipeline, layoutRows, linkPath, rowAt, targetKey, ticks, totalHeight, xOf, ZOOM_LEVELS, DEFAULT_SIZES, type RowSizes, type ZoomLevel,
  type DataOperation, type GanttOperation, type Model, type OperationContext, type OperationHooks, type OperationResult,
  type RowLayout, type Scale, type SelectionTarget, type ViewOperation,
  copyTasks, duplicateOps, fieldValue, findTasks, indentOps, isGroupId, moveOps, newTaskOps, outdentOps, pasteOps, viewModel,
  type GanttViewState, type SavedView, type TreeClipboard,
} from '@gantt/state';
import { fromDay, place, schedule, whyNotLink, type DayNum, type Placement } from '@gantt/engine';
import { checkChange, type AccessEvaluator } from '@gantt/access';
import { placeOffThread, scheduleOffThread } from './engineClient.ts';
import { DragController, type DragKind } from './drag.ts';
import { ContextMenu, type MenuItem } from './menu.tsx';
import type { ScheduleResult } from '@gantt/engine';
import { DetailsPanel, type GanttKinds } from './Details.tsx';
import { I18nContext, makeI18n, mergeMessages, useI18n, type GanttMessages, type I18n } from './i18n.ts';
import { builtinColumns, columnState, fmtDate, gridTemplate, gridWidth, GridBlock, GridHeader, PlaceholderRow, resolveColumns, type CellProps, type GridColumn } from './grid.tsx';
import { ColumnsPanel, FilterValues, FindBar, Popover, ViewPicker } from './viewtools.tsx';
import type { PlacedTask } from '@gantt/engine';
import './gantt.css';

export interface GanttProps {
  data: RoadmapDocument;
  zoom?: string;
  onZoomChanged?: (zoom: string) => void;
  selection?: SelectionTarget[];
  onSelectionChanged?: (e: { selection: SelectionTarget[]; primary?: SelectionTarget }) => void;
  detailsPanel?: 'right' | 'bottom' | false;
  kinds?: GanttKinds;
  theme?: 'light' | 'dark';
  locale?: string;
  /** Vertical markers (F7) in addition to today. */
  markers?: { date: string; label: string }[];
  /** "Today" for the marker; defaults to the roadmap's status date, then the real date. */
  today?: string;
  height?: number | string;
  emptyState?: ReactNode;
  toolbar?: ComponentType<ToolbarProps> | false;

  // Operation API (H3). Every change, including the user's own clicks and keys, goes through these.
  /** Interception: return false or a reason to refuse an operation before it happens. May return a promise. */
  onBeforeOperation?: OperationHooks['beforeOperation'];
  /** Authorisation hook before every data operation (L5). Fails closed if it throws. */
  authorize?: OperationHooks['authorize'];
  /** Listening: every applied operation, with the operations that undo it for data changes. */
  onOperation?: OperationHooks['operation'];
  /** An operation was refused (by interception, authorisation or validation). */
  onOperationRefused?: OperationHooks['refused'];
  /** An operation was refused by the authorisation hook (plan event `accessDenied`). */
  onAccessDenied?: (e: { operation: GanttOperation; reason: string }) => void;
  /** The roadmap changed through a data operation; carries the new document. */
  onDataChanged?: (data: RoadmapDocument, operation: DataOperation) => void;
  /** The current user's id, recorded on operations. */
  userId?: string;

  // Configuration (G).
  /** Zoom levels offered, from widest to narrowest; each sets the scale width (px per day) and its two rows (G1, G2). */
  zoomLevels?: ZoomLevel[];
  /** Row height and lane track height in px (G1). Scale height is the CSS variable --gx-header-h. */
  rowHeight?: number;
  laneTrackHeight?: number;
  /** Shade weekends and holidays from the roadmap calendar (G6). Default true. */
  highlightNonWorking?: boolean;
  /**
   * Reschedule after every edit that affects dates (K1, C1): successors move with the change, inside the
   * same operation. Default true. A change that would create a dependency cycle is refused (C9).
   */
  autoSchedule?: boolean;
  /** Read-only mode (G9): every data operation is refused; a string is the reason shown. Viewing, selecting and zooming still work. */
  readOnly?: boolean | string;
  /** Override any visible text (G12). Dates and numbers follow `locale`. */
  messages?: Partial<GanttMessages>;
  /** Save indicator (F13), driven by the host that persists changes. Omit to hide it. */
  saveState?: { status: 'saving' | 'saved' | 'error'; reason?: string };
  /** Replaces the default error state. */
  errorState?: (e: { message: string; retry: () => void }) => ReactNode;
  /** Loads the children of a task marked `hasChildren: true` when it is first expanded (H2). */
  loadChildren?: (taskId: string) => Promise<{ tasks: Task[]; links?: Link[] }>;

  // Grid and views (Phase 5 step 2).
  /** Extra grid columns (custom fields, D18), or built-in ones replaced by id; `cell` is a template (G7). */
  columns?: GridColumn[];
  /** The view: sort, filter, grouping, columns, zoom (D9–D11, D18, F12). Controlled when given. */
  view?: GanttViewState;
  /** The view changed (the user sorted, filtered, grouped or changed columns). */
  onViewChanged?: (view: GanttViewState) => void;
  /** Named views the user can pick (F12). The host stores them and may share them, for example in the URL. */
  savedViews?: SavedView[];
  onSavedViewsChanged?: (views: SavedView[]) => void;
  /** Template for the content of a task bar (G7). */
  barTemplate?: ComponentType<{ task: Task; placed: PlacedTask }>;
  /** Template for a task's tooltip (G7); `Default` is the built-in content. */
  tooltipTemplate?: ComponentType<{ task: Task; placed: PlacedTask; Default: ReactNode }>;
  /** Compact mode for small screens (F5): `'auto'` (default) switches it on below 720 px. */
  compact?: boolean | 'auto';
}
export type { GridColumn, CellProps, GanttViewState, SavedView };

/** Imperative handle (H3): `const ref = useRef<GanttHandle>(null); <Gantt ref={ref} … />`. */
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

interface ViewBridge {
  apply: (op: ViewOperation) => void;
  getSelection: () => SelectionTarget[];
  scrollToTask: (id: string) => void;
  scrollToToday: () => void;
  fit: () => void;
}

export interface ToolbarProps {
  zoom: string; levels: ZoomLevel[]; setZoom: (z: string) => void; scrollToToday: () => void; fit: () => void;
  /** Critical path highlighting (C2). */
  critical: boolean; setCritical: (on: boolean) => void;
  /** Apply the computed schedule to the roadmap (K1); `scheduleWhyNot` explains a disabled button (F14). */
  runSchedule: () => void; scheduleWhyNot: string | null;
}

/**
 * Rendering strategy (ADR-001, condition 2): rows are cut into memoised blocks of BLOCK rows, and the time
 * axis into chunks of DAY_CHUNK days. Scrolling is native; React re-renders only when the set of visible
 * blocks or day chunks changes, and then only the blocks that are new. Hover never re-renders the chart.
 */
const BLOCK = 32;
const DAY_CHUNK = 64;
const OVERSCAN_PX = 400;
const GRID_MIN = 160;

export interface Block { index: number; start: number; rows: RowLayout[] }
export interface Api {
  /** `rangeTo`: select every row from the anchor to this row index (Shift+click, D14). */
  select: (t: SelectionTarget, additive: boolean, rangeTo?: number) => void;
  addBelow: (id: string) => void;
  rowPointerDown: (e: React.PointerEvent, row: number, id: string) => void;
  focus: (row: number, bar: number) => void;
  toggle: (id: string) => void;
  toggleLane: (id: string) => void;
  tip: (x: number, y: number, content: ReactNode | null) => void;
  startEdit: (id: string) => void;
  finishEdit: (id: string, value: string | null) => void;
  menu: (x: number, y: number, t: SelectionTarget) => void;
}
interface Compare { base: Placement; diff: Map<string, 'added' | 'changed'> }
export interface Ctx {
  cols: GridColumn[]; frozen: number;
  /** Tasks matching the filter; their ancestors are shown for context (D10). */
  matches: ReadonlySet<string> | null;
  barTemplate?: GanttProps['barTemplate']; tooltipTemplate?: GanttProps['tooltipTemplate'];
  model: Model; kinds?: GanttKinds; locale?: string; laneOpen: ReadonlySet<string>; selKeys: ReadonlySet<string>; linkMarked: ReadonlySet<string>;
  loadState: ReadonlyMap<string, string>; compare: Compare | null; editing: string | null;
  /** Tasks on the critical path while highlighting is on (C2). */
  critical: ReadonlySet<string> | null;
}

/**
 * Builds the model in its own task after the shell has painted, so no single main-thread task carries
 * both the model build and the first render (budget: no task over 100 ms). Shows the loading state meanwhile (F13).
 */
/** Internal props set by the outer Gantt (access gate and Proposal workflow). */
export interface CoreProps extends GanttProps {
  /** Access decisions for this user (L4, L5). */
  evaluator?: AccessEvaluator;
  /** Draw Current's dates as ghost bars and mark what differs (K4). */
  compareWith?: RoadmapDocument;
  /** Called after a data operation was applied locally (optimistic); the backend may still refuse it (H7). */
  onCommit?: (op: DataOperation, doc: RoadmapDocument) => void;
  /** Rendered above the chart, inside its frame (the Proposal bar). */
  header?: ReactNode;
  /** Undo history is kept per scope (per Proposal, F8); it is cleared when this changes. */
  undoScope?: string;
}

const SCHEDULE_FIELDS = new Set(['start', 'end', 'duration', 'durationUnit', 'constraint', 'mode', 'parent', 'type']);
/** Whether an operation can move dates (so the schedule must be recalculated). */
export function affectsSchedule(op: DataOperation): boolean {
  if (op.type === 'batch') return op.ops.some(affectsSchedule);
  if (op.type === 'task.update') return Object.keys(op.fields).some((f) => SCHEDULE_FIELDS.has(f));
  if (op.type === 'link.update') return 'type' in op.fields || 'lag' in op.fields || 'lagUnit' in op.fields || 'source' in op.fields || 'target' in op.fields;
  return true;
}

/**
 * The date changes the schedule needs (K1), as task updates; a cycle is refused (C9). Each moved task must
 * be one the user may change: moving a task they cannot change is refused with the reason.
 */
/**
 * A task with predecessors is scheduled as soon as they allow, so moving it by hand would be undone.
 * When the user sets its start, keep that date as a start-no-earlier-than constraint (as desktop planners do).
 */
export function pinMovedStarts(doc: RoadmapDocument, op: DataOperation): DataOperation {
  if (op.type === 'batch') return { ...op, ops: op.ops.map((o) => pinMovedStarts(doc, o)) };
  if (op.type !== 'task.update' || !op.fields.start || 'constraint' in op.fields) return op;
  if (!doc.links.some((l) => l.target === op.id)) return op;
  return { ...op, fields: { ...op.fields, constraint: { type: 'SNET', date: op.fields.start } } };
}

export function rescheduleOps(doc: RoadmapDocument, ev?: AccessEvaluator): { ops: DataOperation[] } | { error: string } {
  const s = schedule(doc);
  if (s.cycle) return { error: s.issues[0]!.message };
  const byId = new Map(doc.tasks.map((t) => [t.id, t]));
  const ops: DataOperation[] = [];
  for (const c of s.changes) {
    const t = byId.get(c.id)!;
    const fields: Partial<Task> = t.end ? { start: c.start, end: null as unknown as undefined } : { start: c.start };
    if (ev) {
      const d = checkChange(ev, { entity: 'task', op: 'update', id: c.id, fields: { start: c.start } }, t as never, doc.roadmap.id);
      if (!d.allowed && !ev.can('schedule.run', { project: doc.roadmap.id })) return { error: `This would also move “${t.name}”, which you may not change (${d.reason})` };
    }
    ops.push({ type: 'task.update', id: c.id, fields });
  }
  return { ops };
}

/** Maps a data operation to the change shape the access rules are written for. */
export type ChangeOf = { entity: 'task' | 'link'; op: 'create' | 'update' | 'delete'; id: string; fields?: Record<string, unknown> };
/** The changes an operation makes, flattened. */
export function changesOf(op: DataOperation): ChangeOf[] { return flattenOps(op).map(changeOf); }
export function changeOf(op: DataOperation): ChangeOf {
  switch (op.type) {
    case 'batch': throw new Error('use changesOf for a batch');
    case 'task.create': return { entity: 'task', op: 'create', id: op.task.id, fields: { ...op.task } };
    case 'task.update': return { entity: 'task', op: 'update', id: op.id, fields: op.fields as Record<string, unknown> };
    case 'task.delete': return { entity: 'task', op: 'delete', id: op.id };
    case 'link.create': return { entity: 'link', op: 'create', id: op.link.id, fields: { ...op.link } };
    case 'link.update': return { entity: 'link', op: 'update', id: op.id, fields: op.fields as Record<string, unknown> };
    case 'link.delete': return { entity: 'link', op: 'delete', id: op.id };
  }
}

export const CoreGantt = forwardRef<GanttHandle, CoreProps>(function CoreGantt(props, ref) {
  // The working document: starts as props.data, changes through data operations, resets when props.data changes.
  const [working, setWorking] = useState<{ from: RoadmapDocument; doc: RoadmapDocument }>({ from: props.data, doc: props.data });
  const doc = working.from === props.data ? working.doc : props.data;
  const docRef = useRef(doc); docRef.current = doc;
  const propsRef = useRef(props); propsRef.current = props;
  const viewRef = useRef<ViewBridge | null>(null);
  const lastRefusal = useRef<string | undefined>(undefined);

  const pipeline = useMemo(() => new OperationPipeline(
    () => {
      const p = propsRef.current;
      return {
        beforeOperation: (op, ctx) => {
          if (p.readOnly && /^(task|link)\./.test(op.type)) return typeof p.readOnly === 'string' ? p.readOnly : mergeMessages(p.messages).readOnly;
          return p.onBeforeOperation?.(op, ctx);
        },
        // The access rules are checked first, then the host's own hook (L5). A refusal carries the reason.
        authorize: (op, ctx) => {
          const ev = p.evaluator;
          if (ev) {
            for (const c of changesOf(op)) {
              const task = c.entity === 'task' ? docRef.current.tasks.find((t) => t.id === c.id) : undefined;
              const d = checkChange(ev, c, task as never, docRef.current.roadmap.id);
              if (!d.allowed) return d.reason!;
            }
          }
          return p.authorize ? p.authorize(op, ctx) : true;
        },
        operation: (r, ctx) => { recordHistory(r, ctx); p.onOperation?.(r, ctx); },
        refused: (r, ctx) => {
          p.onOperationRefused?.(r, ctx);
          if (r.stage === 'authorization') p.onAccessDenied?.({ operation: r.operation, reason: r.reason });
          lastRefusal.current = r.reason;
        },
      };
    },
    (op0) => {
      const op = propsRef.current.autoSchedule !== false ? pinMovedStarts(docRef.current, op0) : op0;
      const r = applyDataOperation(docRef.current, op);
      if ('error' in r) return r;
      // Successors move with the edit, in the same operation (K1).
      const s = propsRef.current.autoSchedule !== false && affectsSchedule(op) ? rescheduleOps(r.doc, propsRef.current.evaluator) : { ops: [] as DataOperation[] };
      if ('error' in s) return { error: s.error };
      let doc = r.doc, inverse = r.inverse, committed = op;
      if (s.ops.length) {
        const r2 = applyDataOperation(doc, { type: 'batch', ops: s.ops });
        if ('error' in r2) return r2;
        doc = r2.doc; inverse = [...r2.inverse, ...r.inverse];
        committed = { type: 'batch', ops: [op, ...s.ops], label: 'reschedule' };
      }
      docRef.current = doc;
      setWorking({ from: propsRef.current.data, doc });
      propsRef.current.onDataChanged?.(doc, committed);
      propsRef.current.onCommit?.(committed, doc);
      return { inverse };
    },
    (op) => { if (!viewRef.current) throw new Error('the chart is still loading'); viewRef.current.apply(op); },
  ), []);
  const run = useCallback((op: GanttOperation, source: OperationContext['source'] = 'api') =>
    pipeline.run(op, { source, by: propsRef.current.userId }), [pipeline]);

  // Undo and redo (F8): this user's own operations, per Proposal (the stacks reset when undoScope changes).
  const undoStack = useRef<DataOperation[][]>([]);
  const redoStack = useRef<DataOperation[][]>([]);
  const [historySize, setHistorySize] = useState({ undo: 0, redo: 0 });
  const syncHistory = () => setHistorySize({ undo: undoStack.current.length, redo: redoStack.current.length });
  function recordHistory(r: { operation: GanttOperation; inverse?: DataOperation[] }, ctx: OperationContext) {
    if (!r.inverse?.length || !isDataOperation(r.operation)) return;
    if (ctx.source === 'undo') redoStack.current.push(r.inverse);
    else { undoStack.current.push(r.inverse); if (ctx.source !== 'redo') redoStack.current = []; }
    if (undoStack.current.length > 200) undoStack.current.shift();
    syncHistory();
  }
  useEffect(() => { undoStack.current = []; redoStack.current = []; syncHistory(); }, [props.undoScope]);
  const undo = useCallback(async () => {
    const inv = undoStack.current.pop(); syncHistory();
    if (!inv) return null;
    const r = await run({ type: 'batch', ops: inv, label: 'undo' }, 'undo');
    if (!r.ok) { undoStack.current.push(inv); syncHistory(); }
    return r;
  }, [run]);
  const redo = useCallback(async () => {
    const inv = redoStack.current.pop(); syncHistory();
    if (!inv) return null;
    const r = await run({ type: 'batch', ops: inv, label: 'redo' }, 'redo');
    if (!r.ok) { redoStack.current.push(inv); syncHistory(); }
    return r;
  }, [run]);
  const history = useMemo(() => ({ undo, redo, canUndo: historySize.undo > 0, canRedo: historySize.redo > 0 }), [undo, redo, historySize]);

  useImperativeHandle(ref, () => ({
    run: (op) => run(op, 'api'),
    getData: () => docRef.current,
    getSelection: () => viewRef.current?.getSelection() ?? [],
    scrollToTask: (id) => viewRef.current?.scrollToTask(id),
    scrollToToday: () => viewRef.current?.scrollToToday(),
    fit: () => viewRef.current?.fit(),
    undo: async () => { await undo(); },
    redo: async () => { await redo(); },
  }), [run, undo, redo]);

  // Children loaded on demand (H2): per task, 'loading' or the reason the last load failed.
  const [loadState, setLoadState] = useState<ReadonlyMap<string, string>>(() => new Map());
  const loadingRef = useRef(new Set<string>());
  const requestChildren = useCallback((id: string) => {
    const load = propsRef.current.loadChildren;
    if (!load || loadingRef.current.has(id)) return;
    loadingRef.current.add(id);
    const mark = (v: string | null) => setLoadState((m) => { const n = new Map(m); v === null ? n.delete(id) : n.set(id, v); return n; });
    mark('loading');
    load(id).then((res) => {
      const r = mergeChildren(docRef.current, id, res);
      if ('error' in r) throw new Error(r.error);
      docRef.current = r.doc;
      setWorking({ from: propsRef.current.data, doc: r.doc });
      mark(null);
    }).catch((e: unknown) => mark(e instanceof Error ? e.message : String(e)))
      .finally(() => loadingRef.current.delete(id));
  }, []);
  const [built, setBuilt] = useState<{ data: RoadmapDocument; model: Model } | null>(null);
  const [failure, setFailure] = useState<{ doc: RoadmapDocument; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => { setFailure(null); setAttempt((a) => a + 1); }, []);
  useEffect(() => {
    if (built?.data === doc || failure?.doc === doc) return;
    // The engine places tasks in a worker; the main thread only builds the tree indexes and renders (as a transition).
    let cancelled = false;
    const fail = (e: unknown) => { if (!cancelled) setFailure({ doc, message: e instanceof Error ? e.message : String(e) }); };
    placeOffThread(doc).then((placement) => {
      if (cancelled) return;
      setTimeout(() => {
        if (cancelled) return;
        try { const model = buildModel(doc, placement); startTransition(() => setBuilt({ data: doc, model })); } catch (e) { fail(e); }
      }, 0);
    }, fail);
    return () => { cancelled = true; };
  }, [doc, built, failure, attempt]);
  const themeAttr = props.theme ? { 'data-theme': props.theme } : {};
  if (failure?.doc === doc) return <ErrorState {...props} message={failure.message} retry={retry} themeAttr={themeAttr} />;
  // While a changed document is being placed, keep showing the previous one (no loading flash).
  if (!built) {
    return <div className="gx-root" {...themeAttr} style={{ height: props.height ?? 600 }} aria-busy="true"><div className="gx-empty">{mergeMessages(props.messages).loading}</div></div>;
  }
  return (
    <ViewBoundary key={attempt} fallback={(message) => <ErrorState {...props} message={message} retry={retry} themeAttr={themeAttr} />}>
      <GanttView {...props} data={built.data} model={built.model} run={run} viewRef={viewRef} loadState={loadState} requestChildren={requestChildren} history={history} />
    </ViewBoundary>
  );
});

function ErrorState(props: GanttProps & { message: string; retry: () => void; themeAttr: object }) {
  const m = mergeMessages(props.messages);
  return (
    <div className="gx-root" {...props.themeAttr} style={{ height: props.height ?? 600 }}>
      {props.errorState ? props.errorState({ message: props.message, retry: props.retry }) : (
        <div className="gx-empty gx-error" role="alert">
          <strong>{m.errorTitle}</strong>
          <p>{props.message}</p>
          <button className="gx-btn" onClick={props.retry}>{m.errorRetry}</button>
        </div>
      )}
    </div>
  );
}

/** Catches a rendering failure so the host page survives and the user sees the error state with a retry. */
class ViewBoundary extends Component<{ fallback: (message: string) => ReactNode; children: ReactNode }, { message: string | null }> {
  state = { message: null as string | null };
  static getDerivedStateFromError(e: unknown) { return { message: e instanceof Error ? e.message : String(e) }; }
  render() { return this.state.message !== null ? this.props.fallback(this.state.message) : this.props.children; }
}

function SaveIndicator({ state }: { state: NonNullable<GanttProps['saveState']> }) {
  const { t: m } = useI18n();
  const text = state.status === 'saving' ? m.saving : state.status === 'saved' ? m.saved : m.notSaved(state.reason ?? '');
  return <span className={`gx-save gx-save-${state.status}`} role="status">{text}</span>;
}

function GanttView(props: CoreProps & {
  model: Model; run: (op: GanttOperation, source?: OperationContext['source']) => Promise<OperationResult>; viewRef: React.RefObject<ViewBridge | null>;
  loadState: ReadonlyMap<string, string>; requestChildren: (id: string) => void;
  history: { undo: () => Promise<OperationResult | null>; redo: () => Promise<OperationResult | null>; canUndo: boolean; canRedo: boolean };
}) {
  const { data, kinds, locale, detailsPanel = 'right', height = 600, run } = props;
  const baseModel = props.model;
  const i18n = useMemo(() => makeI18n(mergeMessages(props.messages), locale), [props.messages, locale]);
  const m = i18n.t;
  // The view (D9–D11, D18, F12): controlled by the host when it passes `view`.
  const [vsState, setVsState] = useState<GanttViewState>(() => props.view ?? {});
  const vs = props.view ?? vsState;
  const onViewRef = useRef(props.onViewChanged); onViewRef.current = props.onViewChanged;
  const setVs = useCallback((next: GanttViewState) => { setVsState(next); onViewRef.current?.(next); }, []);
  const allCols = useMemo(() => {
    const extra = new Map((props.columns ?? []).map((c) => [c.id, c]));
    // A column the host passes is shown unless it says otherwise, even where it replaces a built-in hidden one.
    const out = builtinColumns(m).map((c) => { const x = extra.get(c.id); if (x) extra.delete(c.id); return x ? { ...c, hidden: false, ...x } : c; });
    out.splice(out.length - 1, 0, ...extra.values());
    return out;
  }, [m, props.columns]);
  const cols = useMemo(() => resolveColumns(allCols, vs.columns), [allCols, vs.columns]);
  const frozen = Math.min(vs.frozen ?? 0, cols.length);
  const fieldLabel = useCallback((f: string) => allCols.find((c) => c.field === f)?.label ?? f, [allCols]);
  const shown = useMemo(() => viewModel(baseModel, vs, (f, v) => `${fieldLabel(f)}: ${v === '' ? m.emptyValue : f === 'start' || f === 'end' ? fmtDate(Number(v), locale) : v}`), [baseModel, vs, fieldLabel, m, locale]);
  const model = shown.model;
  /** Rows follow tree order: moving rows by dragging makes sense only then. */
  const treeOrder = !vs.sort && !vs.groupBy;
  const [narrow, setNarrow] = useState(false);
  const compact = props.compact === true || vs.compact === true || ((props.compact ?? 'auto') === 'auto' && narrow);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [laneOpen, setLaneOpen] = useState<Set<string>>(() => new Set());
  const sizes = useMemo<RowSizes>(() => ({ row: props.rowHeight ?? (compact ? 30 : DEFAULT_SIZES.row), laneTrack: props.laneTrackHeight ?? DEFAULT_SIZES.laneTrack }), [props.rowHeight, props.laneTrackHeight, compact]);
  const levels = props.zoomLevels?.length ? props.zoomLevels : ZOOM_LEVELS;
  const rows = useMemo(() => layoutRows(model, collapsed, laneOpen, sizes), [model, collapsed, laneOpen, sizes]);
  const bars = useMemo(() => barIndex(rows, sizes), [rows, sizes]);
  const rowIndexOf = useMemo(() => new Map(rows.map((r, i) => [r.taskId, i])), [rows]);
  const blocks = useMemo(() => {
    const out: Block[] = [];
    for (let s = 0; s < rows.length; s += BLOCK) out.push({ index: out.length, start: s, rows: rows.slice(s, s + BLOCK) });
    return out;
  }, [rows]);

  const [zoomState, setZoomState] = useState(props.zoom ?? (levels.find((z) => z.id === 'week') ?? levels[Math.floor(levels.length / 2)]!).id);
  const zoom = props.zoom ?? zoomState;
  const level = levels.find((z) => z.id === zoom) ?? levels[Math.floor(levels.length / 2)]!;
  const span = model.placement.span;
  const origin = (span?.start ?? 0) - 21;
  const endDay = (span?.end ?? origin + 90) + 45;
  const scale: Scale = useMemo(() => ({ origin, pxPerDay: level.pxPerDay }), [origin, level.pxPerDay]);
  const chartWidth = (endDay - origin) * level.pxPerDay;

  const [selState, setSelState] = useState<SelectionTarget[]>([]);
  const selection = props.selection ?? selState;
  const selKeys = useMemo(() => new Set(selection.map(targetKey)), [selection]);
  const onSelRef = useRef(props.onSelectionChanged); onSelRef.current = props.onSelectionChanged;
  const applySelection = useCallback((sel: SelectionTarget[]) => {
    setSelState(sel);
    onSelRef.current?.({ selection: sel, primary: sel[sel.length - 1] });
  }, []);
  const select = useCallback((sel: SelectionTarget[]) => { void run({ type: 'selection.set', selection: sel }, 'user'); }, [run]);
  const linkById = useMemo(() => new Map(data.links.map((l) => [l.id, l])), [data.links]);
  // Tasks marked because a selected connector joins them (F15).
  const linkMarked = useMemo(() => {
    const s = new Set<string>();
    for (const t of selection) if (t.type === 'link') { const l = linkById.get(t.linkId); if (l) { s.add(l.source); s.add(l.target); } }
    return s;
  }, [selection, linkById]);

  // Scroll position, quantised to blocks and day chunks.
  const chartRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = rootRef.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => { if (e) setNarrow(e.contentRect.width < 720); });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const gridBodyRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  // b0..b1 and c0..c1 include the overscan margin; v0..v1 and t0..t1 are what is actually on screen.
  const [view, setView] = useState({ b0: 0, b1: 1, c0: 0, c1: 1, v0: 0, v1: 1, t0: 0, t1: 1, h: 600 });
  // Right after a zoom only what is on screen is redrawn; the margin follows in a later task, so the
  // redraw never becomes one long task (budget: no task over 100 ms).
  const [settling, setSettling] = useState(false);
  useEffect(() => {
    if (!settling) return;
    let t = 0;
    const raf = requestAnimationFrame(() => { t = window.setTimeout(() => startTransition(() => setSettling(false)), 0); });
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, [settling]);
  const geom = useRef({ rows, scale, blocksLen: blocks.length, zoom, levels }); geom.current = { rows, scale, blocksLen: blocks.length, zoom, levels };
  // Viewport size comes from the ResizeObserver, so the scroll handler only reads scroll offsets and never forces layout.
  const size = useRef({ w: 1000, h: 600 });
  const measure = useCallback((top?: number, left?: number) => {
    const el = chartRef.current; if (!el) return;
    const st = top ?? el.scrollTop, sl = left ?? el.scrollLeft;
    const { w, h } = size.current;
    const { rows: rs, scale: sc, blocksLen } = geom.current;
    const r0 = rowAt(rs, st - OVERSCAN_PX), r1 = rowAt(rs, st + h + OVERSCAN_PX);
    const b0 = Math.floor(r0 / BLOCK), b1 = Math.min(blocksLen, Math.floor(r1 / BLOCK) + 1);
    const v0 = Math.floor(rowAt(rs, st) / BLOCK), v1 = Math.min(blocksLen, Math.floor(rowAt(rs, st + h) / BLOCK) + 1);
    const t0 = Math.floor(Math.max(0, sl / sc.pxPerDay) / DAY_CHUNK), t1 = Math.floor((sl + w) / sc.pxPerDay / DAY_CHUNK) + 1;
    const d0 = (sl - OVERSCAN_PX) / sc.pxPerDay, d1 = (sl + w + OVERSCAN_PX) / sc.pxPerDay;
    const c0 = Math.floor(Math.max(0, d0) / DAY_CHUNK), c1 = Math.floor(d1 / DAY_CHUNK) + 1;
    startTransition(() => setView((v) => (v.b0 === b0 && v.b1 === b1 && v.c0 === c0 && v.c1 === c1 && v.v0 === v0 && v.v1 === v1 && v.t0 === t0 && v.t1 === t1 && v.h === h
      ? v : { b0, b1, c0, c1, v0, v1, t0, t1, h })));
  }, []);
  const onScroll = useCallback(() => {
    const el = chartRef.current!;
    const st = el.scrollTop, sl = el.scrollLeft; // reads first …
    if (gridBodyRef.current) gridBodyRef.current.scrollTop = st; // … then writes
    if (headerRef.current) headerRef.current.scrollLeft = sl;
    measure(st, sl);
  }, [measure]);
  useLayoutEffect(() => { measure(); }, [measure, rows, scale]);
  useLayoutEffect(() => {
    const el = chartRef.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => { if (e) size.current = { w: e.contentRect.width, h: e.contentRect.height }; measure(); });
    ro.observe(el); return () => ro.disconnect();
  }, [measure]);

  // "Today" is the date in the roadmap's time zone (G13), so every user sees the same today line.
  const todayDay = useMemo(() => dayOfIso(props.today ?? data.roadmap.statusDate ?? todayIn(data.roadmap.timeZone)), [props.today, data.roadmap.statusDate, data.roadmap.timeZone]);

  const scrollToDay = useCallback((d: DayNum, smooth = true) => {
    const el = chartRef.current; if (!el) return;
    el.scrollTo({ left: Math.max(0, xOf(scale, d) - el.clientWidth / 3), behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' });
  }, [scale]);
  const scrollToToday = useCallback(() => scrollToDay(todayDay), [scrollToDay, todayDay]);

  // Zooming from the toolbar or keyboard keeps the selected item where it is on screen, else today, else the centre (F11).
  const anchorRef = useRef({ selection: [] as SelectionTarget[], model, today: 0 });
  anchorRef.current = { selection, model, today: todayDay };
  const onZoomRef = useRef(props.onZoomChanged); onZoomRef.current = props.onZoomChanged;
  const pendingAnchor = useRef<{ day: number; px: number } | null>(null);
  const gesture = useRef<{ from: number; px: number; timer: number } | null>(null);
  const gesture_active = () => gesture.current !== null;
  const applyZoom = useCallback((z: string) => { startTransition(() => { setZoomState(z); setSettling(true); }); onZoomRef.current?.(z); }, []);
  const setZoom = useCallback((z: string, anchorPx?: number) => {
    const el = chartRef.current, sc = geom.current.scale;
    if (el && !pendingAnchor.current) {
      if (anchorPx !== undefined) pendingAnchor.current = { day: (el.scrollLeft + anchorPx) / sc.pxPerDay + sc.origin, px: anchorPx };
      else pendingAnchor.current = zoomAnchor(el, sc, anchorRef.current.selection, anchorRef.current.model, anchorRef.current.today);
    }
    void run({ type: 'zoom.set', zoom: z }, 'user').then((r) => { if (!r.ok) { pendingAnchor.current = null; zoomRef.current = geom.current.zoom; } });
  }, [run]);
  useLayoutEffect(() => {
    const a = pendingAnchor.current, el = chartRef.current;
    if (a && el) { el.scrollLeft = (a.day - scale.origin) * scale.pxPerDay - a.px; pendingAnchor.current = null; }
  }, [scale]);
  const fit = useCallback(() => {
    const el = chartRef.current; if (!el || !span) return;
    const days = span.end - span.start + 1;
    const ls = geom.current.levels;
    const best = [...ls].sort((a, b) => b.pxPerDay - a.pxPerDay).find((z) => days * z.pxPerDay <= el.clientWidth - 40) ?? ls[0]!;
    void run({ type: 'zoom.set', zoom: best.id }, 'user').then((r) => {
      if (r.ok) requestAnimationFrame(() => { el.scrollLeft = (span.start - origin) * best.pxPerDay - 20; });
    });
  }, [span, origin, run]);

  useEffect(() => { requestAnimationFrame(() => scrollToDay(todayDay, false)); /* once per data */ }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ctrl/Cmd + wheel zooms around the pointer (F11).
  const zoomRef = useRef(zoom);
  if (!gesture_active()) zoomRef.current = zoom;
  const canvasRef = useRef<HTMLDivElement>(null);
  const headerInnerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = chartRef.current; if (!el) return;
    const h = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const ls = geom.current.levels;
      const i = ls.findIndex((z) => z.id === zoomRef.current);
      const ni = Math.max(0, Math.min(ls.length - 1, i + (e.deltaY < 0 ? 1 : -1)));
      if (ni === i) return;
      const px = e.clientX - el.getBoundingClientRect().left;
      zoomRef.current = ls[ni]!.id;
      // Preview: scale the drawn canvas and the axis on the compositor; React redraws once the gesture settles.
      const g = gesture.current ?? (gesture.current = { from: geom.current.scale.pxPerDay, px, timer: 0 });
      const k = ls[ni]!.pxPerDay / g.from;
      const ox = el.scrollLeft + g.px;
      for (const n of [canvasRef.current, headerInnerRef.current]) if (n) { n.style.transformOrigin = `${ox}px 0`; n.style.transform = `scaleX(${k})`; }
      clearTimeout(g.timer);
      g.timer = window.setTimeout(() => {
        gesture.current = null;
        for (const n of [canvasRef.current, headerInnerRef.current]) if (n) n.style.transform = '';
        setZoom(zoomRef.current, g.px);
      }, 140);
    };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, [setZoom]);

  // Pan by dragging empty timeline (F11). Pure DOM, no React state.
  const pan = useRef<{ x: number; y: number; l: number; t: number; moved: boolean } | null>(null);

  // Keyboard focus (F9): a roving focus over rows, and over bars within a lane row.
  const [focus, setFocus] = useState<{ row: number; bar: number }>({ row: 0, bar: -1 });
  const ensureVisible = useCallback((i: number) => {
    const el = chartRef.current, r = geom.current.rows[i]; if (!el || !r) return;
    if (r.top < el.scrollTop) el.scrollTop = r.top;
    else if (r.top + r.height > el.scrollTop + el.clientHeight) el.scrollTop = r.top + r.height - el.clientHeight;
  }, []);
  const [announce, setAnnounce] = useState('');
  const treeRef = useRef({ collapsed, laneOpen }); treeRef.current = { collapsed, laneOpen };
  const toggle = useCallback((id: string) => {
    const r = geom.current.rows.find((x) => x.taskId === id);
    const expand = r ? !r.expanded : treeRef.current.collapsed.has(id);
    void run({ type: expand ? 'row.expand' : 'row.collapse', id }, 'user');
  }, [run]);
  const toggleLane = useCallback((id: string) => { void run({ type: treeRef.current.laneOpen.has(id) ? 'lane.close' : 'lane.open', id }, 'user'); }, [run]);
  const setIn = (set: React.Dispatch<React.SetStateAction<Set<string>>>, id: string, on: boolean) =>
    set((c) => { if (c.has(id) === on) return c; const n = new Set(c); on ? n.add(id) : n.delete(id); return n; });
  const selRef = useRef({ selection, selKeys, model }); selRef.current = { selection, selKeys, model };
  const i18nRef = useRef(i18n); i18nRef.current = i18n;
  const anchor = useRef<string | null>(null);
  const doSelect = useCallback((t: SelectionTarget, additive: boolean, rangeTo?: number) => {
    const { selection: cur, selKeys: keys, model: mdl } = selRef.current;
    let next: SelectionTarget[];
    if (rangeTo !== undefined && t.type === 'row') {
      // Shift+click selects every row from the anchor to here (D14); Ctrl adds the range to the selection.
      const rs = geom.current.rows;
      const a = anchor.current ? rs.findIndex((r) => r.taskId === anchor.current) : -1;
      const lo = a < 0 ? rangeTo : Math.min(a, rangeTo), hi = a < 0 ? rangeTo : Math.max(a, rangeTo);
      const range: SelectionTarget[] = rs.slice(lo, hi + 1).filter((r) => !isGroupId(r.taskId)).map((r) => ({ type: 'row', taskId: r.taskId }));
      const inRange = new Set(range.map(targetKey));
      next = additive ? [...cur.filter((s) => !inRange.has(targetKey(s))), ...range] : range;
      // The clicked row is the primary one.
      const ci = next.findIndex((s) => targetKey(s) === targetKey(t)); if (ci >= 0) next.push(...next.splice(ci, 1));
    } else {
      next = additive ? (keys.has(targetKey(t)) ? cur.filter((s) => targetKey(s) !== targetKey(t)) : [...cur, t]) : [t];
      if (t.type !== 'link') anchor.current = t.taskId;
    }
    select(next);
    const tx = i18nRef.current;
    const name = labelOf(t, mdl, tx.t);
    setAnnounce(next.length > 1 ? tx.t.selectedMany(name, tx.num(next.length)) : next.length ? tx.t.selected(name) : tx.t.selectionCleared);
  }, [select]);

  const tipRef = useRef<(s: TipState | null) => void>(() => {});
  const menuRef = useRef<(x: number, y: number, t: SelectionTarget) => void>(() => {});
  const apiRef = useRef<Api>(null!);
  const actRef = useRef<{ addBelow: (id: string) => void; rowPointerDown: (e: React.PointerEvent, i: number, id: string) => void }>(null!);
  const editRef = useRef<{ whyNotEdit: (id: string, f: string) => string | null; editTask: (id: string, f: Partial<Task>) => Promise<OperationResult> }>(null!);
  const api = useMemo<Api>(() => ({
    startEdit: (id) => { if (editRef.current.whyNotEdit(id, 'name') === null) setEditing(id); },
    menu: (x, y, t) => menuRef.current(x, y, t),
    finishEdit: (id, value) => { setEditing(null); if (value !== null && value.trim()) void editRef.current.editTask(id, { name: value.trim() }); },
    select: doSelect, focus: (row, bar) => setFocus((f) => (f.row === row && f.bar === bar ? f : { row, bar })), toggle, toggleLane,
    addBelow: (id) => actRef.current.addBelow(id),
    rowPointerDown: (e, i, id) => actRef.current.rowPointerDown(e, i, id),
    tip: (x, y, content) => tipRef.current(content == null ? null : { x, y, content }),
  }), [doSelect, toggle, toggleLane]);
  const scrollToTask = useCallback((id: string) => {
    // Open collapsed ancestors (and a lane holding the task), then scroll to the task's row.
    const m = selRef.current.model;
    for (let p = m.tasks.get(id)?.parent; p; p = m.tasks.get(p)?.parent ?? null) {
      if (m.tasks.get(p)?.lane) continue;
      setIn(setCollapsed, p, false);
    }
    requestAnimationFrame(() => {
      const rs = geom.current.rows; const i = rs.findIndex((r) => r.taskId === id || r.bars.some((b) => b.taskId === id));
      if (i >= 0) { ensureVisible(i); const pl = m.placement.byId.get(id); if (pl?.scheduled) scrollToDay(pl.start!); }
    });
  }, [ensureVisible, scrollToDay]);
  const bridge = useRef<ViewBridge | null>(null);
  bridge.current = {
    apply: (op) => {
      switch (op.type) {
        case 'row.expand': {
          setIn(setCollapsed, op.id, false);
          const r = geom.current.rows.find((x) => x.taskId === op.id);
          if (r?.unloaded) props.requestChildren(op.id);
          break;
        }
        case 'row.collapse': setIn(setCollapsed, op.id, true); break;
        case 'lane.open': setIn(setLaneOpen, op.id, true); break;
        case 'lane.close': setIn(setLaneOpen, op.id, false); break;
        case 'selection.set': applySelection(op.selection); break;
        case 'zoom.set': if (!geom.current.levels.some((z) => z.id === op.zoom)) throw new Error(`unknown zoom level "${op.zoom}"`); applyZoom(op.zoom); break;
      }
    },
    getSelection: () => selRef.current.selection,
    scrollToTask, scrollToToday, fit,
  };
  useLayoutEffect(() => {
    props.viewRef.current = { apply: (op) => bridge.current!.apply(op), getSelection: () => bridge.current!.getSelection(),
      scrollToTask: (id) => bridge.current!.scrollToTask(id), scrollToToday: () => bridge.current!.scrollToToday(), fit: () => bridge.current!.fit() };
    return () => { props.viewRef.current = null; };
  }, [props.viewRef]);
  const loadState = props.loadState;
  // Comparison with Current (K4): Current's placement for ghost bars, and which tasks differ.
  const compare = useMemo<Compare | null>(() => {
    const base = props.compareWith;
    if (!base) return null;
    const baseById = new Map(base.tasks.map((t) => [t.id, t]));
    const diff = new Map<string, 'added' | 'changed'>();
    for (const t of data.tasks) {
      const b = baseById.get(t.id);
      if (!b) diff.set(t.id, 'added');
      else if (JSON.stringify(b) !== JSON.stringify(t)) diff.set(t.id, 'changed');
    }
    return { base: place(base), diff };
  }, [props.compareWith, data.tasks]);
  // Inline editing of a task name in the grid (D7).
  const [editing, setEditing] = useState<string | null>(null);
  // Schedule analysis from the engine, off the main thread (C2, C11).
  const [analysis, setAnalysis] = useState<ScheduleResult | null>(null);
  useEffect(() => {
    let live = true;
    scheduleOffThread(data).then((r) => { if (live) setAnalysis(r.result); }, () => {});
    return () => { live = false; };
  }, [data]);
  const [showCritical, setShowCritical] = useState(false);
  const critical = useMemo(() => (showCritical && analysis ? new Set([...analysis.tasks].filter(([, t]) => t.critical).map(([id]) => id)) : null), [showCritical, analysis]);
  const criticalLinks = useMemo(() => {
    if (!critical || !analysis) return null;
    const out = new Set<string>();
    for (const [id, t] of analysis.tasks) if (t.drivenBy && critical.has(id)) out.add(t.drivenBy);
    return out;
  }, [critical, analysis]);
  const scheduleWhyNot = props.readOnly ? (typeof props.readOnly === 'string' ? props.readOnly : i18n.t.readOnly)
    : props.evaluator && !props.evaluator.can('schedule.run', { project: data.roadmap.id }) ? 'Missing permission: schedule.run' : null;
  const [scheduleNote, setScheduleNote] = useState('');
  const runSchedule = useCallback(() => {
    const r = rescheduleOps(data, props.evaluator);
    if ('error' in r) { setScheduleNote(r.error); return; }
    if (!r.ops.length) { setScheduleNote(i18n.t.scheduleUpToDate); return; }
    void run({ type: 'batch', ops: r.ops, label: 'schedule' }, 'user').then((x) => setScheduleNote(x.ok ? i18n.t.scheduleApplied(i18n.num(r.ops.length)) : x.reason));
  }, [data, props.evaluator, run, i18n]);
  apiRef.current = api;
  menuRef.current = (x, y, t) => openMenuRef.current(x, y, t);
  const ctx = useMemo<Ctx>(() => ({ model, kinds, locale, laneOpen, selKeys, linkMarked, loadState, compare, editing, critical, cols, frozen, matches: shown.matches, barTemplate: props.barTemplate, tooltipTemplate: props.tooltipTemplate }),
    [model, kinds, locale, laneOpen, selKeys, linkMarked, loadState, compare, editing, critical, cols, frozen, shown.matches, props.barTemplate, props.tooltipTemplate]);
  // What the user may change, with the reason when not (F14, L4).
  const whyNotEdit = useCallback((taskId: string, field: string): string | null => {
    const ro = props.readOnly;
    if (ro) return typeof ro === 'string' ? ro : i18n.t.readOnly;
    const t = model.tasks.get(taskId);
    if (!t) return i18n.t.noLongerExists;
    if (isGroupId(taskId)) return i18n.t.groupedBy(fieldLabel(vs.groupBy ?? ''));
    if ((t.type === 'summary' || (model.children.get(taskId)?.length ?? 0) > 0) && ['start', 'end', 'duration', 'progress'].includes(field)) return i18n.t.derivedDates;
    const ev = props.evaluator;
    if (!ev) return null;
    const d = checkChange(ev, { entity: 'task', op: 'update', id: taskId, fields: { [field]: null } }, t as never, data.roadmap.id);
    return d.allowed ? null : d.reason!;
  }, [props.readOnly, props.evaluator, model, data.roadmap.id, i18n, fieldLabel, vs.groupBy]);
  const editTask = useCallback((taskId: string, fields: Partial<Task>) => run({ type: 'task.update', id: taskId, fields }, 'user'), [run]);
  const whyNotLinkEdit = useCallback(() => {
    const ro = props.readOnly; if (ro) return typeof ro === 'string' ? ro : i18n.t.readOnly;
    return props.evaluator && !props.evaluator.can('link.modify', { project: data.roadmap.id }) ? 'Missing permission: link.modify' : null;
  }, [props.readOnly, props.evaluator, data.roadmap.id, i18n]);
  const editLink = useCallback((id: string, fields: Partial<Link>) => run({ type: 'link.update', id, fields }, 'user').then((r) => { if (!r.ok) setAnnounce(r.reason); }), [run]);
  const editMany = useCallback((ids: string[], fields: Partial<Task>) => run({ type: 'batch', label: 'bulk', ops: ids.map((id) => ({ type: 'task.update' as const, id, fields })) }, 'user')
    .then((r) => { if (!r.ok) { setNotice(r.reason); setAnnounce(r.reason); } }), [run]);
  editRef.current = { whyNotEdit, editTask };

  // ---------- Editing on the chart (Phase 5) ----------
  const [notice, setNotice] = useState('');
  const say = useCallback((text: string) => { setNotice(text); setAnnounce(text); }, []);
  const commit = useCallback((op: DataOperation) => { void run(op, 'user').then((r) => { if (!r.ok) say(r.reason); }); }, [run, say]);
  const dataRef = useRef(data); dataRef.current = data;
  const modelRef = useRef(model); modelRef.current = model;
  const newId = useCallback((prefix = 't') => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, []);
  const whyNotLinkFor = useCallback((src: string, tgt: string, type: Link['type']) => {
    const ro = props.readOnly; if (ro) return typeof ro === 'string' ? ro : i18n.t.readOnly;
    const ev = props.evaluator;
    if (ev && !ev.can('link.create', { project: data.roadmap.id })) return 'Missing permission: link.create';
    return whyNotLink(dataRef.current, src, tgt, type);
  }, [props.readOnly, props.evaluator, data.roadmap.id, i18n]);
  /** Tasks the keyboard edits act on: the selection, else the focused row. */
  const editTargets = (): string[] => {
    const ids = selection.filter((t) => t.type !== 'link').map((t) => (t as { taskId: string }).taskId);
    if (ids.length) return ids;
    const r = rows[focus.row]; if (!r) return [];
    const t = r.lane && focus.bar >= 0 ? r.bars[focus.bar]?.taskId : r.taskId;
    return t ? [t] : [];
  };
  /** Moves (or resizes) tasks by whole working days, as one operation (F9: the keyboard equivalent of dragging). */
  const shiftTasks = (ids: string[], days: number, resize: boolean) => {
    const cal = model.placement.calendar; const ops: DataOperation[] = [];
    for (const id of ids) {
      const p = model.placement.byId.get(id);
      if (!p?.scheduled || (model.children.get(id)?.length ?? 0) > 0) continue;
      const why = whyNotEdit(id, resize ? 'duration' : 'start'); if (why) { say(why); return; }
      const end = p.task.end ? { end: null as unknown as undefined } : {};
      if (resize) ops.push({ type: 'task.update', id, fields: { duration: Math.max(1, (p.duration ?? 1) + days), ...end } });
      else ops.push({ type: 'task.update', id, fields: { start: fromDay(cal.shift(p.start!, days)), ...end } });
    }
    if (ops.length) commit(ops.length === 1 ? ops[0]! : { type: 'batch', ops });
  };
  const deleteSelection = () => {
    const ops: DataOperation[] = [];
    for (const t of selection) {
      if (t.type === 'link') ops.push({ type: 'link.delete', id: t.linkId });
      else ops.push({ type: 'task.delete', id: t.taskId });
    }
    if (!ops.length) { const id = editTargets()[0]; if (id) ops.push({ type: 'task.delete', id }); }
    if (ops.length) { commit(ops.length === 1 ? ops[0]! : { type: 'batch', ops }); select([]); }
  };
  // ---------- Tree editing (D2, D3, D4, D15, D16) ----------
  type TreeOut = { ops: DataOperation[]; ids?: string[] } | { error: string };
  const runTree = (r: TreeOut, label: string, after?: (ids?: string[]) => void) => {
    if ('error' in r) { say(r.error); return; }
    if (!r.ops.length) return;
    void run({ type: 'batch', ops: r.ops, label }, 'user').then((x) => { if (!x.ok) say(x.reason); else after?.(r.ids); });
  };
  /** Selected tasks (not connectors or group rows), else the focused one. */
  const selectedTasks = (): string[] => editTargets().filter((id) => !isGroupId(id) && baseModel.tasks.has(id));
  const whyNotMove = (ids: string[]) => ids.map((id) => whyNotEdit(id, 'parent')).find((w) => w) ?? null;
  const addTask = (parent: string | null, index: number, name?: string, near?: string) => {
    const why = whyNotCreate(parent ?? ''); if (why) { say(why); return; }
    const ref = near ? baseModel.placement.byId.get(near) : undefined;
    const cal = baseModel.placement.calendar;
    const id = newId();
    const r = newTaskOps(baseModel, parent, index, { id, name: name ?? m.newTask, type: 'task', start: fromDay(cal.nextWorking(ref?.scheduled ? ref.start! : todayDay)), duration: 1 });
    runTree(r, 'add', () => {
      select([{ type: 'row', taskId: id }]);
      scrollToTask(id);
      if (!name) setTimeout(() => setEditing(id), 0); // name it straight away (D3)
    });
  };
  const addBelow = (id: string) => {
    const t = baseModel.tasks.get(id); if (!t) return;
    const sibs = baseModel.children.get(t.parent) ?? [];
    addTask(t.parent, sibs.indexOf(id) + 1, undefined, id);
  };
  const addChild = (id: string) => addTask(id, baseModel.children.get(id)?.length ?? 0, undefined, id);
  const addFromPlaceholder = (name: string) => {
    // Quick entry (D4): at the end of the selected summary, else at the end of the top level.
    const p = selection[selection.length - 1];
    const into = p && p.type === 'row' && (baseModel.children.get(p.taskId)?.length ?? 0) > 0 ? p.taskId : null;
    addTask(into, baseModel.children.get(into)?.length ?? 0, name, into ?? undefined);
  };
  const clip = useRef<{ clip: TreeClipboard; cut: boolean } | null>(null);
  const copySel = (cut: boolean) => {
    const ids = selectedTasks(); if (!ids.length) return;
    if (cut) { const why = whyNotMove(ids); if (why) { say(why); return; } }
    const c = copyTasks(baseModel, ids);
    clip.current = { clip: c, cut };
    say(m.copied(i18n.num(c.roots.length)));
    try { void navigator.clipboard?.writeText(JSON.stringify({ gantt: 'tasks', tasks: c.tasks, links: c.links })).catch(() => {}); } catch { /* no clipboard access */ }
  };
  /** Where a paste or duplicate lands: after the selected task, among its siblings; else at the end. */
  const pastePlace = (): { parent: string | null; index: number } => {
    const p = selectedTasks().at(-1);
    const t = p ? baseModel.tasks.get(p) : undefined;
    if (!t) return { parent: null, index: baseModel.children.get(null)?.length ?? 0 };
    return { parent: t.parent, index: (baseModel.children.get(t.parent) ?? []).indexOf(t.id) + 1 };
  };
  const pasteSel = () => {
    const c = clip.current; if (!c) { say(m.nothingToPaste); return; }
    const { parent, index } = pastePlace();
    if (c.cut) {
      // Cut and paste moves the tasks: ids, links and history stay.
      const ids = c.clip.roots.filter((id) => baseModel.tasks.has(id));
      clip.current = null;
      runTree(moveOps(baseModel, ids, parent, index), 'move', () => say(m.moved(ids.map((id) => baseModel.tasks.get(id)?.name ?? id).join(', '))));
      return;
    }
    const why = whyNotCreate(parent ?? ''); if (why) { say(why); return; }
    runTree(pasteOps(baseModel, c.clip, parent, index, () => newId()), 'paste', (ids) => {
      if (ids?.length) { select(ids.map((id) => ({ type: 'row' as const, taskId: id }))); say(m.pasted(i18n.num(ids.length))); }
    });
  };
  const duplicateSel = () => {
    const ids = selectedTasks(); if (!ids.length) return;
    const why = whyNotCreate(''); if (why) { say(why); return; }
    runTree(duplicateOps(baseModel, ids, () => newId()), 'duplicate', (n) => { if (n?.length) select(n.map((id) => ({ type: 'row' as const, taskId: id }))); });
  };
  const indentSel = (out: boolean) => {
    const ids = selectedTasks(); if (!ids.length) return;
    const why = whyNotMove(ids); if (why) { say(why); return; }
    runTree(out ? outdentOps(baseModel, ids) : indentOps(baseModel, ids), out ? 'outdent' : 'indent', () => { for (const id of ids) scrollToTask(id); });
  };
  /** Dragging rows in the grid by their WBS cell (D2): before or after a row, or onto it to make it the parent. */
  const rowPointerDown = (e: React.PointerEvent, _i: number, id: string) => {
    if (e.button !== 0 || !(e.target as HTMLElement).closest('.gx-grip') || isGroupId(id)) return;
    const body = gridBodyRef.current; if (!body) return;
    const ids = selKeys.has(`row:${id}`) ? selectedTasks() : [id];
    const y0 = e.clientY;
    let started = false, ind: HTMLDivElement | null = null, target: { parent: string | null; index: number } | null = null;
    const done = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); ind?.remove(); body.classList.remove('gx-row-dragging'); };
    const mv = (ev: PointerEvent) => {
      if (!started) {
        if (Math.abs(ev.clientY - y0) < 5) return;
        if (!treeOrder) { say(m.reorderNeedsTree); done(); return; }
        const why = whyNotMove(ids); if (why) { say(why); done(); return; }
        started = true;
        ind = document.createElement('div'); ind.className = 'gx-drop-ind';
        body.firstElementChild!.appendChild(ind); body.classList.add('gx-row-dragging');
      }
      const y = ev.clientY - body.getBoundingClientRect().top + body.scrollTop;
      const rs = geom.current.rows; const k = rowAt(rs, y);
      const place = (cls: string, top: number, h?: number) => { ind!.className = `gx-drop-ind${cls}`; ind!.style.top = `${top}px`; ind!.style.height = h ? `${h}px` : ''; };
      if (k >= rs.length) { target = { parent: null, index: baseModel.children.get(null)?.length ?? 0 }; place('', totalHeight(rs)); return; }
      const r = rs[k]!; const t = baseModel.tasks.get(r.taskId);
      if (!t) { target = null; return; }
      const f = (y - r.top) / r.height;
      const sibs = baseModel.children.get(t.parent) ?? [];
      if (f < 0.3) { target = { parent: t.parent, index: sibs.indexOf(t.id) }; place('', r.top); }
      else if (f > 0.7) {
        target = r.hasChildren && r.expanded && !r.lane ? { parent: t.id, index: 0 } : { parent: t.parent, index: sibs.indexOf(t.id) + 1 };
        place('', r.top + r.height);
      } else if (t.type === 'milestone' || ids.includes(t.id)) { target = null; place(' gx-drop-none', r.top, r.height); }
      else { target = { parent: t.id, index: baseModel.children.get(t.id)?.length ?? 0 }; place(' gx-drop-into', r.top, r.height); }
    };
    const up = () => {
      done();
      if (!started || !target) return;
      const names = ids.map((x) => baseModel.tasks.get(x)?.name ?? x).join(', ');
      runTree(moveOps(baseModel, ids, target.parent, target.index), 'move', () => say(m.moved(names)));
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  actRef.current = { addBelow, rowPointerDown };
  /** Shift+drag on empty chart space selects every bar inside the rectangle (D14). */
  const startLasso = (e: React.PointerEvent) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const rect0 = canvas.getBoundingClientRect();
    const x0 = e.clientX - rect0.left, y0 = e.clientY - rect0.top;
    const box = document.createElement('div'); box.className = 'gx-lasso'; canvas.appendChild(box);
    let x1 = x0, y1 = y0;
    const mv = (ev: PointerEvent) => {
      const r = canvas.getBoundingClientRect(); x1 = ev.clientX - r.left; y1 = ev.clientY - r.top;
      Object.assign(box.style, { left: `${Math.min(x0, x1)}px`, top: `${Math.min(y0, y1)}px`, width: `${Math.abs(x1 - x0)}px`, height: `${Math.abs(y1 - y0)}px` });
    };
    const up = () => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); box.remove();
      const lx = Math.min(x0, x1), rx = Math.max(x0, x1), ty = Math.min(y0, y1), by = Math.max(y0, y1);
      if (rx - lx < 3 && by - ty < 3) return;
      const sc = geom.current.scale; const out: SelectionTarget[] = [];
      for (const [id, pos] of bars) {
        const p = model.placement.byId.get(id); if (!p?.scheduled || isGroupId(id)) continue;
        const x = xOf(sc, p.start!), w = (p.end! - p.start! + 1) * sc.pxPerDay;
        if (x < rx && x + w > lx && pos.y < by && pos.y + pos.h > ty) out.push(pos.row.lane ? { type: 'bar', taskId: id, bar: 'main' } : { type: 'row', taskId: id });
      }
      select(out); say(m.selectedBars(i18n.num(out.length)));
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };

  // Drawing a dependency with the keyboard (F9): L on the predecessor, then Enter on the successor.
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const startKeyboardLink = (id: string) => { setLinkFrom(id); say(m.linkStart(model.tasks.get(id)?.name ?? id)); };
  const finishKeyboardLink = (t: SelectionTarget) => {
    const src = linkFrom; setLinkFrom(null);
    if (!src || t.type === 'link') return;
    const why = whyNotLinkFor(src, t.taskId, 'FS');
    if (why) { say(why); return; }
    commit({ type: 'link.create', link: { id: newId('l'), source: src, target: t.taskId, type: 'FS' } });
    say(m.linkMade(model.tasks.get(src)?.name ?? src, model.tasks.get(t.taskId)?.name ?? t.taskId));
  };
  /** Shortcuts shared by the grid and the chart (F3). Returns true when handled. */
  const editKeys = (e: React.KeyboardEvent): boolean => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && e.key.toLowerCase() === 'z') { void (e.shiftKey ? props.history.redo() : props.history.undo()); return true; }
    if (mod && e.key.toLowerCase() === 'y') { void props.history.redo(); return true; }
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { shiftTasks(editTargets(), e.key === 'ArrowLeft' ? -1 : 1, e.shiftKey); return true; }
    if (e.key === 'Delete' || (e.key === 'Backspace' && mod)) { deleteSelection(); return true; }
    if (mod && !e.altKey && !e.shiftKey) {
      const k = e.key.toLowerCase();
      if (k === 'c') { copySel(false); return true; }
      if (k === 'x') { copySel(true); return true; }
      if (k === 'v') { pasteSel(); return true; }
      if (k === 'd') { duplicateSel(); return true; }
      if (e.key === ']') { indentSel(false); return true; }
      if (e.key === '[') { indentSel(true); return true; }
    }
    if (e.key === 'Insert') { const id = selectedTasks()[0]; if (id) addBelow(id); else addTask(null, baseModel.children.get(null)?.length ?? 0); return true; }
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      const r = rows[focus.row]; const el = gridBodyRef.current?.querySelector<HTMLElement>(`[data-row="${focus.row}"]`);
      if (r) { const b = el?.getBoundingClientRect(); openMenu(b ? b.left + 40 : 100, b ? b.bottom : 100, targetFor(r, focus.bar)); }
      return true;
    }
    return false;
  };

  // Context menu (D8).
  const [menu, setMenu] = useState<{ x: number; y: number; target: SelectionTarget } | null>(null);
  const openMenu = (x: number, y: number, target: SelectionTarget) => {
    if (!selKeys.has(targetKey(target))) select([target]);
    setMenu({ x, y, target });
  };
  const menuItems = (t: SelectionTarget): MenuItem[] => {
    if (t.type === 'link') {
      const l = data.links.find((x) => x.id === t.linkId); if (!l) return [];
      const why = props.readOnly ? (typeof props.readOnly === 'string' ? props.readOnly : m.readOnly)
        : props.evaluator && !props.evaluator.can('link.modify', { project: data.roadmap.id }) ? 'Missing permission: link.modify' : null;
      const whyDel = props.readOnly ? why : props.evaluator && !props.evaluator.can('link.delete', { project: data.roadmap.id }) ? 'Missing permission: link.delete' : null;
      return [
        ...(['FS', 'SS', 'FF', 'SF'] as const).map((ty) => ({ label: m.linkType[ty], checked: l.type === ty, why, run: () => commit({ type: 'link.update', id: l.id, fields: { type: ty } }) })),
        { separator: true, label: '' },
        { label: m.deleteDependency, shortcut: 'Del', why: whyDel, run: () => commit({ type: 'link.delete', id: l.id }) },
      ];
    }
    const id = t.taskId;
    if (isGroupId(id)) return [];
    const isSum = (model.children.get(id)?.length ?? 0) > 0;
    const whyCreate = whyNotCreate('');
    const whyMoveIt = whyNotMove([id]);
    const name = model.tasks.get(id)?.name ?? id;
    return [
      { label: m.editDetails, shortcut: 'F6', run: () => rootRef.current?.querySelector<HTMLElement>('.gx-details input, .gx-details button')?.focus() },
      { label: m.moveEarlier, shortcut: 'Alt+←', why: isSum ? m.derivedDates : whyNotEdit(id, 'start'), run: () => shiftTasks([id], -1, false) },
      { label: m.moveLater, shortcut: 'Alt+→', why: isSum ? m.derivedDates : whyNotEdit(id, 'start'), run: () => shiftTasks([id], 1, false) },
      { label: m.linkFromHere, shortcut: 'L', why: whyNotLinkFor(id, id, 'FS') === 'A task cannot depend on itself' ? null : whyNotLinkFor(id, id, 'FS'), run: () => startKeyboardLink(id) },
      { separator: true, label: '' },
      { label: m.addBelow(name), shortcut: 'Insert', why: whyCreate, run: () => addBelow(id) },
      { label: m.addChild, why: whyCreate ?? (model.tasks.get(id)?.type === 'milestone' ? 'A milestone cannot contain tasks' : null), run: () => addChild(id) },
      { label: m.cut, shortcut: 'Ctrl+X', why: whyMoveIt, run: () => copySel(true) },
      { label: m.copy, shortcut: 'Ctrl+C', run: () => copySel(false) },
      { label: m.paste, shortcut: 'Ctrl+V', why: clip.current ? null : m.nothingToPaste, run: pasteSel },
      { label: m.duplicate, shortcut: 'Ctrl+D', why: whyCreate, run: duplicateSel },
      { label: m.indent, shortcut: 'Ctrl+]', why: whyMoveIt, run: () => indentSel(false) },
      { label: m.outdent, shortcut: 'Ctrl+[', why: whyMoveIt, run: () => indentSel(true) },
      { separator: true, label: '' },
      { label: m.undo, shortcut: 'Ctrl+Z', why: props.history.canUndo ? null : m.nothingToUndo, run: () => void props.history.undo() },
      { label: m.redo, shortcut: 'Ctrl+Y', why: props.history.canRedo ? null : m.nothingToRedo, run: () => void props.history.redo() },
      { separator: true, label: '' },
      { label: m.deleteTask, shortcut: 'Del', why: props.readOnly ? (typeof props.readOnly === 'string' ? props.readOnly : m.readOnly) : props.evaluator && !props.evaluator.can('task.delete', { project: data.roadmap.id }) ? 'Missing permission: task.delete' : null, run: () => commit({ type: 'task.delete', id }) },
    ];
  };

  // Dragging (D1, D6, D17).
  const justDragged = useRef(false);
  const drag = useMemo(() => new DragController({
    get chart() { return chartRef.current!; },
    get canvas() { return canvasRef.current!; },
    scale: () => geom.current.scale,
    calendar: () => modelRef.current.placement.calendar,
    task: (id) => { const p = modelRef.current.placement.byId.get(id); return p && { task: p.task, start: p.start, end: p.end, duration: p.duration, progress: p.progress }; },
    whyNot: (id, f) => editRef.current.whyNotEdit(id, f),
    whyNotLink: (a, b, ty) => whyNotLinkRef.current(a, b, ty),
    laneAt: (clientY) => {
      const top = canvasRef.current!.getBoundingClientRect().top;
      const r = geom.current.rows[rowAt(geom.current.rows, clientY - top)];
      return r?.lane ? r.taskId : null;
    },
    commit: (op) => commitRef.current(op),
    preview: async (id, fields) => {
      const r = applyDataOperation(dataRef.current, { type: 'task.update', id, fields });
      if ('error' in r) return new Map();
      const s = await scheduleOffThread(r.doc);
      return new Map([...s.result.tasks].map(([k, v]) => [k, { start: v.start, end: v.end }]));
    },
    tip: (x, y, text) => apiRef.current.tip(x, y, text),
    announce: (text) => sayRef.current(text),
    newId: () => newId(),
    describe: (s, e, kind) => {
      const cal = modelRef.current.placement.calendar, i = i18nRef.current;
      return `${kind === 'create' ? i.t.newTask + ': ' : ''}${fmtDate(s, i.locale)} – ${fmtDate(e, i.locale)} · ${i.t.tipWorkingDays(i.num(cal.workingDaysBetween(s, e)))}`;
    },
  }), [newId]);
  const whyNotLinkRef = useRef(whyNotLinkFor); whyNotLinkRef.current = whyNotLinkFor;
  const commitRef = useRef(commit); commitRef.current = commit;
  const sayRef = useRef(say); sayRef.current = say;
  const longPress = useRef(0);
  const onCanvasPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const el = e.target as HTMLElement;
    const handle = el.closest<HTMLElement>('[data-drag]');
    const bar = el.closest<HTMLElement>('.gx-bar[data-task]');
    // Long press opens the menu on touch (F10).
    if (e.pointerType === 'touch' && (bar || el.closest('.gx-link-hit'))) {
      const x = e.clientX, y = e.clientY;
      clearTimeout(longPress.current);
      longPress.current = window.setTimeout(() => {
        if (drag.active) drag.end(true);
        const id = bar?.dataset.task;
        if (id) openMenu(x, y, { type: 'row', taskId: id });
      }, 550);
    }
    if (bar && e.shiftKey && !bar.classList.contains('gx-summary')) return; // Shift+click adds to the selection
    if (bar && !bar.classList.contains('gx-summary')) {
      const kind = (handle?.dataset.drag ?? 'move') as DragKind;
      if (kind === 'move' && whyNotEdit(bar.dataset.task!, 'start')) return; // a click, not a drag
      if (drag.begin(e, kind, bar.dataset.task!, bar)) { e.preventDefault(); chartRef.current?.focus({ preventScroll: true }); return; }
      return;
    }
    if (el.closest('.gx-link-hit')) return;
    const laneBg = el.closest<HTMLElement>('.gx-rowbg.gx-lane[data-task]');
    if (e.shiftKey) { e.preventDefault(); startLasso(e); return; }
    if (laneBg && !isGroupId(laneBg.dataset.task!) && !whyNotCreate(laneBg.dataset.task!) && drag.begin(e, 'create', laneBg.dataset.task!, null)) { e.preventDefault(); chartRef.current?.focus({ preventScroll: true }); return; }
    const c = chartRef.current!; pan.current = { x: e.clientX, y: e.clientY, l: c.scrollLeft, t: c.scrollTop, moved: false };
  };
  const whyNotCreate = (parent: string) => {
    const ro = props.readOnly; if (ro) return typeof ro === 'string' ? ro : m.readOnly;
    return props.evaluator && !props.evaluator.can('task.create', { project: data.roadmap.id }) ? 'Missing permission: task.create' : null;
    void parent;
  };

  const openMenuRef = useRef(openMenu); openMenuRef.current = openMenu;
  const targetFor = (r: RowLayout, bar: number): SelectionTarget =>
    r.lane && bar >= 0 ? { type: 'bar', taskId: r.bars[bar]!.taskId, bar: 'main' } : { type: 'row', taskId: r.taskId };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editKeys(e)) { e.preventDefault(); return; }
    const r = rows[focus.row]; if (!r) return;
    const move = (row: number, bar = -1) => { const i = Math.max(0, Math.min(rows.length - 1, row)); setFocus({ row: i, bar }); ensureVisible(i); };
    switch (e.key) {
      case 'ArrowDown': move(focus.row + 1); break;
      case 'ArrowUp': move(focus.row - 1); break;
      case 'Home': move(0); break;
      case 'End': move(rows.length - 1); break;
      case 'PageDown': move(rowAt(rows, r.top + view.h)); break;
      case 'PageUp': move(rowAt(rows, Math.max(0, r.top - view.h))); break;
      case 'ArrowRight':
        if (r.lane && focus.bar < r.bars.length - 1) setFocus({ row: focus.row, bar: focus.bar + 1 });
        else if (r.hasChildren && !r.lane && !r.expanded) toggle(r.taskId);
        else if (r.hasChildren && !r.lane) move(focus.row + 1);
        break;
      case 'ArrowLeft':
        if (r.lane && focus.bar >= 0) setFocus({ row: focus.row, bar: focus.bar - 1 });
        else if (r.hasChildren && r.expanded && !r.lane) toggle(r.taskId);
        else { const p = model.tasks.get(r.taskId)?.parent; const pi = p ? rowIndexOf.get(p) : undefined; if (pi !== undefined) move(pi); }
        break;
      case ' ': doSelect(targetFor(r, focus.bar), e.ctrlKey || e.metaKey || e.shiftKey); break;
      case 'Enter':
        if (linkFrom) { finishKeyboardLink(targetFor(r, focus.bar)); break; }
        if (r.lane) toggleLane(r.taskId); else doSelect(targetFor(r, focus.bar), false); break;
      case 'Escape': if (linkFrom) { setLinkFrom(null); setNotice(m.linkCancelled); break; } select([]); setAnnounce(m.selectionCleared); break;
      case 'l': case 'L': { const t = targetFor(r, focus.bar); if (t.type !== 'link') startKeyboardLink(t.taskId); break; }
      case '+': case '=': setZoom(levels[Math.min(levels.length - 1, levels.indexOf(level) + 1)]!.id); break;
      case '-': setZoom(levels[Math.max(0, levels.indexOf(level) - 1)]!.id); break;
      case 't': scrollToToday(); break;
      case 'F6': { // move focus to the details panel (and back with F6 there)
        const panel = rootRef.current?.querySelector<HTMLElement>('.gx-details');
        const first = panel?.querySelector<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])');
        (first ?? panel)?.focus();
        break;
      }
      default: return;
    }
    e.preventDefault();
  };
  useEffect(() => { // keep DOM focus on the focused row when it is rendered
    const el = gridBodyRef.current?.querySelector<HTMLElement>(`[data-row="${focus.row}"]`);
    const active = document.activeElement;
    // Not while the user types in the grid (inline name editor, quick entry).
    if (el && gridBodyRef.current?.contains(active) && !(active instanceof HTMLInputElement)) el.focus({ preventScroll: true });
  }, [focus, view.b0, view.b1]);

  // Panes (F4).
  const [gridW, setGridW] = useState(400);
  const [gridHidden, setGridHidden] = useState(false);
  const startSplit = (e: React.PointerEvent) => {
    const x0 = e.clientX, w0 = gridW;
    const mv = (ev: PointerEvent) => setGridW(Math.max(GRID_MIN, Math.min(900, w0 + ev.clientX - x0)));
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };

  const detailsSelect = useCallback((t: SelectionTarget) => {
    select([t]);
    const m = selRef.current.model;
    const id = t.type === 'link' ? linkById.get(t.linkId)?.source : t.taskId;
    const i = id ? rowIndexOf.get(id) ?? rowIndexOf.get(m.tasks.get(id)?.parent ?? '') : undefined;
    if (i !== undefined) ensureVisible(i);
  }, [select, linkById, rowIndexOf, ensureVisible]);

  // ---------- View tools (D9–D11, D18, D19, F12) ----------
  const [findOpen, setFindOpen] = useState(false);
  const [found, setFound] = useState<{ ids: string[]; i: number }>({ ids: [], i: -1 });
  const findInput = useRef<HTMLInputElement>(null);
  const openFind = () => { setFindOpen(true); requestAnimationFrame(() => findInput.current?.focus()); };
  const goFound = (ids: string[], i: number) => { const id = ids[i]; if (!id) return; select([{ type: 'row', taskId: id }]); scrollToTask(id); };
  const [pop, setPop] = useState<{ kind: 'columns' | 'filter'; x: number; y: number; col?: GridColumn } | null>(null);
  const [colMenu, setColMenu] = useState<{ col: GridColumn; x: number; y: number } | null>(null);
  const setColumns = (next: GridColumn[], fr = frozen) => setVs({ ...vs, columns: columnState(allCols, next), frozen: fr });
  const onSort = (c: GridColumn) => {
    if (!c.field) return;
    const cur = vs.sort?.field === c.field ? vs.sort.dir : undefined;
    setVs({ ...vs, sort: cur === 'asc' ? { field: c.field, dir: 'desc' } : cur === 'desc' ? undefined : { field: c.field, dir: 'asc' } });
  };
  const colMenuItems = (c: GridColumn): MenuItem[] => {
    const i = cols.findIndex((x) => x.id === c.id);
    const sortedHere = vs.sort?.field === c.field;
    const f = c.field;
    return [
      ...(f ? [
        { label: m.sortAsc, checked: sortedHere && vs.sort?.dir === 'asc', run: () => setVs({ ...vs, sort: { field: f, dir: 'asc' } }) },
        { label: m.sortDesc, checked: sortedHere && vs.sort?.dir === 'desc', run: () => setVs({ ...vs, sort: { field: f, dir: 'desc' } }) },
        { label: m.sortClear, why: vs.sort ? null : m.sortClear, run: () => setVs({ ...vs, sort: undefined }) },
        { separator: true, label: '' },
        { label: m.groupByCol, checked: vs.groupBy === f, run: () => setVs({ ...vs, groupBy: vs.groupBy === f ? undefined : f }) },
        { label: `${m.filterValues}…`, run: () => setPop({ kind: 'filter', x: colMenu?.x ?? 100, y: colMenu?.y ?? 100, col: c }) },
        { separator: true, label: '' },
      ] as MenuItem[] : []),
      { label: m.moveLeft, why: i <= 0 ? m.moveLeft : null, run: () => { const n = [...cols]; [n[i - 1], n[i]] = [n[i]!, n[i - 1]!]; setColumns(n); } },
      { label: m.moveRight, why: i >= cols.length - 2 ? m.moveRight : null, run: () => { const n = [...cols]; [n[i + 1], n[i]] = [n[i]!, n[i + 1]!]; setColumns(n); } },
      { label: m.freezeTo, checked: frozen === i + 1, run: () => setColumns(cols, frozen === i + 1 ? 0 : i + 1) },
      { label: m.hideColumn, why: c.id === 'name' ? m.colName : null, run: () => setColumns(cols.filter((x) => x.id !== c.id), Math.min(frozen, cols.length - 1)) },
    ];
  };
  const filterValuesOf = (field: string): { value: string; label: string }[] => {
    const seen = new Map<string, string>();
    for (const id of baseModel.tasks.keys()) {
      const v = fieldValue(baseModel, id, field);
      const k = v === undefined || v === null ? '' : String(v);
      if (!seen.has(k)) seen.set(k, k === '' ? '' : field === 'start' || field === 'end' ? fmtDate(Number(k), locale) : field === 'progress' ? i18n.pct(Number(k)) : k);
      if (seen.size >= 200) break;
    }
    return [...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.value === '' ? 1 : b.value === '' ? -1 : a.label.localeCompare(b.label, locale, { numeric: true }));
  };
  const [savedState, setSavedState] = useState<SavedView[]>([]);
  const saved = props.savedViews ?? savedState;
  const setSaved = (v: SavedView[]) => { setSavedState(v); props.onSavedViewsChanged?.(v); };
  const [viewId, setViewId] = useState<string | null>(null);
  const pickView = (id: string | null) => {
    setViewId(id);
    const v = id ? saved.find((x) => x.id === id)?.view : undefined;
    setVs(v ? { ...v } : {});
    if (v?.zoom && v.zoom !== zoom) setZoom(v.zoom);
  };
  const saveView = (name: string) => {
    const id = newId('v');
    setSaved([...saved, { id, name, view: { ...vs, columns: columnState(allCols, cols), frozen, zoom } }]);
    setViewId(id);
  };
  const deleteView = (id: string) => { setSaved(saved.filter((v) => v.id !== id)); setViewId(null); };
  const matchCount = shown.matches ? [...shown.matches].filter((id) => baseModel.tasks.has(id)).length : 0;
  const filterActive = !!shown.matches;
  const gridHeadRef = useRef<HTMLDivElement>(null);
  const hscrollRef = useRef<HTMLDivElement>(null);
  const gw = gridWidth(cols);
  const [gridOnCompact, setGridOnCompact] = useState(false);
  const gridOff = compact ? !gridOnCompact : gridHidden;

  const Toolbar = props.toolbar === false ? null : props.toolbar ?? DefaultToolbar;
  const themeAttr = props.theme ? { 'data-theme': props.theme } : {};
  const visibleBlocks = blocks.slice(view.b0, view.b1);
  // The chart side (bars, links, ticks) shows only the on-screen part while settling after a zoom.
  const chartBlocks = settling ? blocks.slice(view.v0, view.v1) : visibleBlocks;
  // The drawn window. Full-height layers (links, gridlines, shading, markers) are sized to it, not to the
  // whole canvas: with 10,000 rows the canvas is hundreds of thousands of pixels tall, and a layer that
  // size makes every zoom an expensive relayout and repaint.
  const firstRow = chartBlocks[0]?.rows[0];
  const lastBlock = chartBlocks[chartBlocks.length - 1];
  const win = { y: firstRow?.top ?? 0, h: lastBlock ? totalHeight(lastBlock.rows) - (firstRow?.top ?? 0) : 0 };
  const dayFrom = origin + (settling ? view.t0 : view.c0) * DAY_CHUNK, dayTo = origin + (settling ? view.t1 : view.c1) * DAY_CHUNK;
  const markers = useMemo(() => [{ day: todayDay, label: m.todayMarker, today: true }, ...(props.markers ?? []).map((m) => ({ day: dayOfIso(m.date), label: m.label, today: false }))], [todayDay, props.markers, m]);
  const H = totalHeight(rows);
  // Links are bucketed by the block of their upper end; links spanning more than two blocks are drawn separately.
  const linkBuckets = useMemo(() => {
    const byBlock: Link[][] = blocks.map(() => []);
    const long: { l: Link; b0: number; b1: number }[] = [];
    for (const l of data.links) {
      const a = rowIndexOf.get(bars.get(l.source)?.row.taskId ?? ''), b = rowIndexOf.get(bars.get(l.target)?.row.taskId ?? '');
      if (a === undefined || b === undefined) continue;
      const b0 = Math.floor(Math.min(a, b) / BLOCK), b1 = Math.floor(Math.max(a, b) / BLOCK);
      if (b1 - b0 > 1) long.push({ l, b0, b1 }); else byBlock[b0]!.push(l);
    }
    return { byBlock, long };
  }, [blocks, data.links, bars, rowIndexOf]);
  const lb0 = settling ? view.v0 : view.b0, lb1 = settling ? view.v1 : view.b1;
  const longVisible = useMemo(() => linkBuckets.long.filter((x) => x.b1 >= lb0 && x.b0 < lb1).map((x) => x.l), [linkBuckets, lb0, lb1]);

  if (data.tasks.length === 0) {
    return <div className="gx-root" {...themeAttr} style={{ height }}>{props.emptyState ?? <div className="gx-empty">{m.empty}</div>}</div>;
  }

  return (
    <I18nContext.Provider value={i18n}>
    <div ref={rootRef} className={`gx-root gx-details-${compact ? 'sheet' : detailsPanel || 'none'}${compact ? ' gx-compact' : ''}`} {...themeAttr} style={{ height }}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'f') { e.preventDefault(); openFind(); return; }
        if (e.key !== 'F6' || !(e.target as HTMLElement).closest('.gx-details')) return;
        e.preventDefault();
        gridBodyRef.current?.querySelector<HTMLElement>('[role="row"][tabindex="0"]')?.focus();
      }}>
      {props.header}
      {Toolbar && (
        <div className="gx-toolbar-row">
          <Toolbar zoom={zoom} levels={levels} setZoom={(z) => setZoom(z)} scrollToToday={scrollToToday} fit={fit}
            critical={showCritical} setCritical={setShowCritical} runSchedule={runSchedule} scheduleWhyNot={scheduleWhyNot} />
          <button className="gx-btn" aria-disabled={!props.history.canUndo || undefined} title={props.history.canUndo ? `${m.undo} (Ctrl+Z)` : m.nothingToUndo} onClick={() => void props.history.undo()}>{m.undo}</button>
          <button className="gx-btn" aria-disabled={!props.history.canRedo || undefined} title={props.history.canRedo ? `${m.redo} (Ctrl+Y)` : m.nothingToRedo} onClick={() => void props.history.redo()}>{m.redo}</button>
          {(scheduleNote || notice) && <span className="gx-muted gx-notice" role="status">{notice || scheduleNote}</span>}
          {linkFrom && <span className="gx-chip gx-link-mode">{m.linkModeHint}</span>}
          <input className="gx-input gx-filter" type="search" aria-label={m.filterLabel} placeholder={m.filterLabel} value={vs.filter?.text ?? ''}
            onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => setVs({ ...vs, filter: { ...vs.filter, text: e.target.value } })} />
          {findOpen
            ? <FindBar inputRef={findInput} count={found.ids.length} index={found.i}
                onQuery={(q) => { const ids = findTasks(baseModel, q); setFound({ ids, i: ids.length ? 0 : -1 }); goFound(ids, 0); }}
                onStep={(d) => { const n = found.ids.length; if (!n) return; const i = (found.i + d + n) % n; setFound({ ids: found.ids, i }); goFound(found.ids, i); }}
                onClose={() => { setFindOpen(false); setFound({ ids: [], i: -1 }); }} />
            : <button className="gx-btn" title={`${m.find} (Ctrl+F)`} onClick={openFind}>{m.find}</button>}
          <button className="gx-btn" aria-haspopup="dialog" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPop({ kind: 'columns', x: r.left, y: r.bottom + 4 }); }}>{m.columns}</button>
          <ViewPicker views={saved} current={viewId} onPick={pickView} onSave={saveView} onDelete={deleteView} />
          {vs.sort && <span className="gx-chip">{m.sortedBy(fieldLabel(vs.sort.field), vs.sort.dir)}<button className="gx-chip-x" aria-label={m.sortClear} onClick={() => setVs({ ...vs, sort: undefined })}>×</button></span>}
          {vs.groupBy && <span className="gx-chip">{m.groupedBy(fieldLabel(vs.groupBy))}
            <label className="gx-chip-opt"><input type="checkbox" checked={!!vs.groupLanes} onChange={(e) => setVs({ ...vs, groupLanes: e.target.checked || undefined })} /> {m.groupLanes}</label>
            <button className="gx-chip-x" aria-label={m.ungroup} onClick={() => setVs({ ...vs, groupBy: undefined, groupLanes: undefined })}>×</button></span>}
          {filterActive && <span className="gx-chip" role="status">{m.filtered(i18n.num(matchCount), i18n.num(baseModel.tasks.size))}<button className="gx-chip-x" aria-label={m.filterClear} onClick={() => setVs({ ...vs, filter: undefined })}>×</button></span>}
          <button className="gx-btn" aria-pressed={compact} onClick={() => setVs({ ...vs, compact: !compact || undefined })}>{m.compact}</button>
          <button className="gx-btn" onClick={() => compact ? setGridOnCompact((v) => !v) : setGridHidden((h) => !h)} aria-pressed={!gridOff}>{gridOff ? m.showGrid : m.hideGrid}</button>
          {props.saveState && <SaveIndicator state={props.saveState} />}
        </div>
      )}
      <div className="gx-main">
        <div className="gx-panes">
          {!gridOff && (
            <div className="gx-grid" style={{ width: compact ? Math.min(gridW, 240) : gridW }}>
              <div className="gx-grid-inner" role="treegrid" aria-label={data.roadmap.name} aria-rowcount={rows.length + 2} aria-multiselectable="true"
                style={{ ['--gx-cols' as string]: gridTemplate(cols) }}>
              <div className="gx-grid-headwrap" ref={gridHeadRef}>
                <div className="gx-grid-head" role="row" aria-rowindex={1} style={{ minWidth: gw }}>
                  <GridHeader cols={cols} frozen={frozen} sort={vs.sort} onSort={onSort}
                    onResize={(id, w) => setColumns(cols.map((c) => (c.id === id ? { ...c, width: w } : c)))}
                    onReorder={(id, before) => { const c = cols.find((x) => x.id === id)!; const rest = cols.filter((x) => x.id !== id); const at = before ? rest.findIndex((x) => x.id === before) : rest.length; rest.splice(at < 0 ? rest.length : at, 0, c); setColumns(rest); }}
                    onMenu={(col, x, y) => setColMenu({ col, x, y })} />
                </div>
              </div>
              <div className="gx-grid-body" ref={gridBodyRef} role="rowgroup" onKeyDown={onKeyDown}
                onWheel={(e) => {
                  if ((e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) && hscrollRef.current) { hscrollRef.current.scrollLeft += e.deltaX || e.deltaY; return; }
                  if (chartRef.current) chartRef.current.scrollTop += e.deltaY;
                }}>
                <div style={{ height: H + sizes.row, position: 'relative', minWidth: gw }}>
                  {visibleBlocks.map((b) => <GridBlock key={b.index} block={b} ctx={ctx} api={api}
                    focusRow={focus.row >= b.start && focus.row < b.start + BLOCK ? focus.row : -1} />)}
                  <PlaceholderRow top={H} height={sizes.row} rowIndex={rows.length + 2} why={whyNotCreate('')} onAdd={addFromPlaceholder} />
                </div>
              </div>
              {gw > (compact ? Math.min(gridW, 240) : gridW) && (
                <div className="gx-grid-hscroll" ref={hscrollRef}
                  onScroll={(e) => { const l = e.currentTarget.scrollLeft; if (gridHeadRef.current) gridHeadRef.current.scrollLeft = l; if (gridBodyRef.current) gridBodyRef.current.scrollLeft = l; }}>
                  <div style={{ width: gw, height: 1 }} />
                </div>
              )}
              </div>
              <div className="gx-splitter" role="separator" aria-orientation="vertical" aria-label={m.resizeGrid} tabIndex={0}
                aria-valuenow={gridW} aria-valuemin={GRID_MIN} aria-valuemax={900}
                onPointerDown={startSplit}
                onKeyDown={(e) => { if (e.key === 'ArrowLeft') setGridW((w) => Math.max(GRID_MIN, w - 20)); if (e.key === 'ArrowRight') setGridW((w) => Math.min(900, w + 20)); }} />
            </div>
          )}

          <div className="gx-chart-wrap">
            <div className="gx-scale" ref={headerRef} aria-hidden>
              <div ref={headerInnerRef} style={{ width: chartWidth, position: 'relative', height: '100%' }}>
                <ScaleLayer scale={scale} major={level.major} minor={level.minor} from={dayFrom} to={dayTo} locale={locale} />
              </div>
            </div>
            <div className="gx-chart" ref={chartRef} onScroll={onScroll} tabIndex={0} role="region" aria-label={m.timeline}
              onPointerDown={onCanvasPointerDown}
              onPointerMove={(e) => {
                if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) clearTimeout(longPress.current);
                if (drag.active) { drag.move(e); return; }
                const p = pan.current; if (!p) return; const dx = e.clientX - p.x, dy = e.clientY - p.y; if (Math.abs(dx) + Math.abs(dy) > 4) p.moved = true; if (p.moved) { chartRef.current!.scrollLeft = p.l - dx; chartRef.current!.scrollTop = p.t - dy; }
              }}
              onPointerUp={() => {
                clearTimeout(longPress.current);
                if (drag.active) { if (drag.end()) justDragged.current = true; return; }
                const p = pan.current; pan.current = null; if (p && !p.moved) select([]);
              }}
              onPointerCancel={() => { clearTimeout(longPress.current); if (drag.active) drag.end(true); pan.current = null; }}
              onClickCapture={(e) => { if (justDragged.current) { justDragged.current = false; e.stopPropagation(); e.preventDefault(); } }}
              onContextMenu={(e) => {
                const el = e.target as HTMLElement;
                const bar = el.closest<HTMLElement>('.gx-bar[data-task]');
                const link = el.closest<SVGElement>('[data-link]');
                if (bar) { e.preventDefault(); openMenu(e.clientX, e.clientY, { type: 'row', taskId: bar.dataset.task! }); }
                else if (link) { e.preventDefault(); openMenu(e.clientX, e.clientY, { type: 'link', linkId: link.dataset.link! }); }
              }}
              onKeyDown={(e) => { if (editKeys(e)) e.preventDefault(); }}
              onPointerLeave={() => { if (!drag.active) pan.current = null; }}>
              <div className="gx-canvas" ref={canvasRef} style={{ width: chartWidth, height: H + sizes.row }}>
                <div className="gx-window" style={{ top: win.y, height: win.h }}>
                  <BackgroundLayer scale={scale} minor={level.minor} from={dayFrom} to={dayTo} model={model} shade={props.highlightNonWorking !== false} />
                  {markers.map((m) => <div key={m.label + m.day} className={`gx-marker${m.today ? ' gx-today' : ''}`} style={{ left: xOf(scale, m.day) }}><span>{m.label}</span></div>)}
                </div>
                {chartBlocks.map((b) => <RowBgBlock key={'bg' + b.index} block={b} selKeys={selKeys} />)}
                <svg className="gx-links" aria-hidden
                  style={{ left: Math.max(0, xOf(scale, dayFrom)), top: win.y }}
                  width={Math.max(1, Math.min(chartWidth, xOf(scale, dayTo)) - Math.max(0, xOf(scale, dayFrom)))} height={Math.max(1, win.h)}
                  viewBox={`${Math.max(0, xOf(scale, dayFrom))} ${win.y} ${Math.max(1, Math.min(chartWidth, xOf(scale, dayTo)) - Math.max(0, xOf(scale, dayFrom)))} ${Math.max(1, win.h)}`}>
                  <defs>
                    <marker id="gx-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                      <path d="M0,0 L8,4 L0,8 z" className="gx-arrowhead" />
                    </marker>
                  </defs>
                  {chartBlocks.map((b) => <LinkGroup key={'l' + b.index} links={linkBuckets.byBlock[b.index]} model={model} bars={bars} scale={scale} selKeys={selKeys} api={api} critical={criticalLinks} />)}
                  <LinkGroup links={longVisible} model={model} bars={bars} scale={scale} selKeys={selKeys} api={api} critical={criticalLinks} />
                </svg>
                {chartBlocks.map((b) => <BarBlock key={'b' + b.index} block={b} ctx={ctx} api={api} scale={scale} bars={bars}
                  focus={focus.row >= b.start && focus.row < b.start + BLOCK ? focus : null} />)}
              </div>
            </div>
          </div>
        </div>
        {detailsPanel && (!compact || selection.length > 0) && (() => {
          const panel = <DetailsPanel model={model} selection={selection} kinds={kinds} select={detailsSelect} visibleIds={rowIndexOf} barIds={bars} i18n={i18n}
            whyNotEdit={whyNotEdit} edit={editTask} compare={compare ? { base: props.compareWith!, placement: compare.base } : undefined} analysis={analysis}
            whyNotLinkEdit={whyNotLinkEdit} editLink={editLink} editMany={editMany} />;
          // On a small screen (F5) the panel is a sheet over the chart, closed by clearing the selection.
          return compact ? <div className="gx-sheet"><button className="gx-btn gx-small gx-sheet-close" aria-label={m.closePanel} onClick={() => select([])}>×</button>{panel}</div> : panel;
        })()}
      </div>
      <Tooltip setterRef={tipRef} />
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.target)} label={m.menu} onClose={() => setMenu(null)} />}
      {colMenu && <ContextMenu x={colMenu.x} y={colMenu.y} items={colMenuItems(colMenu.col)} label={m.columnMenu(colMenu.col.label)} onClose={() => setColMenu(null)} />}
      {pop?.kind === 'columns' && <Popover x={pop.x} y={pop.y} label={m.columns} onClose={() => setPop(null)}>
        <ColumnsPanel all={allCols} shown={cols} frozen={frozen} onChange={(n, fr) => setColumns(n, fr)} />
      </Popover>}
      {pop?.kind === 'filter' && pop.col?.field && <Popover x={pop.x} y={pop.y} label={`${m.filterValues}: ${pop.col.label}`} onClose={() => setPop(null)}>
        <FilterValues label={pop.col.label} values={filterValuesOf(pop.col.field)} selected={vs.filter?.fields?.[pop.col.field] ?? []}
          onChange={(v) => { const f = pop.col!.field!; setVs({ ...vs, filter: { ...vs.filter, fields: { ...vs.filter?.fields, [f]: v } } }); }} />
      </Popover>}
      <div className="gx-sr" aria-live="polite">{announce}</div>
    </div>
    </I18nContext.Provider>
  );
}

// ---------- memoised layers ----------

const RowBgBlock = memo(function RowBgBlock({ block, selKeys }: { block: Block; selKeys: ReadonlySet<string> }) {
  return <>{block.rows.map((r) => {
    const sel = selKeys.has(`row:${r.taskId}`) || (!r.lane && selKeys.has(`bar:${r.taskId}`));
    return <div key={r.taskId} data-task={r.lane ? r.taskId : undefined} className={`gx-rowbg${sel ? ' gx-sel' : ''}${r.lane ? ' gx-lane' : ''}`} style={{ top: r.top, height: r.height }} />;
  })}</>;
});

const BarBlock = memo(function BarBlock({ block, ctx, api, scale, bars, focus }:
  { block: Block; ctx: Ctx; api: Api; scale: Scale; bars: ReturnType<typeof barIndex>; focus: { row: number; bar: number } | null }) {
  const { model, selKeys, linkMarked, compare, critical } = ctx;
  const i18n = useI18n();
  return <>{block.rows.flatMap((r, k) => r.bars.map((b, bi) => {
    const p = model.placement.byId.get(b.taskId)!;
    if (!p.scheduled) return null;
    const pos = bars.get(b.taskId)!;
    const t = p.task;
    const x = xOf(scale, p.start!), w = Math.max(2, (p.end! - p.start! + 1) * scale.pxPerDay);
    const key = r.lane ? `bar:${t.id}` : `row:${r.taskId}`;
    const sel = selKeys.has(key) || selKeys.has(`bar:${t.id}`);
    const isSummary = t.type === 'summary' || (!r.lane && (model.children.get(t.id)?.length ?? 0) > 0);
    const row = block.start + k;
    const focused = !!focus && focus.row === row && (r.lane ? bi === focus.bar : focus.bar < 0);
    const cls = `gx-bar gx-${t.type === 'milestone' ? 'milestone' : isSummary ? 'summary' : 'task'}${sel ? ' gx-sel' : ''}${linkMarked.has(t.id) ? ' gx-marked' : ''}${focused ? ' gx-focus' : ''}${t.kind ? ` gx-kind-${cssId(t.kind)}` : ''}${critical?.has(t.id) ? ' gx-critical' : ''}${ctx.matches && !ctx.matches.has(t.id) && !isGroupId(t.id) ? ' gx-context' : ''}`;
    const onClick = (e: React.MouseEvent) => { e.stopPropagation(); api.focus(row, r.lane ? bi : -1); api.select(r.lane ? { type: 'bar', taskId: t.id, bar: 'main' } : { type: 'row', taskId: t.id }, e.ctrlKey || e.metaKey || e.shiftKey); };
    // While a button is held a drag owns the tooltip. A host template may wrap the default content (G7).
    const Tip = ctx.tooltipTemplate;
    const tipOn = (e: React.PointerEvent) => e.buttons ? undefined : api.tip(e.clientX, e.clientY, Tip ? <Tip task={t} placed={p} Default={taskTip(t, model, i18n)} /> : taskTip(t, model, i18n));
    const tipOff = (e: React.PointerEvent) => e.buttons ? undefined : api.tip(0, 0, null);
    if (t.type === 'milestone') {
      const s = pos.h;
      return <div key={t.id} data-task={t.id} className={cls} style={{ left: x + scale.pxPerDay / 2 - s / 2, top: pos.y, width: s, height: s }} onClick={onClick} onPointerMove={tipOn} onPointerLeave={tipOff}>
        <div className="gx-diamond" /><span className="gx-bar-label gx-outside">{t.name}</span>
        <span className="gx-hl gx-hl-start" data-drag="link-start" aria-hidden /><span className="gx-hl gx-hl-end" data-drag="link-end" aria-hidden />
      </div>;
    }
    // Where Current has this task, when it differs (K4).
    const was = compare?.diff.get(t.id) === 'changed' ? compare.base.byId.get(t.id) : undefined;
    const ghost = was?.scheduled && (was.start !== p.start || was.end !== p.end)
      ? <div key={t.id + ':ghost'} className="gx-ghost" aria-hidden style={{ left: xOf(scale, was.start!), top: pos.y, width: Math.max(2, (was.end! - was.start! + 1) * scale.pxPerDay), height: pos.h }} />
      : null;
    return [ghost,
      <div key={t.id} data-task={t.id} className={`${cls}${compare?.diff.has(t.id) ? ' gx-diff' : ''}`} style={{ left: x, top: pos.y, width: w, height: pos.h }} onClick={onClick} onPointerMove={tipOn} onPointerLeave={tipOff}>
        {!isSummary && <div className="gx-progress" style={{ width: `${Math.round(p.progress * 100)}%` }} />}
        {ctx.barTemplate && !isGroupId(t.id) ? <ctx.barTemplate task={t} placed={p} /> : <span className={`gx-bar-label${w < 60 ? ' gx-outside' : ''}`}>{t.name}</span>}
        {!isSummary && <>
          <span className="gx-h gx-h-start" data-drag="start" aria-hidden />
          <span className="gx-h gx-h-end" data-drag="end" aria-hidden />
          <span className="gx-hp" data-drag="progress" aria-hidden style={{ left: `${Math.round(p.progress * 100)}%` }} />
        </>}
        <span className="gx-hl gx-hl-start" data-drag="link-start" aria-hidden /><span className="gx-hl gx-hl-end" data-drag="link-end" aria-hidden />
      </div>,
    ];
  }))}</>;
});

const LinkGroup = memo(function LinkGroup({ links, model, bars, scale, selKeys, api, critical }:
  { links: Link[] | undefined; model: Model; bars: ReturnType<typeof barIndex>; scale: Scale; selKeys: ReadonlySet<string>; api: Api; critical: ReadonlySet<string> | null }) {
  const i18n = useI18n();
  return <>{(links ?? []).map((l) => {
    const d = linkPath(l, model.placement, bars, scale);
    if (!d) return null;
    return (
      <g key={l.id} className={`gx-link${selKeys.has(`link:${l.id}`) ? ' gx-sel' : ''}${l.kind ? ` gx-kind-${cssId(l.kind)}` : ''}${critical?.has(l.id) ? ' gx-critical' : ''}`}>
        <path d={d} className="gx-link-line" markerEnd="url(#gx-arrow)" />
        <path d={d} className="gx-link-hit" data-link={l.id} onClick={(e) => { e.stopPropagation(); api.select({ type: 'link', linkId: l.id }, e.ctrlKey || e.metaKey); }}
          onPointerMove={(e) => api.tip(e.clientX, e.clientY, linkTip(l, model, i18n))} onPointerLeave={() => api.tip(0, 0, null)} />
      </g>
    );
  })}</>;
});

const ScaleLayer = memo(function ScaleLayer({ scale, major, minor, from, to, locale }: { scale: Scale; major: 'year' | 'quarter' | 'month'; minor: 'month' | 'week' | 'day'; from: number; to: number; locale?: string }) {
  return <>
    {ticks(scale, major, from, to, locale).map((t) => <div key={'M' + t.day} className="gx-tick gx-major" style={{ left: t.x, width: t.w }}><span>{t.label}</span></div>)}
    {ticks(scale, minor, from, to, locale).map((t) => <div key={'m' + t.day} className="gx-tick gx-minor" style={{ left: t.x, width: t.w }}><span>{t.label}</span></div>)}
  </>;
});

const BackgroundLayer = memo(function BackgroundLayer({ scale, minor, from, to, model, shade }: { scale: Scale; minor: 'month' | 'week' | 'day'; from: number; to: number; model: Model; shade: boolean }) {
  const out: ReactNode[] = [];
  const cal = model.placement.calendar;
  if (shade && scale.pxPerDay >= 8) {
    // Merge consecutive weekend days into one element; holidays get their own, so they can be told apart (G6).
    for (let d = from; d <= to; d++) {
      if (cal.isWorking(d)) continue;
      const holiday = cal.isHoliday(d);
      let e = d; while (e + 1 <= to && !cal.isWorking(e + 1) && cal.isHoliday(e + 1) === holiday) e++;
      out.push(<div key={'w' + d} className={holiday ? 'gx-nonwork gx-holiday' : 'gx-nonwork'} style={{ left: xOf(scale, d), width: (e - d + 1) * scale.pxPerDay }} />);
      d = e;
    }
  } else if (shade) {
    // Too narrow to shade days: mark holidays as thin lines.
    for (const h of cal.holidaysBetween(from, to)) out.push(<div key={'h' + h} className="gx-holiday-line" style={{ left: xOf(scale, h) }} />);
  }
  for (const t of ticks(scale, minor, from, to)) out.push(<div key={'g' + t.day} className="gx-gridline" style={{ left: t.x }} />);
  return <>{out}</>;
});

interface TipState { x: number; y: number; content: ReactNode }
function Tooltip({ setterRef }: { setterRef: React.RefObject<(s: TipState | null) => void> }) {
  const [tip, setTip] = useState<TipState | null>(null);
  setterRef.current = setTip;
  return tip ? <div className="gx-tooltip" role="tooltip" style={{ left: tip.x + 12, top: tip.y + 14 }}>{tip.content}</div> : null;
}

function DefaultToolbar({ zoom, levels, setZoom, scrollToToday, fit, critical, setCritical, runSchedule, scheduleWhyNot }: ToolbarProps) {
  const { t: m } = useI18n();
  return (
    <div className="gx-toolbar" role="toolbar" aria-label={m.toolbarLabel}>
      <div className="gx-seg" role="radiogroup" aria-label={m.zoomLabel}>
        {levels.map((z) => <button key={z.id} role="radio" aria-checked={z.id === zoom} className={`gx-btn${z.id === zoom ? ' gx-on' : ''}`} onClick={() => setZoom(z.id)}>{m.zoomLevel[z.id] ?? z.label}</button>)}
      </div>
      <button className="gx-btn" onClick={scrollToToday}>{m.today}</button>
      <button className="gx-btn" onClick={fit}>{m.fit}</button>
      <button className="gx-btn" aria-pressed={critical} onClick={() => setCritical(!critical)}>{m.criticalPath}</button>
      <button className="gx-btn" aria-disabled={!!scheduleWhyNot || undefined} title={scheduleWhyNot ?? m.scheduleHint}
        onClick={() => { if (!scheduleWhyNot) runSchedule(); }}>{m.schedule}{scheduleWhyNot && <span className="gx-sr">{scheduleWhyNot}</span>}</button>
    </div>
  );
}

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const cssId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '-');
function zoomAnchor(el: HTMLElement, sc: Scale, selection: SelectionTarget[], model: Model, today: number): { day: number; px: number } {
  const w = el.clientWidth;
  const onScreen = (day: number) => { const px = (day - sc.origin) * sc.pxPerDay - el.scrollLeft; return px >= 0 && px <= w ? px : null; };
  for (const t of [...selection].reverse()) {
    const id = t.type === 'link' ? model.doc.links.find((l) => l.id === t.linkId)?.target : t.taskId;
    const p = id ? model.placement.byId.get(id) : undefined;
    if (!p?.scheduled) continue;
    const px = onScreen(p.start!);
    if (px !== null) return { day: p.start!, px };
  }
  const px = onScreen(today);
  if (px !== null) return { day: today, px };
  return { day: (el.scrollLeft + w / 2) / sc.pxPerDay + sc.origin, px: w / 2 };
}
/** Today's date as YYYY-MM-DD in a time zone (falls back to UTC for an unknown zone). */
function todayIn(timeZone: string): string {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  catch { return new Date().toISOString().slice(0, 10); }
}
const dayOfIso = (iso: string) => Math.floor(Date.parse(iso + 'T00:00:00Z') / 86_400_000);
export { fmtDate };

function labelOf(t: SelectionTarget, mdl: Model, m: GanttMessages) {
  if (t.type === 'link') { const l = mdl.doc.links.find((x) => x.id === t.linkId); return l ? m.connectorName(mdl.tasks.get(l.source)?.name ?? l.source, mdl.tasks.get(l.target)?.name ?? l.target) : m.typeConnector; }
  return mdl.tasks.get(t.taskId)?.name ?? t.taskId;
}
function taskTip(t: Task, mdl: Model, { t: m, locale, num, pct }: I18n) {
  const p = mdl.placement.byId.get(t.id)!;
  return <><strong>{t.name}</strong><div>{fmtDate(p.start!, locale)} – {fmtDate(p.end!, locale)} · {m.tipWorkingDays(num(p.duration ?? 0))}</div>{t.type !== 'milestone' && <div>{m.tipComplete(pct(p.progress))}</div>}</>;
}
function linkTip(l: Link, mdl: Model, { t: m }: I18n) {
  return <><strong>{m.linkType[l.type]}{l.lag ? ` +${l.lag}` : ''}</strong><div>{m.linkSentence[l.type](mdl.tasks.get(l.source)?.name ?? l.source, mdl.tasks.get(l.target)?.name ?? l.target)}</div></>;
}
export { fromDay };
