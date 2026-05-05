import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

/**
 * Consent-gated case-study generator (S5).
 *
 * Pulls ONLY real platform data — orders, bookings, revenue, growth
 * windows, top product/service. Synthetic / hallucinated content is
 * never generated. A draft is created on demand; publication is gated
 * on explicit business consent (set via `consent: true` on publish).
 *
 * Drafts are persisted on `business.metaData.caseStudies` because we do
 * not want to introduce a new table for what's effectively a static
 * marketing snapshot. Each entry is keyed by deterministic id so the
 * generator is idempotent — re-generating overwrites the same record.
 */
@Injectable()
export class CaseStudyService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async loadMeta(businessId: string): Promise<{ caseStudies: CaseStudy[]; meta: Record<string, unknown> }> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { id: true, metaData: true },
    });
    if (!business) throw new NotFoundException('Business not found');
    const meta = (business.metaData as Record<string, unknown> | null) ?? {};
    const caseStudies = Array.isArray(meta.caseStudies) ? (meta.caseStudies as CaseStudy[]) : [];
    return { caseStudies, meta };
  }

  private async saveMeta(businessId: string, meta: Record<string, unknown>, caseStudies: CaseStudy[]) {
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: { metaData: { ...meta, caseStudies } as never },
    });
  }

  /**
   * Generates (or refreshes) a case-study draft from real platform
   * data over the trailing 60-day window. Returns the draft for
   * review; nothing is published until `publish()` is called.
   */
  async generateDraft(businessId: string) {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { id: true, name: true, city: true, country: true, industry: true, slug: true },
    });
    if (!business) throw new NotFoundException('Business not found');

    const now = new Date();
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const priorWindowStart = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000);

    // Real platform metrics — we pull counts and totals directly.
    const [recentOrders, priorOrders, recentBookings, priorBookings, topService, topProduct] = await Promise.all([
      this.prisma.client.marketplaceOrder.findMany({
        where: { businessId, createdAt: { gte: sixtyDaysAgo }, paymentStatus: { in: ['PAID', 'COMPLETED'] } },
        select: { total: true, currency: true },
      }),
      this.prisma.client.marketplaceOrder.count({
        where: { businessId, createdAt: { gte: priorWindowStart, lt: sixtyDaysAgo }, paymentStatus: { in: ['PAID', 'COMPLETED'] } },
      }),
      this.prisma.client.booking.count({
        where: { businessId, createdAt: { gte: sixtyDaysAgo }, status: { in: ['CONFIRMED', 'COMPLETED'] } },
      }),
      this.prisma.client.booking.count({
        where: { businessId, createdAt: { gte: priorWindowStart, lt: sixtyDaysAgo }, status: { in: ['CONFIRMED', 'COMPLETED'] } },
      }),
      this.prisma.client.booking.groupBy({
        by: ['serviceId'],
        where: { businessId, createdAt: { gte: sixtyDaysAgo }, status: { in: ['CONFIRMED', 'COMPLETED'] } },
        _count: { _all: true },
        orderBy: { _count: { serviceId: 'desc' } },
        take: 1,
      }).catch(() => [] as Array<{ serviceId: string; _count: { _all: number } }>),
      this.prisma.client.marketplaceOrderItem.groupBy({
        by: ['productId'],
        where: { order: { businessId, createdAt: { gte: sixtyDaysAgo }, paymentStatus: { in: ['PAID', 'COMPLETED'] } } },
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: 1,
      }).catch(() => [] as Array<{ productId: string; _sum: { quantity: number | null } }>),
    ]);

    const recentRevenue = recentOrders.reduce((s, o) => s + (o.total ?? 0), 0);
    const currency = recentOrders[0]?.currency ?? 'TTD';
    const recentOrderCount = recentOrders.length;
    const orderGrowth = priorOrders > 0 ? Math.round(((recentOrderCount - priorOrders) / priorOrders) * 100) : null;
    const bookingGrowth = priorBookings > 0 ? Math.round(((recentBookings - priorBookings) / priorBookings) * 100) : null;

    const [topServiceName, topProductName] = await Promise.all([
      topService[0]?.serviceId
        ? this.prisma.client.service.findUnique({ where: { id: topService[0].serviceId }, select: { name: true } }).then((s) => s?.name ?? null)
        : Promise.resolve(null),
      topProduct[0]?.productId
        ? this.prisma.client.product.findUnique({ where: { id: topProduct[0].productId }, select: { name: true } }).then((p) => p?.name ?? null)
        : Promise.resolve(null),
    ]);

    // We refuse to generate a case study with no underlying activity —
    // synthetic narratives are explicitly out of scope.
    if (recentOrderCount === 0 && recentBookings === 0) {
      throw new BadRequestException(
        'No completed orders or confirmed bookings in the last 60 days. Case studies must be backed by real platform activity.',
      );
    }

    const headlineParts: string[] = [];
    if (orderGrowth !== null && orderGrowth > 0) headlineParts.push(`grew online orders ${orderGrowth}%`);
    if (bookingGrowth !== null && bookingGrowth > 0) headlineParts.push(`grew bookings ${bookingGrowth}%`);
    if (headlineParts.length === 0 && recentOrderCount > 0) headlineParts.push(`completed ${recentOrderCount} online orders`);
    if (headlineParts.length === 0 && recentBookings > 0) headlineParts.push(`booked ${recentBookings} appointments`);

    const location = [business.city, business.country].filter(Boolean).join(', ');
    const headline = `${business.name}${location ? ` (${location})` : ''} ${headlineParts.join(' and ')} in 60 days`;

    const draft: CaseStudy = {
      id: `cs_${sixtyDaysAgo.getFullYear()}_${sixtyDaysAgo.getMonth() + 1}`,
      businessId,
      headline,
      location,
      industry: business.industry ?? null,
      metrics: {
        windowDays: 60,
        recentOrders: recentOrderCount,
        recentRevenue,
        currency,
        recentBookings,
        orderGrowthPct: orderGrowth,
        bookingGrowthPct: bookingGrowth,
        topService: topServiceName,
        topProduct: topProductName,
      },
      status: 'draft',
      consent: false,
      consentedAt: null,
      consentedBy: null,
      generatedAt: now.toISOString(),
      publishedAt: null,
    };

    const { caseStudies, meta } = await this.loadMeta(businessId);
    const idx = caseStudies.findIndex((c) => c.id === draft.id);
    if (idx >= 0) {
      // Preserve consent state if a previous version was already approved
      // by the business owner — re-generation keeps the publication live.
      draft.consent = caseStudies[idx].consent ?? false;
      draft.consentedAt = caseStudies[idx].consentedAt ?? null;
      draft.consentedBy = caseStudies[idx].consentedBy ?? null;
      draft.status = caseStudies[idx].status === 'published' ? 'published' : 'draft';
      draft.publishedAt = caseStudies[idx].publishedAt ?? null;
      caseStudies[idx] = draft;
    } else {
      caseStudies.push(draft);
    }
    await this.saveMeta(businessId, meta, caseStudies);
    return draft;
  }

  async list(businessId: string) {
    const { caseStudies } = await this.loadMeta(businessId);
    return caseStudies;
  }

  async publish(businessId: string, caseStudyId: string, opts: { consent: boolean; userId?: string }) {
    if (!opts.consent) {
      throw new ForbiddenException('Explicit consent is required before publishing a case study.');
    }
    const { caseStudies, meta } = await this.loadMeta(businessId);
    const idx = caseStudies.findIndex((c) => c.id === caseStudyId);
    if (idx < 0) throw new NotFoundException('Case study not found');
    caseStudies[idx] = {
      ...caseStudies[idx],
      consent: true,
      consentedAt: new Date().toISOString(),
      consentedBy: opts.userId ?? null,
      status: 'published',
      publishedAt: new Date().toISOString(),
    };
    await this.saveMeta(businessId, meta, caseStudies);
    return caseStudies[idx];
  }

  async unpublish(businessId: string, caseStudyId: string) {
    const { caseStudies, meta } = await this.loadMeta(businessId);
    const idx = caseStudies.findIndex((c) => c.id === caseStudyId);
    if (idx < 0) throw new NotFoundException('Case study not found');
    caseStudies[idx] = { ...caseStudies[idx], status: 'draft', publishedAt: null };
    await this.saveMeta(businessId, meta, caseStudies);
    return caseStudies[idx];
  }

  /** Public surface — only published, consent-approved studies are returned. */
  async listPublic(slug: string) {
    const business = await this.prisma.client.business.findFirst({
      where: { slug, deletedAt: null },
      select: { id: true, metaData: true },
    });
    if (!business) return [];
    const meta = (business.metaData as Record<string, unknown> | null) ?? {};
    const caseStudies = Array.isArray(meta.caseStudies) ? (meta.caseStudies as CaseStudy[]) : [];
    return caseStudies.filter((c) => c.status === 'published' && c.consent === true);
  }
}

export type CaseStudy = {
  id: string;
  businessId: string;
  headline: string;
  location: string;
  industry: string | null;
  metrics: {
    windowDays: number;
    recentOrders: number;
    recentRevenue: number;
    currency: string;
    recentBookings: number;
    orderGrowthPct: number | null;
    bookingGrowthPct: number | null;
    topService: string | null;
    topProduct: string | null;
  };
  status: 'draft' | 'published';
  consent: boolean;
  consentedAt: string | null;
  consentedBy: string | null;
  generatedAt: string;
  publishedAt: string | null;
};
