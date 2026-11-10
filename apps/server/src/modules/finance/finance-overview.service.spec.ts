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
import { LOW_RUNWAY_LISTED_CURRENCY_LIMIT, lowRunwayDetail } from './finance-overview.service';

const HEAD = '~1.5 months at current burn, from TTD cash only. Cash in other currencies, not included and not converted: ';

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

  it('SEC-W10LR-1 (D-107): the business currency is named only when it is a code', () => {
    expect(lowRunwayDetail(1.5, 'USD', [{ currency: 'TTD', amount: 40 }]))
      .toBe('~1.5 months at current burn, from USD cash only. Cash in other currencies, not included and not converted: TTD 40.00.');
    expect(lowRunwayDetail(1.5, 'PAY NOW', [{ currency: 'TTD', amount: 40 }]))
      .toBe("~1.5 months at current burn, from the business currency's cash only. Cash in other currencies, not included and not converted: TTD 40.00.");
  });
});
