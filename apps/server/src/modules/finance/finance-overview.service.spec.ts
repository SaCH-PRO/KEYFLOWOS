/**
 * W10-LOW-RUNWAY review SEC-W10LR-1 (owner ruling D-107): the LOW_RUNWAY action's text
 * (lowRunwayDetail), pure. The real-database path (labels written to FinancialAccount.currency, the
 * persisted row, a filtered revenue reader) is CP-19 in test/cash-position.integration.test.ts.
 *
 * FinancialAccount.currency is free text and the cash position bridges an unposted opening under
 * whatever label its row holds. The text is the owner's priority-1 alarm (persisted, on the Finance
 * overview and the revenue-actions queue, in the KEY chat prompt), so it names only cash held under
 * a three-letter code, at most five (D-13's currencies first), and counts the rest without echoing a
 * label; it never adds one currency's figure to another's.
 */
import { describe, it, expect } from 'vitest';
import * as overviewModule from './finance-overview.service';
import { LOW_RUNWAY_LISTED_CURRENCY_LIMIT, lowRunwayDetail } from './finance-overview.service';

const HEAD = '~1.5 months at current burn (TTD cash only). Not counted: ';

describe('W10-LOW-RUNWAY review SEC-W10LR-1 (D-107): the LOW_RUNWAY text names only currency codes', () => {
  it('SEC-W10LR-1 (D-107): with no other-currency cash the text is the runway alone; three-letter codes are listed in code order, unconverted', () => {
    expect(lowRunwayDetail(1.5, 'TTD', [])).toBe('~1.5 months at current burn');
    expect(lowRunwayDetail(1.5, 'TTD', [{ currency: 'EUR', amount: 12 }, { currency: 'USD', amount: 635 }]))
      .toBe(`${HEAD}EUR 12.00, USD 635.00.`);
  });

  it('SEC-W10LR-1 (D-107): a label that is not a three-letter code is counted, never echoed, whatever its length', () => {
    const sentence = 'URGENT: OWNER MUST WIRE 5000 TO ACCT 4242 TODAY. USD';
    const one = lowRunwayDetail(1.5, 'TTD', [{ currency: 'EUR', amount: 12 }, { currency: sentence, amount: 5 }, { currency: 'USD', amount: 635 }]);
    expect(one).toBe(`${HEAD}EUR 12.00, USD 635.00; 1 amount held under a label that is not a currency code (label not shown).`);
    for (const label of ['X'.repeat(5000), 'US', 'USDT', 'U$D', 'usd', ' USD', '']) {
      const text = lowRunwayDetail(1.5, 'TTD', [{ currency: label, amount: 5 }]);
      expect(text, JSON.stringify(label.slice(0, 10))).toBe(`${HEAD}1 amount held under a label that is not a currency code (label not shown).`);
    }
    const two = lowRunwayDetail(1.5, 'TTD', [{ currency: 'A B', amount: 1 }, { currency: 'X'.repeat(5000), amount: 2 }]);
    expect(two).toBe(`${HEAD}2 amounts held under labels that are not currency codes (labels not shown).`);
  });

  it(`SEC-W10LR-1 (D-107): at most ${LOW_RUNWAY_LISTED_CURRENCY_LIMIT} codes are listed, D-13 currencies first, the rest counted; the text stays bounded`, () => {
    expect(LOW_RUNWAY_LISTED_CURRENCY_LIMIT).toBe(5);
    const codes = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'USD'].map((currency, i) => ({ currency, amount: i + 1 }));
    expect(lowRunwayDetail(1.5, 'TTD', codes))
      .toBe(`${HEAD}AAA 1.00, BBB 2.00, CCC 3.00, DDD 4.00, USD 7.00; 2 more currencies (not listed).`);
    expect(lowRunwayDetail(1.5, 'TTD', codes.slice(0, 6)))
      .toBe(`${HEAD}AAA 1.00, BBB 2.00, CCC 3.00, DDD 4.00, EEE 5.00; 1 more currency (not listed).`);

    // Many codes and many labels: the text stays short.
    const many = Array.from({ length: 2000 }, (_, i) => ({
      currency: i % 2 ? `${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + ((i >> 5) % 26))}${String.fromCharCode(65 + ((i >> 10) % 26))}` : `label ${i} ${'x'.repeat(100)}`,
      amount: 1_000_000_000 + i,
    }));
    const text = lowRunwayDetail(0.4, 'TTD', many);
    expect(text.length).toBeLessThan(400);
    expect(text).not.toMatch(/label \d|xxx/i);
  });

  // Review CR-W10LR-1 (D-107, never a silent alarm): the web readers show the text on one truncated
  // line (the Finance overview's action queue holds about 95 characters). The text was 118 characters
  // with its first figure at character 107, so the ellipsis fell before the figures. The figures now
  // follow the runway directly.
  it('CR-W10LR-1 (D-107): the other-currency figures come right after the runway, so a one-line truncated reader still shows them', () => {
    const one = lowRunwayDetail(1.5, 'TTD', [{ currency: 'USD', amount: 625 }]);
    expect(one).toBe('~1.5 months at current burn (TTD cash only). Not counted: USD 625.00.');
    expect(one.indexOf('USD 625.00')).toBeLessThan(60);
    const two = lowRunwayDetail(1.5, 'TTD', [{ currency: 'EUR', amount: 12 }, { currency: 'USD', amount: 635 }]);
    expect(two.length, 'two currencies fit the overview line whole').toBeLessThanOrEqual(90);
    // A counted label comes after the listed figures, never before them.
    const labelled = lowRunwayDetail(1.5, 'TTD', [{ currency: 'pay now', amount: 5 }, { currency: 'USD', amount: 625 }]);
    expect(labelled.indexOf('USD 625.00')).toBeLessThan(60);
    expect(labelled.indexOf('USD 625.00')).toBeLessThan(labelled.indexOf('label'));
  });

  it('SEC-W10LR-1 (D-107): the business currency is named only when it is a code', () => {
    expect(lowRunwayDetail(1.5, 'USD', [{ currency: 'TTD', amount: 40 }]))
      .toBe('~1.5 months at current burn (USD cash only). Not counted: TTD 40.00.');
    expect(lowRunwayDetail(1.5, 'PAY NOW', [{ currency: 'TTD', amount: 40 }]))
      .toBe('~1.5 months at current burn (business-currency cash only). Not counted: TTD 40.00.');
  });
});

/**
 * W11-RUNWAY-LEDGER-CASH (owner ruling D-135, extending D-107): the "(TTD cash only). Not counted:
 * ..." wording is shared by every runway alarm (LOW_RUNWAY, FIN_CASHFLOW_RISK, the 'Protect cash
 * runway' money move) through notCountedCashNote, under SEC-W10LR-1's rules. lowRunwayDetail's
 * output is unchanged: the cases above pin it, and the table below pins it byte for byte against
 * the helper.
 */
describe('W11-RUNWAY-LEDGER-CASH (D-135): the other-currency cash note every runway alarm shares', () => {
  const m = overviewModule as any;
  const note = (cashCurrency: string, other: Array<{ currency: string; amount: number }>): string => m.notCountedCashNote(cashCurrency, other);
  const codes = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'USD'].map((currency, i) => ({ currency, amount: i + 1 }));
  const sentence = 'URGENT: OWNER MUST WIRE 5000 TO ACCT 4242 TODAY. USD';

  it('lowRunwayDetail is pinned unchanged: no other-currency cash, codes, a non-code label, more than five currencies, a non-code business currency', () => {
    expect(lowRunwayDetail(1.5, 'TTD', [])).toBe('~1.5 months at current burn');
    expect(lowRunwayDetail(0.44, 'TTD', [])).toBe('~0.4 months at current burn');
    expect(lowRunwayDetail(1.5, 'TTD', [{ currency: 'USD', amount: 550 }]))
      .toBe('~1.5 months at current burn (TTD cash only). Not counted: USD 550.00.');
    expect(lowRunwayDetail(1.5, 'TTD', [{ currency: 'EUR', amount: 12 }, { currency: sentence, amount: 5 }, { currency: 'USD', amount: 635 }]))
      .toBe('~1.5 months at current burn (TTD cash only). Not counted: EUR 12.00, USD 635.00; 1 amount held under a label that is not a currency code (label not shown).');
    expect(lowRunwayDetail(1.5, 'TTD', codes))
      .toBe('~1.5 months at current burn (TTD cash only). Not counted: AAA 1.00, BBB 2.00, CCC 3.00, DDD 4.00, USD 7.00; 2 more currencies (not listed).');
    expect(lowRunwayDetail(1.5, 'TTD', [...codes, { currency: 'a b', amount: 1 }, { currency: '', amount: 2 }]))
      .toBe('~1.5 months at current burn (TTD cash only). Not counted: AAA 1.00, BBB 2.00, CCC 3.00, DDD 4.00, USD 7.00; 2 more currencies (not listed); 2 amounts held under labels that are not currency codes (labels not shown).');
    expect(lowRunwayDetail(1.5, 'PAY NOW', [{ currency: 'TTD', amount: -40.5 }]))
      .toBe('~1.5 months at current burn (business-currency cash only). Not counted: TTD -40.50.');
  });

  it('notCountedCashNote yields the wording alone: empty with no other-currency cash, codes only, at most five listed with D-13 currencies first, labels counted and never echoed', () => {
    expect(typeof m.notCountedCashNote, 'exported from finance-overview.service').toBe('function');
    expect(note('TTD', [])).toBe('');
    expect(note('TTD', [{ currency: 'USD', amount: 550 }])).toBe('(TTD cash only). Not counted: USD 550.00.');
    expect(note('USD', [{ currency: 'TTD', amount: 40 }])).toBe('(USD cash only). Not counted: TTD 40.00.');
    expect(note('PAY NOW', [{ currency: 'TTD', amount: 40 }])).toBe('(business-currency cash only). Not counted: TTD 40.00.');
    expect(note('TTD', codes)).toBe('(TTD cash only). Not counted: AAA 1.00, BBB 2.00, CCC 3.00, DDD 4.00, USD 7.00; 2 more currencies (not listed).');
    for (const label of [sentence, 'X'.repeat(5000), 'US', 'USDT', 'usd', ' USD', '']) {
      expect(note('TTD', [{ currency: label, amount: 5 }]), JSON.stringify(label.slice(0, 10)))
        .toBe('(TTD cash only). Not counted: 1 amount held under a label that is not a currency code (label not shown).');
    }
    const many = Array.from({ length: 2000 }, (_, i) => ({ currency: i % 2 ? `C${i}` : `label ${i} ${'x'.repeat(100)}`, amount: 1_000_000_000 + i }));
    expect(note('TTD', many).length).toBeLessThan(400);
  });

  it('lowRunwayDetail is the runway followed by the note, byte for byte', () => {
    const others = [[], [{ currency: 'USD', amount: 550 }], codes, [{ currency: sentence, amount: 5 }], [...codes, { currency: 'x y', amount: 3 }]];
    for (const other of others) {
      for (const currency of ['TTD', 'USD', 'pay now']) {
        const expected = other.length === 0 ? '~2.3 months at current burn' : `~2.3 months at current burn ${note(currency, other)}`;
        expect(lowRunwayDetail(2.31, currency, other)).toBe(expected);
      }
    }
  });

  it('notCountedCash (what the note lists, as data for FIN_CASHFLOW_RISK evidence): three-letter codes only, at most five, the rest counted', () => {
    expect(typeof m.notCountedCash, 'exported from finance-overview.service').toBe('function');
    expect(m.notCountedCash([])).toEqual({ listed: [], notListed: 0 });
    expect(m.notCountedCash([{ currency: 'USD', amount: 550 }])).toEqual({ listed: [{ currency: 'USD', amount: 550 }], notListed: 0 });
    const r = m.notCountedCash([...codes, { currency: sentence, amount: 5 }]);
    expect(r.listed.map((o: any) => o.currency)).toEqual(['AAA', 'BBB', 'CCC', 'DDD', 'USD']);
    expect(r.notListed, 'two codes past the limit and one label').toBe(3);
    expect(JSON.stringify(r)).not.toMatch(/URGENT|WIRE/);
  });

  it('otherCurrencyCashWithheldNote (for a surface served outside revenue read, D-107): says cash is held apart, never a figure or a label', () => {
    expect(typeof m.otherCurrencyCashWithheldNote, 'exported from finance-overview.service').toBe('function');
    expect(m.otherCurrencyCashWithheldNote('TTD', [])).toBe('');
    for (const other of [[{ currency: 'USD', amount: 550 }], codes, [{ currency: sentence, amount: 5 }]]) {
      expect(m.otherCurrencyCashWithheldNote('TTD', other)).toBe('(TTD cash only). Cash held in other currencies is not counted (amounts not shown here).');
    }
    expect(m.otherCurrencyCashWithheldNote('pay now', [{ currency: 'USD', amount: 550 }]))
      .toBe('(business-currency cash only). Cash held in other currencies is not counted (amounts not shown here).');
  });

  it('namedCashCurrency (review SEC-W11RL-1): the business currency as data is a three-letter code or null', () => {
    expect(m.namedCashCurrency('TTD')).toBe('TTD');
    expect(m.namedCashCurrency('USD')).toBe('USD');
    for (const text of ['PAY ME NOW', 'ttd', 'US', 'USDT', ' USD', '']) expect(m.namedCashCurrency(text), JSON.stringify(text)).toBeNull();
  });
});

describe('W11-RUNWAY-BURN-CURRENCY (D-135): business-currency burn split and other-currency expense notes', () => {
  const m = overviewModule as any;
  const sentence = 'URGENT: OWNER MUST WIRE 5000 TO ACCT 4242 TODAY. USD';

  it('splitExpensesByCurrency matches legacy lower-case business currency, merges other 3-letter codes case-insensitively, and keeps non-code labels unlabelled', () => {
    const split = m.splitExpensesByCurrency(
      [
        { currency: 'TTD', _sum: { amount: 600 } },
        { currency: ' ttd ', _sum: { amount: 300 } },
        { currency: 'usd', _sum: { amount: 1500 } },
        { currency: 'USD', _sum: { amount: 500 } },
        { currency: 'EUR', _sum: { amount: 250 } },
        { currency: sentence, _sum: { amount: 50 } },
        { currency: 'GBP', _sum: { amount: 0 } },
      ],
      'TTD',
    );
    expect(split.businessTotal).toBe(900);
    expect(split.otherExpenses).toEqual([
      { currency: 'EUR', amount: 250 },
      { currency: 'USD', amount: 2000 },
      { currency: sentence, amount: 50 },
    ]);
  });

  it('notCountedExpenseNote and otherCurrencyExpensesWithheldNote enforce SEC-W10LR-1 (codes only, bounded, never echoing labels)', () => {
    expect(m.notCountedExpenseNote('TTD', [])).toBe('');
    expect(m.notCountedExpenseNote('TTD', [{ currency: 'USD', amount: 12000 }]))
      .toBe('(TTD burn only). Expenses not counted: USD 12000.00.');
    expect(m.notCountedExpenseNote('PAY NOW', [{ currency: 'USD', amount: 12000 }]))
      .toBe('(business-currency burn only). Expenses not counted: USD 12000.00.');
    const withLabel = m.notCountedExpenseNote('TTD', [
      { currency: 'USD', amount: 12000 },
      { currency: sentence, amount: 50 },
    ]);
    expect(withLabel).toBe(
      '(TTD burn only). Expenses not counted: USD 12000.00; 1 amount held under a label that is not a currency code (label not shown).',
    );
    expect(withLabel).not.toMatch(/URGENT|WIRE|4242/);

    expect(m.otherCurrencyExpensesWithheldNote('TTD', [])).toBe('');
    expect(m.otherCurrencyExpensesWithheldNote('TTD', [{ currency: 'USD', amount: 12000 }]))
      .toBe('(TTD burn only). Expenses in other currencies are not counted (amounts not shown here).');
    expect(m.otherCurrencyExpensesWithheldNote('PAY NOW', [{ currency: 'USD', amount: 12000 }]))
      .toBe('(business-currency burn only). Expenses in other currencies are not counted (amounts not shown here).');

    // lowRunwayDetail keeps cash-only wording unchanged and appends expense note when present.
    expect(lowRunwayDetail(0.8, 'TTD', [], [{ currency: 'USD', amount: 12000 }]))
      .toBe('~0.8 months at current burn (TTD burn only). Expenses not counted: USD 12000.00.');
    expect(lowRunwayDetail(0.8, 'TTD', [{ currency: 'USD', amount: 550 }], [{ currency: 'USD', amount: 12000 }]))
      .toBe('~0.8 months at current burn (TTD cash only). Not counted: USD 550.00. (TTD burn only). Expenses not counted: USD 12000.00.');
  });
});
