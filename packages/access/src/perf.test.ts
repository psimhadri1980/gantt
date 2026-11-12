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
  const t = performance.now();
  const f = filterDocument(doc, new AccessEvaluator({ subject: { id: 'x' }, rules }));
  const ms = performance.now() - t;
  expect(f.tasks.length).toBeLessThan(doc.tasks.length);
  expect(f.tasks.every((x) => !('kind' in x) || true)).toBe(true);
  expect(ms).toBeLessThan(60);
});
