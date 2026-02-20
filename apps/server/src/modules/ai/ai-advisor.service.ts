import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import OpenAI from 'openai';

@Injectable()
export class AiAdvisorService {
  private readonly logger = new Logger(AiAdvisorService.name);
  private readonly openai: OpenAI;
  private readonly model = 'gpt-5.2';

  constructor(private readonly prisma: PrismaService) {
    this.openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
  }

  async getBusinessContext(businessId: string) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const [
      business,
      contactCount,
      recentContacts,
      invoices,
      paidInvoices,
      outstandingInvoices,
      overdueInvoices,
      upcomingBookings,
      completedBookingsThisMonth,
      expensesThisMonth,
      expensesByCategory,
      recentActivities,
      recentBookings,
      recentPayments,
    ] = await Promise.all([
      this.prisma.client.business.findUnique({
        where: { id: businessId },
        select: {
          name: true,
          industry: true,
          archetype: true,
          revenueModel: true,
          currency: true,
          tagline: true,
          description: true,
        },
      }),
      this.prisma.client.contact.count({
        where: { businessId, deletedAt: null },
      }),
      this.prisma.client.contact.findMany({
        where: { businessId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { firstName: true, lastName: true, status: true, createdAt: true },
      }),
      this.prisma.client.invoice.findMany({
        where: { businessId, deletedAt: null },
        select: { total: true, status: true, dueDate: true, paidAt: true },
      }),
      this.prisma.client.invoice.aggregate({
        where: { businessId, deletedAt: null, status: 'PAID' },
        _sum: { total: true },
      }),
      this.prisma.client.invoice.aggregate({
        where: { businessId, deletedAt: null, status: { in: ['SENT', 'DRAFT'] } },
        _sum: { total: true },
        _count: true,
      }),
      this.prisma.client.invoice.count({
        where: {
          businessId,
          deletedAt: null,
          status: { in: ['SENT', 'DRAFT'] },
          dueDate: { lt: now },
        },
      }),
      this.prisma.client.booking.findMany({
        where: {
          businessId,
          deletedAt: null,
          startTime: { gte: now },
          status: { in: ['PENDING', 'CONFIRMED'] },
        },
        orderBy: { startTime: 'asc' },
        take: 5,
        select: { startTime: true, status: true },
      }),
      this.prisma.client.booking.count({
        where: {
          businessId,
          deletedAt: null,
          status: 'COMPLETED',
          startTime: { gte: startOfMonth },
        },
      }),
      this.prisma.client.expense.aggregate({
        where: {
          businessId,
          deletedAt: null,
          date: { gte: startOfMonth },
        },
        _sum: { amount: true },
      }),
      this.prisma.client.expense.groupBy({
        by: ['categoryId'],
        where: {
          businessId,
          deletedAt: null,
          date: { gte: startOfMonth },
        },
        _sum: { amount: true },
      }),
      this.prisma.client.activity.findMany({
        where: { businessId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { module: true, action: true, title: true, createdAt: true },
      }),
      this.prisma.client.booking.count({
        where: {
          businessId,
          deletedAt: null,
          createdAt: { gte: yesterday },
        },
      }),
      this.prisma.client.invoice.count({
        where: {
          businessId,
          deletedAt: null,
          status: 'PAID',
          paidAt: { gte: yesterday },
        },
      }),
    ]);

    const totalRevenue = paidInvoices._sum.total ?? 0;
    const outstandingAmount = outstandingInvoices._sum.total ?? 0;
    const outstandingCount = outstandingInvoices._count ?? 0;
    const totalExpensesThisMonth = expensesThisMonth._sum.amount ?? 0;

    const signals = [
      recentBookings > 0 ? 1 : 0,
      recentPayments > 0 ? 1 : 0,
      contactCount > 10 ? 1 : 0,
      recentActivities.length > 3 ? 1 : 0,
      overdueInvoices === 0 ? 1 : 0,
    ];
    const momentumScore = Math.round((signals.reduce((a, b) => a + b, 0) / signals.length) * 100);

    return {
      business,
      contacts: {
        total: contactCount,
        recent: recentContacts,
      },
      invoices: {
        totalRevenue,
        outstandingAmount,
        outstandingCount,
        overdueCount: overdueInvoices,
      },
      bookings: {
        upcoming: upcomingBookings,
        completedThisMonth: completedBookingsThisMonth,
      },
      expenses: {
        totalThisMonth: totalExpensesThisMonth,
        byCategory: expensesByCategory,
      },
      recentActivities,
      momentumScore,
    };
  }

  async chat(
    businessId: string,
    message: string,
    conversationHistory?: Array<{ role: string; content: string }>,
  ) {
    const context = await this.getBusinessContext(businessId);
    const businessName = context.business?.name ?? 'your business';

    const contextSnapshot = [
      `Business: ${businessName}`,
      context.business?.industry ? `Industry: ${context.business.industry}` : null,
      context.business?.archetype ? `Archetype: ${context.business.archetype}` : null,
      context.business?.revenueModel ? `Revenue Model: ${context.business.revenueModel}` : null,
      `Contacts: ${context.contacts.total} total`,
      `Revenue: $${context.invoices.totalRevenue.toLocaleString()} TTD collected`,
      `Outstanding: $${context.invoices.outstandingAmount.toLocaleString()} TTD (${context.invoices.outstandingCount} invoices, ${context.invoices.overdueCount} overdue)`,
      `Bookings: ${context.bookings.upcoming.length} upcoming, ${context.bookings.completedThisMonth} completed this month`,
      `Expenses this month: $${context.expenses.totalThisMonth.toLocaleString()} TTD`,
      `Momentum Score: ${context.momentumScore}/100`,
      `Recent Activity: ${context.recentActivities.map((a) => a.title).join('; ')}`,
    ]
      .filter(Boolean)
      .join('\n');

    const systemPrompt = `You are KeyFlow, an AI business co-founder and advisor for ${businessName}. You have deep knowledge of their business operations.\n\n${contextSnapshot}\n\nHelp them make better business decisions, analyze their data, suggest strategies, and answer any business questions. Be concise, actionable, and Caribbean-friendly. Use TTD currency where relevant. Keep responses under 300 words.`;

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    if (conversationHistory?.length) {
      for (const msg of conversationHistory) {
        messages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        });
      }
    }

    messages.push({ role: 'user', content: message });

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages,
        max_tokens: 500,
        temperature: 0.7,
      });

      const reply = response.choices[0]?.message?.content ?? 'I was unable to generate a response. Please try again.';

      return {
        reply,
        context: {
          momentumScore: context.momentumScore,
          businessName,
        },
      };
    } catch (error) {
      this.logger.error(`AI chat error: ${(error as Error).message}`);
      throw error;
    }
  }

  async generateDailyBriefing(businessId: string) {
    const context = await this.getBusinessContext(businessId);
    const businessName = context.business?.name ?? 'your business';

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const revenueThisMonth = await this.prisma.client.invoice.aggregate({
      where: {
        businessId,
        deletedAt: null,
        status: 'PAID',
        paidAt: { gte: startOfMonth },
      },
      _sum: { total: true },
    });

    const revenue = revenueThisMonth._sum.total ?? 0;
    const expenses = context.expenses.totalThisMonth;
    const net = revenue - expenses;

    const staleLeads = await this.prisma.client.contact.count({
      where: {
        businessId,
        deletedAt: null,
        status: 'LEAD',
        updatedAt: { lt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
      },
    });

    const briefingPrompt = `Generate a morning business briefing for ${businessName}. Here is the current data:

Yesterday's activity: ${context.recentActivities.filter((a) => {
      const actDate = new Date(a.createdAt);
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      return actDate >= yesterday;
    }).map((a) => a.title).join(', ') || 'No activity recorded'}

Today's priorities:
- ${context.bookings.upcoming.length} upcoming bookings
- ${context.invoices.overdueCount} overdue invoices
- ${staleLeads} stale leads (no activity in 7+ days)

Cash flow this month:
- Revenue: $${revenue.toLocaleString()} TTD
- Expenses: $${expenses.toLocaleString()} TTD
- Net: $${net.toLocaleString()} TTD

Momentum Score: ${context.momentumScore}/100

Respond ONLY with valid JSON in this exact format (no markdown, no code fences):
{"summary":"...","highlights":["..."],"priorities":["..."],"cashFlow":{"revenue":${revenue},"expenses":${expenses},"net":${net}},"suggestion":"..."}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: `You are KeyFlow, an AI business advisor for ${businessName}. Generate concise daily briefings. Always respond with valid JSON only.`,
          },
          { role: 'user', content: briefingPrompt },
        ],
        max_tokens: 600,
        temperature: 0.5,
      });

      const content = response.choices[0]?.message?.content ?? '';

      try {
        return JSON.parse(content);
      } catch {
        return {
          summary: content,
          highlights: [],
          priorities: [
            context.bookings.upcoming.length > 0 ? `${context.bookings.upcoming.length} upcoming bookings to prepare for` : null,
            context.invoices.overdueCount > 0 ? `${context.invoices.overdueCount} overdue invoices need follow-up` : null,
            staleLeads > 0 ? `${staleLeads} stale leads to re-engage` : null,
          ].filter(Boolean),
          cashFlow: { revenue, expenses, net },
          suggestion: 'Review your overdue invoices and follow up with clients today.',
        };
      }
    } catch (error) {
      this.logger.error(`AI briefing error: ${(error as Error).message}`);
      throw error;
    }
  }

  async predictCashFlow(businessId: string, days = 30) {
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const [paidInvoices, expenses] = await Promise.all([
      this.prisma.client.invoice.findMany({
        where: {
          businessId,
          deletedAt: null,
          status: 'PAID',
          paidAt: { gte: ninetyDaysAgo },
        },
        select: { total: true, paidAt: true },
        orderBy: { paidAt: 'asc' },
      }),
      this.prisma.client.expense.findMany({
        where: {
          businessId,
          deletedAt: null,
          date: { gte: ninetyDaysAgo },
        },
        select: { amount: true, date: true },
        orderBy: { date: 'asc' },
      }),
    ]);

    const totalRevenue90d = paidInvoices.reduce((sum, inv) => sum + inv.total, 0);
    const totalExpenses90d = expenses.reduce((sum, exp) => sum + exp.amount, 0);

    const dailyRevenueRate = totalRevenue90d / 90;
    const dailyExpenseRate = totalExpenses90d / 90;
    const dailyNetRate = dailyRevenueRate - dailyExpenseRate;

    const currentBalance = totalRevenue90d - totalExpenses90d;
    const projectedBalance = currentBalance + dailyNetRate * days;

    let daysUntilNegative: number | null = null;
    if (dailyNetRate < 0 && currentBalance > 0) {
      daysUntilNegative = Math.ceil(currentBalance / Math.abs(dailyNetRate));
    }

    const trend =
      dailyNetRate > 0 ? 'growing' : dailyNetRate < 0 ? 'declining' : 'stable';

    const alerts: string[] = [];
    if (daysUntilNegative !== null && daysUntilNegative <= 30) {
      alerts.push(`Cash flow may turn negative in ${daysUntilNegative} days at the current rate.`);
    }
    if (dailyExpenseRate > dailyRevenueRate * 0.9) {
      alerts.push('Expenses are consuming more than 90% of revenue.');
    }

    const outstandingInvoices = await this.prisma.client.invoice.aggregate({
      where: {
        businessId,
        deletedAt: null,
        status: { in: ['SENT', 'DRAFT'] },
      },
      _sum: { total: true },
      _count: true,
    });

    if ((outstandingInvoices._count ?? 0) > 5) {
      alerts.push(`${outstandingInvoices._count} outstanding invoices totaling $${(outstandingInvoices._sum.total ?? 0).toLocaleString()} TTD.`);
    }

    return {
      currentBalance: Math.round(currentBalance * 100) / 100,
      projectedBalance: Math.round(projectedBalance * 100) / 100,
      daysUntilNegative,
      trend,
      alerts,
      dailyRevenueRate: Math.round(dailyRevenueRate * 100) / 100,
      dailyExpenseRate: Math.round(dailyExpenseRate * 100) / 100,
      projectionDays: days,
    };
  }

  async simulateScenario(businessId: string, scenario: string, variables?: Record<string, any>) {
    const context = await this.getBusinessContext(businessId);
    const prompt = `You are a business simulation engine. Using the business context below, simulate the following scenario and provide detailed projected outcomes.

BUSINESS CONTEXT:
${JSON.stringify(context, null, 2)}

SCENARIO TO SIMULATE:
${scenario}

${variables ? `VARIABLES: ${JSON.stringify(variables)}` : ''}

Provide your simulation results in this exact format:
1. **Scenario Summary** - Brief restatement of what's being simulated
2. **Projected Outcomes** (3-6 months):
   - Revenue Impact: estimated % and dollar change
   - Cash Flow Impact: how this affects monthly cash flow
   - Risk Assessment: LOW/MEDIUM/HIGH with explanation
3. **Key Assumptions** - What assumptions drive this simulation
4. **Recommended Actions** - 3-5 specific steps if proceeding
5. **Alternative Scenarios** - 2 variations to consider

Use the business's actual data to make projections realistic. Currency should match the business currency.`;

    try {
      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: 'You are KeyFlow AI, a business simulation engine that provides detailed what-if analysis based on real business data.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 2000,
      });
      return { simulation: completion.choices[0]?.message?.content || 'Unable to run simulation.' };
    } catch (e) {
      this.logger.error('Simulation failed: ' + (e as Error).message);
      return { simulation: 'Simulation service temporarily unavailable. Please try again.' };
    }
  }

  async scoreSEO(page: { title?: string; description?: string; content?: string; url?: string }) {
    let score = 0;
    const issues: string[] = [];
    const suggestions: string[] = [];

    if (page.title) {
      if (page.title.length >= 30 && page.title.length <= 60) { score += 20; }
      else if (page.title.length > 0) { score += 10; issues.push('Title should be 30-60 characters'); }
    } else { issues.push('Missing page title'); }

    if (page.description) {
      if (page.description.length >= 120 && page.description.length <= 160) { score += 20; }
      else if (page.description.length > 0) { score += 10; issues.push('Meta description should be 120-160 characters'); }
    } else { issues.push('Missing meta description'); suggestions.push('Add a compelling meta description to improve click-through rates'); }

    if (page.content) {
      const wordCount = page.content.split(/\s+/).length;
      if (wordCount >= 300) { score += 20; }
      else if (wordCount >= 100) { score += 10; issues.push('Content should be at least 300 words for good SEO'); }
      else { score += 5; issues.push('Very thin content - aim for 300+ words'); }

      if (page.content.includes('#') || /<h[1-6]/i.test(page.content)) { score += 10; }
      else { suggestions.push('Add headings (H1, H2) to structure your content'); }

      if (page.content.includes('http') || page.content.includes('href')) { score += 5; }
      else { suggestions.push('Add internal or external links to improve authority'); }
    } else { issues.push('No content to analyze'); score += 0; }

    if (page.url) {
      if (page.url.length < 75 && !page.url.includes(' ') && page.url === page.url.toLowerCase()) { score += 10; }
      else { issues.push('URL should be short, lowercase, and contain no spaces'); }
    }

    if (page.title && page.content) {
      const titleWords = page.title.toLowerCase().split(/\s+/);
      const contentLower = page.content.toLowerCase();
      const keywordPresent = titleWords.some(w => w.length > 3 && contentLower.includes(w));
      if (keywordPresent) { score += 15; } else { suggestions.push('Include your title keywords in the page content'); }
    }

    const grade = score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : score >= 20 ? 'D' : 'F';

    return { score: Math.min(score, 100), grade, issues, suggestions };
  }
}
