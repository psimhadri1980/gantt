# @gantt/interchange

Generated from the TypeScript sources by `npm run docs:api`; do not edit by hand.

21 exports.

## Column

*type* · [packages/interchange/src/table.ts](../../packages/interchange/src/table.ts)

```ts
export type Column = (typeof COLUMNS)[number];
```

## COLUMNS

*const* · [packages/interchange/src/table.ts](../../packages/interchange/src/table.ts)

The task table shared by CSV and Excel (I1, I3): one row per task, dependencies in a "predecessors" cell
such as "t2FS; t3SS+2". Every field this table carries survives export followed by import.

```ts
const COLUMNS: readonly ['id', 'name', 'type', 'parent', 'kind', 'start', 'duration', 'durationUnit', 'progress', 'owner', 'predecessors', 'constraint', 'constraintDate', 'deadline', 'mode']
```

## crc32

*function* · [packages/interchange/src/zip.ts](../../packages/interchange/src/zip.ts)

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

```ts
const fromCsv: (text: string, base: Parameters<typeof docFromTable>[1]) => ImportResult
```

## fromMsProject

*function* · [packages/interchange/src/msproject.ts](../../packages/interchange/src/msproject.ts)

```ts
export function fromMsProject(xml: string, base?: Partial<RoadmapDocument>): MsImport
```

## fromXlsx

*function* · [packages/interchange/src/xlsx.ts](../../packages/interchange/src/xlsx.ts)

```ts
export async function fromXlsx(bytes: Uint8Array, base: Parameters<typeof docFromTable>[1]): Promise<ImportResult>
```

## ImportResult

*type* · [packages/interchange/src/table.ts](../../packages/interchange/src/table.ts)

```ts
export type ImportResult = { ok: true; doc: RoadmapDocument; warnings: Issue[] } | { ok: false; errors: Issue[] };
```

## MsImport

*type* · [packages/interchange/src/msproject.ts](../../packages/interchange/src/msproject.ts)

```ts
export type MsImport = { ok: true; doc: RoadmapDocument; warnings: Issue[] } | { ok: false; errors: Issue[] };
```

## MSPDI_FIELDS

*const* · [packages/interchange/src/msproject.ts](../../packages/interchange/src/msproject.ts)

Task and link fields MSPDI carries; an import changes only these.

```ts
const MSPDI_FIELDS: { task: string[]; link: string[]; }
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

```ts
export async function readZip(bytes: Uint8Array): Promise<Map<string, Uint8Array>>
```

## TABLE_FIELDS

*const* · [packages/interchange/src/table.ts](../../packages/interchange/src/table.ts)

Task and link fields the table carries; an import changes only these (others are kept as they are).

```ts
const TABLE_FIELDS: { task: string[]; link: string[]; }
```

## tableFromDoc

*function* · [packages/interchange/src/table.ts](../../packages/interchange/src/table.ts)

```ts
export function tableFromDoc(doc: RoadmapDocument): string[][]
```

## toCsv

*const* · [packages/interchange/src/csv.ts](../../packages/interchange/src/csv.ts)

```ts
const toCsv: (doc: RoadmapDocument) => string
```

## toMsProject

*function* · [packages/interchange/src/msproject.ts](../../packages/interchange/src/msproject.ts)

```ts
export function toMsProject(doc: RoadmapDocument): string
```

## toXlsx

*const* · [packages/interchange/src/xlsx.ts](../../packages/interchange/src/xlsx.ts)

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

```ts
export function writeZip(files: { name: string; data: Uint8Array | string }[]): Uint8Array
```
