import { describe, expect, it } from 'vitest';
import { validate } from './index.ts';

const base = () => ({
  contract: 'gantt-roadmap/1',
  roadmap: { id: 'r', name: 'R', version: 1, timeZone: 'UTC', start: '2026-11-02' },
  tasks: [{ id: 't1', name: 'A', type: 'task', parent: null, start: '2026-11-02', duration: 3 },
          { id: 't2', name: 'B', type: 'task', parent: null, start: '2026-11-05', duration: 3 }],
  links: [{ id: 'l1', source: 't1', target: 't2', type: 'FS' }],
});

describe('validate', () => {
  it('accepts a valid document', () => expect(validate(base()).ok).toBe(true));
  it('refuses an unknown major version', () => {
    const r = validate({ ...base(), contract: 'gantt-roadmap/2' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]!.path).toBe('contract');
  });
  it('gives a path and reason for a bad date', () => {
    const d = base(); (d.tasks[1] as Record<string, unknown>).start = 'soon';
    const r = validate(d);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContainEqual({ path: 'tasks[1].start', message: 'not a date (expected YYYY-MM-DD)' });
  });
  it('detects link cycles and dangling references', () => {
    const d = base(); d.links.push({ id: 'l2', source: 't2', target: 't1', type: 'FS' }, { id: 'l3', source: 't1', target: 'nope', type: 'FS' });
    const r = validate(d);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.path === 'links' && /cycle/.test(e.message))).toBe(true);
      expect(r.errors).toContainEqual({ path: 'links[2].target', message: 'unknown task "nope"' });
    }
  });
  it('warns on unknown fields', () => {
    const d = base(); (d.tasks[0] as Record<string, unknown>).colour = 'red';
    const r = validate(d);
    expect(r.ok && r.warnings[0]?.path).toBe('tasks[0].colour');
  });
});
