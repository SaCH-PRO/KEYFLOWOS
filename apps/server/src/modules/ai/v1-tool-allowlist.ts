/**
 * KEY-TOOL-ALLOWLIST (V1-63, P1 launch-track, D-318 Option 1, rulings `payroll` / `hide` / D-119):
 *
 * Single canonical v1 tool allowlist and module-family classifier for KEY.
 *
 *   - Every FLOW tool in `flow-tool-registry.ts` belongs to EITHER one hidden
 *     module in `packages/shared/src/v1-modules.ts` (`V1_HIDDEN_MODULES`) OR
 *     the reviewed v1 core set `V1_KEY_TOOLS` below (moved here from `V61-01`
 *     per review SEC-V61-3 so there is one source of truth).
 *   - Unconditional v1 removals are never advertised to the model and are
 *     refused at dispatch on every surface with the exact plain message
 *     `'not available in this version'`:
 *       1. `execute_custom_logic` (E2B sandbox; D-318 Option 1)
 *       2. Payroll write tools (`payroll_set_rate`, `payroll_generate_run`,
 *          `payroll_approve_run`, `payroll_mark_paid`; `payroll` ruling)
 *       3. Owner-only dotted cortex stub tools (`cortex.send_email`,
 *          `cortex.send_message`, `cortex.generate_report` and bare aliases; D-119)
 *   - Hidden-module domain families are classified here via `v1ToolModuleFamily`
 *     and gated per business via `v1ToolDomainRefusalReason` /
 *     `isToolAllowedForBusinessInV1` / `getAllowedV1FlowToolsForBusiness`
 *     (`KEY-TOOL-DOMAIN-HIDE`, V1-67, D-152 / D-150 / D-156 / D-329):
 *       - A hidden module not in the business's legacy list (`NAV-B-LEGACY-SERVER`)
 *         has all its tools withheld from prompts and refused at dispatch.
 *       - A hidden module in the business's legacy list keeps its read tools
 *         (`effectClass === 'READ'`), while writes stay withheld.
 *       - `advanced_crm` (`treatment: 'hide-advanced'`, D-150) keeps read+write
 *         when `Business.metaData.advancedCrm === true`.
 *       - `SEC-V61-3` argument guards gate `people_assign_task` (`ProjectTask`)
 *         and `reconcile_connect_statement_source` / `reconcile_sweep_statements`
 *         (Google Drive deferred).
 */
import { V1_HIDDEN_MODULES, type V1HiddenModule, type V1HiddenModuleKey } from '@keyflow/shared';
import { FLOW_TOOLS, type FlowTool, type ToolEffectClass } from './flow-tool-registry';

export const V1_TOOL_UNAVAILABLE_MESSAGE = 'not available in this version';

/**
 * Every FLOW tool that is NOT in a hidden module's `keyTools`, reviewed one by
 * one against the audit's v1 hubs (moved from `V61-01` per review SEC-V61-3).
 */
export const V1_KEY_TOOLS: ReadonlySet<string> = new Set([
  // Today: approvals, obligations and the read-outs behind its blocks.
  'approval_create_request',
  'approval_decide_step',
  'approval_list',
  'command_create_item',
  'command_discharge_obligation',
  'command_list_due_obligations',
  'fetch_business_summary',
  'fetch_client_health',
  'fetch_expense_pressure',
  'fetch_revenue_risk',
  'fetch_schedule_health',
  'fetch_storefront_quality',
  // Customers: contacts, notes and tasks on them, follow-ups, segments, tags, messages to a contact.
  'crm_add_note',
  'crm_add_task',
  'crm_create_contact',
  'crm_create_reminder',
  'crm_delete_contact',
  'crm_find_duplicates',
  'crm_list_contacts',
  'crm_merge_execute',
  'crm_merge_preview',
  'crm_recommend_follow_ups',
  'crm_search_contacts',
  'crm_update_contact',
  'create_followup_queue',
  'create_task',
  'draft_followup_message',
  'keyflow_create_note',
  'segment_contacts',
  'send_message_with_approval',
  'tag_contact',
  'update_status_with_confirmation',
  // Sales: quotes, invoices, products, store orders and listings, stock (warehouses stay a tab of a v1 hub).
  'commerce_convert_quote',
  'commerce_create_invoice',
  'commerce_create_product',
  'commerce_create_quote',
  'commerce_delete_invoice',
  'commerce_list_invoices',
  'commerce_mark_invoice_paid',
  'commerce_send_invoice',
  'commerce_summarize_revenue',
  'commerce_update_invoice',
  'commerce_update_product',
  'draft_payment_reminder',
  'marketplace_list_listings',
  'marketplace_list_orders',
  'store_list_products',
  'store_list_recent_orders',
  'inventory_adjust_stock',
  'inventory_list_movements',
  'inventory_list_stock',
  'inventory_list_warehouses',
  'inventory_low_stock_alerts',
  'inventory_summary',
  'inventory_transfer_stock',
  // Schedule: bookings and the calendar.
  'bookings_cancel_booking',
  'bookings_create_booking',
  'bookings_list_bookings',
  'bookings_list_services',
  'bookings_mark_no_show',
  'bookings_reschedule_booking',
  'calendar_check_conflicts',
  'calendar_create_event',
  'calendar_list_events',
  // Money: expenses, Books, Getting paid, reconciliation, reports.
  'expenses_create',
  'expenses_list',
  'finance_auto_match_bank',
  'finance_balance_sheet',
  'finance_cashflow',
  'finance_cashflow_forecast',
  'finance_create_bill',
  'finance_create_coa_account',
  'finance_create_invoice_reminder_draft',
  'finance_customer_balance',
  'finance_expense_breakdown',
  'finance_list_action_items',
  'finance_list_bank_accounts',
  'finance_list_bills',
  'finance_list_coa',
  'finance_list_overdue_invoices',
  'finance_money_moves',
  'finance_pay_bill',
  'finance_post_journal_entry',
  'finance_profit_and_loss',
  'finance_revenue_breakdown',
  'finance_safe_to_spend',
  'finance_tax_summary',
  'finance_view_payables',
  'finance_view_receivables',
  'payments_create_link',
  'payments_list_gateways',
  'payments_list_links',
  'payments_list_transactions',
  'payments_refund_charge',
  'payments_revoke_link',
  'payments_search_transactions',
  'reconcile_connect_statement_source',
  'reconcile_list_statement_sources',
  'reconcile_list_unmatched',
  'reconcile_match_line',
  'reconcile_run_auto_match',
  'reconcile_sweep_statements',
  'reports_generate',
  // Your page.
  'apply_storefront_recommendation',
  'draft_storefront_copy',
  // Settings: the team, the business profile and its documents, onboarding.
  'people_assign_task',
  'people_list',
  'people_recommend_assignee',
  'people_workload',
  'update_business_blueprint',
  'documents_list',
  'documents_search',
  'present_onboarding_card',
  'save_onboarding_step',
]);

/** FLOW tools unconditionally removed in v1 (never advertised, always refused at dispatch). */
export const V1_UNCONDITIONALLY_DISABLED_FLOW_TOOLS: ReadonlySet<string> = new Set([
  'execute_custom_logic',
  'payroll_set_rate',
  'payroll_generate_run',
  'payroll_approve_run',
  'payroll_mark_paid',
]);

/** Owner-only dotted cortex stub tools unconditionally removed in v1 (D-119). */
export const V1_UNCONDITIONALLY_DISABLED_CORTEX_TOOLS: ReadonlySet<string> = new Set([
  'cortex.send_email',
  'cortex.send_message',
  'cortex.generate_report',
  'send_email',
  'send_message',
  'generate_report',
]);

const HIDDEN_TOOL_TO_MODULE: ReadonlyMap<string, V1HiddenModuleKey> = (() => {
  const map = new Map<string, V1HiddenModuleKey>();
  for (const mod of V1_HIDDEN_MODULES) {
    for (const tool of mod.keyTools) {
      map.set(tool, mod.key);
    }
  }
  return map;
})();

const HIDDEN_TOOL_TO_MODULE_ENTRY: ReadonlyMap<string, V1HiddenModule> = (() => {
  const map = new Map<string, V1HiddenModule>();
  for (const mod of V1_HIDDEN_MODULES) {
    for (const tool of mod.keyTools) {
      map.set(tool, mod);
    }
  }
  return map;
})();

const FLOW_TOOL_EFFECT_CLASS: ReadonlyMap<string, ToolEffectClass> = (() => {
  const map = new Map<string, ToolEffectClass>();
  for (const tool of FLOW_TOOLS) {
    map.set(tool.name.trim().toLowerCase(), tool.effectClass);
  }
  return map;
})();

/**
 * Per-business context governing hidden-module tool visibility in v1
 * (`KEY-TOOL-DOMAIN-HIDE`, V1-67).
 */
export interface V1BusinessToolContext {
  /** Legacy hidden-module keys returned by `LegacyModulesService.getLegacyModules(businessId)`. */
  readonly legacyModules: ReadonlySet<string>;
  /**
   * Whether the business explicitly enabled Advanced CRM (`Business.metaData.advancedCrm === true`, D-150).
   * When true, `advanced_crm` (`treatment: 'hide-advanced'`) keeps both read and write tools.
   * When false (default), `advanced_crm` follows the legacy read-only / hidden rule.
   */
  readonly advancedCrmEnabled?: boolean;
}

/**
 * Classifies a FLOW tool into its canonical module family from
 * `packages/shared/src/v1-modules.ts` (`V1_HIDDEN_MODULES` key), `'v1_core'`
 * for reviewed v1 tools (`V1_KEY_TOOLS`), or `''` if unclassified.
 */
export function v1ToolModuleFamily(toolName: string): string {
  const normalized = typeof toolName === 'string' ? toolName.trim().toLowerCase() : '';
  if (!normalized) return '';
  const hidden = HIDDEN_TOOL_TO_MODULE.get(normalized);
  if (hidden) return hidden;
  if (V1_KEY_TOOLS.has(normalized)) return 'v1_core';
  return '';
}

/** Returns the `V1HiddenModule` entry owning `toolName`, or `null` if it is a v1 core / non-hidden tool. */
export function v1HiddenModuleForTool(toolName: string): V1HiddenModule | null {
  const normalized = typeof toolName === 'string' ? toolName.trim().toLowerCase() : '';
  if (!normalized) return null;
  return HIDDEN_TOOL_TO_MODULE_ENTRY.get(normalized) ?? null;
}

/** Whether `toolName` is a declared `READ`-only FLOW tool (`effectClass === 'READ'`). */
export function isFlowToolReadOnly(toolName: string): boolean {
  const normalized = typeof toolName === 'string' ? toolName.trim().toLowerCase() : '';
  if (!normalized) return false;
  return FLOW_TOOL_EFFECT_CLASS.get(normalized) === 'READ';
}

/**
 * Returns the plain v1 refusal message when `toolName` is unconditionally
 * removed in v1, or `null` otherwise.
 */
export function v1ToolRefusalReason(toolName: string): string | null {
  const normalized = typeof toolName === 'string' ? toolName.trim().toLowerCase() : '';
  if (!normalized) return null;
  if (
    V1_UNCONDITIONALLY_DISABLED_FLOW_TOOLS.has(normalized) ||
    V1_UNCONDITIONALLY_DISABLED_CORTEX_TOOLS.has(normalized)
  ) {
    return V1_TOOL_UNAVAILABLE_MESSAGE;
  }
  return null;
}

/** Whether `toolName` is allowed on the v1 allowlist (not unconditionally disabled). */
export function isToolAllowedInV1(toolName: string): boolean {
  return v1ToolRefusalReason(toolName) === null;
}

/**
 * Argument-level v1 guards for v1 core tools that can target deferred hidden
 * modules (USAGE-COUNT-SCRIPT review `SEC-V61-3`):
 *   - `people_assign_task` assigning a `ProjectTask` (`projects` write -> refused)
 *   - `reconcile_connect_statement_source` connecting a Google Drive folder
 *     (non-empty `driveFolderId` -> refused; empty `''` disconnect stays allowed)
 *   - `reconcile_sweep_statements` sweeping `source: 'drive'` (Google Drive deferred -> refused)
 */
export function v1ToolArgumentRefusalReason(toolName: string, args?: unknown): string | null {
  if (!args || typeof args !== 'object') return null;
  const normalized = typeof toolName === 'string' ? toolName.trim().toLowerCase() : '';
  const obj = args as Record<string, unknown>;

  if (normalized === 'people_assign_task') {
    const taskType = ownProp(obj, 'taskType');
    if (typeof taskType === 'string' && taskType.trim().toLowerCase() === 'projecttask') {
      return V1_TOOL_UNAVAILABLE_MESSAGE;
    }
    return null;
  }

  if (normalized === 'reconcile_connect_statement_source') {
    const driveFolderId = ownProp(obj, 'driveFolderId');
    if (driveFolderId !== undefined && driveFolderId !== null && String(driveFolderId).trim() !== '') {
      return V1_TOOL_UNAVAILABLE_MESSAGE;
    }
    return null;
  }

  if (normalized === 'reconcile_sweep_statements') {
    const source = ownProp(obj, 'source');
    if (typeof source === 'string' && source.trim().toLowerCase() === 'drive') {
      return V1_TOOL_UNAVAILABLE_MESSAGE;
    }
    return null;
  }

  return null;
}

/**
 * Per-business v1 refusal reason (`KEY-TOOL-DOMAIN-HIDE`, V1-67, D-152 / D-150 / D-156 / D-329).
 *
 *   1. Unconditionally disabled tools (`v1ToolRefusalReason`) -> refused.
 *   2. `SEC-V61-3` argument-level hidden-module targets (`v1ToolArgumentRefusalReason`) -> refused.
 *   3. Hidden-module tools (`V1_HIDDEN_MODULES`):
 *      - `advanced_crm` (`hide-advanced`, D-150) when `ctx.advancedCrmEnabled === true` -> allowed (read + write).
 *      - Module not in `ctx.legacyModules` -> refused.
 *      - Module in `ctx.legacyModules` -> allowed ONLY if `isFlowToolReadOnly(toolName)` (`effectClass === 'READ'`);
 *        writes stay refused.
 *   4. All other tools (`V1_KEY_TOOLS` / non-hidden) -> allowed (`null`).
 */
export function v1ToolDomainRefusalReason(
  toolName: string,
  ctx: V1BusinessToolContext,
  args?: unknown,
): string | null {
  const unconditional = v1ToolRefusalReason(toolName);
  if (unconditional) return unconditional;

  const argRefusal = v1ToolArgumentRefusalReason(toolName, args);
  if (argRefusal) return argRefusal;

  const hiddenMod = v1HiddenModuleForTool(toolName);
  if (!hiddenMod) return null;

  if (
    hiddenMod.treatment === 'hide-advanced' &&
    hiddenMod.key === 'advanced_crm' &&
    ctx.advancedCrmEnabled === true
  ) {
    return null;
  }

  if (!ctx.legacyModules.has(hiddenMod.key)) {
    return V1_TOOL_UNAVAILABLE_MESSAGE;
  }

  if (isFlowToolReadOnly(toolName)) {
    return null;
  }

  return V1_TOOL_UNAVAILABLE_MESSAGE;
}

/** Whether `toolName` is allowed for this business in v1 (`KEY-TOOL-DOMAIN-HIDE`). */
export function isToolAllowedForBusinessInV1(
  toolName: string,
  ctx: V1BusinessToolContext,
  args?: unknown,
): boolean {
  return v1ToolDomainRefusalReason(toolName, ctx, args) === null;
}

/**
 * Canonical per-business v1 `FLOW_TOOLS` list shared by chat tool selection
 * (`FlowOrchestratorService.selectToolsForRequest`) and `IntentParserService`.
 */
export function getAllowedV1FlowToolsForBusiness(ctx: V1BusinessToolContext): readonly FlowTool[] {
  return FLOW_TOOLS.filter((tool) => isToolAllowedForBusinessInV1(tool.name, ctx));
}

const V1_WRAPPER_TOOLS: ReadonlySet<string> = new Set([
  'cortex.execute_tool',
  'execute_tool',
  'cortex_execute_tool',
]);

function isWrapperToolName(name: string | null | undefined): boolean {
  if (typeof name !== 'string') return false;
  return V1_WRAPPER_TOOLS.has(name.trim().toLowerCase());
}

const V1_STANDARD_PAYLOAD_KEYS = ['payload', 'toolParams', 'inputPayload', 'parameters', 'result'] as const;
const V1_WRAPPER_ALIAS_CONTAINER_KEYS = ['params', 'args', 'input', 'toolCalls', 'steps', 'actions'] as const;
const V1_WRAPPER_ALIAS_TOOL_KEYS = ['tool', 'tool_name'] as const;

function ownProp(obj: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
}

function isTraversableObject(value: unknown): value is object {
  if (!value || typeof value !== 'object') return false;
  if (value instanceof Date || value instanceof RegExp || ArrayBuffer.isView(value)) {
    return false;
  }
  return true;
}

/**
 * Checks `toolOrActionName` and any nested tool/action name carried inside a
 * wrapper or proposal payload (`toolName`, `actionType`, and nested container
 * objects/arrays) using bounded BFS.
 *
 * Security & Correctness (KEY-TOOL-ALLOWLIST R3/R4):
 * - Guards all property reads with `hasOwnProperty` so prototype-inherited
 *   keys cannot spoof or false-positive.
 * - Traverses ONLY known standard payload keys (`payload`, `toolParams`,
 *   `inputPayload`, `parameters`, `result`) and — on wrapper-active nodes —
 *   wrapper alias containers (`params`, `args`, `input`, `toolCalls`, `steps`,
 *   `actions`) plus array elements reached through them. Arbitrary business
 *   data keys and built-in leaves (`Date`, `RegExp`, `TypedArray`) are never
 *   walked, preventing both decoy node-budget exhaustion and false-positive
 *   refusals on large legitimate payloads (e.g. multi-line invoices or Prisma
 *   proposal envelopes).
 * - Once a wrapper node resolves to a concrete non-wrapper v1-allowed tool
 *   (e.g. `commerce_create_invoice`), its child argument containers are still
 *   inspected for directly smuggled `toolName`/`actionType` (and any re-entered
 *   nested wrapper flips wrapper mode back on), but normal business data inside
 *   those arguments does not trigger wrapper-truncation fail-closed.
 * - If any wrapper-active branch truncates due to `maxDepth` or `maxNodes`,
 *   fails CLOSED by returning `V1_TOOL_UNAVAILABLE_MESSAGE`.
 */
export function v1ToolRefusalReasonForInvocation(
  toolOrActionName: string | null | undefined,
  payload?: unknown,
  maxDepth = 6,
  maxNodes = 24,
): string | null {
  if (typeof toolOrActionName === 'string') {
    const direct = v1ToolRefusalReason(toolOrActionName);
    if (direct) return direct;
  }
  if (!isTraversableObject(payload)) {
    return null;
  }

  const outerIsWrapper = isWrapperToolName(toolOrActionName);
  if (Array.isArray(payload) && !outerIsWrapper) {
    return null;
  }

  const seen = new Set<object>();
  const queue: Array<{ value: object; depth: number; inWrapper: boolean }> = [
    { value: payload, depth: 0, inWrapper: outerIsWrapper },
  ];
  let visited = 0;
  let wrapperTruncated = false;

  const enqueueChild = (child: unknown, nextDepth: number, childInWrapper: boolean) => {
    if (!isTraversableObject(child)) return;
    if (seen.has(child)) return;
    if (Array.isArray(child) && !childInWrapper) return;
    if (nextDepth > maxDepth) {
      if (childInWrapper) wrapperTruncated = true;
      return;
    }
    queue.push({ value: child, depth: nextDepth, inWrapper: childInWrapper });
  };

  while (queue.length > 0 && visited < maxNodes) {
    const current = queue.shift()!;
    if (seen.has(current.value)) continue;
    seen.add(current.value);
    visited += 1;

    if (Array.isArray(current.value)) {
      if (!current.inWrapper) continue;
      for (const item of current.value) {
        enqueueChild(item, current.depth + 1, true);
      }
      continue;
    }

    const obj = current.value as Record<string, unknown>;
    let nodeInWrapper = current.inWrapper;
    let explicitlyNamesWrapper = false;
    let resolvedConcreteTool = false;

    const toolNameVal = ownProp(obj, 'toolName');
    if (typeof toolNameVal === 'string' && toolNameVal.trim() !== '') {
      const refusal = v1ToolRefusalReason(toolNameVal);
      if (refusal) return refusal;
      if (isWrapperToolName(toolNameVal)) {
        nodeInWrapper = true;
        explicitlyNamesWrapper = true;
      } else {
        resolvedConcreteTool = true;
      }
    }
    const actionTypeVal = ownProp(obj, 'actionType');
    if (typeof actionTypeVal === 'string' && actionTypeVal.trim() !== '') {
      const refusal = v1ToolRefusalReason(actionTypeVal);
      if (refusal) return refusal;
      if (isWrapperToolName(actionTypeVal)) {
        nodeInWrapper = true;
        // `actionType: 'EXECUTE_TOOL'` on a proposal row is an envelope; only
        // treat children as wrapper-active when no concrete non-wrapper
        // `toolName` was already resolved on this same node.
        if (!resolvedConcreteTool) {
          explicitlyNamesWrapper = true;
        }
      }
    }

    if (nodeInWrapper) {
      for (const aliasKey of V1_WRAPPER_ALIAS_TOOL_KEYS) {
        const aliasVal = ownProp(obj, aliasKey);
        if (typeof aliasVal === 'string' && aliasVal.trim() !== '') {
          const refusal = v1ToolRefusalReason(aliasVal);
          if (refusal) return refusal;
          if (isWrapperToolName(aliasVal)) {
            explicitlyNamesWrapper = true;
            resolvedConcreteTool = false;
          } else if (!explicitlyNamesWrapper) {
            resolvedConcreteTool = true;
          }
        }
      }
    }

    // Keep wrapper-active traversal into children only while this node is still
    // an unresolved wrapper or explicitly dispatches another wrapper tool.
    const childInWrapper = nodeInWrapper && (!resolvedConcreteTool || explicitlyNamesWrapper);

    for (const key of V1_STANDARD_PAYLOAD_KEYS) {
      enqueueChild(ownProp(obj, key), current.depth + 1, childInWrapper);
    }

    if (nodeInWrapper) {
      for (const key of V1_WRAPPER_ALIAS_CONTAINER_KEYS) {
        // Wrapper dispatch lists (`toolCalls`, `steps`, `actions`) remain
        // wrapper-active even if an outer envelope also carries a `toolName`.
        const isDispatchListKey = key === 'toolCalls' || key === 'steps' || key === 'actions';
        enqueueChild(ownProp(obj, key), current.depth + 1, isDispatchListKey ? true : childInWrapper);
      }
    }
  }

  if (queue.some((entry) => entry.inWrapper && !seen.has(entry.value))) {
    wrapperTruncated = true;
  }

  if (wrapperTruncated) {
    return V1_TOOL_UNAVAILABLE_MESSAGE;
  }

  return null;
}

