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
  /(?<![a-z])(?:un|non-?)?(profits?|profitab\w*|margins?|net|break[\s_-]?even|cash[\s_-]?flows?|ebitda|burn(?:ing|[\s_-]?rate)?|loss(?:es)?|losing[\s_-]?money|deficits?|surplus(?:es)?|in[\s_-]the[\s_-](?:red|black)|p\s*(?:&|and)\s*l|overspen\w*|opex|outflows?)(?![a-z])/i;
const camelSplit = (text: string) => text.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
function statesNet(text: string): boolean {
  if (text.length > MAX_FIELDS_CLASSIFIED) return true;
  return readingsOf(text).some((reading) => NET_WORDS.test(reading) || NET_WORDS.test(camelSplit(reading)));
}

/**
 * Review round 1 (SR1-1): a figure, written as a string. The scans are written from revenue totals ("Avg Revenue $X" a
 * month), so a figure the model writes without a currency sign is revenue all the same: two digits or more (separators
 * between them allowed), a digit with a k/M/bn, % or x after it, or a number word. Read with the text NFKC-folded
 * (fullwidth digits). A lone digit ('call 2 leads') and a date alone ('2026-11-23') state no figure.
 */
const FIGURE = /\d[\s,.'\u00a0\u202f]?\d|\d\s*(?:k|m|mm|bn|b|%|x)(?![a-z])|(?<![a-z])(?:hundred|thousand|million|billion|grand)s?(?![a-z])/i;
const DATE_ALONE = /^\s*\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+Z?)?\s*$/;
function statesFigure(text: string): boolean {
  if (text.length > MAX_FIELDS_CLASSIFIED) return true;
  if (DATE_ALONE.test(text)) return false;
  const folded = text.normalize('NFKC');
  return readingsOf(folded).some((reading) => FIGURE.test(reading));
}

/** A text's sights: money and expenses by the AiMemory rule (fieldsSightNeeds), revenue for a figure, both for net profit. */
function textNeeds(text: string): readonly InsightSight[] {
  if (statesNet(text)) return BOTH;
  const needs = fieldsSightNeeds([text]);
  if (needs.length === 2) return BOTH;
  return statesFigure(text) && !needs.includes('revenue') ? [...needs, 'revenue'] : needs;
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
 * The scans' own schema keys the money rule takes for money ('opportunities' for a pipeline, a price): read as plain
 * keys. Every other key is read like text (review round 1, SR1-2): 'revenueTrend', 'topClientsByRevenue', a key that is
 * itself a figure.
 */
const KEYS_NOT_MONEY: ReadonlySet<string> = new Set(['opportunities', 'bundleOpportunities', 'currentPrice', 'suggestedPrice', 'pricingPrinciples']);

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
 * - a key whose sights they do not hold is dropped (keyNeeds);
 * - a string is kept only if they hold its sights (money, expenses, net profit: textNeeds);
 * - a figure is kept only at revenue read (or under a shared count key): it is dropped, not its item;
 * - a list keeps the items they may read;
 * - an object inside the answer with a withheld string is withheld whole (its figures and the rest never stand alone);
 * - an answer over the classifier bound is withheld whole (fail closed).
 */
export function sightedStrategic<T>(answer: T, who: SemanticReader): T {
  if (readerHolds(who, BOTH)) return answer;
  if ((JSON.stringify(answer) ?? '').length > MAX_FIELDS_CLASSIFIED) return (Array.isArray(answer) ? [] : {}) as T;
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
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (!readerHolds(who, keyNeeds(k))) continue;
        const kept = visit(v, k, false);
        if (kept === DROPPED) continue;
        if (kept === WITHHELD) {
          if (top) continue;
          return WITHHELD;
        }
        // Defined, not assigned: a '__proto__' key from the model is a plain field (SR1-4), never the prototype.
        Object.defineProperty(out, k, { value: kept, enumerable: true, writable: true, configurable: true });
      }
      return out;
    }
    return value;
  };

  const out = visit(answer, undefined, true);
  return (out === WITHHELD || out === DROPPED ? (Array.isArray(answer) ? [] : {}) : out) as T;
}

/**
 * A deterministic item (a strategic action, a workspace recommendation) read whole: its text's sights by the AiMemory
 * rule, and both for net profit ('Margin pressure detected').
 */
export function strategicItemNeeds(item: unknown): InsightSight[] {
  const needs = fieldsSightNeeds([item]);
  if (needs.length === 2 || statesNet(JSON.stringify(item) ?? '')) return [...BOTH];
  return needs;
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
