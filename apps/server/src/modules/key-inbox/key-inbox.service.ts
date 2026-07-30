import { Inject, Injectable, Logger, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import type { KeyInboxInsight, KeyInboxMessage, KeyInboxThread } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiUsageService } from '../ai/ai-usage.service';
import { KeyInboxActionService } from './key-inbox-action.service';
import { KeyInboxAnalysisService } from './key-inbox-analysis.service';
import { KeyInboxTemporalEmitterService } from './key-inbox-temporal-emitter.service';
import { KeyInboxReplySenderService } from './key-inbox-reply-sender.service';
import { GenomeSignalService } from '../business-genome/key-genome/genome-signal.service';
import { KEY_INBOX_CHANNELS, normalizeKeyInboxChannel } from './key-inbox.constants';
import type { CreateInboxMessageInput, CreateInboxThreadInput, InboxAnalysis } from './key-inbox.types';

@Injectable()
export class KeyInboxService {
  private readonly logger = new Logger(KeyInboxService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KeyInboxAnalysisService) private readonly analysisService: KeyInboxAnalysisService,
    @Inject(KeyInboxActionService) private readonly actionService: KeyInboxActionService,
    @Inject(KeyInboxTemporalEmitterService) private readonly temporalEmitter: KeyInboxTemporalEmitterService,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
    @Inject(KeyInboxReplySenderService) private readonly replySender: KeyInboxReplySenderService,
    @Optional()
    @Inject(GenomeSignalService)
    private readonly genomeSignalService?: GenomeSignalService,
  ) {}

  async upsertThread(input: CreateInboxThreadInput): Promise<KeyInboxThread> {
    const channel = normalizeKeyInboxChannel(input.channel);
    const existing = input.externalThreadId
      ? await this.prisma.client.keyInboxThread.findFirst({
          where: {
            businessId: input.businessId,
            channel,
            externalThreadId: input.externalThreadId,
          },
        })
      : null;

    if (existing) return existing;

    try {
      return await this.prisma.client.keyInboxThread.create({
        data: {
          businessId: input.businessId,
          channel,
          externalThreadId: input.externalThreadId ?? null,
          contactId: input.contactId ?? null,
          subject: input.subject ?? null,
          status: input.status ?? 'OPEN',
          priority: input.priority ?? 'NORMAL',
          metadata: input.metadata ?? {},
        },
      });
    } catch (err: any) {
      if (input.externalThreadId && this.isUniqueConstraintError(err)) {
        const thread = await this.prisma.client.keyInboxThread.findFirst({
          where: { businessId: input.businessId, channel, externalThreadId: input.externalThreadId },
        });
        if (thread) return thread;
      }
      throw err;
    }
  }

  async addMessage(
    input: CreateInboxMessageInput & { threadId?: string },
  ): Promise<{ thread: KeyInboxThread; message: KeyInboxMessage }> {
    const channel = normalizeKeyInboxChannel(input.channel);

    if (input.externalMessageId) {
      const existingMessage = await this.prisma.client.keyInboxMessage.findFirst({
        where: { businessId: input.businessId, channel, externalMessageId: input.externalMessageId },
      });
      if (existingMessage) {
        const existingThread = await this.prisma.client.keyInboxThread.findFirst({
          where: { id: existingMessage.threadId, businessId: input.businessId },
        });
        if (existingThread) return { thread: existingThread, message: existingMessage };
      }
    }

    let thread: KeyInboxThread | null;

    if (input.threadId) {
      thread = await this.prisma.client.keyInboxThread.findFirst({
        where: { id: input.threadId, businessId: input.businessId },
      });
    } else {
      const subject = this.truncate(input.contentText ?? 'New message', 100);
      thread = await this.upsertThread({
        businessId: input.businessId,
        channel,
        externalThreadId: input.externalMessageId ?? null,
        contactId: null,
        subject,
        status: 'OPEN',
        priority: 'NORMAL',
        metadata: input.metadata ?? {},
      });
    }

    if (!thread) throw new NotFoundException('Thread not found');

    const receivedAt = input.receivedAt ?? new Date();

    try {
      const [message, updatedThread] = await this.prisma.client.$transaction([
      this.prisma.client.keyInboxMessage.create({
        data: {
          businessId: input.businessId,
          threadId: thread.id,
          channel,
          direction: input.direction,
          senderName: input.senderName ?? null,
          senderHandle: input.senderHandle ?? null,
          senderEmail: input.senderEmail ?? null,
          senderPhone: input.senderPhone ?? null,
          contentText: input.contentText ?? null,
          contentHtml: input.contentHtml ?? null,
          attachments: input.attachments ?? [],
          externalMessageId: input.externalMessageId ?? null,
          receivedAt: input.direction === 'INBOUND' ? receivedAt : input.receivedAt ?? null,
          sentAt: input.direction === 'OUTBOUND' ? (input.sentAt ?? new Date()) : input.sentAt ?? null,
          sendStatus: input.sendStatus ?? null,
          providerMessageId: input.providerMessageId ?? null,
          sendError: input.sendError ?? null,
          sentByUserId: input.sentByUserId ?? null,
          sentVia: input.sentVia ?? null,
        },
      }),
      this.prisma.client.keyInboxThread.update({
        where: { id: thread.id },
        data: {
          lastMessageAt: receivedAt,
          lastInboundAt: input.direction === 'INBOUND' ? receivedAt : undefined,
          lastOutboundAt: input.direction === 'OUTBOUND' ? (input.sentAt ?? new Date()) : undefined,
        },
      }),
    ]);

    await this.temporalEmitter.emitMessageReceived(input.businessId, message);

    if (!input.skipAnalysis) {
      try {
        await this.analyzeMessage(input.businessId, message.id);
        await this.analyzeThread(input.businessId, thread.id);
      } catch (err: any) {
        this.logger.warn(`Background analysis failed for message ${message.id}: ${(err as Error).message}`);
      }
    }

      return { thread: updatedThread, message };
    } catch (err: any) {
      if (input.externalMessageId && this.isUniqueConstraintError(err)) {
        const existingMessage = await this.prisma.client.keyInboxMessage.findFirst({
          where: { businessId: input.businessId, channel, externalMessageId: input.externalMessageId },
        });
        if (existingMessage) {
          const existingThread = await this.prisma.client.keyInboxThread.findFirst({
            where: { id: existingMessage.threadId, businessId: input.businessId },
          });
          if (existingThread) return { thread: existingThread, message: existingMessage };
        }
      }
      throw err;
    }
  }

  private isUniqueConstraintError(err: unknown): boolean {
    return err instanceof Error && /unique constraint/i.test(err.message);
  }

  async analyzeMessage(businessId: string, messageId: string): Promise<KeyInboxMessage> {
    const message = await this.prisma.client.keyInboxMessage.findFirst({
      where: { id: messageId, businessId },
    });
    if (!message) throw new NotFoundException('Message not found');

    const content = message.contentText ?? '';
    const thread = await this.prisma.client.keyInboxThread.findFirst({
      where: { id: message.threadId, businessId },
    });

    const analysis = await this.analysisService.analyzeMessage(businessId, content, {
      subject: thread?.subject ?? undefined,
      channel: message.channel,
    });

    const actions = await this.actionService.buildActions(analysis);

    const updated = await this.prisma.client.keyInboxMessage.update({
      where: { id: messageId },
      data: {
        aiAnalysis: analysis as unknown as Record<string, unknown>,
        extractedEntities: analysis.entities as Record<string, unknown>,
        suggestedActions: actions as unknown as Record<string, unknown>[],
        aiConfidence: analysis.confidence,
      },
    });

    if (thread) {
      await this.temporalEmitter.emitMessageAnalyzed(businessId, thread, analysis);
      await this.temporalEmitter.emitActionSuggested(businessId, thread, actions);
    }

    return updated;
  }

  async analyzeThread(businessId: string, threadId: string): Promise<KeyInboxThread> {
    const thread = await this.prisma.client.keyInboxThread.findFirst({
      where: { id: threadId, businessId },
      include: { messages: { orderBy: { receivedAt: 'asc' } } },
    });
    if (!thread) throw new NotFoundException('Thread not found');

    const analysis = await this.analysisService.analyzeThread(
      businessId,
      thread.messages,
      { subject: thread.subject ?? undefined, channel: thread.channel },
    );

    const tags = this.buildTags(analysis);

    const updated = await this.prisma.client.keyInboxThread.update({
      where: { id: threadId },
      data: {
        aiSummary: analysis.summary,
        aiIntent: analysis.intent,
        aiSentiment: analysis.sentiment,
        aiUrgency: analysis.urgency,
        aiTags: tags,
        priority: this.urgencyToPriority(analysis.urgency),
      },
    });

    const actions = await this.actionService.buildActions(analysis);
    await this.temporalEmitter.emitMessageAnalyzed(businessId, updated, analysis);
    await this.temporalEmitter.emitActionSuggested(businessId, updated, actions);

    // Strong intent/urgency/sentiment becomes a genome signal for the business DNA.
    if (this.genomeSignalService && this.isStrongSignal(analysis)) {
      this.createInboxGenomeSignal(businessId, updated.id, analysis).catch((err: unknown) => {
        this.logger.warn(`Inbox genome signal failed for thread ${threadId}: ${err instanceof Error ? err.message : String(err)}`);
      });
    }

    return updated;
  }

  async listThreads(
    businessId: string,
    filters?: {
      channel?: string;
      status?: string;
      priority?: string;
      intent?: string;
      urgency?: string;
      sentiment?: string;
      sendStatus?: string;
      search?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<KeyInboxThread[]> {
    const where: Record<string, unknown> = { businessId };
    if (filters?.channel) where.channel = filters.channel;
    if (filters?.status) where.status = filters.status;
    if (filters?.priority) where.priority = filters.priority;
    if (filters?.intent) where.aiIntent = filters.intent;
    if (filters?.urgency) where.aiUrgency = filters.urgency;
    if (filters?.sentiment) where.aiSentiment = filters.sentiment;

    if (filters?.sendStatus) {
      where.messages = {
        some: {
          direction: 'OUTBOUND',
          sendStatus: filters.sendStatus,
        },
      };
    }

    if (filters?.search?.trim()) {
      const term = filters.search.trim();
      where.OR = [
        { subject: { contains: term, mode: 'insensitive' } },
        { messages: { some: { contentText: { contains: term, mode: 'insensitive' } } } },
      ];
    }

    return this.prisma.client.keyInboxThread.findMany({
      where,
      orderBy: { lastMessageAt: 'desc' },
      take: filters?.limit ?? 50,
      skip: filters?.offset ?? 0,
    });
  }

  async updateThread(
    businessId: string,
    threadId: string,
    patch: {
      subject?: string;
      status?: 'OPEN' | 'WAITING' | 'DONE' | 'ARCHIVED';
      priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
      metadata?: Record<string, unknown>;
    },
  ): Promise<KeyInboxThread> {
    const thread = await this.prisma.client.keyInboxThread.findFirst({
      where: { id: threadId, businessId },
    });
    if (!thread) throw new NotFoundException('Thread not found');

    const existingMetadata = (thread.metadata as Record<string, unknown>) ?? {};
    return this.prisma.client.keyInboxThread.update({
      where: { id: threadId },
      data: {
        subject: patch.subject,
        status: patch.status,
        priority: patch.priority,
        metadata: patch.metadata ? { ...existingMetadata, ...patch.metadata } : undefined,
      },
    });
  }

  async addReply(
    businessId: string,
    threadId: string,
    contentText: string,
    attachments?: Record<string, unknown>[],
    opts?: { mode?: 'draft' | 'send'; userId?: string },
  ): Promise<{ thread: KeyInboxThread; message: KeyInboxMessage; sendResult?: { success: boolean; status: string; error?: string } }> {
    const thread = await this.prisma.client.keyInboxThread.findFirst({
      where: { id: threadId, businessId },
    });
    if (!thread) throw new NotFoundException('Thread not found');

    const mode = opts?.mode ?? 'draft';
    const userId = opts?.userId;

    const result = await this.addMessage({
      businessId,
      threadId,
      channel: thread.channel,
      direction: 'OUTBOUND',
      contentText,
      attachments,
      sendStatus: mode === 'draft' ? 'DRAFT' : 'QUEUED',
      sentByUserId: userId,
      sentVia: 'key_inbox',
      metadata: { source: 'key_inbox_reply' },
    });

    if (mode === 'draft') {
      this.replySender.emitDraftEvent(businessId, thread.id, result.message.id, userId);
      return result;
    }

    const sendResult = await this.replySender.sendReply(businessId, thread, result.message, userId);
    return {
      ...result,
      sendResult: {
        success: sendResult.success,
        status: sendResult.status,
        error: sendResult.error,
      },
    };
  }

  async getThread(
    businessId: string,
    threadId: string,
  ): Promise<(KeyInboxThread & { messages: KeyInboxMessage[] }) | null> {
    return this.prisma.client.keyInboxThread.findFirst({
      where: { id: threadId, businessId },
      include: {
        messages: {
          orderBy: { receivedAt: 'desc' },
        },
      },
    });
  }

  async generateBrief(
    businessId: string,
    scope: 'DAILY' | 'WEEKLY' | 'CUSTOM',
    periodStart?: Date,
    periodEnd?: Date,
  ): Promise<KeyInboxInsight> {
    const { start, end } = this.resolvePeriod(scope, periodStart, periodEnd);

    const [threads, messages] = await Promise.all([
      this.prisma.client.keyInboxThread.findMany({
        where: { businessId, lastMessageAt: { gte: start, lte: end } },
      }),
      this.prisma.client.keyInboxMessage.findMany({
        where: { businessId, receivedAt: { gte: start, lte: end } },
      }),
    ]);

    const inboundMessages = messages.filter((m) => m.direction === 'INBOUND');
    const outboundMessages = messages.filter((m) => m.direction === 'OUTBOUND');
    const intents = new Map<string, number>();
    const urgencies = new Map<string, number>();

    for (const message of messages) {
      const analysis = message.aiAnalysis as Record<string, unknown> | null;
      if (analysis?.intent) {
        intents.set(String(analysis.intent), (intents.get(String(analysis.intent)) ?? 0) + 1);
      }
      if (analysis?.urgency) {
        urgencies.set(String(analysis.urgency), (urgencies.get(String(analysis.urgency)) ?? 0) + 1);
      }
    }

    const prompt = `Summarize the following inbox activity for a business.
Period: ${start.toISOString()} to ${end.toISOString()}
Threads: ${threads.length}
Inbound messages: ${inboundMessages.length}
Outbound messages: ${outboundMessages.length}
Intents: ${JSON.stringify(Object.fromEntries(intents))}
Urgencies: ${JSON.stringify(Object.fromEntries(urgencies))}

Return ONLY valid JSON:
{
  "summary": "1-2 sentence overview",
  "keyFindings": ["finding 1", ...],
  "recommendations": ["recommendation 1", ...],
  "taskSuggestions": ["task 1", ...],
  "metrics": { "threads": 0, "inbound": 0, "outbound": 0, "highUrgency": 0 }
}`;

    let brief: { summary: string; keyFindings: string[]; recommendations: string[]; taskSuggestions: string[]; metrics: Record<string, number> };

    try {
      const response = await this.aiUsage.trackAndComplete(
        businessId,
        undefined,
        'key_inbox_brief',
        {
          messages: [{ role: 'system', content: prompt }],
          taskCategory: 'summarization',
          temperature: 0.3,
          maxTokens: 1200,
        },
      );

      const raw = (response.content ?? '').trim();
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw) as Partial<typeof brief>;

      brief = {
        summary: typeof parsed.summary === 'string' ? parsed.summary : `Inbox brief for ${scope.toLowerCase()} period.`,
        keyFindings: Array.isArray(parsed.keyFindings) ? parsed.keyFindings.map(String) : [],
        recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.map(String) : [],
        taskSuggestions: Array.isArray(parsed.taskSuggestions) ? parsed.taskSuggestions.map(String) : [],
        metrics: parsed.metrics && typeof parsed.metrics === 'object' ? (parsed.metrics as Record<string, number>) : {},
      };
    } catch (err: any) {
      this.logger.warn(`Brief generation failed: ${(err as Error).message}`);
      brief = {
        summary: `Inbox brief for ${scope.toLowerCase()} period.`,
        keyFindings: [`${threads.length} threads`, `${inboundMessages.length} inbound messages`],
        recommendations: [],
        taskSuggestions: [],
        metrics: {
          threads: threads.length,
          inbound: inboundMessages.length,
          outbound: outboundMessages.length,
          highUrgency: (urgencies.get('high') ?? 0) + (urgencies.get('urgent') ?? 0),
        },
      };
    }

    const insight = await this.prisma.client.keyInboxInsight.create({
      data: {
        businessId,
        periodStart: start,
        periodEnd: end,
        scope,
        summary: brief.summary,
        keyFindings: brief.keyFindings,
        recommendations: brief.recommendations,
        taskSuggestions: brief.taskSuggestions,
        metrics: brief.metrics,
      },
    });

    await this.temporalEmitter.emitBriefGenerated(businessId, insight.id, scope, start, end);

    return insight;
  }

  async listInsights(businessId: string, scope?: string, limit?: number): Promise<KeyInboxInsight[]> {
    return this.prisma.client.keyInboxInsight.findMany({
      where: { businessId, scope },
      orderBy: { createdAt: 'desc' },
      take: limit ?? 20,
    });
  }

  private buildTags(analysis: InboxAnalysis): string[] {
    const tags = new Set<string>();
    tags.add(analysis.intent);
    tags.add(analysis.sentiment);
    tags.add(analysis.urgency);
    for (const [key, values] of Object.entries(analysis.entities)) {
      if (Array.isArray(values) && values.length > 0) {
        tags.add(`entity:${key}`);
      }
    }
    return Array.from(tags);
  }

  private urgencyToPriority(urgency: string): 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT' {
    switch (urgency) {
      case 'urgent':
        return 'URGENT';
      case 'high':
        return 'HIGH';
      case 'low':
        return 'LOW';
      case 'normal':
      default:
        return 'NORMAL';
    }
  }

  private resolvePeriod(
    scope: 'DAILY' | 'WEEKLY' | 'CUSTOM',
    periodStart?: Date,
    periodEnd?: Date,
  ): { start: Date; end: Date } {
    const now = new Date();

    if (scope === 'CUSTOM') {
      if (!periodStart || !periodEnd) {
        throw new BadRequestException('Custom scope requires periodStart and periodEnd');
      }
      return { start: periodStart, end: periodEnd };
    }

    if (scope === 'DAILY') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      return { start, end: now };
    }

    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { start, end: now };
  }

  private truncate(text: string, maxLength: number): string {
    if (!text) return '';
    return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
  }

  private isStrongSignal(analysis: InboxAnalysis): boolean {
    const strongIntents = ['complaint', 'refund', 'cancellation', 'urgent_request', 'escalation', 'booking_request'];
    const strongUrgencies = ['urgent', 'high'];
    const strongSentiments = ['angry', 'frustrated', 'negative'];

    return (
      strongIntents.includes(analysis.intent?.toLowerCase()) ||
      strongUrgencies.includes(analysis.urgency?.toLowerCase()) ||
      strongSentiments.includes(analysis.sentiment?.toLowerCase())
    );
  }

  private async createInboxGenomeSignal(
    businessId: string,
    threadId: string,
    analysis: InboxAnalysis,
  ): Promise<void> {
    if (!this.genomeSignalService) return;

    const intent = analysis.intent?.toLowerCase() ?? 'general';
    let section = 'operations';
    let domain = 'inbox';
    let field: string | undefined = 'strong_intent';
    let signalType = 'CUSTOMER_PATTERN';

    if (intent.includes('complaint') || intent.includes('refund')) {
      section = 'risk';
      domain = 'reputation';
      field = 'complaint_intent';
      signalType = 'RISK_PATTERN';
    } else if (intent.includes('booking') || intent.includes('appointment')) {
      section = 'operations';
      domain = 'bookings';
      field = 'booking_intent';
      signalType = 'OPERATIONS_PATTERN';
    } else if (intent.includes('invoice') || intent.includes('payment')) {
      section = 'sales';
      domain = 'requests';
      field = 'invoice_request';
      signalType = 'REVENUE_PATTERN';
    }

    await this.genomeSignalService.createSignal({
      businessId,
      sourceModule: 'key_inbox',
      sourceEntityType: 'KeyInboxThread',
      sourceEntityId: threadId,
      signalType,
      section,
      domain,
      field,
      proposedValue: { intent: analysis.intent, urgency: analysis.urgency, sentiment: analysis.sentiment },
      reason: `Inbox thread ${threadId} shows strong ${analysis.intent} intent (${analysis.urgency} urgency, ${analysis.sentiment} sentiment)`,
      evidence: [
        {
          sourceModule: 'key_inbox',
          sourceEntityType: 'KeyInboxThread',
          sourceEntityId: threadId,
          summary: `Intent: ${analysis.intent}, urgency: ${analysis.urgency}, sentiment: ${analysis.sentiment}`,
          evidenceStrength: 0.8,
        },
      ],
      confidence: 0.8,
    });
  }
}
