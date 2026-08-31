import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface CashflowSeriesPoint {
  date: string;
  cash: number;
  inflow: number;
  outflow: number;
}

export interface ForecastEvent {
  date: string;
  type: 'INFLOW' | 'OUTFLOW';
  source: string;
  amount: number;
  probability: number;
  description: string;
}

export interface CashflowForecastDto {
  generatedAt: string;
  currency: string;
  horizonDays: number;
  openingCash: number;
  projectedClosingCash: number;
  lowestProjectedCash: number;
  dangerDates: Array<{ date: string; projectedCash: number; reason: string }>;
  scenarios: {
    expected: CashflowSeriesPoint[];
    conservative: CashflowSeriesPoint[];
    optimistic: CashflowSeriesPoint[];
  };
  inflows: ForecastEvent[];
  outflows: ForecastEvent[];
  recommendations: Array<{ title: string; description: string; impact: number }>;
}

@Injectable()
export class CashflowForecastService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async forecast(businessId: string, horizonDays = 90): Promise<CashflowForecastDto> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { currency: true },
    });
    const currency = business?.currency ?? 'TTD';

    const now = new Date();
    const horizonEnd = new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000);

    const [cashAccounts, openInvoices, recurringExpenses, taxLiabilities] = await Promise.all([
      this.prisma.client.financialAccount.findMany({
        where: { businessId, isActive: true, type: { in: ['CASH', 'BANK', 'PAYMENT_PROCESSOR'] } },
        select: { currentBalance: true },
      }),
      this.prisma.client.invoice.findMany({
        where: {
          businessId,
          deletedAt: null,
          status: { in: ['SENT', 'OVERDUE', 'PARTIALLY_PAID'] },
          dueDate: { gte: now, lte: horizonEnd },
        },
        select: { id: true, total: true, dueDate: true, status: true },
      }),
      this.prisma.client.recurringExpense.findMany({
        where: {
          businessId,
          isActive: true,
          nextRunDate: { gte: now, lte: horizonEnd },
        },
        select: { amount: true, nextRunDate: true, vendor: true, description: true },
      }),
      this.prisma.client.taxLiability.findMany({
        where: {
          businessId,
          status: { in: ['OPEN', 'FILED'] },
          periodEnd: { gte: now, lte: horizonEnd },
        },
        select: { amountDue: true, periodEnd: true, type: true },
      }),
    ]);

    const openingCash = cashAccounts.reduce((sum, a) => sum + Number(a.currentBalance ?? 0), 0);

    // Build events
    const inflowEvents: ForecastEvent[] = openInvoices.map((inv) => ({
      date: (inv.dueDate ?? now).toISOString().slice(0, 10),
      type: 'INFLOW',
      source: 'invoice',
      amount: Number(inv.total ?? 0),
      probability: inv.status === 'OVERDUE' ? 0.6 : 0.85,
      description: `Invoice ${inv.status?.toLowerCase()}`,
    }));

    const outflowEvents: ForecastEvent[] = [
      ...recurringExpenses.map((e) => ({
        date: (e.nextRunDate ?? now).toISOString().slice(0, 10),
        type: 'OUTFLOW' as const,
        source: 'recurring_bill',
        amount: Number(e.amount ?? 0),
        probability: 1.0,
        description: `Recurring bill: ${e.description || e.vendor || 'Vendor'}`,
      })),
      ...taxLiabilities.map((t) => ({
        date: (t.periodEnd ?? now).toISOString().slice(0, 10),
        type: 'OUTFLOW' as const,
        source: 'tax',
        amount: Number(t.amountDue ?? 0),
        probability: 1.0,
        description: `Tax liability: ${t.type}`,
      })),
    ];

    // Generate daily series
    const expected: CashflowSeriesPoint[] = [];
    const conservative: CashflowSeriesPoint[] = [];
    const optimistic: CashflowSeriesPoint[] = [];

    let cashExp = openingCash;
    let cashCon = openingCash;
    let cashOpt = openingCash;
    let lowest = openingCash;
    const dangerDates: Array<{ date: string; projectedCash: number; reason: string }> = [];

    for (let d = 0; d <= horizonDays; d++) {
      const date = new Date(now.getTime() + d * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().slice(0, 10);

      const dayInflow = inflowEvents
        .filter((e) => e.date === dateStr)
        .reduce((sum, e) => sum + e.amount * e.probability, 0);
      const dayOutflow = outflowEvents
        .filter((e) => e.date === dateStr)
        .reduce((sum, e) => sum + e.amount * e.probability, 0);

      cashExp += dayInflow - dayOutflow;
      cashCon += dayInflow * 0.7 - dayOutflow;
      cashOpt += dayInflow * 1.2 - dayOutflow;

      expected.push({ date: dateStr, cash: Math.round(cashExp), inflow: Math.round(dayInflow), outflow: Math.round(dayOutflow) });
      conservative.push({ date: dateStr, cash: Math.round(cashCon), inflow: Math.round(dayInflow * 0.7), outflow: Math.round(dayOutflow) });
      optimistic.push({ date: dateStr, cash: Math.round(cashOpt), inflow: Math.round(dayInflow * 1.2), outflow: Math.round(dayOutflow) });

      if (cashExp < lowest) lowest = cashExp;
      if (cashExp < 0) {
        dangerDates.push({ date: dateStr, projectedCash: Math.round(cashExp), reason: 'Projected cash below zero' });
      }
    }

    const recommendations: Array<{ title: string; description: string; impact: number }> = [];
    if (lowest < 0) {
      recommendations.push({
        title: 'Cash danger detected',
        description: `Your cash may go negative within ${horizonDays} days. Consider collecting overdue invoices or delaying non-critical expenses.`,
        impact: Math.abs(Math.round(lowest)),
      });
    }
    if (inflowEvents.some((e) => e.source === 'invoice' && e.probability < 0.8)) {
      recommendations.push({
        title: 'Collect overdue invoices',
        description: 'Some invoices are overdue and may not pay on time. Proactive collection improves forecast accuracy.',
        impact: Math.round(inflowEvents.filter((e) => e.probability < 0.8).reduce((s, e) => s + e.amount, 0)),
      });
    }

    return {
      generatedAt: now.toISOString(),
      currency,
      horizonDays,
      openingCash,
      projectedClosingCash: Math.round(cashExp),
      lowestProjectedCash: Math.round(lowest),
      dangerDates: dangerDates.slice(0, 5),
      scenarios: { expected, conservative, optimistic },
      inflows: inflowEvents,
      outflows: outflowEvents,
      recommendations,
    };
  }
}
