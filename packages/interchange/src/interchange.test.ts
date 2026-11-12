import { describe, expect, it } from 'vitest';
import type { Link, RoadmapDocument, Task } from '@gantt/contract';
import { loadMock } from '../../mock/src/index.ts';
import small from '../../mock/src/samples/small.json';
import { fromCsv, fromMsProject, fromXlsx, readCsv, readXlsx, toCsv, toMsProject, toXlsx, writeCsv } from './index.ts';

const sample = (() => { const r = loadMock(small); if (!r.ok) throw new Error('sample'); return r.doc; })();
// Plus what the samples lack: hours, lag in hours, a constraint, manual mode, a quoted name.
const rich: RoadmapDocument = {
  ...sample,
  tasks: [...sample.tasks.map((t) => (t.id === 't8' ? { ...t, constraint: { type: 'SNET' as const, date: '2026-11-27' } } : t.id === 't9' ? { ...t, mode: 'manual' as const } : t)),
    { id: 'h1', name: 'Rehearsal, "dry run"', type: 'task', parent: 't15', start: '2026-12-14', duration: 4, durationUnit: 'hour', progress: 0.25 }],
  links: [...sample.links, { id: 'lh', source: 't16', target: 'h1', type: 'SS', lag: 2, lagUnit: 'hour' }],
};
const base = { contract: rich.contract, roadmap: rich.roadmap, calendars: rich.calendars };

/** The fields a format carries, in a comparable form. */
const tasksOf = (d: RoadmapDocument, fields: (keyof Task)[]) => Object.fromEntries(d.tasks.map((t) => [t.id, Object.fromEntries(fields.map((f) => [f, (t as Record<string, unknown>)[f] ?? null]))]));
const linksOf = (d: RoadmapDocument) => d.links.map((l: Link) => `${l.source}>${l.target} ${l.type} ${l.lag ?? 0}${l.lagUnit ?? ''}`).sort();
const siblingOrder = (d: RoadmapDocument) => { const m: Record<string, string[]> = {}; for (const t of [...d.tasks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) (m[t.parent ?? ''] ??= []).push(t.id); return m; };
const TABLE: (keyof Task)[] = ['name', 'type', 'parent', 'kind', 'start', 'duration', 'durationUnit', 'progress', 'owner', 'constraint', 'deadline', 'mode'];

describe('CSV (I1)', () => {
  it('quotes what needs quoting and reads it back', () => {
    const rows = [['a', 'b,c', 'say "hi"', 'two\nlines']];
    expect(readCsv(writeCsv(rows))).toEqual(rows);
    expect(readCsv('name;start\nX;2026-11-02\n')).toEqual([['name', 'start'], ['X', '2026-11-02']]);
  });
  it('a roadmap survives export and import without loss', () => {
    const r = fromCsv(toCsv(rich), base);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(tasksOf(r.doc, TABLE)).toEqual(tasksOf(rich, TABLE));
    expect(linksOf(r.doc)).toEqual(linksOf(rich));
    expect(siblingOrder(r.doc)).toEqual(siblingOrder(rich));
  });
  it('accepts common header names and reports bad rows by number', () => {
    const ok = fromCsv('Task Name,Start Date,Days,% Complete\nPlan,2026-11-02,3,50%\n', base);
    expect(ok.ok && ok.doc.tasks[0]).toMatchObject({ name: 'Plan', start: '2026-11-02', duration: 3, progress: 0.5 });
    const bad = fromCsv('name,duration\nPlan,three\n', base);
    expect(!bad.ok && bad.errors[0]).toMatchObject({ path: 'row 2.duration' });
  });
});

describe('Excel (I1, I3)', () => {
  it('a roadmap survives export to .xlsx and import without loss', async () => {
    const bytes = toXlsx(rich);
    expect([...bytes.slice(0, 2)]).toEqual([0x50, 0x4b]); // a ZIP archive
    const r = await fromXlsx(bytes, base);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(tasksOf(r.doc, TABLE)).toEqual(tasksOf(rich, TABLE));
    expect(linksOf(r.doc)).toEqual(linksOf(rich));
  });
  it('reads deflated workbooks with shared strings and dates, as spreadsheet programs write them', async () => {
    const { deflateRawSync } = await import('node:zlib');
    const { crc32 } = await import('./zip.ts');
    const files: Record<string, string> = {
      'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
      'xl/sharedStrings.xml': '<sst><si><t>name</t></si><si><t>start</t></si><si><t>Kick-off</t></si></sst>',
      'xl/styles.xml': '<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
      'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" s="1"><v>46328</v></c></row></sheetData></worksheet>',
    };
    // A hand-built ZIP with deflated entries.
    const enc = new TextEncoder(); const parts: Uint8Array[] = []; const cd: Uint8Array[] = []; let off = 0;
    for (const [n, text] of Object.entries(files)) {
      const raw = enc.encode(text), comp = new Uint8Array(deflateRawSync(raw)), name = enc.encode(n);
      const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(8, 8, true); h.setUint32(14, crc32(raw), true); h.setUint32(18, comp.length, true); h.setUint32(22, raw.length, true); h.setUint16(26, name.length, true);
      parts.push(new Uint8Array(h.buffer), name, comp);
      const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(10, 8, true); c.setUint32(20, comp.length, true); c.setUint32(24, raw.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      cd.push(new Uint8Array(c.buffer), name); off += 30 + name.length + comp.length;
    }
    const e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054b50, true); e.setUint16(10, Object.keys(files).length, true); e.setUint32(16, off, true);
    const all = [...parts, ...cd, new Uint8Array(e.buffer)]; const zip = new Uint8Array(all.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of all) { zip.set(p, o); o += p.length; }
    expect(await readXlsx(zip)).toEqual([['name', 'start'], ['Kick-off', '2026-11-02']]);
  });
});

describe('Microsoft Project XML (I4)', () => {
  it('a roadmap survives export and import without loss of what MSPDI carries', () => {
    const xml = toMsProject(rich);
    expect(xml).toContain('<Project xmlns="http://schemas.microsoft.com/project">');
    const r = fromMsProject(xml, { roadmap: rich.roadmap, calendars: rich.calendars });
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const MS: (keyof Task)[] = ['name', 'parent', 'duration', 'durationUnit', 'progress', 'owner', 'constraint', 'deadline', 'mode'];
    // Summaries are computed in Project: their type follows their children, and they carry no start of their own.
    expect(tasksOf(r.doc, MS)).toEqual(tasksOf(rich, MS));
    const starts = (d: RoadmapDocument) => Object.fromEntries(d.tasks.filter((t) => t.type !== 'summary' && t.start).map((t) => [t.id, t.start]));
    expect(starts(r.doc)).toEqual(starts(rich));
    expect(linksOf(r.doc)).toEqual(linksOf(rich));
    expect(siblingOrder(r.doc)).toEqual(siblingOrder(rich));
  });
  it('reads a file Project wrote: no Text1 ids, task 0 is the project summary', () => {
    const xml = `<?xml version="1.0"?><Project xmlns="http://schemas.microsoft.com/project"><Title>Move office</Title><MinutesPerDay>480</MinutesPerDay><Tasks>
      <Task><UID>0</UID><ID>0</ID><Name>Move office</Name><OutlineLevel>0</OutlineLevel><Summary>1</Summary></Task>
      <Task><UID>1</UID><Name>Pack</Name><OutlineLevel>1</OutlineLevel><Start>2026-11-02T08:00:00</Start><Duration>PT16H0M0S</Duration><DurationFormat>7</DurationFormat><PercentComplete>50</PercentComplete></Task>
      <Task><UID>2</UID><Name>Drive</Name><OutlineLevel>1</OutlineLevel><Start>2026-11-04T08:00:00</Start><Duration>PT4H0M0S</Duration><DurationFormat>5</DurationFormat>
        <PredecessorLink><PredecessorUID>1</PredecessorUID><Type>1</Type><LinkLag>4800</LinkLag><LagFormat>7</LagFormat></PredecessorLink></Task>
    </Tasks></Project>`;
    const r = fromMsProject(xml);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.doc.roadmap.name).toBe('Move office');
    expect(r.doc.tasks.map((t) => `${t.id}:${t.duration}${t.durationUnit ?? 'd'}`)).toEqual(['t1:2d', 't2:4hour']);
    expect(r.doc.links).toEqual([{ id: 'l-t1-t2', source: 't1', target: 't2', type: 'FS', lag: 1 }]);
  });
});
