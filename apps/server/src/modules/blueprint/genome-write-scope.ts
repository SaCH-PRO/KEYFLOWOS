/**
 * FU-GENOME-DNA-WRITES-AND-INTEGRITY (owner ruling D-128: genome finance is written by revenue-write members): which
 * genome writes are financial. One rule for every member-facing write of the blueprint or its DNA: PATCH blueprint,
 * PATCH genome/dna/:section, POST infer/onboarding and genome-chat apply-updates.
 *
 * A write is financial when any of these holds (agreed with the orchestrator in round 1):
 *   (a) the DNA section is financial, sales or unknown (any section but the non-money ones the evolution gate lists), or
 *       a blueprint column is financials, projectionProfile, salesSystem, offerArchitecture or unknown;
 *   (b) the patch sets a listed money field anywhere in it (MONEY_FIELDS), whatever its value, empty included;
 *   (c) a value (never a key) states money by the shared vocabulary.
 *
 * Field names and bare digits alone do not make a write financial: unlike the read side (isFinancialGenomeEvolution,
 * which withholds any figure), a write of the legal card (vatStatus), an operations step ("take orders"), founder hours
 * or a phone number is ordinary genome editing for any member who may write the genome.
 *
 * Residual, accepted (orchestrator, round 1): a target written as a bare figure with no money word ("Hit 120k this
 * quarter" in a growth step) is writable by a member without revenue write. It is withheld on every read
 * (isFinancialGenomeEvolution, the DNA projections).
 */
import { nonMoneySection } from '../key-autonomy/key-action-genome-projection';
import { dnaScoresForReader, structuredValueStatesMoney } from '../business-genome/key-genome/genome-finance-scope';

/**
 * The blueprint columns behind the financial and sales DNA sections (DNA_SECTION_CONFIG: financials and
 * projectionProfile, salesSystem) and the offer architecture (the offer ladder: the business model and pricing, D-234).
 */
export const MONEY_BLUEPRINT_COLUMNS: ReadonlySet<string> = new Set(['financials', 'projectionProfile', 'salesSystem', 'offerArchitecture']);
/** Every other blueprint column (BlueprintSectionKey); a column listed in neither set fails closed. */
export const OTHER_BLUEPRINT_COLUMNS: ReadonlySet<string> = new Set([
  'identity', 'operatingModel', 'goals', 'constraints', 'brand', 'customerModel', 'intelligence', 'workflowModel',
  'aiPreferences', 'founderProfile', 'legalProfile', 'registrationProfile', 'taxProfile', 'ownershipProfile',
  'marketProfile', 'marketingSystem', 'operationsSystem', 'riskProfile', 'complianceProfile', 'executionRoadmap',
  'documentProfile',
]);

/**
 * The money fields written outside the money columns and sections: the business DNA's revenue model and budget
 * (operatingModel, constraints), the risk DNA's financial risks, the tax profile's estimated annual revenue, and the
 * financial DNA's own fields wherever they appear. Matched by exact name, case-insensitively, at any depth.
 */
export const MONEY_FIELDS: ReadonlySet<string> = new Set([
  'revenuemodel', 'budgetrange', 'financialrisks', 'pricingmodel', 'avgticket', 'averageticket', 'monthlytarget',
  'startupcapital', 'startupcosts', 'monthlyfixedcosts', 'variablecostpercent', 'estimatedannualrevenue', 'currency',
  // SEC-DW-1 / COR-1: financial fields inside intelligence, workflowModel, taxProfile, and common snake/camel variants.
  'expenseratio', 'quoteconversionrate', 'recentmomentumscore', 'topproductcategories',
  'retainercycle', 'quotedrivensales', 'ecommercefulfillment',
  'vatthresholdwatch', 'payrollexpected', 'contractorpaymentsexpected',
  'runwaymonths', 'coststructure', 'monthlyrevenue', 'annualrevenue', 'grossmargin', 'netmargin', 'breakeven',
  'cashflow', 'burnrate', 'debt', 'loan', 'funding', 'valuation', 'profitmargin', 'monthlyexpenses',
  'fixedcosts', 'variablecosts', 'operatingcosts', 'pricing', 'price', 'rates', 'ratecard',
  'revenue', 'sales', 'income', 'profit', 'margin', 'budget', 'payroll', 'salary', 'wages',
  'commission', 'discount', 'refund', 'invoice', 'billing', 'receivables', 'payables',
]);

/** Deeper than this fails closed. */
const MAX_DEPTH = 8;

function normalizeFieldKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function setsMoneyField(value: unknown, depth = 0): boolean {
  if (depth > MAX_DEPTH) return true;
  if (Array.isArray(value)) return value.some((v) => setsMoneyField(v, depth + 1));
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(
    ([key, v]) => MONEY_FIELDS.has(normalizeFieldKey(key)) || setsMoneyField(v, depth + 1),
  );
}

/**
 * An operations step names orders ("take orders", "pack orders"), which the shared vocabulary reads as money for
 * proposals and reads. On a write, strip bare operational "orders" ONLY when it is not part of a financial phrase
 * ("average order value", "average_order_value", "order-total", "orders: 500") or paired with a quantity
 * ("500 orders", "500k orders", "200 monthly orders") (SEC-DW-6). Strictly linear O(N) — no overlapping quantifiers.
 */
const ORDER_WORD = /(?<![a-z])orders?(?![a-z])/gi;
const FINANCIAL_ORDER =
  /(?:(?<![a-z])(?:average|avg|mean|total|minimum|min|max|median)[\s_-]+orders?(?![a-z])|(?<![a-z])orders?(?:[\s_-]+(?:value|total|amount|size|revenue|price|volume|count)(?![a-z])|(?:\s+per\s+(?:day|week|month|quarter|year))?\s*(?:[:=]\s*)?\d)|(?<![\d,.])[.,]*\d[\d,.]*(?:\s*(?:k|m|mm|mn|bn|\+))?(?:\s+(?:daily|weekly|monthly|quarterly|annual|yearly))?\s+orders?(?![a-z]))/i;

function sanitizeOperationalOrders(text: string): string {
  if (FINANCIAL_ORDER.test(text)) return text;
  return text.replace(ORDER_WORD, ' ');
}

function valueStatesMoney(value: unknown, depth = 0): boolean {
  if (depth > MAX_DEPTH) return true;
  if (typeof value === 'string') return structuredValueStatesMoney(sanitizeOperationalOrders(value));
  if (Array.isArray(value)) return value.some((v) => valueStatesMoney(v, depth + 1));
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).some((v) => valueStatesMoney(v, depth + 1));
  return false;
}

/** (b) or (c): a listed money field set anywhere, or a value stating money. */
function contentIsFinancial(value: unknown): boolean {
  return setsMoneyField(value) || valueStatesMoney(value);
}

/** Whether a write of a DNA section's data is financial (PATCH genome/dna/:section, genome-chat apply-updates). */
export function isFinancialDnaWrite(section: unknown, data: unknown): boolean {
  if (!nonMoneySection(section)) return true;
  if (data !== undefined && data !== null && (typeof data !== 'object' || Array.isArray(data))) return true;
  return contentIsFinancial(data);
}

/** Whether a blueprint patch is financial (PATCH blueprint, the patch POST infer/onboarding builds). */
export function isFinancialBlueprintPatch(patch: unknown): boolean {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return true;
  const columns = Object.keys(patch as Record<string, unknown>);
  if (columns.some((c) => MONEY_BLUEPRINT_COLUMNS.has(c) || !OTHER_BLUEPRINT_COLUMNS.has(c))) return true;
  return contentIsFinancial(patch);
}

/**
 * SEC-DW-5 (D-233, D-238): strip financial blueprint columns, composite scores derived from financial DNA
 * (including genomeStage and readinessScore), nested money fields, and money-stating strings in non-money columns
 * from blueprint write responses when the caller does not hold revenue read. Preserves Date instances.
 */
const BLUEPRINT_COMPOSITE_KEYS = new Set([
  'completeness', 'confidenceScores', 'genomeIntegrity', 'executiveReadinessScore', 'genomeStage', 'readinessScore',
  'genomeDnaScores', 'genomeDnaConfidence', 'readinessBreakdown',
]);
function stripMoneyFields(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return undefined;
  if (value instanceof Date) return value;
  if (typeof value === 'string') return structuredValueStatesMoney(value) ? undefined : value;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => stripMoneyFields(v, depth + 1)).filter((v) => v !== undefined);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (MONEY_FIELDS.has(normalizeFieldKey(k))) continue;
    const cleaned = stripMoneyFields(v, depth + 1);
    if (cleaned !== undefined) out[k] = cleaned;
  }
  return out;
}
export function blueprintForReader<T>(blueprint: T, readsRevenue: boolean): T {
  if (readsRevenue || !blueprint || typeof blueprint !== 'object' || Array.isArray(blueprint)) return blueprint;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(blueprint as Record<string, unknown>)) {
    if (MONEY_BLUEPRINT_COLUMNS.has(k) || BLUEPRINT_COMPOSITE_KEYS.has(k)) continue;
    const cleaned = stripMoneyFields(v, 1);
    if (cleaned !== undefined) out[k] = cleaned;
  }
  return out as T;
}

/**
 * SEC-DW-5 (D-233, D-238): strip composite integrity scores (including genomeStage and readinessScore) and
 * financial/sales DNA entries from a GenomeIntegrityResult returned to a caller without revenue read, using the
 * canonical case-insensitive allowlists (dnaScoresForReader, nonMoneySection).
 */
const HIDDEN_GENOME_COMPOSITE_KEYS = new Set(['genomeIntegrity', 'executiveReadinessScore', 'genomeStage', 'readinessScore']);
export function genomeIntegrityForReader<T>(genome: T, readsRevenue: boolean): T {
  if (readsRevenue || !genome || typeof genome !== 'object' || Array.isArray(genome)) return genome;
  const src = genome as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (HIDDEN_GENOME_COMPOSITE_KEYS.has(k)) continue;
    if ((k === 'genomeDnaScores' || k === 'genomeDnaConfidence' || k === 'readinessBreakdown') && v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = dnaScoresForReader(v as Record<string, unknown>, false);
      continue;
    }
    if (k === 'dnaSections' && Array.isArray(v)) {
      out[k] = v.filter((sec: any) => nonMoneySection(sec?.key));
      continue;
    }
    out[k] = v;
  }
  return out as T;
}
