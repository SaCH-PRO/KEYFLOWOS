import { describe, it, expect, vi } from 'vitest';
import {
  ISO_CURRENCY_CODE_RE,
  UNCODED_CURRENCY_LABEL,
  otherCurrencyCash,
  sanitizeCurrencyCode,
  sanitizeOtherCurrencyCash,
  type CashPosition,
} from './cash-position.service';
import { lowRunwayDetail, notCountedCash, notCountedCashNote } from './finance-overview.service';
import { SafeToSpendService } from './safe-to-spend.service';

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

  it('[R1-SEC-02] sanitizeCurrencyCode rejects Unicode confusables/ligatures BEFORE uppercasing and rejects non-string runtime inputs', () => {
    // Each of these expands/folds to 3 ASCII uppercase letters under JS .toUpperCase():
    // 'u\u017Fd' -> 'USD', '\uFB03' -> 'FFI', 'u\u00DF' -> 'USS', 't\u0131d' -> 'TID'.
    const confusables = ['u\u017Fd', '\uFB03', 'u\u00DF', 't\u0131d', ' u\u017Fd '];
    for (const raw of confusables) {
      expect(sanitizeCurrencyCode(raw), JSON.stringify(raw)).toBeNull();
    }
    expect(sanitizeCurrencyCode(123 as unknown as string)).toBeNull();
    expect(sanitizeCurrencyCode({} as unknown as string)).toBeNull();
    expect(sanitizeCurrencyCode(['USD'] as unknown as string)).toBeNull();

    const sanitized = sanitizeOtherCurrencyCash([
      { currency: 'u\u017Fd', amount: 10 },
      { currency: '\uFB03', amount: 20 },
      { currency: 'u\u00DF', amount: 30 },
      { currency: 't\u0131d', amount: 40 },
    ]);
    expect(sanitized).toEqual([{ currency: UNCODED_CURRENCY_LABEL, amount: 100, count: 4 }]);
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

  it('[R1-SEC-01] sanitizeOtherCurrencyCash is idempotent on zero-net UNCODED buckets, merges cleanly, and prevents arbitrary entries from spoofing count', () => {
    // Pass 1: two non-zero uncoded entries netting to 0.
    const pass1 = sanitizeOtherCurrencyCash([
      { currency: 'US Dollars', amount: 50 },
      { currency: 'Cash Box', amount: -50 },
    ]);
    expect(pass1).toEqual([{ currency: UNCODED_CURRENCY_LABEL, amount: 0, count: 2 }]);

    // Pass 2: truly idempotent even when aggregated amount is 0.
    expect(sanitizeOtherCurrencyCash(pass1)).toEqual([{ currency: UNCODED_CURRENCY_LABEL, amount: 0, count: 2 }]);

    // Merging a zero-net aggregated UNCODED bucket with another uncoded entry preserves count -> 3.
    expect(sanitizeOtherCurrencyCash([...pass1, { currency: 'TT$', amount: 12.5 }])).toEqual([
      { currency: UNCODED_CURRENCY_LABEL, amount: 12.5, count: 3 },
    ]);

    // A non-UNCODED entry carrying a bogus count cannot spoof count (counts as 1).
    expect(sanitizeOtherCurrencyCash([{ currency: 'Cash Box', amount: 25, count: 99 }])).toEqual([
      { currency: UNCODED_CURRENCY_LABEL, amount: 25, count: 1 },
    ]);

    // A zero-amount non-UNCODED entry carrying a bogus count is still omitted.
    expect(sanitizeOtherCurrencyCash([{ currency: 'Cash Box', amount: 0, count: 99 }])).toEqual([]);
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

  it('[R1-SEC-04] otherCurrencyCash excludes home currency regardless of whitespace/casing', () => {
    expect(
      otherCurrencyCash({
        currency: 'TTD',
        byCurrency: { TTD: 1000, ' ttd ': 50, USD: 20 },
      }),
    ).toEqual([{ currency: 'USD', amount: 20 }]);

    expect(
      otherCurrencyCash({
        currency: ' ttd ',
        byCurrency: { TTD: 1000, USD: 20 },
      }),
    ).toEqual([{ currency: 'USD', amount: 20 }]);

    // Free-text home currency still excludes its normalized self without dropping valid ISO codes.
    expect(
      otherCurrencyCash({
        currency: 'pay me now',
        byCurrency: { 'PAY ME NOW': 7, TTD: 100, USD: 550 },
      }),
    ).toEqual([
      { currency: 'TTD', amount: 100 },
      { currency: 'USD', amount: 550 },
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

  it('[R1-SEC-03] SafeToSpendService explanation never echoes free-text Business.currency while keeping valid 3-letter codes byte-identical', async () => {
    const makeService = (position: CashPosition) => {
      const prisma = {
        client: {
          expense: { findMany: vi.fn(async () => []) },
          cashReserveBucket: { findMany: vi.fn(async () => [{ currentAmount: 100, name: 'Rainy Day' }]) },
          payrollRun: {
            findMany: vi.fn(async () => [
              { totalGross: 200, currency: position.currency, status: 'DRAFT' },
              { totalGross: 50, currency: 'USD', status: 'APPROVED' },
            ]),
          },
          ledgerEntry: { aggregate: vi.fn(async () => ({ _sum: { debit: 0, credit: 0 } })) },
        },
      };
      const coaSeeder = { getBySystemKey: vi.fn(async () => null) };
      const cashPos = { getCashPosition: vi.fn(async () => position) };
      return new SafeToSpendService(prisma as any, coaSeeder as any, cashPos as any);
    };

    // 1. Free-text Business.currency (XSS payload + Trinidad Dollars) must NEVER appear in explanation.
    for (const freeBizCurrency of ['<SCRIPT>ALERT(1)</SCRIPT>', 'TRINIDAD DOLLARS']) {
      const svc = makeService({
        cashBalance: 1000,
        currency: freeBizCurrency,
        byCurrency: {
          [freeBizCurrency]: 1000,
          USD: 250,
          'CASH BOX': 75,
        },
        basis: 'ledger',
        accounts: [],
        unpostedOpeningBalances: [
          { financialAccountId: 'fa_home', name: 'Main Till', type: 'CASH', currency: freeBizCurrency, amount: 1000 },
          { financialAccountId: 'fa_usd', name: 'USD Bank', type: 'BANK', currency: 'USD', amount: 250 },
          { financialAccountId: 'fa_free', name: 'Legacy Box', type: 'CASH', currency: 'CASH BOX', amount: 75 },
        ],
      });

      const dto = await svc.calculate('biz_free');
      expect(dto.currency).toBe(freeBizCurrency);
      expect(dto.otherCurrencyCash).toEqual([
        { currency: 'USD', amount: 250 },
        { currency: UNCODED_CURRENCY_LABEL, amount: 75, count: 1 },
      ]);
      const prose = dto.explanation.join('\n');
      expect(prose).not.toMatch(/<script>|alert\(1\)|TRINIDAD DOLLARS|CASH BOX/i);
      expect(prose).toContain('Cash balance: 1000.00 (ledger)');
      expect(prose).toContain('  - includes Main Till opening balance not yet posted (uncoded currency): 1000.00');
      expect(prose).toContain('Cash in USD, not included (never added to business currency): USD 250.00 (ledger)');
      expect(prose).toContain('Cash in 1 uncoded currency, not included (never added to business currency): 75.00 (ledger)');
      expect(prose).toContain('Safe to spend: 200.00');
    }

    // 2. Valid 3-letter code ('TTD') keeps exact existing byte-identical explanation.
    const validSvc = makeService({
      cashBalance: 1000,
      currency: 'TTD',
      byCurrency: { TTD: 1000, USD: 250 },
      basis: 'ledger',
      accounts: [],
      unpostedOpeningBalances: [
        { financialAccountId: 'fa_home', name: 'Main Till', type: 'CASH', currency: 'TTD', amount: 1000 },
        { financialAccountId: 'fa_usd', name: 'USD Bank', type: 'BANK', currency: 'USD', amount: 250 },
      ],
    });
    const validDto = await validSvc.calculate('biz_ttd');
    expect(validDto.explanation).toEqual([
      'Cash balance: TTD 1000.00 (ledger)',
      '  - includes Main Till opening balance not yet posted: TTD 1000.00',
      'Cash in USD, not included (never added to TTD): USD 250.00 (ledger)',
      '  - includes USD Bank opening balance not yet posted: USD 250.00',
      'Tax reserved: TTD 0.00',
      'Bills due next 30 days: TTD 0.00',
      'Operating buffer: TTD 500.00',
      'Payroll reserved: TTD 200.00 (1 committed run)',
      '  - includes 1 draft run not yet approved: TTD 200.00',
      'Payroll committed in USD, not included (never added to TTD): USD 50.00 (1 run)',
      'Debt payments due: TTD 0.00 (not yet modeled)',
      'Other reserves: TTD 100.00',
      '  - Rainy Day: TTD 100.00',
      'Safe to spend: TTD 200.00',
    ]);
  });
});
