import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { contactWhereBase } from './crm.helpers';

type RevenueData = {
  fromActivePipeline: number;
  fromRecurringClients: number;
  fromColdLeads: number;
  expiringQuotes: { count: number; value: number };
  overdueInvoices: { count: number; value: number };
};

type MonthlyRevenueBucket = {
  month: string;
  collected: number;
  invoiced: number;
};

type FinancialGrowthData = {
  monthlyRevenue: MonthlyRevenueBucket[];
  totalCollected: number;
  totalInvoiced: number;
  collectionRate: number;
  avgClientValue: number;
  clientCount: number;
  revenueGrowthPct: number;
  avgDaysToPayment: number;
  topServices: { name: string; revenue: number; bookings: number }[];
  revenueAtRisk: number;
};

@Injectable()
export class CrmRevenueService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  private toNum(v: any): number {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'object' && 'toNumber' in v) return v.toNumber();
    return Number(v) || 0;
  }

  /**
   * Per-contact revenue rollup for the M5 Insight Card revenue panel.
   * Idempotent read: pure aggregation over Quote/Invoice/Payment.
   */
  async getContactRevenueSummary(
    businessId: string,
    contactId: string,
  ): Promise<{
    contactId: string;
    currency: string;
    lifetimeRevenue: number;
    outstandingBalance: number;
    openInvoices: number;
    openQuotes: number;
    lastPaymentAt: string | null;
    lastPaymentAmount: number | null;
    paymentReliability: number | null;
    recentRevenueActions: Array<{
      type: string;
      label: string;
      amount: number | null;
      currency: string | null;
      occurredAt: string;
      entityId: string | null;
    }>;
  }> {
    const [quotes, invoices, payments, recentEvents] = await Promise.all([
      this.db.quote.findMany({
        where: { businessId, contactId, deletedAt: null },
        select: { id: true, status: true, total: true, currency: true, sentAt: true, expiryDate: true },
      }),
      this.db.invoice.findMany({
        where: { businessId, contactId, deletedAt: null },
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          total: true,
          currency: true,
          dueDate: true,
          createdAt: true,
        },
      }),
      this.db.payment.findMany({
        where: { businessId, invoice: { contactId } },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, amount: true, currency: true, status: true, provider: true, createdAt: true, invoiceId: true },
      }),
      this.db.contactEvent.findMany({
        where: {
          businessId,
          contactId,
          type: {
            in: [
              'invoice.paid',
              'invoice.payment_recorded',
              'invoice.overdue',
              'payment.received',
              'payment.failed',
              'quote.accepted',
              'quote.converted',
              'recurring_invoice.generated',
              'invoice.from_booking',
            ],
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { id: true, type: true, data: true, createdAt: true },
      }),
    ]);

    const successfulPayments = payments.filter((p) => p.status === 'SUCCESSFUL');
    const failedPayments = payments.filter((p) => p.status === 'FAILED');
    const lifetimeRevenue = successfulPayments.reduce((s, p) => s + this.toNum(p.amount), 0);
    const openInvoices = invoices.filter((i) => ['SENT', 'OVERDUE', 'DRAFT'].includes(i.status));
    const outstandingBalance = openInvoices.reduce((s, i) => s + this.toNum(i.total), 0);
    const openQuotes = quotes.filter((q) => ['SENT', 'DRAFT'].includes(q.status));
    const lastPayment = successfulPayments[0] ?? null;
    const totalAttempts = successfulPayments.length + failedPayments.length;
    const reliability = totalAttempts > 0
      ? successfulPayments.length / totalAttempts
      : null;
    const currency =
      lastPayment?.currency ?? invoices[0]?.currency ?? quotes[0]?.currency ?? 'TTD';

    const labelFor = (type: string): string => {
      switch (type) {
        case 'invoice.paid': return 'Invoice paid';
        case 'invoice.payment_recorded': return 'Payment recorded';
        case 'invoice.overdue': return 'Invoice overdue';
        case 'invoice.from_booking': return 'Invoice from booking';
        case 'payment.received': return 'Payment received';
        case 'payment.failed': return 'Payment failed';
        case 'quote.accepted': return 'Quote accepted';
        case 'quote.converted': return 'Quote converted';
        case 'recurring_invoice.generated': return 'Recurring invoice generated';
        default: return type;
      }
    };

    return {
      contactId,
      currency,
      lifetimeRevenue,
      outstandingBalance,
      openInvoices: openInvoices.length,
      openQuotes: openQuotes.length,
      lastPaymentAt: lastPayment?.createdAt?.toISOString() ?? null,
      lastPaymentAmount: lastPayment ? this.toNum(lastPayment.amount) : null,
      paymentReliability: reliability,
      recentRevenueActions: recentEvents.map((e) => {
        const data = (e.data ?? {}) as Record<string, unknown>;
        const rawAmount = data.amount ?? data.total ?? data.value;
        const amount = rawAmount != null ? this.toNum(rawAmount) : null;
        const entityId =
          (typeof data.invoiceId === 'string' && data.invoiceId) ||
          (typeof data.quoteId === 'string' && data.quoteId) ||
          (typeof data.paymentId === 'string' && data.paymentId) ||
          (typeof data.id === 'string' && data.id) ||
          null;
        return {
          type: e.type,
          label: labelFor(e.type),
          amount,
          currency: typeof data.currency === 'string' ? data.currency : null,
          occurredAt: e.createdAt.toISOString(),
          entityId,
        };
      }),
    };
  }

  async getPredictiveRevenue(businessId: string): Promise<RevenueData> {
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const [activeQuotes, overdueInvoices, expiringQuotes, recurringClients, paidInvoices] = await Promise.all([
      this.db.quote.findMany({
        where: { businessId, status: { in: ['SENT', 'ACCEPTED'] } },
        select: { total: true },
      }),
      this.db.invoice.findMany({
        where: { businessId, status: 'OVERDUE' },
        select: { total: true },
      }),
      this.db.quote.findMany({
        where: { businessId, status: 'SENT', expiryDate: { lte: sevenDaysFromNow, gte: now } },
        select: { total: true },
      }),
      this.db.contact.findMany({
        where: { ...contactWhereBase(businessId), status: 'CLIENT' },
        select: { id: true },
      }),
      this.db.invoice.findMany({
        where: { businessId, status: 'PAID', createdAt: { gte: ninetyDaysAgo } },
        select: { total: true },
      }),
    ]);

    const fromActivePipeline = activeQuotes.reduce((sum, q) => sum + this.toNum(q.total), 0);
    const paidTotal = paidInvoices.reduce((sum, inv) => sum + this.toNum(inv.total), 0);
    const avgClientValue = recurringClients.length > 0 && paidInvoices.length > 0
      ? paidTotal / recurringClients.length
      : 0;
    const fromRecurringClients = Math.round(recurringClients.length * avgClientValue);

    return {
      fromActivePipeline,
      fromRecurringClients,
      fromColdLeads: Math.round(fromActivePipeline * 0.1),
      expiringQuotes: {
        count: expiringQuotes.length,
        value: expiringQuotes.reduce((sum, q) => sum + this.toNum(q.total), 0),
      },
      overdueInvoices: {
        count: overdueInvoices.length,
        value: overdueInvoices.reduce((sum, inv) => sum + this.toNum(inv.total), 0),
      },
    };
  }

  async getFinancialGrowth(businessId: string): Promise<FinancialGrowthData> {
    const now = new Date();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    const [allInvoices, clients, bookingsWithService, overdueInvoices, expiringQuotes] = await Promise.all([
      this.db.invoice.findMany({
        where: { businessId, createdAt: { gte: sixMonthsAgo } },
        select: { total: true, status: true, createdAt: true, paidAt: true },
      }),
      this.db.contact.findMany({
        where: { ...contactWhereBase(businessId), status: 'CLIENT' },
        select: { id: true },
      }),
      this.db.booking.findMany({
        where: { businessId, createdAt: { gte: sixMonthsAgo } },
        select: {
          service: { select: { name: true, price: true } },
        },
      }),
      this.db.invoice.findMany({
        where: { businessId, status: 'OVERDUE' },
        select: { total: true },
      }),
      this.db.quote.findMany({
        where: {
          businessId,
          status: 'SENT',
          expiryDate: { lte: new Date(now.getTime() + 7 * 86_400_000), gte: now },
        },
        select: { total: true },
      }),
    ]);

    const monthlyMap = new Map<string, { collected: number; invoiced: number }>();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthlyMap.set(key, { collected: 0, invoiced: 0 });
    }

    let totalCollected = 0;
    let totalInvoiced = 0;
    let totalDaysToPayment = 0;
    let paidCount = 0;

    for (const inv of allInvoices) {
      const amount = this.toNum(inv.total);
      const monthKey = `${inv.createdAt.getFullYear()}-${String(inv.createdAt.getMonth() + 1).padStart(2, '0')}`;
      const bucket = monthlyMap.get(monthKey);

      if (bucket) {
        bucket.invoiced += amount;
        if (inv.status === 'PAID') {
          bucket.collected += amount;
        }
      }

      totalInvoiced += amount;
      if (inv.status === 'PAID') {
        totalCollected += amount;
        if (inv.paidAt) {
          const days = Math.max(0, Math.round((inv.paidAt.getTime() - inv.createdAt.getTime()) / 86_400_000));
          totalDaysToPayment += days;
          paidCount++;
        }
      }
    }

    const monthlyRevenue: MonthlyRevenueBucket[] = [];
    for (const [key, val] of monthlyMap) {
      const [y, m] = key.split('-');
      const d = new Date(Number(y), Number(m) - 1, 1);
      monthlyRevenue.push({
        month: d.toLocaleDateString('en-TT', { month: 'short', year: '2-digit' }),
        collected: Math.round(val.collected),
        invoiced: Math.round(val.invoiced),
      });
    }

    const months = Array.from(monthlyMap.values());
    const currentMonthCollected = months.length > 0 ? months[months.length - 1].collected : 0;
    const prevMonthCollected = months.length > 1 ? months[months.length - 2].collected : 0;
    const revenueGrowthPct = prevMonthCollected > 0
      ? Math.round(((currentMonthCollected - prevMonthCollected) / prevMonthCollected) * 100)
      : currentMonthCollected > 0 ? 100 : 0;

    const serviceMap = new Map<string, { revenue: number; bookings: number }>();
    for (const b of bookingsWithService) {
      if (b.service) {
        const name = b.service.name;
        const price = this.toNum(b.service.price);
        const entry = serviceMap.get(name) ?? { revenue: 0, bookings: 0 };
        entry.revenue += price;
        entry.bookings += 1;
        serviceMap.set(name, entry);
      }
    }
    const topServices = Array.from(serviceMap.entries())
      .map(([name, data]) => ({ name, revenue: Math.round(data.revenue), bookings: data.bookings }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    const overdueTotal = overdueInvoices.reduce((s, inv) => s + this.toNum(inv.total), 0);
    const expiringTotal = expiringQuotes.reduce((s, q) => s + this.toNum(q.total), 0);

    return {
      monthlyRevenue,
      totalCollected: Math.round(totalCollected),
      totalInvoiced: Math.round(totalInvoiced),
      collectionRate: totalInvoiced > 0 ? Math.round((totalCollected / totalInvoiced) * 100) : 0,
      avgClientValue: clients.length > 0 ? Math.round(totalCollected / clients.length) : 0,
      clientCount: clients.length,
      revenueGrowthPct,
      avgDaysToPayment: paidCount > 0 ? Math.round(totalDaysToPayment / paidCount) : 0,
      topServices,
      revenueAtRisk: Math.round(overdueTotal + expiringTotal),
    };
  }
}
