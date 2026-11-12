# @gantt/contract

The roadmap document format every other package reads and writes: contract `gantt-roadmap/1`.

| File | Contents |
| --- | --- |
| `src/types.ts` | TypeScript types: `RoadmapDocument`, `Roadmap`, `Task`, `Link`, `Calendar`, `Resource`, `Proposal`, … |
| `schema/gantt-roadmap-1.schema.json` | The same format as JSON Schema, for other languages and tools |
| `src/validate.ts` | `validate(input)`: checks a document and returns it, or the errors that refuse it |

A document holds the roadmap settings, its tasks (a tree through `parent`, ordered by `order`) and links, and
optionally calendars, resources, baselines, Proposals and access rules. Dates are `YYYY-MM-DD`; durations count
working days, or hours for tasks with `durationUnit: 'hour'`.

Validation refuses wrong types and formats, unknown references (a parent, link end or calendar that does not
exist), parent cycles, link cycles and links between a summary and its own descendant. Unknown fields are
accepted with a warning, so newer documents still load.

The schema and the types are tested against each other (`schema.test.ts`), so they cannot drift apart.
