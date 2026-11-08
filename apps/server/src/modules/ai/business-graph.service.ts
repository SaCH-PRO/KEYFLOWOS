import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  computeNormalizedCashBalance,
  normalizeCurrencyCode,
  resolveConversionRate,
  type CashLedgerMovementRow,
  type ExchangeRateRow,
} from '../finance/finance-accounting.util';

export interface GraphEntityLink {
  fromType: string;
  fromId: string;
  toType: string;
  toId: string;
  relation: string;
  meta?: Record<string, any>;
}

export interface GraphContactSummary {
  id: string;
  name: string;
  email: string | null;
  status: string;
  revenue: number;
  invoiceIds: string[];
  bookingIds: string[];
  projectIds: string[];
}

export interface GraphInvoiceSummary {
  id: string;
  number: string | null;
  status: string;
  total: number;
  dueDate: string | null;
  contactId: string | null;
  contactName: string | null;
}

export interface GraphProductSummary {
  id: string;
  name: string;
  price: number;
  category: string;
  isActive: boolean;
  serviceId: string | null;
  storefrontListed: boolean;
}

export interface BusinessGraphSnapshot {
  businessId: string;
  timestamp: Date;
  business: {
    name: string;
    industry: string | null;
    archetype: string | null;
    revenueModel: string | null;
    currency: string;
    stage: string | null;
    teamSize: string | null;
  };
  contacts: {
    total: number;
    byStatus: Record<string, number>;
    recentCount: number;
    staleLeadCount: number;
    topClients: Array<{ id: string; name: string; revenue: number }>;
  };
  revenue: {
    totalCollected: number;
    outstandingAmount: number;
    outstandingCount: number;
    overdueCount: number;
    overdueAmount: number;
    monthlyRevenue: number;
    averageInvoiceValue: number;
  };
  bookings: {
    upcomingCount: number;
    completedThisMonth: number;
    cancelledThisMonth: number;
    utilizationRate: number;
  };
  expenses: {
    totalThisMonth: number;
    topCategories: Array<{ name: string; amount: number }>;
    budgetUtilization: number;
  };
  projects: {
    activeCount: number;
    overdueTaskCount: number;
    completionRate: number;
  };
  content: {
    draftPostCount: number;
    scheduledPostCount: number;
    draftCampaignCount: number;
  };
  automations: {
    activeCount: number;
    disabledCount: number;
    totalRuns: number;
  };
  storefront: {
    activeProductCount: number;
    averagePrice: number;
  };
  treasury?: {
    cashBalance: number;
    unpaidBillsAmount: number;
    unpaidBillsCount: number;
    committedPayrollAmount: number;
    committedPayrollRuns: number;
    unconvertedByCurrency?: Record<string, { cash?: number; unpaidBills?: number; committedPayroll?: number }>;
  };
  pipeline?: {
    openDealCount: number;
    openPipelineValue: number;
    unconvertedByCurrency?: Record<string, number>;
  };
  support?: {
    openTicketCount: number;
  };
  momentumScore: number;
  healthIndicators: Array<{ area: string; status: 'good' | 'warning' | 'critical'; detail: string }>;
  links: GraphEntityLink[];
  entities: {
    topContacts: GraphContactSummary[];
    overdueInvoices: GraphInvoiceSummary[];
    catalogProducts: GraphProductSummary[];
  };
}

const CACHE_TTL_MS = 120_000;

@Injectable()
export class BusinessGraphService {
  private readonly logger = new Logger(BusinessGraphService.name);
  private readonly cache = new Map<string, { data: BusinessGraphSnapshot; expiresAt: number }>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async getSnapshot(businessId: string, forceRefresh = false): Promise<BusinessGraphSnapshot> {
    if (!forceRefresh) {
      const cached = this.cache.get(businessId);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.data;
      }
    }

    const snapshot = await this.assembleSnapshot(businessId);
    this.cache.set(businessId, { data: snapshot, expiresAt: Date.now() + CACHE_TTL_MS });
    return snapshot;
  }

  invalidateCache(businessId: string): void {
    this.cache.delete(businessId);
  }

  private async assembleSnapshot(businessId: string): Promise<BusinessGraphSnapshot> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const db = this.prisma.client;

    const [
      business,
      contactTotal,
      contactsByStatus,
      recentContactCount,
      staleLeadCount,
      paidInvoicesTotal,
      outstandingInvoices,
      overdueInvoices,
      monthlyPaid,
      invoiceCount,
      upcomingBookings,
      completedBookingsMonth,
      cancelledBookingsMonth,
      totalBookingsMonth,
      expensesMonth,
      expensesByCategory,
      totalBudget,
      activeProjects,
      overdueProjectTasks,
      completedProjectTasks,
      totalProjectTasks,
      draftPosts,
      scheduledPosts,
      draftCampaigns,
      activeAutomations,
      disabledAutomations,
      automationRuns,
      activeProducts,
      avgProductPrice,
      cashAccountsData,
      unpaidBillsData,
      committedPayrollData,
      openDealsData,
      openTicketsCount,
      exchangeRates,
    ] = await Promise.all([
      db.business.findUnique({
        where: { id: businessId },
        select: { name: true, industry: true, archetype: true, revenueModel: true, currency: true, businessStage: true, teamSize: true },
      }),
      db.contact.count({ where: { businessId, deletedAt: null } }),
      db.contact.groupBy({ by: ['status'], where: { businessId, deletedAt: null }, _count: true }),
      db.contact.count({ where: { businessId, deletedAt: null, createdAt: { gte: sevenDaysAgo } } }),
      db.contact.count({ where: { businessId, deletedAt: null, status: 'LEAD', updatedAt: { lt: sevenDaysAgo } } }),
      db.invoice.aggregate({ where: { businessId, deletedAt: null, status: 'PAID' }, _sum: { total: true } }),
      db.invoice.aggregate({ where: { businessId, deletedAt: null, status: { in: ['SENT', 'DRAFT'] } }, _sum: { total: true }, _count: true }),
      db.invoice.aggregate({ where: { businessId, deletedAt: null, status: { in: ['SENT', 'DRAFT'] }, dueDate: { lt: now } }, _sum: { total: true }, _count: true }),
      db.invoice.aggregate({ where: { businessId, deletedAt: null, status: 'PAID', paidAt: { gte: startOfMonth } }, _sum: { total: true } }),
      db.invoice.count({ where: { businessId, deletedAt: null, status: 'PAID' } }),
      db.booking.count({ where: { businessId, deletedAt: null, startTime: { gte: now }, status: { in: ['PENDING', 'CONFIRMED'] } } }),
      db.booking.count({ where: { businessId, deletedAt: null, status: 'COMPLETED', startTime: { gte: startOfMonth } } }),
      db.booking.count({ where: { businessId, deletedAt: null, status: 'CANCELLED', startTime: { gte: startOfMonth } } }),
      db.booking.count({ where: { businessId, deletedAt: null, startTime: { gte: startOfMonth } } }),
      db.expense.aggregate({ where: { businessId, deletedAt: null, date: { gte: startOfMonth } }, _sum: { amount: true } }),
      db.expense.groupBy({
        by: ['categoryId'],
        where: { businessId, deletedAt: null, date: { gte: startOfMonth } },
        _sum: { amount: true },
        orderBy: { _sum: { amount: 'desc' } },
        take: 5,
      }),
      db.expenseBudget.aggregate({ where: { businessId }, _sum: { amount: true } }),
      db.project.count({ where: { businessId, deletedAt: null, status: { in: ['ACTIVE', 'IN_PROGRESS'] } } }),
      db.projectTask.count({ where: { businessId, deletedAt: null, isCompleted: false, dueDate: { lt: now } } }),
      db.projectTask.count({ where: { businessId, deletedAt: null, isCompleted: true } }),
      db.projectTask.count({ where: { businessId, deletedAt: null } }),
      db.socialPost.count({ where: { businessId, deletedAt: null, status: 'DRAFT' } }),
      db.socialPost.count({ where: { businessId, deletedAt: null, status: 'SCHEDULED' } }),
      db.emailCampaign.count({ where: { businessId, deletedAt: null, status: 'DRAFT' } }),
      db.automation.count({ where: { businessId, deletedAt: null, enabled: true } }),
      db.automation.count({ where: { businessId, deletedAt: null, enabled: false } }),
      db.automation.aggregate({ where: { businessId, deletedAt: null }, _sum: { runCount: true } }),
      db.product.count({ where: { businessId, deletedAt: null, isActive: true } }),
      db.product.aggregate({ where: { businessId, deletedAt: null, isActive: true }, _avg: { price: true } }),
      db.financialAccount?.findMany
        ? db.financialAccount.findMany({
            where: { businessId, isActive: true, type: { in: ['CASH', 'BANK', 'PAYMENT_PROCESSOR'] } },
            select: {
              id: true,
              chartOfAccountId: true,
              openingBalance: true,
              currentBalance: true,
              currency: true,
            },
          })
        : db.financialAccount?.aggregate
          ? db.financialAccount.aggregate({
              where: { businessId, isActive: true, type: { in: ['CASH', 'BANK', 'PAYMENT_PROCESSOR'] } },
              _sum: { currentBalance: true },
            })
          : Promise.resolve([]),
      db.expense?.findMany
        ? db.expense.findMany({
            where: { businessId, deletedAt: null, status: 'BILL' },
            select: { amount: true, currency: true },
          })
        : db.expense.aggregate({
            where: { businessId, deletedAt: null, status: 'BILL' },
            _sum: { amount: true },
            _count: true,
          }),
      db.payrollRun?.findMany
        ? db.payrollRun.findMany({
            where: { businessId, status: { in: ['DRAFT', 'APPROVED'] } },
            select: { totalGross: true, currency: true },
          })
        : db.payrollRun?.aggregate
          ? db.payrollRun.aggregate({
              where: { businessId, status: { in: ['DRAFT', 'APPROVED'] } },
              _sum: { totalGross: true },
              _count: true,
            })
          : Promise.resolve([]),
      db.deal?.findMany
        ? db.deal.findMany({
            where: { businessId, deletedAt: null, status: 'OPEN' },
            select: { value: true, currency: true },
          })
        : db.deal?.aggregate
          ? db.deal.aggregate({
              where: { businessId, deletedAt: null, status: 'OPEN' },
              _sum: { value: true },
              _count: true,
            })
          : Promise.resolve([]),
      db.supportTicket?.count
        ? db.supportTicket.count({
            where: { businessId, deletedAt: null, status: { in: ['OPEN', 'IN_PROGRESS', 'WAITING'] } },
          })
        : Promise.resolve(0),
      db.exchangeRate?.findMany
        ? db.exchangeRate.findMany({
            where: { businessId },
            orderBy: { date: 'desc' },
            take: 100,
          })
        : Promise.resolve([] as ExchangeRateRow[]),
    ]);

    const baseCurrency = normalizeCurrencyCode(business?.currency, 'TTD');

    const statusMap: Record<string, number> = {};
    for (const s of contactsByStatus) {
      statusMap[s.status] = s._count;
    }

    const totalRevenue = paidInvoicesTotal._sum.total ?? 0;
    const outstandingAmt = outstandingInvoices._sum.total ?? 0;
    const overdueAmt = overdueInvoices._sum.total ?? 0;
    const monthlyRev = monthlyPaid._sum.total ?? 0;
    const avgInvoice = invoiceCount > 0 ? totalRevenue / invoiceCount : 0;
    const totalExpMonth = expensesMonth._sum.amount ?? 0;
    const totalBudgetAmt = totalBudget._sum.amount ?? 0;
    const budgetUtil = totalBudgetAmt > 0 ? (totalExpMonth / totalBudgetAmt) * 100 : 0;
    const utilizationRate = totalBookingsMonth > 0
      ? (completedBookingsMonth / totalBookingsMonth) * 100
      : 0;
    const taskCompletionRate = totalProjectTasks > 0
      ? (completedProjectTasks / totalProjectTasks) * 100
      : 0;

    const unconvertedTreasury: Record<string, { cash?: number; unpaidBills?: number; committedPayroll?: number }> = {};
    const unconvertedCash: Record<string, number> = {};
    type AggregateFallback = { _sum?: Record<string, unknown>; _count?: number };

    let cashBalance: number;
    if (Array.isArray(cashAccountsData)) {
      const linkedCoaIds = Array.from(
        new Set(
          cashAccountsData
            .map((a: { chartOfAccountId?: string | null }) => a.chartOfAccountId)
            .filter(Boolean) as string[],
        ),
      );
      let cashLedgerMovements: CashLedgerMovementRow[] = [];
      if (linkedCoaIds.length > 0 && db.ledgerEntry?.findMany) {
        const entries = await db.ledgerEntry.findMany({
          where: { businessId, accountId: { in: linkedCoaIds } },
          select: {
            accountId: true,
            debit: true,
            credit: true,
            currency: true,
            transaction: { select: { type: true } },
          },
        });
        cashLedgerMovements = entries.map(
          (e: {
            accountId: string;
            debit: unknown;
            credit: unknown;
            currency?: string | null;
            transaction?: { type?: string | null } | null;
          }) => ({
            accountId: e.accountId,
            debit: e.debit,
            credit: e.credit,
            currency: e.currency,
            transactionType: e.transaction?.type ?? null,
          }),
        );
      }
      cashBalance = computeNormalizedCashBalance({
        accounts: cashAccountsData,
        ledgerMovements: cashLedgerMovements,
        baseCurrency,
        rates: exchangeRates,
        failClosedOnMissingRate: false,
        unconvertedByCurrency: unconvertedCash,
      });
      for (const [cur, amt] of Object.entries(unconvertedCash)) {
        unconvertedTreasury[cur] = { ...(unconvertedTreasury[cur] ?? {}), cash: Math.round(amt * 100) / 100 };
      }
    } else {
      cashBalance = Number((cashAccountsData as AggregateFallback)?._sum?.currentBalance ?? 0);
    }

    let unpaidBillsAmount = 0;
    let unpaidBillsCount: number;
    if (Array.isArray(unpaidBillsData)) {
      unpaidBillsCount = unpaidBillsData.length;
      for (const bill of unpaidBillsData) {
        const amt = Number(bill.amount ?? 0);
        const cur = normalizeCurrencyCode(bill.currency, baseCurrency);
        const mult = resolveConversionRate(cur, baseCurrency, exchangeRates);
        if (mult != null) {
          unpaidBillsAmount += amt * mult;
        } else {
          unconvertedTreasury[cur] = {
            ...(unconvertedTreasury[cur] ?? {}),
            unpaidBills: Math.round(((unconvertedTreasury[cur]?.unpaidBills ?? 0) + amt) * 100) / 100,
          };
        }
      }
      unpaidBillsAmount = Math.round(unpaidBillsAmount * 100) / 100;
    } else {
      const agg = unpaidBillsData as AggregateFallback;
      unpaidBillsAmount = Number(agg?._sum?.amount ?? 0);
      unpaidBillsCount = Number(agg?._count ?? 0);
    }

    let committedPayrollAmount = 0;
    let committedPayrollRuns: number;
    if (Array.isArray(committedPayrollData)) {
      committedPayrollRuns = committedPayrollData.length;
      for (const run of committedPayrollData) {
        const amt = Number(run.totalGross ?? 0);
        const cur = normalizeCurrencyCode(run.currency, baseCurrency);
        const mult = resolveConversionRate(cur, baseCurrency, exchangeRates);
        if (mult != null) {
          committedPayrollAmount += amt * mult;
        } else {
          unconvertedTreasury[cur] = {
            ...(unconvertedTreasury[cur] ?? {}),
            committedPayroll: Math.round(((unconvertedTreasury[cur]?.committedPayroll ?? 0) + amt) * 100) / 100,
          };
        }
      }
      committedPayrollAmount = Math.round(committedPayrollAmount * 100) / 100;
    } else {
      const agg = committedPayrollData as AggregateFallback;
      committedPayrollAmount = Number(agg?._sum?.totalGross ?? 0);
      committedPayrollRuns = Number(agg?._count ?? 0);
    }

    let openPipelineValue = 0;
    let openDealCount: number;
    const unconvertedPipeline: Record<string, number> = {};
    if (Array.isArray(openDealsData)) {
      openDealCount = openDealsData.length;
      for (const d of openDealsData) {
        const val = Number(d.value ?? 0);
        const cur = normalizeCurrencyCode(d.currency, baseCurrency);
        const mult = resolveConversionRate(cur, baseCurrency, exchangeRates);
        if (mult != null) {
          openPipelineValue += val * mult;
        } else {
          unconvertedPipeline[cur] = Math.round(((unconvertedPipeline[cur] ?? 0) + val) * 100) / 100;
        }
      }
      openPipelineValue = Math.round(openPipelineValue * 100) / 100;
    } else {
      const agg = openDealsData as AggregateFallback;
      openPipelineValue = Number(agg?._sum?.value ?? 0);
      openDealCount = Number(agg?._count ?? 0);
    }

    const categoryNames = await this.resolveCategoryNames(businessId, expensesByCategory.map(e => e.categoryId).filter(Boolean) as string[]);
    const topCategories = expensesByCategory.map(e => ({
      name: (e.categoryId && categoryNames[e.categoryId]) || 'Uncategorized',
      amount: e._sum.amount ?? 0,
    }));

    const unmappedCurrencies = Array.from(
      new Set([...Object.keys(unconvertedTreasury), ...Object.keys(unconvertedPipeline)]),
    );

    const healthIndicators = this.computeHealthIndicators({
      overdueCount: overdueInvoices._count ?? 0,
      overdueAmt,
      staleLeadCount,
      overdueTaskCount: overdueProjectTasks,
      cancelledBookings: cancelledBookingsMonth,
      totalBookingsMonth,
      budgetUtil,
      totalExpMonth,
      monthlyRev,
      cashBalance,
      unpaidBillsAmount,
      committedPayrollAmount,
      openTicketsCount,
      unmappedCurrencies,
      baseCurrency,
    });

    const momentumSignals = [
      contactTotal > 0 ? 1 : 0,
      monthlyRev > 0 ? 1 : 0,
      (overdueInvoices._count ?? 0) === 0 ? 1 : 0,
      activeProjects > 0 ? 1 : 0,
      activeAutomations > 0 ? 1 : 0,
      recentContactCount > 0 ? 1 : 0,
      staleLeadCount === 0 ? 1 : 0,
    ];
    const momentumScore = Math.round((momentumSignals.reduce((a, b) => a + b, 0) / momentumSignals.length) * 100);

    const snapshot: BusinessGraphSnapshot = {
      businessId,
      timestamp: now,
      business: {
        name: business?.name ?? '',
        industry: business?.industry ?? null,
        archetype: business?.archetype ?? null,
        revenueModel: business?.revenueModel ?? null,
        currency: baseCurrency,
        stage: business?.businessStage ?? null,
        teamSize: business?.teamSize ?? null,
      },
      contacts: {
        total: contactTotal,
        byStatus: statusMap,
        recentCount: recentContactCount,
        staleLeadCount,
        topClients: [],
      },
      revenue: {
        totalCollected: totalRevenue,
        outstandingAmount: outstandingAmt,
        outstandingCount: outstandingInvoices._count ?? 0,
        overdueCount: overdueInvoices._count ?? 0,
        overdueAmount: overdueAmt,
        monthlyRevenue: monthlyRev,
        averageInvoiceValue: Math.round(avgInvoice * 100) / 100,
      },
      bookings: {
        upcomingCount: upcomingBookings,
        completedThisMonth: completedBookingsMonth,
        cancelledThisMonth: cancelledBookingsMonth,
        utilizationRate: Math.round(utilizationRate * 10) / 10,
      },
      expenses: {
        totalThisMonth: totalExpMonth,
        topCategories,
        budgetUtilization: Math.round(budgetUtil * 10) / 10,
      },
      projects: {
        activeCount: activeProjects,
        overdueTaskCount: overdueProjectTasks,
        completionRate: Math.round(taskCompletionRate * 10) / 10,
      },
      content: {
        draftPostCount: draftPosts,
        scheduledPostCount: scheduledPosts,
        draftCampaignCount: draftCampaigns,
      },
      automations: {
        activeCount: activeAutomations,
        disabledCount: disabledAutomations,
        totalRuns: automationRuns._sum.runCount ?? 0,
      },
      storefront: {
        activeProductCount: activeProducts,
        averagePrice: Math.round((avgProductPrice._avg.price ?? 0) * 100) / 100,
      },
      treasury: {
        cashBalance,
        unpaidBillsAmount,
        unpaidBillsCount,
        committedPayrollAmount,
        committedPayrollRuns,
        ...(Object.keys(unconvertedTreasury).length > 0
          ? { unconvertedByCurrency: unconvertedTreasury }
          : {}),
      },
      pipeline: {
        openDealCount,
        openPipelineValue,
        ...(Object.keys(unconvertedPipeline).length > 0
          ? { unconvertedByCurrency: unconvertedPipeline }
          : {}),
      },
      support: {
        openTicketCount: openTicketsCount,
      },
      momentumScore,
      healthIndicators,
      links: [],
      entities: {
        topContacts: [],
        overdueInvoices: [],
        catalogProducts: [],
      },
    };

    await this.assembleEntityLinks(businessId, snapshot);

    return snapshot;
  }

  private async assembleEntityLinks(businessId: string, snapshot: BusinessGraphSnapshot): Promise<void> {
    const db = this.prisma.client;
    const now = new Date();
    const links: GraphEntityLink[] = [];

    const [topContacts, overdueInvs, catalogProducts, contactProjects] = await Promise.all([
      db.contact.findMany({
        where: { businessId, deletedAt: null },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          status: true,
          invoices: { select: { id: true, total: true, status: true }, where: { deletedAt: null }, take: 20 },
          bookings: { select: { id: true }, where: { deletedAt: null }, take: 20 },
        },
        orderBy: { updatedAt: 'desc' },
        take: 25,
      }),
      db.invoice.findMany({
        where: { businessId, deletedAt: null, status: { in: ['SENT', 'DRAFT'] }, dueDate: { lt: now } },
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          total: true,
          dueDate: true,
          contactId: true,
          contact: { select: { firstName: true, lastName: true } },
        },
        orderBy: { dueDate: 'asc' },
        take: 20,
      }),
      db.product.findMany({
        where: { businessId, deletedAt: null },
        select: {
          id: true,
          name: true,
          price: true,
          category: true,
          isActive: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      db.project.findMany({
        where: { businessId, deletedAt: null, contactId: { not: null } },
        select: { id: true, contactId: true },
        take: 100,
      }),
    ]);

    const projectsByContact = new Map<string, string[]>();
    for (const p of contactProjects) {
      if (!p.contactId) continue;
      const list = projectsByContact.get(p.contactId) || [];
      list.push(p.id);
      projectsByContact.set(p.contactId, list);
    }

    const services = await db.service.findMany({
      where: { businessId, deletedAt: null },
      select: { id: true, name: true },
    });
    const serviceByName = new Map(services.map(s => [s.name.toLowerCase(), s.id]));

    const contactSummaries: GraphContactSummary[] = topContacts.map(c => {
      const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unknown';
      const revenue = c.invoices
        .filter(inv => inv.status === 'PAID')
        .reduce((sum, inv) => sum + (Number(inv.total) || 0), 0);
      const invoiceIds = c.invoices.map(inv => inv.id);
      const bookingIds = c.bookings.map(b => b.id);
      const projectIds = projectsByContact.get(c.id) || [];

      for (const invId of invoiceIds) {
        links.push({ fromType: 'contact', fromId: c.id, toType: 'invoice', toId: invId, relation: 'has_invoice' });
      }
      for (const bId of bookingIds) {
        links.push({ fromType: 'contact', fromId: c.id, toType: 'booking', toId: bId, relation: 'has_booking' });
      }
      for (const pId of projectIds) {
        links.push({ fromType: 'contact', fromId: c.id, toType: 'project', toId: pId, relation: 'has_project' });
      }

      return { id: c.id, name, email: c.email, status: c.status, revenue, invoiceIds, bookingIds, projectIds };
    });

    contactSummaries.sort((a, b) => b.revenue - a.revenue);
    snapshot.contacts.topClients = contactSummaries
      .filter(c => c.revenue > 0)
      .slice(0, 10)
      .map(c => ({ id: c.id, name: c.name, revenue: c.revenue }));

    const invoiceSummaries: GraphInvoiceSummary[] = overdueInvs.map(inv => {
      const contactName = inv.contact
        ? [inv.contact.firstName, inv.contact.lastName].filter(Boolean).join(' ') || null
        : null;
      if (inv.contactId) {
        links.push({ fromType: 'invoice', fromId: inv.id, toType: 'contact', toId: inv.contactId, relation: 'billed_to' });
      }
      return {
        id: inv.id,
        number: inv.invoiceNumber,
        status: inv.status,
        total: Number(inv.total) || 0,
        dueDate: inv.dueDate?.toISOString() ?? null,
        contactId: inv.contactId,
        contactName,
      };
    });

    const productSummaries: GraphProductSummary[] = catalogProducts.map(p => {
      const matchedServiceId = serviceByName.get(p.name.toLowerCase()) ?? null;
      if (matchedServiceId) {
        links.push({ fromType: 'product', fromId: p.id, toType: 'service', toId: matchedServiceId, relation: 'listed_as_service' });
      }
      return {
        id: p.id,
        name: p.name,
        price: Number(p.price) || 0,
        category: p.category,
        isActive: p.isActive,
        serviceId: matchedServiceId,
        storefrontListed: matchedServiceId !== null,
      };
    });

    snapshot.links = links;
    snapshot.entities = {
      topContacts: contactSummaries.slice(0, 15),
      overdueInvoices: invoiceSummaries,
      catalogProducts: productSummaries,
    };
  }

  private async resolveCategoryNames(businessId: string, categoryIds: string[]): Promise<Record<string, string>> {
    if (categoryIds.length === 0) return {};
    const categories = await this.prisma.client.expenseCategory.findMany({
      where: { id: { in: categoryIds }, businessId },
      select: { id: true, name: true },
    });
    const map: Record<string, string> = {};
    for (const c of categories) map[c.id] = c.name;
    return map;
  }

  private computeHealthIndicators(data: {
    overdueCount: number;
    overdueAmt: number;
    staleLeadCount: number;
    overdueTaskCount: number;
    cancelledBookings: number;
    totalBookingsMonth: number;
    budgetUtil: number;
    totalExpMonth: number;
    monthlyRev: number;
    cashBalance?: number;
    unpaidBillsAmount?: number;
    committedPayrollAmount?: number;
    openTicketsCount?: number;
    unmappedCurrencies?: string[];
    baseCurrency?: string;
  }): BusinessGraphSnapshot['healthIndicators'] {
    const indicators: BusinessGraphSnapshot['healthIndicators'] = [];

    if (data.overdueCount > 0) {
      indicators.push({
        area: 'revenue',
        status: data.overdueCount > 5 ? 'critical' : 'warning',
        detail: `${data.overdueCount} overdue invoice(s) totaling $${data.overdueAmt.toLocaleString()}`,
      });
    } else {
      indicators.push({ area: 'revenue', status: 'good', detail: 'No overdue invoices' });
    }

    if (data.staleLeadCount > 0) {
      indicators.push({
        area: 'crm',
        status: data.staleLeadCount > 10 ? 'critical' : 'warning',
        detail: `${data.staleLeadCount} stale lead(s) with no activity in 7+ days`,
      });
    }

    if (data.overdueTaskCount > 0) {
      indicators.push({
        area: 'projects',
        status: data.overdueTaskCount > 5 ? 'critical' : 'warning',
        detail: `${data.overdueTaskCount} overdue project task(s)`,
      });
    }

    if (data.totalBookingsMonth > 0) {
      const cancelRate = (data.cancelledBookings / data.totalBookingsMonth) * 100;
      if (cancelRate > 20) {
        indicators.push({
          area: 'bookings',
          status: 'warning',
          detail: `${cancelRate.toFixed(0)}% cancellation rate this month`,
        });
      }
    }

    if (data.budgetUtil > 90) {
      indicators.push({
        area: 'expenses',
        status: data.budgetUtil > 100 ? 'critical' : 'warning',
        detail: `Budget utilization at ${data.budgetUtil.toFixed(0)}%`,
      });
    }

    if (data.monthlyRev > 0 && data.totalExpMonth > data.monthlyRev * 0.9) {
      indicators.push({
        area: 'profitability',
        status: data.totalExpMonth > data.monthlyRev ? 'critical' : 'warning',
        detail: `Expenses consuming ${((data.totalExpMonth / data.monthlyRev) * 100).toFixed(0)}% of revenue`,
      });
    }

    const obligations = (data.unpaidBillsAmount ?? 0) + (data.committedPayrollAmount ?? 0);
    if (obligations > 0 && data.cashBalance !== undefined && obligations > data.cashBalance) {
      indicators.push({
        area: 'treasury',
        status: 'critical',
        detail: `Committed bills and payroll ($${obligations.toLocaleString()}) exceed available cash ($${data.cashBalance.toLocaleString()})`,
      });
    }

    if (data.unmappedCurrencies && data.unmappedCurrencies.length > 0) {
      indicators.push({
        area: 'treasury',
        status: 'warning',
        detail: `Unconverted foreign currency balances (${data.unmappedCurrencies.join(', ')}) excluded from ${data.baseCurrency ?? 'base'} totals — configure exchange rates`,
      });
    }

    return indicators;
  }

  buildContextString(snapshot: BusinessGraphSnapshot): string {
    const b = snapshot.business;
    const parts: string[] = [
      `Business: ${b.name}`,
      b.industry ? `Industry: ${b.industry}` : null,
      b.archetype ? `Type: ${b.archetype}` : null,
      `Currency: ${b.currency}`,
      `Contacts: ${snapshot.contacts.total} total (${snapshot.contacts.staleLeadCount} stale leads)`,
      `Revenue: $${snapshot.revenue.totalCollected.toLocaleString()} collected, $${snapshot.revenue.monthlyRevenue.toLocaleString()} this month`,
      `Outstanding: $${snapshot.revenue.outstandingAmount.toLocaleString()} (${snapshot.revenue.outstandingCount} invoices, ${snapshot.revenue.overdueCount} overdue)`,
      snapshot.treasury
        ? `Cash & Obligations: $${snapshot.treasury.cashBalance.toLocaleString()} cash, $${snapshot.treasury.unpaidBillsAmount.toLocaleString()} unpaid bills (${snapshot.treasury.unpaidBillsCount}), $${snapshot.treasury.committedPayrollAmount.toLocaleString()} committed payroll (${snapshot.treasury.committedPayrollRuns} runs)`
        : null,
      snapshot.pipeline
        ? `Pipeline: ${snapshot.pipeline.openDealCount} open deals ($${snapshot.pipeline.openPipelineValue.toLocaleString()})`
        : null,
      `Bookings: ${snapshot.bookings.upcomingCount} upcoming, ${snapshot.bookings.completedThisMonth} completed this month`,
      `Expenses: $${snapshot.expenses.totalThisMonth.toLocaleString()} this month`,
      `Projects: ${snapshot.projects.activeCount} active, ${snapshot.projects.overdueTaskCount} overdue tasks`,
      snapshot.support ? `Support: ${snapshot.support.openTicketCount} open tickets` : null,
      `Content: ${snapshot.content.draftPostCount} draft posts, ${snapshot.content.scheduledPostCount} scheduled, ${snapshot.content.draftCampaignCount} draft campaigns`,
      `Automations: ${snapshot.automations.activeCount} active flows`,
      `Store: ${snapshot.storefront.activeProductCount} active products`,
      `Momentum: ${snapshot.momentumScore}/100`,
    ].filter(Boolean) as string[];

    if (snapshot.healthIndicators.length > 0) {
      parts.push('Health Alerts: ' + snapshot.healthIndicators
        .filter(h => h.status !== 'good')
        .map(h => `[${h.status.toUpperCase()}] ${h.detail}`)
        .join('; '));
    }

    return parts.join('\n');
  }
}
