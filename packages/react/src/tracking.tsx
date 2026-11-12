import { memo } from 'react';
import type { ProgressPoint, SCurve } from '@gantt/engine';
import type { RowLayout, Scale } from '@gantt/state';
import { xOf } from '@gantt/state';
import { fmtDate } from './grid.tsx';
import { useI18n } from './i18n.ts';

/**
 * Tracking views (Phase 8): the S-curve (B2) and the progress line (B3). Both are drawn from the engine's
 * numbers; nothing here computes work.
 */

/** S-curve of planned, actual and baseline work, with the totals as text (they match the data). */
export function SCurveChart({ curve, statusDay, baselineName }: { curve: SCurve; statusDay: number; baselineName?: string }) {
  const { t: m, num, locale } = useI18n();
  const W = 640, H = 200, P = { l: 44, r: 12, t: 10, b: 24 };
  const n = curve.days.length;
  if (!n) return <p className="gx-muted">—</p>;
  const max = Math.max(curve.totals.planned, curve.totals.baseline ?? 0, curve.totals.actual, 1);
  // At most ~200 points per series.
  const step = Math.max(1, Math.ceil(n / 200));
  const x = (i: number) => P.l + (i / Math.max(1, n - 1)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - v / max) * (H - P.t - P.b);
  const path = (vals: (number | null)[]) => {
    const pts: string[] = [];
    for (let i = 0; i < n; i += step) { const v = vals[i]; if (v != null) pts.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`); }
    const last = vals[n - 1]; if (last != null && (n - 1) % step) pts.push(`${x(n - 1).toFixed(1)},${y(last).toFixed(1)}`);
    // The actual curve ends exactly on the status date.
    const si = curve.days.indexOf(statusDay);
    if (vals === curve.actual && si >= 0 && vals[si] != null && si % step) pts.push(`${x(si).toFixed(1)},${y(vals[si]!).toFixed(1)}`);
    return pts.join(' ');
  };
  const si = Math.max(0, Math.min(n - 1, statusDay - curve.days[0]!));
  const total = (v: number) => num(Math.round(v * 10) / 10);
  return (
    <figure className="gx-scurve-fig">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={m.sCurveTitle} className="gx-scurve-svg">
        {[0, 0.5, 1].map((f) => <g key={f}><line x1={P.l} x2={W - P.r} y1={y(max * f)} y2={y(max * f)} className="gx-sc-grid" /><text x={P.l - 6} y={y(max * f) + 4} textAnchor="end" className="gx-sc-axis">{total(max * f)}</text></g>)}
        <text x={P.l} y={H - 6} className="gx-sc-axis">{fmtDate(curve.days[0]!, locale)}</text>
        <text x={W - P.r} y={H - 6} textAnchor="end" className="gx-sc-axis">{fmtDate(curve.days[n - 1]!, locale)}</text>
        <line x1={x(si)} x2={x(si)} y1={P.t} y2={H - P.b} className="gx-sc-status" />
        {curve.baseline && <polyline points={path(curve.baseline)} className="gx-sc-baseline" />}
        <polyline points={path(curve.planned)} className="gx-sc-planned" />
        <polyline points={path(curve.actual)} className="gx-sc-actual" />
      </svg>
      <figcaption className="gx-sc-legend">
        <span><i className="gx-sc-key gx-sc-planned" />{m.planned}: <strong data-total="planned">{total(curve.totals.planned)}</strong></span>
        <span><i className="gx-sc-key gx-sc-actual" />{m.actual}: <strong data-total="actual">{total(curve.totals.actual)}</strong></span>
        {curve.baseline && <span><i className="gx-sc-key gx-sc-baseline" />{baselineName ?? m.baselineLabel}: <strong data-total="baseline">{total(curve.totals.baseline ?? 0)}</strong></span>}
        <span className="gx-muted">{m.statusDate}: {fmtDate(statusDay, locale)}</span>
      </figcaption>
    </figure>
  );
}

/**
 * Progress line (B3) through the drawn rows: at the status date for rows without a point, bending to each
 * task's progress; dots say ahead, behind or on track.
 */
export const ProgressLineLayer = memo(function ProgressLineLayer({ rows, points, scale, statusDay, win }: {
  rows: RowLayout[]; points: ReadonlyMap<string, ProgressPoint>; scale: Scale; statusDay: number; win: { y: number; h: number };
}) {
  const { t: m } = useI18n();
  if (!rows.length) return null;
  const sx = xOf(scale, statusDay + 1);
  const pts: string[] = [];
  const dots: { x: number; y: number; p: ProgressPoint }[] = [];
  for (const r of rows) {
    const p = r.lane ? undefined : points.get(r.taskId);
    const cy = r.top + r.height / 2;
    const px = p ? xOf(scale, p.day) : sx;
    pts.push(`${sx},${r.top}`, `${px},${cy}`, `${sx},${r.top + r.height}`);
    if (p && p.status !== 'onTrack') dots.push({ x: px, y: cy, p });
  }
  const left = Math.min(...pts.map((s) => +s.split(',')[0]!)) - 8, right = Math.max(...pts.map((s) => +s.split(',')[0]!)) + 8;
  return (
    <svg className="gx-progress-line" style={{ left, top: win.y }} width={Math.max(1, right - left)} height={Math.max(1, win.h)}
      viewBox={`${left} ${win.y} ${Math.max(1, right - left)} ${Math.max(1, win.h)}`} aria-hidden>
      <polyline points={pts.join(' ')} />
      {dots.map((d) => <circle key={d.p.taskId} data-task={d.p.taskId} cx={d.x} cy={d.y} r={4} className={`gx-pl-${d.p.status}`}><title>{m.progressStatus[d.p.status]}</title></circle>)}
    </svg>
  );
});
