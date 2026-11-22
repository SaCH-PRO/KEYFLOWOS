import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { D13_CURRENCIES, normalizeCurrency } from '../finance/posting.service';
import { balanceOfStoredRows, creditAwareBalance } from './invoice-workflow.service';
import { fromCents, roundMoney, sumMoney, toCents } from './money';

/**
 * V1-64 (SWP-INV-MONEY-TOTALS; sweep BUG-020, BUG-024): the invoices whose
 * remaining balance is owed to the business: issued and not settled. A DRAFT
 * was never sent, PAID / FULLY_CREDITED / VOID owe nothing, FAILED and PENDING
 * are not live receivables here.
 */
export const OPEN_RECEIVABLE_STATUSES: ReadonlySet<string> = new Set(['SENT', 'OVERDUE', 'PARTIALLY_PAID', 'PARTIALLY_CREDITED']);

/** One invoice's money as the totals read it (readInvoiceMoney). */
export interface InvoiceMoney {
  id: string;
  status: string;
  /** Normalized (trimmed, upper-case); '' when the row holds none. */
  currency: string;
  total: number;
  dueDate: Date | null;
  paidAt: Date | null;
  /**
   * The rows that are money in or out, each with its date: SUCCESSFUL rows
   * (in) and negative REFUNDED rows (out, D-14). Their amounts add up to the
   * invoice's net received (CASH_NET_PAYMENT_WHERE, the database form of
   * balanceOfStoredRows(...).net).
   */
  cash: Array<{ amount: number; at: Date }>;
  /** What is still owed on an open receivable, net of its APPLIED credit notes; 0 on any other invoice. */
  remaining: number;
  /** Still owed and past its due date (or flagged OVERDUE). */
  overdue: boolean;
}

/**
 * V1-64 (SWP-INV-MONEY-TOTALS): every live invoice of one business with the
 * money its own payment rows state, the one read the commerce stats and the
 * Executive Summary total from, so they state the same figures.
 *
 *  - Own-tenant rows only (D-75): Payment sits outside the tenant extension
 *    and has no FK to Business (M31), so the rows are read through this
 *    business's invoices and filtered to its businessId; a row carrying
 *    another businessId is not this invoice's money. Credit notes likewise
 *    (credit_notes.business_id is not tied to the invoice's, SEC-V44-6).
 *  - The balance contract (balanceOfStoredRows, D-14): SUCCESSFUL in, refunds
 *    out, PENDING / FAILED nothing, a row flipped to REFUNDED before V1-29
 *    read as its payment plus its refund; integer cents; never below zero.
 *  - `remaining` is credit-aware (creditAwareBalance over the invoice's own
 *    APPLIED notes, as appliedCreditsOf reads them: a PARTIALLY_CREDITED
 *    invoice only), and only an open receivable owes anything.
 *
 * `businessId` must be the caller's admitted tenant; a missing one reads
 * nothing (Prisma drops an `undefined` filter, which would read every tenant).
 */
export async function readInvoiceMoney(
  db: PrismaService['client'],
  businessId: string,
  now: Date = new Date(),
): Promise<InvoiceMoney[]> {
  if (typeof businessId !== 'string' || businessId.length === 0) return [];
  const [invoices, credits] = await Promise.all([
    db.invoice.findMany({
      where: { businessId, deletedAt: null },
      select: {
        id: true,
        total: true,
        status: true,
        dueDate: true,
        paidAt: true,
        currency: true,
        payments: { where: { businessId }, select: { amount: true, status: true, createdAt: true } },
      },
    }),
    db.creditNote.groupBy({
      by: ['invoiceId'],
      where: { businessId, status: 'APPLIED', invoice: { businessId, deletedAt: null, status: 'PARTIALLY_CREDITED' } },
      _sum: { amount: true },
    }),
  ]);
  const creditedOf = new Map<string, number>();
  for (const c of credits) creditedOf.set(c.invoiceId, Number(c._sum.amount ?? 0) || 0);

  return invoices.map((inv) => {
    const total = Number(inv.total ?? 0) || 0;
    const open = OPEN_RECEIVABLE_STATUSES.has(inv.status);
    const balance = creditAwareBalance(
      balanceOfStoredRows(total, inv.payments, inv.currency),
      inv.status === 'PARTIALLY_CREDITED' ? creditedOf.get(inv.id) ?? 0 : 0,
    );
    const remaining = open ? balance.remaining : 0;
    const cash: Array<{ amount: number; at: Date }> = [];
    for (const p of inv.payments) {
      const amount = Number(p.amount) || 0;
      if (p.status === 'SUCCESSFUL' || (p.status === 'REFUNDED' && amount < 0)) cash.push({ amount, at: p.createdAt });
    }
    return {
      id: inv.id,
      status: inv.status,
      currency: normalizeCurrency(inv.currency),
      total,
      dueDate: inv.dueDate,
      paidAt: inv.paidAt,
      cash,
      remaining,
      overdue: remaining > 0 && (inv.status === 'OVERDUE' || (!!inv.dueDate && new Date(inv.dueDate) < now)),
    };
  });
}

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
   * are not money (invoices, quotes, products, conversion, and the per-status
   * counts of the top-level invoiceStatusBreakdown) stay whole-business.
   * Sums are cents-safe (sumMoney, V1-22).
   *
   * V1-64 (SWP-INV-MONEY-TOTALS; sweep BUG-020; D-14, D-75): revenue is the
   * money received net of refunds on the business's own invoices, read from
   * their own-tenant payment rows (readInvoiceMoney), by the date of each row
   * for this month and the six-month series; outstanding is the remaining
   * balance of the open receivables (SENT, OVERDUE, PARTIALLY_PAID,
   * PARTIALLY_CREDITED) and overdue the part of it past due. It summed the
   * totals of PAID invoices as revenue and of SENT / OVERDUE invoices as
   * outstanding, so an invoice of 13,723 with a 400 deposit was neither
   * (revenue 0, outstanding 0), and a part-paid one counted whole once it
   * was flagged OVERDUE. The status breakdown, the paid-invoice count, the
   * average paid invoice and the top products still describe the invoices.
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
      allInvoices,
      statusGroups,
      quoteStatusGroups,
    ] = await Promise.all([
      this.prisma.client.business.findUnique({ where: { id: businessId }, select: { currency: true } }),
      this.prisma.client.product.count({ where: { businessId, deletedAt: null } }),
      this.prisma.client.product.count({ where: { businessId, deletedAt: null, isActive: true } }),
      this.prisma.client.invoice.count({ where: invoiceWhere }),
      this.prisma.client.quote.count({ where: { businessId, deletedAt: null } }),
      readInvoiceMoney(this.prisma.client, businessId, now),
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
    ]);

    const businessCurrency = normalizeCurrency(business?.currency) || 'TTD';
    const currencies = new Set<string>([...D13_CURRENCIES, businessCurrency]);
    for (const row of allInvoices) currencies.add(row.currency);
    currencies.delete('');

    const topProductsByCurrency = new Map<string, Array<{ name: string; revenue: number; count: number }>>();
    await Promise.all(
      [...currencies].map(async (currency) => {
        topProductsByCurrency.set(currency, await this.topProducts(businessId, currency));
      }),
    );

    const byCurrency: Record<string, CurrencyCommerceStats> = {};
    for (const currency of [...currencies].sort()) {
      const all = allInvoices.filter((inv) => inv.currency === currency);
      const paid = all.filter((inv) => inv.status === 'PAID');
      const cash = all.flatMap((inv) => inv.cash);
      const totalRevenue = sumMoney(cash.map((row) => row.amount));
      const outstandingAmount = sumMoney(all.map((inv) => inv.remaining));
      const overdueAmount = sumMoney(all.filter((inv) => inv.overdue).map((inv) => inv.remaining));
      const monthlyPaid = sumMoney(cash.filter((row) => new Date(row.at) >= monthStart).map((row) => row.amount));
      // The average PAID invoice to the cent, half away from zero, on integer cents.
      const paidTotal = sumMoney(paid.map((inv) => inv.total));
      const averageInvoiceValue = paid.length > 0 ? fromCents(Math.round(toCents(paidTotal) / paid.length)) : 0;

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
        revenueByMonth: this.buildRevenueByMonth(cash, paid, now),
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
    // V1-37 review (RV37-03): the top-level status breakdown keeps the
    // whole-business count per status (a count is not money: the KPI strip,
    // billing card and insights read OVERDUE, DRAFT and SENT counts from it),
    // while its `total` stays the business currency's money only. A USD
    // OVERDUE invoice on a TTD business counts as overdue there, and adds
    // nothing to the TTD total; its money is under byCurrency.USD.
    const invoiceStatusBreakdown: Record<string, { count: number; total: number }> = {};
    for (const g of statusGroups) {
      const prior = invoiceStatusBreakdown[g.status] ?? { count: 0, total: 0 };
      invoiceStatusBreakdown[g.status] = {
        count: prior.count + g._count.id,
        total: home.invoiceStatusBreakdown[g.status]?.total ?? 0,
      };
    }
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
      invoiceStatusBreakdown,
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

  /**
   * The last six calendar months of one currency, oldest first: the money
   * received net of refunds in each month, by the date of each payment row
   * (V1-64), and the invoices that became PAID in it.
   */
  private buildRevenueByMonth(
    cash: Array<{ amount: number; at: Date }>,
    paid: Array<{ paidAt: Date | null }>,
    now: Date,
  ) {
    const months: { month: string; revenue: number; invoiceCount: number }[] = [];

    for (let i = 5; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const label = start.toLocaleDateString('en-TT', { year: 'numeric', month: 'short' });
      const within = (at: Date | null) => !!at && new Date(at) >= start && new Date(at) < end;

      months.push({
        month: label,
        revenue: sumMoney(cash.filter((row) => within(row.at)).map((row) => row.amount)),
        invoiceCount: paid.filter((inv) => within(inv.paidAt)).length,
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
