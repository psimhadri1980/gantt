import { describe, expect, it } from 'vitest';
import type { RoadmapDocument } from '@gantt/contract';
import { fromMsProject, readXlsx, toMsProject } from './index.ts';
import { writeZip } from './zip.ts';

// Regression tests for ISSUES.md issues 7–10.
const roadmap = { id: 'r', name: 'r', version: 1, timeZone: 'UTC', start: '2026-11-02' };
const book = (styles: string, strings: string, sheet: string) => writeZip([
  { name: 'xl/workbook.xml', data: '<workbook xmlns:r="r"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>' },
  { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>' },
  { name: 'xl/sharedStrings.xml', data: `<sst>${strings}</sst>` },
  { name: 'xl/styles.xml', data: `<styleSheet><cellXfs>${styles}</cellXfs></styleSheet>` },
  { name: 'xl/worksheets/sheet1.xml', data: `<worksheet><sheetData>${sheet}</sheetData></worksheet>` },
]);

describe('review fixes: Microsoft Project durations (issue 7)', () => {
  const round = (doc: RoadmapDocument) => { const r = fromMsProject(toMsProject(doc), { roadmap: doc.roadmap, calendars: doc.calendars }); if (!r.ok) throw new Error(JSON.stringify(r.errors)); return r.doc.tasks[0]!; };
  it('keeps fractional hours', () => {
    const t = round({ contract: 'gantt-roadmap/1', roadmap, tasks: [{ id: 'a', name: 'A', type: 'task', parent: null, start: '2026-11-02', duration: 1.5, durationUnit: 'hour' }], links: [] });
    expect([t.duration, t.durationUnit]).toEqual([1.5, 'hour']);
  });
  it('keeps whole days on a 7.5-hour calendar', () => {
    const t = round({ contract: 'gantt-roadmap/1', roadmap: { ...roadmap, defaultCalendar: 'c' }, calendars: [{ id: 'c', name: 'C', workingDays: [1, 2, 3, 4, 5], hoursPerDay: 7.5 }],
      tasks: [{ id: 'a', name: 'A', type: 'task', parent: null, start: '2026-11-02', duration: 1 }], links: [] } as RoadmapDocument);
    expect([t.duration, t.durationUnit]).toEqual([1, undefined]);
  });
});

describe('review fixes: Excel import', () => {
  it('maps styles without numFmtId to the right index (issue 8)', async () => {
    const bytes = book('<xf/><xf numFmtId="14"/><xf numFmtId="0"/>', '', '<row r="1"><c r="A1" s="2"><v>5</v></c><c r="B1" s="1"><v>46328</v></c></row>');
    expect(await readXlsx(bytes)).toEqual([['5', '2026-11-02']]);
  });
  it('reads ISO-date cells (issue 9)', async () => {
    const bytes = book('<xf numFmtId="0"/><xf numFmtId="14"/>', '', '<row r="1"><c r="A1" t="d" s="1"><v>2026-01-05T00:00:00</v></c></row>');
    expect(await readXlsx(bytes)).toEqual([['2026-01-05']]);
  });
  it('leaves out phonetic readings (issue 10)', async () => {
    const bytes = book('<xf numFmtId="0"/>', '<si><t>東京</t><rPh sb="0" eb="2"><t>トウキョウ</t></rPh><phoneticPr fontId="1"/></si>', '<row r="1"><c r="A1" t="s"><v>0</v></c></row>');
    expect(await readXlsx(bytes)).toEqual([['東京']]);
  });
});
