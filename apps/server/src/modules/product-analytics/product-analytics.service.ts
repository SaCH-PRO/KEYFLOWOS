import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class ProductAnalyticsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async ingestEvent(input: {
    userId?: string;
    businessId?: string;
    sessionId?: string;
    eventName: string;
    module?: string;
    entityType?: string;
    entityId?: string;
    properties?: Record<string, unknown>;
  }) {
    return this.prisma.client.productEvent.create({
      data: {
        userId: input.userId ?? null,
        businessId: input.businessId ?? null,
        sessionId: input.sessionId ?? null,
        eventName: input.eventName,
        module: input.module ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        properties: input.properties ?? {},
      },
    });
  }

  async ingestEventsBatch(inputs: Array<{
    userId?: string;
    businessId?: string;
    sessionId?: string;
    eventName: string;
    module?: string;
    entityType?: string;
    entityId?: string;
    properties?: Record<string, unknown>;
  }>) {
    return this.prisma.client.productEvent.createMany({
      data: inputs.map((i) => ({
        userId: i.userId ?? null,
        businessId: i.businessId ?? null,
        sessionId: i.sessionId ?? null,
        eventName: i.eventName,
        module: i.module ?? null,
        entityType: i.entityType ?? null,
        entityId: i.entityId ?? null,
        properties: i.properties ?? {},
      })),
    });
  }

  async createFeedback(input: {
    userId?: string;
    businessId?: string;
    module?: string;
    page?: string;
    feedbackType: string;
    rating?: number;
    message?: string;
    context?: Record<string, unknown>;
  }) {
    return this.prisma.client.userFeedback.create({
      data: {
        userId: input.userId ?? null,
        businessId: input.businessId ?? null,
        module: input.module ?? null,
        page: input.page ?? null,
        feedbackType: input.feedbackType,
        rating: input.rating ?? null,
        message: input.message ?? null,
        context: input.context ?? {},
      },
    });
  }

  async listFeedback(filters: {
    businessId?: string;
    module?: string;
    feedbackType?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }) {
    const where: Record<string, unknown> = {};
    if (filters.businessId) where.businessId = filters.businessId;
    if (filters.module) where.module = filters.module;
    if (filters.feedbackType) where.feedbackType = filters.feedbackType;
    if (filters.status) where.status = filters.status;

    const [items, total] = await Promise.all([
      this.prisma.client.userFeedback.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: filters.limit ?? 50,
        skip: filters.offset ?? 0,
      }),
      this.prisma.client.userFeedback.count({ where }),
    ]);

    return { items, total };
  }

  async createAiQualitySignal(input: {
    userId?: string;
    businessId?: string;
    commandId?: string;
    module?: string;
    signalType: string;
    rating?: number;
    comment?: string;
    context?: Record<string, unknown>;
  }) {
    return this.prisma.client.aiQualitySignal.create({
      data: {
        userId: input.userId ?? null,
        businessId: input.businessId ?? null,
        commandId: input.commandId ?? null,
        module: input.module ?? null,
        signalType: input.signalType,
        rating: input.rating ?? null,
        comment: input.comment ?? null,
        context: input.context ?? {},
      },
    });
  }

  async aggregateDailyUsage(day: Date) {
    const start = new Date(day);
    start.setHours(0, 0, 0, 0);
    const end = new Date(day);
    end.setHours(23, 59, 59, 999);

    const rows = await this.prisma.client.productEvent.groupBy({
      by: ['module', 'eventName'],
      where: { occurredAt: { gte: start, lte: end } },
      _count: { id: true },
    });

    const results = [];
    for (const r of rows) {
      const module = r.module ?? 'unknown';
      const featureKey = r.eventName;
      const users = await this.prisma.client.productEvent.groupBy({
        by: ['userId'],
        where: { module: r.module, eventName: r.eventName, occurredAt: { gte: start, lte: end } },
        _count: { id: true },
      });
      const businesses = await this.prisma.client.productEvent.groupBy({
        by: ['businessId'],
        where: { module: r.module, eventName: r.eventName, occurredAt: { gte: start, lte: end } },
        _count: { id: true },
      });

      results.push(
        this.prisma.client.featureUsageDaily.upsert({
          where: {
            day_module_featureKey: {
              day: start,
              module,
              featureKey,
            },
          },
          update: {
            eventCount: r._count.id,
            userCount: users.length,
            businessCount: businesses.length,
          },
          create: {
            day: start,
            module,
            featureKey,
            eventCount: r._count.id,
            userCount: users.length,
            businessCount: businesses.length,
          },
        }),
      );
    }

    await Promise.all(results);
    return { aggregated: results.length };
  }

  async getActivationFunnel(businessId?: string, days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const where = businessId ? { businessId, occurredAt: { gte: since } } : { occurredAt: { gte: since } };

    const [contactCreated, productCreated, invoiceCreated, quoteCreated, paymentReceived, storefrontPublished, keyCommandUsed, integrationConnected] = await Promise.all([
      this.prisma.client.productEvent.count({ where: { ...where, eventName: 'contact.created' } }),
      this.prisma.client.productEvent.count({ where: { ...where, eventName: 'product.created' } }),
      this.prisma.client.productEvent.count({ where: { ...where, eventName: 'invoice.created' } }),
      this.prisma.client.productEvent.count({ where: { ...where, eventName: 'quote.created' } }),
      this.prisma.client.productEvent.count({ where: { ...where, eventName: 'payment.received' } }),
      this.prisma.client.productEvent.count({ where: { ...where, eventName: 'storefront.published' } }),
      this.prisma.client.productEvent.count({ where: { ...where, eventName: 'key.command_used' } }),
      this.prisma.client.productEvent.count({ where: { ...where, eventName: 'integration.connected' } }),
    ]);

    return {
      days,
      businessId: businessId ?? 'all',
      milestones: {
        contactCreated,
        productCreated,
        invoiceCreated,
        quoteCreated,
        paymentReceived,
        storefrontPublished,
        keyCommandUsed,
        integrationConnected,
      },
    };
  }
}
