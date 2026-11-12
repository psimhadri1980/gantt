/**
 * Row layout and the model the view draws from: which rows are visible (collapsed subtrees, lanes), their
 * heights and positions, and the indexes built once per document version.
 */
import type { Link, RoadmapDocument, Task } from '@gantt/contract';
import { place, type DayNum, type Placement, type PlacedTask } from '@gantt/engine';

export const ROW_HEIGHT = 36;
export const LANE_TRACK = 28;
export const LANE_PAD = 4;

/** Row geometry (G1). Bars take the row height minus a margin; lane tracks stack bars within a lane row. */
export interface RowSizes { row: number; laneTrack: number }
export const DEFAULT_SIZES: RowSizes = { row: ROW_HEIGHT, laneTrack: LANE_TRACK };

/** One bar on the chart. On an ordinary row it is the row's own task; on a lane row, one of its children. */
export interface BarLayout {
  taskId: string;
  rowIndex: number;
  /** Track within a lane row (0 on ordinary rows). */
  track: number;
}

/** One visible row: which task, how deep in the tree, its top and height in pixels, and whether it is a lane. */
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

/**
 * Everything the view needs to draw a roadmap: the document, its placement, the tree (parents, children,
 * WBS codes) and indexes by id. Built once per document version by `buildModel`.
 */
export interface Model {
  doc: RoadmapDocument;
  placement: Placement;
  tasks: Map<string, Task>;
  children: Map<string | null, string[]>;
  linksByTask: Map<string, Link[]>;
  wbs: Map<string, string>;
}

/** `placement` may be passed in when it was computed in an earlier task (staged loading). */
export function buildModel(doc: RoadmapDocument, placement: Placement = place(doc)): Model {
  const tasks = new Map(doc.tasks.map((t) => [t.id, t]));
  const children = new Map<string | null, string[]>();
  for (const t of doc.tasks) (children.get(t.parent) ?? children.set(t.parent, []).get(t.parent)!).push(t.id);
  // Siblings follow `order` (D2); tasks without it keep their array position (stable sort).
  if (doc.tasks.some((t) => t.order !== undefined)) {
    const pos = new Map(doc.tasks.map((t, i) => [t.id, i]));
    const key = (id: string) => tasks.get(id)!.order ?? pos.get(id)!;
    for (const kids of children.values()) kids.sort((a, b) => key(a) - key(b) || pos.get(a)! - pos.get(b)!);
  }
  const linksByTask = new Map<string, Link[]>();
  for (const l of doc.links) for (const id of [l.source, l.target]) (linksByTask.get(id) ?? linksByTask.set(id, []).get(id)!).push(l);
  // WBS codes (D13) from tree order.
  const wbs = new Map<string, string>();
  const stack: [string | null, string][] = [[null, '']];
  while (stack.length) {
    const [id, prefix] = stack.pop()!;
    const kids = children.get(id) ?? [];
    for (let i = kids.length - 1; i >= 0; i--) {
      const code = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
      wbs.set(kids[i]!, code);
      stack.push([kids[i]!, code]);
    }
  }
  return { doc, placement, tasks, children, linksByTask, wbs };
}

/**
 * Flattens the tree into visible rows. Lane rows (A6) draw their children as bars on the row itself,
 * stacked into tracks where they overlap, so rows differ in height. `laneOpen` lists lanes the user has
 * opened into ordinary rows.
 */
export function layoutRows(m: Model, collapsed: ReadonlySet<string>, laneOpen: ReadonlySet<string> = new Set(), sizes: RowSizes = DEFAULT_SIZES): RowLayout[] {
  const rows: RowLayout[] = [];
  let top = 0;
  const visit = (id: string, depth: number) => {
    const t = m.tasks.get(id)!;
    const kids = m.children.get(id) ?? [];
    // A task may declare children that are not loaded yet (H2): it shows as collapsed and loads them on expand.
    const unloaded = kids.length === 0 && t.hasChildren === true;
    const lane = !!t.lane && kids.length > 0 && !laneOpen.has(id);
    const expanded = !unloaded && !collapsed.has(id);
    const rowIndex = rows.length;
    let bars: BarLayout[];
    let tracks = 1;
    if (lane) {
      const r = stack(kids.map((k) => m.placement.byId.get(k)!));
      bars = r.bars.map((b) => ({ ...b, rowIndex }));
      tracks = Math.max(1, r.tracks);
    } else bars = [{ taskId: id, rowIndex, track: 0 }];
    const height = lane ? Math.max(sizes.row, tracks * sizes.laneTrack + LANE_PAD * 2) : sizes.row;
    rows.push({ taskId: id, depth, wbs: m.wbs.get(id) ?? '', hasChildren: kids.length > 0 || unloaded, unloaded, expanded, lane, top, height, bars, tracks });
    top += height;
    if (!lane && expanded) for (const k of kids) visit(k, depth + 1);
  };
  for (const id of m.children.get(null) ?? []) visit(id, 0);
  return rows;
}

/** Greedy interval packing: each bar takes the lowest track that is free at its start. */
function stack(items: PlacedTask[]): { bars: Omit<BarLayout, 'rowIndex'>[]; tracks: number } {
  const sorted = items.filter((p) => p.scheduled).sort((a, b) => a.start! - b.start! || b.end! - a.end!);
  const trackEnd: DayNum[] = [];
  const bars = sorted.map((p) => {
    let tr = trackEnd.findIndex((e) => e < p.start!);
    if (tr < 0) { tr = trackEnd.length; trackEnd.push(p.end!); } else trackEnd[tr] = p.end!;
    return { taskId: p.task.id, track: tr };
  });
  return { bars, tracks: trackEnd.length };
}

/** Index of the first row whose bottom is below y (binary search over variable heights). */
export function rowAt(rows: RowLayout[], y: number): number {
  let lo = 0, hi = rows.length - 1, ans = rows.length;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid]!.top + rows[mid]!.height > y) { ans = mid; hi = mid - 1; } else lo = mid + 1;
  }
  return ans;
}

/** Total height in pixels of the given rows (the bottom of the last one). */
export function totalHeight(rows: RowLayout[]): number {
  const last = rows[rows.length - 1];
  return last ? last.top + last.height : 0;
}

/** Where each visible bar sits vertically: the row's index and centre line. */
export function barIndex(rows: RowLayout[], sizes: RowSizes = DEFAULT_SIZES): Map<string, { row: RowLayout; y: number; h: number }> {
  const m = new Map<string, { row: RowLayout; y: number; h: number }>();
  for (const r of rows) for (const b of r.bars) {
    if (r.lane) m.set(b.taskId, { row: r, y: r.top + LANE_PAD + b.track * sizes.laneTrack + 3, h: sizes.laneTrack - 6 });
    else { const pad = Math.max(3, Math.round(sizes.row * 0.22)); m.set(b.taskId, { row: r, y: r.top + pad, h: sizes.row - pad * 2 }); }
  }
  return m;
}
