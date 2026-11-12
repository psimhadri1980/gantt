import type { RoadmapDocument } from '@gantt/contract';
import { docFromTable, tableFromDoc, type ImportResult } from './table.ts';

/** RFC 4180 CSV: fields with commas, quotes or line breaks are quoted; quotes doubled. */
export function writeCsv(rows: string[][]): string {
  return rows.map((r) => r.map((c) => (/[",\r\n;]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\r\n') + '\r\n';
}

/** Reads CSV (comma or semicolon separated, as spreadsheets in some locales write it). */
export function readCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '') /* byte-order mark */;
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (q) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && src[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export const toCsv = (doc: RoadmapDocument) => '﻿' + writeCsv(tableFromDoc(doc));
export const fromCsv = (text: string, base: Parameters<typeof docFromTable>[1]): ImportResult => docFromTable(readCsv(text), base);
