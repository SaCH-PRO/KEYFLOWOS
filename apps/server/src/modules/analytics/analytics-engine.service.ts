import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface SnapshotInput {
  businessId: string;
  snapshotType: 'daily' | 'weekly' | 'monthly';
  snapshotDate: Date;
}

@Injectable()
export class AnalyticsEngineService {
  private readonly logger = new Logger(AnalyticsEngineService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async computeSnapshot(input: SnapshotInput) {
    const { businessId, snapshotType, snapshotDate } = input;

    const since = snapshotType === 'daily'
      ? new Date(snapshotDate.getTime() - 24 * 60 * 60 * 1000)
      : snapshotType === 'weekly'
        ? new Date(snapshotDate.getTime() - 7 * 24 * 60 * 60 * 1000)
        : new Date(snapshotDate.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      revenueAgg,
      invoiceStats,
      contactStats,
      bookingStats,
      quoteStats,
      dealStats,
      flowStats,
      messageStats,
      storefrontStats,
    ] = await Promise.all([
      this.aggregateRevenue(businessId, since),
      this.aggregateInvoices(businessId),
      this.aggregateContacts(businessId, since),
      this.aggregateBookings(businessId),
      this.aggregateQuotes(businessId),
      this.aggregateDeals(businessId),
      this.aggregateFlows(businessId),
      this.aggregateMessages(businessId, since),
      this.aggregateStorefront(businessId, since),
    ]);

    const healthScore = this.calculateHealthScore({
      collectionRate: invoiceStats.collectionRate,
      leadConversionRate: contactStats.leadConversionRate,
      quoteAcceptanceRate: quoteStats.quoteAcceptanceRate,
      flowSuccessRate: flowStats.successRate,
      responseRate: messageStats.responseRate,
    });

    const momentumScore = this.calculateMomentumScore({
      newContacts: contactStats.newContacts,
      revenueGrowth: revenueAgg.growthRate,
      flowRuns: flowStats.totalRuns,
      messagesReceived: messageStats.received,
    });

    const snapshot = await this.prisma.client.businessSnapshot.upsert({
      where: {
        businessId_snapshotType_snapshotDate: {
          businessId,
          snapshotType,
          snapshotDate,
        },
      },
      update: {
        totalRevenue: revenueAgg.totalRevenue,
        invoiceCount: invoiceStats.total,
        paidInvoiceCount: invoiceStats.paid,
        overdueInvoiceCount: invoiceStats.overdue,
        totalOverdueAmount: invoiceStats.overdueAmount,
        averageInvoiceValue: invoiceStats.averageValue,
        collectionRate: invoiceStats.collectionRate,
        totalContacts: contactStats.total,
        newContacts: contactStats.newContacts,
        activeLeads: contactStats.activeLeads,
        leadConversionRate: contactStats.leadConversionRate,
        customerRetentionRate: contactStats.retentionRate,
        totalBookings: bookingStats.total,
        upcomingBookings: bookingStats.upcoming,
        completedBookings: bookingStats.completed,
        noShowRate: bookingStats.noShowRate,
        totalQuotes: quoteStats.total,
        acceptedQuotes: quoteStats.accepted,
        quoteAcceptanceRate: quoteStats.quoteAcceptanceRate,
        totalDeals: dealStats.total,
        openDealsValue: dealStats.openValue,
        activeFlows: flowStats.active,
        flowRuns: flowStats.totalRuns,
        flowSuccessRate: flowStats.successRate,
        messagesSent: messageStats.sent,
        messagesReceived: messageStats.received,
        responseRate: messageStats.responseRate,
        averageResponseTimeMinutes: messageStats.avgResponseTime,
        storefrontVisits: storefrontStats.visits,
        ordersReceived: storefrontStats.orders,
        cartAbandonmentRate: storefrontStats.abandonmentRate,
        healthScore,
        momentumScore,
        growthRate: revenueAgg.growthRate,
      },
      create: {
        businessId,
        snapshotType,
        snapshotDate,
        totalRevenue: revenueAgg.totalRevenue,
        invoiceCount: invoiceStats.total,
        paidInvoiceCount: invoiceStats.paid,
        overdueInvoiceCount: invoiceStats.overdue,
        totalOverdueAmount: invoiceStats.overdueAmount,
        averageInvoiceValue: invoiceStats.averageValue,
        collectionRate: invoiceStats.collectionRate,
        totalContacts: contactStats.total,
        newContacts: contactStats.newContacts,
        activeLeads: contactStats.activeLeads,
        leadConversionRate: contactStats.leadConversionRate,
        customerRetentionRate: contactStats.retentionRate,
        totalBookings: bookingStats.total,
        upcomingBookings: bookingStats.upcoming,
        completedBookings: bookingStats.completed,
        noShowRate: bookingStats.noShowRate,
        totalQuotes: quoteStats.total,
        acceptedQuotes: quoteStats.accepted,
        quoteAcceptanceRate: quoteStats.quoteAcceptanceRate,
        totalDeals: dealStats.total,
        openDealsValue: dealStats.openValue,
        activeFlows: flowStats.active,
        flowRuns: flowStats.totalRuns,
        flowSuccessRate: flowStats.successRate,
        messagesSent: messageStats.sent,
        messagesReceived: messageStats.received,
        responseRate: messageStats.responseRate,
        averageResponseTimeMinutes: messageStats.avgResponseTime,
        storefrontVisits: storefrontStats.visits,
        ordersReceived: storefrontStats.orders,
        cartAbandonmentRate: storefrontStats.abandonmentRate,
        healthScore,
        momentumScore,
        growthRate: revenueAgg.growthRate,
      },
    });

    return snapshot;
  }

  private async aggregateRevenue(businessId: string, since: Date) {
    const invoices = await this.prisma.client.invoice.findMany({
      where: { businessId, deletedAt: null, createdAt: { gte: since } },
      select: { total: true, status: true, currency: true },
    });

    const totalRevenue = invoices
      .filter((i) => i.status === 'PAID')
      .reduce((sum, i) => sum + Number(i.total ?? 0), 0);

    // Compare with previous period for growth rate
    const prevSince = new Date(since.getTime() - (since.getTime() - Date.now()));
    const prevInvoices = await this.prisma.client.invoice.findMany({
      where: { businessId, deletedAt: null, createdAt: { gte: prevSince, lt: since } },
      select: { total: true, status: true },
    });
    const prevRevenue = prevInvoices
      .filter((i) => i.status === 'PAID')
      .reduce((sum, i) => sum + Number(i.total ?? 0), 0);

    const growthRate = prevRevenue > 0
      ? ((totalRevenue - prevRevenue) / prevRevenue) * 100
      : 0;

    return { totalRevenue, growthRate: Math.round(growthRate * 100) / 100 };
  }

  private async aggregateInvoices(businessId: string) {
    const [total, paid, overdue, overdueAmount, avgValue] = await Promise.all([
      this.prisma.client.invoice.count({ where: { businessId, deletedAt: null } }),
      this.prisma.client.invoice.count({ where: { businessId, deletedAt: null, status: 'PAID' } }),
      this.prisma.client.invoice.count({ where: { businessId, deletedAt: null, status: 'OVERDUE' } }),
      this.prisma.client.invoice.aggregate({
        where: { businessId, deletedAt: null, status: 'OVERDUE' },
        _sum: { total: true },
      }).then((r) => r._sum.total ?? 0),
      this.prisma.client.invoice.aggregate({
        where: { businessId, deletedAt: null },
        _avg: { total: true },
      }).then((r) => r._avg.total ?? 0),
    ]);

    const collectionRate = total > 0 ? (paid / total) * 100 : 0;
    return { total, paid, overdue, overdueAmount: Number(overdueAmount), averageValue: Number(avgValue), collectionRate: Math.round(collectionRate * 100) / 100 };
  }

  private async aggregateContacts(businessId: string, since: Date) {
    const [total, newContacts, activeLeads] = await Promise.all([
      this.prisma.client.contact.count({ where: { businessId, deletedAt: null } }),
      this.prisma.client.contact.count({ where: { businessId, deletedAt: null, createdAt: { gte: since } } }),
      this.prisma.client.contact.count({ where: { businessId, deletedAt: null, status: 'LEAD' } }),
    ]);

    // Simplified conversion rate: contacts with bookings / total contacts
    const contactsWithBookings = await this.prisma.client.contact.count({
      where: {
        businessId,
        deletedAt: null,
        bookings: { some: {} },
      },
    });
    const leadConversionRate = total > 0 ? (contactsWithBookings / total) * 100 : 0;

    return { total, newContacts, activeLeads, leadConversionRate: Math.round(leadConversionRate * 100) / 100, retentionRate: 0 };
  }

  private async aggregateBookings(businessId: string) {
    const [total, upcoming, completed, noShows] = await Promise.all([
      this.prisma.client.booking.count({ where: { businessId, deletedAt: null } }),
      this.prisma.client.booking.count({ where: { businessId, deletedAt: null, status: { in: ['CONFIRMED', 'PENDING'] }, startTime: { gte: new Date() } } }),
      this.prisma.client.booking.count({ where: { businessId, deletedAt: null, status: 'COMPLETED' } }),
      this.prisma.client.booking.count({ where: { businessId, deletedAt: null, status: 'NO_SHOW' } }),
    ]);
    const noShowRate = total > 0 ? (noShows / total) * 100 : 0;
    return { total, upcoming, completed, noShowRate: Math.round(noShowRate * 100) / 100 };
  }

  private async aggregateQuotes(businessId: string) {
    const [total, accepted] = await Promise.all([
      this.prisma.client.quote.count({ where: { businessId, deletedAt: null } }),
      this.prisma.client.quote.count({ where: { businessId, deletedAt: null, status: 'ACCEPTED' } }),
    ]);
    const quoteAcceptanceRate = total > 0 ? (accepted / total) * 100 : 0;
    return { total, accepted, quoteAcceptanceRate: Math.round(quoteAcceptanceRate * 100) / 100 };
  }

  private async aggregateDeals(businessId: string) {
    const [total, openValue] = await Promise.all([
      this.prisma.client.deal.count({ where: { businessId, deletedAt: null } }),
      this.prisma.client.deal.aggregate({
        where: { businessId, deletedAt: null, stage: { category: 'OPEN' } },
        _sum: { value: true },
      }).then((r) => r._sum.value ?? 0),
    ]);
    return { total, openValue: Number(openValue) };
  }

  private async aggregateFlows(businessId: string) {
    const [active, totalRuns, completedRuns] = await Promise.all([
      this.prisma.client.automationFlow.count({ where: { businessId, deletedAt: null, status: 'ACTIVE' } }),
      this.prisma.client.flowRun.count({ where: { businessId } }),
      this.prisma.client.flowRun.count({ where: { businessId, status: 'COMPLETED' } }),
    ]);
    const successRate = totalRuns > 0 ? (completedRuns / totalRuns) * 100 : 0;
    return { active, totalRuns, successRate: Math.round(successRate * 100) / 100 };
  }

  private async aggregateMessages(businessId: string, since: Date) {
    const [sent, received] = await Promise.all([
      this.prisma.client.conversationMessage.count({ where: { thread: { businessId }, createdAt: { gte: since }, direction: 'OUTBOUND' } }),
      this.prisma.client.conversationMessage.count({ where: { thread: { businessId }, createdAt: { gte: since }, direction: 'INBOUND' } }),
    ]);
    const responseRate = received > 0 ? Math.min(100, (sent / received) * 100) : 0;
    return { sent, received, responseRate: Math.round(responseRate * 100) / 100, avgResponseTime: 0 };
  }

  private async aggregateStorefront(businessId: string, since: Date) {
    // Placeholder: real storefront analytics would come from analytics events
    return { visits: 0, orders: 0, abandonmentRate: 0 };
  }

  private calculateHealthScore(metrics: {
    collectionRate?: number;
    leadConversionRate?: number;
    quoteAcceptanceRate?: number;
    flowSuccessRate?: number;
    responseRate?: number;
  }): number {
    const weights = {
      collectionRate: 0.25,
      leadConversionRate: 0.2,
      quoteAcceptanceRate: 0.2,
      flowSuccessRate: 0.15,
      responseRate: 0.2,
    };

    let score = 0;
    let totalWeight = 0;

    for (const [key, weight] of Object.entries(weights)) {
      const value = metrics[key as keyof typeof metrics];
      if (value !== undefined && value !== null) {
        score += Math.min(100, Math.max(0, value)) * weight;
        totalWeight += weight;
      }
    }

    return totalWeight > 0 ? Math.round(score / totalWeight) : 50;
  }

  private calculateMomentumScore(metrics: {
    newContacts?: number;
    revenueGrowth?: number;
    flowRuns?: number;
    messagesReceived?: number;
  }): number {
    let score = 50;
    if (metrics.newContacts && metrics.newContacts > 0) score += 10;
    if (metrics.revenueGrowth && metrics.revenueGrowth > 0) score += 15;
    if (metrics.flowRuns && metrics.flowRuns > 0) score += 10;
    if (metrics.messagesReceived && metrics.messagesReceived > 0) score += 10;
    return Math.min(100, score);
  }

  async getOverview(businessId: string, days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const [
      latestSnapshot,
      totalContacts,
      totalInvoices,
      totalBookings,
      totalFlows,
      recentEvents,
      insights,
    ] = await Promise.all([
      this.getLatestSnapshot(businessId),
      this.prisma.client.contact.count({ where: { businessId, deletedAt: null } }),
      this.prisma.client.invoice.count({ where: { businessId, deletedAt: null } }),
      this.prisma.client.booking.count({ where: { businessId, deletedAt: null } }),
      this.prisma.client.automationFlow.count({ where: { businessId, deletedAt: null } }),
      this.prisma.client.businessEvent.count({ where: { businessId, createdAt: { gte: since } } }),
      this.prisma.client.growthInsight.findMany({
        where: { businessId, status: { not: 'dismissed' } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);

    return {
      snapshot: latestSnapshot,
      totals: { totalContacts, totalInvoices, totalBookings, totalFlows, recentEvents },
      insights,
    };
  }

  async getSnapshots(businessId: string, type: string, days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    return this.prisma.client.businessSnapshot.findMany({
      where: { businessId, snapshotType: type, snapshotDate: { gte: since } },
      orderBy: { snapshotDate: 'asc' },
    });
  }

  async getAvailableMetrics(businessId: string) {
    return [
      { key: 'totalRevenue', label: 'Total Revenue', type: 'currency' },
      { key: 'invoiceCount', label: 'Invoices', type: 'count' },
      { key: 'collectionRate', label: 'Collection Rate', type: 'percentage' },
      { key: 'totalContacts', label: 'Contacts', type: 'count' },
      { key: 'newContacts', label: 'New Contacts', type: 'count' },
      { key: 'activeLeads', label: 'Active Leads', type: 'count' },
      { key: 'leadConversionRate', label: 'Lead Conversion', type: 'percentage' },
      { key: 'totalBookings', label: 'Bookings', type: 'count' },
      { key: 'completedBookings', label: 'Completed Bookings', type: 'count' },
      { key: 'noShowRate', label: 'No-Show Rate', type: 'percentage' },
      { key: 'totalQuotes', label: 'Quotes', type: 'count' },
      { key: 'quoteAcceptanceRate', label: 'Quote Acceptance', type: 'percentage' },
      { key: 'activeFlows', label: 'Active Flows', type: 'count' },
      { key: 'flowSuccessRate', label: 'Flow Success', type: 'percentage' },
      { key: 'messagesReceived', label: 'Messages Received', type: 'count' },
      { key: 'responseRate', label: 'Response Rate', type: 'percentage' },
      { key: 'healthScore', label: 'Health Score', type: 'score' },
      { key: 'momentumScore', label: 'Momentum Score', type: 'score' },
      { key: 'growthRate', label: 'Growth Rate', type: 'percentage' },
    ];
  }

  async generateDailySnapshots() {
    const businesses = await this.prisma.client.business.findMany({
      select: { id: true },
    });

    let count = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const business of businesses) {
      try {
        await this.computeSnapshot({
          businessId: business.id,
          snapshotType: 'daily',
          snapshotDate: today,
        });
        count++;
      } catch (error) {
        this.logger.error(`Failed daily snapshot for ${business.id}`, error);
      }
    }

    return { count };
  }

  async generateWeeklySnapshots() {
    const businesses = await this.prisma.client.business.findMany({
      select: { id: true },
    });

    let count = 0;
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);

    for (const business of businesses) {
      try {
        await this.computeSnapshot({
          businessId: business.id,
          snapshotType: 'weekly',
          snapshotDate: weekStart,
        });
        count++;
      } catch (error) {
        this.logger.error(`Failed weekly snapshot for ${business.id}`, error);
      }
    }

    return { count };
  }

  async generateMonthlySnapshots() {
    const businesses = await this.prisma.client.business.findMany({
      select: { id: true },
    });

    let count = 0;
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    for (const business of businesses) {
      try {
        await this.computeSnapshot({
          businessId: business.id,
          snapshotType: 'monthly',
          snapshotDate: monthStart,
        });
        count++;
      } catch (error) {
        this.logger.error(`Failed monthly snapshot for ${business.id}`, error);
      }
    }

    return { count };
  }

  async getTrends(businessId: string, metric: string, days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const snapshots = await this.prisma.client.businessSnapshot.findMany({
      where: { businessId, snapshotType: 'daily', snapshotDate: { gte: since } },
      orderBy: { snapshotDate: 'asc' },
      select: { snapshotDate: true, [metric]: true },
    });

    return snapshots.map((s) => ({
      date: (s.snapshotDate as Date).toISOString(),
      value: (s as any)[metric] ?? 0,
    }));
  }

  async getLatestSnapshot(businessId: string) {
    return this.prisma.client.businessSnapshot.findFirst({
      where: { businessId },
      orderBy: { snapshotDate: 'desc' },
    });
  }
}
