import type { ProposalChange, RoadmapDocument, Task } from '@gantt/contract';
import { applyChanges, fieldGroup } from './changes.ts';

/**
 * Working together on Proposals (K7–K9, K12–K20), without I/O: which tasks two people changed in the same
 * field group, which tasks parallel Proposals share, and how a Proposal is brought up to a newer Current.
 */

/** A choice between the versions of one task inside a Proposal (K9). Settles the changes made before it. */
export interface Pick {
  taskId: string;
  /** The user whose version is kept. */
  keep: string;
  /** The field groups that were in conflict. */
  groups: string[];
  by: string;
  at: string;
  /** Number of changes in the Proposal when the pick was made: it settles changes before this index. */
  seq: number;
}

/** Anything that carries Proposal changes and, optionally, the versions already picked for conflicts. */
interface WithChanges { changes: ProposalChange[]; picks?: Pick[] }

/** A delete conflicts with every other change of the task. */
export const DELETE = 'delete';

/** The field groups a change touches. A create touches nothing (only its creator knows the task). */
export function groupsOf(c: ProposalChange): string[] {
  if (c.entity !== 'task' || c.op === 'create') return [];
  if (c.op === 'delete') return [DELETE];
  return [...new Set(Object.keys(c.fields ?? {}).map(fieldGroup))];
}

/** One task changed by two people at once (K11): which field groups clash, and both versions of each. */
export interface ConcurrentChange {
  taskId: string;
  /** Field groups changed by more than one user (or "delete" against any change). */
  groups: string[];
  users: string[];
  changes: { by: string; at: string; op: ProposalChange['op']; fields?: Record<string, unknown> }[];
}

/**
 * Tasks two or more users changed in the same field group inside one Proposal, not yet settled by a pick
 * (K7). Changes to different field groups of one task are simply combined.
 */
export function concurrentChanges(p: WithChanges): ConcurrentChange[] {
  const settledBefore = new Map<string, number>();
  for (const k of p.picks ?? []) settledBefore.set(k.taskId, Math.max(settledBefore.get(k.taskId) ?? 0, k.seq));
  const byTask = new Map<string, { i: number; c: ProposalChange }[]>();
  p.changes.forEach((c, i) => {
    if (c.entity !== 'task' || c.op === 'create' || i < (settledBefore.get(c.id) ?? 0)) return;
    (byTask.get(c.id) ?? byTask.set(c.id, []).get(c.id)!).push({ i, c });
  });
  const out: ConcurrentChange[] = [];
  for (const [taskId, list] of byTask) {
    const usersByGroup = new Map<string, Set<string>>();
    for (const { c } of list) for (const g of groupsOf(c)) (usersByGroup.get(g) ?? usersByGroup.set(g, new Set()).get(g)!).add(c.by);
    const groups = new Set<string>();
    for (const [g, users] of usersByGroup) if (g !== DELETE && users.size > 1) groups.add(g);
    // A delete by one user against any change by another (two users deleting it agree).
    const deleters = usersByGroup.get(DELETE);
    if (deleters) for (const [g, users] of usersByGroup) if (g !== DELETE && [...users].some((u) => !deleters.has(u) || deleters.size > 1)) { groups.add(DELETE); groups.add(g); }
    if (!groups.size) continue;
    const involved = list.filter(({ c }) => groupsOf(c).some((g) => groups.has(g)));
    out.push({
      taskId, groups: [...groups].sort(), users: [...new Set(involved.map(({ c }) => c.by))],
      changes: involved.map(({ c }) => ({ by: c.by, at: c.at, op: c.op, fields: c.fields })),
    });
  }
  return out;
}

/**
 * The changes as they take effect: for each pick, the other users' changes to the conflicting groups of that
 * task (made before the pick) are left out (K9: one version per task, no field-by-field merge).
 */
export function effectiveChanges(p: WithChanges): ProposalChange[] {
  const picks = p.picks ?? [];
  if (!picks.length) return p.changes;
  const out: ProposalChange[] = [];
  p.changes.forEach((c, i) => {
    if (c.entity !== 'task' || c.op === 'create') { out.push(c); return; }
    const against = picks.filter((k) => k.taskId === c.id && i < k.seq && k.keep !== c.by);
    if (!against.length) { out.push(c); return; }
    const drop = new Set(against.flatMap((k) => k.groups));
    if (c.op === 'delete') { if (!drop.has(DELETE)) out.push(c); return; }
    const fields = Object.fromEntries(Object.entries(c.fields ?? {}).filter(([f]) => !drop.has(fieldGroup(f)) && !drop.has(DELETE)));
    if (Object.keys(fields).length) out.push({ ...c, fields });
  });
  return out;
}

/** One user's version of a task in a Proposal (its base plus that user's settled view), for side-by-side display. */
export function versionOf(base: RoadmapDocument, p: WithChanges, taskId: string, user: string): Task | null {
  const c = concurrentChanges(p).find((x) => x.taskId === taskId);
  const pick: Pick = { taskId, keep: user, groups: c?.groups ?? [], by: user, at: '', seq: p.changes.length };
  const r = applyChanges(base, effectiveChanges({ changes: p.changes, picks: [...(p.picks ?? []), pick] }));
  return r.ok ? r.doc.tasks.find((t) => t.id === taskId) ?? null : null;
}

/** The field groups each task is changed in by a Proposal (after picks). */
export function touched(p: WithChanges): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const c of effectiveChanges(p)) for (const g of groupsOf(c)) (m.get(c.id) ?? m.set(c.id, new Set()).get(c.id)!).add(g);
  return m;
}

/** A task that this Proposal and another open Proposal both change in the same field group. */
export interface ParallelOverlap { taskId: string; groups: string[]; proposalId: string }

/** Tasks this Proposal changes in the same field group as other open Proposals (K7: a warning, K9). */
export function parallelOverlaps(p: WithChanges & { id: string }, others: (WithChanges & { id: string })[]): ParallelOverlap[] {
  const mine = touched(p);
  const out: ParallelOverlap[] = [];
  for (const o of others) {
    if (o.id === p.id) continue;
    for (const [taskId, gs] of touched(o)) {
      const my = mine.get(taskId); if (!my) continue;
      const groups = [...gs].filter((g) => my.has(g) || g === DELETE || my.has(DELETE));
      if (groups.length) out.push({ taskId, groups: [...new Set([...groups, ...(my.has(DELETE) ? [DELETE] : [])])].sort(), proposalId: o.id });
    }
  }
  return out;
}

// ---------- Refresh (K16–K20) ----------

export interface IncomingChange { taskId: string; name: string; kind: 'added' | 'removed' | 'changed'; groups: string[] }
/**
 * A task that a refresh brings in a change for while this Proposal changes it too, with both versions per group.
 */
export interface RefreshOverlap {
  taskId: string;
  name: string;
  /** Field groups changed on both sides ("delete" when one side deleted the task). */
  groups: string[];
  /** The task in the newer Current, and in the Proposal (null when deleted on that side). */
  current: Task | null;
  mine: Task | null;
}
/** Per task: one answer for every overlapping group, or one per group when expanded (K17). */
export type RefreshChoice = 'incoming' | 'mine' | Record<string, 'incoming' | 'mine'>;

/** What changed in Current between two versions, per task and field group. */
export function incomingChanges(from: RoadmapDocument, to: RoadmapDocument): IncomingChange[] {
  const a = new Map(from.tasks.map((t) => [t.id, t])), b = new Map(to.tasks.map((t) => [t.id, t]));
  const out: IncomingChange[] = [];
  for (const [id, tb] of b) {
    const ta = a.get(id);
    if (!ta) { out.push({ taskId: id, name: tb.name, kind: 'added', groups: [] }); continue; }
    const keys = new Set([...Object.keys(ta), ...Object.keys(tb)]);
    const groups = [...new Set([...keys].filter((k) => JSON.stringify((ta as Record<string, unknown>)[k]) !== JSON.stringify((tb as Record<string, unknown>)[k])).map(fieldGroup))];
    if (groups.length) out.push({ taskId: id, name: tb.name, kind: 'changed', groups: groups.sort() });
  }
  for (const [id, ta] of a) if (!b.has(id)) out.push({ taskId: id, name: ta.name, kind: 'removed', groups: [DELETE] });
  return out;
}

/** Where the Proposal and the newer Current changed the same field group of a task (K17). */
export function refreshOverlaps(base: RoadmapDocument, current: RoadmapDocument, p: WithChanges): RefreshOverlap[] {
  const mine = touched(p);
  const built = applyChanges(base, effectiveChanges(p));
  const mineDoc = built.ok ? built.doc : base;
  const cur = new Map(current.tasks.map((t) => [t.id, t])), my = new Map(mineDoc.tasks.map((t) => [t.id, t]));
  const out: RefreshOverlap[] = [];
  for (const inc of incomingChanges(base, current)) {
    const gs = mine.get(inc.taskId); if (!gs) continue;
    const groups = inc.kind === 'removed' || gs.has(DELETE) ? [...new Set([DELETE, ...inc.groups.filter((g) => g !== DELETE), ...[...gs].filter((g) => g !== DELETE)])]
      : inc.groups.filter((g) => gs.has(g));
    if (!groups.length) continue;
    out.push({ taskId: inc.taskId, name: inc.name, groups: groups.sort(), current: cur.get(inc.taskId) ?? null, mine: my.get(inc.taskId) ?? null });
  }
  return out;
}

/**
 * The side chosen for a field group of a task: per group, or for the whole task, or (for a delete) the delete choice.
 */
const choiceFor = (ch: RefreshChoice | undefined, group: string): 'incoming' | 'mine' | undefined =>
  ch === undefined ? undefined : typeof ch === 'string' ? ch : ch[group] ?? ch[DELETE];

/** Overlaps that still need an answer (K17a: none may be left undecided). */
export function undecided(overlaps: RefreshOverlap[], choices: Record<string, RefreshChoice>): string[] {
  return overlaps.filter((o) => o.groups.some((g) => !choiceFor(choices[o.taskId], g))).map((o) => o.taskId);
}

/**
 * The Proposal's changes rewritten onto the newer Current (K17): changes without overlap stay; on an overlap
 * "incoming" drops the Proposal's change to that group and "mine" keeps it. Keeping a change to a task that
 * Current deleted re-creates the task as the Proposal has it. All or nothing: the result must be valid.
 */
export function rebase(base: RoadmapDocument, current: RoadmapDocument, p: WithChanges, choices: Record<string, RefreshChoice>):
  { ok: true; changes: ProposalChange[]; doc: RoadmapDocument; decided: number } | { ok: false; reason: string } {
  const ov = refreshOverlaps(base, current, p);
  const open = undecided(ov, choices);
  if (open.length) return { ok: false, reason: `${open.length} overlapping ${open.length === 1 ? 'task needs' : 'tasks need'} a choice` };
  const byTask = new Map(ov.map((o) => [o.taskId, o]));
  const curIds = new Set(current.tasks.map((t) => t.id));
  const recreated = new Set<string>();
  const out: ProposalChange[] = [];
  for (const c of effectiveChanges(p)) {
    const o = c.entity === 'task' ? byTask.get(c.id) : undefined;
    if (!o) { out.push(c); continue; }
    const ch = choices[o.taskId];
    if (!curIds.has(c.id)) {
      // Current deleted the task. Keep mine: re-create it once, as the Proposal has it.
      if (choiceFor(ch, DELETE) !== 'mine' || !o.mine || recreated.has(c.id)) continue;
      const { id, ...fields } = o.mine;
      out.push({ ...c, op: 'create', fields }); recreated.add(id);
      continue;
    }
    if (c.op === 'delete') { if (choiceFor(ch, DELETE) === 'mine') out.push(c); continue; }
    const fields = Object.fromEntries(Object.entries(c.fields ?? {}).filter(([f]) => {
      const g = fieldGroup(f);
      return !o.groups.includes(g) || choiceFor(ch, g) === 'mine';
    }));
    if (Object.keys(fields).length) out.push({ ...c, fields });
  }
  const r = applyChanges(current, out);
  if (!r.ok) return { ok: false, reason: `The changes do not apply to the newer Current: ${r.reason}` };
  return { ok: true, changes: out, doc: r.doc, decided: ov.length };
}
