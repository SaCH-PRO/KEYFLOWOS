import { Injectable } from '@nestjs/common';
import type { JobRole, Membership, User } from '@prisma/client';
import { FLOW_TOOLS } from '../ai/flow-tool-registry';
import { defaultCrmAccessForLevel } from '../crm/crm-permissions.helper';
import {
  LEVEL_RANK,
  defaultScopesForRole,
  type AccessLevel,
  type CanonicalModule,
} from '../../core/authority/module-vocabulary';

/**
 * Position-scoped governance envelope: what a specific JobRole (position)
 * may use mid-conversation. Derived from the role's `permissions` JSON map
 * ({ module: "read" | "write" | "admin" }) — deny-by-default: modules not
 * granted are outside the position's scope.
 *
 * Kernel K2: the KEY dispatcher calls services directly, with no module-scope
 * check of its own, so a position must never let KEY do what its holder could
 * not do over HTTP with the same scope map, and the union of keys must reach
 * exactly the union of what each key reaches alone.
 *
 * The map is read in two vocabularies (V1-21b-JOBROLE-TOOL-FAMILIES):
 *  - the canonical module vocabulary, which V1-21 holds every JobRole write to
 *    (CANONICAL_MODULE_TOOLS below). A canonical key and its level are matched
 *    EXACTLY, as ModuleScopeGuard reads them (`scopes[module]`, `rankOf`):
 *    `Operations`, `REVENUE` or a level `WRITE` give nothing over HTTP, so they
 *    grant KEY no table tool either (V1-21b review 2 ESC-2).
 *  - the legacy KEY tool-family keys (MODULE_TOOL_FAMILIES), which rows written
 *    before V1-21 still carry, matched case-insensitively as before. A family
 *    grant, and the baseline, reach only tools NO route governs (not in the table,
 *    not GOVERNED_UNGRANTED): a governed tool is reached only through its
 *    governing module, so `finance` no longer reaches the expenses tools nor
 *    `inbox` the operations ones (review 2 ESC-1 / ESC-3).
 * A key present in both (crm, bookings, projects, content) grants the union.
 *
 * Every grant is bounded by the level of the key that makes it, not by the
 * strongest key in the map (V1-21b review SEC-V21b-01 / CR-1): a tool is
 * reachable only through a key whose tier (read 1, write 2, admin 3) covers the
 * tool's risk tier and, for a table tool, whose level reaches the level its
 * routes require (SEC-V21b-03). The canonical `crm` grant is further bounded by
 * the crm_view / crm_edit / crm_delete sub-permissions resolveCrmAccess applies over
 * HTTP (review 2 ESC-4, review 3 IC-1), and never reaches the contact writes whose
 * service bounds the row by visibilityClause (CRM_ROW_VISIBILITY_TOOLS, review 4 DRV-1).
 * A position with no JobRole gets the baseline envelope, never none, and a
 * membership-backed position is bounded by its holder's Membership scopes in the
 * assignment's business, the row HTTP reads (envelopeForPosition, review 3 IC-2,
 * review 4 IC3-1, review 6 INP5-1). A registry tool some
 * pattern matches but no grant covers is
 * listed in `blockedTools`, which `isToolAllowed` checks first, so
 * AiOversightService.evaluate refuses it and the chat never advertises it.
 * `maxRiskTier` stays the strongest key's tier, as before; it is the coarse cap,
 * `blockedTools` the per-grant one.
 */
export interface JobRoleEnvelope {
  jobRoleId: string;
  jobRoleName: string;
  approvedTools: string[];
  blockedTools: string[];
  maxRiskTier: number;
}

/**
 * Legacy (pre-V1-21) permission key → tool-name families it unlocks. These keys are
 * KEY tool families, not canonical modules; V1-21 refuses them on write, and they are
 * kept so that job roles written before V1-21 keep the tools no route governs.
 */
export const MODULE_TOOL_FAMILIES: Readonly<Record<string, readonly string[]>> = {
  finance: ['finance_*', 'expenses_*'],
  crm: ['crm_*'],
  sales: ['crm_*', 'commerce_*'],
  commerce: ['commerce_*'],
  bookings: ['bookings_*', 'calendar_*'],
  calendar: ['calendar_*'],
  projects: ['projects_*', 'time_*'],
  time: ['time_*'],
  marketing: ['marketing_*', 'social_*', 'content_*'],
  social: ['social_*'],
  content: ['content_*'],
  helpdesk: ['helpdesk_*'],
  comms: ['comms_*', 'inbox_*'],
  inbox: ['inbox_*'],
  structure: ['structure_*'],
  hr: ['structure_*'],
  contracts: ['contract_*'],
  legal: ['contract_*'],
  procurement: ['procurement_*'],
  documents: ['documents_*', 'drive_*'],
};

/** A level a JobRole grant can carry; 'none' grants nothing. */
type GrantLevel = Exclude<AccessLevel, 'none'>;

/**
 * Canonical module → the KEY tools, BY EXACT NAME, whose work done by hand sits behind
 * HTTP routes that require that module (a RequireModuleScope decorator on a handler that
 * runs ModuleScopeGuard and calls the service the tool calls), each with the lowest level
 * those routes accept.
 *
 * Derived, not chosen: job-role-tool-families.spec.ts re-derives this table from the
 * route decorators, the KEY dispatcher (with its helpers) and the bridged cortex organ on
 * every run, records the evidence (tool, service, route, scope) and the reason each other
 * tool stays ungranted, and fails if the two disagree. There are no wildcards: a tool the
 * routes do not govern (no service call, a method no route calls, or a route without an
 * enforced scope) is granted by no canonical module (SEC-V21b-02), and a tool added later
 * is granted only once this table says so. A module with no entry governs no KEY tool over
 * HTTP.
 */
export const CANONICAL_MODULE_TOOLS: Readonly<
  Record<CanonicalModule, Readonly<Record<string, GrantLevel>>>
> = {
  crm: {
    call_create_task: 'write', call_generate_script: 'write', call_list_tasks: 'read',
    call_log_outcome: 'write', call_schedule_followup: 'write', create_followup_queue: 'write',
    create_task: 'write', crm_add_note: 'write', crm_add_task: 'write', crm_create_contact: 'write',
    crm_delete_contact: 'write', crm_find_duplicates: 'read', crm_list_contacts: 'read',
    crm_list_deals: 'read', crm_merge_execute: 'write', crm_merge_preview: 'read',
    crm_move_deal_stage: 'write', crm_search_contacts: 'read', crm_update_contact: 'write',
    crm_update_deal: 'write', deals_create: 'write', deals_delete: 'write', deals_forecast: 'read',
    deals_get: 'read', deals_list: 'read', deals_list_stages: 'read', deals_mark_lost: 'write',
    deals_mark_won: 'write', deals_move_stage: 'write', deals_pipeline_velocity: 'read',
    deals_update: 'write', tag_contact: 'write',
  },
  revenue: {
    commerce_convert_quote: 'write', commerce_create_invoice: 'write',
    commerce_create_quote: 'write', commerce_delete_invoice: 'write',
    commerce_list_invoices: 'read', commerce_mark_invoice_paid: 'write',
    commerce_send_invoice: 'write', commerce_update_invoice: 'write', payments_create_link: 'write',
    payments_list_gateways: 'read', payments_list_links: 'read', payments_list_transactions: 'read',
    payments_refund_charge: 'write', payments_revoke_link: 'write',
    payments_search_transactions: 'read',
  },
  bookings: {
    calendar_create_event: 'write', calendar_list_events: 'read',
  },
  projects: {},
  content: {
    assets_delete: 'write', assets_get: 'read', assets_list: 'read', assets_list_folders: 'read',
    assets_tag: 'write', assets_untag: 'write', assets_update: 'write',
  },
  expenses: {
    expenses_create: 'write', expenses_list: 'read', finance_create_bill: 'write',
    finance_list_bills: 'read', finance_pay_bill: 'write', finance_view_payables: 'read',
  },
  automations: {},
  storefront: {},
  settings: {},
  ai: {},
  team: {
    structure_create_delegation_rule: 'write', structure_get_org_tree: 'read',
    structure_get_stats: 'read', structure_list_assignments: 'read',
    structure_list_delegation_rules: 'read', structure_list_job_roles: 'read',
    structure_list_org_units: 'read', structure_update_delegation_rule: 'write',
  },
  analytics: {},
  operations: {
    contract_create_tag: 'write', contract_extract_terms: 'write', contract_list_tags: 'read',
    contracts_acknowledge_alert: 'write', contracts_create: 'write', contracts_delete: 'write',
    contracts_get: 'read', contracts_list: 'read', contracts_stats: 'read',
    contracts_update: 'write', inbox_brief: 'read', inbox_list_threads: 'read',
    inbox_mark_resolved: 'write', inbox_read_thread: 'read', inbox_reply_thread: 'write',
    inbox_update_thread_status: 'write', payroll_approve_run: 'write', payroll_get_run: 'read',
    payroll_list_rates: 'read', payroll_list_runs: 'read', payroll_mark_paid: 'write',
    performance_scorecard: 'read', performance_take_snapshot: 'write',
    performance_team_summary: 'read', performance_trend: 'read',
  },
  connect: {},
};

/**
 * Tools the routes govern that no single canonical module grants (derived, like the table,
 * in job-role-tool-families.spec.ts): they need two modules, or do work beside the governed
 * call that no route exposes, so the governed part is only a floor. No key reaches them —
 * not a canonical key, not a legacy family, not the baseline.
 */
export const GOVERNED_UNGRANTED: Readonly<Record<string, string>> = {
  execute_custom_logic: 're-enters the dispatcher for any tool (innerToolExecutor -> executeToolByName)',
  send_message_with_approval: 'crm:write (CrmService.addNote) beside AiMessageSenderService.sendMessage, which backs no route',
  update_status_with_confirmation: 'needs crm AND revenue',
};

/**
 * Table tools whose service call checks the actor's CRM sub-permission over HTTP
 * (resolveCrmAccess: crm_edit for createContact / updateContact, crm_delete for
 * softDeleteContact). The dispatcher calls those methods with no actor, so the check
 * never runs on the KEY path; the canonical `crm` grant makes it instead, and reaches
 * these tools only when the scope is `any` — an `owned` scope cannot be kept to the
 * holder's own contacts without an actor (V1-21b review 2 ESC-4) — and only when crm_view
 * resolves to all, for the same reason (review 3 IC-1; see crmWithheld). Derived in
 * job-role-tool-families.spec.ts from the methods that read editScope / deleteScope.
 */
export const CRM_SUBPERMISSION_TOOLS: Readonly<Record<'crm_edit' | 'crm_delete', readonly string[]>> = {
  crm_edit: ['crm_create_contact', 'crm_update_contact', 'tag_contact'],
  crm_delete: ['crm_delete_contact'],
};

/**
 * Table tools whose service call, with an actor, ANDs visibilityClause onto the contact it
 * writes (CrmService.updateContact, softDeleteContact). crm_view 'all' does not mean the whole
 * book: for every member but the OWNER the clause still keeps another member's PRIVATE contact
 * out, so PATCH / DELETE contacts/:contactId answer 404 on it. The dispatcher calls these
 * methods with no actor and reaches that row, and no scope map can keep KEY to the rows its
 * holder sees, so the canonical `crm` grant never reaches them, at any level or
 * sub-permission (V1-21b review 4 DRV-1). Derived in job-role-tool-families.spec.ts from the
 * methods that reach visibilityClause( (a holder-aware dispatcher that passes the actor is the
 * way back; an owner decision).
 */
export const CRM_ROW_VISIBILITY_TOOLS: readonly string[] = ['crm_delete_contact', 'crm_update_contact', 'tag_contact'];

/** Baseline reads every position keeps regardless of grants (tools no route governs). */
export const BASELINE_READS: readonly string[] = ['fetch_*', 'calendar_check_conflicts', 'documents_list'];

const LEVEL_TIER: Record<string, number> = { read: 1, write: 2, admin: 3 };

/** Own-property lookup, so a key or level such as `constructor` or `__proto__` is not found on Object.prototype. */
function own<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

/** Exact match or trailing-* prefix, the RoleEngine semantics. */
function matches(patterns: readonly string[], toolName: string): boolean {
  for (const pattern of patterns) {
    if (pattern.endsWith('*')) {
      if (toolName.startsWith(pattern.slice(0, -1))) return true;
    } else if (pattern === toolName) {
      return true;
    }
  }
  return false;
}

/** The same table, keyed by any string, for lookups of a stored permission key. */
const CANONICAL_BY_KEY: Readonly<Record<string, Readonly<Record<string, GrantLevel>>>> =
  CANONICAL_MODULE_TOOLS;

/** Every registry tool some route governs: reached only through its governing module. */
const GOVERNED: ReadonlySet<string> = new Set([
  ...Object.values(CANONICAL_MODULE_TOOLS).flatMap((tools) => Object.keys(tools)),
  ...Object.keys(GOVERNED_UNGRANTED),
]);

interface Grant {
  /** Exact table names (a canonical grant) or tool-family patterns (a legacy grant, the baseline). */
  patterns: readonly string[];
  tier: number;
  /** A family grant reaches only tools no route governs. */
  family: boolean;
  /** Table tools this canonical grant lists but may not reach (the CRM sub-permissions). */
  withheld?: ReadonlySet<string>;
}

/** A grant reaches a tool only at a tier it covers, and a family grant only an ungoverned one. */
function covers(grant: Grant, toolName: string, riskTier: number): boolean {
  if (!matches(grant.patterns, toolName) || riskTier > grant.tier) return false;
  if (grant.family) return !GOVERNED.has(toolName);
  return !grant.withheld?.has(toolName);
}

/**
 * The table tools a canonical `crm` grant at `level` withholds, from the crm_view /
 * crm_edit / crm_delete scopes resolveCrmAccess would compute for the same map: the stored
 * override (exact key, value as stored, read as resolveCrmAccess reads it), else the
 * default of the crm level.
 *
 * crm_view bounds the same tools as crm_edit and crm_delete (V1-21b review 3 IC-1): with
 * an actor, updateContact and softDeleteContact AND the visibility clause onto the row
 * they reach, so a 'my book' member (viewAll false) edits and deletes only contacts they
 * own or that are shared with them, and createContact makes what they create theirs. The
 * dispatcher passes no actor, so KEY could not be kept to that book; every one of these
 * tools is withheld unless viewAll is true.
 *
 * Even viewAll is not the whole book (V1-21b review 4 DRV-1): the visibility clause keeps
 * other members' PRIVATE contacts out of updateContact and softDeleteContact for every
 * member but the OWNER, so CRM_ROW_VISIBILITY_TOOLS are withheld whatever the map says.
 */
function crmWithheld(permissions: Record<string, unknown>, level: GrantLevel): ReadonlySet<string> {
  const withheld = new Set<string>(CRM_ROW_VISIBILITY_TOOLS);
  const defaults = defaultCrmAccessForLevel(level);
  const viewOverride = own(permissions, 'crm_view');
  const viewAll = viewOverride ? viewOverride === 'all' : defaults.viewAll;
  const editScope = own(permissions, 'crm_edit') ?? defaults.editScope;
  const deleteScope = own(permissions, 'crm_delete') ?? defaults.deleteScope;
  if (!viewAll || editScope !== 'any') for (const t of CRM_SUBPERMISSION_TOOLS.crm_edit) withheld.add(t);
  if (!viewAll || deleteScope !== 'any') for (const t of CRM_SUBPERMISSION_TOOLS.crm_delete) withheld.add(t);
  return withheld;
}

/**
 * What a position with no JobRole is: one whose role was deleted (OrgAssignment.jobRole is
 * onDelete SetNull) or never set. It holds no module, so it keeps the baseline reads and
 * nothing else (V1-21b review 3 IC-2), the same as an empty permissions map.
 */
export const NO_JOB_ROLE: Readonly<Pick<JobRole, 'id' | 'name' | 'permissions'>> = {
  id: '',
  name: 'Unassigned',
  permissions: {},
};

/**
 * The holder's account, as AuthMiddleware reads it before any guard runs: a token whose User
 * row is soft-deleted (deletedAt) or banned (bannedAt) is dropped, so every route answers
 * 'Authentication required' (V1-21b review 5 INP4-1).
 */
export type HolderUser = Pick<User, 'deletedAt' | 'bannedAt'>;

/**
 * The holder's Membership, as ModuleScopeGuard and resolveCrmAccess read it (the row of
 * `userId` in `businessId`), with the membership's user as AuthMiddleware reads it.
 */
export type HolderMembership = Pick<Membership, 'role' | 'permissionScopes'> &
  Partial<Pick<Membership, 'businessId' | 'userId'>> & { user?: HolderUser | null };

/**
 * A staff position as StructureService.resolveStaffByPhone returns it: the OrgAssignment's
 * business, its JobRole and, on the membership path (membershipId / userId set), the
 * Membership the assignment names.
 */
export interface StaffPosition {
  businessId?: string | null;
  jobRole?: Pick<JobRole, 'id' | 'name' | 'permissions'> | null;
  membershipId?: string | null;
  userId?: string | null;
  membership?: HolderMembership | null;
}

/**
 * The scope map ModuleScopeGuard enforces for a membership: an explicit permissionScopes
 * object as stored (a missing key is none), else the role defaults. resolveCrmAccess reads
 * the same map for the CRM sub-permissions; with no explicit map its base level (admin for
 * ADMIN, read otherwise, full for the OWNER) is the role default's `crm` level.
 */
function effectiveScopes(membership: HolderMembership): Record<string, unknown> {
  const scopes = membership.permissionScopes;
  return scopes && typeof scopes === 'object' ? (scopes as Record<string, unknown>) : defaultScopesForRole(membership.role);
}

/**
 * Whether HTTP lets the membership's user in at all: its User row is given and neither
 * soft-deleted nor banned, the checks AuthMiddleware.resolveLocalUser makes (any value set
 * refuses). A user not given cannot be shown to be active (fail closed).
 */
function holderMayAuthenticate(membership: HolderMembership): boolean {
  const user = membership.user;
  return !!user && !user.deletedAt && !user.bannedAt;
}

/**
 * Whether the membership the assignment names is the one HTTP reads for its holder where KEY
 * acts (V1-21b review 6 INP5-1). ModuleScopeGuard and resolveCrmAccess look the membership up
 * by (user, the request's business), and BusinessGuard admits a user only to a business they
 * own or are a member of; the bridge acts in the assignment's business. An assignment written
 * before assertAssignmentRefs can name a membership in another business (see
 * StructureService.listPeople), and its userId is a denormalized copy that can name another
 * user than the membership's. Only the membership of the assignment's own user in the
 * assignment's own business is the holder's here; one in another business or of another user,
 * or one whose business or user is not given, is not (fail closed).
 */
function isHoldersMembershipHere(position: StaffPosition, membership: HolderMembership): boolean {
  const businessId = position.businessId;
  if (typeof businessId !== 'string' || !businessId || membership.businessId !== businessId) return false;
  if (typeof membership.userId !== 'string' || !membership.userId) return false;
  return !position.userId || position.userId === membership.userId;
}

/** Both envelope checks AiOversightService.evaluate applies: the tool is allowed and its tier within the cap. */
function passesEnvelope(envelope: JobRoleEnvelope, toolName: string, riskTier: number): boolean {
  if (envelope.blockedTools.includes(toolName)) return false;
  return matches(envelope.approvedTools, toolName) && riskTier <= envelope.maxRiskTier;
}

/**
 * The position's envelope bounded by its holder's: exactly the registry tools both pass, by
 * name, under the lower tier cap. Named after the position.
 */
function boundBy(position: JobRoleEnvelope, holder: JobRoleEnvelope): JobRoleEnvelope {
  return {
    jobRoleId: position.jobRoleId,
    jobRoleName: position.jobRoleName,
    approvedTools: FLOW_TOOLS.filter(
      (t) => passesEnvelope(position, t.name, t.riskTier) && passesEnvelope(holder, t.name, t.riskTier),
    ).map((t) => t.name),
    blockedTools: [],
    maxRiskTier: Math.min(position.maxRiskTier, holder.maxRiskTier),
  };
}

@Injectable()
export class JobRolePolicyService {
  envelopeForJobRole(jobRole: Pick<JobRole, 'id' | 'name' | 'permissions'>): JobRoleEnvelope {
    const permissions = (jobRole.permissions ?? {}) as Record<string, unknown>;
    const grants: Grant[] = [{ patterns: BASELINE_READS, tier: 1, family: true }];
    let maxRiskTier = 1;

    for (const [key, levelRaw] of Object.entries(permissions)) {
      if (typeof levelRaw !== 'string') continue;

      // Canonical: the exact key and the exact level, as ModuleScopeGuard reads them. A
      // level that is not read/write/admin (including 'none') grants nothing.
      const table = own(CANONICAL_BY_KEY, key);
      const tier = own(LEVEL_TIER, levelRaw);
      if (table && tier !== undefined) {
        const level = levelRaw as GrantLevel;
        // Exact names whose route level this grant reaches; the tier check is in covers().
        const names = Object.entries(table)
          .filter(([, required]) => LEVEL_RANK[level] >= LEVEL_RANK[required])
          .map(([tool]) => tool);
        if (names.length) {
          grants.push({
            patterns: names,
            tier,
            family: false,
            withheld: key === 'crm' ? crmWithheld(permissions, level) : undefined,
          });
          maxRiskTier = Math.max(maxRiskTier, tier);
        }
      }

      // Legacy tool families: matched case-insensitively, as before V1-21b, and limited to
      // tools no route governs (covers()).
      const families = own(MODULE_TOOL_FAMILIES, key.toLowerCase());
      const familyTier = own(LEVEL_TIER, levelRaw.toLowerCase());
      if (families && familyTier !== undefined) {
        grants.push({ patterns: families, tier: familyTier, family: true });
        maxRiskTier = Math.max(maxRiskTier, familyTier);
      }
      // An unknown key, or a key that governs no tool at this level, grants nothing and
      // raises no tier.
    }

    const approved = [...new Set(grants.flatMap((g) => g.patterns))];
    // Per-grant cap: a registry tool some pattern lists but no single grant covers at its
    // tier and route level is blocked, whatever the strongest key in the map is.
    const blocked = FLOW_TOOLS.filter(
      (t) => matches(approved, t.name) && !grants.some((g) => covers(g, t.name, t.riskTier)),
    ).map((t) => t.name);

    return {
      jobRoleId: jobRole.id,
      jobRoleName: jobRole.name,
      approvedTools: approved,
      blockedTools: blocked,
      maxRiskTier,
    };
  }

  /**
   * The envelope of a staff position, whether or not it still has a JobRole. A position
   * without one gets the NO_JOB_ROLE envelope (baseline reads only), never none at all:
   * with no envelope AiOversightService.evaluate answers from the crew RoleEngine detects
   * in the message text, which reaches CRM writes, refunds and execute_custom_logic for a
   * holder with no HTTP access (V1-21b review 3 IC-2). Fail closed.
   *
   * A membership-backed position is further bounded by its holder's Membership (V1-21b
   * review 4 IC3-1): ModuleScopeGuard and resolveCrmAccess enforce Membership.permissionScopes,
   * not the JobRole map, and the two drift apart when the member holds a second position
   * whose copy the membership carries, is narrowed by PATCH team/:m/permissions, or changes
   * role. The envelope is then what both the JobRole map and the membership's effective
   * scopes reach. A membership-backed position whose membership is not given keeps the
   * baseline only (fail closed). A contact-only position has no account and no HTTP access;
   * its JobRole map is its whole scope, as before.
   *
   * HTTP checks the account before any scope (V1-21b review 5 INP4-1): AuthMiddleware drops
   * the token of a soft-deleted or banned user, so that holder reaches no route whatever its
   * membership holds. Such a holder, and one whose User row is not given with the membership
   * (fail closed), keeps the baseline only, as a holder with no membership does.
   *
   * The cap is the membership HTTP reads, the holder's own in the business KEY acts in
   * (V1-21b review 6 INP5-1): an older assignment can name the holder's membership in another
   * business, where its scopes give nothing here, or another user's. Such a membership, or one
   * whose business or user is not given, caps the position to the baseline (fail closed), as
   * no membership does; this holds even when the holder has a membership of their own here,
   * which the assignment does not name.
   */
  envelopeForPosition(position: StaffPosition | null | undefined): JobRoleEnvelope {
    const scoped = this.envelopeForJobRole(position?.jobRole ?? NO_JOB_ROLE);
    if (!position) return scoped;
    const membershipBacked = !!(position.membershipId || position.userId || position.membership);
    if (!membershipBacked) return scoped;
    const membership = position.membership;
    const held =
      membership && isHoldersMembershipHere(position, membership) && holderMayAuthenticate(membership)
        ? effectiveScopes(membership)
        : {};
    return boundBy(
      scoped,
      this.envelopeForJobRole({ id: scoped.jobRoleId, name: scoped.jobRoleName, permissions: held as JobRole['permissions'] }),
    );
  }

  /** Same wildcard semantics as RoleEngine: exact match or trailing-* prefix. */
  isToolAllowed(envelope: JobRoleEnvelope, toolName: string): boolean {
    if (envelope.blockedTools.includes(toolName)) return false;
    return matches(envelope.approvedTools, toolName);
  }
}
