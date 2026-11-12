import type { Link, Task } from '@gantt/contract';
import type { Model } from './layout.ts';
import type { DataOperation } from './operations.ts';

/**
 * Tree editing as data operations (D2, D3, D15, D16). Nothing here changes a document; each function returns
 * the operations to run, or the reason it cannot be done.
 */
export type TreeResult = { ops: DataOperation[] } | { error: string };

const ORDER_STEP = 1024;

/** True when `id` is `ancestor` or below it. */
export function isWithin(m: Model, id: string, ancestor: string): boolean {
  for (let cur: string | null | undefined = id; cur; cur = m.tasks.get(cur)?.parent) if (cur === ancestor) return true;
  return false;
}

/** Of the given ids, those whose ancestors are not also given (moving a parent moves its subtree). */
export function topmost(m: Model, ids: Iterable<string>): string[] {
  const set = new Set(ids);
  const out: string[] = [];
  for (const id of set) {
    let p = m.tasks.get(id)?.parent, covered = false;
    for (; p; p = m.tasks.get(p)?.parent) if (set.has(p)) { covered = true; break; }
    if (!covered && m.tasks.has(id)) out.push(id);
  }
  // In tree order, so a block keeps its order when it moves.
  return sortTreeOrder(m, out);
}

/** Sorts ids by their position in the expanded tree. */
export function sortTreeOrder(m: Model, ids: string[]): string[] {
  const rank = new Map<string, number>();
  let n = 0;
  const visit = (id: string | null) => { for (const k of m.children.get(id) ?? []) { rank.set(k, n++); visit(k); } };
  visit(null);
  return [...ids].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
}

/**
 * Places `ids` (in that order) under `parent` before the sibling at `index` of the current child list,
 * numbering the new sibling list with `order`. A task cannot move into itself or its own subtree.
 */
export function moveOps(m: Model, ids: string[], parent: string | null, index: number): TreeResult {
  const moving = topmost(m, ids);
  if (!moving.length) return { error: 'Nothing to move' };
  if (parent !== null) {
    if (!m.tasks.has(parent)) return { error: `unknown task "${parent}"` };
    for (const id of moving) if (isWithin(m, parent, id)) return { error: `“${m.tasks.get(id)!.name}” cannot be placed inside itself` };
    const pt = m.tasks.get(parent)!;
    if (pt.type === 'milestone') return { error: `A milestone (“${pt.name}”) cannot contain tasks` };
  }
  const before = m.children.get(parent) ?? [];
  const at = Math.max(0, Math.min(index, before.length));
  const set = new Set(moving);
  const head = before.slice(0, at).filter((id) => !set.has(id));
  const tail = before.slice(at).filter((id) => !set.has(id));
  return { ops: numberOps(m, [...head, ...moving, ...tail], parent) };
}

/** Operations that make `list` the children of `parent`, in that order, touching only what changes. */
function numberOps(m: Model, list: string[], parent: string | null): DataOperation[] {
  const ops: DataOperation[] = [];
  list.forEach((id, i) => {
    const t = m.tasks.get(id)!;
    const fields: Partial<Task> = {};
    const order = (i + 1) * ORDER_STEP;
    if (t.order !== order) fields.order = order;
    if (t.parent !== parent) fields.parent = parent;
    if (Object.keys(fields).length) ops.push({ type: 'task.update', id, fields });
  });
  return ops;
}

/** Indent (D16): each task becomes the last child of the sibling just above it. */
export function indentOps(m: Model, ids: string[]): TreeResult {
  const moving = topmost(m, ids);
  if (!moving.length) return { error: 'Nothing to indent' };
  const first = m.tasks.get(moving[0]!)!;
  const sibs = m.children.get(first.parent) ?? [];
  // All selected tasks must share a parent and the first must have a sibling above it.
  if (moving.some((id) => m.tasks.get(id)!.parent !== first.parent)) return { error: 'Indent tasks that share a parent' };
  const above = sibs[sibs.indexOf(moving[0]!) - 1];
  if (!above || moving.includes(above)) return { error: `“${first.name}” has no task above it to go under` };
  return moveOps(m, moving, above, (m.children.get(above) ?? []).length);
}

/** Outdent (D16): each task moves up one level, just after its parent. */
export function outdentOps(m: Model, ids: string[]): TreeResult {
  const moving = topmost(m, ids);
  if (!moving.length) return { error: 'Nothing to outdent' };
  const first = m.tasks.get(moving[0]!)!;
  if (moving.some((id) => m.tasks.get(id)!.parent !== first.parent)) return { error: 'Outdent tasks that share a parent' };
  if (first.parent === null) return { error: `“${first.name}” is already at the top level` };
  const parent = m.tasks.get(first.parent)!;
  const sibs = m.children.get(parent.parent) ?? [];
  return moveOps(m, moving, parent.parent, sibs.indexOf(parent.id) + 1);
}

/** What copy and cut put on the clipboard (D15): whole subtrees and the links between them. */
export interface TreeClipboard { tasks: Task[]; links: Link[]; roots: string[] }

/**
 * Copies tasks for pasting (D15): each selected subtree once (children of a selected parent come with it),
 * with the links that run between copied tasks.
 */
export function copyTasks(m: Model, ids: string[]): TreeClipboard {
  const roots = topmost(m, ids);
  const tasks: Task[] = [];
  const visit = (id: string) => { tasks.push(m.tasks.get(id)!); for (const k of m.children.get(id) ?? []) visit(k); };
  roots.forEach(visit);
  const inside = new Set(tasks.map((t) => t.id));
  const links = m.doc.links.filter((l) => inside.has(l.source) && inside.has(l.target));
  return { tasks, links, roots };
}

/**
 * Paste (D15): new ids for every task and internal link, roots placed under `parent` at `index`.
 * Dates and fields are kept; names are kept as they are.
 */
export function pasteOps(m: Model, clip: TreeClipboard, parent: string | null, index: number, newId: () => string): TreeResult & { ids?: string[] } {
  if (!clip.roots.length) return { error: 'The clipboard is empty' };
  if (parent !== null && m.tasks.get(parent)?.type === 'milestone') return { error: 'A milestone cannot contain tasks' };
  const map = new Map(clip.tasks.map((t) => [t.id, newId()]));
  const rootSet = new Set(clip.roots);
  const creates: DataOperation[] = clip.tasks.map((t) => {
    const { order: _o, ...rest } = t;
    void _o;
    const task: Task = { ...rest, id: map.get(t.id)!, parent: rootSet.has(t.id) ? parent : map.get(t.parent!)! };
    if (!rootSet.has(t.id) && t.order !== undefined) task.order = t.order;
    return { type: 'task.create', task };
  });
  const linkOps: DataOperation[] = clip.links.map((l) => ({ type: 'link.create', link: { ...l, id: newId(), source: map.get(l.source)!, target: map.get(l.target)! } }));
  // Number the target sibling list with the pasted roots in place.
  const sibs = (m.children.get(parent) ?? []);
  const at = Math.max(0, Math.min(index, sibs.length));
  const newRoots = clip.roots.map((r) => map.get(r)!);
  const list = [...sibs.slice(0, at), ...newRoots, ...sibs.slice(at)];
  const numbering: DataOperation[] = [];
  list.forEach((id, i) => {
    const order = (i + 1) * ORDER_STEP;
    const created = creates.find((c) => c.type === 'task.create' && c.task.id === id);
    if (created && created.type === 'task.create') { created.task.order = order; return; }
    if (m.tasks.get(id)?.order !== order) numbering.push({ type: 'task.update', id, fields: { order } });
  });
  return { ops: [...creates, ...linkOps, ...numbering], ids: newRoots };
}

/** Duplicate (D15): a copy of each subtree placed just after the original. */
export function duplicateOps(m: Model, ids: string[], newId: () => string): TreeResult & { ids?: string[] } {
  const roots = topmost(m, ids);
  if (!roots.length) return { error: 'Nothing to duplicate' };
  const last = roots[roots.length - 1]!;
  const parent = m.tasks.get(last)!.parent;
  if (roots.some((r) => m.tasks.get(r)!.parent !== parent)) return { error: 'Duplicate tasks that share a parent' };
  const sibs = m.children.get(parent) ?? [];
  return pasteOps(m, copyTasks(m, roots), parent, sibs.indexOf(last) + 1, newId);
}

/** A new task (D3, D4) under `parent` at `index`, starting on `start` when given. */
export function newTaskOps(m: Model, parent: string | null, index: number, task: Pick<Task, 'id' | 'name' | 'type'> & Partial<Task>): TreeResult {
  if (parent !== null && m.tasks.get(parent)?.type === 'milestone') return { error: 'A milestone cannot contain tasks' };
  const sibs = m.children.get(parent) ?? [];
  const at = Math.max(0, Math.min(index, sibs.length));
  const created = { ...task, parent, order: (at + 1) * ORDER_STEP } as Task;
  const ops: DataOperation[] = [{ type: 'task.create', task: created }];
  [...sibs.slice(0, at), task.id, ...sibs.slice(at)].forEach((id, i) => {
    if (id === task.id) return;
    const order = (i + 1) * ORDER_STEP;
    if (m.tasks.get(id)?.order !== order) ops.push({ type: 'task.update', id, fields: { order } });
  });
  return { ops };
}
