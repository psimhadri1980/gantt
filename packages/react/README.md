# @gantt/react

The Gantt component.

```tsx
import { Gantt } from '@gantt/react';

<Gantt data={roadmap} access={rules} onDataChanged={save} />
```

Main props (the [API reference](../../docs/api/react.md) lists all of them):

| Prop | Purpose |
| --- | --- |
| `data` / `backend` | The roadmap to show, or a backend for the Proposal workflow |
| `access`, `resolveAccess`, `conditions` | Access rules (static or fetched) and data-dependent conditions |
| `onDataChanged`, `onOperation`, `onOperationRefused` | Changes as they happen |
| `onBeforeOperation`, `authorize` | Refuse an operation (with a reason shown to the user) |
| `readOnly`, `saveState` | Read-only mode; the host's save status shown in the toolbar |
| `zoom`, `zoomLevels`, `scaleRange`, `markers`, `today` | Time scale |
| `columns`, `barTemplate`, `tooltipTemplate`, `kinds`, `toolbar` | Customisation |
| `view`, `savedViews` | Sorting, filtering, grouping and saved views (controlled or not) |
| `locale`, `messages`, `dir`, `weekStart` | Language, right-to-left layout and the first day of the week |
| `loadChildren` | Load a summary's children when it is expanded |
| `backlog`, `onExport`, `ssr` | Backlog, export hook, server rendering |

The ref (`GanttHandle`) offers `run(operation)`, `getData`, `getSelection`, `scrollToTask`, `scrollToToday`, `fit`,
`undo` and `redo`.

## How it is built

| File | Contents |
| --- | --- |
| `GanttRoot.tsx` | Public `<Gantt>`: access resolution, data mode or the Proposal workflow over a backend |
| `Gantt.tsx` | `CoreGantt` (working document, operation pipeline, undo) and `GanttView` (toolbar, grid, timeline, links, interaction) |
| `engineClient.ts`, `engine.worker.ts` | Placement and scheduling in a Web Worker, with a main-thread fallback |
| `grid.tsx`, `Details.tsx`, `drag.ts`, `menu.tsx`, `viewtools.tsx` | Tree grid, details panel, pointer dragging, context menus, view tools |
| `together.tsx` | Proposal list, concurrent changes and refresh dialogs |
| `resources.tsx`, `tracking.tsx` | Resource load and backlog; S-curve and progress line |
| `exporters.ts` | PNG/PDF rendering and turning imported files into operations |
| `i18n.ts`, `messages.de.ts` | All texts (English defaults), German |
| `gantt.css` | Styles; colours are CSS custom properties (`--gx-*`) with light and dark sets |

Performance: rows and bars are rendered in blocks for the visible part only; a drag changes element styles
directly and renders once on release; placement runs off the main thread.
