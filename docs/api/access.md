# @gantt/access

Generated from the TypeScript sources by `npm run docs:api`; do not edit by hand.

17 exports.

## AccessContext

*interface* · [packages/access/src/types.ts](../../packages/access/src/types.ts)

What a request is about. Every part is optional; a rule's scope only matches parts that are present.

```ts
export interface AccessContext {
  project?: string;
  task?: { id: string; type?: string; owner?: string; kind?: string; group?: string; parent?: string | null };
  proposal?: { id: string; owner: string };
  field?: string;
}
```

## AccessEvaluator

*class* · [packages/access/src/evaluate.ts](../../packages/access/src/evaluate.ts)

The one evaluator (L10). A request is allowed when at least one allow rule matches and no deny rule
matches; order does not matter (decision 19). No rules, or no matching allow, means denied (L8).

```ts
export class AccessEvaluator {
  readonly subject: Subject;
  constructor(rules: AccessRules | null | undefined, private readonly conditions: Record<string, Condition> = {})
  get canView(): boolean
  can(permission: Permission, ctx: AccessContext = {}): boolean
  check(permission: Permission, ctx: AccessContext = {}): Decision
  checkAll(permissions: Permission[], ctx: AccessContext = {}): Decision
  canViewField(task: AccessContext['task'], field: string): boolean
  dependsOnTask(permission: Permission): boolean
}
```

## AccessRules

*interface* · [packages/access/src/types.ts](../../packages/access/src/types.ts)

Serialisable rules, shared by the server and the component (L10).

```ts
export interface AccessRules { subject: Subject; rules: Rule[] }
```

## ChangeLike

*interface* · [packages/access/src/document.ts](../../packages/access/src/document.ts)

A change to a roadmap, in the shape of contract ProposalChange.

```ts
export interface ChangeLike { entity: string; op: 'create' | 'update' | 'delete'; id: string; fields?: Record<string, unknown> }
```

## checkChange

*function* · [packages/access/src/document.ts](../../packages/access/src/document.ts)

Whether `ev` allows a change to `task` (the task as it is before the change; undefined for a create).

```ts
export function checkChange(ev: AccessEvaluator, c: ChangeLike, task: TaskLike | undefined, project?: string)
```

## Condition

*type* · [packages/access/src/types.ts](../../packages/access/src/types.ts)

```ts
export type Condition = (ctx: AccessContext & { subject: Subject }) => boolean;
```

## Decision

*interface* · [packages/access/src/types.ts](../../packages/access/src/types.ts)

```ts
export interface Decision { allowed: boolean; reason?: string }
```

## filterDocument

*function* · [packages/access/src/document.ts](../../packages/access/src/document.ts)

What a user may see (L12): tasks without `view` are removed with their whole subtree, links touching a
removed task are removed, and fields outside the user's `view.fields` are stripped. The server applies
this before sending anything; the component applies it again so its view never differs.

```ts
export function filterDocument<D extends DocLike>(doc: D, ev: AccessEvaluator): D
```

## fullAccess

*function* · [packages/access/src/evaluate.ts](../../packages/access/src/evaluate.ts)

Every permission, for one subject. Used for mock mode, where a file without rules means full access (section 3b).

```ts
export function fullAccess(userId = 'mock-user'): AccessRules
```

## mergeAccess

*function* · [packages/access/src/evaluate.ts](../../packages/access/src/evaluate.ts)

Static data and a resolver result (L11): the resolver wins for the fields it returns. `rules` from the
resolver replaces the static list rather than appending, so a resolver can also narrow access.

```ts
export function mergeAccess(staticRules: AccessRules | null | undefined, resolved: Partial<AccessRules> | null | undefined): AccessRules | null
```

## Permission

*type* · [packages/access/src/types.ts](../../packages/access/src/types.ts)

```ts
export type Permission = (typeof PERMISSIONS)[number];
```

## PERMISSIONS

*const* · [packages/access/src/types.ts](../../packages/access/src/types.ts)

Permission vocabulary (plan section 3).

```ts
const PERMISSIONS: readonly ['view', 'view.fields', 'view.baselines', 'view.resources', 'view.history', 'task.create', 'task.modify.dates', 'task.modify.progress', 'task.modify.fields', 'task.reorder', 'task.delete', 'link.create', 'link.modify', 'link.delete', 'schedule.run', 'constraint.edit', 'calendar.edit', 'proposal.create', 'proposal.edit', 'proposal.refresh', 'proposal.submit', 'proposal.review', 'proposal.a …
```

## permissionsForChange

*function* · [packages/access/src/document.ts](../../packages/access/src/document.ts)

The permissions a change needs, each with the field it applies to (L2).

```ts
export function permissionsForChange(c: ChangeLike): { permission: Permission; field?: string }[]
```

## Rule

*interface* · [packages/access/src/types.ts](../../packages/access/src/types.ts)

```ts
export interface Rule {
  effect: 'allow' | 'deny';
  permissions: Permission[];
  /** Limits the rule to subjects with one of these roles or groups. Omitted: applies to the subject. */
  roles?: string[];
  scope?: RuleScope;
  /** Task fields the rule covers (with view.fields or task.modify.*). Omitted: all fields. */
  fields?: string[];
  /** Name of a host-registered condition, evaluated with the request context. */
  condition?: string;
}
```

## RuleScope

*interface* · [packages/access/src/types.ts](../../packages/access/src/types.ts)

```ts
export interface RuleScope {
  projects?: string[];
  tasks?: { ids?: string[]; groups?: string[]; types?: string[]; owners?: string[]; kinds?: string[] };
  /** 'own': Proposals owned by the subject; 'any'; or a list of Proposal ids. */
  proposals?: 'own' | 'any' | string[];
}
```

## Subject

*interface* · [packages/access/src/types.ts](../../packages/access/src/types.ts)

```ts
export interface Subject { id: string; roles?: string[]; groups?: string[] }
```

## taskContext

*const* · [packages/access/src/document.ts](../../packages/access/src/document.ts)

```ts
const taskContext: (t: TaskLike, project?: string) => AccessContext
```
