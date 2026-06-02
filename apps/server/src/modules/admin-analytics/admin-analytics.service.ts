import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class AdminAnalyticsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getPlatformOverview() {
    const [
      totalUsers,
      totalBusinesses,
      businessesThisWeek,
      activeUsersToday,
      totalCommands,
      totalEvents,
      totalFeedback,
    ] = await Promise.all([
      this.prisma.client.user.count(),
      this.prisma.client.business.count(),
      this.prisma.client.business.count({
        where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      }),
      this.prisma.client.productEvent.groupBy({
        by: ['userId'],
        where: { occurredAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        _count: { userId: true },
      }).then((r) => r.length),
      this.prisma.client.commandItem.count(),
      this.prisma.client.productEvent.count(),
      this.prisma.client.userFeedback.count(),
    ]);

    return {
      totalUsers,
      totalBusinesses,
      businessesThisWeek,
      activeUsersToday,
      totalCommands,
      totalEvents,
      totalFeedback,
    };
  }

  async getActivationFunnel(days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const [
      contactCreated,
      productCreated,
      invoiceCreated,
      quoteCreated,
      paymentReceived,
      bookingCreated,
      storefrontPublished,
      keyCommandUsed,
      integrationConnected,
    ] = await Promise.all([
      this.prisma.client.productEvent.count({ where: { eventName: 'contact.created', occurredAt: { gte: since } } }),
      this.prisma.client.productEvent.count({ where: { eventName: 'product.created', occurredAt: { gte: since } } }),
      this.prisma.client.productEvent.count({ where: { eventName: 'invoice.created', occurredAt: { gte: since } } }),
      this.prisma.client.productEvent.count({ where: { eventName: 'quote.created', occurredAt: { gte: since } } }),
      this.prisma.client.productEvent.count({ where: { eventName: 'payment.received', occurredAt: { gte: since } } }),
      this.prisma.client.productEvent.count({ where: { eventName: 'booking.created', occurredAt: { gte: since } } }),
      this.prisma.client.productEvent.count({ where: { eventName: 'storefront.published', occurredAt: { gte: since } } }),
      this.prisma.client.productEvent.count({ where: { eventName: 'key.command_used', occurredAt: { gte: since } } }),
      this.prisma.client.productEvent.count({ where: { eventName: 'integration.connected', occurredAt: { gte: since } } }),
    ]);

    return {
      days,
      milestones: {
        contactCreated,
        productCreated,
        invoiceCreated,
        quoteCreated,
        paymentReceived,
        bookingCreated,
        storefrontPublished,
        keyCommandUsed,
        integrationConnected,
      },
    };
  }

  async getIntegrationHealth() {
    const [connections, needsAttention, recentSyncs, providers] = await Promise.all([
      this.prisma.client.integrationConnection.count(),
      this.prisma.client.integrationConnection.count({
        where: { status: { in: ['ERROR', 'NEEDS_ATTENTION'] } },
      }),
      this.prisma.client.integrationSyncRun.findMany({
        orderBy: { startedAt: 'desc' },
        take: 20,
      }),
      this.prisma.client.integrationProvider.findMany({ where: { status: 'ACTIVE' } }),
    ]);

    return {
      totalConnections: connections,
      needsAttention,
      healthy: connections - needsAttention,
      totalProviders: providers.length,
      recentSyncs,
    };
  }

  async getFeatureUsage(days = 7) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const usage = await this.prisma.client.featureUsageDaily.findMany({
      where: { day: { gte: since } },
      orderBy: { day: 'desc' },
    });

    return { days, usage };
  }

  async getKeyQuality(days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const [signals, byType, avgRating] = await Promise.all([
      this.prisma.client.aiQualitySignal.count({ where: { createdAt: { gte: since } } }),
      this.prisma.client.aiQualitySignal.groupBy({
        by: ['signalType'],
        where: { createdAt: { gte: since } },
        _count: { id: true },
      }),
      this.prisma.client.aiQualitySignal.aggregate({
        _avg: { rating: true },
        where: { createdAt: { gte: since } },
      }),
    ]);

    return {
      days,
      totalSignals: signals,
      averageRating: avgRating._avg.rating ?? 0,
      byType: byType.map((t) => ({ type: t.signalType, count: t._count.id })),
    };
  }

  async getFeedbackInbox(limit = 50, offset = 0) {
    const [items, total] = await Promise.all([
      this.prisma.client.userFeedback.findMany({
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.client.userFeedback.count(),
    ]);

    return { items, total };
  }

  async getRecentEvents(limit = 50) {
    return this.prisma.client.productEvent.findMany({
      orderBy: { occurredAt: 'desc' },
      take: limit,
    });
  }

  async getProductRoadmapInsights(status?: string) {
    const where = status ? { status } : {};
    return this.prisma.client.productRoadmapInsight.findMany({
      where,
      orderBy: { opportunityScore: 'desc' },
    });
  }
}
