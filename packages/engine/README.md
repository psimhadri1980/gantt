# @gantt/engine

Scheduling and placement, with no UI and no dependencies besides the contract. It runs in the browser's
engine worker, on the server and in tests alike.

| File | Contents |
| --- | --- |
| `calendar.ts` | Day numbers (`toDay`, `fromDay`), `WorkCalendar` (working weekdays and holidays), `spanOf` (where a task's work falls, including hours and splits) |
| `schedule.ts` | `place(doc)`: where each bar is drawn, from the stored dates; summaries span their children |
| `scheduler.ts` | `schedule(doc)`: forward and backward pass over FS/SS/FF/SF links with lag, constraints, deadlines, the critical path, slack, cycles, and `fixesFor(issue)` suggestions |
| `load.ts` | `resourceLoad` (demand against capacity per period), `periods`, `levelResources` (delays tasks to remove over-allocation) |
| `tracking.ts` | `takeBaseline`, `progressLine` (ahead/behind on a status date), `sCurve` (planned, actual and baseline work over time) |
| `transfer.ts` | `placeCompact` / `expandPlacement`: a placement packed into typed arrays to move between threads without copying |

Placement and scheduling are separate on purpose: placement draws what is stored, the scheduler computes what
the links and constraints require. Applying the schedule (the toolbar's Schedule button) turns the scheduler's
`changes` into ordinary edits, so it can be reviewed and undone like any other change.

All day arithmetic uses whole UTC days, so time zones and daylight-saving changes never shift a date.
