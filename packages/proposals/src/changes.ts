import { validate, type ProposalChange, type RoadmapDocument } from '@gantt/contract';

/** The document collection each change entity lives in. */
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
  if (field === 'parent' || field === 'order') return 'position';
  return field;
}

/** How one task differs between two versions: added, removed, or changed (with the changed fields). */
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

/**
 * The changes that turn one version of a roadmap into another, for tasks and links (K22: restoring an
 * earlier version opens a Proposal with these). Removed fields become null; parents are created before
 * their children; a deleted subtree is deleted once, at its top.
 */
export function changesBetween(from: RoadmapDocument, to: RoadmapDocument): Omit<ProposalChange, 'by' | 'at'>[] {
  const out: Omit<ProposalChange, 'by' | 'at'>[] = [];
  const diff = <T extends { id: string }>(entity: 'task' | 'link', a: T[], b: T[]) => {
    const am = new Map(a.map((x) => [x.id, x])), bm = new Map(b.map((x) => [x.id, x]));
    const creates: T[] = [], deletes: T[] = [];
    for (const [id, y] of bm) {
      const x = am.get(id);
      if (!x) { creates.push(y); continue; }
      const fields: Record<string, unknown> = {};
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
        if (k === 'id') continue;
        const xv = (x as Record<string, unknown>)[k], yv = (y as Record<string, unknown>)[k];
        if (JSON.stringify(xv) !== JSON.stringify(yv)) fields[k] = yv === undefined ? null : yv;
      }
      if (Object.keys(fields).length) out.push({ entity, op: 'update', id, fields });
    }
    for (const [id, x] of am) if (!bm.has(id)) deletes.push(x);
    return { creates, deletes };
  };
  const t = diff('task', from.tasks, to.tasks);
  // Deletes: only the top of each deleted subtree (its children go with it), before creates (ids may be reused).
  const gone = new Set(t.deletes.map((x) => x.id));
  const linkGone = (l: { source: string; target: string }) => {
    const deleted = (id: string) => { for (let c: string | null | undefined = id; c; c = from.tasks.find((x) => x.id === c)?.parent) if (gone.has(c)) return true; return false; };
    return deleted(l.source) || deleted(l.target);
  };
  const updates = out.splice(0);
  for (const x of t.deletes) if (!x.parent || !gone.has(x.parent)) out.push({ entity: 'task', op: 'delete', id: x.id });
  // Creates parent-first.
  const depth = (id: string): number => { let d = 0; for (let p = to.tasks.find((x) => x.id === id)?.parent; p; p = to.tasks.find((x) => x.id === p)?.parent) d++; return d; };
  for (const x of [...t.creates].sort((a, b) => depth(a.id) - depth(b.id))) { const { id, ...fields } = x; out.push({ entity: 'task', op: 'create', id, fields }); }
  out.push(...updates);
  const l = diff('link', from.links, to.links);
  for (const x of l.deletes) if (!linkGone(x)) out.push({ entity: 'link', op: 'delete', id: x.id });
  for (const x of l.creates) { const { id, ...fields } = x; out.push({ entity: 'link', op: 'create', id, fields }); }
  return out;
}
