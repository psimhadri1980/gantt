import { fromDay, type DayNum, type WorkCalendar } from '@gantt/engine';
import type { DataOperation, Scale } from '@gantt/state';
import type { LinkType, Task } from '@gantt/contract';

/**
 * Dragging on the chart (D1, D6, D17), done on the DOM directly so a drag never re-renders React per frame
 * (ADR-001, condition 2). React re-renders once, when the change is committed.
 *
 * Kinds: move a bar (also along a lane, or onto another lane), resize its start or end, drag its progress,
 * draw a dependency from one of its ends, or create a bar by dragging across an empty stretch of a lane.
 */
export type DragKind = 'move' | 'start' | 'end' | 'progress' | 'link-start' | 'link-end' | 'create';

/**
 * What the drag controller needs from the chart: its elements, the current scale and calendar, and callbacks to
 * check, preview and commit a change.
 */
export interface DragHost {
  chart: HTMLElement;
  canvas: HTMLElement;
  scale: () => Scale;
  calendar: () => WorkCalendar;
  task: (id: string) => { task: Task; start?: DayNum; end?: DayNum; duration?: number; progress: number } | undefined;
  /** Null when the field may be changed, else the reason. */
  whyNot: (id: string, field: string) => string | null;
  /** Reason a dependency cannot be drawn, or null. */
  whyNotLink: (source: string, target: string, type: LinkType) => string | null;
  /** The lane row under a client y, if any (for moving a bar to another lane). */
  laneAt: (clientY: number) => string | null;
  commit: (op: DataOperation) => void;
  /** Successor positions if `id` had these fields (from the engine, off the main thread). */
  preview: (id: string, fields: Partial<Task>) => Promise<Map<string, { start: DayNum; end: DayNum }>>;
  tip: (x: number, y: number, text: string | null) => void;
  announce: (text: string) => void;
  newId: () => string;
  /** Text for the tooltip while dragging. */
  describe: (start: DayNum, end: DayNum, kind: DragKind) => string;
}

/**
 * The drag in progress: what is dragged (move, resize either end, progress, a new link from either end, or a new
 * task drawn on an empty row), where it started,
 * the pointer's last position and the elements previewed so far.
 */
interface Active {
  kind: DragKind;
  id: string;
  bar: HTMLElement | null;
  x0: number; y0: number; scroll0: number;
  start: DayNum; end: DayNum; progress: number;
  delta: number; moved: boolean;
  previewed: HTMLElement[];
  previewKey: string;
  timer: number;
  raf: number;
  lastX: number; lastY: number;
  line?: SVGLineElement;
  target?: { id: string; type: LinkType; why: string | null };
  lane?: string | null;
  /** For create: the lane, and where the drag began (a day). */
  createDay?: DayNum;
  barStyle?: { width: string; transform: string; fill: string };
  ghost?: HTMLElement;
}

const EDGE = 36; // px from the chart edge where the view scrolls by itself

/**
 * Moving, resizing and linking bars with the pointer (D1, D3, D4). While dragging only the bars' styles change
 * (no React render per frame); the change is committed as one operation on release and undone on Esc.
 */
export class DragController {
  private a: Active | null = null;
  private pointerId = 0;
  constructor(private readonly h: DragHost) {}

  /** True while a drag is in progress. */
  get active() { return this.a !== null; }

  /** Starts a drag from a pointerdown. Returns false (and nothing happens) when the change is not allowed. */
  begin(e: PointerEvent | React.PointerEvent, kind: DragKind, id: string, bar: HTMLElement | null): boolean {
    const t = this.h.task(id);
    if (kind !== 'create' && (!t || t.start === undefined || t.end === undefined)) return false;
    // The field the drag changes: resizing the end changes the duration, moving or resizing the start the start.
    const field = kind === 'progress' ? 'progress' : kind === 'end' ? 'duration' : kind.startsWith('link') || kind === 'create' ? null : 'start';
    const why = field ? this.h.whyNot(id, field) : null;
    if (why) { this.h.announce(why); return false; }
    const sc = this.h.scale();
    const day = Math.floor((e.clientX - this.h.canvas.getBoundingClientRect().left) / sc.pxPerDay) + sc.origin;
    this.a = {
      kind, id, bar, x0: e.clientX, y0: e.clientY, scroll0: this.h.chart.scrollLeft,
      start: t?.start ?? day, end: t?.end ?? day, progress: t?.progress ?? 0,
      delta: 0, moved: false, previewed: [], previewKey: '', timer: 0, raf: 0, lastX: e.clientX, lastY: e.clientY,
      createDay: kind === 'create' ? day : undefined,
      // React owns these inline styles; restore them exactly, or a cancelled drag leaves the bar mis-sized.
      barStyle: bar ? { width: bar.style.width, transform: bar.style.transform, fill: bar.querySelector<HTMLElement>('.gx-progress')?.style.width ?? '' } : undefined,
    };
    this.pointerId = (e as PointerEvent).pointerId;
    window.addEventListener('keydown', this.onKey, true);
    return true;
  }

  /** Follows the pointer: records its position and schedules a preview update for the next frame. */
  move(e: PointerEvent | React.PointerEvent) {
    const a = this.a; if (!a) return;
    a.lastX = e.clientX; a.lastY = e.clientY;
    if (!a.moved && Math.abs(e.clientX - a.x0) + Math.abs(e.clientY - a.y0) < 4) return;
    if (!a.moved) {
      // Capture only once it is a drag, so a plain click still reaches the bar.
      try { this.h.chart.setPointerCapture?.(this.pointerId); } catch { /* pointer already gone */ }
      a.moved = true; this.h.canvas.classList.add('gx-dragging'); if (a.bar) a.bar.classList.add('gx-drag-src'); }
    this.update();
    this.autoScroll();
  }

  /**
   * Recomputes the preview from the pointer: the new dates (snapped to working days on the task's calendar), the
   * bars to move with it, and the tooltip text.
   */
  private update() {
    const a = this.a!; const sc = this.h.scale(); const cal = this.h.calendar();
    const dx = a.lastX - a.x0 + (this.h.chart.scrollLeft - a.scroll0);
    a.delta = Math.round(dx / sc.pxPerDay); // snaps to whole days (D17)
    const px = sc.pxPerDay;
    switch (a.kind) {
      case 'move': {
        if (a.bar) a.bar.style.transform = `translateX(${a.delta * px}px)`;
        const s = cal.nextWorking(a.start + a.delta);
        const dur = cal.workingDaysBetween(a.start, a.end);
        const e = this.h.task(a.id)?.task.type === 'milestone' ? s : cal.endOf(s, dur);
        // Another lane only when the task may be moved there (its parent is a field with its own permission).
        const lane = this.h.laneAt(a.lastY);
        a.lane = lane && lane !== this.h.task(a.id)?.task.parent && this.h.whyNot(a.id, 'parent') ? null : lane;
        if (a.bar) a.bar.classList.toggle('gx-drag-lane', !!a.lane && a.lane !== this.h.task(a.id)?.task.parent);
        this.h.tip(a.lastX, a.lastY, this.h.describe(s, e, 'move'));
        this.schedulePreview({ start: fromDay(s) });
        break;
      }
      case 'end': {
        const e = Math.max(a.start, a.end + a.delta);
        if (a.bar) a.bar.style.width = `${(e - a.start + 1) * px}px`;
        const dur = Math.max(1, cal.workingDaysBetween(a.start, e));
        this.h.tip(a.lastX, a.lastY, this.h.describe(a.start, cal.endOf(a.start, dur), 'end'));
        this.schedulePreview({ duration: dur });
        break;
      }
      case 'start': {
        const s = Math.min(a.end, a.start + a.delta);
        if (a.bar) { a.bar.style.transform = `translateX(${(s - a.start) * px}px)`; a.bar.style.width = `${(a.end - s + 1) * px}px`; }
        const ns = cal.nextWorking(s);
        const dur = Math.max(1, cal.workingDaysBetween(ns, a.end));
        this.h.tip(a.lastX, a.lastY, this.h.describe(ns, a.end, 'start'));
        this.schedulePreview({ start: fromDay(ns), duration: dur });
        break;
      }
      case 'progress': {
        const w = (a.end - a.start + 1) * px;
        const p = Math.max(0, Math.min(1, a.progress + dx / w));
        const snapped = Math.round(p * 20) / 20;
        const fill = a.bar?.querySelector<HTMLElement>('.gx-progress');
        if (fill) fill.style.width = `${snapped * 100}%`;
        this.h.tip(a.lastX, a.lastY, `${Math.round(snapped * 100)}%`);
        break;
      }
      case 'link-start': case 'link-end': this.updateLink(); break;
      case 'create': {
        const from = Math.min(a.createDay!, a.createDay! + a.delta), to = Math.max(a.createDay!, a.createDay! + a.delta);
        if (!a.ghost) {
          a.ghost = document.createElement('div'); a.ghost.className = 'gx-create-ghost';
          const y = a.y0 - this.h.canvas.getBoundingClientRect().top;
          a.ghost.style.top = `${y - 10}px`;
          this.h.canvas.appendChild(a.ghost);
        }
        a.ghost.style.left = `${(from - sc.origin) * px}px`;
        a.ghost.style.width = `${(to - from + 1) * px}px`;
        const s = cal.nextWorking(from);
        this.h.tip(a.lastX, a.lastY, this.h.describe(s, cal.endOf(s, Math.max(1, cal.workingDaysBetween(s, to))), 'create'));
        break;
      }
    }
  }

  /** Successors move in place while dragging (D17), computed by the engine in the worker, at most every 120 ms. */
  private schedulePreview(fields: Partial<Task>) {
    const a = this.a!;
    const key = JSON.stringify(fields);
    if (key === a.previewKey) return;
    a.previewKey = key;
    clearTimeout(a.timer);
    a.timer = window.setTimeout(() => {
      const id = a.id;
      void this.h.preview(id, fields).then((moved) => {
        if (this.a !== a || a.previewKey !== key) return;
        this.clearPreview();
        const px = this.h.scale().pxPerDay;
        for (const [tid, pos] of moved) {
          if (tid === id) continue;
          const now = this.h.task(tid);
          if (now?.start === undefined || now.end === undefined) continue;
          const el = this.h.canvas.querySelector<HTMLElement>(`.gx-bar[data-task="${CSS.escape(tid)}"]`);
          if (!el || (pos.start === now.start && pos.end === now.end)) continue;
          el.style.transform = `translateX(${(pos.start - now.start) * px}px)`;
          el.classList.add('gx-preview');
          a.previewed.push(el);
        }
      });
    }, 120);
  }
  /** Removes the preview styles from every bar that was previewed. */
  private clearPreview() {
    const a = this.a; if (!a) return;
    for (const el of a.previewed) { el.style.transform = ''; el.classList.remove('gx-preview'); }
    a.previewed = [];
  }

  /** While drawing a link: finds the bar under the pointer and shows whether a link to it is allowed. */
  private updateLink() {
    const a = this.a!;
    const rect = this.h.canvas.getBoundingClientRect();
    const sc = this.h.scale();
    if (!a.line) {
      // A 1×1 overlay with visible overflow: never a canvas-sized layer (see the zoom fix).
      let svg = this.h.canvas.querySelector('svg.gx-drag-layer') as SVGSVGElement | null;
      if (!svg) {
        svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'gx-drag-layer'); svg.setAttribute('width', '1'); svg.setAttribute('height', '1');
        this.h.canvas.appendChild(svg);
      }
      a.line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      a.line.setAttribute('class', 'gx-drag-line');
      const barRect = a.bar!.getBoundingClientRect();
      const x = (a.kind === 'link-end' ? barRect.right : barRect.left) - rect.left;
      a.line.setAttribute('x1', String(x)); a.line.setAttribute('y1', String(barRect.top + barRect.height / 2 - rect.top));
      svg.appendChild(a.line);
    }
    a.line.setAttribute('x2', String(a.lastX - rect.left)); a.line.setAttribute('y2', String(a.lastY - rect.top));
    const under = document.elementFromPoint(a.lastX, a.lastY)?.closest<HTMLElement>('.gx-bar[data-task]');
    this.h.canvas.querySelectorAll('.gx-link-target').forEach((n) => n.classList.remove('gx-link-target', 'gx-link-bad'));
    if (!under || under.dataset.task === a.id) { a.target = undefined; this.h.tip(a.lastX, a.lastY, null); return; }
    const tid = under.dataset.task!;
    const r = under.getBoundingClientRect();
    const toStart = a.lastX < r.left + r.width / 2;
    const fromEnd = a.kind === 'link-end';
    const type: LinkType = fromEnd ? (toStart ? 'FS' : 'FF') : (toStart ? 'SS' : 'SF');
    if (a.target?.id !== tid || a.target.type !== type) a.target = { id: tid, type, why: this.h.whyNotLink(a.id, tid, type) };
    under.classList.add('gx-link-target');
    if (a.target.why) under.classList.add('gx-link-bad');
    const name = this.h.task(tid)?.task.name ?? tid;
    this.h.tip(a.lastX, a.lastY, a.target.why ?? `${type}: ${this.h.task(a.id)?.task.name} → ${name}`);
    void sc;
  }

  /** Scrolls the chart while the pointer is near its edge (D17). */
  private autoScroll() {
    const a = this.a!;
    cancelAnimationFrame(a.raf);
    const tick = () => {
      if (this.a !== a) return;
      const r = this.h.chart.getBoundingClientRect();
      const vx = a.lastX < r.left + EDGE ? -12 : a.lastX > r.right - EDGE ? 12 : 0;
      const vy = a.lastY < r.top + EDGE ? -12 : a.lastY > r.bottom - EDGE ? 12 : 0;
      if (!vx && !vy) return;
      this.h.chart.scrollLeft += vx; this.h.chart.scrollTop += vy;
      this.update();
      a.raf = requestAnimationFrame(tick);
    };
    a.raf = requestAnimationFrame(tick);
  }

  /** Ends the drag; commits unless cancelled or not moved. Returns true when it was a drag (not a click). */
  end(cancel = false): boolean {
    const a = this.a; if (!a) return false;
    this.a = null;
    clearTimeout(a.timer); cancelAnimationFrame(a.raf);
    window.removeEventListener('keydown', this.onKey, true);
    for (const el of a.previewed) { el.style.transform = ''; el.classList.remove('gx-preview'); }
    if (a.bar) { a.bar.style.transform = a.barStyle!.transform; a.bar.style.width = a.barStyle!.width; a.bar.classList.remove('gx-drag-src', 'gx-drag-lane'); const f = a.bar.querySelector<HTMLElement>('.gx-progress'); if (f) f.style.width = a.barStyle!.fill; }
    a.line?.remove(); a.ghost?.remove(); this.h.canvas.querySelector('svg.gx-drag-layer')?.remove();
    this.h.canvas.querySelectorAll('.gx-link-target').forEach((n) => n.classList.remove('gx-link-target', 'gx-link-bad'));
    this.h.canvas.classList.remove('gx-dragging');
    this.h.tip(0, 0, null);
    if (!a.moved) return false;
    if (cancel) { this.h.announce('Drag cancelled'); return true; }
    const cal = this.h.calendar();
    const id = a.id;
    const t = this.h.task(id);
    switch (a.kind) {
      case 'move': {
        const s = cal.nextWorking(a.start + a.delta);
        const fields: Partial<Task> = {};
        if (s !== a.start) fields.start = fromDay(s);
        if (a.lane && a.lane !== t?.task.parent) fields.parent = a.lane;
        if (t?.task.end) (fields as Record<string, unknown>).end = null;
        if (fields.start || fields.parent) this.h.commit({ type: 'task.update', id, fields });
        break;
      }
      case 'end': {
        const e = Math.max(a.start, a.end + a.delta);
        const dur = Math.max(1, cal.workingDaysBetween(a.start, e));
        if (dur !== t?.duration) this.h.commit({ type: 'task.update', id, fields: { duration: dur, ...(t?.task.end ? { end: null as unknown as undefined } : {}) } });
        break;
      }
      case 'start': {
        const s = cal.nextWorking(Math.min(a.end, a.start + a.delta));
        if (s !== a.start) this.h.commit({ type: 'task.update', id, fields: { start: fromDay(s), duration: Math.max(1, cal.workingDaysBetween(s, a.end)), ...(t?.task.end ? { end: null as unknown as undefined } : {}) } });
        break;
      }
      case 'progress': {
        const w = (a.end - a.start + 1) * this.h.scale().pxPerDay;
        const dx = a.lastX - a.x0 + (this.h.chart.scrollLeft - a.scroll0);
        const p = Math.round(Math.max(0, Math.min(1, a.progress + dx / w)) * 20) / 20;
        if (p !== a.progress) this.h.commit({ type: 'task.update', id, fields: { progress: p } });
        break;
      }
      case 'link-start': case 'link-end': {
        if (!a.target) break;
        if (a.target.why) { this.h.announce(a.target.why); break; }
        this.h.commit({ type: 'link.create', link: { id: this.h.newId(), source: a.id, target: a.target.id, type: a.target.type } });
        break;
      }
      case 'create': {
        const from = Math.min(a.createDay!, a.createDay! + a.delta), to = Math.max(a.createDay!, a.createDay! + a.delta);
        const s = cal.nextWorking(from);
        this.h.commit({ type: 'task.create', task: { id: this.h.newId(), name: 'New task', type: 'task', parent: id, start: fromDay(s), duration: Math.max(1, cal.workingDaysBetween(s, to)) } });
        break;
      }
    }
    return true;
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.a) { e.preventDefault(); e.stopPropagation(); this.end(true); }
  };
}
