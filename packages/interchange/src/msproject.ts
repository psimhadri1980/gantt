import { validate, type ConstraintType, type Issue, type Link, type RoadmapDocument, type Task } from '@gantt/contract';
import { fromDay, place, toDay } from '@gantt/engine';

/**
 * Microsoft Project XML (MSPDI) import and export (I4). Carried both ways: the outline (tree), names, start,
 * duration (days or hours), finish, % complete, milestones, the four dependency types with lag,
 * constraints, deadlines, manual mode, and our ids (in the task's Text1 field, so a round trip keeps them).
 */

/** Task and link fields MSPDI carries; an import changes only these. */
export const MSPDI_FIELDS = { task: ['name', 'type', 'parent', 'start', 'duration', 'durationUnit', 'progress', 'owner', 'constraint', 'deadline', 'mode', 'order'], link: ['source', 'target', 'type', 'lag', 'lagUnit'] };

/** Escapes text for XML element content. */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Reverses XML escaping, including the entities Project writes. */
const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const LINK_TYPE: Record<Link['type'], number> = { FF: 0, FS: 1, SF: 2, SS: 3 };
const LINK_FROM = ['FF', 'FS', 'SF', 'SS'] as const;
const CONSTRAINT: Record<ConstraintType, number> = { ASAP: 0, MSO: 2, MFO: 3, SNET: 4, SNLT: 5, FNET: 6, FNLT: 7 };
const CONSTRAINT_FROM: Record<number, ConstraintType> = { 0: 'ASAP', 2: 'MSO', 3: 'MFO', 4: 'SNET', 5: 'SNLT', 6: 'FNET', 7: 'FNLT' };

/**
 * Writes the roadmap as Microsoft Project XML (MSPDI): tasks in outline order with WBS, dates, durations, progress,
 * milestones and predecessors. Ids and owners round-trip through the Text1 and Text2 fields.
 */
export function toMsProject(doc: RoadmapDocument): string {
  const p = place(doc);
  const hpd = doc.calendars?.find((c) => c.id === doc.roadmap.defaultCalendar)?.hoursPerDay ?? 8;
  const kids = new Map<string | null, Task[]>();
  doc.tasks.forEach((t) => (kids.get(t.parent) ?? kids.set(t.parent, []).get(t.parent)!).push(t));
  for (const k of kids.values()) k.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const ordered: { t: Task; level: number; wbs: string }[] = [];
  const visit = (parent: string | null, level: number, prefix: string) => (kids.get(parent) ?? []).forEach((t, i) => {
    const wbs = prefix ? `${prefix}.${i + 1}` : String(i + 1);
    ordered.push({ t, level, wbs }); visit(t.id, level + 1, wbs);
  });
  visit(null, 1, '');
  const uid = new Map(ordered.map((o, i) => [o.t.id, i + 1]));
  const preds = new Map<string, Link[]>();
  for (const l of doc.links) (preds.get(l.target) ?? preds.set(l.target, []).get(l.target)!).push(l);
  // Whole minutes, so fractional hours (1.5 h, or a 7.5-hour day) survive the round trip.
  const dur = (hours: number) => { const min = Math.round(hours * 60); return `PT${Math.floor(min / 60)}H${min % 60}M0S`; };
  const tasks = ordered.map(({ t, level, wbs }) => {
    const pl = p.byId.get(t.id)!;
    const summary = (kids.get(t.id)?.length ?? 0) > 0 || t.type === 'summary';
    const hours = t.type === 'milestone' ? 0 : t.durationUnit === 'hour' ? t.duration ?? 0 : (pl.duration ?? t.duration ?? 1) * hpd;
    const lines = [
      `<UID>${uid.get(t.id)}</UID>`, `<ID>${uid.get(t.id)}</ID>`, `<Name>${esc(t.name)}</Name>`, `<OutlineLevel>${level}</OutlineLevel>`, `<WBS>${wbs}</WBS>`,
      `<Summary>${summary ? 1 : 0}</Summary>`, `<Milestone>${t.type === 'milestone' ? 1 : 0}</Milestone>`, `<Manual>${t.mode === 'manual' ? 1 : 0}</Manual>`,
      `<Active>${t.mode === 'inactive' ? 0 : 1}</Active>`,
    ];
    if (pl.scheduled) lines.push(`<Start>${fromDay(pl.start!)}T08:00:00</Start>`, `<Finish>${fromDay(pl.end!)}T${t.type === 'milestone' ? '08' : '17'}:00:00</Finish>`);
    // A task without a duration stays without one (it is unscheduled in the roadmap).
    if (!summary && (t.duration !== undefined || t.type === 'milestone')) lines.push(`<Duration>${dur(hours)}</Duration>`, `<DurationFormat>${t.durationUnit === 'hour' ? 5 : 7}</DurationFormat>`);
    lines.push(`<PercentComplete>${Math.round((t.progress ?? 0) * 100)}</PercentComplete>`);
    if (t.constraint) lines.push(`<ConstraintType>${CONSTRAINT[t.constraint.type]}</ConstraintType>`, ...(t.constraint.date ? [`<ConstraintDate>${t.constraint.date}T08:00:00</ConstraintDate>`] : []));
    if (t.deadline) lines.push(`<Deadline>${t.deadline}T17:00:00</Deadline>`);
    lines.push(`<Text1>${esc(t.id)}</Text1>`);
    if (t.owner) lines.push(`<Text2>${esc(t.owner)}</Text2>`);
    for (const l of preds.get(t.id) ?? []) {
      // Lag in tenths of a minute; LagFormat 7 = days, 5 = hours.
      const lagMin = (l.lag ?? 0) * (l.lagUnit === 'hour' ? 60 : hpd * 60);
      lines.push(`<PredecessorLink><PredecessorUID>${uid.get(l.source)}</PredecessorUID><Type>${LINK_TYPE[l.type]}</Type><LinkLag>${Math.round(lagMin * 10)}</LinkLag><LagFormat>${l.lagUnit === 'hour' ? 5 : 7}</LagFormat></PredecessorLink>`);
    }
    return `<Task>${lines.join('')}</Task>`;
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Project xmlns="http://schemas.microsoft.com/project">`
    + `<Name>${esc(doc.roadmap.name)}</Name><Title>${esc(doc.roadmap.name)}</Title><StartDate>${doc.roadmap.start}T08:00:00</StartDate>`
    + `<MinutesPerDay>${hpd * 60}</MinutesPerDay><DefaultStartTime>08:00:00</DefaultStartTime>`
    + `<Tasks>${tasks.join('\n')}</Tasks></Project>\n`;
}

/** The trimmed text of the first `<name>` element, or undefined. */
const tag = (xml: string, name: string) => { const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml); return m ? unesc(m[1]!.trim()) : undefined; };
/** ISO 8601 duration (PT16H0M0S, P2D…) in hours. */
const hoursOf = (d: string, hpd: number) => {
  const m = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(d);
  return m ? +(m[1] ?? 0) * hpd + +(m[2] ?? 0) + +(m[3] ?? 0) / 60 + +(m[4] ?? 0) / 3600 : NaN;
};

/** The text between the first `<name>` and the last `</name>`, or '' (indexOf, so its time is linear in the input). */
function between(xml: string, name: string): string {
  const a = xml.indexOf(`<${name}>`), b = xml.lastIndexOf(`</${name}>`);
  return a < 0 || b < a ? '' : xml.slice(a + name.length + 2, b);
}
/**
 * The contents of each `<name>…</name>` element in order (not nested). Scans with indexOf rather than a lazy
 * regular expression, so a hostile file cannot make it take quadratic time.
 */
function elements(xml: string, name: string): string[] {
  const open = `<${name}>`, close = `</${name}>`, out: string[] = [];
  for (let i = xml.indexOf(open); i >= 0; ) {
    const j = xml.indexOf(close, i + open.length);
    if (j < 0) break;
    out.push(xml.slice(i + open.length, j));
    i = xml.indexOf(open, j + close.length);
  }
  return out;
}

/** The roadmap read from a Project file, with warnings, or the reasons it was refused. */
export type MsImport = { ok: true; doc: RoadmapDocument; warnings: Issue[] } | { ok: false; errors: Issue[] };

/**
 * Reads Microsoft Project XML (MSPDI) into a roadmap: outline levels become the tree, durations are converted with
 * the file's minutes per day, and predecessors become links. `base` supplies what the file does not (roadmap id…).
 */
export function fromMsProject(xml: string, base?: Partial<RoadmapDocument>): MsImport {
  if (!/<Project[\s>]/.test(xml)) return { ok: false, errors: [{ path: 'file', message: 'not a Microsoft Project XML file' }] };
  const hpd = +(tag(xml, 'MinutesPerDay') ?? 480) / 60 || 8;
  const warnings: Issue[] = [];
  const blocks = elements(between(xml, 'Tasks'), 'Task');
  const rows = blocks.map((b) => ({ b, uid: tag(b, 'UID')!, level: +(tag(b, 'OutlineLevel') ?? 1) })).filter((r) => r.uid && r.uid !== '0' && r.level > 0 && tag(r.b, 'Name') !== undefined);
  const idOf = new Map(rows.map((r) => [r.uid, tag(r.b, 'Text1') || `t${r.uid}`]));
  const tasks: Task[] = [], links: Link[] = [];
  const stack: string[] = [];
  rows.forEach((r, i) => {
    const id = idOf.get(r.uid)!;
    stack.length = r.level - 1;
    const parent = stack[r.level - 2] ?? null;
    stack[r.level - 1] = id;
    const summary = tag(r.b, 'Summary') === '1';
    const milestone = tag(r.b, 'Milestone') === '1';
    const t: Task = { id, name: tag(r.b, 'Name') ?? '', type: summary ? 'summary' : milestone ? 'milestone' : 'task', parent, order: (i + 1) * 1024 };
    const start = tag(r.b, 'Start'); if (start && !summary) t.start = start.slice(0, 10);
    const durTag = tag(r.b, 'Duration');
    if (milestone && durTag !== undefined) t.duration = 0;
    if (!summary && !milestone && durTag !== undefined) {
      const h = hoursOf(durTag, hpd);
      const fmt = tag(r.b, 'DurationFormat');
      if (fmt === '5' || fmt === '6' || Math.abs(h / hpd - Math.round(h / hpd)) > 1e-6) { t.duration = Math.round(h * 100) / 100; t.durationUnit = 'hour'; }
      else t.duration = Math.round(h / hpd);
    }
    const pc = tag(r.b, 'PercentComplete'); if (pc && +pc > 0) t.progress = +pc / 100;
    const ct = CONSTRAINT_FROM[+(tag(r.b, 'ConstraintType') ?? 0)];
    const cd = tag(r.b, 'ConstraintDate');
    if (ct && ct !== 'ASAP') t.constraint = { type: ct, ...(cd ? { date: cd.slice(0, 10) } : {}) };
    const dl = tag(r.b, 'Deadline'); if (dl && !/^1984|NA/.test(dl)) t.deadline = dl.slice(0, 10);
    if (tag(r.b, 'Manual') === '1') t.mode = 'manual';
    if (tag(r.b, 'Active') === '0') t.mode = 'inactive';
    const owner = tag(r.b, 'Text2'); if (owner) t.owner = owner;
    tasks.push(t);
    for (const pm of elements(r.b, 'PredecessorLink')) {
      const src = idOf.get(tag(pm, 'PredecessorUID') ?? '');
      if (!src) { warnings.push({ path: `task ${t.name}`, message: 'a predecessor is not in the file and was left out' }); continue; }
      const lagTenths = +(tag(pm, 'LinkLag') ?? 0), lf = tag(pm, 'LagFormat');
      const l: Link = { id: `l-${src}-${id}`, source: src, target: id, type: LINK_FROM[+(tag(pm, 'Type') ?? 1)] ?? 'FS' };
      if (lagTenths) { if (lf === '5' || lf === '6') { l.lag = lagTenths / 600; l.lagUnit = 'hour'; } else l.lag = lagTenths / 600 / hpd; }
      links.push(l);
    }
  });
  const name = tag(xml, 'Title') ?? tag(xml, 'Name') ?? 'Imported project';
  const startIso = (tag(xml, 'StartDate') ?? tasks.find((t) => t.start)?.start ?? fromDay(toDay(new Date().toISOString().slice(0, 10)))).slice(0, 10);
  const doc: RoadmapDocument = {
    contract: 'gantt-roadmap/1', ...base,
    roadmap: { id: base?.roadmap?.id ?? 'imported', name: base?.roadmap?.name ?? name, version: base?.roadmap?.version ?? 1, timeZone: base?.roadmap?.timeZone ?? 'UTC', start: base?.roadmap?.start ?? startIso, ...(base?.roadmap?.defaultCalendar ? { defaultCalendar: base.roadmap.defaultCalendar } : {}) },
    tasks, links,
  } as RoadmapDocument;
  delete (doc as { baselines?: unknown }).baselines; delete (doc as { proposals?: unknown }).proposals;
  const v = validate(doc);
  if (!v.ok) return { ok: false, errors: v.errors };
  return { ok: true, doc, warnings: [...warnings, ...v.warnings] };
}
