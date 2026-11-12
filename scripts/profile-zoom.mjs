// CPU profile of the zoom phase only (lanes sample, 4x throttle). Build first: GANTT_NO_MINIFY=1 npx vite build (in apps/demo).
import { preview } from 'vite';
import { chromium } from 'playwright-core';
const root = new URL('../apps/demo/', import.meta.url).pathname;
const server = await preview({ root, preview: { port: 5197, host: '127.0.0.1' }, logLevel: 'warn' });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const cdp = await page.context().newCDPSession(page);
await page.goto('http://127.0.0.1:5197/bench.html');
await page.waitForFunction(() => document.title.includes('ready'));
await page.evaluate(() => window.__bench('lanes'));
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
const trace = [];
cdp.on('Tracing.dataCollected', (e) => trace.push(...e.value));
const traceDone = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline', transferMode: 'ReportEvents' });
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start');
const tasks = await page.evaluate(async () => {
  const long = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) long.push(Math.round(e.duration)); }).observe({ type: 'longtask' });
  const chart = document.querySelector('.gx-chart'); const r = chart.getBoundingClientRect();
  for (let g = 0; g < 4; g++) {
    for (let j = 0; j < 3; j++) { chart.dispatchEvent(new WheelEvent('wheel', { deltaY: g % 2 ? 100 : -100, ctrlKey: true, clientX: r.left + r.width / 2, clientY: r.top + 200, bubbles: true, cancelable: true })); await new Promise(requestAnimationFrame); }
    await new Promise((res) => setTimeout(res, 500));
  }
  return long;
});
const { profile } = await cdp.send('Profiler.stop');
await cdp.send('Tracing.end'); await traceDone;
const main = trace.filter((e) => e.ph === 'X' && e.dur);
const agg = new Map(); for (const e of main) agg.set(e.name, (agg.get(e.name) ?? 0) + e.dur / 1000);
const big = main.filter((e) => e.name === 'RunTask' && e.dur > 60000).map((e) => e);
console.log('by event (ms):', [...agg].filter(([n]) => !['RunTask', 'ThreadControllerImpl::RunTask'].includes(n)).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([n, v]) => `${n}=${v.toFixed(0)}`).join(', '));
for (const t of big) {
  const inner = main.filter((e) => e.tid === t.tid && e.ts >= t.ts && e.ts + e.dur <= t.ts + t.dur && e !== t);
  const a = new Map(); for (const e of inner) a.set(e.name, (a.get(e.name) ?? 0) + e.dur / 1000);
  console.log(`task ${(t.dur / 1000).toFixed(0)} ms:`, [...a].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([n, v]) => `${n}=${v.toFixed(0)}`).join(', '));
}
const byId = new Map(profile.nodes.map((n) => [n.id, n])); const self = new Map();
profile.samples.forEach((s, i) => { const n = byId.get(s); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000); });
console.log('long tasks:', tasks.join(', '));
console.log([...self].filter(([k]) => !k.startsWith('(idle)')).sort((a, b) => b[1] - a[1]).slice(0, 22).map(([k, v]) => `${v.toFixed(0).padStart(6)} ms  ${k}`).join('\n'));
await browser.close(); await server.close();
