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
import { membershipApprovalTier } from '../../core/authority/approval-tier';

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
 * review 4 IC3-1, review 6 INP5-1, review 7 INP4-2), and every position by the membership of
 * each member whose account phone it carries (review 7 INP4-3). Only an envelope this service
 * issued governs a KEY turn (isIssued; review 7 ENV-FORGE). No grant reaches a tool whose
 * dispatcher call finds its row by a bare id, which on the staff bridge, with no tenant context,
 * is any business's row (TENANT_UNBOUND_TOOLS, review 8 DD8-1). A reply approval is capped by
 * the same rows (approvalTierForPosition, review 9 WB-1 / FB-3). A registry tool some
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
    commerce_update_invoice: 'write', finance_view_receivables: 'read',
    // finance_* reports and reports_generate: GET reports/{pnl, cashflow, balance-sheet,
    // tax-summary, revenue-by, generate} require revenue:read (owner ruling D-57, V1-81
    // FOLLOW3-A7-MONEY-REPORTS item 9), so the legacy `finance` key and analytics no longer reach them;
    // finance_view_receivables: GET receivables/aging and customers/:contactId/balance (FOLLOW3-A6, D-57)
    finance_balance_sheet: 'read', finance_cashflow: 'read', finance_profit_and_loss: 'read',
    finance_revenue_breakdown: 'read', finance_tax_summary: 'read',
    payments_create_link: 'write',
    payments_list_gateways: 'read', payments_list_links: 'read', payments_list_transactions: 'read',
    payments_refund_charge: 'write', payments_revoke_link: 'write',
    payments_search_transactions: 'read', reports_generate: 'read',
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
    // command_* and procurement_*: the command-centre item and procurement routes require
    // operations (owner ruling D-40, R0-13g-OPS-SCOPE-COMMAND-PROCUREMENT)
    command_discharge_obligation: 'write', command_list_due_obligations: 'read',
    contract_create_tag: 'write', contract_extract_terms: 'write', contract_list_tags: 'read',
    contracts_acknowledge_alert: 'write', contracts_create: 'write', contracts_delete: 'write',
    contracts_get: 'read', contracts_list: 'read', contracts_stats: 'read',
    contracts_update: 'write', inbox_brief: 'write', inbox_list_threads: 'read',
    inbox_mark_resolved: 'write', inbox_read_thread: 'read', inbox_reply_thread: 'write',
    inbox_update_thread_status: 'write', payroll_approve_run: 'write', payroll_get_run: 'read',
    payroll_list_rates: 'read', payroll_list_runs: 'read', payroll_mark_paid: 'write',
    performance_scorecard: 'read', performance_take_snapshot: 'write',
    performance_team_summary: 'read', performance_trend: 'read',
    // procurement_acknowledge_vendor / mark_fulfilled / mark_invoiced: GOVERNED_UNGRANTED from R0-13g
    // (bare-id writes) until FOLLOW3-D15 bound ProcurementService's writes to the business
    procurement_acknowledge_vendor: 'write', procurement_create_request: 'write',
    procurement_get_request: 'read', procurement_get_stats: 'read', procurement_issue_po: 'write',
    procurement_list_requests: 'read', procurement_list_suppliers: 'read',
    procurement_mark_fulfilled: 'write', procurement_mark_invoiced: 'write',
    procurement_select_vendor: 'write', procurement_submit_for_review: 'write',
    procurement_update_request: 'write',
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
  commerce_send_invoice:
    "revenue:write (CommerceService.updateInvoiceStatus) beside TransactionalEmailService.send to the invoice's customer, which no member route does (review 7 DRV5-2)",
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

/**
 * Tools no route governs whose dispatcher call finds a row of a tenant-scoped model by an id the
 * model chose, with no business in the where and no check of the row's businessId (V1-21b
 * review 8 DD8-1). Over HTTP the same lookup stays in the tenant because TenantInterceptor arms
 * the Prisma tenant extension for the request's business; the WhatsApp/SMS staff bridge runs the
 * dispatcher inside a provider webhook with no tenant armed, so there it reaches another
 * business's row. No key reaches these, not a canonical key, a legacy family (content_*,
 * bookings_*, projects_*) or the baseline, until the dispatcher binds the row to
 * the business KEY acts in, as it now does for the call tools (the governed ones the review
 * found). Derived in job-role-tool-families.spec.ts (rule 2b), which fails if this list and the
 * dispatcher disagree. A governed tool with such a call is GOVERNED_UNGRANTED instead (rule 4):
 * procurement_acknowledge_vendor, procurement_mark_fulfilled and procurement_mark_invoiced moved
 * there when D-40 put the procurement routes under operations (R0-13g), and on to
 * CANONICAL_MODULE_TOOLS.operations when FOLLOW3-D15 made ProcurementService write the request
 * where { id, businessId }.
 */
export const TENANT_UNBOUND_TOOLS: Readonly<Record<string, string>> = {
  approval_decide_step: 'ApprovalRequestService.decideStep finds the approval request by its bare id',
  bookings_offer_waitlist_slot: 'BookingWaitlistService.offerSlot finds the waitlist entry by its bare id',
  content_assign_request: 'ContentRequestService.assignRequest finds the content request by its bare id',
  content_deliver_request: 'ContentRequestService.deliverRequest finds the content request by its bare id',
  content_get_request: 'ContentRequestService.getById finds the content request by its bare id',
  content_submit_for_review: 'ContentRequestService.submitForReview finds the content request by its bare id',
  content_transition_status: 'ContentRequestService.transitionStatus finds the content request by its bare id',
  content_upload_deliverables: 'ContentRequestService.uploadDeliverables finds the content request by its bare id',
  evidence_verify: 'EvidenceService.verify finds the evidence by its bare id',
  people_assign_task: 'TaskAssignmentService.assign finds the task and the staff assignee by bare ids',
  // projects_update_task left the list when PR196-PROJECTS-SERVER (D-87) made ProjectsService.updateTask
  // resolve the assignee where { id, businessId } (staff) or by the business's membership
};

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

/**
 * A grant reaches a tool only at a tier it covers, and a family grant only an ungoverned one; no
 * grant reaches a tool that finds its row by a bare id (TENANT_UNBOUND_TOOLS).
 */
function covers(grant: Grant, toolName: string, riskTier: number): boolean {
  if (own(TENANT_UNBOUND_TOOLS, toolName) !== undefined) return false;
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
  Partial<Pick<Membership, 'businessId' | 'userId' | 'maxApprovalTier'>> & { user?: HolderUser | null };

/**
 * A staff position as StructureService.resolveStaffByPhone returns it: the OrgAssignment's
 * business, its JobRole, on the membership path (membershipId / userId set) the holder's
 * membership in that business, the (user, business) row HTTP reads (review 7 INP4-2), and the
 * memberships of the business's members whose account phone is the position's phone (review 7
 * INP4-3).
 */
export interface StaffPosition {
  businessId?: string | null;
  jobRole?: Pick<JobRole, 'id' | 'name' | 'permissions'> | null;
  membershipId?: string | null;
  userId?: string | null;
  membership?: HolderMembership | null;
  phoneMembers?: readonly HolderMembership[] | null;
}

/**
 * The tier a staff position may approve by replying YES to a pending item routed to it
 * (StaffChatBridgeService -> AiOversightService.resolveApprovalByAssignment; V1-21b review 9
 * WB-1 / FB-3). Over HTTP an approval needs an account AuthMiddleware lets in, a membership in
 * the item's business (BusinessGuard) and membershipApprovalTier at or above the item's tier
 * (AiOversightService.resolveApproval). The reply path checked JobRole.defaultApprovalTier alone,
 * so a holder narrowed to tier 0, banned, or a member of another business only, approved a tier-3
 * item by WhatsApp. The tier is now the JobRole's, capped as envelopeForPosition caps the tools:
 *  - a membership-backed position by the membership HTTP reads for its holder in the position's
 *    business, whose account must be active; any other membership, or none, is refused;
 *  - every position by each member whose account phone is the position's (INP4-3), whose account
 *    must be active and whose row must be in the position's business; otherwise refused.
 * A contact-only position with no member on its phone keeps its JobRole tier, as before. A
 * refusal carries a reason and tier 0; `tier` is the highest risk tier the reply may approve.
 */
export function approvalTierForPosition(
  position: StaffPosition & { jobRole?: (Pick<JobRole, 'id' | 'name' | 'permissions'> & { defaultApprovalTier?: number | null }) | null },
): { tier: number; refusal?: string } {
  let tier = position.jobRole?.defaultApprovalTier ?? 0;
  if (position.membershipId || position.userId || position.membership) {
    const membership = position.membership;
    if (!membership || !isHoldersMembershipHere(position, membership)) {
      return { tier: 0, refusal: "This position's holder is not a member of this business" };
    }
    if (!holderMayAuthenticate(membership)) {
      return { tier: 0, refusal: "This position's holder cannot sign in, so cannot approve" };
    }
    tier = Math.min(tier, membershipApprovalTier({ role: membership.role, maxApprovalTier: membership.maxApprovalTier, permissionScopes: membership.permissionScopes }));
  }
  for (const member of position.phoneMembers ?? []) {
    if (!isMembershipHere(position, member) || !holderMayAuthenticate(member)) {
      return { tier: 0, refusal: 'A member who uses this phone number cannot approve in this business' };
    }
    tier = Math.min(tier, membershipApprovalTier({ role: member.role, maxApprovalTier: member.maxApprovalTier, permissionScopes: member.permissionScopes }));
  }
  return { tier };
}

/**
 * The envelopes this service issued (V1-21b review 7 ENV-FORGE). FlowOrchestratorService governs
 * a turn by an envelope only when it is one of these, so an object shaped like an envelope (one
 * a client sent, or a copy) never stands in for a position. Issued envelopes are frozen.
 */
const ISSUED = new WeakSet<object>();

function issue(envelope: JobRoleEnvelope): JobRoleEnvelope {
  Object.freeze(envelope.approvedTools);
  Object.freeze(envelope.blockedTools);
  ISSUED.add(Object.freeze(envelope));
  return envelope;
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
  if (!isMembershipHere(position, membership)) return false;
  return !position.userId || position.userId === membership.userId;
}

/** Whether `membership` is a member's row in the position's business, with its user given (fail closed otherwise). */
function isMembershipHere(position: StaffPosition, membership: HolderMembership): boolean {
  const businessId = position.businessId;
  if (typeof businessId !== 'string' || !businessId || membership.businessId !== businessId) return false;
  return typeof membership.userId === 'string' && !!membership.userId;
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

    return issue({
      jobRoleId: jobRole.id,
      jobRoleName: jobRole.name,
      approvedTools: approved,
      blockedTools: blocked,
      maxRiskTier,
    });
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
   * no membership does. StructureService.resolveStaffByPhone hands over the holder's row in the
   * assignment's business, looked up by (user, business) as ModuleScopeGuard does, in place of
   * a row the assignment names elsewhere (review 7 INP4-2), so a foreign OWNER membership with
   * no scope map never caps, nor uncaps, the position.
   *
   * The bridge knows the sender only by the phone (review 7 INP4-3). A position on the phone of
   * a member of its business, contact-only included, is further bounded by that member's
   * membership as HTTP reads it (by each, when several members carry the phone), so a member
   * who files a contact-only position on their own phone, or a contact later invited with it,
   * is narrowed over KEY when HTTP narrows them. A phone member not shown to be a member of the
   * position's business with an active account caps it to the baseline (fail closed).
   */
  envelopeForPosition(position: StaffPosition | null | undefined): JobRoleEnvelope {
    const scoped = this.envelopeForJobRole(position?.jobRole ?? NO_JOB_ROLE);
    if (!position) return scoped;
    const caps: Array<Record<string, unknown>> = [];
    if (position.membershipId || position.userId || position.membership) {
      const membership = position.membership;
      caps.push(membership && isHoldersMembershipHere(position, membership) && holderMayAuthenticate(membership) ? effectiveScopes(membership) : {});
    }
    for (const member of position.phoneMembers ?? []) {
      caps.push(isMembershipHere(position, member) && holderMayAuthenticate(member) ? effectiveScopes(member) : {});
    }
    let envelope = scoped;
    for (const held of caps) {
      envelope = boundBy(
        envelope,
        this.envelopeForJobRole({ id: scoped.jobRoleId, name: scoped.jobRoleName, permissions: held as JobRole['permissions'] }),
      );
    }
    return envelope === scoped ? scoped : issue(envelope);
  }

  /** Same wildcard semantics as RoleEngine: exact match or trailing-* prefix. */
  isToolAllowed(envelope: JobRoleEnvelope, toolName: string): boolean {
    if (envelope.blockedTools.includes(toolName)) return false;
    return matches(envelope.approvedTools, toolName);
  }

  /** Whether this service issued `envelope` (V1-21b review 7 ENV-FORGE); a copy or a lookalike was not. */
  isIssued(envelope: unknown): envelope is JobRoleEnvelope {
    return typeof envelope === 'object' && envelope !== null && ISSUED.has(envelope);
  }
}
