import { CONTRACT_MAJOR, CONTRACT_NAME, type RoadmapDocument } from './types.ts';

export interface Issue { path: string; message: string }
export type ValidationResult =
  | { ok: true; doc: RoadmapDocument; warnings: Issue[] }
  | { ok: false; errors: Issue[]; warnings: Issue[] };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z?$/;

export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

const KNOWN: Record<string, string[]> = {
  root: ['contract', 'roadmap', 'calendars', 'tasks', 'links', 'resources', 'proposals', 'access'],
  roadmap: ['id', 'name', 'version', 'timeZone', 'start', 'defaultCalendar', 'statusDate'],
  calendar: ['id', 'name', 'workingDays', 'hoursPerDay', 'holidays'],
  task: ['id', 'name', 'type', 'parent', 'kind', 'lane', 'start', 'duration', 'durationUnit', 'end', 'progress',
    'mode', 'owner', 'resources', 'constraint', 'deadline', 'hasChildren'],
  link: ['id', 'source', 'target', 'type', 'kind', 'lag', 'lagUnit'],
  resource: ['id', 'name', 'capacityFte', 'calendar'],
};

/**
 * Validates an unknown value against contract `gantt-roadmap/1` (M3, M4).
 * Errors carry a path and a reason, e.g. `tasks[12].start: not a date`.
 * Unknown fields are warnings. Cross-calendar `end` agreement is checked by the engine
 * (see `checkEnds` in @gantt/engine) because it needs working-time arithmetic.
 */
export function validate(input: unknown): ValidationResult {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const err = (path: string, message: string) => errors.push({ path, message });
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  const str = (o: Record<string, unknown>, k: string, p: string, required = true) => {
    if (o[k] === undefined) { if (required) err(`${p}.${k}`, 'is required'); return; }
    if (typeof o[k] !== 'string' || o[k] === '') err(`${p}.${k}`, 'must be a non-empty string');
  };
  const date = (o: Record<string, unknown>, k: string, p: string, required = false) => {
    if (o[k] === undefined) { if (required) err(`${p}.${k}`, 'is required'); return; }
    if (!isIsoDate(o[k])) err(`${p}.${k}`, 'not a date (expected YYYY-MM-DD)');
  };
  const num = (o: Record<string, unknown>, k: string, p: string, min = -Infinity, max = Infinity) => {
    if (o[k] === undefined) return;
    const v = o[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) err(`${p}.${k}`, 'must be a number');
    else if (v < min || v > max) err(`${p}.${k}`, `must be between ${min} and ${max}`);
  };
  const oneOf = (o: Record<string, unknown>, k: string, p: string, values: string[], required = false) => {
    if (o[k] === undefined) { if (required) err(`${p}.${k}`, 'is required'); return; }
    if (!values.includes(o[k] as string)) err(`${p}.${k}`, `must be one of ${values.join(', ')}`);
  };
  const unknown = (o: Record<string, unknown>, known: string[], p: string) => {
    for (const k of Object.keys(o)) if (!known.includes(k)) warnings.push({ path: `${p}.${k}`, message: 'unknown field' });
  };
  const list = (o: Record<string, unknown>, k: string, required: boolean): unknown[] => {
    if (o[k] === undefined) { if (required) err(k, 'is required'); return []; }
    if (!Array.isArray(o[k])) { err(k, 'must be an array'); return []; }
    return o[k] as unknown[];
  };
  const ids = (items: unknown[], name: string) => {
    const set = new Set<string>();
    items.forEach((it, i) => {
      if (!isObj(it)) return;
      const id = it.id;
      if (typeof id === 'string') {
        if (set.has(id)) err(`${name}[${i}].id`, `duplicate id "${id}"`);
        set.add(id);
      }
    });
    return set;
  };

  if (!isObj(input)) return { ok: false, errors: [{ path: '$', message: 'must be a JSON object' }], warnings };

  // Contract version first: an unknown major version is refused outright.
  const c = input.contract;
  if (typeof c !== 'string') return { ok: false, errors: [{ path: 'contract', message: 'is required' }], warnings };
  const [name, major] = c.split('/');
  if (name !== CONTRACT_NAME || major !== String(CONTRACT_MAJOR)) {
    return { ok: false, errors: [{ path: 'contract', message: `unsupported contract "${c}" (expected ${CONTRACT_NAME}/${CONTRACT_MAJOR})` }], warnings };
  }
  unknown(input, KNOWN.root!, '$');

  const rm = input.roadmap;
  if (!isObj(rm)) err('roadmap', 'is required and must be an object');
  else {
    str(rm, 'id', 'roadmap'); str(rm, 'name', 'roadmap'); str(rm, 'timeZone', 'roadmap');
    if (!Number.isInteger(rm.version)) err('roadmap.version', 'must be an integer');
    date(rm, 'start', 'roadmap', true); date(rm, 'statusDate', 'roadmap');
    unknown(rm, KNOWN.roadmap!, 'roadmap');
  }

  const calendars = list(input, 'calendars', false);
  calendars.forEach((cal, i) => {
    const p = `calendars[${i}]`;
    if (!isObj(cal)) return err(p, 'must be an object');
    str(cal, 'id', p); str(cal, 'name', p);
    const wd = cal.workingDays;
    if (!Array.isArray(wd) || wd.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) err(`${p}.workingDays`, 'must be an array of weekday numbers 1–7');
    else if (wd.length === 0) err(`${p}.workingDays`, 'must contain at least one day');
    num(cal, 'hoursPerDay', p, 0.5, 24);
    if (cal.holidays !== undefined) {
      if (!Array.isArray(cal.holidays)) err(`${p}.holidays`, 'must be an array');
      else cal.holidays.forEach((h, j) => { if (!isIsoDate(h)) err(`${p}.holidays[${j}]`, 'not a date (expected YYYY-MM-DD)'); });
    }
    unknown(cal, KNOWN.calendar!, p);
  });
  const calIds = ids(calendars, 'calendars');
  if (isObj(rm) && typeof rm.defaultCalendar === 'string' && !calIds.has(rm.defaultCalendar)) err('roadmap.defaultCalendar', `unknown calendar "${rm.defaultCalendar}"`);

  const resources = list(input, 'resources', false);
  resources.forEach((r, i) => {
    const p = `resources[${i}]`;
    if (!isObj(r)) return err(p, 'must be an object');
    str(r, 'id', p); str(r, 'name', p); num(r, 'capacityFte', p, 0);
    if (typeof r.calendar === 'string' && !calIds.has(r.calendar)) err(`${p}.calendar`, `unknown calendar "${r.calendar}"`);
    unknown(r, KNOWN.resource!, p);
  });
  const resIds = ids(resources, 'resources');

  const tasks = list(input, 'tasks', true);
  const taskIds = ids(tasks, 'tasks');
  const parentOf = new Map<string, string>();
  tasks.forEach((t, i) => {
    const p = `tasks[${i}]`;
    if (!isObj(t)) return err(p, 'must be an object');
    str(t, 'id', p); str(t, 'name', p);
    oneOf(t, 'type', p, ['task', 'summary', 'milestone'], true);
    oneOf(t, 'mode', p, ['auto', 'manual', 'inactive']);
    oneOf(t, 'durationUnit', p, ['day', 'hour']);
    if (t.parent === undefined) err(`${p}.parent`, 'is required (use null for a top-level task)');
    else if (t.parent !== null) {
      if (typeof t.parent !== 'string') err(`${p}.parent`, 'must be a string or null');
      else if (!taskIds.has(t.parent)) err(`${p}.parent`, `unknown task "${t.parent}"`);
      else if (t.parent === t.id) err(`${p}.parent`, 'a task cannot be its own parent');
      else if (typeof t.id === 'string') parentOf.set(t.id, t.parent);
    }
    if (t.kind !== undefined && typeof t.kind !== 'string') err(`${p}.kind`, 'must be a string');
    if (t.lane !== undefined && typeof t.lane !== 'boolean') err(`${p}.lane`, 'must be true or false');
    if (t.hasChildren !== undefined && typeof t.hasChildren !== 'boolean') err(`${p}.hasChildren`, 'must be true or false');
    if (t.type !== 'summary') {
      date(t, 'start', p); date(t, 'end', p);
      num(t, 'duration', p, 0);
      if (t.type === 'milestone' && t.duration !== undefined && t.duration !== 0) err(`${p}.duration`, 'a milestone has duration 0');
      if (t.type === 'task' && t.start !== undefined && t.duration === undefined && t.end === undefined) err(`${p}.duration`, 'is required when start is given (or give end)');
    }
    num(t, 'progress', p, 0, 1);
    date(t, 'deadline', p);
    if (t.constraint !== undefined) {
      if (!isObj(t.constraint)) err(`${p}.constraint`, 'must be an object');
      else {
        oneOf(t.constraint, 'type', `${p}.constraint`, ['ASAP', 'SNET', 'SNLT', 'FNET', 'FNLT', 'MSO', 'MFO'], true);
        date(t.constraint, 'date', `${p}.constraint`, t.constraint.type !== 'ASAP');
      }
    }
    if (t.resources !== undefined) {
      if (!Array.isArray(t.resources)) err(`${p}.resources`, 'must be an array');
      else t.resources.forEach((ra, j) => {
        if (!isObj(ra) || typeof ra.id !== 'string') return err(`${p}.resources[${j}]`, 'must have an id');
        if (!resIds.has(ra.id)) err(`${p}.resources[${j}].id`, `unknown resource "${ra.id}"`);
        num(ra, 'allocation', `${p}.resources[${j}]`, 0);
      });
    }
    unknown(t, KNOWN.task!, p);
  });
  // Parent cycles.
  for (const start of parentOf.keys()) {
    const seen = new Set<string>([start]);
    let cur = parentOf.get(start);
    while (cur) {
      if (seen.has(cur)) { err(`tasks[${tasks.findIndex((t) => isObj(t) && t.id === start)}].parent`, 'parent chain forms a cycle'); break; }
      seen.add(cur); cur = parentOf.get(cur);
    }
  }

  const links = list(input, 'links', true);
  ids(links, 'links');
  const adj = new Map<string, string[]>();
  links.forEach((l, i) => {
    const p = `links[${i}]`;
    if (!isObj(l)) return err(p, 'must be an object');
    str(l, 'id', p);
    for (const k of ['source', 'target'] as const) {
      if (typeof l[k] !== 'string') err(`${p}.${k}`, 'is required');
      else if (!taskIds.has(l[k] as string)) err(`${p}.${k}`, `unknown task "${l[k]}"`);
    }
    if (l.source === l.target && typeof l.source === 'string') err(p, 'a task cannot depend on itself');
    oneOf(l, 'type', p, ['FS', 'SS', 'FF', 'SF'], true);
    oneOf(l, 'lagUnit', p, ['day', 'hour']);
    num(l, 'lag', p);
    if (typeof l.source === 'string' && typeof l.target === 'string') {
      // A link between a summary and its own descendant is invalid (C9).
      const isAncestor = (a: string, d: string) => { let c = parentOf.get(d); while (c) { if (c === a) return true; c = parentOf.get(c); } return false; };
      if (isAncestor(l.source, l.target) || isAncestor(l.target, l.source)) err(p, 'a link cannot join a summary to its own descendant');
      (adj.get(l.source) ?? adj.set(l.source, []).get(l.source)!).push(l.target);
    }
    unknown(l, KNOWN.link!, p);
  });
  const cycle = findCycle(adj);
  if (cycle) err('links', `links form a cycle: ${cycle.join(' → ')}`);

  if (input.proposals !== undefined && !Array.isArray(input.proposals)) err('proposals', 'must be an array');
  if (input.access !== undefined && !isObj(input.access)) err('access', 'must be an object');

  return errors.length ? { ok: false, errors, warnings } : { ok: true, doc: input as unknown as RoadmapDocument, warnings };
}

function findCycle(adj: Map<string, string[]>): string[] | null {
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  // Iterative DFS so 10k-node chains do not overflow the call stack.
  for (const root of adj.keys()) {
    if (state.has(root)) continue;
    const it: [string, number][] = [[root, 0]];
    state.set(root, 1); stack.push(root);
    while (it.length) {
      const top = it[it.length - 1]!;
      const next = adj.get(top[0]) ?? [];
      if (top[1] < next.length) {
        const n = next[top[1]++]!;
        const s = state.get(n);
        if (s === 1) return [...stack.slice(stack.indexOf(n)), n];
        if (!s) { state.set(n, 1); stack.push(n); it.push([n, 0]); }
      } else { state.set(top[0], 2); stack.pop(); it.pop(); }
    }
  }
  return null;
}
