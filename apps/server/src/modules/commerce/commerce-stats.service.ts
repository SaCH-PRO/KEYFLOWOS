import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { D13_CURRENCIES, normalizeCurrency } from '../finance/posting.service';
import { fromCents, roundMoney, sumMoney, toCents } from './money';

/** One currency's money figures (V1-37): never added to another currency's. */
export interface CurrencyCommerceStats {
  currency: string;
  totalRevenue: number;
  outstandingAmount: number;
  overdueAmount: number;
  monthlyPaid: number;
  averageInvoiceValue: number;
  paidInvoiceCount: number;
  invoiceCount: number;
  invoiceStatusBreakdown: Record<string, { count: number; total: number }>;
  topProducts: Array<{ name: string; revenue: number; count: number }>;
  revenueByMonth: Array<{ month: string; revenue: number; invoiceCount: number }>;
}

@Injectable()
export class CommerceStatsService {
  private readonly logger = new Logger(CommerceStatsService.name);
  private cache: Map<string, { data: any; expires: number }> = new Map();
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  private getCached<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) {
      this.cacheMisses++;
      return null;
    }
    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      this.cacheMisses++;
      return null;
    }
    this.cacheHits++;
    return entry.data as T;
  }

  private setCache(key: string, data: any, ttlMs = 60000): void {
    this.cache.set(key, { data, expires: Date.now() + ttlMs });
  }

  invalidateCache(businessId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${businessId}:`)) {
        this.cache.delete(key);
      }
    }
  }

  getCacheMetrics() {
    const total = this.cacheHits + this.cacheMisses;
    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: total > 0 ? Math.round((this.cacheHits / total) * 100) : 0,
      size: this.cache.size,
    };
  }

  /**
   * V1-37-DM-CURRENCY (CF-38, M23; owner ruling D-13): every money figure is
   * per currency. It summed every invoice's total whatever its currency, so a
   * TTD 100 and a USD 250 invoice read as 350 of nothing on the cockpit and
   * billing cards.
   *
   * `byCurrency` always carries TTD and USD (D-13) and any other currency a
   * stored invoice holds, each in its own bucket. The top-level money fields
   * (what the KPI strip and the money hub read) are the business currency's
   * bucket, named by `currency`; no figure adds two currencies. Counts that
   * are not money (invoices, quotes, products, conversion) stay whole-business.
   * Sums are cents-safe (sumMoney, V1-22).
   */
  async getCommerceStats(businessId: string) {
    const cacheKey = `${businessId}:commerceStats`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    const start = Date.now();
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const invoiceWhere = { businessId, deletedAt: null };

    const [
      business,
      productCount,
      activeProductCount,
      invoiceCount,
      quoteCount,
      paidInvoices,
      allInvoices,
      statusGroups,
      quoteStatusGroups,
      revenueRows,
    ] = await Promise.all([
      this.prisma.client.business.findUnique({ where: { id: businessId }, select: { currency: true } }),
      this.prisma.client.product.count({ where: { businessId, deletedAt: null } }),
      this.prisma.client.product.count({ where: { businessId, deletedAt: null, isActive: true } }),
      this.prisma.client.invoice.count({ where: invoiceWhere }),
      this.prisma.client.quote.count({ where: { businessId, deletedAt: null } }),
      this.prisma.client.invoice.findMany({
        where: { ...invoiceWhere, status: 'PAID' },
        select: { total: true, paidAt: true, currency: true },
      }),
      this.prisma.client.invoice.findMany({
        where: invoiceWhere,
        select: { total: true, status: true, dueDate: true, currency: true },
      }),
      this.prisma.client.invoice.groupBy({
        by: ['status', 'currency'],
        where: invoiceWhere,
        _count: { id: true },
        _sum: { total: true },
      }),
      this.prisma.client.quote.groupBy({
        by: ['status'],
        where: { businessId, deletedAt: null },
        _count: { id: true },
      }),
      this.paidInvoicesSince(businessId, new Date(now.getFullYear(), now.getMonth() - 5, 1)),
    ]);

    const businessCurrency = normalizeCurrency(business?.currency) || 'TTD';
    const currencies = new Set<string>([...D13_CURRENCIES, businessCurrency]);
    for (const row of allInvoices) currencies.add(normalizeCurrency(row.currency));
    currencies.delete('');

    const topProductsByCurrency = new Map<string, Array<{ name: string; revenue: number; count: number }>>();
    await Promise.all(
      [...currencies].map(async (currency) => {
        topProductsByCurrency.set(currency, await this.topProducts(businessId, currency));
      }),
    );

    const byCurrency: Record<string, CurrencyCommerceStats> = {};
    for (const currency of [...currencies].sort()) {
      const inCurrency = <T extends { currency: string }>(rows: T[]) => rows.filter((r) => normalizeCurrency(r.currency) === currency);
      const paid = inCurrency(paidInvoices);
      const all = inCurrency(allInvoices);
      const totalRevenue = sumMoney(paid.map((inv) => Number(inv.total ?? 0)));
      const outstandingAmount = sumMoney(
        all.filter((inv) => ['SENT', 'OVERDUE'].includes(inv.status)).map((inv) => Number(inv.total ?? 0)),
      );
      const overdueAmount = sumMoney(
        all
          .filter((inv) => inv.status === 'OVERDUE' || (inv.status === 'SENT' && inv.dueDate && new Date(inv.dueDate) < now))
          .map((inv) => Number(inv.total ?? 0)),
      );
      const monthlyPaid = sumMoney(
        paid.filter((inv) => inv.paidAt && new Date(inv.paidAt) >= monthStart).map((inv) => Number(inv.total ?? 0)),
      );
      // The average to the cent, half away from zero, on integer cents.
      const averageInvoiceValue = paid.length > 0 ? fromCents(Math.round(toCents(totalRevenue) / paid.length)) : 0;

      const invoiceStatusBreakdown: Record<string, { count: number; total: number }> = {};
      for (const g of statusGroups) {
        if (normalizeCurrency(g.currency) !== currency) continue;
        const prior = invoiceStatusBreakdown[g.status];
        const total = Number(g._sum.total ?? 0);
        invoiceStatusBreakdown[g.status] = prior
          ? { count: prior.count + g._count.id, total: sumMoney([prior.total, total]) }
          : { count: g._count.id, total: roundMoney(total) };
      }

      byCurrency[currency] = {
        currency,
        totalRevenue,
        outstandingAmount,
        overdueAmount,
        monthlyPaid,
        averageInvoiceValue,
        paidInvoiceCount: paid.length,
        invoiceCount: all.length,
        invoiceStatusBreakdown,
        topProducts: topProductsByCurrency.get(currency) ?? [],
        revenueByMonth: this.buildRevenueByMonth(inCurrency(revenueRows), now),
      };
    }

    const quoteStatusBreakdown: Record<string, number> = {};
    let acceptedQuotes = 0;
    let totalQuotes = 0;
    for (const g of quoteStatusGroups) {
      quoteStatusBreakdown[g.status] = g._count.id;
      totalQuotes += g._count.id;
      if (g.status === 'ACCEPTED') acceptedQuotes += g._count.id;
    }
    const quoteConversionRate = totalQuotes > 0 ? Math.round((acceptedQuotes / totalQuotes) * 100) : 0;

    const home = byCurrency[businessCurrency];
    const result = {
      currency: businessCurrency,
      totalRevenue: home.totalRevenue,
      outstandingAmount: home.outstandingAmount,
      overdueAmount: home.overdueAmount,
      monthlyPaid: home.monthlyPaid,
      invoiceCount,
      quoteCount,
      productCount,
      activeProductCount,
      averageInvoiceValue: home.averageInvoiceValue,
      quoteConversionRate,
      invoiceStatusBreakdown: home.invoiceStatusBreakdown,
      quoteStatusBreakdown,
      topProducts: home.topProducts,
      revenueByMonth: home.revenueByMonth,
      byCurrency,
    };

    const duration = Date.now() - start;
    if (duration > 1000) {
      this.logger.warn(`Commerce stats took ${duration}ms for business ${businessId}`);
    }

    this.setCache(cacheKey, result);
    return result;
  }

  /** The five best-selling line descriptions on PAID invoices in one currency. */
  private async topProducts(businessId: string, currency: string) {
    const groups = await this.prisma.client.invoiceItem.groupBy({
      by: ['description'],
      where: {
        // Case-insensitive: a pre-V1-37 row may hold 'ttd' (it was stored as given).
        invoice: { businessId, deletedAt: null, status: 'PAID', currency: { equals: currency, mode: 'insensitive' } },
      },
      _sum: { total: true },
      _count: { id: true },
      orderBy: { _sum: { total: 'desc' } },
      take: 5,
    });
    return groups.map((p) => ({
      name: p.description,
      revenue: roundMoney(Number(p._sum.total ?? 0)),
      count: p._count.id,
    }));
  }

  /** PAID invoices paid since `since`, with their currency: the revenue-by-month source, in one read. */
  private paidInvoicesSince(businessId: string, since: Date) {
    return this.prisma.client.invoice.findMany({
      where: { businessId, deletedAt: null, status: 'PAID', paidAt: { gte: since } },
      select: { total: true, paidAt: true, currency: true },
    });
  }

  /** The last six calendar months of one currency's paid revenue, oldest first. */
  private buildRevenueByMonth(rows: Array<{ total: number | null; paidAt: Date | null }>, now: Date) {
    const months: { month: string; revenue: number; invoiceCount: number }[] = [];

    for (let i = 5; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const label = start.toLocaleDateString('en-TT', { year: 'numeric', month: 'short' });
      const inMonth = rows.filter((r) => r.paidAt && new Date(r.paidAt) >= start && new Date(r.paidAt) < end);

      months.push({
        month: label,
        revenue: sumMoney(inMonth.map((r) => Number(r.total ?? 0))),
        invoiceCount: inMonth.length,
      });
    }

    return months;
  }

  async healthPing(): Promise<boolean> {
    try {
      await this.prisma.client.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
