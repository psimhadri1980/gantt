import { forwardRef, memo, startTransition, useImperativeHandle, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type ComponentType } from 'react';
import type { Link, RoadmapDocument, Task } from '@gantt/contract';
import {
  applyDataOperation, barIndex, buildModel, OperationPipeline, formatDay, layoutRows, linkPath, rowAt, targetKey, ticks, totalHeight, xOf, ZOOM_LEVELS,
  type DataOperation, type GanttOperation, type Model, type OperationContext, type OperationHooks, type OperationResult,
  type RowLayout, type Scale, type SelectionTarget, type ViewOperation,
} from '@gantt/state';
import { fromDay, type DayNum } from '@gantt/engine';
import { placeOffThread } from './engineClient.ts';
import { DetailsPanel, type GanttKinds } from './Details.tsx';
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

export interface ToolbarProps { zoom: string; setZoom: (z: string) => void; scrollToToday: () => void; fit: () => void }

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
interface Ctx { model: Model; kinds?: GanttKinds; locale?: string; laneOpen: ReadonlySet<string>; selKeys: ReadonlySet<string>; linkMarked: ReadonlySet<string> }

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
        beforeOperation: p.onBeforeOperation, authorize: p.authorize, operation: p.onOperation,
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

  const [built, setBuilt] = useState<{ data: RoadmapDocument; model: Model } | null>(null);
  useEffect(() => {
    if (built?.data === doc) return;
    // The engine places tasks in a worker; the main thread only builds the tree indexes and renders (as a transition).
    let cancelled = false;
    placeOffThread(doc).then((placement) => {
      if (cancelled) return;
      setTimeout(() => { if (!cancelled) { const model = buildModel(doc, placement); startTransition(() => setBuilt({ data: doc, model })); } }, 0);
    });
    return () => { cancelled = true; };
  }, [doc, built]);
  // While a changed document is being placed, keep showing the previous one (no loading flash).
  if (!built) {
    const themeAttr = props.theme ? { 'data-theme': props.theme } : {};
    return <div className="gx-root" {...themeAttr} style={{ height: props.height ?? 600 }} aria-busy="true"><div className="gx-empty">Loading roadmap…</div></div>;
  }
  return <GanttView {...props} data={built.data} model={built.model} run={run} viewRef={viewRef} />;
});

function GanttView(props: GanttProps & { model: Model; run: (op: GanttOperation, source?: OperationContext['source']) => Promise<OperationResult>; viewRef: React.RefObject<ViewBridge | null> }) {
  const { data, kinds, locale, detailsPanel = 'right', height = 600, model, run } = props;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [laneOpen, setLaneOpen] = useState<Set<string>>(() => new Set());
  const rows = useMemo(() => layoutRows(model, collapsed, laneOpen), [model, collapsed, laneOpen]);
  const bars = useMemo(() => barIndex(rows), [rows]);
  const rowIndexOf = useMemo(() => new Map(rows.map((r, i) => [r.taskId, i])), [rows]);
  const blocks = useMemo(() => {
    const out: Block[] = [];
    for (let s = 0; s < rows.length; s += BLOCK) out.push({ index: out.length, start: s, rows: rows.slice(s, s + BLOCK) });
    return out;
  }, [rows]);

  const [zoomState, setZoomState] = useState(props.zoom ?? 'week');
  const zoom = props.zoom ?? zoomState;
  const level = ZOOM_LEVELS.find((z) => z.id === zoom) ?? ZOOM_LEVELS[3]!;
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
  const geom = useRef({ rows, scale, blocksLen: blocks.length, zoom }); geom.current = { rows, scale, blocksLen: blocks.length, zoom };
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

  const todayDay = useMemo(() => dayOfIso(props.today ?? data.roadmap.statusDate ?? new Date().toISOString().slice(0, 10)), [props.today, data.roadmap.statusDate]);

  const scrollToDay = useCallback((d: DayNum, smooth = true) => {
    const el = chartRef.current; if (!el) return;
    el.scrollTo({ left: Math.max(0, xOf(scale, d) - el.clientWidth / 3), behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' });
  }, [scale]);
  const scrollToToday = useCallback(() => scrollToDay(todayDay), [scrollToDay, todayDay]);

  const onZoomRef = useRef(props.onZoomChanged); onZoomRef.current = props.onZoomChanged;
  const pendingAnchor = useRef<{ day: number; px: number } | null>(null);
  const gesture = useRef<{ from: number; px: number; timer: number } | null>(null);
  const gesture_active = () => gesture.current !== null;
  const applyZoom = useCallback((z: string) => { startTransition(() => setZoomState(z)); onZoomRef.current?.(z); }, []);
  const setZoom = useCallback((z: string, anchorPx?: number) => {
    const el = chartRef.current, sc = geom.current.scale;
    if (el && !pendingAnchor.current) { const px = anchorPx ?? el.clientWidth / 2; pendingAnchor.current = { day: (el.scrollLeft + px) / sc.pxPerDay + sc.origin, px }; }
    void run({ type: 'zoom.set', zoom: z }, 'user').then((r) => { if (!r.ok) { pendingAnchor.current = null; zoomRef.current = geom.current.zoom; } });
  }, [run]);
  useLayoutEffect(() => {
    const a = pendingAnchor.current, el = chartRef.current;
    if (a && el) { el.scrollLeft = (a.day - scale.origin) * scale.pxPerDay - a.px; pendingAnchor.current = null; }
  }, [scale]);
  const fit = useCallback(() => {
    const el = chartRef.current; if (!el || !span) return;
    const days = span.end - span.start + 1;
    const best = [...ZOOM_LEVELS].reverse().find((z) => days * z.pxPerDay <= el.clientWidth - 40) ?? ZOOM_LEVELS[0]!;
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
      const i = ZOOM_LEVELS.findIndex((z) => z.id === zoomRef.current);
      const ni = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, i + (e.deltaY < 0 ? 1 : -1)));
      if (ni === i) return;
      const px = e.clientX - el.getBoundingClientRect().left;
      zoomRef.current = ZOOM_LEVELS[ni]!.id;
      // Preview: scale the drawn canvas and the axis on the compositor; React redraws once the gesture settles.
      const g = gesture.current ?? (gesture.current = { from: geom.current.scale.pxPerDay, px, timer: 0 });
      const k = ZOOM_LEVELS[ni]!.pxPerDay / g.from;
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
  const toggle = useCallback((id: string) => { void run({ type: treeRef.current.collapsed.has(id) ? 'row.expand' : 'row.collapse', id }, 'user'); }, [run]);
  const toggleLane = useCallback((id: string) => { void run({ type: treeRef.current.laneOpen.has(id) ? 'lane.close' : 'lane.open', id }, 'user'); }, [run]);
  const setIn = (set: React.Dispatch<React.SetStateAction<Set<string>>>, id: string, on: boolean) =>
    set((c) => { if (c.has(id) === on) return c; const n = new Set(c); on ? n.add(id) : n.delete(id); return n; });
  const selRef = useRef({ selection, selKeys, model }); selRef.current = { selection, selKeys, model };
  const doSelect = useCallback((t: SelectionTarget, additive: boolean) => {
    const { selection: cur, selKeys: keys, model: m } = selRef.current;
    const next = additive ? (keys.has(targetKey(t)) ? cur.filter((s) => targetKey(s) !== targetKey(t)) : [...cur, t]) : [t];
    select(next);
    setAnnounce(next.length ? `${labelOf(t, m)} selected${next.length > 1 ? `, ${next.length} items` : ''}` : 'Selection cleared');
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
        case 'row.expand': setIn(setCollapsed, op.id, false); break;
        case 'row.collapse': setIn(setCollapsed, op.id, true); break;
        case 'lane.open': setIn(setLaneOpen, op.id, true); break;
        case 'lane.close': setIn(setLaneOpen, op.id, false); break;
        case 'selection.set': applySelection(op.selection); break;
        case 'zoom.set': if (!ZOOM_LEVELS.some((z) => z.id === op.zoom)) throw new Error(`unknown zoom level "${op.zoom}"`); applyZoom(op.zoom); break;
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
  const ctx = useMemo<Ctx>(() => ({ model, kinds, locale, laneOpen, selKeys, linkMarked }), [model, kinds, locale, laneOpen, selKeys, linkMarked]);

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
      case 'Escape': select([]); setAnnounce('Selection cleared'); break;
      case '+': case '=': setZoom(ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, ZOOM_LEVELS.indexOf(level) + 1)]!.id); break;
      case '-': setZoom(ZOOM_LEVELS[Math.max(0, ZOOM_LEVELS.indexOf(level) - 1)]!.id); break;
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
  const markers = useMemo(() => [{ day: todayDay, label: 'Today', today: true }, ...(props.markers ?? []).map((m) => ({ day: dayOfIso(m.date), label: m.label, today: false }))], [todayDay, props.markers]);
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
    return <div className="gx-root" {...themeAttr} style={{ height }}>{props.emptyState ?? <div className="gx-empty">This roadmap has no tasks yet.</div>}</div>;
  }

  return (
    <div ref={rootRef} className={`gx-root gx-details-${detailsPanel || 'none'}`} {...themeAttr} style={{ height }}
      onKeyDown={(e) => {
        if (e.key !== 'F6' || !(e.target as HTMLElement).closest('.gx-details')) return;
        e.preventDefault();
        gridBodyRef.current?.querySelector<HTMLElement>('[role="row"][tabindex="0"]')?.focus();
      }}>
      {Toolbar && (
        <div className="gx-toolbar-row">
          <Toolbar zoom={zoom} setZoom={(z) => setZoom(z)} scrollToToday={scrollToToday} fit={fit} />
          <button className="gx-btn" onClick={() => setGridHidden((h) => !h)} aria-pressed={!gridHidden}>{gridHidden ? 'Show grid' : 'Hide grid'}</button>
        </div>
      )}
      <div className="gx-main">
        <div className="gx-panes">
          {!gridHidden && (
            <div className="gx-grid" style={{ width: gridW }}>
              <div className="gx-grid-inner" role="treegrid" aria-label={data.roadmap.name} aria-rowcount={rows.length + 1} aria-multiselectable="true">
              <div className="gx-grid-head" role="row" aria-rowindex={1}>
                <span className="gx-col-wbs" role="columnheader">WBS</span>
                <span className="gx-col-name" role="columnheader">Name</span>
                <span className="gx-col-date" role="columnheader">Start</span>
                <span className="gx-col-dur" role="columnheader">Days</span>
              </div>
              <div className="gx-grid-body" ref={gridBodyRef} role="rowgroup" onKeyDown={onKeyDown}
                onWheel={(e) => { if (chartRef.current) chartRef.current.scrollTop += e.deltaY; }}>
                <div style={{ height: H, position: 'relative' }}>
                  {visibleBlocks.map((b) => <GridBlock key={b.index} block={b} ctx={ctx} api={api}
                    focusRow={focus.row >= b.start && focus.row < b.start + BLOCK ? focus.row : -1} />)}
                </div>
              </div>
              </div>
              <div className="gx-splitter" role="separator" aria-orientation="vertical" aria-label="Resize grid" tabIndex={0}
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
            <div className="gx-chart" ref={chartRef} onScroll={onScroll} tabIndex={0} role="region" aria-label="Timeline: scroll with the arrow keys"
              onPointerDown={(e) => { if ((e.target as HTMLElement).closest('.gx-bar,.gx-link-hit')) return; const el = chartRef.current!; pan.current = { x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop, moved: false }; }}
              onPointerMove={(e) => { const p = pan.current; if (!p) return; const dx = e.clientX - p.x, dy = e.clientY - p.y; if (Math.abs(dx) + Math.abs(dy) > 4) p.moved = true; if (p.moved) { chartRef.current!.scrollLeft = p.l - dx; chartRef.current!.scrollTop = p.t - dy; } }}
              onPointerUp={() => { const p = pan.current; pan.current = null; if (p && !p.moved) select([]); }}
              onPointerLeave={() => { pan.current = null; }}>
              <div className="gx-canvas" ref={canvasRef} style={{ width: chartWidth, height: H }}>
                <BackgroundLayer scale={scale} minor={level.minor} from={dayFrom} to={dayTo} model={model} />
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
        {detailsPanel && <DetailsPanel model={model} selection={selection} kinds={kinds} locale={locale} select={detailsSelect} visibleIds={rowIndexOf} barIds={bars} />}
      </div>
      <Tooltip setterRef={tipRef} />
      <div className="gx-sr" aria-live="polite">{announce}</div>
    </div>
  );
}

// ---------- memoised layers ----------

const GridBlock = memo(function GridBlock({ block, ctx, api, focusRow }: { block: Block; ctx: Ctx; api: Api; focusRow: number }) {
  const { model, kinds, locale, laneOpen, selKeys, linkMarked } = ctx;
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
            <button className="gx-twisty" tabIndex={-1} aria-label={r.lane ? 'Open lane into rows' : r.expanded ? 'Collapse' : 'Expand'}
              onClick={(e) => { e.stopPropagation(); r.lane ? api.toggleLane(r.taskId) : api.toggle(r.taskId); }}>
              {r.lane ? '≡' : r.expanded ? '▾' : '▸'}
            </button>
          ) : <span className="gx-twisty-sp" />}
          {kind?.icon ? <span className="gx-kind-icon" aria-hidden>{kind.icon}</span> : null}
          <span className="gx-name-text" title={t.name}>{t.name}</span>
          {r.lane && <span className="gx-badge" title="Lane row: its children are drawn as bars on this row">{r.bars.length} bars</span>}
          {laneOpen.has(r.taskId) && <button className="gx-twisty gx-relane" tabIndex={-1} aria-label="Close into lane" onClick={(e) => { e.stopPropagation(); api.toggleLane(r.taskId); }}>⇤</button>}
        </span>
        <span className="gx-col-date" role="gridcell">{p.scheduled ? fmtDate(p.start!, locale) : <em className="gx-muted">Unscheduled</em>}</span>
        <span className="gx-col-dur" role="gridcell">{p.scheduled ? p.duration : ''}</span>
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
  const { model, selKeys, linkMarked, locale } = ctx;
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
    const tipOn = (e: React.PointerEvent) => api.tip(e.clientX, e.clientY, taskTip(t, model, locale));
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
  return <>{(links ?? []).map((l) => {
    const d = linkPath(l, model.placement, bars, scale);
    if (!d) return null;
    return (
      <g key={l.id} className={`gx-link${selKeys.has(`link:${l.id}`) ? ' gx-sel' : ''}${l.kind ? ` gx-kind-${cssId(l.kind)}` : ''}`}>
        <path d={d} className="gx-link-line" markerEnd="url(#gx-arrow)" />
        <path d={d} className="gx-link-hit" onClick={(e) => { e.stopPropagation(); api.select({ type: 'link', linkId: l.id }, e.ctrlKey || e.metaKey); }}
          onPointerMove={(e) => api.tip(e.clientX, e.clientY, linkTip(l, model))} onPointerLeave={() => api.tip(0, 0, null)} />
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

const BackgroundLayer = memo(function BackgroundLayer({ scale, minor, from, to, model }: { scale: Scale; minor: 'month' | 'week' | 'day'; from: number; to: number; model: Model }) {
  const out: ReactNode[] = [];
  if (scale.pxPerDay >= 8) {
    // Merge consecutive non-working days into one element.
    const cal = model.placement.calendar;
    for (let d = from; d <= to; d++) {
      if (cal.isWorking(d)) continue;
      let e = d; while (e + 1 <= to && !cal.isWorking(e + 1)) e++;
      out.push(<div key={'w' + d} className="gx-nonwork" style={{ left: xOf(scale, d), width: (e - d + 1) * scale.pxPerDay }} />);
      d = e;
    }
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

function DefaultToolbar({ zoom, setZoom, scrollToToday, fit }: ToolbarProps) {
  return (
    <div className="gx-toolbar" role="toolbar" aria-label="Chart navigation">
      <div className="gx-seg" role="radiogroup" aria-label="Zoom">
        {ZOOM_LEVELS.map((z) => <button key={z.id} role="radio" aria-checked={z.id === zoom} className={`gx-btn${z.id === zoom ? ' gx-on' : ''}`} onClick={() => setZoom(z.id)}>{z.label}</button>)}
      </div>
      <button className="gx-btn" onClick={scrollToToday}>Today</button>
      <button className="gx-btn" onClick={fit}>Fit</button>
    </div>
  );
}

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const cssId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '-');
const dayOfIso = (iso: string) => Math.floor(Date.parse(iso + 'T00:00:00Z') / 86_400_000);
export const fmtDate = (d: DayNum, locale?: string) => formatDay(d, locale, { day: 'numeric', month: 'short', year: '2-digit' });

function labelOf(t: SelectionTarget, m: Model) {
  if (t.type === 'link') { const l = m.doc.links.find((x) => x.id === t.linkId); return l ? `Connector ${m.tasks.get(l.source)?.name} to ${m.tasks.get(l.target)?.name}` : 'Connector'; }
  return m.tasks.get(t.taskId)?.name ?? t.taskId;
}
function taskTip(t: Task, m: Model, locale?: string) {
  const p = m.placement.byId.get(t.id)!;
  return <><strong>{t.name}</strong><div>{fmtDate(p.start!, locale)} – {fmtDate(p.end!, locale)} · {p.duration} working days</div>{t.type !== 'milestone' && <div>{Math.round(p.progress * 100)}% complete</div>}</>;
}
function linkTip(l: Link, m: Model) {
  return <><strong>{l.type}{l.lag ? ` +${l.lag}d` : ''}</strong><div>{m.tasks.get(l.source)?.name} → {m.tasks.get(l.target)?.name}</div></>;
}
export { fromDay };
