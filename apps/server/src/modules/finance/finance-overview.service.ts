import { Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { RedisService } from '../../core/redis/redis.service';
import { FinancialAccountSeederService } from './financial-account-seeder.service';
import { ReceivablesService } from './receivables.service';

/**
 * FIN5 — Compute the start of the current month in America/Port_of_Spain
 * (AST, UTC-4, no DST). All Finance month-to-date KPIs anchor on this so
 * boundary times don't flip the figure under the user's feet at midnight.
 */
function trinidadMonthStart(now: Date): Date {
  const offsetMs = 4 * 3600 * 1000;
  const trinidadNow = new Date(now.getTime() - offsetMs);
  return new Date(Date.UTC(
    trinidadNow.getUTCFullYear(),
    trinidadNow.getUTCMonth(),
    1,
    4, 0, 0, 0,
  ));
}

function trinidadMonthOffset(now: Date, monthsBack: number): Date {
  const offsetMs = 4 * 3600 * 1000;
  const trinidadNow = new Date(now.getTime() - offsetMs);
  return new Date(Date.UTC(
    trinidadNow.getUTCFullYear(),
    trinidadNow.getUTCMonth() - monthsBack,
    1,
    4, 0, 0, 0,
  ));
}

export interface FinanceOverviewActionItem {
  id: string;
  title: string;
  detail: string | null;
  amountAtRisk: number | null;
  status: string;
  type: string;
  createdAt: string;
}

export interface FinanceOverview {
  cashBalance: number;
  cashAccountCount: number;
  revenueThisMonth: number;
  expensesThisMonth: number;
  netProfitThisMonth: number;
  outstandingInvoices: number;
  outstandingInvoiceCount: number;
  overdueInvoices: number;
  overdueInvoiceCount: number;
  billsDue: number;
  billsDueCount: number;
  taxReserved: number;
  cashRunwayMonths: number | null;
  pendingActionCount: number;
  actions: FinanceOverviewActionItem[];
  currency: string;
}

/**
 * FIN5 — Aggregates the headline numbers for the Finance Overview tab.
 * Reuses the existing FinancialAccount.currentBalance ledger and the
 * Invoice/Payment/Expense tables. Falls back to ledger trial balance for
 * the Tax Payable holding account so the figure shown matches what the
 * accountant sees in Reports.
 */
@Injectable()
export class FinanceOverviewService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional() @Inject(FinancialAccountSeederService) private readonly accountSeeder: FinancialAccountSeederService | null,
    @Optional() @Inject(ReceivablesService) private readonly receivables: ReceivablesService | null,
    @Optional() @Inject(RedisService) private readonly redis: RedisService | null,
  ) {}

  private cacheKey(businessId: string) {
    return `finance:overview:${businessId}`;
  }

  async invalidateCache(businessId: string) {
    if (this.redis) {
      await this.redis.del(this.cacheKey(businessId)).catch(() => {});
    }
  }

  async getOverview(businessId: string): Promise<FinanceOverview> {
    const cacheKey = this.cacheKey(businessId);
    if (this.redis) {
      const cached = await this.redis.getJson<FinanceOverview>(cacheKey).catch(() => null);
      if (cached) return cached;
    }

    // First read of the surface seeds the default Cash + Bank accounts +
    // system COA so the numbers below are never zero on a clean install.
    if (this.accountSeeder) {
      await this.accountSeeder.ensureDefaults(businessId);
    }

    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { currency: true },
    });
    const currency = business?.currency ?? 'TTD';

    const now = new Date();
    const monthStart = trinidadMonthStart(now);
    const sixMonthsAgo = trinidadMonthOffset(now, 6);

    const [
      cashAccounts,
      paidInvoices,
      monthExpenses,
      outstandingAgg,
      overdueAgg,
      pendingActionItems,
      taxPayable,
      lastSixExpenses,
      billsDueAgg,
      uncategorisedExpenses,
      missingReceiptExpenses,
      overdueInvoiceList,
      recurringBills,
      receivablesAging,
    ] = await Promise.all([
      this.prisma.client.financialAccount.findMany({
        where: { businessId, isActive: true, type: { in: ['CASH', 'BANK', 'PAYMENT_PROCESSOR'] } },
        select: { currentBalance: true },
      }),
      this.prisma.client.payment.aggregate({
        where: { businessId, status: 'SUCCESSFUL', createdAt: { gte: monthStart } },
        _sum: { amount: true },
      }),
      this.prisma.client.expense.aggregate({
        where: { businessId, date: { gte: monthStart } },
        _sum: { amount: true },
      }),
      this.prisma.client.invoice.aggregate({
        where: { businessId, deletedAt: null, status: { in: ['SENT', 'OVERDUE', 'PARTIALLY_PAID'] } },
        _sum: { total: true },
        _count: true,
      }),
      this.prisma.client.invoice.aggregate({
        where: { businessId, deletedAt: null, status: 'OVERDUE' },
        _sum: { total: true },
        _count: true,
      }),
      // pendingActions count superseded by post-upsert read below
      this.prisma.client.revenueAction.findMany({
        where: { businessId, status: 'PENDING' },
        orderBy: [{ amountAtRisk: 'desc' }, { createdAt: 'desc' }],
        take: 10,
      }),
      this.prisma.client.chartOfAccount.findFirst({
        where: { businessId, systemKey: 'TAX_PAYABLE' },
        select: { id: true },
      }),
      this.prisma.client.expense.aggregate({
        where: {
          businessId,
          date: { gte: sixMonthsAgo, lt: monthStart },
        },
        _sum: { amount: true },
      }),
      this.prisma.client.expense.aggregate({
        where: {
          businessId,
          isRecurring: true,
          date: { gte: monthStart },
        },
        _sum: { amount: true },
        _count: true,
      }),
      // FIN5 action-queue inputs: synthesise non-revenue finance actions
      // (categorisation, receipts, overdue invoices, bills due) so the
      // queue isn't only commerce-driven.
      this.prisma.client.expense.findMany({
        where: { businessId, categoryId: null },
        orderBy: [{ amount: 'desc' }],
        take: 5,
        select: { id: true, amount: true, vendor: true, date: true },
      }),
      this.prisma.client.expense.findMany({
        where: { businessId, receiptUrl: null, amount: { gte: 100 } },
        orderBy: [{ amount: 'desc' }],
        take: 5,
        select: { id: true, amount: true, vendor: true, date: true },
      }),
      this.prisma.client.invoice.findMany({
        where: { businessId, deletedAt: null, status: 'OVERDUE' },
        orderBy: [{ total: 'desc' }],
        take: 5,
        select: { id: true, total: true, invoiceNumber: true, dueDate: true },
      }),
      this.prisma.client.expense.findMany({
        where: { businessId, isRecurring: true, date: { gte: monthStart } },
        orderBy: [{ amount: 'desc' }],
        take: 5,
        select: { id: true, amount: true, vendor: true, description: true, date: true },
      }),
      this.receivables ? this.receivables.getAging(businessId) : Promise.resolve(null),
    ]);

    const cashBalance = cashAccounts.reduce((sum, a) => sum + Number(a.currentBalance ?? 0), 0);

    let taxReserved = 0;
    if (taxPayable) {
      const agg = await this.prisma.client.ledgerEntry.aggregate({
        where: { accountId: taxPayable.id },
        _sum: { debit: true, credit: true },
      });
      // Liability accounts: positive = credit > debit.
      taxReserved = Number(agg._sum.credit ?? 0) - Number(agg._sum.debit ?? 0);
    }

    const revenueThisMonth = Number(paidInvoices._sum.amount ?? 0);
    const expensesThisMonth = Number(monthExpenses._sum.amount ?? 0);
    const netProfitThisMonth = revenueThisMonth - expensesThisMonth;

    // Cash runway = cashBalance / (avg monthly burn over last 6 months).
    const sixMonthBurn = Number(lastSixExpenses._sum.amount ?? 0);
    const avgMonthlyBurn = sixMonthBurn > 0 ? sixMonthBurn / 6 : 0;
    const cashRunwayMonths = avgMonthlyBurn > 0 ? cashBalance / avgMonthlyBurn : null;

    // FIN5 — Upsert finance-wide synthetic actions into RevenueAction so
    // they propagate to KEYFLOW Today / R3 (single source of truth). Keyed
    // on the unique constraint (businessId, type, relatedType, relatedId)
    // so repeated overview loads are idempotent.
    type SyntheticSpec = {
      type: string;
      relatedType: string;
      relatedId: string;
      title: string;
      detail: string | null;
      amountAtRisk: number;
      priority: number;
    };
    const specs: SyntheticSpec[] = [
      ...overdueInvoiceList.map<SyntheticSpec>((inv) => ({
        type: 'OVERDUE_INVOICE',
        relatedType: 'invoice',
        relatedId: inv.id,
        title: `Chase overdue invoice ${inv.invoiceNumber ?? ''}`.trim(),
        detail: inv.dueDate ? `Due ${inv.dueDate.toISOString().slice(0, 10)}` : null,
        amountAtRisk: Number(inv.total ?? 0),
        priority: 1,
      })),
      ...uncategorisedExpenses.map<SyntheticSpec>((e) => ({
        type: 'UNCATEGORISED_EXPENSE',
        relatedType: 'expense',
        relatedId: e.id,
        title: 'Categorise expense',
        detail: `${e.vendor ?? 'Unknown vendor'} · ${e.date.toISOString().slice(0, 10)}`,
        amountAtRisk: Number(e.amount ?? 0),
        priority: 3,
      })),
      ...missingReceiptExpenses.map<SyntheticSpec>((e) => ({
        type: 'MISSING_RECEIPT',
        relatedType: 'expense',
        relatedId: e.id,
        title: 'Attach receipt',
        detail: `${e.vendor ?? 'Unknown vendor'} · ${e.date.toISOString().slice(0, 10)}`,
        amountAtRisk: Number(e.amount ?? 0),
        priority: 3,
      })),
      ...recurringBills.map<SyntheticSpec>((b) => ({
        type: 'BILL_DUE',
        relatedType: 'expense',
        relatedId: b.id,
        title: `Bill due: ${b.description ?? b.vendor ?? 'Recurring expense'}`,
        detail: b.vendor ?? null,
        amountAtRisk: Number(b.amount ?? 0),
        priority: 2,
      })),
    ];
    if (cashRunwayMonths != null && cashRunwayMonths < 2) {
      specs.push({
        type: 'LOW_RUNWAY',
        relatedType: 'business',
        relatedId: businessId,
        title: 'Low cash runway',
        detail: `~${cashRunwayMonths.toFixed(1)} months at current burn`,
        amountAtRisk: cashBalance,
        priority: 1,
      });
    }
    if (specs.length > 0) {
      await Promise.all(specs.map((s) =>
        this.prisma.client.revenueAction.upsert({
          where: {
            businessId_type_relatedType_relatedId: {
              businessId,
              type: s.type,
              relatedType: s.relatedType,
              relatedId: s.relatedId,
            },
          },
          create: {
            businessId,
            type: s.type,
            relatedType: s.relatedType,
            relatedId: s.relatedId,
            title: s.title,
            detail: s.detail,
            amountAtRisk: s.amountAtRisk,
            priority: s.priority,
            status: 'PENDING',
          },
          update: {
            title: s.title,
            detail: s.detail,
            amountAtRisk: s.amountAtRisk,
            // Don't reopen actions that the user has dismissed/completed.
          },
        }),
      ));
    }

    // Re-read after upserts so the response and KEYFLOW Today / R3 share
    // the same row set. Cap at 25 highest-risk pending items.
    const blendedItems = await this.prisma.client.revenueAction.findMany({
      where: { businessId, status: 'PENDING' },
      orderBy: [{ amountAtRisk: 'desc' }, { priority: 'asc' }, { createdAt: 'desc' }],
      take: 25,
    });
    const blendedCount = await this.prisma.client.revenueAction.count({
      where: { businessId, status: 'PENDING' },
    });

    const actions: FinanceOverviewActionItem[] = blendedItems.map((a) => ({
      id: a.id,
      title: a.title,
      detail: a.detail ?? null,
      amountAtRisk: a.amountAtRisk != null ? Number(a.amountAtRisk) : null,
      status: a.status,
      type: a.type,
      createdAt: a.createdAt.toISOString(),
    }));
    void pendingActionItems; // initial sample superseded by post-upsert read

    const result: FinanceOverview = {
      cashBalance,
      cashAccountCount: cashAccounts.length,
      revenueThisMonth,
      expensesThisMonth,
      netProfitThisMonth,
      outstandingInvoices: receivablesAging ? receivablesAging.totalOutstanding : Number(outstandingAgg._sum.total ?? 0),
      outstandingInvoiceCount: outstandingAgg._count,
      overdueInvoices: receivablesAging ? receivablesAging.totalOverdue : Number(overdueAgg._sum.total ?? 0),
      overdueInvoiceCount: overdueAgg._count,
      billsDue: Number(billsDueAgg._sum.amount ?? 0),
      billsDueCount: billsDueAgg._count,
      taxReserved,
      cashRunwayMonths: cashRunwayMonths != null ? Math.round(cashRunwayMonths * 10) / 10 : null,
      pendingActionCount: blendedCount,
      actions,
      currency,
    };

    if (this.redis) {
      await this.redis.setJson(cacheKey, result, 60).catch(() => {});
    }

    return result;
  }
}
