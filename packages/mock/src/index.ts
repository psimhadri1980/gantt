import { validate, type Issue, type RoadmapDocument } from '@gantt/contract';
import { place } from '@gantt/engine';
export { generate, type GenerateOptions } from './generate.ts';

export type LoadResult = { ok: true; doc: RoadmapDocument; warnings: Issue[] } | { ok: false; errors: Issue[]; warnings: Issue[] };

/**
 * Mock loader (M1, M4, M5). A separate import: a bundle that never imports @gantt/mock cannot enter mock mode.
 * Accepts a JSON string or an object; runs the same validation real data goes through, plus the end-date check.
 */
export function loadMock(input: string | unknown): LoadResult {
  let data: unknown = input;
  if (typeof input === 'string') {
    try { data = JSON.parse(input); } catch (e) { return { ok: false, errors: [{ path: '$', message: `invalid JSON: ${(e as Error).message}` }], warnings: [] }; }
  }
  const r = validate(data);
  if (!r.ok) return r;
  const p = place(r.doc);
  if (p.errors.length) return { ok: false, errors: p.errors, warnings: [...r.warnings, ...p.warnings] };
  return { ok: true, doc: r.doc, warnings: [...r.warnings, ...p.warnings] };
}

/** Export the current state back to JSON in the same contract (M8). */
export function exportMock(doc: RoadmapDocument): string {
  return JSON.stringify(doc, null, 2);
}
