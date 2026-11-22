import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { D13_CURRENCIES, normalizeCurrency } from '../finance/posting.service';
import { balanceOfStoredRows, creditAwareBalance } from './invoice-workflow.service';
import { fromCents, roundMoney, sumMoney, toCents } from './money';

/**
 * V1-64 (SWP-INV-MONEY-TOTALS; sweep BUG-020, BUG-024): the invoices whose
 * remaining balance is owed to the business: issued and not settled. A DRAFT
 * was never sent, PAID / FULLY_CREDITED / VOID owe nothing, FAILED is not a
 * live receivable. A PENDING invoice counts as owed everywhere (owner ruling
 * D-256; the ledger posts AR recognition for it).
 *
 * The one list of open statuses on the server: the commerce stats, the
 * Executive Summary (ReportsService) and the A/R aging (ReceivablesService)
 * all read it through readInvoiceMoney, so they cannot drift. The web's
 * mirror is OWED_STATUSES in apps/web/.../payments/payments-tab.tsx.
 */
export const OPEN_RECEIVABLE_STATUSES: ReadonlySet<string> = new Set(['PENDING', 'SENT', 'OVERDUE', 'PARTIALLY_PAID', 'PARTIALLY_CREDITED']);

/** One invoice's money as the totals read it (readInvoiceMoney). */
export interface InvoiceMoney {
  id: string;
  status: string;
  /** Normalized (trimmed, upper-case); '' when the row holds none. */
  currency: string;
  contactId: string | null;
  invoiceNumber: string | null;
  total: number;
  dueDate: Date | null;
  paidAt: Date | null;
  /**
   * The rows that are money in or out, each with its date: SUCCESSFUL rows
   * (in) and negative REFUNDED rows (out, D-14). Their amounts add up to the
   * invoice's net received (CASH_NET_PAYMENT_WHERE, the database form of
   * balanceOfStoredRows(...).net). A PAID invoice also carries what its rows
   * do not record of its total, dated the day it was paid (D-249, D-250; see
   * readInvoiceMoney); `at` is null only for that entry on an invoice with no
   * paidAt.
   */
  cash: Array<{ amount: number; at: Date | null }>;
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
 *  - A PAID invoice counts its full total (owner rulings D-249, D-250): what
 *    its own rows do not record as received, all of it for an invoice with no
 *    payment row (CommerceIntegrationService still writes INV-ORD-... PAID
 *    with none) or the rest of it for one whose rows cover part, counts on
 *    its paidAt, so marking paid never loses revenue. Its refund rows still
 *    come off: a rowless PAID 500 with a -100 refund nets 400. Rows that
 *    cover the total, or more, add nothing. A row of another tenant records
 *    none of it (D-75).
 *  - `remaining` never exceeds the total less the credits (D-250): a refund
 *    with no original would otherwise leave more owed than was invoiced.
 *
 * `businessId` must be the caller's admitted tenant; a missing or non-string
 * one reads nothing (Prisma drops an `undefined` filter, which would read
 * every tenant; an object would be a filter). `openOnly` reads the open
 * receivables alone (the Executive Summary needs no other invoice): every
 * `remaining` and `overdue` is the same as in the full read.
 */
export async function readInvoiceMoney(
  db: PrismaService['client'],
  businessId: string,
  now: Date = new Date(),
  options: { openOnly?: boolean } = {},
): Promise<InvoiceMoney[]> {
  if (typeof businessId !== 'string' || businessId.length === 0) return [];
  const invoices = await db.invoice.findMany({
    where: {
      businessId,
      deletedAt: null,
      ...(options.openOnly ? { status: { in: [...OPEN_RECEIVABLE_STATUSES] as InvoiceStatusName[] } } : {}),
    },
    select: {
      id: true,
      total: true,
      status: true,
      dueDate: true,
      paidAt: true,
      currency: true,
      contactId: true,
      invoiceNumber: true,
      payments: { where: { businessId }, select: { amount: true, status: true, createdAt: true } },
    },
  });
  // Only a PARTIALLY_CREDITED invoice nets credit notes (appliedCreditsOf): a book without one reads none.
  const creditedIds = invoices.filter((inv) => inv.status === 'PARTIALLY_CREDITED').map((inv) => inv.id);
  const credits = creditedIds.length
    ? await db.creditNote.groupBy({
        by: ['invoiceId'],
        where: { businessId, status: 'APPLIED', invoiceId: { in: creditedIds } },
        _sum: { amount: true },
      })
    : [];
  const creditedOf = new Map<string, number>();
  for (const c of credits) creditedOf.set(c.invoiceId, Number(c._sum.amount ?? 0) || 0);

  return invoices.map((inv) => {
    const total = Number(inv.total ?? 0) || 0;
    const rows = inv.payments ?? [];
    const open = OPEN_RECEIVABLE_STATUSES.has(inv.status);
    const rowsBalance = balanceOfStoredRows(total, rows, inv.currency);
    const balance = creditAwareBalance(rowsBalance, inv.status === 'PARTIALLY_CREDITED' ? creditedOf.get(inv.id) ?? 0 : 0);
    // D-250 (acceptance finding C2): an invoice never owes more than its total
    // less its credits. A refund row with no original leaves the rows' net
    // below zero, and the balance contract then reads total - net.
    const owedCap = Math.max(0, toCents(rowsBalance.total) - toCents(balance.credited));
    const remaining = open ? fromCents(Math.min(toCents(balance.remaining), owedCap)) : 0;
    const cash: Array<{ amount: number; at: Date | null }> = [];
    for (const p of rows) {
      const amount = Number(p.amount) || 0;
      if (p.status === 'SUCCESSFUL' || (p.status === 'REFUNDED' && amount < 0)) cash.push({ amount, at: p.createdAt });
    }
    // D-249 / D-250: a PAID invoice counts its full total. What its own rows
    // do not record as received (all of it, or the rest of it) counts on the
    // day it was paid; refund rows still come off.
    // Nothing is unrecorded once the payments settle the total as the balance
    // contract reads it (a legacy sub-cent total, 9.405, is settled by the
    // 9.40 the base recorded: no phantom cent; review P2C-5).
    const paidSettles = balanceOfStoredRows(total, [{ amount: rowsBalance.paid, status: 'SUCCESSFUL' }], inv.currency).isFullyPaid;
    const unrecordedCents = inv.status === 'PAID' && !paidSettles ? toCents(rowsBalance.total) - toCents(rowsBalance.paid) : 0;
    if (unrecordedCents > 0) cash.push({ amount: fromCents(unrecordedCents), at: inv.paidAt ?? null });
    return {
      id: inv.id,
      status: inv.status,
      currency: normalizeCurrency(inv.currency),
      contactId: inv.contactId ?? null,
      invoiceNumber: inv.invoiceNumber ?? null,
      total,
      dueDate: inv.dueDate,
      paidAt: inv.paidAt,
      cash,
      remaining,
      overdue: remaining > 0 && (inv.status === 'OVERDUE' || (!!inv.dueDate && new Date(inv.dueDate) < now)),
    };
  });
}

type InvoiceStatusName = 'SENT' | 'OVERDUE' | 'PARTIALLY_PAID' | 'PARTIALLY_CREDITED';

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
    // Review SEC-2: no business named is refused before any read. Prisma drops
    // an `undefined` filter and takes an object as one, so the counts and
    // groupings below would read every tenant.
    if (typeof businessId !== 'string' || businessId.length === 0) {
      throw new BadRequestException('A business is required');
    }
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
      const cash = all.flatMap((inv) => inv.cash.map((row) => ({ ...row, invoiceId: inv.id })));
      const totalRevenue = sumMoney(cash.map((row) => row.amount));
      const outstandingAmount = sumMoney(all.map((inv) => inv.remaining));
      const overdueAmount = sumMoney(all.filter((inv) => inv.overdue).map((inv) => inv.remaining));
      // Net cash this month: below zero when its refunds outweigh its receipts.
      const monthlyPaid = sumMoney(cash.filter((row) => !!row.at && new Date(row.at) >= monthStart).map((row) => row.amount));
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
        revenueByMonth: this.buildRevenueByMonth(cash, now),
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
   * (V1-64), and the number of invoices that money moved on in it. A month
   * whose refunds outweigh its receipts is below zero.
   */
  private buildRevenueByMonth(cash: Array<{ amount: number; at: Date | null; invoiceId: string }>, now: Date) {
    const months: { month: string; revenue: number; invoiceCount: number }[] = [];

    for (let i = 5; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const label = start.toLocaleDateString('en-TT', { year: 'numeric', month: 'short' });
      const inMonth = cash.filter((row) => !!row.at && new Date(row.at) >= start && new Date(row.at) < end);

      months.push({
        month: label,
        revenue: sumMoney(inMonth.map((row) => row.amount)),
        invoiceCount: new Set(inMonth.map((row) => row.invoiceId)).size,
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
