import type { Link, RoadmapDocument, Task } from '@gantt/contract';
import { fromDay, toDay, WorkCalendar } from '@gantt/engine';

export interface GenerateOptions {
  tasks: number;
  /** Maximum nesting depth of summaries (1 = flat). */
  depth?: number;
  /** Links per leaf task, 0–1+. */
  linkDensity?: number;
  /** Arrange every n-th summary as a lane row. 0 = none. */
  laneEvery?: number;
  seed?: number;
  start?: string;
}

/** Deterministic generator for large valid files (M10). */
export function generate(opts: GenerateOptions): RoadmapDocument {
  const { tasks: n, depth = 3, linkDensity = 0.5, laneEvery = 0, seed = 1, start = '2026-11-02' } = opts;
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const cal = new WorkCalendar();
  const base = toDay(start);
  const tasks: Task[] = [];
  const leaves: Task[] = [];
  const links: Link[] = [];
  const fanout = Math.max(2, Math.round(Math.pow(n, 1 / Math.max(1, depth))));
  let summaries = 0;

  const make = (parent: string | null, level: number, offset: number) => {
    if (tasks.length >= n) return;
    const isSummary = level < depth - 1 && tasks.length + fanout < n;
    const id = `t${tasks.length + 1}`;
    if (isSummary) {
      summaries++;
      const t: Task = { id, name: `Phase ${id}`, type: 'summary', parent, kind: level === 0 ? 'initiative' : 'use-case' };
      if (laneEvery && level === depth - 2 && summaries % laneEvery === 0) { t.lane = true; t.kind = 'crew'; t.name = `Crew ${id}`; }
      tasks.push(t);
      let off = offset;
      for (let i = 0; i < fanout && tasks.length < n; i++) { make(id, level + 1, off); off += Math.floor(rnd() * 15); }
    } else {
      const milestone = rnd() < 0.08;
      const dur = milestone ? 0 : 1 + Math.floor(rnd() * 15);
      const st = cal.nextWorking(base + offset + Math.floor(rnd() * 10));
      const t: Task = {
        id, name: milestone ? `Milestone ${id}` : `Task ${id}`, type: milestone ? 'milestone' : 'task', parent,
        start: fromDay(st), duration: dur, progress: milestone ? 0 : Math.round(rnd() * 10) / 10,
      };
      if (rnd() < 0.02) { delete t.start; delete t.duration; }
      tasks.push(t); leaves.push(t);
    }
  };
  let offset = 0;
  while (tasks.length < n) { make(null, 0, offset); offset += 20; }

  // Links only go forward in the list, so they can never form a cycle; skip ancestor/descendant pairs.
  const parent = new Map(tasks.map((t) => [t.id, t.parent]));
  const related = (a: string, b: string) => { for (let c = parent.get(b); c; c = parent.get(c)) if (c === a) return true; return false; };
  const want = Math.floor(leaves.length * linkDensity);
  for (let i = 0; links.length < want && i < want * 3; i++) {
    const a = Math.floor(rnd() * (leaves.length - 1));
    const b = Math.min(leaves.length - 1, a + 1 + Math.floor(rnd() * 5));
    const src = leaves[a]!, tgt = leaves[b]!;
    if (src.id === tgt.id || related(src.id, tgt.id) || related(tgt.id, src.id)) continue;
    const r = rnd();
    links.push({ id: `l${links.length + 1}`, source: src.id, target: tgt.id, type: r < 0.85 ? 'FS' : r < 0.95 ? 'SS' : 'FF' });
  }

  return {
    contract: 'gantt-roadmap/1',
    roadmap: { id: 'gen', name: `Generated (${n} tasks)`, version: 1, timeZone: 'UTC', start, statusDate: start },
    tasks, links,
  };
}
