import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface ForecastBucket {
  date: string;
  expected: number;
  best: number;
  worst: number;
  fromInvoices: number;
  fromQuotes: number;
  fromRecurring: number;
}

export interface RevenueForecast {
  businessId: string;
  currency: string;
  generatedAt: string;
  horizonDays: number;
  totalExpected: number;
  totalBest: number;
  totalWorst: number;
  confidence: 'high' | 'medium' | 'low';
  buckets: ForecastBucket[];
  inputs: {
    openInvoices: number;
    openInvoiceTotal: number;
    acceptedQuotes: number;
    acceptedQuoteTotal: number;
    activeRecurring: number;
    monthlyRecurringEstimate: number;
    avgPaymentDays: number;
    paymentDayStdev: number;
  };
}

interface RecurringRow { amount: number | null; frequency: string | null }
interface PaidInvoiceRow { total: number; paidAt: Date | null; createdAt: Date; dueDate: Date | null }
interface OpenInvoiceRow { id: string; total: number; dueDate: Date | null; issueDate: Date }
interface AcceptedQuoteRow { id: string; total: number; acceptedAt: Date | null; createdAt: Date }

const HORIZON_DAYS = 30;

@Injectable()
export class RevenueForecastService {
  private readonly logger = new Logger(RevenueForecastService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  async compute(businessId: string): Promise<RevenueForecast> {
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400_000);

    const [biz, paidHistory, openInvoices, acceptedQuotes, recurringRows] = await Promise.all([
      this.db.business.findUnique({ where: { id: businessId }, select: { currency: true } }),
      this.db.invoice.findMany({
        where: { businessId, deletedAt: null, status: 'PAID', paidAt: { gte: ninetyDaysAgo } },
        select: { total: true, paidAt: true, createdAt: true, dueDate: true },
      }),
      this.db.invoice.findMany({
        where: { businessId, deletedAt: null, status: { in: ['SENT', 'OVERDUE', 'PARTIALLY_PAID'] } },
        select: { id: true, total: true, dueDate: true, issueDate: true },
      }),
      this.db.quote.findMany({
        where: { businessId, deletedAt: null, status: 'ACCEPTED', invoiceId: null },
        select: { id: true, total: true, acceptedAt: true, createdAt: true },
      }),
      this.db.recurringInvoice.findMany({
        where: { businessId, status: 'ACTIVE' },
        select: { amount: true, frequency: true },
      }),
    ]);

    const currency = biz?.currency ?? 'TTD';
    const { avgPaymentDays, stdev } = this.computePaymentDayStats(paidHistory as PaidInvoiceRow[]);
    const monthlyRecurring = this.estimateMonthlyRecurring(recurringRows as RecurringRow[]);

    const buckets: ForecastBucket[] = [];
    for (let i = 0; i < HORIZON_DAYS; i++) {
      const day = new Date(now);
      day.setDate(day.getDate() + i);
      day.setHours(0, 0, 0, 0);
      buckets.push({
        date: day.toISOString().slice(0, 10),
        expected: 0, best: 0, worst: 0,
        fromInvoices: 0, fromQuotes: 0, fromRecurring: 0,
      });
    }

    // Invoices: weighted by payment-likelihood curve (S-curve over due date + avg lag).
    for (const inv of openInvoices as OpenInvoiceRow[]) {
      const expectedDayOffset = this.estimateInvoicePayDay(inv, avgPaymentDays, now);
      if (expectedDayOffset == null || expectedDayOffset >= HORIZON_DAYS) continue;
      const dayIdx = Math.max(0, Math.min(HORIZON_DAYS - 1, expectedDayOffset));
      const likelihood = this.invoiceLikelihood(inv, now);
      const amt = Number(inv.total ?? 0);
      buckets[dayIdx].fromInvoices += amt * likelihood;
      buckets[dayIdx].expected += amt * likelihood;
      buckets[dayIdx].best += amt;                         // best: paid in full on time
      buckets[dayIdx].worst += amt * Math.max(0, likelihood - 0.25); // worst: collection lags
    }

    // Accepted quotes → time-to-invoice estimate (~7 days) + payment lag.
    const quoteToInvoiceDays = 7;
    for (const q of acceptedQuotes as AcceptedQuoteRow[]) {
      const acceptedAt = q.acceptedAt ?? q.createdAt;
      const daysSinceAccept = Math.floor((now.getTime() - acceptedAt.getTime()) / 86400_000);
      const dayOffset = Math.max(0, quoteToInvoiceDays + Math.round(avgPaymentDays) - daysSinceAccept);
      if (dayOffset >= HORIZON_DAYS) continue;
      const dayIdx = Math.max(0, Math.min(HORIZON_DAYS - 1, dayOffset));
      const amt = Number(q.total ?? 0);
      // Quote → cash conversion is uncertain. Use 60% midpoint, 80% best, 30% worst.
      buckets[dayIdx].fromQuotes += amt * 0.6;
      buckets[dayIdx].expected += amt * 0.6;
      buckets[dayIdx].best += amt * 0.8;
      buckets[dayIdx].worst += amt * 0.3;
    }

    // Recurring expected revenue spread evenly over horizon.
    if (monthlyRecurring > 0) {
      const dailyRecurring = monthlyRecurring / 30;
      for (const b of buckets) {
        b.fromRecurring += dailyRecurring;
        b.expected += dailyRecurring;
        b.best += dailyRecurring * 1.05;
        b.worst += dailyRecurring * 0.85;
      }
    }

    const totalExpected = buckets.reduce((s, b) => s + b.expected, 0);
    const totalBest = buckets.reduce((s, b) => s + b.best, 0);
    const totalWorst = buckets.reduce((s, b) => s + b.worst, 0);

    const confidence = this.confidenceLabel(paidHistory.length, stdev, avgPaymentDays);

    return {
      businessId,
      currency,
      generatedAt: now.toISOString(),
      horizonDays: HORIZON_DAYS,
      totalExpected: this.r2(totalExpected),
      totalBest: this.r2(totalBest),
      totalWorst: this.r2(totalWorst),
      confidence,
      buckets: buckets.map((b) => ({
        date: b.date,
        expected: this.r2(b.expected),
        best: this.r2(b.best),
        worst: this.r2(b.worst),
        fromInvoices: this.r2(b.fromInvoices),
        fromQuotes: this.r2(b.fromQuotes),
        fromRecurring: this.r2(b.fromRecurring),
      })),
      inputs: {
        openInvoices: openInvoices.length,
        openInvoiceTotal: this.r2(openInvoices.reduce((s, i) => s + Number(i.total ?? 0), 0)),
        acceptedQuotes: acceptedQuotes.length,
        acceptedQuoteTotal: this.r2(acceptedQuotes.reduce((s, q) => s + Number(q.total ?? 0), 0)),
        activeRecurring: recurringRows.length,
        monthlyRecurringEstimate: this.r2(monthlyRecurring),
        avgPaymentDays: Math.round(avgPaymentDays),
        paymentDayStdev: Math.round(stdev * 10) / 10,
      },
    };
  }

  private estimateInvoicePayDay(inv: OpenInvoiceRow, avgPaymentDays: number, now: Date): number | null {
    if (inv.dueDate) {
      const offset = Math.floor((inv.dueDate.getTime() - now.getTime()) / 86400_000);
      // assume paid around due-date + lag (some pay early, some late)
      return Math.max(0, offset + Math.round(avgPaymentDays * 0.3));
    }
    const issued = Math.floor((now.getTime() - inv.issueDate.getTime()) / 86400_000);
    const lag = Math.max(0, Math.round(avgPaymentDays) - issued);
    return lag;
  }

  private invoiceLikelihood(inv: OpenInvoiceRow, now: Date): number {
    if (!inv.dueDate) return 0.6;
    const overdueDays = (now.getTime() - inv.dueDate.getTime()) / 86400_000;
    if (overdueDays <= 0) return 0.85;
    if (overdueDays < 14) return 0.7;
    if (overdueDays < 30) return 0.55;
    if (overdueDays < 60) return 0.4;
    if (overdueDays < 90) return 0.25;
    return 0.1;
  }

  private computePaymentDayStats(rows: PaidInvoiceRow[]): { avgPaymentDays: number; stdev: number } {
    const days: number[] = [];
    for (const r of rows) {
      if (!r.paidAt) continue;
      const start = r.createdAt.getTime();
      const paid = r.paidAt.getTime();
      const d = Math.max(0, (paid - start) / 86400_000);
      days.push(d);
    }
    if (days.length === 0) return { avgPaymentDays: 14, stdev: 7 };
    const avg = days.reduce((a, b) => a + b, 0) / days.length;
    const variance = days.reduce((a, b) => a + (b - avg) ** 2, 0) / days.length;
    return { avgPaymentDays: avg, stdev: Math.sqrt(variance) };
  }

  private estimateMonthlyRecurring(rows: RecurringRow[]): number {
    return rows.reduce((sum, r) => {
      const t = Number(r.amount ?? 0);
      const f = (r.frequency ?? '').toUpperCase();
      if (f === 'WEEKLY') return sum + t * 4.33;
      if (f === 'BIWEEKLY') return sum + t * 2.17;
      if (f === 'MONTHLY') return sum + t;
      if (f === 'QUARTERLY') return sum + t / 3;
      if (f === 'YEARLY') return sum + t / 12;
      return sum + t;
    }, 0);
  }

  private confidenceLabel(historySize: number, stdev: number, avg: number): 'high' | 'medium' | 'low' {
    if (historySize < 5) return 'low';
    const cv = avg > 0 ? stdev / avg : 1;
    if (historySize >= 20 && cv < 0.4) return 'high';
    if (historySize >= 10 && cv < 0.7) return 'medium';
    return 'low';
  }

  private r2(n: number): number {
    return Math.round(n * 100) / 100;
  }
}
