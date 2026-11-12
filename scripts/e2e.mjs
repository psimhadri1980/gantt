// Phase 1 acceptance checks in a real browser (plan section 2, Phase 1 "Done when").
//   npm run e2e
// Builds the demo, serves it, drives system Chrome headless. Exits 1 on any failure.
import { build, preview } from 'vite';
import { chromium } from 'playwright-core';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { schedule } from '../packages/engine/src/index.ts';
import { generate } from '../packages/mock/src/generate.ts';
import smallSample from '../packages/mock/src/samples/small.json' with { type: 'json' };

const root = new URL('../apps/demo/', import.meta.url).pathname;
await build({ root, logLevel: 'warn' });
const server = await preview({ root, preview: { port: 5192, host: '127.0.0.1' }, logLevel: 'warn' });
const browser = await chromium.launch({ executablePath: ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync), headless: true });
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

let failures = 0;
const results = [];
const only = process.env.E2E_ONLY ? new RegExp(process.env.E2E_ONLY, 'i') : null;
// On CI runners a failed test is run once more (shared machines are slow and uneven); a pass on the retry is reported as such.
const retries = process.env.CI ? 1 : 0;
async function test(name, fn) {
  if (only && !only.test(name)) return;
  for (let attempt = 0; attempt < retries; attempt++) {
    const before = failures;
    await runOnce(name, fn, true);
    if (failures === before) return;
    failures = before; // try again
  }
  await runOnce(name, fn, false, retries > 0);
}
async function runOnce(name, fn, quiet, retried = false) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto('http://127.0.0.1:5192/');
    await page.waitForSelector('.gx-bar');
    await fn(page);
    if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);
    results.push(`  PASS  ${name}${retried ? ' (on retry)' : ''}`);
  } catch (e) {
    failures++;
    if (!quiet) results.push(`  FAIL  ${name}\n        ${String(e.message).split('\n').slice(0, 3).join('\n        ')}`);
  } finally { await page.close(); }
}
const expectEq = (a, b, what) => { if (a !== b) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const detailsTitle = (page) => page.locator('.gx-details h3').first().evaluate((h) => h.querySelector('input')?.value ?? h.textContent);
const focusedText = (page) => page.evaluate(() => document.activeElement?.textContent ?? '');

await test('small sample can be explored by keyboard alone, including a connector and its details', async (page) => {
  // Tab from the page start until the tree grid has focus.
  for (let i = 0; i < 45; i++) { // toolbar, view tools and column headers come first
    await page.keyboard.press('Tab');
    if (await page.evaluate(() => document.activeElement?.getAttribute('role') === 'row')) break;
  }
  expectEq(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'row', 'focus reaches the tree grid');
  await page.keyboard.press('ArrowDown'); // 1.1 Requirements
  await page.keyboard.press(' ');
  expectEq(await detailsTitle(page), 'Requirements', 'Space selects the focused row');
  expectEq(await page.locator('.gx-sr[aria-live]').textContent(), 'Requirements selected', 'selection is announced');
  await page.keyboard.press('F6');
  if (!(await page.evaluate(() => !!document.activeElement?.closest('.gx-details')))) throw new Error('F6 does not move focus into the details panel');
  // Tab through the panel to the connector button of Requirements → Sign-off.
  for (let i = 0; i < 12; i++) { if ((await focusedText(page)).trim() === 'FS') break; await page.keyboard.press('Tab'); }
  expectEq((await focusedText(page)).trim(), 'FS', 'the connector is reachable by Tab');
  await page.keyboard.press('Enter');
  expectEq(await detailsTitle(page), 'Requirements must finish before Sign-off starts', 'Enter selects the connector and shows its details');
  if (!(await page.locator('.gx-link.gx-sel').count())) throw new Error('the selected connector is not highlighted');
  // F6 returns to the grid; Esc clears.
  await page.locator('.gx-details button').first().focus();
  await page.keyboard.press('F6');
  expectEq(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'row', 'F6 returns focus to the grid');
  await page.keyboard.press('Escape');
  expectEq(await detailsTitle(page), 'Platform migration', 'Esc clears the selection');
});

await test('keyboard expands, collapses and steps through lane bars', async (page) => {
  await page.locator('[role="row"][aria-rowindex="2"]').focus();
  await page.keyboard.press('ArrowLeft'); // collapse Planning
  expectEq(await page.locator('[role="row"][aria-rowindex="2"]').getAttribute('aria-expanded'), 'false', 'ArrowLeft collapses');
  await page.keyboard.press('ArrowRight');
  expectEq(await page.locator('[role="row"][aria-rowindex="2"]').getAttribute('aria-expanded'), 'true', 'ArrowRight expands');
  const laneIndex = await page.locator('.gx-row.gx-lane').getAttribute('aria-rowindex');
  await page.locator(`[role="row"][aria-rowindex="${laneIndex}"]`).focus();
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  await page.keyboard.press(' ');
  expectEq(await detailsTitle(page), 'Indexing', 'ArrowRight steps to the second lane bar; Space selects it');
});

await test('a lane row shows several bars, each selectable with its own details, overlapping ones stacked', async (page) => {
  const lane = page.locator('.gx-row.gx-lane');
  const h = await lane.evaluate((el) => el.getBoundingClientRect().height);
  if (h <= 36) throw new Error(`lane row is not taller than a normal row (${h}px)`);
  for (const name of ['Search', 'Indexing', 'Ranking', 'Caching']) {
    await page.locator('.gx-bar', { hasText: name }).first().click();
    expectEq(await detailsTitle(page), name, `clicking the ${name} bar`);
  }
  const tops = await page.evaluate(() => Object.fromEntries(['Search', 'Indexing'].map((n) => [n, [...document.querySelectorAll('.gx-bar')].find((b) => b.textContent === n).getBoundingClientRect().top])));
  if (tops.Search === tops.Indexing) throw new Error('overlapping bars Search and Indexing are not stacked');
});

await test("host-defined kinds show the host's details, others the default", async (page) => {
  await page.locator('.gx-bar', { hasText: 'Ranking' }).first().click();
  if (!(await page.locator('.demo-host-note').count())) throw new Error('deliverable kind did not render the host component');
  await page.locator('[role="row"]', { hasText: 'Requirements' }).click();
  if (await page.locator('.demo-host-note').count()) throw new Error('use-case kind should use the default details');
  expectEq((await page.locator('.gx-d-type').first().textContent()).includes('Use case'), true, 'kind label is shown');
});

await test('an invalid mock file is refused with a path and a reason', async (page) => {
  await page.selectOption('select', 'invalid');
  const text = await page.locator('[role="alert"]').textContent();
  if (!text.includes('tasks[11].start') || !text.includes('not a date')) throw new Error(`unexpected message: ${text}`);
});

await test('operation API: data operations apply, refuse invalid results, and are reported', async (page) => {
  const r1 = await page.evaluate(() => window.gantt.current.run({ type: 'task.update', id: 't3', fields: { name: 'Architecture sign-off' } }));
  expectEq(r1.ok, true, 'task.update succeeds');
  await page.locator('.gx-name-text', { hasText: 'Architecture sign-off' }).waitFor();
  expectEq(r1.inverse[0].fields.name, 'Architecture review', 'the inverse restores the old name');
  const r2 = await page.evaluate(() => window.gantt.current.run({ type: 'link.create', link: { id: 'lx', source: 't4', target: 't2', type: 'FS' } }));
  expectEq(r2.ok, false, 'a link that closes a cycle is refused');
  expectEq(r2.stage, 'invalid', 'refused at validation');
  const log = await page.getByTestId('oplog').textContent();
  if (!log.includes('✓ api: task.update t3') || !log.includes('✗ link.create')) throw new Error(`operations log: ${log}`);
});

await test("operation API: the user's own actions go through interception", async (page) => {
  await page.getByLabel('Host refuses zoom').check();
  await page.getByRole('radio', { name: 'Days' }).click();
  await page.getByTestId('oplog').getByText('Zoom is locked by the host').waitFor();
  expectEq(await page.getByRole('radio', { name: 'Weeks' }).getAttribute('aria-checked'), 'true', 'zoom stays unchanged');
  await page.locator('[role="row"]', { hasText: 'Pilot' }).click();
  if (!(await page.getByTestId('oplog').textContent()).includes('✓ user: selection.set')) throw new Error('user selection not reported as an operation');
});

await test('the time scale labels follow every zoom level, including periods that start off-screen', async (page) => {
  const expected = { Years: [/^\d{4}$/, /^[A-Z][a-z]{2}$/], Quarters: [/^Q\d \d{4}$/, /^[A-Z][a-z]{2}$/], Months: [/^[A-Z][a-z]{2} \d{4}$/, /^W\d{1,2} \d{1,2}\/\d{1,2}$/],
    Weeks: [/^[A-Z][a-z]{2} \d{4}$/, /^W\d{1,2} · \d{1,2} [A-Z][a-z]{2}$/], Days: [/^[A-Z][a-z]{2} \d{4}$/, /^[A-Z] \d{1,2}$/] };
  for (const z of ['Days', 'Weeks', 'Months', 'Quarters', 'Years', 'Months', 'Days']) {
    await page.getByRole('radio', { name: z }).click();
    await page.waitForTimeout(300);
    const seen = await page.evaluate(() => {
      const hb = document.querySelector('.gx-scale').getBoundingClientRect();
      const vis = (sel) => [...document.querySelectorAll(sel)].filter((s) => { const b = s.getBoundingClientRect(); return b.width > 0 && b.left >= hb.left - 1 && b.left < hb.right; }).map((s) => s.textContent);
      return { major: vis('.gx-major span'), minor: vis('.gx-minor span').filter(Boolean) };
    });
    if (!seen.major.length) throw new Error(`${z}: no top-row label in view`);
    if (!seen.minor.length) throw new Error(`${z}: no bottom-row label in view`);
    const [maj, min] = expected[z];
    if (!seen.major.every((t) => maj.test(t))) throw new Error(`${z}: top row shows ${JSON.stringify(seen.major)}`);
    const clipped = await page.evaluate(() => [...document.querySelectorAll('.gx-tick span')].filter((s) => s.textContent && s.scrollWidth > s.clientWidth + 1).map((s) => s.textContent));
    if (clipped.length) throw new Error(`${z}: labels cut off: ${clipped.slice(0, 3).join(', ')}`);
    if (!seen.minor.every((t) => min.test(t))) throw new Error(`${z}: bottom row shows ${JSON.stringify(seen.minor.slice(0, 4))}`);
  }
});

await test('children load on demand when a row is expanded (H2)', async (page) => {
  await page.selectOption('select >> nth=0', 'lazy');
  const first = page.locator('[role="row"][aria-rowindex="2"]');
  // Until the new sample is placed, the previous one stays on screen.
  await page.waitForFunction(() => window.gantt.current?.getData().tasks.some((t) => t.hasChildren));
  await page.waitForFunction(() => document.querySelector('[role="row"][aria-rowindex="2"]')?.getAttribute('aria-expanded') === 'false', null, { timeout: 5000 })
    .catch(async () => { throw new Error(`an unloaded summary starts collapsed: aria-expanded=${await first.getAttribute('aria-expanded')}`); });
  const before = await page.locator('.gx-grid-body [role="row"]').count();
  await first.locator('.gx-twisty').click();
  await first.getByText('Loading…').waitFor();
  await page.waitForFunction((n) => document.querySelectorAll('.gx-grid-body [role="row"]').length > n, before);
  expectEq(await first.getAttribute('aria-expanded'), 'true', 'the row is expanded once its children arrive');
  const level2 = await page.locator('.gx-grid-body [role="row"][aria-level="2"]').count();
  if (!level2) throw new Error('no child rows appeared');
});

await test('zooming keeps the selected item where it is on screen', async (page) => {
  const bar = page.locator('.gx-bar', { hasText: 'Data model' }).first();
  await bar.click();
  const x0 = (await bar.boundingBox()).x;
  for (const z of ['Days', 'Months', 'Weeks']) {
    await page.getByRole('radio', { name: z }).click();
    await page.waitForTimeout(300);
    const x = (await page.locator('.gx-bar', { hasText: 'Data model' }).first().boundingBox()).x;
    if (Math.abs(x - x0) > 2) throw new Error(`${z}: the selected bar moved from x=${x0} to x=${x}`);
  }
});

await test('all visible text follows the messages and locale (German sample)', async (page) => {
  await page.selectOption('select >> nth=3', 'de');
  await page.getByRole('button', { name: 'Heute' }).waitFor();
  await page.getByRole('radio', { name: 'Wochen' }).waitFor();
  await page.locator('[role="row"]', { hasText: 'Requirements' }).click();
  const details = await page.locator('.gx-details').textContent();
  if (!details.includes('Zeitplan') || !details.includes('Fortschritt')) throw new Error(`details not translated: ${details.slice(0, 120)}`);
  if (!/\d+\.\s?Nov/.test(details) && !/Nov\./.test(details)) throw new Error(`dates not in German format: ${details.slice(0, 160)}`);
});

await test('save indicator shows Saving, then Saved or the reason it was not saved (F13)', async (page) => {
  await page.evaluate(() => window.gantt.current.run({ type: 'task.update', id: 't3', fields: { progress: 0.5 } }));
  await page.locator('.gx-save', { hasText: 'Saving…' }).waitFor();
  await page.locator('.gx-save', { hasText: 'Saved' }).waitFor();
  await page.getByLabel('Saves fail').check();
  await page.evaluate(() => window.gantt.current.run({ type: 'task.update', id: 't3', fields: { progress: 0.6 } }));
  await page.locator('.gx-save', { hasText: 'Not saved: the server is unreachable' }).waitFor();
});

await test('read-only mode refuses changes with a reason (G9)', async (page) => {
  await page.getByLabel('Read-only').check();
  const r = await page.evaluate(() => window.gantt.current.run({ type: 'task.delete', id: 't20' }));
  expectEq(r.reason, 'The chart is read-only', 'refusal reason');
  await page.locator('[role="row"]', { hasText: 'Decommission legacy' }).waitFor();
});

await test('holidays are shaded apart from weekends (G6)', async (page) => {
  await page.getByRole('radio', { name: 'Days' }).click();
  await page.evaluate(() => window.gantt.current.scrollToTask('t17'));
  await page.locator('.gx-holiday').first().waitFor({ state: 'attached', timeout: 5000 }).catch(() => { throw new Error('no holiday shading around 24–25 Dec'); });
  if (!(await page.locator('.gx-nonwork:not(.gx-holiday)').count())) throw new Error('no weekend shading');
});

// ---------- Phase 4: scheduling ----------
await test('the engine gives identical results in the browser worker and on the server (C11)', async (page) => {
  await page.goto('http://127.0.0.1:5192/bench.html');
  await page.waitForFunction(() => document.title.includes('ready'));
  const samples = { small: smallSample, generated: generate({ tasks: 3000, linkDensity: 0.6, seed: 7 }), lanes: generate({ tasks: 2000, laneEvery: 2, seed: 3 }) };
  for (const [name, doc] of Object.entries(samples)) {
    const server = schedule(doc);
    const expected = JSON.parse(JSON.stringify({ tasks: [...server.tasks].sort(([a], [b]) => a.localeCompare(b)), changes: server.changes, issues: server.issues, end: server.end }));
    const browser = await page.evaluate((d) => window.__schedule(d), doc);
    if (!browser.offThread) throw new Error('the engine did not run in the worker');
    delete browser.offThread;
    if (JSON.stringify(browser) !== JSON.stringify(expected)) throw new Error(`${name}: browser and server results differ`);
  }
});

await test('moving a task moves its successors in the same change, and a cycle is refused with the reason (K1, C9)', async (page) => {
  // Requirements (t2) → Sign-off (t4) → Data model (t7) → API layer (t8): move Requirements one week later.
  const before = await page.evaluate(() => window.gantt.current.getData().tasks.find((t) => t.id === 't7').start);
  const r = await page.evaluate(() => window.gantt.current.run({ type: 'task.update', id: 't2', fields: { start: '2026-11-09', end: null } }));
  expectEq(r.ok, true, 'the move is accepted');
  const after = await page.evaluate(() => Object.fromEntries(window.gantt.current.getData().tasks.filter((t) => ['t4', 't7', 't8'].includes(t.id)).map((t) => [t.id, t.start])));
  if (!(after.t7 > before)) throw new Error(`Data model did not move: ${before} → ${after.t7}`);
  expectEq(after.t4, '2026-11-20', 'Sign-off follows Requirements');
  const inverse = r.inverse.map((o) => o.id);
  if (!inverse.includes('t7') || !inverse.includes('t2')) throw new Error('the successors are not in the same operation');
  const c = await page.evaluate(() => window.gantt.current.run({ type: 'link.create', link: { id: 'lx', source: 't8', target: 't2', type: 'FS' } }));
  expectEq(c.ok, false, 'a cycle is refused');
  if (!/cycle/i.test(c.reason)) throw new Error(`no explanation: ${c.reason}`);
});

await test('critical path highlighting and the Schedule button (C2, K1)', async (page) => {
  await page.getByRole('button', { name: 'Critical path' }).click();
  await page.locator('.gx-bar.gx-critical').first().waitFor();
  await page.getByRole('button', { name: /^Schedule/ }).click();
  await page.locator('.gx-toolbar-row [role="status"]', { hasText: /rescheduled|up to date/ }).waitFor();
  await page.locator('[role="row"]', { hasText: 'Hypercare' }).click();
  await page.locator('.gx-details', { hasText: 'Slack' }).waitFor();
});

// ---------- Phase 5: editing on the chart ----------
const taskStart = (page, id) => page.evaluate((i) => window.gantt.current.getData().tasks.find((t) => t.id === i)?.start, id);
async function barBox(page, id) { const b = await page.locator(`.gx-bar[data-task="${id}"]`).boundingBox(); if (!b) throw new Error(`bar ${id} not visible`); return b; }
/** Fails with what is there instead, when the point is not on the task's bar (layouts differ between machines). */
async function assertOnBar(page, id, x, y) {
  const what = await page.evaluate(({ id, x, y }) => {
    const el = document.elementFromPoint(x, y);
    return el?.closest(`.gx-bar[data-task="${id}"]`) ? null : `${el?.tagName}.${el?.className} (viewport ${innerWidth}×${innerHeight})`;
  }, { id, x, y });
  if (what) throw new Error(`(${Math.round(x)}, ${Math.round(y)}) is not on bar ${id}: ${what}`);
}
/** Scrolls to a task and waits until its bar stops moving (scrolling and redraws settle), so pointer coordinates are right. */
async function scrollSettled(page, id) {
  await page.evaluate((i) => window.gantt.current.scrollToTask(i), id);
  await page.waitForTimeout(400);
  // Put the bar's start 60 px into the visible chart, so the whole bar is clear of the details panel on any machine.
  await page.evaluate((i) => {
    const c = document.querySelector('.gx-chart'), b = document.querySelector(`.gx-bar[data-task="${i}"]`);
    if (c && b) c.scrollLeft += b.getBoundingClientRect().left - c.getBoundingClientRect().left - 60;
  }, id);
  let last = '';
  for (let k = 0; k < 40; k++) {
    await page.waitForTimeout(100);
    const b = await page.locator(`.gx-bar[data-task="${id}"]`).boundingBox();
    const key = b ? `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)}` : '';
    if (key && key === last) return;
    last = key;
  }
}
const pxPerDay = (page) => page.evaluate(() => { const b = document.querySelector('.gx-bar[data-task="t7"]').getBoundingClientRect(); return b.width / 10; }); // Data model: 8 working days over 10 calendar days

await test('drag a task: successors preview before release, the change applies to all, undo and redo (D1, D17, F8)', async (page) => {
  await page.getByRole('radio', { name: 'Days' }).click();
  await scrollSettled(page, 't7');
  const px = await pxPerDay(page);
  const b = await barBox(page, 't7');
  const s7 = await taskStart(page, 't7'), s8 = await taskStart(page, 't8');
  await assertOnBar(page, 't7', b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + px * 3.1, b.y + b.height / 2, { steps: 8 });
  await page.locator('.gx-bar.gx-preview[data-task="t8"]').waitFor({ timeout: 3000 }).catch(() => { throw new Error('the successor API layer is not previewed while dragging'); });
  const tip = await page.locator('.gx-tooltip').textContent();
  if (!/working days/.test(tip)) throw new Error(`no live dates in the tooltip: ${tip}`);
  expectEq(await taskStart(page, 't7'), s7, 'nothing changes before release');
  await page.mouse.up();
  await page.waitForFunction((v) => window.gantt.current.getData().tasks.find((t) => t.id === 't7').start !== v, s7, { timeout: 5000 })
    .catch(async () => { throw new Error(`the drop did not move the task: ${await page.locator('.gx-notice').textContent().catch(() => '')}`); });
  const n7 = await taskStart(page, 't7'), n8 = await taskStart(page, 't8');
  if (!(n7 > s7) || !(n8 > s8)) throw new Error(`task and successor did not both move: ${s7}→${n7}, ${s8}→${n8}`);
  await page.keyboard.press('Control+z');
  await page.waitForFunction((v) => window.gantt.current.getData().tasks.find((t) => t.id === 't7').start === v, s7, { timeout: 5000 })
    .catch(async () => { throw new Error(`undo did not restore: ${await taskStart(page, 't7')}`); });
  expectEq(await taskStart(page, 't8'), s8, 'undo restores the successor too');
  await page.keyboard.press('Control+y');
  await page.waitForFunction((v) => window.gantt.current.getData().tasks.find((t) => t.id === 't7').start === v, n7);
});

await test('Esc cancels a drag, resize changes the duration, progress can be dragged (D17, D6)', async (page) => {
  await page.getByRole('radio', { name: 'Days' }).click();
  await scrollSettled(page, 't7');
  const px = await pxPerDay(page);
  let b = await barBox(page, 't7');
  const s7 = await taskStart(page, 't7');
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + px * 4, b.y + b.height / 2, { steps: 5 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  await page.waitForTimeout(200);
  expectEq(await taskStart(page, 't7'), s7, 'Esc cancels');
  b = await barBox(page, 't7');
  await assertOnBar(page, 't7', b.x + b.width - 2, b.y + b.height / 2);
  await page.mouse.move(b.x + b.width - 2, b.y + b.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width - 2 + px * 2, b.y + b.height / 2, { steps: 5 }); await page.mouse.up();
  await page.waitForFunction(() => window.gantt.current.getData().tasks.find((t) => t.id === 't7').duration === 10, null, { timeout: 8000 })
    .catch(async () => { throw new Error(`resize: duration ${await page.evaluate(() => JSON.stringify(window.gantt.current.getData().tasks.find((t) => t.id === 't7')))}`); });
  await page.locator('.gx-bar[data-task="t7"]').click();
  b = await barBox(page, 't7');
  const hp = await page.locator('.gx-bar[data-task="t7"] .gx-hp').boundingBox();
  await page.mouse.move(hp.x + hp.width / 2, hp.y + hp.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.5, hp.y + hp.height / 2, { steps: 5 }); await page.mouse.up();
  await page.waitForFunction(() => window.gantt.current.getData().tasks.find((t) => t.id === 't7').progress >= 0.4, null, { timeout: 8000 })
    .catch(async () => { throw new Error(`progress drag: ${await page.evaluate(() => JSON.stringify(window.gantt.current.getData().tasks.find((t) => t.id === 't7')))}`); });
});

await test('draw a dependency on the chart; a cycle is refused with the reason shown (D6, C9)', async (page) => {
  await page.getByRole('radio', { name: 'Weeks' }).click();
  await scrollSettled(page, 't12');
  const links0 = await page.evaluate(() => window.gantt.current.getData().links.length);
  const from = page.locator('.gx-bar[data-task="t12"]');
  await from.hover();
  const h = await page.locator('.gx-bar[data-task="t12"] .gx-hl-end').boundingBox();
  const to = await barBox(page, 't14');
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down();
  await page.mouse.move(to.x + 4, to.y + to.height / 2, { steps: 10 }); await page.mouse.up();
  await page.waitForFunction((n) => window.gantt.current.getData().links.length === n + 1, links0);
  const made = await page.evaluate(() => window.gantt.current.getData().links.at(-1));
  expectEq(`${made.source}-${made.type}-${made.target}`, 't12-FS-t14', 'a finish-to-start link from Indexing to Caching');
  // Back from Caching to Indexing would close a cycle.
  await page.locator('.gx-bar[data-task="t14"]').hover();
  // The details panel may cover the right end, so start from the start handle (a start-to-start link also closes the cycle).
  const h2 = await page.locator('.gx-bar[data-task="t14"] .gx-hl-start').boundingBox();
  const back = await barBox(page, 't12');
  await page.mouse.move(h2.x + h2.width / 2, h2.y + h2.height / 2); await page.mouse.down();
  await page.mouse.move(back.x + 4, back.y + back.height / 2, { steps: 10 });
  const tip = await page.locator('.gx-tooltip').textContent();
  if (!/cycle/i.test(tip)) throw new Error(`no reason while hovering: ${tip}`);
  await page.mouse.up();
  await page.waitForTimeout(200);
  expectEq(await page.evaluate(() => window.gantt.current.getData().links.length), links0 + 1, 'no cyclic link was created');
});

await test('keyboard only: move a task, link it to another, undo (F9, F3)', async (page) => {
  await page.locator('[role="row"]', { hasText: 'Auth integration' }).click();
  const s9 = await taskStart(page, 't9');
  await page.keyboard.press('Alt+ArrowRight');
  await page.waitForFunction((v) => window.gantt.current.getData().tasks.find((t) => t.id === 't9').start !== v, s9);
  await page.keyboard.press('l');
  await page.locator('.gx-link-mode').waitFor();
  await page.keyboard.press('ArrowDown'); // Crew Atlas lane
  await page.keyboard.press('ArrowDown'); // Rollout
  await page.keyboard.press('ArrowDown'); // Pilot (already a successor of Auth integration)
  await page.keyboard.press('ArrowDown'); // Training
  const n0 = await page.evaluate(() => window.gantt.current.getData().links.length);
  await page.keyboard.press('Enter');
  await page.waitForFunction((n) => window.gantt.current.getData().links.length === n + 1, n0).catch(async () => { throw new Error(`no link: ${await page.locator('.gx-notice').textContent()}`); });
  await page.keyboard.press('Control+z');
  await page.waitForFunction((n) => window.gantt.current.getData().links.length === n, n0);
});

await test('context menu on a bar and a connector; connector type and lag in its details (D8)', async (page) => {
  await scrollSettled(page, 't3');
  const s3 = await taskStart(page, 't3');
  await page.locator('.gx-bar[data-task="t3"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Move one day later/ }).click();
  await page.waitForFunction((v) => window.gantt.current.getData().tasks.find((t) => t.id === 't3').start !== v, s3);
  await page.locator('[role="row"]', { hasText: 'Requirements' }).click();
  await page.locator('.gx-details button', { hasText: 'FS' }).first().click();
  await page.locator('.gx-details select[aria-label="Type"]').selectOption('SS');
  await page.waitForFunction(() => window.gantt.current.getData().links.find((l) => l.id === 'l1').type === 'SS');
  await page.locator('.gx-details input[aria-label="Lag"]').fill('2');
  await page.locator('.gx-details input[aria-label="Lag"]').press('Enter');
  await page.waitForFunction(() => window.gantt.current.getData().links.find((l) => l.id === 'l1').lag === 2);
});

await test('touch: a long press on a bar opens the menu (F10)', async (page) => {
  await scrollSettled(page, 't3');
  const b = await barBox(page, 't3');
  await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerType: 'touch', pointerId: 7, button: 0, isPrimary: true }));
  }, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
  await page.getByRole('menu').waitFor({ timeout: 2000 });
});

// ---------- Phase 5 step 2: grid editing and views ----------
const rowNames = (page) => page.evaluate(() => [...document.querySelectorAll('.gx-grid-body [role="row"][data-task]')]
  .sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top)).map((r) => r.querySelector('.gx-name-text')?.textContent));
const task = (page, name) => page.evaluate((n) => window.gantt.current.getData().tasks.find((t) => t.name === n), name);
const dataLen = (page) => page.evaluate(() => { const d = window.gantt.current.getData(); return { tasks: d.tasks.length, links: d.links.length }; });
const row = (page, name) => page.locator('.gx-grid-body [role="row"]', { has: page.locator('.gx-name-text', { hasText: new RegExp(`^${name}$`) }) });

await test('add a task from the action column and from the placeholder row; undo (D3, D4)', async (page) => {
  await row(page, 'API layer').hover();
  await page.getByRole('button', { name: 'Add a task below API layer' }).click();
  const edit = page.locator('.gx-inline-edit');
  await edit.waitFor();
  await edit.fill('Load tests'); await edit.press('Enter');
  await page.waitForFunction(() => window.gantt.current.getData().tasks.some((t) => t.name === 'Load tests'));
  const t = await task(page, 'Load tests');
  expectEq(t.parent, 't6', 'the new task is a sibling of API layer');
  // The grid redraws once the engine has placed the changed roadmap.
  await page.waitForFunction(() => { const n = [...document.querySelectorAll('.gx-grid-body [role="row"][data-task]')].sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top)).map((r) => r.querySelector('.gx-name-text')?.textContent); return n[n.indexOf('API layer') + 1] === 'Load tests'; }, null, { timeout: 5000 })
    .catch(async () => { throw new Error(`placed right below API layer: ${(await rowNames(page)).join(', ')}`); });
  await page.locator('.gx-placeholder-input').click();
  await page.keyboard.type('Wrap-up'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.gantt.current.getData().tasks.some((t) => t.name === 'Wrap-up' && t.parent === null));
  await page.waitForFunction(() => { const n = [...document.querySelectorAll('.gx-grid-body [role="row"][data-task]')].sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top)); return n.at(-1)?.querySelector('.gx-name-text')?.textContent === 'Wrap-up'; }, null, { timeout: 5000 })
    .catch(async () => { throw new Error(`quick entry adds at the end: ${(await rowNames(page)).join(', ')}`); });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.waitForFunction(() => !window.gantt.current.getData().tasks.some((t) => t.name === 'Wrap-up'));
});

await test('reorder rows by dragging, indent and outdent, copy and paste with internal links (D2, D16, D15)', async (page) => {
  const pilot = await row(page, 'Pilot').boundingBox(); // aim at its top edge: "before Pilot"
  const training = await row(page, 'Training').locator('.gx-grip').boundingBox();
  await page.mouse.move(training.x + 10, training.y + training.height / 2); await page.mouse.down();
  await page.mouse.move(pilot.x + 10, pilot.y + 3, { steps: 6 }); await page.mouse.up();
  await page.waitForFunction(() => { const d = window.gantt.current.getData(); const o = (n) => d.tasks.find((t) => t.name === n).order; return o('Training') < o('Pilot'); }, null, { timeout: 8000 }).catch(async () => { throw new Error('row drag did not reorder: ' + await page.locator('.gx-notice').textContent().catch(() => '')); });
  await page.waitForFunction(() => { const n = [...document.querySelectorAll('.gx-grid-body [role="row"][data-task]')].sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top)).map((r) => r.querySelector('.gx-name-text')?.textContent); return n.indexOf('Training') < n.indexOf('Pilot'); }, null, { timeout: 5000 })
    .catch(async () => { throw new Error(`Training not above Pilot: ${(await rowNames(page)).join(', ')}`); });
  // Indent goes under the row above (Rollout); a task linked to the row above would be refused with the reason.
  await row(page, 'Decommission legacy').click();
  await page.keyboard.press('Control+]');
  await page.waitForFunction(() => window.gantt.current.getData().tasks.find((t) => t.name === 'Decommission legacy').parent === 't15', null, { timeout: 8000 }).catch(async () => { throw new Error('indent: ' + await page.locator('.gx-notice').textContent().catch(() => '')); });
  await page.keyboard.press('Control+[');
  await page.waitForFunction(() => window.gantt.current.getData().tasks.find((t) => t.name === 'Decommission legacy').parent === null, null, { timeout: 8000 }).catch(async () => { throw new Error('outdent: ' + await page.locator('.gx-notice').textContent().catch(() => '')); });
  // Copy Core platform (4 tasks, 2 links between them) and paste it.
  const before = await dataLen(page);
  await row(page, 'Core platform').click();
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await page.waitForFunction((n) => window.gantt.current.getData().tasks.length === n + 4, before.tasks, { timeout: 8000 }).catch(() => { throw new Error('step: ' + '(n) => window.gantt.current.getData().tasks.length === n + 4'); });
  const after = await dataLen(page);
  expectEq(after.links - before.links, 2, 'the links inside the copied subtree are copied');
  await page.keyboard.press('Control+z');
  await page.waitForFunction((n) => window.gantt.current.getData().tasks.length === n, before.tasks, { timeout: 8000 }).catch(() => { throw new Error('step: ' + '(n) => window.gantt.current.getData().tasks.length === n'); });
});

await test('sort by a column header, filter, group and find (D9, D10, D11, D19)', async (page) => {
  const top = async () => (await page.evaluate(() => [...document.querySelectorAll('.gx-grid-body [role="row"][aria-level="1"]')]
    .sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top)).map((r) => r.querySelector('.gx-name-text').textContent)));
  const nameHead = page.getByRole('columnheader', { name: /Name/ });
  await nameHead.getByRole('button', { name: 'Name', exact: true }).click();
  expectEq(await nameHead.getAttribute('aria-sort'), 'ascending', 'aria-sort');
  expectEq((await top()).join(','), 'Build,Decommission legacy,Planning,Rollout', 'ascending');
  await nameHead.getByRole('button', { name: 'Name', exact: true }).click();
  expectEq((await top())[0], 'Rollout', 'descending');
  await nameHead.getByRole('button', { name: 'Name', exact: true }).click();
  expectEq(await nameHead.getAttribute('aria-sort'), null, 'third click clears');
  await page.getByRole('searchbox', { name: 'Filter tasks' }).fill('pilot');
  await page.waitForFunction(() => document.querySelectorAll('.gx-grid-body [role="row"][data-task]').length === 2);
  expectEq((await rowNames(page)).join(','), 'Rollout,Pilot', 'a match and its ancestor');
  await page.getByRole('button', { name: 'Clear filter' }).click();
  // Group by the Days column from its header menu.
  await page.getByRole('columnheader', { name: /Days/ }).click({ button: 'right' });
  await page.getByRole('menuitemradio', { name: 'Group by this column' }).click();
  await page.locator('.gx-row.gx-group').first().waitFor();
  if (await page.locator('.gx-grid-body [role="row"][aria-level="1"]:not(.gx-group)').count()) throw new Error('ungrouped top-level rows remain');
  await page.getByRole('button', { name: 'Remove grouping' }).click();
  await page.locator('.gx-row.gx-group').first().waitFor({ state: 'detached' });
  // Find.
  await page.locator('.gx-chart').focus();
  await page.keyboard.press('Control+f');
  await page.getByRole('searchbox', { name: 'Find' }).fill('go-live');
  await page.getByText('1 of 1').waitFor();
  await page.waitForFunction(() => window.gantt.current.getSelection().some((s) => s.taskId === 't18'));
});

await test('columns: show one, resize, reorder; saved views restore them (D18, F12)', async (page) => {
  await page.getByRole('button', { name: 'Columns' }).click();
  await page.getByRole('dialog', { name: 'Columns' }).getByLabel('Owner').check();
  await page.keyboard.press('Escape');
  await page.getByRole('columnheader', { name: /Owner/ }).waitFor();
  const h = await page.getByRole('separator', { name: 'Resize WBS' }).boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down();
  await page.mouse.move(h.x + 40, h.y + h.height / 2, { steps: 4 }); await page.mouse.up();
  const ws = (await page.getByRole('columnheader', { name: /^WBS/ }).boundingBox()).width;
  if (ws < 90) throw new Error(`WBS column not resized: ${ws}`);
  await page.getByRole('combobox', { name: 'View' }).selectOption({ label: 'Save view as…' });
  await page.getByRole('textbox', { name: 'View name' }).fill('Owners');
  await page.keyboard.press('Enter');
  await page.getByRole('combobox', { name: 'View' }).selectOption({ label: 'Default view' });
  await page.getByRole('columnheader', { name: /Owner/ }).waitFor({ state: 'detached' });
  await page.getByRole('combobox', { name: 'View' }).selectOption({ label: 'Owners' });
  await page.getByRole('columnheader', { name: /Owner/ }).waitFor();
});

await test('multi-select: Shift+click a range, move them together, lasso on the chart (D14)', async (page) => {
  await row(page, 'Data model').click();
  await row(page, 'Auth integration').click({ modifiers: ['Shift'] });
  expectEq(await page.locator('.gx-grid-body [role="row"][aria-selected="true"]').count(), 3, 'three rows selected');
  const s9 = await taskStart(page, 't9');
  await page.keyboard.press('Alt+ArrowRight');
  await page.waitForFunction((v) => window.gantt.current.getData().tasks.find((t) => t.id === 't9').start !== v, s9);
  // Bulk field change from the details panel, as one operation.
  await page.getByRole('textbox', { name: 'Owner: Set for all 3' }).fill('zoe');
  await page.locator('.gx-bulk button', { hasText: 'Apply' }).first().click();
  await page.waitForFunction(() => ['t7', 't8', 't9'].every((id) => window.gantt.current.getData().tasks.find((t) => t.id === id).owner === 'zoe'));
  await row(page, 'Data model').click();
  await page.keyboard.press('Escape');
  await scrollSettled(page, 't2');
  const a = await barBox(page, 't2'), b = await barBox(page, 't3');
  const x0 = Math.min(a.x, b.x) - 12, y0 = a.y - 4, x1 = Math.max(a.x + a.width, b.x + b.width) + 4, y1 = b.y + b.height + 4;
  await page.keyboard.down('Shift');
  await page.mouse.move(x0, y0); await page.mouse.down();
  await page.mouse.move(x1, y1, { steps: 6 }); await page.mouse.up();
  await page.keyboard.up('Shift');
  const sel = await page.evaluate(() => window.gantt.current.getSelection().map((s) => s.taskId).sort().join(','));
  if (!sel.includes('t2') || !sel.includes('t3')) throw new Error(`lasso selected ${sel}`);
});

await test('compact mode on a small screen: details open as a sheet and close (F5)', async (page) => {
  await page.setViewportSize({ width: 600, height: 800 });
  await page.locator('.gx-root.gx-compact').waitFor();
  if (await page.locator('.gx-grid').count()) throw new Error('the grid is shown in compact mode');
  await scrollSettled(page, 't3');
  await page.locator('.gx-bar[data-task="t3"]').click();
  await page.locator('.gx-sheet .gx-details').waitFor();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.locator('.gx-sheet').waitFor({ state: 'detached' });
});

await test('host templates for a cell, a bar and a tooltip (G7)', async (page) => {
  await page.goto('http://127.0.0.1:5192/?templates=1');
  await page.waitForSelector('.gx-bar');
  await page.locator('.demo-owner').first().waitFor();
  await page.locator('.gx-bar .demo-bar-tpl').first().waitFor();
  await scrollSettled(page, 't3');
  await page.locator('.gx-bar[data-task="t3"]').hover();
  await page.locator('.gx-tooltip .demo-tip-tpl').waitFor();
});

// ---------- Phase 7: scheduling depth and time scale ----------
async function depthSample(page) { await page.goto('http://127.0.0.1:5192/?sample=depth'); await page.waitForSelector('.gx-bar[data-task="t8"]'); }

await test('a scheduling problem explains itself; its fix applies as one change and can be undone (C4, C5)', async (page) => {
  await depthSample(page);
  await page.getByRole('button', { name: 'Problems (2)' }).click();
  const dlg = page.getByRole('dialog', { name: 'Scheduling problems' });
  await dlg.getByText('Auth integration finishes after its deadline 2026-12-01').waitFor();
  await dlg.getByRole('button', { name: 'Remove the deadline of Auth integration' }).click();
  await page.getByRole('button', { name: 'Problems (1)' }).waitFor();
  expectEq(await page.evaluate(() => window.gantt.current.getData().tasks.find((t) => t.id === 't9').deadline), undefined, 'deadline removed');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Problems (2)' }).waitFor();
});

await test('an hour-based task displays correctly at every zoom level (G4, G5)', async (page) => {
  await depthSample(page);
  for (const z of ['Years', 'Quarters', 'Months', 'Weeks', 'Days', 'Hours']) {
    await page.getByRole('radio', { name: z, exact: true }).click();
    await page.waitForFunction((n) => document.querySelector(`[role="radio"][aria-checked="true"]`)?.textContent === n, z);
    await page.waitForTimeout(150);
    const r = await page.evaluate(() => {
      const w = (id) => document.querySelector(`.gx-bar[data-task="${id}"]`).getBoundingClientRect().width;
      const day = document.querySelector('.gx-bar[data-task="t7"]').getBoundingClientRect().width / 10; // Data model: 8 working days over 10 calendar days
      return { h1: w('h1'), h2: w('h2'), day };
    });
    // 4 hours = half an 8-hour day; 12 hours = a day and a half (never under 2 px).
    if (Math.abs(r.h1 - Math.max(2, r.day * 0.5)) > 1 || Math.abs(r.h2 - Math.max(2, r.day * 1.5)) > 1) throw new Error(`${z}: ${JSON.stringify(r)}`);
  }
  await page.locator('.gx-tick.gx-minor span', { hasText: /^\d\d$/ }).first().waitFor(); // hour labels
  expectEq((await row(page, 'Cut-over rehearsal').locator('.gx-col-duration').textContent()).trim(), '4 h', 'duration shown in hours');
});

await test('split tasks draw their pieces; slack is drawn as a bar extension (D12, B4)', async (page) => {
  await depthSample(page);
  expectEq(await page.locator('.gx-bar[data-task="t8"] .gx-piece').count(), 2, 'two pieces');
  if (await page.locator('.gx-slack').count()) throw new Error('slack shown before asked');
  await page.getByRole('button', { name: 'Slack', exact: true }).click();
  await page.locator('.gx-slack').first().waitFor();
});

await test('custom scale labels and a fixed start boundary (G2, G3)', async (page) => {
  await depthSample(page);
  await page.getByRole('radio', { name: 'Fiscal' }).click();
  await page.locator('.gx-tick.gx-major span', { hasText: /^FY27 Q3$/ }).first().waitFor();
  await page.getByRole('radio', { name: 'Weeks', exact: true }).click();
  await page.evaluate(() => { document.querySelector('.gx-chart').scrollLeft = 0; });
  await page.waitForTimeout(200);
  const first = await page.evaluate(() => [...document.querySelectorAll('.gx-tick.gx-minor')].find((t) => parseFloat(t.style.left) <= 0 && parseFloat(t.style.left) + parseFloat(t.style.width) > 0)?.textContent);
  expectEq(first, 'W44 · 26 Oct', 'the scale starts at the fixed boundary');
});

// ---------- Phase 8: tracking ----------
await test('a baseline renders under the current bars, with how the finish moved (B1)', async (page) => {
  await depthSample(page);
  await page.getByLabel('Baseline').selectOption({ label: 'Kick-off plan (v10)' });
  const base = page.locator('.gx-baseline[data-task="t7"]');
  await base.waitFor();
  const bb = await base.boundingBox(), bar = await barBox(page, 't7');
  if (!(bb.y >= bar.y + bar.height - 1 && bb.y < bar.y + bar.height + 8)) throw new Error(`not under the bar: ${JSON.stringify({ bb, bar })}`);
  if (!(bb.x < bar.x)) throw new Error('the baseline should start earlier than the current bar');
  if (!/later now/.test(await base.getAttribute('title'))) throw new Error('no finish difference');
});

await test('S-curve totals match the data (B2)', async (page) => {
  await depthSample(page);
  await page.getByRole('button', { name: 'S-curve' }).click();
  await page.getByLabel('Baseline').selectOption({ label: 'Kick-off plan (v10)' });
  const shown = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-total]')].map((e) => [e.dataset.total, parseFloat(e.textContent)])));
  // The same totals, computed here from the data alone.
  const want = await page.evaluate(() => {
    const d = window.gantt.current.getData();
    const parents = new Set(d.tasks.map((t) => t.parent));
    const leaves = d.tasks.filter((t) => !parents.has(t.id) && t.type === 'task' && t.start && t.mode !== 'inactive');
    const work = (t) => (t.durationUnit === 'hour' ? (t.duration ?? 8) / 8 : t.duration ?? 1);
    const r = (v) => Math.round(v * 10) / 10;
    return { planned: r(leaves.reduce((a, t) => a + work(t), 0)), actual: r(leaves.reduce((a, t) => a + work(t) * (t.progress ?? 0), 0)), baseline: r(d.baselines[0].tasks.reduce((a, t) => a + t.work, 0)) };
  });
  expectEq(JSON.stringify(shown), JSON.stringify(want), 'totals');
});

await test('progress line on a chosen date marks tasks ahead and behind; rollups show children on summaries (B3, A5)', async (page) => {
  await depthSample(page);
  await page.getByRole('button', { name: 'Progress line' }).click();
  await page.getByLabel('Status date').fill('2026-12-01');
  await page.locator('.gx-progress-line circle.gx-pl-behind').first().waitFor();
  await page.getByRole('button', { name: 'Rollups' }).click();
  expectEq(await page.locator('.gx-bar[data-task="t6"] .gx-rollup').count(), 3, 'Core platform shows its three tasks');
});

// ---------- Phase 9: resources ----------
async function staffedSample(page) { await page.goto('http://127.0.0.1:5192/?sample=resources'); await page.waitForSelector('.gx-bar[data-task="t7"]'); }
const openLoad = (page) => page.getByRole('button', { name: 'Resources', exact: true }).click();

await test('without resource data the load shows total demand per period, and per owner (E7)', async (page) => {
  await openLoad(page);
  await page.getByText('No resource data: each task counts as one person full time.').waitFor();
  const labels = await page.locator('.gx-load-label').allTextContents();
  if (labels[0] !== 'Total demand' || labels.length < 2) throw new Error(`rows: ${labels.join(' | ')}`);
  if (!(await page.locator('.gx-load-cell[data-row="total"]').count())) throw new Error('no demand bars');
  if (await page.locator('.gx-load-cell[data-over]').count()) throw new Error('over-allocation shown without any capacity');
});

await test('with assignments the load is per resource, over-allocation highlighted against capacity (E3, E4, E5)', async (page) => {
  await staffedSample(page);
  await openLoad(page);
  expectEq((await page.locator('.gx-load-label').allTextContents()).join(' | '), '⠿Pat · 1 FTE | ⠿Sam · 1 FTE | ⠿Kim (part-time) · 0.6 FTE | Unassigned', 'rows');
  await page.locator('.gx-load-cell[data-row="r:pat"][data-over]').first().waitFor();
  const tip = await page.locator('.gx-load-cell[data-row="r:pat"][data-over]').first().getAttribute('title');
  if (!/over-allocated on \d+ days/.test(tip)) throw new Error(tip);
});

await test('assign in the details panel and by dragging a person onto a bar (E1, E2)', async (page) => {
  await staffedSample(page);
  await row(page, 'Requirements').click();
  await page.locator('.gx-details').getByRole('combobox', { name: 'Assign' }).selectOption({ label: 'Pat' });
  await page.waitForFunction(() => window.gantt.current.getData().tasks.find((t) => t.id === 't2').resources.some((r) => r.id === 'pat'));
  await page.locator('.gx-details').getByRole('spinbutton', { name: 'Share of Pat’s time' }).fill('50');
  await page.locator('.gx-details').getByRole('spinbutton', { name: 'Share of Pat’s time' }).press('Enter');
  await page.waitForFunction(() => window.gantt.current.getData().tasks.find((t) => t.id === 't2').resources.find((r) => r.id === 'pat').allocation === 0.5);
  await openLoad(page);
  await scrollSettled(page, 't3');
  await page.locator('.gx-load-label', { hasText: 'Kim' }).dragTo(page.locator('.gx-bar[data-task="t3"]'));
  await page.waitForFunction(() => window.gantt.current.getData().tasks.find((t) => t.id === 't3').resources.some((r) => r.id === 'kim'));
});

await test('levelling removes over-allocation in one undoable change (E6)', async (page) => {
  await staffedSample(page);
  await openLoad(page);
  await page.locator('.gx-load-cell[data-row="r:pat"][data-over]').first().waitFor();
  await page.getByRole('button', { name: 'Level resources' }).click();
  await page.getByText(/tasks moved so nobody is over-allocated/).first().waitFor();
  await page.waitForFunction(() => !document.querySelector('.gx-load-cell[data-over]'));
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.locator('.gx-load-cell[data-row="r:pat"][data-over]').first().waitFor();
});

await test('a backlog item dragged onto the chart becomes a task there (D5)', async (page) => {
  await staffedSample(page);
  await scrollSettled(page, 't16');
  await page.locator('.gx-backlog-item', { hasText: 'Load testing' }).dragTo(page.locator('.gx-chart'), { targetPosition: { x: 300, y: await page.evaluate(() => { const c = document.querySelector('.gx-chart').getBoundingClientRect(); const r = [...document.querySelectorAll('.gx-grid-body [role="row"][data-task="t15"]')][0].getBoundingClientRect(); return r.top - c.top + r.height / 2; }) } });
  await page.waitForFunction(() => window.gantt.current.getData().tasks.some((t) => t.name === 'Load testing' && t.parent === 't15' && t.duration === 3));
  await page.locator('.gx-backlog-item', { hasText: 'Load testing' }).waitFor({ state: 'detached' });
});

// ---------- Phase 10: interchange and platform ----------
async function exportFile(page, label) {
  await page.getByRole('button', { name: 'Export' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: label }).click()]);
  const path = await dl.path();
  return { name: dl.suggestedFilename(), bytes: readFileSync(path) };
}

await test('export to PNG, PDF, Excel, CSV and Microsoft Project produces valid files (I2, I3, I4)', async (page) => {
  const png = await exportFile(page, 'Image (PNG)');
  expectEq(png.bytes.subarray(1, 4).toString(), 'PNG', 'PNG signature');
  if (png.bytes.length < 5000) throw new Error('PNG suspiciously small');
  const pdf = await exportFile(page, 'PDF');
  expectEq(pdf.bytes.subarray(0, 5).toString(), '%PDF-', 'PDF header'); expectEq(pdf.name, 'Platform-migration.pdf', 'file name');
  if (!pdf.bytes.toString('latin1').includes('/DCTDecode') || !pdf.bytes.toString('latin1').trimEnd().endsWith('%%EOF')) throw new Error('PDF without image or trailer');
  const xlsx = await exportFile(page, 'Excel workbook');
  expectEq(xlsx.bytes.subarray(0, 2).toString(), 'PK', 'xlsx is a ZIP');
  const csv = await exportFile(page, 'CSV');
  if (!csv.bytes.toString('utf8').includes('Data model')) throw new Error('CSV without tasks');
  const xml = await exportFile(page, 'Microsoft Project XML');
  if (!xml.bytes.toString('utf8').includes('<Name>Data model</Name>')) throw new Error('MSPDI without tasks');
});

await test('import from CSV and Microsoft Project applies as one undoable change (I1, I4)', async (page) => {
  const csv = (await exportFile(page, 'CSV')).bytes.toString('utf8').replace('Data model', 'Data model (imported)');
  await page.locator('input[type="file"][aria-label="Import…"]').setInputFiles({ name: 'plan.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.waitForFunction(() => window.gantt.current.getData().tasks.find((t) => t.id === 't7').name === 'Data model (imported)');
  await page.locator('.gx-notice', { hasText: 'plan.csv: 1 changes imported' }).waitFor(); // exactly the one real change
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.waitForFunction(() => window.gantt.current.getData().tasks.find((t) => t.id === 't7').name === 'Data model');
  const xml = (await exportFile(page, 'Microsoft Project XML')).bytes.toString('utf8').replace('<Name>Pilot</Name>', '<Name>Pilot (from Project)</Name>');
  await page.locator('input[type="file"][aria-label="Import…"]').setInputFiles({ name: 'plan.xml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  await page.waitForFunction(() => window.gantt.current.getData().tasks.find((t) => t.id === 't16').name === 'Pilot (from Project)');
  await page.locator('input[type="file"][aria-label="Import…"]').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('name,duration\nX,three\n') });
  await page.locator('.gx-notice', { hasText: /bad.csv could not be imported: row 2.duration/ }).waitFor();
});

await test('full screen mode (G8)', async (page) => {
  await page.getByRole('button', { name: 'Full screen' }).click();
  await page.waitForFunction(() => document.fullscreenElement?.classList.contains('gx-root'));
  await page.getByRole('button', { name: 'Exit full screen' }).click();
  await page.waitForFunction(() => !document.fullscreenElement);
});

// ---------- Phase 2 and 3: access and the Proposal workflow, through the real interface ----------
async function proposals(page) {
  await page.goto('http://127.0.0.1:5192/?sample=proposals');
  await page.waitForSelector('.gx-pbar');
}
const userSelect = (page) => page.getByLabel('User');
const viewSelect = (page) => page.locator('.gx-pbar select');
async function pickProposal(page) {
  const value = await viewSelect(page).locator('option[value^="p:"]').first().getAttribute('value');
  await viewSelect(page).selectOption(value);
  await page.waitForTimeout(200);
}

await test('a user without view access sees the no-access state and nothing is fetched (L6)', async (page) => {
  await proposals(page);
  await userSelect(page).selectOption('mallory');
  await page.getByText('You do not have access to this roadmap.').waitFor();
  if (await page.locator('[role="treegrid"]').count()) throw new Error('the chart rendered without view');
});

await test('a viewer does not see tasks they may not view (L12)', async (page) => {
  await proposals(page);
  await userSelect(page).selectOption('erin');
  await page.locator('[role="treegrid"]').waitFor();
  if (await page.locator('[role="row"]', { hasText: 'Crew Atlas' }).count()) throw new Error('a crew row is visible to Erin');
});

await test('lifecycle through the interface: edit creates a Proposal, submit, review, approve changes Current (K0, K2, K5)', async (page) => {
  await proposals(page);
  // Alice edits a task name in the details panel: Current is untouched, a Proposal is created and shown.
  await page.locator('[role="row"]', { hasText: 'Data model' }).click();
  const name = page.locator('.gx-details h3 input');
  await name.fill('Data model v2');
  await name.press('Enter');
  await page.locator('.gx-save', { hasText: 'Saved' }).waitFor();
  expectEq((await viewSelect(page).inputValue()).startsWith('p:'), true, 'the view switches to the new Proposal');
  expectEq(await page.evaluate(() => window.svc.snapshot('erin').current.tasks.find((t) => t.id === 't7').name), 'Data model', 'Current is unchanged');
  await page.locator('.gx-pbar-actions [data-action="submit"]').click();
  await page.locator('.gx-state', { hasText: 'Submitted' }).waitFor();
  // Locked: the name field is no longer editable, with the reason.
  await page.locator('[role="row"]', { hasText: 'Data model v2' }).click();
  if (await page.locator('.gx-details h3 input').count()) throw new Error('a submitted Proposal is still editable');
  // Bob reviews.
  await userSelect(page).selectOption('bob');
  await page.waitForSelector('.gx-pbar');
  await pickProposal(page);
  await page.locator('.gx-pbar-actions [data-action="review"]').click();
  await page.locator('.gx-state', { hasText: 'Reviewed' }).waitFor();
  // Carol approves; Current now has the change as version 13.
  await userSelect(page).selectOption('carol');
  await page.waitForSelector('.gx-pbar');
  await pickProposal(page);
  await page.locator('.gx-pbar-actions [data-action="approve"]').click();
  await page.waitForFunction(() => window.svc.snapshot('erin').version === 13);
  expectEq(await viewSelect(page).inputValue(), 'current', 'after approval the view returns to Current');
  await page.locator('[role="row"]', { hasText: 'Data model v2' }).waitFor();
  if (!(await viewSelect(page).locator('option', { hasText: 'Current (version 13)' }).count())) throw new Error('Current is not shown as version 13');
});

await test('return needs a reason, and the author sees it (K2d)', async (page) => {
  await proposals(page);
  await page.evaluate(() => { const p = window.svc.change('alice', null, [{ entity: 'task', op: 'update', id: 't3', fields: { progress: 0.9 } }]); window.svc.act('alice', p.id, 'submit'); });
  await userSelect(page).selectOption('carol');
  await page.waitForSelector('.gx-pbar');
  await pickProposal(page);
  await page.locator('.gx-pbar-actions [data-action="return"]').click();
  await page.getByLabel('Reason').fill('Progress looks too high');
  await page.getByRole('button', { name: 'Return', exact: true }).click();
  await page.locator('.gx-state', { hasText: 'Returned' }).waitFor();
  await page.locator('.gx-pbar .gx-note', { hasText: 'Returned: Progress looks too high' }).waitFor();
});

await test('separation of duties: the submitter is refused approval with the reason, and allowed when relaxed (K2a, K2b)', async (page) => {
  await proposals(page);
  await userSelect(page).selectOption('frank');
  await page.waitForSelector('.gx-pbar');
  await page.locator('[role="row"]', { hasText: 'Pilot' }).click();
  await page.locator('.gx-details input[max="100"]').fill('40');
  await page.locator('.gx-details input[max="100"]').press('Enter');
  await page.locator('.gx-save', { hasText: 'Saved' }).waitFor();
  await page.locator('.gx-pbar-actions [data-action="submit"]').click();
  await page.locator('.gx-state', { hasText: 'Submitted' }).waitFor();
  const approve = page.locator('.gx-pbar-actions [data-action="approve"]');
  expectEq(await approve.getAttribute('aria-disabled'), 'true', 'Approve is disabled for the submitter');
  if (!(await approve.getAttribute('title')).includes('You submitted this Proposal')) throw new Error('no reason on the disabled Approve');
  // Playwright will not click an aria-disabled control; a user can, and is told why it does nothing (F14).
  await approve.click({ force: true });
  await page.locator('.gx-pbar-status', { hasText: 'You submitted this Proposal' }).waitFor();
  // With separation of duties off (a fresh mock service), the same user can approve.
  await page.getByLabel('Separation of duties').uncheck();
  // A fresh mock service: wait until the previous chart (with its save indicator and Proposal) is gone.
  await page.locator('.gx-save').waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.querySelector('.gx-pbar select')?.value === 'current');
  await page.locator('[role="row"]', { hasText: 'Pilot' }).click();
  await page.locator('.gx-details input[max="100"]').fill('40');
  await page.locator('.gx-details input[max="100"]').press('Enter');
  await page.locator('.gx-save', { hasText: 'Saved' }).waitFor();
  await page.locator('.gx-pbar-actions [data-action="submit"]').click();
  await page.locator('.gx-state', { hasText: 'Submitted' }).waitFor();
  await page.locator('.gx-pbar-actions [data-action="approve"]').click();
  await page.waitForFunction(() => window.svc.snapshot('erin').version === 13);
});

await test('a Proposal expires when its phase limit passes on the mock clock (K2e, M7)', async (page) => {
  await proposals(page);
  await page.evaluate(() => window.svc.change('alice', null, [{ entity: 'task', op: 'update', id: 't3', fields: { progress: 0.3 } }]));
  for (let i = 0; i < 8; i++) await page.getByRole('button', { name: '+1 day' }).click();
  await page.getByTestId('oplog').getByText('event: proposalExpired (preparing)').waitFor();
  await page.getByTestId('oplog').getByText(/event: proposalExpiring/).waitFor();
  await pickProposal(page);
  await page.locator('.gx-state', { hasText: 'Expired' }).waitFor();
  await page.getByRole('button', { name: 'New Proposal from this' }).waitFor();
});

// ---------- Phase 6: working together on Proposals ----------
const viewProposal = async (page, id) => {
  await page.locator(`.gx-pbar select option[value="p:${id}"]`).waitFor({ state: 'attached' });
  await viewSelect(page).selectOption(`p:${id}`);
  await page.locator('.gx-pbar .gx-state').waitFor();
};

await test('two users change the same field group in one Proposal: flagged, and Approve waits for a pick (K7, K8, K9)', async (page) => {
  await proposals(page);
  const id = await page.evaluate(() => {
    const p = window.svc.change('alice', null, [{ entity: 'task', op: 'update', id: 't7', fields: { start: '2026-11-17' } }], 'Data model dates');
    window.svc.change('frank', p.id, [{ entity: 'task', op: 'update', id: 't7', fields: { duration: 12 } }]);
    window.svc.act('alice', p.id, 'submit');
    return p.id;
  });
  await viewProposal(page, id);
  await page.getByRole('button', { name: 'Concurrent changes (1)' }).waitFor();
  await page.locator('.gx-row.gx-flagged .gx-name-text', { hasText: 'Data model' }).waitFor();
  // The approver sees Approve disabled with the reason, picks a version, then approves.
  await userSelect(page).selectOption('carol');
  await viewProposal(page, id);
  const approve = page.locator('.gx-pbar [data-action="approve"]');
  await page.waitForFunction(() => /pick a version/.test(document.querySelector('.gx-pbar [data-action="approve"]')?.getAttribute('title') ?? ''));
  await page.getByRole('button', { name: 'Concurrent changes (1)' }).click();
  await page.getByRole('button', { name: 'Keep frank’s version' }).click();
  await page.waitForFunction(() => !document.querySelector('.gx-pbar [data-action="approve"]')?.getAttribute('aria-disabled'));
  await approve.click();
  await page.waitForFunction(() => window.svc.snapshot('erin').version === 13);
  const t7 = await page.evaluate(() => window.svc.snapshot('erin').current.tasks.find((t) => t.id === 't7'));
  expectEq(t7.duration, 12, 'Frank’s version was approved');
  expectEq(t7.start, '2026-11-16', 'Alice’s start was not kept');
});

await test('two users change different fields of one task: no flag (K7)', async (page) => {
  await proposals(page);
  const id = await page.evaluate(() => {
    const p = window.svc.change('alice', null, [{ entity: 'task', op: 'update', id: 't7', fields: { name: 'Data model v2' } }]);
    window.svc.change('frank', p.id, [{ entity: 'task', op: 'update', id: 't7', fields: { duration: 12 } }]);
    return p.id;
  });
  await viewProposal(page, id);
  await page.locator('.gx-name-text', { hasText: 'Data model v2' }).waitFor();
  if (await page.locator('.gx-row.gx-flagged').count()) throw new Error('a task is flagged');
  if (await page.getByRole('button', { name: /Concurrent changes/ }).count()) throw new Error('the concurrent-changes button is shown');
});

await test('parallel Proposals are warned; approving one makes the other stale live; Refresh with a choice clears it (K11–K18, H5)', async (page) => {
  await proposals(page);
  const [mine, theirs] = await page.evaluate(() => {
    // As the chart records a move of a task with predecessors: the date plus a start-no-earlier-than constraint.
    const a = window.svc.change('alice', null, [{ entity: 'task', op: 'update', id: 't7', fields: { start: '2026-11-18', constraint: { type: 'SNET', date: '2026-11-18' } } }, { entity: 'task', op: 'update', id: 't3', fields: { name: 'Arch review (mine)' } }], 'Mine');
    const b = window.svc.change('frank', null, [{ entity: 'task', op: 'update', id: 't7', fields: { duration: 10 } }, { entity: 'task', op: 'update', id: 't2', fields: { name: 'Requirements (new)' } }], 'Theirs');
    return [a.id, b.id];
  });
  await viewProposal(page, mine);
  await page.getByRole('button', { name: 'Concurrent changes (1)' }).click();
  await page.locator('.gx-concurrent').getByText('Also changed in another Proposal').waitFor(); // Alice may not see Frank's Proposal (K8)
  // The Proposal list shows the shared task (K11).
  await page.getByRole('button', { name: /^Proposals \(/ }).click();
  await page.locator(`.gx-plist tr[data-proposal="${mine}"] .gx-chip.gx-warn`, { hasText: '1' }).waitFor();
  await page.getByRole('button', { name: /^Proposals \(/ }).click();
  // Frank's Proposal is approved elsewhere: Alice's view turns stale without a reload.
  await page.evaluate((id) => { window.svc.act('frank', id, 'submit'); window.svc.act('carol', id, 'approve'); }, theirs);
  await page.getByText('Current has changed: 1 newer version').first().waitFor();
  await page.locator('.gx-row.gx-flagged .gx-name-text', { hasText: 'Data model' }).waitFor();
  await page.getByRole('button', { name: 'Refresh Proposal' }).click();
  const dlg = page.getByRole('dialog', { name: /Refresh from version 12 to 13/ });
  await dlg.waitFor();
  await dlg.getByText('Requirements (new)').waitFor(); // incoming without overlap, for information
  const confirm = dlg.getByRole('button', { name: 'Confirm refresh' });
  expectEq(await confirm.getAttribute('aria-disabled'), 'true', 'Confirm waits for every choice');
  await dlg.getByRole('radio', { name: 'Keep mine' }).check();
  await page.waitForFunction(() => !document.querySelector('.gx-modal .gx-primary')?.getAttribute('aria-disabled'));
  await confirm.click();
  await dlg.waitFor({ state: 'detached' });
  await page.getByText('Refreshed from version 12 to 13').waitFor();
  if (await page.getByText(/Current has changed: \d/).count()) throw new Error('still stale after refresh');
  const doc = await page.evaluate((id) => window.svc.proposalDocument('alice', id), mine);
  expectEq(doc.tasks.find((t) => t.id === 't2').name, 'Requirements (new)', 'incoming change taken');
  expectEq(doc.tasks.find((t) => t.id === 't7').start, '2026-11-18', 'my start kept');
  // The refresh can be undone.
  await page.getByRole('button', { name: 'Undo refresh' }).click();
  await page.getByText('Current has changed: 1 newer version').first().waitFor();
});

await test('a baseline is offered on approval and needs baseline.save (B1, K22)', async (page) => {
  await proposals(page);
  const id = await page.evaluate(() => { const p = window.svc.change('alice', null, [{ entity: 'task', op: 'update', id: 't3', fields: { progress: 0.5 } }]); window.svc.act('alice', p.id, 'submit'); return p.id; });
  if (await page.locator('[data-action="save-baseline"]').count()) throw new Error('Alice may not save baselines');
  await userSelect(page).selectOption('carol');
  await viewProposal(page, id);
  await page.locator('.gx-pbar [data-action="approve"]').click();
  const form = page.getByRole('form', { name: 'Save baseline' });
  await form.waitFor();
  await form.getByLabel('Baseline name').fill('After review');
  await form.getByRole('button', { name: 'Save baseline' }).click();
  await page.getByText('Baseline “After review” saved').waitFor();
  await page.getByLabel('Baseline').locator('option', { hasText: 'After review' }).waitFor({ state: 'attached' });
  expectEq(await page.evaluate(() => window.svc.snapshot('carol').version), 13, 'saving a baseline does not create a version');
});

await test('an earlier version is restored only through a new Proposal; the summary counts open Proposals (K22)', async (page) => {
  await proposals(page);
  await page.evaluate(() => { const p = window.svc.change('alice', null, [{ entity: 'task', op: 'update', id: 't3', fields: { name: 'Arch review v2' } }]); window.svc.act('alice', p.id, 'submit'); window.svc.act('carol', p.id, 'approve'); });
  await page.waitForFunction(() => window.svc.snapshot('alice').version === 13);
  await page.locator('.gx-pbar select option[value="v:12"]').waitFor({ state: 'attached' });
  await viewSelect(page).selectOption('v:12');
  await page.locator('.gx-pbar [data-action="restore"]').click();
  await page.locator('.gx-pbar select option:checked', { hasText: 'Restore version 12' }).waitFor({ state: 'attached' });
  await page.locator('.gx-name-text', { hasText: /^Architecture review$/ }).waitFor();
  expectEq(await page.evaluate(() => window.svc.snapshot('erin').current.tasks.find((t) => t.id === 't3').name), 'Arch review v2', 'Current is unchanged until approval');
  await page.keyboard.press('Escape');
  await page.locator('.gx-details dd', { hasText: /^1$/ }).first().waitFor(); // Open proposals: 1
});

await test('an import in the Proposal workflow lands in a Proposal, never in Current (I1, K0)', async (page) => {
  await proposals(page);
  await page.locator('.gx-bar[data-task="t7"]').waitFor();
  const csv = (await exportFile(page, 'CSV')).bytes.toString('utf8').replace('Data model', 'Data model v2');
  await page.locator('input[type="file"][aria-label="Import…"]').setInputFiles({ name: 'plan.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.locator('.gx-pbar .gx-state', { hasText: 'Draft' }).waitFor();
  expectEq(await page.evaluate(() => window.svc.snapshot('erin').current.tasks.find((t) => t.id === 't7').name), 'Data model', 'Current unchanged');
  const p = await page.evaluate(() => window.svc.snapshot('alice').proposals[0]);
  expectEq(await page.evaluate((id) => window.svc.proposalDocument('alice', id).tasks.find((t) => t.id === 't7').name, p.id), 'Data model v2', 'the Proposal has it');
});

await test('accessibility scan of the Proposal workflow (axe, WCAG 2.2 AA)', async (page) => {
  await proposals(page);
  await page.evaluate(() => window.svc.change('alice', null, [{ entity: 'task', op: 'update', id: 't3', fields: { progress: 0.3 } }]));
  await page.locator('.gx-pbar select option[value^="p:"]').first().waitFor({ state: 'attached' });
  await pickProposal(page);
  await page.getByRole('button', { name: 'Compare with Current' }).click();
  await page.getByRole('button', { name: 'History' }).click();
  await page.locator('[role="row"]', { hasText: 'Architecture review' }).click();
  await page.addScriptTag({ content: axeSource });
  const v = await page.evaluate(async () => {
    const r = await window.axe.run(document.querySelector('.gx-root'), { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] });
    return r.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical').map((x) => `${x.id} (${x.nodes.length}): ${x.nodes[0]?.target.join(' ')}`);
  });
  if (v.length) throw new Error(v.join(' | '));
});

await test('accessibility scan of concurrent changes, the Proposal list and the refresh preview (axe, WCAG 2.2 AA)', async (page) => {
  await proposals(page);
  const mine = await page.evaluate(() => {
    const a = window.svc.change('alice', null, [{ entity: 'task', op: 'update', id: 't7', fields: { duration: 9 } }], 'Mine');
    window.svc.change('frank', a.id, [{ entity: 'task', op: 'update', id: 't7', fields: { start: '2026-11-19' } }]);
    const b = window.svc.change('frank', null, [{ entity: 'task', op: 'update', id: 't7', fields: { duration: 11 } }], 'Theirs');
    window.svc.act('frank', b.id, 'submit'); window.svc.act('carol', b.id, 'approve');
    return a.id;
  });
  await viewProposal(page, mine);
  await page.getByRole('button', { name: /Concurrent changes/ }).click();
  await page.addScriptTag({ content: axeSource });
  const scan = (sel) => page.evaluate(async (s) => {
    const r = await window.axe.run(document.querySelector(s), { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] });
    return r.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical').map((x) => `${x.id} (${x.nodes.length}): ${x.nodes[0]?.target.join(' ')}`);
  }, sel);
  let v = await scan('.gx-root');
  await page.getByRole('button', { name: /^Proposals \(/ }).click();
  v = v.concat(await scan('.gx-root'));
  await page.locator('.gx-plist').getByRole('button', { name: 'Refresh Proposal' }).click(); // from the list (K16)
  await page.getByRole('dialog').waitFor();
  v = v.concat(await scan('.gx-modal'));
  if (v.length) throw new Error(v.join(' | '));
});

for (const theme of ['Light', 'Dark']) {
  await test(`accessibility scan (axe, WCAG 2.2 AA), ${theme.toLowerCase()} theme`, async (page) => {
    await page.selectOption('select >> nth=1', theme.toLowerCase());
    await page.locator('[role="row"]', { hasText: 'Requirements' }).click();
    await page.addScriptTag({ content: axeSource });
    const v = await page.evaluate(async () => {
      const r = await window.axe.run(document.querySelector('.gx-root'), { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] });
      return r.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical').map((x) => `${x.id} (${x.nodes.length}): ${x.nodes[0]?.target.join(' ')}`);
    });
    if (v.length) throw new Error(v.join(' | '));
  });
}

await browser.close();
await server.close();
console.log(results.join('\n'));
console.log(failures ? `\n${failures} failed.` : '\nAll passed.');
process.exit(failures ? 1 : 0);
