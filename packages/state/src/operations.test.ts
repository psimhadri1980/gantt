import { describe, expect, it, vi } from 'vitest';
import type { RoadmapDocument } from '@gantt/contract';
import { applyDataOperation, OperationPipeline, type DataOperation, type OperationHooks } from './index.ts';

const doc: RoadmapDocument = {
  contract: 'gantt-roadmap/1', roadmap: { id: 'r', name: 'r', version: 1, timeZone: 'UTC', start: '2026-11-02' },
  tasks: [
    { id: 's', name: 'S', type: 'summary', parent: null },
    { id: 'a', name: 'A', type: 'task', parent: 's', start: '2026-11-02', duration: 3 },
    { id: 'b', name: 'B', type: 'task', parent: null, start: '2026-11-09', duration: 2 },
  ],
  links: [{ id: 'l1', source: 'a', target: 'b', type: 'FS' }],
};

const undo = (d: RoadmapDocument, inv: DataOperation[]) => inv.reduce((acc, op) => { const r = applyDataOperation(acc, op); if ('error' in r) throw new Error(r.error); return r.doc; }, d);

describe('applyDataOperation', () => {
  it('updates without mutating and returns an exact inverse', () => {
    const r = applyDataOperation(doc, { type: 'task.update', id: 'a', fields: { name: 'A2', progress: 0.5 } });
    if ('error' in r) throw new Error(r.error);
    expect(r.doc.tasks[1]!.name).toBe('A2');
    expect(doc.tasks[1]!.name).toBe('A');
    expect(undo(r.doc, r.inverse)).toEqual(doc);
  });
  it('deleting a summary removes its subtree and touching links, and can be undone', () => {
    const r = applyDataOperation(doc, { type: 'task.delete', id: 's' });
    if ('error' in r) throw new Error(r.error);
    expect(r.doc.tasks.map((t) => t.id)).toEqual(['b']);
    expect(r.doc.links).toEqual([]);
    const back = undo(r.doc, r.inverse);
    expect(new Set(back.tasks.map((t) => t.id))).toEqual(new Set(['s', 'a', 'b']));
    expect(back.links).toEqual(doc.links);
  });
  it('refuses operations that would make an invalid document', () => {
    expect(applyDataOperation(doc, { type: 'link.create', link: { id: 'l2', source: 'b', target: 'a', type: 'FS' } })).toHaveProperty('error');
    expect(applyDataOperation(doc, { type: 'task.update', id: 'b', fields: { start: 'soon' } })).toHaveProperty('error');
    expect(applyDataOperation(doc, { type: 'link.create', link: { id: 'l3', source: 's', target: 'a', type: 'FS' } })).toHaveProperty('error');
  });
});

describe('OperationPipeline', () => {
  const make = (hooks: OperationHooks) => {
    let d = doc; const view: unknown[] = [];
    const p = new OperationPipeline(() => hooks, (op) => { const r = applyDataOperation(d, op); if ('error' in r) return r; d = r.doc; return { inverse: r.inverse }; }, (op) => view.push(op));
    return { p, get doc() { return d; }, view };
  };
  it('runs interception, authorisation, apply and listen in order', async () => {
    const order: string[] = [];
    const h = make({
      beforeOperation: () => { order.push('before'); },
      authorize: async () => { order.push('authorize'); return true; },
      operation: () => order.push('listen'),
    });
    const r = await h.p.run({ type: 'task.update', id: 'b', fields: { progress: 1 } });
    expect(r.ok).toBe(true);
    expect(order).toEqual(['before', 'authorize', 'listen']);
    expect(h.doc.tasks[2]!.progress).toBe(1);
  });
  it('an interceptor can refuse with a reason, asynchronously', async () => {
    const refused = vi.fn();
    const h = make({ beforeOperation: async () => 'locked for review', refused });
    const r = await h.p.run({ type: 'task.delete', id: 'b' });
    expect(r).toMatchObject({ ok: false, stage: 'intercepted', reason: 'locked for review' });
    expect(refused).toHaveBeenCalledOnce();
    expect(h.doc).toBe(doc);
  });
  it('authorisation fails closed when the hook throws', async () => {
    const h = make({ authorize: async () => { throw new Error('network'); } });
    expect(await h.p.run({ type: 'task.delete', id: 'b' })).toMatchObject({ ok: false, stage: 'authorization' });
  });
  it('view operations skip authorisation', async () => {
    const authorize = vi.fn(() => false);
    const h = make({ authorize });
    expect((await h.p.run({ type: 'zoom.set', zoom: 'day' })).ok).toBe(true);
    expect(authorize).not.toHaveBeenCalled();
    expect(h.view).toHaveLength(1);
  });
});

describe('OperationPipeline timing', () => {
  it('applies synchronously when the hooks answer synchronously', () => {
    let applied = false;
    const p = new OperationPipeline(() => ({ beforeOperation: () => true }), () => ({ inverse: [] }), () => { applied = true; });
    void p.run({ type: 'zoom.set', zoom: 'day' });
    expect(applied).toBe(true);
  });
  it('waits for an asynchronous interceptor', async () => {
    let applied = false;
    const p = new OperationPipeline(() => ({ beforeOperation: async () => true }), () => ({ inverse: [] }), () => { applied = true; });
    const r = p.run({ type: 'zoom.set', zoom: 'day' });
    expect(applied).toBe(false);
    await r;
    expect(applied).toBe(true);
  });
});
