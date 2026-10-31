import { Injectable } from '@nestjs/common';
import type { JobRole } from '@prisma/client';
import type { CanonicalModule } from '../../core/authority/module-vocabulary';

/**
 * Position-scoped governance envelope: what a specific JobRole (position)
 * may use mid-conversation. Derived from the role's `permissions` JSON map
 * ({ module: "read" | "write" | "admin" }) — deny-by-default: modules not
 * granted are outside the position's scope.
 *
 * The map is read in two vocabularies (V1-21b-JOBROLE-TOOL-FAMILIES):
 *  - the canonical module vocabulary, which V1-21 holds every JobRole write to
 *    (CANONICAL_MODULE_TOOL_FAMILIES below), and
 *  - the legacy KEY tool-family keys (MODULE_TOOL_FAMILIES), which rows written
 *    before V1-21 still carry.
 * A key present in both (crm, bookings, projects, content) grants the union.
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

/**
 * Canonical module → the KEY tools whose work, done by hand, sits behind HTTP routes
 * that require that module (`@RequireModuleScope` on a handler that runs
 * ModuleScopeGuard and calls the service the tool calls).
 *
 * Derived, not chosen: job-role-tool-families.spec.ts re-derives this table from the
 * route decorators and the KEY dispatcher on every run, records the evidence (family,
 * service, route, scope) and the reason each unlisted family stays unmapped, and fails
 * if the two disagree. Change the decorators or the tools and that spec says what this
 * table must become. A module with no entry governs no KEY tool over HTTP.
 */
export const CANONICAL_MODULE_TOOL_FAMILIES: Readonly<Record<CanonicalModule, readonly string[]>> = {
  crm: ['crm_*', 'deals_*', 'call_*', 'tag_*'],
  revenue: ['commerce_*', 'payments_*'],
  bookings: ['calendar_*'],
  projects: [],
  content: ['assets_*'],
  // finance_* as a family is behind finance.controller / reports.controller, which declare
  // no module scope; only its four bill tools call ExpensesService behind bills.controller.
  expenses: ['expenses_*', 'finance_list_bills', 'finance_create_bill', 'finance_pay_bill', 'finance_view_payables'],
  automations: [],
  storefront: [],
  settings: [],
  ai: [],
  team: ['structure_*'],
  analytics: [],
  operations: ['contracts_*', 'contract_*', 'inbox_*', 'payroll_*', 'performance_*'],
  connect: [],
};

/** Baseline reads every position keeps regardless of grants. */
const BASELINE_READS = ['fetch_*', 'calendar_check_conflicts', 'documents_list'];

const LEVEL_TIER: Record<string, number> = { read: 1, write: 2, admin: 3 };

/** Own-property lookup, so a key or level such as `constructor` or `__proto__` is not found on Object.prototype. */
function own<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

/** Every tool pattern a permission key unlocks, in either vocabulary. */
function familiesFor(key: string): string[] {
  return [
    ...(own(MODULE_TOOL_FAMILIES, key) ?? []),
    ...(own(CANONICAL_MODULE_TOOL_FAMILIES as Readonly<Record<string, readonly string[]>>, key) ?? []),
  ];
}

@Injectable()
export class JobRolePolicyService {
  envelopeForJobRole(jobRole: Pick<JobRole, 'id' | 'name' | 'permissions'>): JobRoleEnvelope {
    const permissions = (jobRole.permissions ?? {}) as Record<string, unknown>;
    const approved = new Set<string>(BASELINE_READS);
    let maxRiskTier = 1;

    for (const [module, levelRaw] of Object.entries(permissions)) {
      if (typeof levelRaw !== 'string') continue;
      const tier = own(LEVEL_TIER, levelRaw.toLowerCase());
      const families = familiesFor(module.toLowerCase());
      // Deny by default: an unknown key, a key that governs no tool, or a level that is
      // not read/write/admin (including 'none') grants nothing and raises no tier.
      if (!families.length || tier === undefined) continue;
      families.forEach((f) => approved.add(f));
      maxRiskTier = Math.max(maxRiskTier, tier);
    }

    return {
      jobRoleId: jobRole.id,
      jobRoleName: jobRole.name,
      approvedTools: [...approved],
      blockedTools: [],
      maxRiskTier,
    };
  }

  /** Same wildcard semantics as RoleEngine: exact match or trailing-* prefix. */
  isToolAllowed(envelope: JobRoleEnvelope, toolName: string): boolean {
    if (envelope.blockedTools.includes(toolName)) return false;
    for (const pattern of envelope.approvedTools) {
      if (pattern.endsWith('*')) {
        if (toolName.startsWith(pattern.slice(0, -1))) return true;
      } else if (pattern === toolName) {
        return true;
      }
    }
    return false;
  }
}
