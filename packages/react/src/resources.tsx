import { memo } from 'react';
import type { ResourceLoad } from '@gantt/engine';
import { xOf, type Scale } from '@gantt/state';
import { fmtDate } from './grid.tsx';
import { useI18n } from './i18n.ts';

/**
 * Resource load (E3, E4, E7) under the chart, on the same time scale: one row per resource (or the total
 * demand and one row per owner without resource data). Bars show demand per period; the dashed line is
 * capacity; periods with over-allocated days are red. Resource names can be dragged onto bars (E2).
 */
export const LoadPanel = memo(function LoadPanel({ load, scale, labelWidth, innerRef, chartWidth, chartVisible }: {
  load: ResourceLoad; scale: Scale; labelWidth: number; innerRef: React.RefObject<HTMLDivElement | null>; chartWidth: number; chartVisible: number;
}) {
  const { t: m, num, locale } = useI18n();
  const H = 40;
  const label = (key: string, l: string) => (key === 'total' ? m.totalDemand : key === 'unassigned' ? m.unassigned : l);
  return (
    <div className="gx-load" role="region" aria-label={m.loadTitle}>
      {load.defaultDemand && <div className="gx-load-note gx-muted">{m.defaultDemandNote}</div>}
      <div className="gx-load-body">
        <div className="gx-load-labels" style={{ width: labelWidth }}>
          {load.rows.map((r) => (
            <div key={r.key} className="gx-load-label" style={{ height: H }} data-row={r.key}
              draggable={r.kind === 'resource'} title={r.kind === 'resource' ? m.dragToAssign : undefined}
              onDragStart={(e) => { e.dataTransfer.setData('application/x-gantt-resource', r.key.slice(2)); e.dataTransfer.effectAllowed = 'copy'; }}>
              {r.kind === 'resource' && <span className="gx-grip-dots" aria-hidden>⠿</span>}
              <span>{label(r.key, r.label)}</span>
              {r.capacityFte !== null && <span className="gx-muted"> · {num(r.capacityFte)} FTE</span>}
            </div>
          ))}
        </div>
        <div className="gx-load-chart" style={{ width: chartVisible || undefined }}>
          <div ref={innerRef} style={{ width: chartWidth, position: 'relative', height: load.rows.length * H }}>
            {load.rows.map((r, i) => {
              const max = Math.max(1e-9, ...r.buckets.map((b) => Math.max(b.demand, b.capacity ?? 0)));
              return r.buckets.map((b) => {
                if (!b.demand && !b.capacity) return null;
                const x = xOf(scale, b.start), w = Math.max(1, (b.end - b.start + 1) * scale.pxPerDay - 1);
                const h = (b.demand / max) * (H - 8), ch = b.capacity === null ? null : (b.capacity / max) * (H - 8);
                const tip = m.loadTip(label(r.key, r.label), fmtDate(b.start, locale), num(Math.round(b.demand * 10) / 10), b.capacity === null ? null : num(Math.round(b.capacity * 10) / 10), num(b.overDays));
                return (
                  <div key={r.key + b.start} className="gx-load-cell" style={{ left: x, top: i * H, width: w, height: H }} title={tip} data-row={r.key} data-over={b.overDays || undefined}>
                    <div className={`gx-load-bar${b.overDays ? ' gx-over' : ''}`} style={{ height: h }} />
                    {ch !== null && <div className="gx-load-cap" style={{ bottom: ch + 2 }} />}
                  </div>
                );
              });
            })}
          </div>
        </div>
      </div>
    </div>
  );
});

export interface BacklogItem { id: string; name: string; duration?: number; kind?: string }

/** Work not yet planned (D5): drag an item onto the chart to create the task where it is dropped. */
export function Backlog({ items }: { items: BacklogItem[] }) {
  const { t: m, num } = useI18n();
  return (
    <div className="gx-backlog" role="region" aria-label={m.backlog}>
      <strong>{m.backlog}</strong> <span className="gx-muted">{m.backlogHint}</span>
      <ul className="gx-backlog-list">
        {items.map((it) => (
          <li key={it.id} className="gx-chip gx-backlog-item" draggable data-backlog={it.id}
            onDragStart={(e) => { e.dataTransfer.setData('application/x-gantt-backlog', it.id); e.dataTransfer.effectAllowed = 'copy'; }}>
            {it.name}{it.duration ? ` · ${num(it.duration)} d` : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}
