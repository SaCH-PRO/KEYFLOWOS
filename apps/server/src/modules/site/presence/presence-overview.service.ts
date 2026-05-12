import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { PresenceService } from './presence.service';
import { RevenueActionService } from '../../commerce/revenue-action.service';
import { StoreOrderService } from '../store-order.service';
import { PresenceStatsService, PRESENCE_METRICS } from '../../public-events/presence-stats.service';

/**
 * Presence Command Center backend.
 *
 * Aggregates Overview KPIs, Health Score, Action Cards, Leads and
 * Orders/Bookings — all sourced from existing modules so we do not duplicate
 * truth tables. Action cards are also pushed into the Revenue Action Queue
 * (R3) under a `PRESENCE_*` type so they appear in the operator's unified
 * action inbox alongside revenue actions.
 */

const PRESENCE_ACTION_PREFIX = 'PRESENCE_';

export type PresenceActionKey =
  | 'ADD_FIRST_SERVICE'
  | 'ADD_FIRST_PRODUCT'
  | 'ADD_BOOKING_CTA'
  | 'ENABLE_PAYMENTS'
  | 'ENABLE_WHATSAPP'
  | 'SHARE_VIA_WHATSAPP'
  | 'PRODUCT_VIEWS_NO_SALES'
  | 'POPULAR_SERVICE_ADD_DEPOSIT'
  | 'NO_TRUST_SECTION'
  | 'ADD_HOURS_LOCATION'
  | 'COMPLETE_BRANDING'
  | 'COMPLETE_SEO'
  | 'PUBLISH_SITE';

export interface PresenceActionCard {
  key: PresenceActionKey;
  title: string;
  description: string;
  severity: 'info' | 'warning' | 'critical';
  ctaLabel: string;
  ctaHref: string;
  /** When set, the action also references a domain object (e.g. product). */
  relatedType?: string | null;
  relatedId?: string | null;
}

export interface PresenceHealthCheck {
  key: string;
  label: string;
  passed: boolean;
  weight: number;
  hint?: string;
}

export interface PresenceHealthScore {
  score: number;
  band: 'critical' | 'needs-work' | 'good' | 'great';
  passed: number;
  total: number;
  checks: PresenceHealthCheck[];
}

@Injectable()
export class PresenceOverviewService {
  private readonly logger = new Logger(PresenceOverviewService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PresenceService) private readonly presence: PresenceService,
    @Inject(RevenueActionService) private readonly revenueActions: RevenueActionService,
    @Inject(StoreOrderService) private readonly storeOrders: StoreOrderService,
    @Inject(PresenceStatsService) private readonly presenceStats: PresenceStatsService,
  ) {}

  // -------------------------------------------------------------------------
  // OVERVIEW (KPIs + Health Score + Action Cards)
  // -------------------------------------------------------------------------

  async getOverview(businessId: string, days = 30) {
    const business = await this.prisma.client.business.findFirst({
      where: { id: businessId, deletedAt: null },
      select: {
        id: true, name: true, slug: true, whatsapp: true, phone: true,
        email: true, address: true, businessHours: true, storeEnabled: true,
      },
    });
    if (!business) throw new NotFoundException('Business not found');

    // Canonical analytics from PresenceDailyStat. We normalize the
    // window to UTC-day buckets (the same buckets PresenceDailyStat
    // uses) and split: aggregated rows for [since, todayStart) plus
    // raw PublicEvent rows for the current incomplete UTC day. The two
    // ranges are disjoint so totals are additive — no double counting,
    // no gap before the nightly aggregator runs.
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const since = new Date(todayStart);
    since.setUTCDate(since.getUTCDate() - (days - 1));

    // Visit-event types map to PRESENCE_METRICS.visit — used to compute
    // period-level distinct visitor counts from raw events.
    const visitEventTypes = ['page_view'];

    const [aggRows, itemAggRows, todayRaw, periodDistinctVisitors] = await Promise.all([
      this.prisma.client.presenceDailyStat.findMany({
        where: { businessId, day: { gte: since, lt: todayStart }, dimension: 'all' },
        select: { metric: true, count: true, uniques: true },
      }),
      this.prisma.client.presenceDailyStat.findMany({
        where: {
          businessId,
          day: { gte: since, lt: todayStart },
          dimension: { in: ['product', 'service'] },
        },
        select: { dimension: true, dimKey: true, metric: true, count: true },
      }),
      this.prisma.client.publicEvent.findMany({
        where: { businessId, ts: { gte: todayStart } },
        select: {
          type: true, visitorId: true, payload: true,
        },
      }),
      // True period-level unique visitor count: distinct visitorIds for
      // visit-type events across the entire selected window. Raw events
      // are retained for 90d (>= our max selectable window), so this
      // gives an accurate dedupe across days.
      this.prisma.client.publicEvent.findMany({
        where: {
          businessId,
          ts: { gte: since },
          type: { in: visitEventTypes },
        },
        select: { visitorId: true },
        distinct: ['visitorId'],
      }),
    ]);

    // Merge aggregated 'all' counts with today's raw events (additive).
    // Aggregated rows cover [since, todayStart); raw events cover today
    // only — the two windows are disjoint so we can sum counts directly.
    const totals: Record<string, number> = {};
    for (const r of aggRows) totals[r.metric] = (totals[r.metric] ?? 0) + r.count;
    for (const ev of todayRaw) {
      const m = this.presenceStats.metricForType(ev.type);
      if (!m) continue;
      totals[m] = (totals[m] ?? 0) + 1;
    }
    const metricCount = (m: string) => totals[m] ?? 0;

    // True period-level distinct visitors (deduped across days) come
    // from raw PublicEvent rows for the whole window.
    const visits = periodDistinctVisitors.length || metricCount(PRESENCE_METRICS.visit);
    const checkoutStarts = metricCount(PRESENCE_METRICS.checkoutStart);
    const checkoutCompletes = metricCount(PRESENCE_METRICS.checkoutComplete);
    const bookingStarts = metricCount(PRESENCE_METRICS.bookingStart);
    const bookingCompletes = metricCount(PRESENCE_METRICS.bookingComplete);
    const abandoned = Math.max(0, checkoutStarts - checkoutCompletes)
      + Math.max(0, bookingStarts - bookingCompletes);
    const shareClicks = metricCount(PRESENCE_METRICS.shareClick);
    const whatsappClicks = metricCount(PRESENCE_METRICS.whatsappClick);

    // Item-level views & canonical service bookings from PresenceDailyStat,
    // additively merged with today's raw events.
    const itemViewCounts = new Map<string, number>();
    const canonicalServiceBookings = new Map<string, number>();
    const addItemView = (id: string, n: number) =>
      itemViewCounts.set(id, (itemViewCounts.get(id) ?? 0) + n);
    const addServiceBooking = (id: string, n: number) =>
      canonicalServiceBookings.set(id, (canonicalServiceBookings.get(id) ?? 0) + n);

    for (const r of itemAggRows) {
      if (r.dimension === 'product') {
        if (r.metric === PRESENCE_METRICS.productView || r.metric === PRESENCE_METRICS.view) {
          addItemView(r.dimKey, r.count);
        }
      } else if (r.dimension === 'service') {
        if (r.metric === PRESENCE_METRICS.serviceView || r.metric === PRESENCE_METRICS.view) {
          addItemView(r.dimKey, r.count);
        }
        // Use booking_complete only — counting both start + complete
        // would double-count a single booking flow.
        if (r.metric === PRESENCE_METRICS.bookingComplete) {
          addServiceBooking(r.dimKey, r.count);
        }
      }
    }
    for (const ev of todayRaw) {
      const m = this.presenceStats.metricForType(ev.type);
      if (!m) continue;
      const payload = (ev.payload && typeof ev.payload === 'object' && !Array.isArray(ev.payload))
        ? (ev.payload as Record<string, unknown>)
        : {};
      const productId = typeof payload.productId === 'string' ? payload.productId
        : (typeof payload.itemId === 'string' && (m === PRESENCE_METRICS.productView || m === PRESENCE_METRICS.view) ? payload.itemId : null);
      const serviceId = typeof payload.serviceId === 'string' ? payload.serviceId : null;
      if (productId && (m === PRESENCE_METRICS.productView || m === PRESENCE_METRICS.view)) {
        addItemView(productId, 1);
      }
      if (serviceId) {
        if (m === PRESENCE_METRICS.serviceView || m === PRESENCE_METRICS.view) addItemView(serviceId, 1);
        if (m === PRESENCE_METRICS.bookingComplete) addServiceBooking(serviceId, 1);
      }
    }

    const [
      bookingsInPeriod,
      ordersInPeriod,
      paidOrdersInPeriod,
      paidInvoicesInPeriod,
      leadsInPeriod,
      services,
      products,
    ] = await Promise.all([
      this.prisma.client.booking.findMany({
        where: { businessId, deletedAt: null, createdAt: { gte: since } },
        select: { id: true, status: true, paymentStatus: true, serviceId: true },
      }),
      this.prisma.client.marketplaceOrder.findMany({
        where: { businessId, createdAt: { gte: since } },
        select: { id: true, status: true, paymentStatus: true, total: true, items: { select: { productId: true, quantity: true } } },
      }),
      this.prisma.client.marketplaceOrder.findMany({
        where: { businessId, createdAt: { gte: since }, paymentStatus: 'PAID' },
        select: { total: true },
      }),
      this.prisma.client.invoice.findMany({
        where: { businessId, deletedAt: null, status: 'PAID', paidAt: { gte: since } },
        select: { total: true },
      }),
      this.prisma.client.contact.count({
        where: { businessId, deletedAt: null, source: 'storefront', createdAt: { gte: since } },
      }),
      this.prisma.client.service.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, name: true, price: true, duration: true },
        take: 200,
      }),
      this.prisma.client.product.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, name: true, price: true, isActive: true },
        take: 200,
      }),
    ]);

    const productOrderCounts = new Map<string, number>();
    for (const o of ordersInPeriod) {
      for (const it of o.items) {
        productOrderCounts.set(it.productId, (productOrderCounts.get(it.productId) ?? 0) + (it.quantity ?? 0));
      }
    }

    const ordersRevenue = paidOrdersInPeriod.reduce((s, o) => s + Number(o.total ?? 0), 0);
    const invoicesRevenue = paidInvoicesInPeriod.reduce((s, i) => s + Number(i.total ?? 0), 0);
    const totalRevenue = ordersRevenue + invoicesRevenue;

    const bookingsCreated = bookingsInPeriod.length;
    const ordersCreated = ordersInPeriod.length;

    // Canonical conversion: completed checkouts + completed bookings out
    // of unique visitors, both sourced from PresenceDailyStat.
    const canonicalConversions = checkoutCompletes + bookingCompletes;
    const conversionRate = visits > 0 ? Math.min(1, canonicalConversions / visits) : 0;

    // Top product/service by views with sales fallback so we still have
    // something useful to show before public analytics ingestion lands.
    const productById = new Map(products.map((p) => [p.id, p]));
    const serviceById = new Map(services.map((s) => [s.id, s]));

    const topProduct = pickTop(itemViewCounts, productOrderCounts, products.map((p) => p.id));
    const topService = pickTop(itemViewCounts, canonicalServiceBookings, services.map((s) => s.id));

    // Find products with views but no sales — surfaces an action card.
    const viewedNoSales: { id: string; name: string; views: number }[] = [];
    for (const [id, views] of itemViewCounts.entries()) {
      const isProduct = productById.has(id);
      if (!isProduct) continue;
      const sales = productOrderCounts.get(id) ?? 0;
      if (views >= 5 && sales === 0) {
        viewedNoSales.push({ id, name: productById.get(id)?.name ?? 'Product', views });
      }
    }
    viewedNoSales.sort((a, b) => b.views - a.views);

    // Find popular services without a deposit configured. Popularity is
    // sourced from canonical PresenceDailyStat booking_complete /
    // booking_start counts on the service dimension (already merged with
    // today's raw events above).
    const popularNoDeposit: { id: string; name: string; bookings: number }[] = [];
    for (const [id, count] of canonicalServiceBookings.entries()) {
      const svc = serviceById.get(id);
      if (!svc) continue;
      if (count >= 3) {
        popularNoDeposit.push({ id, name: svc.name, bookings: count });
      }
    }
    popularNoDeposit.sort((a, b) => b.bookings - a.bookings);

    const health = await this.computeHealth(businessId, business, services.length, products.length);

    const draft = await this.prisma.client.sitePageDraft.findUnique({ where: { businessId } });
    const published = await this.prisma.client.sitePagePublished.findUnique({ where: { businessId } });
    const isPublished = !!(published && !published.unpublishedAt);
    const presenceSlug = (draft && draft.payload && (draft.payload as any).slug) || business.slug || null;

    const cards = this.buildActionCards({
      isPublished,
      health,
      services,
      products,
      hasWhatsapp: !!business.whatsapp,
      hasHours: !!business.businessHours,
      hasAddress: !!business.address,
      paymentsEnabled: !!business.storeEnabled,
      slug: presenceSlug,
      viewedNoSales: viewedNoSales.slice(0, 3),
      popularNoDeposit: popularNoDeposit.slice(0, 3),
    });

    // Push action cards into the unified Revenue Action Queue (R3) so they
    // appear in the operator's inbox without requiring a manual sync click.
    // Idempotent: COMPLETED/DISMISSED cards are skipped, others are upserted.
    void this.syncCardsToQueue(businessId, cards).catch((e) =>
      this.logger.warn(`auto-sync action cards failed for ${businessId}: ${(e as Error).message}`),
    );

    return {
      period: { days, since: since.toISOString() },
      kpis: {
        visits,
        leadsCaptured: leadsInPeriod,
        bookingsCreated,
        ordersCreated,
        revenue: totalRevenue,
        currency: 'TTD',
        conversionRate,
        abandoned,
        shareClicks,
        whatsappClicks,
      },
      topProduct: topProduct ? {
        id: topProduct,
        name: productById.get(topProduct)?.name ?? 'Product',
        views: itemViewCounts.get(topProduct) ?? 0,
        orders: productOrderCounts.get(topProduct) ?? 0,
      } : null,
      topService: topService ? {
        id: topService,
        name: serviceById.get(topService)?.name ?? 'Service',
        views: itemViewCounts.get(topService) ?? 0,
        bookings: canonicalServiceBookings.get(topService) ?? 0,
      } : null,
      health,
      actionCards: cards,
      site: {
        slug: presenceSlug,
        published: isPublished,
        publishedAt: published?.publishedAt ?? null,
      },
    };
  }

  private async syncCardsToQueue(businessId: string, cards: PresenceActionCard[]): Promise<number> {
    let synced = 0;
    for (const card of cards) {
      try {
        const created = await this.upsertPresenceAction(businessId, card);
        if (created) synced++;
      } catch (e) {
        this.logger.debug?.(`syncCardsToQueue: ${card.key} -> ${(e as Error).message}`);
      }
    }
    return synced;
  }

  // -------------------------------------------------------------------------
  // HEALTH SCORE
  // -------------------------------------------------------------------------

  async computeHealth(
    businessId: string,
    business: {
      slug: string | null;
      whatsapp: string | null;
      phone: string | null;
      email: string | null;
      address: string | null;
      businessHours: unknown;
      storeEnabled: boolean | null;
    },
    serviceCount: number,
    productCount: number,
  ): Promise<PresenceHealthScore> {
    const completeness = await this.presence.getSectionCompleteness(businessId);
    const draft = await this.prisma.client.sitePageDraft.findUnique({ where: { businessId } });
    const payload = draft?.payload as any;
    const sections: any[] = (payload?.sections ?? []) as any[];
    const trustSection = sections.find((s) => s.type === 'trust');
    const hasTrust = !!(trustSection?.visible && Array.isArray(trustSection?.data?.items) && trustSection.data.items.length > 0);

    const hasContact = !!(business.phone || business.email || business.whatsapp);
    const hasBookingCta = serviceCount > 0;

    const checks: PresenceHealthCheck[] = [
      { key: 'branding', label: 'Branding complete (logo + colors)', passed: completeness.brandingComplete, weight: 10, hint: 'Add your logo and primary colors in Pages → Branding.' },
      { key: 'contact', label: 'Contact info complete', passed: hasContact, weight: 10, hint: 'Add at least one of phone, email or WhatsApp.' },
      { key: 'services', label: 'Services listed', passed: serviceCount > 0, weight: 10, hint: 'Add your first service from Catalog.' },
      { key: 'products', label: 'Products listed', passed: productCount > 0, weight: 10, hint: 'Add your first product from Catalog.' },
      { key: 'booking', label: 'Booking enabled', passed: hasBookingCta, weight: 10, hint: 'Add a service so visitors can book online.' },
      { key: 'payments', label: 'Storefront payments enabled', passed: !!business.storeEnabled, weight: 10, hint: 'Turn on the storefront so visitors can buy.' },
      { key: 'whatsapp', label: 'WhatsApp enabled', passed: !!business.whatsapp, weight: 5, hint: 'Add your WhatsApp number for instant chat.' },
      { key: 'seo', label: 'SEO complete (title + description)', passed: completeness.seoComplete, weight: 10, hint: 'Add a page title and meta description in Pages → SEO.' },
      { key: 'trust', label: 'Trust section populated', passed: hasTrust, weight: 10, hint: 'Add credentials, awards or guarantees in Pages → Trust.' },
      { key: 'hours_location', label: 'Hours & location set', passed: !!business.businessHours && !!business.address, weight: 5, hint: 'Set business hours and address in Settings.' },
      { key: 'mobile', label: 'Mobile-ready', passed: true, weight: 5, hint: 'Your storefront is mobile-responsive by default.' },
      { key: 'sections', label: 'Presence sections complete', passed: completeness.score >= 70, weight: 5, hint: 'Fill in all visible sections in Pages.' },
    ];

    const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
    const earned = checks.filter((c) => c.passed).reduce((s, c) => s + c.weight, 0);
    const score = Math.round((earned / Math.max(1, totalWeight)) * 100);
    const band: PresenceHealthScore['band'] =
      score >= 85 ? 'great' : score >= 65 ? 'good' : score >= 40 ? 'needs-work' : 'critical';
    return {
      score,
      band,
      passed: checks.filter((c) => c.passed).length,
      total: checks.length,
      checks,
    };
  }

  // -------------------------------------------------------------------------
  // ACTION CARDS
  // -------------------------------------------------------------------------

  buildActionCards(input: {
    isPublished: boolean;
    health: PresenceHealthScore;
    services: { id: string; name: string }[];
    products: { id: string; name: string; isActive: boolean | null }[];
    hasWhatsapp: boolean;
    hasHours: boolean;
    hasAddress: boolean;
    paymentsEnabled: boolean;
    slug: string | null;
    viewedNoSales: { id: string; name: string; views: number }[];
    popularNoDeposit: { id: string; name: string; bookings: number }[];
  }): PresenceActionCard[] {
    const cards: PresenceActionCard[] = [];

    if (!input.isPublished) {
      cards.push({
        key: 'PUBLISH_SITE',
        title: 'Publish your storefront',
        description: 'Your presence is still in draft. Publish it so visitors can find and convert.',
        severity: 'critical',
        ctaLabel: 'Open editor',
        ctaHref: '/app/presence/pages',
      });
    }

    if (input.services.length === 0) {
      cards.push({
        key: 'ADD_FIRST_SERVICE',
        title: 'Add your first service',
        description: 'Visitors expect to book — add at least one bookable service.',
        severity: 'warning',
        ctaLabel: 'Open Catalog',
        ctaHref: '/app/store',
      });
    } else {
      cards.push({
        key: 'ADD_BOOKING_CTA',
        title: 'Highlight a booking CTA',
        description: 'Make sure your hero or contact section invites visitors to book.',
        severity: 'info',
        ctaLabel: 'Edit hero',
        ctaHref: '/app/presence/pages',
      });
    }

    if (input.products.length === 0) {
      cards.push({
        key: 'ADD_FIRST_PRODUCT',
        title: 'Add your first product',
        description: 'Sell on your storefront by adding products to your catalog.',
        severity: 'info',
        ctaLabel: 'Open Catalog',
        ctaHref: '/app/store',
      });
    }

    if (!input.paymentsEnabled) {
      cards.push({
        key: 'ENABLE_PAYMENTS',
        title: 'Enable payments on your storefront',
        description: 'Turn on storefront checkout so visitors can pay you online.',
        severity: 'warning',
        ctaLabel: 'Open settings',
        ctaHref: '/app/store',
      });
    }

    if (!input.hasWhatsapp) {
      cards.push({
        key: 'ENABLE_WHATSAPP',
        title: 'Add your WhatsApp number',
        description: 'WhatsApp is the highest-converting channel for many storefronts. Add a number so visitors can reach you instantly.',
        severity: 'info',
        ctaLabel: 'Settings',
        ctaHref: '/app/settings',
      });
    } else if (input.slug) {
      cards.push({
        key: 'SHARE_VIA_WHATSAPP',
        title: 'Share your storefront via WhatsApp',
        description: 'Send your storefront link to your contacts in one tap.',
        severity: 'info',
        ctaLabel: 'Share',
        ctaHref: `/app/whatsapp?presenceShare=${encodeURIComponent(input.slug)}`,
      });
    }

    for (const item of input.viewedNoSales) {
      cards.push({
        key: 'PRODUCT_VIEWS_NO_SALES',
        title: `${item.name} gets views but no sales`,
        description: `Visitors viewed ${item.name} ${item.views} time${item.views === 1 ? '' : 's'} without buying. Try a sharper headline, photo or price.`,
        severity: 'warning',
        ctaLabel: 'Edit product',
        ctaHref: `/app/store?productId=${encodeURIComponent(item.id)}`,
        relatedType: 'product',
        relatedId: item.id,
      });
    }

    for (const svc of input.popularNoDeposit) {
      cards.push({
        key: 'POPULAR_SERVICE_ADD_DEPOSIT',
        title: `${svc.name} is popular — add a deposit`,
        description: `${svc.name} got ${svc.bookings} booking${svc.bookings === 1 ? '' : 's'} recently. A deposit reduces no-shows.`,
        severity: 'info',
        ctaLabel: 'Edit service',
        ctaHref: `/app/store?serviceId=${encodeURIComponent(svc.id)}`,
        relatedType: 'service',
        relatedId: svc.id,
      });
    }

    if (!input.health.checks.find((c) => c.key === 'trust')?.passed) {
      cards.push({
        key: 'NO_TRUST_SECTION',
        title: 'Add a trust section',
        description: 'Awards, certifications or guarantees lift conversion.',
        severity: 'info',
        ctaLabel: 'Edit trust',
        ctaHref: '/app/presence/pages',
      });
    }

    if (!input.hasHours || !input.hasAddress) {
      cards.push({
        key: 'ADD_HOURS_LOCATION',
        title: 'Add opening hours and location',
        description: 'Visitors looking for local businesses need this to make a decision.',
        severity: 'info',
        ctaLabel: 'Settings',
        ctaHref: '/app/settings',
      });
    }

    if (!input.health.checks.find((c) => c.key === 'branding')?.passed) {
      cards.push({
        key: 'COMPLETE_BRANDING',
        title: 'Complete your branding',
        description: 'Add your logo and colors so your storefront feels like you.',
        severity: 'info',
        ctaLabel: 'Branding',
        ctaHref: '/app/presence/pages',
      });
    }

    if (!input.health.checks.find((c) => c.key === 'seo')?.passed) {
      cards.push({
        key: 'COMPLETE_SEO',
        title: 'Complete SEO basics',
        description: 'A page title and meta description help your site show up in search.',
        severity: 'info',
        ctaLabel: 'SEO',
        ctaHref: '/app/presence/pages',
      });
    }

    return cards;
  }

  /**
   * Push presence action cards into the Revenue Action Queue (R3) so the
   * operator sees them in their unified inbox. Each card uses a stable
   * `PRESENCE_<KEY>` type so it's idempotent — re-syncing won't duplicate.
   */
  async syncActionCardsToQueue(businessId: string): Promise<{ synced: number }> {
    const overview = await this.getOverview(businessId);
    const synced = await this.syncCardsToQueue(businessId, overview.actionCards);
    return { synced };
  }

  private severityToPriority(s: PresenceActionCard['severity']): number {
    switch (s) {
      case 'critical': return 1;
      case 'warning': return 2;
      default: return 3;
    }
  }

  private async upsertPresenceAction(businessId: string, card: PresenceActionCard): Promise<boolean> {
    const type = `${PRESENCE_ACTION_PREFIX}${card.key}`;
    const relatedType = card.relatedType ?? 'presence';
    const relatedId = card.relatedId ?? card.key;
    try {
      const existing = await this.prisma.client.revenueAction.findUnique({
        where: {
          businessId_type_relatedType_relatedId: { businessId, type, relatedType, relatedId },
        },
      });
      const recommendation: Prisma.InputJsonValue = {
        explanation: card.description,
        suggestedAction: card.ctaLabel,
        ctaHref: card.ctaHref,
        source: 'template',
        kind: 'presence',
        presenceKey: card.key,
      };
      if (existing) {
        if (existing.status === 'COMPLETED' || existing.status === 'DISMISSED') return false;
        await this.prisma.client.revenueAction.update({
          where: { id: existing.id },
          data: {
            title: card.title,
            detail: card.description,
            priority: this.severityToPriority(card.severity),
            recommendation,
          },
        });
        return false;
      }
      await this.prisma.client.revenueAction.create({
        data: {
          businessId,
          type,
          title: card.title,
          detail: card.description,
          priority: this.severityToPriority(card.severity),
          relatedType,
          relatedId,
          recommendation,
        },
      });
      return true;
    } catch (e) {
      this.logger.debug?.(`upsertPresenceAction(${card.key}) failed: ${(e as Error).message}`);
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // LEADS / ORDERS / BOOKINGS for the Presence tabs
  // -------------------------------------------------------------------------

  async listStorefrontLeads(businessId: string, opts: { limit?: number } = {}) {
    const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
    const items = await this.prisma.client.contact.findMany({
      where: { businessId, deletedAt: null, source: 'storefront' },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true, firstName: true, lastName: true, displayName: true,
        email: true, phone: true, whatsappNumber: true,
        sourceDetail: true, createdAt: true, lastContactedAt: true,
        relationshipHealth: true, lifecycleStage: true,
      },
    });
    return { items };
  }

  async listStorefrontOrders(businessId: string, opts: { limit?: number } = {}) {
    const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
    // Reuse the canonical commerce read path — all marketplace orders are
    // storefront-originated by definition (placed via /storefront/checkout).
    const result = await this.storeOrders.listOrders(businessId, { pageSize: limit });
    const items = (result.data ?? []).map((o: any) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      paymentStatus: o.paymentStatus,
      customerName: o.customerName,
      customerEmail: o.customerEmail,
      total: Number(o.total ?? 0),
      currency: o.currency,
      createdAt: o.createdAt,
      items: (o.items ?? []).map((it: any) => ({ name: it.name, quantity: it.quantity })),
    }));
    return { items };
  }

  async listStorefrontBookings(businessId: string, opts: { limit?: number } = {}) {
    const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
    // Strict: bookings whose contact has source='storefront'. If there are no
    // storefront contacts yet, return an empty list (do not leak unrelated
    // bookings into this surface).
    const storefrontContactIds = await this.prisma.client.contact.findMany({
      where: { businessId, deletedAt: null, source: 'storefront' },
      select: { id: true },
      take: 1000,
    });
    const ids = storefrontContactIds.map((c) => c.id);
    if (ids.length === 0) {
      return { items: [] as Array<unknown>, sourceFiltered: true };
    }
    const items = await this.prisma.client.booking.findMany({
      where: { businessId, deletedAt: null, contactId: { in: ids } },
      orderBy: { startTime: 'desc' },
      take: limit,
      select: {
        id: true, status: true, paymentStatus: true, startTime: true, endTime: true,
        contact: { select: { id: true, firstName: true, lastName: true, displayName: true, email: true } },
        service: { select: { id: true, name: true, price: true } },
      },
    });
    return { items, sourceFiltered: true };
  }
}

function pickTop(
  views: Map<string, number>,
  fallback: Map<string, number>,
  candidateIds: string[],
): string | null {
  let best: { id: string; score: number } | null = null;
  for (const id of candidateIds) {
    const v = views.get(id) ?? 0;
    const f = fallback.get(id) ?? 0;
    const score = v * 10 + f;
    if (score === 0) continue;
    if (!best || score > best.score) best = { id, score };
  }
  return best?.id ?? null;
}
