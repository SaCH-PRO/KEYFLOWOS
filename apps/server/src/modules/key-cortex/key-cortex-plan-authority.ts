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
 * (owned-view) rules are applied to the contacts a step reaches (KeyCortexPlannerService).
 * settings is enforced by its adapter on the actor (SettingsAdapterService), so it needs nothing
 * here. A module mapped to nothing is refused for a member held to scopes (deny by default).
 *
 * D-73: a plan with no member principal (one no member created, run by a system caller) may not
 * write money or invoices (commerce, finance) and may not read contacts (crm reads).
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
  return null;
}

/** The parameters of a crm step that name a contact. */
const CONTACT_ID_PARAMETERS = ['contactId', 'masterContactId', 'duplicateContactId'];

/** The contact ids a step's parameters name (a crm step reaches exactly these rows). */
export function planStepContactIds(parameters: unknown): string[] {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) return [];
  const p = parameters as Record<string, unknown>;
  return CONTACT_ID_PARAMETERS.map((key) => p[key]).filter((v): v is string => typeof v === 'string' && v.length > 0);
}

/** The crm actions that delete a contact (the crm_delete sub-permission, not crm_edit). */
export const CRM_DELETE_ACTIONS: ReadonlySet<string> = new Set(['delete_contact', 'merge_contacts']);
