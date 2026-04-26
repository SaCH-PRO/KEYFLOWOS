import { Injectable, Inject, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiUsageService } from '../ai/ai-usage.service';
import type { BusinessBlueprint } from './blueprint.types';
import { buildDefaultBlueprint, mergeBlueprintPatch, normalizeBlueprintForStorage } from './blueprint.generator';

interface StorefrontEvent {
  type: string;
  itemId: string | null;
  timestamp: string;
}

interface FunnelStage {
  stage: string;
  count: number;
  dropOff: number;
  conversionRate: number;
}

interface HealthIssue {
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  itemId?: string;
  itemName?: string;
  message: string;
  fix?: { action: string; target: string };
}

interface SeoCheck {
  category: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  fix?: { action: string; target: string };
}

interface ConversionSuggestion {
  id: string;
  priority: 'high' | 'medium' | 'low';
  category: string;
  title: string;
  message: string;
  fix?: { action: string; target: string };
  impact: string;
}

interface PerProductConversion {
  itemId: string;
  views: number;
  cartAdds: number;
  conversionRate: number;
}

interface AiRecommendation {
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  category: string;
}

@Injectable()
export class SiteService {
  private readonly logger = new Logger(SiteService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiUsageService) private readonly ai: AiUsageService,
  ) {}

  async getBusinessBlueprint(businessId: string): Promise<BusinessBlueprint> {
    const business = await this.prisma.client.business.findFirst({
      where: { id: businessId, deletedAt: null },
      select: {
        id: true,
        name: true,
        ownerId: true,
        industry: true,
        city: true,
        country: true,
        timezone: true,
        currency: true,
        primaryColor: true,
        secondaryColor: true,
        tagline: true,
        description: true,
        slug: true,
        whatsapp: true,
        onboardingComplete: true,
        storeEnabled: true,
        metaData: true,
      },
    });
    if (!business) throw new NotFoundException('Business not found');

    const meta = (business.metaData as Record<string, any>) ?? {};
    const existing = meta.blueprint as Partial<BusinessBlueprint> | undefined;
    const merged = mergeBlueprintPatch(buildDefaultBlueprint(business), existing ?? {});

    return merged;
  }

  async getBlueprint(businessId: string): Promise<BusinessBlueprint> {
    return this.getBusinessBlueprint(businessId);
  }

  async generateBusinessBlueprint(businessId: string): Promise<BusinessBlueprint> {
    const blueprint = await this.getBusinessBlueprint(businessId);
    await this.saveBusinessBlueprint(businessId, blueprint);
    return blueprint;
  }

  async generateBlueprint(
    businessId: string,
    options?: { force?: boolean },
  ): Promise<BusinessBlueprint> {
    if (options?.force) {
      const current = await this.getBusinessBlueprint(businessId);
      const regenerated = mergeBlueprintPatch(
        buildDefaultBlueprint({
          name: current.businessIdentity.businessName,
          industry: current.businessIdentity.industry,
          currency: current.businessIdentity.currency,
          timezone: current.businessIdentity.timezone ?? 'America/Port_of_Spain',
          country: current.businessIdentity.country ?? null,
        }),
        current,
      );
      await this.saveBusinessBlueprint(businessId, regenerated);
      return regenerated;
    }
    return this.generateBusinessBlueprint(businessId);
  }

  async updateBusinessBlueprint(
    businessId: string,
    patch: Partial<BusinessBlueprint>,
  ): Promise<BusinessBlueprint> {
    const current = await this.getBusinessBlueprint(businessId);
    const next = mergeBlueprintPatch(current, patch);
    await this.saveBusinessBlueprint(businessId, next);
    return next;
  }

  async updateBlueprint(
    businessId: string,
    body: { blueprint?: Record<string, any>; patch?: Record<string, any> },
  ): Promise<BusinessBlueprint> {
    const payload = ((body?.blueprint ?? body?.patch ?? {}) as Partial<BusinessBlueprint>) ?? {};
    return this.updateBusinessBlueprint(businessId, payload);
  }

  async completeBusinessBlueprintStep(
    businessId: string,
    stepKey: keyof BusinessBlueprint['activation'],
    completed: boolean,
  ): Promise<BusinessBlueprint> {
    const current = await this.getBusinessBlueprint(businessId);
    const next = mergeBlueprintPatch(current, {
      activation: {
        ...current.activation,
        [stepKey]: completed,
      },
    });
    await this.saveBusinessBlueprint(businessId, next);
    return next;
  }

  async completeBlueprintStep(
    businessId: string,
    stepKey: string,
  ): Promise<BusinessBlueprint> {
    const key = stepKey as keyof BusinessBlueprint['activation'];
    const allowed: Array<keyof BusinessBlueprint['activation']> = [
      'onboardingCompleted',
      'storefrontPublished',
      'paymentPathConfigured',
      'firstOfferCreated',
      'firstShareCompleted',
      'firstTransactionIntentCreated',
    ];
    if (!allowed.includes(key)) {
      throw new BadRequestException(`Unsupported blueprint step: ${stepKey}`);
    }
    return this.completeBusinessBlueprintStep(businessId, key, true);
  }

  async publishStorefrontFromBlueprint(businessId: string): Promise<{
    storefrontUrl: string | null;
    blueprint: BusinessBlueprint;
  }> {
    const current = await this.getBusinessBlueprint(businessId);
    const next = mergeBlueprintPatch(current, {
      activation: {
        ...current.activation,
        storefrontPublished: true,
      },
    });

    const business = await this.prisma.client.business.findFirst({
      where: { id: businessId, deletedAt: null },
      select: {
        id: true,
        slug: true,
        metaData: true,
      },
    });
    if (!business) throw new NotFoundException('Business not found');

    const meta = (business.metaData as Record<string, any>) ?? {};
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: {
        storeEnabled: true,
        slug: business.slug ?? next.storefront.slug,
        metaData: {
          ...meta,
          blueprint: normalizeBlueprintForStorage(next),
        },
      },
    });

    const storefrontUrl = (business.slug ?? next.storefront.slug)
      ? `/book/${business.slug ?? next.storefront.slug}`
      : null;

    return { storefrontUrl, blueprint: next };
  }

  private async saveBusinessBlueprint(
    businessId: string,
    blueprint: BusinessBlueprint,
  ): Promise<void> {
    const business = await this.prisma.client.business.findFirst({
      where: { id: businessId, deletedAt: null },
      select: { metaData: true },
    });
    if (!business) throw new NotFoundException('Business not found');

    const meta = (business.metaData as Record<string, any>) ?? {};
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: {
        metaData: {
          ...meta,
          blueprint: normalizeBlueprintForStorage(blueprint),
        },
      },
    });
  }

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

    const ARRAY_KEYS = new Set(['sections', 'faqEntries']);
    const DIRECT_REPLACE_KEYS = new Set(['policies', 'storeSettings', 'contactOptions']);

    const merged: Record<string, any> = { ...existing };
    for (const key of Object.keys(config)) {
      if (ARRAY_KEYS.has(key) || Array.isArray(config[key])) {
        merged[key] = config[key];
      } else if (DIRECT_REPLACE_KEYS.has(key)) {
        merged[key] = { ...(existing[key] ?? {}), ...config[key] };
      } else if (config[key] && typeof config[key] === 'object' && !Array.isArray(config[key])) {
        merged[key] = { ...(existing[key] ?? {}), ...config[key] };
      } else {
        merged[key] = config[key];
      }
    }

    if (merged.faqEntries && Array.isArray(merged.faqEntries)) {
      merged.faqEntries = merged.faqEntries.slice(0, 50);
    }
    if (merged.sections && Array.isArray(merged.sections)) {
      merged.sections = merged.sections.slice(0, 20);
    }
    if (merged.merchandising?.featuredItemIds) {
      merged.merchandising.featuredItemIds = merged.merchandising.featuredItemIds.slice(0, 8);
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
    const storefrontEvents: StorefrontEvent[] = meta.storefrontEvents ?? [];
    const completedOrdersCount = storefrontEvents.filter((e) => e.type === 'checkout_complete').length;

    const [services, products, shippingZones] = await Promise.all([
      this.prisma.client.service.findMany({
        where: { businessId: business.id, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.client.product.findMany({
        where: { businessId: business.id, deletedAt: null, isActive: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.client.shippingZone.findMany({
        where: { businessId: business.id, isActive: true },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          countries: true,
          regions: true,
          baseFee: true,
          freeAbove: true,
          currency: true,
          estimatedDays: true,
          carrier: true,
        },
      }),
    ]);

    const { metaData: _meta, ...publicBusiness } = business;

    return {
      business: publicBusiness,
      storefront,
      services,
      products,
      shippingZones,
      completedOrdersCount,
    };
  }

  private readonly ALLOWED_EVENT_TYPES = new Set([
    'page_view', 'item_view', 'add_to_cart', 'checkout_start', 'checkout_complete',
  ]);

  async trackEvent(businessId: string, type: string, itemId?: string) {
    if (!type || !this.ALLOWED_EVENT_TYPES.has(type)) return { tracked: false };
    if (itemId && itemId.length > 100) return { tracked: false };

    const business = await this.prisma.client.business.findFirst({
      where: { id: businessId, deletedAt: null },
      select: { metaData: true },
    });
    if (!business) return;

    const meta = (business.metaData as Record<string, any>) ?? {};
    const events: StorefrontEvent[] = meta.storefrontEvents ?? [];

    events.push({
      type,
      itemId: itemId ?? null,
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
    const storefrontEvents: StorefrontEvent[] = meta.storefrontEvents ?? [];
    const eventsInPeriod = storefrontEvents.filter(
      (e) => new Date(e.timestamp) >= since,
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

  async getConversionFunnel(businessId: string) {
    const business = await this.prisma.client.business.findFirst({
      where: { id: businessId, deletedAt: null },
      select: { metaData: true },
    });
    if (!business) throw new NotFoundException('Business not found');

    const meta = (business.metaData as Record<string, any>) ?? {};
    const allEvents: StorefrontEvent[] = meta.storefrontEvents ?? [];
    const now = new Date();

    const thisWeekStart = new Date(now);
    thisWeekStart.setDate(now.getDate() - 7);

    const lastWeekStart = new Date(now);
    lastWeekStart.setDate(now.getDate() - 14);

    const thisWeekEvents = allEvents.filter(
      (e) => new Date(e.timestamp) >= thisWeekStart,
    );
    const lastWeekEvents = allEvents.filter(
      (e) => {
        const ts = new Date(e.timestamp);
        return ts >= lastWeekStart && ts < thisWeekStart;
      },
    );

    const countByType = (events: StorefrontEvent[]) => {
      const counts: Record<string, number> = {};
      for (const e of events) {
        counts[e.type] = (counts[e.type] ?? 0) + 1;
      }
      return counts;
    };

    const thisWeek = countByType(thisWeekEvents);
    const lastWeek = countByType(lastWeekEvents);

    const funnelStages = ['page_view', 'item_view', 'add_to_cart', 'checkout_start', 'checkout_complete'];

    const buildFunnelStage = (stage: string, counts: Record<string, number>, prevCount: number) => {
      const count = counts[stage] ?? 0;
      const rawDropOff = prevCount > 0 ? Math.round(((prevCount - count) / prevCount) * 100) : 0;
      const rawConversion = prevCount > 0 ? Math.round((count / prevCount) * 100) : 0;
      const dropOff = Math.max(0, Math.min(100, rawDropOff));
      const conversionRate = Math.max(0, Math.min(100, rawConversion));
      return { stage, count, dropOff, conversionRate };
    };

    const buildFunnel = (counts: Record<string, number>) => {
      const stages: FunnelStage[] = [];
      for (let i = 0; i < funnelStages.length; i++) {
        const prevCount = i === 0 ? (counts[funnelStages[0]] ?? 0) : stages[i - 1].count;
        stages.push(buildFunnelStage(funnelStages[i], counts, i === 0 ? counts[funnelStages[0]] ?? 0 : prevCount));
      }
      if (stages.length > 0) {
        stages[0].dropOff = 0;
        stages[0].conversionRate = 100;
      }
      return stages;
    };

    const thisWeekFunnel = buildFunnel(thisWeek);
    const lastWeekFunnel = buildFunnel(lastWeek);

    const overallRate = (thisWeek['page_view'] ?? 0) > 0
      ? Math.round(((thisWeek['checkout_complete'] ?? 0) / (thisWeek['page_view'] ?? 1)) * 100)
      : 0;
    const lastWeekRate = (lastWeek['page_view'] ?? 0) > 0
      ? Math.round(((lastWeek['checkout_complete'] ?? 0) / (lastWeek['page_view'] ?? 1)) * 100)
      : 0;

    const itemViewEvents = thisWeekEvents.filter((e) => e.type === 'item_view' && e.itemId);
    const cartEvents = thisWeekEvents.filter((e) => e.type === 'add_to_cart' && e.itemId);

    const itemViewCounts: Record<string, number> = {};
    for (const e of itemViewEvents) {
      if (e.itemId) itemViewCounts[e.itemId] = (itemViewCounts[e.itemId] ?? 0) + 1;
    }
    const itemCartCounts: Record<string, number> = {};
    for (const e of cartEvents) {
      if (e.itemId) itemCartCounts[e.itemId] = (itemCartCounts[e.itemId] ?? 0) + 1;
    }

    const perProduct: PerProductConversion[] = [];
    for (const [itemId, views] of Object.entries(itemViewCounts)) {
      const carts = itemCartCounts[itemId] ?? 0;
      perProduct.push({
        itemId,
        views,
        cartAdds: carts,
        conversionRate: views > 0 ? Math.round((carts / views) * 100) : 0,
      });
    }
    perProduct.sort((a, b) => b.views - a.views);

    return {
      thisWeek: {
        funnel: thisWeekFunnel,
        totalVisitors: thisWeek['page_view'] ?? 0,
        totalCompleted: thisWeek['checkout_complete'] ?? 0,
        overallConversionRate: overallRate,
      },
      lastWeek: {
        funnel: lastWeekFunnel,
        totalVisitors: lastWeek['page_view'] ?? 0,
        totalCompleted: lastWeek['checkout_complete'] ?? 0,
        overallConversionRate: lastWeekRate,
      },
      weekOverWeekChange: overallRate - lastWeekRate,
      perProduct: perProduct.slice(0, 20),
      summary: `${thisWeek['page_view'] ?? 0} visitors this week, ${thisWeek['item_view'] ?? 0} viewed products, ${thisWeek['add_to_cart'] ?? 0} added to cart, ${thisWeek['checkout_start'] ?? 0} started checkout, ${thisWeek['checkout_complete'] ?? 0} completed bookings — your checkout completion rate is ${overallRate}%`,
    };
  }

  async getProductHealthAudit(businessId: string) {
    const [products, services] = await Promise.all([
      this.prisma.client.product.findMany({
        where: { businessId, deletedAt: null },
        select: {
          id: true,
          name: true,
          description: true,
          price: true,
          imageUrl: true,
          isActive: true,
          category: true,
          updatedAt: true,
          createdAt: true,
        },
      }),
      this.prisma.client.service.findMany({
        where: { businessId, deletedAt: null },
        select: {
          id: true,
          name: true,
          description: true,
          price: true,
        },
      }),
    ]);

    const now = new Date();
    const staleThreshold = new Date(now);
    staleThreshold.setDate(now.getDate() - 90);

    const issues: HealthIssue[] = [];
    let healthScore = 100;
    const totalItems = products.length + services.length;

    if (totalItems === 0) {
      return {
        score: 0,
        totalItems: 0,
        issues: [{ type: 'no_items', severity: 'critical', message: 'No products or services listed. Add items to your storefront to start converting visitors.', fix: { action: 'navigate', target: 'products' } }],
        summary: 'Your storefront has no products or services listed.',
      };
    }

    for (const product of products) {
      if (!product.description || product.description.trim().length === 0) {
        issues.push({
          type: 'missing_description',
          severity: 'high',
          itemId: product.id,
          itemName: product.name,
          message: `"${product.name}" has no description — adding one could improve conversions`,
          fix: { action: 'edit_product', target: product.id },
        });
        healthScore -= 3;
      } else if (product.description.trim().length < 20) {
        issues.push({
          type: 'short_description',
          severity: 'medium',
          itemId: product.id,
          itemName: product.name,
          message: `"${product.name}" has a very short description (${product.description.trim().length} chars). Consider expanding it.`,
          fix: { action: 'edit_product', target: product.id },
        });
        healthScore -= 1;
      }

      if (!product.imageUrl) {
        issues.push({
          type: 'missing_image',
          severity: 'high',
          itemId: product.id,
          itemName: product.name,
          message: `"${product.name}" has no image — products with images get significantly more engagement`,
          fix: { action: 'edit_product', target: product.id },
        });
        healthScore -= 3;
      }

      if (product.price === 0) {
        issues.push({
          type: 'zero_price',
          severity: 'medium',
          itemId: product.id,
          itemName: product.name,
          message: `"${product.name}" has a price of $0. Is this intentional?`,
          fix: { action: 'edit_product', target: product.id },
        });
        healthScore -= 2;
      }

      if (!product.isActive) {
        issues.push({
          type: 'inactive',
          severity: 'low',
          itemId: product.id,
          itemName: product.name,
          message: `"${product.name}" is inactive and won't appear in your storefront`,
          fix: { action: 'edit_product', target: product.id },
        });
        healthScore -= 1;
      }

      if (product.updatedAt < staleThreshold) {
        issues.push({
          type: 'stale_content',
          severity: 'low',
          itemId: product.id,
          itemName: product.name,
          message: `"${product.name}" hasn't been updated in over 90 days. Consider refreshing the listing.`,
          fix: { action: 'edit_product', target: product.id },
        });
        healthScore -= 1;
      }
    }

    for (const service of services) {
      if (!service.description || service.description.trim().length === 0) {
        issues.push({
          type: 'missing_description',
          severity: 'high',
          itemId: service.id,
          itemName: service.name,
          message: `Service "${service.name}" has no description — your most-viewed service having no description could hurt conversions`,
          fix: { action: 'navigate', target: 'products' },
        });
        healthScore -= 3;
      }

      if (service.price === 0) {
        issues.push({
          type: 'zero_price',
          severity: 'medium',
          itemId: service.id,
          itemName: service.name,
          message: `Service "${service.name}" has a price of $0`,
          fix: { action: 'navigate', target: 'products' },
        });
        healthScore -= 2;
      }
    }

    issues.sort((a, b) => {
      const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return (severityOrder[a.severity as keyof typeof severityOrder] ?? 4) - (severityOrder[b.severity as keyof typeof severityOrder] ?? 4);
    });

    healthScore = Math.max(0, Math.min(100, healthScore));

    const criticalCount = issues.filter(i => i.severity === 'critical').length;
    const highCount = issues.filter(i => i.severity === 'high').length;
    const mediumCount = issues.filter(i => i.severity === 'medium').length;

    return {
      score: healthScore,
      totalItems,
      issues: issues.slice(0, 25),
      issueCount: { critical: criticalCount, high: highCount, medium: mediumCount, low: issues.length - criticalCount - highCount - mediumCount },
      summary: issues.length === 0
        ? 'All product listings look great! No issues found.'
        : `Found ${issues.length} issue${issues.length !== 1 ? 's' : ''} across your ${totalItems} listings. ${highCount > 0 ? `${highCount} high-priority items need attention.` : ''}`,
    };
  }

  async getSeoHealthCheck(businessId: string) {
    const business = await this.prisma.client.business.findFirst({
      where: { id: businessId, deletedAt: null },
      select: {
        name: true,
        tagline: true,
        description: true,
        logoUrl: true,
        slug: true,
        metaData: true,
      },
    });
    if (!business) throw new NotFoundException('Business not found');

    const meta = (business.metaData as Record<string, any>) ?? {};
    const storefront = meta.storefront ?? {};
    const seo = storefront.seo ?? {};

    const [products, services] = await Promise.all([
      this.prisma.client.product.findMany({
        where: { businessId, deletedAt: null, isActive: true },
        select: { id: true, name: true, description: true, imageUrl: true },
      }),
      this.prisma.client.service.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, name: true, description: true },
      }),
    ]);

    const checks: SeoCheck[] = [];
    let score = 100;

    const metaTitle = seo.metaTitle || business.name || '';
    if (!metaTitle || metaTitle.length === 0) {
      checks.push({ category: 'title', status: 'fail', message: 'No page title set. Add a compelling title for search engines.', fix: { action: 'navigate', target: 'settings' } });
      score -= 15;
    } else if (metaTitle.length < 15) {
      checks.push({ category: 'title', status: 'warn', message: `Page title is too short (${metaTitle.length} chars). Aim for 50-60 characters.`, fix: { action: 'navigate', target: 'settings' } });
      score -= 8;
    } else if (metaTitle.length > 60) {
      checks.push({ category: 'title', status: 'warn', message: `Page title is too long (${metaTitle.length} chars). Keep it under 60 characters for best results.`, fix: { action: 'navigate', target: 'settings' } });
      score -= 5;
    } else {
      checks.push({ category: 'title', status: 'pass', message: `Page title is good (${metaTitle.length} chars).` });
    }

    const metaDesc = seo.metaDescription || business.description || business.tagline || '';
    if (!metaDesc || metaDesc.length === 0) {
      checks.push({ category: 'description', status: 'fail', message: 'No meta description set. Write a 150-160 character description to improve search visibility.', fix: { action: 'navigate', target: 'settings' } });
      score -= 15;
    } else if (metaDesc.length < 50) {
      checks.push({ category: 'description', status: 'warn', message: `Meta description is too short (${metaDesc.length} chars). Aim for 150-160 characters.`, fix: { action: 'navigate', target: 'settings' } });
      score -= 8;
    } else if (metaDesc.length > 160) {
      checks.push({ category: 'description', status: 'warn', message: `Meta description is long (${metaDesc.length} chars). Keep it under 160 characters so it doesn't get truncated.`, fix: { action: 'navigate', target: 'settings' } });
      score -= 3;
    } else {
      checks.push({ category: 'description', status: 'pass', message: `Meta description is good (${metaDesc.length} chars).` });
    }

    if (!business.slug) {
      checks.push({ category: 'url', status: 'fail', message: 'No custom URL slug set. A memorable slug improves shareability and SEO.', fix: { action: 'navigate', target: 'settings' } });
      score -= 10;
    } else {
      checks.push({ category: 'url', status: 'pass', message: `Custom URL slug is set: "${business.slug}".` });
    }

    if (!business.logoUrl) {
      checks.push({ category: 'branding', status: 'warn', message: 'No logo uploaded. A logo improves social sharing previews and trust.', fix: { action: 'navigate', target: 'customize' } });
      score -= 8;
    } else {
      checks.push({ category: 'branding', status: 'pass', message: 'Logo is set for social sharing previews.' });
    }

    const socialImage = seo.socialImage || business.logoUrl;
    if (!socialImage) {
      checks.push({ category: 'social', status: 'warn', message: 'No social sharing image (OG image). Set one to improve how your store looks when shared on social media.', fix: { action: 'navigate', target: 'settings' } });
      score -= 5;
    } else {
      checks.push({ category: 'social', status: 'pass', message: 'Social sharing image is configured.' });
    }

    const productsWithDesc = products.filter(p => p.description && p.description.trim().length > 10).length;
    const productsWithImages = products.filter(p => p.imageUrl).length;
    const servicesWithDesc = services.filter(s => s.description && s.description.trim().length > 10).length;
    const totalListings = products.length + services.length;

    if (totalListings > 0) {
      const descCoverage = Math.round(((productsWithDesc + servicesWithDesc) / totalListings) * 100);
      if (descCoverage < 50) {
        checks.push({ category: 'content', status: 'fail', message: `Only ${descCoverage}% of your listings have descriptions. Product descriptions are critical for SEO.`, fix: { action: 'navigate', target: 'products' } });
        score -= 12;
      } else if (descCoverage < 80) {
        checks.push({ category: 'content', status: 'warn', message: `${descCoverage}% of listings have descriptions. Aim for 100% coverage.`, fix: { action: 'navigate', target: 'products' } });
        score -= 5;
      } else {
        checks.push({ category: 'content', status: 'pass', message: `${descCoverage}% of listings have descriptions. Great coverage!` });
      }

      if (products.length > 0) {
        const imgCoverage = Math.round((productsWithImages / products.length) * 100);
        if (imgCoverage < 50) {
          checks.push({ category: 'images', status: 'warn', message: `Only ${imgCoverage}% of products have images. Images improve engagement and SEO.`, fix: { action: 'navigate', target: 'products' } });
          score -= 8;
        } else {
          checks.push({ category: 'images', status: 'pass', message: `${imgCoverage}% of products have images.` });
        }

        const productsWithAltText = products.filter(p => p.imageUrl && p.name && p.name.trim().length > 0).length;
        const productsNeedingAlt = products.filter(p => p.imageUrl && (!p.name || p.name.trim().length === 0)).length;
        if (productsNeedingAlt > 0) {
          checks.push({ category: 'alt_text', status: 'warn', message: `${productsNeedingAlt} product image${productsNeedingAlt > 1 ? 's lack' : ' lacks'} descriptive alt text. Alt text improves accessibility and search image rankings.`, fix: { action: 'navigate', target: 'products' } });
          score -= 5;
        } else if (productsWithImages > 0) {
          const shortDescProducts = products.filter(p => p.imageUrl && (!p.description || p.description.trim().length < 10)).length;
          if (shortDescProducts > 0) {
            checks.push({ category: 'alt_text', status: 'warn', message: `${shortDescProducts} product${shortDescProducts > 1 ? 's have' : ' has'} images but very short or missing descriptions. Search engines use descriptions as alt text context — add detailed descriptions.`, fix: { action: 'navigate', target: 'products' } });
            score -= 4;
          } else {
            checks.push({ category: 'alt_text', status: 'pass', message: 'Product images have descriptive context for search engines.' });
          }
        }
      }
    } else {
      checks.push({ category: 'content', status: 'fail', message: 'No products or services listed. Content is essential for search engine visibility.', fix: { action: 'navigate', target: 'products' } });
      score -= 15;
    }

    if (!business.description || business.description.trim().length < 30) {
      checks.push({ category: 'business_info', status: 'warn', message: 'Business description is missing or too short. A detailed description helps search engines understand your business.', fix: { action: 'navigate', target: 'settings' } });
      score -= 5;
    } else {
      checks.push({ category: 'business_info', status: 'pass', message: 'Business description is set.' });
    }

    score = Math.max(0, Math.min(100, score));

    const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';

    return {
      score,
      grade,
      checks,
      passCount: checks.filter(c => c.status === 'pass').length,
      warnCount: checks.filter(c => c.status === 'warn').length,
      failCount: checks.filter(c => c.status === 'fail').length,
      summary: score >= 90
        ? 'Your storefront SEO is in great shape!'
        : score >= 60
        ? 'Your storefront SEO is decent but has room for improvement.'
        : 'Your storefront SEO needs significant work to rank well in search results.',
    };
  }

  async getConversionSuggestions(businessId: string) {
    const [funnel, healthAudit, seoReport] = await Promise.all([
      this.getConversionFunnel(businessId),
      this.getProductHealthAudit(businessId),
      this.getSeoHealthCheck(businessId),
    ]);

    const suggestions: ConversionSuggestion[] = [];

    if (healthAudit.issues.length > 0) {
      const missingDescs = healthAudit.issues.filter((i) => i.type === 'missing_description');
      if (missingDescs.length > 0) {
        suggestions.push({
          id: 'missing_desc',
          priority: 'high',
          category: 'listing_quality',
          title: 'Add missing descriptions',
          message: `${missingDescs.length} item${missingDescs.length > 1 ? 's have' : ' has'} no description. Adding descriptions can increase conversions by up to 30%.`,
          fix: { action: 'navigate', target: 'products' },
          impact: 'high',
        });
      }

      const missingImages = healthAudit.issues.filter((i) => i.type === 'missing_image');
      if (missingImages.length > 0) {
        suggestions.push({
          id: 'missing_images',
          priority: 'high',
          category: 'listing_quality',
          title: 'Add product images',
          message: `${missingImages.length} product${missingImages.length > 1 ? 's are' : ' is'} missing images. Visual content significantly boosts engagement.`,
          fix: { action: 'navigate', target: 'products' },
          impact: 'high',
        });
      }
    }

    const cartAbandons = (funnel.thisWeek.funnel.find((s) => s.stage === 'add_to_cart')?.count ?? 0)
      - (funnel.thisWeek.funnel.find((s) => s.stage === 'checkout_start')?.count ?? 0);
    if (cartAbandons > 0) {
      suggestions.push({
        id: 'cart_abandonment',
        priority: 'medium',
        category: 'conversion',
        title: 'Reduce cart abandonment',
        message: `${cartAbandons} visitor${cartAbandons > 1 ? 's' : ''} added to cart but didn't checkout this week. Consider simplifying your checkout flow.`,
        fix: { action: 'navigate', target: 'overview' },
        impact: 'high',
      });
    }

    const checkoutDropoffs = (funnel.thisWeek.funnel.find((s) => s.stage === 'checkout_start')?.count ?? 0)
      - (funnel.thisWeek.funnel.find((s) => s.stage === 'checkout_complete')?.count ?? 0);
    if (checkoutDropoffs > 0) {
      suggestions.push({
        id: 'checkout_dropoff',
        priority: 'medium',
        category: 'conversion',
        title: 'Checkout drop-offs detected',
        message: `${checkoutDropoffs} visitor${checkoutDropoffs > 1 ? 's' : ''} started checkout but didn't complete it. Ensure your booking form is simple and trust signals are visible.`,
        fix: { action: 'navigate', target: 'customize' },
        impact: 'medium',
      });
    }

    if (seoReport.score < 70) {
      suggestions.push({
        id: 'seo_improvement',
        priority: 'medium',
        category: 'seo',
        title: 'Improve SEO score',
        message: `Your SEO score is ${seoReport.score}/100 (${seoReport.grade}). Improving meta titles and descriptions can increase organic traffic.`,
        fix: { action: 'navigate', target: 'settings' },
        impact: 'medium',
      });
    }

    if (funnel.thisWeek.totalVisitors === 0) {
      suggestions.push({
        id: 'no_traffic',
        priority: 'high',
        category: 'traffic',
        title: 'No visitors this week',
        message: 'Your storefront had no visitors this week. Share your store link on WhatsApp, social media, or with existing clients to drive traffic.',
        fix: { action: 'navigate', target: 'overview' },
        impact: 'critical',
      });
    } else if (funnel.thisWeek.totalVisitors > 0 && funnel.thisWeek.totalCompleted === 0) {
      suggestions.push({
        id: 'no_conversions',
        priority: 'high',
        category: 'conversion',
        title: 'Visitors but no bookings',
        message: `You had ${funnel.thisWeek.totalVisitors} visitor${funnel.thisWeek.totalVisitors > 1 ? 's' : ''} but no completed bookings. Review your pricing, descriptions, and storefront layout.`,
        fix: { action: 'navigate', target: 'customize' },
        impact: 'high',
      });
    }

    if (funnel.weekOverWeekChange < -10) {
      suggestions.push({
        id: 'declining_conversion',
        priority: 'medium',
        category: 'conversion',
        title: 'Conversion rate declining',
        message: `Your conversion rate dropped ${Math.abs(funnel.weekOverWeekChange)}% compared to last week. Review recent changes to your storefront.`,
        fix: { action: 'navigate', target: 'overview' },
        impact: 'medium',
      });
    }

    suggestions.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return (priorityOrder[a.priority as keyof typeof priorityOrder] ?? 3) - (priorityOrder[b.priority as keyof typeof priorityOrder] ?? 3);
    });

    return {
      suggestions: suggestions.slice(0, 10),
      metrics: {
        conversionRate: funnel.thisWeek.overallConversionRate,
        weekOverWeekChange: funnel.weekOverWeekChange,
        healthScore: healthAudit.score,
        seoScore: seoReport.score,
        totalVisitors: funnel.thisWeek.totalVisitors,
        totalCompletions: funnel.thisWeek.totalCompleted,
      },
    };
  }

  async getAiConversionAdvice(businessId: string) {
    const [funnel, healthAudit, seoReport] = await Promise.all([
      this.getConversionFunnel(businessId),
      this.getProductHealthAudit(businessId),
      this.getSeoHealthCheck(businessId),
    ]);

    const business = await this.prisma.client.business.findFirst({
      where: { id: businessId, deletedAt: null },
      select: { name: true, industry: true, country: true, description: true },
    });

    const contextParts = [
      `Business: ${business?.name ?? 'Unknown'}`,
      business?.industry ? `Industry: ${business.industry}` : null,
      business?.country ? `Location: ${business.country}` : null,
      `Conversion funnel (this week): ${funnel.summary}`,
      `Week-over-week conversion change: ${funnel.weekOverWeekChange > 0 ? '+' : ''}${funnel.weekOverWeekChange}%`,
      `Product health score: ${healthAudit.score}/100 — ${healthAudit.summary}`,
      `SEO score: ${seoReport.score}/100 (${seoReport.grade})`,
      healthAudit.issues.length > 0
        ? `Top listing issues: ${healthAudit.issues.slice(0, 5).map((i) => i.message).join('; ')}`
        : null,
      seoReport.checks.filter((c) => c.status !== 'pass').length > 0
        ? `SEO issues: ${seoReport.checks.filter((c) => c.status !== 'pass').slice(0, 3).map((c) => c.message).join('; ')}`
        : null,
    ].filter(Boolean).join('\n');

    try {
      const result = await this.ai.callAi({
        businessId,
        feature: 'storefront_advisor',
        model: 'gpt-4o-mini',
        maxTokens: 600,
        temperature: 0.7,
        outputCategory: 'general',
        messages: [
          {
            role: 'system',
            content: `You are a storefront conversion optimization advisor for Caribbean small businesses. Analyze the data provided and give 3-5 specific, actionable recommendations to improve visitor-to-booking conversions. Keep suggestions practical for solo entrepreneurs and small teams. Format as a JSON array of objects with "title" (string), "description" (string), "priority" ("high" | "medium" | "low"), and "category" ("listing" | "seo" | "conversion" | "marketing" | "trust"). Respond ONLY with the JSON array.`,
          },
          {
            role: 'user',
            content: contextParts,
          },
        ],
      });

      let recommendations: AiRecommendation[] = [];
      try {
        const cleaned = result.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        recommendations = JSON.parse(cleaned) as AiRecommendation[];
      } catch {
        this.logger.warn('Failed to parse AI conversion advice response');
        recommendations = [{
          title: 'Review your storefront',
          description: result.content,
          priority: 'medium',
          category: 'conversion',
        }];
      }

      return {
        recommendations,
        dataSnapshot: {
          conversionRate: funnel.thisWeek.overallConversionRate,
          healthScore: healthAudit.score,
          seoScore: seoReport.score,
        },
        usage: result.usage,
      };
    } catch (error) {
      this.logger.error(`AI conversion advice failed: ${(error as Error).message}`);
      return {
        recommendations: [],
        dataSnapshot: {
          conversionRate: funnel.thisWeek.overallConversionRate,
          healthScore: healthAudit.score,
          seoScore: seoReport.score,
        },
        error: 'AI recommendations unavailable at this time.',
      };
    }
  }

  async submitReview(slug: string, data: {
    productId: string;
    customerName: string;
    customerEmail?: string;
    rating: number;
    reviewText?: string;
    orderReference?: string;
  }) {
    const business = await this.prisma.client.business.findFirst({
      where: { slug, deletedAt: null, storeEnabled: true },
      select: { id: true },
    });
    if (!business) throw new NotFoundException('Storefront not found');

    if (!data.productId || typeof data.productId !== 'string') {
      throw new BadRequestException('Product ID is required');
    }
    if (!data.rating || data.rating < 1 || data.rating > 5) {
      throw new BadRequestException('Rating must be between 1 and 5');
    }
    if (!data.customerName || data.customerName.trim().length === 0) {
      throw new BadRequestException('Customer name is required');
    }
    if (data.customerName.trim().length > 100) {
      throw new BadRequestException('Customer name is too long');
    }
    if (data.reviewText && data.reviewText.length > 2000) {
      throw new BadRequestException('Review text is too long');
    }

    const productExists = await this.prisma.client.product.findFirst({
      where: { id: data.productId, businessId: business.id, deletedAt: null },
      select: { id: true },
    });
    const serviceExists = !productExists
      ? await this.prisma.client.service.findFirst({
          where: { id: data.productId, businessId: business.id, deletedAt: null },
          select: { id: true },
        })
      : null;

    if (!productExists && !serviceExists) {
      throw new BadRequestException('Product or service not found');
    }

    const review = await this.prisma.client.productReview.create({
      data: {
        productId: data.productId,
        businessId: business.id,
        customerName: data.customerName.trim().slice(0, 100),
        customerEmail: data.customerEmail?.trim().slice(0, 255) || null,
        rating: Math.round(data.rating),
        reviewText: data.reviewText?.trim().slice(0, 2000) || null,
        status: 'PENDING',
        orderReference: data.orderReference?.trim().slice(0, 100) || null,
      },
    });

    return { id: review.id, status: review.status };
  }

  async getProductReviews(slug: string, productId: string) {
    const business = await this.prisma.client.business.findFirst({
      where: { slug, deletedAt: null, storeEnabled: true },
      select: { id: true },
    });
    if (!business) throw new NotFoundException('Storefront not found');

    const reviews = await this.prisma.client.productReview.findMany({
      where: {
        businessId: business.id,
        productId,
        status: 'APPROVED',
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const totalCount = reviews.length;
    const averageRating = totalCount > 0
      ? Math.round((reviews.reduce((sum, r) => sum + r.rating, 0) / totalCount) * 10) / 10
      : 0;

    return {
      reviews: reviews.map((r) => ({
        id: r.id,
        customerName: r.customerName,
        rating: r.rating,
        reviewText: r.reviewText,
        sellerResponse: r.sellerResponse,
        createdAt: r.createdAt,
      })),
      averageRating,
      totalCount,
    };
  }

  async getReviewAggregates(slug: string) {
    const business = await this.prisma.client.business.findFirst({
      where: { slug, deletedAt: null, storeEnabled: true },
      select: { id: true },
    });
    if (!business) throw new NotFoundException('Storefront not found');

    const reviews = await this.prisma.client.productReview.findMany({
      where: {
        businessId: business.id,
        status: 'APPROVED',
      },
      select: { productId: true, rating: true },
    });

    const aggregates: Record<string, { total: number; sum: number; count: number }> = {};
    for (const r of reviews) {
      if (!aggregates[r.productId]) {
        aggregates[r.productId] = { total: 0, sum: 0, count: 0 };
      }
      aggregates[r.productId].total++;
      aggregates[r.productId].sum += r.rating;
      aggregates[r.productId].count++;
    }

    const result: Record<string, { averageRating: number; reviewCount: number }> = {};
    for (const [productId, agg] of Object.entries(aggregates)) {
      result[productId] = {
        averageRating: Math.round((agg.sum / agg.count) * 10) / 10,
        reviewCount: agg.count,
      };
    }

    return result;
  }

  async listBusinessReviews(businessId: string, filters?: {
    status?: string;
    rating?: number;
  }) {
    const where: any = { businessId };
    if (filters?.status) where.status = filters.status;
    if (filters?.rating) where.rating = filters.rating;

    const reviews = await this.prisma.client.productReview.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const stats = {
      total: reviews.length,
      pending: reviews.filter((r) => r.status === 'PENDING').length,
      approved: reviews.filter((r) => r.status === 'APPROVED').length,
      hidden: reviews.filter((r) => r.status === 'HIDDEN').length,
      averageRating: reviews.length > 0
        ? Math.round((reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length) * 10) / 10
        : 0,
    };

    return { reviews, stats };
  }

  async moderateReview(businessId: string, reviewId: string, data: {
    status?: string;
    sellerResponse?: string;
  }) {
    const review = await this.prisma.client.productReview.findFirst({
      where: { id: reviewId, businessId },
    });
    if (!review) throw new NotFoundException('Review not found');

    const updateData: any = {};
    if (data.status && ['APPROVED', 'HIDDEN', 'PENDING'].includes(data.status)) {
      updateData.status = data.status;
    }
    if (data.sellerResponse !== undefined) {
      updateData.sellerResponse = data.sellerResponse?.trim() || null;
    }

    return this.prisma.client.productReview.update({
      where: { id: reviewId },
      data: updateData,
    });
  }
}
