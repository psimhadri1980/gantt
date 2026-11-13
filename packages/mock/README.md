# @gantt/mock

Data for the demo, tests and benchmarks.

- `samples/small.json`: a small roadmap with summaries, milestones, links and lanes; `samples/roles.json`:
  access rules for the demo users of the Proposal workflow.
- `generate(options)`: a large roadmap (any number of tasks, nesting depth, link density, lanes), the same for
  the same `seed`.
- `loadMock(text)`: parses and validates a mock file like any import, adding full access when it has no rules.

```bash
ppnpm run generate --tasks 10000 --links 0.5 --depth 3 --lanes 0 > big.json
```
