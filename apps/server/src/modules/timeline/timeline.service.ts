import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  activityPrefilter,
  filterVisibleActivity,
  readVisibleActivityPage,
  resolveTimelineViewer,
  type TimelineViewer,
} from './timeline-visibility';

export interface RecordEventInput {
  businessId: string;
  module: string;
  action: string;
  entityType: string;
  entityId?: string;
  title: string;
  detail?: string;
  icon?: string;
  tone?: string;
  data?: Record<string, unknown>;
  contactId?: string;
  category?: 'CONTACT' | 'COMMERCE' | 'BOOKING' | 'PAYMENT' | 'AI' | 'SYSTEM' | 'STORE' | 'TASK';
  type?: string;
  actorType?: 'USER' | 'AI' | 'CUSTOMER' | 'SYSTEM';
  actorId?: string;
  status?: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'FAILED' | 'PENDING';
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  revenueImpact?: number;
  startsAt?: Date;
  endsAt?: Date;
  occurredAt?: Date;
}

export interface TimelineFilters {
  category?: string;
  contactId?: string;
  entityType?: string;
  entityId?: string;
  actorType?: string;
  status?: string;
  priority?: string;
  from?: Date;
  to?: Date;
  minRevenueImpact?: number;
  limit?: number;
  cursor?: string;
}

@Injectable()
export class TimelineService {
  private readonly logger = new Logger(TimelineService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async recordEvent(input: RecordEventInput) {
    try {
      return await (this.prisma.client as any).activity.create({
        data: {
          businessId: input.businessId,
          module: input.module,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          title: input.title,
          detail: input.detail,
          icon: input.icon,
          tone: input.tone,
          data: input.data as any,
          contactId: input.contactId,
          category: input.category,
          type: input.type,
          actorType: input.actorType,
          actorId: input.actorId,
          status: input.status,
          priority: input.priority,
          revenueImpact: input.revenueImpact,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          occurredAt: input.occurredAt ?? new Date(),
        },
      });
    } catch (e) {
      this.logger.error(`Failed to record event: ${(e as Error).message}`);
    }
  }

  async recordContactEvent(businessId: string, contactId: string, type: string, metadata?: Record<string, unknown>) {
    return this.recordEvent({
      businessId,
      module: 'crm',
      action: type,
      entityType: 'contact',
      entityId: contactId,
      title: `Contact ${type}`,
      detail: metadata?.detail as string,
      category: 'CONTACT',
      actorType: 'SYSTEM',
      contactId,
      data: metadata,
    });
  }

  async recordCommerceEvent(
    businessId: string,
    entityType: string,
    entityId: string,
    type: string,
    revenueImpact?: number,
    metadata?: Record<string, unknown>,
  ) {
    return this.recordEvent({
      businessId,
      module: 'commerce',
      action: type,
      entityType,
      entityId,
      title: `${entityType} ${type}`,
      detail: metadata?.detail as string,
      category: 'COMMERCE',
      actorType: 'SYSTEM',
      revenueImpact,
      contactId: metadata?.contactId as string,
      data: metadata,
    });
  }

  async recordBookingEvent(businessId: string, bookingId: string, type: string, metadata?: Record<string, unknown>) {
    return this.recordEvent({
      businessId,
      module: 'bookings',
      action: type,
      entityType: 'booking',
      entityId: bookingId,
      title: `Booking ${type}`,
      detail: metadata?.detail as string,
      category: 'BOOKING',
      actorType: 'SYSTEM',
      contactId: metadata?.contactId as string,
      data: metadata,
    });
  }

  async recordAiEvent(businessId: string, commandId: string, type: string, metadata?: Record<string, unknown>) {
    return this.recordEvent({
      businessId,
      module: 'ai',
      action: type,
      entityType: 'key_command',
      entityId: commandId,
      title: `AI ${type}`,
      detail: metadata?.detail as string,
      category: 'AI',
      actorType: 'AI',
      actorId: commandId,
      data: metadata,
    });
  }

  /**
   * V1-84: the caller of a feed read as timeline-visibility.ts reads them
   * (module scopes, OWNER / ADMIN for unmapped modules, CRM access).
   */
  async resolveViewer(businessId: string, userId: string): Promise<TimelineViewer> {
    return resolveTimelineViewer(this.prisma, businessId, userId);
  }

  /**
   * One page of the business's rows, newest first, holding only rows the
   * viewer may read (V1-84: canReadActivityRow and contact visibility).
   */
  async queryTimeline(businessId: string, filters: TimelineFilters, viewer: TimelineViewer) {
    const where: any = { businessId };
    if (filters.category) where.category = filters.category;
    if (filters.contactId) where.contactId = filters.contactId;
    if (filters.entityType) where.entityType = filters.entityType;
    if (filters.entityId) where.entityId = filters.entityId;
    if (filters.actorType) where.actorType = filters.actorType;
    if (filters.status) where.status = filters.status;
    if (filters.priority) where.priority = filters.priority;
    if (filters.minRevenueImpact !== undefined) where.revenueImpact = { gte: filters.minRevenueImpact };
    if (filters.from || filters.to) {
      where.occurredAt = {};
      if (filters.from) where.occurredAt.gte = filters.from;
      if (filters.to) where.occurredAt.lte = filters.to;
    }
    if (filters.cursor) where.occurredAt = { ...where.occurredAt, lt: new Date(filters.cursor) };
    const prefilter = activityPrefilter(viewer);
    if (prefilter.length) where.AND = prefilter;

    return readVisibleActivityPage(this.prisma, viewer, filters.limit ?? 50, (skip, take) =>
      (this.prisma.client as any).activity.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
    );
  }

  /**
   * The day's rows the viewer may read, and the revenueImpact summed over
   * exactly those rows (V1-84: a member without revenue read is served no
   * money row, so their sum is 0).
   */
  async getBusinessDaySummary(businessId: string, date: Date, viewer: TimelineViewer) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    const prefilter = activityPrefilter(viewer);
    const rows: Array<{ revenueImpact?: number | null }> = await (this.prisma.client as any).activity.findMany({
      where: { businessId, occurredAt: { gte: start, lte: end }, ...(prefilter.length ? { AND: prefilter } : {}) },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    });
    const events = await filterVisibleActivity(this.prisma, viewer, rows);
    const revenueImpact = events.reduce((sum, e) => sum + (typeof e.revenueImpact === 'number' ? e.revenueImpact : 0), 0);

    return {
      date: start.toISOString(),
      eventCount: events.length,
      revenueImpact,
      events,
    };
  }

  /** The next SCHEDULED rows the viewer may read, soonest first (V1-84). */
  async getUpcomingActions(businessId: string, opts: { limit?: number; from?: Date }, viewer: TimelineViewer) {
    const from = opts.from ?? new Date();
    const prefilter = activityPrefilter(viewer);
    const where = {
      businessId,
      status: 'SCHEDULED',
      startsAt: { gte: from },
      ...(prefilter.length ? { AND: prefilter } : {}),
    };
    return readVisibleActivityPage(this.prisma, viewer, opts.limit ?? 50, (skip, take) =>
      (this.prisma.client as any).activity.findMany({
        where,
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        skip,
        take,
      }),
    );
  }
}
