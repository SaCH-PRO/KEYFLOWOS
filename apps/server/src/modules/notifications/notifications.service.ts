import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private get notifModel() {
    return this.prisma.client.notification;
  }

  async create(input: {
    businessId: string;
    type: string;
    title: string;
    body?: string;
    data?: Record<string, unknown>;
  }) {
    return this.notifModel.create({
      data: {
        businessId: input.businessId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data ?? undefined,
      },
    });
  }

  /**
   * `excludeTypes` (W8-REVENUE-ACTIONS-SCOPE, D-63): notification types the caller may not be served,
   * left out in the query so the page stays full (the weekly financial briefing for a member without
   * revenue read).
   */
  async listForBusiness(businessId: string, opts?: { unreadOnly?: boolean; limit?: number; excludeTypes?: string[] }) {
    return this.notifModel.findMany({
      where: {
        businessId,
        ...(opts?.unreadOnly ? { read: false } : {}),
        ...(opts?.excludeTypes?.length ? { type: { notIn: opts.excludeTypes } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: opts?.limit ?? 50,
    });
  }

  async unreadCount(businessId: string, opts?: { excludeTypes?: string[] }) {
    return this.notifModel.count({
      where: {
        businessId,
        read: false,
        ...(opts?.excludeTypes?.length ? { type: { notIn: opts.excludeTypes } } : {}),
      },
    });
  }

  /**
   * `excludeTypes` (W8-REVENUE-ACTIONS-SCOPE review SEC-W8RA-3, D-63): types the caller may not be
   * served are not marked either (the read flag is the business's), and a notification of one is
   * answered as a missing id is ({ count: 0 }).
   */
  async markRead(id: string, businessId: string, opts?: { excludeTypes?: string[] }) {
    return this.notifModel.updateMany({
      where: {
        id,
        businessId,
        ...(opts?.excludeTypes?.length ? { type: { notIn: opts.excludeTypes } } : {}),
      },
      data: { read: true },
    });
  }

  async markAllRead(businessId: string, opts?: { excludeTypes?: string[] }) {
    return this.notifModel.updateMany({
      where: {
        businessId,
        read: false,
        ...(opts?.excludeTypes?.length ? { type: { notIn: opts.excludeTypes } } : {}),
      },
      data: { read: true },
    });
  }
}
