import { describe, expect, it } from 'vitest';
import { generate, loadMock } from './index.ts';
import small from './samples/small.json';

describe('mock', () => {
  it('loads the small sample', () => {
    const r = loadMock(small);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.tasks.length).toBe(20);
  });
  it('refuses invalid JSON with a reason', () => {
    const r = loadMock('{ nope');
    expect(r.ok).toBe(false);
  });
  it('generates a valid 10,000-task file with about 5,000 links', () => {
    const doc = generate({ tasks: 10000, linkDensity: 0.55, laneEvery: 3 });
    const r = loadMock(doc);
    if (!r.ok) throw new Error(JSON.stringify(r.errors.slice(0, 3)));
    expect(doc.tasks.length).toBe(10000);
    expect(doc.links.length).toBeGreaterThan(4500);
  });
});

import { splitForLazyLoading } from './index.ts';
import { mergeChildren } from '../../state/src/index.ts';
describe('splitForLazyLoading', () => {
  it('holds back deeper levels and serves them one level at a time, ending with the full roadmap', async () => {
    const full = generate({ tasks: 200, depth: 3, linkDensity: 0.4 });
    const { initial, loadChildren } = splitForLazyLoading(full, 1, 0);
    expect(loadMock(initial).ok).toBe(true);
    expect(initial.tasks.every((t) => t.parent === null)).toBe(true);
    let doc = initial;
    for (let pending = doc.tasks.filter((t) => t.hasChildren); pending.length; pending = doc.tasks.filter((t) => t.hasChildren)) {
      for (const t of pending) {
        const r = mergeChildren(doc, t.id, await loadChildren(t.id));
        if ('error' in r) throw new Error(r.error);
        doc = r.doc;
      }
    }
    expect(doc.tasks.length).toBe(full.tasks.length);
    expect(doc.links.length).toBe(full.links.length);
  });
});
