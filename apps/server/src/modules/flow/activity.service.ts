import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { activityPrefilter, readVisibleActivityPage, type TimelineViewer } from '../timeline/timeline-visibility';

export interface CreateActivityInput {
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
  // Business Event Ledger extensions
  category?: 'CONTACT' | 'COMMERCE' | 'BOOKING' | 'PAYMENT' | 'AI' | 'SYSTEM' | 'STORE' | 'TASK';
  actorType?: 'USER' | 'AI' | 'CUSTOMER' | 'SYSTEM';
  actorId?: string;
  status?: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'FAILED' | 'PENDING';
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  revenueImpact?: number;
  startsAt?: Date;
  endsAt?: Date;
  occurredAt?: Date;
}

@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async log(input: CreateActivityInput) {
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
          actorType: input.actorType ?? 'SYSTEM',
          actorId: input.actorId,
          status: input.status ?? 'COMPLETED',
          priority: input.priority,
          revenueImpact: input.revenueImpact,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          occurredAt: input.occurredAt ?? new Date(),
        },
      });
    } catch (e) {
      this.logger.error(`Failed to log activity: ${(e as Error).message}`);
    }
  }

  /**
   * One page of the business's rows, newest first, holding only rows the
   * viewer may read (V1-84: the rule of GET /timeline/businesses/:id/events,
   * timeline-visibility.ts).
   */
  async listForBusiness(
    businessId: string,
    opts: { module?: string; limit?: number; cursor?: string },
    viewer: TimelineViewer,
  ) {
    const where: any = { businessId };
    if (opts.module) where.module = opts.module;
    if (opts.cursor) where.createdAt = { lt: new Date(opts.cursor) };
    const prefilter = activityPrefilter(viewer);
    if (prefilter.length) where.AND = prefilter;

    return readVisibleActivityPage(this.prisma, viewer, opts.limit ?? 50, (skip, take) =>
      (this.prisma.client as any).activity.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
    );
  }
}
