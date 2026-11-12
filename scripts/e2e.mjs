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
async function test(name, fn) {
  if (only && !only.test(name)) return;
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto('http://127.0.0.1:5192/');
    await page.waitForSelector('.gx-bar');
    await fn(page);
    if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);
    results.push(`  PASS  ${name}`);
  } catch (e) {
    failures++;
    results.push(`  FAIL  ${name}\n        ${String(e.message).split('\n').slice(0, 3).join('\n        ')}`);
  } finally { await page.close(); }
}
const expectEq = (a, b, what) => { if (a !== b) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const detailsTitle = (page) => page.locator('.gx-details h3').first().evaluate((h) => h.querySelector('input')?.value ?? h.textContent);
const focusedText = (page) => page.evaluate(() => document.activeElement?.textContent ?? '');

await test('small sample can be explored by keyboard alone, including a connector and its details', async (page) => {
  // Tab from the page start until the tree grid has focus.
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(() => document.activeElement?.getAttribute('role') === 'row')) break;
  }
  expectEq(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'row', 'focus reaches the tree grid');
  await page.keyboard.press('ArrowDown'); // 1.1 Requirements
  await page.keyboard.press(' ');
  expectEq(await detailsTitle(page), 'Requirements', 'Space selects the focused row');
  expectEq(await page.locator('.gx-sr').textContent(), 'Requirements selected', 'selection is announced');
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
  await first.waitFor();
  expectEq(await first.getAttribute('aria-expanded'), 'false', 'an unloaded summary starts collapsed');
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
const pxPerDay = (page) => page.evaluate(() => { const b = document.querySelector('.gx-bar[data-task="t7"]').getBoundingClientRect(); return b.width / 10; }); // Data model: 8 working days over 10 calendar days

await test('drag a task: successors preview before release, the change applies to all, undo and redo (D1, D17, F8)', async (page) => {
  await page.getByRole('radio', { name: 'Days' }).click();
  await page.evaluate(() => window.gantt.current.scrollToTask('t7'));
  await page.waitForTimeout(500);
  const px = await pxPerDay(page);
  const b = await barBox(page, 't7');
  const s7 = await taskStart(page, 't7'), s8 = await taskStart(page, 't8');
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
  await page.evaluate(() => window.gantt.current.scrollToTask('t7'));
  await page.waitForTimeout(500);
  const px = await pxPerDay(page);
  let b = await barBox(page, 't7');
  const s7 = await taskStart(page, 't7');
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + px * 4, b.y + b.height / 2, { steps: 5 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  await page.waitForTimeout(200);
  expectEq(await taskStart(page, 't7'), s7, 'Esc cancels');
  b = await barBox(page, 't7');
  await page.mouse.move(b.x + b.width - 2, b.y + b.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width - 2 + px * 2, b.y + b.height / 2, { steps: 5 }); await page.mouse.up();
  await page.waitForFunction(() => window.gantt.current.getData().tasks.find((t) => t.id === 't7').duration === 10);
  await page.locator('.gx-bar[data-task="t7"]').click();
  b = await barBox(page, 't7');
  const hp = await page.locator('.gx-bar[data-task="t7"] .gx-hp').boundingBox();
  await page.mouse.move(hp.x + hp.width / 2, hp.y + hp.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.5, hp.y + hp.height / 2, { steps: 5 }); await page.mouse.up();
  await page.waitForFunction(() => window.gantt.current.getData().tasks.find((t) => t.id === 't7').progress >= 0.4);
});

await test('draw a dependency on the chart; a cycle is refused with the reason shown (D6, C9)', async (page) => {
  await page.getByRole('radio', { name: 'Weeks' }).click();
  await page.evaluate(() => window.gantt.current.scrollToTask('t12'));
  await page.waitForTimeout(500);
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
  await page.evaluate(() => window.gantt.current.scrollToTask('t3'));
  await page.waitForTimeout(400);
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
  await page.evaluate(() => window.gantt.current.scrollToTask('t3'));
  await page.waitForTimeout(400);
  const b = await barBox(page, 't3');
  await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerType: 'touch', pointerId: 7, button: 0, isPrimary: true }));
  }, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
  await page.getByRole('menu').waitFor({ timeout: 2000 });
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
