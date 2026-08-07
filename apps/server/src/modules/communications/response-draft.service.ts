import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiMessageSenderService } from '../ai/ai-message-sender.service';

export interface DraftOptions {
  channel: 'email' | 'sms' | 'whatsapp' | 'call' | 'form';
  purpose: string;
  tone?: 'professional' | 'friendly' | 'empathetic' | 'formal' | 'casual';
  body: string;
  requiresApproval?: boolean;
  riskTier?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  evidence?: Record<string, unknown>;
}

/**
 * KEY-generated response drafts with approval workflow.
 *
 * - Creates draft replies for inbound interactions
 * - Supports approval workflow (HIGH/CRISK risk = requires approval)
 * - Links drafts to intents, threads, commands
 * - Tracks sent status
 */
@Injectable()
export class ResponseDraftService {
  private readonly logger = new Logger(ResponseDraftService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiMessageSenderService) private readonly sender: AiMessageSenderService,
  ) {}

  async createDraft(
    businessId: string,
    createdBy: string,
    options: DraftOptions,
    links?: {
      intentId?: string;
      threadId?: string;
      commandId?: string;
      channelAccountId?: string;
    },
  ) {
    const requiresApproval =
      options.requiresApproval ??
      (options.riskTier === 'HIGH' || options.riskTier === 'CRITICAL');

    const draft = await this.prisma.client.responseDraft.create({
      data: {
        businessId,
        channel: options.channel,
        purpose: options.purpose,
        body: options.body,
        tone: options.tone ?? 'professional',
        status: requiresApproval ? 'PENDING_APPROVAL' : 'APPROVED',
        requiresApproval,
        riskTier: this.riskTierToNumber(options.riskTier ?? 'LOW'),
        evidence: options.evidence ?? {},
        createdBy,
        threadId: links?.threadId ?? null,
        contactId: links?.intentId ? (await this.prisma.client.interactionIntent.findUnique({ where: { id: links.intentId }, select: { contactId: true } }))?.contactId ?? null : null,
      },
    });

    this.logger.log(
      `Draft ${draft.id} created for ${businessId} (risk: ${options.riskTier ?? 'LOW'}, approval: ${requiresApproval})`,
    );

    return draft;
  }

  /**
   * TENANT SCOPING — every method below takes businessId FIRST, and it is required.
   *
   * These methods used to take a bare draftId and resolve it with
   * `where: { id: draftId }`. The route is
   * POST /api/communications/businesses/:businessId/drafts/:id/approve, guarded
   * by BusinessGuard — which validates that the caller belongs to the business
   * in the URL, and nothing more. The handler then took that parameter as
   * `_businessId` and discarded it.
   *
   * So an authenticated user of business A passed THEIR OWN businessId (guard
   * passes) with business B's draft id, and approved, rejected, edited or SENT
   * B's customer message. ResponseDraft carries a businessId column and is not
   * in BUSINESS_ID_MODELS, so no layer caught it.
   *
   * businessId is first and required so every existing caller fails to compile
   * until it supplies one — the same forcing function used on
   * createPlanFromGoal. `updateMany` is deliberate on the writes: it scopes in
   * the WHERE and returns a count, so a mismatched tenant is a 0 rather than a
   * P2025 that reads like a missing row.
   */
  async approveDraft(businessId: string, draftId: string, approvedById: string) {
    const { count } = await this.prisma.client.responseDraft.updateMany({
      where: { id: draftId, businessId },
      data: { status: 'APPROVED', approvedById },
    });
    if (count === 0) throw new NotFoundException('Draft not found');

    this.logger.log(`Draft ${draftId} approved by ${approvedById}`);
    return this.getDraftById(businessId, draftId);
  }

  async rejectDraft(businessId: string, draftId: string, reason: string) {
    const { count } = await this.prisma.client.responseDraft.updateMany({
      where: { id: draftId, businessId },
      data: {
        status: 'REJECTED',
        evidence: {
          ...(await this.getEvidence(draftId)),
          rejectionReason: reason,
        },
      },
    });
    if (count === 0) throw new NotFoundException('Draft not found');

    this.logger.log(`Draft ${draftId} rejected: ${reason}`);
    return this.getDraftById(businessId, draftId);
  }

  async sendDraft(businessId: string, draftId: string, sentById?: string) {
    // The worst of the six: this one puts a message in front of a customer.
    const draft = await this.prisma.client.responseDraft.findFirst({
      where: { id: draftId, businessId },
    });

    if (!draft) {
      throw new Error('Draft not found');
    }
    if (draft.status !== 'APPROVED') {
      throw new Error(`Cannot send draft with status ${draft.status}. Must be APPROVED.`);
    }

    let contactId = draft.contactId;
    if (!contactId && draft.threadId) {
      const thread = await this.prisma.client.conversationThread.findUnique({
        where: { id: draft.threadId },
        select: { contactId: true },
      });
      contactId = thread?.contactId ?? null;
    }
    if (!contactId) {
      throw new Error('Draft has no associated contact');
    }

    const channel = draft.channel as 'email' | 'whatsapp' | 'sms';
    if (!['email', 'whatsapp', 'sms'].includes(channel)) {
      throw new Error(`Unsupported channel: ${channel}`);
    }

    const result = await this.sender.sendMessage({
      businessId: draft.businessId,
      contactId,
      channel,
      body: draft.body,
    });

    if (!result.success) {
      throw new Error(result.error ?? 'Failed to send message');
    }

    const updated = await this.prisma.client.responseDraft.update({
      where: { id: draft.id },
      data: { status: 'SENT', sentAt: new Date() },
    });

    this.logger.log(`Draft ${draftId} sent via ${channel} to contact ${contactId}`);
    return updated;
  }

  async markSent(businessId: string, draftId: string) {
    const { count } = await this.prisma.client.responseDraft.updateMany({
      where: { id: draftId, businessId },
      data: { status: 'SENT', sentAt: new Date() },
    });
    if (count === 0) throw new NotFoundException('Draft not found');
    return this.getDraftById(businessId, draftId);
  }

  async listDrafts(
    businessId: string,
    filters?: { status?: string; channel?: string; riskTier?: string },
    pagination?: { skip?: number; take?: number },
  ) {
    const where: Record<string, unknown> = { businessId };
    if (filters?.status) where.status = filters.status;
    if (filters?.channel) where.channel = filters.channel;
    if (filters?.riskTier) where.riskTier = this.riskTierToNumber(filters.riskTier);

    const [items, total] = await Promise.all([
      this.prisma.client.responseDraft.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: pagination?.skip ?? 0,
        take: pagination?.take ?? 50,

      }),
      this.prisma.client.responseDraft.count({ where }),
    ]);

    return { items, total };
  }

  async getDraftById(businessId: string, draftId: string) {
    return this.prisma.client.responseDraft.findFirst({
      where: { id: draftId, businessId },
    });
  }

  async updateDraftBody(businessId: string, draftId: string, body: string, updatedById?: string) {
    const draft = await this.prisma.client.responseDraft.findFirst({
      where: { id: draftId, businessId },
    });
    if (!draft) throw new NotFoundException('Draft not found');

    const nextStatus = draft.status === 'APPROVED' ? 'PENDING_APPROVAL' : draft.status;

    const updated = await this.prisma.client.responseDraft.update({
      where: { id: draftId },
      data: {
        body,
        status: nextStatus,
        evidence: {
          ...(draft.evidence as Record<string, unknown>),
          lastEditedBy: updatedById ?? 'user',
          lastEditedAt: new Date().toISOString(),
        },
      },
    });

    this.logger.log(`Draft ${draftId} body updated by ${updatedById ?? 'user'}`);
    return updated;
  }

  private riskTierToNumber(tier: string): number {
    const map: Record<string, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
    return map[tier] ?? 2;
  }

  private async getEvidence(draftId: string): Promise<Record<string, unknown>> {
    const draft = await this.prisma.client.responseDraft.findUnique({
      where: { id: draftId },
      select: { evidence: true },
    });
    return (draft?.evidence as Record<string, unknown>) ?? {};
  }

  /**
   * Generate a smart draft body from an intent and optional template.
   */
  generateBody(intentType: string, context: Record<string, unknown>, tone = 'professional'): string {
    const t = tone;
    const name = (context.contactName as string) ?? 'there';

    switch (intentType) {
      case 'booking_request': {
        const date = (context.detectedDate as string) ?? 'your preferred time';
        return t === 'friendly'
          ? `Hi ${name}! We'd love to see you. Let me check ${date} and get back to you shortly.`
          : `Dear ${name}, thank you for your booking request. We are checking availability for ${date} and will confirm shortly.`;
      }
      case 'quote_request':
        return t === 'friendly'
          ? `Hi ${name}! Thanks for reaching out. I'm putting together a quote for you and will send it over shortly.`
          : `Dear ${name}, thank you for your interest. We are preparing a detailed quote for your requirements and will send it shortly.`;
      case 'payment_question':
        return t === 'friendly'
          ? `Hi ${name}! No worries, let me check your account and send the payment details right over.`
          : `Dear ${name}, we have received your inquiry. We will review your account and provide payment instructions shortly.`;
      case 'complaint':
        return t === 'empathetic'
          ? `Hi ${name}, I sincerely apologise for this experience. This is absolutely not the standard we hold ourselves to. I'm escalating this immediately and will personally follow up.`
          : `Dear ${name}, we sincerely apologise for the issue you've experienced. We take this very seriously and are investigating immediately. A member of our team will contact you within 24 hours.`;
      case 'support':
        return `Hi ${name}, thanks for reaching out. I'm looking into this for you and will get back to you as soon as I have an update.`;
      case 'new_lead':
        return t === 'friendly'
          ? `Hi ${name}! Great to hear from you. I'd love to learn more about what you're looking for. Can we schedule a quick call?`
          : `Dear ${name}, thank you for your interest in our services. We would be delighted to discuss how we can assist you. Please let us know a convenient time for a call.`;
      case 'review':
        return t === 'friendly'
          ? `Hi ${name}! If you enjoyed your experience, we'd love it if you could leave us a review. It means the world to us!`
          : `Dear ${name}, we would greatly appreciate it if you could take a moment to share your experience with us. Your feedback helps us improve.`;
      case 'referral':
        return `Hi ${name}! Thank you so much for thinking of us. We love referrals. We'll make sure to take great care of them.`;
      default:
        return `Hi ${name}, thank you for reaching out. We're reviewing your message and will respond shortly.`;
    }
  }
}
