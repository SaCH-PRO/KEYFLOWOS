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
      budget?: string;
      timeline?: string;
      teamSize?: string;
      location?: string;
      legalStructure?: string;
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
      intake.budget ? `Available Budget: ${sanitize(intake.budget)}` : null,
      intake.timeline ? `Launch Timeline: ${sanitize(intake.timeline)}` : null,
      intake.teamSize ? `Team Size: ${sanitize(intake.teamSize)}` : null,
      intake.location ? `Location: ${sanitize(intake.location)}` : null,
      intake.legalStructure ? `Preferred Legal Structure: ${sanitize(intake.legalStructure)}` : null,
    ].filter(Boolean).join('\n');

    const systemPrompt = `You are a world-class Business Strategist, Legal Advisor, Financial Analyst, and Operations Consultant combined. You have deep expertise in Caribbean and international markets, startup methodology, corporate law, tax strategy, financial modeling, and go-to-market execution. You produce institutional-quality business plans that would satisfy investors, bank loan officers, legal counsel, and regulatory bodies.

YOUR EXPERTISE AREAS:
- Legal: Company formation (sole trader, partnership, LLC, limited company), BIR registration, VAT compliance, industry permits/licenses, employment law, data protection (T&T Data Protection Act 2011), intellectual property, contract law
- Financial: Unit economics (CAC, LTV, ARPU), cash flow modeling, break-even analysis, working capital requirements, funding strategy, tax obligations (Corporation Tax 30%, Green Fund Levy 0.3%, Business Levy 0.6%), financial projections
- Strategic: Porter's Five Forces, SWOT analysis, competitive positioning, Blue Ocean strategy, market sizing (TAM/SAM/SOM), customer journey mapping
- Operations: Supply chain, vendor management, technology stack, process automation, quality assurance, scalability planning
- Marketing: Go-to-market strategy, channel economics, brand positioning, customer acquisition funnel, retention strategy, digital marketing

Existing Business Data:
${existingContext || 'New business — no existing data.'}

User Input:
${intakeContext}

Generate a comprehensive, professional-grade business plan. Return ONLY valid JSON with this EXACT structure:

{
  "summary": "3-4 sentence executive summary covering the concept, market opportunity, revenue potential, and competitive edge",
  "canvas": {
    "valueProposition": "Detailed unique value — include specific benefits, pain points solved, and why customers would switch from alternatives. Reference specific market gaps.",
    "customerSegments": "Detailed segmentation with demographics, psychographics, buying behavior, estimated market size (TAM/SAM/SOM where possible), and primary vs secondary segments",
    "channels": "Multi-channel strategy: acquisition channels, distribution channels, communication channels. Include cost-per-channel estimates and expected conversion rates",
    "customerRelationships": "Lifecycle strategy: acquisition tactics, onboarding process, retention mechanisms, upsell/cross-sell strategy, churn prevention, community building",
    "revenueStreams": "Detailed pricing architecture: primary revenue model, secondary streams, pricing tiers with specific price points in TTD, payment terms, projected revenue mix",
    "keyResources": "Categorized: Human (roles, headcount, salary ranges), Intellectual (IP, brand, proprietary tech), Physical (equipment, workspace, inventory), Financial (capital requirements, credit lines)",
    "keyActivities": "Core operations workflow, quality assurance processes, technology development, partnership management, compliance activities. Prioritized by impact.",
    "keyPartnerships": "Strategic alliances, key suppliers (with alternatives), distribution partners, technology vendors, professional advisors (lawyer, accountant, insurance). Include why each matters.",
    "costStructure": "Detailed: fixed costs (rent, salaries, insurance, subscriptions), variable costs (COGS, commissions, shipping), one-time costs (setup, equipment, legal). Break down monthly totals in TTD."
  },
  "legalCompliance": {
    "businessStructure": "Recommended legal structure (Sole Trader / Partnership / LLC / Limited Company) with reasoning, formation steps, estimated registration costs in TTD, and timeline",
    "registrations": ["List each required registration: BIR (Board of Inland Revenue), NIB (National Insurance Board), VAT registration (if revenue > 500,000 TTD), TTSEC (if applicable), industry-specific licenses"],
    "taxObligations": "Corporation Tax (30%), Business Levy (0.6%), Green Fund Levy (0.3%), PAYE obligations, VAT (12.5% if applicable), Health Surcharge. Include filing deadlines and estimated annual tax liability.",
    "contracts": ["List essential contracts: Service Agreement, Terms of Service, Privacy Policy, Employment Contracts, NDA, Contractor Agreements, Supplier Agreements — explain why each is needed"],
    "insuranceNeeds": ["Required and recommended insurance: Public Liability, Professional Indemnity, Workers Compensation, Property Insurance, Cyber Liability — with estimated annual premiums in TTD"],
    "complianceChecklist": ["Ordered checklist of every legal/regulatory step from Day 1 to full compliance. Be specific to T&T and the industry."]
  },
  "competitiveAnalysis": {
    "swot": {
      "strengths": ["3-5 genuine strengths based on the business concept — be specific, not generic"],
      "weaknesses": ["3-5 honest weaknesses and limitations — include resource gaps, experience gaps, market barriers"],
      "opportunities": ["3-5 market opportunities — include timing advantages, underserved segments, regulatory changes, tech trends"],
      "threats": ["3-5 real threats — competitive response, regulatory risk, economic conditions, supply chain risks"]
    },
    "competitorLandscape": "Analysis of the competitive environment: who the main competitors are (direct and indirect), their strengths/weaknesses, market share estimates, pricing comparison, and your positioning strategy",
    "differentiators": ["3-5 specific competitive advantages that are defensible and sustainable"],
    "marketEntry": "Go-to-market strategy: launch approach, initial target segment, beachhead market, expansion plan, estimated time to first revenue"
  },
  "unitEconomics": {
    "customerAcquisitionCost": "Estimated CAC with breakdown by channel (social media, referrals, advertising, partnerships) in TTD",
    "lifetimeValue": "Estimated LTV based on average order value, purchase frequency, and retention rate in TTD",
    "ltvCacRatio": "Target LTV:CAC ratio with analysis — healthy is 3:1+",
    "averageRevenue": "ARPU (Average Revenue Per User) monthly and annually in TTD",
    "grossMargin": "Expected gross margin percentage with COGS breakdown",
    "contributionMargin": "Revenue minus variable costs per unit/transaction in TTD",
    "paybackPeriod": "Months to recover CAC from a single customer",
    "breakEvenUnits": "Number of customers/transactions needed monthly to break even"
  },
  "roadmap": [
    {
      "phase": "Phase name (e.g. Foundation & Legal Setup)",
      "timeline": "e.g. Month 1-3",
      "objectives": ["Specific, measurable objectives"],
      "milestones": ["Concrete deliverables with success criteria"],
      "estimatedCost": "Budget range in TTD with breakdown"
    }
  ],
  "actionPlan": [
    {
      "priority": "HIGH|MEDIUM|LOW",
      "action": "Specific, actionable task — not vague advice",
      "category": "LEGAL|FINANCE|SETUP|MARKETING|OPERATIONS|TECHNOLOGY|HR",
      "timeframe": "This week|This month|This quarter",
      "details": "Step-by-step execution instructions including who, what, where, estimated cost, and expected outcome",
      "module": "projects|bookings|commerce|marketing|expenses|contacts|store|documents|reports"
    }
  ],
  "financialOutlook": {
    "startupCosts": "Itemized startup investment in TTD (registration, equipment, inventory, marketing, working capital, legal fees, insurance)",
    "monthlyBurn": "Detailed monthly operating costs in TTD (rent, salaries, utilities, marketing, subscriptions, supplies, insurance, loan payments)",
    "breakEvenTimeline": "Month-by-month projection to breakeven with assumptions stated",
    "yearOneRevenue": "Conservative, moderate, and optimistic revenue scenarios for Year 1 in TTD with underlying assumptions",
    "keyMetrics": ["Specific KPIs with target values: Monthly Revenue, Customer Count, CAC, LTV, Churn Rate, Gross Margin %, Cash Runway"],
    "fundingStrategy": "Recommended funding approach: bootstrapping, bank loan (with T&T bank options), grants (NEDCO, IDB, Youth Business TT), angel investment, or hybrid. Include estimated amounts needed.",
    "cashFlowProjection": "Quarter-by-quarter cash flow summary for Year 1 showing inflows, outflows, and closing balance in TTD"
  },
  "risks": [
    {
      "risk": "Specific risk description",
      "impact": "HIGH|MEDIUM|LOW",
      "likelihood": "HIGH|MEDIUM|LOW",
      "category": "FINANCIAL|LEGAL|MARKET|OPERATIONAL|TECHNOLOGY|REGULATORY",
      "mitigation": "Detailed mitigation strategy with specific actions, contingency plans, and early warning indicators",
      "contingency": "What to do if this risk materializes despite mitigation"
    }
  ],
  "recommendedDocuments": ["document-slug-1", "document-slug-2"]
}

QUALITY STANDARDS — Your output must meet these criteria:
1. LEGAL DEFENSIBILITY: Every legal recommendation must reference actual T&T legislation, regulatory bodies, or established legal principles. Cite the Companies Act, the VAT Act, the Income Tax Act, OSHA requirements, and industry-specific regulations where applicable.
2. FINANCIAL RIGOR: All financial figures must be realistic for the T&T/Caribbean market. Use actual market rates for rent, salaries, utilities, and insurance. Show your work — explain assumptions behind projections.
3. COMPETITIVE INTELLIGENCE: Analyze real competitive dynamics, not theoretical ones. Consider local market leaders, regional competitors, and international players entering the market.
4. ACTIONABILITY: Every recommendation must be something the user can execute within the given timeframe. Include specific next steps, not generic advice like "do market research."
5. INDUSTRY SPECIFICITY: Tailor every section to the specific industry. A restaurant plan should discuss food safety certificates and health inspections. A tech startup should discuss IP protection and data handling. A consulting firm should discuss professional liability and client contracts.

VOLUME REQUIREMENTS:
- 4-6 roadmap phases covering first 18 months
- 10-15 action items across all categories (LEGAL, FINANCE, SETUP, MARKETING, OPERATIONS, TECHNOLOGY, HR)
- 6-8 risks with mitigations across all categories
- 3-5 items in each SWOT quadrant
- 4-6 legal registrations
- 3-5 essential contracts
- 3-5 insurance recommendations
- 3-5 competitive differentiators
- Recommend 5-8 business documents from these available slugs ONLY: company-description, registration-record, owner-register, license-register, invoice-template, tax-calendar, chart-of-accounts, financial-statement, budget-template, receipt-template, expense-report, proposal-template, service-agreement, payment-terms, pricing-sheet, client-onboarding, refund-policy, company-tagline, founder-bio, company-profile, elevator-pitch, mission-vision, tone-guide, sales-one-pager, faq-document, sop, approval-matrix, business-continuity, meeting-agenda, project-handoff, communication-plan, offer-letter, employee-handbook, nda-employee, job-description, contractor-agreement, contractor-sow, contractor-ip, privacy-policy, data-handling, cookie-policy, website-terms, ecommerce-terms

ALL financial figures in TTD. Be specific, be thorough, be actionable. This plan should be good enough to present to a bank or investor.`;

    try {
      const result = await this.aiUsage.callAi({
        businessId,
        feature: 'chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Generate a complete, professional-grade business plan for: ${intake.businessIdea}` },
        ],
        maxTokens: 8000,
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

      const safeStr = (v: unknown, fallback = '') => typeof v === 'string' ? v : fallback;
      const safeArr = (v: unknown) => Array.isArray(v) ? v : [];
      const safeObj = (v: unknown) => v && typeof v === 'object' ? v as Record<string, unknown> : {};

      const fin = safeObj(parsed.financialOutlook);
      const legal = safeObj(parsed.legalCompliance);
      const comp = safeObj(parsed.competitiveAnalysis);
      const swotRaw = safeObj((comp as Record<string, unknown>).swot);
      const unit = safeObj(parsed.unitEconomics);

      const validated = {
        summary: safeStr(parsed.summary),
        canvas: parsed.canvas && typeof parsed.canvas === 'object' ? parsed.canvas : {
          valueProposition: '', customerSegments: '', channels: '',
          customerRelationships: '', revenueStreams: '', keyResources: '',
          keyActivities: '', keyPartnerships: '', costStructure: '',
        },
        legalCompliance: {
          businessStructure: safeStr(legal.businessStructure, 'Consult a local attorney for structure recommendation'),
          registrations: safeArr(legal.registrations),
          taxObligations: safeStr(legal.taxObligations, 'Consult BIR for specific tax obligations'),
          contracts: safeArr(legal.contracts),
          insuranceNeeds: safeArr(legal.insuranceNeeds),
          complianceChecklist: safeArr(legal.complianceChecklist),
        },
        competitiveAnalysis: {
          swot: {
            strengths: safeArr(swotRaw.strengths),
            weaknesses: safeArr(swotRaw.weaknesses),
            opportunities: safeArr(swotRaw.opportunities),
            threats: safeArr(swotRaw.threats),
          },
          competitorLandscape: safeStr(comp.competitorLandscape),
          differentiators: safeArr(comp.differentiators),
          marketEntry: safeStr(comp.marketEntry),
        },
        unitEconomics: {
          customerAcquisitionCost: safeStr(unit.customerAcquisitionCost, 'Not estimated'),
          lifetimeValue: safeStr(unit.lifetimeValue, 'Not estimated'),
          ltvCacRatio: safeStr(unit.ltvCacRatio, 'Not estimated'),
          averageRevenue: safeStr(unit.averageRevenue, 'Not estimated'),
          grossMargin: safeStr(unit.grossMargin, 'Not estimated'),
          contributionMargin: safeStr(unit.contributionMargin, 'Not estimated'),
          paybackPeriod: safeStr(unit.paybackPeriod, 'Not estimated'),
          breakEvenUnits: safeStr(unit.breakEvenUnits, 'Not estimated'),
        },
        roadmap: safeArr(parsed.roadmap),
        actionPlan: safeArr(parsed.actionPlan),
        financialOutlook: {
          startupCosts: safeStr(fin.startupCosts, 'Not estimated'),
          monthlyBurn: safeStr(fin.monthlyBurn, 'Not estimated'),
          breakEvenTimeline: safeStr(fin.breakEvenTimeline, 'Not estimated'),
          yearOneRevenue: safeStr(fin.yearOneRevenue, 'Not estimated'),
          keyMetrics: safeArr(fin.keyMetrics),
          fundingStrategy: safeStr(fin.fundingStrategy),
          cashFlowProjection: safeStr(fin.cashFlowProjection),
        },
        risks: safeArr(parsed.risks),
        recommendedDocuments: safeArr(parsed.recommendedDocuments),
      };

      return { success: true, model: validated, usage: result.usage };
    } catch (error) {
      this.logger.error(`Business model generation error: ${(error as Error).message}`);
      return { success: false, error: 'An error occurred generating your business model. Please try again.' };
    }
  }
}
