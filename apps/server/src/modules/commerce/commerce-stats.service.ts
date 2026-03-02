import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

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

  async getCommerceStats(businessId: string) {
    const cacheKey = `${businessId}:commerceStats`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    const start = Date.now();
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const invoiceWhere = { businessId, deletedAt: null };

    const [
      productCount,
      activeProductCount,
      invoiceCount,
      quoteCount,
      paidInvoices,
      allInvoices,
      monthlyInvoices,
      statusGroups,
      quoteStatusGroups,
      topProducts,
      revenueByMonth,
    ] = await Promise.all([
      this.prisma.client.product.count({ where: { businessId, deletedAt: null } }),
      this.prisma.client.product.count({ where: { businessId, deletedAt: null, isActive: true } }),
      this.prisma.client.invoice.count({ where: invoiceWhere }),
      this.prisma.client.quote.count({ where: { businessId, deletedAt: null } }),
      this.prisma.client.invoice.findMany({
        where: { ...invoiceWhere, status: 'PAID' },
        select: { total: true, paidAt: true },
      }),
      this.prisma.client.invoice.findMany({
        where: invoiceWhere,
        select: { total: true, status: true, dueDate: true },
      }),
      this.prisma.client.invoice.findMany({
        where: { ...invoiceWhere, status: 'PAID', paidAt: { gte: monthStart } },
        select: { total: true },
      }),
      this.prisma.client.invoice.groupBy({
        by: ['status'],
        where: invoiceWhere,
        _count: { id: true },
        _sum: { total: true },
      }),
      this.prisma.client.quote.groupBy({
        by: ['status'],
        where: { businessId, deletedAt: null },
        _count: { id: true },
      }),
      this.prisma.client.invoiceItem.groupBy({
        by: ['description'],
        where: {
          invoice: { businessId, deletedAt: null, status: 'PAID' },
        },
        _sum: { total: true },
        _count: { id: true },
        orderBy: { _sum: { total: 'desc' } },
        take: 5,
      }),
      this.buildRevenueByMonth(businessId),
    ]);

    const totalRevenue = paidInvoices.reduce((sum, inv) => sum + Number(inv.total ?? 0), 0);
    const outstandingAmount = allInvoices
      .filter((inv) => ['SENT', 'OVERDUE'].includes(inv.status))
      .reduce((sum, inv) => sum + Number(inv.total ?? 0), 0);
    const overdueAmount = allInvoices
      .filter((inv) => inv.status === 'OVERDUE' || (inv.status === 'SENT' && inv.dueDate && new Date(inv.dueDate) < now))
      .reduce((sum, inv) => sum + Number(inv.total ?? 0), 0);
    const monthlyPaid = monthlyInvoices.reduce((sum, inv) => sum + Number(inv.total ?? 0), 0);
    const averageInvoiceValue = paidInvoices.length > 0 ? totalRevenue / paidInvoices.length : 0;

    const invoiceStatusBreakdown: Record<string, { count: number; total: number }> = {};
    for (const g of statusGroups) {
      invoiceStatusBreakdown[g.status] = {
        count: g._count.id,
        total: Number(g._sum.total ?? 0),
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

    const topProductsList = topProducts.map((p) => ({
      name: p.description,
      revenue: Number(p._sum.total ?? 0),
      count: p._count.id,
    }));

    const result = {
      totalRevenue,
      outstandingAmount,
      overdueAmount,
      monthlyPaid,
      invoiceCount,
      quoteCount,
      productCount,
      activeProductCount,
      averageInvoiceValue: Math.round(averageInvoiceValue * 100) / 100,
      quoteConversionRate,
      invoiceStatusBreakdown,
      quoteStatusBreakdown,
      topProducts: topProductsList,
      revenueByMonth,
    };

    const duration = Date.now() - start;
    if (duration > 1000) {
      this.logger.warn(`Commerce stats took ${duration}ms for business ${businessId}`);
    }

    this.setCache(cacheKey, result);
    return result;
  }

  private async buildRevenueByMonth(businessId: string) {
    const months: { month: string; revenue: number; invoiceCount: number }[] = [];
    const now = new Date();

    for (let i = 5; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const label = start.toLocaleDateString('en-TT', { year: 'numeric', month: 'short' });

      const invoices = await this.prisma.client.invoice.findMany({
        where: {
          businessId,
          deletedAt: null,
          status: 'PAID',
          paidAt: { gte: start, lt: end },
        },
        select: { total: true },
      });

      months.push({
        month: label,
        revenue: invoices.reduce((sum, inv) => sum + Number(inv.total ?? 0), 0),
        invoiceCount: invoices.length,
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
