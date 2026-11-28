/**
 * P154 — RR-LEGACY-TOOLS-CLASSIFY (D-261, D-262, D-17, D-100, D-119, D-145, D-234).
 *
 * Explicit classification of every legacy tool registered in `KeyToolRegistryService`
 * (all 14) against the canonical `FLOW_TOOLS` catalogue (`flow-tool-registry.ts`):
 *
 *   - `SAME`: exact canonical match in `FLOW_TOOLS` (same domain owner service and contract).
 *   - `ALIAS`: maps to an equivalent canonical tool in `FLOW_TOOLS` without loosening risk,
 *     approval, or scope (revenue-deriving tools gain/keep `revenue:read` + D-104 membership).
 *   - `SPECIALIZATION`: genuinely distinct legacy contract (e.g. D-260 sent-only overdue
 *     statuses, higher risk tier, contact-level follow-up list, optional-contact reminder)
 *     that stays on the legacy registry until `RR-LEGACY-FALLBACK-REMOVE`.
 *   - `MISSING`: needed capability with no canonical equivalent in `FLOW_TOOLS` yet; stays
 *     on the legacy registry until `RR-LEGACY-FALLBACK-REMOVE`.
 *   - `OBSOLETE`: belongs to a module hidden in v1 (`packages/shared/src/v1-modules.ts`) or
 *     retired; fails closed with a plain refusal and never executes.
 *
 * Security invariant: no tool's risk tier, approval requirement, or module scope may loosen;
 * ambiguity fails closed.
 */

export type LegacyToolDisposition =
  | 'SAME'
  | 'ALIAS'
  | 'SPECIALIZATION'
  | 'OBSOLETE'
  | 'MISSING';

export interface LegacyToolEquivalenceEntry {
  /** Legacy `module.tool` key as registered in `KeyToolRegistryService`. */
  readonly legacyKey: string;
  readonly disposition: LegacyToolDisposition;
  /** Canonical `FLOW_TOOLS` name. Present iff disposition is `'SAME'` or `'ALIAS'`. */
  readonly canonicalTool?: string;
  readonly reason: string;
}

export const LEGACY_TOOL_EQUIVALENCE: ReadonlyArray<LegacyToolEquivalenceEntry> = [
  {
    legacyKey: 'finance.summarizeCashPosition',
    disposition: 'ALIAS',
    canonicalTool: 'finance_safe_to_spend',
    reason:
      'SafeToSpendService.calculate (via canonical finance_safe_to_spend) reports authoritative ledger cashBalance and currency (V1-34/CF-41) with identical empty input, tier 1, and enforces revenue:read + D-104 membership (D-100/D-145/D-234).',
  },
  {
    legacyKey: 'finance.calculateSafeToSpend',
    disposition: 'SAME',
    canonicalTool: 'finance_safe_to_spend',
    reason:
      'Exact match: both invoke SafeToSpendService.calculate(businessId) with empty input at tier 1; canonical tool enforces revenue:read + D-104 membership (TOF-FINANCE-CANONICAL-TOOLS, D-100/D-145/D-234).',
  },
  {
    legacyKey: 'finance.listOverdueInvoices',
    disposition: 'SAME',
    canonicalTool: 'finance_list_overdue_invoices',
    reason:
      'Promoted in P160 (RR-LEGACY-FALLBACK-REMOVE): canonical finance_list_overdue_invoices preserves D-260 sent-only overdue statuses (SENT, OVERDUE, PARTIALLY_PAID, PARTIALLY_CREDITED), per-currency totalsByCurrency, and limit (1-100) at tier 1 under revenue:read + D-104 membership.',
  },
  {
    legacyKey: 'finance.generateMoneyMoves',
    disposition: 'SAME',
    canonicalTool: 'finance_money_moves',
    reason:
      'Exact match: both invoke MoneyMovesService.generate(businessId) with empty input at tier 1; canonical tool enforces revenue:read + D-104 membership (TOF-FINANCE-CANONICAL-TOOLS, D-100/D-145/D-234).',
  },
  {
    legacyKey: 'finance.cashflowForecast',
    disposition: 'SAME',
    canonicalTool: 'finance_cashflow_forecast',
    reason:
      'Exact match: both invoke CashflowForecastService.forecast(businessId, horizonDays) at tier 1; canonical tool validates horizonDays (1-365) and enforces revenue:read + D-104 membership (TOF-FINANCE-CANONICAL-TOOLS, D-100/D-145/D-234).',
  },
  {
    legacyKey: 'finance.createInvoiceReminderDraft',
    disposition: 'SAME',
    canonicalTool: 'finance_create_invoice_reminder_draft',
    reason:
      'Promoted in P160 (RR-LEGACY-FALLBACK-REMOVE): canonical finance_create_invoice_reminder_draft preserves deterministic tier-2 template drafting, D-260 sent-only overdue checks, and credit-aware remaining balance under revenue:write + D-104 membership without loosening riskTier 2.',
  },
  {
    legacyKey: 'contacts.recommendFollowUps',
    disposition: 'SAME',
    canonicalTool: 'crm_recommend_follow_ups',
    reason:
      'Promoted in P160 (RR-LEGACY-FALLBACK-REMOVE): canonical crm_recommend_follow_ups returns stale non-dormant contacts with daysSinceContact at tier 1 under crm:read and enforces D-37 caller CRM visibility directly in Prisma.',
  },
  {
    legacyKey: 'contacts.createCommandItem',
    disposition: 'SAME',
    canonicalTool: 'command_create_item',
    reason:
      'Promoted in P160 (RR-LEGACY-FALLBACK-REMOVE): canonical command_create_item creates a universal-queue CommandItem via CommandService.create at tier 1 under operations:write (D-40) with D-37 contact visibility checks when contactId is supplied.',
  },
  {
    legacyKey: 'commerce.summarizeRevenue',
    disposition: 'SAME',
    canonicalTool: 'commerce_summarize_revenue',
    reason:
      'Promoted in P160 (RR-LEGACY-FALLBACK-REMOVE): canonical commerce_summarize_revenue returns all-time PAID invoice totalRevenue, paidInvoiceCount, and currency with empty input at tier 1 under revenue:read + D-104 membership.',
  },
  {
    legacyKey: 'timeline.createReminder',
    disposition: 'SAME',
    canonicalTool: 'crm_create_reminder',
    reason:
      'Promoted in P160 (RR-LEGACY-FALLBACK-REMOVE): canonical crm_create_reminder creates a ContactTask reminder at tier 1 under crm:write and validates required contactId ownership and D-37 visibility.',
  },
  {
    legacyKey: 'connect.scanDrive',
    disposition: 'OBSOLETE',
    reason:
      'Retired in P160 (RR-LEGACY-FALLBACK-REMOVE): Google Drive sits under V1_HIDDEN_MODULES key "connectors" (defer-v1plus, D-152) and has no v1 canonical replacement; must fail closed without executing.',
  },
  {
    legacyKey: 'connect.listDriveIntake',
    disposition: 'OBSOLETE',
    reason:
      'Retired in P160 (RR-LEGACY-FALLBACK-REMOVE): Google Drive intake sits under V1_HIDDEN_MODULES key "connectors" (defer-v1plus, D-152) and has no v1 canonical replacement; must fail closed without executing.',
  },
  {
    legacyKey: 'messages.listMessageIntake',
    disposition: 'OBSOLETE',
    reason:
      'Retired in P160 (RR-LEGACY-FALLBACK-REMOVE): MessageIntake sits under V1_HIDDEN_MODULES key "inbox" (defer-v1plus, D-152/D-153) and is deliberately distinct from inbox_list_threads (PRS-M29); must fail closed without executing.',
  },
  {
    legacyKey: 'social.listRecentEngagement',
    disposition: 'OBSOLETE',
    reason:
      'Belongs to the social module, which is hidden in v1 (V1_HIDDEN_MODULES key "social", defer-v1plus, D-152) and has no v1 canonical replacement; must fail closed without executing.',
  },
];

export const LEGACY_TOOL_EQUIVALENCE_BY_KEY: ReadonlyMap<string, LegacyToolEquivalenceEntry> = new Map(
  LEGACY_TOOL_EQUIVALENCE.map((entry) => [entry.legacyKey, entry]),
);

export function getLegacyToolEquivalence(legacyKey: string): LegacyToolEquivalenceEntry | undefined {
  return LEGACY_TOOL_EQUIVALENCE_BY_KEY.get(legacyKey);
}

/**
 * Plain fail-closed refusal message for an OBSOLETE legacy tool.
 */
export function obsoleteLegacyToolRefusal(entry: LegacyToolEquivalenceEntry): string {
  return `Tool "${entry.legacyKey}" is obsolete and cannot be executed: ${entry.reason}`;
}
