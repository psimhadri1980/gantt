# @gantt/interchange

Import and export without third-party libraries.

| File | Contents |
| --- | --- |
| `table.ts` | The task table shared by CSV and Excel: `COLUMNS`, `tableFromDoc`, `docFromTable`; predecessors written like Project ("3FS+2d") |
| `csv.ts` | `toCsv`, `fromCsv` (RFC 4180, UTF-8 with a byte-order mark for Excel) |
| `xlsx.ts` | `toXlsx`, `fromXlsx`: a one-sheet workbook |
| `zip.ts` | Minimal ZIP writing (stored) and reading (stored and deflated, via `DecompressionStream`) |
| `msproject.ts` | `toMsProject`, `fromMsProject`: Microsoft Project XML (MSPDI) with outline, dates, durations, milestones and predecessors |

An import only changes the fields its format carries (`TABLE_FIELDS`, `MSPDI_FIELDS`); everything else on an
existing task is kept. In the component an import becomes ordinary operations, so it is permission-checked,
undoable, and lands in a Proposal in managed mode.
