import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

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
        },
      });
    } catch (e) {
      this.logger.error(`Failed to log activity: ${(e as Error).message}`);
    }
  }

  async listForBusiness(businessId: string, opts?: { module?: string; limit?: number; cursor?: string }) {
    const where: any = { businessId };
    if (opts?.module) where.module = opts.module;
    if (opts?.cursor) where.createdAt = { lt: new Date(opts.cursor) };

    return (this.prisma.client as any).activity.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: opts?.limit ?? 50,
    });
  }
}
