import type { RoadmapDocument } from '@gantt/contract';
import { docFromTable, tableFromDoc, type ImportResult } from './table.ts';
import { readZip, writeZip } from './zip.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
const colName = (i: number) => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

/** A workbook with one sheet, "Tasks" (I3). Numbers are numbers, everything else inline text. */
export function writeXlsx(rows: string[][], sheet = 'Tasks'): Uint8Array {
  const numeric = (c: string, r: number, i: number) => r > 0 && c !== '' && /^-?\d+(\.\d+)?$/.test(c) && ['duration', 'progress'].includes(rows[0]![i]!);
  const body = rows.map((row, r) => `<row r="${r + 1}">${row.map((c, i) => {
    const ref = `${colName(i)}${r + 1}`;
    if (c === '') return '';
    return numeric(c, r, i) ? `<c r="${ref}"><v>${c}</v></c>` : `<c r="${ref}" t="inlineStr"${r === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${esc(c)}</t></is></c>`;
  }).join('')}</row>`).join('');
  return writeZip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheet)}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/styles.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>' },
    { name: 'xl/worksheets/sheet1.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${body}</sheetData></worksheet>` },
  ]);
}

/** Reads the first sheet of a workbook as text cells, including shared strings and dates stored as serial numbers. */
export async function readXlsx(bytes: Uint8Array): Promise<string[][]> {
  const files = await readZip(bytes);
  const dec = new TextDecoder();
  const get = (n: string) => { const f = files.get(n); return f ? dec.decode(f) : ''; };
  const shared = [...get('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unesc([...m[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('')));
  const rels = get('xl/_rels/workbook.xml.rels');
  const firstSheet = /<sheet\b[^>]*r:id="([^"]+)"/.exec(get('xl/workbook.xml'))?.[1];
  const target = firstSheet ? new RegExp(`Id="${firstSheet}"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Id="${firstSheet}"`).exec(rels) : null;
  const path = target ? 'xl/' + (target[1] ?? target[2])!.replace(/^\/?xl\//, '') : 'xl/worksheets/sheet1.xml';
  const xml = get(path);
  if (!xml) throw new Error('the workbook has no sheet');
  // Which styles are dates (built-in date formats 14–22 and custom ones with d/m/y).
  const styles = get('xl/styles.xml');
  const custom = new Map([...styles.matchAll(/<numFmt numFmtId="(\d+)" formatCode="([^"]*)"/g)].map((m) => [+m[1]!, m[2]!]));
  const xfs = [...(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '').matchAll(/<xf\b[^>]*?numFmtId="(\d+)"/g)].map((m) => +m[1]!);
  const isDate = (s: number) => { const f = xfs[s]; return f !== undefined && ((f >= 14 && f <= 22) || /[dmy]/i.test(custom.get(f)?.replace(/\[[^\]]*\]|"[^"]*"/g, '') ?? '')); };
  const rows: string[][] = [];
  for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cm of rm[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1]!, inner = cm[2] ?? '';
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1]; const i = ref ? colIndex(ref) : row.length;
      const t = /t="(\w+)"/.exec(attrs)?.[1]; const s = +(/s="(\d+)"/.exec(attrs)?.[1] ?? 0);
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let text = '';
      if (t === 's') text = shared[+(v ?? 0)] ?? '';
      else if (t === 'inlineStr') text = unesc([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
      else if (t === 'str' || t === 'b') text = unesc(v ?? '');
      else if (v !== undefined) text = isDate(s) ? new Date(Math.round((+v - 25569) * 86_400_000)).toISOString().slice(0, 10) : v;
      while (row.length < i) row.push('');
      row[i] = text;
    }
    rows.push(row);
  }
  return rows;
}

export const toXlsx = (doc: RoadmapDocument) => writeXlsx(tableFromDoc(doc));
export async function fromXlsx(bytes: Uint8Array, base: Parameters<typeof docFromTable>[1]): Promise<ImportResult> {
  try { return docFromTable(await readXlsx(bytes), base); }
  catch (e) { return { ok: false, errors: [{ path: 'file', message: (e as Error).message }] }; }
}
