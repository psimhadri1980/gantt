// Cold-start timing of the model build steps (first call, no JIT warm-up), as the browser sees it on first load.
import { generate } from '../packages/mock/src/generate.ts';
import { place } from '../packages/engine/src/schedule.ts';
import { buildModel, layoutRows, barIndex } from '../packages/state/src/index.ts';
const doc = generate({ tasks: 10000, linkDensity: 0.55 });
const t = (n: string, f: () => unknown) => { const s = performance.now(); const r = f(); console.log(n.padEnd(12), (performance.now() - s).toFixed(1), 'ms'); return r; };
t('place', () => place(doc));
const m = t('buildModel', () => buildModel(doc)) as ReturnType<typeof buildModel>;
const rows = t('layoutRows', () => layoutRows(m, new Set())) as ReturnType<typeof layoutRows>;
t('barIndex', () => barIndex(rows));
