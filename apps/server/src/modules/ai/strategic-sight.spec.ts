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

describe('sightedStrategic review round 1 (FU-STRATEGIC-ROUTES-SIGHT)', () => {
  it('SR1-1: without revenue read, a string stating a figure is withheld (the scans are written from revenue totals); a date and a lone small count are kept', () => {
    const out = sightedStrategic(
      {
        notes: [
          'December averages 18,500 versus 9,200 in February',
          'Goal: bring in 20000 this week',
          'Weekly target: close 12k',
          'Up 35% on last month',
          'Acme brought in about 1.2M',
          'plain 4 000 here',
          'fullwidth ４０００ too',
          'Chase Acme for the 3,200 they still owe',
          'SAFEMARK call 2 leads',
        ],
        weekOf: '2026-11-23',
      },
      blind,
    ) as any;
    expect(out.notes).toEqual(['SAFEMARK call 2 leads']);
    expect(out.weekOf).toBe('2026-11-23');
    // Control: a revenue reader keeps the figures.
    expect((sightedStrategic({ notes: ['Up 35% on last month'] }, revnoexp) as any).notes).toEqual(['Up 35% on last month']);
  });

  it('SR1-2: without revenue read, a key naming money or stating a figure is withheld with its value; the scans\' own list keys are kept', () => {
    const out = sightedStrategic(
      {
        revenueTrend: 'declining',
        salesTrend: 'up',
        topClientsByRevenue: ['Acme Ltd'],
        revenueGrowing: true,
        'TTD 40,000 overdue': 'critical',
        $12k: 'x',
        opportunities: ['SAFEMARK re-engage'],
        quickWins: ['SAFEMARK post'],
      },
      blind,
    );
    expect(out).toEqual({ opportunities: ['SAFEMARK re-engage'], quickWins: ['SAFEMARK post'] });
  });

  it('SR1-3 / CR1-1: net position (a loss, a deficit, the red, P&L, overspending, unprofitable, a cash-flow verdict however spelt) needs expenses read too', () => {
    const lines = [
      'The business is unprofitable',
      'nonprofitable line',
      'Operating at a loss',
      'losing money on deliveries',
      'In the red this quarter',
      'a deficit is likely',
      'P&L negative',
      'Overspending on supplies',
      'Cash-flow negative next month',
      'cash_flow',
      'break-even by June',
      'opex is climbing',
      'Outflows will exceed collections',
    ];
    const out = sightedStrategic({ notes: [...lines, 'SAFEMARK keep going'], outflow: 1200, opex: 3000, risks: [{ category: 'cash_flow', title: 'Squeeze in March' }] }, revnoexp) as any;
    expect(out).toEqual({ notes: ['SAFEMARK keep going'], risks: [] });
  });

  it('SR1-4: keys every object has (constructor, toString, __proto__) are read as plain keys, not answered with a 500', () => {
    const answer = JSON.parse('{"constructor":"SAFEMARK a","toString":"SAFEMARK b","hasOwnProperty":"SAFEMARK c","__proto__":"SAFEMARK d","valueOf":"SAFEMARK e"}');
    expect(() => sightedStrategic(answer, blind)).not.toThrow();
    expect(JSON.stringify(sightedStrategic(answer, blind))).toContain('SAFEMARK a');
  });
});

describe('sightedStrategic review round 2 (FU-STRATEGIC-ROUTES-SIGHT)', () => {
  it('SR2-1 / CR2-3: decimal digits of any script state a figure (Arabic-Indic, Extended Arabic-Indic, Devanagari)', () => {
    const out = sightedStrategic({ notes: ['Avg ٤٬٠٠٠ in July', 'Avg ۴۰۰۰ in July', 'Avg ४००० in July', 'SAFEMARK July is busy'] }, blind) as any;
    expect(out.notes).toEqual(['SAFEMARK July is busy']);
  });

  it('SR2-2: a date stands alone only as a date (and a clock time): a figure after it is a figure', () => {
    const out = sightedStrategic({ a: '2026-11-23', b: '2026-11-23T09:30:00Z', c: '2026-11-23 4000', d: '2026-11-23T4.000.000', e: '2026-11-23 ...8500' }, blind) as any;
    expect(out).toEqual({ a: '2026-11-23', b: '2026-11-23T09:30:00Z' });
  });

  it('SR2-3: net profit and expenses are read in fullwidth and mathematical letters and through soft hyphens and zero-width characters', () => {
    const rev = sightedStrategic({ notes: ['ｐｒｏｆｉｔ is thin', '𝐩𝐫𝐨𝐟𝐢𝐭 is thin', 'pro­fit is thin', 'pro​fit is thin', 'SAFEMARK fine'] }, revnoexp) as any;
    expect(rev.notes).toEqual(['SAFEMARK fine']);
    const bl = sightedStrategic({ notes: ['ｓｐｅｎｔ a lot', 're​nt is due', 'SAFEMARK fine'] }, blind) as any;
    expect(bl.notes).toEqual(['SAFEMARK fine']);
  });

  it('SR2-4: the bottom line, solvency, liquidity, a runway, being underwater and payback are net position; turnover, takings and the top line are money; a percent in words is a figure', () => {
    const rev = sightedStrategic(
      { notes: ['Protect the bottom line', 'Risk of being insolvent', 'solvency is fine', 'liquidity is tight', 'cash runway is short', 'underwater on the van', 'payback in a year', 'SAFEMARK fine'] },
      revnoexp,
    ) as any;
    expect(rev.notes).toEqual(['SAFEMARK fine']);
    const bl = sightedStrategic({ notes: ['turnover is up', 'takings are down', 'grow the top line', 'grew 8 percent', 'up 8 pct', 'up 8 per cent', 'SAFEMARK fine'] }, blind) as any;
    expect(bl.notes).toEqual(['SAFEMARK fine']);
  });
});

describe('sightedStrategic review round 3 (FU-STRATEGIC-ROUTES-SIGHT)', () => {
  const marks = ['‎', '‬', '⁦', '͏', '️', '⁡', '⁣', '᠎', '\u{e0020}', 'ㅤ', '⠀'];

  it('CR3-1 / SR3-1: no default-ignorable code point, combining mark or blank filler hides net profit, an expense or a figure', () => {
    const rev = sightedStrategic({ notes: [...marks.map((x) => `pro${x}fit is thin`), 'SAFEMARK fine'] }, revnoexp) as any;
    expect(rev.notes).toEqual(['SAFEMARK fine']);
    const bl = sightedStrategic({ notes: [...marks.map((x) => `re${x}nt is due`), ...marks.map((x) => `4${x}5${x}0${x}0`), 'SAFEMARK fine'] }, blind) as any;
    expect(bl.notes).toEqual(['SAFEMARK fine']);
  });

  it('SR3-2: a single digit with a scale word (mn, mil, mio, lakh, lac, crore, 万, 億, 亿, 千) is a figure', () => {
    const out = sightedStrategic({ notes: ['about 5 mn this year', '5 mil', '3 mio', '5 lakh', '2 lacs', '2 crore', '5万', '3億', '2亿', '8千', 'SAFEMARK fine'] }, blind) as any;
    expect(out.notes).toEqual(['SAFEMARK fine']);
  });

  it('SR3-3: an item is read on its folded text too', () => {
    expect(strategicItemNeeds({ title: 'pro‎fit is thin' })).toEqual(['revenue', 'expenses']);
    expect(strategicItemNeeds({ title: 'ｐｒｏｆｉｔ is thin' })).toEqual(['revenue', 'expenses']);
  });
});
