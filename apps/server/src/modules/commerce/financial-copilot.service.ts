import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiUsageService } from '../ai/ai-usage.service';
import { Prisma } from '@prisma/client';

interface LineItem {
  quantity?: number;
  unitPrice?: number;
}

interface FinancialAlert {
  id: string;
  type: 'expense_spike' | 'revenue_drop' | 'cash_shortfall' | 'milestone' | 'unpaid_invoices' | 'overdue_warning';
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  title: string;
  message: string;
  amount?: number;
  percentChange?: number;
  action?: string;
  createdAt: string;
}

interface FinancialPulse {
  cashPosition: number;
  weeklyRevenue: number;
  lastWeekRevenue: number;
  weeklyRevenueChange: number;
  monthlyRevenue: number;
  monthlyExpenses: number;
  netIncome: number;
  outstandingReceivables: number;
  overdueReceivables: number;
  overdueCount: number;
  alerts: FinancialAlert[];
  topUnpaidInvoices: Array<{
    id: string;
    invoiceNumber: string;
    total: number;
    daysOverdue: number;
    contactName: string;
    priority: 'high' | 'medium' | 'low';
  }>;
  cashFlowForecast: Array<{
    period: string;
    projected: number;
    label: string;
  }>;
}

interface WeeklyBriefing {
  summary: string;
  lastWeekRevenue: number;
  lastWeekExpenses: number;
  lastWeekNet: number;
  outstandingReceivables: number;
  cashPosition: number;
  highlights: string[];
  concerns: string[];
  recommendation: string;
  outlook: string;
}

@Injectable()
export class FinancialCopilotService {
  private readonly logger = new Logger(FinancialCopilotService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  private formatTTD(amount: number): string {
    return `TTD ${amount.toLocaleString('en-TT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  async getFinancialPulse(businessId: string): Promise<FinancialPulse> {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const lastWeekStart = new Date(weekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    const lastWeekEnd = new Date(weekStart);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const baseWhere = { businessId, deletedAt: null };

    const [
      weeklyPaid,
      lastWeekPaid,
      monthlyPaid,
      monthlyExpenses,
      outstandingInvoices,
      threeMonthExpenses,
      recentPaidTotal,
      recentExpenseTotal,
      unpaidInvoices,
    ] = await Promise.all([
      this.db.invoice.aggregate({
        where: { ...baseWhere, status: 'PAID', paidAt: { gte: weekStart } },
        _sum: { total: true },
      }),
      this.db.invoice.aggregate({
        where: { ...baseWhere, status: 'PAID', paidAt: { gte: lastWeekStart, lt: lastWeekEnd } },
        _sum: { total: true },
      }),
      this.db.invoice.aggregate({
        where: { ...baseWhere, status: 'PAID', paidAt: { gte: monthStart } },
        _sum: { total: true },
      }),
      this.db.expense.aggregate({
        where: { ...baseWhere, date: { gte: monthStart } },
        _sum: { amount: true },
      }),
      this.db.invoice.findMany({
        where: { ...baseWhere, status: { in: ['SENT', 'OVERDUE'] } },
        select: { total: true, status: true, dueDate: true },
      }),
      this.db.expense.aggregate({
        where: { ...baseWhere, date: { gte: threeMonthsAgo } },
        _sum: { amount: true },
        _count: true,
      }),
      this.db.invoice.aggregate({
        where: { ...baseWhere, status: 'PAID', paidAt: { gte: ninetyDaysAgo } },
        _sum: { total: true },
      }),
      this.db.expense.aggregate({
        where: { ...baseWhere, date: { gte: ninetyDaysAgo } },
        _sum: { amount: true },
      }),
      this.db.invoice.findMany({
        where: { ...baseWhere, status: { in: ['SENT', 'OVERDUE'] } },
        select: {
          id: true,
          invoiceNumber: true,
          total: true,
          dueDate: true,
          status: true,
          contact: { select: { firstName: true, lastName: true, email: true } },
        },
        orderBy: { total: 'desc' },
        take: 10,
      }),
    ]);

    const weeklyRev = weeklyPaid._sum.total ?? 0;
    const lastWeekRev = lastWeekPaid._sum.total ?? 0;
    const monthlyRev = monthlyPaid._sum.total ?? 0;
    const monthlyExp = monthlyExpenses._sum.amount ?? 0;
    const netIncome = monthlyRev - monthlyExp;

    const outstandingTotal = outstandingInvoices.reduce((s, i) => s + (i.total ?? 0), 0);
    const overdueInvs = outstandingInvoices.filter(
      i => i.status === 'OVERDUE' || (i.dueDate && new Date(i.dueDate) < now),
    );
    const overdueTotal = overdueInvs.reduce((s, i) => s + (i.total ?? 0), 0);

    const recentRev = recentPaidTotal._sum.total ?? 0;
    const recentExp = recentExpenseTotal._sum.amount ?? 0;
    const cashPosition = recentRev - recentExp;

    const weeklyChange = lastWeekRev > 0
      ? ((weeklyRev - lastWeekRev) / lastWeekRev) * 100
      : weeklyRev > 0 ? 100 : 0;

    const alerts = await this.detectAnomalies(businessId, {
      weeklyRev,
      lastWeekRev,
      monthlyRev,
      monthlyExp,
      cashPosition,
      outstandingTotal,
      overdueTotal,
      overdueCount: overdueInvs.length,
      threeMonthExpenseAvg: (threeMonthExpenses._sum.amount ?? 0) / 3,
    });

    const topUnpaidInvoices = unpaidInvoices.map(inv => {
      const daysOverdue = inv.dueDate
        ? Math.max(0, Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / 86400000))
        : 0;
      const contactName = inv.contact
        ? `${inv.contact.firstName ?? ''} ${inv.contact.lastName ?? ''}`.trim() || inv.contact.email || 'Unknown'
        : 'Unknown';
      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        total: inv.total,
        daysOverdue,
        contactName,
        priority: (daysOverdue > 30 ? 'high' : daysOverdue > 14 ? 'medium' : 'low') as 'high' | 'medium' | 'low',
      };
    }).sort((a, b) => b.daysOverdue - a.daysOverdue || b.total - a.total);

    const dailyNetRate = (recentRev - recentExp) / 90;
    const cashFlowForecast = [
      { period: '30d', projected: Math.round((cashPosition + dailyNetRate * 30) * 100) / 100, label: '30 Days' },
      { period: '60d', projected: Math.round((cashPosition + dailyNetRate * 60) * 100) / 100, label: '60 Days' },
      { period: '90d', projected: Math.round((cashPosition + dailyNetRate * 90) * 100) / 100, label: '90 Days' },
    ];

    return {
      cashPosition: Math.round(cashPosition * 100) / 100,
      weeklyRevenue: Math.round(weeklyRev * 100) / 100,
      lastWeekRevenue: Math.round(lastWeekRev * 100) / 100,
      weeklyRevenueChange: Math.round(weeklyChange * 10) / 10,
      monthlyRevenue: Math.round(monthlyRev * 100) / 100,
      monthlyExpenses: Math.round(monthlyExp * 100) / 100,
      netIncome: Math.round(netIncome * 100) / 100,
      outstandingReceivables: Math.round(outstandingTotal * 100) / 100,
      overdueReceivables: Math.round(overdueTotal * 100) / 100,
      overdueCount: overdueInvs.length,
      alerts,
      topUnpaidInvoices,
      cashFlowForecast,
    };
  }

  private async detectAnomalies(
    businessId: string,
    data: {
      weeklyRev: number;
      lastWeekRev: number;
      monthlyRev: number;
      monthlyExp: number;
      cashPosition: number;
      outstandingTotal: number;
      overdueTotal: number;
      overdueCount: number;
      threeMonthExpenseAvg: number;
    },
  ): Promise<FinancialAlert[]> {
    const alerts: FinancialAlert[] = [];
    const now = new Date().toISOString();

    if (data.threeMonthExpenseAvg > 0 && data.monthlyExp > data.threeMonthExpenseAvg * 1.35) {
      const pctIncrease = Math.round(((data.monthlyExp - data.threeMonthExpenseAvg) / data.threeMonthExpenseAvg) * 100);
      const increaseAmt = Math.round((data.monthlyExp - data.threeMonthExpenseAvg) * 100) / 100;
      alerts.push({
        id: `expense-spike-${Date.now()}`,
        type: 'expense_spike',
        severity: pctIncrease > 50 ? 'CRITICAL' : 'WARNING',
        title: 'Expense Spike Detected',
        message: `Your expenses this month are ${pctIncrease}% higher than your 3-month average — ${this.formatTTD(increaseAmt)} increase.`,
        amount: increaseAmt,
        percentChange: pctIncrease,
        action: '/app/expenses',
        createdAt: now,
      });
    }

    if (data.lastWeekRev > 0 && data.weeklyRev < data.lastWeekRev * 0.7) {
      const pctDrop = Math.round(((data.lastWeekRev - data.weeklyRev) / data.lastWeekRev) * 100);
      alerts.push({
        id: `revenue-drop-${Date.now()}`,
        type: 'revenue_drop',
        severity: pctDrop > 50 ? 'CRITICAL' : 'WARNING',
        title: 'Revenue Drop',
        message: `Revenue this week is down ${pctDrop}% compared to last week (${this.formatTTD(data.weeklyRev)} vs ${this.formatTTD(data.lastWeekRev)}).`,
        amount: data.lastWeekRev - data.weeklyRev,
        percentChange: -pctDrop,
        action: '/app/commerce',
        createdAt: now,
      });
    }

    const dailyBurnRate = (data.monthlyExp - data.monthlyRev) / 30;
    if (dailyBurnRate > 0 && data.cashPosition > 0) {
      const daysUntilNegative = Math.ceil(data.cashPosition / dailyBurnRate);
      if (daysUntilNegative <= 30) {
        alerts.push({
          id: `cash-shortfall-${Date.now()}`,
          type: 'cash_shortfall',
          severity: daysUntilNegative <= 14 ? 'CRITICAL' : 'WARNING',
          title: 'Cash Shortfall Warning',
          message: `At the current rate, your cash flow may turn negative in ${daysUntilNegative} days. Consider collecting outstanding invoices.`,
          amount: data.cashPosition,
          action: '/app/commerce',
          createdAt: now,
        });
      }
    }

    if (data.overdueTotal > 0) {
      alerts.push({
        id: `overdue-${Date.now()}`,
        type: 'overdue_warning',
        severity: data.overdueCount > 5 ? 'CRITICAL' : 'WARNING',
        title: 'Overdue Invoices',
        message: `You have ${data.overdueCount} overdue invoice${data.overdueCount > 1 ? 's' : ''} totaling ${this.formatTTD(data.overdueTotal)}. Prioritize collection to maintain cash flow.`,
        amount: data.overdueTotal,
        action: '/app/commerce',
        createdAt: now,
      });
    }

    if (data.outstandingTotal > data.monthlyRev * 1.5 && data.outstandingTotal > 0) {
      alerts.push({
        id: `unpaid-${Date.now()}`,
        type: 'unpaid_invoices',
        severity: 'WARNING',
        title: 'High Outstanding Receivables',
        message: `Outstanding invoices total ${this.formatTTD(data.outstandingTotal)} — more than 1.5x your monthly revenue. Follow up with clients.`,
        amount: data.outstandingTotal,
        action: '/app/commerce',
        createdAt: now,
      });
    }

    const bestWeek = await this.checkRevenueMilestone(businessId, data.weeklyRev);
    if (bestWeek) {
      alerts.push(bestWeek);
    }

    return alerts;
  }

  private async checkRevenueMilestone(businessId: string, currentWeekRevenue: number): Promise<FinancialAlert | null> {
    if (currentWeekRevenue <= 0) return null;

    const now = new Date();
    const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const previousWeeks = await this.db.invoice.findMany({
      where: {
        businessId,
        deletedAt: null,
        status: 'PAID',
        paidAt: { gte: quarterStart, lt: weekStart },
      },
      select: { total: true, paidAt: true },
    });

    const weeklyTotals = new Map<string, number>();
    for (const inv of previousWeeks) {
      if (!inv.paidAt) continue;
      const d = new Date(inv.paidAt);
      const weekKey = `${d.getFullYear()}-W${Math.ceil((d.getDate() + new Date(d.getFullYear(), d.getMonth(), 1).getDay()) / 7)}`;
      weeklyTotals.set(weekKey, (weeklyTotals.get(weekKey) ?? 0) + inv.total);
    }

    const maxPrevious = Math.max(0, ...Array.from(weeklyTotals.values()));

    if (currentWeekRevenue > maxPrevious && maxPrevious > 0) {
      return {
        id: `milestone-${Date.now()}`,
        type: 'milestone',
        severity: 'INFO',
        title: 'Revenue Milestone!',
        message: `You earned ${this.formatTTD(currentWeekRevenue)} this week — your best week this quarter!`,
        amount: currentWeekRevenue,
        createdAt: new Date().toISOString(),
      };
    }

    return null;
  }

  async getCashFlowForecast(businessId: string): Promise<{
    currentBalance: number;
    projections: Array<{ days: number; label: string; projected: number; confidence: string }>;
    recurringRevenue: number;
    recurringExpenses: number;
    outstandingReceivables: number;
    avgPaymentDays: number;
    risks: string[];
    opportunities: string[];
    collectionPriority: Array<{ invoiceNumber: string; total: number; daysOverdue: number; contactName: string }>;
  }> {
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const [
      paidInvoices,
      expenses,
      outstandingInvoices,
      recurringInvoices,
      recurringExpenses,
    ] = await Promise.all([
      this.db.invoice.findMany({
        where: { businessId, deletedAt: null, status: 'PAID', paidAt: { gte: ninetyDaysAgo } },
        select: { total: true, paidAt: true, createdAt: true },
        orderBy: { paidAt: 'asc' },
      }),
      this.db.expense.findMany({
        where: { businessId, deletedAt: null, date: { gte: ninetyDaysAgo } },
        select: { amount: true, date: true },
        orderBy: { date: 'asc' },
      }),
      this.db.invoice.findMany({
        where: { businessId, deletedAt: null, status: { in: ['SENT', 'OVERDUE'] } },
        select: {
          invoiceNumber: true,
          total: true,
          dueDate: true,
          createdAt: true,
          contact: { select: { firstName: true, lastName: true, email: true } },
        },
        orderBy: { total: 'desc' },
      }),
      this.db.recurringInvoice.findMany({
        where: { businessId, isActive: true, deletedAt: null },
        select: { name: true, frequency: true, lineItems: true },
      }),
      this.db.expense.findMany({
        where: { businessId, deletedAt: null, isRecurring: true },
        select: { amount: true, recurringFrequency: true },
      }),
    ]);

    const totalRev90 = paidInvoices.reduce((s, i) => s + i.total, 0);
    const totalExp90 = expenses.reduce((s, e) => s + e.amount, 0);
    const dailyRevRate = totalRev90 / 90;
    const dailyExpRate = totalExp90 / 90;
    const currentBalance = totalRev90 - totalExp90;

    const paymentDays = paidInvoices
      .filter(i => i.paidAt && i.createdAt)
      .map(i => Math.max(0, (new Date(i.paidAt!).getTime() - new Date(i.createdAt).getTime()) / 86400000));
    const avgPaymentDays = paymentDays.length > 0
      ? Math.round(paymentDays.reduce((a, b) => a + b, 0) / paymentDays.length)
      : 0;

    const monthlyRecurringRev = recurringInvoices.reduce((sum, ri) => {
      const items = (Array.isArray(ri.lineItems) ? ri.lineItems : []) as LineItem[];
      const total = items.reduce((s, item) => s + ((item.quantity ?? 1) * (item.unitPrice ?? 0)), 0);
      const freq = ri.frequency?.toUpperCase();
      if (freq === 'WEEKLY') return sum + total * 4.33;
      if (freq === 'BIWEEKLY') return sum + total * 2.17;
      if (freq === 'MONTHLY') return sum + total;
      if (freq === 'QUARTERLY') return sum + total / 3;
      if (freq === 'YEARLY') return sum + total / 12;
      return sum + total;
    }, 0);

    const monthlyRecurringExp = recurringExpenses.reduce((sum, e) => {
      const freq = e.recurringFrequency?.toUpperCase();
      if (freq === 'WEEKLY') return sum + e.amount * 4.33;
      if (freq === 'BIWEEKLY') return sum + e.amount * 2.17;
      if (freq === 'MONTHLY') return sum + e.amount;
      if (freq === 'QUARTERLY') return sum + e.amount / 3;
      if (freq === 'YEARLY') return sum + e.amount / 12;
      return sum + e.amount;
    }, 0);

    const outstandingTotal = outstandingInvoices.reduce((s, i) => s + i.total, 0);

    const dailyRecurringRev = monthlyRecurringRev / 30;
    const dailyRecurringExp = monthlyRecurringExp / 30;

    const collectionRate = avgPaymentDays > 0 ? Math.min(1, 30 / avgPaymentDays) : 0.5;
    const expectedCollections30 = outstandingTotal * collectionRate;
    const expectedCollections60 = outstandingTotal * Math.min(1, collectionRate * 1.5);
    const expectedCollections90 = outstandingTotal * Math.min(1, collectionRate * 2);

    const projections = [
      { days: 30, expectedCollections: expectedCollections30 },
      { days: 60, expectedCollections: expectedCollections60 },
      { days: 90, expectedCollections: expectedCollections90 },
    ].map(({ days, expectedCollections }) => {
      const historicalNet = (dailyRevRate - dailyExpRate) * days;
      const recurringNet = (dailyRecurringRev - dailyRecurringExp) * days;
      const blendedNet = (historicalNet + recurringNet) / 2;
      const projected = currentBalance + blendedNet + expectedCollections;
      const confidence = days <= 30 ? 'high' : days <= 60 ? 'medium' : 'low';
      return {
        days,
        label: `${days} Days`,
        projected: Math.round(projected * 100) / 100,
        confidence,
      };
    });

    const risks: string[] = [];
    const opportunities: string[] = [];

    if (dailyExpRate > dailyRevRate * 0.9) {
      risks.push('Expenses are consuming more than 90% of revenue.');
    }
    if (projections[0].projected < 0) {
      risks.push('Cash flow is projected to turn negative within 30 days.');
    }
    if (avgPaymentDays > 30) {
      risks.push(`Average payment collection takes ${avgPaymentDays} days — consider tighter payment terms.`);
    }
    if (outstandingTotal > totalRev90 / 3) {
      risks.push(`Outstanding receivables (${this.formatTTD(outstandingTotal)}) are high relative to quarterly revenue.`);
    }

    if (monthlyRecurringRev > 0) {
      opportunities.push(`Recurring revenue of ${this.formatTTD(monthlyRecurringRev)}/month provides a stable base.`);
    }
    if (outstandingTotal > 0) {
      opportunities.push(`Collecting outstanding invoices could add ${this.formatTTD(outstandingTotal)} to cash position.`);
    }
    if (dailyRevRate > dailyExpRate * 1.5) {
      opportunities.push('Strong revenue-to-expense ratio — consider reinvesting in growth.');
    }

    const collectionPriority = outstandingInvoices.map(inv => {
      const daysOverdue = inv.dueDate
        ? Math.max(0, Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / 86400000))
        : 0;
      const contactName = inv.contact
        ? `${inv.contact.firstName ?? ''} ${inv.contact.lastName ?? ''}`.trim() || inv.contact.email || 'Unknown'
        : 'Unknown';
      return {
        invoiceNumber: inv.invoiceNumber,
        total: inv.total,
        daysOverdue,
        contactName,
      };
    }).sort((a, b) => (b.total * (1 + b.daysOverdue / 30)) - (a.total * (1 + a.daysOverdue / 30)))
      .slice(0, 5);

    return {
      currentBalance: Math.round(currentBalance * 100) / 100,
      projections,
      recurringRevenue: Math.round(monthlyRecurringRev * 100) / 100,
      recurringExpenses: Math.round(monthlyRecurringExp * 100) / 100,
      outstandingReceivables: Math.round(outstandingTotal * 100) / 100,
      avgPaymentDays,
      risks,
      opportunities,
      collectionPriority,
    };
  }

  async generateWeeklyBriefing(businessId: string): Promise<WeeklyBriefing> {
    const now = new Date();
    const lastWeekEnd = new Date(now);
    lastWeekEnd.setDate(lastWeekEnd.getDate() - lastWeekEnd.getDay());
    lastWeekEnd.setHours(0, 0, 0, 0);
    const lastWeekStart = new Date(lastWeekEnd);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);

    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const [lastWeekPaid, lastWeekExpenses, outstandingInvs, recentRev, recentExp, business] = await Promise.all([
      this.db.invoice.aggregate({
        where: { businessId, deletedAt: null, status: 'PAID', paidAt: { gte: lastWeekStart, lt: lastWeekEnd } },
        _sum: { total: true },
        _count: true,
      }),
      this.db.expense.aggregate({
        where: { businessId, deletedAt: null, date: { gte: lastWeekStart, lt: lastWeekEnd } },
        _sum: { amount: true },
        _count: true,
      }),
      this.db.invoice.aggregate({
        where: { businessId, deletedAt: null, status: { in: ['SENT', 'OVERDUE'] } },
        _sum: { total: true },
        _count: true,
      }),
      this.db.invoice.aggregate({
        where: { businessId, deletedAt: null, status: 'PAID', paidAt: { gte: ninetyDaysAgo } },
        _sum: { total: true },
      }),
      this.db.expense.aggregate({
        where: { businessId, deletedAt: null, date: { gte: ninetyDaysAgo } },
        _sum: { amount: true },
      }),
      this.db.business.findUnique({
        where: { id: businessId },
        select: { name: true, industry: true, currency: true },
      }),
    ]);

    const rev = lastWeekPaid._sum.total ?? 0;
    const exp = lastWeekExpenses._sum.amount ?? 0;
    const net = rev - exp;
    const outstanding = outstandingInvs._sum.total ?? 0;
    const cashPosition = (recentRev._sum.total ?? 0) - (recentExp._sum.amount ?? 0);

    const dataContext = `Business: ${business?.name ?? 'Business'}
Industry: ${business?.industry ?? 'General'}
Currency: ${business?.currency ?? 'TTD'}

Last Week Performance:
- Revenue: ${this.formatTTD(rev)} from ${lastWeekPaid._count ?? 0} paid invoices
- Expenses: ${this.formatTTD(exp)} across ${lastWeekExpenses._count ?? 0} transactions
- Net Income: ${this.formatTTD(net)}

Current Position:
- Cash Position (90-day): ${this.formatTTD(cashPosition)}
- Outstanding Receivables: ${this.formatTTD(outstanding)} across ${outstandingInvs._count ?? 0} invoices`;

    try {
      const result = await this.aiUsage.callAi({
        businessId,
        feature: 'financial_weekly_briefing',
        messages: [
          {
            role: 'system',
            content: `You are a financial copilot for a Caribbean small business. Generate a plain-English weekly financial briefing. Be warm, clear, and actionable. Use TTD currency. Respond ONLY with valid JSON:
{"summary":"2-3 sentence overview","highlights":["positive point 1","positive point 2"],"concerns":["concern 1"],"recommendation":"one specific actionable recommendation","outlook":"brief outlook for this week"}`,
          },
          { role: 'user', content: `Generate the weekly financial briefing based on this data:\n\n${dataContext}` },
        ],
        maxTokens: 800,
        temperature: 0.5,
        outputCategory: 'briefings',
        
      });

      try {
        const parsed = JSON.parse(result.content);
        return {
          ...parsed,
          lastWeekRevenue: rev,
          lastWeekExpenses: exp,
          lastWeekNet: net,
          outstandingReceivables: outstanding,
          cashPosition: Math.round(cashPosition * 100) / 100,
        };
      } catch {
        return {
          summary: result.content,
          lastWeekRevenue: rev,
          lastWeekExpenses: exp,
          lastWeekNet: net,
          outstandingReceivables: outstanding,
          cashPosition: Math.round(cashPosition * 100) / 100,
          highlights: [],
          concerns: [],
          recommendation: 'Review your outstanding invoices and follow up with clients this week.',
          outlook: 'Keep monitoring your cash flow closely.',
        };
      }
    } catch (error) {
      this.logger.error(`Weekly briefing generation failed: ${(error as Error).message}`);
      return {
        summary: `Last week you earned ${this.formatTTD(rev)} and spent ${this.formatTTD(exp)}, for a net of ${this.formatTTD(net)}.`,
        lastWeekRevenue: rev,
        lastWeekExpenses: exp,
        lastWeekNet: net,
        outstandingReceivables: outstanding,
        cashPosition: Math.round(cashPosition * 100) / 100,
        highlights: rev > 0 ? [`Collected ${this.formatTTD(rev)} in revenue`] : [],
        concerns: outstanding > 0 ? [`${this.formatTTD(outstanding)} in outstanding invoices`] : [],
        recommendation: 'Follow up on outstanding invoices to maintain healthy cash flow.',
        outlook: 'Focus on collections and controlling expenses this week.',
      };
    }
  }

  async checkExpenseAnomaly(businessId: string, newExpenseAmount: number, categoryId?: string): Promise<FinancialAlert | null> {
    const now = new Date();
    const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const where: Prisma.ExpenseWhereInput = { businessId, deletedAt: null, date: { gte: threeMonthsAgo, lt: monthStart } };
    if (categoryId) where.categoryId = categoryId;

    const historicalExpenses = await this.db.expense.aggregate({
      where,
      _sum: { amount: true },
    });

    const monthlyAvg = (historicalExpenses._sum.amount ?? 0) / 3;

    const currentMonthWhere: Prisma.ExpenseWhereInput = { businessId, deletedAt: null, date: { gte: monthStart } };
    if (categoryId) currentMonthWhere.categoryId = categoryId;

    const currentMonth = await this.db.expense.aggregate({
      where: currentMonthWhere,
      _sum: { amount: true },
    });

    const currentTotal = currentMonth._sum.amount ?? 0;

    if (monthlyAvg > 0 && currentTotal > monthlyAvg * 1.35) {
      const pctIncrease = Math.round(((currentTotal - monthlyAvg) / monthlyAvg) * 100);
      const increase = Math.round((currentTotal - monthlyAvg) * 100) / 100;

      let categoryName = 'expenses';
      if (categoryId) {
        const cat = await this.db.expenseCategory.findUnique({ where: { id: categoryId }, select: { name: true } });
        if (cat) categoryName = cat.name;
      }

      return {
        id: `expense-anomaly-${Date.now()}`,
        type: 'expense_spike',
        severity: pctIncrease > 50 ? 'CRITICAL' : 'WARNING',
        title: 'Expense Spike Detected',
        message: `Your ${categoryName} this month are ${pctIncrease}% higher than your 3-month average — ${this.formatTTD(increase)} increase.`,
        amount: increase,
        percentChange: pctIncrease,
        action: '/app/expenses',
        createdAt: new Date().toISOString(),
      };
    }

    return null;
  }

  async checkRevenueMilestoneOnPayment(businessId: string, invoiceTotal: number): Promise<FinancialAlert | null> {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const weeklyPaid = await this.db.invoice.aggregate({
      where: { businessId, deletedAt: null, status: 'PAID', paidAt: { gte: weekStart } },
      _sum: { total: true },
    });

    const currentWeekRev = (weeklyPaid._sum.total ?? 0);
    return this.checkRevenueMilestone(businessId, currentWeekRev);
  }
}
