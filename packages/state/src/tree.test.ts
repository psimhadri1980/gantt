import { describe, expect, it } from 'vitest';
import type { RoadmapDocument } from '@gantt/contract';
import {
  applyDataOperation, buildModel, copyTasks, duplicateOps, findTasks, indentOps, layoutRows, moveOps, newTaskOps, outdentOps, pasteOps,
  viewModel, GROUP_PREFIX, type DataOperation, type TreeResult,
} from './index.ts';

const doc: RoadmapDocument = {
  contract: 'gantt-roadmap/1', roadmap: { id: 'r', name: 'r', version: 1, timeZone: 'UTC', start: '2026-11-02' },
  tasks: [
    { id: 's', name: 'Summary', type: 'summary', parent: null },
    { id: 'a', name: 'Alpha', type: 'task', parent: 's', start: '2026-11-02', duration: 3, owner: 'ann' },
    { id: 'b', name: 'Beta', type: 'task', parent: 's', start: '2026-11-05', duration: 2, owner: 'bob' },
    { id: 'c', name: 'Gamma', type: 'task', parent: null, start: '2026-11-09', duration: 5, owner: 'ann' },
    { id: 'm', name: 'Done', type: 'milestone', parent: null, start: '2026-11-20' },
  ],
  links: [{ id: 'l1', source: 'a', target: 'b', type: 'FS' }, { id: 'l2', source: 'b', target: 'c', type: 'FS' }],
};

const apply = (d: RoadmapDocument, r: TreeResult): RoadmapDocument => {
  if ('error' in r) throw new Error(r.error);
  const x = applyDataOperation(d, { type: 'batch', ops: r.ops });
  if ('error' in x) throw new Error(x.error);
  return x.doc;
};
const order = (d: RoadmapDocument) => layoutRows(buildModel(d), new Set()).map((r) => `${'  '.repeat(r.depth)}${r.taskId}`);
let n = 0;
const newId = () => `n${++n}`;

describe('tree operations', () => {
  it('reorders siblings and moves a task to another parent (D2)', () => {
    const m = buildModel(doc);
    expect(order(apply(doc, moveOps(m, ['b'], 's', 0)))).toEqual(['s', '  b', '  a', 'c', 'm']);
    expect(order(apply(doc, moveOps(m, ['c'], 's', 1)))).toEqual(['s', '  a', '  c', '  b', 'm']);
  });
  it('refuses moving a task into itself or under a milestone', () => {
    const m = buildModel(doc);
    expect(moveOps(m, ['s'], 'a', 0)).toHaveProperty('error');
    expect(moveOps(m, ['c'], 'm', 0)).toHaveProperty('error');
  });
  it('indents under the task above and outdents to just after the parent (D16)', () => {
    const m = buildModel(doc);
    const d1 = apply(doc, indentOps(m, ['c']));
    expect(order(d1)).toEqual(['s', '  a', '  b', '  c', 'm']);
    const d2 = apply(d1, outdentOps(buildModel(d1), ['a']));
    expect(order(d2)).toEqual(['s', '  b', '  c', 'a', 'm']);
    expect(indentOps(buildModel(doc), ['s'])).toHaveProperty('error');
    expect(outdentOps(buildModel(doc), ['c'])).toHaveProperty('error');
  });
  it('copies a subtree with its internal links only, and pastes it with new ids (D15)', () => {
    const m = buildModel(doc);
    const clip = copyTasks(m, ['s', 'a']);
    expect(clip.roots).toEqual(['s']);
    expect(clip.tasks.map((t) => t.id)).toEqual(['s', 'a', 'b']);
    expect(clip.links.map((l) => l.id)).toEqual(['l1']);
    const r = pasteOps(m, clip, null, 1, newId);
    const d = apply(doc, r);
    expect(d.tasks).toHaveLength(8);
    const pasted = d.links.filter((l) => !['l1', 'l2'].includes(l.id));
    expect(pasted).toHaveLength(1);
    expect(order(d)[0]).toBe('s');
    expect(order(d)[3]).toBe(r.ids![0]);
  });
  it('duplicates just after the original', () => {
    const d = apply(doc, duplicateOps(buildModel(doc), ['c'], newId));
    const rows = order(d);
    expect(rows[rows.indexOf('c') + 1]).toMatch(/^n\d+$/);
  });
  it('adds a new task at a position (D3, D4)', () => {
    const d = apply(doc, newTaskOps(buildModel(doc), 's', 1, { id: 'x', name: 'New', type: 'task', start: '2026-11-02', duration: 1 }));
    expect(order(d)).toEqual(['s', '  a', '  x', '  b', 'c', 'm']);
  });
  it('undo of a delete puts tasks back in place', () => {
    const r = applyDataOperation(doc, { type: 'task.delete', id: 's' });
    if ('error' in r) throw new Error(r.error);
    const back = r.inverse.reduce<RoadmapDocument>((acc, op: DataOperation) => { const x = applyDataOperation(acc, op); if ('error' in x) throw new Error(x.error); return x.doc; }, r.doc);
    expect(back.tasks.map((t) => t.id)).toEqual(doc.tasks.map((t) => t.id));
  });
});

describe('views', () => {
  const m = buildModel(doc);
  const rows = (v: Parameters<typeof viewModel>[1]) => layoutRows(viewModel(m, v).model, new Set()).map((r) => r.taskId);
  it('sorts siblings, keeping the hierarchy (D9)', () => {
    expect(rows({ sort: { field: 'name', dir: 'desc' } })).toEqual(['s', 'b', 'a', 'c', 'm']);
    const byDuration = rows({ sort: { field: 'duration', dir: 'asc' } });
    expect(byDuration.indexOf('b')).toBeLessThan(byDuration.indexOf('a')); // 2 days before 3, still inside the summary
    expect(byDuration[0]).toBe('m'); // the milestone (0 days) leads the top level
  });
  it('filters to matches and their ancestors (D10)', () => {
    expect(rows({ filter: { text: 'bet' } })).toEqual(['s', 'b']);
    expect(rows({ filter: { fields: { owner: ['ann'] } } })).toEqual(['s', 'a', 'c']);
  });
  it('groups leaves by a field, empty values last (D11)', () => {
    const r = rows({ groupBy: 'owner' });
    expect(r).toEqual([`${GROUP_PREFIX}ann`, 'a', 'c', `${GROUP_PREFIX}bob`, 'b', `${GROUP_PREFIX}`, 'm']);
    const g = viewModel(m, { groupBy: 'owner' }).model.placement.byId.get(`${GROUP_PREFIX}ann`)!;
    expect(g.scheduled).toBe(true);
  });
  it('finds by name, id or WBS code (D19)', () => {
    expect(findTasks(m, 'a')).toEqual(['s', 'a', 'b', 'c', 'm'].filter((id) => /a/i.test(m.tasks.get(id)!.name) || id === 'a'));
    expect(findTasks(m, '1.2')).toEqual(['b']);
  });
  it('leaves the model untouched when no view is active', () => {
    expect(viewModel(m, {}).model).toBe(m);
  });
});
