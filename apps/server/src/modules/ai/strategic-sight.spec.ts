import { describe, expect, it } from 'vitest';
import { sightedStrategic, strategicItemNeeds } from './strategic-sight';
import type { SemanticReader } from './semantic-memory-sight';

/** A member reader holding exactly `held` (module names). */
const readerWith = (...held: string[]): SemanticReader => ({ reader: 'u', sight: ((m: string) => held.includes(m)) as any });
const owner = readerWith('revenue', 'expenses', 'operations', 'crm');
const blind = readerWith('crm', 'operations');
const revnoexp = readerWith('revenue', 'crm');
const memberless: SemanticReader = { reader: null, sight: (() => true) as any };

const plan = {
  summary: 'SAFEMARK a steady week',
  weekOf: '2026-11-23',
  topPriorities: ['MONEYMARK collect $4,000 from Acme', 'SAFEMARK confirm Tuesday bookings'],
  dailyFocus: [{ day: 'Monday', theme: 'Client outreach', tasks: ['SAFEMARK call two leads', 'MONEYMARK send the $3,341 reminder'] }],
  revenueActions: ['SAFEMARK follow up'],
  expenseReview: { monthToDate: 900, action: 'look again' },
  operationalTasks: ['NETMARK net margin is thin this month', 'SAFEMARK tidy the studio'],
  neglectedLeads: 5,
  pendingQuoteValue: 5200,
  opportunities: [{ title: 'SAFEMARK re-engage cold leads', description: 'Five leads untouched for a month', estimatedValue: 2400 }],
  risks: [{ label: 'Rent', amount: 900 }],
  riskLevel: 'high',
};

describe('sightedStrategic: a strategic answer as the reader may read it (FU-STRATEGIC-ROUTES-SIGHT; D-100, D-234, D-146)', () => {
  it('a reader holding revenue and expenses read gets the answer unchanged (owner parity)', () => {
    expect(sightedStrategic(plan, owner)).toBe(plan);
  });

  it('without revenue read: no money string, no figure (bar the shared lead count), no money key; the rest is kept item by item', () => {
    const out = sightedStrategic(plan, blind) as any;
    const t = JSON.stringify(out);
    for (const marker of ['MONEYMARK', '4,000', '3,341', '5200', '2400', '900', 'NETMARK', 'revenueActions', 'expenseReview', 'pendingQuoteValue', 'riskLevel', 'Rent']) {
      expect(t, marker).not.toContain(marker);
    }
    expect(out.summary).toBe('SAFEMARK a steady week');
    expect(out.topPriorities).toEqual(['SAFEMARK confirm Tuesday bookings']);
    expect(out.dailyFocus).toEqual([{ day: 'Monday', theme: 'Client outreach', tasks: ['SAFEMARK call two leads'] }]);
    expect(out.operationalTasks).toEqual(['SAFEMARK tidy the studio']);
    expect(out.neglectedLeads).toBe(5);
    expect(out.opportunities).toEqual([{ title: 'SAFEMARK re-engage cold leads', description: 'Five leads untouched for a month' }]);
    // An item whose label is withheld is withheld whole: its figure never stands alone.
    expect(out.risks).toEqual([]);
  });

  it('revenue read without expenses read: money is kept; expense text, expense keys and net-profit text (revenue less expenses) are not', () => {
    const out = sightedStrategic(plan, revnoexp) as any;
    const t = JSON.stringify(out);
    expect(t).toContain('MONEYMARK collect $4,000');
    expect(out.pendingQuoteValue).toBe(5200);
    expect(out.revenueActions).toEqual(['SAFEMARK follow up']);
    expect(out.opportunities[0].estimatedValue).toBe(2400);
    for (const marker of ['expenseReview', 'NETMARK', 'Rent', 'riskLevel']) expect(t, marker).not.toContain(marker);
  });

  it('a memberless reader gets nothing that needs a sight (fail closed)', () => {
    const t = JSON.stringify(sightedStrategic(plan, memberless));
    for (const marker of ['MONEYMARK', '5200', 'expenseReview', 'NETMARK']) expect(t, marker).not.toContain(marker);
  });

  it('an answer past the classifier bound is withheld whole for a partial reader (fail closed)', () => {
    const big = { summary: 'SAFEMARK '.repeat(10_000) };
    expect(sightedStrategic(big, blind)).toEqual({});
    expect(sightedStrategic(big, owner)).toBe(big);
  });

  it('a line break or an escape glued to a word does not hide it', () => {
    const out = sightedStrategic({ notes: ['SAFEMARK fine', 'see below\nrent is due', 'the\\nnet result'] }, revnoexp) as any;
    expect(out.notes).toEqual(['SAFEMARK fine']);
  });
});

describe('strategicItemNeeds: a deterministic item (a strategic action, a workspace recommendation) read whole', () => {
  it('money text needs revenue; expense text needs expenses; net-profit text needs both; plain text needs none', () => {
    expect(strategicItemNeeds({ title: 'Collect 2 overdue invoices', description: '$7,341 TTD at risk' })).toContain('revenue');
    expect(strategicItemNeeds({ title: 'Spending concentrated in rent' })).toContain('expenses');
    expect(strategicItemNeeds({ title: 'Margins are thin' })).toEqual(['revenue', 'expenses']);
    expect(strategicItemNeeds({ title: 'Re-engage 5 stale leads', description: 'Send a check-in message.' })).toEqual([]);
  });
});
