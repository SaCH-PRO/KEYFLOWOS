import { Injectable, Inject, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TemporalFlowService } from './temporal-flow.service';
import type { TemporalFlowEventInput, TemporalFlowImportance } from './temporal-flow.types';

interface KeyInboxMessageReceivedPayload {
  businessId: string;
  messageId: string;
  threadId: string;
  channel: string;
  direction: string;
  senderHandle?: string | null;
  senderEmail?: string | null;
  receivedAt?: Date | string | null;
}

interface KeyInboxMessageAnalyzedPayload {
  businessId: string;
  threadId: string;
  intent?: string | null;
  sentiment?: string | null;
  urgency?: string | null;
  confidence?: number | null;
  summary?: string | null;
  entities?: Record<string, unknown>;
}

interface KeyInboxActionsSuggestedPayload {
  businessId: string;
  threadId: string;
  actions: Array<{ type: string; confidence?: number }>;
}

interface KeyInboxInsightPayload {
  businessId: string;
  insightId: string;
  scope: string;
  periodStart: Date | string;
  periodEnd: Date | string;
  insight?: {
    type?: string;
    severity?: string;
    title?: string;
    description?: string;
  };
  signal?: {
    signalType?: string;
    section?: string;
    domain?: string;
    field?: string;
    confidence?: number;
    reason?: string;
  };
}

@Injectable()
export class TemporalFlowKeyInboxListener {
  private readonly logger = new Logger(TemporalFlowKeyInboxListener.name);

  constructor(
    @Inject(TemporalFlowService) private readonly temporalFlow: TemporalFlowService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @OnEvent('key_inbox.message_received')
  async onMessageReceived(payload: KeyInboxMessageReceivedPayload): Promise<void> {
    const thread = await this.getThread(payload.threadId);
    const source = this.normalizeSource(payload.channel);
    const title = `${source} message ${payload.direction?.toLowerCase() === 'outbound' ? 'sent' : 'received'}`;

    await this.emit({
      businessId: payload.businessId,
      source,
      type: 'key_inbox.message_received',
      title,
      summary: payload.senderHandle ?? payload.senderEmail ?? undefined,
      occurredAt: payload.receivedAt ? new Date(payload.receivedAt) : new Date(),
      threadId: payload.threadId,
      messageId: payload.messageId,
      contactId: thread?.contactId ?? undefined,
      payload: {
        channel: payload.channel,
        direction: payload.direction,
        senderHandle: payload.senderHandle,
        senderEmail: payload.senderEmail,
      },
    });
  }

  @OnEvent('key_inbox.message_analyzed')
  async onMessageAnalyzed(payload: KeyInboxMessageAnalyzedPayload): Promise<void> {
    const thread = await this.getThread(payload.threadId);
    const source = this.normalizeSource(thread?.channel);

    await this.emit({
      businessId: payload.businessId,
      source,
      type: 'key_inbox.message_analyzed',
      title: payload.summary ? `Analysis: ${payload.summary.slice(0, 80)}` : 'Message analyzed',
      occurredAt: new Date(),
      threadId: payload.threadId,
      contactId: thread?.contactId ?? undefined,
      importance: this.importanceFromUrgency(payload.urgency),
      payload: {
        intent: payload.intent,
        sentiment: payload.sentiment,
        urgency: payload.urgency,
        confidence: payload.confidence,
        entities: payload.entities,
      },
      genomeImpactPotential: this.isGenomeWorthyIntent(payload.intent),
    });
  }

  @OnEvent('key_inbox.actions_suggested')
  async onActionsSuggested(payload: KeyInboxActionsSuggestedPayload): Promise<void> {
    const thread = await this.getThread(payload.threadId);
    const source = this.normalizeSource(thread?.channel);

    await this.emit({
      businessId: payload.businessId,
      source,
      type: 'key_inbox.actions_suggested',
      title: `${payload.actions.length} action(s) suggested`,
      occurredAt: new Date(),
      threadId: payload.threadId,
      contactId: thread?.contactId ?? undefined,
      payload: {
        actions: payload.actions.map((a) => a.type),
        topAction: payload.actions[0]?.type,
      },
    });
  }

  @OnEvent('key_inbox.brief_generated')
  async onBriefGenerated(payload: KeyInboxInsightPayload): Promise<void> {
    await this.emit({
      businessId: payload.businessId,
      source: 'key_inbox',
      type: 'key_inbox.brief_generated',
      title: `KEYInbox ${payload.scope} brief generated`,
      occurredAt: new Date(payload.periodEnd),
      externalId: `key-inbox:brief:${payload.insightId}`,
      payload: { scope: payload.scope, periodStart: payload.periodStart, periodEnd: payload.periodEnd },
    });
  }

  @OnEvent('key_inbox.intelligence_generated')
  async onIntelligenceGenerated(payload: KeyInboxInsightPayload): Promise<void> {
    await this.emit({
      businessId: payload.businessId,
      source: 'key_inbox',
      type: 'key_inbox.intelligence_generated',
      title: `KEYInbox intelligence report generated`,
      occurredAt: new Date(payload.periodEnd),
      externalId: `key-inbox:intelligence:${payload.insightId}`,
      payload: { scope: payload.scope, generatedBy: (payload as any).generatedBy },
    });
  }

  @OnEvent('key_inbox.trend_detected')
  async onTrendDetected(payload: KeyInboxInsightPayload): Promise<void> {
    const trend = (payload as any).trend;
    await this.emit({
      businessId: payload.businessId,
      source: 'key_inbox',
      type: 'key_inbox.trend_detected',
      title: `Trend: ${(payload as any).metricKey}`,
      occurredAt: new Date(payload.periodEnd),
      externalId: `key-inbox:trend:${payload.insightId}:${(payload as any).metricKey}`,
      payload: { metricKey: (payload as any).metricKey, trend },
    });
  }

  @OnEvent('key_inbox.opportunity_detected')
  async onOpportunityDetected(payload: KeyInboxInsightPayload): Promise<void> {
    await this.emitInsightEvent(payload, 'key_inbox.opportunity_detected', 'OPPORTUNITY');
  }

  @OnEvent('key_inbox.risk_detected')
  async onRiskDetected(payload: KeyInboxInsightPayload): Promise<void> {
    await this.emitInsightEvent(payload, 'key_inbox.risk_detected', 'RISK');
  }

  @OnEvent('key_inbox.genome_signal_detected')
  async onGenomeSignalDetected(payload: KeyInboxInsightPayload): Promise<void> {
    const signal = payload.signal;
    if (!signal) return;

    await this.emit({
      businessId: payload.businessId,
      source: 'key_inbox',
      type: 'key_inbox.genome_signal_detected',
      title: `Genome signal: ${signal.signalType}`,
      occurredAt: new Date(payload.periodEnd),
      externalId: `key-inbox:genome:${payload.insightId}`,
      importance: signal.confidence && signal.confidence > 0.7 ? 'HIGH' : 'NORMAL',
      genomeImpactPotential: true,
      payload: {
        signalType: signal.signalType,
        section: signal.section,
        domain: signal.domain,
        field: signal.field,
        confidence: signal.confidence,
        reason: signal.reason,
      },
    });
  }

  private async emitInsightEvent(
    payload: KeyInboxInsightPayload,
    type: string,
    classification: 'OPPORTUNITY' | 'RISK',
  ): Promise<void> {
    const insight = payload.insight;
    await this.emit({
      businessId: payload.businessId,
      source: 'key_inbox',
      type,
      title: insight?.title ?? `${classification} detected`,
      summary: insight?.description ?? undefined,
      occurredAt: new Date(payload.periodEnd),
      externalId: `key-inbox:${type}:${payload.insightId}`,
      importance: this.importanceFromSeverity(insight?.severity),
      genomeImpactPotential: true,
      payload: {
        insightType: insight?.type,
        severity: insight?.severity,
        classification,
      },
    });
  }

  private async emit(input: TemporalFlowEventInput & { externalId?: string }): Promise<void> {
    try {
      await this.temporalFlow.emit({
        ...input,
        externalId: input.externalId ?? this.externalId(input),
        module: 'key_inbox',
      });
    } catch (err: any) {
      this.logger.warn(`Failed to emit temporal flow event: ${(err as Error).message}`);
    }
  }

  private externalId(input: TemporalFlowEventInput): string {
    const parts = ['key-inbox', input.type, input.threadId ?? input.messageId ?? input.entityId].filter(Boolean);
    return parts.join(':');
  }

  private async getThread(threadId: string) {
    return this.prisma.client.keyInboxThread.findUnique({
      where: { id: threadId },
      select: { id: true, channel: true, contactId: true },
    });
  }

  private normalizeSource(channel?: string | null): string {
    if (!channel) return 'key_inbox';
    return channel.toLowerCase();
  }

  private importanceFromUrgency(urgency?: string | null): TemporalFlowImportance {
    switch (urgency?.toUpperCase()) {
      case 'URGENT':
      case 'HIGH':
        return 'HIGH';
      case 'CRITICAL':
        return 'CRITICAL';
      default:
        return 'NORMAL';
    }
  }

  private importanceFromSeverity(severity?: string | null): TemporalFlowImportance {
    switch (severity?.toUpperCase()) {
      case 'HIGH':
        return 'HIGH';
      case 'CRITICAL':
        return 'CRITICAL';
      default:
        return 'NORMAL';
    }
  }

  private isGenomeWorthyIntent(intent?: string | null): boolean {
    if (!intent) return false;
    const worthy = ['lead_inquiry', 'complaint', 'invoice_request', 'booking_request', 'support_request'];
    return worthy.includes(intent.toLowerCase());
  }
}
