import { textIsExpense, textIsMoney, type SemanticReader } from './semantic-memory-sight';

/**
 * FU-INSIGHTS-SIGHT (P0; D-100, D-234, D-146): which sights a ProAutoMonitor insight, and the suggestion made of it,
 * need. An insight states money (an overdue total, the month's revenue) or an expense (the month's expenses, a budget)
 * in its text, and it was handed to every member (GET .../ai/monitoring/insights, .../ai/suggestions,
 * .../ai/control-tower). Its needs are decided where it is produced: its category's (an unknown category needs both:
 * fail closed), and what its text states by the rule AiMemory rows are read by (aiMemoryRowVisibleTo).
 */
export type InsightSight = 'revenue' | 'expenses';

/** Each insight category's sights by what it is about (its text may add more). */
const CATEGORY_NEEDS: Readonly<Record<string, readonly InsightSight[]>> = {
  stale_leads: [],
  delayed_projects: [],
  booking_gaps: [],
  content_stale: [],
  automation_health: [],
  storefront_health: [],
  pending_bookings: [],
  overdue_invoices: ['revenue'],
  revenue_trend: ['revenue'],
  client_risk: ['revenue'],
  cost_pressure: ['expenses'],
};

/**
 * The sights free text needs by the rule AiMemory rows are read by (aiMemoryRowVisibleTo, for a row whose category and
 * key name nothing): money (textIsMoney: revenue read), an expense (textIsExpense: expenses read). Security review round 5
 * (ISS-R5-1): the two text rules once each, where two probe readers ran the whole row rule twice.
 */
export function textSightNeeds(text: string): InsightSight[] {
  return [
    ...(textIsMoney(text) ? (['revenue'] as const) : []),
    ...(textIsExpense(text) ? (['expenses'] as const) : []),
  ];
}

/** A value's control characters blanked, in strings and object keys alike, all the way down. */
function blankControls(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/\p{Cc}/gu, ' ');
  if (Array.isArray(value)) return value.map(blankControls);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [blankControls(k) as string, blankControls(v)]));
  }
  return value;
}

/**
 * The readings of a text (as D-238's readings do, a reading is only ever added): the text as written; its escapes
 * (`\n`, `\t`, `\"`, `\\`, `\uXXXX`) read as spaces; its `\uXXXX` escapes decoded; and each with its control
 * characters blanked. A text with no backslash and no control character has one reading: itself.
 */
function readingsOf(text: string): string[] {
  if (!/[\\\p{Cc}]/u.test(text)) return [text];
  const escapesAsSpaces = text.replace(/\\+(?:u[0-9a-fA-F]{4}|[bfnrt"/])?/g, ' ');
  const decoded = text.replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  const blank = (t: string) => t.replace(/\p{Cc}/gu, ' ');
  return [...new Set([text, escapesAsSpaces, decoded, blank(text), blank(escapesAsSpaces), blank(decoded)])];
}

/**
 * Security review round 5 (ISS-R5-1): the most characters of text fieldsSightNeeds reads for one item; past it the item
 * needs both sights, unread (fail closed), as D-238 bounds what it classifies (MAX_CLASSIFIED_CONTENT).
 */
export const MAX_FIELDS_CLASSIFIED = 50_000;

/**
 * Security review round 3 (ISS-R3-1), reviews round 4 (ISS-R4-1, R3-C1, R3-C2): the sights a list of fields needs, by
 * every reading of each field and of the whole list: a string as written, a structured value as JSON as it is and with
 * its control characters blanked (keys included), and every reading of those (readingsOf), with the list read whole as
 * JSON as it always was. Readings are only ever added: one that misses a word (an escape glued to it, a control
 * character before a figure) never takes the place of one that reads it. Round 5: each distinct text is read once, the
 * read stops once both sights are found, and a list over MAX_FIELDS_CLASSIFIED needs both, unread.
 */
export function fieldsSightNeeds(fields: readonly unknown[]): InsightSight[] {
  const whole = JSON.stringify(fields) ?? '';
  if (whole.length > MAX_FIELDS_CLASSIFIED) return ['revenue', 'expenses'];
  const texts: string[] = [whole];
  for (const field of fields) {
    if (field === null || field === undefined) continue;
    if (typeof field === 'string') {
      texts.push(field);
    } else {
      texts.push(JSON.stringify(field) ?? '', JSON.stringify(blankControls(field)) ?? '');
    }
  }
  const needs = new Set<InsightSight>();
  const seen = new Set<string>();
  for (const text of texts) {
    for (const reading of readingsOf(text)) {
      if (seen.has(reading)) continue;
      seen.add(reading);
      for (const sight of textSightNeeds(reading)) needs.add(sight);
      if (needs.size === 2) return ['revenue', 'expenses'];
    }
  }
  return (['revenue', 'expenses'] as const).filter((sight) => needs.has(sight));
}

/** An insight's needs: its category's (both when the category is unknown) and its text's. */
export function insightNeeds(insight: {
  category: string;
  title?: string;
  description?: string;
  metric?: string;
  suggestedAction?: string;
  suggestedTool?: string;
}): InsightSight[] {
  const byCategory = CATEGORY_NEEDS[insight.category] ?? (['revenue', 'expenses'] as const);
  const byText = fieldsSightNeeds([insight.title, insight.description, insight.metric, insight.suggestedAction, insight.suggestedTool]);
  return (['revenue', 'expenses'] as const).filter((sight) => byCategory.includes(sight) || byText.includes(sight));
}

/** Whether `who` holds every sight in `needs` (a member reader with that module read; nobody else). */
export function readerHolds(who: SemanticReader, needs: readonly InsightSight[]): boolean {
  return needs.every((sight) => who.reader !== null && who.sight(sight));
}

/**
 * The words a stored row carries for its sights, each read by the text rule exactly as that sight (as the pattern
 * detector's stamp): 'revenue' (a money term: revenue read), 'suppliers' (an expense word and no money term: expenses
 * read), so the row is withheld wherever it is read as an AiMemory row (GET .../ai/memory, its semantic copies).
 */
export const SIGHT_WORDS: Readonly<Record<InsightSight, string>> = { revenue: 'revenue', expenses: 'suppliers' };

/**
 * The strategic dashboard (StrategicIntelligenceService.getStrategicDashboard) as `who` may read it: a reader who holds
 * revenue and expenses read is handed it whole; anyone else only the fields named here that they may read: its revenue
 * figures (the month's revenue, the outstanding and overdue totals and counts, the pending quotes) at revenue read, the
 * month's expenses at expenses read, the rest (momentum, projects, bookings, stale leads, utilisation) to every member.
 * Security review round 1 (OOS-2): a keep-list, so a field added to the dashboard later is left out until it is named.
 */
const DASHBOARD_SHARED_FIELDS = ['momentumScore', 'activeProjects', 'overdueTaskCount', 'upcomingBookings', 'staleLeads', 'utilizationRate'] as const;
const DASHBOARD_REVENUE_FIELDS = ['monthlyRevenue', 'outstandingRevenue', 'overdueInvoices', 'overdueAmount', 'pendingQuotes', 'pendingQuoteValue'] as const;
const DASHBOARD_EXPENSE_FIELDS = ['expensesThisMonth'] as const;
export function dashboardFor<D extends Record<string, unknown>>(dashboard: D, who: SemanticReader): Partial<D> {
  if (readerHolds(who, ['revenue', 'expenses'])) return dashboard;
  const keep = new Set<string>([
    ...DASHBOARD_SHARED_FIELDS,
    ...(readerHolds(who, ['revenue']) ? DASHBOARD_REVENUE_FIELDS : []),
    ...(readerHolds(who, ['expenses']) ? DASHBOARD_EXPENSE_FIELDS : []),
  ]);
  return Object.fromEntries(Object.entries(dashboard).filter(([field]) => keep.has(field))) as Partial<D>;
}
