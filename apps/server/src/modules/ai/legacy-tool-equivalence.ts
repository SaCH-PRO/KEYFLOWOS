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
    disposition: 'SPECIALIZATION',
    reason:
      'Enforces D-260 sent-only overdue statuses (SENT, OVERDUE, PARTIALLY_PAID, PARTIALLY_CREDITED) with per-currency totalsByCurrency and limit; canonical finance_view_receivables includes PENDING per D-256 and fetch_revenue_risk filters SENT/DRAFT. Kept legacy until RR-LEGACY-FALLBACK-REMOVE.',
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
    disposition: 'SPECIALIZATION',
    reason:
      'Deterministic tier-2 template draft enforcing D-260 sent-only overdue checks and credit-aware remaining balance; canonical draft_payment_reminder is tier 1 (aliasing would loosen riskTier 2 -> 1 and drop D-260 guards) and calls an LLM. Kept legacy until RR-LEGACY-FALLBACK-REMOVE.',
  },
  {
    legacyKey: 'contacts.recommendFollowUps',
    disposition: 'SPECIALIZATION',
    reason:
      'Returns individual stale contacts with daysSinceContact filtered by the caller CRM visibility clause (scopeContacts); canonical fetch_client_health returns aggregate counts only and create_followup_queue is a tier-2 write. Kept legacy until RR-LEGACY-FALLBACK-REMOVE.',
  },
  {
    legacyKey: 'contacts.createCommandItem',
    disposition: 'MISSING',
    reason:
      'Creates a universal-queue CommandItem via CommandService.create; FLOW_TOOLS only exposes obligation list/discharge tools (command_list_due_obligations, command_discharge_obligation) and has no item-creation tool yet. Kept legacy until RR-LEGACY-FALLBACK-REMOVE.',
  },
  {
    legacyKey: 'commerce.summarizeRevenue',
    disposition: 'SPECIALIZATION',
    reason:
      'Returns all-time PAID invoice totalRevenue, paidInvoiceCount, and currency with empty input under revenue:read; canonical finance_profit_and_loss and finance_revenue_breakdown require date ranges, fetch_revenue_risk computes 30d risk metrics, and fetch_business_summary requires expenses:read. Kept legacy until RR-LEGACY-FALLBACK-REMOVE.',
  },
  {
    legacyKey: 'timeline.createReminder',
    disposition: 'SPECIALIZATION',
    reason:
      'Creates a ContactTask reminder with optional contactId; canonical create_task (tier 2) and crm_add_task (tier 1) both require a contactId via CrmService.addTask. Kept legacy until RR-LEGACY-FALLBACK-REMOVE.',
  },
  {
    legacyKey: 'connect.scanDrive',
    disposition: 'MISSING',
    reason:
      'Triggers ConnectorIntelligenceService.syncGoogleDrive under D-99 owner-only enforcement; canonical reconcile_sweep_statements only sweeps a single bank account statement source. Kept legacy until RR-LEGACY-FALLBACK-REMOVE.',
  },
  {
    legacyKey: 'connect.listDriveIntake',
    disposition: 'MISSING',
    reason:
      'Lists driveIntakeFile rows awaiting review; no canonical Drive intake list tool exists in FLOW_TOOLS yet. Kept legacy until RR-LEGACY-FALLBACK-REMOVE.',
  },
  {
    legacyKey: 'messages.listMessageIntake',
    disposition: 'MISSING',
    reason:
      'Lists MessageIntake approval-queue rows; deliberately distinct from canonical inbox_list_threads which reads inbox threads (PRS-M29). Kept legacy until RR-LEGACY-FALLBACK-REMOVE.',
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
