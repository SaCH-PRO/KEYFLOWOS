import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { contactWhereBase } from './crm.helpers';

type FlowIntelligenceData = {
  totalContacts: number;
  leads: number;
  prospects: number;
  clients: number;
  lost: number;
  newThisWeek: number;
  conversionsThisWeek: number;
  contactsGoingCold: number;
  contactsReadyToAdvance: number;
  weeklyChange: number;
};

@Injectable()
export class CrmFlowService {
  private readonly logger = new Logger(CrmFlowService.name);
  private cache: Map<string, { data: any; expires: number }> = new Map();
  private readonly ttlMs = 60000;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  private getCached<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  private setCache(key: string, data: any): void {
    this.cache.set(key, { data, expires: Date.now() + this.ttlMs });
  }

  invalidateCache(businessId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${businessId}:`)) {
        this.cache.delete(key);
      }
    }
  }

  async getFlowIntelligence(businessId: string): Promise<FlowIntelligenceData> {
    const cacheKey = `${businessId}:flowIntelligence`;
    const cached = this.getCached<FlowIntelligenceData>(cacheKey);
    if (cached) return cached;
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [allContacts, statusCounts, newThisWeek, newLastWeek, conversions, coldContacts, readyContacts] = await Promise.all([
      this.db.contact.count({
        where: contactWhereBase(businessId),
      }),
      this.db.contact.groupBy({
        by: ['status'],
        where: contactWhereBase(businessId),
        _count: true,
      }),
      this.db.contact.count({
        where: { ...contactWhereBase(businessId), createdAt: { gte: weekAgo } },
      }),
      this.db.contact.count({
        where: { ...contactWhereBase(businessId), createdAt: { gte: twoWeeksAgo, lt: weekAgo } },
      }),
      this.db.contactEvent.count({
        where: {
          contact: contactWhereBase(businessId),
          type: 'STATUS_CHANGED',
          createdAt: { gte: weekAgo },
        },
      }),
      this.db.contact.count({
        where: {
          ...contactWhereBase(businessId),
          status: { in: ['LEAD', 'PROSPECT'] },
          updatedAt: { lt: thirtyDaysAgo },
        },
      }),
      this.db.contact.count({
        where: {
          ...contactWhereBase(businessId),
          status: 'LEAD',
          updatedAt: { gte: weekAgo },
        },
      }),
    ]);

    const statusMap = statusCounts.reduce((acc, { status, _count }) => {
      acc[status || 'LEAD'] = _count;
      return acc;
    }, {} as Record<string, number>);

    const weeklyChange = newLastWeek > 0 
      ? Math.round(((newThisWeek - newLastWeek) / newLastWeek) * 100)
      : newThisWeek > 0 ? 100 : 0;

    const result: FlowIntelligenceData = {
      totalContacts: allContacts,
      leads: statusMap['LEAD'] || 0,
      prospects: statusMap['PROSPECT'] || 0,
      clients: statusMap['CLIENT'] || 0,
      lost: statusMap['LOST'] || 0,
      newThisWeek,
      conversionsThisWeek: conversions,
      contactsGoingCold: coldContacts,
      contactsReadyToAdvance: readyContacts,
      weeklyChange,
    };
    this.setCache(cacheKey, result);
    return result;
  }
}
