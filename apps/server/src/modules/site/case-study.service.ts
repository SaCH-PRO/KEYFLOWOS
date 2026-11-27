import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { lockBusinessMeta, type BusinessMetaTx } from '../../core/prisma/business-meta';
import { memberModuleLevel, type ModuleLevelActor } from '../../core/auth/member-module-level';
import { LEVEL_RANK, rankOf } from '../../core/authority/module-vocabulary';

const REVENUE_OR_PAID_ORDER_METRIC_KEYS = [
  'recentRevenue',
  'priorRevenue',
  'revenueGrowthPct',
  'recentOrders',
  'priorOrders',
  'orderGrowthPct',
  'topProduct',
] as const;

const GENERATED_HEADLINE_RE =
  /^(.*?) ((?:grew online orders \d+%|grew revenue \d+%|grew bookings \d+%|completed \d+ online orders|booked \d+ appointments|recorded storefront activity)(?: and (?:grew online orders \d+%|grew revenue \d+%|grew bookings \d+%|completed \d+ online orders|booked \d+ appointments|recorded storefront activity))*) in (\d+) days$/i;

const SAFE_FALLBACK_HEADLINE_RE =
  /^(?:Booking activity grew \d+% over the last \d+ days|Booked \d+ appointments over the last \d+ days|Business activity summary \(last \d+ days\))$/;

const PAID_ORDER_OR_REVENUE_CLAUSE_RE =
  /^(?:grew revenue \d+%|grew online orders \d+%|completed \d+ online orders)$/i;

const MONETARY_OR_ORDER_KEYWORDS_RE =
  /[$£€¥₹₦₵]|\b(?:revenue|sales|orders?|earned|earning|earnings|gross|net|income|profit|profits|aov|gmv|paid|turnover|dollars?|cents?|cash|billing|billed|invoices?|receipts?|usd|ttd|eur|gbp|cad|jmd|bbd|xcd|bzd|gyd|srd|bsd|kyd|aud|nzd)\b/i;

const ISO_CURRENCY_AMOUNT_RE = /(?:\b[A-Z]{3}\s*[\d,.]|[\d,.]\s*[A-Z]{3}\b)/;

const UNPARSED_NUMERIC_OR_MULTILINE_RE = /\d|[\r\n]/;

/**
 * Whether a headline mentions money, revenue, sales, orders, or ISO currency
 * figures (used to fail closed on custom/legacy case-study headlines).
 */
export function isMonetaryOrOrderHeadline(headline: string): boolean {
  return MONETARY_OR_ORDER_KEYWORDS_RE.test(headline) || ISO_CURRENCY_AMOUNT_RE.test(headline);
}

/**
 * Whether a stored case study carries revenue or paid-order metrics/copy.
 * Used to preserve owner-generated revenue snapshots on non-revenue refresh
 * and to refuse publishing revenue-bearing drafts without `revenue:read`.
 */
export function hasRevenueMetrics(study: CaseStudy): boolean {
  const m = study.metrics as Record<string, unknown> | undefined;
  if (m) {
    for (const key of REVENUE_OR_PAID_ORDER_METRIC_KEYS) {
      if (m[key] !== undefined) return true;
    }
  }
  if (typeof study.headline !== 'string') return false;
  if (isMonetaryOrOrderHeadline(study.headline)) return true;
  if (
    !GENERATED_HEADLINE_RE.test(study.headline) &&
    !SAFE_FALLBACK_HEADLINE_RE.test(study.headline) &&
    UNPARSED_NUMERIC_OR_MULTILINE_RE.test(study.headline)
  ) {
    return true;
  }
  return false;
}

/**
 * Builds a strictly allow-listed non-money summary headline from booking metrics
 * when an unparsed/custom/legacy headline cannot be safely stripped.
 */
function buildAllowListedNonRevenueHeadline(metrics: CaseStudyMetrics): string {
  if (typeof metrics.bookingGrowthPct === 'number' && metrics.bookingGrowthPct > 0) {
    return `Booking activity grew ${metrics.bookingGrowthPct}% over the last ${metrics.windowDays} days`;
  }
  if (metrics.recentBookings > 0) {
    return `Booked ${metrics.recentBookings} appointments over the last ${metrics.windowDays} days`;
  }
  return `Business activity summary (last ${metrics.windowDays} days)`;
}

/**
 * Strips paid-order and revenue growth clauses from a case-study headline for
 * callers below `revenue:read`, preserving non-money booking copy cleanly.
 *
 * Fails closed on any non-canonical (custom/legacy/multi-line) headline that
 * carried revenue metrics, matches monetary/sales/order terms or currency
 * figures, or contains unparsed digits/line breaks by reconstructing strictly
 * from the non-money booking allow-list rather than returning regex-patched prose.
 */
export function sanitizeHeadlineForNonRevenueReader(
  headline: string,
  metrics: CaseStudyMetrics,
  hadRevenueMetrics = false,
): string {
  const generatedMatch = GENERATED_HEADLINE_RE.exec(headline);
  if (generatedMatch) {
    const [, prefix, clausesRaw, days] = generatedMatch;
    if (!isMonetaryOrOrderHeadline(prefix)) {
      const kept = clausesRaw
        .split(/ and /i)
        .filter((clause) => !PAID_ORDER_OR_REVENUE_CLAUSE_RE.test(clause.trim()));
      const fallbackClause =
        metrics.recentBookings > 0
          ? `booked ${metrics.recentBookings} appointments`
          : 'recorded storefront activity';
      const summary = kept.length > 0 ? kept.join(' and ') : fallbackClause;
      return `${prefix} ${summary} in ${days} days`;
    }
  }

  if (SAFE_FALLBACK_HEADLINE_RE.test(headline)) {
    return headline;
  }

  if (
    hadRevenueMetrics ||
    isMonetaryOrOrderHeadline(headline) ||
    UNPARSED_NUMERIC_OR_MULTILINE_RE.test(headline)
  ) {
    return buildAllowListedNonRevenueHeadline(metrics);
  }

  return headline;
}

/**
 * FU-CASE-STUDY-REVENUE (P139, D-100/D-234): allow-list projection of a case
 * study for callers below `revenue:read`. Withholds `recentRevenue`,
 * `priorRevenue`, `revenueGrowthPct`, `recentOrders`, `priorOrders`,
 * `orderGrowthPct`, `topProduct` (keys absent, never zero), and strips
 * revenue/paid-order clauses from `headline` (failing closed to an allow-listed
 * booking summary on non-canonical/monetary headlines) while keeping `currency`
 * and all non-money booking/study fields intact.
 */
export function redactCaseStudyForNonRevenueReader(study: CaseStudy): CaseStudy {
  const hadRevenue = hasRevenueMetrics(study);
  const m = study.metrics;
  const redactedMetrics: CaseStudyMetrics = {
    windowDays: m.windowDays,
    currency: m.currency,
    recentBookings: m.recentBookings,
    priorBookings: m.priorBookings,
    bookingGrowthPct: m.bookingGrowthPct,
    topService: m.topService,
  };
  return {
    ...study,
    headline: sanitizeHeadlineForNonRevenueReader(study.headline, redactedMetrics, hadRevenue),
    metrics: redactedMetrics,
  };
}

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

  /**
   * Canonical `revenue:read` check matching ModuleScopeGuard's reading
   * (`memberModuleLevel`): fails closed when `actor` is missing/null, has no
   * membership in `businessId`, has JSON array scopes `[]`, or has explicit
   * `revenue: 'none'` (including OWNER per D-114/D-140).
   */
  async readsRevenue(businessId: string, actor: ModuleLevelActor): Promise<boolean> {
    return rankOf(await memberModuleLevel(this.prisma, businessId, actor, 'revenue')) >= LEVEL_RANK.read;
  }

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

  /**
   * FOLLOW3-D13: change the case studies under the business row lock
   * (lockBusinessMeta). metaData is read, changed by `change` and written back
   * in one transaction, so a metaData write that commits meanwhile (another
   * publish, an owner's cleared payment secret) is neither undone by this one
   * nor undoes it (RED-before MW-13: one of two concurrent publishes was lost).
   * What `change` throws (a missing study) rolls the transaction back.
   */
  private async changeCaseStudies<T>(businessId: string, change: (caseStudies: CaseStudy[]) => T): Promise<T> {
    return this.prisma.client.$transaction(async (tx) => {
      const business = await lockBusinessMeta(tx, businessId);
      if (!business) throw new NotFoundException('Business not found');
      const meta = (business.metaData as Record<string, unknown> | null) ?? {};
      const caseStudies = Array.isArray(meta.caseStudies) ? [...(meta.caseStudies as CaseStudy[])] : [];
      const result = change(caseStudies);
      await this.saveMeta(tx, businessId, meta, caseStudies);
      return result;
    });
  }

  /** Writes `caseStudies` over `meta`: the metaData changeCaseStudies read under the row lock on `tx`. */
  private async saveMeta(tx: BusinessMetaTx, businessId: string, meta: Record<string, unknown>, caseStudies: CaseStudy[]) {
    await tx.business.update({
      where: { id: businessId },
      data: { metaData: { ...meta, caseStudies } as never },
    });
  }

  /**
   * Generates (or refreshes) a case-study draft from real platform
   * data over the trailing 60-day window. Returns the draft for
   * review; nothing is published until `publish()` is called.
   *
   * FU-CASE-STUDY-REVENUE (P139, D-100/D-234): when the acting member lacks
   * `revenue:read` (or `actor` is missing/null — fail closed), all paid-order
   * queries are skipped, revenue/paid-order fields are withheld from the
   * response, and any pre-existing owner-generated revenue fields on the
   * persisted study are preserved rather than wiped out.
   */
  async generateDraft(businessId: string, actor?: ModuleLevelActor) {
    const readsRevenue = await this.readsRevenue(businessId, actor);

    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { id: true, name: true, city: true, country: true, industry: true, slug: true, currency: true },
    });
    if (!business) throw new NotFoundException('Business not found');

    const now = new Date();
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const priorWindowStart = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000);

    // Real platform metrics — paid-order queries run ONLY when the caller holds revenue:read.
    const [recentOrders, priorOrdersList, recentBookings, priorBookings, topService, topProduct] = await Promise.all([
      readsRevenue
        ? this.prisma.client.marketplaceOrder.findMany({
            where: { businessId, createdAt: { gte: sixtyDaysAgo }, paymentStatus: { in: ['PAID', 'COMPLETED'] } },
            select: { total: true, currency: true },
          })
        : Promise.resolve([] as Array<{ total: number | null; currency: string | null }>),
      readsRevenue
        ? this.prisma.client.marketplaceOrder.findMany({
            where: { businessId, createdAt: { gte: priorWindowStart, lt: sixtyDaysAgo }, paymentStatus: { in: ['PAID', 'COMPLETED'] } },
            select: { total: true },
          })
        : Promise.resolve([] as Array<{ total: number | null }>),
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
      readsRevenue
        ? this.prisma.client.marketplaceOrderItem.groupBy({
            by: ['productId'],
            where: { order: { businessId, createdAt: { gte: sixtyDaysAgo }, paymentStatus: { in: ['PAID', 'COMPLETED'] } } },
            _sum: { quantity: true },
            orderBy: { _sum: { quantity: 'desc' } },
            take: 1,
          }).catch(() => [] as Array<{ productId: string; _sum: { quantity: number | null } }>)
        : Promise.resolve([] as Array<{ productId: string; _sum: { quantity: number | null } }>),
    ]);

    const bookingGrowth = priorBookings > 0 ? Math.round(((recentBookings - priorBookings) / priorBookings) * 100) : null;
    const currency = (readsRevenue ? recentOrders[0]?.currency : null) ?? business.currency ?? 'TTD';

    const [topServiceName, topProductName] = await Promise.all([
      topService[0]?.serviceId
        ? this.prisma.client.service.findUnique({ where: { id: topService[0].serviceId }, select: { name: true } }).then((s) => s?.name ?? null)
        : Promise.resolve(null),
      readsRevenue && topProduct[0]?.productId
        ? this.prisma.client.product.findUnique({ where: { id: topProduct[0].productId }, select: { name: true } }).then((p) => p?.name ?? null)
        : Promise.resolve(null),
    ]);

    const recentOrderCount = recentOrders.length;

    // We refuse to generate a case study with no underlying activity —
    // synthetic narratives are explicitly out of scope.
    if (readsRevenue ? (recentOrderCount === 0 && recentBookings === 0) : recentBookings === 0) {
      throw new BadRequestException(
        readsRevenue
          ? 'No completed orders or confirmed bookings in the last 60 days. Case studies must be backed by real platform activity.'
          : 'No confirmed bookings in the last 60 days. Case studies must be backed by real platform activity.',
      );
    }

    const location = [business.city, business.country].filter(Boolean).join(', ');
    const headlineParts: string[] = [];
    let metrics: CaseStudyMetrics;

    if (readsRevenue) {
      const recentRevenue = recentOrders.reduce((s, o) => s + (o.total ?? 0), 0);
      const priorRevenue = priorOrdersList.reduce((s, o) => s + (o.total ?? 0), 0);
      const priorOrders = priorOrdersList.length;
      const orderGrowth = priorOrders > 0 ? Math.round(((recentOrderCount - priorOrders) / priorOrders) * 100) : null;
      const revenueGrowth = priorRevenue > 0 ? Math.round(((recentRevenue - priorRevenue) / priorRevenue) * 100) : null;

      if (orderGrowth !== null && orderGrowth > 0) headlineParts.push(`grew online orders ${orderGrowth}%`);
      if (revenueGrowth !== null && revenueGrowth > 0) headlineParts.push(`grew revenue ${revenueGrowth}%`);
      if (bookingGrowth !== null && bookingGrowth > 0) headlineParts.push(`grew bookings ${bookingGrowth}%`);
      if (headlineParts.length === 0 && recentOrderCount > 0) headlineParts.push(`completed ${recentOrderCount} online orders`);
      if (headlineParts.length === 0 && recentBookings > 0) headlineParts.push(`booked ${recentBookings} appointments`);

      metrics = {
        windowDays: 60,
        recentOrders: recentOrderCount,
        priorOrders,
        recentRevenue,
        priorRevenue,
        currency,
        recentBookings,
        priorBookings,
        orderGrowthPct: orderGrowth,
        revenueGrowthPct: revenueGrowth,
        bookingGrowthPct: bookingGrowth,
        topService: topServiceName,
        topProduct: topProductName,
      };
    } else {
      if (bookingGrowth !== null && bookingGrowth > 0) headlineParts.push(`grew bookings ${bookingGrowth}%`);
      if (headlineParts.length === 0 && recentBookings > 0) headlineParts.push(`booked ${recentBookings} appointments`);

      metrics = {
        windowDays: 60,
        currency,
        recentBookings,
        priorBookings,
        bookingGrowthPct: bookingGrowth,
        topService: topServiceName,
      };
    }

    const headline = `${business.name}${location ? ` (${location})` : ''} ${headlineParts.join(' and ')} in 60 days`;

    const draft: CaseStudy = {
      id: `cs_${sixtyDaysAgo.getFullYear()}_${sixtyDaysAgo.getMonth() + 1}`,
      businessId,
      headline,
      location,
      industry: business.industry ?? null,
      metrics,
      status: 'draft',
      consent: false,
      consentedAt: null,
      consentedBy: null,
      generatedAt: now.toISOString(),
      publishedAt: null,
    };

    const saved = await this.changeCaseStudies(businessId, (caseStudies) => {
      const idx = caseStudies.findIndex((c) => c.id === draft.id);
      if (idx >= 0) {
        const existing = caseStudies[idx];
        // Preserve consent state if a previous version was already approved
        // by the business owner — re-generation keeps the publication live.
        draft.consent = existing.consent ?? false;
        draft.consentedAt = existing.consentedAt ?? null;
        draft.consentedBy = existing.consentedBy ?? null;
        draft.status = existing.status === 'published' ? 'published' : 'draft';
        draft.publishedAt = existing.publishedAt ?? null;

        if (!readsRevenue && hasRevenueMetrics(existing)) {
          // Do not clobber existing owner-generated revenue metrics when a
          // non-revenue member refreshes booking stats on the same period id.
          const merged: CaseStudy = {
            ...draft,
            headline: existing.headline,
            metrics: {
              ...existing.metrics,
              windowDays: draft.metrics.windowDays,
              recentBookings: draft.metrics.recentBookings,
              priorBookings: draft.metrics.priorBookings,
              bookingGrowthPct: draft.metrics.bookingGrowthPct,
              topService: draft.metrics.topService,
            },
          };
          caseStudies[idx] = merged;
          return merged;
        }
        caseStudies[idx] = draft;
      } else {
        caseStudies.push(draft);
      }
      return draft;
    });

    return readsRevenue ? saved : redactCaseStudyForNonRevenueReader(saved);
  }

  async list(businessId: string, actor?: ModuleLevelActor) {
    const readsRevenue = await this.readsRevenue(businessId, actor);
    const { caseStudies } = await this.loadMeta(businessId);
    return readsRevenue ? caseStudies : caseStudies.map(redactCaseStudyForNonRevenueReader);
  }

  async publish(businessId: string, caseStudyId: string, opts: { consent: boolean; userId?: string }) {
    return this.publishForReader(businessId, caseStudyId, {
      consent: opts.consent,
      actor: opts.userId ? { id: opts.userId } : undefined,
    });
  }

  /**
   * Reader-scoped publish for HTTP callers (`SiteController.publishCaseStudy`).
   * Refuses publishing a revenue-bearing draft without `revenue:read` (403) so
   * a `revenue:none` member cannot leak private revenue numbers onto the
   * unauthenticated public storefront, and withholds revenue fields in the
   * response below `revenue:read`.
   */
  async publishForReader(
    businessId: string,
    caseStudyId: string,
    opts: { consent: boolean; actor: ModuleLevelActor },
  ) {
    if (!opts.consent) {
      throw new ForbiddenException('Explicit consent is required before publishing a case study.');
    }
    const readsRevenue = await this.readsRevenue(businessId, opts.actor);
    const updated = await this.changeCaseStudies(businessId, (caseStudies) => {
      const idx = caseStudies.findIndex((c) => c.id === caseStudyId);
      if (idx < 0) throw new NotFoundException('Case study not found');
      if (!readsRevenue && hasRevenueMetrics(caseStudies[idx])) {
        throw new ForbiddenException(
          'Insufficient permissions: publishing a case study with revenue metrics requires revenue read access',
        );
      }
      caseStudies[idx] = {
        ...caseStudies[idx],
        consent: true,
        consentedAt: new Date().toISOString(),
        consentedBy: opts.actor?.id ?? null,
        status: 'published',
        publishedAt: new Date().toISOString(),
      };
      return caseStudies[idx];
    });
    return readsRevenue ? updated : redactCaseStudyForNonRevenueReader(updated);
  }

  async unpublish(businessId: string, caseStudyId: string, actor?: ModuleLevelActor) {
    const readsRevenue = await this.readsRevenue(businessId, actor);
    const updated = await this.changeCaseStudies(businessId, (caseStudies) => {
      const idx = caseStudies.findIndex((c) => c.id === caseStudyId);
      if (idx < 0) throw new NotFoundException('Case study not found');
      caseStudies[idx] = { ...caseStudies[idx], status: 'draft', publishedAt: null };
      return caseStudies[idx];
    });
    return readsRevenue ? updated : redactCaseStudyForNonRevenueReader(updated);
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

export type CaseStudyMetrics = {
  windowDays: number;
  recentOrders?: number;
  priorOrders?: number;
  recentRevenue?: number;
  priorRevenue?: number;
  currency: string;
  recentBookings: number;
  priorBookings: number;
  orderGrowthPct?: number | null;
  revenueGrowthPct?: number | null;
  bookingGrowthPct: number | null;
  topService: string | null;
  topProduct?: string | null;
};

export type CaseStudy = {
  id: string;
  businessId: string;
  headline: string;
  location: string;
  industry: string | null;
  metrics: CaseStudyMetrics;
  status: 'draft' | 'published';
  consent: boolean;
  consentedAt: string | null;
  consentedBy: string | null;
  generatedAt: string;
  publishedAt: string | null;
};
