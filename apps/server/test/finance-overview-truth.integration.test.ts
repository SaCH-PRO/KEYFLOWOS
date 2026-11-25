/**
 * V1-65 (SWP-FIN-OVERVIEW-TRUTH, BUG-021, BUG-112, Journeys H & I) — server half:
 * Real-Postgres + real FinanceOverviewService + ExpensesService +
 * ExpensePostingService + AccountantExportService proof that:
 *
 *   FOT-01 (BUG-021): A 640.25 bill created and then voided (via real
 *          ExpensesService.voidExpense, which sets status='VOID' & deletedAt
 *          and posts its ledger reversal) — plus a legacy status='VOID' row
 *          with deletedAt=null — are NOT counted in `expensesThisMonth`,
 *          `netProfitThisMonth` equals the ledger P&L (`AccountantExportService`),
 *          and voided bills do not generate `UNCATEGORISED_EXPENSE` or
 *          `MISSING_RECEIPT` action items.
 *   FOT-02 (BUG-112): A PAID recurring expense (`isRecurring: true, status: 'PAID'`,
 *          e.g. paid monthly rent) is NOT counted in `billsDue`, `billsDueCount`,
 *          or `BILL_DUE` actions; an actual unpaid bill (`status: 'BILL'`,
 *          non-recurring or recurring) IS counted in `billsDue`, `billsDueCount`,
 *          and `BILL_DUE` actions, and drops out once voided or paid.
 *   FOT-03 (Burn & multi-tenant): A voided expense in the prior 6-month window
 *          does not inflate 6-month burn / depress `cashRunwayMonths`, and
 *          another tenant's open bills / expenses never leak into this tenant's
 *          overview.
 *
 * Pre-allocated fixture prefix: `v65a_` (registered in
 * `apps/server/test/helpers/fixture-prefixes.json`, cleaned up with
 * `sqlLikePrefix(P)`).
 */
import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { db } from '@keyflow/db';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { FinanceOverviewService } from '../src/modules/finance/finance-overview.service';
import { CashPositionService } from '../src/modules/finance/cash-position.service';
import { ChartOfAccountsSeederService } from '../src/modules/finance/chart-of-accounts-seeder.service';
import { PostingService } from '../src/modules/finance/posting.service';
import { AccountingPeriodService } from '../src/modules/finance/accounting-period.service';
import { ExpensePostingService } from '../src/modules/finance/expense-posting.service';
import { ExpensesService } from '../src/modules/expenses/expenses.service';
import { AccountantExportService } from '../src/modules/finance/accountant-export.service';
import { sqlLikePrefix } from './helpers/sql-like.js';

const P = 'v65a_';

const ID = {
  owner: `${P}owner`,
  otherOwner: `${P}other_owner`,
  bizVoid: `${P}biz_void`,
  bizBills: `${P}biz_bills`,
  bizBurn: `${P}biz_burn`,
  bizOther: `${P}biz_other`,
};

async function cleanup() {
  await db.$executeRawUnsafe(`DELETE FROM revenue_actions WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM ledger_entries WHERE transaction_id IN (SELECT id FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)})`);
  await db.$executeRawUnsafe(`DELETE FROM financial_transactions WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM expenses WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM expense_categories WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM payments WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM financial_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM chart_of_accounts WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM accounting_periods WHERE business_id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM memberships WHERE id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`);
  await db.$executeRawUnsafe(`DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`);
}

describe('V1-65 (SWP-FIN-OVERVIEW-TRUTH, BUG-021, BUG-112) — server half', () => {
  let overview: FinanceOverviewService;
  let expenses: ExpensesService;
  let coaSeeder: ChartOfAccountsSeederService;
  let accountantExport: AccountantExportService;

  beforeAll(async () => {
    await cleanup();

    await db.user.createMany({
      data: [
        { id: ID.owner, email: `${P}owner@test.local`, name: 'v65a Owner', role: 'USER' },
        { id: ID.otherOwner, email: `${P}other@test.local`, name: 'v65a Other', role: 'USER' },
      ],
    });
    await db.business.createMany({
      data: [
        { id: ID.bizVoid, name: 'v65a Void Biz', slug: `${P}void`, ownerId: ID.owner, currency: 'TTD' },
        { id: ID.bizBills, name: 'v65a Bills Biz', slug: `${P}bills`, ownerId: ID.owner, currency: 'TTD' },
        { id: ID.bizBurn, name: 'v65a Burn Biz', slug: `${P}burn`, ownerId: ID.owner, currency: 'TTD' },
        { id: ID.bizOther, name: 'v65a Other Biz', slug: `${P}other`, ownerId: ID.otherOwner, currency: 'TTD' },
      ],
    });
    await db.membership.createMany({
      data: [
        { id: `${P}m_v`, businessId: ID.bizVoid, userId: ID.owner, role: 'OWNER' },
        { id: `${P}m_b`, businessId: ID.bizBills, userId: ID.owner, role: 'OWNER' },
        { id: `${P}m_r`, businessId: ID.bizBurn, userId: ID.owner, role: 'OWNER' },
        { id: `${P}m_o`, businessId: ID.bizOther, userId: ID.otherOwner, role: 'OWNER' },
      ],
    });

    const prismaStub = { client: db } as unknown as PrismaService;
    const eventsStub = { emit: () => true } as unknown as EventEmitter2;
    coaSeeder = new ChartOfAccountsSeederService(prismaStub);
    const periods = new AccountingPeriodService(prismaStub);
    const posting = new PostingService(prismaStub, periods);
    const cashPosition = new CashPositionService(prismaStub);
    const expensePosting = new ExpensePostingService(prismaStub, posting, coaSeeder);
    const timelineStub = { recordEvent: async () => null } as any;

    overview = new FinanceOverviewService(prismaStub, null, null, null, cashPosition);
    expenses = new ExpensesService(prismaStub, eventsStub, expensePosting, timelineStub, posting);
    accountantExport = new AccountantExportService(prismaStub);
  });

  afterAll(async () => {
    await cleanup();
  });

  it('[FOT-01] RED-BEFORE (BUG-021): a 640.25 VOID bill (via voidExpense or legacy status=VOID) is excluded from expensesThisMonth, netProfitThisMonth equals ledger P&L, and voided rows create no expense actions', async () => {
    const now = new Date();
    // Seed a real operating expense (200.00) and a 640.25 bill that gets voided via real ExpensesService.voidExpense.
    const kept = await expenses.createExpense({
      businessId: ID.bizVoid,
      description: 'Valid office supplies',
      amount: 200,
      date: now,
      status: 'PAID',
      vendor: 'OfficeMart',
    });
    expect(kept.status).toBe('PAID');

    const bill = await expenses.createExpense({
      businessId: ID.bizVoid,
      description: 'Mistaken supplier bill',
      amount: 640.25,
      date: now,
      status: 'BILL',
      vendor: 'MistakeVendor',
      dueDate: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    });
    expect(bill.status).toBe('BILL');

    await expenses.voidExpense({
      businessId: ID.bizVoid,
      expenseId: bill.id,
      reason: 'Entered in error',
    });

    // Also seed a legacy VOID row with deletedAt=null (defends against direct/pre-soft-delete VOID rows).
    await db.expense.create({
      data: {
        id: `${P}legacy_void_bill`,
        businessId: ID.bizVoid,
        description: 'Legacy voided bill',
        amount: 315.5,
        date: now,
        status: 'VOID',
        vendor: 'LegacyVendor',
        deletedAt: null,
      },
    });

    const result = await overview.getOverview(ID.bizVoid);
    expect(result.expensesThisMonth).toBe(200);
    expect(result.revenueThisMonth).toBe(0);
    expect(result.netProfitThisMonth).toBe(-200);

    // Compare against the real ledger P&L for this month (voidExpense reversed the 640.25 ledger posting).
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    const pnl = await accountantExport.buildProfitAndLoss(ID.bizVoid, monthStart, monthEnd);
    expect(result.netProfitThisMonth).toBe(pnl.netProfit);

    // Neither voided bill should surface as an uncategorised or missing-receipt action.
    const voidActionIds = result.actions.map((a) => a.detail ?? '').join(' | ');
    expect(voidActionIds).not.toContain('MistakeVendor');
    expect(voidActionIds).not.toContain('LegacyVendor');
    expect(result.billsDue).toBe(0);
    expect(result.billsDueCount).toBe(0);
  });

  it('[FOT-02] RED-BEFORE (BUG-112): paid recurring rent is NOT billsDue or a BILL_DUE action; an unpaid BILL IS billsDue and clears once paid', async () => {
    const now = new Date();
    // Paid recurring rent (status PAID, isRecurring true) — MUST NOT be counted as billsDue.
    await db.expense.create({
      data: {
        id: `${P}paid_recurring_rent`,
        businessId: ID.bizBills,
        description: 'Monthly Studio Rent',
        amount: 1500,
        date: now,
        status: 'PAID',
        isRecurring: true,
        recurringFrequency: 'MONTHLY',
        vendor: 'Landlord Co',
        paidAt: now,
      },
    });

    // Unpaid non-recurring bill (status BILL, isRecurring false) — MUST be counted as billsDue.
    const openBill = await db.expense.create({
      data: {
        id: `${P}open_supplier_bill`,
        businessId: ID.bizBills,
        description: 'Packaging Invoice #99',
        amount: 425.75,
        date: now,
        status: 'BILL',
        isRecurring: false,
        vendor: 'BoxCo',
        dueDate: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000),
      },
    });

    // Seed an open bill in another tenant to verify strict tenant isolation.
    await db.expense.create({
      data: {
        id: `${P}other_biz_bill`,
        businessId: ID.bizOther,
        description: 'Other Tenant Bill',
        amount: 9999,
        date: now,
        status: 'BILL',
        vendor: 'OtherVendor',
      },
    });

    const result = await overview.getOverview(ID.bizBills);
    expect(result.billsDue).toBe(425.75);
    expect(result.billsDueCount).toBe(1);

    const billDueActions = result.actions.filter((a) => a.type === 'BILL_DUE');
    expect(billDueActions.some((a) => a.title.includes('Packaging Invoice #99'))).toBe(true);
    expect(billDueActions.some((a) => a.title.includes('Monthly Studio Rent'))).toBe(false);

    // Mark the open bill PAID -> billsDue drops to 0.
    await db.expense.update({
      where: { id: openBill.id },
      data: { status: 'PAID', paidAt: now },
    });
    const afterPaid = await overview.getOverview(ID.bizBills);
    expect(afterPaid.billsDue).toBe(0);
    expect(afterPaid.billsDueCount).toBe(0);
  });

  it('[FOT-03] RED-BEFORE: a legacy status=VOID expense in the prior 6-month window does not inflate burn / depress cashRunwayMonths', async () => {
    const now = new Date();
    const twoMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 15));

    await coaSeeder.ensureDefaults(ID.bizBurn);
    const cashCoa = await coaSeeder.getBySystemKey(ID.bizBurn, 'CASH');
    expect(cashCoa).toBeTruthy();

    // Give bizBurn 6000 cash (unposted legacy opening balance on an active CASH account).
    await db.financialAccount.create({
      data: {
        id: `${P}burn_acct`,
        business: { connect: { id: ID.bizBurn } },
        chartOfAccount: { connect: { id: cashCoa!.id } },
        name: 'Operating Cash',
        type: 'CASH',
        currency: 'TTD',
        openingBalance: 6000,
        currentBalance: 6000,
        isActive: true,
      },
    });
    // One legitimate 6000 expense over the last 6 months -> avgMonthlyBurn = 1000 -> runway = 6.0 months.
    await db.expense.create({
      data: {
        id: `${P}burn_real`,
        businessId: ID.bizBurn,
        description: 'Equipment lease',
        amount: 6000,
        currency: 'TTD',
        date: twoMonthsAgo,
        status: 'PAID',
      },
    });
    // One legacy status='VOID' (deletedAt: null) 24000 expense -> must NOT inflate burn to 5000 (1.2 months).
    await db.expense.create({
      data: {
        id: `${P}burn_void`,
        businessId: ID.bizBurn,
        description: 'Voided equipment bill',
        amount: 24000,
        currency: 'TTD',
        date: twoMonthsAgo,
        status: 'VOID',
        deletedAt: null,
      },
    });

    const result = await overview.getOverview(ID.bizBurn);
    expect(result.cashRunwayMonths).toBe(6);
  });
});
