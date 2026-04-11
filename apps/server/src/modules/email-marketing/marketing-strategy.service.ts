import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiUsageService } from '../ai/ai-usage.service';

@Injectable()
export class MarketingStrategyService {
  private readonly logger = new Logger(MarketingStrategyService.name);

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

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async buildMarketingContext(businessId: string): Promise<string> {
    const [business, campaigns, forms, contacts, products, invoices, bookings, socialPosts, services] = await Promise.all([
      this.db.business.findUnique({
        where: { id: businessId },
        select: {
          name: true, tagline: true, description: true, industry: true,
          archetype: true, revenueModel: true, budgetRange: true,
          city: true, country: true, website: true,
          facebook: true, instagram: true, twitter: true, linkedin: true, tiktok: true,
          currency: true,
        },
      }),
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
      this.db.product.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, name: true, price: true, currency: true, category: true, isActive: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.db.invoice.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, status: true, total: true, currency: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.db.booking.findMany({
        where: { businessId },
        select: { id: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.db.socialPost.findMany({
        where: { businessId, deletedAt: null },
        select: { id: true, status: true, channelIds: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.db.service.findMany({
        where: { businessId },
        select: { id: true, name: true, price: true, duration: true },
        take: 30,
      }),
    ]);

    const parts: string[] = [];

    if (business) {
      parts.push(`Business Profile:`);
      parts.push(`  Name: ${business.name}`);
      if (business.tagline) parts.push(`  Tagline: ${business.tagline}`);
      if (business.description) parts.push(`  Description: ${business.description}`);
      if (business.industry) parts.push(`  Industry: ${business.industry}`);
      if (business.archetype) parts.push(`  Business Type: ${business.archetype}`);
      if (business.revenueModel) parts.push(`  Revenue Model: ${business.revenueModel}`);
      if (business.city || business.country) parts.push(`  Location: ${[business.city, business.country].filter(Boolean).join(', ')}`);
      if (business.website) parts.push(`  Website: ${business.website}`);
      parts.push(`  Currency: ${business.currency}`);
      const socials = [
        business.facebook && 'Facebook',
        business.instagram && 'Instagram',
        business.twitter && 'Twitter',
        business.linkedin && 'LinkedIn',
        business.tiktok && 'TikTok',
      ].filter(Boolean);
      if (socials.length) parts.push(`  Social Presence: ${socials.join(', ')}`);
    }

    parts.push(`\nEmail Campaigns (${campaigns.length}):`);
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

    if (products.length > 0) {
      parts.push(`\nProducts/Services Catalog (${products.length}):`);
      const categoryCounts: Record<string, number> = {};
      let totalRevenuePotential = 0;
      products.forEach((p) => {
        categoryCounts[p.category ?? 'Uncategorized'] = (categoryCounts[p.category ?? 'Uncategorized'] || 0) + 1;
        totalRevenuePotential += Number(p.price) || 0;
      });
      parts.push(`  Categories: ${JSON.stringify(categoryCounts)}`);
      parts.push(`  Price range: ${Math.min(...products.map(p => Number(p.price) || 0))} - ${Math.max(...products.map(p => Number(p.price) || 0))} ${products[0]?.currency ?? 'TTD'}`);
      parts.push(`  Active: ${products.filter(p => p.isActive).length}, Inactive: ${products.filter(p => !p.isActive).length}`);
    }

    if (invoices.length > 0) {
      parts.push(`\nInvoice History (${invoices.length}):`);
      const invStatusCounts: Record<string, number> = {};
      let totalRevenue = 0;
      let paidCount = 0;
      invoices.forEach((inv) => {
        invStatusCounts[inv.status] = (invStatusCounts[inv.status] || 0) + 1;
        if (inv.status === 'PAID') {
          totalRevenue += Number(inv.total) || 0;
          paidCount++;
        }
      });
      parts.push(`  Status: ${JSON.stringify(invStatusCounts)}`);
      parts.push(`  Total paid revenue: ${totalRevenue.toFixed(2)} ${invoices[0]?.currency ?? 'TTD'} (${paidCount} invoices)`);
      const avgInvoice = paidCount > 0 ? (totalRevenue / paidCount).toFixed(2) : '0';
      parts.push(`  Average invoice value: ${avgInvoice}`);
    }

    if (bookings.length > 0) {
      parts.push(`\nBookings (${bookings.length}):`);
      const bookingStatusCounts: Record<string, number> = {};
      bookings.forEach((b) => {
        bookingStatusCounts[b.status] = (bookingStatusCounts[b.status] || 0) + 1;
      });
      parts.push(`  Status: ${JSON.stringify(bookingStatusCounts)}`);
    }

    if (services.length > 0) {
      const svcCurrency = business?.currency ?? 'TTD';
      parts.push(`\nService Offerings (${services.length}):`);
      services.forEach((s) => {
        parts.push(`  - ${s.name} | ${s.price ? `${svcCurrency} ${s.price}` : 'No price'} | ${s.duration ? `${s.duration} min` : 'No duration'}`);
      });
    }

    if (socialPosts.length > 0) {
      parts.push(`\nSocial Posts (${socialPosts.length}):`);
      const postStatusCounts: Record<string, number> = {};
      const platformCounts: Record<string, number> = {};
      socialPosts.forEach((p) => {
        postStatusCounts[p.status] = (postStatusCounts[p.status] || 0) + 1;
        if (p.channelIds && Array.isArray(p.channelIds)) {
          (p.channelIds as string[]).forEach((pl) => {
            platformCounts[pl] = (platformCounts[pl] || 0) + 1;
          });
        }
      });
      parts.push(`  Post statuses: ${JSON.stringify(postStatusCounts)}`);
      if (Object.keys(platformCounts).length) parts.push(`  Platforms used: ${JSON.stringify(platformCounts)}`);
    }

    return parts.join('\n');
  }

  async getBusinessSnapshot(businessId: string) {
    const [business, contactCount, productCount, invoiceStats, bookingCount, campaignCount, serviceCount] = await Promise.all([
      this.db.business.findUnique({
        where: { id: businessId },
        select: {
          name: true, tagline: true, description: true, industry: true,
          archetype: true, revenueModel: true, budgetRange: true,
          city: true, country: true, website: true, currency: true,
          facebook: true, instagram: true, twitter: true, linkedin: true, tiktok: true,
        },
      }),
      this.db.contact.count({ where: { businessId, deletedAt: null } }),
      this.db.product.count({ where: { businessId, deletedAt: null } }),
      this.db.invoice.aggregate({
        where: { businessId, deletedAt: null, status: 'PAID' },
        _sum: { total: true },
        _count: true,
      }),
      this.db.booking.count({ where: { businessId } }),
      this.db.emailCampaign.count({ where: { businessId, deletedAt: null } }),
      this.db.service.count({ where: { businessId } }),
    ]);

    const socials: string[] = [];
    if (business?.facebook) socials.push('Facebook');
    if (business?.instagram) socials.push('Instagram');
    if (business?.twitter) socials.push('Twitter');
    if (business?.linkedin) socials.push('LinkedIn');
    if (business?.tiktok) socials.push('TikTok');

    return {
      businessName: business?.name ?? '',
      tagline: business?.tagline ?? '',
      description: business?.description ?? '',
      industry: business?.industry ?? '',
      archetype: business?.archetype ?? '',
      revenueModel: business?.revenueModel ?? '',
      budgetRange: business?.budgetRange ?? '',
      location: [business?.city, business?.country].filter(Boolean).join(', '),
      website: business?.website ?? '',
      currency: business?.currency ?? 'TTD',
      socialPresence: socials,
      totalContacts: contactCount,
      totalProducts: productCount,
      totalRevenue: Number(invoiceStats._sum?.total ?? 0),
      paidInvoices: invoiceStats._count,
      totalBookings: bookingCount,
      totalCampaigns: campaignCount,
      totalServices: serviceCount,
    };
  }

  async submitMarketingBrief(businessId: string, brief: Record<string, unknown>) {
    const business = await this.db.business.findUnique({
      where: { id: businessId },
      select: { name: true, gmailEmail: true, gmailAccessToken: true, gmailRefreshToken: true },
    });

    const snapshot = await this.getBusinessSnapshot(businessId);

    const briefFields: [string, unknown][] = Object.entries(brief).filter(([, v]) => v !== '' && v !== null && v !== undefined);

    const rows = briefFields.map(([key, value]) => {
      const label = this.escapeHtml(key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim());
      const rawVal = Array.isArray(value) ? value.join(', ') : String(value);
      const val = this.escapeHtml(rawVal);
      return `<tr><td style="padding:8px 12px;border:1px solid #333;color:#aaa;font-weight:600;white-space:nowrap;vertical-align:top;">${label}</td><td style="padding:8px 12px;border:1px solid #333;">${val}</td></tr>`;
    }).join('\n');

    const snapshotRows = [
      ['Business Name', snapshot.businessName],
      ['Tagline', snapshot.tagline],
      ['Industry', snapshot.industry],
      ['Business Type', snapshot.archetype],
      ['Revenue Model', snapshot.revenueModel],
      ['Location', snapshot.location],
      ['Website', snapshot.website],
      ['Currency', snapshot.currency],
      ['Social Presence', snapshot.socialPresence.join(', ') || 'None'],
      ['Total Contacts', snapshot.totalContacts],
      ['Total Products', snapshot.totalProducts],
      ['Total Revenue', `${snapshot.totalRevenue.toFixed(2)} ${snapshot.currency}`],
      ['Paid Invoices', snapshot.paidInvoices],
      ['Total Bookings', snapshot.totalBookings],
      ['Total Campaigns', snapshot.totalCampaigns],
      ['Total Services', snapshot.totalServices],
    ].map(([label, val]) => `<tr><td style="padding:8px 12px;border:1px solid #333;color:#aaa;font-weight:600;white-space:nowrap;vertical-align:top;">${label}</td><td style="padding:8px 12px;border:1px solid #333;">${val}</td></tr>`).join('\n');

    const htmlBody = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;background:#111;color:#eee;padding:24px;">
  <div style="max-width:700px;margin:0 auto;background:#1a1a1a;border-radius:12px;padding:32px;border:1px solid #333;">
    <h1 style="color:#F97316;margin:0 0 4px;">Marketing Brief Submission</h1>
    <p style="color:#888;margin:0 0 24px;">From: <strong>${snapshot.businessName || 'Unknown Business'}</strong></p>

    <h2 style="color:#14B8A6;font-size:16px;margin:24px 0 8px;">Business Snapshot (Auto-Collected)</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      ${snapshotRows}
    </table>

    <h2 style="color:#F97316;font-size:16px;margin:24px 0 8px;">Marketing Brief Details</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      ${rows}
    </table>

    <p style="color:#666;font-size:12px;margin-top:24px;border-top:1px solid #333;padding-top:12px;">
      Submitted via KEYFLOWOS on ${new Date().toLocaleDateString('en-TT', { dateStyle: 'full' })} at ${new Date().toLocaleTimeString('en-TT')}
    </p>
  </div>
</body>
</html>`;

    const subject = `Marketing Brief: ${snapshot.businessName || 'New Submission'} — ${new Date().toLocaleDateString('en-TT')}`;
    const targetEmail = 'keyflowos.tt@gmail.com';

    if (business?.gmailAccessToken) {
      try {
        const { GmailService } = await import('../commerce/gmail.service');
        const gmailService = new GmailService(this.prisma);
        await gmailService.sendEmail({
          businessId,
          to: targetEmail,
          subject,
          htmlBody,
        });
        this.logger.log(`Marketing brief emailed for business ${businessId}`);
        return { success: true, method: 'gmail', message: 'Marketing brief sent successfully via Gmail' };
      } catch (err) {
        this.logger.warn(`Gmail send failed for marketing brief: ${err}`);
      }
    }

    this.logger.warn(`Marketing brief could not be emailed for business ${businessId} (Gmail not connected or send failed)`);
    return {
      success: false,
      method: 'pending',
      message: 'Gmail is not connected. Please connect Gmail in Settings to send your marketing brief to our team.',
    };
  }

  async generateMarketingStrategy(businessId: string, metrics: {
    industry: string;
    monthlyRevenue?: string;
    targetAudience?: string;
    currentChannels?: string[];
    budget?: string;
    goals?: string[];
    competitiveLandscape?: string;
    businessStage?: string;
  }) {
    const start = Date.now();
    const context = await this.buildMarketingContext(businessId);

    const metricsContext = [
      `Industry: ${this.sanitizeAiInput(metrics.industry, 200)}`,
      metrics.monthlyRevenue ? `Monthly Revenue: ${this.sanitizeAiInput(metrics.monthlyRevenue, 100)}` : null,
      metrics.targetAudience ? `Target Audience: ${this.sanitizeAiInput(metrics.targetAudience, 300)}` : null,
      metrics.currentChannels?.length ? `Current Channels: ${metrics.currentChannels.map(c => this.sanitizeAiInput(c, 50)).join(', ')}` : null,
      metrics.budget ? `Marketing Budget: ${this.sanitizeAiInput(metrics.budget, 100)}` : null,
      metrics.goals?.length ? `Goals: ${metrics.goals.map(g => this.sanitizeAiInput(g, 100)).join(', ')}` : null,
      metrics.competitiveLandscape ? `Competitive Landscape: ${this.sanitizeAiInput(metrics.competitiveLandscape, 300)}` : null,
      metrics.businessStage ? `Business Stage: ${this.sanitizeAiInput(metrics.businessStage, 100)}` : null,
    ].filter(Boolean).join('\n');

    const prompt = `You are a senior marketing strategist AI for a Caribbean service business (TTD currency, Trinidad & Tobago).
Generate a comprehensive, actionable marketing strategy based on the business metrics and existing marketing data provided.

Business Metrics:
${metricsContext}

Existing Marketing Data:
${context}

Create a detailed marketing strategy covering short-term quick wins and long-term growth initiatives.
Consider Caribbean market dynamics, local consumer behavior, and regional business practices.
Be specific with numbers, timelines, and actionable steps.

Respond in valid JSON:
{
  "executiveSummary": "2-3 sentence overview of the recommended strategy",
  "shortTermPlan": {
    "timeframe": "0-3 months",
    "actions": [
      {
        "title": "Action title",
        "description": "Detailed description of what to do",
        "timeline": "Week 1-2",
        "expectedOutcome": "What result to expect",
        "priority": "high|medium|low",
        "estimatedCost": "TTD amount or Free"
      }
    ]
  },
  "longTermPlan": {
    "timeframe": "3-12 months",
    "actions": [
      {
        "title": "Action title",
        "description": "Detailed description",
        "timeline": "Month 3-6",
        "expectedOutcome": "Expected result",
        "priority": "high|medium|low",
        "estimatedCost": "TTD amount range"
      }
    ]
  },
  "channelStrategy": [
    {
      "channel": "Channel name",
      "priority": "primary|secondary|experimental",
      "currentStatus": "active|inactive|underutilized",
      "recommendations": ["Specific recommendation 1", "Specific recommendation 2"],
      "expectedROI": "Expected return description",
      "budgetAllocation": "Percentage of total budget"
    }
  ],
  "budgetModel": {
    "totalRecommendedBudget": "TTD amount per month",
    "allocation": [
      { "category": "Category name", "percentage": 30, "amount": "TTD amount", "justification": "Why this allocation" }
    ],
    "expectedROI": "Overall expected return on marketing investment",
    "breakEvenTimeline": "When to expect positive ROI"
  },
  "kpiTargets": [
    {
      "metric": "KPI name",
      "currentValue": "Current value or N/A",
      "target30Days": "30-day target",
      "target90Days": "90-day target",
      "target12Months": "12-month target",
      "measurementMethod": "How to track this"
    }
  ],
  "financialProjections": {
    "month1": { "investment": "TTD", "expectedRevenue": "TTD", "netImpact": "TTD" },
    "month3": { "investment": "TTD", "expectedRevenue": "TTD", "netImpact": "TTD" },
    "month6": { "investment": "TTD", "expectedRevenue": "TTD", "netImpact": "TTD" },
    "month12": { "investment": "TTD", "expectedRevenue": "TTD", "netImpact": "TTD" }
  },
  "competitiveAdvantages": [
    { "advantage": "What sets you apart", "howToLeverage": "How to use this in marketing" }
  ],
  "risks": [
    { "risk": "Potential risk", "mitigation": "How to mitigate", "likelihood": "high|medium|low" }
  ]
}`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'marketing_strategy_generation',
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: `Generate a comprehensive marketing strategy for my ${this.sanitizeAiInput(metrics.industry, 100)} business.` },
      ],
      maxTokens: 4000,
      temperature: 0.5,
      outputCategory: 'documents',
    });

    const duration = Date.now() - start;
    if (duration > 2000) this.logger.warn(`Marketing strategy generation took ${duration}ms`);

    try {
      return JSON.parse(result.content);
    } catch {
      return {
        executiveSummary: result.content,
        shortTermPlan: { timeframe: '0-3 months', actions: [] },
        longTermPlan: { timeframe: '3-12 months', actions: [] },
        channelStrategy: [],
        budgetModel: { totalRecommendedBudget: 'N/A', allocation: [], expectedROI: 'N/A', breakEvenTimeline: 'N/A' },
        kpiTargets: [],
        financialProjections: {
          month1: { investment: 'N/A', expectedRevenue: 'N/A', netImpact: 'N/A' },
          month3: { investment: 'N/A', expectedRevenue: 'N/A', netImpact: 'N/A' },
          month6: { investment: 'N/A', expectedRevenue: 'N/A', netImpact: 'N/A' },
          month12: { investment: 'N/A', expectedRevenue: 'N/A', netImpact: 'N/A' },
        },
        competitiveAdvantages: [],
        risks: [],
      };
    }
  }
}
