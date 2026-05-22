import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface SalesRep {
  id: string;
  name: string;
  commissionRate: number;
  dealsClosed: number;
  revenueAttributed: number;
}

export interface DealAttribution {
  contactId: string;
  salesRepId: string;
  attributedValue: number;
  attributedAt: string;
}

@Injectable()
export class SalesTeamService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async setSalesRep(businessId: string, contactId: string, salesRepId: string | null) {
    const contact = await this.prisma.client.contact.findUnique({
      where: { id: contactId, businessId },
      select: { custom: true },
    });
    if (!contact) throw new Error('Contact not found');

    const custom = (contact.custom as Record<string, any>) ?? {};
    await this.prisma.client.contact.update({
      where: { id: contactId },
      data: {
        custom: { ...custom, salesRepId: salesRepId ?? undefined },
      },
    });
  }

  async getSalesReps(businessId: string): Promise<SalesRep[]> {
    const staff = await this.prisma.client.staffMember.findMany({
      where: { businessId },
      select: { id: true, name: true },
    });

    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { metaData: true },
    });
    const meta = (business?.metaData as Record<string, any>) ?? {};
    const salesConfig = (meta.salesConfig as Record<string, any>) ?? {};
    const commissionMap = (salesConfig.commissionRates as Record<string, number>) ?? {};

    const reps: SalesRep[] = [];
    for (const s of staff) {
      const repContacts = await this.prisma.client.contact.findMany({
        where: {
          businessId,
          custom: { path: ['salesRepId'], equals: s.id },
        },
        select: { id: true },
      });

      const contactIds = repContacts.map((c) => c.id);
      const invoices = await this.prisma.client.invoice.findMany({
        where: {
          businessId,
          contactId: { in: contactIds },
          status: 'PAID',
        },
        select: { total: true, currency: true },
      });

      const revenue = invoices.reduce((sum, inv) => sum + (inv.total ?? 0), 0);
      reps.push({
        id: s.id,
        name: s.name,
        commissionRate: commissionMap[s.id] ?? 0,
        dealsClosed: invoices.length,
        revenueAttributed: revenue,
      });
    }

    return reps;
  }

  async setCommissionRate(businessId: string, staffId: string, rate: number) {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { metaData: true },
    });
    const meta = (business?.metaData as Record<string, any>) ?? {};
    const salesConfig = (meta.salesConfig as Record<string, any>) ?? {};
    const commissionRates = { ...(salesConfig.commissionRates as Record<string, number> ?? {}), [staffId]: rate };

    await this.prisma.client.business.update({
      where: { id: businessId },
      data: {
        metaData: {
          ...meta,
          salesConfig: { ...salesConfig, commissionRates },
        },
      },
    });
  }

  async getRepPipeline(businessId: string, repId: string) {
    const contacts = await this.prisma.client.contact.findMany({
      where: {
        businessId,
        custom: { path: ['salesRepId'], equals: repId },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        status: true,
        lifecycleStage: true,
        custom: true,
      },
    });

    const result = [];
    for (const c of contacts) {
      const openDeals = await this.prisma.client.invoice.count({
        where: { businessId, contactId: c.id, status: { in: ['SENT', 'OVERDUE'] } },
      });
      const paidDeals = await this.prisma.client.invoice.count({
        where: { businessId, contactId: c.id, status: 'PAID' },
      });
      const custom = (c.custom as Record<string, any>) ?? {};
      result.push({
        id: c.id,
        name: [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email,
        status: c.status,
        stage: c.lifecycleStage,
        openDealsValue: custom.openDealsValue ?? 0,
        openDeals,
        paidDeals,
      });
    }
    return result;
  }
}
