import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiUsageService } from '../ai/ai-usage.service';
import { CrmSequenceService } from './crm-sequence.service';
import { CrmListsService } from './crm-lists.service';
import { CrmTimelineService } from './crm-timeline.service';
import { normalizeContactEventType } from '@keyflow/shared';
import { contactWhereBase, contactWhereWithId } from './crm.helpers';
import { buildContactSummaryPrompt } from './prompts/contact-summary.prompt';
import { buildLeadScoringPrompt } from './prompts/lead-scoring.prompt';
import { buildChurnDetectionPrompt } from './prompts/churn-detection.prompt';
import { buildNlSearchPrompt } from './prompts/nl-search.prompt';
import { buildCommandInterpreterPrompt } from './prompts/command-interpreter.prompt';

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
    @Inject(CrmSequenceService) private readonly sequences: CrmSequenceService,
    @Inject(CrmListsService) private readonly lists: CrmListsService,
    @Inject(CrmTimelineService) private readonly timeline: CrmTimelineService,
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
    // eslint-disable-next-line no-control-regex
    sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    return sanitized.slice(0, maxLen);
  }

  async analyzeContacts(
    businessId: string,
    prompt: string,
    contactIds?: string[],
  ): Promise<AiAnalysisResult> {
    const start = Date.now();
    const sanitizedPrompt = this.sanitizeAiInput(prompt, 2000);
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
          { role: 'user', content: sanitizedPrompt },
        ],
        maxTokens: 2000,
        temperature: 0.4,
        outputCategory: 'general',
      });

      const parsed = this.parseJsonResponse(result.content);
      const duration = Date.now() - start;
      this.logger.log(`[CRM] analyzeContacts businessId=${businessId} duration=${duration}ms`);
      if (duration > 1000) this.logger.warn(`[CRM] analyzeContacts slow businessId=${businessId} duration=${duration}ms`);
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
          where: contactWhereWithId(businessId, task.contactId),
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
    const where: Record<string, unknown> = { ...contactWhereBase(businessId) };
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
        where: contactWhereBase(businessId),
        _count: true,
      }),
      this.db.contactEvent.findMany({
        where: { contact: contactWhereBase(businessId) },
        take: 50,
        orderBy: { createdAt: 'desc' },
        select: {
          type: true,
          createdAt: true,
          contact: { select: { firstName: true, lastName: true, id: true } },
        },
      }),
      this.db.contactTask.findMany({
        where: { ...contactWhereBase(businessId), status: 'OPEN' },
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
    const start = Date.now();
    const contact = await this.db.contact.findFirst({
      where: contactWhereWithId(businessId, contactId),
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

    const systemPrompt = buildContactSummaryPrompt(contextBlock);

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
        outputCategory: 'general',
      });
      const parsed = this.parseJson(result.content);
      const duration = Date.now() - start;
      this.logger.log(`[CRM] summarizeContact businessId=${businessId} contactId=${contactId} duration=${duration}ms`);
      if (duration > 1000) this.logger.warn(`[CRM] summarizeContact slow businessId=${businessId} duration=${duration}ms`);
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
    const start = Date.now();
    const contact = await this.db.contact.findFirst({
      where: contactWhereWithId(businessId, contactId),
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

    const systemPrompt = buildLeadScoringPrompt(contextBlock);

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
        outputCategory: 'general',
        responseMode: 'structured_json',
      });
      const parsed = this.parseJson(result.content);
      const score = Math.max(0, Math.min(100, Number(parsed.score) || 50));

      await this.db.contact.updateMany({
        where: { id: contactId, businessId },
        data: { leadScore: score },
      }).catch(() => {});

      const duration = Date.now() - start;
      this.logger.log(`[CRM] scoreContactWithAi businessId=${businessId} contactId=${contactId} duration=${duration}ms`);
      if (duration > 1000) this.logger.warn(`[CRM] scoreContactWithAi slow businessId=${businessId} duration=${duration}ms`);
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
    const sanitizedNoteBody = this.sanitizeAiInput(noteBody, 5000);
    const contact = await this.db.contact.findFirst({
      where: contactWhereWithId(businessId, contactId),
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
"${sanitizedNoteBody}"

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
          { role: 'user', content: `Analyze this note: "${sanitizedNoteBody}"` },
        ],
        maxTokens: 500,
        temperature: 0.3,
        outputCategory: 'general',
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
      where: { ...contactWhereBase(businessId), status: { in: ['CLIENT', 'PROSPECT'] } },
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

    const systemPrompt = buildChurnDetectionPrompt(contactProfiles);

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
        outputCategory: 'general',
        responseMode: 'structured_json',
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
    const sanitizedQuery = this.sanitizeAiInput(query, 500);
    const contactFields = await this.db.contact.findMany({
      where: contactWhereBase(businessId),
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

    const systemPrompt = buildNlSearchPrompt({
      knownStatuses,
      knownTags,
      knownSources,
      knownCities,
      knownIndustries,
    });

    try {
      const result = await this.aiUsage.callAi({
        businessId,
        feature: 'nl_search',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: sanitizedQuery },
        ],
        maxTokens: 400,
        temperature: 0.2,
        outputCategory: 'general',
        responseMode: 'structured_json',
      });
      const parsed = this.parseJson(result.content);

      const filters: Record<string, any> = parsed.filters ?? {};
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
      where: contactWhereWithId(businessId, contactId),
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
      where: contactWhereBase(businessId),
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
        outputCategory: 'general',
        responseMode: 'structured_json',
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
      where: contactWhereWithId(businessId, contactId),
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
        outputCategory: 'general',
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
    const sanitizedCommand = this.sanitizeAiInput(command, 500);
    const [contacts, sequencesList, contactLists] = await Promise.all([
      this.db.contact.findMany({
        where: contactWhereBase(businessId),
        take: 200,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true, firstName: true, lastName: true, email: true, phone: true,
          status: true, companyName: true, tags: true,
        },
      }),
      this.sequences.listSequences(businessId).catch(() => []),
      this.lists.listContactLists(businessId).catch(() => []),
    ]);

    const contactSummary = contacts.slice(0, 50).map(c => {
      const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || 'Unnamed';
      return `${name} (${c.id}) [${c.status}]${c.companyName ? ` @ ${c.companyName}` : ''}`;
    }).join('\n');

    const sequenceSummary = sequencesList.length > 0
      ? sequencesList.map((s: any) => `${s.name} (${s.id}) [${s.status}] - ${s.enrollmentCount} enrolled`).join('\n')
      : undefined;

    const listSummary = contactLists.length > 0
      ? contactLists.map((l: any) => `${l.name} (${l.id}) [${l.type ?? 'MANUAL'}] - ${l.memberCount ?? 0} members`).join('\n')
      : undefined;

    const systemPrompt = buildCommandInterpreterPrompt(contactSummary, sequenceSummary, listSummary);

    const result = await this.aiUsage.callAi({
      businessId,
      feature: 'crm_command',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: sanitizedCommand },
      ],
      maxTokens: 500,
      temperature: 0.1,
      outputCategory: 'general',
      responseMode: 'structured_json',
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

  async executeAiCommand(businessId: string, userId: string, command: { action: string; contactId?: string | null; params?: Record<string, unknown> }) {
    const { action, contactId, params } = command;
    this.logger.log(`[CRM AI] executeAiCommand action=${action} businessId=${businessId}`);

    try {
      switch (action) {
        case 'enroll_sequence': {
          const seqName = (params?.sequenceName as string) ?? '';
          const allSeqs = await this.sequences.listSequences(businessId);
          const matched = allSeqs.find((s: any) => s.name.toLowerCase().includes(seqName.toLowerCase()));
          if (!matched) return { success: false, message: `Sequence "${seqName}" not found`, data: null };
          if (!contactId) return { success: false, message: 'No contact specified for enrollment', data: null };
          await this.sequences.enrollContacts(businessId, matched.id, [contactId]);
          return { success: true, message: `Enrolled contact in "${matched.name}"`, data: { sequenceId: matched.id, sequenceName: matched.name } };
        }

        case 'unenroll_sequence': {
          const seqName = (params?.sequenceName as string) ?? '';
          const allSeqs = await this.sequences.listSequences(businessId);
          const matched = allSeqs.find((s: any) => s.name.toLowerCase().includes(seqName.toLowerCase()));
          if (!matched) return { success: false, message: `Sequence "${seqName}" not found`, data: null };
          if (!contactId) return { success: false, message: 'No contact specified', data: null };
          const enrollment = await this.db.crmSequenceEnrollment.findFirst({
            where: { sequenceId: matched.id, contactId, status: 'active' },
          });
          if (!enrollment) return { success: false, message: 'Contact is not enrolled in this sequence', data: null };
          await this.db.crmSequenceEnrollment.update({ where: { id: enrollment.id }, data: { status: 'unenrolled' } });
          return { success: true, message: `Unenrolled contact from "${matched.name}"`, data: { sequenceId: matched.id } };
        }

        case 'create_list': {
          const name = (params?.name as string) ?? 'Untitled List';
          const type = (params?.type as string) ?? 'MANUAL';
          const description = (params?.description as string) ?? '';
          const list = await this.lists.createContactList({ businessId, name, type, description });
          return { success: true, message: `Created list "${name}"`, data: { listId: list.id, listName: name } };
        }

        case 'add_to_list': {
          const listName = (params?.listName as string) ?? '';
          const allLists = await this.lists.listContactLists(businessId);
          const matched = allLists.find((l: any) => l.name.toLowerCase().includes(listName.toLowerCase()));
          if (!matched) return { success: false, message: `List "${listName}" not found`, data: null };
          if (!contactId) return { success: false, message: 'No contact specified', data: null };
          await this.lists.addContactsToList({ businessId, listId: matched.id, contactIds: [contactId] });
          return { success: true, message: `Added contact to "${matched.name}"`, data: { listId: matched.id, listName: matched.name } };
        }

        case 'remove_from_list': {
          const listName = (params?.listName as string) ?? '';
          const allLists = await this.lists.listContactLists(businessId);
          const matched = allLists.find((l: any) => l.name.toLowerCase().includes(listName.toLowerCase()));
          if (!matched) return { success: false, message: `List "${listName}" not found`, data: null };
          if (!contactId) return { success: false, message: 'No contact specified', data: null };
          await this.lists.removeContactFromList({ businessId, listId: matched.id, contactId });
          return { success: true, message: `Removed contact from "${matched.name}"`, data: { listId: matched.id } };
        }

        case 'bulk_status_change': {
          const fromStatus = (params?.fromStatus as string);
          const toStatus = (params?.toStatus as string);
          if (!fromStatus || !toStatus) return { success: false, message: 'fromStatus and toStatus are required', data: null };
          const where: any = { ...contactWhereBase(businessId), status: fromStatus };
          const filterTag = params?.filter as string;
          if (filterTag) where.tags = { has: filterTag };
          const result = await this.db.contact.updateMany({ where, data: { status: toStatus } });
          return { success: true, message: `Changed ${result.count} contacts from ${fromStatus} to ${toStatus}`, data: { count: result.count } };
        }

        case 'add_note': {
          if (!contactId) return { success: false, message: 'No contact specified', data: null };
          const body = (params?.body as string) ?? '';
          if (!body) return { success: false, message: 'Note body is required', data: null };
          const note = await this.db.contactNote.create({
            data: { contactId, businessId, body, source: 'ai_command', authorId: userId },
          });
          return { success: true, message: 'Note added successfully', data: { noteId: note.id } };
        }

        case 'add_task': {
          if (!contactId) return { success: false, message: 'No contact specified', data: null };
          const title = (params?.title as string) ?? '';
          if (!title) return { success: false, message: 'Task title is required', data: null };
          const priority = (params?.priority as string) ?? 'NORMAL';
          const dueDate = params?.dueDate ? new Date(params.dueDate as string) : null;
          const task = await this.db.contactTask.create({
            data: { contactId, businessId, title, priority, dueDate, status: 'OPEN', assigneeId: userId },
          });
          return { success: true, message: `Task "${title}" created`, data: { taskId: task.id } };
        }

        case 'change_status': {
          if (!contactId) return { success: false, message: 'No contact specified', data: null };
          const status = (params?.status as string) ?? '';
          if (!['LEAD', 'PROSPECT', 'CLIENT', 'LOST'].includes(status)) {
            return { success: false, message: `Invalid status: ${status}`, data: null };
          }
          await this.db.contact.updateMany({ where: { id: contactId, businessId }, data: { status } });
          return { success: true, message: `Status changed to ${status}`, data: { status } };
        }

        case 'toggle_favorite': {
          if (!contactId) return { success: false, message: 'No contact specified', data: null };
          const contact = await this.db.contact.findFirst({ where: contactWhereWithId(businessId, contactId), select: { tags: true } });
          if (!contact) return { success: false, message: 'Contact not found', data: null };
          const tags = contact.tags ?? [];
          const isFavorite = tags.includes('favorite');
          const newTags = isFavorite ? tags.filter((t: string) => t !== 'favorite') : [...tags, 'favorite'];
          await this.db.contact.updateMany({ where: { id: contactId, businessId }, data: { tags: newTags } });
          return { success: true, message: !isFavorite ? 'Contact starred' : 'Contact unstarred', data: { isFavorite: !isFavorite } };
        }

        case 'log_communication': {
          if (!contactId) return { success: false, message: 'No contact specified', data: null };
          const channel = (params?.channel as string) ?? 'call';
          const notes = (params?.notes as string) ?? '';
          const outcome = (params?.outcome as string) ?? 'completed';
          const commType = normalizeContactEventType(`communication.${channel}`).canonical
            ?? normalizeContactEventType('communication.call').canonical!;
          await this.timeline.logEvent(
            businessId,
            contactId,
            commType,
            { channel, outcome, notes },
            { source: 'crm-ai', actorType: 'AI' },
          );
          await this.db.contact.updateMany({ where: { id: contactId, businessId }, data: { lastInteractionAt: new Date() } });
          return { success: true, message: `${channel} logged`, data: { channel, outcome } };
        }

        default:
          return { success: false, message: `Action "${action}" must be handled on the frontend`, data: null };
      }
    } catch (error: any) {
      this.logger.error(`[CRM AI] executeAiCommand failed: ${error.message}`, error.stack);
      return { success: false, message: error.message ?? 'Command execution failed', data: null };
    }
  }

  async dataQualityScan(businessId: string) {
    const contacts = await this.db.contact.findMany({
      where: contactWhereBase(businessId),
      select: {
        id: true, firstName: true, lastName: true, email: true, phone: true,
        companyName: true, tags: true, status: true, source: true,
        city: true, country: true, industry: true, jobTitle: true,
      },
    });

    const issues: Array<{ contactId: string; contactName: string; missingFields: string[]; completeness: number }> = [];
    const keyFields = ['email', 'phone', 'companyName', 'tags', 'city', 'industry'];

    for (const c of contacts) {
      const name = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || 'Unnamed';
      const missing: string[] = [];
      if (!c.firstName) missing.push('firstName');
      if (!c.lastName) missing.push('lastName');
      if (!c.email) missing.push('email');
      if (!c.phone) missing.push('phone');
      if (!c.companyName) missing.push('company');
      if (!c.tags || (c.tags as string[]).length === 0) missing.push('tags');
      if (!c.city) missing.push('city');
      if (!c.industry) missing.push('industry');
      if (!c.jobTitle) missing.push('jobTitle');

      const totalFields = 9;
      const completeness = Math.round(((totalFields - missing.length) / totalFields) * 100);

      if (missing.length > 0) {
        issues.push({ contactId: c.id, contactName: name, missingFields: missing, completeness });
      }
    }

    issues.sort((a, b) => a.completeness - b.completeness);

    const avgCompleteness = contacts.length > 0
      ? Math.round(issues.reduce((sum, i) => sum + i.completeness, 0) / Math.max(issues.length, 1))
      : 100;

    return {
      totalContacts: contacts.length,
      contactsWithIssues: issues.length,
      averageCompleteness: avgCompleteness,
      topIssues: issues.slice(0, 25),
      fieldBreakdown: keyFields.map(field => ({
        field,
        missing: issues.filter(i => i.missingFields.includes(field === 'company' ? 'company' : field)).length,
        percentage: contacts.length > 0
          ? Math.round((issues.filter(i => i.missingFields.includes(field === 'company' ? 'company' : field)).length / contacts.length) * 100)
          : 0,
      })),
    };
  }

  async findDuplicatesAi(businessId: string) {
    const contacts = await this.db.contact.findMany({
      where: contactWhereBase(businessId),
      select: {
        id: true, firstName: true, lastName: true, email: true, phone: true,
        companyName: true, status: true,
      },
    });

    const clusters: Array<{ contacts: Array<{ id: string; name: string; email: string | null; phone: string | null }>; reason: string; confidence: number }> = [];

    const emailMap = new Map<string, typeof contacts>();
    const phoneMap = new Map<string, typeof contacts>();
    const nameMap = new Map<string, typeof contacts>();

    for (const c of contacts) {
      if (c.email) {
        const key = c.email.toLowerCase().trim();
        if (!emailMap.has(key)) emailMap.set(key, []);
        emailMap.get(key)!.push(c);
      }
      if (c.phone) {
        const normalized = c.phone.replace(/\D/g, '').slice(-10);
        if (normalized.length >= 7) {
          if (!phoneMap.has(normalized)) phoneMap.set(normalized, []);
          phoneMap.get(normalized)!.push(c);
        }
      }
      const fullName = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim().toLowerCase();
      if (fullName && fullName !== 'unnamed' && fullName.length > 2) {
        if (!nameMap.has(fullName)) nameMap.set(fullName, []);
        nameMap.get(fullName)!.push(c);
      }
    }

    const seenPairs = new Set<string>();
    const addCluster = (group: typeof contacts, reason: string, confidence: number) => {
      const ids = group.map(c => c.id).sort().join('-');
      if (seenPairs.has(ids)) return;
      seenPairs.add(ids);
      clusters.push({
        contacts: group.map(c => ({
          id: c.id,
          name: `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || 'Unnamed',
          email: c.email,
          phone: c.phone,
        })),
        reason,
        confidence,
      });
    };

    for (const [email, group] of emailMap) {
      if (group.length > 1) addCluster(group, `Same email: ${email}`, 0.95);
    }
    for (const [phone, group] of phoneMap) {
      if (group.length > 1) addCluster(group, `Same phone: ${phone}`, 0.85);
    }
    for (const [name, group] of nameMap) {
      if (group.length > 1) addCluster(group, `Same name: ${name}`, 0.7);
    }

    clusters.sort((a, b) => b.confidence - a.confidence);

    return {
      totalContacts: contacts.length,
      duplicateClusters: clusters.slice(0, 20),
      estimatedDuplicates: clusters.reduce((s, c) => s + c.contacts.length - 1, 0),
    };
  }

  async bulkReengagementSuggestions(businessId: string) {
    const now = new Date();
    const staleThreshold = new Date(now.getTime() - 30 * 86400000);

    const staleContacts = await this.db.contact.findMany({
      where: {
        ...contactWhereBase(businessId),
        status: { in: ['CLIENT', 'PROSPECT', 'LEAD'] },
        OR: [
          { lastInteractionAt: { lt: staleThreshold } },
          { lastInteractionAt: null },
        ],
      },
      take: 50,
      orderBy: { lastInteractionAt: 'asc' },
      select: {
        id: true, firstName: true, lastName: true, email: true,
        status: true, lastInteractionAt: true, tags: true,
        leadScore: true, companyName: true,
      },
    });

    const sequences = await this.sequences.listSequences(businessId).catch(() => []);

    const suggestions = staleContacts.map(c => {
      const name = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || 'Unnamed';
      const daysSince = c.lastInteractionAt
        ? Math.floor((now.getTime() - new Date(c.lastInteractionAt).getTime()) / 86400000)
        : null;

      let recommendedAction: string;
      let urgency: 'high' | 'medium' | 'low';
      let suggestedSequence: string | null;

      if (c.status === 'CLIENT') {
        recommendedAction = 'Check-in call or satisfaction survey';
        urgency = daysSince && daysSince > 60 ? 'high' : 'medium';
        suggestedSequence = sequences.find((s: any) => s.name.toLowerCase().includes('follow') || s.name.toLowerCase().includes('check'))?.name ?? null;
      } else if (c.status === 'PROSPECT') {
        recommendedAction = 'Follow up on proposal or schedule meeting';
        urgency = 'high';
        suggestedSequence = sequences.find((s: any) => s.name.toLowerCase().includes('engage') || s.name.toLowerCase().includes('nurture'))?.name ?? null;
      } else {
        recommendedAction = 'Send value content or introductory offer';
        urgency = 'medium';
        suggestedSequence = sequences.find((s: any) => s.name.toLowerCase().includes('onboard') || s.name.toLowerCase().includes('welcome'))?.name ?? null;
      }

      return {
        contactId: c.id,
        contactName: name,
        email: c.email,
        status: c.status,
        daysSinceLastInteraction: daysSince,
        leadScore: c.leadScore,
        recommendedAction,
        urgency,
        suggestedSequence,
      };
    });

    suggestions.sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.urgency] - order[b.urgency];
    });

    return {
      totalStale: staleContacts.length,
      suggestions,
      availableSequences: sequences.map((s: any) => ({ id: s.id, name: s.name })),
    };
  }

  async revenueOpportunityScan(businessId: string) {
    const contacts = await this.db.contact.findMany({
      where: { ...contactWhereBase(businessId), status: { in: ['CLIENT', 'PROSPECT'] } },
      take: 100,
      select: {
        id: true, firstName: true, lastName: true, status: true,
        companyName: true, leadScore: true, tags: true,
        lastInteractionAt: true,
      },
    });

    const contactIds = contacts.map(c => c.id);
    const invoices = await this.db.invoice.findMany({
      where: { businessId, contactId: { in: contactIds } },
      select: { contactId: true, total: true, status: true, createdAt: true },
    });

    const now = new Date();
    const opportunities = contacts.map(c => {
      const name = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || 'Unnamed';
      const cInvoices = invoices.filter(i => i.contactId === c.id);
      const totalRevenue = cInvoices.filter(i => i.status === 'PAID').reduce((s, i) => s + Number(i.total ?? 0), 0);
      const lastInvoice = cInvoices.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
      const daysSinceLastInvoice = lastInvoice
        ? Math.floor((now.getTime() - new Date(lastInvoice.createdAt).getTime()) / 86400000)
        : null;

      let opportunityType: string;
      let estimatedValue: number;

      if (c.status === 'PROSPECT' && (c.leadScore ?? 0) >= 60) {
        opportunityType = 'Hot prospect — close the deal';
        estimatedValue = totalRevenue > 0 ? totalRevenue * 0.5 : 500;
      } else if (c.status === 'CLIENT' && daysSinceLastInvoice && daysSinceLastInvoice > 60) {
        opportunityType = 'Repeat business — re-engage for new project';
        estimatedValue = totalRevenue > 0 ? totalRevenue * 0.3 : 300;
      } else if (c.status === 'CLIENT' && totalRevenue > 1000) {
        opportunityType = 'Upsell — offer premium service';
        estimatedValue = totalRevenue * 0.2;
      } else {
        return null;
      }

      return {
        contactId: c.id,
        contactName: name,
        company: c.companyName,
        status: c.status,
        totalRevenue,
        opportunityType,
        estimatedValue: Math.round(estimatedValue),
        leadScore: c.leadScore,
      };
    }).filter(Boolean);

    const totalEstimated = opportunities.reduce((s, o) => s + (o?.estimatedValue ?? 0), 0);

    return {
      opportunities: opportunities.slice(0, 20),
      totalEstimatedRevenue: totalEstimated,
      contactsAnalyzed: contacts.length,
    };
  }

  async generateFollowUpDraft(businessId: string, contactId: string) {
    const contact = await this.db.contact.findFirst({
      where: contactWhereWithId(businessId, contactId),
      select: {
        id: true, firstName: true, lastName: true, email: true,
        status: true, companyName: true, tags: true, leadScore: true,
        lastInteractionAt: true, preferredChannel: true,
      },
    });
    if (!contact) throw new Error('Contact not found');

    const [notes, events, invoices] = await Promise.all([
      this.db.contactNote.findMany({
        where: { contactId, businessId },
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: { body: true, createdAt: true },
      }),
      this.db.contactEvent.findMany({
        where: { contactId },
        take: 10,
        orderBy: { createdAt: 'desc' },
        select: { type: true, createdAt: true, data: true },
      }),
      this.db.invoice.findMany({
        where: { contactId, businessId, status: { in: ['SENT', 'OVERDUE'] } },
        take: 5,
        select: { total: true, status: true },
      }),
    ]);

    const name = `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || 'there';
    const firstName = contact.firstName ?? name;

    const contextBlock = `Contact: ${name}
Status: ${contact.status} | Company: ${contact.companyName ?? 'N/A'} | Score: ${contact.leadScore ?? 'N/A'}
Channel: ${contact.preferredChannel ?? 'email'}
Recent Notes: ${notes.map(n => n.body.substring(0, 100)).join('; ') || 'None'}
Recent Events: ${events.map(e => e.type).join(', ') || 'None'}
Outstanding Invoices: ${invoices.length > 0 ? invoices.map(i => `TTD ${Number(i.total).toFixed(0)} (${i.status})`).join(', ') : 'None'}`;

    const systemPrompt = `You are a Caribbean business communication specialist writing follow-up messages for a Trinidad & Tobago service business.
Write in a warm, professional Caribbean style. Use TTD for currency. Be concise and actionable.

${contextBlock}

Generate 2 follow-up message options: one formal and one friendly.

Respond in valid JSON:
{
  "messages": [
    {
      "tone": "formal",
      "subject": "Email subject line",
      "body": "Full message body",
      "channel": "email|whatsapp"
    },
    {
      "tone": "friendly",
      "subject": "Email subject line",
      "body": "Full message body",
      "channel": "email|whatsapp"
    }
  ],
  "context": "Brief explanation of why this follow-up is needed",
  "bestTime": "Suggested best time to send"
}`;

    try {
      const result = await this.aiUsage.callAi({
        businessId,
        feature: 'follow_up_draft',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Generate follow-up messages for ${firstName}.` },
        ],
        maxTokens: 800,
        temperature: 0.5,
        outputCategory: 'messages',
      });
      const parsed = this.parseJson(result.content);
      return {
        messages: Array.isArray(parsed.messages) ? parsed.messages : [],
        context: parsed.context ?? '',
        bestTime: parsed.bestTime ?? '',
        contactName: name,
        creditsUsed: result.usage?.creditsUsed ?? 2,
      };
    } catch (error) {
      this.logger.error('Follow-up draft generation failed', error);
      throw error;
    }
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
