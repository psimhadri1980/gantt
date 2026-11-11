import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Gantt, type GanttHandle, type GanttKinds, type GanttMessages, type GanttOperation } from '@gantt/react';
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
const german: Partial<GanttMessages> = {
  loading: 'Roadmap wird geladen…', zoomLevel: { year: 'Jahre', quarter: 'Quartale', month: 'Monate', week: 'Wochen', day: 'Tage' },
  today: 'Heute', fit: 'Einpassen', showGrid: 'Tabelle zeigen', hideGrid: 'Tabelle ausblenden', colName: 'Name', colStart: 'Beginn', colDays: 'Tage',
  unscheduled: 'Nicht geplant', todayMarker: 'Heute', schedule: 'Zeitplan', start: 'Beginn', end: 'Ende', duration: 'Dauer', progress: 'Fortschritt',
  workingDays: (n) => `${n} Arbeitstage`, saving: 'Wird gespeichert…', saved: 'Gespeichert', notSaved: (r) => `Nicht gespeichert: ${r}`,
  readOnly: 'Das Diagramm ist schreibgeschützt',
};

type SampleId = 'small' | 'large' | 'lanes' | 'lazy' | 'invalid';
function App() {
  const [sample, setSample] = useState<SampleId>('small');
  const [theme, setTheme] = useState<'light' | 'dark' | undefined>();
  const [dock, setDock] = useState<'right' | 'bottom'>('right');
  const [lockZoom, setLockZoom] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [failSave, setFailSave] = useState(false);
  const [lang, setLang] = useState<'en' | 'de'>('en');
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
          <option value="small">Small (20 tasks, kinds, lane)</option>
          <option value="large">Large (10,000 tasks)</option>
          <option value="lanes">Large as lanes</option>
          <option value="lazy">Children loaded on expand</option>
          <option value="invalid">Invalid file</option>
        </select></label>
        <label>Theme <select value={theme ?? ''} onChange={(e) => setTheme((e.target.value || undefined) as typeof theme)}>
          <option value="">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
        <label>Details <select value={dock} onChange={(e) => setDock(e.target.value as typeof dock)}>
          <option value="right">Right</option><option value="bottom">Bottom</option></select></label>
        <label>Language <select value={lang} onChange={(e) => setLang(e.target.value as typeof lang)}>
          <option value="en">English</option><option value="de">Deutsch (partial)</option></select></label>
        <label><input type="checkbox" checked={lockZoom} onChange={(e) => setLockZoom(e.target.checked)} /> Host refuses zoom</label>
        <label><input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} /> Read-only</label>
        <label><input type="checkbox" checked={failSave} onChange={(e) => setFailSave(e.target.checked)} /> Saves fail</label>
        <span className="demo-meta">{result.r.ok ? `${result.r.doc.tasks.length} tasks, ${result.r.doc.links.length} links · validated in ${result.ms} ms` : 'Refused'}</span>
      </header>
      {result.r.ok
        ? <>
          <Gantt ref={ref} data={result.r.doc} kinds={kinds} theme={theme} detailsPanel={dock} height="calc(100vh - 110px)"
            markers={[{ date: '2026-12-18', label: 'Code freeze' }]} userId="demo-user"
            readOnly={readOnly} saveState={save} onDataChanged={onDataChanged} loadChildren={result.loadChildren}
            locale={lang === 'de' ? 'de-DE' : undefined} messages={lang === 'de' ? german : undefined}
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
