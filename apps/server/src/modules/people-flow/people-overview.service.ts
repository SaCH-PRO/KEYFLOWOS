import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface PeopleOverviewDto {
  contacts: {
    total: number;
    leads: number;
    prospects: number;
    customers: number;
    staleLeads: number;
    atRisk: number;
    highValue: number;
  };
  pipeline: {
    openDeals: number;
    pipelineValue: number;
    averageDealSize: number;
  };
  followUps: {
    overdue: number;
    today: number;
    thisWeek: number;
  };
  segments: Array<{ name: string; count: number }>;
}

@Injectable()
export class PeopleOverviewService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async getOverview(businessId: string): Promise<PeopleOverviewDto> {
    const now = new Date();
    const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [
      totalContacts,
      leads,
      prospects,
      customers,
      staleLeads,
      atRisk,
      highValue,
      openDeals,
      pipelineValueAgg,
      overdueFollowUps,
      todayFollowUps,
      weekFollowUps,
    ] = await Promise.all([
      this.prisma.client.contact.count({ where: { businessId, deletedAt: null } }),
      this.prisma.client.contact.count({ where: { businessId, deletedAt: null, status: 'LEAD' } }),
      this.prisma.client.contact.count({ where: { businessId, deletedAt: null, status: 'PROSPECT' } }),
      this.prisma.client.contact.count({ where: { businessId, deletedAt: null, status: 'CLIENT' } }),
      this.prisma.client.contact.count({
        where: { businessId, deletedAt: null, status: 'LEAD', nextActionAt: { lt: now } },
      }),
      this.prisma.client.contact.count({
        where: { businessId, deletedAt: null, status: 'CLIENT', relationshipHealth: 'AT_RISK' },
      }),
      this.prisma.client.contact.count({
        where: { businessId, deletedAt: null, status: 'CLIENT', lifetimeValue: { gte: 5000 } },
      }),
      this.prisma.client.deal.count({ where: { businessId, status: 'OPEN' } }),
      this.prisma.client.deal.aggregate({
        where: { businessId, status: 'OPEN' },
        _sum: { value: true },
        _avg: { value: true },
      }),
      this.prisma.client.contactTask.count({
        where: { businessId, status: 'OPEN', dueDate: { lt: now } },
      }),
      this.prisma.client.contactTask.count({
        where: {
          businessId,
          status: 'OPEN',
          dueDate: { gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()), lt: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) },
        },
      }),
      this.prisma.client.contactTask.count({
        where: { businessId, status: 'OPEN', dueDate: { gte: now, lt: weekEnd } },
      }),
    ]);

    return {
      contacts: {
        total: totalContacts,
        leads,
        prospects,
        customers,
        staleLeads,
        atRisk,
        highValue,
      },
      pipeline: {
        openDeals,
        pipelineValue: Number(pipelineValueAgg._sum.value ?? 0),
        averageDealSize: Number(pipelineValueAgg._avg.value ?? 0),
      },
      followUps: {
        overdue: overdueFollowUps,
        today: todayFollowUps,
        thisWeek: weekFollowUps,
      },
      segments: [
        { name: 'Hot leads', count: leads },
        { name: 'Stale leads', count: staleLeads },
        { name: 'High-value customers', count: highValue },
        { name: 'At-risk customers', count: atRisk },
      ],
    };
  }
}
