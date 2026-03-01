import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiUsageService } from '../ai/ai-usage.service';

interface AutopilotActionInput {
  id: string;
  type: 'follow_up' | 'birthday' | 'payment_reminder' | 'check_in' | 'offer';
  contactId: string;
  contactName: string;
  description: string;
}

export interface AutopilotDraft {
  subject: string;
  message: string;
  tone: string;
  suggestedChannel: 'whatsapp' | 'email';
}

const ACTION_CONTEXT: Record<string, { goal: string; tone: string; defaultChannel: 'whatsapp' | 'email' }> = {
  follow_up: {
    goal: 'Re-engage the contact with a warm, friendly follow-up. Reference prior interactions if available.',
    tone: 'warm and professional',
    defaultChannel: 'whatsapp',
  },
  birthday: {
    goal: 'Send a heartfelt birthday greeting. Optionally mention a small birthday offer or discount.',
    tone: 'warm and celebratory',
    defaultChannel: 'whatsapp',
  },
  payment_reminder: {
    goal: 'Politely remind the contact about an outstanding payment. Be firm but friendly. Include the invoice reference if available.',
    tone: 'professional and courteous',
    defaultChannel: 'email',
  },
  check_in: {
    goal: 'Check in with the contact to maintain the relationship. Ask how things are going and if they need anything.',
    tone: 'casual and caring',
    defaultChannel: 'whatsapp',
  },
  offer: {
    goal: 'Present a special offer or incentive to re-engage a stale prospect. Create urgency without being pushy.',
    tone: 'enthusiastic but professional',
    defaultChannel: 'email',
  },
};

@Injectable()
export class AutopilotAiService {
  private readonly logger = new Logger(AutopilotAiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiUsage: AiUsageService,
  ) {}

  async generateDraft(businessId: string, action: AutopilotActionInput): Promise<AutopilotDraft> {
    const [contact, business] = await Promise.all([
      action.contactId
        ? this.prisma.client.contact.findUnique({
            where: { id: action.contactId },
            select: {
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              companyName: true,
              status: true,
              lifecycleStage: true,
              industry: true,
              notes: { take: 3, orderBy: { createdAt: 'desc' }, select: { body: true } },
              invoices: {
                where: { status: { in: ['SENT', 'OVERDUE'] } },
                take: 2,
                orderBy: { createdAt: 'desc' },
                select: { invoiceNumber: true, total: true, status: true, dueDate: true },
              },
            },
          })
        : null,
      this.prisma.client.business.findUnique({
        where: { id: businessId },
        select: { name: true, industry: true, archetype: true },
      }),
    ]);

    const ctx = ACTION_CONTEXT[action.type] || ACTION_CONTEXT.follow_up;
    const contactFirstName = contact?.firstName || action.contactName.split(' ')[0] || 'there';
    const businessName = business?.name || 'our business';

    const contactContext = [
      `Contact: ${action.contactName}`,
      contact?.companyName ? `Company: ${contact.companyName}` : null,
      contact?.status ? `Status: ${contact.status}` : null,
      contact?.industry ? `Industry: ${contact.industry}` : null,
      contact?.notes?.length
        ? `Recent notes: ${contact.notes.map((n: { body: string }) => n.body.slice(0, 80)).join('; ')}`
        : null,
      contact?.invoices?.length
        ? `Outstanding invoices: ${contact.invoices.map((inv: { invoiceNumber: string; total: unknown; status: string }) => `${inv.invoiceNumber} — TTD ${Number(inv.total).toFixed(2)} (${inv.status})`).join(', ')}`
        : null,
    ]
      .filter(Boolean)
      .join('\n');

    const systemPrompt = [
      `You are the AI assistant for "${businessName}", a Caribbean business.`,
      `Your tone is ${ctx.tone}. You are writing in a Caribbean-friendly style — warm, respectful, natural.`,
      `Use TTD (Trinidad & Tobago Dollar) for any currency references.`,
      `The recipient's first name is "${contactFirstName}".`,
      '',
      `GOAL: ${ctx.goal}`,
      '',
      `CONTEXT about the action: ${action.description}`,
      contactContext ? `\nCONTACT INFO:\n${contactContext}` : '',
      '',
      'Respond ONLY with valid JSON in this exact format:',
      '{"subject":"<email subject line>","message":"<the message body, 2-4 sentences, no greeting sign-off — just the body>","tone":"<one word: warm|professional|friendly|urgent|celebratory>"}',
      '',
      'Keep the message concise (under 300 characters for WhatsApp suitability). Be genuine, not generic.',
    ].join('\n');

    try {
      const result = await this.aiUsage.callAi({
        businessId,
        feature: 'autopilot_draft',
        model: 'gpt-4o-mini',
        maxTokens: 300,
        temperature: 0.6,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Generate a ${action.type.replace(/_/g, ' ')} message for ${action.contactName}.` },
        ],
      });

      const parsed = this.parseJson(result.content);

      return {
        subject: parsed.subject || `${action.type.replace(/_/g, ' ')} — ${action.contactName}`,
        message: parsed.message || `Hi ${contactFirstName}, just reaching out to connect. Let me know if there's anything I can help with!`,
        tone: parsed.tone || 'warm',
        suggestedChannel: contact?.email ? ctx.defaultChannel : 'whatsapp',
      };
    } catch (error) {
      this.logger.warn(`AI draft generation failed, using fallback: ${(error as Error).message}`);
      return this.fallbackDraft(action, contactFirstName, ctx);
    }
  }

  private fallbackDraft(
    action: AutopilotActionInput,
    firstName: string,
    ctx: { goal: string; tone: string; defaultChannel: 'whatsapp' | 'email' },
  ): AutopilotDraft {
    const templates: Record<string, { subject: string; message: string }> = {
      follow_up: {
        subject: `Following up — ${action.contactName}`,
        message: `Hi ${firstName}, just checking in on our last conversation. Would love to hear how things are going and if there's anything I can help with!`,
      },
      birthday: {
        subject: `Happy Birthday! 🎉`,
        message: `Happy Birthday ${firstName}! 🎂 Wishing you a wonderful day filled with joy. We truly value having you as part of our community!`,
      },
      payment_reminder: {
        subject: `Friendly Payment Reminder`,
        message: `Hi ${firstName}, just a gentle reminder about your outstanding balance. Please let me know if you have any questions or need to discuss payment arrangements.`,
      },
      check_in: {
        subject: `Just checking in`,
        message: `Hi ${firstName}, hope all is well! Just wanted to check in and see how everything's going. Let me know if there's anything we can help with.`,
      },
      offer: {
        subject: `Special Offer Just for You`,
        message: `Hi ${firstName}, we have something special lined up that I think you'd really appreciate. Would love to share the details — are you available for a quick chat?`,
      },
    };

    const tmpl = templates[action.type] || templates.follow_up;
    return {
      subject: tmpl.subject,
      message: tmpl.message,
      tone: ctx.tone.split(' ')[0],
      suggestedChannel: ctx.defaultChannel,
    };
  }

  private parseJson(raw: string): { subject?: string; message?: string; tone?: string } {
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
    } catch {
      this.logger.warn('Failed to parse AI JSON response');
    }
    return {};
  }
}
