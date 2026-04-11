import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiUsageService } from './ai-usage.service';

@Injectable()
export class AiAdvisorService {
  private readonly logger = new Logger(AiAdvisorService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
  ) {}

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
      const result = await this.aiUsage.callAi({
        businessId,
        feature: 'chat',
        messages,
        maxTokens: 500,
        temperature: 0.7,
      });

      return {
        reply: result.content || 'I was unable to generate a response. Please try again.',
        context: {
          momentumScore: context.momentumScore,
          businessName,
        },
        usage: result.usage,
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
      const yday = new Date(now);
      yday.setDate(yday.getDate() - 1);
      return actDate >= yday;
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
      const result = await this.aiUsage.callAi({
        businessId,
        feature: 'briefing',
        messages: [
          {
            role: 'system',
            content: `You are KeyFlow, an AI business advisor for ${businessName}. Generate concise daily briefings. Always respond with valid JSON only.`,
          },
          { role: 'user', content: briefingPrompt },
        ],
        maxTokens: 600,
        temperature: 0.5,
      });

      try {
        const parsed = JSON.parse(result.content);
        return { ...parsed, usage: result.usage };
      } catch {
        return {
          summary: result.content,
          highlights: [],
          priorities: [
            context.bookings.upcoming.length > 0 ? `${context.bookings.upcoming.length} upcoming bookings to prepare for` : null,
            context.invoices.overdueCount > 0 ? `${context.invoices.overdueCount} overdue invoices need follow-up` : null,
            staleLeads > 0 ? `${staleLeads} stale leads to re-engage` : null,
          ].filter(Boolean),
          cashFlow: { revenue, expenses, net },
          suggestion: 'Review your overdue invoices and follow up with clients today.',
          usage: result.usage,
        };
      }
    } catch (error) {
      this.logger.error(`AI briefing error: ${(error as Error).message}`);
      throw error;
    }
  }

  async predictCashFlow(businessId: string, days = 30) {
    if (!this.prisma?.client) {
      this.logger.error('PrismaService not available in predictCashFlow');
      return {
        currentBalance: 0, projectedBalance: 0, daysUntilNegative: null,
        trend: 'stable', alerts: ['Cash flow data unavailable — service initializing.'],
        dailyRevenueRate: 0, dailyExpenseRate: 0, projectionDays: days,
      };
    }
    try {
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
    } catch (e) {
      this.logger.error(`predictCashFlow failed: ${(e as Error).message}`);
      return {
        currentBalance: 0, projectedBalance: 0, daysUntilNegative: null,
        trend: 'stable', alerts: ['Unable to compute cash flow forecast at this time.'],
        dailyRevenueRate: 0, dailyExpenseRate: 0, projectionDays: days,
      };
    }
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
      const result = await this.aiUsage.callAi({
        businessId,
        feature: 'simulation',
        messages: [
          { role: 'system', content: 'You are KeyFlow AI, a business simulation engine that provides detailed what-if analysis based on real business data.' },
          { role: 'user', content: prompt },
        ],
        maxTokens: 2000,
      });
      return { simulation: result.content || 'Unable to run simulation.', usage: result.usage };
    } catch (e) {
      this.logger.error('Simulation failed: ' + (e as Error).message);
      throw e;
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

  async generateBusinessModel(
    businessId: string,
    intake: {
      businessIdea: string;
      targetMarket?: string;
      valueProposition?: string;
      revenueModel?: string;
      goals?: string;
      stage?: string;
      challenges?: string;
    },
  ) {
    const context = await this.getBusinessContext(businessId);
    const businessName = context.business?.name ?? 'your business';
    const industry = context.business?.industry ?? '';

    const existingContext = [
      businessName !== 'your business' ? `Business Name: ${businessName}` : null,
      industry ? `Industry: ${industry}` : null,
      context.business?.archetype ? `Archetype: ${context.business.archetype}` : null,
      context.business?.revenueModel ? `Current Revenue Model: ${context.business.revenueModel}` : null,
      context.business?.tagline ? `Tagline: ${context.business.tagline}` : null,
      context.contacts?.total ? `Existing Contacts: ${context.contacts.total}` : null,
      context.invoices?.totalRevenue ? `Revenue to Date: $${context.invoices.totalRevenue.toLocaleString()} TTD` : null,
    ].filter(Boolean).join('\n');

    const sanitize = (s: string) => s.replace(/[<>{}]/g, '').slice(0, 2000);

    const intakeContext = [
      `Business Idea: ${sanitize(intake.businessIdea)}`,
      intake.targetMarket ? `Target Market: ${sanitize(intake.targetMarket)}` : null,
      intake.valueProposition ? `Value Proposition: ${sanitize(intake.valueProposition)}` : null,
      intake.revenueModel ? `Preferred Revenue Model: ${sanitize(intake.revenueModel)}` : null,
      intake.goals ? `Goals: ${sanitize(intake.goals)}` : null,
      intake.stage ? `Current Stage: ${sanitize(intake.stage)}` : null,
      intake.challenges ? `Key Challenges: ${sanitize(intake.challenges)}` : null,
    ].filter(Boolean).join('\n');

    const systemPrompt = `You are a Senior Business Strategist and startup advisor specializing in Caribbean and international markets. You create comprehensive, actionable business plans.

Existing Business Data:
${existingContext || 'New business — no existing data.'}

User Input:
${intakeContext}

Generate a comprehensive business model and execution plan. Return ONLY valid JSON with this exact structure:
{
  "summary": "2-3 sentence executive summary of the business concept",
  "canvas": {
    "valueProposition": "What unique value you deliver to customers",
    "customerSegments": "Who your target customers are and their characteristics",
    "channels": "How you reach and deliver to customers",
    "customerRelationships": "How you acquire, retain, and grow customer base",
    "revenueStreams": "How the business makes money — pricing, models, projections",
    "keyResources": "Critical assets needed — people, tech, capital, IP",
    "keyActivities": "Most important things the business must do",
    "keyPartnerships": "Strategic partners, suppliers, and alliances needed",
    "costStructure": "Major costs, fixed vs variable, and burn rate considerations"
  },
  "roadmap": [
    {
      "phase": "Phase name",
      "timeline": "e.g. Month 1-3",
      "objectives": ["Objective 1", "Objective 2"],
      "milestones": ["Milestone 1", "Milestone 2"],
      "estimatedCost": "Budget range in TTD"
    }
  ],
  "actionPlan": [
    {
      "priority": "HIGH|MEDIUM|LOW",
      "action": "Specific action to take",
      "category": "SETUP|MARKETING|FINANCE|OPERATIONS|LEGAL",
      "timeframe": "This week|This month|This quarter",
      "details": "Brief explanation of how to execute"
    }
  ],
  "financialOutlook": {
    "startupCosts": "Estimated total startup investment in TTD",
    "monthlyBurn": "Estimated monthly operating costs in TTD",
    "breakEvenTimeline": "When the business should break even",
    "yearOneRevenue": "Projected first-year revenue in TTD",
    "keyMetrics": ["Metric 1 to track", "Metric 2 to track"]
  },
  "risks": [
    {
      "risk": "Description of the risk",
      "impact": "HIGH|MEDIUM|LOW",
      "mitigation": "How to mitigate this risk"
    }
  ],
  "recommendedDocuments": ["document-slug-1", "document-slug-2"]
}

Guidelines:
- Use TTD currency for all financial figures
- Be specific and actionable — no generic advice
- Tailor to Caribbean market realities (import costs, island logistics, local regulations)
- Include 4-6 roadmap phases covering first 18 months
- Include 8-12 action items across categories
- Include 4-6 risks with mitigations
- Recommend 5-8 business documents from these available slugs ONLY: company-description, registration-record, owner-register, license-register, invoice-template, tax-calendar, chart-of-accounts, financial-statement, budget-template, receipt-template, expense-report, proposal-template, service-agreement, payment-terms, pricing-sheet, client-onboarding, refund-policy, company-tagline, founder-bio, company-profile, elevator-pitch, mission-vision, tone-guide, sales-one-pager, faq-document, sop, approval-matrix, business-continuity, meeting-agenda, project-handoff, communication-plan, offer-letter, employee-handbook, nda-employee, job-description, contractor-agreement, contractor-sow, contractor-ip, privacy-policy, data-handling, cookie-policy, website-terms, ecommerce-terms
- Each action item should have a "module" field indicating which KEYFLOWOS module can execute it: "projects", "bookings", "commerce", "marketing", "expenses", "contacts", "store", "documents", "reports"

Enhance the actionPlan items to include a "module" field:
"actionPlan": [
  {
    "priority": "HIGH|MEDIUM|LOW",
    "action": "Specific action to take",
    "category": "SETUP|MARKETING|FINANCE|OPERATIONS|LEGAL",
    "timeframe": "This week|This month|This quarter",
    "details": "Brief explanation of how to execute",
    "module": "projects|bookings|commerce|marketing|expenses|contacts|store|documents|reports"
  }
]`;

    try {
      const result = await this.aiUsage.callAi({
        businessId,
        feature: 'chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Generate a complete business model and execution plan for: ${intake.businessIdea}` },
        ],
        maxTokens: 4000,
        temperature: 0.7,
      });

      const raw = result.content || '';
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { success: false, error: 'Failed to generate business model. Please try again.' };
      }

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        return { success: false, error: 'AI returned an invalid response. Please try again.' };
      }

      if (!parsed.summary || !parsed.canvas || !parsed.roadmap) {
        return { success: false, error: 'AI generated an incomplete business model. Please try again.' };
      }

      const validated = {
        summary: typeof parsed.summary === 'string' ? parsed.summary : '',
        canvas: parsed.canvas && typeof parsed.canvas === 'object' ? parsed.canvas : {
          valueProposition: '', customerSegments: '', channels: '',
          customerRelationships: '', revenueStreams: '', keyResources: '',
          keyActivities: '', keyPartnerships: '', costStructure: '',
        },
        roadmap: Array.isArray(parsed.roadmap) ? parsed.roadmap : [],
        actionPlan: Array.isArray(parsed.actionPlan) ? parsed.actionPlan : [],
        financialOutlook: parsed.financialOutlook && typeof parsed.financialOutlook === 'object' ? {
          startupCosts: (parsed.financialOutlook as any).startupCosts ?? 'Not estimated',
          monthlyBurn: (parsed.financialOutlook as any).monthlyBurn ?? 'Not estimated',
          breakEvenTimeline: (parsed.financialOutlook as any).breakEvenTimeline ?? 'Not estimated',
          yearOneRevenue: (parsed.financialOutlook as any).yearOneRevenue ?? 'Not estimated',
          keyMetrics: Array.isArray((parsed.financialOutlook as any).keyMetrics) ? (parsed.financialOutlook as any).keyMetrics : [],
        } : {
          startupCosts: 'Not estimated', monthlyBurn: 'Not estimated',
          breakEvenTimeline: 'Not estimated', yearOneRevenue: 'Not estimated',
          keyMetrics: [],
        },
        risks: Array.isArray(parsed.risks) ? parsed.risks : [],
        recommendedDocuments: Array.isArray(parsed.recommendedDocuments) ? parsed.recommendedDocuments : [],
      };

      return { success: true, model: validated, usage: result.usage };
    } catch (error) {
      this.logger.error(`Business model generation error: ${(error as Error).message}`);
      return { success: false, error: 'An error occurred generating your business model. Please try again.' };
    }
  }
}
