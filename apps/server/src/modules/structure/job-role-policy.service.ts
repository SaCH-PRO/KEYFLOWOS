import { Injectable } from '@nestjs/common';
import type { JobRole } from '@prisma/client';
import { FLOW_TOOLS } from '../ai/flow-tool-registry';
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
 * The map is read in two vocabularies (V1-21b-JOBROLE-TOOL-FAMILIES):
 *  - the canonical module vocabulary, which V1-21 holds every JobRole write to
 *    (CANONICAL_MODULE_TOOLS below), and
 *  - the legacy KEY tool-family keys (MODULE_TOOL_FAMILIES), which rows written
 *    before V1-21 still carry.
 * A key present in both (crm, bookings, projects, content) grants the union.
 *
 * Every grant is bounded by the level of the key that makes it, not by the
 * strongest key in the map (V1-21b review SEC-V21b-01 / CR-1): a tool is
 * reachable only through a key whose tier (read 1, write 2, admin 3) covers the
 * tool's risk tier and, when the HTTP routes govern the tool, whose level reaches
 * the level those routes require (SEC-V21b-03). A registry tool some pattern
 * matches but no key covers is listed in `blockedTools`, which `isToolAllowed`
 * checks first, so AiOversightService.evaluate refuses it and the chat never
 * advertises it. `maxRiskTier` stays the strongest key's tier, as before; it is
 * the coarse cap, `blockedTools` the per-grant one.
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
 * kept, unchanged, so that job roles written before V1-21 keep their envelope.
 */
const MODULE_TOOL_FAMILIES: Readonly<Record<string, readonly string[]>> = {
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
 * route decorators, the KEY dispatcher and the bridged cortex organ on every run, records
 * the evidence (tool, service, route, scope) and the reason each other tool stays
 * ungranted, and fails if the two disagree. There are no wildcards: a tool the routes do
 * not govern (no service call, a method no route calls, or a route without an enforced
 * scope) is granted by no canonical module (SEC-V21b-02), and a tool added later is granted
 * only once this table says so. A module with no entry governs no KEY tool over HTTP.
 */
export const CANONICAL_MODULE_TOOLS: Readonly<
  Record<CanonicalModule, Readonly<Record<string, GrantLevel>>>
> = {
  crm: {
    call_create_task: 'write', call_generate_script: 'write', call_list_tasks: 'read',
    call_log_outcome: 'write', call_schedule_followup: 'write', crm_create_contact: 'write',
    crm_delete_contact: 'write', crm_find_duplicates: 'read', crm_merge_execute: 'write',
    crm_merge_preview: 'read', crm_move_deal_stage: 'write', crm_update_contact: 'write',
    crm_update_deal: 'write', deals_create: 'write', deals_delete: 'write', deals_forecast: 'read',
    deals_get: 'read', deals_list: 'read', deals_list_stages: 'read', deals_mark_lost: 'write',
    deals_mark_won: 'write', deals_move_stage: 'write', deals_pipeline_velocity: 'read',
    deals_update: 'write', tag_contact: 'write',
  },
  revenue: {
    commerce_convert_quote: 'write', commerce_create_invoice: 'write',
    commerce_create_quote: 'write', commerce_delete_invoice: 'write',
    commerce_send_invoice: 'write', commerce_update_invoice: 'write', payments_create_link: 'write',
    payments_list_gateways: 'read', payments_list_links: 'read', payments_list_transactions: 'read',
    payments_refund_charge: 'write', payments_revoke_link: 'write',
    payments_search_transactions: 'read',
  },
  bookings: {
    calendar_create_event: 'write',
  },
  projects: {},
  content: {
    assets_delete: 'write', assets_list: 'read', assets_list_folders: 'read', assets_tag: 'write',
    assets_untag: 'write', assets_update: 'write',
  },
  expenses: {
    expenses_create: 'write', finance_create_bill: 'write', finance_list_bills: 'read',
    finance_pay_bill: 'write', finance_view_payables: 'read',
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

/** Baseline reads every position keeps regardless of grants. */
const BASELINE_READS = ['fetch_*', 'calendar_check_conflicts', 'documents_list'];

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

/** Registry tool → the level its HTTP routes require, for every tool the routes govern. */
const ROUTE_LEVEL: ReadonlyMap<string, GrantLevel> = (() => {
  const out = new Map<string, GrantLevel>();
  for (const tools of Object.values(CANONICAL_MODULE_TOOLS)) {
    for (const [tool, level] of Object.entries(tools)) {
      const cur = out.get(tool);
      if (!cur || LEVEL_RANK[level] > LEVEL_RANK[cur]) out.set(tool, level);
    }
  }
  return out;
})();

interface Grant {
  patterns: readonly string[];
  level: GrantLevel;
  tier: number;
}

/** A grant reaches a tool only at a tier it covers and a route level it reaches. */
function covers(grant: Grant, toolName: string, riskTier: number): boolean {
  if (!matches(grant.patterns, toolName) || riskTier > grant.tier) return false;
  const required = ROUTE_LEVEL.get(toolName);
  return required === undefined || LEVEL_RANK[grant.level] >= LEVEL_RANK[required];
}

@Injectable()
export class JobRolePolicyService {
  envelopeForJobRole(jobRole: Pick<JobRole, 'id' | 'name' | 'permissions'>): JobRoleEnvelope {
    const permissions = (jobRole.permissions ?? {}) as Record<string, unknown>;
    const grants: Grant[] = [{ patterns: BASELINE_READS, level: 'read', tier: 1 }];
    let maxRiskTier = 1;

    for (const [module, levelRaw] of Object.entries(permissions)) {
      if (typeof levelRaw !== 'string') continue;
      const level = levelRaw.toLowerCase();
      const tier = own(LEVEL_TIER, level);
      // Deny by default: a level that is not read/write/admin (including 'none') grants
      // nothing and raises no tier.
      if (tier === undefined) continue;
      const key = module.toLowerCase();
      const canonical = own(CANONICAL_BY_KEY, key) ?? {};
      const patterns = [
        ...(own(MODULE_TOOL_FAMILIES, key) ?? []),
        // Exact names whose route level this grant reaches; the tier check is in covers().
        ...Object.entries(canonical)
          .filter(([, required]) => LEVEL_RANK[level as GrantLevel] >= LEVEL_RANK[required])
          .map(([tool]) => tool),
      ];
      // An unknown key, or a key that governs no tool at this level, grants nothing and
      // raises no tier.
      if (!patterns.length) continue;
      grants.push({ patterns, level: level as GrantLevel, tier });
      maxRiskTier = Math.max(maxRiskTier, tier);
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
