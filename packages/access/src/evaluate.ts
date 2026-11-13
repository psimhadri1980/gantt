import { PERMISSIONS, type AccessContext, type AccessRules, type Condition, type Decision, type Permission, type Rule, type Subject } from './types.ts';

/**
 * The one evaluator (L10). A request is allowed when at least one allow rule matches and no deny rule
 * matches; order does not matter (decision 19). No rules, or no matching allow, means denied (L8).
 */
export class AccessEvaluator {
  readonly subject: Subject;
  private readonly rules: Rule[];
  private readonly cache = new Map<string, boolean>();

  constructor(rules: AccessRules | null | undefined, private readonly conditions: Record<string, Condition> = {}) {
    this.subject = rules?.subject ?? { id: '' };
    this.rules = (rules?.rules ?? []).filter((r) => appliesToSubject(r, this.subject));
  }

  /** True when the configuration grants `view` at all; without it nothing is fetched or rendered (L6). */
  get canView(): boolean { return this.can('view'); }

  /**
   * True when the subject has `permission` in this context: at least one matching allow rule and no matching deny.
   */
  can(permission: Permission, ctx: AccessContext = {}): boolean {
    // Cached per task, Proposal and field (L13). Rules with conditions are dynamic and skip the cache.
    const t = ctx.task, pr = ctx.proposal;
    const key = `${permission}|${ctx.project ?? ''}|${t ? `${t.id}:${t.type ?? ''}:${t.owner ?? ''}:${t.kind ?? ''}:${t.group ?? ''}` : ''}|${pr ? `${pr.id}:${pr.owner}` : ''}|${ctx.field ?? ''}`;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    let allow = false, cacheable = true;
    for (const r of this.rules) {
      if (!r.permissions.includes(permission)) continue;
      if (!this.matches(r, ctx)) continue;
      if (r.condition) {
        cacheable = false;
        const fn = this.conditions[r.condition];
        if (!fn || !fn({ ...ctx, subject: this.subject })) continue; // an unknown condition never matches
      }
      if (r.effect === 'deny') { this.store(key, false, cacheable); return false; }
      allow = true;
    }
    this.store(key, allow, cacheable);
    return allow;
  }

  /** A decision with the reason, for explained controls (F14) and denial events (L7). */
  check(permission: Permission, ctx: AccessContext = {}): Decision {
    if (this.can(permission, ctx)) return { allowed: true };
    const what = ctx.field ? ` for the field “${ctx.field}”` : '';
    return { allowed: false, reason: `Missing permission: ${permission}${what}` };
  }

  /** Every permission in the list, with the first missing one as the reason. */
  checkAll(permissions: Permission[], ctx: AccessContext = {}): Decision {
    for (const p of permissions) { const d = this.check(p, ctx); if (!d.allowed) return d; }
    return { allowed: true };
  }

  /**
   * Whether a task field may be seen. `view` on the task is required; when any `view.fields` rule exists,
   * fields outside its lists are hidden. Identity and structure fields are always visible.
   */
  canViewField(task: AccessContext['task'], field: string): boolean {
    if (ALWAYS_VISIBLE.has(field)) return true;
    if (!this.hasFieldRules()) return true;
    // When no field rule depends on the task, the answer is the same for every task (L13).
    if (!this.dependsOnTask('view.fields')) return this.can('view.fields', { field });
    return this.can('view.fields', { task, field });
  }

  /**
   * Whether any rule for a permission looks at the task (a task scope or a condition). When none does,
   * one decision covers every task, which keeps large charts fast (L13).
   */
  dependsOnTask(permission: Permission): boolean {
    let v = this.taskDependence.get(permission);
    if (v === undefined) {
      v = this.rules.some((r) => r.permissions.includes(permission) && (!!r.scope?.tasks || !!r.condition));
      this.taskDependence.set(permission, v);
    }
    return v;
  }
  private taskDependence = new Map<Permission, boolean>();

  private fieldRules: boolean | undefined;
  /** True when any rule restricts individual fields, so field checks can be skipped entirely otherwise. */
  private hasFieldRules() { return (this.fieldRules ??= this.rules.some((r) => r.permissions.includes('view.fields'))); }

  /** Remembers a decision, unless a condition made it depend on the data. */
  private store(key: string, v: boolean, cacheable: boolean) { if (cacheable) this.cache.set(key, v); }

  /**
   * A rule matches a request when every part of its scope that the request mentions fits. When the request
   * does not mention a part the rule is scoped to (for example "may this user view the roadmap at all?",
   * with no task), an allow rule still matches (it grants something there) but a deny rule does not
   * (it only takes away that scoped part).
   */
  private matches(r: Rule, ctx: AccessContext): boolean {
    const deny = r.effect === 'deny';
    if (r.fields) { if (ctx.field === undefined) { if (deny) return false; } else if (!r.fields.includes(ctx.field)) return false; }
    const s = r.scope;
    if (!s) return true;
    if (s.projects) { if (ctx.project === undefined) { if (deny) return false; } else if (!s.projects.includes(ctx.project)) return false; }
    if (s.tasks && !ctx.task && deny) return false;
    if (s.proposals && !ctx.proposal && deny) return false;
    if (s.tasks && ctx.task) {
      const t = s.tasks, k = ctx.task;
      if (t.ids && !t.ids.includes(k.id)) return false;
      if (t.types && !t.types.includes(k.type ?? 'task')) return false;
      if (t.owners && !(k.owner && (t.owners.includes(k.owner) || (t.owners.includes('$self') && k.owner === this.subject.id)))) return false;
      if (t.kinds && !(k.kind && t.kinds.includes(k.kind))) return false;
      // Tasks carry no group yet, so a group-scoped rule fails closed: a deny covers every task, an allow none.
      if (t.groups && !(k.group && t.groups.includes(k.group)) && !deny) return false;
    }
    if (s.proposals && ctx.proposal) {
      if (s.proposals === 'own' && ctx.proposal.owner !== this.subject.id) return false;
      if (Array.isArray(s.proposals) && !s.proposals.includes(ctx.proposal.id)) return false;
    }
    return true;
  }
}

const ALWAYS_VISIBLE = new Set(['id', 'name', 'type', 'parent', 'kind', 'lane', 'hasChildren']);

/**
 * True when the rule applies to the subject: it names none of the subject's roles or groups, or names no roles at all.
 */
function appliesToSubject(r: Rule, s: Subject): boolean {
  if (!r.roles) return true;
  return r.roles.some((x) => s.roles?.includes(x) || s.groups?.includes(x));
}

/**
 * Static data and a resolver result (L11): the resolver wins for the fields it returns. `rules` from the
 * resolver replaces the static list rather than appending, so a resolver can also narrow access.
 */
export function mergeAccess(staticRules: AccessRules | null | undefined, resolved: Partial<AccessRules> | null | undefined): AccessRules | null {
  if (!staticRules && !resolved) return null;
  const subject = resolved?.subject ?? staticRules?.subject;
  if (!subject) return null;
  return { subject, rules: resolved?.rules ?? staticRules?.rules ?? [] };
}

/** Every permission, for one subject. Used for mock mode, where a file without rules means full access (section 3b). */
export function fullAccess(userId = 'mock-user'): AccessRules {
  return { subject: { id: userId }, rules: [{ effect: 'allow', permissions: [...PERMISSIONS] }] };
}
