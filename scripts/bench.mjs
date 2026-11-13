// Automated Phase 1 performance benchmark.
//   pnpm run bench                 (this machine, no throttling)
//   pnpm run bench --throttle 4 (CPU slowed 4x to approximate a mid-range laptop)
// Builds the demo in production mode, serves it, drives system Chrome headless, checks the budget, exits 1 on a miss.
import { build, preview } from 'vite';
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const throttle = Number(arg('throttle', '1'));
const BUDGET = { scheduleMs: 500, firstRenderMs: 1500, minFps: 50, pointerFeedbackMs: 50, longestTaskDuringInteractionMs: 100, longestTaskMs: 100 };

const root = new URL('../apps/demo/', import.meta.url).pathname;
await build({ root, logLevel: 'warn' });
const server = await preview({ root, preview: { port: 5190, host: '127.0.0.1' }, logLevel: 'warn' });
const exe = arg('chrome', ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync));
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
if (throttle > 1) await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: throttle });
await page.goto('http://127.0.0.1:5190/bench.html');
await page.waitForFunction(() => document.title.includes('ready'));

let failed = false;
for (const layout of ['bars', 'lanes']) {
  const r = await page.evaluate((l) => window.__bench(l), layout);
  const checks = [
    ['full reschedule in worker', `${r.scheduleMs} ms`, r.scheduleMs <= BUDGET.scheduleMs, `≤ ${BUDGET.scheduleMs} ms`],
    ['first render', `${r.firstRenderMs} ms`, r.firstRenderMs <= BUDGET.firstRenderMs, `≤ ${BUDGET.firstRenderMs} ms`],
    ['vertical scroll', `${r.verticalScroll.fps} fps (p95 frame ${r.verticalScroll.p95FrameMs} ms)`, r.verticalScroll.fps >= BUDGET.minFps, `≥ ${BUDGET.minFps} fps`],
    ['horizontal scroll', `${r.horizontalScroll.fps} fps (p95 frame ${r.horizontalScroll.p95FrameMs} ms)`, r.horizontalScroll.fps >= BUDGET.minFps, `≥ ${BUDGET.minFps} fps`],
    ['zoom', `${r.zoom.fps} fps (p95 frame ${r.zoom.p95FrameMs} ms)`, r.zoom.fps >= BUDGET.minFps, `≥ ${BUDGET.minFps} fps`],
    ['pointer feedback p95', `${r.pointerFeedbackMs} ms`, r.pointerFeedbackMs <= BUDGET.pointerFeedbackMs, `≤ ${BUDGET.pointerFeedbackMs} ms`],
    ['longest task (interaction)', `${r.longestTaskDuringInteractionMs} ms`, r.longestTaskDuringInteractionMs <= BUDGET.longestTaskDuringInteractionMs, `≤ ${BUDGET.longestTaskDuringInteractionMs} ms`],
    ['longest task (incl. first render)', `${r.longestTaskMs} ms`, r.longestTaskMs <= BUDGET.longestTaskMs, `≤ ${BUDGET.longestTaskMs} ms`],
  ];
  console.log(`\n${layout === 'bars' ? 'One bar per row' : 'Lanes'}: ${r.tasks} tasks, ${r.links} links, CPU throttle ${throttle}x`);
  console.log(`  longest task by phase (ms): ${JSON.stringify(r.longTaskByPhase)}`);
  for (const [name, val, ok, budget] of checks) { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(34)} ${val.padEnd(30)} budget ${budget}`); if (!ok) failed = true; }
}
await browser.close();
await server.close();
console.log(failed ? '\nBudget missed.' : '\nBudget met.');
process.exit(failed ? 1 : 0);
