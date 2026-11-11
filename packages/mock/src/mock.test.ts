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
