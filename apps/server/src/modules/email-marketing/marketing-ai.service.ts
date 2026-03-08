import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiUsageService } from '../ai/ai-usage.service';

@Injectable()
export class MarketingAiService {
  private readonly logger = new Logger(MarketingAiService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  sanitizeAiInput(input: string, maxLen = 500): string {
    let sanitized = input;
    const injectionPatterns = [
      /<\|system\|>/gi,
      /<\|user\|>/gi,
      /<\|assistant\|>/gi,
      /\[INST\]/gi,
      /\[\/INST\]/gi,
      /<<SYS>>/gi,
      /<<\/SYS>>/gi,
      /<\/s>/gi,
      /^Human:/gim,
      /^Assistant:/gim,
      /^System:/gim,
    ];
    for (const pattern of injectionPatterns) {
      sanitized = sanitized.replace(pattern, '');
    }
    sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    return sanitized.slice(0, maxLen);
  }

  private async buildMarketingContext(businessId: string): Promise<string> {
    const [campaigns, forms, contacts] = await Promise.all([
      this.db.emailCampaign.findMany({
        where: { businessId, deletedAt: null },
        select: {
          id: true, name: true, subject: true, status: true,
          totalRecipients: true, sentCount: true, openCount: true, clickCount: true,
          sentAt: true, createdAt: true, segmentFilter: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.db.leadForm.findMany({
        where: { businessId, deletedAt: null },
        select: {
          id: true, name: true, description: true, isActive: true, fields: true,
          createdAt: true,
          _count: { select: { submissions: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      this.db.contact.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, firstName: true, lastName: true, email: true, status: true, tags: true, source: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);

    const parts: string[] = [];

    parts.push(`Email Campaigns (${campaigns.length}):`);
    campaigns.forEach((c) => {
      const openRate = c.sentCount && c.sentCount > 0 ? ((c.openCount ?? 0) / c.sentCount * 100).toFixed(1) : '0';
      const clickRate = c.sentCount && c.sentCount > 0 ? ((c.clickCount ?? 0) / c.sentCount * 100).toFixed(1) : '0';
      parts.push(`  - ${c.name} | ${c.status} | Subject: "${c.subject}" | Recipients: ${c.totalRecipients ?? 0} | Open: ${openRate}% | Click: ${clickRate}% | Sent: ${c.sentAt ? new Date(c.sentAt).toLocaleDateString('en-TT') : 'Not sent'} [ID: ${c.id}]`);
    });

    parts.push(`\nLead Forms (${forms.length}):`);
    forms.forEach((f) => {
      const fieldCount = Array.isArray(f.fields) ? (f.fields as any[]).length : 0;
      parts.push(`  - ${f.name} | ${f.isActive ? 'Active' : 'Inactive'} | Fields: ${fieldCount} | Submissions: ${f._count.submissions} [ID: ${f.id}]`);
    });

    parts.push(`\nContacts (${contacts.length}):`);
    const statusCounts: Record<string, number> = {};
    const sourceCounts: Record<string, number> = {};
    const tagCounts: Record<string, number> = {};
    contacts.forEach((c) => {
      statusCounts[c.status ?? 'UNKNOWN'] = (statusCounts[c.status ?? 'UNKNOWN'] || 0) + 1;
      if (c.source) sourceCounts[c.source] = (sourceCounts[c.source] || 0) + 1;
      if (c.tags && Array.isArray(c.tags)) {
        (c.tags as string[]).forEach((t) => {
          tagCounts[t] = (tagCounts[t] || 0) + 1;
        });
      }
    });
    parts.push(`  Status breakdown: ${JSON.stringify(statusCounts)}`);
    parts.push(`  Source breakdown: ${JSON.stringify(sourceCounts)}`);
    parts.push(`  Top tags: ${Object.entries(tagCounts).sort(([, a], [, b]) => b - a).slice(0, 10).map(([t, c]) => `${t}(${c})`).join(', ') || 'None'}`);

    return parts.join('\n');
  }

  async naturalLanguageSearch(businessId: string, query: string) {
    const start = Date.now();
    const sanitized = this.sanitizeAiInput(query, 500);

    const [campaigns, forms] = await Promise.all([
      this.db.emailCampaign.findMany({
        where: { businessId, deletedAt: null },
        select: {
          id: true, name: true, subject: true, status: true,
          totalRecipients: true, sentCount: true, openCount: true, clickCount: true,
          sentAt: true, createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.db.leadForm.findMany({
        where: { businessId, deletedAt: null },
        select: {
          id: true, name: true, isActive: true, createdAt: true,
          _count: { select: { submissions: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);

    const knownStatuses = [...new Set(campaigns.map(c => c.status))];

    const prompt = `You are a Marketing search translator for a Caribbean service business (TTD currency, Trinidad & Tobago).
Convert a natural language query into structured Marketing filter parameters.

Available data types: campaigns, forms

Campaign filter fields:
- type: "campaigns"
- search: text search across name, subject
- status: campaign status (known: ${knownStatuses.join(', ') || 'DRAFT, SENT, SCHEDULED'})
- dateFrom: ISO date string
- dateTo: ISO date string
- hasRecipients: boolean (only campaigns with recipients)
- sortBy: newest|oldest|openRate|clickRate|recipients

Form filter fields:
- type: "forms"
- search: text search across name, description
- isActive: boolean
- minSubmissions: minimum submission count
- sortBy: newest|oldest|submissions

Respond in valid JSON:
{
  "type": "campaigns|forms",
  "filters": { ... relevant filters only ... },
  "interpretation": "What you understood the user wants",
  "confidence": 0.9
}

Only include filters relevant to the query. Current date: ${new Date().toISOString()}.`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'marketing_nl_search',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: sanitized },
      ],
      maxTokens: 600,
      temperature: 0.2,
    });

    const duration = Date.now() - start;
    if (duration > 1000) this.logger.warn(`Marketing NL search took ${duration}ms`);

    try {
      const parsed = JSON.parse(result.content);
      const resultData = await this.executeNlSearch(businessId, parsed);
      return { ...parsed, results: resultData };
    } catch {
      return { type: 'campaigns', filters: {}, interpretation: result.content, confidence: 0, results: [] };
    }
  }

  private async executeNlSearch(businessId: string, parsed: any) {
    const { type, filters } = parsed;
    if (!filters) return [];

    if (type === 'forms') {
      const where: any = { businessId, deletedAt: null };
      if (filters.search) where.name = { contains: filters.search, mode: 'insensitive' };
      if (filters.isActive !== undefined && filters.isActive !== null) where.isActive = filters.isActive;
      const orderBy: any = {};
      if (filters.sortBy === 'oldest') orderBy.createdAt = 'asc';
      else if (filters.sortBy === 'submissions') orderBy.submissions = { _count: 'desc' };
      else orderBy.createdAt = 'desc';
      const results = await this.db.leadForm.findMany({
        where,
        orderBy: filters.sortBy === 'submissions' ? undefined : orderBy,
        take: 50,
        include: { _count: { select: { submissions: true } } },
      });
      if (filters.minSubmissions) {
        return results.filter((f: any) => f._count.submissions >= Number(filters.minSubmissions));
      }
      return results;
    }

    const where: any = { businessId, deletedAt: null };
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { subject: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    if (filters.status) where.status = filters.status;
    if (filters.dateFrom || filters.dateTo) {
      where.createdAt = {};
      if (filters.dateFrom) where.createdAt.gte = new Date(filters.dateFrom);
      if (filters.dateTo) where.createdAt.lte = new Date(filters.dateTo);
    }
    if (filters.hasRecipients) where.totalRecipients = { gt: 0 };
    const orderBy: any = {};
    if (filters.sortBy === 'oldest') orderBy.createdAt = 'asc';
    else if (filters.sortBy === 'openRate') orderBy.openCount = 'desc';
    else if (filters.sortBy === 'clickRate') orderBy.clickCount = 'desc';
    else if (filters.sortBy === 'recipients') orderBy.totalRecipients = 'desc';
    else orderBy.createdAt = 'desc';

    return this.db.emailCampaign.findMany({
      where,
      orderBy,
      take: 50,
      include: { _count: { select: { recipients: true } } },
    });
  }

  async campaignContentGenerator(businessId: string, query: string) {
    const start = Date.now();
    const sanitized = this.sanitizeAiInput(query, 500);
    const context = await this.buildMarketingContext(businessId);

    const prompt = `You are an email marketing content AI for a Caribbean service business (TTD currency, Trinidad & Tobago).
Generate compelling email campaign content based on the user's request and business context.

Business Context:
${context}

Generate professional email content that resonates with Caribbean audiences.
Consider local culture, language nuances, and business practices common in Trinidad & Tobago.

Respond in valid JSON:
{
  "subject": "Email subject line",
  "previewText": "Preview text for email clients",
  "body": "Full HTML email body content",
  "callToAction": "Primary CTA text",
  "ctaUrl": "Suggested CTA URL path",
  "tone": "professional|friendly|urgent|promotional",
  "targetAudience": "Description of ideal audience for this email",
  "suggestedSegment": { "tags": [], "status": null },
  "alternativeSubjects": ["Subject option 2", "Subject option 3"],
  "sendTimeRecommendation": "Best time to send this email",
  "estimatedEngagement": { "openRate": "15-25%", "clickRate": "3-8%" }
}`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'marketing_campaign_content',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: sanitized },
      ],
      maxTokens: 2000,
      temperature: 0.6,
    });

    const duration = Date.now() - start;
    if (duration > 1000) this.logger.warn(`Campaign content generation took ${duration}ms`);

    try {
      return JSON.parse(result.content);
    } catch {
      return {
        subject: 'Generated Campaign',
        previewText: '',
        body: result.content,
        callToAction: 'Learn More',
        ctaUrl: '/',
        tone: 'professional',
        targetAudience: 'All contacts',
        suggestedSegment: { tags: [], status: null },
        alternativeSubjects: [],
        sendTimeRecommendation: 'Tuesday or Thursday, 10:00 AM AST',
        estimatedEngagement: { openRate: '15-25%', clickRate: '3-8%' },
      };
    }
  }

  async campaignPerformanceAnalyzer(businessId: string, query: string) {
    const start = Date.now();
    const sanitized = this.sanitizeAiInput(query, 500);
    const context = await this.buildMarketingContext(businessId);

    const campaigns = await this.db.emailCampaign.findMany({
      where: { businessId, deletedAt: null, status: 'SENT' },
      select: {
        id: true, name: true, subject: true, sentAt: true,
        totalRecipients: true, sentCount: true, openCount: true, clickCount: true,
      },
      orderBy: { sentAt: 'desc' },
      take: 20,
    });

    const performanceContext = campaigns.map((c) => {
      const openRate = c.sentCount && c.sentCount > 0 ? ((c.openCount ?? 0) / c.sentCount * 100).toFixed(1) : '0';
      const clickRate = c.sentCount && c.sentCount > 0 ? ((c.clickCount ?? 0) / c.sentCount * 100).toFixed(1) : '0';
      return `  - "${c.name}" | Open: ${openRate}% | Click: ${clickRate}% | Recipients: ${c.totalRecipients ?? 0} | Sent: ${c.sentAt ? new Date(c.sentAt).toLocaleDateString('en-TT') : 'N/A'}`;
    }).join('\n');

    const prompt = `You are an email marketing performance analyst for a Caribbean service business (TTD currency, Trinidad & Tobago).
Analyze campaign performance data and provide actionable improvement suggestions.

Business Context:
${context}

Sent Campaign Performance:
${performanceContext || '  No sent campaigns yet'}

User question: "${sanitized}"

Respond in valid JSON:
{
  "summary": "Executive summary of campaign performance",
  "overallMetrics": {
    "averageOpenRate": 22.5,
    "averageClickRate": 5.2,
    "totalCampaignsSent": 10,
    "totalRecipients": 500,
    "bestPerformingCampaign": "Campaign Name",
    "worstPerformingCampaign": "Campaign Name"
  },
  "trends": [
    { "trend": "Open rates improving", "direction": "up|down|stable", "impact": "high|medium|low" }
  ],
  "recommendations": [
    { "title": "Optimize send times", "description": "...", "expectedImpact": "Increase open rate by 5-10%", "priority": "high|medium|low" }
  ],
  "performanceScore": 72,
  "performanceLabel": "good"
}`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'marketing_performance_analysis',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: sanitized },
      ],
      maxTokens: 2000,
      temperature: 0.4,
    });

    const duration = Date.now() - start;
    if (duration > 1000) this.logger.warn(`Campaign performance analysis took ${duration}ms`);

    try {
      return JSON.parse(result.content);
    } catch {
      return {
        summary: result.content,
        overallMetrics: { averageOpenRate: 0, averageClickRate: 0, totalCampaignsSent: campaigns.length, totalRecipients: 0, bestPerformingCampaign: '', worstPerformingCampaign: '' },
        trends: [],
        recommendations: [],
        performanceScore: 50,
        performanceLabel: 'fair',
      };
    }
  }

  async audienceSegmentAdvisor(businessId: string, query: string) {
    const start = Date.now();
    const sanitized = this.sanitizeAiInput(query, 500);
    const context = await this.buildMarketingContext(businessId);

    const contacts = await this.db.contact.findMany({
      where: { businessId, deletedAt: null },
      select: {
        id: true, firstName: true, lastName: true, email: true,
        status: true, tags: true, source: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const contactContext = `Total contacts: ${contacts.length}
Status breakdown: ${JSON.stringify(contacts.reduce((acc: Record<string, number>, c) => { acc[c.status ?? 'UNKNOWN'] = (acc[c.status ?? 'UNKNOWN'] || 0) + 1; return acc; }, {}))}
Source breakdown: ${JSON.stringify(contacts.reduce((acc: Record<string, number>, c) => { if (c.source) acc[c.source] = (acc[c.source] || 0) + 1; return acc; }, {}))}
With email: ${contacts.filter(c => c.email).length}`;

    const prompt = `You are an audience segmentation AI advisor for a Caribbean service business (TTD currency, Trinidad & Tobago).
Analyze CRM contacts and recommend optimal audience segments for email campaigns.

Business Context:
${context}

Contact Data:
${contactContext}

User question: "${sanitized}"

Respond in valid JSON:
{
  "summary": "Overview of audience segmentation opportunities",
  "suggestedSegments": [
    {
      "name": "Segment Name",
      "description": "Who is in this segment",
      "filter": { "tags": [], "status": null, "source": null },
      "estimatedSize": 50,
      "campaignIdeas": ["Welcome series", "Upsell high-value services"],
      "expectedEngagement": "high|medium|low",
      "reasoning": "Why this segment matters"
    }
  ],
  "audienceInsights": [
    { "insight": "30% of contacts have no tags", "action": "Tag contacts for better segmentation", "priority": "high|medium|low" }
  ],
  "recommendations": [
    { "title": "Create win-back segment", "description": "...", "expectedImpact": "Re-engage 20% of dormant contacts" }
  ]
}`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'marketing_audience_advisor',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: sanitized },
      ],
      maxTokens: 2000,
      temperature: 0.4,
    });

    const duration = Date.now() - start;
    if (duration > 1000) this.logger.warn(`Audience segment advisor took ${duration}ms`);

    try {
      return JSON.parse(result.content);
    } catch {
      return {
        summary: result.content,
        suggestedSegments: [],
        audienceInsights: [],
        recommendations: [],
      };
    }
  }

  async subjectLineOptimizer(businessId: string, query: string) {
    const start = Date.now();
    const sanitized = this.sanitizeAiInput(query, 500);

    const sentCampaigns = await this.db.emailCampaign.findMany({
      where: { businessId, deletedAt: null, status: 'SENT' },
      select: {
        subject: true, openCount: true, sentCount: true, clickCount: true,
      },
      orderBy: { sentAt: 'desc' },
      take: 20,
    });

    const subjectPerformance = sentCampaigns.map((c) => {
      const openRate = c.sentCount && c.sentCount > 0 ? ((c.openCount ?? 0) / c.sentCount * 100).toFixed(1) : '0';
      const clickRate = c.sentCount && c.sentCount > 0 ? ((c.clickCount ?? 0) / c.sentCount * 100).toFixed(1) : '0';
      return `  - "${c.subject}" | Open: ${openRate}% | Click: ${clickRate}%`;
    }).join('\n');

    const prompt = `You are an email subject line optimization AI for a Caribbean service business (Trinidad & Tobago).
Generate optimized subject line variations based on historical performance and best practices.

Historical Subject Line Performance:
${subjectPerformance || '  No historical data available'}

User request: "${sanitized}"

Consider Caribbean audience preferences, local language nuances, and email marketing best practices.
Generate subject lines that are compelling, concise (under 60 characters), and avoid spam triggers.

Respond in valid JSON:
{
  "originalAnalysis": "Analysis of the user's request/existing subject line",
  "variations": [
    {
      "subject": "Subject line text",
      "previewText": "Suggested preview text",
      "strategy": "curiosity|urgency|personalization|benefit|question|social_proof",
      "predictedOpenRate": "18-25%",
      "reasoning": "Why this subject line should perform well",
      "characterCount": 45,
      "emojiSuggestion": "Optional emoji placement"
    }
  ],
  "bestPractices": [
    "Keep subject lines under 50 characters for mobile",
    "Use personalization tokens when possible"
  ],
  "avoidList": ["Words or patterns to avoid based on historical data"]
}`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'marketing_subject_optimizer',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: sanitized },
      ],
      maxTokens: 1500,
      temperature: 0.6,
    });

    const duration = Date.now() - start;
    if (duration > 1000) this.logger.warn(`Subject line optimizer took ${duration}ms`);

    try {
      return JSON.parse(result.content);
    } catch {
      return {
        originalAnalysis: result.content,
        variations: [],
        bestPractices: [],
        avoidList: [],
      };
    }
  }

  async leadFormOptimizer(businessId: string, query: string) {
    const start = Date.now();
    const sanitized = this.sanitizeAiInput(query, 500);

    const forms = await this.db.leadForm.findMany({
      where: { businessId, deletedAt: null },
      select: {
        id: true, name: true, description: true, fields: true, isActive: true,
        settings: true, createdAt: true,
        _count: { select: { submissions: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const submissions = await this.db.leadFormSubmission.findMany({
      where: { businessId },
      select: { formId: true, createdAt: true, source: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const submissionsByForm: Record<string, number> = {};
    const submissionsByMonth: Record<string, number> = {};
    submissions.forEach((s) => {
      submissionsByForm[s.formId] = (submissionsByForm[s.formId] || 0) + 1;
      const month = new Date(s.createdAt).toISOString().slice(0, 7);
      submissionsByMonth[month] = (submissionsByMonth[month] || 0) + 1;
    });

    const formContext = forms.map((f) => {
      const fieldCount = Array.isArray(f.fields) ? (f.fields as any[]).length : 0;
      const fieldNames = Array.isArray(f.fields) ? (f.fields as any[]).map((field: any) => field.name || field.label).join(', ') : 'Unknown';
      return `  - "${f.name}" | ${f.isActive ? 'Active' : 'Inactive'} | Fields: ${fieldCount} (${fieldNames}) | Submissions: ${f._count.submissions} [ID: ${f.id}]`;
    }).join('\n');

    const prompt = `You are a lead form conversion optimization AI for a Caribbean service business (Trinidad & Tobago).
Analyze form structure, submission rates, and suggest improvements to increase conversions.

Forms:
${formContext || '  No forms yet'}

Submission Trends: ${JSON.stringify(submissionsByMonth)}

User request: "${sanitized}"

Respond in valid JSON:
{
  "summary": "Overview of form performance and conversion opportunities",
  "formAnalysis": [
    {
      "formId": "...",
      "formName": "...",
      "currentSubmissions": 50,
      "conversionScore": 75,
      "issues": [
        { "issue": "Too many required fields", "severity": "high|medium|low", "suggestion": "Reduce to 3-4 essential fields" }
      ],
      "fieldRecommendations": [
        { "action": "remove|add|modify|reorder", "field": "Company Name", "reason": "Low-value field increasing friction" }
      ]
    }
  ],
  "generalRecommendations": [
    { "title": "Add social proof", "description": "...", "expectedImpact": "Increase submissions by 15-25%", "priority": "high|medium|low" }
  ],
  "submissionTrends": {
    "direction": "up|down|stable",
    "monthlyAverage": 25,
    "bestMonth": "2024-01",
    "insight": "Submissions peak during..."
  }
}`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'marketing_form_optimizer',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: sanitized },
      ],
      maxTokens: 2000,
      temperature: 0.4,
    });

    const duration = Date.now() - start;
    if (duration > 1000) this.logger.warn(`Lead form optimizer took ${duration}ms`);

    try {
      return JSON.parse(result.content);
    } catch {
      return {
        summary: result.content,
        formAnalysis: [],
        generalRecommendations: [],
        submissionTrends: { direction: 'stable', monthlyAverage: 0, bestMonth: '', insight: '' },
      };
    }
  }
}
