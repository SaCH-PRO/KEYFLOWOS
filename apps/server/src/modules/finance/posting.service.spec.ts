import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as door from './posting.service';
import { buildExternalRef, sumEntries, validatePosting } from './posting.service';

const baseInput = {
  businessId: 'biz_1',
  type: 'INCOME' as const,
  date: new Date('2026-01-01'),
  amount: 100,
};

describe('buildExternalRef', () => {
  it('returns null without sourceType+sourceId', () => {
    expect(buildExternalRef(null, null)).toBeNull();
    expect(buildExternalRef('Invoice', null)).toBeNull();
    expect(buildExternalRef(null, 'inv_1')).toBeNull();
  });

  it('uses default kind when not provided', () => {
    expect(buildExternalRef('Invoice', 'inv_1')).toBe('Invoice:inv_1:default');
  });

  it('honours an explicit kind', () => {
    expect(buildExternalRef('Payment', 'pay_1', 'received')).toBe('Payment:pay_1:received');
  });
});

describe('sumEntries', () => {
  it('sums Decimals correctly across mixed input types', () => {
    const { debit, credit } = sumEntries([
      { accountId: 'a', debit: 100 },
      { accountId: 'b', credit: '60' },
      { accountId: 'c', credit: new Prisma.Decimal('40.0') },
    ]);
    expect(debit.toString()).toBe('100');
    expect(credit.toString()).toBe('100');
  });
});

describe('validatePosting', () => {
  it('accepts a balanced 2-line entry', () => {
    expect(() =>
      validatePosting({
        ...baseInput,
        entries: [
          { accountId: 'cash', debit: 100 },
          { accountId: 'revenue', credit: 100 },
        ],
      }),
    ).not.toThrow();
  });

  it('rejects fewer than 2 entries', () => {
    expect(() =>
      validatePosting({
        ...baseInput,
        entries: [{ accountId: 'cash', debit: 100 }],
      }),
    ).toThrow(/at least 2/);
  });

  it('rejects unbalanced entries', () => {
    expect(() =>
      validatePosting({
        ...baseInput,
        entries: [
          { accountId: 'cash', debit: 100 },
          { accountId: 'revenue', credit: 99 },
        ],
      }),
    ).toThrow(/Unbalanced/);
  });

  it('rejects an entry with both debit and credit', () => {
    expect(() =>
      validatePosting({
        ...baseInput,
        entries: [
          { accountId: 'cash', debit: 100, credit: 100 },
          { accountId: 'revenue', credit: 100 },
        ],
      }),
    ).toThrow(/cannot have both/);
  });

  it('rejects an entry with neither debit nor credit', () => {
    expect(() =>
      validatePosting({
        ...baseInput,
        entries: [
          { accountId: 'cash' },
          { accountId: 'revenue', credit: 0 },
        ],
      }),
    ).toThrow(/non-zero/);
  });

  it('rejects negative debit/credit', () => {
    expect(() =>
      validatePosting({
        ...baseInput,
        entries: [
          { accountId: 'cash', debit: -100 },
          { accountId: 'revenue', credit: 100 },
        ],
      }),
    ).toThrow(/non-negative/);
  });

  it('rejects entries missing accountId', () => {
    expect(() =>
      validatePosting({
        ...baseInput,
        entries: [
          { accountId: '', debit: 100 },
          { accountId: 'revenue', credit: 100 },
        ],
      }),
    ).toThrow(/accountId is required/);
  });

  it('rejects calls without businessId', () => {
    expect(() =>
      validatePosting({
        ...baseInput,
        businessId: '',
        entries: [
          { accountId: 'cash', debit: 100 },
          { accountId: 'revenue', credit: 100 },
        ],
      }),
    ).toThrow(/businessId/);
  });

  it('accepts multi-leg balanced postings (e.g. payment with processor fee)', () => {
    expect(() =>
      validatePosting({
        ...baseInput,
        amount: 100,
        entries: [
          { accountId: 'bank', debit: 97 },
          { accountId: 'fee_expense', debit: 3 },
          { accountId: 'ar', credit: 100 },
        ],
      }),
    ).not.toThrow();
  });

  it('tolerates sub-cent rounding within 0.0001', () => {
    expect(() =>
      validatePosting({
        ...baseInput,
        entries: [
          { accountId: 'a', debit: '100.00005' },
          { accountId: 'b', credit: '100.00000' },
        ],
      }),
    ).not.toThrow();
  });
});

/**
 * V1-37-DM-CURRENCY (CF-38; owner ruling D-13: one currency per business,
 * defaulting to the business currency; TTD and USD supported).
 *
 * The posting door's currency policy:
 *   - a posting that names no currency is in the business currency (it was
 *     the literal 'TTD', so a USD business's manual journal, recurring journal
 *     and tax payment landed in TTD);
 *   - a currency is an ISO code, compared and stored upper-case;
 *   - the business currency is always postable;
 *   - another currency (a mismatch) is accepted only when D-13 allows it: a
 *     supported currency (TTD, USD) carried by a source document (sourceType
 *     and sourceId), whose explicit currency wins (a TTD business's USD
 *     invoice; pinned by V1-15 TB-01). A sourceless mismatch (a manual or KEY
 *     journal in a currency the business does not keep) and any unsupported
 *     currency are refused with 400 before anything is written.
 *
 * `door.*` is read through the namespace so this file still loads when the
 * policy does not exist (the tests-first run): those cases fail, the rest run.
 */
describe('V1-37 posting currency policy (D-13)', () => {
  const resolve = (input: { currency?: string | null; sourceType?: string | null; sourceId?: string | null }, business: string) =>
    (door as any).resolvePostingCurrency(input, business);

  it('PC-01: the supported currencies are TTD and USD (D-13)', () => {
    expect((door as any).D13_CURRENCIES).toEqual(['TTD', 'USD']);
  });

  it('PC-02: no currency -> the business currency, never the literal TTD', () => {
    expect(resolve({}, 'USD')).toBe('USD');
    expect(resolve({ currency: null }, 'USD')).toBe('USD');
    expect(resolve({ currency: '' }, 'USD')).toBe('USD');
    expect(resolve({}, 'TTD')).toBe('TTD');
  });

  it('PC-03: the business currency is postable, compared and returned upper-case', () => {
    expect(resolve({ currency: 'USD' }, 'USD')).toBe('USD');
    expect(resolve({ currency: 'usd' }, 'USD')).toBe('USD');
    expect(resolve({ currency: ' ttd ' }, 'ttd')).toBe('TTD');
    // A business whose own currency predates D-13 keeps posting in it.
    expect(resolve({ currency: 'JPY' }, 'JPY')).toBe('JPY');
    expect(resolve({}, 'JPY')).toBe('JPY');
  });

  it('PC-04: a sourceless posting in another currency is refused (400)', () => {
    expect(() => resolve({ currency: 'TTD' }, 'USD')).toThrow(BadRequestException);
    expect(() => resolve({ currency: 'TTD', sourceType: 'Invoice' }, 'USD')).toThrow(/currency/i);
    expect(() => resolve({ currency: 'USD', sourceId: 'inv_1' }, 'TTD')).toThrow(/currency/i);
  });

  it('PC-05: a document-sourced posting in another SUPPORTED currency is accepted (the document currency wins)', () => {
    expect(resolve({ currency: 'USD', sourceType: 'Invoice', sourceId: 'inv_1' }, 'TTD')).toBe('USD');
    expect(resolve({ currency: 'ttd', sourceType: 'Payment', sourceId: 'pay_1' }, 'USD')).toBe('TTD');
  });

  it('PC-06: an unsupported currency is refused even with a source document (400)', () => {
    expect(() => resolve({ currency: 'EUR', sourceType: 'Invoice', sourceId: 'inv_1' }, 'TTD')).toThrow(BadRequestException);
    expect(() => resolve({ currency: 'EUR', sourceType: 'Invoice', sourceId: 'inv_1' }, 'USD')).toThrow(/EUR/);
    expect(() => resolve({ currency: 'US', sourceType: 'Invoice', sourceId: 'inv_1' }, 'USD')).toThrow(BadRequestException);
  });
});

/**
 * PostingService.post() with a hermetic transaction stub: what the door writes
 * for a USD business. The chart rows carry their business's currency (the door
 * reads it with the ownership check, one query).
 */
describe('V1-37 PostingService.post() currency at the door (hermetic)', () => {
  function harness(businessCurrency: string) {
    const created: any[] = [];
    const tx = {
      financialTransaction: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async (args: any) => {
          created.push(args.data);
          return { id: `txn_${created.length}` };
        }),
      },
      chartOfAccount: {
        findMany: vi.fn(async (args: any) =>
          (args.where.id.in as string[]).map((id) => ({ id, businessId: 'biz_usd', business: { currency: businessCurrency } })),
        ),
      },
      contact: { findUnique: vi.fn(async () => ({ businessId: 'biz_usd' })) },
      business: { findUnique: vi.fn(async () => ({ currency: businessCurrency })) },
    };
    const prisma = { client: { $transaction: async (cb: any) => cb(tx) } } as any;
    return { svc: new door.PostingService(prisma), created, tx };
  }
  const input = (over: Partial<door.PostingInput> = {}): door.PostingInput => ({
    businessId: 'biz_usd',
    type: 'ADJUSTMENT',
    date: new Date('2026-10-01'),
    amount: 25,
    entries: [
      { accountId: 'acc_cash', debit: 25 },
      { accountId: 'acc_equity', credit: 25 },
    ],
    ...over,
  });

  it('PD-01 RED-BEFORE: a USD business posting with no currency is written in USD (transaction and every entry)', async () => {
    const h = harness('USD');
    await h.svc.post(input());
    expect(h.created).toHaveLength(1);
    expect(h.created[0].currency).toBe('USD');
    expect(h.created[0].entries.create.map((e: any) => e.currency)).toEqual(['USD', 'USD']);
  });

  it('PD-02 RED-BEFORE: a sourceless TTD posting on a USD business is refused with 400 and nothing is written', async () => {
    const h = harness('USD');
    await expect(h.svc.post(input({ currency: 'TTD' }))).rejects.toBeInstanceOf(BadRequestException);
    expect(h.tx.financialTransaction.create).not.toHaveBeenCalled();
  });

  it('PD-03 RED-BEFORE: an unsupported currency (EUR) is refused even when document-sourced; nothing is written', async () => {
    const h = harness('USD');
    await expect(
      h.svc.post(input({ currency: 'EUR', sourceType: 'Invoice', sourceId: 'inv_eur', kind: 'invoice_finalized' })),
    ).rejects.toThrow(/EUR/);
    expect(h.tx.financialTransaction.create).not.toHaveBeenCalled();
  });

  it('PD-04 control (V1-15 TB-01): a TTD invoice posting on a USD business (document-sourced) is accepted in TTD', async () => {
    const h = harness('USD');
    const res = await h.svc.post(input({ currency: 'TTD', sourceType: 'Invoice', sourceId: 'inv_ttd', kind: 'invoice_finalized' }));
    expect(res.alreadyPosted).toBe(false);
    expect(h.created[0].currency).toBe('TTD');
    expect(h.created[0].entries.create.map((e: any) => e.currency)).toEqual(['TTD', 'TTD']);
  });

  it('PD-05: a lower-case currency is stored upper-case', async () => {
    const h = harness('USD');
    await h.svc.post(input({ currency: 'usd', sourceType: 'Payment', sourceId: 'pay_1', kind: 'payment_recorded' }));
    expect(h.created[0].currency).toBe('USD');
    expect(h.created[0].entries.create.map((e: any) => e.currency)).toEqual(['USD', 'USD']);
  });
});

/**
 * V1-37d-LEGACY-CURRENCY-PAYMENTS (verify-money VR-04, a V1-37 regression; D-13).
 *
 * V1-37 refused every posting in a currency outside D-13 (TTD, USD) that is
 * not the business currency, so money against an invoice stored BEFORE D-13 in
 * another currency (a TTD business's JMD invoice) could no longer be recorded:
 * the payment answered 400 and nothing was written. The base recorded and
 * posted it in the invoice's currency.
 *
 * Contract pinned here:
 *   - money that follows a stored document posts in that document's own
 *     currency: a posting sourced by a Payment (its recording, a partial
 *     refund) is accepted in the currency its invoice is stored in, read by
 *     the door from the payment row of the posting business (never a caller's
 *     word), when the payment and the invoice agree on it (a void and a full
 *     refund are reversals, which copy the original's currency);
 *   - everything else keeps the D-13 refusal: a sourceless posting, one sourced
 *     by any other document (an expense, an invoice's own receivable), a payment
 *     of another business or whose invoice is in another currency;
 *   - a posting in the business currency or a D-13 currency never reads the
 *     payment (the hot path is unchanged).
 */
describe('V1-37d money that follows a stored legacy-currency document (resolvePostingCurrency)', () => {
  const resolve = (
    input: { currency?: string | null; sourceType?: string | null; sourceId?: string | null },
    business: string,
    followed?: string | null,
  ) => (door as any).resolvePostingCurrency(input, business, followed);

  it('LP-01 RED-BEFORE: a payment-sourced posting in the currency of the document it follows (JMD) is accepted, upper-case', () => {
    expect(resolve({ currency: 'JMD', sourceType: 'Payment', sourceId: 'pay_1' }, 'TTD', 'JMD')).toBe('JMD');
    expect(resolve({ currency: 'jmd', sourceType: 'Payment', sourceId: 'pay_1' }, 'TTD', ' jmd ')).toBe('JMD');
  });

  it('LP-02: the followed document must be in the requested currency; otherwise the D-13 refusal stands (400)', () => {
    expect(() => resolve({ currency: 'JMD', sourceType: 'Payment', sourceId: 'pay_1' }, 'TTD', 'TTD')).toThrow(BadRequestException);
    expect(() => resolve({ currency: 'JMD', sourceType: 'Payment', sourceId: 'pay_1' }, 'TTD', null)).toThrow(/JMD/);
    expect(() => resolve({ currency: 'JMD', sourceType: 'Payment', sourceId: 'pay_1' }, 'TTD', '')).toThrow(/JMD/);
    expect(() => resolve({ currency: 'JMD', sourceType: 'Payment', sourceId: 'pay_1' }, 'TTD')).toThrow(/JMD/);
  });

  it('LP-03: a free-standing posting is held to D-13 even when a followed currency is passed', () => {
    expect(() => resolve({ currency: 'JMD' }, 'TTD', 'JMD')).toThrow(BadRequestException);
    expect(() => resolve({ currency: 'JMD', sourceType: 'Payment' }, 'TTD', 'JMD')).toThrow(BadRequestException);
  });

  it('LP-04 control: the business currency and the D-13 rules are unchanged by a followed currency', () => {
    expect(resolve({}, 'TTD', 'JMD')).toBe('TTD');
    expect(resolve({ currency: 'USD', sourceType: 'Payment', sourceId: 'pay_1' }, 'TTD', 'JMD')).toBe('USD');
    expect(() => resolve({ currency: 'EUR', sourceType: 'Expense', sourceId: 'exp_1' }, 'TTD', null)).toThrow(/EUR/);
  });
});

describe('V1-37d PostingService.post(): a payment posts in its stored invoice currency (hermetic)', () => {
  type PaymentRow = { currency: string; invoice: { businessId: string; currency: string; deletedAt: Date | null } | null } | null;
  function harness(businessCurrency: string, payment: PaymentRow) {
    const created: any[] = [];
    const tx = {
      financialTransaction: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async (args: any) => {
          created.push(args.data);
          return { id: `txn_${created.length}` };
        }),
      },
      chartOfAccount: {
        findMany: vi.fn(async (args: any) =>
          (args.where.id.in as string[]).map((id) => ({ id, businessId: 'biz_ttd', business: { currency: businessCurrency } })),
        ),
      },
      contact: { findUnique: vi.fn(async () => ({ businessId: 'biz_ttd' })) },
      payment: { findFirst: vi.fn(async (_args: any) => payment) },
    };
    const prisma = { client: { $transaction: async (cb: any) => cb(tx) } } as any;
    return { svc: new door.PostingService(prisma), created, tx };
  }
  const legacyPayment = (over: Partial<NonNullable<PaymentRow>> = {}): PaymentRow => ({
    currency: 'JMD',
    invoice: { businessId: 'biz_ttd', currency: 'JMD', deletedAt: null },
    ...over,
  });
  const input = (over: Partial<door.PostingInput> = {}): door.PostingInput => ({
    businessId: 'biz_ttd',
    type: 'INCOME',
    date: new Date('2026-10-01'),
    amount: 50,
    currency: 'JMD',
    sourceType: 'Payment',
    sourceId: 'pay_jmd',
    kind: 'payment_recorded',
    entries: [
      { accountId: 'acc_cash', debit: 50 },
      { accountId: 'acc_ar', credit: 50 },
    ],
    ...over,
  });

  it('LD-01 RED-BEFORE (VR-04): a JMD payment on a stored JMD invoice of a TTD business is written in JMD (transaction and every entry), read from the payment of the posting business', async () => {
    const h = harness('TTD', legacyPayment());
    const res = await h.svc.post(input());
    expect(res.alreadyPosted).toBe(false);
    expect(h.created).toHaveLength(1);
    expect(h.created[0].currency).toBe('JMD');
    expect(h.created[0].entries.create.map((e: any) => e.currency)).toEqual(['JMD', 'JMD']);
    expect(h.tx.payment.findFirst).toHaveBeenCalledTimes(1);
    expect(h.tx.payment.findFirst.mock.calls[0][0].where).toEqual({ id: 'pay_jmd', businessId: 'biz_ttd' });
  });

  it('LD-02 RED-BEFORE: a partial refund of that payment (Payment-sourced REFUND) is written in JMD', async () => {
    const h = harness('TTD', legacyPayment());
    await h.svc.post(input({
      type: 'REFUND',
      kind: 'payment_refunded:1',
      amount: 20,
      entries: [
        { accountId: 'acc_ar', debit: 20 },
        { accountId: 'acc_cash', credit: 20 },
      ],
    }));
    expect(h.created[0].currency).toBe('JMD');
    expect(h.created[0].entries.create.map((e: any) => e.currency)).toEqual(['JMD', 'JMD']);
  });

  it('LD-03: a payment whose invoice is stored in another currency, or that disagrees with its invoice, is refused (400), nothing written', async () => {
    for (const row of [
      legacyPayment({ invoice: { businessId: 'biz_ttd', currency: 'TTD', deletedAt: null } }),
      legacyPayment({ currency: 'TTD' }),
    ]) {
      const h = harness('TTD', row);
      await expect(h.svc.post(input())).rejects.toBeInstanceOf(BadRequestException);
      expect(h.tx.financialTransaction.create).not.toHaveBeenCalled();
    }
  });

  it('LD-04: a payment the posting business does not hold (unknown, another tenant, a deleted invoice) is refused (400), nothing written', async () => {
    for (const row of [
      null,
      legacyPayment({ invoice: null }),
      legacyPayment({ invoice: { businessId: 'biz_other', currency: 'JMD', deletedAt: null } }),
      legacyPayment({ invoice: { businessId: 'biz_ttd', currency: 'JMD', deletedAt: new Date('2026-09-01') } }),
    ]) {
      const h = harness('TTD', row);
      await expect(h.svc.post(input())).rejects.toThrow(/JMD/);
      expect(h.tx.financialTransaction.create).not.toHaveBeenCalled();
    }
  });

  it('LD-05: postings not sourced by a payment keep the D-13 refusal and never read a payment (sourceless, expense, the invoice receivable, a fixture document)', async () => {
    for (const over of [
      { sourceType: null, sourceId: null, kind: null },
      { sourceType: 'Expense', sourceId: 'exp_jmd', kind: 'paid' },
      { sourceType: 'Invoice', sourceId: 'inv_jmd', kind: 'invoice_finalized' },
      { sourceType: 'V37dFixture', sourceId: 'doc_jmd', kind: 'adj' },
    ]) {
      const h = harness('TTD', legacyPayment());
      await expect(h.svc.post(input(over))).rejects.toBeInstanceOf(BadRequestException);
      expect(h.tx.financialTransaction.create).not.toHaveBeenCalled();
      expect(h.tx.payment.findFirst).not.toHaveBeenCalled();
    }
  });

  it('LD-06 control: a payment in the business currency or a D-13 currency is posted without reading the payment row', async () => {
    for (const currency of ['TTD', 'usd', undefined]) {
      const h = harness('TTD', legacyPayment());
      await h.svc.post(input({ currency }));
      expect(h.created[0].currency).toBe(currency ? currency.toUpperCase() : 'TTD');
      expect(h.tx.payment.findFirst).not.toHaveBeenCalled();
    }
  });
});
