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
  type InvoiceRow = { id?: string; businessId: string; currency: string; deletedAt: Date | null; createdAt?: Date } | null;
  type PaymentRow = { currency: string; invoice: InvoiceRow } | null;
  /**
   * V1-37d review: the door also reads the invoice a COGS follows
   * (invoice.findFirst) and, for an invoice created on or after
   * D13_DOCUMENTS_FROM, whether the ledger already holds its money in the
   * currency (payment.findMany, financialTransaction.findFirst).
   */
  function harness(
    businessCurrency: string,
    payment: PaymentRow,
    opts: { invoice?: InvoiceRow; priorMoney?: boolean; invoicePayments?: string[] } = {},
  ) {
    const created: any[] = [];
    const tx = {
      financialTransaction: {
        findUnique: vi.fn(async () => null),
        findFirst: vi.fn(async (_args: any) => (opts.priorMoney ? { id: 'txn_prior' } : null)),
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
      payment: {
        findFirst: vi.fn(async (_args: any) => payment),
        findMany: vi.fn(async (_args: any) => (opts.invoicePayments ?? []).map((id) => ({ id }))),
      },
      invoice: { findFirst: vi.fn(async (_args: any) => opts.invoice ?? null) },
    };
    const prisma = { client: { $transaction: async (cb: any) => cb(tx) } } as any;
    return { svc: new door.PostingService(prisma), created, tx };
  }
  /** An invoice written before D-13 held new documents (a legacy row). */
  const LEGACY_CREATED = new Date('2026-06-01T00:00:00Z');
  const legacyPayment = (over: Partial<NonNullable<PaymentRow>> = {}): PaymentRow => ({
    currency: 'JMD',
    invoice: { id: 'inv_jmd', businessId: 'biz_ttd', currency: 'JMD', deletedAt: null, createdAt: LEGACY_CREATED },
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
      legacyPayment({ invoice: { id: 'inv_jmd', businessId: 'biz_ttd', currency: 'TTD', deletedAt: null, createdAt: LEGACY_CREATED } }),
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
      legacyPayment({ invoice: { id: 'inv_jmd', businessId: 'biz_other', currency: 'JMD', deletedAt: null, createdAt: LEGACY_CREATED } }),
      legacyPayment({ invoice: { id: 'inv_jmd', businessId: 'biz_ttd', currency: 'JMD', deletedAt: new Date('2026-09-01'), createdAt: LEGACY_CREATED } }),
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

/**
 * V1-37d review (ST-V37D-1 / CR-V37D-1, ST-V37D-3). The exception is bound to a
 * legacy document: an invoice created before D13_DOCUMENTS_FROM, or one whose
 * money the ledger already holds in that currency (its receivable, a payment's
 * posting). A new invoice in an unsupported currency (the storefront checkout,
 * quote conversion and the other writers that do not check yet) gets the D-13
 * refusal for its money, as V1-37 gave it. The COGS a legacy invoice posts when
 * it becomes PAID (Invoice-sourced, kind 'cogs') follows it like its payments.
 */
describe('V1-37d review: only money that follows a legacy invoice keeps its currency (hermetic)', () => {
  /** Written before D-13 held new documents, and after (LR-03 pins both against D13_DOCUMENTS_FROM). */
  const LEGACY_CREATED = new Date('2026-06-01T00:00:00Z');
  const NEW_CREATED = new Date('2026-11-03T00:00:00Z');
  const cutoff = (): Date => (door as any).D13_DOCUMENTS_FROM;
  function harness(
    payment: { currency: string; invoice: any } | null,
    opts: { invoice?: any; priorMoney?: boolean; invoicePayments?: string[] } = {},
  ) {
    const created: any[] = [];
    const tx = {
      financialTransaction: {
        findUnique: vi.fn(async () => null),
        findFirst: vi.fn(async (_args: any) => (opts.priorMoney ? { id: 'txn_prior' } : null)),
        create: vi.fn(async (args: any) => {
          created.push(args.data);
          return { id: `txn_${created.length}` };
        }),
      },
      chartOfAccount: {
        findMany: vi.fn(async (args: any) =>
          (args.where.id.in as string[]).map((id) => ({ id, businessId: 'biz_ttd', business: { currency: 'TTD' } })),
        ),
      },
      contact: { findUnique: vi.fn(async () => ({ businessId: 'biz_ttd' })) },
      payment: {
        findFirst: vi.fn(async (_args: any) => payment),
        findMany: vi.fn(async (_args: any) => (opts.invoicePayments ?? []).map((id) => ({ id }))),
      },
      invoice: { findFirst: vi.fn(async (_args: any) => opts.invoice ?? null) },
    };
    const prisma = { client: { $transaction: async (cb: any) => cb(tx) } } as any;
    return { svc: new door.PostingService(prisma), created, tx };
  }
  const invoiceRow = (currency: string, createdAt: Date, over: Record<string, unknown> = {}) => ({
    id: 'inv_x', businessId: 'biz_ttd', currency, deletedAt: null, createdAt, ...over,
  });
  const paymentPosting = (currency: string, over: Partial<door.PostingInput> = {}): door.PostingInput => ({
    businessId: 'biz_ttd',
    type: 'INCOME',
    date: new Date('2026-11-03'),
    amount: 50,
    currency,
    sourceType: 'Payment',
    sourceId: 'pay_x',
    kind: 'payment_recorded',
    entries: [
      { accountId: 'acc_cash', debit: 50 },
      { accountId: 'acc_revenue', credit: 50 },
    ],
    ...over,
  });
  const cogsPosting = (currency: string, over: Partial<door.PostingInput> = {}): door.PostingInput => ({
    businessId: 'biz_ttd',
    type: 'EXPENSE',
    date: new Date('2026-11-03'),
    amount: 5,
    currency,
    sourceType: 'Invoice',
    sourceId: 'inv_x',
    kind: 'cogs',
    entries: [
      { accountId: 'acc_cogs', debit: 5 },
      { accountId: 'acc_inventory', credit: 5 },
    ],
    ...over,
  });

  it('LR-01 RED-BEFORE (ST-V37D-1 / CR-V37D-1): money on a NEW invoice in an unsupported currency (storefront checkout) is refused (400), nothing written', async () => {
    for (const currency of ['JMD', 'EUR', 'ZZZ']) {
      const h = harness({ currency, invoice: invoiceRow(currency, NEW_CREATED) }, { invoicePayments: ['pay_x'] });
      await expect(h.svc.post(paymentPosting(currency))).rejects.toThrow(new RegExp(`Unsupported posting currency ${currency}`));
      expect(h.tx.financialTransaction.create).not.toHaveBeenCalled();
      // The ledger was asked, scoped to the business, the invoice, its payments and the currency.
      expect(h.tx.payment.findMany.mock.calls[0][0].where).toEqual({ invoiceId: 'inv_x', businessId: 'biz_ttd' });
      expect(h.tx.financialTransaction.findFirst.mock.calls[0][0].where).toEqual({
        businessId: 'biz_ttd',
        currency: { equals: currency, mode: 'insensitive' },
        OR: [
          { sourceType: 'Invoice', sourceId: 'inv_x' },
          { sourceType: 'Payment', sourceId: { in: ['pay_x'] } },
        ],
      });
    }
  });

  it('LR-02: an invoice created on or after D13_DOCUMENTS_FROM is legacy only when the ledger already holds its money in that currency (its receivable, a payment)', async () => {
    const held = harness({ currency: 'JMD', invoice: invoiceRow('JMD', NEW_CREATED) }, { priorMoney: true });
    await held.svc.post(paymentPosting('JMD'));
    expect(held.created[0].currency).toBe('JMD');
    expect(held.created[0].entries.create.map((e: any) => e.currency)).toEqual(['JMD', 'JMD']);
    // No payment of it yet: only its own postings are asked about.
    expect(held.tx.financialTransaction.findFirst.mock.calls[0][0].where.OR).toEqual([{ sourceType: 'Invoice', sourceId: 'inv_x' }]);
  });

  it('LR-03: the cutoff is exclusive: one millisecond before D13_DOCUMENTS_FROM is legacy without reading the ledger; at it, the ledger decides', async () => {
    expect(cutoff()).toBeInstanceOf(Date);
    expect(LEGACY_CREATED.getTime()).toBeLessThan(cutoff().getTime());
    expect(NEW_CREATED.getTime()).toBeGreaterThanOrEqual(cutoff().getTime());
    const before = harness({ currency: 'JMD', invoice: invoiceRow('JMD', new Date(cutoff().getTime() - 1)) });
    await before.svc.post(paymentPosting('JMD'));
    expect(before.created[0].currency).toBe('JMD');
    expect(before.tx.financialTransaction.findFirst).not.toHaveBeenCalled();

    const at = harness({ currency: 'JMD', invoice: invoiceRow('JMD', new Date(cutoff().getTime())) });
    await expect(at.svc.post(paymentPosting('JMD'))).rejects.toBeInstanceOf(BadRequestException);
    expect(at.tx.financialTransaction.findFirst).toHaveBeenCalledTimes(1);
    expect(at.tx.financialTransaction.create).not.toHaveBeenCalled();
  });

  it('LR-04 RED-BEFORE (ST-V37D-3): the COGS of a legacy invoice (Invoice, kind cogs) posts in its currency, read from the posting business', async () => {
    const legacy = harness(null, { invoice: invoiceRow('JMD', LEGACY_CREATED) });
    await legacy.svc.post(cogsPosting('JMD'));
    expect(legacy.created[0].currency).toBe('JMD');
    expect(legacy.created[0].entries.create.map((e: any) => e.currency)).toEqual(['JMD', 'JMD']);
    expect(legacy.tx.invoice.findFirst.mock.calls[0][0].where).toEqual({ id: 'inv_x', businessId: 'biz_ttd' });
    expect(legacy.tx.payment.findFirst).not.toHaveBeenCalled();

    // A newer invoice whose payment already posted in JMD (the PAID transaction's own payment posting).
    const paid = harness(null, { invoice: invoiceRow('JMD', NEW_CREATED), priorMoney: true, invoicePayments: ['pay_x'] });
    await paid.svc.post(cogsPosting('JMD'));
    expect(paid.created[0].currency).toBe('JMD');
  });

  it('LR-05: a COGS is refused (400, nothing written) for a new invoice without money in the currency, another currency, another business, a deleted or missing invoice', async () => {
    for (const opts of [
      { invoice: invoiceRow('JMD', NEW_CREATED) },
      { invoice: invoiceRow('TTD', LEGACY_CREATED) },
      { invoice: invoiceRow('JMD', LEGACY_CREATED, { businessId: 'biz_other' }) },
      { invoice: invoiceRow('JMD', LEGACY_CREATED, { deletedAt: new Date('2026-09-01') }) },
      { invoice: null },
    ]) {
      const h = harness(null, opts);
      await expect(h.svc.post(cogsPosting('JMD')), JSON.stringify(opts)).rejects.toThrow(/JMD/);
      expect(h.tx.financialTransaction.create).not.toHaveBeenCalled();
    }
  });

  it('LR-06: any other invoice-sourced posting of a legacy invoice (its receivable when a draft is issued, an adjustment) keeps the D-13 refusal and never reads the invoice', async () => {
    for (const kind of ['invoice_finalized', 'v37d-probe', null]) {
      const h = harness(null, { invoice: invoiceRow('JMD', LEGACY_CREATED), priorMoney: true });
      await expect(h.svc.post(cogsPosting('JMD', { kind }))).rejects.toBeInstanceOf(BadRequestException);
      expect(h.tx.financialTransaction.create).not.toHaveBeenCalled();
      expect(h.tx.invoice.findFirst).not.toHaveBeenCalled();
    }
  });
});
