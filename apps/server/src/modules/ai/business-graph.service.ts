import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

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
  momentumScore: number;
  healthIndicators: Array<{ area: string; status: 'good' | 'warning' | 'critical'; detail: string }>;
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
    ]);

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

    const categoryNames = await this.resolveCategoryNames(businessId, expensesByCategory.map(e => e.categoryId).filter(Boolean) as string[]);
    const topCategories = expensesByCategory.map(e => ({
      name: (e.categoryId && categoryNames[e.categoryId]) || 'Uncategorized',
      amount: e._sum.amount ?? 0,
    }));

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

    return {
      businessId,
      timestamp: now,
      business: {
        name: business?.name ?? '',
        industry: business?.industry ?? null,
        archetype: business?.archetype ?? null,
        revenueModel: business?.revenueModel ?? null,
        currency: business?.currency ?? 'TTD',
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
      momentumScore,
      healthIndicators,
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
      `Bookings: ${snapshot.bookings.upcomingCount} upcoming, ${snapshot.bookings.completedThisMonth} completed this month`,
      `Expenses: $${snapshot.expenses.totalThisMonth.toLocaleString()} this month`,
      `Projects: ${snapshot.projects.activeCount} active, ${snapshot.projects.overdueTaskCount} overdue tasks`,
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
