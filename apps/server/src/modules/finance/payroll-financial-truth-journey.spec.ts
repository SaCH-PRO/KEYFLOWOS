import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { PayrollService } from '../payroll/payroll.service';
import { ExpensePostingService } from './expense-posting.service';
import { PostingService } from './posting.service';
import { SafeToSpendService } from './safe-to-spend.service';
import { FinanceOverviewService } from './finance-overview.service';
import { BusinessGraphService } from '../ai/business-graph.service';

/**
 * End-to-End Financial Truth & KEY Treasury Sight Journey Test
 *
 * Verifies the complete domain chain required by PR #195:
 *   Payroll generation -> Approval -> Payment -> Ledger posting ->
 *   Cash position -> Safe-to-Spend -> Finance Overview -> KEY BusinessGraphSnapshot
 */
describe('Payroll-to-Ledger-to-Treasury E2E Financial Truth Journey', () => {
  function createInMemoryFinancialWorld() {
    const businessId = 'biz_truth_1';
    const coaMap: Record<string, { id: string; businessId: string; systemKey: string }> = {
      CASH: { id: 'coa_cash', businessId, systemKey: 'CASH' },
      BANK: { id: 'coa_bank', businessId, systemKey: 'BANK' },
      PAYMENT_PROCESSOR: { id: 'coa_proc', businessId, systemKey: 'PAYMENT_PROCESSOR' },
      EXPENSE_PAYROLL: { id: 'coa_exp_payroll', businessId, systemKey: 'EXPENSE_PAYROLL' },
      TAX_PAYABLE: { id: 'coa_tax_payable', businessId, systemKey: 'TAX_PAYABLE' },
    };

    const financialAccounts = [
      {
        id: 'fa_bank_main',
        businessId,
        chartOfAccountId: 'coa_bank',
        name: 'Republic Bank Operating',
        type: 'BANK',
        subtype: 'checking',
        currency: 'TTD',
        openingBalance: new Prisma.Decimal(30_000),
        currentBalance: new Prisma.Decimal(30_000),
        isDefault: true,
        isActive: true,
      },
      {
        id: 'fa_cash_petty',
        businessId,
        chartOfAccountId: 'coa_cash',
        name: 'Cash on Hand',
        type: 'CASH',
        subtype: null,
        currency: 'TTD',
        openingBalance: new Prisma.Decimal(5_000),
        currentBalance: new Prisma.Decimal(5_000),
        isDefault: true,
        isActive: true,
      },
    ];

    const transactions: Array<{
      id: string;
      businessId: string;
      type: string;
      externalRef: string | null;
      amount: Prisma.Decimal;
      currency: string;
    }> = [];

    const ledgerEntries: Array<{
      id: string;
      transactionId: string;
      businessId: string;
      accountId: string;
      debit: Prisma.Decimal;
      credit: Prisma.Decimal;
      currency: string;
      transaction: { type: string };
    }> = [];

    const payRates = [
      {
        id: 'rate_1',
        businessId,
        assignmentId: 'assign_1',
        amount: new Prisma.Decimal(8_000),
        currency: 'TTD',
        periodType: 'monthly',
        effectiveFrom: new Date('2026-01-01'),
        assignment: { id: 'assign_1', contactName: 'Maya Singh', contactEmail: null, userId: 'u_1' },
      },
    ];

    const payrollRuns: Array<any> = [];

    const client: any = {
      business: {
        findUnique: vi.fn(async () => ({
          id: businessId,
          name: 'KeyFlow Truth Co',
          industry: 'Technology',
          archetype: 'SAAS',
          revenueModel: 'SUBSCRIPTION',
          currency: 'TTD',
          businessStage: 'GROWTH',
          teamSize: '5-10',
        })),
      },
      orgAssignment: {
        findFirst: vi.fn(async ({ where }: any) =>
          where?.id === 'assign_1' ? payRates[0].assignment : null,
        ),
      },
      payRate: {
        findMany: vi.fn(async () => payRates),
      },
      payrollRun: {
        findFirst: vi.fn(async ({ where }: any) => {
          if (where?.id) {
            return payrollRuns.find((r) => r.id === where.id && r.businessId === where.businessId) ?? null;
          }
          return null;
        }),
        findMany: vi.fn(async ({ where }: any) => {
          return payrollRuns.filter((r) => {
            if (where?.businessId && r.businessId !== where.businessId) return false;
            if (where?.status?.in) return where.status.in.includes(r.status);
            if (typeof where?.status === 'string') return r.status === where.status;
            return true;
          });
        }),
        create: vi.fn(async ({ data }: any) => {
          const created = {
            id: `run_${payrollRuns.length + 1}`,
            businessId: data.businessId,
            periodStart: data.periodStart,
            periodEnd: data.periodEnd,
            status: data.status,
            totalGross: new Prisma.Decimal(String(data.totalGross)),
            currency: data.currency,
            itemCount: data.itemCount,
            notes: data.notes ?? null,
            approvedAt: null,
            paidAt: null,
            items: (data.items?.create ?? []).map((it: any, idx: number) => ({
              id: `item_${idx + 1}`,
              ...it,
              assignment: payRates[0].assignment,
            })),
          };
          payrollRuns.push(created);
          return created;
        }),
        update: vi.fn(async ({ where, data }: any) => {
          const run = payrollRuns.find((r) => r.id === where.id);
          if (!run) throw new Error('Run not found');
          Object.assign(run, data);
          return run;
        }),
        updateMany: vi.fn(async ({ where, data }: any) => {
          const run = payrollRuns.find(
            (r) =>
              r.id === where.id &&
              r.businessId === where.businessId &&
              r.status === where.status,
          );
          if (!run) return { count: 0 };
          Object.assign(run, data);
          return { count: 1 };
        }),
      },
      financialAccount: {
        findMany: vi.fn(async () => financialAccounts.filter((a) => a.isActive)),
        findUnique: vi.fn(async ({ where }: any) =>
          financialAccounts.find((a) => a.id === where.id) ?? null,
        ),
        findFirst: vi.fn(async ({ where }: any) => {
          if (where?.id) {
            return (
              financialAccounts.find(
                (a) =>
                  a.id === where.id &&
                  (!where.businessId || a.businessId === where.businessId) &&
                  (where.isActive === undefined || a.isActive === where.isActive),
              ) ?? null
            );
          }
          if (where?.chartOfAccountId) {
            return (
              financialAccounts.find(
                (a) =>
                  a.chartOfAccountId === where.chartOfAccountId &&
                  a.businessId === where.businessId &&
                  a.isActive,
              ) ?? null
            );
          }
          return null;
        }),
        update: vi.fn(async ({ where, data }: any) => {
          const acc = financialAccounts.find((a) => a.id === where.id);
          if (!acc) throw new Error('Account not found');
          const inc = data.currentBalance?.increment;
          if (inc !== undefined) {
            acc.currentBalance = new Prisma.Decimal(String(acc.currentBalance)).add(
              new Prisma.Decimal(String(inc)),
            );
          } else if (data.currentBalance !== undefined) {
            acc.currentBalance = new Prisma.Decimal(String(data.currentBalance));
          }
          return acc;
        }),
      },
      chartOfAccount: {
        findMany: vi.fn(async ({ where }: any) => {
          const ids: string[] = where?.id?.in ?? [];
          return Object.values(coaMap).filter((c) => ids.includes(c.id));
        }),
        findFirst: vi.fn(async ({ where }: any) => {
          if (where?.systemKey) return coaMap[where.systemKey] ?? null;
          return null;
        }),
      },
      financialTransaction: {
        findUnique: vi.fn(async ({ where }: any) => {
          const key = where?.businessId_externalRef;
          if (!key) return null;
          return (
            transactions.find(
              (t) => t.businessId === key.businessId && t.externalRef === key.externalRef,
            ) ?? null
          );
        }),
        create: vi.fn(async ({ data }: any) => {
          const txn = {
            id: `txn_${transactions.length + 1}`,
            businessId: data.businessId,
            type: data.type,
            externalRef: data.externalRef ?? null,
            amount: data.amount,
            currency: data.currency,
            metadata: data.metadata ?? null,
          };
          transactions.push(txn);
          for (const e of data.entries?.create ?? []) {
            ledgerEntries.push({
              id: e.id ?? `le_${ledgerEntries.length + 1}`,
              transactionId: txn.id,
              businessId: e.businessId,
              accountId: e.accountId,
              debit: new Prisma.Decimal(String(e.debit ?? 0)),
              credit: new Prisma.Decimal(String(e.credit ?? 0)),
              currency: e.currency ?? 'TTD',
              transaction: { type: data.type, metadata: data.metadata ?? null },
            });
          }
          return { id: txn.id };
        }),
      },
      ledgerEntry: {
        findMany: vi.fn(async ({ where }: any) => {
          const ids: string[] = where?.accountId?.in ?? [];
          return ledgerEntries.filter(
            (e) => e.businessId === where.businessId && (ids.length === 0 || ids.includes(e.accountId)),
          );
        }),
        aggregate: vi.fn(async () => ({ _sum: { debit: 0, credit: 0 } })),
      },
      expense: {
        findMany: vi.fn(async () => []),
        aggregate: vi.fn(async () => ({ _sum: { amount: 0 }, _count: 0 })),
        groupBy: vi.fn(async () => []),
      },
      cashReserveBucket: {
        findMany: vi.fn(async () => []),
      },
      exchangeRate: {
        findMany: vi.fn(async () => []),
      },
      payment: {
        aggregate: vi.fn(async () => ({ _sum: { amount: 0 } })),
      },
      invoice: {
        aggregate: vi.fn(async () => ({ _sum: { total: 0 }, _count: 0 })),
        count: vi.fn(async () => 0),
        findMany: vi.fn(async () => []),
      },
      revenueAction: {
        findMany: vi.fn(async () => []),
        count: vi.fn(async () => 0),
        upsert: vi.fn(async () => ({})),
      },
      contact: {
        count: vi.fn(async () => 0),
        groupBy: vi.fn(async () => []),
        findMany: vi.fn(async () => []),
      },
      booking: { count: vi.fn(async () => 0) },
      expenseBudget: { aggregate: vi.fn(async () => ({ _sum: { amount: 0 } })) },
      project: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
      projectTask: { count: vi.fn(async () => 0) },
      socialPost: { count: vi.fn(async () => 0) },
      emailCampaign: { count: vi.fn(async () => 0) },
      automation: {
        count: vi.fn(async () => 0),
        aggregate: vi.fn(async () => ({ _sum: { runCount: 0 } })),
      },
      product: {
        count: vi.fn(async () => 0),
        aggregate: vi.fn(async () => ({ _avg: { price: 0 } })),
        findMany: vi.fn(async () => []),
      },
      service: { findMany: vi.fn(async () => []) },
      deal: { findMany: vi.fn(async () => []) },
      supportTicket: { count: vi.fn(async () => 0) },
      $transaction: vi.fn(async (cb: any) => cb(client)),
    };

    const prisma = { client } as any;
    const coaSeeder = {
      getBySystemKey: vi.fn(async (_b: string, key: string) => coaMap[key] ?? null),
      ensureDefaults: vi.fn(async () => undefined),
    } as any;

    const postingService = new PostingService(prisma);
    const expensePostingService = new ExpensePostingService(prisma, postingService, coaSeeder);
    const payrollService = new PayrollService(prisma, expensePostingService);
    const safeToSpendService = new SafeToSpendService(prisma, coaSeeder);
    const financeOverviewService = new FinanceOverviewService(prisma, null, null, null);
    const businessGraphService = new BusinessGraphService(prisma);

    return {
      businessId,
      financialAccounts,
      transactions,
      ledgerEntries,
      payrollService,
      safeToSpendService,
      financeOverviewService,
      businessGraphService,
    };
  }

  it('maintains exact cash, reserve, ledger, Safe-to-Spend, Finance Overview, and KEY BusinessGraph consistency across the full payroll lifecycle', async () => {
    const world = createInMemoryFinancialWorld();
    const {
      businessId,
      financialAccounts,
      transactions,
      ledgerEntries,
      payrollService,
      safeToSpendService,
      financeOverviewService,
      businessGraphService,
    } = world;

    // 1. Initial state: 30,000 (Bank) + 5,000 (Cash) = 35,000 TTD cash, 0 payroll reserved
    const initialSafe = await safeToSpendService.calculate(businessId);
    expect(initialSafe.cashBalance).toBe(35_000);
    expect(initialSafe.payrollReserved).toBe(0);
    // 35,000 - 3,500 (10% buffer) = 31,500
    expect(initialSafe.safeToSpend).toBe(31_500);

    // 2. Generate payroll run (8,000 TTD DRAFT)
    const draftRun = await payrollService.generateRun(
      businessId,
      new Date('2026-08-01'),
      new Date('2026-08-31'),
      { notes: 'August payroll' },
    );
    expect(draftRun.status).toBe('DRAFT');
    expect(Number(draftRun.totalGross)).toBe(8_000);

    // While DRAFT, SafeToSpend reserves the 8,000 TTD and KEY sees 8,000 TTD committed payroll
    const afterDraftSafe = await safeToSpendService.calculate(businessId);
    expect(afterDraftSafe.cashBalance).toBe(35_000);
    expect(afterDraftSafe.payrollReserved).toBe(8_000);
    // 35,000 - 8,000 (payroll) - 3,500 (10% buffer) = 23,500
    expect(afterDraftSafe.safeToSpend).toBe(23_500);

    const draftGraph = await businessGraphService.getSnapshot(businessId, true);
    expect(draftGraph.treasury?.cashBalance).toBe(35_000);
    expect(draftGraph.treasury?.committedPayrollAmount).toBe(8_000);
    expect(draftGraph.treasury?.committedPayrollRuns).toBe(1);

    // 3. Approve payroll run -> still reserved, not yet disbursed
    const approvedRun = await payrollService.approveRun(businessId, draftRun.id, 'user_owner');
    expect(approvedRun.status).toBe('APPROVED');

    // 4. Mark payroll run paid from the explicit Republic Bank account ('fa_bank_main')
    const paidRun = await payrollService.markRunPaid(businessId, draftRun.id, {
      paymentAccountId: 'fa_bank_main',
    });
    expect(paidRun.status).toBe('PAID');

    // 5. Verify ledger entries & FinancialAccount synchronization:
    //    - 1 FinancialTransaction created (PayrollRun:run_1:paid)
    //    - 2 balanced LedgerEntry rows: Dr EXPENSE_PAYROLL 8,000 / Cr BANK 8,000
    //    - Republic Bank FinancialAccount.currentBalance updated from 30,000 to 22,000
    expect(transactions).toHaveLength(1);
    expect(ledgerEntries).toHaveLength(2);
    expect(Number(financialAccounts[0].currentBalance.toString())).toBe(22_000);
    expect(Number(financialAccounts[1].currentBalance.toString())).toBe(5_000);

    // 6. Verify SafeToSpend, FinanceOverview, and KEY BusinessGraph all agree on 27,000 TTD cash
    //    and 0 TTD committed payroll reserve!
    const afterPaidSafe = await safeToSpendService.calculate(businessId);
    const afterPaidOverview = await financeOverviewService.getOverview(businessId);
    const afterPaidGraph = await businessGraphService.getSnapshot(businessId, true);

    expect(afterPaidSafe.cashBalance).toBe(27_000);
    expect(afterPaidOverview.cashBalance).toBe(27_000);
    expect(afterPaidGraph.treasury?.cashBalance).toBe(27_000);

    expect(afterPaidSafe.payrollReserved).toBe(0);
    expect(afterPaidGraph.treasury?.committedPayrollAmount).toBe(0);
    expect(afterPaidGraph.treasury?.committedPayrollRuns).toBe(0);

    // Safe to spend after paying 8,000 payroll: 27,000 - 2,700 (10% buffer) = 24,300
    expect(afterPaidSafe.safeToSpend).toBe(24_300);

    // 7. Idempotent retry: calling markRunPaid a second time does NOT create a second transaction
    //    or reduce cash a second time!
    await payrollService.markRunPaid(businessId, draftRun.id, {
      paymentAccountId: 'fa_bank_main',
    });
    expect(transactions).toHaveLength(1);
    expect(ledgerEntries).toHaveLength(2);
    expect(Number(financialAccounts[0].currentBalance.toString())).toBe(22_000);
    const retrySafe = await safeToSpendService.calculate(businessId);
    expect(retrySafe.cashBalance).toBe(27_000);
  });
});
