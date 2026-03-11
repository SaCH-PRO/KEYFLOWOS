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
        select: { id: true, name: true, price: true, currency: true, category: true, status: true },
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
        select: { id: true, status: true, platforms: true, createdAt: true },
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
      parts.push(`  Active: ${products.filter(p => p.status === 'ACTIVE').length}, Draft: ${products.filter(p => p.status === 'DRAFT').length}`);
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
        if (p.platforms && Array.isArray(p.platforms)) {
          (p.platforms as string[]).forEach((pl) => {
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

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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
