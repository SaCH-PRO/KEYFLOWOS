/**
 * Sentiment Watcher — Phase D.1
 *
 * Monitors recent inbound messages (KeyInbox, direct messages, and general
 * Message rows) for negative sentiment using a rule-based keyword scan.
 * An optional LLM pass can be enabled for higher-confidence classification.
 * Emits proactive.negative_sentiment events when negative signals are found.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ModelGatewayService } from '../../ai/model-gateway.service';
import { KeyCortexEventBusService } from '../key-cortex-event-bus.service';

export interface SentimentDetectionResult {
  detected: boolean;
  score: number; // 0..1
  keywords: string[];
  llmReason?: string;
}

interface MessageRow {
  id: string;
  channel: string;
  contentText?: string | null;
  content?: string | null;
  direction?: string;
  receivedAt?: Date | null;
  createdAt: Date;
  senderName?: string | null;
  senderEmail?: string | null;
  threadId?: string | null;
  contactId?: string | null;
}

@Injectable()
export class SentimentWatcherService {
  private readonly logger = new Logger(SentimentWatcherService.name);

  private readonly negativeKeywords = [
    'angry',
    'annoyed',
    'terrible',
    'awful',
    'horrible',
    'hate',
    'disappointed',
    'frustrated',
    'unacceptable',
    'ridiculous',
    'worst',
    'never again',
    'cancel',
    'refund',
    'complaint',
    'bad service',
    'not happy',
    'poor',
    'disgusting',
    'scam',
    'fraud',
    'waste of money',
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: KeyCortexEventBusService,
    @Optional()
    private readonly modelGateway?: ModelGatewayService,
  ) {}

  /**
   * Scan recent inbound messages for a business and emit negative-sentiment
   * events. Returns the number of events emitted.
   */
  async scan(businessId: string): Promise<number> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const messages = await this.loadRecentMessages(businessId, since);

    let emitted = 0;
    for (const message of messages) {
      const text = (message.contentText ?? message.content ?? '').toLowerCase();
      if (!text.trim()) continue;

      const detection = await this.detectSentiment(text);
      if (!detection.detected) continue;

      await this.eventBus.publish({
        source: 'proactive_watcher',
        type: 'proactive.negative_sentiment',
        businessId,
        payload: {
          messageId: message.id,
          channel: message.channel,
          threadId: message.threadId ?? null,
          contactId: message.contactId ?? null,
          senderName: message.senderName ?? null,
          senderEmail: message.senderEmail ?? null,
          snippet: text.slice(0, 300),
          score: detection.score,
          keywords: detection.keywords,
          llmReason: detection.llmReason,
          receivedAt: message.receivedAt ?? message.createdAt,
        },
        metadata: {
          entityType: 'KeyInboxMessage',
          entityId: message.id,
          importance: detection.score > 0.8 ? 'high' : 'normal',
        },
      });

      emitted++;
    }

    this.logger.debug(
      `[scan] ${businessId}: emitted ${emitted} negative sentiment event(s) from ${messages.length} message(s)`,
    );
    return emitted;
  }

  /**
   * Scan all active businesses and return the total number of events emitted.
   */
  async scanAll(): Promise<number> {
    const businessIds = await this.getActiveBusinesses();
    let total = 0;

    for (const businessId of businessIds) {
      try {
        total += await this.scan(businessId);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[scanAll] failed for ${businessId}: ${msg}`);
      }
    }

    return total;
  }

  /**
   * Rule-based sentiment detection with optional LLM confirmation.
   */
  async detectSentiment(text: string): Promise<SentimentDetectionResult> {
    const lower = text.toLowerCase();
    const keywords = this.negativeKeywords.filter((k) => lower.includes(k));

    if (keywords.length === 0) {
      return { detected: false, score: 0, keywords: [] };
    }

    let score = Math.min(1, 0.4 + keywords.length * 0.15);
    let llmReason: string | undefined;

    if (this.modelGateway) {
      try {
        const llmResult = await this.classifyWithLlm(text);
        if (llmResult.negative) {
          score = Math.max(score, llmResult.confidence);
          llmReason = llmResult.reason;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[detectSentiment] LLM classification failed: ${msg}`);
      }
    }

    return { detected: score >= 0.4, score, keywords, llmReason };
  }

  private async loadRecentMessages(
    businessId: string,
    since: Date,
  ): Promise<MessageRow[]> {
    try {
      const [keyInboxMessages, directMessages, genericMessages] = await Promise.all([
        (this.prisma.client as any).keyInboxMessage
          ? (this.prisma.client as any).keyInboxMessage.findMany({
              where: {
                businessId,
                direction: 'INBOUND',
                receivedAt: { gte: since },
              },
              select: {
                id: true,
                channel: true,
                contentText: true,
                direction: true,
                receivedAt: true,
                createdAt: true,
                senderName: true,
                senderEmail: true,
                threadId: true,
              },
              orderBy: { receivedAt: 'desc' },
              take: 200,
            })
          : Promise.resolve([]),
        (this.prisma.client as any).directMessage
          ? (this.prisma.client as any).directMessage.findMany({
              where: {
                conversation: {
                  OR: [
                    { participantAId: businessId },
                    { participantBId: businessId },
                  ],
                },
                senderBusinessId: { not: businessId },
                createdAt: { gte: since },
              },
              select: {
                id: true,
                content: true,
                createdAt: true,
                senderBusinessId: true,
              },
              orderBy: { createdAt: 'desc' },
              take: 100,
            })
          : Promise.resolve([]),
        (this.prisma.client as any).message
          ? (this.prisma.client as any).message.findMany({
              where: {
                businessId,
                direction: 'inbound',
                createdAt: { gte: since },
              },
              select: {
                id: true,
                channel: true,
                content: true,
                direction: true,
                createdAt: true,
                recipientId: true,
              },
              orderBy: { createdAt: 'desc' },
              take: 100,
            })
          : Promise.resolve([]),
      ]);

      const normalized: MessageRow[] = [
        ...(keyInboxMessages as any[]).map((m) => ({
          id: m.id,
          channel: m.channel,
          contentText: m.contentText,
          direction: m.direction,
          receivedAt: m.receivedAt,
          createdAt: m.createdAt,
          senderName: m.senderName,
          senderEmail: m.senderEmail,
          threadId: m.threadId,
          contactId: null,
        })),
        ...(directMessages as any[]).map((m) => ({
          id: m.id,
          channel: 'direct_message',
          contentText: m.content,
          direction: 'INBOUND',
          receivedAt: m.createdAt,
          createdAt: m.createdAt,
          senderName: null,
          senderEmail: null,
          threadId: null,
          contactId: null,
        })),
        ...(genericMessages as any[]).map((m) => ({
          id: m.id,
          channel: m.channel,
          contentText: m.content,
          direction: m.direction,
          receivedAt: m.createdAt,
          createdAt: m.createdAt,
          senderName: null,
          senderEmail: null,
          threadId: null,
          contactId: m.recipientId,
        })),
      ];

      return normalized.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[loadRecentMessages] ${businessId}: ${msg}`);
      return [];
    }
  }

  private async classifyWithLlm(
    text: string,
  ): Promise<{ negative: boolean; confidence: number; reason: string }> {
    const prompt = `Classify whether the following customer message expresses negative sentiment. Reply with exactly one line in this format: NEGATIVE:<score>:<reason> or NEUTRAL:<score>:<reason> where score is 0.0-1.0.

Message: "${text.replace(/"/g, '\\"').slice(0, 500)}"`;

    const result = await (this.modelGateway as any).complete(prompt, {
      model: 'gpt-4o-mini',
      maxTokens: 80,
      temperature: 0,
    });

    const response = ((result as any).text ?? '').trim();
    const negativeMatch = response.match(/NEGATIVE:([0-9.]+):(.+)/i);
    if (negativeMatch) {
      return {
        negative: true,
        confidence: Math.min(1, Math.max(0, parseFloat(negativeMatch[1]))),
        reason: negativeMatch[2].trim(),
      };
    }

    const neutralMatch = response.match(/NEUTRAL:([0-9.]+):(.+)/i);
    if (neutralMatch) {
      return {
        negative: false,
        confidence: Math.min(1, Math.max(0, parseFloat(neutralMatch[1]))),
        reason: neutralMatch[2].trim(),
      };
    }

    return { negative: false, confidence: 0, reason: '' };
  }

  private async getActiveBusinesses(): Promise<string[]> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    try {
      const businesses = await (this.prisma.client as any).business.findMany({
        where: {
          autopilotEnabled: true,
          OR: [
            {
              subscriptions: {
                some: {
                  status: { in: ['ACTIVE', 'TRIALING'] },
                },
              },
            },
            {
              cortexSessions: {
                some: {
                  updatedAt: { gte: sevenDaysAgo },
                },
              },
            },
            {
              aiUsageLogs: {
                some: {
                  createdAt: { gte: sevenDaysAgo },
                },
              },
            },
          ],
        },
        select: { id: true },
        take: 500,
        distinct: ['id'],
      });

      return businesses.map((b: { id: string }) => b.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[getActiveBusinesses] Failed: ${msg}`);
      return [];
    }
  }
}
