import type { Link, RoadmapDocument, Task } from '@gantt/contract';
import { buildCalendars, fromDay, spanOf, toDay, workDays, WorkCalendar, type DayNum } from './calendar.ts';

/**
 * The scheduling engine (C1, C2, C9, C10, C11): forward and backward pass over the four dependency types
 * with lag, in working time, giving each task its earliest dates, slack and whether it is critical.
 * It has no interface dependency and runs in the browser (off the main thread) and on the server.
 *
 * Rules:
 * - A task with incoming dependencies starts as soon as they, its constraint and the roadmap start allow
 *   ("as soon as possible", C10), following its predecessors both later and earlier.
 * - A task with no incoming dependencies keeps its own start (its planned start), never before the
 *   roadmap start. Pulling every unlinked task to the roadmap start would discard the plan.
 * - Manual tasks keep their dates; a dependency they break is reported. Inactive tasks are ignored.
 * - A dependency into a summary applies to each of its leaf tasks; a dependency from a summary uses the
 *   summary's span, derived from its children.
 * - Constraints SNET, FNET, MSO and MFO set an earliest date; SNLT, FNLT and deadlines are reported when broken.
 */

export interface TaskSchedule {
  start: DayNum;
  end: DayNum;
  /** Latest start and finish that do not delay the end of the roadmap. */
  lateStart: DayNum;
  lateFinish: DayNum;
  /** Total slack in working days (negative when a manual task or constraint forces lateness). */
  slack: number;
  critical: boolean;
  /** The link that sets this task's start, if any (shown in a connector's details). */
  drivenBy?: string;
}

/**
 * A problem the scheduler found. `kind` says which: a dependency cycle, a link the stored dates break, a constraint
 * that cannot be met, or a deadline the task finishes after. `taskId`/`linkId` point at what to fix.
 */
export interface ScheduleIssue {
  kind: 'cycle' | 'brokenDependency' | 'constraint' | 'deadline';
  taskId?: string;
  linkId?: string;
  message: string;
  /** Working days by which it is broken. */
  by?: number;
  /** The date that would satisfy it (a start for dependencies; the actual date for constraints and deadlines). */
  suggest?: string;
  /** Links in a cycle. */
  linkIds?: string[];
}

/**
 * What `schedule` returns: the computed dates per task, the edits that would apply them, the problems found,
 * and the latest finish (undefined for an empty roadmap).
 */
export interface ScheduleResult {
  tasks: Map<string, TaskSchedule>;
  /** Changes that bring the stored dates in line with the schedule (K1): start, and end dropped. */
  changes: { id: string; start: string }[];
  issues: ScheduleIssue[];
  /** Ids in a dependency cycle, when there is one; nothing is scheduled then. */
  cycle?: string[];
  end?: DayNum;
}

/** The four dependency types: finish-to-start, start-to-start, finish-to-finish, start-to-finish. */
type Kind = Link['type'];
/**
 * One dependency in the form the scheduler walks: `to` may not start (or finish) before `from` allows, plus `lag` working days.
 */
interface Edge { from: string; to: string; type: Kind; lag: number; linkId: string }

/**
 * Computes the schedule of a whole roadmap (C1–C8): every task's earliest start and finish from its own date,
 * its constraint, its predecessors (with lag, on each task's calendar) and its parent's dates. Summaries span their
 * children. Tasks in a cycle are reported and left at their stored dates. Pure: the document is not changed.
 */
export function schedule(doc: RoadmapDocument): ScheduleResult {
  const cals = buildCalendars(doc.calendars);
  const cal = (doc.roadmap.defaultCalendar && cals.get(doc.roadmap.defaultCalendar)) || new WorkCalendar();
  const hoursPerDay = doc.calendars?.find((c) => c.id === doc.roadmap.defaultCalendar)?.hoursPerDay ?? 8;
  const roadmapStart = cal.nextWorking(toDay(doc.roadmap.start));
  const byId = new Map<string, Task>();
  const children = new Map<string, string[]>();
  for (const t of doc.tasks) {
    if (t.mode === 'inactive') continue;
    byId.set(t.id, t);
  }
  for (const t of byId.values()) if (t.parent && byId.has(t.parent)) (children.get(t.parent) ?? children.set(t.parent, []).get(t.parent)!).push(t.id);
  const isSummary = (id: string) => (children.get(id)?.length ?? 0) > 0 || byId.get(id)?.type === 'summary';
  const leavesOf = (id: string): string[] => {
    const out: string[] = []; const stack = [id];
    while (stack.length) { const x = stack.pop()!; const k = children.get(x); if (k?.length) stack.push(...k); else if (x !== id || !isSummary(x)) out.push(x); }
    return out;
  };

  // Edges: links (into a summary: to each leaf) and child → parent aggregation.
  const edges: Edge[] = [];
  const out = new Map<string, Edge[]>(), inn = new Map<string, Edge[]>();
  const add = (e: Edge) => { edges.push(e); (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e); (inn.get(e.to) ?? inn.set(e.to, []).get(e.to)!).push(e); };
  for (const l of doc.links) {
    if (!byId.has(l.source) || !byId.has(l.target)) continue;
    const lag = l.lagUnit === 'hour' ? Math.ceil((l.lag ?? 0) / hoursPerDay) : Math.round(l.lag ?? 0);
    const targets = isSummary(l.target) ? leavesOf(l.target) : [l.target];
    for (const t of targets) add({ from: l.source, to: t, type: l.type, lag, linkId: l.id });
  }
  const aggOut = new Map<string, string>(); // child → parent
  for (const [p, ks] of children) for (const k of ks) aggOut.set(k, p);

  // Topological order over links and aggregation (Kahn); what is left over is a cycle (C9).
  const indeg = new Map<string, number>();
  for (const id of byId.keys()) indeg.set(id, 0);
  for (const e of edges) indeg.set(e.to, indeg.get(e.to)! + 1);
  for (const p of aggOut.values()) indeg.set(p, indeg.get(p)! + 1);
  const queue = [...byId.keys()].filter((id) => indeg.get(id) === 0);
  const order: string[] = [];
  const dec = (id: string) => { const d = indeg.get(id)! - 1; indeg.set(id, d); if (d === 0) queue.push(id); };
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    order.push(id);
    for (const e of out.get(id) ?? []) dec(e.to);
    const p = aggOut.get(id); if (p) dec(p);
  }
  if (order.length < byId.size) {
    const left = new Set([...byId.keys()].filter((id) => indeg.get(id)! > 0));
    const cycle = findCycle(left, out, aggOut);
    const names = cycle.map((id) => byId.get(id)?.name ?? id);
    const linkIds: string[] = [];
    for (let i = 0; i + 1 < cycle.length; i++) { const l = doc.links.find((x) => x.source === cycle[i] && x.target === cycle[i + 1]); if (l) linkIds.push(l.id); }
    return { tasks: new Map(), changes: [], cycle, issues: [{ kind: 'cycle', message: `Dependencies form a cycle: ${names.join(' → ')}`, linkIds }] };
  }

  // Forward pass.
  const es = new Map<string, DayNum>(), ef = new Map<string, DayNum>(), driver = new Map<string, string>();
  // Each task in its own calendar (C8), with its pauses (D12) and hours (G4).
  const hpdOf = new Map((doc.calendars ?? []).map((c) => [c.id, c.hoursPerDay ?? 8]));
  const calOf = (t: Task) => (t.calendar && cals.get(t.calendar)) || cal;
  const spanFor = (t: Task, s: DayNum) => spanOf(calOf(t), s, workDays(t, (t.calendar && hpdOf.get(t.calendar)) || hoursPerDay), t.splits);
  /** Working days the task occupies from start to end, pauses included. */
  const durOf = (t: Task) => (t.type === 'milestone' ? 0 : Math.max(1, Math.round(spanFor(t, roadmapStart).occupied)));
  const minStartFrom = (e: Edge, succ: Task): DayNum | undefined => {
    const ps = es.get(e.from), pf = ef.get(e.from);
    if (ps === undefined || pf === undefined) return undefined;
    const predMilestone = byId.get(e.from)?.type === 'milestone';
    const succMilestone = succ.type === 'milestone';
    const d = durOf(succ);
    switch (e.type) {
      case 'FS': return predMilestone || succMilestone ? cal.shift(pf, e.lag) : cal.shift(pf, 1 + e.lag);
      case 'SS': return cal.shift(ps, e.lag);
      case 'FF': { const minEnd = cal.shift(pf, e.lag); return d <= 1 ? minEnd : cal.shift(minEnd, -(d - 1)); }
      case 'SF': { const minEnd = cal.shift(ps, e.lag - 1); return d <= 1 ? minEnd : cal.shift(minEnd, -(d - 1)); }
    }
  };
  for (const id of order) {
    const t = byId.get(id)!;
    if (isSummary(id)) {
      let s = Infinity, f = -Infinity;
      for (const k of children.get(id) ?? []) { const a = es.get(k), b = ef.get(k); if (a !== undefined && b !== undefined) { s = Math.min(s, a); f = Math.max(f, b); } }
      if (s !== Infinity) { es.set(id, s); ef.set(id, f); }
      continue;
    }
    const d = durOf(t);
    const incoming = inn.get(id) ?? [];
    let start: DayNum | undefined;
    if (t.mode === 'manual') {
      if (t.start) start = cal.nextWorking(toDay(t.start));
    } else {
      let min: DayNum | undefined;
      let by: string | undefined;
      for (const e of incoming) { const m = minStartFrom(e, t); if (m !== undefined && (min === undefined || m > min)) { min = m; by = e.linkId; } }
      if (min !== undefined) { start = Math.max(min, roadmapStart); if (by && min >= roadmapStart) driver.set(id, by); }
      else if (t.start) start = Math.max(cal.nextWorking(toDay(t.start)), roadmapStart);
      const c = t.constraint;
      if (start !== undefined && c?.date) {
        const cd = toDay(c.date);
        if (c.type === 'SNET' && start < cal.nextWorking(cd)) { start = cal.nextWorking(cd); driver.delete(id); }
        if (c.type === 'MSO') { start = cal.nextWorking(cd); driver.delete(id); }
        if (c.type === 'FNET' || c.type === 'MFO') {
          const s2 = d <= 1 ? cal.prevWorking(cd) : cal.shift(cal.prevWorking(cd), -(d - 1));
          if (c.type === 'MFO' || start < s2) { start = s2; driver.delete(id); }
        }
      }
    }
    if (start === undefined) continue; // unscheduled
    start = calOf(t).nextWorking(start);
    es.set(id, start);
    ef.set(id, d === 0 ? start : spanFor(t, start).end);
  }

  // Backward pass for slack and the critical path (C2).
  let end = -Infinity;
  for (const [id, f] of ef) if (!isSummary(id)) end = Math.max(end, f);
  const ls = new Map<string, DayNum>(), lf = new Map<string, DayNum>();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i]!;
    if (!es.has(id)) continue;
    const t = byId.get(id)!;
    const d = isSummary(id) ? 0 : durOf(t);
    let latestFinish = end;
    const p = aggOut.get(id);
    if (p && lf.has(p)) latestFinish = Math.min(latestFinish, lf.get(p)!);
    for (const e of out.get(id) ?? []) {
      const sLS = ls.get(e.to), sLF = lf.get(e.to);
      if (sLS === undefined || sLF === undefined) continue;
      // A summary's start-based links limit when its first subtask starts, not when its subtasks finish.
      if (isSummary(id) && (e.type === 'SS' || e.type === 'SF')) continue;
      const succMilestone = byId.get(e.to)?.type === 'milestone', meMilestone = t.type === 'milestone';
      let f: DayNum;
      switch (e.type) {
        case 'FS': f = meMilestone || succMilestone ? cal.shift(sLS, -e.lag) : cal.shift(sLS, -(1 + e.lag)); break;
        case 'SS': { const lsMe = cal.shift(sLS, -e.lag); f = d <= 1 ? lsMe : cal.shift(lsMe, d - 1); break; }
        case 'FF': f = cal.shift(sLF, -e.lag); break;
        case 'SF': { const lsMe = cal.shift(sLF, -(e.lag - 1)); f = d <= 1 ? lsMe : cal.shift(lsMe, d - 1); break; }
      }
      latestFinish = Math.min(latestFinish, f);
    }
    if (isSummary(id)) {
      // A summary's latest finish only passes its own successors' limits down to its children.
      lf.set(id, latestFinish); ls.set(id, latestFinish);
      continue;
    }
    lf.set(id, latestFinish);
    ls.set(id, d <= 1 ? latestFinish : cal.shift(latestFinish, -(d - 1)));
  }

  // Results, changes (K1) and issues.
  const tasks = new Map<string, TaskSchedule>();
  const changes: ScheduleResult['changes'] = [];
  const issues: ScheduleIssue[] = [];
  for (const [id, s] of es) {
    const t = byId.get(id)!;
    const f = ef.get(id)!, l = ls.get(id) ?? s, lfi = lf.get(id) ?? f;
    const slack = l >= s ? cal.workingDaysBetween(s, l) - 1 : -(cal.workingDaysBetween(l, s) - 1);
    tasks.set(id, { start: s, end: f, lateStart: l, lateFinish: lfi, slack, critical: !isSummary(id) && slack <= 0, drivenBy: driver.get(id) });
    if (!isSummary(id) && t.mode !== 'manual' && (!t.start || toDay(t.start) !== s)) changes.push({ id, start: fromDay(s) });
    const c = t.constraint;
    if (c?.date && !isSummary(id)) {
      const cd = toDay(c.date);
      if (c.type === 'SNLT' && s > cd) issues.push({ kind: 'constraint', taskId: id, message: `${t.name} starts after ${c.date} (start no later than)`, by: cal.workingDaysBetween(cd, s) - 1, suggest: fromDay(s) });
      if (c.type === 'FNLT' && f > cd) issues.push({ kind: 'constraint', taskId: id, message: `${t.name} finishes after ${c.date} (finish no later than)`, by: cal.workingDaysBetween(cd, f) - 1, suggest: fromDay(f) });
    }
    if (t.deadline && f > toDay(t.deadline)) issues.push({ kind: 'deadline', taskId: id, message: `${t.name} finishes after its deadline ${t.deadline}`, by: cal.workingDaysBetween(toDay(t.deadline), f) - 1, suggest: fromDay(f) });
  }
  // Dependencies a manual task (or a fixed constraint) breaks.
  for (const e of edges) {
    const succ = byId.get(e.to)!;
    const s = es.get(e.to);
    const m = minStartFrom(e, succ);
    if (s !== undefined && m !== undefined && s < m) {
      const pn = byId.get(e.from)?.name, sn = succ.name;
      issues.push({ kind: 'brokenDependency', linkId: e.linkId, taskId: e.to, message: `${sn} is scheduled before ${pn} allows`, by: cal.workingDaysBetween(s, m) - 1, suggest: fromDay(calOf(succ).nextWorking(m)) });
    }
  }
  return { tasks, changes, issues, end: end === -Infinity ? undefined : end };
}

/**
 * Finds one dependency cycle among `nodes` (the tasks a topological sort could not order), following links and
 * child-to-parent edges (`agg`). Returns the task ids along the cycle, for the issue message.
 */
function findCycle(nodes: Set<string>, out: Map<string, Edge[]>, agg: Map<string, string>): string[] {
  const next = (id: string) => [...(out.get(id) ?? []).map((e) => e.to), ...(agg.has(id) ? [agg.get(id)!] : [])].filter((x) => nodes.has(x));
  const start = nodes.values().next().value as string;
  // Walk forward inside the remaining set until a node repeats.
  const seen = new Map<string, number>(); const path: string[] = [];
  let cur: string | undefined = start;
  while (cur !== undefined && !seen.has(cur)) { seen.set(cur, path.length); path.push(cur); cur = next(cur)[0]; }
  return cur === undefined ? path : [...path.slice(seen.get(cur)!), cur];
}

/**
 * Whether a new dependency may be drawn from `source` to `target` (C9): not to itself, not between a
 * summary and its own descendant, not twice, and not if it would close a cycle. Returns the reason.
 */
export function whyNotLink(doc: RoadmapDocument, source: string, target: string, type: Kind = 'FS'): string | null {
  if (source === target) return 'A task cannot depend on itself';
  const t = new Map(doc.tasks.map((x) => [x.id, x]));
  const a = t.get(source), b = t.get(target);
  if (!a || !b) return 'Unknown task';
  const isAncestor = (anc: string, d: string) => { for (let p = t.get(d)?.parent; p; p = t.get(p)?.parent ?? null) if (p === anc) return true; return false; };
  if (isAncestor(source, target) || isAncestor(target, source)) return 'A summary cannot depend on its own sub-task, or the other way round';
  if (doc.links.some((l) => l.source === source && l.target === target)) return `${a.name} already links to ${b.name}`;
  const trial = schedule({ ...doc, links: [...doc.links, { id: '__trial', source, target, type }] });
  if (trial.cycle) return `This would create a cycle: ${trial.cycle.map((id) => t.get(id)?.name ?? id).join(' → ')}`;
  return null;
}

/** Applies a schedule's changes to a document (K1): new starts; a stored end is dropped so it cannot disagree. */
export function applySchedule(doc: RoadmapDocument, r: ScheduleResult): RoadmapDocument {
  if (!r.changes.length) return doc;
  const ch = new Map(r.changes.map((c) => [c.id, c.start]));
  return { ...doc, tasks: doc.tasks.map((t) => { const s = ch.get(t.id); if (s === undefined) return t; const { end: _e, ...rest } = t; return { ...rest, start: s }; }) };
}

/** One way to resolve a scheduling problem (C5), as data operations the caller runs (and can undo). */
export interface IssueFix {
  label: string;
  ops: ({ type: 'task.update'; id: string; fields: Record<string, unknown> } | { type: 'link.delete'; id: string })[];
}

/** Explained fixes for an issue (C5): move, remove the cause, or switch to automatic scheduling. */
export function fixesFor(doc: RoadmapDocument, issue: ScheduleIssue): IssueFix[] {
  const task = issue.taskId ? doc.tasks.find((t) => t.id === issue.taskId) : undefined;
  const link = issue.linkId ? doc.links.find((l) => l.id === issue.linkId) : undefined;
  const name = (id: string) => doc.tasks.find((t) => t.id === id)?.name ?? id;
  const out: IssueFix[] = [];
  const dropEnd = task?.end ? { end: null } : {};
  switch (issue.kind) {
    case 'brokenDependency': {
      if (task && issue.suggest) {
        const fixedConstraint = task.constraint && (task.constraint.type === 'MSO' || task.constraint.type === 'MFO');
        out.push({ label: `Move ${task.name} to start on ${issue.suggest}`, ops: [{ type: 'task.update', id: task.id, fields: { start: issue.suggest, ...dropEnd, ...(fixedConstraint ? { constraint: null } : {}) } }] });
      }
      if (task?.mode === 'manual') out.push({ label: `Schedule ${task.name} automatically`, ops: [{ type: 'task.update', id: task.id, fields: { mode: 'auto' } }] });
      if (link) out.push({ label: `Remove the dependency ${name(link.source)} → ${name(link.target)}`, ops: [{ type: 'link.delete', id: link.id }] });
      break;
    }
    case 'constraint':
      if (task && issue.suggest && task.constraint) out.push({ label: `Move the constraint to ${issue.suggest}`, ops: [{ type: 'task.update', id: task.id, fields: { constraint: { ...task.constraint, date: issue.suggest } } }] });
      if (task) out.push({ label: `Remove the constraint on ${task.name}`, ops: [{ type: 'task.update', id: task.id, fields: { constraint: null } }] });
      break;
    case 'deadline':
      if (task && issue.suggest) out.push({ label: `Move the deadline to ${issue.suggest}`, ops: [{ type: 'task.update', id: task.id, fields: { deadline: issue.suggest } }] });
      if (task) out.push({ label: `Remove the deadline of ${task.name}`, ops: [{ type: 'task.update', id: task.id, fields: { deadline: null } }] });
      break;
    case 'cycle':
      for (const id of issue.linkIds ?? []) { const l = doc.links.find((x) => x.id === id); if (l) out.push({ label: `Remove the dependency ${name(l.source)} → ${name(l.target)}`, ops: [{ type: 'link.delete', id }] }); }
      break;
  }
  return out;
}
