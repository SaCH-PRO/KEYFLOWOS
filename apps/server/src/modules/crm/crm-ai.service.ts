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
      select: { settings: true },
    });

    const settings = (business?.settings as Record<string, unknown>) ?? {};
    const aiGuidelines = settings.aiGuidelines as { guidelines: string[]; generatedAt: string } | undefined;

    return {
      guidelines: aiGuidelines?.guidelines ?? [],
      generatedAt: aiGuidelines?.generatedAt ?? null,
    };
  }

  async saveGuidelines(businessId: string, guidelines: string[]): Promise<void> {
    const business = await this.db.business.findUnique({
      where: { id: businessId },
      select: { settings: true },
    });

    const existing = (business?.settings as Record<string, unknown>) ?? {};

    await this.db.business.update({
      where: { id: businessId },
      data: {
        settings: {
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
