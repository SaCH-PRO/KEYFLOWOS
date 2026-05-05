import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export type RevenueReportPreset =
  | 'by-source'
  | 'by-contact'
  | 'by-product'
  | 'quote-conversion'
  | 'days-to-pay'
  | 'aging-buckets'
  | 'collected-vs-expected'
  | 'recurring-expected';

export interface RevenueReportRange {
  start: Date;
  end: Date;
}

interface RollupCacheEntry {
  builtAt: number;
  bySource: BySourceReport;
  byContact: ByContactReport;
  byProduct: ByProductReport;
  daysToPay: DaysToPayReport;
}

const ROLLUP_TTL_MS = 24 * 60 * 60 * 1000;

export interface BySourceRow {
  source: string;
  channel: 'campaign' | 'referral' | 'staff' | 'channel' | 'unknown';
  revenue: number;
  invoiceCount: number;
}

export interface BySourceReport {
  rows: BySourceRow[];
  totalRevenue: number;
  currency: string;
}

export interface ByContactRow {
  contactId: string | null;
  name: string;
  revenue: number;
  invoiceCount: number;
  avgInvoice: number;
  lastPaymentAt: string | null;
}

export interface ByContactReport {
  rows: ByContactRow[];
  totalRevenue: number;
  currency: string;
}

export interface ByProductRow {
  productId: string | null;
  name: string;
  revenue: number;
  unitsSold: number;
  invoiceCount: number;
  category: 'product' | 'service' | 'unmapped';
}

export interface ByProductReport {
  rows: ByProductRow[];
  totalRevenue: number;
  currency: string;
}

export interface QuoteConversionReport {
  totals: {
    quotesCreated: number;
    quotesSent: number;
    quotesAccepted: number;
    quotesInvoiced: number;
    quotesPaid: number;
  };
  rates: {
    sentToAccepted: number;
    acceptedToInvoiced: number;
    invoicedToPaid: number;
    overall: number;
  };
  funnel: Array<{ stage: string; count: number; pct: number }>;
  currency: string;
}

export interface DaysToPaySegment {
  segment: string;
  avgDays: number;
  count: number;
}

export interface DaysToPayReport {
  overallAvgDays: number;
  paidCount: number;
  perContact: Array<{ contactId: string; name: string; avgDays: number; count: number }>;
  perSegment: DaysToPaySegment[];
}

export interface AgingBucketsReport {
  buckets: Array<{ label: string; min: number; max: number | null; total: number; count: number }>;
  totalOutstanding: number;
  totalCount: number;
  currency: string;
}

export interface CollectedVsExpectedReport {
  current: { collected: number; expected: number; pctCollected: number; period: { start: string; end: string } };
  previous: { collected: number; expected: number; pctCollected: number; period: { start: string; end: string } };
  changePct: number;
  currency: string;
}

export interface RecurringExpectedReport {
  windows: Array<{ label: '30d' | '60d' | '90d'; expected: number; runs: number }>;
  rows: Array<{ id: string; name: string; contactName: string; total: number; frequency: string; nextRunDate: string; runsInWindow: number }>;
  currency: string;
}

@Injectable()
export class RevenueReportingService {
  private readonly logger = new Logger(RevenueReportingService.name);
  private readonly rollupCache = new Map<string, RollupCacheEntry>();

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // ---------- Public preset entrypoints ----------

  async generate(businessId: string, preset: RevenueReportPreset, range: RevenueReportRange) {
    switch (preset) {
      case 'by-source':
        return this.bySource(businessId, range);
      case 'by-contact':
        return this.byContact(businessId, range);
      case 'by-product':
        return this.byProduct(businessId, range);
      case 'quote-conversion':
        return this.quoteConversion(businessId, range);
      case 'days-to-pay':
        return this.daysToPay(businessId, range);
      case 'aging-buckets':
        return this.agingBuckets(businessId);
      case 'collected-vs-expected':
        return this.collectedVsExpected(businessId, range);
      case 'recurring-expected':
        return this.recurringExpected(businessId);
      default:
        throw new Error(`Unknown revenue report preset: ${preset as string}`);
    }
  }

  /**
   * Refresh the in-memory rollup cache for the heavy aggregates.
   * Called by RevenueReportingRollupScheduler daily.
   */
  async refreshRollup(businessId: string, range: RevenueReportRange): Promise<void> {
    const [bySource, byContact, byProduct, daysToPay] = await Promise.all([
      this.computeBySource(businessId, range),
      this.computeByContact(businessId, range),
      this.computeByProduct(businessId, range),
      this.computeDaysToPay(businessId, range),
    ]);
    this.rollupCache.set(businessId, {
      builtAt: Date.now(),
      bySource,
      byContact,
      byProduct,
      daysToPay,
    });
  }

  // ---------- Aggregates ----------

  async bySource(businessId: string, range: RevenueReportRange): Promise<BySourceReport> {
    return this.maybeFromCache(businessId, range, 'bySource', () => this.computeBySource(businessId, range));
  }

  private async computeBySource(businessId: string, range: RevenueReportRange): Promise<BySourceReport> {
    const currency = await this.businessCurrency(businessId);
    const invoices = await this.prisma.client.invoice.findMany({
      where: {
        businessId,
        deletedAt: null,
        status: 'PAID',
        paidAt: { gte: range.start, lte: range.end },
      },
      select: {
        total: true,
        campaignId: true,
        campaign: { select: { name: true } },
        contact: { select: { source: true, sourceDetail: true } },
        booking: { select: { staff: { select: { name: true } } } },
      },
    });

    const buckets = new Map<string, BySourceRow>();
    const inc = (key: string, channel: BySourceRow['channel'], source: string, total: number) => {
      const existing = buckets.get(key);
      if (existing) {
        existing.revenue += total;
        existing.invoiceCount += 1;
      } else {
        buckets.set(key, { source, channel, revenue: total, invoiceCount: 1 });
      }
    };

    for (const inv of invoices) {
      const total = Number(inv.total ?? 0);
      if (inv.campaignId && inv.campaign?.name) {
        inc(`campaign:${inv.campaignId}`, 'campaign', `Campaign — ${inv.campaign.name}`, total);
        continue;
      }
      const staffName = inv.booking?.staff?.name;
      if (staffName) {
        inc(`staff:${staffName}`, 'staff', `Staff — ${staffName}`, total);
        continue;
      }
      const src = (inv.contact?.source || '').trim();
      if (src) {
        inc(`source:${src.toLowerCase()}`, /referral/i.test(src) ? 'referral' : 'channel', src, total);
        continue;
      }
      inc('unknown', 'unknown', 'Unattributed', total);
    }

    const rows = Array.from(buckets.values()).sort((a, b) => b.revenue - a.revenue);
    const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
    return { rows, totalRevenue, currency };
  }

  async byContact(businessId: string, range: RevenueReportRange): Promise<ByContactReport> {
    return this.maybeFromCache(businessId, range, 'byContact', () => this.computeByContact(businessId, range));
  }

  private async computeByContact(businessId: string, range: RevenueReportRange): Promise<ByContactReport> {
    const currency = await this.businessCurrency(businessId);
    const invoices = await this.prisma.client.invoice.findMany({
      where: {
        businessId,
        deletedAt: null,
        status: 'PAID',
        paidAt: { gte: range.start, lte: range.end },
      },
      select: {
        total: true,
        paidAt: true,
        contact: { select: { id: true, displayName: true, firstName: true, lastName: true, companyName: true } },
      },
    });

    const map = new Map<string, ByContactRow>();
    for (const inv of invoices) {
      const id = inv.contact?.id ?? 'unknown';
      const name = this.contactDisplayName(inv.contact);
      const existing = map.get(id);
      const total = Number(inv.total ?? 0);
      const paidAt = inv.paidAt ? new Date(inv.paidAt).toISOString() : null;
      if (existing) {
        existing.revenue += total;
        existing.invoiceCount += 1;
        existing.avgInvoice = existing.revenue / existing.invoiceCount;
        if (paidAt && (!existing.lastPaymentAt || paidAt > existing.lastPaymentAt)) {
          existing.lastPaymentAt = paidAt;
        }
      } else {
        map.set(id, {
          contactId: inv.contact?.id ?? null,
          name,
          revenue: total,
          invoiceCount: 1,
          avgInvoice: total,
          lastPaymentAt: paidAt,
        });
      }
    }

    const rows = Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
    const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
    return { rows, totalRevenue, currency };
  }

  async byProduct(businessId: string, range: RevenueReportRange): Promise<ByProductReport> {
    return this.maybeFromCache(businessId, range, 'byProduct', () => this.computeByProduct(businessId, range));
  }

  private async computeByProduct(businessId: string, range: RevenueReportRange): Promise<ByProductReport> {
    const currency = await this.businessCurrency(businessId);

    // Invoiced product/services via InvoiceItem
    const items = await this.prisma.client.invoiceItem.findMany({
      where: {
        invoice: {
          businessId,
          deletedAt: null,
          status: 'PAID',
          paidAt: { gte: range.start, lte: range.end },
        },
      },
      select: {
        description: true,
        quantity: true,
        total: true,
        productId: true,
        product: { select: { name: true } },
        invoiceId: true,
      },
    });

    const map = new Map<string, ByProductRow & { invoiceIds: Set<string> }>();
    for (const it of items) {
      const key = it.productId ? `p:${it.productId}` : `desc:${(it.description || 'Unmapped').toLowerCase()}`;
      const name = it.product?.name || it.description || 'Unmapped item';
      const existing = map.get(key);
      const total = Number(it.total ?? 0);
      if (existing) {
        existing.revenue += total;
        existing.unitsSold += it.quantity ?? 0;
        existing.invoiceIds.add(it.invoiceId);
      } else {
        map.set(key, {
          productId: it.productId ?? null,
          name,
          revenue: total,
          unitsSold: it.quantity ?? 0,
          invoiceCount: 0,
          invoiceIds: new Set([it.invoiceId]),
          category: it.productId ? 'product' : 'unmapped',
        });
      }
    }

    // Service revenue via Booking → Invoice paid
    const bookings = await this.prisma.client.booking.findMany({
      where: {
        businessId,
        deletedAt: null,
        invoice: { is: { status: 'PAID', deletedAt: null, paidAt: { gte: range.start, lte: range.end } } },
      },
      select: {
        service: { select: { id: true, name: true } },
        invoice: { select: { id: true, total: true } },
      },
    });
    for (const b of bookings) {
      if (!b.service || !b.invoice) continue;
      const key = `svc:${b.service.id}`;
      const total = Number(b.invoice.total ?? 0);
      const existing = map.get(key);
      if (existing) {
        existing.revenue += total;
        existing.unitsSold += 1;
        existing.invoiceIds.add(b.invoice.id);
      } else {
        map.set(key, {
          productId: null,
          name: `Service — ${b.service.name}`,
          revenue: total,
          unitsSold: 1,
          invoiceCount: 0,
          invoiceIds: new Set([b.invoice.id]),
          category: 'service',
        });
      }
    }

    const rows: ByProductRow[] = Array.from(map.values())
      .map(({ invoiceIds, ...rest }) => ({ ...rest, invoiceCount: invoiceIds.size }))
      .sort((a, b) => b.revenue - a.revenue);
    const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
    return { rows, totalRevenue, currency };
  }

  async quoteConversion(businessId: string, range: RevenueReportRange): Promise<QuoteConversionReport> {
    const currency = await this.businessCurrency(businessId);
    const quotes = await this.prisma.client.quote.findMany({
      where: { businessId, deletedAt: null, createdAt: { gte: range.start, lte: range.end } },
      select: {
        id: true,
        status: true,
        sentAt: true,
        acceptedAt: true,
        invoiceId: true,
        invoice: { select: { status: true, paidAt: true } },
      },
    });

    const created = quotes.length;
    const sent = quotes.filter((q) => !!q.sentAt || ['SENT', 'ACCEPTED', 'REJECTED'].includes(q.status)).length;
    const accepted = quotes.filter((q) => !!q.acceptedAt || q.status === 'ACCEPTED').length;
    const invoiced = quotes.filter((q) => !!q.invoiceId).length;
    const paid = quotes.filter((q) => q.invoice?.status === 'PAID').length;

    const safe = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

    return {
      totals: {
        quotesCreated: created,
        quotesSent: sent,
        quotesAccepted: accepted,
        quotesInvoiced: invoiced,
        quotesPaid: paid,
      },
      rates: {
        sentToAccepted: safe(accepted, sent),
        acceptedToInvoiced: safe(invoiced, accepted),
        invoicedToPaid: safe(paid, invoiced),
        overall: safe(paid, sent),
      },
      funnel: [
        { stage: 'Sent', count: sent, pct: 100 },
        { stage: 'Accepted', count: accepted, pct: safe(accepted, sent) },
        { stage: 'Invoiced', count: invoiced, pct: safe(invoiced, sent) },
        { stage: 'Paid', count: paid, pct: safe(paid, sent) },
      ],
      currency,
    };
  }

  async daysToPay(businessId: string, range: RevenueReportRange): Promise<DaysToPayReport> {
    return this.maybeFromCache(businessId, range, 'daysToPay', () => this.computeDaysToPay(businessId, range));
  }

  private async computeDaysToPay(businessId: string, range: RevenueReportRange): Promise<DaysToPayReport> {
    const invoices = await this.prisma.client.invoice.findMany({
      where: {
        businessId,
        deletedAt: null,
        status: 'PAID',
        paidAt: { gte: range.start, lte: range.end },
      },
      select: {
        issueDate: true,
        sentAt: true,
        paidAt: true,
        contact: { select: { id: true, displayName: true, firstName: true, lastName: true, companyName: true, segment: true, lifecycleStage: true } },
      },
    });

    const days = (a: Date | null | undefined, b: Date | null | undefined): number | null => {
      if (!a || !b) return null;
      const d = (new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24);
      return d >= 0 ? d : null;
    };

    let totalDays = 0;
    let counted = 0;
    const perContact = new Map<string, { name: string; total: number; count: number }>();
    const perSegment = new Map<string, { total: number; count: number }>();

    for (const inv of invoices) {
      const baseline = inv.sentAt ?? inv.issueDate;
      const d = days(baseline, inv.paidAt);
      if (d == null) continue;
      totalDays += d;
      counted += 1;

      const cid = inv.contact?.id;
      if (cid) {
        const name = this.contactDisplayName(inv.contact);
        const existing = perContact.get(cid);
        if (existing) { existing.total += d; existing.count += 1; }
        else perContact.set(cid, { name, total: d, count: 1 });
      }

      const segKey = inv.contact?.segment || inv.contact?.lifecycleStage || 'Unsegmented';
      const seg = perSegment.get(segKey);
      if (seg) { seg.total += d; seg.count += 1; }
      else perSegment.set(segKey, { total: d, count: 1 });
    }

    const overallAvgDays = counted > 0 ? Math.round((totalDays / counted) * 10) / 10 : 0;

    return {
      overallAvgDays,
      paidCount: counted,
      perContact: Array.from(perContact.entries())
        .map(([id, v]) => ({ contactId: id, name: v.name, avgDays: Math.round((v.total / v.count) * 10) / 10, count: v.count }))
        .sort((a, b) => b.avgDays - a.avgDays)
        .slice(0, 50),
      perSegment: Array.from(perSegment.entries())
        .map(([segment, v]) => ({ segment, avgDays: Math.round((v.total / v.count) * 10) / 10, count: v.count }))
        .sort((a, b) => b.avgDays - a.avgDays),
    };
  }

  async agingBuckets(businessId: string): Promise<AgingBucketsReport> {
    const currency = await this.businessCurrency(businessId);
    const now = Date.now();
    const invoices = await this.prisma.client.invoice.findMany({
      where: {
        businessId,
        deletedAt: null,
        status: { in: ['SENT', 'OVERDUE', 'PARTIALLY_PAID', 'DRAFT'] },
      },
      select: { total: true, dueDate: true, issueDate: true },
    });

    const defs: Array<{ label: string; min: number; max: number | null }> = [
      { label: '0-30', min: 0, max: 30 },
      { label: '31-60', min: 31, max: 60 },
      { label: '61-90', min: 61, max: 90 },
      { label: '90+', min: 91, max: null },
    ];
    const buckets = defs.map((d) => ({ ...d, total: 0, count: 0 }));

    let totalOutstanding = 0;
    let totalCount = 0;

    for (const inv of invoices) {
      const due = inv.dueDate ?? inv.issueDate;
      if (!due) continue;
      const ageDays = Math.floor((now - new Date(due).getTime()) / (1000 * 60 * 60 * 24));
      const total = Number(inv.total ?? 0);
      totalOutstanding += total;
      totalCount += 1;
      const slot = buckets.find((b) => ageDays >= b.min && (b.max == null || ageDays <= b.max));
      if (slot) {
        slot.total += total;
        slot.count += 1;
      }
    }

    return { buckets, totalOutstanding, totalCount, currency };
  }

  async collectedVsExpected(businessId: string, range: RevenueReportRange): Promise<CollectedVsExpectedReport> {
    const currency = await this.businessCurrency(businessId);
    const periodMs = range.end.getTime() - range.start.getTime();
    const prevEnd = new Date(range.start.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - periodMs);

    const [collectedNow, expectedNow, collectedPrev, expectedPrev] = await Promise.all([
      this.prisma.client.payment.aggregate({
        where: { businessId, status: 'SUCCESSFUL', createdAt: { gte: range.start, lte: range.end } },
        _sum: { amount: true },
      }),
      this.prisma.client.invoice.aggregate({
        where: { businessId, deletedAt: null, issueDate: { gte: range.start, lte: range.end } },
        _sum: { total: true },
      }),
      this.prisma.client.payment.aggregate({
        where: { businessId, status: 'SUCCESSFUL', createdAt: { gte: prevStart, lte: prevEnd } },
        _sum: { amount: true },
      }),
      this.prisma.client.invoice.aggregate({
        where: { businessId, deletedAt: null, issueDate: { gte: prevStart, lte: prevEnd } },
        _sum: { total: true },
      }),
    ]);

    const cNow = Number(collectedNow._sum.amount ?? 0);
    const eNow = Number(expectedNow._sum.total ?? 0);
    const cPrev = Number(collectedPrev._sum.amount ?? 0);
    const ePrev = Number(expectedPrev._sum.total ?? 0);

    const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
    const change = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : a > 0 ? 100 : 0);

    return {
      current: {
        collected: cNow,
        expected: eNow,
        pctCollected: pct(cNow, eNow),
        period: { start: range.start.toISOString(), end: range.end.toISOString() },
      },
      previous: {
        collected: cPrev,
        expected: ePrev,
        pctCollected: pct(cPrev, ePrev),
        period: { start: prevStart.toISOString(), end: prevEnd.toISOString() },
      },
      changePct: change(cNow, cPrev),
      currency,
    };
  }

  async recurringExpected(businessId: string): Promise<RecurringExpectedReport> {
    const currency = await this.businessCurrency(businessId);
    const recurring = await this.prisma.client.recurringInvoice.findMany({
      where: { businessId, isActive: true, deletedAt: null },
      select: {
        id: true,
        name: true,
        total: true,
        frequency: true,
        nextRunDate: true,
        endDate: true,
        contact: { select: { displayName: true, firstName: true, lastName: true, companyName: true } },
      },
    });

    const now = new Date();
    const horizons = [30, 60, 90] as const;
    const windows = horizons.map((h) => ({ label: `${h}d` as '30d' | '60d' | '90d', expected: 0, runs: 0 }));

    const rows: RecurringExpectedReport['rows'] = recurring.map((r) => {
      const runsByWindow = horizons.map((h) => {
        const horizonEnd = new Date(now.getTime() + h * 24 * 60 * 60 * 1000);
        return this.estimateRuns(r.nextRunDate, r.endDate ?? null, r.frequency, horizonEnd);
      });
      const total = Number(r.total ?? 0);
      runsByWindow.forEach((runs, i) => {
        windows[i].expected += runs * total;
        windows[i].runs += runs;
      });
      return {
        id: r.id,
        name: r.name,
        contactName: this.contactDisplayName(r.contact),
        total,
        frequency: r.frequency,
        nextRunDate: r.nextRunDate.toISOString(),
        runsInWindow: runsByWindow[2], // 90d
      };
    });

    rows.sort((a, b) => b.runsInWindow * b.total - a.runsInWindow * a.total);
    return { windows, rows, currency };
  }

  // ---------- helpers ----------

  private async businessCurrency(businessId: string): Promise<string> {
    const b = await this.prisma.client.business.findUnique({ where: { id: businessId }, select: { currency: true } });
    return b?.currency || 'TTD';
  }

  private contactDisplayName(c?: { displayName?: string | null; firstName?: string | null; lastName?: string | null; companyName?: string | null } | null): string {
    if (!c) return 'Unknown';
    const explicit = c.displayName?.trim();
    if (explicit) return explicit;
    const composed = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim();
    if (composed) return composed;
    return c.companyName?.trim() || 'Unknown';
  }

  private estimateRuns(nextRun: Date, endDate: Date | null, frequency: string, horizonEnd: Date): number {
    const startMs = nextRun.getTime();
    const horizonMs = Math.min(horizonEnd.getTime(), endDate ? endDate.getTime() : horizonEnd.getTime());
    if (horizonMs < startMs) return 0;
    const stepDays = (() => {
      switch (frequency) {
        case 'WEEKLY': return 7;
        case 'BIWEEKLY': return 14;
        case 'MONTHLY': return 30;
        case 'QUARTERLY': return 90;
        case 'YEARLY': return 365;
        default: return 30;
      }
    })();
    const days = (horizonMs - startMs) / (1000 * 60 * 60 * 24);
    return Math.max(1, Math.floor(days / stepDays) + 1);
  }

  private maybeFromCache<K extends 'bySource' | 'byContact' | 'byProduct' | 'daysToPay'>(
    businessId: string,
    range: RevenueReportRange,
    key: K,
    fallback: () => Promise<RollupCacheEntry[K]>,
  ): Promise<RollupCacheEntry[K]> {
    const entry = this.rollupCache.get(businessId);
    if (entry && Date.now() - entry.builtAt < ROLLUP_TTL_MS && this.isMonthRange(range)) {
      return Promise.resolve(entry[key]);
    }
    return fallback();
  }

  private isMonthRange(range: RevenueReportRange): boolean {
    // Cache only applies when caller asked for the full current month — the
    // shape the daily rollup actually materializes.
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    return Math.abs(range.start.getTime() - monthStart.getTime()) < 60 * 1000;
  }
}
