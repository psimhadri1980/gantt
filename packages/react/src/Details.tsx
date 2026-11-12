import { memo, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import type { Link, RoadmapDocument, Task } from '@gantt/contract';
import { formatDay, type Model, type SelectionTarget } from '@gantt/state';
import { fromDay, type DayNum, type Placement, type ScheduleResult } from '@gantt/engine';
import { useI18n, type I18n } from './i18n.ts';

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
  select: (t: SelectionTarget) => void;
  visibleIds: Map<string, number>;
  barIds: Map<string, unknown>;
  /** Changes when the messages or locale change, so the memoised panel re-renders. */
  i18n: I18n;
  /** Null when the field may be changed, else the reason it may not (F14). */
  whyNotEdit?: (taskId: string, field: string) => string | null;
  edit?: (taskId: string, fields: Partial<Task>) => unknown;
  /** Current, when comparing a Proposal with it (K4). */
  compare?: { base: RoadmapDocument; placement: Placement };
  /** The engine's schedule analysis (C2): slack, critical, driving links, issues. */
  analysis?: ScheduleResult | null;
  /** Editing a connector's type and lag; null when allowed, else the reason. */
  whyNotLinkEdit?: () => string | null;
  editLink?: (id: string, fields: Partial<Link>) => unknown;
}

const fmt = (d: DayNum | undefined, locale?: string) =>
  d === undefined ? '—' : formatDay(d, locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const readOnly = () => false; // Phase 1: the panel is read-only.

export const DetailsPanel = memo(function DetailsPanel({ model, selection, kinds, select, barIds, i18n, whyNotEdit, edit, compare, analysis, whyNotLinkEdit, editLink }: Props) {
  const { t: m } = i18n;
  const primary = selection[selection.length - 1];
  let body: ReactNode;
  if (!primary) body = <RoadmapSummary model={model} analysis={analysis} select={select} />;
  else if (selection.length > 1) body = <Multi model={model} selection={selection} />;
  else if (primary.type === 'link') {
    const l = model.doc.links.find((x) => x.id === primary.linkId);
    if (!l) body = <p className="gx-muted">{m.noLongerExists}</p>;
    else {
      const Default = () => <LinkDetails link={l} model={model} select={select} kinds={kinds} analysis={analysis} why={whyNotLinkEdit ? whyNotLinkEdit() : 'read-only'} edit={editLink} />;
      const Custom = l.kind ? kinds?.links?.[l.kind]?.details : undefined;
      body = Custom ? <Custom item={l} model={model} select={select} canEdit={readOnly} Default={Default} /> : <Default />;
    }
  } else {
    const t = model.tasks.get(primary.taskId);
    if (!t) body = <p className="gx-muted">{m.noLongerExists}</p>;
    else {
      const Default = () => <TaskDetails task={t} model={model} select={select} kinds={kinds} whyNotEdit={whyNotEdit} edit={edit} compare={compare} analysis={analysis} />;
      const Custom = t.kind ? kinds?.rows?.[t.kind]?.details : undefined;
      const canEdit = (field: string) => !!edit && !!whyNotEdit && whyNotEdit(t.id, field) === null;
      body = <>
        {!barIds.has(t.id) && <p className="gx-note">{m.notVisible(t.parent ? m.insideCollapsed(model.tasks.get(t.parent)?.name ?? t.parent) : m.outsideView)}</p>}
        {Custom ? <Custom item={t} model={model} select={select} canEdit={canEdit} Default={Default} /> : <Default />}
      </>;
    }
  }
  return <aside className="gx-details" aria-label={m.details} tabIndex={-1}>{body}</aside>;
});

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <><dt>{label}</dt><dd>{children}</dd></>;
}
function TaskRef({ id, model, select }: { id: string; model: Model; select: Props['select'] }) {
  return <button className="gx-link-btn" onClick={() => select({ type: 'row', taskId: id })}>{model.tasks.get(id)?.name ?? id}</button>;
}

/**
 * One field of the edit form (D7): an input where the user may change it, otherwise the value with the
 * reason it cannot be changed (F14). A change is committed on Enter or when the field loses focus.
 */
function EditField({ label, value, display, type, taskId, field, whyNotEdit, onCommit, was, min, max, step, bare }: {
  label: string; value: string; display: ReactNode; type: 'text' | 'date' | 'number'; taskId: string; field: string;
  whyNotEdit?: Props['whyNotEdit']; onCommit?: (v: string) => void; was?: ReactNode; min?: number; max?: number; step?: number; bare?: boolean;
}) {
  const why = whyNotEdit ? whyNotEdit(taskId, field) : 'read-only';
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const id = `gx-f-${taskId}-${field}`;
  const commit = () => { if (draft !== value && draft.trim() !== '') onCommit?.(draft); };
  const control = why === null && onCommit
    ? <input id={id} className="gx-input" type={type} value={draft} min={min} max={max} step={step} aria-label={bare ? label : undefined}
        onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setDraft(value); }} />
    : <span title={why !== 'read-only' && why ? why : undefined}>{display}</span>;
  if (bare) return control;
  return <>
    <dt><label htmlFor={why === null ? id : undefined}>{label}</label></dt>
    <dd>{control}{was !== undefined && <div className="gx-was">{was}</div>}</dd>
  </>;
}

function TaskDetails({ task: t, model, select, kinds, whyNotEdit, edit, compare, analysis }: { task: Task; model: Model; select: Props['select']; kinds?: GanttKinds; whyNotEdit?: Props['whyNotEdit']; edit?: Props['edit']; compare?: Props['compare']; analysis?: Props['analysis'] }) {
  const { t: m, locale, num, pct } = useI18n();
  const p = model.placement.byId.get(t.id)!;
  const kids = model.children.get(t.id) ?? [];
  const isSummary = t.type === 'summary' || kids.length > 0;
  const links = model.linksByTask.get(t.id) ?? [];
  const preds = links.filter((l) => l.target === t.id), succs = links.filter((l) => l.source === t.id);
  const kindDef = t.kind ? kinds?.rows?.[t.kind] : undefined;
  const typeLabel = t.lane ? m.typeLane : t.type === 'milestone' ? m.typeMilestone : isSummary ? m.typeSummary : m.typeTask;
  type ChildState = keyof typeof m.childState;
  const counts = isSummary ? kids.reduce((a, k) => {
    const c = model.placement.byId.get(k)!;
    const s: ChildState = !c.scheduled ? 'unscheduled' : c.progress >= 1 ? 'done' : c.progress > 0 ? 'in progress' : 'not started';
    a[s] = (a[s] ?? 0) + 1; return a;
  }, {} as Partial<Record<ChildState, number>>) : null;
  const known = new Set(['id', 'name', 'type', 'parent', 'kind', 'lane', 'hasChildren', 'start', 'duration', 'durationUnit', 'end', 'progress', 'mode', 'constraint', 'deadline', 'resources']);
  const extra = Object.entries(t).filter(([k]) => !known.has(k));
  const before = compare?.base.tasks.find((x) => x.id === t.id);
  const bp = before ? compare!.placement.byId.get(t.id) : undefined;
  const wasText = (now: string, then: string | undefined) => (compare && before && then !== undefined && now !== then ? `${m.diffChanged}: ${then}` : undefined);
  const set = (fields: Partial<Task>) => edit?.(t.id, fields);
  const linkBtn = (l: Link) => <button className="gx-link-btn gx-small" onClick={() => select({ type: 'link', linkId: l.id })}>{l.type}{l.lag ? ` +${num(l.lag)}` : ''}</button>;

  return (
    <div className="gx-d">
      <header>
        <div className="gx-d-type">{kindDef?.icon} {kindDef?.label ?? t.kind ?? typeLabel} · {model.wbs.get(t.id)}</div>
        {edit && whyNotEdit?.(t.id, 'name') === null
          ? <h3><EditField bare label={m.colName} value={t.name} display={t.name} type="text" taskId={t.id} field="name" whyNotEdit={whyNotEdit} onCommit={(v) => set({ name: v })} /></h3>
          : <h3>{t.name}</h3>}
        {compare && !before && <span className="gx-chip gx-diff-badge-added">{m.diffAdded}</span>}
        <div className="gx-chips">
          {!p.scheduled && <span className="gx-chip">{m.unscheduled}</span>}
          {t.deadline && p.end !== undefined && p.end > dayOf(t.deadline) && <span className="gx-chip gx-warn">{m.pastDeadline}</span>}
          {isSummary && <span className="gx-chip">{m.derivedDates}</span>}
        </div>
      </header>
      <section><h4>{m.schedule}</h4><dl>
        <EditField label={t.type === 'milestone' ? m.date : m.start} value={p.start !== undefined ? fromDay(p.start) : ''} display={fmt(p.start, locale)} type="date"
          taskId={t.id} field="start" whyNotEdit={whyNotEdit} onCommit={(v) => set({ start: v, ...(t.end ? { end: undefined } : {}) })}
          was={wasText(fmt(p.start, locale), bp && fmt(bp.start, locale))} />
        {t.type !== 'milestone' && <>
          <Field label={m.end}>{fmt(p.end, locale)}</Field>
          <EditField label={m.duration} value={String(p.duration ?? '')} display={p.scheduled ? m.workingDays(num(p.duration ?? 0)) : '—'} type="number" min={1} step={1}
            taskId={t.id} field="duration" whyNotEdit={whyNotEdit} onCommit={(v) => set({ duration: Math.max(1, Math.round(Number(v))), ...(t.end ? { end: undefined } : {}) })}
            was={wasText(String(p.duration), bp && String(bp.duration))} />
          <EditField label={m.progress} value={String(Math.round(p.progress * 100))} display={pct(p.progress)} type="number" min={0} max={100} step={5}
            taskId={t.id} field="progress" whyNotEdit={whyNotEdit} onCommit={(v) => set({ progress: Math.min(1, Math.max(0, Number(v) / 100)) })}
            was={wasText(pct(p.progress), bp && pct(bp.progress))} />
        </>}
        {(() => {
          const a = analysis?.tasks.get(t.id);
          if (!a || isSummary) return null;
          const by = a.drivenBy ? model.doc.links.find((l) => l.id === a.drivenBy) : undefined;
          return <>
            <Field label={m.slack}>{m.slackDays(num(a.slack))}{a.critical && <> · <strong>{m.criticalTask}</strong></>}</Field>
            {by && <Field label={m.drivenBy}><TaskRef id={by.source} model={model} select={select} /> {linkBtn(by)}</Field>}
          </>;
        })()}
        {t.constraint && <Field label={m.constraint}>{t.constraint.type}{t.constraint.date ? ` ${fmt(dayOf(t.constraint.date), locale)}` : ''}</Field>}
        {t.deadline && <Field label={m.deadline}>{fmt(dayOf(t.deadline), locale)}</Field>}
        {t.mode && t.mode !== 'auto' && <Field label={m.mode}>{t.mode}</Field>}
      </dl></section>
      {counts && <section><h4>{t.lane ? m.barsOnRow : m.children}</h4>
        {t.lane ? <ul className="gx-list">{kids.map((k) => <li key={k}><button className="gx-link-btn" onClick={() => select({ type: 'bar', taskId: k, bar: 'main' })}>{model.tasks.get(k)?.name}</button></li>)}</ul>
          : <p>{(Object.entries(counts) as [ChildState, number][]).map(([k, v]) => m.childState[k](num(v))).join(' · ')}</p>}
      </section>}
      <section><h4>{m.placeInTree}</h4>
        <p>{t.parent ? <>{m.inside} <TaskRef id={t.parent} model={model} select={select} /></> : m.topLevel}</p>
      </section>
      {(preds.length > 0 || succs.length > 0) && <section><h4>{m.dependencies}</h4>
        <ul className="gx-list">
          {preds.map((l) => <li key={l.id}><span className="gx-muted">{m.after}</span> <TaskRef id={l.source} model={model} select={select} /> {linkBtn(l)}</li>)}
          {succs.map((l) => <li key={l.id}><span className="gx-muted">{m.before}</span> <TaskRef id={l.target} model={model} select={select} /> {linkBtn(l)}</li>)}
        </ul></section>}
      {(t.owner || t.resources?.length) && <section><h4>{m.people}</h4><dl>
        {t.owner && <Field label={m.owner}>{t.owner}</Field>}
        {t.resources?.map((r) => <Field key={r.id} label={model.doc.resources?.find((x) => x.id === r.id)?.name ?? r.id}>{pct(r.allocation)}</Field>)}
      </dl></section>}
      {extra.length > 0 && <section><h4>{m.otherFields}</h4><dl>{extra.map(([k, v]) => <Field key={k} label={k}>{String(typeof v === 'object' ? JSON.stringify(v) : v)}</Field>)}</dl></section>}
    </div>
  );
}

function LinkDetails({ link: l, model, select, kinds, analysis, why, edit }: { link: Link; model: Model; select: Props['select']; kinds?: GanttKinds; analysis?: Props['analysis']; why: string | null; edit?: Props['editLink'] }) {
  const { t: m, num } = useI18n();
  const a = model.placement.byId.get(l.source), b = model.placement.byId.get(l.target);
  const src = model.tasks.get(l.source)?.name ?? l.source, tgt = model.tasks.get(l.target)?.name ?? l.target;
  // Status from the engine, in working time: broken (by how much), or whether it sets the successor's start.
  let status = m.notChecked, broken = false;
  const issue = analysis?.issues.find((i) => i.kind === 'brokenDependency' && i.linkId === l.id);
  const sets = !!analysis && [...analysis.tasks.values()].some((t) => t.drivenBy === l.id);
  if (a?.scheduled && b?.scheduled && analysis) {
    if (issue) { broken = true; status = m.brokenBy(num(issue.by ?? 0)); }
    else status = sets ? m.setsDate : m.satisfied;
  }
  const kindDef = l.kind ? kinds?.links?.[l.kind] : undefined;
  return (
    <div className="gx-d">
      <header>
        <div className="gx-d-type">{kindDef?.icon} {kindDef?.label ?? l.kind ?? m.typeConnector}</div>
        <h3>{m.linkSentence[l.type](src, tgt)}</h3>
        <div className="gx-chips"><span className={`gx-chip${broken ? ' gx-warn' : ''}`}>{status}</span></div>
      </header>
      <section><dl>
        <Field label={m.from}><TaskRef id={l.source} model={model} select={select} /></Field>
        <Field label={m.to}><TaskRef id={l.target} model={model} select={select} /></Field>
        <Field label={m.type}>{why === null && edit
          ? <select className="gx-select" aria-label={m.type} value={l.type} onChange={(e) => edit(l.id, { type: e.target.value as Link['type'] })}>
              {(['FS', 'SS', 'FF', 'SF'] as const).map((ty) => <option key={ty} value={ty}>{m.linkType[ty]}</option>)}
            </select>
          : <span title={why && why !== 'read-only' ? why : undefined}>{m.linkType[l.type]}</span>}</Field>
        <Field label={m.lag}>{why === null && edit
          ? <LagInput value={l.lag ?? 0} label={m.lag} onCommit={(v) => edit(l.id, { lag: v })} />
          : <span title={why && why !== 'read-only' ? why : undefined}>{l.lag ? m.lagValue(num(l.lag), l.lagUnit ?? 'day') : m.none}</span>}</Field>
      </dl></section>
    </div>
  );
}

function Multi({ model, selection }: { model: Model; selection: SelectionTarget[] }) {
  const { t: m, locale, num } = useI18n();
  let s = Infinity, e = -Infinity;
  for (const t of selection) if (t.type !== 'link') { const p = model.placement.byId.get(t.taskId); if (p?.scheduled) { s = Math.min(s, p.start!); e = Math.max(e, p.end!); } }
  const nLinks = selection.filter((t) => t.type === 'link').length;
  return <div className="gx-d"><header><div className="gx-d-type">{m.selection}</div><h3>{m.items(num(selection.length))}</h3></header>
    <section><dl>
      <Field label={m.tasks}>{num(selection.length - nLinks)}</Field>
      <Field label={m.connectors}>{num(nLinks)}</Field>
      {s !== Infinity && <Field label={m.span}>{fmt(s, locale)} – {fmt(e, locale)}</Field>}
    </dl></section></div>;
}

function RoadmapSummary({ model, analysis, select }: { model: Model; analysis?: Props['analysis']; select: Props['select'] }) {
  const { t: m, locale, num, pct } = useI18n();
  const r = model.doc.roadmap, span = model.placement.span;
  const tops = model.children.get(null) ?? [];
  let w = 0, d = 0;
  for (const id of tops) { const p = model.placement.byId.get(id)!; if (p.scheduled) { w += p.duration ?? 0; d += (p.duration ?? 0) * p.progress; } }
  let unscheduled = 0;
  for (const p of model.placement.byId.values()) if (!p.scheduled) unscheduled++;
  return <div className="gx-d"><header><div className="gx-d-type">{m.roadmapVersion(num(r.version))}</div><h3>{r.name}</h3></header>
    <section><dl>
      <Field label={m.start}>{fmt(span?.start, locale)}</Field>
      <Field label={m.end}>{fmt(span?.end, locale)}</Field>
      <Field label={m.progress}>{w ? pct(d / w) : '—'}</Field>
      <Field label={m.tasks}>{num(model.doc.tasks.length)}</Field>
      <Field label={m.connectors}>{num(model.doc.links.length)}</Field>
      <Field label={m.unscheduled}>{num(unscheduled)}</Field>
      <Field label={m.openProposals}>{num(model.doc.proposals?.length ?? 0)}</Field>
    </dl></section>
    {analysis && analysis.issues.length > 0 && <section><h4>{m.issues}</h4><ul className="gx-list">
      {analysis.issues.slice(0, 20).map((i, k) => <li key={k}>{i.linkId ? <button className="gx-link-btn" onClick={() => select({ type: 'link', linkId: i.linkId! })}>{i.message}</button>
        : i.taskId ? <button className="gx-link-btn" onClick={() => select({ type: 'row', taskId: i.taskId! })}>{i.message}</button> : i.message}</li>)}
    </ul></section>}
    <p className="gx-muted gx-hint">{m.keyboardHint}</p>
  </div>;
}

const dayOf = (iso: string) => Math.floor(Date.parse(iso + 'T00:00:00Z') / 86_400_000);

function LagInput({ value, label, onCommit }: { value: number; label: string; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => { const v = Math.round(Number(draft)); if (Number.isFinite(v) && v !== value) onCommit(v); };
  return <input className="gx-input" type="number" step={1} aria-label={label} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />;
}
