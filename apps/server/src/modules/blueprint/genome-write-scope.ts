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
import { structuredValueStatesMoney } from '../business-genome/key-genome/genome-finance-scope';

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
  'revenuemodel', 'budgetrange', 'financialrisks', 'pricingmodel', 'avgticket', 'monthlytarget', 'startupcapital',
  'startupcosts', 'monthlyfixedcosts', 'variablecostpercent', 'estimatedannualrevenue', 'currency',
]);

/** Deeper than this fails closed. */
const MAX_DEPTH = 8;

function setsMoneyField(value: unknown, depth = 0): boolean {
  if (depth > MAX_DEPTH) return true;
  if (Array.isArray(value)) return value.some((v) => setsMoneyField(v, depth + 1));
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(
    ([key, v]) => MONEY_FIELDS.has(key.toLowerCase()) || setsMoneyField(v, depth + 1),
  );
}

/**
 * An operations step names orders ("take orders", "pack orders"), which the shared vocabulary reads as money for
 * proposals and reads. On a write it is read as the operations word it is; an order's amount is still caught by the
 * amount pattern and every other money word.
 */
const ORDER_WORD = /(?<![a-z])orders?(?![a-z])/gi;

function valueStatesMoney(value: unknown, depth = 0): boolean {
  if (depth > MAX_DEPTH) return true;
  if (typeof value === 'string') return structuredValueStatesMoney(value.replace(ORDER_WORD, ' '));
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
