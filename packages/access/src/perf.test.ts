import { expect, it } from 'vitest';
import { generate } from '../../mock/src/generate.ts';
import { AccessEvaluator, filterDocument, type Rule } from './index.ts';

// L13: permissions must not slow a large chart. Generous bounds; this guards against per-field re-evaluation.
it('filters 10,000 tasks with task-level and field-level rules quickly', () => {
  const doc = generate({ tasks: 10000, linkDensity: 0.55 });
  const rules: Rule[] = [
    { effect: 'allow', permissions: ['view'] },
    { effect: 'allow', permissions: ['view.fields'], fields: ['start', 'duration', 'end', 'progress'] },
    { effect: 'deny', permissions: ['view'], scope: { tasks: { ids: ['t5', 't9'] } } },
  ];
  const ev = new AccessEvaluator({ subject: { id: 'x' }, rules });
  filterDocument(doc, ev); // warm up
  // Best of three, so other test files running in parallel do not make it flaky.
  let ms = Infinity, f = doc;
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    f = filterDocument(doc, new AccessEvaluator({ subject: { id: 'x' }, rules }));
    ms = Math.min(ms, performance.now() - t);
  }
  expect(f.tasks.length).toBeLessThan(doc.tasks.length);
  expect(f.tasks.every((x) => !('owner' in x))).toBe(true);
  expect(ms).toBeLessThan(60);
});
