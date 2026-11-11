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

/**
 * Splits a roadmap for loading on demand (H2): tasks below `depth` are held back, their parents are marked
 * `hasChildren: true`, and `loadChildren` returns one level at a time after `delayMs`, like a server would.
 */
export function splitForLazyLoading(doc: RoadmapDocument, depth = 1, delayMs = 300) {
  const parentOf = new Map(doc.tasks.map((t) => [t.id, t.parent]));
  const level = (id: string) => { let d = 0; for (let p = parentOf.get(id); p; p = parentOf.get(p)) d++; return d; };
  const kept = new Set(doc.tasks.filter((t) => level(t.id) < depth).map((t) => t.id));
  const hasKids = new Set(doc.tasks.filter((t) => t.parent).map((t) => t.parent!));
  const initial: RoadmapDocument = {
    ...doc,
    tasks: doc.tasks.filter((t) => kept.has(t.id)).map((t) => (hasKids.has(t.id) && level(t.id) === depth - 1 ? { ...t, hasChildren: true } : t)),
    links: doc.links.filter((l) => kept.has(l.source) && kept.has(l.target)),
  };
  const sent = new Set(kept);
  const loadChildren = (parentId: string) => new Promise<{ tasks: RoadmapDocument['tasks']; links: RoadmapDocument['links'] }>((resolve) => {
    setTimeout(() => {
      const tasks = doc.tasks.filter((t) => t.parent === parentId).map((t) => (hasKids.has(t.id) ? { ...t, hasChildren: true } : t));
      tasks.forEach((t) => sent.add(t.id));
      // Send the links whose both ends are now loaded.
      const links = doc.links.filter((l) => sent.has(l.source) && sent.has(l.target) && (tasks.some((t) => t.id === l.source || t.id === l.target)));
      resolve({ tasks, links });
    }, delayMs);
  });
  return { initial, loadChildren };
}
