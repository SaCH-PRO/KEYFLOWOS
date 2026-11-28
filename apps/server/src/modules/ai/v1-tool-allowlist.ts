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
 *     but are NOT yet hidden here: `KEY-TOOL-DOMAIN-HIDE` applies per-business
 *     legacy-list gating on top of this classifier so businesses with legacy
 *     records keep their read tools.
 */
import { V1_HIDDEN_MODULES, type V1HiddenModuleKey } from '@keyflow/shared';

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

/**
 * Checks `toolOrActionName` and any nested tool/action name carried inside a
 * wrapper or proposal payload (`toolName`, `actionType`, and nested container
 * objects/arrays) using bounded BFS.
 *
 * Security (KEY-TOOL-ALLOWLIST R3 SEC MAJOR-2):
 * - Guards all property reads with `hasOwnProperty` so prototype-inherited
 *   keys cannot spoof or false-positive.
 * - For wrapper invocations (`cortex.execute_tool`, `EXECUTE_TOOL`,
 *   `cortex_execute_tool`), also traverses alias containers (`params`, `args`,
 *   `input`, `toolCalls`, `steps`, `actions`), array elements, and alias tool
 *   fields (`tool`, `tool_name`).
 * - If a wrapper invocation truncates due to `maxDepth` or `maxNodes`, fails
 *   CLOSED by returning `V1_TOOL_UNAVAILABLE_MESSAGE`. Benign deep payloads on
 *   non-wrapper tools remain unaffected.
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
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  let sawWrapper = isWrapperToolName(toolOrActionName);
  if (Array.isArray(payload) && !sawWrapper) {
    return null;
  }

  const seen = new Set<object>();
  const queue: Array<{ value: object; depth: number; inWrapper: boolean }> = [
    { value: payload as object, depth: 0, inWrapper: sawWrapper },
  ];
  let visited = 0;
  let truncated = false;

  const enqueueChild = (child: unknown, nextDepth: number, childInWrapper: boolean) => {
    if (!child || typeof child !== 'object') return;
    if (seen.has(child)) return;
    if (Array.isArray(child) && !childInWrapper) return;
    if (nextDepth > maxDepth) {
      truncated = true;
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

    const toolNameVal = ownProp(obj, 'toolName');
    if (typeof toolNameVal === 'string') {
      const refusal = v1ToolRefusalReason(toolNameVal);
      if (refusal) return refusal;
      if (isWrapperToolName(toolNameVal)) {
        sawWrapper = true;
        nodeInWrapper = true;
      }
    }
    const actionTypeVal = ownProp(obj, 'actionType');
    if (typeof actionTypeVal === 'string') {
      const refusal = v1ToolRefusalReason(actionTypeVal);
      if (refusal) return refusal;
      if (isWrapperToolName(actionTypeVal)) {
        sawWrapper = true;
        nodeInWrapper = true;
      }
    }

    if (nodeInWrapper) {
      for (const aliasKey of V1_WRAPPER_ALIAS_TOOL_KEYS) {
        const aliasVal = ownProp(obj, aliasKey);
        if (typeof aliasVal === 'string') {
          const refusal = v1ToolRefusalReason(aliasVal);
          if (refusal) return refusal;
          if (isWrapperToolName(aliasVal)) {
            sawWrapper = true;
          }
        }
      }
    }

    for (const key of V1_STANDARD_PAYLOAD_KEYS) {
      enqueueChild(ownProp(obj, key), current.depth + 1, nodeInWrapper);
    }

    if (nodeInWrapper) {
      for (const key of V1_WRAPPER_ALIAS_CONTAINER_KEYS) {
        enqueueChild(ownProp(obj, key), current.depth + 1, true);
      }
      // Also detect shallow/wide decoy siblings inside wrapper containers so
      // an attacker cannot exhaust `maxNodes` on arbitrary keys before our
      // real target key is popped from the queue.
      for (const key of Object.keys(obj)) {
        if (
          (V1_STANDARD_PAYLOAD_KEYS as readonly string[]).includes(key) ||
          (V1_WRAPPER_ALIAS_CONTAINER_KEYS as readonly string[]).includes(key)
        ) {
          continue;
        }
        const val = obj[key];
        if (val && typeof val === 'object') {
          enqueueChild(val, current.depth + 1, true);
        }
      }
    }
  }

  if (queue.length > 0) {
    truncated = true;
  }

  if (truncated && sawWrapper) {
    return V1_TOOL_UNAVAILABLE_MESSAGE;
  }

  return null;
}

