import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class ActivityLogService {
  private readonly logger = new Logger(ActivityLogService.name);
  constructor(private readonly prisma: PrismaService) {}

  async logActivity(businessId: string, data: { type: string; description: string; userId?: string; metadata?: any }) {
    return this.prisma.client.activityLog.create({ data: { businessId, ...data, createdAt: new Date() } });
  }

  async getActivity(businessId: string, limit = 50) {
    return this.prisma.client.activityLog.findMany({ where: { businessId }, take: limit, orderBy: { createdAt: 'desc' } });
  }

  async getRecentActivity(businessId: string, since: Date) {
    return this.prisma.client.activityLog.findMany({ where: { businessId, createdAt: { gte: since } }, orderBy: { createdAt: 'desc' } });
  }

  async getActivityStats(businessId: string) {
    const total = await this.prisma.client.activityLog.count({ where: { businessId } });
    const today = await this.prisma.client.activityLog.count({ where: { businessId, createdAt: { gte: new Date(Date.now() - 86400000) } } });
    return { total, today };
 }
}
