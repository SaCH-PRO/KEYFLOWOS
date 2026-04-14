import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiUsageService } from './ai-usage.service';
import { BusinessGraphService } from './business-graph.service';

interface RevenueDataPoint {
  month: string;
  revenue: number;
  invoiceCount: number;
  paidCount: number;
}

interface ClientProfitability {
  contactId: string;
  name: string;
  totalRevenue: number;
  directExpenses: number;
  invoiceCount: number;
  avgInvoiceValue: number;
  lastActivityDate: Date | null;
}

interface ServicePerformance {
  name: string;
  totalRevenue: number;
  unitsSold: number;
  transactionCount: number;
  effectiveHourlyRate: number;
}

interface SeasonalBucket {
  month: number;
  monthName: string;
  avgRevenue: number;
  avgBookings: number;
  dataPoints: number;
}

interface InvoiceRow {
  id?: string;
  total?: number | string;
  status?: string;
  createdAt?: Date;
  paidAt?: Date | null;
  contact?: { id: string; firstName?: string | null; lastName?: string | null } | null;
  items?: Array<{ productId?: string | null; total: number | string; quantity: number; description?: string }>;
  lineItems?: unknown;
  frequency?: string;
  name?: string;
  nextRunDate?: Date;
}

interface ExpenseRow {
  amount: number | string;
  date?: Date;
  contactId?: string | null;
  category?: { name: string } | null;
}

interface BookingRow {
  startTime: Date;
  endTime?: Date;
  status?: string;
}

interface ServiceRow {
  id: string;
  name: string;
  price: number | string;
  duration: number;
  description?: string | null;
}

@Injectable()
export class StrategicIntelligenceService {
  private readonly logger = new Logger(StrategicIntelligenceService.name);

  private parseAiJson<T extends Record<string, unknown>>(content: string, fallback: T, label: string): T {
    try {
      const parsed = JSON.parse(content);
      if (typeof parsed !== 'object' || parsed === null) {
        this.logger.warn(`[${label}] AI returned non-object JSON: ${typeof parsed}`);
        return { ...fallback, dataQuality: 'degraded' };
      }
      return parsed as T;
    } catch {
      this.logger.warn(`[${label}] Failed to parse AI JSON response (${content.length} chars). Raw start: ${content.slice(0, 200)}`);
      return { ...fallback, dataQuality: 'degraded' };
    }
  }

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
    @Inject(BusinessGraphService) private readonly businessGraph: BusinessGraphService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  async forecastRevenue(businessId: string, options?: { horizonDays?: number }) {
    const horizonDays = options?.horizonDays ?? 90;
    const now = new Date();
    const lookbackMonths = 12;
    const lookbackDate = new Date(now);
    lookbackDate.setMonth(lookbackDate.getMonth() - lookbackMonths);

    const [invoices, recurringInvoices, expenses, snapshot] = await Promise.all([
      this.db.invoice.findMany({
        where: { businessId, deletedAt: null, createdAt: { gte: lookbackDate } },
        select: {
          id: true, total: true, status: true, currency: true,
          createdAt: true, paidAt: true, dueDate: true,
          contact: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.db.recurringInvoice.findMany({
        where: { businessId, isActive: true, deletedAt: null },
        select: { name: true, frequency: true, nextRunDate: true, lineItems: true },
        take: 30,
      }),
      this.db.expense.aggregate({
        where: { businessId, deletedAt: null, date: { gte: lookbackDate } },
        _sum: { amount: true },
        _count: true,
      }),
      this.businessGraph.getSnapshot(businessId),
    ]);

    const monthlyData = this.buildMonthlyRevenue(invoices, lookbackMonths);
    const recurringMonthly = this.estimateRecurringRevenue(recurringInvoices);
    const avgMonthlyExpenses = (Number(expenses._sum.amount) || 0) / Math.max(1, lookbackMonths);

    const contextBlock = this.buildForecastContext(monthlyData, recurringMonthly, avgMonthlyExpenses, snapshot, horizonDays);

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'strategic_revenue_forecast',
      messages: [
        { role: 'system', content: this.revenueForecastPrompt(contextBlock, horizonDays) },
        { role: 'user', content: `Forecast revenue for the next ${horizonDays} days with confidence intervals.` },
      ],
      maxTokens: 2000,
      temperature: 0.3,
      outputCategory: 'reports',
      responseMode: 'structured_json',
    });

    return this.parseAiJson(result.content, {
      summary: result.content,
      currentMonthlyRun: 0,
      projectedMonthlyAvg: 0,
      periods: [],
      confidenceLevel: 'low',
      trend: 'stable',
      assumptions: [],
      risks: [],
      recurringRevenue: recurringMonthly,
      recommendations: [],
    }, 'forecastRevenue');
  }

  async analyzeProfitability(businessId: string) {
    const now = new Date();
    const sixMonthsAgo = new Date(now);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const [invoices, expenses, projects, services] = await Promise.all([
      this.db.invoice.findMany({
        where: { businessId, deletedAt: null, status: 'PAID', paidAt: { gte: sixMonthsAgo } },
        select: {
          id: true, total: true, paidAt: true,
          contact: { select: { id: true, firstName: true, lastName: true } },
          items: { select: { productId: true, description: true, total: true, quantity: true } },
        },
      }),
      this.db.expense.findMany({
        where: { businessId, deletedAt: null, date: { gte: sixMonthsAgo } },
        select: {
          amount: true, date: true, vendor: true,
          category: { select: { name: true } },
          projectId: true, contactId: true,
        },
      }),
      this.db.project.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, name: true, status: true, priority: true, contactId: true, dueDate: true },
        take: 50,
      }),
      this.db.service.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, name: true, price: true, duration: true },
        take: 30,
      }),
    ]);

    const clientProfitability = this.computeClientProfitability(invoices, expenses);
    const totalRevenue = invoices.reduce((s, i) => s + Number(i.total), 0);
    const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);
    const grossProfit = totalRevenue - totalExpenses;
    const grossMarginPct = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

    const servicePerformance = this.computeServicePerformance(invoices, services);

    const contextBlock = `PROFITABILITY ANALYSIS — Last 6 Months
Total Revenue: $${totalRevenue.toFixed(2)} TTD
Total Expenses: $${totalExpenses.toFixed(2)} TTD
Gross Profit: $${grossProfit.toFixed(2)} TTD
Gross Margin: ${grossMarginPct.toFixed(1)}%
Invoice Count: ${invoices.length}

TOP CLIENTS BY REVENUE (with direct expense allocation):
${clientProfitability.slice(0, 10).map(c => `  ${c.name}: Revenue $${c.totalRevenue.toFixed(0)} | Direct Expenses $${c.directExpenses.toFixed(0)} | Net $${(c.totalRevenue - c.directExpenses).toFixed(0)} (${c.invoiceCount} invoices, avg $${c.avgInvoiceValue.toFixed(0)})`).join('\n')}

SERVICE PERFORMANCE (from invoice items):
${servicePerformance.map(s => `  ${s.name}: $${s.totalRevenue.toFixed(0)} revenue | ${s.unitsSold} units | Effective hourly: $${s.effectiveHourlyRate.toFixed(0)} | Utilization: ${s.transactionCount} transactions`).join('\n') || '  No service-level data'}

EXPENSE CATEGORIES:
${this.summarizeExpenseCategories(expenses)}

PROJECTS (${projects.length}):
${projects.slice(0, 10).map(p => `  ${p.name} — status: ${p.status}, priority: ${p.priority ?? 'NORMAL'}, due: ${p.dueDate ? new Date(p.dueDate).toISOString().split('T')[0] : 'no date'}`).join('\n')}

SERVICES CATALOG (${services.length}):
${services.slice(0, 10).map(s => `  ${s.name} — listed at $${s.price}, ${s.duration}min`).join('\n')}`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'strategic_profitability',
      messages: [
        { role: 'system', content: this.profitabilityPrompt(contextBlock) },
        { role: 'user', content: 'Analyze profitability by client, service, and overall business.' },
      ],
      maxTokens: 2000,
      temperature: 0.3,
      outputCategory: 'reports',
      responseMode: 'structured_json',
    });

    return this.parseAiJson(result.content, {
      summary: result.content,
      grossMarginPct,
      grossProfit,
      totalRevenue,
      totalExpenses,
      netMarginEstimate: grossMarginPct,
      clientBreakdown: [],
      serviceBreakdown: [],
      expenseInsights: [],
      recommendations: [],
      concentrationRisk: 'unknown',
      concentrationDetail: '',
    }, 'analyzeProfitability');
  }

  async advisePricing(businessId: string) {
    const now = new Date();
    const threeMonthsAgo = new Date(now);
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    const [services, products, invoiceItems, bookings] = await Promise.all([
      this.db.service.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, name: true, price: true, duration: true, description: true },
      }),
      this.db.product.findMany({
        where: { businessId, deletedAt: null, isActive: true },
        select: { id: true, name: true, price: true, category: true, currency: true },
        take: 50,
      }),
      this.db.invoiceItem.findMany({
        where: {
          invoice: { businessId, deletedAt: null, createdAt: { gte: threeMonthsAgo } },
        },
        select: { productId: true, description: true, unitPrice: true, quantity: true, total: true },
      }),
      this.db.booking.count({
        where: { businessId, deletedAt: null, startTime: { gte: threeMonthsAgo } },
      }),
    ]);

    const salesByProduct = new Map<string, { count: number; revenue: number; units: number }>();
    for (const item of invoiceItems) {
      const key = item.productId || item.description || 'unknown';
      const existing = salesByProduct.get(key) ?? { count: 0, revenue: 0, units: 0 };
      existing.count++;
      existing.revenue += Number(item.total);
      existing.units += item.quantity;
      salesByProduct.set(key, existing);
    }

    const contextBlock = `PRICING ANALYSIS — Caribbean Service Business (TTD)

SERVICES (${services.length}):
${services.map(s => {
  const hourlyRate = s.duration > 0 ? (Number(s.price) / (s.duration / 60)).toFixed(0) : 'N/A';
  return `  ${s.name} | $${s.price} | ${s.duration}min | Effective hourly: $${hourlyRate}${s.description ? ` | ${s.description.slice(0, 50)}` : ''}`;
}).join('\n')}

PRODUCTS (${products.length}):
${products.map(p => {
  const sales = salesByProduct.get(p.id);
  return `  ${p.name} | $${p.price} ${p.currency} | Sales: ${sales ? `${sales.units} units, $${sales.revenue.toFixed(0)}` : 'no recent sales'}`;
}).join('\n')}

DEMAND SIGNALS:
Total invoice line items (3mo): ${invoiceItems.length}
Bookings (3mo): ${bookings}
Total item revenue (3mo): $${invoiceItems.reduce((s, i) => s + Number(i.total), 0).toFixed(0)}`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'strategic_pricing_advisor',
      messages: [
        { role: 'system', content: this.pricingAdvisorPrompt(contextBlock) },
        { role: 'user', content: 'Advise on optimal pricing strategy across all my services and products.' },
      ],
      maxTokens: 2000,
      temperature: 0.4,
      outputCategory: 'reports',
      responseMode: 'structured_json',
    });

    return this.parseAiJson(result.content, {
      summary: result.content,
      serviceRecommendations: [],
      productRecommendations: [],
      overallStrategy: '',
      quickWins: [],
      bundleOpportunities: [],
      pricingPrinciples: [],
    }, 'advisePricing');
  }

  async detectSeasonalPatterns(businessId: string) {
    const now = new Date();
    const twoYearsAgo = new Date(now);
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

    const [invoices, bookings, expenses] = await Promise.all([
      this.db.invoice.findMany({
        where: { businessId, deletedAt: null, createdAt: { gte: twoYearsAgo } },
        select: { total: true, status: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.db.booking.findMany({
        where: { businessId, deletedAt: null, startTime: { gte: twoYearsAgo } },
        select: { startTime: true, status: true },
        orderBy: { startTime: 'asc' },
      }),
      this.db.expense.findMany({
        where: { businessId, deletedAt: null, date: { gte: twoYearsAgo } },
        select: { amount: true, date: true },
        orderBy: { date: 'asc' },
      }),
    ]);

    const seasonalBuckets = this.buildSeasonalBuckets(invoices, bookings);

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];

    const contextBlock = `SEASONAL PATTERN DATA — Caribbean Business (Trinidad & Tobago)

MONTHLY REVENUE AVERAGES (up to 2 years):
${seasonalBuckets.map(b => `  ${b.monthName}: Avg Revenue $${b.avgRevenue.toFixed(0)}, Avg Bookings ${b.avgBookings.toFixed(0)} (${b.dataPoints} data points)`).join('\n')}

TOTAL DATA:
Invoices analyzed: ${invoices.length}
Bookings analyzed: ${bookings.length}
Expenses analyzed: ${expenses.length}

LOCAL CONTEXT:
Trinidad & Tobago seasonal factors: Carnival season (Feb-Mar), back-to-school (Aug-Sep), Christmas/holiday season (Nov-Dec), hurricane season (Jun-Nov), Divali season (Oct-Nov).`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'strategic_seasonal_patterns',
      messages: [
        { role: 'system', content: this.seasonalPatternPrompt(contextBlock) },
        { role: 'user', content: 'Identify seasonal patterns, peak periods, and slow periods in my business data.' },
      ],
      maxTokens: 2000,
      temperature: 0.3,
      outputCategory: 'reports',
      responseMode: 'structured_json',
    });

    return this.parseAiJson(result.content, {
      summary: result.content,
      peakMonths: [],
      slowMonths: [],
      patterns: [],
      recommendations: [],
      monthlyData: seasonalBuckets,
      localFactors: [],
    }, 'detectSeasonalPatterns');
  }

  async scanOpportunities(businessId: string) {
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sixtyDaysAgo = new Date(now);
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    const [
      staleLeads,
      recentPaidInvoices,
      acceptedQuotes,
      pendingQuotes,
      topClients,
      products,
      snapshot,
    ] = await Promise.all([
      this.db.contact.findMany({
        where: {
          businessId, deletedAt: null,
          status: 'LEAD',
          createdAt: { lt: thirtyDaysAgo },
        },
        select: { id: true, firstName: true, lastName: true, email: true, createdAt: true },
        take: 20,
      }),
      this.db.invoice.findMany({
        where: { businessId, deletedAt: null, status: 'PAID', paidAt: { gte: thirtyDaysAgo } },
        select: {
          total: true,
          contact: { select: { id: true, firstName: true, lastName: true } },
        },
        take: 30,
      }),
      this.db.quote.count({
        where: { businessId, deletedAt: null, status: 'ACCEPTED', createdAt: { gte: sixtyDaysAgo } },
      }),
      this.db.quote.findMany({
        where: { businessId, deletedAt: null, status: { in: ['DRAFT', 'SENT'] } },
        select: {
          id: true, total: true, quoteNumber: true, createdAt: true,
          contact: { select: { firstName: true, lastName: true } },
        },
        take: 15,
      }),
      this.db.invoice.groupBy({
        by: ['contactId'],
        where: { businessId, deletedAt: null, status: 'PAID' },
        _sum: { total: true },
        _count: true,
        orderBy: { _sum: { total: 'desc' } },
        take: 10,
      }),
      this.db.product.findMany({
        where: { businessId, deletedAt: null, isActive: true },
        select: { id: true, name: true, price: true },
        take: 30,
      }),
      this.businessGraph.getSnapshot(businessId),
    ]);

    const contextBlock = `OPPORTUNITY SCAN — Business Data

STALE LEADS (${staleLeads.length} leads untouched 30+ days):
${staleLeads.slice(0, 10).map(l => `  ${l.firstName ?? ''} ${l.lastName ?? ''} (${l.email ?? 'no email'}) — created ${l.createdAt.toISOString().split('T')[0]}`).join('\n') || '  None'}

RECENT PAID INVOICES (${recentPaidInvoices.length}):
${recentPaidInvoices.slice(0, 10).map(i => `  $${Number(i.total).toFixed(0)} — ${i.contact ? `${i.contact.firstName ?? ''} ${i.contact.lastName ?? ''}`.trim() : 'unknown'}`).join('\n') || '  None'}

PENDING QUOTES (${pendingQuotes.length}, total value: $${pendingQuotes.reduce((s, q) => s + Number(q.total), 0).toFixed(0)}):
${pendingQuotes.slice(0, 10).map(q => `  #${q.quoteNumber} $${Number(q.total).toFixed(0)} — ${q.contact ? `${q.contact.firstName ?? ''} ${q.contact.lastName ?? ''}`.trim() : 'unknown'}`).join('\n') || '  None'}

ACCEPTED QUOTES (last 60 days): ${acceptedQuotes}

TOP CLIENTS BY LIFETIME VALUE:
${topClients.slice(0, 5).map(c => `  Contact ${c.contactId}: $${Number(c._sum.total).toFixed(0)} (${c._count} invoices)`).join('\n')}

ACTIVE PRODUCTS: ${products.length}
STOREFRONT: ${snapshot.storefront.activeProductCount} active products

BUSINESS HEALTH:
Revenue collected: $${snapshot.revenue.totalCollected.toFixed(0)}
Outstanding: $${snapshot.revenue.outstandingAmount.toFixed(0)}
Overdue: ${snapshot.revenue.overdueCount} invoices ($${snapshot.revenue.overdueAmount.toFixed(0)})
Momentum Score: ${snapshot.momentumScore}/100`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'strategic_opportunity_scan',
      messages: [
        { role: 'system', content: this.opportunityScanPrompt(contextBlock) },
        { role: 'user', content: 'Scan for growth opportunities, upsells, neglected leads, and revenue potential.' },
      ],
      maxTokens: 2000,
      temperature: 0.4,
      outputCategory: 'reports',
      responseMode: 'structured_json',
    });

    return this.parseAiJson(result.content, {
      summary: result.content,
      opportunities: [],
      quickWins: [],
      neglectedLeads: staleLeads.length,
      pendingQuoteValue: pendingQuotes.reduce((s, q) => s + Number(q.total), 0),
      priority: 'medium',
      totalPotentialValue: 0,
      reactivationTargets: [],
      recommendations: [],
    }, 'scanOpportunities');
  }

  async scanRisks(businessId: string) {
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [
      overdueInvoices,
      overdueCount,
      recentCancellations,
      inactiveContacts,
      expenseSpike,
      snapshot,
    ] = await Promise.all([
      this.db.invoice.findMany({
        where: {
          businessId, deletedAt: null,
          status: { in: ['SENT', 'DRAFT'] },
          dueDate: { lt: now },
        },
        select: {
          id: true, invoiceNumber: true, total: true, dueDate: true,
          contact: { select: { firstName: true, lastName: true } },
        },
        orderBy: { dueDate: 'asc' },
        take: 20,
      }),
      this.db.invoice.count({
        where: { businessId, deletedAt: null, status: { in: ['SENT', 'DRAFT'] }, dueDate: { lt: now } },
      }),
      this.db.booking.count({
        where: { businessId, deletedAt: null, status: 'CANCELLED', startTime: { gte: thirtyDaysAgo } },
      }),
      this.db.contact.count({
        where: {
          businessId, deletedAt: null,
          status: { in: ['ACTIVE', 'LEAD'] },
          updatedAt: { lt: thirtyDaysAgo },
        },
      }),
      this.db.expense.aggregate({
        where: { businessId, deletedAt: null, date: { gte: thirtyDaysAgo } },
        _sum: { amount: true },
        _count: true,
      }),
      this.businessGraph.getSnapshot(businessId),
    ]);

    const overdueTotal = overdueInvoices.reduce((s, i) => s + Number(i.total), 0);

    const contextBlock = `RISK SCAN — Business Health Assessment

OVERDUE INVOICES (${overdueCount} total, $${overdueTotal.toFixed(0)} at risk):
${overdueInvoices.slice(0, 10).map(i => {
  const daysPast = Math.floor((now.getTime() - new Date(i.dueDate!).getTime()) / 86400000);
  const name = i.contact ? `${i.contact.firstName ?? ''} ${i.contact.lastName ?? ''}`.trim() : 'unknown';
  return `  #${i.invoiceNumber} $${Number(i.total).toFixed(0)} — ${daysPast} days overdue — ${name}`;
}).join('\n') || '  None'}

CANCELLATIONS (last 30 days): ${recentCancellations}
INACTIVE CONTACTS (30+ days no activity): ${inactiveContacts}

EXPENSE PRESSURE:
Last 30 days: $${(Number(expenseSpike._sum.amount) || 0).toFixed(0)} across ${expenseSpike._count} entries

BUSINESS SNAPSHOT:
Outstanding revenue: $${snapshot.revenue.outstandingAmount.toFixed(0)}
Monthly revenue: $${snapshot.revenue.monthlyRevenue.toFixed(0)}
Active projects: ${snapshot.projects.activeCount}
Overdue tasks: ${snapshot.projects.overdueTaskCount}
Momentum: ${snapshot.momentumScore}/100`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'strategic_risk_scan',
      messages: [
        { role: 'system', content: this.riskScanPrompt(contextBlock) },
        { role: 'user', content: 'Scan for business risks: cash flow threats, churn signals, overdue cascades, operational gaps.' },
      ],
      maxTokens: 2000,
      temperature: 0.3,
      outputCategory: 'reports',
      responseMode: 'structured_json',
    });

    return this.parseAiJson(result.content, {
      summary: result.content,
      riskLevel: 'medium',
      riskScore: 0,
      risks: [],
      mitigations: [],
      overdueTotal,
      overdueCount,
      urgentActions: [],
      cashFlowHealth: 'watch',
    }, 'scanRisks');
  }

  async generateWeeklyPlan(businessId: string) {
    const now = new Date();
    const endOfWeek = new Date(now);
    endOfWeek.setDate(endOfWeek.getDate() + 7);
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      upcomingBookings,
      overdueInvoices,
      pendingQuotes,
      activeTasks,
      staleLeads,
      draftPosts,
      scheduledPosts,
      activeProjects,
      recentExpenses,
      monthRevenue,
      snapshot,
    ] = await Promise.all([
      this.db.booking.findMany({
        where: {
          businessId, deletedAt: null,
          startTime: { gte: now, lte: endOfWeek },
          status: { not: 'CANCELLED' },
        },
        select: { startTime: true, endTime: true, status: true, notes: true },
        orderBy: { startTime: 'asc' },
        take: 30,
      }),
      this.db.invoice.findMany({
        where: {
          businessId, deletedAt: null,
          status: { in: ['SENT', 'DRAFT'] },
          dueDate: { lt: now },
        },
        select: { invoiceNumber: true, total: true, dueDate: true },
        take: 10,
      }),
      this.db.quote.findMany({
        where: { businessId, deletedAt: null, status: { in: ['DRAFT', 'SENT'] } },
        select: { quoteNumber: true, total: true, expiryDate: true },
        take: 10,
      }),
      this.db.contactTask.findMany({
        where: {
          contact: { businessId },
          status: { in: ['PENDING', 'IN_PROGRESS'] },
        },
        select: { title: true, dueDate: true, priority: true, status: true },
        orderBy: { dueDate: 'asc' },
        take: 20,
      }),
      this.db.contact.count({
        where: {
          businessId, deletedAt: null,
          status: 'LEAD',
          createdAt: { lt: thirtyDaysAgo },
        },
      }),
      this.db.socialPost.count({
        where: { businessId, deletedAt: null, status: 'DRAFT' },
      }),
      this.db.socialPost.count({
        where: { businessId, deletedAt: null, status: 'SCHEDULED' },
      }),
      this.db.project.findMany({
        where: { businessId, deletedAt: null, status: { in: ['IN_PROGRESS', 'ACTIVE'] } },
        select: { id: true, name: true, status: true, dueDate: true, contactId: true },
        take: 10,
      }),
      this.db.expense.aggregate({
        where: { businessId, deletedAt: null, date: { gte: startOfMonth } },
        _sum: { amount: true },
        _count: true,
      }),
      this.db.invoice.aggregate({
        where: { businessId, deletedAt: null, status: 'PAID', paidAt: { gte: startOfMonth } },
        _sum: { total: true },
      }),
      this.businessGraph.getSnapshot(businessId),
    ]);

    const monthlyRevSoFar = Number(monthRevenue._sum.total) || 0;
    const monthlyExpSoFar = Number(recentExpenses._sum.amount) || 0;

    const contextBlock = `WEEKLY PLANNING — Week of ${now.toISOString().split('T')[0]}

REVENUE TARGETS:
Month-to-date revenue: $${monthlyRevSoFar.toFixed(0)} TTD
Month-to-date expenses: $${monthlyExpSoFar.toFixed(0)} TTD
Net margin so far: $${(monthlyRevSoFar - monthlyExpSoFar).toFixed(0)} TTD

UPCOMING BOOKINGS THIS WEEK (${upcomingBookings.length}):
${upcomingBookings.slice(0, 15).map(b => {
  const day = new Date(b.startTime).toLocaleDateString('en-TT', { weekday: 'short', month: 'short', day: 'numeric' });
  const time = new Date(b.startTime).toLocaleTimeString('en-TT', { hour: '2-digit', minute: '2-digit' });
  return `  ${day} ${time} — ${b.notes || 'No description'}`;
}).join('\n') || '  No bookings this week'}

OVERDUE INVOICES TO CHASE (${overdueInvoices.length}):
${overdueInvoices.map(i => `  #${i.invoiceNumber} $${Number(i.total).toFixed(0)} — due ${i.dueDate ? new Date(i.dueDate).toISOString().split('T')[0] : 'unknown'}`).join('\n') || '  None'}

PENDING QUOTES TO FOLLOW UP (${pendingQuotes.length}):
${pendingQuotes.map(q => `  #${q.quoteNumber} $${Number(q.total).toFixed(0)} — expires ${q.expiryDate ? new Date(q.expiryDate).toISOString().split('T')[0] : 'no expiry'}`).join('\n') || '  None'}

OPEN TASKS (${activeTasks.length}):
${activeTasks.slice(0, 10).map(t => `  ${t.title} — ${t.priority ?? 'normal'} priority — due ${t.dueDate ? new Date(t.dueDate).toISOString().split('T')[0] : 'no date'}`).join('\n') || '  None'}

CONTENT SCHEDULE:
Draft posts ready to publish: ${draftPosts}
Scheduled posts this week: ${scheduledPosts}

ACTIVE PROJECTS & MILESTONES (${activeProjects.length}):
${activeProjects.map(p => `  ${p.name} — ${p.status} — due ${p.dueDate ? new Date(p.dueDate).toISOString().split('T')[0] : 'no date'}`).join('\n') || '  No active projects'}

EXPENSE REVIEW:
Expenses this month: $${monthlyExpSoFar.toFixed(0)} across ${recentExpenses._count} entries

OUTREACH OPPORTUNITIES:
Stale leads to re-engage: ${staleLeads}

BUSINESS MOMENTUM: ${snapshot.momentumScore}/100`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'strategic_weekly_plan',
      messages: [
        { role: 'system', content: this.weeklyPlanPrompt(contextBlock) },
        { role: 'user', content: 'Generate a structured weekly plan prioritizing revenue, client engagement, and operational tasks.' },
      ],
      maxTokens: 2000,
      temperature: 0.4,
      outputCategory: 'reports',
      responseMode: 'structured_json',
    });

    return this.parseAiJson(result.content, {
      summary: result.content,
      weekOf: now.toISOString().split('T')[0],
      topPriorities: [],
      dailyFocus: [],
      revenueActions: [],
      clientActions: [],
      contentPlan: [],
      projectMilestones: [],
      expenseReview: { monthToDate: monthlyExpSoFar, action: '' },
      operationalTasks: [],
      weeklyGoal: '',
    }, 'generateWeeklyPlan');
  }

  async getStrategicActions(businessId: string): Promise<Array<{
    type: string;
    title: string;
    description: string;
    priority: 'high' | 'medium' | 'low';
    category: 'revenue' | 'risk' | 'opportunity' | 'operational';
    estimatedValue?: number;
  }>> {
    const dashboard = await this.getStrategicDashboard(businessId);
    const actions: Array<{
      type: string;
      title: string;
      description: string;
      priority: 'high' | 'medium' | 'low';
      category: 'revenue' | 'risk' | 'opportunity' | 'operational';
      estimatedValue?: number;
    }> = [];

    if (dashboard.overdueInvoices > 0) {
      actions.push({
        type: 'collect_overdue',
        title: `Collect ${dashboard.overdueInvoices} overdue invoices`,
        description: `$${dashboard.overdueAmount.toFixed(0)} TTD at risk across ${dashboard.overdueInvoices} overdue invoices. Follow up today.`,
        priority: 'high',
        category: 'revenue',
        estimatedValue: dashboard.overdueAmount,
      });
    }

    if (dashboard.pendingQuotes > 0) {
      actions.push({
        type: 'convert_quotes',
        title: `Follow up on ${dashboard.pendingQuotes} pending quotes`,
        description: `$${dashboard.pendingQuoteValue.toFixed(0)} TTD in pending quotes. Convert to revenue.`,
        priority: dashboard.pendingQuoteValue > dashboard.monthlyRevenue * 0.2 ? 'high' : 'medium',
        category: 'opportunity',
        estimatedValue: dashboard.pendingQuoteValue,
      });
    }

    if (dashboard.staleLeads > 0) {
      actions.push({
        type: 're_engage_leads',
        title: `Re-engage ${dashboard.staleLeads} stale leads`,
        description: `${dashboard.staleLeads} leads have gone cold (30+ days). Send a check-in message.`,
        priority: dashboard.staleLeads > 10 ? 'high' : 'medium',
        category: 'opportunity',
      });
    }

    if (dashboard.overdueTaskCount > 0) {
      actions.push({
        type: 'clear_overdue_tasks',
        title: `Clear ${dashboard.overdueTaskCount} overdue project tasks`,
        description: `${dashboard.overdueTaskCount} tasks across ${dashboard.activeProjects} projects are overdue. Review and update.`,
        priority: dashboard.overdueTaskCount > 5 ? 'high' : 'medium',
        category: 'operational',
      });
    }

    if (dashboard.momentumScore < 40) {
      actions.push({
        type: 'boost_momentum',
        title: 'Business momentum is low',
        description: `Momentum score: ${dashboard.momentumScore}/100. Focus on revenue-generating activities and client engagement.`,
        priority: 'high',
        category: 'risk',
      });
    }

    if (dashboard.utilizationRate < 30 && dashboard.upcomingBookings < 3) {
      actions.push({
        type: 'fill_schedule',
        title: 'Schedule is underutilized',
        description: `Utilization at ${dashboard.utilizationRate.toFixed(0)}% with only ${dashboard.upcomingBookings} upcoming bookings. Promote availability.`,
        priority: 'medium',
        category: 'opportunity',
      });
    }

    actions.sort((a, b) => {
      const prio = { high: 0, medium: 1, low: 2 };
      return prio[a.priority] - prio[b.priority];
    });

    return actions;
  }

  async getStrategicDashboard(businessId: string) {
    const [snapshot, overdueCount, staleLeadCount, pendingQuoteAgg] = await Promise.all([
      this.businessGraph.getSnapshot(businessId),
      this.db.invoice.count({
        where: { businessId, deletedAt: null, status: { in: ['SENT', 'DRAFT'] }, dueDate: { lt: new Date() } },
      }),
      this.db.contact.count({
        where: { businessId, deletedAt: null, status: 'LEAD', createdAt: { lt: new Date(Date.now() - 30 * 86400000) } },
      }),
      this.db.quote.aggregate({
        where: { businessId, deletedAt: null, status: { in: ['DRAFT', 'SENT'] } },
        _sum: { total: true },
        _count: true,
      }),
    ]);

    return {
      momentumScore: snapshot.momentumScore,
      monthlyRevenue: snapshot.revenue.monthlyRevenue,
      outstandingRevenue: snapshot.revenue.outstandingAmount,
      overdueInvoices: overdueCount,
      overdueAmount: snapshot.revenue.overdueAmount,
      activeProjects: snapshot.projects.activeCount,
      overdueTaskCount: snapshot.projects.overdueTaskCount,
      upcomingBookings: snapshot.bookings.upcomingCount,
      staleLeads: staleLeadCount,
      pendingQuotes: pendingQuoteAgg._count,
      pendingQuoteValue: Number(pendingQuoteAgg._sum.total) || 0,
      expensesThisMonth: snapshot.expenses.totalThisMonth,
      utilizationRate: snapshot.bookings.utilizationRate,
    };
  }


  private buildMonthlyRevenue(invoices: InvoiceRow[], months: number): RevenueDataPoint[] {
    const now = new Date();
    const data: RevenueDataPoint[] = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
      const monthInvoices = invoices.filter(inv => {
        if (!inv.createdAt) return false;
        const created = new Date(inv.createdAt);
        return created >= d && created <= monthEnd;
      });
      data.push({
        month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        revenue: monthInvoices.reduce((s, inv) => s + (inv.status === 'PAID' ? Number(inv.total) : 0), 0),
        invoiceCount: monthInvoices.length,
        paidCount: monthInvoices.filter(inv => inv.status === 'PAID').length,
      });
    }
    return data;
  }

  private estimateRecurringRevenue(recurring: InvoiceRow[]): number {
    let monthly = 0;
    for (const r of recurring) {
      const items: Array<Record<string, unknown>> = Array.isArray(r.lineItems) ? r.lineItems : [];
      const invoiceTotal: number = items.reduce((s, item) => s + (Number(item.total) || 0), 0);
      switch (r.frequency) {
        case 'WEEKLY': monthly += invoiceTotal * 4.33; break;
        case 'BIWEEKLY': monthly += invoiceTotal * 2.17; break;
        case 'MONTHLY': monthly += invoiceTotal; break;
        case 'QUARTERLY': monthly += invoiceTotal / 3; break;
        case 'YEARLY': monthly += invoiceTotal / 12; break;
        default: monthly += invoiceTotal; break;
      }
    }
    return monthly;
  }

  private buildForecastContext(
    monthlyData: RevenueDataPoint[],
    recurringMonthly: number,
    avgMonthlyExpenses: number,
    snapshot: { revenue: { outstandingAmount: number; outstandingCount: number; overdueAmount: number; overdueCount: number; monthlyRevenue: number }; bookings: { upcomingCount: number } },
    horizonDays: number,
  ): string {
    return `REVENUE FORECAST DATA — Caribbean Service Business (TTD)

MONTHLY REVENUE HISTORY (last ${monthlyData.length} months):
${monthlyData.map(m => `  ${m.month}: Revenue $${m.revenue.toFixed(0)} | ${m.invoiceCount} invoices | ${m.paidCount} paid`).join('\n')}

RECURRING REVENUE (estimated monthly): $${recurringMonthly.toFixed(0)}
AVERAGE MONTHLY EXPENSES: $${avgMonthlyExpenses.toFixed(0)}

CURRENT STATE:
Outstanding invoices: $${snapshot.revenue.outstandingAmount.toFixed(0)} (${snapshot.revenue.outstandingCount} invoices)
Overdue: $${snapshot.revenue.overdueAmount.toFixed(0)} (${snapshot.revenue.overdueCount} invoices)
Monthly revenue (current): $${snapshot.revenue.monthlyRevenue.toFixed(0)}
Upcoming bookings: ${snapshot.bookings.upcomingCount}

FORECAST HORIZON: ${horizonDays} days`;
  }

  private computeClientProfitability(invoices: InvoiceRow[], expenses: ExpenseRow[]): ClientProfitability[] {
    const clientMap = new Map<string, ClientProfitability>();
    for (const inv of invoices) {
      if (!inv.contact) continue;
      const key = inv.contact.id;
      const existing = clientMap.get(key) ?? {
        contactId: key,
        name: `${inv.contact.firstName ?? ''} ${inv.contact.lastName ?? ''}`.trim() || 'Unknown',
        totalRevenue: 0,
        directExpenses: 0,
        invoiceCount: 0,
        avgInvoiceValue: 0,
        lastActivityDate: null,
      };
      existing.totalRevenue += Number(inv.total);
      existing.invoiceCount++;
      const paidDate = inv.paidAt ? new Date(inv.paidAt) : null;
      if (paidDate && (!existing.lastActivityDate || paidDate > existing.lastActivityDate)) {
        existing.lastActivityDate = paidDate;
      }
      clientMap.set(key, existing);
    }

    for (const exp of expenses) {
      if (exp.contactId && clientMap.has(exp.contactId)) {
        clientMap.get(exp.contactId)!.directExpenses += Number(exp.amount);
      }
    }

    const results = Array.from(clientMap.values());
    for (const r of results) {
      r.avgInvoiceValue = r.invoiceCount > 0 ? r.totalRevenue / r.invoiceCount : 0;
    }
    results.sort((a, b) => b.totalRevenue - a.totalRevenue);
    return results;
  }

  private computeServicePerformance(invoices: InvoiceRow[], services: ServiceRow[]): ServicePerformance[] {
    const serviceMap = new Map<string, { name: string; revenue: number; units: number; count: number; duration: number }>();
    for (const s of services) {
      serviceMap.set(s.id, { name: s.name, revenue: 0, units: 0, count: 0, duration: s.duration || 60 });
    }

    for (const inv of invoices) {
      if (!inv.items) continue;
      for (const item of inv.items) {
        if (item.productId && serviceMap.has(item.productId)) {
          const entry = serviceMap.get(item.productId)!;
          entry.revenue += Number(item.total);
          entry.units += item.quantity;
          entry.count++;
        }
      }
    }

    return Array.from(serviceMap.values())
      .filter(s => s.count > 0)
      .map(s => ({
        name: s.name,
        totalRevenue: s.revenue,
        unitsSold: s.units,
        transactionCount: s.count,
        effectiveHourlyRate: s.duration > 0 ? (s.revenue / s.units) / (s.duration / 60) : 0,
      }))
      .sort((a, b) => b.totalRevenue - a.totalRevenue);
  }

  private summarizeExpenseCategories(expenses: ExpenseRow[]): string {
    const catMap = new Map<string, number>();
    for (const e of expenses) {
      const cat = e.category?.name || 'Uncategorized';
      catMap.set(cat, (catMap.get(cat) || 0) + Number(e.amount));
    }
    const sorted = Array.from(catMap.entries()).sort((a, b) => b[1] - a[1]);
    return sorted.slice(0, 8).map(([name, amount]) => `  ${name}: $${amount.toFixed(0)}`).join('\n') || '  No expenses recorded';
  }

  private buildSeasonalBuckets(invoices: InvoiceRow[], bookings: BookingRow[]): SeasonalBucket[] {
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];

    const revenueByMonth: Map<number, number[]> = new Map();
    const bookingsByMonth: Map<number, number[]> = new Map();

    for (let m = 0; m < 12; m++) {
      revenueByMonth.set(m, []);
      bookingsByMonth.set(m, []);
    }

    const yearMonthRev = new Map<string, number>();
    for (const inv of invoices) {
      if (inv.status !== 'PAID' || !inv.createdAt) continue;
      const d = new Date(inv.createdAt);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      yearMonthRev.set(key, (yearMonthRev.get(key) || 0) + Number(inv.total));
    }
    for (const [key, total] of yearMonthRev) {
      const month = parseInt(key.split('-')[1]);
      revenueByMonth.get(month)!.push(total);
    }

    const yearMonthBook = new Map<string, number>();
    for (const b of bookings) {
      const d = new Date(b.startTime);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      yearMonthBook.set(key, (yearMonthBook.get(key) || 0) + 1);
    }
    for (const [key, count] of yearMonthBook) {
      const month = parseInt(key.split('-')[1]);
      bookingsByMonth.get(month)!.push(count);
    }

    return Array.from({ length: 12 }, (_, m) => {
      const revArr = revenueByMonth.get(m)!;
      const bookArr = bookingsByMonth.get(m)!;
      return {
        month: m + 1,
        monthName: monthNames[m],
        avgRevenue: revArr.length > 0 ? revArr.reduce((a, b) => a + b, 0) / revArr.length : 0,
        avgBookings: bookArr.length > 0 ? bookArr.reduce((a, b) => a + b, 0) / bookArr.length : 0,
        dataPoints: Math.max(revArr.length, bookArr.length),
      };
    });
  }


  private revenueForecastPrompt(context: string, horizonDays: number): string {
    return `You are a financial forecasting analyst for a Caribbean service business.
Using historical revenue data, recurring revenue, outstanding invoices, and expense trends, produce a revenue forecast.

${context}

Respond in valid JSON:
{
  "summary": "Executive summary of the forecast",
  "currentMonthlyRun": 0.00,
  "projectedMonthlyAvg": 0.00,
  "periods": [
    { "label": "30 days", "projected": 0.00, "low": 0.00, "high": 0.00, "confidence": 0.8 },
    { "label": "60 days", "projected": 0.00, "low": 0.00, "high": 0.00, "confidence": 0.7 },
    { "label": "90 days", "projected": 0.00, "low": 0.00, "high": 0.00, "confidence": 0.6 }
  ],
  "confidenceLevel": "low|medium|high",
  "trend": "growing|stable|declining",
  "assumptions": ["assumption 1"],
  "risks": ["risk 1"],
  "recurringRevenue": 0.00,
  "recommendations": ["action 1"]
}`;
  }

  private profitabilityPrompt(context: string): string {
    return `You are a profitability analyst for a Caribbean service business (TTD currency).
Analyze revenue versus expenses, client concentration, and margin performance.

${context}

Respond in valid JSON:
{
  "summary": "Executive profitability summary",
  "grossMarginPct": 0.0,
  "grossProfit": 0.00,
  "totalRevenue": 0.00,
  "totalExpenses": 0.00,
  "netMarginEstimate": 0.0,
  "clientBreakdown": [
    { "name": "Client Name", "revenue": 0, "marginEstimate": "high|medium|low", "recommendation": "..." }
  ],
  "serviceBreakdown": [
    { "name": "Service", "effectiveHourlyRate": 0, "profitability": "high|medium|low", "recommendation": "..." }
  ],
  "expenseInsights": ["insight 1"],
  "recommendations": ["recommendation 1"],
  "concentrationRisk": "low|medium|high",
  "concentrationDetail": "..."
}`;
  }

  private pricingAdvisorPrompt(context: string): string {
    return `You are a pricing strategist for a Caribbean service business (TTD currency, Trinidad & Tobago market).
Analyze current pricing against demand, utilization, and market positioning.

${context}

Respond in valid JSON:
{
  "summary": "Overall pricing assessment",
  "overallStrategy": "Description of recommended pricing approach",
  "serviceRecommendations": [
    { "name": "Service Name", "currentPrice": 0, "suggestedPrice": 0, "reasoning": "...", "impact": "..." }
  ],
  "productRecommendations": [
    { "name": "Product Name", "currentPrice": 0, "suggestedPrice": 0, "reasoning": "...", "impact": "..." }
  ],
  "quickWins": ["quick win 1"],
  "bundleOpportunities": ["bundle idea 1"],
  "pricingPrinciples": ["principle 1"]
}`;
  }

  private seasonalPatternPrompt(context: string): string {
    return `You are a business analytics expert specializing in Caribbean markets.
Analyze the monthly revenue and booking data to identify seasonal patterns, accounting for local events and cultural calendar.

${context}

Respond in valid JSON:
{
  "summary": "Overview of seasonal patterns found",
  "peakMonths": [{ "month": "Month Name", "reason": "Why it peaks", "avgRevenueIndex": 1.2 }],
  "slowMonths": [{ "month": "Month Name", "reason": "Why it slows", "avgRevenueIndex": 0.7 }],
  "patterns": [{ "pattern": "Description", "confidence": "high|medium|low", "actionable": true }],
  "recommendations": [{ "timing": "When", "action": "What to do", "expectedImpact": "..." }],
  "dataQuality": "strong|moderate|limited",
  "localFactors": ["Carnival", "Christmas season", "etc."]
}`;
  }

  private opportunityScanPrompt(context: string): string {
    return `You are a growth strategist for a Caribbean service business.
Identify revenue opportunities, neglected leads, upsell potential, and quick wins.

${context}

Respond in valid JSON:
{
  "summary": "Overall opportunity assessment",
  "priority": "high|medium|low",
  "totalPotentialValue": 0.00,
  "opportunities": [
    { "type": "upsell|cross-sell|reactivation|conversion|expansion", "title": "...", "description": "...", "estimatedValue": 0, "effort": "low|medium|high", "priority": "high|medium|low" }
  ],
  "quickWins": [{ "action": "...", "expectedValue": 0, "timeframe": "this week|this month" }],
  "neglectedLeads": 0,
  "pendingQuoteValue": 0,
  "reactivationTargets": ["Client or lead to re-engage"],
  "recommendations": ["recommendation 1"]
}`;
  }

  private riskScanPrompt(context: string): string {
    return `You are a business risk analyst for a Caribbean service business.
Identify cash flow threats, client churn signals, operational risks, and overdue cascades.

${context}

Respond in valid JSON:
{
  "summary": "Overall risk assessment",
  "riskLevel": "low|medium|high|critical",
  "riskScore": 0,
  "risks": [
    { "category": "cash_flow|churn|operational|compliance|concentration", "title": "...", "severity": "low|medium|high|critical", "description": "...", "impact": "...", "mitigation": "..." }
  ],
  "urgentActions": [{ "action": "...", "deadline": "immediate|this_week|this_month", "impact": "..." }],
  "mitigations": ["long-term mitigation 1"],
  "overdueTotal": 0,
  "overdueCount": 0,
  "cashFlowHealth": "healthy|watch|warning|critical"
}`;
  }

  private weeklyPlanPrompt(context: string): string {
    return `You are a business productivity coach for a Caribbean entrepreneur.
Create a structured weekly plan covering ALL of these dimensions:
1. Revenue targets and collection actions (overdue invoices, quote follow-ups)
2. Client outreach and engagement (stale leads, upsell opportunities, retention)
3. Content schedule (draft posts to publish, content to create)
4. Booking optimization (preparation, scheduling gaps)
5. Project milestones and delivery tasks
6. Expense review and budget check

${context}

Respond in valid JSON:
{
  "summary": "Week at a glance",
  "weekOf": "YYYY-MM-DD",
  "topPriorities": [{ "priority": "...", "reason": "...", "deadline": "..." }],
  "dailyFocus": [
    { "day": "Monday", "theme": "Revenue Recovery", "tasks": ["task 1", "task 2"] },
    { "day": "Tuesday", "theme": "Client Engagement", "tasks": ["task 1"] },
    { "day": "Wednesday", "theme": "Content & Marketing", "tasks": ["task 1"] },
    { "day": "Thursday", "theme": "Delivery & Projects", "tasks": ["task 1"] },
    { "day": "Friday", "theme": "Review & Planning", "tasks": ["task 1"] }
  ],
  "revenueActions": [{ "action": "...", "expectedValue": 0, "urgency": "high|medium|low" }],
  "clientActions": [{ "action": "...", "client": "...", "type": "follow-up|upsell|retention" }],
  "contentPlan": [{ "action": "...", "channel": "...", "day": "..." }],
  "projectMilestones": [{ "project": "...", "milestone": "...", "dueDate": "..." }],
  "expenseReview": { "monthToDate": 0, "action": "..." },
  "operationalTasks": ["task 1"],
  "weeklyGoal": "One sentence goal for the week"
}`;
  }
}
