import { validate, type Issue, type Link, type LinkType, type RoadmapDocument, type Task } from '@gantt/contract';

/**
 * The task table shared by CSV and Excel (I1, I3): one row per task, dependencies in a "predecessors" cell
 * such as "t2FS; t3SS+2". Every field this table carries survives export followed by import.
 */
export const COLUMNS = ['id', 'name', 'type', 'parent', 'kind', 'start', 'duration', 'durationUnit', 'progress', 'owner', 'predecessors', 'constraint', 'constraintDate', 'deadline', 'mode'] as const;
/** One column name of the import/export table. */
export type Column = (typeof COLUMNS)[number];
/** Task and link fields the table carries; an import changes only these (others are kept as they are). */
export const TABLE_FIELDS = { task: ['name', 'type', 'parent', 'kind', 'start', 'duration', 'durationUnit', 'progress', 'owner', 'constraint', 'deadline', 'mode', 'order'], link: ['source', 'target', 'type', 'lag', 'lagUnit'] };

/** Header names accepted on import besides the column ids (case and spaces ignored). */
const SYNONYMS: Record<string, Column> = {
  task: 'name', taskname: 'name', title: 'name', summary: 'parent', parentid: 'parent', begin: 'start', startdate: 'start',
  days: 'duration', durationdays: 'duration', unit: 'durationUnit', complete: 'progress', percentcomplete: 'progress', done: 'progress',
  assignee: 'owner', dependencies: 'predecessors', dependson: 'predecessors', predecessor: 'predecessors',
};

/**
 * The roadmap as a table: a header row of `COLUMNS`, then one row per task in tree order with its predecessors
 * written like Project does ("3FS+2d").
 */
export function tableFromDoc(doc: RoadmapDocument): string[][] {
  const preds = new Map<string, Link[]>();
  for (const l of doc.links) (preds.get(l.target) ?? preds.set(l.target, []).get(l.target)!).push(l);
  // Children after their parent, siblings in order, so a spreadsheet reads like the tree.
  const kids = new Map<string | null, Task[]>();
  doc.tasks.forEach((t) => (kids.get(t.parent) ?? kids.set(t.parent, []).get(t.parent)!).push(t));
  for (const k of kids.values()) k.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const ordered: Task[] = [];
  const visit = (p: string | null) => { for (const t of kids.get(p) ?? []) { ordered.push(t); visit(t.id); } };
  visit(null);
  const rows = ordered.map((t) => [
    t.id, t.name, t.type, t.parent ?? '', t.kind ?? '', t.start ?? '', t.duration === undefined ? '' : String(t.duration), t.durationUnit ?? '',
    t.progress === undefined ? '' : String(Math.round(t.progress * 1000) / 10), t.owner ?? '',
    (preds.get(t.id) ?? []).map((l) => `${l.source}${l.type}${l.lag ? (l.lag > 0 ? `+${l.lag}` : String(l.lag)) : ''}${l.lagUnit === 'hour' ? 'h' : ''}`).join('; '),
    t.constraint?.type ?? '', t.constraint?.date ?? '', t.deadline ?? '', t.mode ?? '',
  ]);
  return [[...COLUMNS], ...rows];
}

/** The roadmap read from a table, with warnings, or the reasons it was refused. */
export type ImportResult = { ok: true; doc: RoadmapDocument; warnings: Issue[] } | { ok: false; errors: Issue[] };

/**
 * Builds a roadmap from a table (I1). `base` supplies the roadmap header, calendars and resources; the
 * tasks and links come from the table. The result is validated like any loaded file; problems name the row.
 */
export function docFromTable(table: string[][], base: Pick<RoadmapDocument, 'contract' | 'roadmap'> & Partial<RoadmapDocument>): ImportResult {
  const errors: Issue[] = [], warnings: Issue[] = [];
  const nonEmpty = table.filter((r) => r.some((c) => c.trim() !== ''));
  if (!nonEmpty.length) return { ok: false, errors: [{ path: 'row 1', message: 'the file is empty' }] };
  const norm = (h: string) => h.trim().toLowerCase().replace(/[^a-z]/g, '');
  const header = nonEmpty[0]!.map((h) => {
    const n = norm(h);
    return (COLUMNS as readonly string[]).find((c) => c.toLowerCase() === n) as Column | undefined ?? SYNONYMS[n];
  });
  if (!header.includes('name')) return { ok: false, errors: [{ path: 'row 1', message: 'a "name" column is required' }] };
  nonEmpty[0]!.forEach((h, i) => { if (!header[i] && h.trim()) warnings.push({ path: `column ${i + 1}`, message: `unknown column "${h}" ignored` }); });
  const tasks: Task[] = [], links: Link[] = [];
  const at = (r: string[], c: Column) => { const i = header.indexOf(c); return i < 0 ? '' : (r[i] ?? '').trim(); };
  nonEmpty.slice(1).forEach((r, k) => {
    const row = `row ${k + 2}`;
    const name = at(r, 'name');
    if (!name) { errors.push({ path: row, message: 'name is empty' }); return; }
    const id = at(r, 'id') || `t${k + 1}`;
    const t: Task = { id, name, type: (at(r, 'type') || 'task') as Task['type'], parent: at(r, 'parent') || null, order: (k + 1) * 1024 };
    const kind = at(r, 'kind'); if (kind) t.kind = kind;
    const start = at(r, 'start'); if (start) t.start = start;
    const dur = at(r, 'duration'); if (dur) { const n = Number(dur.replace(',', '.')); if (Number.isFinite(n)) t.duration = n; else errors.push({ path: `${row}.duration`, message: `not a number: "${dur}"` }); }
    const unit = at(r, 'durationUnit'); if (unit) t.durationUnit = unit as Task['durationUnit'];
    const pr = at(r, 'progress'); if (pr) { const n = Number(pr.replaceAll('%', '').trim().replace(',', '.')); if (Number.isFinite(n)) t.progress = Math.max(0, Math.min(1, n / 100)); else errors.push({ path: `${row}.progress`, message: `not a number: "${pr}"` }); }
    const owner = at(r, 'owner'); if (owner) t.owner = owner;
    const ct = at(r, 'constraint'); if (ct) t.constraint = { type: ct as NonNullable<Task['constraint']>['type'], ...(at(r, 'constraintDate') ? { date: at(r, 'constraintDate') } : {}) };
    const dl = at(r, 'deadline'); if (dl) t.deadline = dl;
    const mode = at(r, 'mode'); if (mode) t.mode = mode as Task['mode'];
    tasks.push(t);
    for (const p of at(r, 'predecessors').split(/[;,]/).map((x) => x.trim()).filter(Boolean)) {
      const m = /^(.+?)(FS|SS|FF|SF)?([+-]\d+(?:\.\d+)?)?(h)?$/.exec(p);
      if (!m) { errors.push({ path: `${row}.predecessors`, message: `cannot read "${p}"` }); continue; }
      const link: Link = { id: `l-${m[1]}-${id}`, source: m[1]!, target: id, type: (m[2] ?? 'FS') as LinkType };
      if (m[3]) link.lag = Number(m[3]);
      if (m[4]) link.lagUnit = 'hour';
      links.push(link);
    }
  });
  if (errors.length) return { ok: false, errors };
  const doc: RoadmapDocument = { ...base, tasks, links } as RoadmapDocument;
  delete (doc as { baselines?: unknown }).baselines;
  delete (doc as { proposals?: unknown }).proposals;
  const v = validate(doc);
  if (!v.ok) return { ok: false, errors: v.errors };
  return { ok: true, doc, warnings: [...warnings, ...v.warnings] };
}
