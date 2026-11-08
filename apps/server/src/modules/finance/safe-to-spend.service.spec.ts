import { describe, expect, it, vi } from 'vitest';
import { SafeToSpendService } from './safe-to-spend.service';

describe('SafeToSpendService', () => {
  function makeStubs(opts?: {
    cashBalance?: number;
    taxCredit?: number;
    taxDebit?: number;
    bills?: number[];
    reserves?: Array<{ name: string; currentAmount: number }>;
    payrollRuns?: Array<{ totalGross: number; status: string }>;
  }) {
    const prisma = {
      client: {
        business: {
          findUnique: vi.fn(async () => ({ currency: 'TTD' })),
        },
        financialAccount: {
          findMany: vi.fn(async () => [{ currentBalance: opts?.cashBalance ?? 20_000 }]),
        },
        expense: {
          findMany: vi.fn(async () => (opts?.bills ?? [1_500]).map((amount) => ({ amount }))),
        },
        cashReserveBucket: {
          findMany: vi.fn(async () => opts?.reserves ?? [{ name: 'Equipment', currentAmount: 1_000 }]),
        },
        payrollRun: {
          findMany: vi.fn(async () => opts?.payrollRuns ?? []),
        },
        ledgerEntry: {
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
        { totalGross: 3_200, status: 'APPROVED' },
        { totalGross: 1_800, status: 'DRAFT' },
      ], // payrollReserved = 5,000
    });

    const result = await svc.calculate('biz_1');

    expect(prisma.client.payrollRun.findMany).toHaveBeenCalledWith({
      where: {
        businessId: 'biz_1',
        status: { in: ['DRAFT', 'APPROVED'] },
      },
      select: { totalGross: true, status: true },
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
});
