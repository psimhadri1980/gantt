# @gantt/interchange

Import and export: CSV, Excel (.xlsx) and Microsoft Project XML, with no third-party libraries.

Generated from the TypeScript sources by `pnpm run docs:api`; do not edit by hand.

21 exports.

## COLUMNS

*const* · [packages/interchange/src/table.ts](../../packages/interchange/src/table.ts)

The task table shared by CSV and Excel (I1, I3): one row per task, dependencies in a "predecessors" cell
such as "t2FS; t3SS+2". Every field this table carries survives export followed by import.

```ts
const COLUMNS: readonly ['id', 'name', 'type', 'parent', 'kind', 'start', 'duration', 'durationUnit', 'progress', 'owner', 'predecessors', 'constraint', 'constraintDate', 'deadline', 'mode']
```

## Column

*type* · [packages/interchange/src/table.ts](../../packages/interchange/src/table.ts)

One column name of the import/export table.

```ts
export type Column = (typeof COLUMNS)[number];
```

## ImportResult

*type* · [packages/interchange/src/table.ts](../../packages/interchange/src/table.ts)

The roadmap read from a table, with warnings, or the reasons it was refused.

```ts
export type ImportResult = { ok: true; doc: RoadmapDocument; warnings: Issue[] } | { ok: false; errors: Issue[] };
```

## MSPDI_FIELDS

*const* · [packages/interchange/src/msproject.ts](../../packages/interchange/src/msproject.ts)

Task and link fields MSPDI carries; an import changes only these.

```ts
const MSPDI_FIELDS: { task: string[]; link: string[]; }
```

## MsImport

*type* · [packages/interchange/src/msproject.ts](../../packages/interchange/src/msproject.ts)

The roadmap read from a Project file, with warnings, or the reasons it was refused.

```ts
export type MsImport = { ok: true; doc: RoadmapDocument; warnings: Issue[] } | { ok: false; errors: Issue[] };
```

## TABLE_FIELDS

*const* · [packages/interchange/src/table.ts](../../packages/interchange/src/table.ts)

Task and link fields the table carries; an import changes only these (others are kept as they are).

```ts
const TABLE_FIELDS: { task: string[]; link: string[]; }
```

## crc32

*function* · [packages/interchange/src/zip.ts](../../packages/interchange/src/zip.ts)

The CRC-32 checksum of the bytes (the checksum ZIP stores for every file).

```ts
export function crc32(b: Uint8Array): number
```

## docFromTable

*function* · [packages/interchange/src/table.ts](../../packages/interchange/src/table.ts)

Builds a roadmap from a table (I1). `base` supplies the roadmap header, calendars and resources; the
tasks and links come from the table. The result is validated like any loaded file; problems name the row.

```ts
export function docFromTable(table: string[][], base: Pick<RoadmapDocument, 'contract' | 'roadmap'> & Partial<RoadmapDocument>): ImportResult
```

## fromCsv

*const* · [packages/interchange/src/csv.ts](../../packages/interchange/src/csv.ts)

Reads CSV text into a roadmap.

```ts
const fromCsv: (text: string, base: Parameters<typeof docFromTable>[1]) => ImportResult
```

## fromMsProject

*function* · [packages/interchange/src/msproject.ts](../../packages/interchange/src/msproject.ts)

Reads Microsoft Project XML (MSPDI) into a roadmap: outline levels become the tree, durations are converted with
the file's minutes per day, and predecessors become links. `base` supplies what the file does not (roadmap id…).

```ts
export function fromMsProject(xml: string, base?: Partial<RoadmapDocument>): MsImport
```

## fromXlsx

*function* · [packages/interchange/src/xlsx.ts](../../packages/interchange/src/xlsx.ts)

Reads an Excel workbook into a roadmap; any failure to read the file is returned as an error, not thrown.

```ts
export async function fromXlsx(bytes: Uint8Array, base: Parameters<typeof docFromTable>[1]): Promise<ImportResult>
```

## readCsv

*function* · [packages/interchange/src/csv.ts](../../packages/interchange/src/csv.ts)

Reads CSV (comma or semicolon separated, as spreadsheets in some locales write it).

```ts
export function readCsv(text: string): string[][]
```

## readXlsx

*function* · [packages/interchange/src/xlsx.ts](../../packages/interchange/src/xlsx.ts)

Reads the first sheet of a workbook as text cells, including shared strings and dates stored as serial numbers.

```ts
export async function readXlsx(bytes: Uint8Array): Promise<string[][]>
```

## readZip

*function* · [packages/interchange/src/zip.ts](../../packages/interchange/src/zip.ts)

Reads a ZIP archive into a map of file name to bytes. Handles stored and deflated entries; finds the entries
through the central directory at the end of the file.

```ts
export async function readZip(bytes: Uint8Array): Promise<Map<string, Uint8Array>>
```

## tableFromDoc

*function* · [packages/interchange/src/table.ts](../../packages/interchange/src/table.ts)

The roadmap as a table: a header row of `COLUMNS`, then one row per task in tree order with its predecessors
written like Project does ("3FS+2d").

```ts
export function tableFromDoc(doc: RoadmapDocument): string[][]
```

## toCsv

*const* · [packages/interchange/src/csv.ts](../../packages/interchange/src/csv.ts)

The roadmap as CSV text. Starts with a byte-order mark so Excel reads it as UTF-8.

```ts
const toCsv: (doc: RoadmapDocument) => string
```

## toMsProject

*function* · [packages/interchange/src/msproject.ts](../../packages/interchange/src/msproject.ts)

Writes the roadmap as Microsoft Project XML (MSPDI): tasks in outline order with WBS, dates, durations, progress,
milestones and predecessors. Ids and owners round-trip through the Text1 and Text2 fields.

```ts
export function toMsProject(doc: RoadmapDocument): string
```

## toXlsx

*const* · [packages/interchange/src/xlsx.ts](../../packages/interchange/src/xlsx.ts)

The roadmap as an Excel workbook (bytes of an .xlsx file).

```ts
const toXlsx: (doc: RoadmapDocument) => Uint8Array<ArrayBufferLike>
```

## writeCsv

*function* · [packages/interchange/src/csv.ts](../../packages/interchange/src/csv.ts)

RFC 4180 CSV: fields with commas, quotes or line breaks are quoted; quotes doubled.

```ts
export function writeCsv(rows: string[][]): string
```

## writeXlsx

*function* · [packages/interchange/src/xlsx.ts](../../packages/interchange/src/xlsx.ts)

A workbook with one sheet, "Tasks" (I3). Numbers are numbers, everything else inline text.

```ts
export function writeXlsx(rows: string[][], sheet = 'Tasks'): Uint8Array
```

## writeZip

*function* · [packages/interchange/src/zip.ts](../../packages/interchange/src/zip.ts)

Writes a ZIP archive with the files stored uncompressed (enough for an .xlsx, which Excel opens either way).

```ts
export function writeZip(files: { name: string; data: Uint8Array | string }[]): Uint8Array
```
