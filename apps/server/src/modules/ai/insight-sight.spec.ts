/** FU-INSIGHTS-SIGHT (security review round 1, OOS-2): dashboardFor keeps named fields only, so a field added later fails closed. */
import { describe, it, expect } from 'vitest';
import { dashboardFor, fieldsSightNeeds, insightNeeds, keepWithinBudget } from './insight-sight';

const blind = { reader: 'u1', sight: (m: string) => m !== 'revenue' && m !== 'expenses' } as any;
const full = { reader: 'u0', sight: () => true } as any;

describe('dashboardFor keeps a field only when it is known and the reader holds its sight', () => {
  const dashboard = {
    momentumScore: 40, activeProjects: 2, overdueTaskCount: 1, upcomingBookings: 3, staleLeads: 5, utilizationRate: 60,
    monthlyRevenue: 1000, outstandingRevenue: 7341, overdueInvoices: 2, overdueAmount: 7341, pendingQuotes: 1, pendingQuoteValue: 250,
    expensesThisMonth: 900, cashRunwayDays: 12,
  };
  it('a field it does not know (a money field added later) is left out for every reader but one who reads everything', () => {
    expect(dashboardFor(dashboard, blind)).toEqual({ momentumScore: 40, activeProjects: 2, overdueTaskCount: 1, upcomingBookings: 3, staleLeads: 5, utilizationRate: 60 });
    expect(dashboardFor(dashboard, full)).toEqual(dashboard);
  });
});

describe('insightNeeds reads each text field as written (security review round 3, ISS-R3-1)', () => {
  it('an expense or money word after a line break, a tab or a carriage return is read (JSON escaping no longer glues it to a letter)', () => {
    expect(insightNeeds({ category: 'stale_leads', description: 'Monthly\nrent is due' })).toContain('expenses');
    expect(insightNeeds({ category: 'stale_leads', title: 'Process\tpayroll' })).toContain('expenses');
    expect(insightNeeds({ category: 'stale_leads', metric: 'Pay\rsuppliers' })).toContain('expenses');
    expect(insightNeeds({ category: 'stale_leads', title: '5 stale leads', description: 'Follow up' })).toEqual([]);
  });
});

describe('fieldsSightNeeds only ever adds readings (reviews round 4: ISS-R4-1, R3-C1, R3-C2)', () => {
  it.each([
    ['a key with a line break', [{ 'Pay\nsuppliers': true }], 'expenses'],
    ['a key with a tab', [{ 'monthly\tutilities': true }], 'expenses'],
    ['a key "Monthly\\nrent"', [{ 'Monthly\nrent': 1 }], 'expenses'],
    ['literal escape text in a string', ['Pay\\nsuppliers'], 'expenses'],
    ['a nested JSON string in a payload', [{ body: JSON.stringify({ note: 'Line one\nsuppliers due' }) }], 'expenses'],
    ['a JSON string field', [JSON.stringify(['a\tvendors'])], 'expenses'],
    ['a control character before a figure ("Wire\\u0003900")', ['Wire\u0003900 to them'], 'revenue'],
    ['a control character after a currency sign ("$\\u0001900")', ['$\u0001900 due'], 'revenue'],
  ] as const)('%s is read', (_label, fields, sight) => {
    expect(fieldsSightNeeds(fields as unknown as unknown[])).toContain(sight);
  });

  it('a plain field needs nothing (control)', () => {
    expect(fieldsSightNeeds(['5 stale leads', { note: 'Follow up next week' }, null, 3])).toEqual([]);
  });
});

describe('fieldsSightNeeds is bounded (security review round 5, ISS-R5-1)', () => {
  it('fields whose text exceeds the classifier bound need both sights, unread (fail closed, as D-238 does)', () => {
    const big = 'printer jams '.repeat(4_000);
    expect(fieldsSightNeeds([big, big])).toEqual(['revenue', 'expenses']);
  });
  it('under the bound, plain text still needs nothing (control)', () => {
    expect(fieldsSightNeeds(['printer jams '.repeat(100)])).toEqual([]);
  });
});

describe('keepWithinBudget bounds what one request classifies (security review round 6, ISS-R6-1)', () => {
  it('classifies items in order until the budget is spent; every later item is withheld unclassified (fail closed)', () => {
    const items = ['a', 'b', 'c', 'd'];
    const classified: string[] = [];
    const kept = keepWithinBudget(items, () => 40, (item) => {
      classified.push(item);
      return item !== 'b';
    }, 100);
    expect(classified).toEqual(['a', 'b']);
    expect(kept).toEqual(['a']);
  });
  it('an item larger than the whole budget is withheld unclassified; nothing after it is classified', () => {
    const classified: string[] = [];
    expect(keepWithinBudget(['huge', 'small'], (i) => (i === 'huge' ? 500 : 1), (i) => { classified.push(i); return true; }, 100)).toEqual([]);
    expect(classified).toEqual([]);
  });
});
