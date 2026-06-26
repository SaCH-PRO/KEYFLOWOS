import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiUsageService } from '../ai/ai-usage.service';

interface AutopilotActionInput {
  id: string;
  type: 'follow_up' | 'birthday' | 'payment_reminder' | 'check_in' | 'offer' | 'review_request' | 'referral_request' | 'thank_you' | 're_engage';
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
    goal: 'Re-engage the contact with a warm, friendly follow-up. Reference prior interactions, services used, or outstanding items if available.',
    tone: 'warm and professional',
    defaultChannel: 'whatsapp',
  },
  birthday: {
    goal: 'Send a heartfelt birthday greeting. Optionally mention a small birthday offer or discount.',
    tone: 'warm and celebratory',
    defaultChannel: 'whatsapp',
  },
  payment_reminder: {
    goal: 'Politely remind the contact about an outstanding payment. Be firm but friendly. Reference the specific invoice number and amount. Mention the due date if overdue.',
    tone: 'professional and courteous',
    defaultChannel: 'email',
  },
  check_in: {
    goal: 'Check in with the contact to maintain the relationship. Reference their last interaction or service if available. Ask how things are going and if they need anything.',
    tone: 'casual and caring',
    defaultChannel: 'whatsapp',
  },
  offer: {
    goal: 'Present a special offer or incentive to re-engage a stale prospect. Create urgency without being pushy. Reference what they were previously interested in if known.',
    tone: 'enthusiastic but professional',
    defaultChannel: 'email',
  },
  review_request: {
    goal: 'Ask a satisfied client for a review or testimonial after a recently completed session or service. Make it easy — suggest a one-line review or star rating.',
    tone: 'grateful and casual',
    defaultChannel: 'whatsapp',
  },
  referral_request: {
    goal: 'Ask a loyal, happy client if they know anyone who could benefit from your services. Make it natural, not pushy. Optionally offer a referral incentive.',
    tone: 'friendly and appreciative',
    defaultChannel: 'whatsapp',
  },
  thank_you: {
    goal: 'Send a genuine thank-you after a payment, completed project, or milestone. Acknowledge the specific transaction or achievement.',
    tone: 'warm and grateful',
    defaultChannel: 'whatsapp',
  },
  re_engage: {
    goal: 'Win back a dormant or churning client. Reference their history with your business and what they valued. Offer a compelling reason to reconnect.',
    tone: 'warm and inviting',
    defaultChannel: 'whatsapp',
  },
};

@Injectable()
export class AutopilotAiService {
  private readonly logger = new Logger(AutopilotAiService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
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
              preferredChannel: true,
              lastInteractionAt: true,
              leadScore: true,
              tags: true,
              notes: { take: 3, orderBy: { createdAt: 'desc' as const }, select: { body: true } },
              invoices: {
                where: { status: { in: ['SENT', 'OVERDUE', 'PAID'] }, deletedAt: null },
                take: 5,
                orderBy: { createdAt: 'desc' as const },
                select: { invoiceNumber: true, total: true, status: true, dueDate: true, paidAt: true },
              },
              bookings: {
                take: 3,
                orderBy: { startTime: 'desc' as const },
                select: { status: true, startTime: true, endTime: true },
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
    const businessIndustry = business?.industry || 'service';

    const now = new Date();
    const daysSinceLastInteraction = contact?.lastInteractionAt
      ? Math.round((now.getTime() - new Date(contact.lastInteractionAt).getTime()) / (24 * 60 * 60 * 1000))
      : null;

    const paidInvoices = contact?.invoices?.filter((i: any) => i.status === 'PAID') || [];
    const unpaidInvoices = contact?.invoices?.filter((i: any) => i.status !== 'PAID') || [];
    const lifetimeRevenue = paidInvoices.reduce((sum: number, i: any) => sum + (Number(i.total) || 0), 0);
    const completedBookings = contact?.bookings?.filter((b: any) => b.status === 'COMPLETED') || [];

    const contactContext = [
      `Contact: ${action.contactName}`,
      contact?.companyName ? `Company: ${contact.companyName}` : null,
      contact?.status ? `Status: ${contact.status}` : null,
      contact?.lifecycleStage ? `Stage: ${contact.lifecycleStage}` : null,
      contact?.industry ? `Industry: ${contact.industry}` : null,
      contact?.leadScore ? `Lead Score: ${contact.leadScore}/100` : null,
      contact?.tags?.length ? `Tags: ${contact.tags.join(', ')}` : null,
      daysSinceLastInteraction !== null ? `Last interaction: ${daysSinceLastInteraction} days ago` : null,
      completedBookings.length > 0 ? `Completed sessions: ${completedBookings.length}` : null,
      lifetimeRevenue > 0 ? `Lifetime revenue: TTD ${lifetimeRevenue.toFixed(2)}` : null,
      contact?.notes?.length
        ? `Recent notes: ${contact.notes.map((n: { body: string }) => n.body.slice(0, 80)).join('; ')}`
        : null,
      unpaidInvoices.length > 0
        ? `Outstanding invoices: ${unpaidInvoices.map((inv: { invoiceNumber: string; total: unknown; status: string; dueDate: Date | null }) => `${inv.invoiceNumber} — TTD ${Number(inv.total).toFixed(2)} (${inv.status}${inv.dueDate ? ', due ' + new Date(inv.dueDate).toLocaleDateString() : ''})`).join(', ')}`
        : null,
    ]
      .filter(Boolean)
      .join('\n');

    const preferredChannel = contact?.preferredChannel || (contact?.phone ? 'whatsapp' : contact?.email ? 'email' : ctx.defaultChannel);

    const systemPrompt = [
      `You are the AI communications assistant for "${businessName}", a ${businessIndustry} business in Trinidad & Tobago.`,
      `You write messages that feel personal, warm, and Caribbean-natural — never robotic, templated, or overly formal.`,
      `Use TTD (Trinidad & Tobago Dollar) for any currency references.`,
      `The recipient's first name is "${contactFirstName}".`,
      '',
      `GOAL: ${ctx.goal}`,
      `TONE: ${ctx.tone}`,
      '',
      `ACTION CONTEXT: ${action.description}`,
      contactContext ? `\nCONTACT PROFILE:\n${contactContext}` : '',
      '',
      'WRITING RULES:',
      '- Reference specific details from the contact profile (amounts, dates, services) — never write generic messages',
      '- Keep it concise: 2-3 sentences for WhatsApp, 3-4 for email',
      '- Sound like a real person who knows this client, not an AI',
      '- Use natural Caribbean English — warm but professional, no slang extremes',
      `- ${preferredChannel === 'whatsapp' ? 'Keep under 250 characters — this is for WhatsApp' : 'Include a clear subject line for email'}`,
      '',
      'Respond ONLY with valid JSON:',
      '{"subject":"<email subject line>","message":"<message body — no greeting/sign-off, just the content>","tone":"<warm|professional|friendly|urgent|celebratory>"}',
    ].join('\n');

    try {
      const result = await this.aiUsage.callAi({
        businessId,
        feature: 'autopilot_draft',
        model: 'gpt-4o-mini',
        maxTokens: 400,
        temperature: 0.5,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Generate a ${action.type.replace(/_/g, ' ')} message for ${action.contactName}.` },
        ],
        outputCategory: 'messages',
      });

      const parsed = this.parseJson(result.content);

      return {
        subject: parsed.subject || `${action.type.replace(/_/g, ' ')} — ${action.contactName}`,
        message: parsed.message || `Hi ${contactFirstName}, just reaching out to connect. Let me know if there's anything I can help with!`,
        tone: parsed.tone || 'warm',
        suggestedChannel: preferredChannel as 'whatsapp' | 'email',
      };
    } catch (error: any) {
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
        subject: `Happy Birthday!`,
        message: `Happy Birthday ${firstName}! Wishing you a wonderful day filled with joy. We truly value having you as part of our community!`,
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
      review_request: {
        subject: `Quick favour — your feedback matters`,
        message: `Hi ${firstName}, hope you enjoyed your recent session with us! If you have a moment, a quick review would mean the world. Even one line helps!`,
      },
      referral_request: {
        subject: `Know someone who could use our help?`,
        message: `Hi ${firstName}, we've really enjoyed working with you! If you know anyone who could benefit from our services, we'd love an introduction.`,
      },
      thank_you: {
        subject: `Thank you!`,
        message: `Hi ${firstName}, just wanted to say a sincere thank you for your recent payment. It's a genuine pleasure working with you and we look forward to continuing!`,
      },
      re_engage: {
        subject: `We miss you!`,
        message: `Hi ${firstName}, it's been a while since we last connected and I wanted to reach out. We'd love to catch up and see how we can help again.`,
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
