import { LEVEL_RANK, memberModuleLevel, rankOf } from '../../../core/authority/module-vocabulary';
import type { PrismaService } from '../../../core/prisma/prisma.service';
import type { GenomeRecommendationService } from './genome-recommendation.service';
import type { GenomeSignalService } from './genome-signal.service';
import type { ListGenomeRecommendationsQuery, ListGenomeSignalsQuery } from './key-genome.types';

/**
 * W11-GENOME-FINANCE-SCOPE review repairs (owner rulings D-128 and D-100;
 * SEC-GFS-1..4, GFS-R1, GFS-R2). The genome's shared tables hold finance rows
 * beside the other domains' rows: FinanceGenomeService writes signals with
 * sourceModule 'finance' (section FINANCIAL, domain 'finance') whose reason is
 * the warning text ("Runway is 0.8 months"), recommendations in domain
 * FINANCIAL, and FINANCE_GENOME memory events carrying the health score and
 * overall risk; outcome learning copies those rows' domain and text into its
 * own memory events. The cross-domain service's events carry the composite's
 * overall health score, which averages the finance health score, and the
 * customer-sales snapshot's event carries the revenue quality worked out from
 * the lifetime value and acquisition cost metrics. D-128: reading them needs
 * revenue read; acting on a finance signal or recommendation needs revenue
 * write. The match is on "financ" in any of the row's module fields, so a row
 * a temporal or KEY writer files under section FINANCIAL is caught too.
 *
 * W11A-SEAM-REPAIR (seam of B1 W11-KEY-ORGAN-AUTHORITY-MAP x B2; D-128, D-131): moved
 * here from KeyGenomeController unchanged, so that the KEY organ tools
 * key_genome.list_signals and key_genome.list_recommendations (KeyGenomeAdapterService),
 * which D-131's map opens to members holding settings read, apply the same
 * projection the REST routes apply (one rule, two doors).
 */
/**
 * FU-GENOME-REVENUE-CLASSIFIER (owner rulings D-233, D-234; D-128 widened, D-100). The rows a reader
 * without revenue read is not served are classified by provenance and meaning, not by a "financ" label
 * alone (the rule before, which let SALES rows and unlabelled money rows through):
 *   - money or sales meaning in any field the writer files: its module, source type, section, domain,
 *     event type, signal type or field, a recommendation's title, or the source signal of a recommendation
 *     made from one (BUSINESS_MODEL, the revenue model and pricing, counts as money) (finance, revenue, sales, cash, commerce, payments, invoices, pricing,
 *     profit, billing, collections, refunds, payroll, treasury, margins, lifetime value, acquisition cost,
 *     costs and budgets, and the cross-domain composite, which averages the finance health score);
 *   - a row with nothing to classify it by (no section and no domain, or only 'general') fails closed.
 * The names of the three predicates are kept, so every reader (the REST routes, the organ tools, the KEY
 * prompt memory and the KEY chat genome) applies the same rule, and the actions on such a row keep
 * needing revenue write (D-128).
 */
const MONEY_TERMS =
  /financ|revenue|sales|cash|commerce|payment|invoice|pric|profit|billing|collection|refund|payroll|treasury|margin|lifetime|acquisition_?cost|cost|budget|spend|expense|conversion|forecast|churn|transaction|opportunit|pipeline|unit_?economics|cross_?domain|money/i;
/** Short money words, matched only as a whole word (letters on neither side), so snake_case values (cac_payback, first_sale) match. */
const MONEY_WORDS = /(?<![a-z])(cac|ltv|mrr|arr|roi|sale|deal|order)s?(?![a-z])/i;
/** Genome sections whose rows are money by default (D-234: the revenue model and pricing; fail closed). */
const MONEY_SECTIONS = new Set(['BUSINESS_MODEL']);

export type GenomeRowFields = {
  sourceModule?: string | null;
  sourceType?: string | null;
  section?: string | null;
  domain?: string | null;
  eventType?: string | null;
  signalType?: string | null;
  field?: string | null;
  title?: string | null;
  diagnosis?: string | null;
};

function mentionsMoney(...values: Array<string | null | undefined>): boolean {
  return values.some(
    (v) => typeof v === 'string' && (MONEY_TERMS.test(v) || MONEY_WORDS.test(v) || MONEY_SECTIONS.has(v.trim().toUpperCase())),
  );
}

/** Nothing to classify a row by: no value, or only the 'general' placeholder. */
function unclassified(...values: Array<string | null | undefined>): boolean {
  return values.every((v) => typeof v !== 'string' || v.trim() === '' || /^general$/i.test(v.trim()));
}

/**
 * GenomeRecommendationService files a recommendation made from a signal with the signal's section as
 * its domain and "A <type> signal was detected in <signal domain>..." as its diagnosis: the domain the
 * money classification of the source signal rests on (review MAJOR-2 / MAJOR-3).
 */
function signalDomainOf(diagnosis: string | null | undefined): string | null {
  const m = typeof diagnosis === 'string' ? /signal was detected in ([^\s]+)/i.exec(diagnosis) : null;
  return m ? m[1] : null;
}

/** A module, section, department or action label with money or sales meaning (governance, readiness): D-233, D-234. */
export function isMoneyLabel(value: string | null | undefined): boolean {
  return mentionsMoney(value);
}

/** A genome signal with money or sales provenance, or with nothing to classify it by: D-128, D-234. */
export function isFinanceSignal(row: GenomeRowFields): boolean {
  return mentionsMoney(row.sourceModule, row.section, row.domain, row.signalType, row.field) || unclassified(row.section, row.domain);
}

/** A genome recommendation in a money or sales domain (FINANCIAL, SALES, ...), titled for a money figure, made from a money signal, or with no domain: D-128, D-234. */
export function isFinanceRecommendation(row: GenomeRowFields): boolean {
  return mentionsMoney(row.domain, row.title, signalDomainOf(row.diagnosis)) || unclassified(row.domain);
}

/** A memory event that carries a money, sales or composite signal, or that has nothing to classify it by: D-128, D-100, D-234. */
export function isMoneyMemoryEvent(row: GenomeRowFields): boolean {
  return (
    mentionsMoney(row.sourceType, row.domain, row.section, row.eventType) ||
    row.sourceType === 'CROSS_DOMAIN_GENOME' ||
    row.domain === 'CROSS_DOMAIN' ||
    // A KEY action proposal's outcome event carries no domain; it is a proposal record, which stays business-wide
    // under D-226 (O3: a memberless turn sees its action, status and risk level only). PROVISIONAL reading of
    // D-234 against D-226, put to the owner (FU-GENOME-REVENUE-CLASSIFIER): only it is exempt from the
    // nothing-to-classify rule; any money field still withholds it.
    (row.sourceType !== 'KEY_ACTION_PROPOSAL' && unclassified(row.domain, row.section))
  );
}

/**
 * D-233: the DNA dimensions a reader without revenue read is shown. A finance or sales score is finance
 * even with no currency in it, and a key that is not listed here (a money dimension, a key written from
 * a KEY action type) is withheld: the list fails closed. Marketing stays: it is the marketing module's
 * own score (the ruling's separable non-financial guidance); its acquisition-cost targets are withheld
 * with the marketing-growth figures, not through this score.
 */
const NON_MONEY_DNA_KEYS: ReadonlySet<string> = new Set([
  'execution', 'strategy', 'operations', 'marketing', 'founder', 'vision', 'business', 'market', 'legal',
  'growth', 'technology', 'risk', 'customer_success', 'product', 'talent',
]);

export function dnaScoresForReader<T extends Record<string, unknown>>(scores: T | null | undefined, readsRevenue: boolean): Partial<T> {
  if (!scores) return {};
  if (readsRevenue) return scores;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(scores)) {
    if (NON_MONEY_DNA_KEYS.has(key.toLowerCase())) out[key] = value;
  }
  return out as Partial<T>;
}

export function firstN<T>(rows: T[], limit: number | undefined): T[] {
  return limit === undefined ? rows : rows.slice(0, limit);
}

/** Who reads the genome: the authenticated user ({ id, role } as AuthMiddleware attaches it), or none. */
export type GenomeReader = { id?: string; role?: string } | undefined;

/**
 * D-128 / D-100: the reader's revenue level in `businessId`, read by ModuleScopeGuard's rule:
 * SUPER_ADMIN passes; else the membership's explicit scope map (a missing key being 'none') or its
 * role's defaults. No reader, or no membership, is 'none': the finance rows fail closed.
 */
export async function genomeReaderRevenueLevel(prisma: PrismaService, businessId: string, reader: GenomeReader): Promise<string> {
  if (reader?.role === 'SUPER_ADMIN') return 'admin';
  if (!reader?.id) return 'none';
  const membership = await prisma.client.membership.findUnique({
    where: { userId_businessId: { userId: reader.id, businessId } },
    select: { role: true, permissionScopes: true },
  });
  if (!membership) return 'none';
  return memberModuleLevel(membership, 'revenue');
}

/** Whether `reader` reads revenue in `businessId` (D-100), by genomeReaderRevenueLevel. */
export async function genomeReaderReadsRevenue(prisma: PrismaService, businessId: string, reader: GenomeReader): Promise<boolean> {
  return rankOf(await genomeReaderRevenueLevel(prisma, businessId, reader)) >= LEVEL_RANK.read;
}

/**
 * SEC-GFS-4 (D-128 read clause): the genome signals a reader is served. A reader with revenue read
 * gets the list as asked; any other reader gets no finance signal, and the limit counts the signals
 * that reader is served.
 */
export async function listSignalsForReader(
  signals: Pick<GenomeSignalService, 'listSignals'>,
  businessId: string,
  filters: ListGenomeSignalsQuery,
  readsRevenue: boolean,
) {
  if (readsRevenue) return signals.listSignals(businessId, filters);
  const rows = await signals.listSignals(businessId, { ...filters, limit: undefined });
  return firstN(rows.filter((s) => !isFinanceSignal(s)), filters.limit);
}

/**
 * SEC-GFS-4 (D-128 read clause): the genome recommendations a reader is served. A reader with
 * revenue read gets the list as asked; any other reader gets no finance (FINANCIAL) recommendation,
 * and the limit counts the rows that reader is served.
 */
export async function listRecommendationsForReader(
  recommendations: Pick<GenomeRecommendationService, 'listRecommendations'>,
  businessId: string,
  filters: ListGenomeRecommendationsQuery,
  readsRevenue: boolean,
) {
  if (readsRevenue) return recommendations.listRecommendations(businessId, filters);
  const rows = await recommendations.listRecommendations(businessId, { ...filters, limit: undefined });
  return firstN(rows.filter((r) => !isFinanceRecommendation(r)), filters.limit);
}
