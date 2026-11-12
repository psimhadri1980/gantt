# @gantt/access

Who may do what. The host supplies rules; this package answers every permission question with them.

| File | Contents |
| --- | --- |
| `types.ts` | `PERMISSIONS`, `Subject`, `Rule` (allow or deny, roles, scope, condition), `AccessRules`, `Decision` |
| `evaluate.ts` | `AccessEvaluator`: `can(permission, context)`, `check` (with the reason), `canViewField`; results are cached |
| `document.ts` | `filterDocument` (only what the user may see), `checkChange` (may this change be made?), `mergeAccess`, `fullAccess` |

A request is allowed when at least one allow rule matches and no deny rule does; rule order never matters, and
no rules means no access. Rules can be scoped to projects and to tasks by id, group, type, owner or kind, can
restrict individual fields (`view.fields`, `task.modify.fields`, with a `fields` list), and can name a host-provided condition for rules that
depend on the data.

The same evaluator runs in the browser (to hide controls and explain refusals) and in the service (to enforce
them), so the two always agree. Rule format and examples: section 3 of the feature plan.
