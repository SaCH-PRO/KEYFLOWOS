import type { CanonicalModule } from '../../core/authority/module-vocabulary';
import { LEVEL_RANK, rankOf } from '../../core/authority/module-vocabulary';
import { KeyCortexCapabilityRegistryService } from './key-cortex-capability-registry.service';

/**
 * KEY-R3b-PLAN-AUTHORITY (owner rulings D-71 and D-73, 2026-11-03): what a KEY-cortex plan step
 * (a connector `module.action`) needs from the member it runs as, and what a plan with no member
 * principal may not do.
 *
 * D-71: each step needs the running member's scope for its module, write for a write and read for
 * a read, as ModuleScopeGuard computes scopes (the membership's explicit map, else its role's
 * defaults). OWNER and ADMIN keep every module. The module map is the one POST cortex/execute holds
 * a direct command to (key-cortex.controller.ts CORTEX_MODULE_RULES: commerce -> revenue, finance ->
 * expenses, ...), without that route's crm owner-only rule and registry check: a plan step is the
 * member's own plan, so a STAFF member's crm steps run within its crm scope, and its own-contact
 * (owned-view) rules are applied to the contacts a step reaches (KeyCortexPlannerService); an
 * ADMIN's contact visibility applies the same way (D-37: it keeps every module, not another
 * member's PRIVATE contact).
 * settings is enforced by its adapter on the actor (SettingsAdapterService), so it needs nothing
 * here. A module mapped to nothing is refused for a member held to scopes (deny by default).
 *
 * D-73: a plan with no member principal (one no member created, run by a system caller) may not
 * write money or invoices (commerce, finance) and may not read contacts (crm reads).
 *
 * W10-KEY-PLAN-SCOPE (D-57, D-114): a money report step also needs revenue:read from a member held to
 * scopes (memberPlanStepScopeRefusal), and an ADMIN whose explicit scope map sets revenue to none is
 * refused money steps (adminPlanStepScopeRefusal); an ADMIN with role-default scopes keeps D-71.
 */
export const KEY_PLAN_MODULE_SCOPES: Readonly<Record<string, CanonicalModule | 'adapter'>> = {
  crm: 'crm',
  commerce: 'revenue',
  finance: 'expenses',
  bookings: 'bookings',
  content: 'content',
  social: 'content',
  communications: 'content',
  projects: 'projects',
  analytics: 'analytics',
  intelligence: 'analytics',
  flow: 'automations',
  autopilot: 'automations',
  inbox: 'operations',
  notifications: 'operations',
  temporal: 'ai',
  settings: 'adapter',
};

/** The connector modules whose writes move the business's money or invoices (D-73). */
export const MONEY_WRITE_MODULES: ReadonlySet<string> = new Set(['commerce', 'finance']);

/**
 * W10-KEY-PLAN-SCOPE review SEC-W10KPS-1 (owner rulings D-114, D-57): the modules KeyCortexConnectorService
 * dispatches a command to (its adapter map: every module with an adapter; 'keystore' has none). A stored
 * step of one of these modules may hold the output of module.action whatever its toolName:
 * KeyCortexPlannerService runs module.action (buildCommand reads no toolName), and PlannerService stores
 * a step's toolName, module and action independently from the model's output. The plan read rule
 * (graph-actions.controller planStepReadRule) therefore judges such a step by its module too. A step of
 * any other module is answered 'Unknown module' by the connector and stores no module.action output.
 * money-reports-key-parity.spec.ts pins this set to the connector's adapter map.
 */
export const KEY_CONNECTOR_MODULES: ReadonlySet<string> = new Set([
  'crm',
  'commerce',
  'bookings',
  'content',
  'communications',
  'flow',
  'autopilot',
  'temporal',
  'inbox',
  'notifications',
  'projects',
  'activity',
  'genome',
  'intelligence',
  'analytics',
  'finance',
  'settings',
  'social',
]);

/**
 * W10-KEY-PLAN-SCOPE (SEC-W9MRK-1, owner rulings D-57 and D-114): the plan steps that read a money
 * report through LedgerReportingService: finance.generate_pnl (the P&L) and analytics.create_report /
 * export_report (the P&L, cash flow, balance sheet, tax summary and revenue by customer, CSV
 * included). These are the actions POST cortex/execute holds to revenue:read on top of their module's
 * own scope (key-cortex.controller.ts CORTEX_MONEY_REPORT_ACTIONS, W9-MONEY-REPORTS-KEY, D-57);
 * money-reports-key-parity.spec.ts pins the two lists to the same registry actions. The rule is per
 * action (a step's parameters are not read), so a create_report of a type that carries no revenue
 * figures is held to it too (deny by default).
 */
export const MONEY_REPORT_PLAN_STEPS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['finance', new Set(['generate_pnl'])],
  ['analytics', new Set(['create_report', 'export_report'])],
]);

/** Whether `module.action` reads a money report (MONEY_REPORT_PLAN_STEPS; D-57). */
export function planStepReadsMoneyReport(module: string | null | undefined, action: string | null | undefined): boolean {
  if (typeof module !== 'string' || typeof action !== 'string') return false;
  return MONEY_REPORT_PLAN_STEPS.get(module)?.has(action) ?? false;
}

/**
 * D-114: whether `module.action` is a money step: a money report (planStepReadsMoneyReport), or any
 * step of a module KEY_PLAN_MODULE_SCOPES maps to revenue (commerce: the invoice, quote, order and
 * payment actions, and their reads).
 */
export function planStepIsMoneyStep(module: string | null | undefined, action: string | null | undefined): boolean {
  if (planStepReadsMoneyReport(module, action)) return true;
  return typeof module === 'string' && Object.prototype.hasOwnProperty.call(KEY_PLAN_MODULE_SCOPES, module) && KEY_PLAN_MODULE_SCOPES[module] === 'revenue';
}

const READ_ACTION_PREFIXES = ['get_', 'list_', 'search_', 'count_', 'find_', 'recall_'];

const REGISTRY_QUERIES: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  new KeyCortexCapabilityRegistryService()
    .getAllCapabilities()
    .map((capability) => [capability.module as string, new Set(capability.queries.map((q) => q.name))]),
);

/**
 * Whether `module.action` only reads: a query the KEY capability registry lists for the module, or
 * an action named as a read (get_, list_, search_, count_, find_, recall_). Anything else is a write,
 * the stricter reading.
 */
export function planStepIsRead(module: string, action: string): boolean {
  if (REGISTRY_QUERIES.get(module)?.has(action)) return true;
  return READ_ACTION_PREFIXES.some((prefix) => action.startsWith(prefix));
}

/** Whether the step reads the business's contacts (every crm read does: contacts, their timeline, tasks or counts). */
export function planStepReadsContacts(module: string, action: string): boolean {
  return module === 'crm' && planStepIsRead(module, action);
}

/** Why a plan with no member principal may not run `module.action` (D-73), or null when it may. */
export function noMemberPlanStepRefusal(module: string | null, action: string): string | null {
  const m = module ?? 'general';
  if (planStepReadsContacts(m, action)) {
    return `"${m}.${action}" reads the business's contacts, and a KEY plan with no member principal reads no contacts (D-73)`;
  }
  if (MONEY_WRITE_MODULES.has(m) && !planStepIsRead(m, action)) {
    return `"${m}.${action}" writes the business's money or invoices, and a KEY plan with no member principal writes neither (D-73)`;
  }
  return null;
}

/**
 * Why a member held to module scopes (not the OWNER, an ADMIN or a SUPER_ADMIN) may not run
 * `module.action` (D-71), or null when its scopes cover it.
 *
 * W10-KEY-PLAN-SCOPE (SEC-W9MRK-1, D-57): a money report step (planStepReadsMoneyReport) also needs
 * revenue:read on top of its module's own scope, as POST cortex/execute asks for the same action
 * (cortexCommandRefusal) and the REST money reports ask ModuleScopeGuard for. Its module's scope is
 * checked first, as the direct-command door checks it.
 */
export function memberPlanStepScopeRefusal(module: string | null, action: string, scopes: Record<string, string>): string | null {
  const m = module ?? 'general';
  const scope = Object.prototype.hasOwnProperty.call(KEY_PLAN_MODULE_SCOPES, m) ? KEY_PLAN_MODULE_SCOPES[m] : undefined;
  if (!scope) return `Plan step "${m}.${action}": module "${m}" is mapped to no module scope, so it is not run for this member (D-71)`;
  if (scope === 'adapter') return null;
  const minLevel = planStepIsRead(m, action) ? 'read' : 'write';
  const level = scopes[scope] || 'none';
  if (rankOf(level) < LEVEL_RANK[minLevel]) {
    return `Insufficient permissions: ${scope} requires ${minLevel} access (you have ${level}); plan step "${m}.${action}" is not run (D-71)`;
  }
  if (planStepReadsMoneyReport(m, action)) {
    const revenue = scopes.revenue || 'none';
    if (rankOf(revenue) < LEVEL_RANK.read) {
      return `Insufficient permissions: revenue requires read access (you have ${revenue}); plan step "${m}.${action}" reads a money report, so it is not run (D-57)`;
    }
  }
  return null;
}

/**
 * W10-KEY-PLAN-SCOPE (owner ruling D-114, amending D-71 for an explicit revenue 'none' only;
 * SEC-W9MRK-1): why an ADMIN may not run `module.action`, or null. D-71 keeps an ADMIN every module,
 * so no module scope is checked here. D-114: an explicit module scope binds an ADMIN too, for money:
 * an ADMIN whose explicit scope map (`explicitScopes`, the membership's permissionScopes) sets revenue
 * to none is refused every money step (planStepIsMoneyStep: the money reports and the invoice actions).
 * A key the explicit map leaves out reads 'none', as ModuleScopeGuard reads it (EXPLICIT_MAP_MISSING_KEY),
 * so the plan door is no wider than the REST money routes for that ADMIN. An ADMIN with role-default
 * scopes (`explicitScopes` null: no map) is unaffected, and an explicit revenue read or above keeps D-71
 * (an invoice write still needs revenue write: KeyCortexPlannerService.assertRevenueWrite).
 */
export function adminPlanStepScopeRefusal(
  module: string | null,
  action: string,
  explicitScopes: Record<string, string> | null,
): string | null {
  if (!explicitScopes) return null;
  const m = module ?? 'general';
  if (!planStepIsMoneyStep(m, action)) return null;
  const revenue = explicitScopes.revenue || 'none';
  if (rankOf(revenue) >= LEVEL_RANK.read) return null;
  return `Insufficient permissions: revenue requires read access (you have ${revenue}); plan step "${m}.${action}" is a money step, and an ADMIN whose revenue access is set to none runs no money step (D-114)`;
}

/** The parameters of a crm step that name a contact. */
const CONTACT_ID_PARAMETERS = ['contactId', 'masterContactId', 'duplicateContactId'];

/** The contact ids a step's parameters name (a crm step reaches exactly these rows). */
export function planStepContactIds(parameters: unknown): string[] {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) return [];
  const p = parameters as Record<string, unknown>;
  return CONTACT_ID_PARAMETERS.map((key) => p[key]).filter((v): v is string => typeof v === 'string' && v.length > 0);
}

/**
 * KEY-R3b review SEC-R3b-3 / CR-R3b-2: the parameters of a crm step that name a contact's child row
 * the adapter reaches by its own id, whatever contact the step names beside it: crm.complete_task
 * completes the task `taskId` names (CrmService.completeTask reads the task by that id alone). The
 * contact such a row belongs to is the one the step reaches (KeyCortexPlannerService resolves it).
 */
export function planStepTaskIds(parameters: unknown): string[] {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) return [];
  const taskId = (parameters as Record<string, unknown>).taskId;
  return typeof taskId === 'string' && taskId.length > 0 ? [taskId] : [];
}

/** The crm actions that delete a contact (the crm_delete sub-permission, not crm_edit). */
export const CRM_DELETE_ACTIONS: ReadonlySet<string> = new Set(['delete_contact', 'merge_contacts']);
