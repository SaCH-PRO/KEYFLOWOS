/**
 * FU-PROPOSAL-MONEY-TAG (V1-88 / P131; owner rulings D-238, D-227):
 * Canonical structural money classifier stamped onto every `KeyActionProposal`
 * at creation (`carries_money BOOLEAN`), so proposal visibility stops depending
 * on free-text heuristics alone.
 *
 * Design:
 *   1. `isStructurallyFinancialProposal(proposal)`: inspects ONLY structural
 *      properties — tool authority (organ map, FLOW_TOOLS registry, canonical
 *      module tools), tool input/output schemas, actionType, module,
 *      sourceType, approval requestType, Pro Auto insight category, and genome
 *      domain/section. Used BOTH at creation time and as the read-time
 *      anti-downgrade backstop when `carriesMoney === false`.
 *   2. `structuredPayloadCarriesMoney(value)`: walks JSON trees to arbitrary
 *      depth (bounded cleanly without a 50k string fail-closed cliff), catching
 *      deeply nested money, separate currency fields, spaced 9+ word money
 *      keys, and worded money tokens under id-named keys (`balance_900`) while
 *      exempting count keys (including count keys ending in a digit and nested
 *      count objects like `{ total: { count: 12 } }`).
 *   3. `structuralTextCarriesMoney(text)`: normalizes evasions (HTML entities,
 *      NFKC, NFD combining marks, Cyrillic/Greek homoglyphs, zero-width format
 *      characters) and detects worded amounts and wide-window money figures
 *      while avoiding known over-hiding false positives ("spent 3 hours",
 *      "Meeting with Bill at 10am", Windows path segments like `\trent`,
 *      >50k benign payloads).
 *   4. `computeProposalCarriesMoney(proposal)`: combines (1)+(2)+(3) with
 *      monotonic caller hints (`carriesMoney: true` is never downgraded to
 *      `false`).
 */
import { getToolByName, type ToolParamSchema } from '../ai/flow-tool-registry';
import {
  KEY_ORGAN_TOOLS_UNMAPPED,
  keyOrganToolAuthority,
} from '../key-cortex/key-cortex-organ-tool-authority';
import { CANONICAL_MODULE_TOOLS } from '../structure/job-role-policy.service';

export interface StructuralProposalInput {
  carriesMoney?: boolean | null;
  sourceType?: string | null;
  actionType?: string | null;
  module?: string | null;
  toolName?: string | null;
  title?: string | null;
  summary?: string | null;
  description?: string | null;
  rationale?: string | null;
  expectedBenefit?: string | null;
  risks?: unknown;
  evidence?: unknown;
  payload?: unknown;
  inputPayload?: unknown;
  affectedEntities?: unknown;
  executionResult?: unknown;
  rejectionReason?: string | null;
  failureReason?: string | null;
  /** Optional input schema passed by writers that hold a runtime tool definition (e.g. KeyCortexToolRegistryService). */
  toolSchema?: ToolParamSchema | Record<string, unknown> | null;
}

const MONEY_SCOPES: ReadonlySet<string> = new Set(['revenue', 'expenses']);

const CANONICAL_TOOL_MODULE_MAP: ReadonlyMap<string, string> = new Map(
  Object.entries(CANONICAL_MODULE_TOOLS).flatMap(([mod, tools]) =>
    Object.keys(tools).map((tool): [string, string] => [tool, mod]),
  ),
);

const NON_MONEY_PROPOSAL_ACTIONS: ReadonlySet<string> = new Set([
  'CREATE_TASK',
  'COMPLETE_TASK',
  'CREATE_EVENT',
  'CONFIRM_BOOKING',
  'REBOOK',
  'OPEN',
  'OPEN_GENOME',
  'OPEN_TEMPORAL_FLOW',
  'REVIEW_ASSETS',
  'ENABLE_LOOP',
  'CREATE_LOOP',
  'COMPLETE_SETUP',
  'DISMISS',
  'ACCEPT',
  'REJECT',
  'REQUEST_APPROVAL',
]);

export const NON_MONEY_APPROVAL_REQUEST_TYPES: ReadonlySet<string> = new Set([
  'content_delivery',
  'time_off',
  'task_completion',
  'evidence_verification',
]);

/** Pro Auto insight categories that structurally carry financial/revenue/expense data. */
export const MONEY_PRO_AUTO_CATEGORIES: ReadonlySet<string> = new Set([
  'overdue_invoices',
  'cost_pressure',
  'revenue_trend',
  'client_risk',
]);

const NON_MONEY_PRO_AUTO_TOOLS: ReadonlySet<string> = new Set([
  'monitoring_stale_leads',
  'monitoring_delayed_projects',
  'monitoring_booking_gaps',
  'monitoring_content_stale',
  'monitoring_automation_health',
  'monitoring_pending_bookings',
]);

/** Tools whose authority or data payload structurally touches money even when their primary module is not revenue/expenses. */
const STRUCTURAL_MONEY_TOOL_NAMES: ReadonlySet<string> = new Set([
  'temporal_flow.list_events',
  'temporal_flow.analyze_timeline',
  'storelink.get_analytics',
  'storelink.get_conversion_funnel',
  'storelink.get_product_health',
  'storelink.create_promo_code',
  'storelink.get_portal_dashboard',
  'fetch_revenue_risk',
  'fetch_client_health',
  'fetch_business_summary',
  'fetch_expense_pressure',
  'update_status_with_confirmation',
  'execute_custom_logic',
  'reconcile_connect_statement_source',
  'reconcile_sweep_statements',
  'draft_payment_reminder',
  'bookings.add_service',
  'bookings.update_service',
  'bookings.get_services',
  'bookings_list_services',
  'contracts_stats',
  'contracts_get',
  'contracts_list',
  'contracts_update',
  'contracts_delete',
  'contract_extract_terms',
  'contract_extract_clauses',
  'approval_list',
  'approval_decide_step',
  'monitoring_overdue_invoices',
  'monitoring_cost_pressure',
  'monitoring_revenue_trend',
  'monitoring_client_risk',
]);

const STRUCTURAL_MONEY_TOOL_PREFIXES: readonly string[] = [
  'commerce_',
  'commerce.',
  'payments_',
  'payments.',
  'finance_',
  'finance.',
  'reconcile_',
  'retainers_',
  'expenses_',
  'expenses.',
  'deals_',
  'deals.',
  'payroll_',
  'payroll.',
  'procurement_',
  'procurement.',
  'suppliers_',
  'marketplace_',
  'store_',
  'storelink.',
];

const MONEY_SECTIONS: ReadonlySet<string> = new Set(['BUSINESS_MODEL', 'FINANCIAL', 'FINANCE', 'REVENUE', 'SALES', 'CROSS_DOMAIN']);

const MONEY_TERMS_RE = new RegExp(
  [
    'financ', 'revenue', 'sales', 'commerce', 'payment', 'invoice', 'profit', 'billing', 'refund', 'payroll', 'treasury',
    '(?<!de)commission', '(?<!over)compensat', '(?<![a-z])bonus(?:es)?(?![a-z])', 'incentiv', 'stipend',
    'lifetime', 'acquisition_?cost', 'budget', 'expense', 'conversion', 'forecast', 'churn', 'transaction', 'opportunit',
    'unit_?economics', 'cross_?domain', 'money', 'receivable', 'payable', 'quote', 'quotation', 'reimburs', 'discount',
    '(?<![a-z])promo(?!t)', 'coupon', 'deposit', 'payout', 'purchase', 'wallet', 'ledger', 'salar', 'subscription', 'overdue', 'storelink',
    '(?<![a-z])pric', '(?<![a-z])cash(?!ier)', '(?<![a-z])costs?(?![a-z])', '(?<![a-z])costing', '(?<![a-z])spend',
    '(?<![a-z])margins?(?![a-z])', '(?<![a-z])collections(?![a-z])', '(?<![a-z])charges?(?![a-z])',
    '(?<![a-z])credits?(?![a-z])', '(?<![a-z])wages?(?![a-z])',
    '(?<![a-z])business_model(?![a-z])',
  ].join('|'),
  'i',
);

const MONEY_WORDS_RE = /(?<![a-z])(cac|ltv|mrr|arr|roi|sale|deal|order|tax|vat|fee)s?(?![a-z])/i;
const MONEY_AMOUNT_RE =
  /[$€£¥₹¢]\s?\d|(?<![a-z0-9])(ttd|usd|eur|gbp|jmd|bbd|xcd|cad)\s?\d|(?:(?<![\d.,])[.,]+|(?<![a-z0-9.,]))\d[\d.,]*\s?(ttd|usd|eur|gbp|jmd|bbd|xcd|cad)(?![a-z0-9])/i;

const PROPOSAL_MONEY_WORDS_RE =
  /(?<![a-z])(amounts?|subtotals?|balances?|owed|owes|owing|paid|unpaid|dollars?|euros?|pounds?|cents?|rent|income|earnings?|funds?|rate[\s_-]+cards?)(?![a-z])|(?<![a-z])(pay|pays|paying)(?![a-z])(?!\s+(?:a\s+|close\s+)?(?:visit|attention|heed|respects?|tribute|homage|mind)(?![a-z]))|(?<![a-z])(?:cards?|payments?|transactions?|charges?)\s+(?:was\s+|were\s+|got\s+)?declined|(?<![a-z])declined\s+(?:card|payment|transaction|charge)/i;

const SCHEMA_MONEY_KEY_RE = new RegExp(
  [
    '^(?:currency|currency_code|iso_currency|money_currency)$',
    '^(?:price|unit_price|base_price|sale_price|list_price|amount|subtotal|tax|tax_rate|vat|discount|fee|fees|cost|unit_cost|budget|salary|wage|hourly_rate|pay_rate|rate_per_hour|commission|bonus|stipend|refund|deposit|payout|balance|revenue|margin|profit|deal_value|contract_value|billable|order_total|invoice_total|payment_amount|expense_amount|total_amount|total_price|total_cost|line_total)$',
    '(?:^|_)(?:invoice|payment|quote|expense|bill|billable|payroll|purchase_order|refund|retainer|credit_note|price|amount|cost|budget|currency|discount|tax|fee|salary|wage|commission|balance|revenue|margin|profit|payout|deposit|contract_value)(?:_|s?$|$)',
  ].join('|'),
  'i',
);

const SCHEMA_MONEY_ENTITY_RE =
  /^(?:invoice|quote|payment|expense|deal|contract|payroll|purchaseOrder|purchase_order|bill|refund|retainer|ledger|creditNote|credit_note|order|product|transaction|subscription)s?$/i;

const QUANTITY_KEY_PARTS =
  'counts?|items?|pages?|results?|records?|rows?|tasks?|hits?|matches|entries|contacts?|bookings?|leads?|messages?|tokens?|runs?|ms|duration(?:_?ms)?|latency(?:_?ms)?|steps?|clicks?|views?|shown|users?|members?|events?|calls?|emails?|posts?|files?|attempts?|retries';
const TIME_KEY_PARTS = 'hours?|minutes?|seconds?';
const COUNT_KEY_PARTS = `${QUANTITY_KEY_PARTS}|${TIME_KEY_PARTS}`;

const EXEMPT_COUNT_KEY_RE = new RegExp(
  `^(?:(?:total|totals|time_?spent|spent|tips)_(?:${COUNT_KEY_PARTS})|rate_(?:${QUANTITY_KEY_PARTS}|limit)|(?:response|reply|show|no_?show|completion|open|click|attendance|retention|bounce|success|error|occupancy|star|heart|frame|bit|sample|refresh)_rate)(?:_?\\d+)?$`,
  'i',
);

const PURE_COUNT_LEAF_KEY_RE = new RegExp(`^(?:${COUNT_KEY_PARTS})(?:_?\\d+)?$`, 'i');

const FIGURE_TRIGGER_KEY_RE =
  /(?:^|[_ -])(?:totals?|rates?|bills?|billed|billing|retainers?|tips?|loans?|spent|spend|spending|charged|wire|wired|settle|settled)(?:$|[_ -])/i;

const CURRENCY_KEY_RE = /^(?:currency|currency_code|iso_currency|money_currency)$/i;

const ID_KEY_RE = /(^id$|Ids?$|_ids?$)/;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CUID_RE = /^c(?=[a-z0-9]{0,23}\d)[a-z0-9]{24}$/;
const HEX_DIGEST_RE = /^(?:sha(?:256|512):)?[0-9a-fA-F]{32,512}$/;

/** Common Cyrillic & Greek homoglyphs mapped to ASCII Latin equivalents. */
const CONFUSABLE_MAP: Readonly<Record<string, string>> = {
  '\u0430': 'a', '\u0410': 'A', // Cyrillic а/А
  '\u0435': 'e', '\u0415': 'E', // Cyrillic е/Е
  '\u043e': 'o', '\u041e': 'O', // Cyrillic о/О
  '\u0440': 'p', '\u0420': 'P', // Cyrillic р/Р
  '\u0441': 'c', '\u0421': 'C', // Cyrillic с/С
  '\u0443': 'y', '\u0423': 'Y', // Cyrillic у/У
  '\u0445': 'x', '\u0425': 'X', // Cyrillic х/Х
  '\u0456': 'i', '\u0406': 'I', // Cyrillic і/І
  '\u0458': 'j', '\u0408': 'J', // Cyrillic ј/Ј
  '\u0455': 's', '\u0405': 'S', // Cyrillic ѕ/Ѕ
  '\u0412': 'B', '\u041a': 'K', '\u041c': 'M', '\u041d': 'H', '\u0422': 'T',
  '\u0501': 'd', '\u0261': 'g', '\u04bb': 'h', '\u04cf': 'l', '\u0578': 'n', '\u0475': 'v', '\u051d': 'w',
  '\u03b1': 'a', '\u0391': 'A', // Greek α/Α
  '\u03b5': 'e', '\u0395': 'E', // Greek ε/Ε
  '\u03b9': 'i', '\u0399': 'I', // Greek ι/Ι
  '\u03bf': 'o', '\u039f': 'O', // Greek ο/Ο
  '\u03c1': 'p', '\u03a1': 'P', // Greek ρ/Ρ
  '\u03bd': 'v', '\u03c4': 't', '\u0392': 'B', '\u0396': 'Z', '\u0397': 'H', '\u039a': 'K',
  '\u039c': 'M', '\u039d': 'N', '\u03a4': 'T', '\u03a5': 'Y', '\u03a7': 'X',
};

const CONFUSABLE_RE = new RegExp(`[${Object.keys(CONFUSABLE_MAP).join('')}]`, 'g');

const HTML_NAMED_ENTITIES: Readonly<Record<string, string>> = {
  dollar: '$',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  nbsp: ' ',
  amp: '&',
};

const WORDED_UNIT =
  '(?:(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[\\s-]+(?:one|two|three|four|five|six|seven|eight|nine))?|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen))';
const WORDED_NUMBER = `${WORDED_UNIT}(?:\\s+(?:hundred|thousand|million|billion))+(?:\\s+(?:and\\s+)?${WORDED_UNIT})?`;
const WORDED_MONEY_RE = new RegExp(
  `(?<![a-z])(?:totals?|subtotals?|amounts?|balances?|rates?|bills?|bill(?:ed|ing)?|settle(?:s|d)?|wire[sd]?|retainers?|tips?|loans?|spent|spend(?:s|ing)?|charged|pay|pays|paying|due|owed|owes|fees?|costs?|pric(?:e|ed|ing)|deposits?|refunds?)(?![a-z])(?:[\\s,:;=—–-]+[a-z0-9'-]{1,24}){0,8}[\\s,:;=—–-]+${WORDED_NUMBER}(?![a-z])|(?<![a-z])${WORDED_NUMBER}\\s+(?:dollars?|euros?|pounds?|cents?|bucks?|ttd|usd|eur|gbp|jmd|bbd|xcd|cad)(?![a-z])`,
  'i',
);

const DATE_OR_PHONE_FRAG = '(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}/\\d{1,2}/(?:\\d{4}|\\d{2})|\\d{3}-\\d{3}-\\d{4})(?![\\d.,])';
const TIME_OF_DAY_FRAG = '(?:\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)(?![a-z])|\\d{1,2}:\\d{2}(?::\\d{2})?(?!\\d))';
const NON_MONEY_FIGURE_GUARD = `(?!${DATE_OR_PHONE_FRAG}|${TIME_OF_DAY_FRAG})`;

/** Wide-window money figure detection (up to 12 words in same clause) without over-hiding on durations, times, or person names. */
const WIDE_MONEY_WORD_FIGURE_RE = new RegExp(
  [
    `(?<!(?:response|reply|show|no[\\s_-]?show|completion|open|click|attendance|retention|bounce|success|error|occupancy|star|heart|frame|bit|sample|refresh)[\\s_]?)(?<![a-z])rates?(?![\\s_-]*limit)(?![a-z])(?:[\\s_,:;()=*~>—–-]+(?:[a-z0-9'/-]{1,30})){0,12}[\\s_,:;()=*~>—–-]+[$€£¥₹]?${NON_MONEY_FIGURE_GUARD}\\d`,
    `(?<![a-z])(?:totals?|retainers?|loans?|charged|wire[sd]?|settle(?:s|d)?|bill(?:s|ed|ing)?|tips?|spent|spend(?:s|ing)?|transfer(?:s|red)?)(?![a-z])(?:[\\s_,:;()=*~>—–-]+(?:[a-z0-9'/-]{1,30})){0,12}[\\s_,:;()=*~>—–-]+[$€£¥₹]?${NON_MONEY_FIGURE_GUARD}\\d`,
    `(?:(?<![\\d.,])[.,]+|(?<![\\d.,]))[$€£¥₹]?\\d[\\d,.]*(?:\\s*k)?\\s+(?:outstanding|owed|overdue|unpaid|past\\s+due)(?![a-z])`,
  ].join('|'),
  'i',
);

const BENIGN_DURATION_RE =
  /(?<![a-z])(?:spent|spend(?:s|ing)?)\s+(?:about\s+|around\s+|nearly\s+|over\s+|under\s+|roughly\s+)?\d+(?:[.,]\d+)?\s*(?:hours?|hrs?|minutes?|mins?|seconds?|secs?|days?|weeks?|months?)(?![a-z])/gi;

const BENIGN_PERSON_BILL_RE =
  /\b(?:with|call|calling|called|meet|meeting|met|email|emailing|emailed|text|texting|texted|message|messaging|messaged|from|to|ask|asking|asked|tell|telling|told|notify|notifying|notified|ping|pinging|pinged|thank|thanking|thanked|contact|contacting|contacted|join|joining|joined|sync\s+with)\s+Bill\b/g;

const BENIGN_COUNT_PHRASE_RE = new RegExp(
  `(?<![a-z])(?:total(?:\\s+of)?\\s+\\d+\\s+(?:${COUNT_KEY_PARTS}|forms?|tickets?|issues?|bugs?|projects?)|transfer(?:s|red)?\\s+(?:the\\s+)?\\d+\\s+(?:files?|docs?|documents?|tickets?|tasks?|leads?|contacts?|items?|folders?)|tips?\\s+(?:for|on)\\s+(?:the\\s+)?\\d+\\s+(?:posts?|articles?|videos?|slides?|steps?)|settle(?:s|d)?\\s+(?:the\\s+)?\\d+\\s+(?:open\\s+)?(?:tickets?|issues?|bugs?|tasks?)|wire\\s+up\\s+(?:the\\s+)?\\d+\\s+(?:forms?|pages?|routes?|endpoints?|buttons?|components?))(?![a-z])`,
  'gi',
);

function splitHumps(v: string): string {
  return v.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
}

function normalizeKey(key: string): string {
  return splitHumps(key).trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function isMoneyLabelText(v: string | null | undefined): boolean {
  if (typeof v !== 'string' || !v.trim()) return false;
  if (MONEY_SECTIONS.has(v.trim().toUpperCase())) return true;
  return [v, splitHumps(v)].some((t) => MONEY_TERMS_RE.test(t) || MONEY_WORDS_RE.test(t) || MONEY_AMOUNT_RE.test(t));
}

function extractToolName(proposal: StructuralProposalInput): string | null {
  if (typeof proposal.toolName === 'string' && proposal.toolName.trim()) {
    return proposal.toolName.trim();
  }
  for (const container of [proposal.payload, proposal.inputPayload]) {
    if (container && typeof container === 'object' && !Array.isArray(container)) {
      const candidate = (container as Record<string, unknown>).toolName;
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
  }
  return null;
}

function extractRequestType(proposal: StructuralProposalInput): string | null {
  for (const source of [proposal.affectedEntities, proposal.payload, proposal.inputPayload]) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    const rec = source as Record<string, unknown>;
    const t = rec.requestType;
    if (t !== undefined && t !== null) return typeof t === 'string' ? t.trim().toLowerCase() : '?';
    const nestedParams = rec.params ?? rec.args ?? rec.input ?? rec.arguments;
    if (nestedParams && typeof nestedParams === 'object' && !Array.isArray(nestedParams)) {
      const nt = (nestedParams as Record<string, unknown>).requestType;
      if (nt !== undefined && nt !== null) return typeof nt === 'string' ? nt.trim().toLowerCase() : '?';
    }
  }
  return null;
}

function extractHasThreshold(proposal: StructuralProposalInput): boolean {
  for (const source of [proposal.affectedEntities, proposal.payload, proposal.inputPayload]) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    const rec = source as Record<string, unknown>;
    if ('threshold' in rec && rec.threshold !== null && rec.threshold !== undefined && rec.threshold !== '') {
      return true;
    }
    const nestedParams = rec.params ?? rec.args ?? rec.input ?? rec.arguments;
    if (nestedParams && typeof nestedParams === 'object' && !Array.isArray(nestedParams)) {
      const pRec = nestedParams as Record<string, unknown>;
      if ('threshold' in pRec && pRec.threshold !== null && pRec.threshold !== undefined && pRec.threshold !== '') {
        return true;
      }
    }
  }
  return false;
}

function extractStringField(sources: unknown[], key: string): string | null {
  for (const source of sources) {
    if (source && typeof source === 'object' && !Array.isArray(source)) {
      const v = (source as Record<string, unknown>)[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  return null;
}

/**
 * Inspects a tool's parameter schema (FLOW_TOOLS `ToolParamSchema` or KEY Cortex
 * `KeyCortexToolDefinition.parameters`) for financial field names.
 */
export function toolSchemaCarriesMoney(schema: ToolParamSchema | Record<string, unknown> | null | undefined): boolean {
  if (!schema || typeof schema !== 'object') return false;
  const props =
    'properties' in schema && schema.properties && typeof schema.properties === 'object'
      ? (schema.properties as Record<string, unknown>)
      : (schema as Record<string, unknown>);
  const keys = Object.keys(props);
  for (const rawKey of keys) {
    const norm = normalizeKey(rawKey);
    if (SCHEMA_MONEY_KEY_RE.test(norm)) return true;
    const def = props[rawKey];
    if (def && typeof def === 'object') {
      const nestedItems = (def as Record<string, unknown>).items;
      if (nestedItems && typeof nestedItems === 'object' && 'properties' in nestedItems) {
        if (toolSchemaCarriesMoney(nestedItems as Record<string, unknown>)) return true;
      }
      if ('properties' in def) {
        if (toolSchemaCarriesMoney(def as Record<string, unknown>)) return true;
      }
    }
  }
  return false;
}

/**
 * Determines whether a tool name is structurally financial by authority map,
 * canonical module mapping, FLOW_TOOLS input/output schema, or known tool lists.
 * Unknown/unmapped tools always fail closed (`true`).
 */
export function isStructurallyFinancialTool(toolName: string, seen = new Set<string>()): boolean {
  const tool = toolName.trim();
  if (!tool || seen.has(tool)) return true;
  seen.add(tool);

  const lower = tool.toLowerCase();
  if (NON_MONEY_PRO_AUTO_TOOLS.has(lower)) return false;
  if (STRUCTURAL_MONEY_TOOL_NAMES.has(lower)) return true;
  if (STRUCTURAL_MONEY_TOOL_PREFIXES.some((prefix) => lower.startsWith(prefix))) return true;
  if (isMoneyLabelText(tool) || PROPOSAL_MONEY_WORDS_RE.test(tool) || PROPOSAL_MONEY_WORDS_RE.test(splitHumps(tool))) {
    return true;
  }

  if (Object.prototype.hasOwnProperty.call(KEY_ORGAN_TOOLS_UNMAPPED, tool)) return true;

  const candidates = tool.includes('.') ? [tool, lower.replace(/\./g, '_')] : [tool];
  let knownTool = false;

  for (const candidate of candidates) {
    if (STRUCTURAL_MONEY_TOOL_NAMES.has(candidate.toLowerCase())) return true;
    if (Object.prototype.hasOwnProperty.call(KEY_ORGAN_TOOLS_UNMAPPED, candidate)) return true;

    const organ = keyOrganToolAuthority(candidate);
    if (organ) {
      knownTool = true;
      if ('twin' in organ) {
        if (isStructurallyFinancialTool(organ.twin, seen)) return true;
      } else if (organ.scopes.some((s) => MONEY_SCOPES.has(s.module))) {
        return true;
      }
    }

    const canonicalMod = CANONICAL_TOOL_MODULE_MAP.get(candidate);
    if (canonicalMod) {
      knownTool = true;
      if (MONEY_SCOPES.has(canonicalMod)) return true;
    }

    const flowTool = getToolByName(candidate);
    if (flowTool) {
      knownTool = true;
      if (toolSchemaCarriesMoney(flowTool.parameters)) return true;
      if (Array.isArray(flowTool.changedEntities) && flowTool.changedEntities.some((e) => SCHEMA_MONEY_ENTITY_RE.test(e))) {
        return true;
      }
    }
  }

  // Known non-financial tool (verified across organ authority, canonical module map,
  // and FLOW_TOOLS schema/entities); any unknown/unmapped tool fails closed.
  return !knownTool;
}

/**
 * Pure structural classification (no free-text over-hiding):
 * returns `true` when the proposal's tool authority, tool input schema,
 * actionType, module, requestType, Pro Auto category, or genome domain/section
 * is financial or unclassifiable (fail closed).
 */
export function isStructurallyFinancialProposal(proposal: StructuralProposalInput | null | undefined): boolean {
  if (!proposal) return true;

  const { actionType, module, sourceType } = proposal;

  if (isMoneyLabelText(actionType) || isMoneyLabelText(module)) return true;

  if (proposal.toolSchema && toolSchemaCarriesMoney(proposal.toolSchema)) return true;

  const tool = extractToolName(proposal);
  if (tool && isStructurallyFinancialTool(tool)) return true;

  // Genome-bridged or DNA proposals naming a financial domain/section.
  const domain = extractStringField([proposal.payload, proposal.inputPayload], 'domain');
  const section = extractStringField([proposal.payload, proposal.inputPayload], 'section');
  if (isMoneyLabelText(domain) || isMoneyLabelText(section)) return true;

  // Pro Auto monitoring category check.
  if (sourceType === 'PRO_AUTO') {
    const category = extractStringField([proposal.payload, proposal.inputPayload], 'category');
    if (category && MONEY_PRO_AUTO_CATEGORIES.has(category.toLowerCase())) return true;
    const suggestedTool = extractStringField([proposal.payload, proposal.inputPayload], 'suggestedTool');
    if (suggestedTool && isStructurallyFinancialTool(suggestedTool)) return true;
  }

  const normalizedActionType = typeof actionType === 'string' ? actionType.trim().toUpperCase() : '';

  // Approval requests (both REQUEST_APPROVAL actions and approval_create_request tool calls):
  // fail closed on threshold or non-allowlisted requestType, and fail closed when requestType
  // is missing on approval_create_request or HUMAN_WORKFLOW shadow proposals.
  const isApprovalTool = tool !== null && tool.toLowerCase() === 'approval_create_request';
  const isApprovalAction = normalizedActionType === 'REQUEST_APPROVAL';
  if (isApprovalTool || isApprovalAction) {
    if (extractHasThreshold(proposal)) return true;
    const requestType = extractRequestType(proposal);
    if (requestType !== null) {
      return !NON_MONEY_APPROVAL_REQUEST_TYPES.has(requestType);
    }
    if (isApprovalTool || sourceType === 'HUMAN_WORKFLOW') return true;
    return false;
  }

  // EXECUTE_TOOL without a resolvable tool name must fail closed.
  if (normalizedActionType === 'EXECUTE_TOOL') {
    return !tool;
  }

  // Known non-financial tool (verified above) makes a tool-bearing proposal non-financial structurally.
  if (tool) return false;

  if (normalizedActionType && NON_MONEY_PROPOSAL_ACTIONS.has(normalizedActionType)) {
    return false;
  }

  // Unclassified / unknown actionType fails closed (no blind module-only fallback).
  return true;
}

/** Decode HTML decimal/hex/named currency entities in linear time. */
function decodeHtmlEntities(input: string): string {
  if (!input.includes('&')) return input;
  return input
    .replace(/&#x([0-9a-fA-F]{1,6});/g, (m, hex: string) => {
      const cp = parseInt(hex, 16);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    })
    .replace(/&#(\d{1,7});/g, (m, dec: string) => {
      const cp = parseInt(dec, 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    })
    .replace(/&([a-zA-Z]{2,10});/g, (m, name: string) => HTML_NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

/** Replace backslashes inside Windows paths (`C:\foo\bar` or `\\server\share`) with spaces so `\trent` is never split as `\t` + `rent`. */
function neutralizeWindowsPathBackslashes(input: string): string {
  if (!input.includes('\\')) return input;
  return input.replace(/(?:[A-Za-z]:\\|\\\\)[^\s"'<>|]+/g, (match) => match.replace(/\\/g, ' '));
}

function stripOpaqueIds(text: string): string {
  return text
    .replace(/(?<![A-Za-z0-9])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![A-Za-z0-9])/gi, ' ')
    .replace(/(?<![A-Za-z0-9-])c(?=[a-z0-9]{0,23}\d)[a-z0-9]{24}(?![A-Za-z0-9-])/g, (run) =>
      run.split(/\d+/).some((letters) => letters.length >= 5 && (MONEY_TERMS_RE.test(letters) || PROPOSAL_MONEY_WORDS_RE.test(letters)))
        ? run
        : ' ',
    )
    .replace(/(?<![A-Za-z0-9-])[0-9a-fA-F]{32,512}(?![A-Za-z0-9-])/g, (run) => {
      const digits = run.replace(/\D/g, '').length;
      return digits >= 6 && run.length - digits >= 6 ? ' ' : run;
    });
}

function checkNormalizedTextForMoney(raw: string): boolean {
  const cleaned = stripOpaqueIds(raw);
  const forms = [cleaned, splitHumps(cleaned)];
  for (const t of forms) {
    if (MONEY_TERMS_RE.test(t) || MONEY_WORDS_RE.test(t) || MONEY_AMOUNT_RE.test(t) || PROPOSAL_MONEY_WORDS_RE.test(t)) {
      return true;
    }
    if (WORDED_MONEY_RE.test(t)) return true;
  }

  // Strip known benign over-hiding phrases before wide-window figure matching.
  const withoutBenign = cleaned
    .replace(BENIGN_PERSON_BILL_RE, ' ')
    .replace(BENIGN_DURATION_RE, ' ')
    .replace(BENIGN_COUNT_PHRASE_RE, ' ');

  if (WIDE_MONEY_WORD_FIGURE_RE.test(withoutBenign) || WIDE_MONEY_WORD_FIGURE_RE.test(splitHumps(withoutBenign))) {
    return true;
  }

  return false;
}

const MAX_STRUCTURAL_TEXT_SCAN = 500_000;

/**
 * Evasion-resistant, non-over-hiding text money detector used at proposal
 * creation time. Handles HTML entities, NFD combining marks, Cyrillic/Greek
 * homoglyphs, zero-width characters, worded amounts, and wide-window figures
 * without over-hiding on benign durations ("spent 3 hours"), person+time
 * ("Meeting with Bill at 10am"), Windows paths (`C:\trent\notes.txt`), or
 * >50,000-character non-financial descriptions.
 */
export function structuralTextCarriesMoney(text: string | null | undefined): boolean {
  if (typeof text !== 'string' || text.length === 0) return false;
  if (text.length > MAX_STRUCTURAL_TEXT_SCAN) return true;

  const pathSafe = neutralizeWindowsPathBackslashes(text);
  const htmlDecoded = decodeHtmlEntities(pathSafe);
  const nfkc = htmlDecoded.normalize('NFKC');
  const strippedMarks = nfkc.normalize('NFD').replace(/\p{Mn}+/gu, '');
  const folded = strippedMarks.replace(CONFUSABLE_RE, (ch) => CONFUSABLE_MAP[ch] ?? ch);

  const candidates = new Set<string>([pathSafe, folded]);
  if (/\p{Cf}/u.test(folded)) {
    candidates.add(folded.replace(/\p{Cf}+/gu, ''));
    candidates.add(folded.replace(/\p{Cf}+/gu, ' '));
  }
  if (folded.includes('\\')) {
    const unescaped = folded
      .replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/\\[bfnrt]/g, ' ')
      .replace(/\\/g, ' ');
    candidates.add(unescaped);
  }

  for (const candidate of candidates) {
    if (checkNormalizedTextForMoney(candidate)) return true;
  }
  return false;
}

function idTokenCarriesMoney(val: unknown): boolean {
  if (typeof val !== 'string') return false;
  const trimmed = val.trim();
  if (!trimmed) return false;
  if (UUID_RE.test(trimmed)) return false;
  if (HEX_DIGEST_RE.test(trimmed)) {
    const digits = trimmed.replace(/\D/g, '').length;
    if (digits >= 6 && trimmed.length - digits >= 6) return false;
  }
  if (CUID_RE.test(trimmed)) {
    return trimmed
      .split(/\d+/)
      .some((letters) => letters.length >= 5 && (MONEY_TERMS_RE.test(letters) || PROPOSAL_MONEY_WORDS_RE.test(letters)));
  }
  if (structuralTextCarriesMoney(trimmed)) return true;
  const spaced = trimmed.replace(/[_-]+/g, ' ');
  return spaced !== trimmed && structuralTextCarriesMoney(spaced);
}

function subtreeHasNumericValue(val: unknown, depth = 0): boolean {
  if (depth > 16) return true; // fail closed on extreme depth under a money-trigger key
  if (typeof val === 'number') return Number.isFinite(val);
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return false;
    if (/^[$€£¥₹¢]?-?\d[\d,.]*(?:\s*%)?$/.test(trimmed)) return true;
    if (new RegExp(`\\b${WORDED_NUMBER}\\b`, 'i').test(trimmed)) return true;
    return false;
  }
  if (Array.isArray(val)) {
    return val.some((item) => subtreeHasNumericValue(item, depth + 1));
  }
  if (val && typeof val === 'object') {
    for (const child of Object.values(val as Record<string, unknown>)) {
      if (subtreeHasNumericValue(child, depth + 1)) return true;
    }
  }
  return false;
}

function isNestedCountObject(val: unknown): boolean {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return false;
  const entries = Object.entries(val as Record<string, unknown>);
  if (entries.length === 0) return false;
  return entries.every(([k, v]) => {
    const norm = normalizeKey(k);
    if (!PURE_COUNT_LEAF_KEY_RE.test(norm)) return false;
    return v === null || v === undefined || typeof v === 'number' || typeof v === 'boolean';
  });
}

const MAX_WALK_DEPTH = 24;
const MAX_WALK_NODES = 10_000;

/**
 * Walks a structured payload / evidence / result tree to detect money fields
 * at ANY nesting depth (including after sibling fields, separate `currency`
 * fields, spaced 9+ word money keys, `toJSON()` outputs, and `$500`/`usd_500`/
 * `balance_900` under id-named keys) while exempting count keys (e.g.
 * `totalCount2`, `total_items_2`, `{ total: { count: 12 } }`). Fails closed on
 * cycles or unreadable objects.
 */
export function structuredPayloadCarriesMoney(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return structuralTextCarriesMoney(value);
  if (typeof value === 'number' || typeof value === 'boolean') return false;
  if (typeof value === 'bigint') return true;
  if (typeof value !== 'object') return false;

  let visited = 0;
  const stack = new Set<object>();

  const walk = (node: unknown, depth: number): boolean => {
    if (node === null || node === undefined) return false;
    if (typeof node === 'string') return structuralTextCarriesMoney(node);
    if (typeof node === 'number' || typeof node === 'boolean') return false;
    if (typeof node === 'bigint') return true;
    if (typeof node !== 'object') return false;

    if (depth > MAX_WALK_DEPTH || ++visited > MAX_WALK_NODES) return true;
    if (stack.has(node)) return true; // cycle -> fail closed
    stack.add(node);

    try {
      if (typeof (node as { toJSON?: unknown }).toJSON === 'function') {
        let serialized: unknown;
        try {
          serialized = (node as { toJSON: () => unknown }).toJSON();
        } catch {
          return true; // throwing toJSON -> fail closed
        }
        if (serialized !== node) {
          return walk(serialized, depth + 1);
        }
      }

      if (Array.isArray(node)) {
        for (const item of node) {
          if (walk(item, depth + 1)) return true;
        }
        return false;
      }

      for (const [rawKey, val] of Object.entries(node as Record<string, unknown>)) {
        const normKey = normalizeKey(rawKey);

        // Separate currency field (e.g. { currency: 'TTD', value: 500 })
        if (CURRENCY_KEY_RE.test(normKey) && val !== null && val !== undefined && val !== '') {
          return true;
        }

        // Exempt count/duration/non-money-metric keys (including count keys ending in a digit)
        if (EXEMPT_COUNT_KEY_RE.test(normKey)) {
          if (val === null || val === undefined || typeof val === 'number' || typeof val === 'boolean') {
            continue;
          }
          if (typeof val === 'string' && !structuralTextCarriesMoney(val)) {
            continue;
          }
        }

        // Exempt nested count objects under `total` / `totals` (e.g. `{ stats: { total: { count: 12, items: 5 } } }`)
        if (/^totals?$/i.test(normKey) && isNestedCountObject(val)) {
          continue;
        }

        // ID-named keys: inspect for money tokens (`$500`, `usd_500`, `total_900`, `balance_900`, homoglyphs)
        // and financial entity key names (`invoiceId`, `paymentId`, `balanceId`, `rentId`, etc.).
        if (ID_KEY_RE.test(rawKey)) {
          const idKeyIsMoney =
            isMoneyLabelText(rawKey) ||
            PROPOSAL_MONEY_WORDS_RE.test(rawKey) ||
            PROPOSAL_MONEY_WORDS_RE.test(splitHumps(rawKey)) ||
            SCHEMA_MONEY_KEY_RE.test(normKey);
          if (typeof val === 'string') {
            if (idKeyIsMoney || idTokenCarriesMoney(val)) return true;
            continue;
          }
          if (Array.isArray(val) && val.every((item) => typeof item === 'string')) {
            if (idKeyIsMoney || val.some((item) => idTokenCarriesMoney(item))) return true;
            continue;
          }
        }

        // Unambiguous money key names (including camelCase, snake_case, spaced keys, control chars in keys)
        const keyText = rawKey.replace(/\p{Cc}+/gu, ' ');
        if (
          isMoneyLabelText(keyText) ||
          SCHEMA_MONEY_KEY_RE.test(normKey) ||
          PROPOSAL_MONEY_WORDS_RE.test(keyText) ||
          PROPOSAL_MONEY_WORDS_RE.test(splitHumps(keyText))
        ) {
          return true;
        }

        // Figure-trigger keys (`total`, `grandTotal`, `hourlyRate`, `monthlyRetainer`, `total due for...`, etc.)
        // with numeric or worded-number values at ANY nesting depth (including after sibling fields!)
        if (FIGURE_TRIGGER_KEY_RE.test(keyText) || FIGURE_TRIGGER_KEY_RE.test(normKey)) {
          if (subtreeHasNumericValue(val)) return true;
        }

        // Recurse into value
        if (walk(val, depth + 1)) return true;
      }
      return false;
    } catch {
      return true; // unreadable -> fail closed
    } finally {
      stack.delete(node);
    }
  };

  return walk(value, 0);
}

/**
 * Monotonic merge for `carriesMoney` updates: once `true`, NEVER silently
 * downgrades to `false`.
 */
export function monotonicCarriesMoney(existing: boolean | null | undefined, next: boolean): boolean {
  return existing === true || next === true;
}

/**
 * Authoritative structural money tag computed at proposal creation:
 *   1. Monotonic caller provenance (`carriesMoney === true` stays `true`).
 *   2. Structural tool authority / input schema / actionType / module /
 *      requestType / Pro Auto category / genome domain (`isStructurallyFinancialProposal`).
 *   3. Deep structured payload/evidence/affectedEntities/executionResult walk.
 *   4. Evasion-resistant, non-over-hiding text scan of title/summary/description/etc.
 */
export function computeProposalCarriesMoney(proposal: StructuralProposalInput): boolean {
  if (proposal.carriesMoney === true) return true;
  if (isStructurallyFinancialProposal(proposal)) return true;

  for (const field of [
    proposal.payload,
    proposal.inputPayload,
    proposal.affectedEntities,
    proposal.evidence,
    proposal.risks,
    proposal.executionResult,
  ]) {
    if (field !== null && field !== undefined && structuredPayloadCarriesMoney(field)) {
      return true;
    }
  }

  for (const text of [
    proposal.title,
    proposal.summary,
    proposal.description,
    proposal.rationale,
    proposal.expectedBenefit,
    proposal.rejectionReason,
  ]) {
    if (typeof text === 'string' && structuralTextCarriesMoney(text)) {
      return true;
    }
  }

  return false;
}
