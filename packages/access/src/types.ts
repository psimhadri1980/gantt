/**
 * Access-control types (section L): permissions, subjects, rules with scopes and conditions, and decisions.
 */
/** Permission vocabulary (plan section 3). */
export const PERMISSIONS = [
  'view', 'view.fields', 'view.baselines', 'view.resources', 'view.history',
  'task.create', 'task.modify.dates', 'task.modify.progress', 'task.modify.fields', 'task.reorder', 'task.delete',
  'link.create', 'link.modify', 'link.delete',
  'schedule.run', 'constraint.edit', 'calendar.edit',
  'proposal.create', 'proposal.edit', 'proposal.refresh', 'proposal.submit', 'proposal.review', 'proposal.approve',
  'proposal.return', 'proposal.reject', 'proposal.discard', 'proposal.viewOthers',
  'resource.assign', 'resource.edit',
  'export', 'import', 'baseline.save',
] as const;
/** One permission name, such as 'view', 'task.modify' or 'proposal.approve'. */
export type Permission = (typeof PERMISSIONS)[number];

/** Who is asking: a user id with the roles and groups that rules can match. */
export interface Subject { id: string; roles?: string[]; groups?: string[] }

/** Where a rule applies: projects, and tasks by id, group, type, owner or kind. Empty means everywhere. */
export interface RuleScope {
  projects?: string[];
  tasks?: { ids?: string[]; groups?: string[]; types?: string[]; owners?: string[]; kinds?: string[] };
  /** 'own': Proposals owned by the subject; 'any'; or a list of Proposal ids. */
  proposals?: 'own' | 'any' | string[];
}

/**
 * One access rule: allow or deny some permissions, for some roles, within a scope, optionally under a condition.
 */
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

/** Serialisable rules, shared by the server and the component (L10). */
export interface AccessRules { subject: Subject; rules: Rule[] }

/** What a request is about. Every part is optional; a rule's scope only matches parts that are present. */
export interface AccessContext {
  project?: string;
  task?: { id: string; type?: string; owner?: string; kind?: string; group?: string; parent?: string | null };
  proposal?: { id: string; owner: string };
  field?: string;
}

/** A host-provided check for rules that depend on the data (for example "only before the freeze date"). */
export type Condition = (ctx: AccessContext & { subject: Subject }) => boolean;

/** The answer to "may this happen?", with the reason when it may not. */
export interface Decision { allowed: boolean; reason?: string }
