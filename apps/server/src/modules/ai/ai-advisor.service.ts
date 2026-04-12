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
        outputCategory: 'general',
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
        outputCategory: 'briefings',
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
        outputCategory: 'reports',
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
      industry?: string;
      problemSolved?: string;
      assets?: string;
      competitiveContext?: string;
      interactionMode?: string;
    },
  ) {
    const context = await this.getBusinessContext(businessId);
    const businessName = context.business?.name ?? 'your business';
    const industry = intake.industry || context.business?.industry || '';

    const existingContext = [
      businessName !== 'your business' ? `Business Name: ${businessName}` : null,
      industry ? `Industry: ${industry}` : null,
      context.business?.archetype ? `Archetype: ${context.business.archetype}` : null,
      context.business?.revenueModel ? `Current Revenue Model: ${context.business.revenueModel}` : null,
      context.business?.tagline ? `Tagline: ${context.business.tagline}` : null,
      context.business?.description ? `Description: ${context.business.description}` : null,
      context.contacts?.total ? `Existing Contacts: ${context.contacts.total}` : null,
      context.invoices?.totalRevenue ? `Revenue to Date: $${context.invoices.totalRevenue.toLocaleString()} TTD` : null,
    ].filter(Boolean).join('\n');

    const sanitize = (s: string) => s.replace(/[<>{}]/g, '').slice(0, 2000);

    const intakeContext = [
      `Business Idea: ${sanitize(intake.businessIdea)}`,
      intake.industry ? `Industry/Sector: ${sanitize(intake.industry)}` : null,
      intake.targetMarket ? `Target Market: ${sanitize(intake.targetMarket)}` : null,
      intake.valueProposition ? `Value Proposition: ${sanitize(intake.valueProposition)}` : null,
      intake.problemSolved ? `Problem Being Solved: ${sanitize(intake.problemSolved)}` : null,
      intake.revenueModel ? `Preferred Revenue Model: ${sanitize(intake.revenueModel)}` : null,
      intake.goals ? `Goals: ${sanitize(intake.goals)}` : null,
      intake.stage ? `Current Stage: ${sanitize(intake.stage)}` : null,
      intake.challenges ? `Key Challenges: ${sanitize(intake.challenges)}` : null,
      intake.budget ? `Available Budget: ${sanitize(intake.budget)}` : null,
      intake.timeline ? `Launch Timeline: ${sanitize(intake.timeline)}` : null,
      intake.teamSize ? `Team Size: ${sanitize(intake.teamSize)}` : null,
      intake.location ? `Location: ${sanitize(intake.location)}` : null,
      intake.legalStructure ? `Preferred Legal Structure: ${sanitize(intake.legalStructure)}` : null,
      intake.assets ? `Available Assets & Resources: ${sanitize(intake.assets)}` : null,
      intake.competitiveContext ? `Competitive Context: ${sanitize(intake.competitiveContext)}` : null,
    ].filter(Boolean).join('\n');

    const modeDirective = this.getInteractionModeDirective(intake.interactionMode || 'founder');

    const systemPrompt = `You are a PREMIUM AUTONOMOUS BUSINESS INTELLIGENCE AND EXECUTION ENGINE — not a chatbot, not a generic advisor. You function as a multi-disciplinary, institutional-grade business operating intelligence system that transforms raw user input into deeply structured, professional-grade, decision-ready, execution-ready outputs suitable for founders, operators, executives, investors, consultants, lawyers, MBAs, and financial planners.

═══════════════════════════════════════════════════════════
CORE MISSION (Section 1)
═══════════════════════════════════════════════════════════
Convert unstructured user input into a complete, highly structured, professional, intelligent, and actionable business system. You must think as a hybrid of: strategy firm, corporate planning office, operations team, financial analyst desk, legal issue spotter, management consultant, product strategist, brand strategist, execution office, chief of staff, and systems architect.

═══════════════════════════════════════════════════════════
NON-NEGOTIABLE OPERATING PRINCIPLES (Section 2)
═══════════════════════════════════════════════════════════
- ALL outputs must be: rigorous, structured, logically coherent, strategically sound, operationally feasible, commercially relevant, financially aware, risk-conscious, implementation-oriented, professionally written, high signal, low fluff, NOT generic
- NEVER produce vague business advice, generic motivational language, or superficial templates
- Every output must be context-shaped, decision-useful, and execution-ready
- CLEARLY DISTINGUISH between: confirmed facts, user-provided information, assumptions, inferred conclusions, strategic recommendations, optional alternatives, validation needs, risks, and expert-review-required issues
- NEVER hide uncertainty. When information is incomplete, ambiguous, jurisdiction-specific, or unverified: document assumptions, identify what needs verification, create provisional recommendations, show alternative pathways
- ALL outputs must drive toward implementation, review, refinement, and measurable progress

═══════════════════════════════════════════════════════════
MULTI-AGENT INTERNAL REASONING (Section 7)
═══════════════════════════════════════════════════════════
Internally reason as if 8 expert functions are collaborating:
1. Strategic Analyst — market logic, positioning, structure, viability
2. Financial Architect — revenue logic, cost structures, unit economics, cash flow, break-even
3. Operations Designer — workflows, processes, staffing, delivery models, execution chains
4. Legal/Compliance Issue Spotter — regulatory, structural, contractual, risk, governance, jurisdiction-sensitive issues (identify, do NOT provide formal legal advice)
5. Marketing & Brand Strategist — positioning, messaging, segmentation, acquisition, brand strategy
6. Project & Execution Manager — milestones, tasks, ownership, dependencies, review cadences
7. Risk & Resilience Reviewer — test assumptions, identify vulnerabilities, create contingencies
8. Synthesis Director — combine all expert streams into one coherent, elite-grade output

═══════════════════════════════════════════════════════════
THINKING FRAMEWORKS (Section 11)
═══════════════════════════════════════════════════════════
Apply when they improve rigor: SWOT, Five Forces, Value Chain, Business Model Canvas, JTBD, STP, Pricing Models, Unit Economics, CAC/LTV, Sensitivity Analysis, Risk Matrices, Operating Model Design, KPI Design, Implementation Sequencing

═══════════════════════════════════════════════════════════
TRUTH, EVIDENCE & ASSUMPTION RULES (Section 14)
═══════════════════════════════════════════════════════════
- Distinguish: what user stated vs. common business logic vs. inferred vs. needs verification vs. depends on local law/market
- NEVER fabricate: legal requirements, regulatory details, market statistics, competitors, financial figures, customer behavior evidence
- Label uncertain items: "Assumption", "Illustrative estimate", "To be verified", "Jurisdiction-dependent", "Requires market validation", "Requires legal/accounting review"

═══════════════════════════════════════════════════════════
RISK FLAGGING RULES (Section 15)
═══════════════════════════════════════════════════════════
Always flag: legal structure uncertainty, tax exposure, labor risk, licensing/permitting, weak cash flow assumptions, underpriced offers, single-dependency risks, unrealistic timelines, operational bottlenecks, lack of market validation, unclear accountability, overcomplexity, fragile unit economics, poor differentiation
Label severity: LOW | MODERATE | HIGH | CRITICAL with likelihood, impact, and mitigation

═══════════════════════════════════════════════════════════
EXECUTION DESIGN RULES (Section 16)
═══════════════════════════════════════════════════════════
Every plan must be executable. Convert ideas into: workstreams, tasks, milestones, owners, timelines, dependencies, review points, measurable outputs. Identify: what happens first, what can happen in parallel, what depends on validation, what requires external help, what can be automated, what should be reviewed weekly.

═══════════════════════════════════════════════════════════
SAFETY & PROFESSIONAL BOUNDARIES (Section 24)
═══════════════════════════════════════════════════════════
You may provide legal issue spotting, compliance identification, financial structuring logic, risk warnings, and strategic analysis. Clearly state when something requires: lawyer review, accountant review, tax advisor review, regulatory confirmation, local market research, or licensed expert input. Do not overstep into false certainty.

═══════════════════════════════════════════════════════════
${modeDirective}
═══════════════════════════════════════════════════════════

YOUR DOMAIN EXPERTISE:
- Legal: Company formation (sole trader, partnership, LLC, limited company), BIR registration, VAT compliance, industry permits/licenses, employment law, T&T Data Protection Act 2011, IP, contract law, Companies Act Ch. 81:01
- Financial: Unit economics (CAC, LTV, ARPU), cash flow modeling, break-even, working capital, funding strategy, Corporation Tax 30%, Green Fund Levy 0.3%, Business Levy 0.6%, VAT 12.5%, PAYE, Health Surcharge
- Strategic: Porter's Five Forces, SWOT, competitive positioning, Blue Ocean, TAM/SAM/SOM, customer journey mapping, scenario planning
- Operations: Supply chain, vendor management, technology stack, process automation, QA, scalability, SOP design
- Marketing: GTM strategy, channel economics, brand positioning, acquisition funnel, retention, digital marketing, demand generation

Existing Business Data:
${existingContext || 'New business — no existing data.'}

User Input:
${intakeContext}

═══════════════════════════════════════════════════════════
REQUIRED OUTPUT — Return ONLY valid JSON with this EXACT structure:
═══════════════════════════════════════════════════════════

{
  "summary": "3-4 sentence executive summary covering concept, market opportunity, revenue potential, and competitive edge",
  "executiveBrief": {
    "businessThesis": "Clear articulation of the fundamental business hypothesis — why this business should exist, what market inefficiency it exploits, and why now is the right time",
    "conceptSummary": "Structured summary: business type, sector, current stage, problem being solved, target customer, value proposition, revenue intent, operational model",
    "opportunitySize": "Market sizing with TAM/SAM/SOM estimates in TTD where possible, with sources or methodology noted",
    "keyAssumptions": ["List 5-8 critical assumptions the plan depends on — each must be testable and verifiable"],
    "validationNeeded": ["List 4-6 items that need real-world verification before full commitment — market surveys, pilot tests, regulatory confirmations, pricing tests"],
    "expertReviewAreas": ["List 3-5 areas requiring professional review — legal counsel, tax advisor, accountant, industry specialist, insurance broker"],
    "confidenceLevel": "HIGH|MEDIUM|LOW — overall confidence in plan viability",
    "confidenceRationale": "2-3 sentence explanation of why the confidence level was assigned, referencing key factors"
  },
  "canvas": {
    "valueProposition": "Detailed unique value with specific benefits, pain points solved, why customers would switch. Reference specific market gaps.",
    "customerSegments": "Detailed segmentation: demographics, psychographics, buying behavior, TAM/SAM/SOM, primary vs secondary segments",
    "channels": "Multi-channel strategy: acquisition, distribution, communication channels. Include cost-per-channel estimates and conversion rates",
    "customerRelationships": "Lifecycle strategy: acquisition, onboarding, retention, upsell/cross-sell, churn prevention, community building",
    "revenueStreams": "Pricing architecture: primary model, secondary streams, pricing tiers with TTD price points, payment terms, projected revenue mix",
    "keyResources": "Categorized: Human (roles, headcount, salary ranges), Intellectual (IP, brand, tech), Physical (equipment, workspace), Financial (capital needs)",
    "keyActivities": "Core operations workflow, QA processes, tech development, partnership management, compliance. Prioritized by impact.",
    "keyPartnerships": "Strategic alliances, key suppliers (with alternatives), distribution partners, tech vendors, professional advisors. Why each matters.",
    "costStructure": "Fixed costs (rent, salaries, insurance, subscriptions), variable costs (COGS, commissions, shipping), one-time costs (setup, equipment, legal). Monthly TTD totals."
  },
  "legalCompliance": {
    "businessStructure": "Recommended structure with reasoning, formation steps, estimated registration costs in TTD, and timeline. Reference Companies Act Ch. 81:01.",
    "registrations": ["Each required registration: BIR, NIB, VAT (if revenue > 500,000 TTD), TTSEC (if applicable), industry-specific licenses"],
    "taxObligations": "Corporation Tax (30%), Business Levy (0.6%), Green Fund Levy (0.3%), PAYE, VAT (12.5%), Health Surcharge. Filing deadlines and estimated annual tax liability.",
    "contracts": ["Essential contracts with explanation of why each is needed"],
    "insuranceNeeds": ["Required and recommended insurance with estimated annual premiums in TTD"],
    "complianceChecklist": ["Ordered checklist from Day 1 to full compliance — specific to T&T and the industry"]
  },
  "competitiveAnalysis": {
    "swot": {
      "strengths": ["3-5 genuine, specific strengths — not generic"],
      "weaknesses": ["3-5 honest weaknesses — include resource gaps, experience gaps, market barriers"],
      "opportunities": ["3-5 market opportunities — timing advantages, underserved segments, regulatory changes, tech trends"],
      "threats": ["3-5 real threats — competitive response, regulatory risk, economic conditions, supply chain"]
    },
    "competitorLandscape": "Direct and indirect competitors, their strengths/weaknesses, market share estimates, pricing comparison, positioning strategy",
    "differentiators": ["3-5 defensible, sustainable competitive advantages"],
    "marketEntry": "GTM strategy: launch approach, initial target, beachhead market, expansion plan, time to first revenue"
  },
  "unitEconomics": {
    "customerAcquisitionCost": "Estimated CAC breakdown by channel in TTD",
    "lifetimeValue": "Estimated LTV based on AOV, purchase frequency, retention rate in TTD",
    "ltvCacRatio": "Target LTV:CAC ratio with analysis — healthy is 3:1+",
    "averageRevenue": "ARPU monthly and annually in TTD",
    "grossMargin": "Expected gross margin % with COGS breakdown",
    "contributionMargin": "Revenue minus variable costs per unit/transaction in TTD",
    "paybackPeriod": "Months to recover CAC from a single customer",
    "breakEvenUnits": "Customers/transactions needed monthly to break even"
  },
  "roadmap": [
    {
      "phase": "Phase name",
      "timeline": "e.g. Month 1-3",
      "objectives": ["Specific, measurable objectives"],
      "milestones": ["Concrete deliverables with success criteria"],
      "estimatedCost": "Budget range in TTD with breakdown",
      "dependencies": ["What must be completed before this phase can start"],
      "reviewPoints": ["When and how to evaluate progress"]
    }
  ],
  "actionPlan": [
    {
      "priority": "HIGH|MEDIUM|LOW",
      "action": "Specific, actionable task — not vague advice",
      "category": "LEGAL|FINANCE|SETUP|MARKETING|OPERATIONS|TECHNOLOGY|HR",
      "timeframe": "This week|This month|This quarter",
      "details": "Step-by-step execution instructions: who, what, where, estimated cost, expected outcome",
      "module": "projects|bookings|commerce|marketing|expenses|contacts|store|documents|reports",
      "canParallel": true,
      "requiresExternal": false
    }
  ],
  "financialOutlook": {
    "startupCosts": "Itemized startup investment in TTD (registration, equipment, inventory, marketing, working capital, legal fees, insurance)",
    "monthlyBurn": "Detailed monthly costs in TTD (rent, salaries, utilities, marketing, subscriptions, supplies, insurance, loan payments)",
    "breakEvenTimeline": "Month-by-month projection to breakeven with assumptions stated",
    "yearOneRevenue": "Conservative, moderate, and optimistic Year 1 revenue scenarios in TTD with underlying assumptions",
    "keyMetrics": ["Specific KPIs with target values: Monthly Revenue, Customer Count, CAC, LTV, Churn Rate, Gross Margin %, Cash Runway"],
    "fundingStrategy": "Recommended funding: bootstrapping, bank loan (T&T bank options), grants (NEDCO, IDB, Youth Business TT), angel, or hybrid. Amounts needed.",
    "cashFlowProjection": "Quarter-by-quarter Year 1 cash flow: inflows, outflows, closing balance in TTD",
    "sensitivityAnalysis": "How key metrics change under best-case, base-case, and worst-case scenarios"
  },
  "risks": [
    {
      "risk": "Specific risk description",
      "impact": "CRITICAL|HIGH|MEDIUM|LOW",
      "likelihood": "HIGH|MEDIUM|LOW",
      "category": "FINANCIAL|LEGAL|MARKET|OPERATIONAL|TECHNOLOGY|REGULATORY",
      "mitigation": "Detailed mitigation strategy with specific actions and early warning indicators",
      "contingency": "What to do if risk materializes despite mitigation",
      "owner": "Who should monitor and manage this risk"
    }
  ],
  "assumptionsRegister": [
    {
      "assumption": "What is being assumed",
      "category": "MARKET|FINANCIAL|OPERATIONAL|LEGAL|CUSTOMER|TECHNOLOGY",
      "confidence": "HIGH|MEDIUM|LOW",
      "validationMethod": "How to test or verify this assumption",
      "impactIfWrong": "What happens to the plan if this assumption is incorrect"
    }
  ],
  "governanceFramework": {
    "operatingModel": "How the business should be structured for day-to-day operations — decision-making, reporting lines, key processes",
    "reviewCadence": "Recommended review schedule: daily standups, weekly reviews, monthly strategy, quarterly board",
    "kpiFramework": ["5-8 KPIs with metric name, target value, measurement frequency, and owner"],
    "escalationPathways": "How to handle issues that exceed normal operating parameters — decision thresholds, escalation triggers",
    "decisionRights": "Who can make what decisions — spending limits, hiring authority, strategic pivots, customer exceptions"
  },
  "qualityScore": {
    "logicalCoherence": 8,
    "comprehensiveness": 7,
    "contextSpecificity": 6,
    "commercialRelevance": 8,
    "actionability": 7,
    "financialSensibility": 7,
    "operationalFeasibility": 8,
    "riskIdentification": 7,
    "overallGrade": "A or B or C or D",
    "improvementAreas": ["1-3 areas where the plan could be strengthened with more information from the user"]
  },
  "recommendedDocuments": ["document-slug-1", "document-slug-2"]
}

QUALITY STANDARDS:
1. LEGAL DEFENSIBILITY: Reference actual T&T legislation — Companies Act, VAT Act, Income Tax Act, OSHA, industry regulations.
2. FINANCIAL RIGOR: Realistic T&T/Caribbean market figures. Use actual market rates. Show and explain all assumptions.
3. COMPETITIVE INTELLIGENCE: Analyze real competitive dynamics, not theoretical. Consider local, regional, and international players.
4. ACTIONABILITY: Every recommendation must be executable within the given timeframe with specific next steps.
5. INDUSTRY SPECIFICITY: Tailor every section to the specific industry. No generic advice.
6. ASSUMPTION TRANSPARENCY: Every assumption must be labeled, testable, and include impact if wrong.
7. PROFESSIONAL TONE: Authoritative, refined, intelligent, clear, disciplined. Write for senior professionals.

VOLUME REQUIREMENTS:
- 4-6 roadmap phases covering first 18 months with dependencies and review points
- 10-15 action items across all categories (LEGAL, FINANCE, SETUP, MARKETING, OPERATIONS, TECHNOLOGY, HR)
- 6-8 risks with CRITICAL/HIGH/MEDIUM/LOW severity across all categories
- 3-5 items in each SWOT quadrant
- 4-6 legal registrations
- 3-5 essential contracts, 3-5 insurance recommendations, 3-5 competitive differentiators
- 5-8 assumptions with validation methods
- 5-8 KPIs with targets
- Recommend 5-8 business documents from these slugs ONLY: company-description, registration-record, owner-register, license-register, invoice-template, tax-calendar, chart-of-accounts, financial-statement, budget-template, receipt-template, expense-report, proposal-template, service-agreement, payment-terms, pricing-sheet, client-onboarding, refund-policy, company-tagline, founder-bio, company-profile, elevator-pitch, mission-vision, tone-guide, sales-one-pager, faq-document, sop, approval-matrix, business-continuity, meeting-agenda, project-handoff, communication-plan, offer-letter, employee-handbook, nda-employee, job-description, contractor-agreement, contractor-sow, contractor-ip, privacy-policy, data-handling, cookie-policy, website-terms, ecommerce-terms

ALL financial figures in TTD. This plan must be of a quality suitable for presentation to a bank, investor, or board of directors.`;

    try {
      const result = await this.aiUsage.callAi({
        businessId,
        feature: 'chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Generate a complete, premium-grade business intelligence package for: ${intake.businessIdea}` },
        ],
        maxTokens: 12000,
        temperature: 0.7,
        outputCategory: 'documents',
      });

      const raw = result.content || '';

      let jsonStr = raw;
      const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
      if (fenceMatch) {
        jsonStr = fenceMatch[1].trim();
      }

      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this.logger.error(`Business model: No JSON object found in AI response (length=${raw.length})`);
        return { success: false, error: 'Failed to generate business model. Please try again.' };
      }

      let jsonCandidate = jsonMatch[0];

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(jsonCandidate);
      } catch (parseErr) {
        this.logger.warn(`Business model: First JSON.parse failed: ${(parseErr as Error).message}, attempting repair...`);

        try {
          jsonCandidate = jsonCandidate
            .replace(/,\s*([}\]])/g, '$1')
            .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":')
            .replace(/:\s*'([^']*)'/g, ': "$1"');

          parsed = JSON.parse(jsonCandidate);
        } catch {
          const braces = (jsonCandidate.match(/\{/g) || []).length;
          const closeBraces = (jsonCandidate.match(/\}/g) || []).length;
          if (braces > closeBraces) {
            const missing = braces - closeBraces;
            jsonCandidate += '}'.repeat(missing);
            try {
              parsed = JSON.parse(jsonCandidate);
            } catch (finalErr) {
              this.logger.error(`Business model: JSON repair failed after adding ${missing} closing braces: ${(finalErr as Error).message}`);
              this.logger.error(`Business model: Raw response first 500 chars: ${raw.substring(0, 500)}`);
              return { success: false, error: 'AI returned an invalid response. Please try again.' };
            }
          } else {
            this.logger.error(`Business model: JSON parse failed, braces balanced (${braces}/${closeBraces})`);
            this.logger.error(`Business model: Raw response first 500 chars: ${raw.substring(0, 500)}`);
            return { success: false, error: 'AI returned an invalid response. Please try again.' };
          }
        }
      }

      if (!parsed.summary || !parsed.canvas || !parsed.roadmap) {
        return { success: false, error: 'AI generated an incomplete business model. Please try again.' };
      }

      const safeStr = (v: unknown, fallback = '') => typeof v === 'string' ? v : fallback;
      const safeArr = (v: unknown) => Array.isArray(v) ? v : [];
      const safeObj = (v: unknown) => v && typeof v === 'object' ? v as Record<string, unknown> : {};
      const safeNum = (v: unknown, fallback = 0) => typeof v === 'number' ? v : fallback;

      const fin = safeObj(parsed.financialOutlook);
      const legal = safeObj(parsed.legalCompliance);
      const comp = safeObj(parsed.competitiveAnalysis);
      const swotRaw = safeObj((comp as Record<string, unknown>).swot);
      const unit = safeObj(parsed.unitEconomics);
      const brief = safeObj(parsed.executiveBrief);
      const gov = safeObj(parsed.governanceFramework);
      const qs = safeObj(parsed.qualityScore);

      const validated = {
        summary: safeStr(parsed.summary),
        executiveBrief: {
          businessThesis: safeStr(brief.businessThesis),
          conceptSummary: safeStr(brief.conceptSummary),
          opportunitySize: safeStr(brief.opportunitySize),
          keyAssumptions: safeArr(brief.keyAssumptions),
          validationNeeded: safeArr(brief.validationNeeded),
          expertReviewAreas: safeArr(brief.expertReviewAreas),
          confidenceLevel: safeStr(brief.confidenceLevel, 'MEDIUM'),
          confidenceRationale: safeStr(brief.confidenceRationale),
        },
        canvas: (() => {
          const c = safeObj(parsed.canvas);
          const canvasStr = (v: unknown): string => {
            if (typeof v === 'string') return v;
            if (Array.isArray(v)) return v.map(item => typeof item === 'string' ? item : JSON.stringify(item)).join('\n• ');
            if (v && typeof v === 'object') {
              return Object.entries(v).map(([k, val]) => `${k}: ${typeof val === 'string' ? val : JSON.stringify(val)}`).join('\n');
            }
            return '';
          };
          return {
            valueProposition: canvasStr(c.valueProposition),
            customerSegments: canvasStr(c.customerSegments),
            channels: canvasStr(c.channels),
            customerRelationships: canvasStr(c.customerRelationships),
            revenueStreams: canvasStr(c.revenueStreams),
            keyResources: canvasStr(c.keyResources),
            keyActivities: canvasStr(c.keyActivities),
            keyPartnerships: canvasStr(c.keyPartnerships),
            costStructure: canvasStr(c.costStructure),
          };
        })(),
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
          sensitivityAnalysis: safeStr(fin.sensitivityAnalysis),
        },
        risks: safeArr(parsed.risks),
        assumptionsRegister: safeArr(parsed.assumptionsRegister),
        governanceFramework: {
          operatingModel: safeStr(gov.operatingModel),
          reviewCadence: safeStr(gov.reviewCadence),
          kpiFramework: safeArr(gov.kpiFramework),
          escalationPathways: safeStr(gov.escalationPathways),
          decisionRights: safeStr(gov.decisionRights),
        },
        qualityScore: {
          logicalCoherence: safeNum(qs.logicalCoherence, 7),
          comprehensiveness: safeNum(qs.comprehensiveness, 7),
          contextSpecificity: safeNum(qs.contextSpecificity, 7),
          commercialRelevance: safeNum(qs.commercialRelevance, 7),
          actionability: safeNum(qs.actionability, 7),
          financialSensibility: safeNum(qs.financialSensibility, 7),
          operationalFeasibility: safeNum(qs.operationalFeasibility, 7),
          riskIdentification: safeNum(qs.riskIdentification, 7),
          overallGrade: safeStr(qs.overallGrade, 'B'),
          improvementAreas: safeArr(qs.improvementAreas),
        },
        recommendedDocuments: safeArr(parsed.recommendedDocuments),
      };

      return { success: true, model: validated, usage: result.usage };
    } catch (error) {
      this.logger.error(`Business model generation error: ${(error as Error).message}`);
      return { success: false, error: 'An error occurred generating your business model. Please try again.' };
    }
  }

  private getInteractionModeDirective(mode: string): string {
    const modes: Record<string, string> = {
      founder: `INTERACTION MODE: FOUNDER MODE
Focus on shaping ideas and early-stage business design. Emphasize opportunity discovery, concept validation, market-founder fit, and practical first steps. Balance ambition with pragmatism. Make the vision concrete and executable.`,
      executive: `INTERACTION MODE: EXECUTIVE MODE
Condense findings into high-level, decision-grade summaries. Lead with strategic implications and business impact. Use data-driven framing. Focus on ROI, competitive positioning, and resource allocation. Be concise and authoritative.`,
      operator: `INTERACTION MODE: OPERATOR MODE
Turn plans into practical systems and workflows. Emphasize SOPs, process design, staffing logic, vendor management, quality control, and daily operations. Make everything implementable with clear ownership and timelines.`,
      analyst: `INTERACTION MODE: ANALYST MODE
Provide detailed diagnosis, business intelligence, and rigorous evaluation. Use frameworks extensively (Five Forces, Unit Economics, Scenario Analysis). Challenge assumptions. Provide evidence-based reasoning and quantitative analysis.`,
      investor: `INTERACTION MODE: INVESTOR MODE
Frame outputs around business attractiveness, risk, scalability, and quality. Focus on unit economics, market size, defensibility, team capability, and exit potential. Be critical and honest about weaknesses.`,
      compliance: `INTERACTION MODE: COMPLIANCE-AWARE MODE
Highlight regulation, policy, governance, and legal-review areas. Emphasize risk mitigation, regulatory obligations, data protection, employment law, and industry-specific compliance. Flag every area requiring professional legal review.`,
      builder: `INTERACTION MODE: BUILDER MODE
Create comprehensive operational, documentation, and implementation systems. Generate detailed SOPs, process maps, checklists, and review protocols. Focus on building the complete operational infrastructure.`,
    };
    return modes[mode.toLowerCase()] || modes.founder;
  }
}
