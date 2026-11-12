import { describe, expect, it, vi } from 'vitest';
import { SafeToSpendService } from './safe-to-spend.service';

/**
 * PR195-PORT (owner PR #195 part 1): safe-to-spend reserves committed payroll.
 *
 * payrollReserved was a hard 0 "not yet modeled". It is now the gross of the
 * business's committed runs (DRAFT and APPROVED: approved or about to be, not
 * yet paid), deducted from safeToSpend, with the run count in the explanation.
 * A PAID run's money already left the ledger cash (its posting, part 2), so it
 * is not reserved twice; a VOID run is no commitment.
 *
 * Held to the head: cash is the ledger cash position (CashPositionService,
 * V1-34), and every figure is in the business currency; a committed run in
 * another currency is named apart, never added or converted (D-13, V1-37c),
 * as other-currency cash already is. The PR's exchange-rate conversion is not
 * ported (head ruling D-13 wins).
 */

function makeStubs(opts: {
  cashBalance?: number;
  byCurrency?: Record<string, number>;
  runs?: Array<{ totalGross: number | string; currency: string; status: string }>;
  bills?: Array<{ amount: number }>;
} = {}) {
  const cashBalance = opts.cashBalance ?? 50_000;
  const prisma = {
    client: {
      expense: { findMany: vi.fn(async () => opts.bills ?? []) },
      cashReserveBucket: { findMany: vi.fn(async () => []) },
      ledgerEntry: { aggregate: vi.fn(async () => ({ _sum: { debit: 0, credit: 0 } })) },
      payrollRun: { findMany: vi.fn(async () => opts.runs ?? []) },
      financialAccount: {
        // V1-34: never read. A stub that would lie if it were.
        findMany: vi.fn(async () => [{ currentBalance: 999_999 }]),
      },
    },
  } as any;
  const coaSeeder = { getBySystemKey: vi.fn(async () => null) } as any;
  const cashPosition = {
    getCashPosition: vi.fn(async () => ({
      cashBalance,
      currency: 'TTD',
      byCurrency: opts.byCurrency ?? { TTD: cashBalance },
      basis: 'ledger',
      accounts: [],
      unpostedOpeningBalances: [],
    })),
  } as any;
  return { prisma, svc: new SafeToSpendService(prisma, coaSeeder, cashPosition) };
}

describe('SafeToSpendService: committed payroll reserve (PR195-PORT)', () => {
  it('STS-01 reserves DRAFT and APPROVED runs of this business and deducts them from safe to spend', async () => {
    const { svc, prisma } = makeStubs({
      cashBalance: 50_000,
      runs: [
        { totalGross: 6_000, currency: 'TTD', status: 'APPROVED' },
        { totalGross: '2500.50', currency: 'TTD', status: 'DRAFT' },
      ],
    });
    const dto = await svc.calculate('biz_1');

    expect(prisma.client.payrollRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId: 'biz_1', status: { in: ['DRAFT', 'APPROVED'] } } }),
    );
    expect(dto.payrollReserved).toBe(8_500.5);
    // 50,000 - 5,000 buffer (10%) - 8,500.50 payroll = 36,499.50
    expect(dto.operatingBuffer).toBe(5_000);
    expect(dto.safeToSpend).toBe(36_499.5);
    expect(dto.explanation).toContain('Payroll reserved: TTD 8500.50 (2 committed runs)');
    expect(dto.explanation.join('\n')).not.toMatch(/Payroll reserved.*not yet modeled/);
  });

  it('STS-02 one committed run reads in the singular', async () => {
    const { svc } = makeStubs({ runs: [{ totalGross: 1_000, currency: 'TTD', status: 'APPROVED' }] });
    const dto = await svc.calculate('biz_1');
    expect(dto.explanation).toContain('Payroll reserved: TTD 1000.00 (1 committed run)');
  });

  it('STS-03 no committed run: 0 reserved, said plainly', async () => {
    const { svc } = makeStubs({ runs: [] });
    const dto = await svc.calculate('biz_1');
    expect(dto.payrollReserved).toBe(0);
    expect(dto.explanation).toContain('Payroll reserved: TTD 0.00 (no unpaid runs)');
  });

  it('STS-04 (D-13) a committed run in another currency is named apart, never added or converted', async () => {
    const { svc } = makeStubs({
      cashBalance: 20_000,
      runs: [
        { totalGross: 3_000, currency: 'TTD', status: 'APPROVED' },
        { totalGross: 400, currency: 'usd', status: 'DRAFT' },
      ],
    });
    const dto = await svc.calculate('biz_1');
    expect(dto.payrollReserved).toBe(3_000);
    expect(dto.otherCurrencyPayroll).toEqual([{ currency: 'USD', amount: 400 }]);
    expect(dto.explanation).toContain('Payroll reserved: TTD 3000.00 (1 committed run)');
    expect(dto.explanation).toContain('Payroll committed in USD, not included (never added to TTD): USD 400.00 (1 run)');
    // 20,000 - 2,000 buffer - 3,000 = 15,000
    expect(dto.safeToSpend).toBe(15_000);
  });

  it('STS-05 the cash figure stays the ledger cash position (V1-34), never FinancialAccount.currentBalance', async () => {
    const { svc, prisma } = makeStubs({ cashBalance: 12_345, runs: [] });
    const dto = await svc.calculate('biz_1');
    expect(dto.cashBalance).toBe(12_345);
    expect(dto.cashBasis).toBe('ledger');
    expect(prisma.client.financialAccount.findMany).not.toHaveBeenCalled();
  });

  it('STS-06 safe to spend never goes below zero when payroll exceeds cash', async () => {
    const { svc } = makeStubs({ cashBalance: 1_000, runs: [{ totalGross: 9_000, currency: 'TTD', status: 'APPROVED' }] });
    const dto = await svc.calculate('biz_1');
    expect(dto.payrollReserved).toBe(9_000);
    expect(dto.safeToSpend).toBe(0);
  });

  it('STS-07 (review CR-P195-3) draft runs are named apart under the reserve: not yet approved, still reserved', async () => {
    const { svc, prisma } = makeStubs({
      cashBalance: 50_000,
      runs: [
        { totalGross: 6_000, currency: 'TTD', status: 'APPROVED' },
        { totalGross: '2500.50', currency: 'TTD', status: 'DRAFT' },
        { totalGross: 700, currency: 'USD', status: 'DRAFT' },
      ],
    });
    const dto = await svc.calculate('biz_1');
    expect(prisma.client.payrollRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ select: expect.objectContaining({ status: true, totalGross: true, currency: true }) }),
    );
    expect(dto.payrollReserved).toBe(8_500.5);
    const at = dto.explanation.indexOf('Payroll reserved: TTD 8500.50 (2 committed runs)');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(dto.explanation[at + 1]).toBe('  - includes 1 draft run not yet approved: TTD 2500.50');
    expect(dto.explanation.join('\n')).not.toMatch(/draft run not yet approved: USD/);
  });

  it('STS-08 (review CR-P195-3) with only approved runs no draft line is said', async () => {
    const { svc } = makeStubs({ runs: [{ totalGross: 1_000, currency: 'TTD', status: 'APPROVED' }] });
    const dto = await svc.calculate('biz_1');
    expect(dto.explanation.join('\n')).not.toMatch(/draft run/);
  });
});
