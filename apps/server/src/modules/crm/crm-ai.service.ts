import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiUsageService } from '../ai/ai-usage.service';

type SuggestedAction = {
  type: 'follow_up' | 'call' | 'email' | 'send_quote' | 'payment_reminder' | 'check_in' | 'upsell' | 're_engage';
  contactId?: string;
  contactName?: string;
  title: string;
  description: string;
  priority: 'urgent' | 'high' | 'medium' | 'low';
};

type AutomatedTask = {
  contactId: string;
  contactName?: string;
  title: string;
  dueDate: string;
  priority: 'HIGH' | 'NORMAL' | 'LOW';
};

type AiAnalysisResult = {
  analysis: string;
  suggestedActions: SuggestedAction[];
  guidelines: string[];
  automatedTasks: AutomatedTask[];
};

@Injectable()
export class CrmAiService {
  private readonly logger = new Logger(CrmAiService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  async analyzeContacts(
    businessId: string,
    prompt: string,
    contactIds?: string[],
  ): Promise<AiAnalysisResult> {
    const context = await this.buildCrmContext(businessId, contactIds);

    const systemPrompt = `You are an expert CRM analyst and business advisor for a Caribbean service business (Trinidad & Tobago, TTD currency).
You analyze customer relationship data and provide actionable business intelligence.

CURRENT CRM DATA:
${context}

INSTRUCTIONS:
- Analyze the data based on the user's request
- Provide concrete, specific, actionable suggestions
- Reference actual contact names and data points
- Prioritize revenue-generating and retention actions
- Consider Caribbean business culture and TTD currency
- Be direct and practical, not theoretical

Respond in valid JSON with this exact structure:
{
  "analysis": "Detailed analysis paragraph(s) addressing the user's question",
  "suggestedActions": [
    {
      "type": "follow_up|call|email|send_quote|payment_reminder|check_in|upsell|re_engage",
      "contactId": "contact ID if applicable",
      "contactName": "contact name",
      "title": "Short action title",
      "description": "What to do and why",
      "priority": "urgent|high|medium|low"
    }
  ],
  "guidelines": [
    "Operational guideline or best practice based on the data"
  ],
  "automatedTasks": [
    {
      "contactId": "contact ID",
      "contactName": "contact name",
      "title": "Task title",
      "dueDate": "ISO date string",
      "priority": "HIGH|NORMAL|LOW"
    }
  ]
}`;

    try {
      const result = await this.aiUsage.callAi({
        businessId,
        feature: 'crm_analysis',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        maxTokens: 2000,
        temperature: 0.4,
      });

      const parsed = this.parseJsonResponse(result.content);
      return parsed;
    } catch (error) {
      this.logger.error('AI analysis failed', error);
      return {
        analysis: 'Unable to complete analysis at this time. Please try again.',
        suggestedActions: [],
        guidelines: [],
        automatedTasks: [],
      };
    }
  }

  async executeTasks(
    businessId: string,
    userId: string,
    tasks: AutomatedTask[],
  ): Promise<{ created: number; failed: number }> {
    let created = 0;
    let failed = 0;

    for (const task of tasks) {
      try {
        const contactExists = await this.db.contact.findFirst({
          where: { id: task.contactId, businessId, deletedAt: null },
          select: { id: true },
        });

        if (!contactExists) {
          failed++;
          continue;
        }

        await this.db.contactTask.create({
          data: {
            businessId,
            contactId: task.contactId,
            assigneeId: userId,
            title: task.title,
            dueDate: new Date(task.dueDate),
            priority: task.priority,
            status: 'OPEN',
            source: 'ai_generated',
          },
        });
        created++;
      } catch (err) {
        this.logger.warn(`Failed to create task for contact ${task.contactId}`, err);
        failed++;
      }
    }

    return { created, failed };
  }

  async getGuidelines(businessId: string): Promise<{ guidelines: string[]; generatedAt: string | null }> {
    const business = await this.db.business.findUnique({
      where: { id: businessId },
      select: { metaData: true },
    });

    const meta = (business?.metaData as Record<string, unknown>) ?? {};
    const aiGuidelines = meta.aiGuidelines as { guidelines: string[]; generatedAt: string } | undefined;

    return {
      guidelines: aiGuidelines?.guidelines ?? [],
      generatedAt: aiGuidelines?.generatedAt ?? null,
    };
  }

  async saveGuidelines(businessId: string, guidelines: string[]): Promise<void> {
    const business = await this.db.business.findUnique({
      where: { id: businessId },
      select: { metaData: true },
    });

    const existing = (business?.metaData as Record<string, unknown>) ?? {};

    await this.db.business.update({
      where: { id: businessId },
      data: {
        metaData: {
          ...existing,
          aiGuidelines: {
            guidelines,
            generatedAt: new Date().toISOString(),
          },
        },
      },
    });
  }

  private async buildCrmContext(businessId: string, contactIds?: string[]): Promise<string> {
    const where: Record<string, unknown> = { businessId, deletedAt: null };
    if (contactIds?.length) {
      where.id = { in: contactIds };
    }

    const [contacts, statusCounts, recentEvents, tasks, invoiceSummary] = await Promise.all([
      this.db.contact.findMany({
        where: where as any,
        take: 200,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          status: true,
          source: true,
          tags: true,
          companyName: true,
          leadScore: true,
          lifecycleStage: true,
          lastInteractionAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.db.contact.groupBy({
        by: ['status'],
        where: { businessId, deletedAt: null },
        _count: true,
      }),
      this.db.contactEvent.findMany({
        where: { contact: { businessId, deletedAt: null } },
        take: 50,
        orderBy: { createdAt: 'desc' },
        select: {
          type: true,
          createdAt: true,
          contact: { select: { firstName: true, lastName: true, id: true } },
        },
      }),
      this.db.contactTask.findMany({
        where: { businessId, deletedAt: null, status: 'OPEN' },
        take: 50,
        orderBy: { dueDate: 'asc' },
        select: {
          title: true,
          dueDate: true,
          priority: true,
          contact: { select: { firstName: true, lastName: true, id: true } },
        },
      }),
      this.db.invoice.aggregate({
        where: { businessId },
        _sum: { total: true },
        _count: true,
      }),
    ]);

    const totalContacts = contacts.length;
    const statusSummary = statusCounts.map(s => `${s.status}: ${s._count}`).join(', ');

    const tagMap = new Map<string, number>();
    contacts.forEach(c => {
      (c.tags ?? []).forEach(t => tagMap.set(t, (tagMap.get(t) ?? 0) + 1));
    });
    const topTags = [...tagMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => `${tag} (${count})`)
      .join(', ');

    const now = new Date();
    const staleContacts = contacts.filter(c => {
      const lastActivity = c.lastInteractionAt || c.updatedAt;
      return lastActivity && (now.getTime() - new Date(lastActivity).getTime()) > 30 * 24 * 60 * 60 * 1000;
    });

    const overdueTasks = tasks.filter(t => t.dueDate && new Date(t.dueDate) < now);

    const contactSummaries = contacts.slice(0, 50).map(c => {
      const name = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || 'Unnamed';
      const daysSinceActivity = c.lastInteractionAt
        ? Math.floor((now.getTime() - new Date(c.lastInteractionAt).getTime()) / (24 * 60 * 60 * 1000))
        : null;
      return `- ${name} (ID: ${c.id}) | Status: ${c.status} | Score: ${c.leadScore ?? 'N/A'} | Company: ${c.companyName ?? 'N/A'} | Tags: ${(c.tags ?? []).join(', ') || 'none'} | Last active: ${daysSinceActivity != null ? `${daysSinceActivity}d ago` : 'unknown'} | Source: ${c.source ?? 'manual'}`;
    }).join('\n');

    return `OVERVIEW:
Total contacts: ${totalContacts}
Status breakdown: ${statusSummary}
Top tags: ${topTags || 'none'}
Stale contacts (30+ days inactive): ${staleContacts.length}
Open tasks: ${tasks.length} (${overdueTasks.length} overdue)
Total invoices: ${invoiceSummary._count} | Total revenue: TTD ${invoiceSummary._sum?.total?.toFixed(2) ?? '0.00'}

CONTACTS:
${contactSummaries}

RECENT ACTIVITY (last 50 events):
${recentEvents.slice(0, 20).map(e => `- ${e.type} for ${e.contact.firstName ?? ''} ${e.contact.lastName ?? ''} at ${e.createdAt.toISOString()}`).join('\n')}

OPEN TASKS:
${tasks.slice(0, 20).map(t => `- "${t.title}" for ${t.contact.firstName ?? ''} ${t.contact.lastName ?? ''} | Due: ${t.dueDate?.toISOString() ?? 'no date'} | Priority: ${t.priority}`).join('\n')}`;
  }

  async summarizeContact(businessId: string, contactId: string) {
    const contact = await this.db.contact.findFirst({
      where: { id: contactId, businessId, deletedAt: null },
      select: {
        id: true, firstName: true, lastName: true, email: true, phone: true,
        status: true, source: true, tags: true, companyName: true, jobTitle: true,
        industry: true, leadScore: true, lifecycleStage: true, segment: true,
        lastInteractionAt: true, createdAt: true, city: true, country: true,
        preferredChannel: true, whatsappNumber: true,
      },
    });
    if (!contact) throw new Error('Contact not found');

    const [notes, events, invoices, tasks, bookings] = await Promise.all([
      this.db.contactNote.findMany({
        where: { contactId, businessId },
        take: 20,
        orderBy: { createdAt: 'desc' },
        select: { body: true, createdAt: true, source: true },
      }),
      this.db.contactEvent.findMany({
        where: { contactId },
        take: 30,
        orderBy: { createdAt: 'desc' },
        select: { type: true, createdAt: true, data: true },
      }),
      this.db.invoice.findMany({
        where: { contactId, businessId },
        take: 20,
        orderBy: { createdAt: 'desc' },
        select: { total: true, status: true, createdAt: true, dueDate: true },
      }),
      this.db.contactTask.findMany({
        where: { contactId, businessId, deletedAt: null },
        take: 15,
        orderBy: { createdAt: 'desc' },
        select: { title: true, status: true, priority: true, dueDate: true },
      }),
      this.db.booking.findMany({
        where: { contactId, businessId },
        take: 10,
        orderBy: { startTime: 'desc' },
        select: { startTime: true, status: true },
      }),
    ]);

    const name = `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || 'Unnamed';
    const now = new Date();
    const daysSinceCreated = Math.floor((now.getTime() - new Date(contact.createdAt).getTime()) / 86400000);
    const daysSinceLastInteraction = contact.lastInteractionAt
      ? Math.floor((now.getTime() - new Date(contact.lastInteractionAt).getTime()) / 86400000)
      : null;

    const totalRevenue = invoices.filter(i => i.status === 'PAID').reduce((s, i) => s + Number(i.total ?? 0), 0);
    const outstandingBalance = invoices.filter(i => ['SENT', 'OVERDUE'].includes(i.status)).reduce((s, i) => s + Number(i.total ?? 0), 0);

    const contextBlock = `CONTACT PROFILE:
Name: ${name} | Email: ${contact.email ?? 'N/A'} | Phone: ${contact.phone ?? 'N/A'}
Company: ${contact.companyName ?? 'N/A'} | Job Title: ${contact.jobTitle ?? 'N/A'} | Industry: ${contact.industry ?? 'N/A'}
Status: ${contact.status} | Lifecycle: ${contact.lifecycleStage ?? 'N/A'} | Lead Score: ${contact.leadScore ?? 'N/A'}
Location: ${[contact.city, contact.country].filter(Boolean).join(', ') || 'N/A'}
Source: ${contact.source ?? 'manual'} | Tags: ${(contact.tags ?? []).join(', ') || 'none'}
Preferred Channel: ${contact.preferredChannel ?? 'N/A'} | WhatsApp: ${contact.whatsappNumber ?? 'N/A'}
Created: ${daysSinceCreated} days ago | Last Interaction: ${daysSinceLastInteraction != null ? `${daysSinceLastInteraction} days ago` : 'never'}

FINANCIAL:
Total Revenue: TTD ${totalRevenue.toFixed(2)} | Outstanding: TTD ${outstandingBalance.toFixed(2)}
Invoices: ${invoices.length} total (${invoices.filter(i => i.status === 'PAID').length} paid, ${invoices.filter(i => i.status === 'OVERDUE').length} overdue)
Bookings: ${bookings.length} total (${bookings.filter(b => b.status === 'COMPLETED').length} completed)

NOTES (recent ${notes.length}):
${notes.slice(0, 10).map(n => `- [${n.source ?? 'general'}] ${n.body.substring(0, 200)}`).join('\n') || 'No notes'}

RECENT EVENTS (${events.length}):
${events.slice(0, 15).map(e => `- ${e.type} at ${e.createdAt.toISOString().split('T')[0]}`).join('\n') || 'No events'}

OPEN TASKS:
${tasks.filter(t => t.status === 'OPEN').map(t => `- ${t.title} (${t.priority ?? 'NORMAL'}, due: ${t.dueDate?.toISOString().split('T')[0] ?? 'no date'})`).join('\n') || 'None'}`;

    const systemPrompt = `You are a CRM intelligence assistant for a Caribbean service business (Trinidad & Tobago, TTD currency).
Generate a concise, actionable briefing about this contact. Be specific — reference actual data points.

${contextBlock}

Respond in valid JSON:
{
  "summary": "2-3 sentence overview of who this person is, their relationship with the business, and current status",
  "sentiment": "positive|neutral|negative|at_risk",
  "keyInsights": ["insight1", "insight2", "insight3"],
  "recommendedAction": "The single most important next step",
  "relationshipHealth": "strong|good|neutral|weak|critical",
  "revenueImpact": "high|medium|low"
}`;

    try {
      const result = await this.aiUsage.callAi({
        businessId,
        feature: 'contact_summary',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Generate a comprehensive briefing for ${name}.` },
        ],
        maxTokens: 600,
        temperature: 0.3,
      });
      const parsed = this.parseJson(result.content);
      return {
        summary: parsed.summary ?? '',
        sentiment: parsed.sentiment ?? 'neutral',
        keyInsights: Array.isArray(parsed.keyInsights) ? parsed.keyInsights : [],
        recommendedAction: parsed.recommendedAction ?? '',
        relationshipHealth: parsed.relationshipHealth ?? 'neutral',
        revenueImpact: parsed.revenueImpact ?? 'low',
        creditsUsed: result.usage?.creditsUsed ?? 1,
      };
    } catch (error) {
      this.logger.error('Contact summary failed', error);
      throw error;
    }
  }

  async scoreContactWithAi(businessId: string, contactId: string) {
    const contact = await this.db.contact.findFirst({
      where: { id: contactId, businessId, deletedAt: null },
      select: {
        id: true, firstName: true, lastName: true, email: true, phone: true,
        status: true, tags: true, companyName: true, leadScore: true,
        lifecycleStage: true, lastInteractionAt: true, createdAt: true,
        source: true, industry: true,
      },
    });
    if (!contact) throw new Error('Contact not found');

    const [notes, events, invoices, tasks, bookings] = await Promise.all([
      this.db.contactNote.findMany({
        where: { contactId, businessId },
        take: 15,
        orderBy: { createdAt: 'desc' },
        select: { body: true, createdAt: true },
      }),
      this.db.contactEvent.findMany({
        where: { contactId },
        take: 30,
        orderBy: { createdAt: 'desc' },
        select: { type: true, createdAt: true },
      }),
      this.db.invoice.findMany({
        where: { contactId, businessId },
        select: { total: true, status: true, createdAt: true },
      }),
      this.db.contactTask.findMany({
        where: { contactId, businessId, deletedAt: null },
        select: { status: true, priority: true, dueDate: true },
      }),
      this.db.booking.findMany({
        where: { contactId, businessId },
        select: { status: true, startTime: true },
      }),
    ]);

    const name = `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || 'Unnamed';
    const now = new Date();
    const daysSinceLastInteraction = contact.lastInteractionAt
      ? Math.floor((now.getTime() - new Date(contact.lastInteractionAt).getTime()) / 86400000)
      : null;
    const totalRevenue = invoices.filter(i => i.status === 'PAID').reduce((s, i) => s + Number(i.total ?? 0), 0);
    const recentEvents30d = events.filter(e => (now.getTime() - new Date(e.createdAt).getTime()) < 30 * 86400000).length;

    const contextBlock = `CONTACT: ${name}
Status: ${contact.status} | Current Lead Score: ${contact.leadScore ?? 'N/A'} | Lifecycle: ${contact.lifecycleStage ?? 'N/A'}
Company: ${contact.companyName ?? 'N/A'} | Industry: ${contact.industry ?? 'N/A'} | Source: ${contact.source ?? 'manual'}
Tags: ${(contact.tags ?? []).join(', ') || 'none'}
Last Interaction: ${daysSinceLastInteraction != null ? `${daysSinceLastInteraction} days ago` : 'never'}
Contact Age: ${Math.floor((now.getTime() - new Date(contact.createdAt).getTime()) / 86400000)} days

ENGAGEMENT:
Events in last 30 days: ${recentEvents30d} | Total events: ${events.length}
Event types: ${[...new Set(events.map(e => e.type))].join(', ') || 'none'}

FINANCIAL:
Total Revenue: TTD ${totalRevenue.toFixed(2)}
Invoices: ${invoices.length} (${invoices.filter(i => i.status === 'PAID').length} paid, ${invoices.filter(i => i.status === 'OVERDUE').length} overdue)
Bookings: ${bookings.length} (${bookings.filter(b => b.status === 'COMPLETED').length} completed)

TASKS:
Open: ${tasks.filter(t => t.status === 'OPEN').length} | Overdue: ${tasks.filter(t => t.status === 'OPEN' && t.dueDate && new Date(t.dueDate) < now).length}

NOTES (sentiment context):
${notes.slice(0, 8).map(n => `- ${n.body.substring(0, 150)}`).join('\n') || 'No notes'}`;

    const systemPrompt = `You are a lead scoring AI for a Caribbean service business (TTD currency).
Analyze this contact and provide an intelligent lead score (0-100) with detailed reasoning.

${contextBlock}

Scoring guidelines:
- 80-100: Hot — active engagement, revenue history, positive sentiment
- 60-79: Warm — regular interaction, some revenue, good potential
- 40-59: Neutral — moderate engagement, no red flags
- 20-39: Cool — declining engagement, no recent revenue
- 0-19: Cold — no engagement, negative signals

Respond in valid JSON:
{
  "score": 75,
  "label": "Hot|Warm|Neutral|Cool|Cold",
  "reasoning": "2-3 sentence explanation referencing actual data points",
  "factors": [
    {"name": "Engagement Frequency", "impact": "positive|neutral|negative", "detail": "brief explanation"},
    {"name": "Revenue History", "impact": "positive|neutral|negative", "detail": "brief explanation"},
    {"name": "Note Sentiment", "impact": "positive|neutral|negative", "detail": "brief explanation"},
    {"name": "Responsiveness", "impact": "positive|neutral|negative", "detail": "brief explanation"}
  ],
  "recommendation": "One specific action to improve or maintain this score"
}`;

    try {
      const result = await this.aiUsage.callAi({
        businessId,
        feature: 'ai_lead_score',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Score this lead: ${name}` },
        ],
        maxTokens: 600,
        temperature: 0.3,
      });
      const parsed = this.parseJson(result.content);
      const score = Math.max(0, Math.min(100, Number(parsed.score) || 50));

      await this.db.contact.updateMany({
        where: { id: contactId, businessId },
        data: { leadScore: score },
      }).catch(() => {});

      return {
        score,
        label: parsed.label ?? (score >= 80 ? 'Hot' : score >= 60 ? 'Warm' : score >= 40 ? 'Neutral' : score >= 20 ? 'Cool' : 'Cold'),
        reasoning: parsed.reasoning ?? '',
        factors: Array.isArray(parsed.factors) ? parsed.factors : [],
        recommendation: parsed.recommendation ?? '',
        creditsUsed: result.usage?.creditsUsed ?? 1,
      };
    } catch (error) {
      this.logger.error('AI lead scoring failed', error);
      throw error;
    }
  }

  async analyzeNote(businessId: string, contactId: string, noteBody: string, noteId?: string) {
    const contact = await this.db.contact.findFirst({
      where: { id: contactId, businessId, deletedAt: null },
      select: {
        id: true, firstName: true, lastName: true, status: true,
        companyName: true, tags: true, leadScore: true,
      },
    });
    if (!contact) throw new Error('Contact not found');

    const recentNotes = await this.db.contactNote.findMany({
      where: { contactId, businessId },
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: { body: true, createdAt: true },
    });

    const name = `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || 'Unnamed';

    const systemPrompt = `You are a CRM note intelligence assistant for a Caribbean service business (Trinidad & Tobago, TTD currency).
Analyze this note about a contact and extract actionable intelligence.

CONTACT: ${name} | Status: ${contact.status} | Company: ${contact.companyName ?? 'N/A'} | Score: ${contact.leadScore ?? 'N/A'}
Tags: ${(contact.tags ?? []).join(', ') || 'none'}

PREVIOUS NOTES (for context):
${recentNotes.slice(0, 3).map(n => `- ${n.body.substring(0, 200)}`).join('\n') || 'No previous notes'}

NEW NOTE TO ANALYZE:
"${noteBody}"

Respond in valid JSON:
{
  "sentiment": "positive|neutral|negative|urgent",
  "sentimentConfidence": 0.85,
  "actionItems": [
    {"title": "Task to create", "priority": "HIGH|NORMAL|LOW", "dueInDays": 3}
  ],
  "suggestedTags": ["tag1", "tag2"],
  "riskFlags": ["Any concerns or red flags detected"],
  "keyEntities": ["Names, companies, amounts, dates mentioned"],
  "summary": "One sentence summary of what this note means for the relationship"
}`;

    try {
      const result = await this.aiUsage.callAi({
        businessId,
        feature: 'note_intelligence',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Analyze this note: "${noteBody}"` },
        ],
        maxTokens: 500,
        temperature: 0.3,
      });
      const parsed = this.parseJson(result.content);
      return {
        sentiment: parsed.sentiment ?? 'neutral',
        sentimentConfidence: Number(parsed.sentimentConfidence) || 0.5,
        actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
        suggestedTags: Array.isArray(parsed.suggestedTags) ? parsed.suggestedTags : [],
        riskFlags: Array.isArray(parsed.riskFlags) ? parsed.riskFlags : [],
        keyEntities: Array.isArray(parsed.keyEntities) ? parsed.keyEntities : [],
        summary: parsed.summary ?? '',
        creditsUsed: result.usage?.creditsUsed ?? 1,
      };
    } catch (error) {
      this.logger.error('Note intelligence failed', error);
      throw error;
    }
  }

  async detectChurnRisk(businessId: string) {
    const now = new Date();
    const contacts = await this.db.contact.findMany({
      where: { businessId, deletedAt: null, status: { in: ['CLIENT', 'PROSPECT'] } },
      take: 100,
      orderBy: { lastInteractionAt: 'asc' },
      select: {
        id: true, firstName: true, lastName: true, email: true, phone: true,
        status: true, tags: true, companyName: true, leadScore: true,
        lastInteractionAt: true, createdAt: true,
      },
    });

    if (contacts.length === 0) {
      return { atRisk: [], summary: 'No clients or prospects found to analyze.', creditsUsed: 0 };
    }

    const contactIds = contacts.map(c => c.id);

    const [invoices, events, tasks, notes] = await Promise.all([
      this.db.invoice.findMany({
        where: { businessId, contactId: { in: contactIds } },
        select: { contactId: true, total: true, status: true, createdAt: true },
      }),
      this.db.contactEvent.findMany({
        where: { contactId: { in: contactIds } },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { contactId: true, type: true, createdAt: true },
      }),
      this.db.contactTask.findMany({
        where: { businessId, contactId: { in: contactIds }, deletedAt: null, status: 'OPEN' },
        select: { contactId: true, dueDate: true },
      }),
      this.db.contactNote.findMany({
        where: { businessId, contactId: { in: contactIds } },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: { contactId: true, body: true, createdAt: true },
      }),
    ]);

    const contactProfiles = contacts.map(c => {
      const name = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || 'Unnamed';
      const cInvoices = invoices.filter(i => i.contactId === c.id);
      const cEvents = events.filter(e => e.contactId === c.id);
      const cTasks = tasks.filter(t => t.contactId === c.id);
      const cNotes = notes.filter(n => n.contactId === c.id);
      const daysSinceLastInteraction = c.lastInteractionAt
        ? Math.floor((now.getTime() - new Date(c.lastInteractionAt).getTime()) / 86400000)
        : 999;
      const totalRevenue = cInvoices.filter(i => i.status === 'PAID').reduce((s, i) => s + Number(i.total ?? 0), 0);
      const overdueInvoices = cInvoices.filter(i => i.status === 'OVERDUE').length;
      const recentEvents = cEvents.filter(e => (now.getTime() - new Date(e.createdAt).getTime()) < 30 * 86400000).length;
      const overdueTasks = cTasks.filter(t => t.dueDate && new Date(t.dueDate) < now).length;

      return `- ${name} (ID:${c.id}) | Status: ${c.status} | Revenue: TTD ${totalRevenue.toFixed(0)} | Last active: ${daysSinceLastInteraction}d ago | Recent events: ${recentEvents} | Overdue invoices: ${overdueInvoices} | Overdue tasks: ${overdueTasks} | Score: ${c.leadScore ?? 'N/A'} | Latest note: "${cNotes[0]?.body?.substring(0, 100) ?? 'none'}"`;
    }).join('\n');

    const systemPrompt = `You are a churn prediction AI for a Caribbean service business (Trinidad & Tobago, TTD currency).
Analyze these contacts and identify who is at risk of churning (leaving or going inactive).

CONTACTS:
${contactProfiles}

Respond in valid JSON:
{
  "atRisk": [
    {
      "contactId": "contact ID",
      "contactName": "name",
      "churnProbability": 0.85,
      "riskLevel": "critical|high|medium",
      "reasons": ["reason1", "reason2"],
      "recommendedAction": "What to do to retain this client",
      "estimatedRevenueLoss": 0
    }
  ],
  "summary": "Overview of churn risk across the business"
}

Only include contacts with meaningful churn risk (probability > 0.4). Sort by churnProbability descending.`;

    try {
      const result = await this.aiUsage.callAi({
        businessId,
        feature: 'churn_detection',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: 'Analyze churn risk for my contacts.' },
        ],
        maxTokens: 1500,
        temperature: 0.3,
      });
      const parsed = this.parseJson(result.content);
      return {
        atRisk: Array.isArray(parsed.atRisk) ? parsed.atRisk : [],
        summary: parsed.summary ?? '',
        creditsUsed: result.usage?.creditsUsed ?? 2,
      };
    } catch (error) {
      this.logger.error('Churn detection failed', error);
      throw error;
    }
  }

  async naturalLanguageSearch(businessId: string, query: string) {
    const contactFields = await this.db.contact.findMany({
      where: { businessId, deletedAt: null },
      take: 5,
      select: {
        status: true, tags: true, source: true, city: true,
        country: true, industry: true, lifecycleStage: true, segment: true,
      },
    });

    const knownStatuses = [...new Set(contactFields.map(c => c.status).filter(Boolean))];
    const knownTags = [...new Set(contactFields.flatMap(c => c.tags ?? []))];
    const knownSources = [...new Set(contactFields.map(c => c.source).filter(Boolean))];
    const knownCities = [...new Set(contactFields.map(c => c.city).filter(Boolean))];
    const knownIndustries = [...new Set(contactFields.map(c => c.industry).filter(Boolean))];

    const systemPrompt = `You are a CRM search translator for a Caribbean service business (TTD currency, Trinidad & Tobago).
Convert a natural language query into structured CRM filter parameters.

Available filter fields:
- status: contact status (known values: ${knownStatuses.join(', ') || 'LEAD, PROSPECT, CLIENT, LOST'})
- search: text search across name, email, phone, company
- tags: array of tags to filter by (known: ${knownTags.slice(0, 20).join(', ') || 'none yet'})
- hasUnpaidInvoices: boolean
- staleDays: number (contacts inactive for N+ days)
- newThisWeek: boolean
- city: city name (known: ${knownCities.join(', ') || 'any'})
- industry: industry (known: ${knownIndustries.join(', ') || 'any'})
- source: lead source (known: ${knownSources.join(', ') || 'any'})
- sortBy: name|newest|oldest|revenue|score|lastInteraction
- sortOrder: asc|desc

Respond in valid JSON:
{
  "filters": {
    "status": "CLIENT",
    "search": "",
    "tags": [],
    "hasUnpaidInvoices": false,
    "staleDays": null,
    "newThisWeek": false,
    "city": null,
    "industry": null,
    "source": null,
    "sortBy": "name",
    "sortOrder": "asc"
  },
  "interpretation": "What you understood the user wants",
  "confidence": 0.9
}

Only include filters that are relevant to the query. Set irrelevant filters to null or false.`;

    try {
      const result = await this.aiUsage.callAi({
        businessId,
        feature: 'nl_search',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: query },
        ],
        maxTokens: 400,
        temperature: 0.2,
      });
      const parsed = this.parseJson(result.content);

      const filters = parsed.filters ?? {};
      const cleanFilters: Record<string, unknown> = {};
      if (filters.status) cleanFilters.status = filters.status;
      if (filters.search) cleanFilters.search = filters.search;
      if (Array.isArray(filters.tags) && filters.tags.length > 0) cleanFilters.tags = filters.tags;
      if (filters.hasUnpaidInvoices === true) cleanFilters.hasUnpaidInvoices = true;
      if (filters.staleDays && Number(filters.staleDays) > 0) cleanFilters.staleDays = Number(filters.staleDays);
      if (filters.newThisWeek === true) cleanFilters.newThisWeek = true;
      if (filters.city) cleanFilters.city = filters.city;
      if (filters.industry) cleanFilters.industry = filters.industry;
      if (filters.source) cleanFilters.source = filters.source;
      if (filters.sortBy) cleanFilters.sortBy = filters.sortBy;
      if (filters.sortOrder) cleanFilters.sortOrder = filters.sortOrder;

      const contacts = await this.db.contact.findMany({
        where: {
          businessId,
          deletedAt: null,
          ...(cleanFilters.status ? { status: cleanFilters.status as string } : {}),
          ...(cleanFilters.search ? {
            OR: [
              { firstName: { contains: cleanFilters.search as string, mode: 'insensitive' as const } },
              { lastName: { contains: cleanFilters.search as string, mode: 'insensitive' as const } },
              { email: { contains: cleanFilters.search as string, mode: 'insensitive' as const } },
              { companyName: { contains: cleanFilters.search as string, mode: 'insensitive' as const } },
            ],
          } : {}),
          ...(cleanFilters.tags ? { tags: { hasSome: cleanFilters.tags as string[] } } : {}),
          ...(cleanFilters.city ? { city: { contains: cleanFilters.city as string, mode: 'insensitive' as const } } : {}),
          ...(cleanFilters.industry ? { industry: { contains: cleanFilters.industry as string, mode: 'insensitive' as const } } : {}),
          ...(cleanFilters.source ? { source: { contains: cleanFilters.source as string, mode: 'insensitive' as const } } : {}),
          ...(cleanFilters.staleDays ? {
            lastInteractionAt: { lt: new Date(Date.now() - Number(cleanFilters.staleDays) * 86400000) },
          } : {}),
          ...(cleanFilters.newThisWeek ? {
            createdAt: { gte: new Date(Date.now() - 7 * 86400000) },
          } : {}),
        },
        take: 50,
        orderBy: cleanFilters.sortBy === 'score' ? { leadScore: (cleanFilters.sortOrder as 'asc' | 'desc') ?? 'desc' }
          : cleanFilters.sortBy === 'revenue' ? { leadScore: (cleanFilters.sortOrder as 'asc' | 'desc') ?? 'desc' }
          : cleanFilters.sortBy === 'newest' ? { createdAt: 'desc' }
          : cleanFilters.sortBy === 'oldest' ? { createdAt: 'asc' }
          : cleanFilters.sortBy === 'lastInteraction' ? { lastInteractionAt: (cleanFilters.sortOrder as 'asc' | 'desc') ?? 'desc' }
          : { firstName: (cleanFilters.sortOrder as 'asc' | 'desc') ?? 'asc' },
        select: {
          id: true, firstName: true, lastName: true, email: true, phone: true,
          status: true, companyName: true, leadScore: true, tags: true,
          lastInteractionAt: true, createdAt: true,
        },
      });

      return {
        contacts,
        filters: cleanFilters,
        interpretation: parsed.interpretation ?? '',
        confidence: Number(parsed.confidence) || 0.5,
        totalResults: contacts.length,
        creditsUsed: result.usage?.creditsUsed ?? 1,
      };
    } catch (error) {
      this.logger.error('NL search failed', error);
      throw error;
    }
  }

  async suggestTags(businessId: string, contactId: string) {
    const contact = await this.db.contact.findFirst({
      where: { id: contactId, businessId, deletedAt: null },
      select: {
        id: true, firstName: true, lastName: true, email: true, phone: true,
        status: true, source: true, tags: true, companyName: true, jobTitle: true,
        industry: true, leadScore: true, lifecycleStage: true, segment: true,
        lastInteractionAt: true, createdAt: true, city: true, country: true,
        preferredChannel: true,
      },
    });
    if (!contact) throw new Error('Contact not found');

    const [notes, events, invoices, bookings] = await Promise.all([
      this.db.contactNote.findMany({
        where: { contactId, businessId },
        take: 15,
        orderBy: { createdAt: 'desc' },
        select: { body: true, createdAt: true, source: true },
      }),
      this.db.contactEvent.findMany({
        where: { contactId },
        take: 30,
        orderBy: { createdAt: 'desc' },
        select: { type: true, createdAt: true, data: true },
      }),
      this.db.invoice.findMany({
        where: { contactId, businessId },
        take: 20,
        select: { total: true, status: true, createdAt: true },
      }),
      this.db.booking.findMany({
        where: { contactId, businessId },
        take: 10,
        orderBy: { startTime: 'desc' },
        select: { startTime: true, status: true },
      }),
    ]);

    const allTags = await this.db.contact.findMany({
      where: { businessId, deletedAt: null },
      select: { tags: true },
    });
    const tagFreq = new Map<string, number>();
    allTags.forEach(c => (c.tags ?? []).forEach(t => tagFreq.set(t, (tagFreq.get(t) ?? 0) + 1)));
    const popularTags = [...tagFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([t]) => t);

    const name = `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || 'Unnamed';
    const now = new Date();
    const daysSinceCreated = Math.floor((now.getTime() - new Date(contact.createdAt).getTime()) / 86400000);
    const daysSinceLastInteraction = contact.lastInteractionAt
      ? Math.floor((now.getTime() - new Date(contact.lastInteractionAt).getTime()) / 86400000)
      : null;
    const totalRevenue = invoices.filter(i => i.status === 'PAID').reduce((s, i) => s + Number(i.total ?? 0), 0);
    const eventTypes = [...new Set(events.map(e => e.type))];

    const contextBlock = `CONTACT:
Name: ${name} | Email: ${contact.email ?? 'N/A'} | Phone: ${contact.phone ?? 'N/A'}
Company: ${contact.companyName ?? 'N/A'} | Job Title: ${contact.jobTitle ?? 'N/A'} | Industry: ${contact.industry ?? 'N/A'}
Status: ${contact.status} | Lifecycle: ${contact.lifecycleStage ?? 'N/A'} | Lead Score: ${contact.leadScore ?? 'N/A'}
Location: ${[contact.city, contact.country].filter(Boolean).join(', ') || 'N/A'}
Source: ${contact.source ?? 'manual'} | Current Tags: ${(contact.tags ?? []).join(', ') || 'none'}
Preferred Channel: ${contact.preferredChannel ?? 'N/A'}
Created: ${daysSinceCreated} days ago | Last Interaction: ${daysSinceLastInteraction != null ? `${daysSinceLastInteraction} days ago` : 'never'}

FINANCIAL:
Total Revenue: TTD ${totalRevenue.toFixed(2)}
Invoices: ${invoices.length} (${invoices.filter(i => i.status === 'PAID').length} paid, ${invoices.filter(i => i.status === 'OVERDUE').length} overdue)
Bookings: ${bookings.length} (${bookings.filter(b => b.status === 'COMPLETED').length} completed)

INTERACTION PATTERNS:
Event types: ${eventTypes.join(', ') || 'none'}
Total events: ${events.length}

NOTES (${notes.length}):
${notes.slice(0, 8).map(n => `- [${n.source ?? 'general'}] ${n.body.substring(0, 200)}`).join('\n') || 'No notes'}

EXISTING TAGS IN BUSINESS (popular ones):
${popularTags.join(', ') || 'none yet'}`;

    const systemPrompt = `You are a CRM tagging intelligence assistant for a Caribbean service business (Trinidad & Tobago, TTD currency).
Analyze this contact's data, notes, events, and interaction patterns to suggest relevant tags.

${contextBlock}

INSTRUCTIONS:
- Suggest 3-8 relevant tags based on the contact's data and behavior
- Include both new tags and existing popular tags from the business if relevant
- Do NOT suggest tags the contact already has
- Each tag should be lowercase, short (1-3 words), using hyphens for multi-word tags
- Provide a confidence score (0-1) and brief reasoning for each suggestion
- Consider: industry, behavior patterns, revenue level, engagement, preferences, location, lifecycle stage

Respond in valid JSON:
{
  "suggestedTags": [
    {
      "tag": "high-value",
      "confidence": 0.92,
      "reasoning": "Has generated significant revenue with multiple paid invoices"
    }
  ]
}`;

    try {
      const result = await this.aiUsage.callAi({
        businessId,
        feature: 'ai_tags',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Suggest tags for ${name}.` },
        ],
        maxTokens: 600,
        temperature: 0.3,
      });
      const parsed = this.parseJson(result.content);
      const existingTags = new Set((contact.tags ?? []).map(t => t.toLowerCase()));
      const suggestions = Array.isArray(parsed.suggestedTags)
        ? parsed.suggestedTags.filter((s: any) => s.tag && !existingTags.has(s.tag.toLowerCase()))
        : [];

      return {
        suggestedTags: suggestions.map((s: any) => ({
          tag: String(s.tag).toLowerCase().trim(),
          confidence: Math.max(0, Math.min(1, Number(s.confidence) || 0.5)),
          reasoning: String(s.reasoning ?? ''),
        })),
        currentTags: contact.tags ?? [],
        creditsUsed: result.usage?.creditsUsed ?? 1,
      };
    } catch (error) {
      this.logger.error('AI tag suggestion failed', error);
      throw error;
    }
  }

  async generatePrepBrief(businessId: string, contactId: string) {
    const contact = await this.db.contact.findFirst({
      where: { id: contactId, businessId, deletedAt: null },
      select: {
        id: true, firstName: true, lastName: true, email: true, phone: true,
        status: true, source: true, tags: true, companyName: true, jobTitle: true,
        industry: true, leadScore: true, lifecycleStage: true, segment: true,
        lastInteractionAt: true, createdAt: true, city: true, country: true,
        preferredChannel: true, whatsappNumber: true,
      },
    });
    if (!contact) throw new Error('Contact not found');

    const [notes, events, invoices, tasks, bookings, quotes] = await Promise.all([
      this.db.contactNote.findMany({
        where: { contactId, businessId },
        take: 25,
        orderBy: { createdAt: 'desc' },
        select: { body: true, createdAt: true, source: true },
      }),
      this.db.contactEvent.findMany({
        where: { contactId },
        take: 40,
        orderBy: { createdAt: 'desc' },
        select: { type: true, createdAt: true, data: true },
      }),
      this.db.invoice.findMany({
        where: { contactId, businessId },
        take: 20,
        orderBy: { createdAt: 'desc' },
        select: { total: true, status: true, createdAt: true, dueDate: true, invoiceNumber: true },
      }),
      this.db.contactTask.findMany({
        where: { contactId, businessId, deletedAt: null },
        take: 15,
        orderBy: { createdAt: 'desc' },
        select: { title: true, status: true, priority: true, dueDate: true },
      }),
      this.db.booking.findMany({
        where: { contactId, businessId },
        take: 10,
        orderBy: { startTime: 'desc' },
        select: { startTime: true, status: true },
      }),
      this.db.quote.findMany({
        where: { contactId, businessId },
        take: 10,
        orderBy: { createdAt: 'desc' },
        select: { total: true, status: true, createdAt: true, quoteNumber: true },
      }),
    ]);

    const name = `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || 'Unnamed';
    const now = new Date();
    const daysSinceCreated = Math.floor((now.getTime() - new Date(contact.createdAt).getTime()) / 86400000);
    const daysSinceLastInteraction = contact.lastInteractionAt
      ? Math.floor((now.getTime() - new Date(contact.lastInteractionAt).getTime()) / 86400000)
      : null;

    const totalRevenue = invoices.filter(i => i.status === 'PAID').reduce((s, i) => s + Number(i.total ?? 0), 0);
    const outstandingBalance = invoices.filter(i => ['SENT', 'OVERDUE'].includes(i.status)).reduce((s, i) => s + Number(i.total ?? 0), 0);
    const overdueInvoices = invoices.filter(i => i.status === 'OVERDUE');
    const openQuotes = quotes.filter(q => ['DRAFT', 'SENT'].includes(q.status));
    const openTasks = tasks.filter(t => t.status === 'OPEN');
    const overdueTasks = openTasks.filter(t => t.dueDate && new Date(t.dueDate) < now);

    const contextBlock = `CONTACT PROFILE:
Name: ${name} | Email: ${contact.email ?? 'N/A'} | Phone: ${contact.phone ?? 'N/A'}
Company: ${contact.companyName ?? 'N/A'} | Job Title: ${contact.jobTitle ?? 'N/A'} | Industry: ${contact.industry ?? 'N/A'}
Status: ${contact.status} | Lifecycle: ${contact.lifecycleStage ?? 'N/A'} | Lead Score: ${contact.leadScore ?? 'N/A'}
Location: ${[contact.city, contact.country].filter(Boolean).join(', ') || 'N/A'}
Source: ${contact.source ?? 'manual'} | Tags: ${(contact.tags ?? []).join(', ') || 'none'}
Preferred Channel: ${contact.preferredChannel ?? 'N/A'} | WhatsApp: ${contact.whatsappNumber ?? 'N/A'}
Created: ${daysSinceCreated} days ago | Last Interaction: ${daysSinceLastInteraction != null ? `${daysSinceLastInteraction} days ago` : 'never'}

FINANCIAL:
Total Revenue: TTD ${totalRevenue.toFixed(2)} | Outstanding: TTD ${outstandingBalance.toFixed(2)}
Invoices: ${invoices.length} total (${invoices.filter(i => i.status === 'PAID').length} paid, ${overdueInvoices.length} overdue)
Overdue invoices: ${overdueInvoices.map(i => `${i.invoiceNumber ?? 'N/A'} - TTD ${Number(i.total ?? 0).toFixed(2)}`).join('; ') || 'none'}
Open quotes: ${openQuotes.map(q => `${q.quoteNumber ?? 'N/A'} - TTD ${Number(q.total ?? 0).toFixed(2)} (${q.status})`).join('; ') || 'none'}
Bookings: ${bookings.length} total (${bookings.filter(b => b.status === 'COMPLETED').length} completed)

OPEN TASKS:
${openTasks.map(t => `- ${t.title} (${t.priority ?? 'NORMAL'}, due: ${t.dueDate?.toISOString().split('T')[0] ?? 'no date'}${t.dueDate && new Date(t.dueDate) < now ? ' OVERDUE' : ''})`).join('\n') || 'None'}

NOTES (recent ${notes.length}):
${notes.slice(0, 15).map(n => `- [${n.createdAt.toISOString().split('T')[0]}] [${n.source ?? 'general'}] ${n.body.substring(0, 300)}`).join('\n') || 'No notes'}

RECENT EVENTS (${events.length}):
${events.slice(0, 20).map(e => `- ${e.type} at ${e.createdAt.toISOString().split('T')[0]}`).join('\n') || 'No events'}`;

    const systemPrompt = `You are a CRM conversation preparation assistant for a Caribbean service business (Trinidad & Tobago, TTD currency).
Generate a comprehensive pre-interaction preparation brief for an upcoming conversation with this contact.

${contextBlock}

Respond in valid JSON with this exact structure:
{
  "keyInfo": {
    "summary": "2-3 sentence overview of who this person is and current relationship status",
    "relationshipHealth": "strong|good|neutral|weak|critical",
    "sentiment": "positive|neutral|negative|at_risk",
    "lastContactSummary": "Brief summary of last interaction/activity"
  },
  "openItems": [
    {"type": "invoice|quote|task|booking", "title": "Description of the open item", "urgency": "high|medium|low", "detail": "Specifics like amounts, dates"}
  ],
  "suggestedTopics": [
    {"topic": "Topic to discuss", "reason": "Why this is important", "approach": "How to bring it up"}
  ],
  "relationshipSignals": {
    "positive": ["Positive signals from the data"],
    "concerns": ["Concerns or red flags detected"],
    "opportunities": ["Upsell or deepening opportunities"]
  },
  "icebreakers": ["Contextual conversation starters based on their profile"],
  "thingsToAvoid": ["Topics or approaches to avoid based on the data"],
  "talkingPoints": ["Key points to make sure to mention during the conversation"]
}

Be specific and reference actual data. Keep icebreakers relevant and professional. Focus on actionable intelligence.`;

    try {
      const result = await this.aiUsage.callAi({
        businessId,
        feature: 'ai_prep_brief',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Prepare me for a conversation with ${name}.` },
        ],
        maxTokens: 1200,
        temperature: 0.3,
      });
      const parsed = this.parseJson(result.content);
      return {
        keyInfo: parsed.keyInfo ?? { summary: '', relationshipHealth: 'neutral', sentiment: 'neutral', lastContactSummary: '' },
        openItems: Array.isArray(parsed.openItems) ? parsed.openItems : [],
        suggestedTopics: Array.isArray(parsed.suggestedTopics) ? parsed.suggestedTopics : [],
        relationshipSignals: parsed.relationshipSignals ?? { positive: [], concerns: [], opportunities: [] },
        icebreakers: Array.isArray(parsed.icebreakers) ? parsed.icebreakers : [],
        thingsToAvoid: Array.isArray(parsed.thingsToAvoid) ? parsed.thingsToAvoid : [],
        talkingPoints: Array.isArray(parsed.talkingPoints) ? parsed.talkingPoints : [],
        creditsUsed: result.usage?.creditsUsed ?? 2,
      };
    } catch (error) {
      this.logger.error('Prep brief generation failed', error);
      throw error;
    }
  }

  async interpretCommand(businessId: string, command: string) {
    const contacts = await this.db.contact.findMany({
      where: { businessId, deletedAt: null },
      take: 200,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true, firstName: true, lastName: true, email: true, phone: true,
        status: true, companyName: true, tags: true,
      },
    });

    const contactSummary = contacts.slice(0, 50).map(c => {
      const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || 'Unnamed';
      return `${name} (${c.id}) [${c.status}]${c.companyName ? ` @ ${c.companyName}` : ''}`;
    }).join('\n');

    const systemPrompt = `You are KeyFlow CRM's AI command interpreter. Parse the user's natural language command into a structured action intent.

Available actions:
- add_contact: Open the add contact form. Extract any provided details (firstName, lastName, email, phone, companyName, status).
- edit_contact: Open edit form for a specific contact. Requires matching a contact from the list.
- delete_contact: Delete a specific contact. Requires matching a contact.
- view_contact: Open/select a specific contact to view details. Requires matching a contact.
- change_status: Change a contact's status. Requires contact match and new status (LEAD, PROSPECT, CLIENT, LOST).
- add_note: Add a note to a contact. Requires contact match and note body.
- add_task: Add a task for a contact. Requires contact match and task title.
- log_communication: Log an interaction. Requires contact match and channel (call, email, whatsapp, meeting, sms).
- switch_tab: Navigate to a CRM tab (pipeline, database, insights, engage).
- filter_status: Filter the pipeline by status (LEAD, PROSPECT, CLIENT, LOST, all).
- open_broadcast: Open the broadcast/bulk messaging tool.
- import_contacts: Open the contact import modal.
- search_contacts: Search for contacts (delegate to search, not an action).
- show_favorites: Show favorite contacts.
- toggle_favorite: Star/unstar a contact.
- bulk_tag: Add tags to selected contacts. Requires tag names.
- generate_ai_summary: Generate AI summary for a contact.
- generate_ai_score: Generate AI lead score for a contact.
- generate_prep_brief: Generate AI prep brief for a contact.
- suggest_tags: Get AI tag suggestions for a contact.

Current contacts:
${contactSummary}

Respond with JSON:
{
  "isAction": true/false,
  "action": "action_name",
  "contactId": "id if applicable",
  "contactName": "matched name for confirmation",
  "params": { action-specific parameters },
  "confirmation": "Human-readable description of what will happen",
  "confidence": 0.0-1.0
}

If the input is a question/search query rather than an action command, set isAction to false.
If you cannot determine which contact the user means, set action to "ambiguous_contact" with params.candidates as an array of {id, name} matches.
Always try to match contacts by partial name, email, or company.`;

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'crm_command',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: command },
      ],
      maxTokens: 500,
      temperature: 0.1,
    });

    const parsed = this.parseJson(result.content);
    return {
      isAction: parsed.isAction === true,
      action: (parsed.action as string) || '',
      contactId: (parsed.contactId as string) || null,
      contactName: (parsed.contactName as string) || null,
      params: (parsed.params as Record<string, unknown>) || {},
      confirmation: (parsed.confirmation as string) || '',
      confidence: Number(parsed.confidence) || 0.5,
      creditsUsed: result.usage?.creditsUsed ?? 1,
    };
  }

  private parseJson(content: string): Record<string, unknown> {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return {};
      return JSON.parse(jsonMatch[0]);
    } catch {
      return {};
    }
  }

  private parseJsonResponse(content: string): AiAnalysisResult {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        analysis: parsed.analysis ?? '',
        suggestedActions: Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions : [],
        guidelines: Array.isArray(parsed.guidelines) ? parsed.guidelines : [],
        automatedTasks: Array.isArray(parsed.automatedTasks) ? parsed.automatedTasks : [],
      };
    } catch {
      return {
        analysis: content,
        suggestedActions: [],
        guidelines: [],
        automatedTasks: [],
      };
    }
  }
}
