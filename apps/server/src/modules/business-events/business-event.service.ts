import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  CreateBusinessEventInput,
  AuditFilter,
  KpiStats,
  ActorType,
} from './dto/create-business-event.dto';

@Injectable()
export class BusinessEventService {
  private readonly logger = new Logger(BusinessEventService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  /**
   * Emit a single business event. Fire-and-forget: never throws.
   * This is the primary method — every mutation should call this.
   */
  async emit(input: CreateBusinessEventInput): Promise<void> {
    try {
      await this.prisma.client.businessEvent.create({
        data: {
          businessId: input.businessId,
          branchId: input.branchId ?? null,
          eventType: input.eventType,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          actorType: input.actorType,
          actorId: input.actorId,
          action: input.action,
          before: input.before ?? undefined,
          after: input.after ?? undefined,
          evidenceIds: input.evidenceIds ?? [],
          messageIds: input.messageIds ?? [],
          approvalId: input.approvalId ?? null,
          riskScore: input.riskScore ?? null,
          source: input.source,
          metadata: input.metadata ?? undefined,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to emit business event: ${(err as Error).message}`,
        { input: JSON.stringify(input).slice(0, 500) },
      );
      // Never throw — audit failure should not break the business operation
    }
  }

  /**
   * Emit multiple events in a single transaction. Use for bulk operations.
   */
  async emitBatch(inputs: CreateBusinessEventInput[]): Promise<void> {
    if (inputs.length === 0) return;
    try {
      await this.prisma.client.$transaction(
        inputs.map((input) =>
          this.prisma.client.businessEvent.create({
            data: {
              businessId: input.businessId,
              branchId: input.branchId ?? null,
              eventType: input.eventType,
              subjectType: input.subjectType,
              subjectId: input.subjectId,
              actorType: input.actorType,
              actorId: input.actorId,
              action: input.action,
              before: input.before ?? undefined,
              after: input.after ?? undefined,
              evidenceIds: input.evidenceIds ?? [],
              messageIds: input.messageIds ?? [],
              approvalId: input.approvalId ?? null,
              riskScore: input.riskScore ?? null,
              source: input.source,
              metadata: input.metadata ?? undefined,
            },
          }),
        ),
      );
    } catch (err) {
      this.logger.error(
        `Failed to emit ${inputs.length} business events: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Get full timeline for a specific business object.
   * Returns events in chronological order (oldest first).
   */
  async getTimeline(
    subjectType: string,
    subjectId: string,
    limit: number = 50,
  ) {
    return this.prisma.client.businessEvent.findMany({
      where: { subjectType, subjectId },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  /**
   * Get audit trail for a business with filters.
   */
  async getAuditTrail(businessId: string, filters: AuditFilter = {}) {
    const where: any = { businessId };

    if (filters.eventTypes?.length) {
      where.eventType = { in: filters.eventTypes };
    }
    if (filters.subjectTypes?.length) {
      where.subjectType = { in: filters.subjectTypes };
    }
    if (filters.actorTypes?.length) {
      where.actorType = { in: filters.actorTypes };
    }
    if (filters.actions?.length) {
      where.action = { in: filters.actions };
    }
    if (filters.sources?.length) {
      where.source = { in: filters.sources };
    }
    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) where.createdAt.gte = filters.startDate;
      if (filters.endDate) where.createdAt.lte = filters.endDate;
    }

    const [events, total] = await Promise.all([
      this.prisma.client.businessEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filters.offset ?? 0,
        take: filters.limit ?? 50,
      }),
      this.prisma.client.businessEvent.count({ where }),
    ]);

    return { events, total, offset: filters.offset ?? 0, limit: filters.limit ?? 50 };
  }

  /**
   * Get KPI stats for a business over a time window.
   */
  async getKpiStats(businessId: string, windowDays: number = 7): Promise<KpiStats> {
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    const events = await this.prisma.client.businessEvent.findMany({
      where: {
        businessId,
        createdAt: { gte: since },
      },
      select: {
        eventType: true,
        actorType: true,
        riskScore: true,
        action: true,
        approvalId: true,
      },
    });

    const stats: KpiStats = {
      totalEvents: events.length,
      eventsByType: {},
      eventsByActor: {},
      highRiskEvents: 0,
      approvalEvents: 0,
      aiActions: 0,
    };

    for (const e of events) {
      stats.eventsByType[e.eventType] = (stats.eventsByType[e.eventType] ?? 0) + 1;
      stats.eventsByActor[e.actorType] = (stats.eventsByActor[e.actorType] ?? 0) + 1;
      if ((e.riskScore ?? 0) >= 3) stats.highRiskEvents++;
      if (e.approvalId) stats.approvalEvents++;
      if (e.actorType === 'ai') stats.aiActions++;
    }

    return stats;
  }

  /**
   * Convenience: emit from a NestJS request context.
   * Extracts actor from req.user, source from request headers.
   */
  async emitFromRequest(
    req: { user?: { id: string }; headers?: Record<string, string> },
    input: Omit<CreateBusinessEventInput, 'actorType' | 'actorId' | 'source'>,
  ): Promise<void> {
    const actorType: ActorType = req.user ? 'human' : 'system';
    const actorId = req.user?.id ?? 'system';
    const source = this.detectSource(req.headers);

    await this.emit({
      ...input,
      actorType,
      actorId,
      source,
    });
  }

  private detectSource(headers?: Record<string, string>): 'web' | 'mobile' | 'api' | 'worker' {
    const ua = headers?.['user-agent']?.toLowerCase() ?? '';
    if (ua.includes('mobile') || ua.includes('android') || ua.includes('ios')) return 'mobile';
    if (headers?.['x-api-key']) return 'api';
    return 'web';
  }
}
