import { memo, type ComponentType, type ReactNode } from 'react';
import type { Link, Task } from '@gantt/contract';
import { describeLink, type Model, type SelectionTarget } from '@gantt/state';
import type { DayNum } from '@gantt/engine';

export interface DetailsProps<T> {
  item: T;
  model: Model;
  select: (t: SelectionTarget) => void;
  canEdit: (field: string) => boolean;
  Default: ComponentType;
}
export interface KindDefinition<T> {
  label: string;
  icon?: ReactNode;
  /** Replace the default details with the host's own component (which may render `Default`). */
  details?: ComponentType<DetailsProps<T>>;
}
export interface GanttKinds {
  rows?: Record<string, KindDefinition<Task>>;
  links?: Record<string, KindDefinition<Link>>;
}

interface Props {
  model: Model;
  selection: SelectionTarget[];
  kinds?: GanttKinds;
  locale?: string;
  select: (t: SelectionTarget) => void;
  visibleIds: Map<string, number>;
  barIds: Map<string, unknown>;
}

import { formatDay } from '@gantt/state';
const fmt = (d: DayNum | undefined, locale?: string) =>
  d === undefined ? '—' : formatDay(d, locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const pct = (v: number) => `${Math.round(v * 100)}%`;
const readOnly = () => false; // Phase 1: the panel is read-only.

export const DetailsPanel = memo(function DetailsPanel({ model, selection, kinds, locale, select, barIds }: Props) {
  const primary = selection[selection.length - 1];
  let body: ReactNode;
  if (!primary) body = <RoadmapSummary model={model} locale={locale} />;
  else if (selection.length > 1) body = <Multi model={model} selection={selection} locale={locale} />;
  else if (primary.type === 'link') {
    const l = model.doc.links.find((x) => x.id === primary.linkId);
    if (!l) body = <p className="gx-muted">This connector no longer exists.</p>;
    else {
      const Default = () => <LinkDetails link={l} model={model} select={select} kinds={kinds} />;
      const Custom = l.kind ? kinds?.links?.[l.kind]?.details : undefined;
      body = Custom ? <Custom item={l} model={model} select={select} canEdit={readOnly} Default={Default} /> : <Default />;
    }
  } else {
    const t = model.tasks.get(primary.taskId);
    if (!t) body = <p className="gx-muted">This task no longer exists.</p>;
    else {
      const Default = () => <TaskDetails task={t} model={model} select={select} locale={locale} kinds={kinds} />;
      const Custom = t.kind ? kinds?.rows?.[t.kind]?.details : undefined;
      body = <>
        {!barIds.has(t.id) && <p className="gx-note">Not visible: {hiddenReason(t, model)}.</p>}
        {Custom ? <Custom item={t} model={model} select={select} canEdit={readOnly} Default={Default} /> : <Default />}
      </>;
    }
  }
  return <aside className="gx-details" aria-label="Details (F6 to move between chart and details)" tabIndex={-1}>{body}</aside>;
});

function hiddenReason(t: Task, m: Model) {
  if (t.parent) return `inside “${m.tasks.get(t.parent)?.name}”, which is collapsed`;
  return 'outside the current view';
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <><dt>{label}</dt><dd>{children}</dd></>;
}
function TaskRef({ id, model, select }: { id: string; model: Model; select: Props['select'] }) {
  return <button className="gx-link-btn" onClick={() => select({ type: 'row', taskId: id })}>{model.tasks.get(id)?.name ?? id}</button>;
}

function TaskDetails({ task: t, model, select, locale, kinds }: { task: Task; model: Model; select: Props['select']; locale?: string; kinds?: GanttKinds }) {
  const p = model.placement.byId.get(t.id)!;
  const kids = model.children.get(t.id) ?? [];
  const isSummary = t.type === 'summary' || kids.length > 0;
  const links = model.linksByTask.get(t.id) ?? [];
  const preds = links.filter((l) => l.target === t.id), succs = links.filter((l) => l.source === t.id);
  const kindDef = t.kind ? kinds?.rows?.[t.kind] : undefined;
  const typeLabel = t.lane ? 'Lane row' : t.type === 'milestone' ? 'Milestone' : isSummary ? 'Summary' : 'Task';
  const counts = isSummary ? kids.reduce((a, k) => { const c = model.placement.byId.get(k)!; const s = !c.scheduled ? 'unscheduled' : c.progress >= 1 ? 'done' : c.progress > 0 ? 'in progress' : 'not started'; a[s] = (a[s] ?? 0) + 1; return a; }, {} as Record<string, number>) : null;
  const known = new Set(['id', 'name', 'type', 'parent', 'kind', 'lane', 'start', 'duration', 'durationUnit', 'end', 'progress', 'mode', 'constraint', 'deadline', 'resources']);
  const extra = Object.entries(t).filter(([k]) => !known.has(k));

  return (
    <div className="gx-d">
      <header>
        <div className="gx-d-type">{kindDef?.icon} {kindDef?.label ?? t.kind ?? typeLabel} · {model.wbs.get(t.id)}</div>
        <h3>{t.name}</h3>
        <div className="gx-chips">
          {!p.scheduled && <span className="gx-chip">Unscheduled</span>}
          {t.deadline && p.end !== undefined && p.end > dayOf(t.deadline) && <span className="gx-chip gx-warn">Past deadline</span>}
          {isSummary && <span className="gx-chip">Dates derived from children</span>}
        </div>
      </header>
      <section><h4>Schedule</h4><dl>
        {t.type === 'milestone' ? <Field label="Date">{fmt(p.start, locale)}</Field> : <>
          <Field label="Start">{fmt(p.start, locale)}</Field>
          <Field label="End">{fmt(p.end, locale)}</Field>
          <Field label="Duration">{p.scheduled ? `${p.duration} working days` : '—'}</Field>
          <Field label="Progress">{pct(p.progress)}</Field>
        </>}
        {t.constraint && <Field label="Constraint">{t.constraint.type}{t.constraint.date ? ` ${t.constraint.date}` : ''}</Field>}
        {t.deadline && <Field label="Deadline">{fmt(dayOf(t.deadline), locale)}</Field>}
        {t.mode && t.mode !== 'auto' && <Field label="Mode">{t.mode}</Field>}
      </dl></section>
      {counts && <section><h4>{t.lane ? 'Bars on this row' : 'Children'}</h4>
        {t.lane ? <ul className="gx-list">{kids.map((k) => <li key={k}><button className="gx-link-btn" onClick={() => select({ type: 'bar', taskId: k, bar: 'main' })}>{model.tasks.get(k)?.name}</button></li>)}</ul>
          : <p>{Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(' · ')}</p>}
      </section>}
      <section><h4>Place in tree</h4>
        <p>{t.parent ? <>Inside <TaskRef id={t.parent} model={model} select={select} /></> : 'Top level'}</p>
      </section>
      {(preds.length > 0 || succs.length > 0) && <section><h4>Dependencies</h4>
        <ul className="gx-list">
          {preds.map((l) => <li key={l.id}><span className="gx-muted">After</span> <TaskRef id={l.source} model={model} select={select} /> <button className="gx-link-btn gx-small" onClick={() => select({ type: 'link', linkId: l.id })}>{l.type}{l.lag ? ` +${l.lag}d` : ''}</button></li>)}
          {succs.map((l) => <li key={l.id}><span className="gx-muted">Before</span> <TaskRef id={l.target} model={model} select={select} /> <button className="gx-link-btn gx-small" onClick={() => select({ type: 'link', linkId: l.id })}>{l.type}{l.lag ? ` +${l.lag}d` : ''}</button></li>)}
        </ul></section>}
      {(t.owner || t.resources?.length) && <section><h4>People</h4><dl>
        {t.owner && <Field label="Owner">{t.owner}</Field>}
        {t.resources?.map((r) => <Field key={r.id} label={model.doc.resources?.find((x) => x.id === r.id)?.name ?? r.id}>{pct(r.allocation)}</Field>)}
      </dl></section>}
      {extra.length > 0 && <section><h4>Other fields</h4><dl>{extra.map(([k, v]) => <Field key={k} label={k}>{String(typeof v === 'object' ? JSON.stringify(v) : v)}</Field>)}</dl></section>}
    </div>
  );
}

function LinkDetails({ link: l, model, select, kinds }: { link: Link; model: Model; select: Props['select']; kinds?: GanttKinds }) {
  const a = model.placement.byId.get(l.source), b = model.placement.byId.get(l.target);
  const src = model.tasks.get(l.source)?.name ?? l.source, tgt = model.tasks.get(l.target)?.name ?? l.target;
  // Satisfaction check on calendar days (Phase 4 replaces this with the engine's working-time result).
  let status = 'Not checked: a task is unscheduled';
  if (a?.scheduled && b?.scheduled) {
    const lag = l.lag ?? 0;
    const need = { FS: a.end! + 1 + lag, SS: a.start! + lag, FF: a.end! + lag, SF: a.start! + lag }[l.type];
    const have = l.type === 'FS' || l.type === 'SS' ? b.start! : b.end!;
    const diff = have - need;
    status = diff >= 0 ? `Satisfied${diff > 0 ? ` with ${diff} days to spare` : ''}` : `Broken by ${-diff} days`;
  }
  const kindDef = l.kind ? kinds?.links?.[l.kind] : undefined;
  return (
    <div className="gx-d">
      <header>
        <div className="gx-d-type">{kindDef?.icon} {kindDef?.label ?? l.kind ?? 'Connector'}</div>
        <h3>{describeLink(l, src, tgt)}</h3>
        <div className="gx-chips"><span className={`gx-chip${status.startsWith('Broken') ? ' gx-warn' : ''}`}>{status}</span></div>
      </header>
      <section><dl>
        <Field label="From"><TaskRef id={l.source} model={model} select={select} /></Field>
        <Field label="To"><TaskRef id={l.target} model={model} select={select} /></Field>
        <Field label="Type">{{ FS: 'Finish to start', SS: 'Start to start', FF: 'Finish to finish', SF: 'Start to finish' }[l.type]}</Field>
        <Field label="Lag">{l.lag ? `${l.lag} ${l.lagUnit ?? 'day'}${l.lag === 1 ? '' : 's'}` : 'None'}</Field>
      </dl></section>
    </div>
  );
}

function Multi({ model, selection, locale }: { model: Model; selection: SelectionTarget[]; locale?: string }) {
  let s = Infinity, e = -Infinity;
  for (const t of selection) if (t.type !== 'link') { const p = model.placement.byId.get(t.taskId); if (p?.scheduled) { s = Math.min(s, p.start!); e = Math.max(e, p.end!); } }
  const nLinks = selection.filter((t) => t.type === 'link').length;
  return <div className="gx-d"><header><div className="gx-d-type">Selection</div><h3>{selection.length} items</h3></header>
    <section><dl>
      <Field label="Tasks">{selection.length - nLinks}</Field>
      <Field label="Connectors">{nLinks}</Field>
      {s !== Infinity && <Field label="Span">{fmt(s, locale)} – {fmt(e, locale)}</Field>}
    </dl></section></div>;
}

function RoadmapSummary({ model, locale }: { model: Model; locale?: string }) {
  const r = model.doc.roadmap, span = model.placement.span;
  const tops = model.children.get(null) ?? [];
  let w = 0, d = 0;
  for (const id of tops) { const p = model.placement.byId.get(id)!; if (p.scheduled) { w += p.duration ?? 0; d += (p.duration ?? 0) * p.progress; } }
  const unscheduled = [...model.placement.byId.values()].filter((p) => !p.scheduled).length;
  return <div className="gx-d"><header><div className="gx-d-type">Roadmap · version {r.version}</div><h3>{r.name}</h3></header>
    <section><dl>
      <Field label="Start">{fmt(span?.start, locale)}</Field>
      <Field label="End">{fmt(span?.end, locale)}</Field>
      <Field label="Progress">{w ? pct(d / w) : '—'}</Field>
      <Field label="Tasks">{model.doc.tasks.length}</Field>
      <Field label="Connectors">{model.doc.links.length}</Field>
      <Field label="Unscheduled">{unscheduled}</Field>
      <Field label="Open proposals">{model.doc.proposals?.length ?? 0}</Field>
    </dl></section>
    <p className="gx-muted gx-hint">Select a row, bar or connector to see its details. Keyboard: ↑↓ move, ←→ collapse/expand or step through lane bars, Space select, Enter open lane, Esc clear, +/− zoom, T today, F6 details panel.</p>
  </div>;
}

const dayOf = (iso: string) => Math.floor(Date.parse(iso + 'T00:00:00Z') / 86_400_000);
