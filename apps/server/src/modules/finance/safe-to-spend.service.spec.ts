import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { SafeToSpendService } from './safe-to-spend.service';

describe('SafeToSpendService', () => {
  function makeStubs(opts?: {
    cashBalance?: number;
    accounts?: Array<{
      id?: string;
      chartOfAccountId?: string | null;
      openingBalance?: number;
      currentBalance?: number;
      currency?: string;
    }>;
    cashLedgerEntries?: Array<{
      accountId: string;
      debit?: number;
      credit?: number;
      currency?: string;
      transaction?: { type: string };
    }>;
    taxCredit?: number;
    taxDebit?: number;
    bills?: Array<number | { amount: number; currency?: string }>;
    reserves?: Array<{ name: string; currentAmount: number; currency?: string }>;
    payrollRuns?: Array<{ totalGross: number; status: string; currency?: string }>;
    exchangeRates?: Array<{ fromCurrency: string; toCurrency: string; rate: number }>;
  }) {
    const prisma = {
      client: {
        business: {
          findUnique: vi.fn(async () => ({ currency: 'TTD' })),
        },
        financialAccount: {
          findMany: vi.fn(async () =>
            opts?.accounts ?? [{ currentBalance: opts?.cashBalance ?? 20_000 }],
          ),
        },
        expense: {
          findMany: vi.fn(async () =>
            (opts?.bills ?? [1_500]).map((b) =>
              typeof b === 'number' ? { amount: b, currency: 'TTD' } : b,
            ),
          ),
        },
        cashReserveBucket: {
          findMany: vi.fn(async () => opts?.reserves ?? [{ name: 'Equipment', currentAmount: 1_000, currency: 'TTD' }]),
        },
        payrollRun: {
          findMany: vi.fn(async () => opts?.payrollRuns ?? []),
        },
        exchangeRate: {
          findMany: vi.fn(async () => opts?.exchangeRates ?? []),
        },
        ledgerEntry: {
          findMany: vi.fn(async () => opts?.cashLedgerEntries ?? []),
          aggregate: vi.fn(async () => ({
            _sum: {
              credit: opts?.taxCredit ?? 2_000,
              debit: opts?.taxDebit ?? 500,
            },
          })),
        },
      },
    } as any;
    const coaSeeder = {
      getBySystemKey: vi.fn(async () => ({ id: 'coa_tax_payable' })),
    } as any;
    return { prisma, coaSeeder, svc: new SafeToSpendService(prisma, coaSeeder) };
  }

  it('deducts committed DRAFT and APPROVED payroll runs from safeToSpend', async () => {
    const { svc, prisma } = makeStubs({
      cashBalance: 20_000,
      taxCredit: 2_000,
      taxDebit: 500, // taxReserved = 1,500
      bills: [1_500], // billsDueNext30Days = 1,500
      reserves: [{ name: 'Equipment', currentAmount: 1_000 }], // otherReserves = 1,000
      payrollRuns: [
        { totalGross: 3_200, status: 'APPROVED', currency: 'TTD' },
        { totalGross: 1_800, status: 'DRAFT', currency: 'TTD' },
      ], // payrollReserved = 5,000
    });

    const result = await svc.calculate('biz_1');

    expect(prisma.client.payrollRun.findMany).toHaveBeenCalledWith({
      where: {
        businessId: 'biz_1',
        status: { in: ['DRAFT', 'APPROVED'] },
      },
      select: { totalGross: true, currency: true, status: true },
    });
    expect(result.payrollReserved).toBe(5_000);
    // 20,000 - 1,500 (tax) - 1,500 (bills) - 5,000 (payroll) - 2,000 (10% buffer) - 1,000 (reserves) = 9,000
    expect(result.safeToSpend).toBe(9_000);
    expect(result.explanation).toContain('Payroll reserved: TTD 5000.00 (2 committed runs)');
  });

  it('reports 0 payrollReserved with "(no unpaid runs)" when no DRAFT or APPROVED runs exist', async () => {
    const { svc } = makeStubs({ payrollRuns: [] });
    const result = await svc.calculate('biz_1');
    expect(result.payrollReserved).toBe(0);
    expect(result.explanation).toContain('Payroll reserved: TTD 0.00 (no unpaid runs)');
  });

  it('derives cashBalance from openingBalance plus non-OPENING_BALANCE ledger movements so paid payroll reduces cash as reserve releases', async () => {
    // Before payment: openingBalance = 20,000, APPROVED payroll = 5,000, no ledger movement yet
    const beforeStub = makeStubs({
      accounts: [{ id: 'fa_bank', chartOfAccountId: 'coa_bank', openingBalance: 20_000, currentBalance: 20_000, currency: 'TTD' }],
      cashLedgerEntries: [
        // An OPENING_BALANCE transaction in the ledger must NOT double-count openingBalance
        { accountId: 'coa_bank', debit: 20_000, credit: 0, currency: 'TTD', transaction: { type: 'OPENING_BALANCE' } },
      ],
      taxCredit: 0,
      taxDebit: 0,
      bills: [],
      reserves: [],
      payrollRuns: [{ totalGross: 5_000, status: 'APPROVED', currency: 'TTD' }],
    });
    const before = await beforeStub.svc.calculate('biz_1');
    expect(before.cashBalance).toBe(20_000);
    expect(before.payrollReserved).toBe(5_000);
    // 20,000 - 5,000 (payroll) - 2,000 (10% buffer) = 13,000
    expect(before.safeToSpend).toBe(13_000);

    // After payment: payroll run is PAID (removed from committed runs), and ledger has Cr BANK 5,000
    const afterStub = makeStubs({
      accounts: [{ id: 'fa_bank', chartOfAccountId: 'coa_bank', openingBalance: 20_000, currentBalance: 20_000, currency: 'TTD' }],
      cashLedgerEntries: [
        { accountId: 'coa_bank', debit: 20_000, credit: 0, currency: 'TTD', transaction: { type: 'OPENING_BALANCE' } },
        { accountId: 'coa_bank', debit: 0, credit: 5_000, currency: 'TTD', transaction: { type: 'EXPENSE' } },
      ],
      taxCredit: 0,
      taxDebit: 0,
      bills: [],
      reserves: [],
      payrollRuns: [],
    });
    const after = await afterStub.svc.calculate('biz_1');
    expect(after.cashBalance).toBe(15_000);
    expect(after.payrollReserved).toBe(0);
    // 15,000 - 1,500 (10% buffer) = 13,500 (cash dropped by 5,000, buffer adjusted from 2,000 to 1,500)
    expect(after.safeToSpend).toBe(13_500);
    expect(after.cashBalance).toBe(before.cashBalance - 5_000);
  });

  it('converts foreign-currency payroll reserves and bills into business base currency via ExchangeRate', async () => {
    const { svc } = makeStubs({
      cashBalance: 50_000,
      taxCredit: 0,
      taxDebit: 0,
      bills: [{ amount: 1_000, currency: 'USD' }], // 1,000 USD * 6.8 = 6,800 TTD
      reserves: [],
      payrollRuns: [{ totalGross: 2_000, status: 'APPROVED', currency: 'USD' }], // 2,000 USD * 6.8 = 13,600 TTD
      exchangeRates: [{ fromCurrency: 'USD', toCurrency: 'TTD', rate: 6.8 }],
    });
    const result = await svc.calculate('biz_1');
    expect(result.billsDueNext30Days).toBe(6_800);
    expect(result.payrollReserved).toBe(13_600);
    // 50,000 - 6,800 - 13,600 - 5,000 (10% buffer) = 24,600
    expect(result.safeToSpend).toBe(24_600);
  });

  it('fails closed with BadRequestException when a foreign-currency payroll run has no configured exchange rate', async () => {
    const { svc } = makeStubs({
      cashBalance: 50_000,
      payrollRuns: [{ totalGross: 2_000, status: 'APPROVED', currency: 'EUR' }],
      exchangeRates: [],
    });
    await expect(svc.calculate('biz_1')).rejects.toThrow(BadRequestException);
    await expect(svc.calculate('biz_1')).rejects.toThrow(/missing exchange rate from EUR to TTD/);
  });
});
