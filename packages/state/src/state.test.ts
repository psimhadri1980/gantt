import { describe, expect, it } from 'vitest';
import { buildModel, layoutRows, rowAt, totalHeight, ROW_HEIGHT } from './index.ts';
import { loadMock } from '../../mock/src/index.ts';
import small from '../../mock/src/samples/small.json';

const doc = (() => { const r = loadMock(small); if (!r.ok) throw new Error('bad'); return r.doc; })();

describe('layout', () => {
  const m = buildModel(doc);
  it('assigns WBS codes', () => {
    expect(m.wbs.get('t1')).toBe('1');
    expect(m.wbs.get('t7')).toBe('2.1.1');
  });
  it('lane row carries its children as stacked bars and is taller', () => {
    const rows = layoutRows(m, new Set());
    const lane = rows.find((r) => r.taskId === 't10')!;
    expect(lane.lane).toBe(true);
    expect(lane.bars.map((b) => b.taskId).sort()).toEqual(['t11', 't12', 't13', 't14']);
    expect(lane.tracks).toBe(2); // Search and Indexing overlap
    expect(lane.height).toBeGreaterThan(ROW_HEIGHT);
    expect(rows.some((r) => r.taskId === 't11')).toBe(false);
  });
  it('opening a lane gives its children rows; collapsing hides them', () => {
    expect(layoutRows(m, new Set(), new Set(['t10'])).some((r) => r.taskId === 't11')).toBe(true);
    expect(layoutRows(m, new Set(['t5'])).some((r) => r.taskId === 't7')).toBe(false);
  });
  it('finds rows by y with variable heights', () => {
    const rows = layoutRows(m, new Set());
    const lane = rows.findIndex((r) => r.lane);
    expect(rowAt(rows, rows[lane]!.top + 1)).toBe(lane);
    expect(rowAt(rows, totalHeight(rows) + 10)).toBe(rows.length);
  });
});
