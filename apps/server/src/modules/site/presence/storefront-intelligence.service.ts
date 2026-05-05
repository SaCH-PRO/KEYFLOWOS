import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ModelGatewayService } from '../../ai/model-gateway.service';
import type { PresenceInsightsContract } from '../../ai/ai-output-contracts';

export const PRESENCE_INSIGHTS_SCHEMA_VERSION = 1;

/**
 * Minimum number of qualifying records required before we surface an
 * insight. Every generator MUST consult `minSamples` and discard any
 * candidate that is below the bar so we never narrate fake/empty data.
 */
const MIN_SAMPLES = {
  views: 10,
  conversions: 3,
  bookings: 3,
  orders: 3,
  inventoryUnits: 3,
  inquiries: 3,
  shareSources: 5,
};

export type InsightCategory = 'money' | 'time' | 'people' | 'services' | 'goods';
export type InsightSeverity = 'info' | 'warning' | 'success';

export interface PresenceInsight {
  /** Stable key, e.g. "money.top_revenue_product". Unique within a snapshot. */
  id: string;
  category: InsightCategory;
  title: string;
  detail: string;
  severity: InsightSeverity;
  actionable: boolean;
  /** Headline metric to render in the card, e.g. "TTD 4,320" or "23 mins". */
  metric?: { label: string; value: string };
  /** When `actionable`, what kind of revenue-action to enqueue. */
  actionType?: string;
  /** CTA shown on the insight card and copied onto the RevenueAction. */
  cta?: { label: string; href: string };
  /** Polymorphic source object so the operator can deep-link. */
  relatedType?: string;
  relatedId?: string;
  /** How many real records back this insight (audit + min-sample gate). */
  sampleSize: number;
}

export interface PresenceInsightCategoryBlock {
  summary: string;
  insights: PresenceInsight[];
}

export interface PresenceInsightSnapshotPayload {
  version: number;
  windowDays: number;
  generatedAt: string;
  /** Whole-snapshot AI-narrated headline + body. Falls back to a template. */
  narrative: {
    headline: string;
    body: string;
    source: 'ai' | 'template';
    modelUsed: string | null;
  };
  categories: Record<InsightCategory, PresenceInsightCategoryBlock>;
}

interface RawAggregate {
  business: {
    id: string;
    currency: string;
    storeEnabled: boolean | null;
    whatsapp: string | null;
    slug: string | null;
  };
  windowDays: number;
  // Money
  totalRevenue: number;
  ordersCount: number;
  abandonedCheckouts: number;
  checkoutStarts: number;
  checkoutCompletes: number;
  // Per-product/service rollups
  productById: Map<string, ProductRow>;
  serviceById: Map<string, ServiceRow>;
  productOrderCounts: Map<string, number>;
  productRevenue: Map<string, number>;
  productViews: Map<string, number>;
  serviceBookingCounts: Map<string, number>;
  serviceViews: Map<string, number>;
  /** Per-service avg dwell on the service page in seconds and sample size. */
  serviceDwell: Map<string, { avgSeconds: number; samples: number }>;
  /** Per UTM source / medium / campaign click totals from PublicEvent. */
  partnerCampaigns: Map<string, { clicks: number; sourceLabel: string; mediumLabel: string }>;
  // People
  shareClicks: number;
  whatsappClicks: number;
  sourceCounts: Map<string, number>; // visit by source
  referrerCounts: Map<string, number>; // bookings/orders by referrer
  // Inquiries
  inquiriesText: string[];
  inquiriesWithoutBudget: number;
  totalInquiries: number;
  // Time
  selfServeBookings: number;
  selfServeOrders: number;
  adminMinutesSavedEstimate: number;
  // Goods
  inventoryRows: InventoryRow[];
}

interface ProductRow {
  id: string;
  name: string;
  price: number;
  isActive: boolean | null;
}
interface ServiceRow {
  id: string;
  name: string;
  price: number;
  duration: number;
  depositRequired: boolean | null;
  depositValue: number | null;
}
interface InventoryRow {
  productId: string;
  productName: string;
  quantity: number;
  reserved: number;
  reorderAt: number | null;
  costPerUnit: number | null;
  currency: string;
}

@Injectable()
export class StorefrontIntelligenceService {
  private readonly logger = new Logger(StorefrontIntelligenceService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ModelGatewayService) private readonly gateway: ModelGatewayService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Returns the latest snapshot for the business, or null if none has been
   * computed yet. Marked `stale: true` if the underlying data has shifted.
   */
  async getSnapshot(businessId: string): Promise<{
    snapshot: PresenceInsightSnapshotPayload;
    stale: boolean;
    computedAt: string;
    narrativeSource: 'ai' | 'template' | null;
  } | null> {
    const row = await this.db.presenceInsightSnapshot.findUnique({
      where: { businessId },
    });
    if (!row) return null;
    return {
      snapshot: row.payload as unknown as PresenceInsightSnapshotPayload,
      stale: row.stale,
      computedAt: row.computedAt.toISOString(),
      narrativeSource: (row.narrativeSource as 'ai' | 'template' | null) ?? null,
    };
  }

  /** Returns the latest snapshot, generating one synchronously if missing. */
  async getOrGenerate(
    businessId: string,
    windowDays = 30,
  ): Promise<{
    snapshot: PresenceInsightSnapshotPayload;
    stale: boolean;
    computedAt: string;
    narrativeSource: 'ai' | 'template';
  }> {
    const existing = await this.getSnapshot(businessId);
    if (
      existing &&
      !existing.stale &&
      existing.snapshot.windowDays === windowDays
    ) {
      return {
        ...existing,
        narrativeSource: existing.narrativeSource ?? 'template',
      };
    }
    return this.regenerate(businessId, windowDays);
  }

  /**
   * Recompute insights end-to-end: aggregate real data → derive typed
   * insights → AI narrate (with template fallback) → persist → return.
   */
  async regenerate(
    businessId: string,
    windowDays = 30,
  ): Promise<{
    snapshot: PresenceInsightSnapshotPayload;
    stale: boolean;
    computedAt: string;
    narrativeSource: 'ai' | 'template';
  }> {
    const business = await this.db.business.findFirst({
      where: { id: businessId, deletedAt: null },
      select: { id: true },
    });
    if (!business) throw new NotFoundException('Business not found');

    const aggregate = await this.aggregate(businessId, windowDays);
    const categories = this.buildCategories(aggregate);
    const narrative = await this.generateNarrative(businessId, aggregate, categories);

    const payload: PresenceInsightSnapshotPayload = {
      version: PRESENCE_INSIGHTS_SCHEMA_VERSION,
      windowDays,
      generatedAt: new Date().toISOString(),
      narrative,
      categories,
    };

    // Auto-enqueue every actionable insight into the Revenue Action Queue
    // (R3). Idempotent per insight id; failures here must NOT abort the
    // snapshot itself.
    let enqueued = 0;
    for (const block of Object.values(categories)) {
      for (const insight of block.insights) {
        if (!insight.actionable) continue;
        try {
          const res = await this.enqueueInsight(businessId, insight);
          if (res.created) enqueued++;
        } catch (e) {
          this.logger.warn(
            `enqueueInsight(${insight.id}) failed: ${(e as Error).message}`,
          );
        }
      }
    }
    if (enqueued > 0) {
      this.logger.log(`Enqueued ${enqueued} new presence recommendation(s) for ${businessId}`);
    }

    const saved = await this.db.presenceInsightSnapshot.upsert({
      where: { businessId },
      create: {
        businessId,
        version: PRESENCE_INSIGHTS_SCHEMA_VERSION,
        windowDays,
        payload: payload as unknown as Prisma.InputJsonValue,
        stale: false,
        narrativeSource: narrative.source,
        modelUsed: narrative.modelUsed,
      },
      update: {
        version: PRESENCE_INSIGHTS_SCHEMA_VERSION,
        windowDays,
        payload: payload as unknown as Prisma.InputJsonValue,
        stale: false,
        narrativeSource: narrative.source,
        modelUsed: narrative.modelUsed,
        computedAt: new Date(),
      },
    });

    return {
      snapshot: payload,
      stale: false,
      computedAt: saved.computedAt.toISOString(),
      narrativeSource: narrative.source,
    };
  }

  /** Mark every snapshot stale so the nightly job re-derives. Safe to call. */
  async markAllStale(): Promise<{ updated: number }> {
    const res = await this.db.presenceInsightSnapshot.updateMany({
      where: { stale: false },
      data: { stale: true },
    });
    return { updated: res.count };
  }

  /**
   * "Delegate" an insight into the Revenue Action Queue (R3) — creates a
   * `presence_recommendation` revenue action carrying the insight's
   * explanation and a one-click CTA. Idempotent per insight id.
   */
  async delegateInsight(
    businessId: string,
    insightId: string,
  ): Promise<{ created: boolean; revenueActionId: string }> {
    const snapshot = await this.getSnapshot(businessId);
    if (!snapshot) throw new NotFoundException('No insights snapshot to delegate from');
    const insight = findInsight(snapshot.snapshot, insightId);
    if (!insight) throw new NotFoundException(`Insight ${insightId} not found`);
    if (!insight.actionable) {
      throw new BadRequestException('This insight is informational and cannot be delegated');
    }
    return this.enqueueInsight(businessId, insight);
  }

  /**
   * Idempotent upsert that lifts a single actionable insight into a
   * `PRESENCE_RECOMMENDATION_*` RevenueAction. Used both by the on-demand
   * delegate route AND automatically from `regenerate` so actionable insights
   * land in the queue without an extra operator click.
   */
  private async enqueueInsight(
    businessId: string,
    insight: PresenceInsight,
  ): Promise<{ created: boolean; revenueActionId: string }> {
    // Stable canonical type per task contract; per-insight identity lives in
    // (relatedType, relatedId) so the unique key still distinguishes rows.
    const type = 'presence_recommendation';
    const relatedType = insight.relatedType ?? 'presence_insight';
    const relatedId = insight.relatedId
      ? `${insight.id}:${insight.relatedId}`
      : insight.id;

    const recommendation: Prisma.InputJsonValue = {
      explanation: insight.detail,
      suggestedAction: insight.cta?.label ?? 'Open',
      ctaHref: insight.cta?.href ?? '/app/presence',
      source: 'template',
      kind: 'presence_recommendation',
      insightId: insight.id,
      category: insight.category,
      metric: insight.metric ?? null,
    };

    const existing = await this.db.revenueAction.findUnique({
      where: {
        businessId_type_relatedType_relatedId: {
          businessId,
          type,
          relatedType,
          relatedId,
        },
      },
    });
    if (existing) {
      if (existing.status === 'COMPLETED' || existing.status === 'DISMISSED') {
        await this.db.revenueAction.update({
          where: { id: existing.id },
          data: { status: 'PENDING', completedAt: null, resolvedBy: null, resolution: null, recommendation },
        });
      } else {
        await this.db.revenueAction.update({
          where: { id: existing.id },
          data: {
            title: insight.title,
            detail: insight.detail,
            priority: severityToPriority(insight.severity),
            recommendation,
          },
        });
      }
      return { created: false, revenueActionId: existing.id };
    }
    const created = await this.db.revenueAction.create({
      data: {
        businessId,
        type,
        title: insight.title,
        detail: insight.detail,
        priority: severityToPriority(insight.severity),
        relatedType,
        relatedId,
        recommendation,
      },
    });
    return { created: true, revenueActionId: created.id };
  }

  // ---------------------------------------------------------------------------
  // Aggregation — pull real data from S4 stats + Catalog + Inventory + CRM.
  // ---------------------------------------------------------------------------

  private async aggregate(businessId: string, windowDays: number): Promise<RawAggregate> {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - windowDays);

    const [
      business,
      orders,
      products,
      services,
      bookings,
      contacts,
      inventoryStocks,
      dailyStats,
      leadSubmissions,
      forms,
    ] = await Promise.all([
      this.db.business.findFirst({
        where: { id: businessId, deletedAt: null },
        select: { id: true, slug: true, whatsapp: true, storeEnabled: true },
      }),
      this.db.marketplaceOrder.findMany({
        where: { businessId, createdAt: { gte: since } },
        select: {
          id: true, status: true, paymentStatus: true, total: true, currency: true,
          createdAt: true,
          items: { select: { productId: true, quantity: true, total: true } },
        },
        take: 2000,
      }),
      this.db.product.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, name: true, price: true, isActive: true },
        take: 1000,
      }),
      this.db.service.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, name: true, price: true, duration: true, depositRequired: true, depositValue: true },
        take: 1000,
      }),
      this.db.booking.findMany({
        where: { businessId, deletedAt: null, createdAt: { gte: since } },
        select: {
          id: true, status: true, paymentStatus: true, serviceId: true,
          createdAt: true,
          contact: { select: { source: true } },
        },
        take: 2000,
      }),
      this.db.contact.findMany({
        where: { businessId, deletedAt: null, source: 'storefront', createdAt: { gte: since } },
        select: { id: true, sourceDetail: true, createdAt: true },
        take: 2000,
      }),
      this.db.inventoryStock.findMany({
        where: { businessId },
        select: {
          quantity: true, reserved: true, reorderAt: true, costPerUnit: true, currency: true,
          product: { select: { id: true, name: true } },
        },
        take: 2000,
      }),
      this.db.presenceDailyStat.findMany({
        where: { businessId, day: { gte: since } },
        select: { metric: true, dimension: true, dimKey: true, count: true },
        take: 20000,
      }),
      this.db.leadFormSubmission.findMany({
        where: { businessId, createdAt: { gte: since } },
        select: { data: true, createdAt: true, formId: true },
        take: 2000,
      }),
      this.db.leadForm.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, fields: true },
        take: 200,
      }),
    ]);

    // Service dwell + UTM partner attribution come straight from raw
    // PublicEvent rows so we can compute real time deltas (PresenceDailyStat
    // rolls these up but loses the per-event timestamp signal).
    const publicEvents = await this.db.publicEvent.findMany({
      where: { businessId, ts: { gte: since } },
      select: {
        type: true, sessionId: true, visitorId: true, payload: true, ts: true,
        source: true, medium: true, campaign: true,
      },
      orderBy: { ts: 'asc' },
      take: 10000,
    });

    if (!business) throw new NotFoundException('Business not found');

    const productById = new Map(products.map((p) => [p.id, p]));
    const serviceById = new Map(services.map((s) => [s.id, s]));

    // Money: revenue + checkout funnel.
    let totalRevenue = 0;
    let ordersPaid = 0;
    let checkoutCompletes = 0;
    const productOrderCounts = new Map<string, number>();
    const productRevenue = new Map<string, number>();
    let currency = 'TTD';
    for (const o of orders) {
      if (o.currency) currency = o.currency;
      if (o.paymentStatus === 'PAID') {
        totalRevenue += Number(o.total ?? 0);
        ordersPaid++;
        checkoutCompletes++;
      }
      for (const it of o.items) {
        productOrderCounts.set(it.productId, (productOrderCounts.get(it.productId) ?? 0) + (it.quantity ?? 0));
        productRevenue.set(it.productId, (productRevenue.get(it.productId) ?? 0) + Number(it.total ?? 0));
      }
    }

    const sourceCounts = new Map<string, number>();
    const productViews = new Map<string, number>();
    const serviceViews = new Map<string, number>();
    // Per-service dwell time (seconds) — computed below from PublicEvent.
    const serviceDwell = new Map<string, { totalSeconds: number; samples: number }>();
    const partnerCampaigns = new Map<
      string,
      { clicks: number; sourceLabel: string; mediumLabel: string }
    >();
    let checkoutStarts = 0;

    for (const r of dailyStats) {
      if (r.dimension === 'all') {
        if (r.metric === 'checkout_start') checkoutStarts += r.count;
      }
      if (r.dimension === 'source' && r.metric === 'visit') {
        sourceCounts.set(r.dimKey, (sourceCounts.get(r.dimKey) ?? 0) + r.count);
      }
      if (r.dimension === 'product' && (r.metric === 'product_view' || r.metric === 'view')) {
        productViews.set(r.dimKey, (productViews.get(r.dimKey) ?? 0) + r.count);
      }
      if (r.dimension === 'service' && (r.metric === 'service_view' || r.metric === 'view')) {
        serviceViews.set(r.dimKey, (serviceViews.get(r.dimKey) ?? 0) + r.count);
      }
    }
    const abandonedCheckouts = Math.max(0, checkoutStarts - checkoutCompletes);

    // People: shares + WhatsApp + bookings/orders by source/referrer.
    let shareClicks = 0;
    let whatsappClicks = 0;
    for (const r of dailyStats) {
      if (r.dimension !== 'all') continue;
      if (r.metric === 'share_click') shareClicks += r.count;
      if (r.metric === 'whatsapp_click') whatsappClicks += r.count;
    }
    const referrerCounts = new Map<string, number>();
    for (const r of dailyStats) {
      if (r.dimension === 'referrer') {
        referrerCounts.set(r.dimKey, (referrerCounts.get(r.dimKey) ?? 0) + r.count);
      }
    }

    // Services: bookings.
    const serviceBookingCounts = new Map<string, number>();
    for (const b of bookings) {
      if (b.serviceId) serviceBookingCounts.set(b.serviceId, (serviceBookingCounts.get(b.serviceId) ?? 0) + 1);
    }

    // Inquiries: lead submissions text + budget detection.
    const formsWithBudget = new Set<string>();
    for (const f of forms) {
      const fields = (f.fields as unknown) as Array<{ name?: string; label?: string }> | null;
      if (Array.isArray(fields)) {
        const hasBudget = fields.some(
          (fd) => /budget|price|spend/i.test(`${fd?.name ?? ''} ${fd?.label ?? ''}`),
        );
        if (hasBudget) formsWithBudget.add(f.id);
      }
    }
    const inquiriesText: string[] = [];
    let inquiriesWithoutBudget = 0;
    for (const sub of leadSubmissions) {
      const data = sub.data as Record<string, unknown> | null;
      if (!data) continue;
      // Pull obvious message-like fields for FAQ-gap derivation.
      for (const [k, v] of Object.entries(data)) {
        if (typeof v !== 'string') continue;
        if (v.length < 6) continue;
        if (/^(name|email|phone|first|last)$/i.test(k)) continue;
        inquiriesText.push(v.slice(0, 300));
      }
      // Budget gap: form schema didn't include a budget field.
      if (!formsWithBudget.has(sub.formId)) inquiriesWithoutBudget++;
    }

    // Time savings — admin minutes ≈ 4 mins per self-serve booking + 3 mins per
    // self-serve order. Real conservative anchor; not invented data.
    const selfServeBookings = bookings.filter((b) => (b.contact?.source ?? null) === 'storefront').length;
    const selfServeOrders = orders.length;
    const adminMinutesSavedEstimate = selfServeBookings * 4 + selfServeOrders * 3;

    // ----- Dwell time per service from raw PublicEvent stream --------------
    // For each session that produced a service_view, find the next event in
    // that session and use the timestamp delta as the dwell on the service
    // page. We cap a single sample at 5 minutes so a long-idle tab doesn't
    // pull the average up.
    const eventsBySession = new Map<string, typeof publicEvents>();
    for (const e of publicEvents) {
      const key = e.sessionId ?? `v:${e.visitorId}`;
      const arr = eventsBySession.get(key) ?? [];
      arr.push(e);
      eventsBySession.set(key, arr);
    }
    for (const arr of eventsBySession.values()) {
      // arr is already in `ts` ASC because the parent query ordered globally.
      for (let i = 0; i < arr.length; i++) {
        const e = arr[i];
        if (e.type !== 'service_view' && e.type !== 'item_view' && e.type !== 'product_view') continue;
        const payload = (e.payload as Record<string, unknown> | null) ?? {};
        const itemId = typeof payload.serviceId === 'string'
          ? payload.serviceId
          : typeof payload.itemId === 'string'
            ? payload.itemId
            : null;
        if (!itemId || !serviceById.has(itemId)) continue;
        const next = arr[i + 1];
        if (!next) continue;
        const deltaMs = next.ts.getTime() - e.ts.getTime();
        if (deltaMs <= 0) continue;
        const seconds = Math.min(300, Math.round(deltaMs / 1000));
        const cur = serviceDwell.get(itemId) ?? { totalSeconds: 0, samples: 0 };
        cur.totalSeconds += seconds;
        cur.samples += 1;
        serviceDwell.set(itemId, cur);
      }
    }
    const serviceDwellAvg = new Map<string, { avgSeconds: number; samples: number }>();
    for (const [sid, v] of serviceDwell.entries()) {
      if (v.samples === 0) continue;
      serviceDwellAvg.set(sid, { avgSeconds: Math.round(v.totalSeconds / v.samples), samples: v.samples });
    }

    // ----- Partner / referrer campaign attribution from PublicEvent --------
    for (const e of publicEvents) {
      if (!e.source && !e.medium && !e.campaign) continue;
      const key = [e.source ?? '', e.medium ?? '', e.campaign ?? ''].join('|');
      const cur = partnerCampaigns.get(key) ?? {
        clicks: 0,
        sourceLabel: e.source ?? 'direct',
        mediumLabel: e.medium ?? 'unknown',
      };
      cur.clicks += 1;
      partnerCampaigns.set(key, cur);
    }

    // Goods inventory.
    const inventoryRows: InventoryRow[] = inventoryStocks
      .filter((s) => s.product)
      .map((s) => ({
        productId: s.product!.id,
        productName: s.product!.name,
        quantity: s.quantity ?? 0,
        reserved: s.reserved ?? 0,
        reorderAt: s.reorderAt ?? null,
        costPerUnit: s.costPerUnit ?? null,
        currency: s.currency ?? currency,
      }));

    return {
      business: {
        id: business.id,
        currency,
        storeEnabled: business.storeEnabled,
        whatsapp: business.whatsapp,
        slug: business.slug,
      },
      windowDays,
      totalRevenue,
      ordersCount: ordersPaid,
      abandonedCheckouts,
      checkoutStarts,
      checkoutCompletes,
      productById,
      serviceById,
      productOrderCounts,
      productRevenue,
      productViews,
      serviceBookingCounts,
      serviceViews,
      serviceDwell: serviceDwellAvg,
      partnerCampaigns,
      shareClicks,
      whatsappClicks,
      sourceCounts,
      referrerCounts,
      inquiriesText,
      inquiriesWithoutBudget,
      totalInquiries: leadSubmissions.length,
      selfServeBookings,
      selfServeOrders,
      adminMinutesSavedEstimate,
      inventoryRows,
    };
  }

  // ---------------------------------------------------------------------------
  // Insight generators — one block per leverage axis. Each generator is
  // expected to return only insights that pass the min-sample-size gate so
  // we never narrate unfounded claims.
  // ---------------------------------------------------------------------------

  buildCategories(a: RawAggregate): Record<InsightCategory, PresenceInsightCategoryBlock> {
    return {
      money: this.buildMoneyBlock(a),
      time: this.buildTimeBlock(a),
      people: this.buildPeopleBlock(a),
      services: this.buildServicesBlock(a),
      goods: this.buildGoodsBlock(a),
    };
  }

  private buildMoneyBlock(a: RawAggregate): PresenceInsightCategoryBlock {
    const insights: PresenceInsight[] = [];
    const cur = a.business.currency;

    if (a.ordersCount >= MIN_SAMPLES.orders) {
      insights.push({
        id: 'money.monthly_revenue',
        category: 'money',
        title: 'Storefront revenue',
        detail: `Your storefront brought in ${formatMoney(a.totalRevenue, cur)} from ${a.ordersCount} paid order${a.ordersCount === 1 ? '' : 's'} in the last ${a.windowDays} days.`,
        severity: 'success',
        actionable: false,
        metric: { label: 'last 30d', value: formatMoney(a.totalRevenue, cur) },
        sampleSize: a.ordersCount,
      });
    }

    // Top revenue product.
    const topProduct = topByValue(a.productRevenue);
    if (topProduct && (a.productOrderCounts.get(topProduct) ?? 0) >= MIN_SAMPLES.orders) {
      const p = a.productById.get(topProduct);
      if (p) {
        const rev = a.productRevenue.get(topProduct) ?? 0;
        insights.push({
          id: `money.top_revenue_product:${p.id}`,
          category: 'money',
          title: `${p.name} drives the most revenue`,
          detail: `${p.name} produced ${formatMoney(rev, cur)} across ${a.productOrderCounts.get(topProduct)} order${a.productOrderCounts.get(topProduct) === 1 ? '' : 's'}. Consider featuring it on the hero or in a bundle.`,
          severity: 'success',
          actionable: true,
          actionType: 'feature_top_product',
          cta: { label: 'Feature on hero', href: '/app/presence/pages' },
          metric: { label: 'revenue', value: formatMoney(rev, cur) },
          relatedType: 'product',
          relatedId: p.id,
          sampleSize: a.productOrderCounts.get(topProduct) ?? 0,
        });
      }
    }

    // Top service by bookings → revenue proxy.
    const topService = topByValue(a.serviceBookingCounts);
    if (topService && (a.serviceBookingCounts.get(topService) ?? 0) >= MIN_SAMPLES.bookings) {
      const s = a.serviceById.get(topService);
      if (s) {
        const bookings = a.serviceBookingCounts.get(topService) ?? 0;
        const rev = bookings * Number(s.price ?? 0);
        insights.push({
          id: `money.top_revenue_service:${s.id}`,
          category: 'money',
          title: `${s.name} is your top-booked service`,
          detail: `${s.name} accounted for ${bookings} booking${bookings === 1 ? '' : 's'} (≈ ${formatMoney(rev, cur)} at list price). Promote it on the storefront.`,
          severity: 'success',
          actionable: false,
          metric: { label: 'bookings', value: String(bookings) },
          relatedType: 'service',
          relatedId: s.id,
          sampleSize: bookings,
        });
      }
    }

    // High views, low conversion warning per product.
    for (const [pid, views] of a.productViews.entries()) {
      if (views < MIN_SAMPLES.views) continue;
      const orders = a.productOrderCounts.get(pid) ?? 0;
      const ratio = orders / Math.max(1, views);
      if (orders === 0 || ratio < 0.02) {
        const p = a.productById.get(pid);
        if (!p) continue;
        insights.push({
          id: `money.high_views_low_conv:${p.id}`,
          category: 'money',
          title: `${p.name} gets traffic but few sales`,
          detail: `${views} visitors viewed ${p.name} but only ${orders} bought. Sharper copy, photos or price often unlocks this.`,
          severity: 'warning',
          actionable: true,
          actionType: 'improve_product_listing',
          cta: { label: 'Edit product', href: `/app/store?productId=${encodeURIComponent(p.id)}` },
          metric: { label: 'views/orders', value: `${views}/${orders}` },
          relatedType: 'product',
          relatedId: p.id,
          sampleSize: views,
        });
      }
    }

    // Deposits-reduce-no-shows nudge for popular services without deposits.
    for (const [sid, count] of a.serviceBookingCounts.entries()) {
      if (count < MIN_SAMPLES.bookings) continue;
      const s = a.serviceById.get(sid);
      if (!s) continue;
      const hasDeposit = !!(s.depositRequired && s.depositValue && Number(s.depositValue) > 0);
      if (hasDeposit) continue;
      insights.push({
        id: `money.add_deposit:${s.id}`,
        category: 'money',
        title: `Add a deposit to ${s.name}`,
        detail: `${s.name} has ${count} recent booking${count === 1 ? '' : 's'} without a deposit. A small deposit reduces no-shows and protects revenue.`,
        severity: 'info',
        actionable: true,
        actionType: 'add_deposit',
        cta: { label: 'Add deposit', href: `/app/store?serviceId=${encodeURIComponent(s.id)}` },
        metric: { label: 'bookings', value: String(count) },
        relatedType: 'service',
        relatedId: s.id,
        sampleSize: count,
      });
    }

    return {
      summary: insights.length
        ? `Tracking ${formatMoney(a.totalRevenue, cur)} in storefront revenue across ${a.ordersCount} order${a.ordersCount === 1 ? '' : 's'}.`
        : 'Not enough paid orders yet to derive money insights.',
      insights,
    };
  }

  private buildTimeBlock(a: RawAggregate): PresenceInsightCategoryBlock {
    const insights: PresenceInsight[] = [];
    if (a.adminMinutesSavedEstimate > 0 && (a.selfServeBookings + a.selfServeOrders) >= MIN_SAMPLES.conversions) {
      insights.push({
        id: 'time.admin_minutes_saved',
        category: 'time',
        title: 'Time saved by self-service',
        detail: `Self-service bookings and orders saved you about ${a.adminMinutesSavedEstimate} minute${a.adminMinutesSavedEstimate === 1 ? '' : 's'} of back-and-forth in the last ${a.windowDays} days.`,
        severity: 'success',
        actionable: false,
        metric: { label: 'admin saved', value: `${a.adminMinutesSavedEstimate} mins` },
        sampleSize: a.selfServeBookings + a.selfServeOrders,
      });
    }

    if (a.totalInquiries >= MIN_SAMPLES.inquiries && a.inquiriesWithoutBudget > 0) {
      insights.push({
        id: 'time.budget_field_gap',
        category: 'time',
        title: 'Quote requests are missing a budget field',
        detail: `${a.inquiriesWithoutBudget} of ${a.totalInquiries} recent inquiries came in without a budget — a quick form change saves a follow-up email each.`,
        severity: 'warning',
        actionable: true,
        actionType: 'add_budget_field',
        cta: { label: 'Edit lead forms', href: '/app/presence/pages?focus=forms' },
        metric: { label: 'gap', value: `${a.inquiriesWithoutBudget}/${a.totalInquiries}` },
        sampleSize: a.totalInquiries,
      });
    }

    // FAQ-gap: extract the most repeated short keyword from inquiry text.
    if (a.inquiriesText.length >= MIN_SAMPLES.inquiries) {
      const top = topInquiryKeyword(a.inquiriesText);
      if (top) {
        insights.push({
          id: `time.faq_gap:${top.term}`,
          category: 'time',
          title: `Customers keep asking about "${top.term}"`,
          detail: `"${top.term}" came up in ${top.count} inquiries. Adding it to your FAQ can deflect repeat questions.`,
          severity: 'info',
          actionable: true,
          actionType: 'add_faq',
          cta: { label: 'Edit FAQ', href: '/app/presence/pages?focus=faq' },
          metric: { label: 'mentions', value: String(top.count) },
          sampleSize: top.count,
        });
      }
    }

    return {
      summary: insights.length
        ? `Self-service is freeing up your inbox.`
        : 'Not enough storefront activity yet to estimate time savings.',
      insights,
    };
  }

  private buildPeopleBlock(a: RawAggregate): PresenceInsightCategoryBlock {
    const insights: PresenceInsight[] = [];
    const totalShareSources = sumMap(a.sourceCounts);

    if (totalShareSources >= MIN_SAMPLES.shareSources) {
      const top = topByValue(a.sourceCounts);
      if (top) {
        const count = a.sourceCounts.get(top) ?? 0;
        const share = Math.round((count / totalShareSources) * 100);
        insights.push({
          id: `people.top_source:${top}`,
          category: 'people',
          title: `${prettySource(top)} drives most of your traffic`,
          detail: `${share}% of recent visits came via ${prettySource(top)} (${count} of ${totalShareSources}). Consider doubling down — share more there.`,
          severity: 'success',
          actionable: a.business.slug ? true : false,
          actionType: 'share_via_top_source',
          cta: a.business.slug
            ? { label: `Share via ${prettySource(top)}`, href: `/app/whatsapp?presenceShare=${encodeURIComponent(a.business.slug)}` }
            : undefined,
          metric: { label: 'share', value: `${share}%` },
          sampleSize: totalShareSources,
        });
      }

      const leaderboard = Array.from(a.sourceCounts.entries())
        .sort((x, y) => y[1] - x[1])
        .slice(0, 5);
      if (leaderboard.length >= 2) {
        insights.push({
          id: 'people.referrer_leaderboard',
          category: 'people',
          title: 'Referrer leaderboard',
          detail: leaderboard.map(([src, n]) => `${prettySource(src)}: ${n}`).join(' · '),
          severity: 'info',
          actionable: false,
          metric: { label: 'sources', value: String(leaderboard.length) },
          sampleSize: totalShareSources,
        });
      }
    }

    // Partner-link / UTM campaign performance — surfaces tagged links so the
    // owner can see which influencer / partner / campaign actually delivers.
    const taggedCampaigns = Array.from(a.partnerCampaigns.entries())
      .filter(([, v]) => v.clicks >= MIN_SAMPLES.shareSources)
      .sort((x, y) => y[1].clicks - x[1].clicks)
      .slice(0, 1);
    for (const [, v] of taggedCampaigns) {
      const label = `${prettySource(v.sourceLabel)} / ${v.mediumLabel}`;
      insights.push({
        id: `people.partner_link:${v.sourceLabel}-${v.mediumLabel}`,
        category: 'people',
        title: `Top partner link: ${label}`,
        detail: `${v.clicks} visit${v.clicks === 1 ? '' : 's'} arrived via the ${label} link. Thank the partner publicly and reuse the same UTM tag in the next push.`,
        severity: 'success',
        actionable: false,
        metric: { label: 'visits', value: String(v.clicks) },
        sampleSize: v.clicks,
      });
    }

    // WhatsApp share-click signal.
    if (a.whatsappClicks >= MIN_SAMPLES.shareSources) {
      insights.push({
        id: 'people.whatsapp_clicks',
        category: 'people',
        title: 'WhatsApp is the highest-intent channel',
        detail: `${a.whatsappClicks} visitors tapped WhatsApp. Make sure replies are quick — that's where conversions happen.`,
        severity: 'info',
        actionable: false,
        metric: { label: 'taps', value: String(a.whatsappClicks) },
        sampleSize: a.whatsappClicks,
      });
    }

    return {
      summary: insights.length
        ? 'Word-of-mouth and referrer signal is starting to show.'
        : 'Not enough referrer signal yet — share your link in a few channels and check back.',
      insights,
    };
  }

  private buildServicesBlock(a: RawAggregate): PresenceInsightCategoryBlock {
    const insights: PresenceInsight[] = [];

    // High views, low bookings.
    for (const [sid, views] of a.serviceViews.entries()) {
      if (views < MIN_SAMPLES.views) continue;
      const bookings = a.serviceBookingCounts.get(sid) ?? 0;
      if (bookings === 0 || bookings / views < 0.03) {
        const s = a.serviceById.get(sid);
        if (!s) continue;
        insights.push({
          id: `services.high_views_low_bookings:${s.id}`,
          category: 'services',
          title: `${s.name} draws clicks but not bookings`,
          detail: `${views} visitors viewed ${s.name} and only ${bookings} booked. Sharpen the description, price or duration.`,
          severity: 'warning',
          actionable: true,
          actionType: 'improve_service_listing',
          cta: { label: 'Edit service', href: `/app/store?serviceId=${encodeURIComponent(s.id)}` },
          metric: { label: 'views/bookings', value: `${views}/${bookings}` },
          relatedType: 'service',
          relatedId: s.id,
          sampleSize: views,
        });
      }
    }

    // Low time-on-page: visitors land on a service page but don't read.
    // Sharper copy / above-the-fold pricing usually lifts the dwell.
    for (const [sid, dwell] of a.serviceDwell.entries()) {
      if (dwell.samples < MIN_SAMPLES.views) continue;
      if (dwell.avgSeconds >= 12) continue;
      const s = a.serviceById.get(sid);
      if (!s) continue;
      insights.push({
        id: `services.low_time_on_page:${s.id}`,
        category: 'services',
        title: `${s.name}: visitors leave the page quickly`,
        detail: `Average dwell on the ${s.name} page is ${dwell.avgSeconds}s across ${dwell.samples} session${dwell.samples === 1 ? '' : 's'}. A clearer description, lead photo or upfront price often lifts engagement.`,
        severity: 'warning',
        actionable: true,
        actionType: 'improve_service_listing',
        cta: { label: 'Edit service', href: `/app/store?serviceId=${encodeURIComponent(s.id)}` },
        metric: { label: 'avg dwell', value: `${dwell.avgSeconds}s` },
        relatedType: 'service',
        relatedId: s.id,
        sampleSize: dwell.samples,
      });
    }

    // Top booked services list.
    const topServices = Array.from(a.serviceBookingCounts.entries())
      .filter(([, count]) => count >= MIN_SAMPLES.bookings)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 3);
    for (const [sid, count] of topServices) {
      const s = a.serviceById.get(sid);
      if (!s) continue;
      insights.push({
        id: `services.top_booked:${s.id}`,
        category: 'services',
        title: `${s.name} is in demand`,
        detail: `${count} recent booking${count === 1 ? '' : 's'}. Make sure availability is generous and the listing photo shines.`,
        severity: 'success',
        actionable: false,
        metric: { label: 'bookings', value: String(count) },
        relatedType: 'service',
        relatedId: s.id,
        sampleSize: count,
      });
    }

    return {
      summary: insights.length ? 'Service-level signal is forming.' : 'Not enough service activity yet to derive insights.',
      insights,
    };
  }

  private buildGoodsBlock(a: RawAggregate): PresenceInsightCategoryBlock {
    const insights: PresenceInsight[] = [];

    for (const inv of a.inventoryRows) {
      const sold = a.productOrderCounts.get(inv.productId) ?? 0;
      const available = Math.max(0, inv.quantity - inv.reserved);
      if (sold >= MIN_SAMPLES.inventoryUnits && available <= Math.max(2, sold)) {
        insights.push({
          id: `goods.low_stock_selling_fast:${inv.productId}`,
          category: 'goods',
          title: `${inv.productName} is running low`,
          detail: `Sold ${sold} unit${sold === 1 ? '' : 's'} recently with only ${available} left in stock. Restock before you stock out.`,
          severity: 'warning',
          actionable: true,
          actionType: 'request_restock',
          cta: { label: 'Request restock', href: `/app/store?productId=${encodeURIComponent(inv.productId)}` },
          metric: { label: 'on hand', value: String(available) },
          relatedType: 'product',
          relatedId: inv.productId,
          sampleSize: sold,
        });
      }

      const views = a.productViews.get(inv.productId) ?? 0;
      if (views >= MIN_SAMPLES.views && sold === 0 && available > 0) {
        insights.push({
          id: `goods.high_views_low_checkout:${inv.productId}`,
          category: 'goods',
          title: `${inv.productName}: traffic without checkout`,
          detail: `${views} visitors viewed ${inv.productName} but no one checked out. Stock is fine — try a sharper offer or photo.`,
          severity: 'warning',
          actionable: true,
          actionType: 'improve_product_listing',
          cta: { label: 'Edit product', href: `/app/store?productId=${encodeURIComponent(inv.productId)}` },
          metric: { label: 'views', value: String(views) },
          relatedType: 'product',
          relatedId: inv.productId,
          sampleSize: views,
        });
      }

      if (
        sold === 0 &&
        inv.quantity >= MIN_SAMPLES.inventoryUnits &&
        inv.costPerUnit != null &&
        Number(inv.costPerUnit) > 0
      ) {
        const cashTied = inv.quantity * Number(inv.costPerUnit);
        insights.push({
          id: `goods.dead_stock:${inv.productId}`,
          category: 'goods',
          title: `${inv.productName} is dead stock`,
          detail: `${inv.quantity} unit${inv.quantity === 1 ? '' : 's'} sitting at ${formatMoney(cashTied, inv.currency)} of tied-up cash with no recent sales.`,
          severity: 'warning',
          actionable: true,
          actionType: 'discount_dead_stock',
          cta: { label: 'Edit product', href: `/app/store?productId=${encodeURIComponent(inv.productId)}` },
          metric: { label: 'tied up', value: formatMoney(cashTied, inv.currency) },
          relatedType: 'product',
          relatedId: inv.productId,
          sampleSize: inv.quantity,
        });
      }
    }

    return {
      summary: insights.length ? 'Inventory signal is live.' : 'Not enough inventory or sales data yet to derive goods insights.',
      insights,
    };
  }

  // ---------------------------------------------------------------------------
  // Narrative — AI gateway with strict typed contract + template fallback.
  // ---------------------------------------------------------------------------

  async generateNarrative(
    businessId: string,
    a: RawAggregate,
    categories: Record<InsightCategory, PresenceInsightCategoryBlock>,
  ): Promise<PresenceInsightSnapshotPayload['narrative']> {
    const fallback = this.buildTemplateNarrative(a, categories);
    if (process.env.AI_DISABLED === '1' || process.env.PRESENCE_INSIGHTS_AI === '0') {
      return fallback;
    }

    // Skip the AI call entirely when the snapshot is empty — no narrative to write.
    const allInsights = Object.values(categories).flatMap((c) => c.insights);
    if (allInsights.length === 0) return fallback;

    const compact = {
      windowDays: a.windowDays,
      currency: a.business.currency,
      totals: {
        revenue: a.totalRevenue,
        orders: a.ordersCount,
        bookings: sumMap(a.serviceBookingCounts),
        abandonedCheckouts: a.abandonedCheckouts,
        whatsappClicks: a.whatsappClicks,
        shareClicks: a.shareClicks,
      },
      insights: Object.fromEntries(
        Object.entries(categories).map(([k, v]) => [
          k,
          v.insights.slice(0, 6).map((i) => ({ title: i.title, detail: i.detail.slice(0, 240), severity: i.severity })),
        ]),
      ),
    };

    const systemPrompt = `You are KEYFLOW's storefront intelligence narrator for Caribbean small-business owners.
Return STRICT JSON matching:
{
  "headline": "string (max 90 chars, plain English, NO emoji)",
  "narrative": "string (2-3 sentences, plain English, NO emoji)",
  "categories": {
    "money": "string (1 sentence)",
    "time": "string (1 sentence)",
    "people": "string (1 sentence)",
    "services": "string (1 sentence)",
    "goods": "string (1 sentence)"
  }
}
Rules:
- Use ONLY the metrics and insights provided — never invent products, services, numbers or dates.
- Currency is ${a.business.currency}. Tone is calm, specific and encouraging.
- If a category has no insights, write a single short sentence stating "Not enough signal yet."`;
    const userPrompt = `Aggregates and insights:\n${JSON.stringify(compact)}`;

    try {
      const response = await this.gateway.complete({
        businessId,
        taskCategory: 'summarization',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        maxTokens: 600,
        expectedContract: 'presence_insights',
      });
      const parsed = safeJsonParse(response.content ?? '');
      if (parsed && typeof parsed === 'object') {
        const obj = parsed as PresenceInsightsContract;
        if (
          typeof obj.headline === 'string' &&
          typeof obj.narrative === 'string' &&
          obj.categories &&
          typeof obj.categories === 'object'
        ) {
          // Overwrite the per-category summaries with the AI versions when valid.
          for (const k of ['money', 'time', 'people', 'services', 'goods'] as InsightCategory[]) {
            const text = (obj.categories as Record<string, unknown>)[k];
            if (typeof text === 'string' && text.length > 0) categories[k].summary = text.slice(0, 280);
          }
          return {
            headline: obj.headline.slice(0, 140),
            body: obj.narrative.slice(0, 700),
            source: 'ai',
            modelUsed: response.model,
          };
        }
      }
    } catch (err) {
      this.logger.warn(
        `Presence insights AI narration failed for ${businessId}: ${(err as Error).message}`,
      );
    }
    return fallback;
  }

  buildTemplateNarrative(
    a: RawAggregate,
    categories: Record<InsightCategory, PresenceInsightCategoryBlock>,
  ): PresenceInsightSnapshotPayload['narrative'] {
    const cur = a.business.currency;
    const moneyCount = categories.money.insights.length;
    const goodsCount = categories.goods.insights.length;
    const headline =
      a.ordersCount > 0
        ? `${formatMoney(a.totalRevenue, cur)} in storefront revenue this period`
        : a.checkoutStarts > 0
          ? `Visitors are starting to convert`
          : `Your storefront is gathering signal`;
    const body = [
      a.ordersCount > 0
        ? `Your storefront produced ${formatMoney(a.totalRevenue, cur)} from ${a.ordersCount} paid order${a.ordersCount === 1 ? '' : 's'} in the last ${a.windowDays} days.`
        : `No paid orders in the last ${a.windowDays} days yet — keep sharing your link.`,
      moneyCount > 0
        ? `We surfaced ${moneyCount} money insight${moneyCount === 1 ? '' : 's'} you can act on.`
        : '',
      goodsCount > 0
        ? `Inventory has ${goodsCount} signal${goodsCount === 1 ? '' : 's'} worth a look.`
        : '',
    ]
      .filter(Boolean)
      .join(' ');
    return { headline, body, source: 'template', modelUsed: null };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function severityToPriority(s: InsightSeverity): number {
  switch (s) {
    case 'warning': return 2;
    case 'success': return 3;
    default: return 3;
  }
}

function formatMoney(amount: number, currency: string): string {
  return `${currency} ${Math.round(amount).toLocaleString()}`;
}

function topByValue(m: Map<string, number>): string | null {
  let best: { key: string; value: number } | null = null;
  for (const [k, v] of m.entries()) {
    if (v <= 0) continue;
    if (!best || v > best.value) best = { key: k, value: v };
  }
  return best?.key ?? null;
}

function sumMap(m: Map<string, number>): number {
  let sum = 0;
  for (const v of m.values()) sum += v;
  return sum;
}

function prettySource(s: string): string {
  const lower = s.toLowerCase();
  const map: Record<string, string> = {
    whatsapp: 'WhatsApp', wa: 'WhatsApp', instagram: 'Instagram', ig: 'Instagram',
    facebook: 'Facebook', fb: 'Facebook', google: 'Google', tiktok: 'TikTok',
    email: 'Email', direct: 'Direct', sms: 'SMS',
  };
  return map[lower] ?? s.charAt(0).toUpperCase() + s.slice(1);
}

const STOP_WORDS = new Set([
  'the','and','for','with','your','from','that','this','have','want','need','just','please','about','some','will',
  'are','was','you','our','can','any','what','when','where','how','who','why','which','they','them','their',
  'has','had','but','not','all','his','her','its','out','one','two','get','got','also','more','than','then',
]);

function topInquiryKeyword(texts: string[]): { term: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const t of texts) {
    const seen = new Set<string>();
    for (const word of t.toLowerCase().split(/[^a-z0-9]+/g)) {
      if (word.length < 4 || word.length > 24) continue;
      if (STOP_WORDS.has(word)) continue;
      if (seen.has(word)) continue;
      seen.add(word);
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  let best: { term: string; count: number } | null = null;
  for (const [term, count] of counts.entries()) {
    if (count < 3) continue;
    if (!best || count > best.count) best = { term, count };
  }
  return best;
}

function safeJsonParse(s: string): unknown {
  try {
    const cleaned = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function findInsight(
  snapshot: PresenceInsightSnapshotPayload,
  insightId: string,
): PresenceInsight | null {
  for (const block of Object.values(snapshot.categories)) {
    const m = block.insights.find((i) => i.id === insightId);
    if (m) return m;
  }
  return null;
}
