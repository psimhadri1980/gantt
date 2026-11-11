import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Gantt, type GanttKinds } from '@gantt/react';
import { generate, loadMock } from '@gantt/mock';
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

type SampleId = 'small' | 'large' | 'lanes' | 'invalid';
function App() {
  const [sample, setSample] = useState<SampleId>('small');
  const [theme, setTheme] = useState<'light' | 'dark' | undefined>();
  const [dock, setDock] = useState<'right' | 'bottom'>('right');
  const result = useMemo(() => {
    const t0 = performance.now();
    const input = sample === 'small' ? small
      : sample === 'invalid' ? { ...small, tasks: [...small.tasks.slice(0, 11), { ...small.tasks[11], start: 'soon' }, ...small.tasks.slice(12)] }
      : generate({ tasks: 10000, linkDensity: 0.55, laneEvery: sample === 'lanes' ? 2 : 0 });
    const r = loadMock(input);
    return { r, ms: Math.round(performance.now() - t0) };
  }, [sample]);
  return (
    <div className="demo">
      <header className="demo-bar">
        <h1>Gantt gallery</h1>
        <label>Sample <select value={sample} onChange={(e) => setSample(e.target.value as SampleId)}>
          <option value="small">Small (20 tasks, kinds, lane)</option>
          <option value="large">Large (10,000 tasks)</option>
          <option value="lanes">Large as lanes</option>
          <option value="invalid">Invalid file</option>
        </select></label>
        <label>Theme <select value={theme ?? ''} onChange={(e) => setTheme((e.target.value || undefined) as typeof theme)}>
          <option value="">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
        <label>Details <select value={dock} onChange={(e) => setDock(e.target.value as typeof dock)}>
          <option value="right">Right</option><option value="bottom">Bottom</option></select></label>
        <span className="demo-meta">{result.r.ok ? `${result.r.doc.tasks.length} tasks, ${result.r.doc.links.length} links · validated in ${result.ms} ms` : 'Refused'}</span>
      </header>
      {result.r.ok
        ? <Gantt data={result.r.doc} kinds={kinds} theme={theme} detailsPanel={dock} height="calc(100vh - 70px)"
            markers={[{ date: '2026-12-18', label: 'Code freeze' }]} />
        : <div className="demo-error" role="alert"><h2>This file was refused</h2><ul>{result.r.errors.map((e) => <li key={e.path}><code>{e.path}</code>: {e.message}</li>)}</ul></div>}
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
