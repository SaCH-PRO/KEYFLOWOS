import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { contactWhereBase } from './crm.helpers';

type RevenueData = {
  fromActivePipeline: number;
  fromRecurringClients: number;
  fromColdLeads: number;
  expiringQuotes: { count: number; value: number };
  overdueInvoices: { count: number; value: number };
};

@Injectable()
export class CrmRevenueService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  private toNum(v: any): number {
    return v?.toNumber?.() ?? v ?? 0;
  }

  async getPredictiveRevenue(businessId: string): Promise<RevenueData> {
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const [activeQuotes, overdueInvoices, expiringQuotes, recurringClients, paidInvoices] = await Promise.all([
      this.db.quote.findMany({
        where: {
          businessId,
          status: { in: ['SENT', 'ACCEPTED'] },
        },
        select: { total: true },
      }),
      this.db.invoice.findMany({
        where: {
          businessId,
          status: 'OVERDUE',
        },
        select: { total: true },
      }),
      this.db.quote.findMany({
        where: {
          businessId,
          status: 'SENT',
          expiryDate: { lte: sevenDaysFromNow, gte: now },
        },
        select: { total: true },
      }),
      this.db.contact.findMany({
        where: {
          ...contactWhereBase(businessId),
          status: 'CLIENT',
        },
        select: { id: true },
      }),
      this.db.invoice.findMany({
        where: {
          businessId,
          status: 'PAID',
          createdAt: { gte: ninetyDaysAgo },
        },
        select: { total: true },
      }),
    ]);

    const fromActivePipeline = activeQuotes.reduce((sum, q) => {
      const val = typeof q.total === 'object' && q.total !== null && 'toNumber' in q.total ? (q.total as any).toNumber() : Number(q.total ?? 0);
      return sum + val;
    }, 0);

    const paidTotal = paidInvoices.reduce((sum, inv) => {
      const val = typeof inv.total === 'object' && inv.total !== null && 'toNumber' in inv.total ? (inv.total as any).toNumber() : Number(inv.total ?? 0);
      return sum + val;
    }, 0);
    const avgClientValue = recurringClients.length > 0 && paidInvoices.length > 0
      ? paidTotal / recurringClients.length
      : 0;
    const fromRecurringClients = Math.round(recurringClients.length * avgClientValue);

    const expiringValue = expiringQuotes.reduce((sum, q) => {
      const val = typeof q.total === 'object' && q.total !== null && 'toNumber' in q.total ? (q.total as any).toNumber() : Number(q.total ?? 0);
      return sum + val;
    }, 0);

    const overdueValue = overdueInvoices.reduce((sum, inv) => {
      const val = typeof inv.total === 'object' && inv.total !== null && 'toNumber' in inv.total ? (inv.total as any).toNumber() : Number(inv.total ?? 0);
      return sum + val;
    }, 0);

    return {
      fromActivePipeline,
      fromRecurringClients,
      fromColdLeads: Math.round(fromActivePipeline * 0.1),
      expiringQuotes: { count: expiringQuotes.length, value: expiringValue },
      overdueInvoices: { count: overdueInvoices.length, value: overdueValue },
    };
  }
}
