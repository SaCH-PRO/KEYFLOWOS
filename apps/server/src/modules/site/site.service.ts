import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class SiteService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async getStorefrontConfig(businessId: string) {
    const business = await this.prisma.client.business.findFirst({
      where: { id: businessId, deletedAt: null },
      select: { metaData: true },
    });
    if (!business) throw new NotFoundException('Business not found');
    const meta = (business.metaData as Record<string, any>) ?? {};
    return meta.storefront ?? {};
  }

  async updateStorefrontConfig(businessId: string, config: Record<string, any>) {
    const business = await this.prisma.client.business.findFirst({
      where: { id: businessId, deletedAt: null },
      select: { metaData: true },
    });
    if (!business) throw new NotFoundException('Business not found');

    const meta = (business.metaData as Record<string, any>) ?? {};
    const existing = meta.storefront ?? {};

    const merged: Record<string, any> = { ...existing };
    for (const key of Object.keys(config)) {
      if (config[key] && typeof config[key] === 'object' && !Array.isArray(config[key])) {
        merged[key] = { ...(existing[key] ?? {}), ...config[key] };
      } else {
        merged[key] = config[key];
      }
    }

    const updated = await this.prisma.client.business.update({
      where: { id: businessId },
      data: {
        metaData: { ...meta, storefront: merged },
      },
      select: { metaData: true },
    });
    return ((updated.metaData as Record<string, any>) ?? {}).storefront ?? {};
  }

  async getPublicStorefront(slug: string) {
    const business = await this.prisma.client.business.findFirst({
      where: { slug, deletedAt: null },
      select: {
        id: true,
        name: true,
        slug: true,
        logoUrl: true,
        tagline: true,
        description: true,
        address: true,
        city: true,
        country: true,
        phone: true,
        email: true,
        website: true,
        whatsapp: true,
        facebook: true,
        instagram: true,
        twitter: true,
        primaryColor: true,
        secondaryColor: true,
        storeEnabled: true,
        businessHours: true,
        metaData: true,
      },
    });
    if (!business) throw new NotFoundException('Storefront not found');
    if (!business.storeEnabled) throw new NotFoundException('Storefront not found');

    const meta = (business.metaData as Record<string, any>) ?? {};
    const storefront = meta.storefront ?? {};

    const [services, products] = await Promise.all([
      this.prisma.client.service.findMany({
        where: { businessId: business.id, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.client.product.findMany({
        where: { businessId: business.id, deletedAt: null, isActive: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const { metaData: _meta, ...publicBusiness } = business;

    return {
      business: publicBusiness,
      storefront,
      services,
      products,
    };
  }

  async trackEvent(businessId: string, type: string, itemId?: string, metadata?: any) {
    const business = await this.prisma.client.business.findFirst({
      where: { id: businessId, deletedAt: null },
      select: { metaData: true },
    });
    if (!business) return;

    const meta = (business.metaData as Record<string, any>) ?? {};
    const events: any[] = meta.storefrontEvents ?? [];

    events.push({
      type,
      itemId: itemId ?? null,
      metadata: metadata ?? null,
      timestamp: new Date().toISOString(),
    });

    const bounded = events.slice(-1000);

    await this.prisma.client.business.update({
      where: { id: businessId },
      data: {
        metaData: { ...meta, storefrontEvents: bounded },
      },
    });

    return { tracked: true };
  }

  async getAnalytics(businessId: string, days = 30) {
    const business = await this.prisma.client.business.findFirst({
      where: { id: businessId, deletedAt: null },
      select: { metaData: true },
    });
    if (!business) throw new NotFoundException('Business not found');

    const since = new Date();
    since.setDate(since.getDate() - days);

    const since7 = new Date();
    since7.setDate(since7.getDate() - 7);

    const [
      totalBookings,
      bookingsInPeriod,
      bookingsLast7,
      totalInvoices,
      invoicesInPeriod,
      paidInvoices,
      totalProducts,
      totalServices,
    ] = await Promise.all([
      this.prisma.client.booking.count({
        where: { businessId, deletedAt: null },
      }),
      this.prisma.client.booking.count({
        where: { businessId, deletedAt: null, createdAt: { gte: since } },
      }),
      this.prisma.client.booking.count({
        where: { businessId, deletedAt: null, createdAt: { gte: since7 } },
      }),
      this.prisma.client.invoice.count({
        where: { businessId, deletedAt: null },
      }),
      this.prisma.client.invoice.count({
        where: { businessId, deletedAt: null, createdAt: { gte: since } },
      }),
      this.prisma.client.invoice.findMany({
        where: { businessId, deletedAt: null, status: 'PAID', paidAt: { gte: since } },
        select: { total: true },
      }),
      this.prisma.client.product.count({
        where: { businessId, deletedAt: null },
      }),
      this.prisma.client.service.count({
        where: { businessId, deletedAt: null },
      }),
    ]);

    const revenueInPeriod = paidInvoices.reduce((sum, inv) => sum + (inv.total ?? 0), 0);

    const meta = (business.metaData as Record<string, any>) ?? {};
    const storefrontEvents: any[] = meta.storefrontEvents ?? [];
    const eventsInPeriod = storefrontEvents.filter(
      (e: any) => new Date(e.timestamp) >= since,
    );

    const eventCounts: Record<string, number> = {};
    for (const e of eventsInPeriod) {
      eventCounts[e.type] = (eventCounts[e.type] ?? 0) + 1;
    }

    return {
      period: { days, since: since.toISOString() },
      bookings: {
        total: totalBookings,
        inPeriod: bookingsInPeriod,
        last7Days: bookingsLast7,
      },
      invoices: {
        total: totalInvoices,
        inPeriod: invoicesInPeriod,
      },
      revenue: {
        inPeriod: revenueInPeriod,
      },
      catalog: {
        products: totalProducts,
        services: totalServices,
      },
      storefrontEvents: eventCounts,
    };
  }
}
