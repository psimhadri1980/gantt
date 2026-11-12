import { validate, type ProposalChange, type RoadmapDocument } from '@gantt/contract';

type Coll = 'tasks' | 'links' | 'resources' | 'calendars';
const COLL: Record<string, Coll> = { task: 'tasks', link: 'links', resource: 'resources', calendar: 'calendars' };

/**
 * Applies a Proposal's changes to a version of Current, all or nothing (K23): the result must pass the
 * same validation as any loaded roadmap, or nothing is applied. Deleting a task deletes its subtree and
 * every link touching it.
 */
export function applyChanges(base: RoadmapDocument, changes: ProposalChange[]): { ok: true; doc: RoadmapDocument } | { ok: false; reason: string } {
  const doc: RoadmapDocument = { ...base, tasks: [...base.tasks], links: [...base.links], resources: base.resources && [...base.resources], calendars: base.calendars && [...base.calendars] };
  for (const [i, c] of changes.entries()) {
    const where = `change ${i + 1} (${c.entity} ${c.op} ${c.id})`;
    if (c.entity === 'roadmap') {
      if (c.op !== 'update') return { ok: false, reason: `${where}: only update is possible` };
      doc.roadmap = { ...doc.roadmap, ...(c.fields as object), id: doc.roadmap.id };
      continue;
    }
    const k = COLL[c.entity];
    if (!k) return { ok: false, reason: `${where}: unknown entity` };
    const list = ((doc[k] as { id: string }[] | undefined) ?? []).slice();
    const at = list.findIndex((x) => x.id === c.id);
    if (c.op === 'create') {
      if (at >= 0) return { ok: false, reason: `${where}: already exists` };
      list.push({ ...(c.fields as object), id: c.id } as { id: string });
    } else if (at < 0) {
      return { ok: false, reason: `${where}: does not exist` };
    } else if (c.op === 'update') {
      const merged: Record<string, unknown> = { ...list[at], ...(c.fields as object), id: c.id };
      for (const key of Object.keys(merged)) if (merged[key] === undefined || merged[key] === null && key !== 'parent') delete merged[key];
      list[at] = merged as { id: string };
    } else {
      list.splice(at, 1);
      if (c.entity === 'task') {
        const gone = new Set([c.id]);
        for (let grew = true; grew;) { grew = false; for (const t of doc.tasks) if (t.parent && gone.has(t.parent) && !gone.has(t.id)) { gone.add(t.id); grew = true; } }
        (doc as { tasks: unknown }).tasks = (list as RoadmapDocument['tasks']).filter((t) => !gone.has(t.id));
        doc.links = doc.links.filter((l) => !gone.has(l.source) && !gone.has(l.target));
        continue;
      }
    }
    (doc as unknown as Record<Coll, unknown>)[k] = list;
  }
  const v = validate(doc);
  if (!v.ok) return { ok: false, reason: v.errors.slice(0, 3).map((e) => `${e.path}: ${e.message}`).join('; ') };
  return { ok: true, doc };
}

/** Field groups for comparison (K7): schedule, position, and each other field on its own. */
export function fieldGroup(field: string): string {
  if (['start', 'end', 'duration', 'durationUnit', 'constraint'].includes(field)) return 'schedule';
  if (field === 'parent') return 'position';
  return field;
}

export interface TaskDiff { id: string; kind: 'added' | 'removed' | 'changed'; fields: string[] }

/** What differs between two versions of a roadmap, per task (K4). */
export function diffTasks(a: RoadmapDocument, b: RoadmapDocument): TaskDiff[] {
  const am = new Map(a.tasks.map((t) => [t.id, t])), bm = new Map(b.tasks.map((t) => [t.id, t]));
  const out: TaskDiff[] = [];
  for (const [id, tb] of bm) {
    const ta = am.get(id);
    if (!ta) { out.push({ id, kind: 'added', fields: [] }); continue; }
    const keys = new Set([...Object.keys(ta), ...Object.keys(tb)]);
    const fields = [...keys].filter((k) => JSON.stringify((ta as Record<string, unknown>)[k]) !== JSON.stringify((tb as Record<string, unknown>)[k]));
    if (fields.length) out.push({ id, kind: 'changed', fields });
  }
  for (const id of am.keys()) if (!bm.has(id)) out.push({ id, kind: 'removed', fields: [] });
  return out;
}
