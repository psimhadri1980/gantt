# @gantt/state

The view's logic without React: everything that decides what is drawn and how changes flow.

| File | Contents |
| --- | --- |
| `layout.ts` | `buildModel` (indexes, tree, WBS codes), `layoutRows` (visible rows after collapsing, lanes, heights), `rowAt` |
| `scale.ts` | Zoom levels (`ZOOM_LEVELS`, `HOUR_ZOOM`), `xOf`/`dayAt`, `ticks` (scale labels, ISO weeks, `weekStart`), `localeWeekStart` |
| `operations.ts` | The operation types and `OperationPipeline`: interception, authorization, application, inverse operations for undo |
| `tree.ts` | Tree edits as operations: move, indent, outdent, copy, paste, duplicate, new task |
| `view.ts` | Sorting, filtering, grouping and find (`viewModel`, `findTasks`); saved views |
| `links.ts` | Connector paths between bars for each link type |
| `selection.ts` | Selection targets (row, bar, link) |
| `format.ts` | Cached date formatters |

Every change to a roadmap is a `DataOperation` (`task.create`, `task.update`, `link.delete`, `batch`, …) and every
change to the view a `ViewOperation` (zoom, expand, select, scroll). `OperationPipeline.run` passes each one through
the host's `beforeOperation`, then `authorize`, applies it and returns the operations that undo it. The UI and the
host's API use the same pipeline, so permissions and undo behave identically for both.
