import { describe, it, expect } from 'vitest';
import {
  ISO_CURRENCY_CODE_RE,
  UNCODED_CURRENCY_LABEL,
  otherCurrencyCash,
  sanitizeCurrencyCode,
  sanitizeOtherCurrencyCash,
} from './cash-position.service';
import { lowRunwayDetail, notCountedCash, notCountedCashNote } from './finance-overview.service';

describe('FU-CASH-LABEL-SANITISER (D-135): shared code-only currency label sanitiser', () => {
  it('sanitizeCurrencyCode accepts strictly 3-letter ASCII alphabetic codes after trim+uppercase and rejects everything else', () => {
    expect(sanitizeCurrencyCode('USD')).toBe('USD');
    expect(sanitizeCurrencyCode(' usd ')).toBe('USD');
    expect(sanitizeCurrencyCode('eur')).toBe('EUR');
    expect(sanitizeCurrencyCode('\tGbp\n')).toBe('GBP');

    const invalid = [
      '',
      '   ',
      null,
      undefined,
      'US',
      'USDT',
      'TT$',
      'US$',
      '123',
      'U5D',
      'U$D',
      'ÜSD',
      'ÉUR',
      '£££',
      'Trinidad Dollars',
      'US Dollars',
      'Cash Box',
      '<script>alert(1)</script>',
      UNCODED_CURRENCY_LABEL,
    ];
    for (const raw of invalid) {
      expect(sanitizeCurrencyCode(raw), JSON.stringify(raw)).toBeNull();
    }
    expect(ISO_CURRENCY_CODE_RE.test(UNCODED_CURRENCY_LABEL)).toBe(false);
  });

  it('sanitizeOtherCurrencyCash preserves valid 3-letter codes sorted, merges case variants cent-safely, and aggregates non-code entries into one UNCODED bucket', () => {
    const out = sanitizeOtherCurrencyCash([
      { currency: 'usd', amount: 100.1 },
      { currency: ' USD ', amount: 200.2 },
      { currency: 'EUR', amount: 50 },
      { currency: 'US Dollars', amount: 10.1 },
      { currency: '<script>alert(1)</script>', amount: 20.2 },
      { currency: 'TT$', amount: 30.3 },
      { currency: 'GBP', amount: 0 },
      { currency: 'Cash Box', amount: 0 },
    ]);

    expect(out).toEqual([
      { currency: 'EUR', amount: 50 },
      { currency: 'USD', amount: 300.3 },
      { currency: UNCODED_CURRENCY_LABEL, amount: 60.6, count: 3 },
    ]);
    expect(out.filter((e) => e.currency !== UNCODED_CURRENCY_LABEL).every((e) => !('count' in e))).toBe(true);
    expect(JSON.stringify(out)).not.toMatch(/US Dollars|<script>|TT\$|Cash Box/i);
  });

  it('sanitizeOtherCurrencyCash is idempotent and preserves count on already-aggregated UNCODED buckets', () => {
    const first = sanitizeOtherCurrencyCash([
      { currency: 'USD', amount: 500 },
      { currency: 'Trinidad Dollars', amount: 40 },
      { currency: 'US$', amount: 60 },
    ]);
    expect(first).toEqual([
      { currency: 'USD', amount: 500 },
      { currency: UNCODED_CURRENCY_LABEL, amount: 100, count: 2 },
    ]);
    expect(sanitizeOtherCurrencyCash(first)).toEqual(first);
  });

  it('sanitizeOtherCurrencyCash preserves negative balances and omits coded buckets that net to zero', () => {
    const out = sanitizeOtherCurrencyCash([
      { currency: 'USD', amount: 50 },
      { currency: 'usd', amount: -50 },
      { currency: 'EUR', amount: -12.5 },
      { currency: 'Non-ASCII ÜSD', amount: -7.25 },
      { currency: '123', amount: 2.25 },
    ]);
    expect(out).toEqual([
      { currency: 'EUR', amount: -12.5 },
      { currency: UNCODED_CURRENCY_LABEL, amount: -5, count: 2 },
    ]);
  });

  it('otherCurrencyCash excludes business currency, keeps valid codes, and feeds exact uncoded count into notCountedCash and runway prose', () => {
    const sanitized = otherCurrencyCash({
      currency: 'TTD',
      byCurrency: {
        TTD: 1000,
        USD: 550,
        EUR: 120.5,
        'US DOLLARS': 125.1,
        '<SCRIPT>ALERT(1)</SCRIPT>': 74.9,
      },
    });

    expect(sanitized).toEqual([
      { currency: 'EUR', amount: 120.5 },
      { currency: 'USD', amount: 550 },
      { currency: UNCODED_CURRENCY_LABEL, amount: 200, count: 2 },
    ]);

    expect(notCountedCash(sanitized)).toEqual({
      listed: [
        { currency: 'EUR', amount: 120.5 },
        { currency: 'USD', amount: 550 },
      ],
      notListed: 2,
    });

    expect(notCountedCashNote('TTD', sanitized)).toBe(
      '(TTD cash only). Not counted: EUR 120.50, USD 550.00; 2 amounts held under labels that are not currency codes (labels not shown).',
    );

    expect(lowRunwayDetail(1.2, 'TTD', sanitized)).toBe(
      '~1.2 months at current burn (TTD cash only). Not counted: EUR 120.50, USD 550.00; 2 amounts held under labels that are not currency codes (labels not shown).',
    );
  });
});
