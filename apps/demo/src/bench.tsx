// Performance benchmark page (Phase 1 budget). Driven by scripts/bench.mjs; also usable by hand at /bench.html.
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { Gantt } from '@gantt/react';
import { generate, loadMock } from '@gantt/mock';
import type { RoadmapDocument } from '@gantt/contract';

const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r));
const painted = async () => { await nextFrame(); await nextFrame(); };
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0; };

let longTasks: number[] = [];
const phases: Record<string, number> = {};
const phase = (name: string) => { phases[name] = Math.round(Math.max(0, ...longTasks)); longTasks = []; };
new PerformanceObserver((l) => { for (const e of l.getEntries()) longTasks.push(e.duration); }).observe({ type: 'longtask', buffered: false });

let root: Root | null = null;
const host = document.getElementById('root')!;

function dataset(layout: 'bars' | 'lanes'): RoadmapDocument {
  const r = loadMock(generate({ tasks: 10000, linkDensity: 0.55, laneEvery: layout === 'lanes' ? 2 : 0 }));
  if (!r.ok) throw new Error('generated data invalid');
  return r.doc;
}

async function frameStats(steps: number, step: (i: number) => void) {
  const gaps: number[] = [];
  let prev = await nextFrame();
  for (let i = 0; i < steps; i++) {
    step(i);
    const t = await nextFrame();
    gaps.push(t - prev); prev = t;
  }
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  return { fps: Math.round(1000 / avg), p95FrameMs: +pct(gaps, 0.95).toFixed(1), worstFrameMs: +Math.max(...gaps).toFixed(1) };
}

async function run(layout: 'bars' | 'lanes') {
  root?.unmount(); host.innerHTML = '';
  const doc = dataset(layout); // data generation and validation happen before "data arrives"
  await painted();
  longTasks = [];

  // 1. First render: data arrives → chart painted.
  const t0 = performance.now();
  root = createRoot(host);
  flushSync(() => root!.render(<Gantt data={doc} height={800} detailsPanel="right" />));
  while (!host.querySelector('.gx-bar')) await nextFrame();
  await painted();
  const firstRenderMs = Math.round(performance.now() - t0);
  await new Promise((r) => setTimeout(r, 300));
  const renderLong = Math.max(0, ...longTasks);
  phase('render');

  const chart = host.querySelector<HTMLElement>('.gx-chart')!;
  // 2. Vertical scroll at a fast fling speed: 120 px per frame (7,200 px/s) for 300 frames.
  const maxTop = chart.scrollHeight - chart.clientHeight;
  chart.scrollTop = maxTop / 4;
  const vScroll = await frameStats(300, (i) => { chart.scrollTop = maxTop / 4 + 120 * (i + 1); });
  phase('vscroll');
  // 3. Horizontal scroll.
  chart.scrollTop = maxTop / 2;
  const maxLeft = chart.scrollWidth - chart.clientWidth;
  const hScroll = await frameStats(120, (i) => { chart.scrollLeft = (maxLeft * (i + 1)) / 120; });
  phase('hscroll');
  // 4. Zoom: ctrl+wheel in and out around the centre, one step per frame.
  chart.scrollLeft = maxLeft / 2;
  const r = chart.getBoundingClientRect();
  // Four gestures of three wheel steps each, alternating in and out, with the settle-and-redraw frames included.
  const zoom = await frameStats(4 * 30, (i) => {
    const g = Math.floor(i / 30), j = i % 30;
    if (j < 3) chart.dispatchEvent(new WheelEvent('wheel', { deltaY: g % 2 ? 100 : -100, ctrlKey: true, clientX: r.left + r.width / 2, clientY: r.top + 200, bubbles: true, cancelable: true }));
  });
  await new Promise((r) => setTimeout(r, 300));
  phase('zoom');
  const scrollLong = Math.max(phases.vscroll!, phases.hscroll!, phases.zoom!);

  // 5. Pointer feedback: click a visible bar → selection painted.
  const fb: number[] = [];
  for (let i = 0; i < 10; i++) {
    const bars = [...host.querySelectorAll<HTMLElement>('.gx-bar.gx-task')].filter((b) => { const br = b.getBoundingClientRect(); return br.top > r.top && br.bottom < r.bottom && br.left > r.left && br.right < r.right; });
    const bar = bars[i % Math.max(1, bars.length)];
    if (!bar) break;
    const t = performance.now();
    bar.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextFrame();
    fb.push(performance.now() - t);
  }
  const pointerFeedbackMs = Math.round(pct(fb, 0.95));
  phase('click');

  return {
    layout, tasks: doc.tasks.length, links: doc.links.length,
    firstRenderMs, verticalScroll: vScroll, horizontalScroll: hScroll, zoom, pointerFeedbackMs,
    longestTaskMs: Math.round(Math.max(renderLong, scrollLong, phases.click!)),
    longestTaskDuringInteractionMs: Math.round(Math.max(scrollLong, phases.click!)),
    longTaskByPhase: { ...phases },
  };
}

(window as unknown as { __bench: typeof run }).__bench = run;
document.title = 'Gantt bench (ready)';
