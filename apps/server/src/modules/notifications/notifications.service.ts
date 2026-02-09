import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: {
    businessId: string;
    type: string;
    title: string;
    body?: string;
    data?: Record<string, unknown>;
  }) {
    return this.prisma.client.notification.create({
      data: {
        businessId: input.businessId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data as any,
      },
    });
  }

  async listForBusiness(businessId: string, opts?: { unreadOnly?: boolean; limit?: number }) {
    return this.prisma.client.notification.findMany({
      where: {
        businessId,
        ...(opts?.unreadOnly ? { read: false } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: opts?.limit ?? 50,
    });
  }

  async unreadCount(businessId: string) {
    return this.prisma.client.notification.count({
      where: { businessId, read: false },
    });
  }

  async markRead(id: string, businessId: string) {
    return this.prisma.client.notification.updateMany({
      where: { id, businessId },
      data: { read: true },
    });
  }

  async markAllRead(businessId: string) {
    return this.prisma.client.notification.updateMany({
      where: { businessId, read: false },
      data: { read: true },
    });
  }
}
