import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface StoreGraphMapping {
  productId: string;
  productName: string;
  serviceId: string | null;
  serviceName: string | null;
  isLive: boolean;
  priceDrift: boolean;
  durationDrift: boolean;
  commercePrice: number;
  servicePrice: number | null;
  commerceDuration: number | null;
  serviceDuration: number | null;
  category: string;
  imageUrl: string | null;
  isActive: boolean;
}

export interface StoreGraph {
  mappings: StoreGraphMapping[];
  liveCount: number;
  draftCount: number;
  driftCount: number;
  totalProducts: number;
  totalServices: number;
  serviceNameIndex: Record<string, string>;
}

export type ReadinessCategory = 'launch' | 'conversion' | 'merchandising' | 'promotion';
export type ReadinessSeverity = 'blocker' | 'warning' | 'tip';

export interface ReadinessItem {
  id: string;
  category: ReadinessCategory;
  severity: ReadinessSeverity;
  title: string;
  detail: string;
  actionLabel: string;
  actionTab: string;
  resolved: boolean;
}

export interface ReadinessScores {
  overall: number;
  launch: number;
  conversion: number;
  merchandising: number;
  promotion: number;
}

export interface RevenueSnapshot {
  totalRevenue30d: number;
  totalOrders30d: number;
  avgOrderValue: number;
  topProductRevenue: { productId: string; productName: string; revenue: number; orders: number }[];
  conversionRate: number | null;
}

export interface StoreReadinessResult {
  scores: ReadinessScores;
  items: ReadinessItem[];
  revenue: RevenueSnapshot;
  graph: StoreGraph;
}

interface CheckDef {
  id: string;
  category: ReadinessCategory;
  severity: ReadinessSeverity;
  title: string;
  failDetail: string;
  actionLabel: string;
  actionTab: string;
  passed: boolean;
}

@Injectable()
export class StoreReadinessService {
  private readonly logger = new Logger(StoreReadinessService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  async backfillSourceProductIds(businessId: string): Promise<number> {
    const services = await this.db.service.findMany({
      where: { businessId, deletedAt: null, sourceProductId: null },
      select: { id: true, name: true },
    });
    if (services.length === 0) return 0;

    const products = await this.db.product.findMany({
      where: { businessId, deletedAt: null },
      select: { id: true, name: true },
    });

    const productByName = new Map<string, string>();
    for (const p of products) {
      productByName.set(p.name.toLowerCase().trim(), p.id);
    }

    const alreadyLinked = new Set(
      (await this.db.service.findMany({
        where: { businessId, deletedAt: null, sourceProductId: { not: null } },
        select: { sourceProductId: true },
      })).map(s => s.sourceProductId!),
    );

    let backfilled = 0;
    for (const svc of services) {
      const productId = productByName.get(svc.name.toLowerCase().trim());
      if (productId && !alreadyLinked.has(productId)) {
        await this.db.service.update({
          where: { id: svc.id },
          data: { sourceProductId: productId },
        });
        alreadyLinked.add(productId);
        backfilled++;
      }
    }

    if (backfilled > 0) {
      this.logger.log(`Backfilled sourceProductId for ${backfilled} services in business ${businessId}`);
    }
    return backfilled;
  }

  async buildStoreGraph(businessId: string): Promise<StoreGraph> {
    await this.backfillSourceProductIds(businessId);

    const [products, services] = await Promise.all([
      this.db.product.findMany({
        where: { businessId, deletedAt: null },
        select: {
          id: true, name: true, price: true, category: true,
          duration: true, imageUrl: true, isActive: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.db.service.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, name: true, price: true, duration: true, sourceProductId: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const serviceByProductId = new Map<string, typeof services[0]>();
    for (const svc of services) {
      if (svc.sourceProductId) {
        serviceByProductId.set(svc.sourceProductId, svc);
      }
    }

    const serviceNameIndex: Record<string, string> = {};
    for (const svc of services) {
      serviceNameIndex[svc.id] = svc.name;
    }

    const mappings: StoreGraphMapping[] = [];
    let liveCount = 0;
    let driftCount = 0;

    for (const product of products) {
      const matchedService = serviceByProductId.get(product.id) ?? null;
      const isLive = !!matchedService;

      const priceDrift = isLive
        ? Math.abs(product.price - matchedService!.price) > 0.01
        : false;
      const durationDrift = isLive && product.duration != null && matchedService!.duration != null
        ? product.duration !== matchedService!.duration
        : false;

      if (isLive) liveCount++;
      if (priceDrift || durationDrift) driftCount++;

      mappings.push({
        productId: product.id,
        productName: product.name,
        serviceId: matchedService?.id ?? null,
        serviceName: matchedService?.name ?? null,
        isLive,
        priceDrift,
        durationDrift,
        commercePrice: product.price,
        servicePrice: matchedService?.price ?? null,
        commerceDuration: product.duration,
        serviceDuration: matchedService?.duration ?? null,
        category: product.category,
        imageUrl: product.imageUrl,
        isActive: product.isActive,
      });
    }

    return {
      mappings,
      liveCount,
      draftCount: products.length - liveCount,
      driftCount,
      totalProducts: products.length,
      totalServices: services.length,
      serviceNameIndex,
    };
  }

  async getReadiness(businessId: string): Promise<StoreReadinessResult> {
    const [graph, business, orderData] = await Promise.all([
      this.buildStoreGraph(businessId),
      this.db.business.findUnique({
        where: { id: businessId },
        select: {
          name: true, slug: true, logoUrl: true, phone: true, email: true,
          storeEnabled: true, businessHours: true,
          primaryColor: true, secondaryColor: true,
          metaData: true,
        },
      }),
      this.getRevenueSnapshot(businessId),
    ]);

    const meta = (business?.metaData as Record<string, any>) ?? {};
    const config = meta.storefront ?? {};
    const hero = config.hero ?? {};
    const seo = config.seo ?? {};
    const socialProof = config.socialProof ?? {};
    const policies = config.policies ?? {};
    const faqEntries = config.faqEntries ?? [];
    const contact = config.contact ?? {};

    const storeEnabled = business?.storeEnabled ?? false;
    const hasSlug = !!business?.slug;
    const hasLogo = !!business?.logoUrl;
    const hasHeroImage = !!(hero.imageUrl || hero.coverImageUrl);
    const hasHeroHeadline = !!(hero.headline && hero.headline.trim().length > 0);
    const hasHeroCta = !!(hero.ctaLabel && hero.ctaLabel.trim().length > 0);
    const hasMetaTitle = !!(seo.metaTitle && seo.metaTitle.trim().length > 0);
    const hasMetaDescription = !!(seo.metaDescription && seo.metaDescription.trim().length > 0);
    const hasTestimonials = Array.isArray(socialProof.testimonials) && socialProof.testimonials.length > 0;
    const hasPolicies = policies ? Object.values(policies).some((p: any) => (p as any)?.enabled) : false;
    const hasFaq = Array.isArray(faqEntries) && faqEntries.length > 0;
    const hasPhone = !!business?.phone;
    const hasEmail = !!business?.email;
    const hasContact = hasPhone || hasEmail || !!contact.whatsapp;
    const hoursConfigured = business?.businessHours
      ? Object.values(business.businessHours as Record<string, any>).some((h: any) => h?.enabled)
      : false;
    const hasProducts = graph.liveCount > 0 || graph.totalServices > 0;
    const liveWithImagesCount = graph.mappings.filter(m => m.isLive && m.imageUrl).length;
    const liveWithImagesPct = graph.liveCount > 0 ? (liveWithImagesCount / graph.liveCount) * 100 : 100;

    const deliveryConfig = meta.deliveryConfig ?? {};
    const hasDeliveryMethod = Object.values(deliveryConfig).some((m: any) => m?.enabled);

    const paymentConfig = meta.paymentConfig ?? {};
    const hasPaymentMethod = !!(paymentConfig.wipay?.enabled || paymentConfig.paypal?.enabled
      || paymentConfig.googlepay?.enabled || paymentConfig.cash?.enabled || paymentConfig.bankTransfer?.enabled);

    const hasBranding = !!business?.primaryColor;
    const hasDescription = !!(hero.subheadline && hero.subheadline.trim().length > 10);

    const liveWithDescCount = graph.mappings.filter(m => m.isLive).length > 0
      ? graph.mappings.filter(m => m.isLive && m.productName.length > 0).length : 0;
    const liveActiveCount = graph.mappings.filter(m => m.isLive && m.isActive).length;
    const hasInactiveItems = graph.liveCount > 0 && liveActiveCount < graph.liveCount;

    const checks: CheckDef[] = [
      { id: 'store-offline', category: 'launch', severity: 'blocker', title: 'Store is Offline', failDetail: 'Your storefront is in draft mode. Customers cannot see or order from it.', actionLabel: 'Go Live', actionTab: 'launch', passed: storeEnabled },
      { id: 'no-slug', category: 'launch', severity: 'blocker', title: 'No Store URL', failDetail: 'Set a custom URL slug so customers can find your store.', actionLabel: 'Set URL', actionTab: 'launch', passed: hasSlug },
      { id: 'no-products', category: 'launch', severity: 'blocker', title: 'Empty Catalog', failDetail: 'Your store has no live products or services. Add items so visitors can browse and purchase.', actionLabel: 'Add Items', actionTab: 'catalog', passed: hasProducts },
      { id: 'no-payment', category: 'launch', severity: 'blocker', title: 'No Payment Method', failDetail: 'Customers cannot pay without a payment method. Configure WiPay, PayPal, or bank transfer.', actionLabel: 'Setup Payments', actionTab: 'operations', passed: hasPaymentMethod },
      { id: 'no-delivery', category: 'launch', severity: 'warning', title: 'No Delivery Method', failDetail: 'Set up at least one delivery or pickup method so customers can receive their orders.', actionLabel: 'Setup Delivery', actionTab: 'operations', passed: hasDeliveryMethod },
      { id: 'no-hero-image', category: 'conversion', severity: 'warning', title: 'No Hero Image', failDetail: 'Stores with hero banners see up to 40% higher engagement. Upload one in Design.', actionLabel: 'Add Hero', actionTab: 'design', passed: hasHeroImage },
      { id: 'no-hero-headline', category: 'conversion', severity: 'warning', title: 'Missing Hero Headline', failDetail: 'A compelling headline is the first thing visitors read. AI can generate one for you.', actionLabel: 'Write Headline', actionTab: 'design', passed: hasHeroHeadline },
      { id: 'no-hero-cta', category: 'conversion', severity: 'warning', title: 'No Call-to-Action', failDetail: 'Add a CTA button to guide visitors toward purchasing or booking.', actionLabel: 'Add CTA', actionTab: 'design', passed: hasHeroCta },
      { id: 'no-description', category: 'conversion', severity: 'warning', title: 'No Store Description', failDetail: 'A sub-headline or description tells visitors what you offer in seconds.', actionLabel: 'Add Description', actionTab: 'design', passed: hasDescription },
      { id: 'no-logo', category: 'merchandising', severity: 'warning', title: 'No Logo', failDetail: 'A branded logo builds trust and recognition with customers.', actionLabel: 'Upload Logo', actionTab: 'design', passed: hasLogo },
      { id: 'no-branding', category: 'merchandising', severity: 'tip', title: 'No Brand Colors', failDetail: 'Custom brand colors make your store memorable and professional.', actionLabel: 'Set Colors', actionTab: 'design', passed: hasBranding },
      { id: 'no-testimonials', category: 'conversion', severity: 'warning', title: 'No Social Proof', failDetail: '92% of consumers read reviews before purchasing. Add testimonials to boost trust.', actionLabel: 'Add Testimonials', actionTab: 'merchandising', passed: hasTestimonials },
      { id: 'weak-seo', category: 'promotion', severity: 'warning', title: 'SEO Not Configured', failDetail: 'Missing meta title or description reduces search visibility.', actionLabel: 'Configure SEO', actionTab: 'merchandising', passed: hasMetaTitle && hasMetaDescription },
      { id: 'no-hours', category: 'merchandising', severity: 'tip', title: 'Business Hours Not Set', failDetail: 'Business hours help customers plan visits and improve local SEO.', actionLabel: 'Set Hours', actionTab: 'operations', passed: hoursConfigured },
      { id: 'no-contact', category: 'conversion', severity: 'warning', title: 'No Contact Info', failDetail: 'Customers need a way to reach you. Add phone, email, or WhatsApp.', actionLabel: 'Add Contact', actionTab: 'operations', passed: hasContact },
      { id: 'no-policies', category: 'conversion', severity: 'tip', title: 'No Store Policies', failDetail: 'Refund and privacy policies are top trust signals. AI can draft them.', actionLabel: 'Generate Policies', actionTab: 'merchandising', passed: hasPolicies },
      { id: 'no-faq', category: 'merchandising', severity: 'tip', title: 'No FAQ Content', failDetail: 'FAQ reduces support load and improves SEO with long-tail keywords.', actionLabel: 'Generate FAQ', actionTab: 'merchandising', passed: hasFaq },
      { id: 'price-drift', category: 'merchandising', severity: 'warning', title: `${graph.driftCount} Price/Duration Drift${graph.driftCount > 1 ? 's' : ''}`, failDetail: 'Some store items have different prices than their catalog source. Sync to fix.', actionLabel: 'Sync Catalog', actionTab: 'catalog', passed: graph.driftCount === 0 },
      { id: 'low-images', category: 'merchandising', severity: 'warning', title: 'Low Image Coverage', failDetail: `Only ${Math.round(liveWithImagesPct)}% of live items have images. Products with images convert 2× better.`, actionLabel: 'Add Images', actionTab: 'catalog', passed: liveWithImagesPct >= 50 || graph.liveCount === 0 },
      { id: 'inactive-items', category: 'merchandising', severity: 'warning', title: 'Inactive Items in Store', failDetail: 'Some store items are marked inactive in your catalog. Deactivated items confuse customers.', actionLabel: 'Review Catalog', actionTab: 'catalog', passed: !hasInactiveItems },
    ];

    const items: ReadinessItem[] = checks.map(c => ({
      id: c.id,
      category: c.category,
      severity: c.severity,
      title: c.title,
      detail: c.failDetail,
      actionLabel: c.actionLabel,
      actionTab: c.actionTab,
      resolved: c.passed,
    }));

    const categoryScore = (cat: ReadinessCategory) => {
      const catItems = items.filter(i => i.category === cat);
      if (catItems.length === 0) return 100;
      const resolved = catItems.filter(i => i.resolved).length;
      return Math.round((resolved / catItems.length) * 100);
    };

    const scores: ReadinessScores = {
      overall: 0,
      launch: categoryScore('launch'),
      conversion: categoryScore('conversion'),
      merchandising: categoryScore('merchandising'),
      promotion: categoryScore('promotion'),
    };
    scores.overall = Math.round(
      scores.launch * 0.35 +
      scores.conversion * 0.30 +
      scores.merchandising * 0.20 +
      scores.promotion * 0.15
    );

    return {
      scores,
      items,
      revenue: orderData,
      graph,
    };
  }

  private async getRevenueSnapshot(businessId: string): Promise<RevenueSnapshot> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);

    try {
      const orders = await this.db.marketplaceOrder.findMany({
        where: {
          businessId,
          createdAt: { gte: thirtyDaysAgo },
          status: { notIn: ['CANCELLED', 'REFUNDED'] },
        },
        select: {
          id: true, total: true,
          items: {
            select: { productId: true, total: true, quantity: true, product: { select: { name: true } } },
          },
        },
      });

      const totalRevenue = orders.reduce((sum, o) => sum + Number(o.total ?? 0), 0);
      const totalOrders = orders.length;
      const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

      const productMap = new Map<string, { productName: string; revenue: number; orders: number }>();
      for (const order of orders) {
        for (const item of order.items) {
          if (!item.productId) continue;
          const existing = productMap.get(item.productId) ?? { productName: item.product?.name ?? 'Unknown', revenue: 0, orders: 0 };
          existing.revenue += Number(item.total ?? 0);
          existing.orders += item.quantity;
          productMap.set(item.productId, existing);
        }
      }

      const topProductRevenue = [...productMap.entries()]
        .map(([productId, data]) => ({ productId, ...data }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5);

      const meta = (await this.db.business.findUnique({
        where: { id: businessId },
        select: { metaData: true },
      }))?.metaData as Record<string, any> ?? {};

      interface StorefrontEvent { type: string; timestamp: string | number }
      const storefrontEvents: StorefrontEvent[] = meta.storefrontEvents ?? [];
      const recentEvents = storefrontEvents.filter(e => new Date(e.timestamp).getTime() > thirtyDaysAgo.getTime());
      const pageViews = recentEvents.filter(e => e.type === 'page_view').length;

      const conversionRate = pageViews > 0 ? (totalOrders / pageViews) * 100 : null;

      return { totalRevenue30d: totalRevenue, totalOrders30d: totalOrders, avgOrderValue, topProductRevenue, conversionRate };
    } catch (e) {
      this.logger.warn(`Failed to compute revenue snapshot: ${(e as Error).message}`);
      return { totalRevenue30d: 0, totalOrders30d: 0, avgOrderValue: 0, topProductRevenue: [], conversionRate: null };
    }
  }
}
