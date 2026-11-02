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
