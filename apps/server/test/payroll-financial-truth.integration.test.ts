/**
 * PR #195 — Payroll, Ledger, Cash, Safe-to-Spend & KEY Treasury Sight (REAL PostgreSQL).
 *
 * Exercises the complete financial truth chain against live PostgreSQL transactions:
 * 1. Atomic payroll generation -> approval -> disbursement (`$transaction`), updating
 *    `FinancialAccount.currentBalance`, `FinancialTransaction`, and `LedgerEntry` rows.
 * 2. Immediate `BusinessGraphService.getSnapshot(businessId)` (default `forceRefresh = false`)
 *    cache invalidation after payroll and ledger mutations.
 * 3. Explicit `FinancialAccount` validation (rejecting mismatched `chartOfAccountId` or
 *    cross-business `financialAccountId`).
 * 4. FX-sensitive cash reconstruction using persisted `appliedDelta` so subsequent
 *    `ExchangeRate` updates never fabricate or erase cash, and exact `appliedDelta`
 *    negation on `PostingService.reverse()`.
 * 5. Multi-currency `TAX_PAYABLE` reserve normalization into business base currency.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'pft195_';
const ID = {
  userA: `${P}userA`,
  userB: `${P}userB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  orgUnitA: `${P}orgUnitA`,
  assignA: `${P}assignA`,
  faBankMain: `${P}faBankMain`,
  faCashPetty: `${P}faCashPetty`,
  faOtherBiz: `${P}faOtherBiz`,
  coaOtherBizBank: `${P}coaOtherBizBank`,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let coaSeeder: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let postingService: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let expensePostingService: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let payrollService: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let safeToSpendService: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let financeOverviewService: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let businessGraphService: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM ledger_entries WHERE business_id LIKE '${P}%'`,
    `UPDATE financial_transactions SET reversal_of_id = NULL WHERE business_id LIKE '${P}%'`,
    `DELETE FROM financial_transactions WHERE business_id LIKE '${P}%'`,
    `DELETE FROM payroll_items WHERE business_id LIKE '${P}%'`,
    `DELETE FROM payroll_runs WHERE business_id LIKE '${P}%'`,
    `DELETE FROM pay_rates WHERE business_id LIKE '${P}%'`,
    `DELETE FROM org_assignments WHERE business_id LIKE '${P}%'`,
    `DELETE FROM org_units WHERE business_id LIKE '${P}%'`,
    `DELETE FROM exchange_rates WHERE business_id LIKE '${P}%'`,
    `DELETE FROM revenue_actions WHERE business_id LIKE '${P}%'`,
    `DELETE FROM financial_accounts WHERE business_id LIKE '${P}%'`,
    `DELETE FROM chart_of_accounts WHERE business_id LIKE '${P}%'`,
    `DELETE FROM businesses WHERE id LIKE '${P}%'`,
    `DELETE FROM users WHERE id LIKE '${P}%'`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort cleanup */
    }
  }
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { ChartOfAccountsSeederService } = await import(
    '../src/modules/finance/chart-of-accounts-seeder.service'
  );
  const { PostingService } = await import('../src/modules/finance/posting.service');
  const { ExpensePostingService } = await import(
    '../src/modules/finance/expense-posting.service'
  );
  const { PayrollService } = await import('../src/modules/payroll/payroll.service');
  const { SafeToSpendService } = await import('../src/modules/finance/safe-to-spend.service');
  const { FinanceOverviewService } = await import(
    '../src/modules/finance/finance-overview.service'
  );
  const { BusinessGraphService } = await import(
    '../src/modules/ai/business-graph.service'
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma = new PrismaService() as any;
  coaSeeder = new ChartOfAccountsSeederService(prisma);
  postingService = new PostingService(prisma);
  expensePostingService = new ExpensePostingService(prisma, postingService, coaSeeder);
  payrollService = new PayrollService(prisma, expensePostingService);
  safeToSpendService = new SafeToSpendService(prisma, coaSeeder);
  financeOverviewService = new FinanceOverviewService(prisma, null, null, null);
  businessGraphService = new BusinessGraphService(prisma);

  await cleanup();

  await db.user.create({ data: { id: ID.userA, email: `${P}a@t.local`, role: 'USER' } });
  await db.user.create({ data: { id: ID.userB, email: `${P}b@t.local`, role: 'USER' } });
  await db.business.create({
    data: { id: ID.bizA, name: 'KeyFlow Truth Integration A', ownerId: ID.userA, currency: 'TTD' },
  });
  await db.business.create({
    data: { id: ID.bizB, name: 'KeyFlow Truth Integration B', ownerId: ID.userB, currency: 'TTD' },
  });

  await coaSeeder.ensureDefaults(ID.bizA);
  const bankCoa = await coaSeeder.getBySystemKey(ID.bizA, 'BANK');
  const cashCoa = await coaSeeder.getBySystemKey(ID.bizA, 'CASH');

  await db.financialAccount.create({
    data: {
      id: ID.faBankMain,
      businessId: ID.bizA,
      chartOfAccountId: bankCoa.id,
      name: 'Republic Bank Operating',
      type: 'BANK',
      subtype: 'checking',
      currency: 'TTD',
      openingBalance: 30_000,
      currentBalance: 30_000,
      isDefault: true,
      isActive: true,
    },
  });

  await db.financialAccount.create({
    data: {
      id: ID.faCashPetty,
      businessId: ID.bizA,
      chartOfAccountId: cashCoa.id,
      name: 'Petty Cash',
      type: 'CASH',
      currency: 'TTD',
      openingBalance: 5_000,
      currentBalance: 5_000,
      isDefault: true,
      isActive: true,
    },
  });

  await db.chartOfAccount.create({
    data: {
      id: ID.coaOtherBizBank,
      businessId: ID.bizB,
      systemKey: 'BANK',
      name: 'Other Biz Bank',
      type: 'ASSET',
    },
  });
  await db.financialAccount.create({
    data: {
      id: ID.faOtherBiz,
      businessId: ID.bizB,
      chartOfAccountId: ID.coaOtherBizBank,
      name: 'Other Biz Checking',
      type: 'BANK',
      currency: 'TTD',
      openingBalance: 10_000,
      currentBalance: 10_000,
      isDefault: true,
      isActive: true,
    },
  });

  await db.orgUnit.create({
    data: { id: ID.orgUnitA, businessId: ID.bizA, name: 'Engineering', type: 'DEPARTMENT' },
  });
  await db.orgAssignment.create({
    data: {
      id: ID.assignA,
      businessId: ID.bizA,
      orgUnitId: ID.orgUnitA,
      isContactOnly: true,
      contactName: 'Maya Singh',
    },
  });
  await payrollService.setRate(ID.bizA, {
    assignmentId: ID.assignA,
    amount: 8_000,
    currency: 'TTD',
    periodType: 'monthly',
  });
}, 60_000);

afterAll(async () => {
  if (db) await cleanup();
});

describe('PostgreSQL Financial Truth & KEY Treasury Sight Integration', () => {
  it('executes atomic payroll disbursement and invalidates normal KEY getSnapshot(businessId) cache immediately', async () => {
    // 1. Prime KEY's BusinessGraphSnapshot cache before any payroll run exists
    const initialSnapshot = await businessGraphService.getSnapshot(ID.bizA);
    expect(initialSnapshot.treasury?.cashBalance).toBe(35_000);
    expect(initialSnapshot.treasury?.committedPayrollAmount).toBe(0);

    // 2. Generate DRAFT payroll run (8,000 TTD)
    const draftRun = await payrollService.generateRun(
      ID.bizA,
      new Date('2026-08-01T00:00:00.000Z'),
      new Date('2026-08-31T00:00:00.000Z'),
      { notes: 'August real DB payroll' },
    );
    expect(draftRun.status).toBe('DRAFT');
    expect(Number(draftRun.totalGross)).toBe(8_000);

    // Normal getSnapshot(ID.bizA) without forceRefresh=true must immediately reflect the 8,000 TTD reserve
    const draftSnapshot = await businessGraphService.getSnapshot(ID.bizA);
    expect(draftSnapshot.treasury?.cashBalance).toBe(35_000);
    expect(draftSnapshot.treasury?.committedPayrollAmount).toBe(8_000);
    expect(draftSnapshot.treasury?.committedPayrollRuns).toBe(1);

    const draftSafe = await safeToSpendService.calculate(ID.bizA);
    expect(draftSafe.cashBalance).toBe(35_000);
    expect(draftSafe.payrollReserved).toBe(8_000);
    expect(draftSafe.safeToSpend).toBe(23_500);

    // 3. Approve and mark paid from faBankMain
    await payrollService.approveRun(ID.bizA, draftRun.id, ID.userA);
    const paidRun = await payrollService.markRunPaid(ID.bizA, draftRun.id, {
      paymentAccountId: ID.faBankMain,
    });
    expect(paidRun.status).toBe('PAID');

    // 4. Verify PostgreSQL FinancialAccount.currentBalance and normal KEY snapshot read
    const updatedBank = await db.financialAccount.findUnique({ where: { id: ID.faBankMain } });
    expect(Number(updatedBank.currentBalance)).toBe(22_000);

    const paidSafe = await safeToSpendService.calculate(ID.bizA);
    const paidOverview = await financeOverviewService.getOverview(ID.bizA);
    const paidSnapshot = await businessGraphService.getSnapshot(ID.bizA);

    expect(paidSafe.cashBalance).toBe(27_000);
    expect(paidOverview.cashBalance).toBe(27_000);
    expect(paidSnapshot.treasury?.cashBalance).toBe(27_000);
    expect(paidSafe.payrollReserved).toBe(0);
    expect(paidSnapshot.treasury?.committedPayrollAmount).toBe(0);
    expect(paidSnapshot.treasury?.committedPayrollRuns).toBe(0);
  });

  it('rejects explicitly targeted FinancialAccounts that belong to another business or mismatch the entry COA', async () => {
    const bankCoa = await coaSeeder.getBySystemKey(ID.bizA, 'BANK');
    const payrollCoa = await coaSeeder.getBySystemKey(ID.bizA, 'EXPENSE_PAYROLL');

    // Petty cash account is linked to CASH COA, not BANK COA
    await expect(
      postingService.post({
        businessId: ID.bizA,
        type: 'EXPENSE',
        date: new Date('2026-09-01T00:00:00.000Z'),
        amount: 500,
        currency: 'TTD',
        sourceType: 'ManualTest',
        sourceId: 'wrong_coa_1',
        kind: 'paid',
        entries: [
          { accountId: payrollCoa.id, debit: 500 },
          { accountId: bankCoa.id, financialAccountId: ID.faCashPetty, credit: 500 },
        ],
      }),
    ).rejects.toThrow(/is linked to chart of account .*, which does not match ledger entry account/);

    // Cross-business FinancialAccount
    await expect(
      postingService.post({
        businessId: ID.bizA,
        type: 'EXPENSE',
        date: new Date('2026-09-01T00:00:00.000Z'),
        amount: 500,
        currency: 'TTD',
        sourceType: 'ManualTest',
        sourceId: 'wrong_biz_1',
        kind: 'paid',
        entries: [
          { accountId: payrollCoa.id, debit: 500 },
          { accountId: bankCoa.id, financialAccountId: ID.faOtherBiz, credit: 500 },
        ],
      }),
    ).rejects.toThrow(/does not belong to business/);
  });

  it('preserves exact cash under changed FX rates using persisted appliedDelta and normalizes multi-currency tax reserves', async () => {
    const bankCoa = await coaSeeder.getBySystemKey(ID.bizA, 'BANK');
    const revCoa = await coaSeeder.getBySystemKey(ID.bizA, 'REVENUE_SERVICE');
    const taxCoa = await coaSeeder.getBySystemKey(ID.bizA, 'TAX_PAYABLE');

    await db.exchangeRate.create({
      data: {
        businessId: ID.bizA,
        fromCurrency: 'USD',
        toCurrency: 'TTD',
        rate: 6.8,
        date: new Date('2026-09-01T00:00:00.000Z'),
        source: 'manual',
      },
    });

    // Post USD 100 invoice payment with 20 USD tax into TTD bank at rate 6.8 (+680 TTD cash, +136 TTD tax reserve)
    const usdPosted = await postingService.post({
      businessId: ID.bizA,
      type: 'INCOME',
      date: new Date('2026-09-02T00:00:00.000Z'),
      amount: 100,
      currency: 'USD',
      sourceType: 'Payment',
      sourceId: 'usd_pay_fx_1',
      kind: 'received',
      entries: [
        { accountId: bankCoa.id, financialAccountId: ID.faBankMain, debit: 100 },
        { accountId: revCoa.id, credit: 80 },
        { accountId: taxCoa.id, credit: 20 },
      ],
    });

    // Also post a TTD tax entry of 500 TTD
    const ttdTaxPosted = await postingService.post({
      businessId: ID.bizA,
      type: 'INCOME',
      date: new Date('2026-09-02T00:00:00.000Z'),
      amount: 500,
      currency: 'TTD',
      sourceType: 'Payment',
      sourceId: 'ttd_pay_tax_1',
      kind: 'received',
      entries: [
        { accountId: bankCoa.id, financialAccountId: ID.faBankMain, debit: 500 },
        { accountId: taxCoa.id, credit: 500 },
      ],
    });

    // Bank balance: 22,000 + 680 + 500 = 23,180; Total cash (with 5,000 petty cash) = 28,180
    // Tax reserve at rate 6.8: 500 TTD + (20 USD * 6.8 = 136 TTD) = 636 TTD
    const safeAt68 = await safeToSpendService.calculate(ID.bizA);
    expect(safeAt68.cashBalance).toBe(28_180);
    expect(safeAt68.taxReserved).toBe(636);

    // Now insert a newer exchange rate USD -> TTD = 7.5
    await db.exchangeRate.create({
      data: {
        businessId: ID.bizA,
        fromCurrency: 'USD',
        toCurrency: 'TTD',
        rate: 7.5,
        date: new Date('2026-09-10T00:00:00.000Z'),
        source: 'manual',
      },
    });

    // Cash in the TTD bank account must remain 28,180 TTD (NOT 28,250 TTD!) because the 100 USD
    // was already converted and settled into TTD at 6.8 (appliedDelta = 680 TTD).
    // Meanwhile, the unsettled USD 20 tax liability revalues at 7.5 (500 + 150 = 650 TTD).
    const safeAt75 = await safeToSpendService.calculate(ID.bizA);
    const overviewAt75 = await financeOverviewService.getOverview(ID.bizA);
    const graphAt75 = await businessGraphService.getSnapshot(ID.bizA);

    expect(safeAt75.cashBalance).toBe(28_180);
    expect(overviewAt75.cashBalance).toBe(28_180);
    expect(graphAt75.treasury?.cashBalance).toBe(28_180);
    expect(safeAt75.taxReserved).toBe(650);
    expect(overviewAt75.taxReserved).toBe(650);

    // Reversing the USD transaction must negate the exact 680 TTD appliedDelta
    await postingService.reverse(ID.bizA, usdPosted.transactionId, { reason: 'FX reversal test' });
    await postingService.reverse(ID.bizA, ttdTaxPosted.transactionId, { reason: 'Tax reversal test' });

    const bankAfterReversal = await db.financialAccount.findUnique({ where: { id: ID.faBankMain } });
    expect(Number(bankAfterReversal.currentBalance)).toBe(22_000);

    const safeAfterReversal = await safeToSpendService.calculate(ID.bizA);
    expect(safeAfterReversal.cashBalance).toBe(27_000);
    expect(safeAfterReversal.taxReserved).toBe(0);
  });
});
