import { memo, useRef, useState, type ComponentType, type CSSProperties, type ReactNode } from 'react';
import type { Task } from '@gantt/contract';
import type { DayNum, PlacedTask } from '@gantt/engine';
import { formatDay, isGroupId, type ColumnState, type Model, type RowLayout, type ViewSort } from '@gantt/state';
import { useI18n, type GanttMessages, type I18n } from './i18n.ts';
import type { Api, Block, Ctx } from './Gantt.tsx';

export const fmtDate = (d: DayNum, locale?: string) => formatDay(d, locale, { day: 'numeric', month: 'short', year: '2-digit' });

/** What a cell template receives (G7). */
export interface CellProps { task: Task; placed: PlacedTask; row: RowLayout; model: Model; i18n: I18n }

/**
 * A grid column (D18). Built-in columns cover the common fields; the host adds its own (custom fields)
 * and may replace any cell with a template (G7).
 */
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

const ACTION = 'add';

export function builtinColumns(m: GanttMessages): GridColumn[] {
  return [
    { id: 'wbs', label: m.colWbs, width: 56, minWidth: 40, field: 'wbs', text: ({ row }) => row.wbs },
    { id: 'name', label: m.colName, width: 150, minWidth: 100, field: 'name' },
    { id: 'start', label: m.colStart, width: 90, minWidth: 70, field: 'start', text: ({ placed, i18n }) => placed.scheduled ? fmtDate(placed.start!, i18n.locale) : <em className="gx-muted">{i18n.t.unscheduled}</em> },
    { id: 'end', label: m.colEnd, width: 90, minWidth: 70, field: 'end', hidden: true, text: ({ placed, i18n }) => placed.scheduled ? fmtDate(placed.end!, i18n.locale) : '' },
    { id: 'duration', label: m.colDays, width: 48, minWidth: 40, field: 'duration', align: 'end', text: ({ placed, task, i18n }) => !placed.scheduled ? '' : task.durationUnit === 'hour' ? `${i18n.num(task.duration ?? 0)} h` : i18n.num(placed.duration ?? 0) },
    { id: 'progress', label: m.colProgress, width: 56, minWidth: 44, field: 'progress', align: 'end', hidden: true, text: ({ placed, task, i18n }) => task.type === 'milestone' || !placed.scheduled ? '' : i18n.pct(placed.progress) },
    { id: 'owner', label: m.colOwner, width: 80, minWidth: 50, field: 'owner', hidden: true, text: ({ task }) => task.owner ?? '' },
    { id: 'kind', label: m.colKind, width: 80, minWidth: 50, field: 'kind', hidden: true, text: ({ task }) => task.kind ?? '' },
    { id: ACTION, label: m.colAdd, width: 30, minWidth: 30 },
  ];
}

/** Columns in the order and widths the view says, with the rest after them (hidden unless shown). */
export function resolveColumns(all: GridColumn[], state: ColumnState[] | undefined): GridColumn[] {
  if (!state?.length) return all.filter((c) => !c.hidden);
  const byId = new Map(all.map((c) => [c.id, c]));
  const out: GridColumn[] = [];
  for (const s of state) {
    const c = byId.get(s.id); if (!c) continue;
    byId.delete(s.id);
    if (!s.hidden) out.push({ ...c, width: s.width ?? c.width });
  }
  // Columns the view does not mention: new ones appear unless hidden by default; the action column stays last.
  for (const c of byId.values()) if (!c.hidden) out.push(c);
  const act = out.findIndex((c) => c.id === ACTION);
  if (act >= 0 && act !== out.length - 1) out.push(...out.splice(act, 1));
  return out;
}

/** Full column state (every column, in display order) so a view can be stored and restored exactly. */
export function columnState(all: GridColumn[], shown: GridColumn[]): ColumnState[] {
  const ids = new Set(shown.map((c) => c.id));
  return [...shown.map((c) => ({ id: c.id, width: c.width })), ...all.filter((c) => !ids.has(c.id)).map((c) => ({ id: c.id, hidden: true }))];
}

export const gridTemplate = (cols: GridColumn[]) => cols.map((c) => (c.id === 'name' ? `minmax(${c.width}px, 1fr)` : `${c.width}px`)).join(' ');
export const gridWidth = (cols: GridColumn[]) => cols.reduce((s, c) => s + c.width, 0);

/** Left offsets of the frozen columns (sticky while the grid scrolls sideways). */
export function frozenStyle(cols: GridColumn[], frozen: number, i: number): CSSProperties | undefined {
  if (i >= frozen) return undefined;
  let left = 0; for (let k = 0; k < i; k++) left += cols[k]!.width;
  return { position: 'sticky', left, zIndex: 1 };
}

export interface HeaderProps {
  cols: GridColumn[];
  frozen: number;
  sort?: ViewSort;
  onSort: (col: GridColumn) => void;
  onResize: (id: string, width: number) => void;
  onReorder: (id: string, before: string | null) => void;
  onMenu: (col: GridColumn, x: number, y: number) => void;
}

export function GridHeader({ cols, frozen, sort, onSort, onResize, onReorder, onMenu }: HeaderProps) {
  const { t: m } = useI18n();
  const [dragOver, setDragOver] = useState<string | null>(null);
  const resizing = useRef<{ id: string; x: number; w: number; min: number } | null>(null);
  return <>{cols.map((c, i) => {
    const sorted = sort && c.field && sort.field === c.field ? sort.dir : undefined;
    const st: CSSProperties = { ...frozenStyle(cols, frozen, i), ...(c.align === 'end' ? { textAlign: 'right' } : {}) };
    return (
      <span key={c.id} role="columnheader" className={`gx-col-${c.id} gx-colhead${dragOver === c.id ? ' gx-drop-before' : ''}${i < frozen ? ' gx-frozen' : ''}`} style={st}
        aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
        draggable={c.id !== ACTION} data-col={c.id}
        onDragStart={(e) => {
          // A resize starts on the handle inside the header: that is not a column move.
          if (resizing.current || (e.target as HTMLElement).closest?.('.gx-col-resize')) { e.preventDefault(); return; }
          e.dataTransfer.setData('application/x-gantt-col', c.id); e.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-gantt-col')) { e.preventDefault(); setDragOver(c.id); } }}
        onDragLeave={() => setDragOver((d) => (d === c.id ? null : d))}
        onDrop={(e) => { e.preventDefault(); setDragOver(null); const id = e.dataTransfer.getData('application/x-gantt-col'); if (id && id !== c.id) onReorder(id, c.id); }}
        onContextMenu={(e) => { if (c.id === ACTION) return; e.preventDefault(); onMenu(c, e.clientX, e.clientY); }}>
        {c.field
          ? <button className="gx-colhead-btn" onClick={() => onSort(c)} title={m.sortAsc}>{c.label}{sorted && <span aria-hidden className="gx-sort-ind">{sorted === 'asc' ? ' ▲' : ' ▼'}</span>}</button>
          : c.id === ACTION ? <span className="gx-sr">{c.label}</span> : <span>{c.label}</span>}
        {c.id !== ACTION && <button className="gx-colmenu-btn" aria-label={m.columnMenu(c.label)} aria-haspopup="menu" tabIndex={-1}
          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); onMenu(c, r.left, r.bottom); }}>▾</button>}
        {c.id !== ACTION && <span className="gx-col-resize" role="separator" aria-orientation="vertical" aria-label={m.resizeColumn(c.label)} tabIndex={0}
          aria-valuenow={c.width} aria-valuemin={c.minWidth ?? 30}
          onKeyDown={(e) => { if (e.key === 'ArrowLeft') onResize(c.id, Math.max(c.minWidth ?? 30, c.width - 10)); if (e.key === 'ArrowRight') onResize(c.id, c.width + 10); }}
          onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); (e.target as HTMLElement).setPointerCapture(e.pointerId); resizing.current = { id: c.id, x: e.clientX, w: c.width, min: c.minWidth ?? 30 }; }}
          onPointerMove={(e) => { const r = resizing.current; if (r) onResize(r.id, Math.max(r.min, Math.round(r.w + e.clientX - r.x))); }}
          onPointerUp={() => { resizing.current = null; }} onPointerCancel={() => { resizing.current = null; }}
          draggable onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }} />}
      </span>
    );
  })}</>;
}

/** The name cell: tree indent, expander, kind icon, inline editor and status badges. */
function NameCell({ r, t, ctx, api }: { r: RowLayout; t: Task; ctx: Ctx; api: Api }) {
  const { kinds, laneOpen, loadState, compare, editing } = ctx;
  const { t: m, num } = useI18n();
  const kind = t.kind ? kinds?.rows?.[t.kind] : undefined;
  return <>
    {r.hasChildren ? (
      <button className="gx-twisty" tabIndex={-1} aria-label={r.lane ? m.openLane : r.expanded ? m.collapse : m.expand}
        onClick={(e) => { e.stopPropagation(); r.lane ? api.toggleLane(r.taskId) : api.toggle(r.taskId); }}>
        {r.lane ? '≡' : r.expanded ? '▾' : '▸'}
      </button>
    ) : <span className="gx-twisty-sp" />}
    {kind?.icon ? <span className="gx-kind-icon" aria-hidden>{kind.icon}</span> : null}
    {editing === r.taskId
      ? <input className="gx-inline-edit" defaultValue={t.name} aria-label={m.colName} autoFocus
          onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') api.finishEdit(r.taskId, e.currentTarget.value); if (e.key === 'Escape') api.finishEdit(r.taskId, null); }}
          onBlur={(e) => api.finishEdit(r.taskId, e.currentTarget.value === t.name ? null : e.currentTarget.value)} />
      : <span className={`gx-name-text${isGroupId(t.id) ? ' gx-group-name' : ''}`} title={t.name} onDoubleClick={(e) => { e.stopPropagation(); api.startEdit(r.taskId); }}>{t.name}</span>}
    {compare?.diff.has(r.taskId) && <span className={`gx-badge gx-diff-badge-${compare.diff.get(r.taskId)}`}>{compare.diff.get(r.taskId) === 'added' ? m.diffAdded : m.diffChanged}</span>}
    {loadState.get(r.taskId) === 'loading' && <span className="gx-badge" role="status">{m.loadingChildren}</span>}
    {loadState.has(r.taskId) && loadState.get(r.taskId) !== 'loading' && <span className="gx-badge gx-badge-error" title={m.loadFailed(loadState.get(r.taskId)!)} role="status">⚠<span className="gx-sr">{m.loadFailed(loadState.get(r.taskId)!)}</span></span>}
    {ctx.flags?.has(r.taskId) && <span className="gx-badge gx-flag" title={ctx.flags.get(r.taskId)} role="img" aria-label={ctx.flags.get(r.taskId)}>⚠</span>}
    {r.lane && <span className="gx-badge" title={m.laneBarsHint}>{m.laneBars(num(r.bars.length))}</span>}
    {laneOpen.has(r.taskId) && <button className="gx-twisty gx-relane" tabIndex={-1} aria-label={m.closeLane} onClick={(e) => { e.stopPropagation(); api.toggleLane(r.taskId); }}>⇤</button>}
  </>;
}

export const GridBlock = memo(function GridBlock({ block, ctx, api, focusRow }: { block: Block; ctx: Ctx; api: Api; focusRow: number }) {
  const { model, selKeys, linkMarked, compare, cols, frozen, matches } = ctx;
  const i18n = useI18n();
  const m = i18n.t;
  return <>{block.rows.map((r, k) => {
    const i = block.start + k;
    const t = model.tasks.get(r.taskId)!;
    const p = model.placement.byId.get(r.taskId)!;
    const group = isGroupId(r.taskId);
    const selected = selKeys.has(`row:${r.taskId}`) || (!r.lane && selKeys.has(`bar:${r.taskId}`));
    const cellProps: CellProps = { task: t, placed: p, row: r, model, i18n };
    return (
      <div key={r.taskId} data-row={i} data-task={r.taskId} role="row" aria-level={r.depth + 1} aria-rowindex={i + 2}
        aria-expanded={r.hasChildren && !r.lane ? r.expanded : undefined} aria-selected={selected}
        tabIndex={i === focusRow || (focusRow < 0 && i === 0) ? 0 : -1}
        className={`gx-row${selected ? ' gx-sel' : ''}${linkMarked.has(r.taskId) ? ' gx-marked' : ''}${i === focusRow ? ' gx-focus' : ''}${r.lane ? ' gx-lane' : ''}${group ? ' gx-group' : ''}${matches && !matches.has(r.taskId) && !group ? ' gx-context' : ''}${ctx.flags?.has(r.taskId) ? ' gx-flagged' : ''}${compare?.diff.has(r.taskId) ? ` gx-diff-${compare.diff.get(r.taskId)}` : ''}`}
        style={{ top: r.top, height: r.height }}
        onFocus={() => api.focus(i, -1)}
        onPointerDown={(e) => api.rowPointerDown(e, i, r.taskId)}
        onContextMenu={(e) => { e.preventDefault(); api.menu(e.clientX, e.clientY, { type: 'row', taskId: r.taskId }); }}
        onClick={(e) => { api.focus(i, -1); api.select({ type: 'row', taskId: r.taskId }, e.ctrlKey || e.metaKey, e.shiftKey ? i : undefined); }}>
        {cols.map((c, ci) => {
          const st = frozenStyle(cols, frozen, ci);
          const cls = `gx-col-${c.id}${ci < frozen ? ' gx-frozen' : ''}`;
          if (c.id === 'name') return <span key={c.id} className={cls} role="gridcell" style={{ ...st, paddingLeft: 6 + r.depth * 16 }}>
            {c.cell && !group ? <c.cell {...cellProps} /> : <NameCell r={r} t={t} ctx={ctx} api={api} />}
          </span>;
          if (c.id === ACTION) return <span key={c.id} className={cls} role="gridcell" style={st}>
            {!group && <button className="gx-add-btn" tabIndex={-1} aria-label={m.addBelow(t.name)} title={m.addBelow(t.name)}
              onClick={(e) => { e.stopPropagation(); api.addBelow(r.taskId); }}>+</button>}
          </span>;
          if (c.id === 'wbs') return <span key={c.id} className={`${cls} gx-grip`} role="gridcell" style={st} title={group ? undefined : m.reorderRow}>{group ? '' : r.wbs}</span>;
          return <span key={c.id} className={cls} role="gridcell" style={{ ...st, ...(c.align === 'end' ? { textAlign: 'right' } : {}) }}>
            {group ? null : c.cell ? <c.cell {...cellProps} /> : c.text?.(cellProps) ?? String((t as Record<string, unknown>)[c.field ?? c.id] ?? '')}
          </span>;
        })}
      </div>
    );
  })}</>;
});

/** Quick entry (D4): a row at the end of the grid where typing a name and pressing Enter adds a task. */
export function PlaceholderRow({ top, height, rowIndex, why, onAdd }: { top: number; height: number; rowIndex: number; why: string | null; onAdd: (name: string) => void }) {
  const { t: m } = useI18n();
  return (
    <div className="gx-row gx-placeholder" style={{ top, height }} role="row" aria-rowindex={rowIndex}>
      <span role="gridcell" className="gx-placeholder-cell">
        <input className="gx-input gx-placeholder-input" placeholder={m.addPlaceholder} aria-label={m.addPlaceholder}
          aria-disabled={why ? true : undefined} title={why ?? undefined} readOnly={!!why}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && e.currentTarget.value.trim() && !why) { onAdd(e.currentTarget.value.trim()); e.currentTarget.value = ''; }
            if (e.key === 'Escape') e.currentTarget.value = '';
          }} />
      </span>
    </div>
  );
}
