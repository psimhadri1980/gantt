import { forwardRef, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RoadmapDocument } from '@gantt/contract';
import { AccessEvaluator, filterDocument, mergeAccess, type AccessRules, type Condition } from '@gantt/access';
import type { LifecycleAction } from '@gantt/proposals';
import type { GanttBackend, ProposalSummary, ServiceEvent, Snapshot } from '@gantt/service';
import type { DataOperation, GanttOperation } from '@gantt/state';
import { changesOf, CoreGantt, fmtDate, type GanttHandle, type GanttProps } from './Gantt.tsx';
import { mergeMessages, makeI18n, type GanttMessages } from './i18n.ts';

type EventName = ServiceEvent['type'];
type EventCallbacks = { [K in EventName as `on${Capitalize<K>}`]?: (e: ServiceEvent & { type: K }) => void };

export interface GanttRootProps extends Omit<GanttProps, 'data'>, EventCallbacks {
  /** Data mode: the roadmap to show. Ignored when `backend` is given. */
  data?: RoadmapDocument;
  /** Proposal mode: Current, Proposals and their lifecycle come from here (H4); every change is a Proposal (K0). */
  backend?: GanttBackend;
  /** Access rules as static data (L3, L11). In data mode `data.access` is used when this is omitted. */
  access?: AccessRules | null;
  /** Access rules from a resolver; its result wins for the fields it returns (L11). */
  resolveAccess?: () => Promise<Partial<AccessRules>>;
  /** Host-registered conditions named in rules. */
  conditions?: Record<string, Condition>;
  /** Shown instead of the Gantt without `view` (L6). */
  noAccess?: ReactNode;
  /** How controls the user may not use appear: disabled with the reason (default), or hidden (L4). */
  deniedControls?: 'disable' | 'hide';
  /** A change could not be saved and was rolled back (H7). */
  onOperationFailed?: (e: { operation: GanttOperation; reason: string }) => void;
  /** Sent once the server configuration is known (section 4). */
  onSeparationOfDutiesStatus?: (e: { enforced: boolean }) => void;
}

/**
 * The Gantt. Resolves access first: without `view` nothing is fetched or rendered (L6, L8). Then renders
 * either the given data (filtered for the user, L12) or the Proposal workflow against a backend.
 */
export const Gantt = forwardRef<GanttHandle, GanttRootProps>(function Gantt(props, ref) {
  const [resolved, setResolved] = useState<{ fn: unknown; value: Partial<AccessRules> | null; error?: string } | null>(null);
  useEffect(() => {
    const fn = props.resolveAccess;
    if (!fn) return;
    let live = true;
    fn().then((value) => { if (live) setResolved({ fn, value }); }, (e: unknown) => { if (live) setResolved({ fn, value: null, error: String(e) }); });
    return () => { live = false; };
  }, [props.resolveAccess]);
  const resolving = !!props.resolveAccess && resolved?.fn !== props.resolveAccess;
  const staticRules = props.access !== undefined ? props.access : props.backend ? null : (props.data?.access as AccessRules | undefined) ?? null;
  const rules = mergeAccess(staticRules, resolved?.fn === props.resolveAccess ? resolved?.value : null);
  // Rules change at runtime without a reload (L3): a new evaluator whenever their content changes.
  const rulesKey = JSON.stringify(rules);
  const evaluator = useMemo(() => new AccessEvaluator(rules, props.conditions), [rulesKey, props.conditions]); // eslint-disable-line react-hooks/exhaustive-deps
  // Filtering for the user (L12) runs in a task of its own, so it never lengthens the first-render task
  // (budget: no task over 100 ms). Until it is ready the previous view stays, or the loading state shows.
  const [filtered, setFiltered] = useState<{ src: RoadmapDocument; ev: AccessEvaluator; doc: RoadmapDocument } | null>(null);
  useEffect(() => {
    const src = props.data;
    if (!src || props.backend || !evaluator.canView) return;
    if (filtered?.src === src && filtered.ev === evaluator) return;
    const id = setTimeout(() => setFiltered({ src, ev: evaluator, doc: filterDocument(src, evaluator) }), 0);
    return () => clearTimeout(id);
  }, [props.data, props.backend, evaluator, filtered]);
  const data = props.data && !props.backend ? filtered?.doc : undefined;
  const filtering = !!props.data && !props.backend && !filtered;
  const m = mergeMessages(props.messages);

  const denied = !resolving && !evaluator.canView;
  const onAccessDenied = useRef(props.onAccessDenied); onAccessDenied.current = props.onAccessDenied;
  useEffect(() => { if (denied) onAccessDenied.current?.({ operation: null as unknown as GanttOperation, reason: 'Missing permission: view' }); }, [denied]);

  const frame = (child: ReactNode, busy = false) => (
    <div className="gx-root" data-theme={props.theme} style={{ height: props.height ?? 600 }} aria-busy={busy || undefined}>{child}</div>
  );
  if (resolving) return frame(<div className="gx-empty">{m.loading}</div>, true);
  if (denied) return frame(props.noAccess ?? <div className="gx-empty gx-no-access" role="status">{m.noAccess}</div>);
  if (props.backend) return <Managed {...props} backend={props.backend} evaluator={evaluator} forwardedRef={ref} />;
  if (filtering) return frame(<div className="gx-empty">{m.loading}</div>, true);
  if (!data) return frame(props.emptyState ?? <div className="gx-empty">{m.empty}</div>);
  return <CoreGantt {...props} ref={ref} data={data} evaluator={evaluator} />;
});

type View = { kind: 'current' } | { kind: 'proposal'; id: string } | { kind: 'version'; version: number };
type SaveState = { status: 'saving' | 'saved' | 'error'; reason?: string };

/** The Proposal workflow over a backend (section K). */
function Managed(props: GanttRootProps & { backend: GanttBackend; evaluator: AccessEvaluator; forwardedRef: React.ForwardedRef<GanttHandle> }) {
  const { backend } = props;
  const m = mergeMessages(props.messages);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: 'current' });
  const [doc, setDoc] = useState<{ key: string; doc: RoadmapDocument } | null>(null);
  const [compare, setCompare] = useState(false);
  const [save, setSave] = useState<SaveState | undefined>();
  const propsRef = useRef(props); propsRef.current = props;
  const viewKey = view.kind === 'current' ? 'current' : view.kind === 'proposal' ? `p:${view.id}` : `v:${view.version}`;

  const refresh = useCallback(async () => {
    try {
      const s = await backend.snapshot();
      setSnap(s); setFailure(null);
      return s;
    } catch (e) { setFailure((e as Error).message); return null; }
  }, [backend]);

  // First load, configuration status, and live events (K14, K15): each event goes to its on… callback.
  useEffect(() => {
    let first = true;
    void refresh().then((s) => { if (s && first) propsRef.current.onSeparationOfDutiesStatus?.({ enforced: s.config.separationOfDuties }); first = false; });
    return backend.subscribe((e) => {
      const name = `on${e.type[0]!.toUpperCase()}${e.type.slice(1)}` as keyof EventCallbacks;
      (propsRef.current[name] as ((x: ServiceEvent) => void) | undefined)?.(e);
      void refresh();
      if (e.type === 'currentChanged') setDoc((d) => (d?.key === 'current' ? null : d));
    });
  }, [backend, refresh]);

  // The document for the view.
  useEffect(() => {
    if (!snap) return;
    let live = true;
    const load = view.kind === 'current' ? Promise.resolve(snap.current)
      : view.kind === 'proposal' ? backend.proposalDocument(view.id) : backend.versionDocument(view.version);
    load.then((d) => { if (live) setDoc(d ? { key: viewKey, doc: d } : null); }, (e: unknown) => { if (live) setFailure((e as Error).message); });
    return () => { live = false; };
  }, [snap?.version, viewKey, backend]); // eslint-disable-line react-hooks/exhaustive-deps
  const reloadDoc = useCallback(async () => {
    const v = viewRef.current;
    const d = v.kind === 'current' ? (await backend.snapshot()).current : v.kind === 'proposal' ? await backend.proposalDocument(v.id) : await backend.versionDocument(v.version);
    if (d) setDoc({ key: v.kind === 'current' ? 'current' : v.kind === 'proposal' ? `p:${v.id}` : `v:${v.version}`, doc: { ...d } });
  }, [backend]);
  const viewRef = useRef(view); viewRef.current = view;

  const proposal = view.kind === 'proposal' ? snap?.proposals.find((p) => p.id === view.id) : undefined;

  // Why the chart is read-only here (F14, K0b, K21).
  let readOnly: string | false = false;
  if (view.kind === 'version') readOnly = m.versionReadOnly;
  else if (view.kind === 'proposal' && proposal) {
    if (proposal.state === 'Submitted' || proposal.state === 'Reviewed') readOnly = 'The Proposal is locked for review; withdraw it to make changes';
    else if (proposal.state !== 'Draft' && proposal.state !== 'Returned') readOnly = m.closedReadOnly(m.state[proposal.state] ?? proposal.state);
    else if (snap && !snap.can['proposal.edit']) readOnly = 'Missing permission: proposal.edit';
  } else if (view.kind === 'current' && snap && !snap.can['proposal.create'] && !editableOwn(snap, backend.userId).length) readOnly = 'Missing permission: proposal.create';

  // Saving (H7, H8): every change is sent at once, in order; a refusal rolls the view back to the server's state.
  const queue = useRef(Promise.resolve());
  const [choice, setChoice] = useState<{ ops: DataOperation[]; options: ProposalSummary[] } | null>(null);
  const send = useCallback((target: string | null, ops: DataOperation[]) => {
    queue.current = queue.current.then(async () => {
      setSave({ status: 'saving' });
      try {
        const summary = await backend.change(target, ops.flatMap((op) => changesOf(op)));
        setSave({ status: 'saved' });
        if (!target) setView({ kind: 'proposal', id: summary.id }); // K0c: the chart now shows the new Proposal
        await refresh();
      } catch (e) {
        const reason = (e as Error).message;
        setSave({ status: 'error', reason });
        for (const op of ops) propsRef.current.onOperationFailed?.({ operation: op, reason });
        await reloadDoc().catch(() => {});
      }
    });
  }, [backend, refresh, reloadDoc]);
  const onCommit = useCallback((op: DataOperation) => {
    const v = viewRef.current;
    if (v.kind === 'proposal') return send(v.id, [op]);
    // Editing Current (K0c): with open Proposals of their own the user chooses where the change goes.
    const own = snapRef.current ? editableOwn(snapRef.current, backend.userId) : [];
    if (!own.length) return send(null, [op]);
    setChoice((c) => ({ ops: [...(c?.ops ?? []), op], options: own }));
  }, [send, backend.userId]);
  const snapRef = useRef(snap); snapRef.current = snap;

  // Lifecycle actions.
  const [statusLine, setStatusLine] = useState('');
  const act = useCallback(async (p: ProposalSummary, action: LifecycleAction | 'newFrom', reason?: string) => {
    try {
      if (action === 'newFrom') { const n = await backend.newFrom(p.id); await refresh(); setView({ kind: 'proposal', id: n.id }); setStatusLine(''); return; }
      const r = await backend.act(p.id, action, reason);
      setStatusLine('');
      if (action === 'discard') setView({ kind: 'current' });
      if (action === 'approve') setView({ kind: 'current' });
      await refresh();
      void r;
    } catch (e) { setStatusLine((e as Error).message); }
  }, [backend, refresh]);

  if (failure && !snap) {
    if (/no access/i.test(failure)) return <div className="gx-root" data-theme={props.theme} style={{ height: props.height ?? 600 }}>{props.noAccess ?? <div className="gx-empty gx-no-access" role="status">{m.noAccess}</div>}</div>;
    return <div className="gx-root" data-theme={props.theme} style={{ height: props.height ?? 600 }}><div className="gx-empty gx-error" role="alert"><strong>{m.errorTitle}</strong><p>{failure}</p><button className="gx-btn" onClick={() => void refresh()}>{m.errorRetry}</button></div></div>;
  }
  if (!snap) return <div className="gx-root" data-theme={props.theme} style={{ height: props.height ?? 600 }} aria-busy><div className="gx-empty">{m.loading}</div></div>;

  const header = (
    <ProposalBar snap={snap} view={view} setView={setView} proposal={proposal} compare={compare} setCompare={setCompare} act={act}
      statusLine={statusLine} setStatusLine={setStatusLine} choice={choice} m={m} locale={props.locale} hide={props.deniedControls === 'hide'}
      choose={(target) => { const c = choice; setChoice(null); if (!c) return; if (target === undefined) { void reloadDoc(); return; } if (target) setView({ kind: 'proposal', id: target }); send(target, c.ops); }} />
  );
  const shown = doc && doc.key === viewKey ? doc.doc : null;
  const empty: RoadmapDocument = { contract: 'gantt-roadmap/1', roadmap: { id: 'none', name: '', version: 0, timeZone: 'UTC', start: new Date().toISOString().slice(0, 10) }, tasks: [], links: [] };
  return (
    <CoreGantt {...props} ref={props.forwardedRef} data={shown ?? empty} evaluator={props.evaluator} header={header}
      readOnly={readOnly} saveState={save} onCommit={onCommit} undoScope={viewKey}
      compareWith={compare && view.kind === 'proposal' && snap.current ? snap.current : undefined}
      emptyState={<>{header}<div className="gx-empty">{view.kind === 'current' && !snap.current ? m.currentNone : shown ? m.empty : m.loading}</div></>} />
  );
}

const editableOwn = (s: Snapshot, user: string) => s.proposals.filter((p) => p.owner === user && (p.state === 'Draft' || p.state === 'Returned'));

const ACTIONS: LifecycleAction[] = ['submit', 'withdraw', 'review', 'approve', 'return', 'reject', 'discard'];

function ProposalBar({ snap, view, setView, proposal, compare, setCompare, act, statusLine, setStatusLine, choice, choose, m, locale, hide }: {
  snap: Snapshot; view: View; setView: (v: View) => void; proposal?: ProposalSummary; compare: boolean; setCompare: (b: boolean) => void;
  act: (p: ProposalSummary, a: LifecycleAction | 'newFrom', reason?: string) => Promise<void>; statusLine: string; setStatusLine: (s: string) => void;
  choice: { ops: DataOperation[]; options: ProposalSummary[] } | null; choose: (target: string | null | undefined) => void;
  m: GanttMessages; locale?: string; hide: boolean;
}) {
  const [asking, setAsking] = useState<'return' | 'reject' | null>(null);
  const [reason, setReason] = useState('');
  const [history, setHistory] = useState(false);
  const { num } = makeI18n(m, locale);
  const day = (iso?: string) => (iso ? fmtDate(Math.floor(Date.parse(iso) / 86_400_000), locale) : '');
  const value = view.kind === 'current' ? 'current' : view.kind === 'proposal' ? `p:${view.id}` : `v:${view.version}`;
  const closed = proposal && ['Rejected', 'Expired', 'Approved', 'Discarded'].includes(proposal.state);
  return (
    <div className="gx-pbar" role="region" aria-label={m.proposalBar}>
      <div className="gx-pbar-row">
        <label className="gx-pbar-view">{m.viewLabel}{' '}
          <select className="gx-select" value={value} onChange={(e) => {
            const v = e.target.value;
            setView(v === 'current' ? { kind: 'current' } : v.startsWith('p:') ? { kind: 'proposal', id: v.slice(2) } : { kind: 'version', version: Number(v.slice(2)) });
            setStatusLine('');
          }}>
            <option value="current">{snap.current ? m.currentView(num(snap.version)) : m.currentNone}</option>
            {snap.proposals.length > 0 && <optgroup label={m.proposalBar}>
              {snap.proposals.map((p) => <option key={p.id} value={`p:${p.id}`}>{m.proposalOption(p.name, m.state[p.state] ?? p.state, p.owner)}</option>)}
            </optgroup>}
            {snap.versions.length > 1 && <optgroup label={m.history}>
              {[...snap.versions].reverse().filter((v) => v.version !== snap.version).map((v) => <option key={v.version} value={`v:${v.version}`}>{m.versionView(num(v.version), v.by, day(v.at))}</option>)}
            </optgroup>}
          </select>
        </label>
        {proposal && <>
          <span className={`gx-chip gx-state gx-state-${proposal.state.toLowerCase()}`}>{m.state[proposal.state] ?? proposal.state}</span>
          <span className="gx-muted">{m.changesCount(num(proposal.changeCount))}</span>
          {proposal.expiresAt && proposal.phase && <span className="gx-muted">{m.expires(day(proposal.expiresAt), m.phaseName[proposal.phase] ?? proposal.phase)}</span>}
          {proposal.stale && <span className="gx-chip gx-warn">{m.stale}</span>}
          <button className="gx-btn" aria-pressed={compare} onClick={() => setCompare(!compare)} disabled={!snap.current}>{m.compare}</button>
          <button className="gx-btn" aria-pressed={history} aria-expanded={history} onClick={() => setHistory(!history)}>{m.history}</button>
        </>}
      </div>
      {proposal && (
        <div className="gx-pbar-row gx-pbar-actions" role="group" aria-label={m.proposalBar}>
          {ACTIONS.map((a) => {
            const why = proposal.actions?.[a];
            if (why === undefined) return null;
            // Actions that do not apply in this state are left out; a missing permission or a rule is explained (F14).
            if (why?.startsWith('Not possible while')) return null;
            if (why && hide && why.startsWith('Missing permission')) return null;
            return (
              <button key={a} data-action={a} className={`gx-btn${a === 'approve' ? ' gx-primary' : ''}`} aria-disabled={!!why || undefined} title={why ?? undefined}
                aria-describedby={why ? `gx-why-${a}` : undefined}
                onClick={() => {
                  if (why) { setStatusLine(why); return; }
                  if (a === 'return' || a === 'reject') { setAsking(a); setReason(''); return; }
                  void act(proposal, a);
                }}>
                {m.action[a]}
                {why && <span id={`gx-why-${a}`} className="gx-sr">{why}</span>}
              </button>
            );
          })}
          {(closed || proposal.stale) && snap.can['proposal.create'] && proposal.state !== 'Approved' && (
            <button className="gx-btn" onClick={() => void act(proposal, 'newFrom')}>{m.action.newFrom}</button>
          )}
          {proposal.state === 'Returned' && proposal.reason && <span className="gx-note">{m.returnedReason(proposal.reason)}</span>}
          {proposal.state === 'Rejected' && proposal.reason && <span className="gx-note">{proposal.reason}</span>}
        </div>
      )}
      {asking && proposal && (
        <form className="gx-pbar-row" onSubmit={(e) => { e.preventDefault(); void act(proposal, asking, reason); setAsking(null); }}>
          <label>{m.reasonLabel} <input className="gx-input" value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus /></label>
          <button className="gx-btn gx-primary" type="submit">{m.action[asking].replace('…', '')}</button>
          <button className="gx-btn" type="button" onClick={() => setAsking(null)}>{m.cancel}</button>
        </form>
      )}
      {choice && (
        <div className="gx-pbar-row" role="group" aria-label={m.chooseTarget}>
          <span>{m.chooseTarget}</span>
          {choice.options.map((p) => <button key={p.id} className="gx-btn" onClick={() => choose(p.id)}>{p.name}</button>)}
          <button className="gx-btn gx-primary" onClick={() => choose(null)}>{m.newProposal}</button>
          <button className="gx-btn" onClick={() => choose(undefined)}>{m.cancel}</button>
        </div>
      )}
      {statusLine && <div className="gx-pbar-row gx-pbar-status" role="status">{statusLine}</div>}
      {history && proposal && (
        <ol className="gx-history" aria-label={m.history}>
          {proposal.history.map((h, i) => (
            <li key={i}>{m.historyEntry(h.by, `${h.action}${h.to ? ` → ${m.state[h.to] ?? h.to}` : ''}${h.reason ? ` (${h.reason})` : ''}${h.separationOfDuties !== undefined ? ` · separation of duties ${h.separationOfDuties ? 'enforced' : 'not enforced'}` : ''}`, day(h.at))}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
