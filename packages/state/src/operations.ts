import type { Link, RoadmapDocument, Task } from '@gantt/contract';
import { validate } from '@gantt/contract';
import type { SelectionTarget } from './selection.ts';

/**
 * The operation API (H3): the single path for every change. Data operations change the roadmap; view
 * operations change only what is shown. Permissions (L5), Proposals and undo all hook into this pipeline.
 */
export type DataOperation =
  | { type: 'task.create'; task: Task }
  | { type: 'task.update'; id: string; fields: Partial<Omit<Task, 'id'>> }
  | { type: 'task.delete'; id: string }
  | { type: 'link.create'; link: Link }
  | { type: 'link.update'; id: string; fields: Partial<Omit<Link, 'id'>> }
  | { type: 'link.delete'; id: string };

export type ViewOperation =
  | { type: 'row.expand'; id: string }
  | { type: 'row.collapse'; id: string }
  | { type: 'lane.open'; id: string }
  | { type: 'lane.close'; id: string }
  | { type: 'selection.set'; selection: SelectionTarget[] }
  | { type: 'zoom.set'; zoom: string };

export type GanttOperation = DataOperation | ViewOperation;

export const isDataOperation = (op: GanttOperation): op is DataOperation => /^(task|link)\./.test(op.type);

export interface OperationContext { by?: string; source: 'user' | 'api' | 'undo' }

export type OperationResult =
  | { ok: true; operation: GanttOperation; inverse?: DataOperation[] }
  | { ok: false; operation: GanttOperation; reason: string; stage: 'intercepted' | 'authorization' | 'invalid' };

export interface OperationHooks {
  /** Interception: return false or a reason string to refuse. May return a promise (H3). */
  beforeOperation?: (op: GanttOperation, ctx: OperationContext) => boolean | string | void | Promise<boolean | string | void>;
  /** Authorisation hook, called before every data operation (L5). */
  authorize?: (op: DataOperation, ctx: OperationContext) => boolean | Promise<boolean>;
  /** Listening: called after an operation has been applied. */
  operation?: (result: Extract<OperationResult, { ok: true }>, ctx: OperationContext) => void;
  /** Called when an operation is refused at any stage. */
  refused?: (result: Extract<OperationResult, { ok: false }>, ctx: OperationContext) => void;
}

/**
 * Applies a data operation to a document. Returns the new document and the operations that undo it.
 * The input is never mutated. The result is validated against the contract, so an operation cannot
 * produce a document that would be refused on load (cycles, dangling ids, bad dates).
 */
export function applyDataOperation(doc: RoadmapDocument, op: DataOperation): { doc: RoadmapDocument; inverse: DataOperation[] } | { error: string } {
  let tasks = doc.tasks, links = doc.links;
  let inverse: DataOperation[];
  const pick = <T extends object>(o: T, keys: string[]) => Object.fromEntries(keys.map((k) => [k, (o as Record<string, unknown>)[k]])) as Partial<T>;
  switch (op.type) {
    case 'task.create':
      if (tasks.some((t) => t.id === op.task.id)) return { error: `task "${op.task.id}" already exists` };
      tasks = [...tasks, op.task]; inverse = [{ type: 'task.delete', id: op.task.id }]; break;
    case 'task.update': {
      const i = tasks.findIndex((t) => t.id === op.id);
      if (i < 0) return { error: `unknown task "${op.id}"` };
      if ('id' in op.fields) return { error: 'a task id cannot be changed' };
      const old = tasks[i]!;
      tasks = tasks.slice(); tasks[i] = stripUndefined({ ...old, ...op.fields });
      inverse = [{ type: 'task.update', id: op.id, fields: pick(old, Object.keys(op.fields)) }]; break;
    }
    case 'task.delete': {
      const t = tasks.find((x) => x.id === op.id);
      if (!t) return { error: `unknown task "${op.id}"` };
      // Deleting a task deletes its subtree and every link that touches it.
      const gone = new Set([op.id]);
      for (let grew = true; grew;) { grew = false; for (const x of tasks) if (x.parent && gone.has(x.parent) && !gone.has(x.id)) { gone.add(x.id); grew = true; } }
      const removedTasks = tasks.filter((x) => gone.has(x.id));
      const removedLinks = links.filter((l) => gone.has(l.source) || gone.has(l.target));
      tasks = tasks.filter((x) => !gone.has(x.id));
      links = links.filter((l) => !gone.has(l.source) && !gone.has(l.target));
      inverse = [...removedTasks.map((task): DataOperation => ({ type: 'task.create', task })), ...removedLinks.map((link): DataOperation => ({ type: 'link.create', link }))];
      break;
    }
    case 'link.create':
      if (links.some((l) => l.id === op.link.id)) return { error: `link "${op.link.id}" already exists` };
      links = [...links, op.link]; inverse = [{ type: 'link.delete', id: op.link.id }]; break;
    case 'link.update': {
      const i = links.findIndex((l) => l.id === op.id);
      if (i < 0) return { error: `unknown link "${op.id}"` };
      if ('id' in op.fields) return { error: 'a link id cannot be changed' };
      const old = links[i]!;
      links = links.slice(); links[i] = stripUndefined({ ...old, ...op.fields });
      inverse = [{ type: 'link.update', id: op.id, fields: pick(old, Object.keys(op.fields)) }]; break;
    }
    case 'link.delete': {
      const l = links.find((x) => x.id === op.id);
      if (!l) return { error: `unknown link "${op.id}"` };
      links = links.filter((x) => x.id !== op.id); inverse = [{ type: 'link.create', link: l }]; break;
    }
  }
  const next = { ...doc, tasks, links };
  const v = validate(next);
  if (!v.ok) return { error: v.errors.map((e) => `${e.path}: ${e.message}`).join('; ') };
  return { doc: next, inverse };
}

const stripUndefined = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/**
 * Runs operations through interception, authorisation, application and notification, in that order.
 * Holds no React; the Gantt component and the server both drive one.
 */
export class OperationPipeline {
  constructor(
    private readonly getHooks: () => OperationHooks,
    private readonly applyData: (op: DataOperation) => { inverse: DataOperation[] } | { error: string },
    private readonly applyView: (op: ViewOperation) => void,
  ) {}

  /**
   * Runs one operation. When every hook answers synchronously, the operation is applied synchronously
   * (inside the user's event, so the chart responds in the same frame); the pipeline only waits when a
   * hook actually returns a promise.
   */
  run(op: GanttOperation, ctx: OperationContext = { source: 'api' }): Promise<OperationResult> {
    const hooks = this.getHooks();
    const refuse = (reason: string, stage: 'intercepted' | 'authorization' | 'invalid'): OperationResult => {
      const r = { ok: false as const, operation: op, reason, stage };
      hooks.refused?.(r, ctx);
      return r;
    };
    const apply = (): OperationResult => {
      if (isDataOperation(op)) {
        const r = this.applyData(op);
        if ('error' in r) return refuse(r.error, 'invalid');
        const ok = { ok: true as const, operation: op, inverse: r.inverse };
        hooks.operation?.(ok, ctx);
        return ok;
      }
      try { this.applyView(op); } catch (e) { return refuse((e as Error).message, 'invalid'); }
      const ok = { ok: true as const, operation: op };
      hooks.operation?.(ok, ctx);
      return ok;
    };
    const afterAuthorize = (allowed: boolean) => (allowed ? apply() : refuse('not permitted', 'authorization'));
    const authorize = (): OperationResult | Promise<OperationResult> => {
      if (!isDataOperation(op) || !hooks.authorize) return apply();
      let a: boolean | Promise<boolean>;
      try { a = hooks.authorize(op, ctx); } catch { return afterAuthorize(false); } // fail closed
      return isThenable(a) ? a.then(afterAuthorize, () => afterAuthorize(false)) : afterAuthorize(a);
    };
    const afterIntercept = (b: boolean | string | void) => {
      if (b === false) return refuse('refused by the host', 'intercepted');
      if (typeof b === 'string') return refuse(b, 'intercepted');
      return authorize();
    };
    let b: ReturnType<NonNullable<OperationHooks['beforeOperation']>>;
    try { b = hooks.beforeOperation?.(op, ctx); } catch (e) { return Promise.resolve(refuse(`interception failed: ${(e as Error).message}`, 'intercepted')); }
    return Promise.resolve(isThenable(b) ? b.then(afterIntercept, (e: Error) => refuse(`interception failed: ${e?.message}`, 'intercepted')) : afterIntercept(b));
  }
}

const isThenable = <T,>(v: unknown): v is Promise<T> => !!v && typeof (v as { then?: unknown }).then === 'function';

/**
 * Merges children loaded on demand (H2) under `parentId`. This is data arriving, not an edit: it does not
 * go through interception or authorisation and is not undoable. The result is validated like any load.
 */
export function mergeChildren(doc: RoadmapDocument, parentId: string, loaded: { tasks: Task[]; links?: Link[] }): { doc: RoadmapDocument } | { error: string } {
  const parent = doc.tasks.find((t) => t.id === parentId);
  if (!parent) return { error: `unknown task "${parentId}"` };
  const ids = new Set(loaded.tasks.map((t) => t.id));
  const outside = loaded.tasks.find((t) => t.parent !== parentId && !ids.has(t.parent ?? ''));
  if (outside) return { error: `loaded task "${outside.id}" is not inside "${parentId}"` };
  const tasks = [...doc.tasks.filter((t) => !ids.has(t.id)).map((t) => {
    if (t.id !== parentId) return t;
    const { hasChildren: _done, ...rest } = t;
    return rest as Task;
  }), ...loaded.tasks];
  const linkIds = new Set((loaded.links ?? []).map((l) => l.id));
  const links = [...doc.links.filter((l) => !linkIds.has(l.id)), ...(loaded.links ?? [])];
  const next = { ...doc, tasks, links };
  const v = validate(next);
  if (!v.ok) return { error: v.errors.slice(0, 3).map((e) => `${e.path}: ${e.message}`).join('; ') };
  return { doc: next };
}
