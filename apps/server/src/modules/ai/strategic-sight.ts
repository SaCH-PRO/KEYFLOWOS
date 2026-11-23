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
 * Net profit and what it is made of (revenue less expenses): a margin, a profit, a cash flow, a burn. Stating one states
 * both sides, so it needs both sights. Read on every reading of the text, and with camelCase split ('grossMarginPct').
 */
const NET_WORDS = /(?<![a-z])(profits?|profitab\w*|margins?|net|break-?even|cash ?flows?|ebitda|burn(?:ing| rate)?)(?![a-z])/i;
const camelSplit = (text: string) => text.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
function statesNet(text: string): boolean {
  if (text.length > MAX_FIELDS_CLASSIFIED) return true;
  return readingsOf(text).some((reading) => NET_WORDS.test(reading) || NET_WORDS.test(camelSplit(reading)));
}

/** A text's sights: money and expenses by the AiMemory rule (fieldsSightNeeds), and both for net profit. */
function textNeeds(text: string): readonly InsightSight[] {
  const needs = fieldsSightNeeds([text]);
  return needs.length === 2 || statesNet(text) ? BOTH : needs;
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
 * A key's sights: STRATEGIC_KEY_NEEDS', an expense named in it, and both for net profit. Money named in a key is not
 * read (the money rule takes 'opportunities' for a pipeline); a key's value is read on its own, and a figure needs
 * revenue read wherever it stands.
 */
function keyNeeds(key: string): readonly InsightSight[] {
  if (statesNet(key)) return BOTH;
  const named = STRATEGIC_KEY_NEEDS[key] ?? [];
  const expense = fieldsSightNeeds([key, camelSplit(key)]).includes('expenses');
  return expense ? [...new Set<InsightSight>([...named, 'expenses'])] : named;
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
        out[k] = kept;
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
