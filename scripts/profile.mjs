import { preview } from 'vite';
import { chromium } from 'playwright-core';
const root = '/home/simhadri/gantt/apps/demo/';
const server = await preview({ root, preview: { port: 5191, host: '127.0.0.1' }, logLevel: 'warn' });
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await page.goto('http://127.0.0.1:5191/bench.html');
await page.waitForFunction(() => document.title.includes('ready'));
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start');
await page.evaluate((l) => window.__bench(l), process.argv[2] ?? 'bars');
const { profile } = await cdp.send('Profiler.stop');
const self = new Map(); const byId = new Map(profile.nodes.map(n => [n.id, n]));
const dt = profile.timeDeltas; const counts = new Map();
profile.samples.forEach((s, i) => counts.set(s, (counts.get(s) ?? 0) + (dt[i] ?? 0)));
for (const [id, t] of counts) { const n = byId.get(id); const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`; self.set(k, (self.get(k) ?? 0) + t / 1000); }
console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${v.toFixed(0).padStart(6)} ms  ${k}`).join('\n'));
await browser.close(); await server.close();
