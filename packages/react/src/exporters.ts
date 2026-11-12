import type { RoadmapDocument } from '@gantt/contract';
import { fromDay } from '@gantt/engine';
import { changesBetween } from '@gantt/proposals';
import { barIndex, linkPath, ticks, totalHeight, xOf, type DataOperation, type Model, type RowLayout, type ZoomLevel } from '@gantt/state';

/**
 * Export to images and documents (I2), and turning an imported file into operations (I1, I4).
 * Images are drawn from the model, not copied from the screen, so they cover the whole roadmap at the
 * chosen zoom regardless of what is scrolled into view, and look the same in every browser.
 */

export interface ImageOptions {
  rows: RowLayout[];
  model: Model;
  level: ZoomLevel;
  locale?: string;
  title: string;
  /** Width of the task-name column in CSS pixels. */
  nameWidth?: number;
  /** Device pixels per CSS pixel (2 gives a sharp image on high-density screens and in print). */
  pixelRatio?: number;
  /** Colours, read from the component's CSS variables so the image matches the theme. */
  colors: { bg: string; text: string; muted: string; grid: string; bar: string; summary: string; milestone: string; link: string; today: string };
  today?: number;
}

/** Largest canvas side browsers accept reliably; wider roadmaps are drawn at a smaller zoom to fit. */
const MAX_SIDE = 16_000;

/** Draws the roadmap (grid names, scale, bars, links, today) on a new canvas. */
export function renderChartImage(o: ImageOptions): HTMLCanvasElement {
  const span = o.model.placement.span;
  const first = (span?.start ?? 0) - 7, last = (span?.end ?? first + 30) + 7;
  const nameW = o.nameWidth ?? 240, headH = 64, scaleH = 40;
  // Shrink the scale (not the text) when the timeline would be wider than a canvas allows.
  const px = Math.min(o.level.pxPerDay, (MAX_SIDE - nameW) / (last - first + 1));
  const scale = { origin: first, pxPerDay: px };
  const W = Math.ceil(nameW + (last - first + 1) * px), H = Math.ceil(headH + scaleH + totalHeight(o.rows));
  const ratio = Math.min(o.pixelRatio ?? 2, MAX_SIDE / Math.max(W, H));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * ratio); canvas.height = Math.round(H * ratio);
  const g = canvas.getContext('2d')!;
  g.scale(ratio, ratio);
  const c = o.colors;
  g.fillStyle = c.bg; g.fillRect(0, 0, W, H);
  g.textBaseline = 'middle';
  // Title.
  g.fillStyle = c.text; g.font = '600 18px system-ui, sans-serif'; g.fillText(o.title, 16, 24);
  g.font = '12px system-ui, sans-serif'; g.fillStyle = c.muted;
  if (span) g.fillText(`${fromDay(span.start)} – ${fromDay(span.end)}`, 16, 46);
  // Scale: two lines, and gridlines down the chart.
  const top = headH, body = headH + scaleH;
  g.save(); g.translate(nameW, 0);
  for (const [unit, y] of [[o.level.major, top], [o.level.minor, top + scaleH / 2]] as const) {
    for (const t of ticks(scale, unit, first, last, o.locale)) {
      const x = xOf(scale, t.day);
      g.strokeStyle = c.grid; g.beginPath(); g.moveTo(x + 0.5, y); g.lineTo(x + 0.5, unit === o.level.minor ? H : y + scaleH / 2); g.stroke();
      if (t.w > 24) { g.fillStyle = c.muted; g.fillText(t.label, x + 4, y + scaleH / 4, Math.max(0, t.w - 8)); }
    }
  }
  g.restore();
  g.strokeStyle = c.grid; g.beginPath(); g.moveTo(0, body + 0.5); g.lineTo(W, body + 0.5); g.moveTo(nameW + 0.5, top); g.lineTo(nameW + 0.5, H); g.stroke();
  // Rows: names on the left, row lines across.
  for (const r of o.rows) {
    const t = o.model.tasks.get(r.taskId); if (!t) continue;
    const y = body + r.top;
    g.strokeStyle = c.grid; g.beginPath(); g.moveTo(0, y + r.height + 0.5); g.lineTo(W, y + r.height + 0.5); g.stroke();
    g.fillStyle = c.text; g.font = `${r.hasChildren ? '600 ' : ''}12px system-ui, sans-serif`;
    g.fillText(t.name, 8 + r.depth * 14, y + Math.min(r.height, 36) / 2, nameW - 16 - r.depth * 14);
  }
  // Links under bars.
  const bars = barIndex(o.rows);
  g.save(); g.translate(nameW, body); g.strokeStyle = c.link; g.lineWidth = 1.2;
  for (const l of o.model.doc.links) {
    const d = linkPath(l, o.model.placement, bars, scale); if (!d) continue;
    g.stroke(new Path2D(d));
  }
  g.restore();
  // Bars.
  g.save(); g.translate(nameW, body);
  for (const [id, pos] of bars) {
    const p = o.model.placement.byId.get(id); if (!p?.scheduled) continue;
    const x = xOf(scale, p.start!), w = Math.max(2, (p.end! - p.start! + (p.endFraction ?? 1)) * px);
    const summary = p.task.type === 'summary' || (!pos.row.lane && (o.model.children.get(id)?.length ?? 0) > 0);
    if (p.task.type === 'milestone') {
      const s = pos.h * 0.8, cx = x + px / 2, cy = pos.y + pos.h / 2;
      g.fillStyle = c.milestone; g.beginPath(); g.moveTo(cx, cy - s / 2); g.lineTo(cx + s / 2, cy); g.lineTo(cx, cy + s / 2); g.lineTo(cx - s / 2, cy); g.closePath(); g.fill();
      continue;
    }
    if (summary) { g.fillStyle = c.summary; g.fillRect(x, pos.y + pos.h / 2 - 3, w, 6); continue; }
    g.fillStyle = c.bar; g.globalAlpha = 0.45; g.fillRect(x, pos.y, w, pos.h); g.globalAlpha = 1;
    g.fillRect(x, pos.y, w * p.progress, pos.h);
    if (w > 50) { g.fillStyle = '#fff'; g.font = '11px system-ui, sans-serif'; g.fillText(p.task.name, x + 4, pos.y + pos.h / 2, w - 8); }
  }
  if (o.today !== undefined && o.today >= first && o.today <= last) { g.fillStyle = c.today; g.fillRect(xOf(scale, o.today), -scaleH, 2, H); }
  g.restore();
  return canvas;
}

export const canvasBlob = (c: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('the image could not be created'))), type, quality));

/**
 * A one-page PDF holding a JPEG image at its natural size (I2). PDF can carry JPEG data unchanged
 * (DCTDecode), so no PDF library is needed; the page is sized to the image, in points.
 */
export function pdfFromJpeg(jpeg: Uint8Array, widthPx: number, heightPx: number, title: string): Blob {
  const w = Math.round(widthPx * 0.75), h = Math.round(heightPx * 0.75); // CSS px → pt at 96 dpi
  const enc = new TextEncoder();
  const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
  const esc = (s: string) => s.replace(/[\\()]/g, (m) => `\\${m}`).replace(/[^\x20-\x7e]/g, '?');
  const objs: (string | [string, Uint8Array, string])[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
    [`<< /Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, '\nendstream'],
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    `<< /Title (${esc(title)}) /Producer (Gantt) >>`,
  ];
  const chunks: Uint8Array[] = [enc.encode('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')];
  let size = chunks[0]!.length;
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(size);
    const parts = typeof o === 'string' ? [enc.encode(`${i + 1} 0 obj\n${o}\nendobj\n`)] : [enc.encode(`${i + 1} 0 obj\n${o[0]}`), o[1], enc.encode(`${o[2]}\nendobj\n`)];
    for (const p of parts) { chunks.push(p); size += p.length; }
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  chunks.push(enc.encode(`${xref}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${objs.length} 0 R >>\nstartxref\n${size}\n%%EOF\n`));
  return new Blob(chunks as BlobPart[], { type: 'application/pdf' });
}

/** Saves a file through the browser's download. */
export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.style.display = 'none';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * An imported roadmap as one batch of operations against the current one (I1, I4): it then goes through
 * the same pipeline as any edit (permissions, validation, undo), and in the Proposal workflow into a
 * Proposal, never into Current.
 */
export function importOperations(current: RoadmapDocument, imported: RoadmapDocument, carried?: { task: string[]; link: string[] }): DataOperation[] {
  return changesBetween(current, reconcile(current, imported, carried)).map((c): DataOperation => {
    if (c.entity === 'task') {
      if (c.op === 'create') return { type: 'task.create', task: { id: c.id, ...(c.fields as object) } as never };
      if (c.op === 'delete') return { type: 'task.delete', id: c.id };
      return { type: 'task.update', id: c.id, fields: c.fields as never };
    }
    if (c.op === 'create') return { type: 'link.create', link: { id: c.id, ...(c.fields as object) } as never };
    if (c.op === 'delete') return { type: 'link.delete', id: c.id };
    return { type: 'link.update', id: c.id, fields: c.fields as never };
  });
}

/**
 * Makes an imported file comparable with the roadmap, so only real differences become changes: a link
 * between the same two tasks keeps its existing id (files do not carry link ids), and where the file keeps
 * the same sibling order, each task keeps the order field it had (files number every row).
 */
export function reconcile(current: RoadmapDocument, imported: RoadmapDocument, carried?: { task: string[]; link: string[] }): RoadmapDocument {
  const linkKey = (l: { source: string; target: string }) => `${l.source}\u0000${l.target}`;
  const existing = new Map(current.links.map((l) => [linkKey(l), l.id]));
  const curLinks = new Map(current.links.map((l) => [l.id, l]));
  // Fields the format does not carry are kept from the roadmap, so an import never wipes them.
  const keep = <T extends object>(old: T | undefined, now: T, fields?: string[]): T => {
    if (!old || !fields) return now;
    const kept = Object.fromEntries(Object.entries(old).filter(([k]) => !fields.includes(k) && k !== 'id'));
    return { ...kept, ...now };
  };
  const links = imported.links.map((l) => { const id = existing.get(linkKey(l)) ?? l.id; return keep(curLinks.get(id), { ...l, id }, carried?.link); });
  const siblings = (d: RoadmapDocument) => {
    const pos = new Map(d.tasks.map((t, i) => [t.id, i]));
    const m = new Map<string | null, string[]>();
    for (const t of [...d.tasks].sort((a, b) => (a.order ?? pos.get(a.id)!) - (b.order ?? pos.get(b.id)!) || pos.get(a.id)! - pos.get(b.id)!)) (m.get(t.parent) ?? m.set(t.parent, []).get(t.parent)!).push(t.id);
    return m;
  };
  const a = siblings(current), b = siblings(imported);
  const same = (p: string | null) => JSON.stringify(a.get(p) ?? []) === JSON.stringify(b.get(p) ?? []);
  const cur = new Map(current.tasks.map((t) => [t.id, t]));
  const tasks = imported.tasks.map((t) => {
    const c = cur.get(t.id);
    t = keep(c, t, carried?.task);
    if (!c || c.parent !== t.parent || !same(t.parent)) return t;
    const { order: _o, ...rest } = t; void _o;
    return c.order === undefined ? rest : { ...rest, order: c.order };
  });
  return { ...imported, tasks, links };
}
