import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
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
