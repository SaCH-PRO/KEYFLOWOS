import { fieldsSightNeeds, MAX_FIELDS_CLASSIFIED, readerHolds, readingsOf, type InsightSight } from './insight-sight';
import type { SemanticReader } from './semantic-memory-sight';

/**
 * FU-STRATEGIC-ROUTES-SIGHT (P0; D-100, D-234, D-146): StrategicIntelligenceService's scans (seasonal patterns,
 * opportunities, risks, the weekly plan, a forecast's and pricing advice's items) are written by the model from invoice,
 * quote and expense totals, in a shape the model chooses. Each is answered to a caller as their membership reads it:
 * money at revenue read, an expense at expenses read, net profit (revenue less expenses) at both.
 */

const BOTH: readonly InsightSight[] = ['revenue', 'expenses'];

/**
 * Net profit and what it is made of (revenue less expenses): a margin, a profit or loss, a cash flow, a burn, a deficit,
 * outflows. Stating one states both sides, so it needs both sights. Read on every reading of the text, and with
 * camelCase split ('grossMarginPct'). Review round 1 (SR1-3, CR1-1): 'unprofitable', a loss, the red, P&L, overspending,
 * opex, outflows, and a cash flow or break-even however spelt ('cash_flow', 'Cash-flow').
 */
const NET_WORDS =
  /(?<![a-z])(?:un|non-?)?(profits?|profitab\w*|margins?|net|break[\s_\-\u2013\u2014]?even|cash[\s_\-\u2013\u2014]?flows?|ebit(?:da)?|burn(?:ing|[\s_\-\u2013\u2014]?rate)?|loss(?:es)?|losing[\s_\-\u2013\u2014]?money|deficits?|surplus(?:es)?|in[\s_\-\u2013\u2014]the[\s_\-\u2013\u2014](?:red|black)|p\s*(?:&|and|\/)\s*l|overspen\w*|opex|capex|outflows?|bottom[\s_\-\u2013\u2014]?lines?|insolven\w*|solven\w*|liquidity|runways?|underwater|payback)(?![a-z])/i;
/** Review round 2 (SR2-4) & round 4 (SEC-SRS-6): revenue by its other names. */
const MONEY_WORDS = /(?<![a-z])(turnover|takings|top[\s_\-\u2013\u2014]?lines?|concentration|upsells?)(?![a-z])/i;

/**
 * Review round 2 (SR2-1, SR2-3, CR2-3), round 3 (CR3-1, SR3-1), round 4 (SEC-SRS-4):
 * every default-ignorable code point, all format/control characters (\p{Cf}, \p{Cc}), every combining mark,
 * and the blank braille cell.
 */
const INVISIBLE = /[\p{Default_Ignorable_Code_Point}\p{Cf}\p{Cc}\p{Mn}\p{Me}\u2800]/gu;
function digitValue(ch: string): string {
  let code = ch.codePointAt(0)!;
  let start = code;
  while (/\p{Nd}/u.test(String.fromCodePoint(start - 1)) && code - start < 64) start -= 1;
  return String((code - start) % 10);
}
function folded(text: string): string {
  return text.normalize('NFKC').replace(INVISIBLE, '').replace(/\p{Nd}/gu, (ch) => (/[0-9]/.test(ch) ? ch : digitValue(ch)));
}
/** Decode escapes BEFORE folding so JSON-escaped invisibles (\u200B, \u00AD) are stripped too (SEC-SRS-4). */
function allReadings(text: string): string[] {
  const out = new Set<string>();
  for (const reading of readingsOf(text)) {
    out.add(reading);
    out.add(folded(reading));
  }
  const f = folded(text);
  out.add(f);
  for (const reading of readingsOf(f)) {
    out.add(reading);
    out.add(folded(reading));
  }
  return [...out];
}
const camelSplit = (text: string) => text.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
function statesNet(text: string): boolean {
  if (text.length > MAX_FIELDS_CLASSIFIED) return true;
  return allReadings(text).some((reading) => NET_WORDS.test(reading) || NET_WORDS.test(camelSplit(reading)));
}

/**
 * Review round 1 (SR1-1): a figure, written as a string. The scans are written from revenue totals ("Avg Revenue $X" a
 * month), so a figure the model writes without a currency sign is revenue all the same: two digits or more (separators
 * between them allowed), a digit with a k/M/bn, % or x after it, or a number word. Read with the text NFKC-folded
 * (fullwidth digits). A lone digit ('call 2 leads') and a date alone ('2026-11-23') state no figure.
 */
const FIGURE =
  /\d[\s,.'\u00a0\u202f]?\d|\d\s*(?:k|m|mm|mn|mil|mio|bn|b|%|x|percent|pct|per[\s-]?cent|lakhs?|lacs?|crores?)(?![a-z])|\d\s*[万億亿千]|(?<![a-z])(?:hundred|thousand|million|billion|grand)s?(?![a-z])/i;
/** Review round 2 (SR2-2): a date, with a clock time at most: nothing after it. */
const DATE_ALONE = /^\s*\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?)?\s*$/;
function statesFigure(text: string): boolean {
  if (text.length > MAX_FIELDS_CLASSIFIED) return true;
  const plain = folded(text);
  if (DATE_ALONE.test(plain)) return false;
  return allReadings(text).some((reading) => FIGURE.test(reading));
}

/**
 * A text's sights, on the text as written and as it reads (decoded then folded): money and expenses by the AiMemory
 * rule (fieldsSightNeeds), revenue for a figure or revenue's other names, both for net profit.
 */
function textNeeds(text: string): readonly InsightSight[] {
  const readings = allReadings(text);
  if (readings.some((reading) => NET_WORDS.test(reading) || NET_WORDS.test(camelSplit(reading)))) return BOTH;
  const needs = new Set<InsightSight>(fieldsSightNeeds(readings));
  if (needs.size === 2) return BOTH;
  if (statesFigure(text) || readings.some((reading) => MONEY_WORDS.test(reading))) needs.add('revenue');
  return (['revenue', 'expenses'] as const).filter((sight) => needs.has(sight));
}

/**
 * The keys of the scans' answers whose value is about money or expenses whatever it reads as (a month name ranked by
 * revenue, a cash-flow verdict, a risk score scored from overdue totals and expense pressure).
 */
const STRATEGIC_KEY_NEEDS: Readonly<Record<string, readonly InsightSight[]>> = {
  peakMonths: ['revenue'],
  slowMonths: ['revenue'],
  monthlyData: ['revenue'],
  pendingQuoteValue: ['revenue'],
  totalPotentialValue: ['revenue'],
  overdueTotal: ['revenue'],
  overdueCount: ['revenue'],
  estimatedValue: ['revenue'],
  recurringRevenue: ['revenue'],
  revenueActions: ['revenue'],
  expenseReview: ['expenses'],
  expenseInsights: ['expenses'],
  riskLevel: BOTH,
  riskScore: BOTH,
  cashFlowHealth: BOTH,
};

/** Counts the scans carry that state no money: the reader without revenue read keeps them. */
const SHARED_NUMBER_KEYS: ReadonlySet<string> = new Set(['neglectedLeads']);

/**
 * Optional numeric metric keys on a non-money card (e.g. an opportunity card's estimatedValue) that may be stripped
 * without withholding the card itself; any other disallowed key on a nested object withholds the object whole (SEC-SRS-3).
 */
const DROPPABLE_NESTED_KEYS: ReadonlySet<string> = new Set(['estimatedValue']);

/**
 * The scans' own schema keys the money rule takes for money ('opportunities' for a pipeline): read as plain keys.
 * Every other key (including price keys: SEC-SRS-5) is read like text (SR1-2).
 */
const KEYS_NOT_MONEY: ReadonlySet<string> = new Set(['opportunities', 'bundleOpportunities']);

/** A key's sights: STRATEGIC_KEY_NEEDS' (own keys only: SR1-4), and its words' and figures' as text, camelCase split. */
function keyNeeds(key: string): readonly InsightSight[] {
  const needs = new Set<InsightSight>(Object.hasOwn(STRATEGIC_KEY_NEEDS, key) ? STRATEGIC_KEY_NEEDS[key] : []);
  for (const text of [key, camelSplit(key)]) {
    for (const sight of textNeeds(text)) needs.add(sight);
  }
  if (KEYS_NOT_MONEY.has(key) && !(Object.hasOwn(STRATEGIC_KEY_NEEDS, key) && STRATEGIC_KEY_NEEDS[key].includes('revenue'))) {
    needs.delete('revenue');
  }
  return [...needs];
}

const WITHHELD = Symbol('withheld');
const DROPPED = Symbol('dropped');

/**
 * A scan's answer as `who` may read it. A reader holding revenue and expenses read gets it unchanged. For any other:
 * - a key whose sights they do not hold is dropped at top level (or on DROPPABLE_NESTED_KEYS); on a nested object any
 *   other disallowed key withholds the nested object whole (SEC-SRS-3);
 * - a string is kept only if they hold its sights (money, expenses, net profit: textNeeds);
 * - a figure is kept only at revenue read (or under a shared count key): it is dropped, not its item;
 * - a list keeps the items they may read;
 * - a nested object whose keys are all dropped is itself dropped (never left as an empty {} ghost: SEC-SRS-3);
 * - an object inside the answer with a withheld string is withheld whole (its figures and the rest never stand alone);
 * - an unserializable answer (e.g. BigInt, circular: CR-3) or one over the classifier bound is withheld whole (fail closed).
 */
export function sightedStrategic<T>(answer: T, who: SemanticReader): T {
  if (readerHolds(who, BOTH)) return answer;
  let serialized: string;
  try {
    serialized = JSON.stringify(answer) ?? '';
  } catch {
    return (Array.isArray(answer) ? [] : {}) as T;
  }
  if (serialized.length > MAX_FIELDS_CLASSIFIED) return (Array.isArray(answer) ? [] : {}) as T;
  const readsRevenue = readerHolds(who, ['revenue']);

  const visit = (value: unknown, key: string | undefined, top: boolean): unknown => {
    if (typeof value === 'string') return readerHolds(who, textNeeds(value)) ? value : WITHHELD;
    if (typeof value === 'number' || typeof value === 'bigint') {
      return readsRevenue || (key !== undefined && SHARED_NUMBER_KEYS.has(key)) ? value : DROPPED;
    }
    if (Array.isArray(value)) {
      return value.map((item) => visit(item, undefined, false)).filter((item) => item !== WITHHELD && item !== DROPPED);
    }
    if (value && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>);
      const out: Record<string, unknown> = {};
      for (const [k, v] of entries) {
        if (!readerHolds(who, keyNeeds(k))) {
          if (top || DROPPABLE_NESTED_KEYS.has(k)) continue;
          return WITHHELD;
        }
        const kept = visit(v, k, false);
        if (kept === DROPPED) continue;
        if (kept === WITHHELD) {
          if (top) continue;
          return WITHHELD;
        }
        // Defined, not assigned: a '__proto__' key from the model is a plain field (SR1-4), never the prototype.
        Object.defineProperty(out, k, { value: kept, enumerable: true, writable: true, configurable: true });
      }
      if (!top && entries.length > 0 && Object.keys(out).length === 0) return DROPPED;
      return out;
    }
    return value;
  };

  const out = visit(answer, undefined, true);
  return (out === WITHHELD || out === DROPPED ? (Array.isArray(answer) ? [] : {}) : out) as T;
}

/**
 * A deterministic item (a strategic action, a workspace recommendation) read whole: its text's sights by the AiMemory
 * rule, MONEY_WORDS (SEC-SRS-6), and both for net profit ('Margin pressure detected'). Fails closed on unserializable
 * values such as BigInt (CR-3).
 */
export function strategicItemNeeds(item: unknown): InsightSight[] {
  let json: string;
  try {
    json = JSON.stringify(item) ?? '';
  } catch {
    return [...BOTH];
  }
  const readings = allReadings(json);
  const needs = new Set<InsightSight>(fieldsSightNeeds([item, ...readings]));
  if (needs.size === 2 || readings.some((r) => NET_WORDS.test(r) || NET_WORDS.test(camelSplit(r)))) return [...BOTH];
  if (readings.some((r) => MONEY_WORDS.test(r))) needs.add('revenue');
  return (['revenue', 'expenses'] as const).filter((sight) => needs.has(sight));
}

/**
 * Each strategic action type's sights by what it is about (its words may add more, and its 'revenue' category adds
 * revenue); an unknown type needs both.
 */
export const STRATEGIC_ACTION_NEEDS: Readonly<Record<string, readonly InsightSight[]>> = {
  collect_overdue: ['revenue'],
  convert_quotes: ['revenue'],
  re_engage_leads: [],
  clear_overdue_tasks: [],
  boost_momentum: [],
  fill_schedule: [],
};
