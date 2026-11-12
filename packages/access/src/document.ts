import type { AccessEvaluator } from './evaluate.ts';
import type { AccessContext, Permission } from './types.ts';

// Structural types, so the access package depends on nothing (plan section 0a).
interface TaskLike { id: string; type?: string; owner?: string; kind?: string; parent: string | null; [k: string]: unknown }
interface LinkLike { id: string; source: string; target: string }
interface DocLike { roadmap: { id: string }; tasks: TaskLike[]; links: LinkLike[] }

export const taskContext = (t: TaskLike, project?: string): AccessContext => ({
  project, task: { id: t.id, type: t.type, owner: t.owner, kind: t.kind, parent: t.parent },
});

/**
 * What a user may see (L12): tasks without `view` are removed with their whole subtree, links touching a
 * removed task are removed, and fields outside the user's `view.fields` are stripped. The server applies
 * this before sending anything; the component applies it again so its view never differs.
 */
export function filterDocument<D extends DocLike>(doc: D, ev: AccessEvaluator): D {
  if (!ev.canView) return { ...doc, tasks: [], links: [] };
  const project = doc.roadmap.id;
  const viewPerTask = ev.dependsOnTask('view');
  const fieldsPerTask = ev.dependsOnTask('view.fields');
  // Fast path (L13): no rule looks at individual tasks, so everything the roadmap shows is visible and the
  // visible fields are the same for every task.
  const allowed = new Map<string, boolean>();
  const fieldOk = (k: string) => { let v = allowed.get(k); if (v === undefined) { v = ev.canViewField(undefined, k); allowed.set(k, v); } return v; };
  if (!viewPerTask) {
    const tasks = fieldsPerTask ? null : doc.tasks.map((t) => {
      let out: TaskLike | null = null;
      for (const k in t) if (!fieldOk(k)) { out ??= { ...t }; delete out[k]; }
      return (out ?? t) as typeof t;
    });
    if (tasks) return { ...doc, tasks };
  }
  const byId = new Map(doc.tasks.map((t) => [t.id, t]));
  const hidden = new Set<string>();
  const isHidden = (t: TaskLike): boolean => {
    if (hidden.has(t.id)) return true;
    const parent = t.parent ? byId.get(t.parent) : undefined;
    const h = (viewPerTask && !ev.can('view', taskContext(t, project))) || (!!parent && isHidden(parent));
    if (h) hidden.add(t.id);
    return h;
  };
  const tasks = doc.tasks.filter((t) => !isHidden(t)).map((t) => {
    const ctx = fieldsPerTask ? taskContext(t, project).task : undefined;
    let out: TaskLike | null = null;
    for (const k in t) if (!(fieldsPerTask ? ev.canViewField(ctx, k) : fieldOk(k))) { out ??= { ...t }; delete out[k]; }
    return (out ?? t) as typeof t;
  });
  const links = doc.links.filter((l) => !hidden.has(l.source) && !hidden.has(l.target) && byId.has(l.source) && byId.has(l.target));
  return { ...doc, tasks, links };
}

/** A change to a roadmap, in the shape of contract ProposalChange. */
export interface ChangeLike { entity: string; op: 'create' | 'update' | 'delete'; id: string; fields?: Record<string, unknown> }

const DATE_FIELDS = new Set(['start', 'end', 'duration', 'durationUnit', 'deadline']);

/** The permissions a change needs, each with the field it applies to (L2). */
export function permissionsForChange(c: ChangeLike): { permission: Permission; field?: string }[] {
  switch (c.entity) {
    case 'task':
      if (c.op === 'create') return [{ permission: 'task.create' }];
      if (c.op === 'delete') return [{ permission: 'task.delete' }];
      return Object.keys(c.fields ?? {}).map((f) => ({
        field: f,
        permission: DATE_FIELDS.has(f) ? 'task.modify.dates' : f === 'progress' ? 'task.modify.progress' : f === 'constraint' ? 'constraint.edit'
          : f === 'parent' ? 'task.reorder' : f === 'resources' ? 'resource.assign' : 'task.modify.fields',
      }));
    case 'link': return [{ permission: c.op === 'create' ? 'link.create' : c.op === 'delete' ? 'link.delete' : 'link.modify' }];
    case 'calendar': return [{ permission: 'calendar.edit' }];
    case 'resource': return [{ permission: 'resource.edit' }];
    default: return [{ permission: 'proposal.edit' }];
  }
}

/** Whether `ev` allows a change to `task` (the task as it is before the change; undefined for a create). */
export function checkChange(ev: AccessEvaluator, c: ChangeLike, task: TaskLike | undefined, project?: string) {
  const base = task ? taskContext(task, project) : { project };
  for (const { permission, field } of permissionsForChange(c)) {
    const d = ev.check(permission, { ...base, field });
    if (!d.allowed) return d;
  }
  return { allowed: true as const };
}
