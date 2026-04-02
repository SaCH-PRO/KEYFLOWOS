import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiUsageService } from '../ai/ai-usage.service';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiUsage: AiUsageService,
  ) {}

  async generateReport(businessId: string, type: string, startDate?: string, endDate?: string, compare = false) {
    const now = new Date();
    const start = startDate ? new Date(startDate) : new Date(now.getFullYear(), now.getMonth(), 1);
    const end = endDate ? new Date(endDate) : now;

    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: { name: true, industry: true, archetype: true, revenueModel: true, currency: true, tagline: true },
    });

    const currency = business?.currency || 'TTD';

    const [
      allInvoices,
      paidInvoicesInPeriod,
      allExpensesInPeriod,
      expensesByCategory,
      contacts,
      contactsByStatus,
      bookings,
      products,
    ] = await Promise.all([
      this.prisma.client.invoice.findMany({
        where: { businessId, deletedAt: null, createdAt: { gte: start, lte: end } },
        select: { id: true, invoiceNumber: true, total: true, status: true, createdAt: true, dueDate: true, paidAt: true, currency: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.client.invoice.aggregate({
        where: { businessId, deletedAt: null, status: 'PAID', paidAt: { gte: start, lte: end } },
        _sum: { total: true },
        _count: true,
      }),
      this.prisma.client.expense.findMany({
        where: { businessId, deletedAt: null, date: { gte: start, lte: end } },
        select: { id: true, description: true, amount: true, date: true, vendor: true, categoryId: true, category: { select: { name: true } } },
        orderBy: { date: 'desc' },
      }),
      this.prisma.client.expense.groupBy({
        by: ['categoryId'],
        where: { businessId, deletedAt: null, date: { gte: start, lte: end } },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.client.contact.count({ where: { businessId, deletedAt: null } }),
      this.prisma.client.contact.groupBy({
        by: ['status'],
        where: { businessId, deletedAt: null },
        _count: true,
      }),
      this.prisma.client.booking.findMany({
        where: { businessId, deletedAt: null, startTime: { gte: start, lte: end } },
        select: { id: true, status: true, startTime: true },
      }),
      this.prisma.client.product.count({ where: { businessId, deletedAt: null } }),
    ]);

    const categoryIds = expensesByCategory.map(e => e.categoryId).filter(Boolean);
    const categories = categoryIds.length > 0 ? await this.prisma.client.expenseCategory.findMany({
      where: { id: { in: categoryIds as string[] } },
      select: { id: true, name: true },
    }) : [];
    const categoryMap = new Map(categories.map(c => [c.id, c.name]));

    const [outstandingInvoices, overdueInvoices] = await Promise.all([
      this.prisma.client.invoice.aggregate({
        where: { businessId, deletedAt: null, status: { in: ['SENT', 'DRAFT'] } },
        _sum: { total: true },
        _count: true,
      }),
      this.prisma.client.invoice.count({
        where: { businessId, deletedAt: null, status: { in: ['SENT', 'DRAFT'] }, dueDate: { lt: now } },
      }),
    ]);

    const totalRevenue = Number(paidInvoicesInPeriod._sum.total ?? 0);
    const totalExpenses = allExpensesInPeriod.reduce((sum, e) => sum + Number(e.amount), 0);
    const netProfit = totalRevenue - totalExpenses;
    const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

    const invoicesByStatus: Record<string, { count: number; total: number }> = {};
    for (const inv of allInvoices) {
      if (!invoicesByStatus[inv.status]) invoicesByStatus[inv.status] = { count: 0, total: 0 };
      invoicesByStatus[inv.status].count++;
      invoicesByStatus[inv.status].total += Number(inv.total);
    }

    const expenseCategoryBreakdown = expensesByCategory.map(e => ({
      category: categoryMap.get(e.categoryId ?? '') || 'Uncategorized',
      total: Number(e._sum.amount ?? 0),
      count: e._count,
    })).sort((a, b) => b.total - a.total);

    const topExpenseVendors: Record<string, number> = {};
    for (const exp of allExpensesInPeriod) {
      const vendor = exp.vendor || 'Unknown';
      topExpenseVendors[vendor] = (topExpenseVendors[vendor] || 0) + Number(exp.amount);
    }
    const sortedVendors = Object.entries(topExpenseVendors).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([vendor, total]) => ({ vendor, total }));

    const confirmedBookings = bookings.filter(b => b.status === 'CONFIRMED').length;
    const completedBookings = bookings.filter(b => b.status === 'COMPLETED').length;
    const cancelledBookings = bookings.filter(b => b.status === 'CANCELLED').length;
    const pendingBookings = bookings.filter(b => b.status === 'PENDING').length;

    const contactStatusBreakdown = contactsByStatus.map(c => ({
      status: c.status || 'Unknown',
      count: c._count,
    }));

    const clientInvoiceTotals: Record<string, number> = {};
    const invoicesWithContacts = await this.prisma.client.invoice.findMany({
      where: { businessId, deletedAt: null, status: 'PAID', paidAt: { gte: start, lte: end } },
      select: { total: true, contact: { select: { id: true, firstName: true, lastName: true, displayName: true } } },
    });
    for (const inv of invoicesWithContacts) {
      if (inv.contact) {
        const name = inv.contact.displayName || `${inv.contact.firstName || ''} ${inv.contact.lastName || ''}`.trim() || 'Unknown';
        clientInvoiceTotals[name] = (clientInvoiceTotals[name] || 0) + Number(inv.total);
      }
    }
    const topClients = Object.entries(clientInvoiceTotals).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, total]) => ({ name, total }));

    const metrics = {
      period: { start: start.toISOString(), end: end.toISOString() },
      currency,
      revenue: {
        total: totalRevenue,
        invoiceCount: paidInvoicesInPeriod._count ?? 0,
        averageInvoice: (paidInvoicesInPeriod._count ?? 0) > 0 ? totalRevenue / (paidInvoicesInPeriod._count ?? 1) : 0,
        byStatus: invoicesByStatus,
        outstanding: Number(outstandingInvoices._sum.total ?? 0),
        outstandingCount: outstandingInvoices._count ?? 0,
        overdueCount: overdueInvoices,
        topClients,
      },
      expenses: {
        total: totalExpenses,
        count: allExpensesInPeriod.length,
        averageExpense: allExpensesInPeriod.length > 0 ? totalExpenses / allExpensesInPeriod.length : 0,
        byCategory: expenseCategoryBreakdown,
        topVendors: sortedVendors,
      },
      profitability: {
        netProfit,
        profitMargin: Math.round(profitMargin * 100) / 100,
        revenueToExpenseRatio: totalExpenses > 0 ? Math.round((totalRevenue / totalExpenses) * 100) / 100 : null,
      },
      clients: {
        totalContacts: contacts,
        byStatus: contactStatusBreakdown,
      },
      bookings: {
        total: bookings.length,
        confirmed: confirmedBookings,
        completed: completedBookings,
        cancelled: cancelledBookings,
        pending: pendingBookings,
        completionRate: bookings.length > 0 ? Math.round((completedBookings / bookings.length) * 100) : 0,
      },
      products: {
        total: products,
      },
      business: {
        name: business?.name || 'Business',
        industry: business?.industry || null,
        archetype: business?.archetype || null,
        revenueModel: business?.revenueModel || null,
      },
    };

    let aiNarrative = '';
    try {
      const reportTypeTitles: Record<string, string> = {
        executive: 'Executive Summary',
        pnl: 'Profit & Loss Statement',
        revenue: 'Revenue Analysis',
        expenses: 'Expense Analysis',
        clients: 'Client Portfolio Analysis',
      };
      const reportTitle = reportTypeTitles[type] || 'Executive Summary';

      const prompt = `You are a professional business analyst preparing a ${reportTitle} report for "${metrics.business.name}". Generate a concise, professional narrative suitable for high-level stakeholder meetings.

BUSINESS DATA (${start.toLocaleDateString()} to ${end.toLocaleDateString()}):
- Industry: ${metrics.business.industry || 'Not specified'}
- Revenue Model: ${metrics.business.revenueModel || 'Not specified'}
- Total Revenue: $${totalRevenue.toLocaleString()} ${currency} from ${metrics.revenue.invoiceCount} paid invoices
- Average Invoice Value: $${metrics.revenue.averageInvoice.toLocaleString()} ${currency}
- Outstanding Receivables: $${metrics.revenue.outstanding.toLocaleString()} ${currency} (${metrics.revenue.outstandingCount} invoices, ${metrics.revenue.overdueCount} overdue)
- Total Expenses: $${totalExpenses.toLocaleString()} ${currency} across ${metrics.expenses.count} entries
- Top Expense Categories: ${expenseCategoryBreakdown.slice(0, 5).map(c => `${c.category}: $${c.total.toLocaleString()}`).join(', ') || 'None recorded'}
- Net Profit: $${netProfit.toLocaleString()} ${currency}
- Profit Margin: ${profitMargin.toFixed(1)}%
- Total Contacts: ${contacts} (${contactStatusBreakdown.map(c => `${c.count} ${c.status}`).join(', ')})
- Bookings: ${bookings.length} total (${completedBookings} completed, ${confirmedBookings} confirmed, ${pendingBookings} pending, ${cancelledBookings} cancelled)
- Products/Services: ${products}
- Top Clients by Revenue: ${topClients.slice(0, 5).map(c => `${c.name}: $${c.total.toLocaleString()}`).join(', ') || 'No client data'}

${type === 'executive' ? `Write an executive summary with: 1) Business Overview paragraph, 2) Financial Performance paragraph, 3) Key Metrics highlights, 4) Recommendations (3-5 actionable items), 5) Outlook paragraph. Keep it professional, data-driven, and suitable for board presentations.` : ''}
${type === 'pnl' ? `Write a Profit & Loss analysis with: 1) Revenue Analysis paragraph, 2) Expense Analysis paragraph, 3) Net Profit Assessment, 4) Key Financial Ratios, 5) Cost Optimization Recommendations. Focus on financial accuracy and actionable insights.` : ''}
${type === 'revenue' ? `Write a Revenue Analysis with: 1) Revenue Performance Summary, 2) Invoice Collection Efficiency, 3) Client Revenue Concentration Analysis, 4) Outstanding Receivables Risk Assessment, 5) Revenue Growth Recommendations.` : ''}
${type === 'expenses' ? `Write an Expense Analysis with: 1) Expense Overview, 2) Category Breakdown Analysis, 3) Vendor Concentration, 4) Cost-to-Revenue Ratio Assessment, 5) Cost Reduction Opportunities.` : ''}
${type === 'clients' ? `Write a Client Portfolio Analysis with: 1) Portfolio Overview, 2) Client Segmentation Analysis, 3) Client Engagement Metrics, 4) Client Retention Assessment, 5) Growth Opportunities.` : ''}

Use ${currency} for all monetary values. Be specific with numbers. Keep each section concise but insightful. Format with clear section headers using **bold**.`;

      const result = await this.aiUsage.callAi({
        businessId,
        feature: 'report_narrative',
        messages: [
          { role: 'system', content: `You are a senior business analyst preparing professional reports for ${metrics.business.name}. Write clear, data-driven narratives suitable for board-level presentations. Use ${currency} currency. Be precise and actionable.` },
          { role: 'user', content: prompt },
        ],
        maxTokens: 1500,
        temperature: 0.4,
      });

      aiNarrative = result.content;
    } catch (error) {
      this.logger.error(`Report AI narrative error: ${(error as Error).message}`);
      aiNarrative = 'AI analysis is temporarily unavailable. Please review the data metrics below.';
    }

    let comparison: {
      period: { start: string; end: string };
      revenue: { total: number; invoiceCount: number; changePct: number };
      expenses: { total: number; count: number; changePct: number };
      profitability: { netProfit: number; profitMargin: number; changePct: number };
      bookings: { total: number; changePct: number };
      clients: { totalContacts: number; newContacts: number; changePct: number };
    } | null = null;
    if (compare) {
      const periodMs = end.getTime() - start.getTime();
      const prevEnd = new Date(start.getTime() - 1);
      const prevStart = new Date(prevEnd.getTime() - periodMs);

      const [prevPaid, prevExpenses, prevBookings, prevContacts, currentPeriodContacts] = await Promise.all([
        this.prisma.client.invoice.aggregate({
          where: { businessId, deletedAt: null, status: 'PAID', paidAt: { gte: prevStart, lte: prevEnd } },
          _sum: { total: true },
          _count: true,
        }),
        this.prisma.client.expense.aggregate({
          where: { businessId, deletedAt: null, date: { gte: prevStart, lte: prevEnd } },
          _sum: { amount: true },
          _count: true,
        }),
        this.prisma.client.booking.count({
          where: { businessId, deletedAt: null, startTime: { gte: prevStart, lte: prevEnd } },
        }),
        this.prisma.client.contact.count({
          where: { businessId, deletedAt: null, createdAt: { gte: prevStart, lte: prevEnd } },
        }),
        this.prisma.client.contact.count({
          where: { businessId, deletedAt: null, createdAt: { gte: start, lte: end } },
        }),
      ]);

      const prevRevenue = Number(prevPaid._sum.total ?? 0);
      const prevExpenseTotal = Number(prevExpenses._sum.amount ?? 0);
      const prevNetProfit = prevRevenue - prevExpenseTotal;
      const prevProfitMargin = prevRevenue > 0 ? (prevNetProfit / prevRevenue) * 100 : 0;

      const pctChange = (curr: number, prev: number) =>
        prev === 0 ? (curr > 0 ? 100 : 0) : Math.round(((curr - prev) / prev) * 1000) / 10;

      comparison = {
        period: { start: prevStart.toISOString(), end: prevEnd.toISOString() },
        revenue: {
          total: prevRevenue,
          invoiceCount: prevPaid._count ?? 0,
          changePct: pctChange(totalRevenue, prevRevenue),
        },
        expenses: {
          total: prevExpenseTotal,
          count: prevExpenses._count ?? 0,
          changePct: pctChange(totalExpenses, prevExpenseTotal),
        },
        profitability: {
          netProfit: prevNetProfit,
          profitMargin: Math.round(prevProfitMargin * 100) / 100,
          changePct: pctChange(netProfit, prevNetProfit),
        },
        bookings: {
          total: prevBookings,
          changePct: pctChange(bookings.length, prevBookings),
        },
        clients: {
          totalContacts: prevContacts,
          newContacts: currentPeriodContacts,
          changePct: pctChange(currentPeriodContacts, prevContacts),
        },
      };
    }

    const bookingTimeSeries = this.buildBookingTimeSeries(bookings as Array<{ id: string; status: string; startTime: Date }>, start, end);
    const prevBookingTimeSeries = compare
      ? await this.fetchPrevBookingTimeSeries(businessId, start, end)
      : undefined;

    return {
      type,
      generatedAt: new Date().toISOString(),
      metrics,
      aiNarrative,
      comparison,
      data: {
        totalBookings: bookings.length,
        completedBookings,
        cancelledBookings,
        noShowRate: bookings.length > 0 ? Math.round((cancelledBookings / bookings.length) * 100) : 0,
        bookingTimeSeries,
        prevBookingTimeSeries,
      },
    };
  }

  private buildBookingTimeSeries(
    bookings: Array<{ id: string; status: string; startTime: Date }>,
    start: Date,
    end: Date,
  ): Array<{ date: string; completed: number; missed: number; total: number }> {
    const dayMap = new Map<string, { completed: number; missed: number; total: number }>();

    const current = new Date(start);
    while (current <= end) {
      const key = current.toISOString().split('T')[0];
      dayMap.set(key, { completed: 0, missed: 0, total: 0 });
      current.setDate(current.getDate() + 1);
    }

    for (const b of bookings) {
      const key = new Date(b.startTime).toISOString().split('T')[0];
      const entry = dayMap.get(key);
      if (entry) {
        entry.total++;
        if (b.status === 'COMPLETED' || b.status === 'CONFIRMED') entry.completed++;
        else entry.missed++;
      }
    }

    return Array.from(dayMap.entries()).map(([date, counts]) => ({ date, ...counts }));
  }

  private async fetchPrevBookingTimeSeries(
    businessId: string,
    start: Date,
    end: Date,
  ): Promise<Array<{ date: string; completed: number; missed: number; total: number }>> {
    const periodMs = end.getTime() - start.getTime();
    const prevEnd = new Date(start.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - periodMs);

    const prevBookings = await this.prisma.client.booking.findMany({
      where: { businessId, deletedAt: null, startTime: { gte: prevStart, lte: prevEnd } },
      select: { id: true, status: true, startTime: true },
    });

    return this.buildBookingTimeSeries(prevBookings, prevStart, prevEnd);
  }
}
