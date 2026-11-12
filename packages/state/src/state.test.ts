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

import { isoWeek, localeWeekStart, ticks } from './index.ts';
import { toDay } from '@gantt/engine';
describe('ISO week numbers', () => {
  it.each([
    ['2026-11-09', 46], ['2026-01-01', 1], ['2025-12-29', 1], ['2027-01-01', 53], ['2026-12-28', 53],
    ['2027-01-04', 1], ['2021-01-03', 53], ['2024-12-30', 1], ['2020-12-31', 53],
  ])('%s is week %i', (iso, w) => expect(isoWeek(toDay(iso))).toBe(w));
  it('labels a week tick with its number and Monday start date', () => {
    const d = toDay('2026-11-09');
    const [t] = ticks({ origin: d, pxPerDay: 22 }, 'week', d, d + 6, 'en-GB');
    expect(t!.label).toBe('W46 · 9 Nov');
    const [n] = ticks({ origin: d, pxPerDay: 10 }, 'week', d, d + 6, 'en-GB');
    expect(n!.label).toBe('W46 09/11');
  });
  it('starts weeks on Sunday when asked, numbered like the following ISO week (G14)', () => {
    const d = toDay('2026-11-11');
    const [t] = ticks({ origin: d, pxPerDay: 22 }, 'week', d, d, 'en-US', undefined, 0);
    expect(t!.day).toBe(toDay('2026-11-08'));
    expect(t!.label).toMatch(/^W46 /);
    expect(localeWeekStart('en-US')).toBe(0);
    expect(localeWeekStart('de-DE')).toBe(1);
  });
});
