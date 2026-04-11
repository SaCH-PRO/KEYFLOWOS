import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiUsageService } from '../ai/ai-usage.service';

interface MomentumDraftInput {
  recommendationId: string;
  contactId: string;
  contactName: string;
  type: string;
  description: string;
  momentumScore?: number;
}

export interface MomentumDraft {
  subject: string;
  message: string;
  tone: string;
  suggestedChannel: 'whatsapp' | 'email';
}

const TYPE_CONTEXT: Record<string, { goal: string; tone: string; defaultChannel: 'whatsapp' | 'email' }> = {
  churn_risk: {
    goal: 'Re-engage a client whose activity has dropped significantly. Show genuine concern and provide a compelling reason to reconnect.',
    tone: 'warm and concerned',
    defaultChannel: 'whatsapp',
  },
  check_in: {
    goal: 'Check in with a valuable client who has been quiet lately. Be casual and caring.',
    tone: 'casual and caring',
    defaultChannel: 'whatsapp',
  },
  upsell: {
    goal: 'Capitalize on strong engagement momentum to suggest an upgrade, package, or additional service.',
    tone: 'enthusiastic but professional',
    defaultChannel: 'email',
  },
  package_offer: {
    goal: 'Offer a loyal, frequent client a package deal that saves them money and locks in their business.',
    tone: 'friendly and value-focused',
    defaultChannel: 'email',
  },
  re_engage: {
    goal: 'Win back an inactive client with a special offer or personalized message showing you remember and value them.',
    tone: 'warm and inviting',
    defaultChannel: 'whatsapp',
  },
  birthday: {
    goal: 'Send a heartfelt birthday greeting. Optionally mention a small birthday offer or discount.',
    tone: 'warm and celebratory',
    defaultChannel: 'whatsapp',
  },
};

@Injectable()
export class MomentumAiService {
  private readonly logger = new Logger(MomentumAiService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
  ) {}

  async generateDraft(businessId: string, input: MomentumDraftInput): Promise<MomentumDraft> {
    const [contact, business] = await Promise.all([
      this.prisma.client.contact.findFirst({
        where: { id: input.contactId, businessId, deletedAt: null },
        select: {
          firstName: true, lastName: true, email: true, phone: true,
          companyName: true, status: true, industry: true,
          notes: { take: 3, orderBy: { createdAt: 'desc' as const }, select: { body: true } },
        },
      }),
      this.prisma.client.business.findUnique({
        where: { id: businessId },
        select: { name: true, industry: true },
      }),
    ]);

    const ctx = TYPE_CONTEXT[input.type] || TYPE_CONTEXT.check_in;
    const contactFirstName = contact?.firstName || input.contactName.split(' ')[0] || 'there';
    const businessName = business?.name || 'our business';

    const contactContext = [
      `Contact: ${input.contactName}`,
      contact?.companyName ? `Company: ${contact.companyName}` : null,
      contact?.status ? `Status: ${contact.status}` : null,
      contact?.industry ? `Industry: ${contact.industry}` : null,
      input.momentumScore !== undefined ? `Momentum Score: ${input.momentumScore}/100` : null,
      contact?.notes?.length
        ? `Recent notes: ${contact.notes.map((n: { body: string }) => n.body.slice(0, 80)).join('; ')}`
        : null,
    ].filter(Boolean).join('\n');

    const systemPrompt = [
      `You are the AI assistant for "${businessName}", a Caribbean business.`,
      `Your tone is ${ctx.tone}. You write in a Caribbean-friendly style — warm, respectful, natural.`,
      `Use TTD (Trinidad & Tobago Dollar) for any currency references.`,
      `The recipient's first name is "${contactFirstName}".`,
      '',
      `GOAL: ${ctx.goal}`,
      '',
      `CONTEXT: ${input.description}`,
      contactContext ? `\nCONTACT INFO:\n${contactContext}` : '',
      '',
      'Respond ONLY with valid JSON:',
      '{"subject":"<email subject>","message":"<message body, 2-4 sentences>","tone":"<warm|professional|friendly|urgent|celebratory>"}',
      '',
      'Keep the message concise (under 300 characters for WhatsApp). Be genuine, not generic.',
    ].join('\n');

    try {
      const result = await this.aiUsage.callAi({
        businessId,
        feature: 'momentum_draft',
        model: 'gpt-4o-mini',
        maxTokens: 300,
        temperature: 0.6,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Generate a ${input.type.replace(/_/g, ' ')} message for ${input.contactName}.` },
        ],
        outputCategory: 'messages',
      });

      const parsed = this.parseJson(result.content);

      const draft: MomentumDraft = {
        subject: parsed.subject || `${input.type.replace(/_/g, ' ')} — ${input.contactName}`,
        message: parsed.message || `Hi ${contactFirstName}, just reaching out to connect. Let me know if there's anything I can help with!`,
        tone: parsed.tone || 'warm',
        suggestedChannel: contact?.email ? ctx.defaultChannel : 'whatsapp',
      };

      await this.prisma.client.momentumRecommendation.update({
        where: { id: input.recommendationId, businessId },
        data: {
          draftMessage: draft.message,
          draftSubject: draft.subject,
          suggestedChannel: draft.suggestedChannel,
        },
      });

      return draft;
    } catch (error) {
      this.logger.warn(`Momentum AI draft failed, using fallback: ${(error as Error).message}`);
      return this.fallbackDraft(input, contactFirstName, ctx);
    }
  }

  private fallbackDraft(
    input: MomentumDraftInput,
    firstName: string,
    ctx: { goal: string; tone: string; defaultChannel: 'whatsapp' | 'email' },
  ): MomentumDraft {
    const templates: Record<string, { subject: string; message: string }> = {
      churn_risk: {
        subject: `We miss you, ${input.contactName}!`,
        message: `Hi ${firstName}, we noticed it's been a while since we connected. We'd love to catch up and see how things are going — anything we can help with?`,
      },
      check_in: {
        subject: `Just checking in`,
        message: `Hi ${firstName}, hope all is well! Just wanted to check in and see how everything's going. Let me know if there's anything we can help with.`,
      },
      upsell: {
        subject: `Something special for you`,
        message: `Hi ${firstName}, we've got some exciting new offerings that I think you'd love. Would you be available for a quick chat to discuss?`,
      },
      package_offer: {
        subject: `Exclusive package deal`,
        message: `Hi ${firstName}, based on your loyalty, we'd like to offer you a special package deal. Let's chat about how we can save you money!`,
      },
      re_engage: {
        subject: `We'd love to reconnect`,
        message: `Hi ${firstName}, it's been a while and we miss having you around! We have something special lined up — would love to share.`,
      },
      birthday: {
        subject: `Happy Birthday! 🎉`,
        message: `Happy Birthday ${firstName}! 🎂 Wishing you a wonderful day filled with joy. We truly value having you as part of our community!`,
      },
    };

    const tmpl = templates[input.type] || templates.check_in;
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
      this.logger.warn('Failed to parse momentum AI JSON response');
    }
    return {};
  }
}
