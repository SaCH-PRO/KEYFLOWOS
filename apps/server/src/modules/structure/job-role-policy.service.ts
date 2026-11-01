import { Injectable } from '@nestjs/common';
import type { JobRole } from '@prisma/client';
import { FLOW_TOOLS } from '../ai/flow-tool-registry';
import { defaultCrmAccessForLevel } from '../crm/crm-permissions.helper';
import {
  LEVEL_RANK,
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
 * the crm_edit / crm_delete sub-permissions resolveCrmAccess applies over HTTP
 * (review 2 ESC-4). A registry tool some pattern matches but no grant covers is
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
 * holder's own contacts without an actor (V1-21b review 2 ESC-4). Derived in
 * job-role-tool-families.spec.ts from the methods that read editScope / deleteScope.
 */
export const CRM_SUBPERMISSION_TOOLS: Readonly<Record<'crm_edit' | 'crm_delete', readonly string[]>> = {
  crm_edit: ['crm_create_contact', 'crm_update_contact', 'tag_contact'],
  crm_delete: ['crm_delete_contact'],
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

/** A grant reaches a tool only at a tier it covers, and a family grant only an ungoverned one. */
function covers(grant: Grant, toolName: string, riskTier: number): boolean {
  if (!matches(grant.patterns, toolName) || riskTier > grant.tier) return false;
  if (grant.family) return !GOVERNED.has(toolName);
  return !grant.withheld?.has(toolName);
}

/**
 * The table tools a canonical `crm` grant at `level` withholds, from the crm_edit /
 * crm_delete scopes resolveCrmAccess would compute for the same map: the stored override
 * (exact key, value as stored), else the default of the crm level.
 */
function crmWithheld(permissions: Record<string, unknown>, level: GrantLevel): ReadonlySet<string> {
  const defaults = defaultCrmAccessForLevel(level);
  const editScope = own(permissions, 'crm_edit') ?? defaults.editScope;
  const deleteScope = own(permissions, 'crm_delete') ?? defaults.deleteScope;
  return new Set([
    ...(editScope === 'any' ? [] : CRM_SUBPERMISSION_TOOLS.crm_edit),
    ...(deleteScope === 'any' ? [] : CRM_SUBPERMISSION_TOOLS.crm_delete),
  ]);
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

  /** Same wildcard semantics as RoleEngine: exact match or trailing-* prefix. */
  isToolAllowed(envelope: JobRoleEnvelope, toolName: string): boolean {
    if (envelope.blockedTools.includes(toolName)) return false;
    return matches(envelope.approvedTools, toolName);
  }
}
