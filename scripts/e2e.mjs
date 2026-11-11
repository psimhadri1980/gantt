// Phase 1 acceptance checks in a real browser (plan section 2, Phase 1 "Done when").
//   npm run e2e
// Builds the demo, serves it, drives system Chrome headless. Exits 1 on any failure.
import { build, preview } from 'vite';
import { chromium } from 'playwright-core';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const root = new URL('../apps/demo/', import.meta.url).pathname;
await build({ root, logLevel: 'warn' });
const server = await preview({ root, preview: { port: 5192, host: '127.0.0.1' }, logLevel: 'warn' });
const browser = await chromium.launch({ executablePath: ['/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync), headless: true });
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

let failures = 0;
const results = [];
async function test(name, fn) {
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
    results.push(`  FAIL  ${name}\n        ${String(e.message).split('\n')[0]}`);
  } finally { await page.close(); }
}
const expectEq = (a, b, what) => { if (a !== b) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const detailsTitle = (page) => page.locator('.gx-details h3').first().textContent();
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
  if (!details.includes('Zeitplan') || !details.includes('Arbeitstage')) throw new Error(`details not translated: ${details.slice(0, 120)}`);
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
