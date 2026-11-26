import { LEVEL_RANK, memberModuleLevel, rankOf } from '../../../core/authority/module-vocabulary';
import type { PrismaService } from '../../../core/prisma/prisma.service';
import {
  isStructurallyFinancialProposal,
  structuredPayloadCarriesMoney,
  structuralTextCarriesMoney,
} from '../../key-autonomy/proposal-money-tag';
import { keyOrganToolAuthority } from '../../key-cortex/key-cortex-organ-tool-authority';
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
const MONEY_TERMS = new RegExp(
  [
    'financ', 'revenue', 'sales', 'commerce', 'payment', 'invoice', 'profit', 'billing', 'refund', 'payroll', 'treasury',
    // Compensation is money (Codex P1 on #218: commission rates are real data in conversion/sales-team).
    // Only the two known false matches are excluded (decommission, overcompensation); every other compound, key or
    // acronym-prefixed name fails closed (confirmation review m2/m4). Compensate, incentivise and stipend are
    // compensation too.
    '(?<!de)commission', '(?<!over)compensat', '(?<![a-z])bonus(?:es)?(?![a-z])', 'incentiv', 'stipend',
    'lifetime', 'acquisition_?cost', 'budget', 'expense', 'conversion', 'forecast', 'churn', 'transaction', 'opportunit',
    'unit_?economics', 'cross_?domain', 'money', 'receivable', 'payable', 'quote', 'quotation', 'reimburs', 'discount',
    // A promo code is money; promote / promotion is not (round-3 correctness minor).
    '(?<![a-z])promo(?!t)', 'coupon', 'deposit', 'payout', 'purchase', 'wallet', 'ledger', 'salar', 'subscription', 'overdue', 'storelink',
    // Letter-bounded (correctness review MINOR-3: apricot, costume, cashier, suspend, data collection are not money).
    '(?<![a-z])pric', '(?<![a-z])cash(?!ier)', '(?<![a-z])costs?(?![a-z])', '(?<![a-z])costing', '(?<![a-z])spend',
    '(?<![a-z])margins?(?![a-z])', '(?<![a-z])collections(?![a-z])', '(?<![a-z])charges?(?![a-z])',
    '(?<![a-z])credits?(?![a-z])', '(?<![a-z])wages?(?![a-z])',
    // A genome-bridged proposal's payload names the section it came from (round-3 security M2).
    '(?<![a-z])business_model(?![a-z])',
  ].join('|'),
  'i',
);
/** Short money words, matched only as a whole word (letters on neither side), so snake_case values (cac_payback, first_sale) match. */
const MONEY_WORDS = /(?<![a-z])(cac|ltv|mrr|arr|roi|sale|deal|order|tax|vat|fee)s?(?![a-z])/i;
/** A money amount in free text ("$12,345", "TTD 500", "£9.99"): a title, summary or reason that states a figure (D-238). */
const MONEY_AMOUNT = /[$€£¥₹]\s?\d|(?<![a-z0-9])(ttd|usd|eur|gbp|jmd|bbd|xcd|cad)\s?\d|(?:(?<![\d.,])[.,]+|(?<![a-z0-9.,]))\d[\d.,]*\s?(ttd|usd|eur|gbp|jmd|bbd|xcd|cad)(?![a-z0-9])/i;
/**
 * Words that make a KEY action proposal's text or parameters financial (round-3 security M2): an amount, a total, a
 * balance, what is owed or paid, a rate. Read for proposals only: a genome row's domain is classified by the vocabulary
 * above, where "rate" would take every response or completion rate.
 */
const PROPOSAL_MONEY_WORDS =
  /(?<![a-z])(amounts?|subtotals?|balances?|owed|owes|owing|paid|unpaid|dollars?|euros?|cents?|rent|income|earnings?|funds?|rate[\s_-]+cards?)(?![a-z])|(?<![a-z])(pay|pays|paying)(?![a-z])(?!\s+(?:a\s+|close\s+)?(?:visit|attention|heed|respects?|tribute|homage|mind)(?![a-z]))|(?<![a-z])(?:cards?|payments?|transactions?|charges?)\s+(?:was\s+|were\s+|got\s+)?declined|(?<![a-z])declined\s+(?:card|payment|transaction|charge)/i;
/**
 * Money beside a figure (rounds 4-6): a word followed within three words by a figure, a quoted figure or a percentage
 * ("Total due 900", "the total came to 1200", "Rates will rise 10%", "Wire 900 to the vendor", {"bookingTotal":900}).
 * "rate" alone is not money when it is a named non-money metric (a response, show or completion rate: round-5
 * correctness minor 2); "total" and the money verbs never are exempted (round-6 security MAJOR-1: a booking total or
 * rate is the sale amount).
 */
/**
 * The figure after a money word (rounds 4-8): a JSON value right after the key ({"total":1200}, {"rate":"150"}), or prose
 * within three words whose separators hold no quote, so the window never runs across a JSON key boundary ("Call Bill",
 * "dueDate":"2026-..."). Only a real date or phone shape (2026-11-25, 25/11/2026, 868-555-0101) is no money figure.
 * Whatever follows the figure ("150 per hour", "3 hours") is not read: wording that cannot be told from money fails
 * closed (D-238; round-8, both reviews), and the structural follow-up FU-PROPOSAL-MONEY-TAG has the writers tag money.
 */
// The exempt shapes end where the date or phone ends (round 9: "Rate 1/12/150" is no date).
const DATE_OR_PHONE = `(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}/\\d{1,2}/(?:\\d{4}|\\d{2})|\\d{3}-\\d{3}-\\d{4})(?![\\d.,])`;
const FIGURE = `[$€£¥₹]?(?!${DATE_OR_PHONE})\\d`;
/**
 * Count and duration words: a key whose only segment after the money word is one of them is a count, not money
 * (totalCount, total_items, totalHours, totalDurationMs, timeSpentMinutes, tipsShown: round 10, correctness m2). In a
 * longer key it is money (total_items_value, rate_per_hour: security M3), and a time unit after "rate" is the hourly
 * rate (rateHour, rate_minute: round 11, security m1).
 */
const QUANTITY_WORDS =
  'counts?|items?|pages?|results?|records?|rows?|tasks?|hits?|matches|entries|contacts?|bookings?|leads?|messages?|tokens?|runs?|ms|duration(?:_?ms)?|latency(?:_?ms)?|steps?|clicks?|views?|shown|users?|members?|events?|calls?|emails?|posts?|files?|attempts?|retries';
/** Time units: a count of time after most money words (totalHours), but the hourly rate after "rate" (rateHour). */
const TIME_WORDS = 'hours?|minutes?|seconds?';
const COUNT_WORDS = `${QUANTITY_WORDS}|${TIME_WORDS}`;
// A key suffix after the money word: up to four segments of up to 30 letters, joined by '_', '-', a space or a doubled
// '_' (totalDue -> total_Due, total_due, "Total Due", total-due, total__due). Bounded, so a money-word chain
// (total_total_...) is linear (round 10, both reviews).
// The count exemption applies only to a count word right after the money word (totalCount, totalHours); in a longer key
// (rate_per_hour, total_items_value) the key is money.
// Up to eight segments (round 11: a longer key is still read); a key that runs past the bound fails closed (below).
const KEY_SUFFIX = `(?:[_ -]{1,2}(?!(?:${COUNT_WORDS})["']?\\s*[:=])[a-z0-9]{1,30}(?:[_ -]{1,2}[a-z0-9]{1,30}){0,7})?`;
const RATE_KEY_SUFFIX = `(?:[_ -]{1,2}(?!(?:${QUANTITY_WORDS})["']?\\s*[:=])[a-z0-9]{1,30}(?:[_ -]{1,2}[a-z0-9]{1,30}){0,7})?`;
// A money word followed by more than eight KEY segments ('_' or '-', never a space, so a long sentence is not one):
// fails closed (rounds 11-12).
const LONG_KEY = `(?:[_-]{1,2}[a-z0-9]{1,30}){9}`;
// The prose window: up to three words (or exempt dates or phones) of up to 30 letters, separated by whitespace
// (newlines included), punctuation, '=', markdown '*', '~', '>', and dashes (round 10, security M4).
const SEP = `[\\s,:;()=*~>—–-]{1,4}`;
const WINDOW_WORD = `(?:[a-z]{1,30}|${DATE_OR_PHONE})`;
// One whitespace run each side of the colon (round 11, security M2: two \\s* around an optional quote were quadratic).
// A value may be nested one level (round 12, security M2: {"total":{"value":900}}, {"total":[900]}).
const KEY_VALUE = `["']?\\s*[:=]\\s*(?:[\\[{]\\s*(?:["'][a-z0-9_ -]{1,30}["']\\s*:\\s*)?)?(?:["']\\s*)?${FIGURE}`;
const PROSE_FIGURE = `(?![a-z])(?:${SEP}(?:${WINDOW_WORD}${SEP}){0,3})${FIGURE}`;
const NEAR_FIGURE = `(?:${KEY_SUFFIX}${KEY_VALUE}|${LONG_KEY}|${PROSE_FIGURE})`;
const RATE_NEAR_FIGURE = `(?:${RATE_KEY_SUFFIX}${KEY_VALUE}|${LONG_KEY}|${PROSE_FIGURE})`;
const PROPOSAL_FIGURE_WORDS = new RegExp(
  [
    `(?<!(?:response|reply|show|no[\\s_-]?show|completion|open|click|attendance|retention|bounce|success|error|occupancy|star|heart|frame|bit|sample|refresh)[\\s_]?)(?<![a-z])rates?(?![\\s_-]*limit)${RATE_NEAR_FIGURE}`,
    `(?<![a-z])(?:totals?|bill(?:s|ed|ing)?|settle(?:s|d)?|wire[sd]?|transfer(?:s|red)?|tips?|loans?|retainers?|spent|spend(?:s|ing)?|charged)${NEAR_FIGURE}`,
    // A figure that is outstanding, owed or overdue ("Chase the 900 outstanding"), at the start of its number: not after
    // a digit, nor after a digit and one mark (round 10: linear on "9..9.." runs; "them,900 outstanding" is money).
    // At the start of its number: a run of marks not after a digit may precede it ("Chase...900 outstanding"), a
    // digit run may not (round 12: linear, each start is a mark run's first mark or a number's first digit).
    `(?:(?<![\\d.,])[.,]+|(?<![\\d.,]))[$€£¥₹]?\\d[\\d,.]*(?:\\s*k)?\\s+(?:outstanding|owed|overdue|unpaid|past\\s+due)(?![a-z])`,
  ].join('|'),
  'i',
);
/** camelCase keys and words split at their humps (estimatedCost, unitPrice, adSpend), so the bounded terms see them (correctness MAJOR-2). */
function splitHumps(v: string): string {
  return v.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
}
/** Genome sections whose rows are money by default (D-234: the revenue model and pricing; fail closed). */
const MONEY_SECTIONS = new Set(['BUSINESS_MODEL']);

export type GenomeRowFields = {
  sourceModule?: string | null;
  sourceType?: string | null;
  sourceEntityType?: string | null;
  section?: string | null;
  domain?: string | null;
  eventType?: string | null;
  signalType?: string | null;
  field?: string | null;
  title?: string | null;
  insight?: string | null;
  diagnosis?: string | null;
  recommendation?: string | null;
  expectedGain?: string | null;
  /** A memory event's own metadata (a KEY_ACTION_PROPOSAL outcome carries its proposal's actionType, module, toolName). */
  metadata?: unknown;
  /** A genome signal's own text (Codex P1 on #228): its reason (served by the KEY bridge as `message`), evidence, proposed value. */
  reason?: unknown;
  message?: unknown;
  evidence?: unknown;
  proposedValue?: unknown;
};

/**
 * FU-GENOME-SURFACES-REVENUE round 3 (D-234, D-100): marketing-growth snapshot signal fields computed strictly from
 * content strategy / channel counts (an allow-list: every other MARKETING_GROWTH_GENOME snapshot signal fails closed).
 */
const NON_MONEY_MARKETING_SIGNAL_FIELDS: ReadonlySet<string> = new Set([
  'NO_CONTENT_STRATEGY',
  'MISSING_CONTENT_PILLARS',
  'MISSING_CONTENT_CADENCE',
]);

/** Acquisition-cost, budget and conversion terms in recommendation prose (round 3, MGC-02). */
const MARKETING_RECOMMENDATION_MONEY_TEXT =
  /(?<![a-z])(?:acquisition[\s_-]+cost|target_?cac|cac|budgets?|conversions?)(?![a-z])/i;

function mentionsMoney(...values: Array<string | null | undefined>): boolean {
  return values.some((v) => {
    if (typeof v !== 'string') return false;
    if (MONEY_SECTIONS.has(v.trim().toUpperCase())) return true;
    return [v, splitHumps(v)].some((t) => MONEY_TERMS.test(t) || MONEY_WORDS.test(t) || MONEY_AMOUNT.test(t));
  });
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
  if (row.sourceEntityType === 'MARKETING_GROWTH_GENOME') {
    const field = typeof row.field === 'string' ? row.field.trim() : '';
    if (!NON_MONEY_MARKETING_SIGNAL_FIELDS.has(field)) return true;
  }
  if (
    mentionsMoney(row.sourceModule, row.section, row.domain, row.signalType, row.field, row.sourceEntityType) ||
    unclassified(row.section, row.domain)
  ) {
    return true;
  }
  // Codex P1 on #228 (D-234: authorization follows the data's meaning, not only its labels): a signal made from an inbox
  // thread keeps the customer's text as its reason, so a signal with non-money labels can state money in its field,
  // sourceEntityType, reason/message, evidence or proposed value (including figure-word field + scalar proposedValue).
  // Read with the proposal vocabulary under one shared reading budget; unreadable fails closed.
  const budget: ReadingBudget = { left: READING_BUDGET };
  const fieldName = typeof row.field === 'string' && row.field.trim() !== '' ? row.field : null;
  const proposed =
    fieldName && !ID_KEY.test(fieldName) && row.proposedValue !== undefined && row.proposedValue !== null
      ? Object.defineProperty(Object.create(null), fieldName, { value: row.proposedValue, enumerable: true })
      : row.proposedValue;
  return [row.field, row.sourceEntityType, row.reason, row.message, row.evidence, proposed].some((value) =>
    typeof value === 'string' ? textStatesMoney(value, budget) : structuredValueStatesMoney(value, budget),
  );
}

/** A genome recommendation in a money or sales domain (FINANCIAL, SALES, ...), titled for a money figure, made from a money signal, or with no domain: D-128, D-234. */
export function isFinanceRecommendation(row: GenomeRowFields): boolean {
  if (mentionsMoney(row.domain, row.title, signalDomainOf(row.diagnosis)) || unclassified(row.domain)) {
    return true;
  }
  return [row.title, row.insight, row.diagnosis, row.recommendation, row.expectedGain].some(
    (v) => typeof v === 'string' && MARKETING_RECOMMENDATION_MONEY_TEXT.test(v),
  );
}

/** A memory event that carries a money, sales or composite signal, or that has nothing to classify it by: D-128, D-100, D-234. */
export function isMoneyMemoryEvent(row: GenomeRowFields): boolean {
  // D-238: a KEY proposal's outcome event is classified by its proposal (the event carries its action type,
  // module, tool and title); a financial or unclassifiable proposal is money.
  if (row.sourceType === 'KEY_ACTION_PROPOSAL') return isFinancialProposal(proposalFieldsOfEvent(row));
  if (row.eventType === 'MARKETING_GROWTH_SNAPSHOT_COMPUTED') return true;
  return (
    mentionsMoney(row.sourceType, row.domain, row.section, row.eventType) ||
    row.sourceType === 'CROSS_DOMAIN_GENOME' ||
    row.domain === 'CROSS_DOMAIN' ||
    unclassified(row.domain, row.section)
  );
}

/** The fields a KEY action proposal is classified by (KeyActionProposal: actionType, module, toolName, title). */
export type ProposalFields = {
  /** FU-PROPOSAL-MONEY-TAG (D-238, D-227): authoritative structural money tag stamped at creation (`null` on legacy rows). */
  carriesMoney?: boolean | null;
  actionType?: string | null;
  module?: string | null;
  toolName?: string | null;
  title?: string | null;
  /** Content fields (security review MAJOR-3): a proposal's money may live only in its text or its parameters. */
  summary?: string | null;
  description?: string | null;
  rationale?: string | null;
  expectedBenefit?: string | null;
  risks?: unknown;
  /** Where the proposal came from (HUMAN_WORKFLOW: the approvals module's shadow; round 8). */
  sourceType?: string | null;
  /**
   * The proposal's lifecycle results (Codex P1 on #218): what it executed to and why it was rejected are classified as
   * its content; a failure reason (mostly the system's own text) is redacted field by field instead
   * (nonFinancialProposalForReader).
   */
  executionResult?: unknown;
  rejectionReason?: string | null;
  failureReason?: string | null;
  /** The evidence the proposal cites (round-3 security M2). */
  evidence?: unknown;
  payload?: unknown;
  inputPayload?: unknown;
  affectedEntities?: unknown;
};

/**
 * A structured value (parameters, a result, evidence) as the text the vocabulary reads.
 * - Ids name rows, not money: under an id-named key, a value shaped like an id (one token, no worded money in it) is
 *   dropped and its name kept (an invoiceId names an invoice). Anything else under such a key is read (fourth review
 *   m3/m4).
 * - A control character inside a string becomes a space, so JSON's escape of it never stands as a letter before a word
 *   (third review m1). The escapes JSON still writes (in keys, of lone surrogates, of a nested JSON string) are read
 *   by `readings`.
 * Returns null when the value cannot be serialised; every caller treats that as financial (fail closed).
 */
const ID_KEY = /(^id$|Ids?$|_ids?$)/;
/** One token (no whitespace), none of whose all-letter parts is a money word: `tsk_1`, a cuid, a UUID; not `invoice-900-usd`. */
function idShaped(v: unknown): boolean {
  if (typeof v !== 'string' || v.length > 128 || /\s/.test(v)) return false;
  const words = v.split(/[^A-Za-z0-9]+/).filter((part) => /^[A-Za-z]+$/.test(part));
  return !mentionsMoney(words.join(' '));
}
function structuredText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  try {
    const json = JSON.stringify(v, (k, val) => {
      if (k && ID_KEY.test(k)) {
        if (idShaped(val)) return '[id]';
        if (Array.isArray(val) && val.every(idShaped)) return '[id]';
      }
      return typeof val === 'string' ? val.replace(/\p{Cc}+/gu, ' ') : val;
    });
    return typeof json === 'string' ? json : null;
  } catch {
    return null;
  }
}
/**
 * Real id shapes are stripped from text: a UUID (hex), a cuid (Prisma cuid(): "c" and 24 lowercase letters and digits,
 * none of whose letter runs of five or more the proposal vocabulary reads as money), or a hex digest of 32 or more characters (at least 6
 * digits and 6 letters). Nothing else is stripped: a squashed phrase, a file name, a hyphenated phrase
 * (overdue-invoices-2026, december-2026-cost-fees-transactions) and a camelCase name are words, and are read.
 */
function withoutIdTokens(t: string, keepWordedCuids = true): string {
  return t
    .replace(/(?<![A-Za-z0-9])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![A-Za-z0-9])/gi, ' ')
    .replace(/(?<![A-Za-z0-9-])c(?=[a-z0-9]{0,23}\d)[a-z0-9]{24}(?![A-Za-z0-9-])/g, (run) =>
      keepWordedCuids && run.split(/\d+/).some((letters) => letters.length >= 5 && proposalMentionsMoney(letters)) ? run : ' ',
    )
    .replace(/(?<![A-Za-z0-9-])[0-9a-fA-F]{32,512}(?![A-Za-z0-9-])/g, (run) => {
      const digits = run.replace(/\D/g, '').length;
      return digits >= 6 && run.length - digits >= 6 ? ' ' : run;
    });
}

/**
 * The characters of readings one proposal's content (or one single text read on its own) may cost. A plain text is one
 * reading of its own length; an ordinary long text with a quote, a path, a joiner or a no-break space in it is a few;
 * text whose readings multiply past it (several kinds of ambiguity in one long text, or across several long fields) runs
 * out, and then it fails closed before the vocabulary reads it (seventh review; the lengths are recorded under
 * FU-PROPOSAL-MONEY-TAG).
 */
const READING_BUDGET = 300_000;
type ReadingBudget = { left: number };

/**
 * The ways a text may be read, or null when it must fail closed. The text states money if ANY reading does, so a
 * reading is only ever added, never substituted (sixth review): each earlier way of reading stays one of them.
 * - as written, and with compatibility forms folded (fullwidth digits; a folded symbol can also glue itself to a word,
 *   which is why the text as written stays);
 * - an invisible format character kept, as a joiner (in<ZWSP>voice) or as a separator (fee<ZWSP>from);
 * - a backslash kept as written; as a separator (c:\clients\tax); as the start of an escape that is a space, either
 *   that escape alone (\n, \t ...) or any backslash run with its letter; or as JSON's own quoting, removed with its
 *   \uXXXX escapes decoded, its \n-style escapes read as spaces or dropped (a nested JSON string, an escaped
 *   currency sign).
 * Every pattern matches one character or a run that always matches, so the cost is linear in what is read, and what
 * is read is bounded by the budget.
 */
function readings(text: string, budget: ReadingBudget): string[] | null {
  const folded = text.normalize('NFKC');
  if (folded.length > MAX_CLASSIFIED_CONTENT) return null;
  const raw = new Set<string>([text]);
  if (/[\\\p{Cf}]/u.test(text) || folded !== text) {
    for (const form of new Set([text, folded])) {
      for (const formatRead of new Set([form, form.replace(/\p{Cf}/gu, ''), form.replace(/\p{Cf}/gu, ' ')])) {
        raw.add(formatRead);
        if (!formatRead.includes('\\')) continue;
        const decoded = formatRead.replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
        raw.add(formatRead.replace(/\\/g, ' '));
        raw.add(formatRead.replace(/\\[bfnrt]/g, ' '));
        raw.add(formatRead.replace(/\\+(?:u[0-9a-fA-F]{4}|[bfnrt])?/g, ' '));
        raw.add(decoded.replace(/\\/g, ''));
        raw.add(decoded.replace(/\\[bfnrt]/g, ' ').replace(/\\/g, ''));
      }
    }
  }
  // The raw readings are checked against the budget first, before any id pass runs over them: text over the budget
  // fails closed at once, and stripping ids can never bring refused text back under it (review of the budget charge).
  let rawCost = 0;
  for (const reading of raw) rawCost += reading.length;
  if (rawCost > budget.left) return null;
  // A cuid-shaped run kept for a money word in it is read both ways, kept and stripped: kept, it can read as no money
  // in its place ("...paying attention") and stand between a money word and its figure (eighth review, security MINOR-1).
  const out = new Set<string>();
  for (const reading of raw) {
    out.add(withoutIdTokens(reading));
    out.add(withoutIdTokens(reading, false));
  }
  // The budget is charged for everything the vocabulary will read, the stripped forms included (final review MINOR-2).
  let cost = 0;
  for (const reading of out) cost += reading.length;
  if (cost > budget.left) return null;
  // The larger of the two is deducted: the id pass ran over the raw readings, so a field never costs less than they
  // do, and id-dense text split across fields runs the budget out as one field would (review of the budget repair).
  budget.left -= Math.max(rawCost, cost);
  return [...out];
}

/**
 * D-238: whether a text states money by the proposal vocabulary, in any of its readings. Oversized text, and text whose
 * readings exceed the budget, fail closed before they are read.
 */
function textStatesMoney(text: string | null | undefined, budget: ReadingBudget = { left: READING_BUDGET }): boolean {
  if (typeof text !== 'string' || text === '') return false;
  if (text.length > MAX_CLASSIFIED_CONTENT) return true;
  const all = readings(text, budget);
  return all === null || all.some((reading) => proposalMentionsMoney(reading));
}

/**
 * D-238: whether a structured value a proposal or its event carries (an execution result, outcome evidence) states
 * money, read exactly as the proposal's own content is. A value that cannot be read, or is oversized, fails closed.
 */
export function structuredValueStatesMoney(value: unknown, budget?: ReadingBudget): boolean {
  if (value === null || value === undefined) return false;
  const text = structuredText(value);
  return text === null || textStatesMoney(text, budget);
}

const STRUCTURED_PROPOSAL_FIELDS = ['risks', 'evidence', 'payload', 'inputPayload', 'affectedEntities', 'executionResult'] as const;

/** A proposal's content as text: its string fields and its structured fields (parameters, request type) serialised. */
function proposalContent(p: ProposalFields): Array<string | null | undefined> {
  // The provenance a recommendation id names is read by financialProposalWithProvenance.
  const fields = p as unknown as Record<string, unknown>;
  return [p.summary, p.description, p.rationale, p.expectedBenefit, ...STRUCTURED_PROPOSAL_FIELDS.map((key) => structuredText(fields[key])), p.rejectionReason];
}

/** Whether a structured field of the proposal holds a value that cannot be serialised: unreadable content fails closed. */
function hasUnreadableContent(p: ProposalFields): boolean {
  const fields = p as unknown as Record<string, unknown>;
  return STRUCTURED_PROPOSAL_FIELDS.some((key) => fields[key] !== null && fields[key] !== undefined && structuredText(fields[key]) === null);
}

/** D-238: whether a proposal's free text (a failure or rejection reason) states money, by the proposal vocabulary. */
export function proposalTextStatesMoney(text: string | null | undefined): boolean {
  return textStatesMoney(text);
}

function proposalMentionsMoney(...values: Array<string | null | undefined>): boolean {
  return mentionsMoney(...values) || values.some((v) => typeof v === 'string' && [v, splitHumps(v)].some((t) => PROPOSAL_MONEY_WORDS.test(t) || PROPOSAL_FIGURE_WORDS.test(t)));
}

/**
 * D-238: the KEY action types that are not financial in themselves. Any other action type is classified by its
 * module and tool, and an action that cannot be classified fails closed (D-227, D-234). A listed action is still
 * financial when its module, tool or title carries money or sales meaning ("Chase the $4,000 invoice").
 */
const NON_MONEY_PROPOSAL_ACTIONS: ReadonlySet<string> = new Set([
  'CREATE_TASK', 'COMPLETE_TASK', 'CREATE_EVENT', 'CONFIRM_BOOKING', 'REBOOK', 'OPEN', 'OPEN_GENOME',
  'OPEN_TEMPORAL_FLOW', 'REVIEW_ASSETS', 'ENABLE_LOOP', 'CREATE_LOOP', 'COMPLETE_SETUP', 'DISMISS', 'ACCEPT', 'REJECT',
  'REQUEST_APPROVAL',
]);
/** D-238 (round 7): the approvals-module request types that carry no money (APPROVAL_REQUEST_TYPES). */
const NON_MONEY_REQUEST_TYPES: ReadonlySet<string> = new Set(['content_delivery', 'time_off', 'task_completion', 'evidence_verification']);

function requestTypeOf(p: ProposalFields): string | null {
  for (const source of [p.affectedEntities, p.payload]) {
    if (source && typeof source === 'object' && !Array.isArray(source)) {
      const t = (source as Record<string, unknown>).requestType;
      if (t !== undefined && t !== null) return typeof t === 'string' ? t.trim().toLowerCase() : '?';
    }
  }
  return null;
}

/** D-238: KEY modules whose tools carry no money (CORTEX_MODULE_RULES: crm, bookings, content, projects, operations). */
const NON_MONEY_PROPOSAL_MODULES: ReadonlySet<string> = new Set([
  'crm', 'contacts', 'bookings', 'calendar', 'content', 'social', 'communications', 'projects', 'tasks', 'inbox',
  'key_inbox', 'notifications', 'operations',
]);
/** The module scopes whose tools touch money (the KEY organ-tool authority map's revenue and expenses scopes). */
const MONEY_SCOPES: ReadonlySet<string> = new Set(['revenue', 'expenses']);

/**
 * D-238 (D-226, D-227, D-234): whether a KEY action proposal reveals restricted financial or sales information, by its
 * type, provenance and content: money or sales meaning in its action type, module, tool or title; a tool the KEY
 * organ-tool authority map scopes to revenue or expenses; or no classification at all (fail closed). A proposal is
 * non-financial only when its action type is listed non-financial, its tool is mapped to no money scope, or its tool
 * belongs to a listed non-money module, and nothing in it carries money.
 */
/** Content beyond this many characters fails closed (round 12): no ordinary proposal is that long, and it bounds the cost. */
const MAX_CLASSIFIED_CONTENT = 50_000;

export function isFinancialProposal(proposal: ProposalFields | null | undefined): boolean {
  if (!proposal) return true;
  // FU-PROPOSAL-MONEY-TAG (V1-88, D-238, D-227): read the structural money tag stamped at creation first.
  if (proposal.carriesMoney === true) return true;
  if (proposal.carriesMoney === false) {
    // Structural safety backstop: a financial/unmapped tool, financial module/action/requestType,
    // or post-creation money executionResult/rejectionReason can never be suppressed by carriesMoney=false.
    if (isStructurallyFinancialProposal(proposal)) return true;
    if (proposal.executionResult != null && structuredPayloadCarriesMoney(proposal.executionResult)) return true;
    if (typeof proposal.rejectionReason === 'string' && proposal.rejectionReason && structuralTextCarriesMoney(proposal.rejectionReason)) return true;
    return false;
  }
  // Untagged / legacy rows (carriesMoney === null | undefined): fail closed via the existing text/provenance heuristic.
  if (hasUnreadableContent(proposal)) return true;
  const content = proposalContent(proposal);
  if ([proposal.title, ...content].reduce((n, v) => n + (typeof v === 'string' ? v.length : 0), 0) > MAX_CLASSIFIED_CONTENT) return true;
  const { actionType, module, toolName, title } = proposal;
  // The content is read before any list (review MAJOR-3): an approval request, a listed action or a mapped tool whose
  // text or parameters carry money is financial.
  // One reading budget for the whole proposal (seventh review, security MINOR-1).
  const budget: ReadingBudget = { left: READING_BUDGET };
  if (proposalMentionsMoney(actionType, module, toolName) || [title, ...content].some((text) => textStatesMoney(text, budget))) return true;
  const tool = typeof toolName === 'string' && toolName.trim() ? toolName.trim() : null;
  const authority = tool ? keyOrganToolAuthority(tool) : null;
  if (authority && 'scopes' in authority) return authority.scopes.some((s) => MONEY_SCOPES.has(s.module));
  // Round 7 (security m1): an approvals-module request (its shadow carries affectedEntities.requestType) is decided by its
  // request type: only the listed non-money types are non-financial; a purchase order, a general request or an unknown
  // type fails closed. A KEY approval request with no request type is classified as before (D-226).
  const requestType = requestTypeOf(proposal);
  const isApproval = typeof actionType === 'string' && actionType.trim().toUpperCase() === 'REQUEST_APPROVAL';
  if (isApproval && requestType !== null) return !NON_MONEY_REQUEST_TYPES.has(requestType);
  // An approvals-module shadow (sourceType HUMAN_WORKFLOW) with no request type (a KEY tool that left it out) fails
  // closed (round 8, correctness m4).
  if (isApproval && proposal.sourceType === 'HUMAN_WORKFLOW') return true;
  if (typeof actionType === 'string' && NON_MONEY_PROPOSAL_ACTIONS.has(actionType.trim().toUpperCase())) return false;
  const owner = (typeof module === 'string' && module.trim() ? module : tool?.includes('.') ? tool.split('.')[0] : '').trim().toLowerCase();
  if (owner && NON_MONEY_PROPOSAL_MODULES.has(owner)) return false;
  return true;
}

/**
 * D-238: a proposal as a reader may be handed it after acting on it (approve, reject, cancel, execute). A revenue reader,
 * or any reader of a non-financial proposal, gets it whole; a reader without revenue read gets only its id, its status
 * and a failure reason that states no money (round 13). The action itself stays governed by the existing authority (tiers, D-140,
 * D-119); only what is answered is redacted.
 */
export function proposalViewForReader<T extends { id: string; status?: unknown; failureReason?: unknown }>(
  proposal: T,
  readsRevenue: boolean,
): T | { id: string; status?: unknown; failureReason?: string } {
  if (readsRevenue) return proposal;
  if (!isFinancialProposal(proposal as unknown as ProposalFields)) return nonFinancialProposalForReader(proposal);
  return redactedProposalView(proposal);
}

/**
 * Codex P1 on #218: a non-financial proposal as a reader without revenue read is served it: whole, except a failure
 * reason that states money, which is blanked.
 */
export function nonFinancialProposalForReader<T extends { failureReason?: unknown; outcomeEvidence?: unknown }>(proposal: T): T {
  // One reading budget for the failure reason, the evidence and its status together.
  const budget: ReadingBudget = { left: READING_BUDGET };
  const reasonStates = typeof proposal.failureReason === 'string' && textStatesMoney(proposal.failureReason, budget);
  // The action boundary writes the same message into outcomeEvidence (review of the Codex fixes, security m1). Evidence
  // that states money anywhere in it is reduced to its status (confirmation review m6), read as proposal content is.
  const evidence = proposal.outcomeEvidence;
  const evidenceStates = structuredValueStatesMoney(evidence, budget);
  if (!reasonStates && !evidenceStates) return proposal;
  // The status is kept only when it is a short string that states no money (third review m2).
  const status = evidence && typeof evidence === 'object' && !Array.isArray(evidence) ? (evidence as Record<string, unknown>).status : undefined;
  const keepStatus = typeof status === 'string' && status.length <= 40 && !textStatesMoney(status, budget);
  return {
    ...proposal,
    ...(reasonStates ? { failureReason: null } : {}),
    ...(evidenceStates ? { outcomeEvidence: { ...(keepStatus ? { status } : {}), reason: null } } : {}),
  };
}

/** D-238: the redacted view of a financial proposal: its id, its status (D-226) and a failure reason that states no money. */
export function redactedProposalView(proposal: { id: string; status?: unknown; failureReason?: unknown }): { id: string; status?: unknown; failureReason?: string } {
  // A failure reason that states no money stays: it is the authority's own refusal (D-140, D-119), which the action
  // answers pin (round 13; round 7 had dropped it). One that states money is withheld.
  const reason = typeof proposal.failureReason === 'string' && proposal.failureReason && !textStatesMoney(proposal.failureReason) ? proposal.failureReason : undefined;
  return reason === undefined ? { id: proposal.id, status: proposal.status } : { id: proposal.id, status: proposal.status, failureReason: reason };
}

/**
 * D-238 (round 4, correctness MAJOR-2): the KeyActionProposal columns every surface classifies a proposal by, so the
 * event, timeline, memory, governance and prompt paths judge it on the same fields as the REST routes.
 */
export const PROPOSAL_CLASSIFY_SELECT = {
  id: true,
  carriesMoney: true,
  sourceType: true,
  actionType: true,
  module: true,
  toolName: true,
  title: true,
  summary: true,
  description: true,
  rationale: true,
  expectedBenefit: true,
  risks: true,
  evidence: true,
  payload: true,
  inputPayload: true,
  affectedEntities: true,
  executionResult: true,
  rejectionReason: true,
  failureReason: true,
} as const;

/**
 * financialProposalWithProvenance over a list (round-4 correctness minor 5): the bridged recommendations are read in
 * one query, in `businessId` only. A recommendation that is not found, or a read that fails, makes its proposal
 * financial (fail closed).
 */
export async function financialProposalsWithProvenance(
  prisma: Pick<PrismaService, 'client'> | undefined,
  businessId: string,
  proposals: Array<ProposalFields | null | undefined>,
): Promise<boolean[]> {
  const own = proposals.map((p) => isFinancialProposal(p));
  const recIds = proposals.map((p, i) => (own[i] ? null : recommendationIdOf(p!)));
  const wanted = [...new Set(recIds.filter((id): id is string => !!id))];
  if (wanted.length === 0) return own;
  let recs: Map<string, GenomeRowFields> | null;
  try {
    const found = ((await prisma?.client.genomeRecommendation.findMany({
      where: { businessId, id: { in: wanted } },
      select: { id: true, domain: true, title: true, diagnosis: true },
    })) ?? []) as Array<{ id: string } & GenomeRowFields>;
    recs = new Map(found.map((r) => [r.id, r]));
  } catch {
    recs = null;
  }
  return own.map((financial, i) => {
    if (financial) return true;
    const recId = recIds[i];
    if (!recId) return false;
    const rec = recs?.get(recId);
    return !rec || isFinanceRecommendation(rec);
  });
}

/** The genome recommendation a bridged proposal was made from (GenomeKeyBridge writes payload.recommendationId). */
function recommendationIdOf(p: ProposalFields): string | null {
  for (const source of [p.payload, p.inputPayload]) {
    if (source && typeof source === 'object' && !Array.isArray(source)) {
      const id = (source as Record<string, unknown>).recommendationId;
      if (typeof id === 'string' && id) return id;
    }
  }
  return null;
}

/**
 * D-238 provenance (round-3 security M2): a proposal is financial by its own fields (isFinancialProposal) or by the
 * genome recommendation it was bridged from, read in `businessId` only. A recommendation that cannot be read, or a read
 * that fails, makes it financial (fail closed).
 */
export async function financialProposalWithProvenance(
  prisma: Pick<PrismaService, 'client'> | undefined,
  businessId: string,
  proposal: ProposalFields | null | undefined,
): Promise<boolean> {
  if (isFinancialProposal(proposal)) return true;
  const recId = recommendationIdOf(proposal!);
  if (!recId) return false;
  try {
    const rec = await prisma?.client.genomeRecommendation.findFirst({
      where: { id: recId, businessId },
      select: { domain: true, title: true, diagnosis: true },
    });
    return !rec || isFinanceRecommendation(rec);
  } catch {
    return true;
  }
}

/**
 * D-238 (round 3, security M3): the memory events among `events` a reader without revenue read may be served. A money
 * memory event (isMoneyMemoryEvent) is withheld; a KEY_ACTION_PROPOSAL event is also judged by its underlying proposal
 * row (sourceEntityId, read in `businessId` only) with its provenance (financialProposalWithProvenance), and withheld when
 * the row is financial, cannot be found, or the read fails (fail closed).
 */
export async function readableMemoryEvents<T extends GenomeRowFields & { sourceEntityId?: string | null }>(
  prisma: Pick<PrismaService, 'client'> | undefined,
  businessId: string,
  events: T[],
): Promise<T[]> {
  const kept = events.filter((e) => !isMoneyMemoryEvent(e));
  const proposalEvents = kept.filter((e) => e.sourceType === 'KEY_ACTION_PROPOSAL');
  if (proposalEvents.length === 0) return kept;
  const ids = [...new Set(proposalEvents.map((e) => e.sourceEntityId).filter((id): id is string => typeof id === 'string' && !!id))];
  const readable = new Set<string>();
  try {
    const rows = ids.length
      ? ((await prisma?.client.keyActionProposal.findMany({
          where: { businessId, id: { in: ids } },
          select: PROPOSAL_CLASSIFY_SELECT,
        })) ?? [])
      : [];
    const list = rows as Array<{ id: string } & ProposalFields>;
    const financial = await financialProposalsWithProvenance(prisma, businessId, list);
    list.forEach((row, i) => {
      if (!financial[i]) readable.add(row.id);
    });
  } catch {
    return kept.filter((e) => e.sourceType !== 'KEY_ACTION_PROPOSAL');
  }
  return kept.filter((e) => e.sourceType !== 'KEY_ACTION_PROPOSAL' || (typeof e.sourceEntityId === 'string' && readable.has(e.sourceEntityId)));
}

/** A KEY_ACTION_PROPOSAL outcome event's proposal fields: its metadata (OutcomeLearningService) and its title. */
function proposalFieldsOfEvent(row: GenomeRowFields): ProposalFields {
  const meta = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? (row.metadata as Record<string, unknown>) : {};
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  return {
    carriesMoney: typeof meta.carriesMoney === 'boolean' ? meta.carriesMoney : undefined,
    actionType: str(meta.actionType),
    module: str(meta.module),
    toolName: str(meta.toolName),
    title: row.title ?? null,
  };
}

/**
 * D-233: the DNA dimensions a reader without revenue read is shown. A finance or sales score is finance
 * even with no currency in it, and a key that is not listed here (a money dimension, a key written from
 * a KEY action type) is withheld: the list fails closed. Marketing stays: it is the marketing module's
 * own score (the ruling's separable non-financial guidance); its acquisition-cost targets are withheld
 * with the marketing-growth figures, not through this score.
 */
const NON_MONEY_DNA_KEYS: ReadonlySet<string> = new Set([
  'execution', 'strategy', 'operations', 'marketing', 'founder', 'vision', 'market', 'legal',
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
  // A limit that is no number (?limit=abc) limits nothing, rather than serving nothing (round-3 correctness minor).
  return limit === undefined || !Number.isFinite(limit) || limit < 0 ? rows : rows.slice(0, Math.floor(limit));
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
  // D-238 (round 3): a reader passed by id alone (a KEY tool's actor, a socket) is read with its platform role, so a
  // SUPER_ADMIN is not taken for a non-member.
  if (reader.role === undefined) {
    let platformRole: string | undefined;
    try {
      const user = await prisma.client.user?.findUnique({
        where: { id: reader.id },
        select: { role: true, deletedAt: true, bannedAt: true },
      });
      platformRole = user && !user.deletedAt && !user.bannedAt ? user.role : undefined;
    } catch {
      platformRole = undefined;
    }
    if (platformRole === 'SUPER_ADMIN') return 'admin';
  }
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
