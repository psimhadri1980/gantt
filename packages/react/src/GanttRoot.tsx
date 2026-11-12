import { forwardRef, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RoadmapDocument } from '@gantt/contract';
import { AccessEvaluator, filterDocument, mergeAccess, type AccessRules, type Condition } from '@gantt/access';
import type { LifecycleAction, RefreshChoice } from '@gantt/proposals';
import type { Concurrency, GanttBackend, ProposalSummary, RefreshPreview, ServiceEvent, Snapshot } from '@gantt/service';
import { ConcurrentPanel, ProposalList, RefreshDialog } from './together.tsx';
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
  const [statusLine, setStatusLine] = useState('');
  const [offerBaseline, setOfferBaseline] = useState(false);
  const propsRef = useRef(props); propsRef.current = props;
  // Our own handle as well as the host's, so the panels can jump to a task.
  const inner = useRef<GanttHandle | null>(null);
  const setRef = useCallback((h: GanttHandle | null) => {
    inner.current = h;
    const f = propsRef.current.forwardedRef;
    if (typeof f === 'function') f(h); else if (f) f.current = h;
  }, []);
  const viewKey = view.kind === 'current' ? 'current' : view.kind === 'proposal' ? `p:${view.id}` : `v:${view.version}`;

  const refresh = useCallback(async () => {
    try {
      const s = await backend.snapshot();
      setSnap(s); setFailure(null);
      return s;
    } catch (e) { setFailure((e as Error).message); return null; }
  }, [backend]);

  const saveBaseline = useCallback(async (name: string) => {
    try { const b = await backend.saveBaseline(name); setOfferBaseline(false); setStatusLine(m.baselineSaved(b.name)); await refresh(); await reloadDocRef.current().catch(() => {}); }
    catch (e) { setStatusLine((e as Error).message); }
  }, [backend, refresh]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const reloadDocRef = useRef(reloadDoc); reloadDocRef.current = reloadDoc;

  const proposal = view.kind === 'proposal' ? snap?.proposals.find((p) => p.id === view.id) : undefined;
  // Someone else changed, picked or refreshed this Proposal: show their version at once (H5).
  const othersRev = proposal ? `${proposal.history.filter((h) => h.by !== backend.userId).length}:${proposal.baseVersion}` : '';
  const firstRev = useRef(othersRev);
  useEffect(() => {
    if (firstRev.current === othersRev) return;
    firstRev.current = othersRev;
    if (proposal) void reloadDoc().catch(() => {});
  }, [othersRev]); // eslint-disable-line react-hooks/exhaustive-deps

  // Concurrent changes and overlaps (K7, K8), and what a stale Proposal overlaps with Current (K12).
  const [cc, setCc] = useState<Concurrency | null>(null);
  const [incomingOverlap, setIncomingOverlap] = useState<string[]>([]);
  useEffect(() => {
    if (!proposal) { setCc(null); setIncomingOverlap([]); return; }
    let live = true;
    backend.concurrency(proposal.id).then((c) => { if (live) setCc(c); }, () => { if (live) setCc(null); });
    if (proposal.stale) backend.refreshPreview(proposal.id, {}).then((pv) => { if (live) setIncomingOverlap(pv.overlaps.map((o) => o.taskId)); }, () => {});
    else setIncomingOverlap([]);
    return () => { live = false; };
  }, [snap, proposal?.id, backend]); // eslint-disable-line react-hooks/exhaustive-deps
  const flags = useMemo(() => {
    const f = new Map<string, string>();
    for (const t of incomingOverlap) f.set(t, m.flagIncoming);
    for (const o of cc?.parallel ?? []) f.set(o.taskId, m.flagParallel(o.proposal ? o.proposal.name : m.anotherProposal));
    for (const c of cc?.inProposal ?? []) f.set(c.taskId, m.flagConcurrent(c.users.join(', ')));
    return f;
  }, [cc, incomingOverlap, m]);

  // Refresh (K16–K18): a preview with choices that are kept if the dialog is left (K17c).
  const savedChoices = useRef(new Map<string, Record<string, RefreshChoice>>());
  const [dlg, setDlg] = useState<{ id: string; key: string; preview: RefreshPreview; choices: Record<string, RefreshChoice>; busy: boolean; error: string | null } | null>(null);
  const openRefresh = useCallback(async (p: ProposalSummary) => {
    const s0 = snapRef.current; if (!s0) return;
    const key = `${p.id}:${s0.version}`;
    const choices = savedChoices.current.get(key) ?? {};
    try {
      const preview = await backend.refreshPreview(p.id, choices);
      setDlg({ id: p.id, key, preview, choices, busy: false, error: null });
    } catch (e) { setStatusLine((e as Error).message); }
  }, [backend]);
  const setChoices = useCallback((choices: Record<string, RefreshChoice>) => {
    setDlg((d) => (d ? { ...d, choices } : d));
    const d = dlgRef.current; if (!d) return;
    savedChoices.current.set(d.key, choices);
    void backend.refreshPreview(d.id, choices).then((preview) => setDlg((x) => (x && x.key === d.key ? { ...x, preview, choices } : x)), () => {});
  }, [backend]);
  const dlgRef = useRef(dlg); dlgRef.current = dlg;
  const confirmRefresh = useCallback(async () => {
    const d = dlgRef.current; if (!d) return;
    setDlg({ ...d, busy: true, error: null });
    try {
      const r = await backend.refresh(d.id, d.choices);
      savedChoices.current.delete(d.key);
      setDlg(null);
      setStatusLine(m.refreshed(String(d.preview.fromVersion), String(d.preview.toVersion)));
      void r;
      await refresh(); await reloadDoc().catch(() => {});
    } catch (e) { setDlg({ ...d, busy: false, error: (e as Error).message }); }
  }, [backend, refresh, reloadDoc, m]);
  const undoRefresh = useCallback(async (p: ProposalSummary) => {
    try { await backend.undoRefresh(p.id); setStatusLine(''); await refresh(); await reloadDoc().catch(() => {}); }
    catch (e) { setStatusLine((e as Error).message); }
  }, [backend, refresh, reloadDoc]);
  const pick = useCallback(async (taskId: string, keep: string) => {
    const v = viewRef.current; if (v.kind !== 'proposal') return;
    try { await backend.pick(v.id, taskId, keep); await refresh(); await reloadDoc().catch(() => {}); }
    catch (e) { setStatusLine((e as Error).message); }
  }, [backend, refresh, reloadDoc]);

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
  const act = useCallback(async (p: ProposalSummary, action: LifecycleAction | 'newFrom', reason?: string) => {
    try {
      if (action === 'newFrom') { const n = await backend.newFrom(p.id); await refresh(); setView({ kind: 'proposal', id: n.id }); setStatusLine(''); return; }
      const r = await backend.act(p.id, action, reason);
      setStatusLine('');
      if (action === 'discard') setView({ kind: 'current' });
      if (action === 'approve') { setView({ kind: 'current' }); setOfferBaseline(true); } // a baseline is offered on every approval (B1)
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
      restoreVersion={(v) => void (async () => { try { const p = await backend.restoreVersion(v); await refresh(); setView({ kind: 'proposal', id: p.id }); setStatusLine(''); } catch (e) { setStatusLine((e as Error).message); } })()}
      offerBaseline={offerBaseline} setOfferBaseline={setOfferBaseline} saveBaseline={(n) => void saveBaseline(n)}
      cc={cc} pick={(t, k) => void pick(t, k)} onRefresh={(p) => void openRefresh(p)} onUndoRefresh={(p) => void undoRefresh(p)} now={Date.now()}
      selectTask={(id) => { const h = inner.current; if (!h) return; h.scrollToTask(id); void h.run({ type: 'selection.set', selection: [{ type: 'row', taskId: id }] }); }}
      statusLine={statusLine} setStatusLine={setStatusLine} choice={choice} m={m} locale={props.locale} hide={props.deniedControls === 'hide'}
      choose={(target) => { const c = choice; setChoice(null); if (!c) return; if (target === undefined) { void reloadDoc(); return; } if (target) setView({ kind: 'proposal', id: target }); send(target, c.ops); }} />
  );
  const shown = doc && doc.key === viewKey ? doc.doc : null;
  const empty: RoadmapDocument = { contract: 'gantt-roadmap/1', roadmap: { id: 'none', name: '', version: 0, timeZone: 'UTC', start: new Date().toISOString().slice(0, 10) }, tasks: [], links: [] };
  return (
    <>
    <CoreGantt {...props} ref={setRef} data={shown ?? empty} evaluator={props.evaluator} header={header}
      readOnly={readOnly} saveState={save} onCommit={onCommit} undoScope={viewKey}
      openProposals={snap.proposals.filter((p) => ['Draft', 'Returned', 'Submitted', 'Reviewed'].includes(p.state)).length} flags={view.kind === 'proposal' ? flags : undefined}
      compareWith={compare && view.kind === 'proposal' && snap.current ? snap.current : undefined}
      emptyState={<>{header}<div className="gx-empty">{view.kind === 'current' && !snap.current ? m.currentNone : shown ? m.empty : m.loading}</div></>} />
    {dlg && <div className="gx-root gx-layer" data-theme={props.theme}><RefreshDialog preview={dlg.preview} choices={dlg.choices} setChoices={setChoices} m={m} busy={dlg.busy} error={dlg.error}
      onConfirm={() => void confirmRefresh()} onCancel={() => setDlg(null)} /></div>}
    </>
  );
}

const editableOwn = (s: Snapshot, user: string) => s.proposals.filter((p) => p.owner === user && (p.state === 'Draft' || p.state === 'Returned'));

const ACTIONS: LifecycleAction[] = ['submit', 'withdraw', 'review', 'approve', 'return', 'reject', 'discard'];

function ProposalBar({ snap, view, setView, proposal, compare, setCompare, act, statusLine, setStatusLine, choice, choose, m, locale, hide, cc, pick, onRefresh, onUndoRefresh, now, selectTask, restoreVersion, offerBaseline, setOfferBaseline, saveBaseline }: {
  restoreVersion: (v: number) => void; offerBaseline: boolean; setOfferBaseline: (b: boolean) => void; saveBaseline: (name: string) => void;
  cc: Concurrency | null; pick: (taskId: string, keep: string) => void; onRefresh: (p: ProposalSummary) => void; onUndoRefresh: (p: ProposalSummary) => void;
  now: number; selectTask: (id: string) => void;
  snap: Snapshot; view: View; setView: (v: View) => void; proposal?: ProposalSummary; compare: boolean; setCompare: (b: boolean) => void;
  act: (p: ProposalSummary, a: LifecycleAction | 'newFrom', reason?: string) => Promise<void>; statusLine: string; setStatusLine: (s: string) => void;
  choice: { ops: DataOperation[]; options: ProposalSummary[] } | null; choose: (target: string | null | undefined) => void;
  m: GanttMessages; locale?: string; hide: boolean;
}) {
  const [asking, setAsking] = useState<'return' | 'reject' | null>(null);
  const [reason, setReason] = useState('');
  const [history, setHistory] = useState(false);
  const [panel, setPanel] = useState<'list' | 'concurrent' | null>(null);
  const ccCount = cc ? cc.inProposal.length + new Set(cc.parallel.map((o) => o.taskId)).size : 0;
  const canRefresh = snap.can['proposal.refresh'] ? null : 'Missing permission: proposal.refresh';
  const editable = proposal && (proposal.state === 'Draft' || proposal.state === 'Returned');
  const canPick = editable ? (snap.can['proposal.edit'] ? null : 'Missing permission: proposal.edit') : (snap.can['proposal.approve'] ? null : 'Missing permission: proposal.approve');
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
        {view.kind === 'version' && snap.can['proposal.create'] &&
          <button className="gx-btn" data-action="restore" onClick={() => restoreVersion(view.version)}>{m.restoreVersion}</button>}
        {view.kind === 'current' && snap.current && snap.can['baseline.save'] && !offerBaseline &&
          <button className="gx-btn" data-action="save-baseline" onClick={() => setOfferBaseline(true)}>{m.saveBaseline}</button>}
        <button className="gx-btn" aria-pressed={panel === 'list'} aria-expanded={panel === 'list'} onClick={() => setPanel(panel === 'list' ? null : 'list')}>{m.proposals} ({num(snap.proposals.length)})</button>
        {proposal && <>
          <span className={`gx-chip gx-state gx-state-${proposal.state.toLowerCase()}`}>{m.state[proposal.state] ?? proposal.state}</span>
          <span className="gx-muted">{m.changesCount(num(proposal.changeCount))}</span>
          {proposal.expiresAt && proposal.phase && <span className="gx-muted">{m.expires(day(proposal.expiresAt), m.phaseName[proposal.phase] ?? proposal.phase)}</span>}
          {proposal.stale && <span className="gx-chip gx-warn" role="status">{m.behind(num(proposal.behind))}</span>}
          {ccCount > 0 && <button className="gx-btn gx-warn-btn" aria-pressed={panel === 'concurrent'} aria-expanded={panel === 'concurrent'} onClick={() => setPanel(panel === 'concurrent' ? null : 'concurrent')}>{m.concurrent(num(ccCount))}</button>}
          <button className="gx-btn" aria-pressed={compare} onClick={() => setCompare(!compare)} disabled={!snap.current}>{m.compare}</button>
          <button className="gx-btn" aria-pressed={history} aria-expanded={history} onClick={() => setHistory(!history)}>{m.history}</button>
        </>}
      </div>
      {proposal && (
        <div className="gx-pbar-row gx-pbar-actions" role="group" aria-label={m.proposalBar}>
          {ACTIONS.map((a) => {
            const why = proposal.actions?.[a];
            // Where Approve would be, a stale Proposal shows the reason and the Refresh action (K19).
            const refreshHere = a === 'approve' && proposal.stale && (why !== undefined) ? (
              <button key="refresh" data-action="refresh" className="gx-btn gx-primary" aria-disabled={!!canRefresh || undefined} title={canRefresh ?? undefined}
                onClick={() => { if (canRefresh) { setStatusLine(canRefresh); return; } onRefresh(proposal); }}>{m.refreshProposal}</button>
            ) : null;
            if (refreshHere && why?.startsWith('Not possible while')) return refreshHere;
            if (why === undefined) return null;
            // Actions that do not apply in this state are left out; a missing permission or a rule is explained (F14).
            if (why?.startsWith('Not possible while')) return null;
            if (why && hide && why.startsWith('Missing permission')) return null;
            return (<span key={a} className="gx-act">{refreshHere}
              <button data-action={a} className={`gx-btn${a === 'approve' && !proposal.stale ? ' gx-primary' : ''}`} aria-disabled={!!why || undefined} title={why ?? undefined}
                aria-describedby={why ? `gx-why-${a}` : undefined}
                onClick={() => {
                  if (why) { setStatusLine(why); return; }
                  if (a === 'return' || a === 'reject') { setAsking(a); setReason(''); return; }
                  void act(proposal, a);
                }}>
                {m.action[a]}
                {why && <span id={`gx-why-${a}`} className="gx-sr">{why}</span>}
              </button></span>
            );
          })}
          {proposal.stale && !(proposal.actions?.approve !== undefined) && (
            <button data-action="refresh" className="gx-btn gx-primary" aria-disabled={!!canRefresh || undefined} title={canRefresh ?? undefined}
              onClick={() => { if (canRefresh) { setStatusLine(canRefresh); return; } onRefresh(proposal); }}>{m.refreshProposal}</button>
          )}
          {proposal.canUndoRefresh && <button className="gx-btn" data-action="undo-refresh" onClick={() => onUndoRefresh(proposal)}>{m.undoRefresh}</button>}
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
      {offerBaseline && snap.can['baseline.save'] && snap.current && (
        <form className="gx-pbar-row" aria-label={m.saveBaseline} onSubmit={(e) => { e.preventDefault(); const v = new FormData(e.currentTarget).get('name'); if (typeof v === 'string' && v.trim()) saveBaseline(v.trim()); }}>
          <label>{m.baselineName} <input className="gx-input" name="name" defaultValue={`Version ${snap.version}`} autoFocus required /></label>
          <button className="gx-btn gx-primary" type="submit">{m.saveBaseline}</button>
          <button className="gx-btn" type="button" onClick={() => setOfferBaseline(false)}>{m.cancel}</button>
        </form>
      )}
      {statusLine && <div className="gx-pbar-row gx-pbar-status" role="status">{statusLine}</div>}
      {panel === 'list' && <div className="gx-pbar-panel" role="region" aria-label={m.proposals}>
        <ProposalList snap={snap} m={m} locale={locale} now={now} open={(id) => { setView({ kind: 'proposal', id }); setPanel(null); }}
          refresh={(p) => { setView({ kind: 'proposal', id: p.id }); setPanel(null); onRefresh(p); }} />
      </div>}
      {panel === 'concurrent' && cc && proposal && <div className="gx-pbar-panel" role="region" aria-label={m.concurrentTitle}>
        <ConcurrentPanel cc={cc} m={m} canPick={canPick} pick={pick} select={selectTask} />
      </div>}
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
