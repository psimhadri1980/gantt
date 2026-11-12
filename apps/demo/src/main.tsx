import { StrictMode, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Gantt, HOUR_ZOOM, memoryBackend, germanMessages, ZOOM_LEVELS, type GridColumn, type AccessRules, type GanttHandle, type GanttKinds, type GanttOperation } from '@gantt/react';
import { RoadmapService } from '@gantt/service';
import roles from '../../../packages/mock/src/samples/roles.json';
import { generate, loadMock, splitForLazyLoading } from '@gantt/mock';
import small from '../../../packages/mock/src/samples/small.json';
import './demo.css';

const kinds: GanttKinds = {
  rows: {
    initiative: { label: 'Initiative', icon: '◆' },
    'use-case': { label: 'Use case', icon: '◇' },
    application: { label: 'Application', icon: '▣' },
    crew: { label: 'Crew', icon: '👥' },
    deliverable: {
      label: 'Deliverable', icon: '📦',
      details: ({ item, Default }) => <><div className="demo-host-note">Host-defined details for deliverable “{item.name}”</div><Default /></>,
    },
  },
  links: { delivery: { label: 'Delivery dependency', icon: '⇢' } },
};

// A partial German translation: anything not listed falls back to English (G12).
const german = germanMessages;

// Templates (G7) and a host column (D18), shown with ?templates=1.
const withTemplates = new URLSearchParams(location.search).has('templates');
const hostColumns: GridColumn[] = [{
  id: 'owner', label: 'Owner', width: 90, field: 'owner',
  cell: ({ task }) => <span className="demo-owner">{task.owner ? `@${task.owner}` : '—'}</span>,
}];
const BarTemplate = ({ task, placed }: { task: { name: string }; placed: { progress: number } }) =>
  <span className="gx-bar-label demo-bar-tpl">{task.name} · {Math.round(placed.progress * 100)}%</span>;
const TooltipTemplate = ({ task, Default }: { task: { owner?: string }; Default: ReactNode }) =>
  <>{Default}<div className="demo-tip-tpl">Owner: {task.owner ?? 'nobody'}</div></>;

type SampleId = 'proposals' | 'small' | 'large' | 'lanes' | 'lazy' | 'invalid' | 'depth' | 'resources';

// Resources (Phase 9): three people, one part-time on a Mon–Wed calendar, assigned so that Pat is
// over-allocated in the build; and a backlog to drag onto the chart.
const assignments: Record<string, { id: string; allocation: number }[]> = {
  t2: [{ id: 'sam', allocation: 1 }], t3: [{ id: 'pat', allocation: 0.5 }], t7: [{ id: 'pat', allocation: 1 }],
  t8: [{ id: 'pat', allocation: 1 }], t9: [{ id: 'pat', allocation: 1 }, { id: 'kim', allocation: 0.5 }], t16: [{ id: 'sam', allocation: 1 }],
};
const staffed = {
  ...small,
  calendars: [...(small.calendars ?? []), { id: 'mtw', name: 'Mon–Wed', workingDays: [1, 2, 3], hoursPerDay: 8 }],
  resources: [{ id: 'pat', name: 'Pat', capacityFte: 1 }, { id: 'sam', name: 'Sam', capacityFte: 1 }, { id: 'kim', name: 'Kim (part-time)', capacityFte: 0.6, calendar: 'mtw' }],
  tasks: small.tasks.map((t) => (assignments[t.id] ? { ...t, resources: assignments[t.id] } : t)),
};
const backlogItems = [{ id: 'bk1', name: 'Load testing', duration: 3 }, { id: 'bk2', name: 'Security review', duration: 2 }, { id: 'bk3', name: 'Docs update', duration: 1 }];

// Scheduling depth (Phase 7): a task calendar, a split task, hour-based tasks, constraints and a deadline that
// are broken (so the Problems list has something to fix), and an inactive task.
const depth = {
  ...small,
  calendars: [...(small.calendars ?? []), { id: 'six', name: 'Mon–Sat', workingDays: [1, 2, 3, 4, 5, 6], hoursPerDay: 8 }],
  tasks: [
    ...small.tasks.map((t) => t.id === 't8' ? { ...t, splits: [{ after: 4, gap: 3 }] }
      : t.id === 't9' ? { ...t, deadline: '2026-12-01' }
      : t.id === 't16' ? { ...t, constraint: { type: 'SNLT', date: '2026-12-01' } }
      : t.id === 't17' ? { ...t, calendar: 'six' } : t),
    { id: 'h1', name: 'Cut-over rehearsal', type: 'task', parent: 't15', start: '2026-12-21', duration: 4, durationUnit: 'hour' },
    { id: 'h2', name: 'Cut-over', type: 'task', parent: 't15', start: '2026-12-22', duration: 12, durationUnit: 'hour', mode: 'manual' },
    { id: 'x1', name: 'Parked idea', type: 'task', parent: null, start: '2026-11-10', duration: 5, mode: 'inactive' },
  ],
  links: [...small.links, { id: 'lh', source: 'h1', target: 'h2', type: 'FS' }, { id: 'lh2', source: 't17', target: 'h2', type: 'FS' }],
  // The kick-off plan (B1): the build was meant to finish a week earlier.
  baselines: [{
    id: 'kickoff', name: 'Kick-off plan', version: 10, savedAt: '2026-10-20T09:00:00Z', savedBy: 'carol',
    tasks: [
      { id: 't7', start: '2026-11-09', end: '2026-11-18', work: 8 }, { id: 't8', start: '2026-11-19', end: '2026-12-04', work: 12 },
      { id: 't9', start: '2026-11-23', end: '2026-11-30', work: 6 }, { id: 't2', start: '2026-11-02', end: '2026-11-13', work: 10 },
      { id: 't3', start: '2026-11-09', end: '2026-11-13', work: 5 }, { id: 't16', start: '2026-12-07', end: '2026-12-11', work: 5 },
    ],
  }],
};
// Fiscal quarters (G2): the year starts in April.
const fiscal = { ...ZOOM_LEVELS[1]!, id: 'fiscal', label: 'Fiscal', format: { quarter: (d: number) => { const dt = new Date(d * 86_400_000); const m = dt.getUTCMonth(); const fy = m >= 3 ? dt.getUTCFullYear() + 1 : dt.getUTCFullYear(); return `FY${String(fy).slice(2)} Q${Math.floor(((m + 9) % 12) / 3) + 1}`; } } };
const depthLevels = [...ZOOM_LEVELS, HOUR_ZOOM, fiscal];
const rules = roles as Record<string, AccessRules>;
const DAY = 86_400_000;
const USERS: [string, string][] = [['alice', 'Alice (planner)'], ['bob', 'Bob (reviewer)'], ['carol', 'Carol (approver)'], ['dave', 'Dave (progress only)'],
  ['erin', 'Erin (viewer, no crews)'], ['frank', 'Frank (admin)'], ['mallory', 'Mallory (no access)']];
function App() {
  const [sample, setSample] = useState<SampleId>(() => (new URLSearchParams(location.search).get('sample') as SampleId) || 'small');
  // Proposal workflow on a mock backend (M7): one service per separation-of-duties setting, with a clock the demo can move.
  const [user, setUser] = useState('alice');
  const [sod, setSod] = useState(true);
  const clock = useRef(Date.parse('2026-11-11T09:00:00Z'));
  const [clockLabel, setClockLabel] = useState(new Date(clock.current).toISOString().slice(0, 10));
  const svc = useMemo(() => {
    const r = loadMock(small);
    if (!r.ok) throw new Error('sample invalid');
    return new RoadmapService({ current: { ...r.doc, access: undefined }, rulesFor: (u) => rules[u] ?? null, separationOfDuties: sod, now: () => clock.current });
  }, [sod]);
  const backend = useMemo(() => memoryBackend(svc, user), [svc, user]);
  useEffect(() => { (window as unknown as { svc: unknown }).svc = svc; }, [svc]);
  const [theme, setTheme] = useState<'light' | 'dark' | undefined>();
  const [dock, setDock] = useState<'right' | 'bottom'>('right');
  const [lockZoom, setLockZoom] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [failSave, setFailSave] = useState(false);
  const [lang, setLang] = useState<'en' | 'de' | 'ar'>(() => (new URLSearchParams(location.search).get('lang') as 'de' | 'ar' | null) ?? 'en');
  const [backlog, setBacklog] = useState(backlogItems);
  const [save, setSave] = useState<{ status: 'saving' | 'saved' | 'error'; reason?: string } | undefined>();
  // Simulated persistence: every data change is "saved" after a short delay, or fails when asked to.
  const onDataChanged = () => {
    setSave({ status: 'saving' });
    setTimeout(() => setSave(failSave ? { status: 'error', reason: 'the server is unreachable' } : { status: 'saved' }), 600);
  };
  const [log, setLog] = useState<string[]>([]);
  const ref = useRef<GanttHandle>(null);
  const push = (line: string) => setLog((l) => [line, ...l].slice(0, 8));
  useEffect(() => { (window as unknown as { gantt: unknown }).gantt = ref; });
  const describe = (op: GanttOperation) => op.type + ('id' in op ? ` ${op.id}` : op.type === 'zoom.set' ? ` ${op.zoom}` : op.type === 'selection.set' ? ` (${op.selection.length})` : '');
  const result = useMemo(() => {
    const t0 = performance.now();
    const input = sample === 'small' ? small
      : sample === 'depth' ? depth
      : sample === 'resources' ? staffed
      : sample === 'invalid' ? { ...small, tasks: [...small.tasks.slice(0, 11), { ...small.tasks[11], start: 'soon' }, ...small.tasks.slice(12)] }
      : generate({ tasks: 10000, linkDensity: 0.55, laneEvery: sample === 'lanes' ? 2 : 0 });
    if (sample === 'lazy') {
      const full = loadMock(generate({ tasks: 3000, depth: 3, linkDensity: 0.3 }));
      if (!full.ok) throw new Error('generated data invalid');
      const { initial, loadChildren } = splitForLazyLoading(full.doc, 1, 400);
      return { r: { ok: true as const, doc: initial, warnings: [] }, ms: Math.round(performance.now() - t0), loadChildren };
    }
    const r = loadMock(input);
    return { r, ms: Math.round(performance.now() - t0), loadChildren: undefined };
  }, [sample]);
  return (
    <div className="demo">
      <header className="demo-bar">
        <h1>Gantt gallery</h1>
        <label>Sample <select value={sample} onChange={(e) => setSample(e.target.value as SampleId)}>
          <option value="proposals">Proposal workflow (mock backend)</option>
          <option value="small">Small (20 tasks, kinds, lane)</option>
          <option value="large">Large (10,000 tasks)</option>
          <option value="lanes">Large as lanes</option>
          <option value="lazy">Children loaded on expand</option>
          <option value="resources">Resources (people, load, backlog)</option>
          <option value="depth">Scheduling depth (hours, splits, problems)</option>
          <option value="invalid">Invalid file</option>
        </select></label>
        <label>Theme <select value={theme ?? ''} onChange={(e) => setTheme((e.target.value || undefined) as typeof theme)}>
          <option value="">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
        <label>Details <select value={dock} onChange={(e) => setDock(e.target.value as typeof dock)}>
          <option value="right">Right</option><option value="bottom">Bottom</option></select></label>
        <label>Language <select value={lang} onChange={(e) => setLang(e.target.value as typeof lang)}>
          <option value="en">English</option><option value="de">Deutsch</option><option value="ar">العربية (right-to-left layout, English text)</option></select></label>
        <label><input type="checkbox" checked={lockZoom} onChange={(e) => setLockZoom(e.target.checked)} /> Host refuses zoom</label>
        <label><input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} /> Read-only</label>
        <label><input type="checkbox" checked={failSave} onChange={(e) => setFailSave(e.target.checked)} /> Saves fail</label>
        {sample === 'proposals' && <>
          <label>User <select value={user} onChange={(e) => setUser(e.target.value)}>{USERS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          <label><input type="checkbox" checked={sod} onChange={(e) => setSod(e.target.checked)} /> Separation of duties</label>
          <span className="demo-meta">Clock {clockLabel}</span>
          <button onClick={() => { clock.current += DAY; setClockLabel(new Date(clock.current).toISOString().slice(0, 10)); svc.tick(); }}>+1 day</button>
        </>}
        <span className="demo-meta">{sample === 'proposals' ? '' : result.r.ok ? `${result.r.doc.tasks.length} tasks, ${result.r.doc.links.length} links · validated in ${result.ms} ms` : 'Refused'}</span>
      </header>
      {sample === 'proposals'
        ? <>
          <Gantt key={user + String(sod)} ref={ref} backend={backend} access={rules[user] ?? null} kinds={kinds} theme={theme} detailsPanel={dock} height="calc(100vh - 110px)"
            userId={user} locale={lang === 'de' ? 'de-DE' : lang === 'ar' ? 'ar-EG' : undefined} messages={lang === 'de' ? german : undefined}
            onProposalCreated={(e) => push(`event: proposalCreated ${e.proposal.name}`)}
            onProposalSubmitted={(e) => push(`event: proposalSubmitted by ${e.actor}`)}
            onProposalReviewed={(e) => push(`event: proposalReviewed by ${e.actor}`)}
            onProposalApproved={(e) => push(`event: proposalApproved by ${e.actor}`)}
            onProposalReturned={(e) => push(`event: proposalReturned: ${e.reason}`)}
            onProposalRejected={(e) => push(`event: proposalRejected: ${e.reason}`)}
            onProposalExpiring={(e) => push(`event: proposalExpiring (${e.phase}) at ${e.expiresAt.slice(0, 10)}`)}
            onProposalExpired={(e) => push(`event: proposalExpired (${e.phase})`)}
            onProposalStale={(e) => push(`event: proposalStale ${e.proposal.name}: version ${e.newVersion}`)}
            onConcurrentChange={(e) => push(`event: concurrentChange in ${e.proposal.name}${e.parallel ? ' (parallel Proposal)' : ''}: ${e.taskIds.join(', ')}`)}
            onProposalRefreshed={(e) => push(`event: proposalRefreshed ${e.proposal.name}: ${e.fromVersion} → ${e.toVersion}`)}
            onSeparationOfDutiesStatus={(e) => push(`separation of duties ${e.enforced ? 'enforced' : 'NOT enforced'}`)}
            onOperationFailed={(e) => push(`✗ not saved: ${e.reason}`)}
            onOperationRefused={(r) => push(`✗ ${describe(r.operation)}: ${r.reason}`)} />
          <div className="demo-log" aria-label="Operations log" data-testid="oplog">{log.map((l, i) => <div key={i}>{l}</div>)}</div>
        </>
        : result.r.ok
        ? <>
          <Gantt ref={ref} data={result.r.doc} kinds={kinds} theme={theme} detailsPanel={dock} height="calc(100vh - 110px)"
            markers={[{ date: '2026-12-18', label: 'Code freeze' }]} userId="demo-user"
            readOnly={readOnly} saveState={save} onDataChanged={onDataChanged} loadChildren={result.loadChildren}
            zoomLevels={sample === 'depth' ? depthLevels : undefined}
            backlog={sample === 'resources' ? backlog : undefined} onBacklogUsed={(it) => setBacklog((b) => b.filter((x) => x.id !== it.id))}
            scaleRange={sample === 'depth' ? { start: '2026-10-26' } : undefined}
            columns={withTemplates ? hostColumns : undefined} barTemplate={withTemplates ? BarTemplate : undefined} tooltipTemplate={withTemplates ? TooltipTemplate : undefined}
            locale={lang === 'de' ? 'de-DE' : lang === 'ar' ? 'ar-EG' : undefined} messages={lang === 'de' ? german : undefined}
            onBeforeOperation={(op) => (lockZoom && op.type === 'zoom.set' ? 'Zoom is locked by the host' : undefined)}
            onOperation={(r, ctx) => push(`✓ ${ctx.source}: ${describe(r.operation)}`)}
            onOperationRefused={(r) => push(`✗ ${describe(r.operation)}: ${r.reason}`)} />
          <div className="demo-log" aria-label="Operations log" data-testid="oplog">{log.map((l, i) => <div key={i}>{l}</div>)}</div>
        </>
        : <div className="demo-error" role="alert"><h2>This file was refused</h2><ul>{result.r.errors.map((e) => <li key={e.path}><code>{e.path}</code>: {e.message}</li>)}</ul></div>}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
