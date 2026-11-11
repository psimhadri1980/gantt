import { Component, forwardRef, memo, startTransition, useImperativeHandle, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type ComponentType } from 'react';
import type { Link, RoadmapDocument, Task } from '@gantt/contract';
import {
  applyDataOperation, mergeChildren, barIndex, buildModel, OperationPipeline, formatDay, layoutRows, linkPath, rowAt, targetKey, ticks, totalHeight, xOf, ZOOM_LEVELS, DEFAULT_SIZES, type RowSizes, type ZoomLevel,
  type DataOperation, type GanttOperation, type Model, type OperationContext, type OperationHooks, type OperationResult,
  type RowLayout, type Scale, type SelectionTarget, type ViewOperation,
} from '@gantt/state';
import { fromDay, type DayNum } from '@gantt/engine';
import { placeOffThread } from './engineClient.ts';
import { DetailsPanel, type GanttKinds } from './Details.tsx';
import { I18nContext, makeI18n, mergeMessages, useI18n, type GanttMessages, type I18n } from './i18n.ts';
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
  /** Read-only mode (G9): every data operation is refused with a reason; viewing, selecting and zooming still work. */
  readOnly?: boolean;
  /** Override any visible text (G12). Dates and numbers follow `locale`. */
  messages?: Partial<GanttMessages>;
  /** Save indicator (F13), driven by the host that persists changes. Omit to hide it. */
  saveState?: { status: 'saving' | 'saved' | 'error'; reason?: string };
  /** Replaces the default error state. */
  errorState?: (e: { message: string; retry: () => void }) => ReactNode;
  /** Loads the children of a task marked `hasChildren: true` when it is first expanded (H2). */
  loadChildren?: (taskId: string) => Promise<{ tasks: Task[]; links?: Link[] }>;
}

/** Imperative handle (H3): `const ref = useRef<GanttHandle>(null); <Gantt ref={ref} … />`. */
export interface GanttHandle {
  run: (op: GanttOperation) => Promise<OperationResult>;
  getData: () => RoadmapDocument;
  getSelection: () => SelectionTarget[];
  scrollToTask: (id: string) => void;
  scrollToToday: () => void;
  fit: () => void;
}

interface ViewBridge {
  apply: (op: ViewOperation) => void;
  getSelection: () => SelectionTarget[];
  scrollToTask: (id: string) => void;
  scrollToToday: () => void;
  fit: () => void;
}

export interface ToolbarProps { zoom: string; levels: ZoomLevel[]; setZoom: (z: string) => void; scrollToToday: () => void; fit: () => void }

/**
 * Rendering strategy (ADR-001, condition 2): rows are cut into memoised blocks of BLOCK rows, and the time
 * axis into chunks of DAY_CHUNK days. Scrolling is native; React re-renders only when the set of visible
 * blocks or day chunks changes, and then only the blocks that are new. Hover never re-renders the chart.
 */
const BLOCK = 32;
const DAY_CHUNK = 64;
const OVERSCAN_PX = 400;
const GRID_MIN = 160;

interface Block { index: number; start: number; rows: RowLayout[] }
interface Api {
  select: (t: SelectionTarget, additive: boolean) => void;
  focus: (row: number, bar: number) => void;
  toggle: (id: string) => void;
  toggleLane: (id: string) => void;
  tip: (x: number, y: number, content: ReactNode | null) => void;
}
interface Ctx { model: Model; kinds?: GanttKinds; locale?: string; laneOpen: ReadonlySet<string>; selKeys: ReadonlySet<string>; linkMarked: ReadonlySet<string>; loadState: ReadonlyMap<string, string> }

/**
 * Builds the model in its own task after the shell has painted, so no single main-thread task carries
 * both the model build and the first render (budget: no task over 100 ms). Shows the loading state meanwhile (F13).
 */
export const Gantt = forwardRef<GanttHandle, GanttProps>(function Gantt(props, ref) {
  // The working document: starts as props.data, changes through data operations, resets when props.data changes.
  const [working, setWorking] = useState<{ from: RoadmapDocument; doc: RoadmapDocument }>({ from: props.data, doc: props.data });
  const doc = working.from === props.data ? working.doc : props.data;
  const docRef = useRef(doc); docRef.current = doc;
  const propsRef = useRef(props); propsRef.current = props;
  const viewRef = useRef<ViewBridge | null>(null);

  const pipeline = useMemo(() => new OperationPipeline(
    () => {
      const p = propsRef.current;
      return {
        beforeOperation: (op, ctx) => {
          if (p.readOnly && /^(task|link)\./.test(op.type)) return mergeMessages(p.messages).readOnly;
          return p.onBeforeOperation?.(op, ctx);
        },
        authorize: p.authorize, operation: p.onOperation,
        refused: (r, ctx) => { p.onOperationRefused?.(r, ctx); if (r.stage === 'authorization') p.onAccessDenied?.({ operation: r.operation, reason: r.reason }); },
      };
    },
    (op) => {
      const r = applyDataOperation(docRef.current, op);
      if ('error' in r) return r;
      docRef.current = r.doc;
      const from = propsRef.current.data;
      setWorking({ from, doc: r.doc });
      propsRef.current.onDataChanged?.(r.doc, op);
      return { inverse: r.inverse };
    },
    (op) => { if (!viewRef.current) throw new Error('the chart is still loading'); viewRef.current.apply(op); },
  ), []);
  const run = useCallback((op: GanttOperation, source: OperationContext['source'] = 'api') =>
    pipeline.run(op, { source, by: propsRef.current.userId }), [pipeline]);

  useImperativeHandle(ref, () => ({
    run: (op) => run(op, 'api'),
    getData: () => docRef.current,
    getSelection: () => viewRef.current?.getSelection() ?? [],
    scrollToTask: (id) => viewRef.current?.scrollToTask(id),
    scrollToToday: () => viewRef.current?.scrollToToday(),
    fit: () => viewRef.current?.fit(),
  }), [run]);

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
      <GanttView {...props} data={built.data} model={built.model} run={run} viewRef={viewRef} loadState={loadState} requestChildren={requestChildren} />
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

function GanttView(props: GanttProps & {
  model: Model; run: (op: GanttOperation, source?: OperationContext['source']) => Promise<OperationResult>; viewRef: React.RefObject<ViewBridge | null>;
  loadState: ReadonlyMap<string, string>; requestChildren: (id: string) => void;
}) {
  const { data, kinds, locale, detailsPanel = 'right', height = 600, model, run } = props;
  const i18n = useMemo(() => makeI18n(mergeMessages(props.messages), locale), [props.messages, locale]);
  const m = i18n.t;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [laneOpen, setLaneOpen] = useState<Set<string>>(() => new Set());
  const sizes = useMemo<RowSizes>(() => ({ row: props.rowHeight ?? DEFAULT_SIZES.row, laneTrack: props.laneTrackHeight ?? DEFAULT_SIZES.laneTrack }), [props.rowHeight, props.laneTrackHeight]);
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
  const gridBodyRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ b0: 0, b1: 1, c0: 0, c1: 1, h: 600 });
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
    const d0 = (sl - OVERSCAN_PX) / sc.pxPerDay, d1 = (sl + w + OVERSCAN_PX) / sc.pxPerDay;
    const c0 = Math.floor(Math.max(0, d0) / DAY_CHUNK), c1 = Math.floor(d1 / DAY_CHUNK) + 1;
    startTransition(() => setView((v) => (v.b0 === b0 && v.b1 === b1 && v.c0 === c0 && v.c1 === c1 && v.h === h ? v : { b0, b1, c0, c1, h })));
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
  const applyZoom = useCallback((z: string) => { startTransition(() => setZoomState(z)); onZoomRef.current?.(z); }, []);
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
  const doSelect = useCallback((t: SelectionTarget, additive: boolean) => {
    const { selection: cur, selKeys: keys, model: mdl } = selRef.current;
    const next = additive ? (keys.has(targetKey(t)) ? cur.filter((s) => targetKey(s) !== targetKey(t)) : [...cur, t]) : [t];
    select(next);
    const tx = i18nRef.current;
    const name = labelOf(t, mdl, tx.t);
    setAnnounce(next.length > 1 ? tx.t.selectedMany(name, tx.num(next.length)) : next.length ? tx.t.selected(name) : tx.t.selectionCleared);
  }, [select]);

  const tipRef = useRef<(s: TipState | null) => void>(() => {});
  const api = useMemo<Api>(() => ({
    select: doSelect, focus: (row, bar) => setFocus((f) => (f.row === row && f.bar === bar ? f : { row, bar })), toggle, toggleLane,
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
  const ctx = useMemo<Ctx>(() => ({ model, kinds, locale, laneOpen, selKeys, linkMarked, loadState }), [model, kinds, locale, laneOpen, selKeys, linkMarked, loadState]);

  const targetFor = (r: RowLayout, bar: number): SelectionTarget =>
    r.lane && bar >= 0 ? { type: 'bar', taskId: r.bars[bar]!.taskId, bar: 'main' } : { type: 'row', taskId: r.taskId };
  const onKeyDown = (e: React.KeyboardEvent) => {
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
      case 'Enter': if (r.lane) toggleLane(r.taskId); else doSelect(targetFor(r, focus.bar), false); break;
      case 'Escape': select([]); setAnnounce(m.selectionCleared); break;
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
    if (el && gridBodyRef.current?.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, [focus, view.b0, view.b1]);

  // Panes (F4).
  const [gridW, setGridW] = useState(360);
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

  const Toolbar = props.toolbar === false ? null : props.toolbar ?? DefaultToolbar;
  const themeAttr = props.theme ? { 'data-theme': props.theme } : {};
  const visibleBlocks = blocks.slice(view.b0, view.b1);
  const dayFrom = origin + view.c0 * DAY_CHUNK, dayTo = origin + view.c1 * DAY_CHUNK;
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
  const longVisible = useMemo(() => linkBuckets.long.filter((x) => x.b1 >= view.b0 && x.b0 < view.b1).map((x) => x.l), [linkBuckets, view.b0, view.b1]);

  if (data.tasks.length === 0) {
    return <div className="gx-root" {...themeAttr} style={{ height }}>{props.emptyState ?? <div className="gx-empty">{m.empty}</div>}</div>;
  }

  return (
    <I18nContext.Provider value={i18n}>
    <div ref={rootRef} className={`gx-root gx-details-${detailsPanel || 'none'}`} {...themeAttr} style={{ height }}
      onKeyDown={(e) => {
        if (e.key !== 'F6' || !(e.target as HTMLElement).closest('.gx-details')) return;
        e.preventDefault();
        gridBodyRef.current?.querySelector<HTMLElement>('[role="row"][tabindex="0"]')?.focus();
      }}>
      {Toolbar && (
        <div className="gx-toolbar-row">
          <Toolbar zoom={zoom} levels={levels} setZoom={(z) => setZoom(z)} scrollToToday={scrollToToday} fit={fit} />
          <button className="gx-btn" onClick={() => setGridHidden((h) => !h)} aria-pressed={!gridHidden}>{gridHidden ? m.showGrid : m.hideGrid}</button>
          {props.saveState && <SaveIndicator state={props.saveState} />}
        </div>
      )}
      <div className="gx-main">
        <div className="gx-panes">
          {!gridHidden && (
            <div className="gx-grid" style={{ width: gridW }}>
              <div className="gx-grid-inner" role="treegrid" aria-label={data.roadmap.name} aria-rowcount={rows.length + 1} aria-multiselectable="true">
              <div className="gx-grid-head" role="row" aria-rowindex={1}>
                <span className="gx-col-wbs" role="columnheader">{m.colWbs}</span>
                <span className="gx-col-name" role="columnheader">{m.colName}</span>
                <span className="gx-col-date" role="columnheader">{m.colStart}</span>
                <span className="gx-col-dur" role="columnheader">{m.colDays}</span>
              </div>
              <div className="gx-grid-body" ref={gridBodyRef} role="rowgroup" onKeyDown={onKeyDown}
                onWheel={(e) => { if (chartRef.current) chartRef.current.scrollTop += e.deltaY; }}>
                <div style={{ height: H, position: 'relative' }}>
                  {visibleBlocks.map((b) => <GridBlock key={b.index} block={b} ctx={ctx} api={api}
                    focusRow={focus.row >= b.start && focus.row < b.start + BLOCK ? focus.row : -1} />)}
                </div>
              </div>
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
              onPointerDown={(e) => { if ((e.target as HTMLElement).closest('.gx-bar,.gx-link-hit')) return; const el = chartRef.current!; pan.current = { x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop, moved: false }; }}
              onPointerMove={(e) => { const p = pan.current; if (!p) return; const dx = e.clientX - p.x, dy = e.clientY - p.y; if (Math.abs(dx) + Math.abs(dy) > 4) p.moved = true; if (p.moved) { chartRef.current!.scrollLeft = p.l - dx; chartRef.current!.scrollTop = p.t - dy; } }}
              onPointerUp={() => { const p = pan.current; pan.current = null; if (p && !p.moved) select([]); }}
              onPointerLeave={() => { pan.current = null; }}>
              <div className="gx-canvas" ref={canvasRef} style={{ width: chartWidth, height: H }}>
                <BackgroundLayer scale={scale} minor={level.minor} from={dayFrom} to={dayTo} model={model} shade={props.highlightNonWorking !== false} />
                {visibleBlocks.map((b) => <RowBgBlock key={'bg' + b.index} block={b} selKeys={selKeys} />)}
                <svg className="gx-links" width={chartWidth} height={H} aria-hidden>
                  <defs>
                    <marker id="gx-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                      <path d="M0,0 L8,4 L0,8 z" className="gx-arrowhead" />
                    </marker>
                  </defs>
                  {visibleBlocks.map((b) => <LinkGroup key={'l' + b.index} links={linkBuckets.byBlock[b.index]} model={model} bars={bars} scale={scale} selKeys={selKeys} api={api} />)}
                  <LinkGroup links={longVisible} model={model} bars={bars} scale={scale} selKeys={selKeys} api={api} />
                </svg>
                {visibleBlocks.map((b) => <BarBlock key={'b' + b.index} block={b} ctx={ctx} api={api} scale={scale} bars={bars}
                  focus={focus.row >= b.start && focus.row < b.start + BLOCK ? focus : null} />)}
                {markers.map((m) => <div key={m.label + m.day} className={`gx-marker${m.today ? ' gx-today' : ''}`} style={{ left: xOf(scale, m.day) }}><span>{m.label}</span></div>)}
              </div>
            </div>
          </div>
        </div>
        {detailsPanel && <DetailsPanel model={model} selection={selection} kinds={kinds} select={detailsSelect} visibleIds={rowIndexOf} barIds={bars} i18n={i18n} />}
      </div>
      <Tooltip setterRef={tipRef} />
      <div className="gx-sr" aria-live="polite">{announce}</div>
    </div>
    </I18nContext.Provider>
  );
}

// ---------- memoised layers ----------

const GridBlock = memo(function GridBlock({ block, ctx, api, focusRow }: { block: Block; ctx: Ctx; api: Api; focusRow: number }) {
  const { model, kinds, locale, laneOpen, selKeys, linkMarked, loadState } = ctx;
  const { t: m, num } = useI18n();
  return <>{block.rows.map((r, k) => {
    const i = block.start + k;
    const t = model.tasks.get(r.taskId)!;
    const p = model.placement.byId.get(r.taskId)!;
    const selected = selKeys.has(`row:${r.taskId}`) || (!r.lane && selKeys.has(`bar:${r.taskId}`));
    const kind = t.kind ? kinds?.rows?.[t.kind] : undefined;
    return (
      <div key={r.taskId} data-row={i} role="row" aria-level={r.depth + 1} aria-rowindex={i + 2}
        aria-expanded={r.hasChildren && !r.lane ? r.expanded : undefined} aria-selected={selected}
        tabIndex={i === focusRow || (focusRow < 0 && i === 0) ? 0 : -1}
        className={`gx-row${selected ? ' gx-sel' : ''}${linkMarked.has(r.taskId) ? ' gx-marked' : ''}${i === focusRow ? ' gx-focus' : ''}${r.lane ? ' gx-lane' : ''}`}
        style={{ top: r.top, height: r.height }}
        onFocus={() => api.focus(i, -1)}
        onClick={(e) => { api.focus(i, -1); api.select({ type: 'row', taskId: r.taskId }, e.ctrlKey || e.metaKey); }}>
        <span className="gx-col-wbs" role="gridcell">{r.wbs}</span>
        <span className="gx-col-name" role="gridcell" style={{ paddingLeft: 6 + r.depth * 16 }}>
          {r.hasChildren ? (
            <button className="gx-twisty" tabIndex={-1} aria-label={r.lane ? m.openLane : r.expanded ? m.collapse : m.expand}
              onClick={(e) => { e.stopPropagation(); r.lane ? api.toggleLane(r.taskId) : api.toggle(r.taskId); }}>
              {r.lane ? '≡' : r.expanded ? '▾' : '▸'}
            </button>
          ) : <span className="gx-twisty-sp" />}
          {kind?.icon ? <span className="gx-kind-icon" aria-hidden>{kind.icon}</span> : null}
          <span className="gx-name-text" title={t.name}>{t.name}</span>
          {loadState.get(r.taskId) === 'loading' && <span className="gx-badge" role="status">{m.loadingChildren}</span>}
          {loadState.has(r.taskId) && loadState.get(r.taskId) !== 'loading' && <span className="gx-badge gx-badge-error" title={m.loadFailed(loadState.get(r.taskId)!)} role="status">⚠<span className="gx-sr">{m.loadFailed(loadState.get(r.taskId)!)}</span></span>}
          {r.lane && <span className="gx-badge" title={m.laneBarsHint}>{m.laneBars(num(r.bars.length))}</span>}
          {laneOpen.has(r.taskId) && <button className="gx-twisty gx-relane" tabIndex={-1} aria-label={m.closeLane} onClick={(e) => { e.stopPropagation(); api.toggleLane(r.taskId); }}>⇤</button>}
        </span>
        <span className="gx-col-date" role="gridcell">{p.scheduled ? fmtDate(p.start!, locale) : <em className="gx-muted">{m.unscheduled}</em>}</span>
        <span className="gx-col-dur" role="gridcell">{p.scheduled ? num(p.duration ?? 0) : ''}</span>
      </div>
    );
  })}</>;
});

const RowBgBlock = memo(function RowBgBlock({ block, selKeys }: { block: Block; selKeys: ReadonlySet<string> }) {
  return <>{block.rows.map((r) => {
    const sel = selKeys.has(`row:${r.taskId}`) || (!r.lane && selKeys.has(`bar:${r.taskId}`));
    return <div key={r.taskId} className={`gx-rowbg${sel ? ' gx-sel' : ''}${r.lane ? ' gx-lane' : ''}`} style={{ top: r.top, height: r.height }} />;
  })}</>;
});

const BarBlock = memo(function BarBlock({ block, ctx, api, scale, bars, focus }:
  { block: Block; ctx: Ctx; api: Api; scale: Scale; bars: ReturnType<typeof barIndex>; focus: { row: number; bar: number } | null }) {
  const { model, selKeys, linkMarked } = ctx;
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
    const cls = `gx-bar gx-${t.type === 'milestone' ? 'milestone' : isSummary ? 'summary' : 'task'}${sel ? ' gx-sel' : ''}${linkMarked.has(t.id) ? ' gx-marked' : ''}${focused ? ' gx-focus' : ''}${t.kind ? ` gx-kind-${cssId(t.kind)}` : ''}`;
    const onClick = (e: React.MouseEvent) => { e.stopPropagation(); api.focus(row, r.lane ? bi : -1); api.select(r.lane ? { type: 'bar', taskId: t.id, bar: 'main' } : { type: 'row', taskId: t.id }, e.ctrlKey || e.metaKey); };
    const tipOn = (e: React.PointerEvent) => api.tip(e.clientX, e.clientY, taskTip(t, model, i18n));
    const tipOff = () => api.tip(0, 0, null);
    if (t.type === 'milestone') {
      const s = pos.h;
      return <div key={t.id} className={cls} style={{ left: x + scale.pxPerDay / 2 - s / 2, top: pos.y, width: s, height: s }} onClick={onClick} onPointerMove={tipOn} onPointerLeave={tipOff}><div className="gx-diamond" /><span className="gx-bar-label gx-outside">{t.name}</span></div>;
    }
    return (
      <div key={t.id} className={cls} style={{ left: x, top: pos.y, width: w, height: pos.h }} onClick={onClick} onPointerMove={tipOn} onPointerLeave={tipOff}>
        {!isSummary && <div className="gx-progress" style={{ width: `${Math.round(p.progress * 100)}%` }} />}
        <span className={`gx-bar-label${w < 60 ? ' gx-outside' : ''}`}>{t.name}</span>
      </div>
    );
  }))}</>;
});

const LinkGroup = memo(function LinkGroup({ links, model, bars, scale, selKeys, api }:
  { links: Link[] | undefined; model: Model; bars: ReturnType<typeof barIndex>; scale: Scale; selKeys: ReadonlySet<string>; api: Api }) {
  const i18n = useI18n();
  return <>{(links ?? []).map((l) => {
    const d = linkPath(l, model.placement, bars, scale);
    if (!d) return null;
    return (
      <g key={l.id} className={`gx-link${selKeys.has(`link:${l.id}`) ? ' gx-sel' : ''}${l.kind ? ` gx-kind-${cssId(l.kind)}` : ''}`}>
        <path d={d} className="gx-link-line" markerEnd="url(#gx-arrow)" />
        <path d={d} className="gx-link-hit" onClick={(e) => { e.stopPropagation(); api.select({ type: 'link', linkId: l.id }, e.ctrlKey || e.metaKey); }}
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

function DefaultToolbar({ zoom, levels, setZoom, scrollToToday, fit }: ToolbarProps) {
  const { t: m } = useI18n();
  return (
    <div className="gx-toolbar" role="toolbar" aria-label={m.toolbarLabel}>
      <div className="gx-seg" role="radiogroup" aria-label={m.zoomLabel}>
        {levels.map((z) => <button key={z.id} role="radio" aria-checked={z.id === zoom} className={`gx-btn${z.id === zoom ? ' gx-on' : ''}`} onClick={() => setZoom(z.id)}>{m.zoomLevel[z.id] ?? z.label}</button>)}
      </div>
      <button className="gx-btn" onClick={scrollToToday}>{m.today}</button>
      <button className="gx-btn" onClick={fit}>{m.fit}</button>
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
export const fmtDate = (d: DayNum, locale?: string) => formatDay(d, locale, { day: 'numeric', month: 'short', year: '2-digit' });

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
