import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SemanticMemoryService } from '../ai/semantic-memory.service';
import type {
  CreateTemporalFlowMemoryInput,
  TemporalFlowMemoryData,
  TemporalFlowMemoryQuery,
} from './temporal-flow-memory.types';

const EMBEDDING_CONFIDENCE_THRESHOLD = 0.7;

@Injectable()
export class TemporalFlowMemoryService {
  private readonly logger = new Logger(TemporalFlowMemoryService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SemanticMemoryService) private readonly semanticMemory: SemanticMemoryService,
  ) {}

  async createMemory(input: CreateTemporalFlowMemoryInput): Promise<TemporalFlowMemoryData> {
    const existing = await this.prisma.client.temporalFlowMemory.findFirst({
      where: {
        businessId: input.businessId,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        type: input.type,
      },
    });

    const data = {
      content: input.content,
      sourceEventIds: input.sourceEventIds ?? [],
      sourceModule: input.sourceModule,
      metadata: input.metadata ?? {},
      confidence: input.confidence ?? 0.5,
    };

    let record;
    if (existing) {
      record = await this.prisma.client.temporalFlowMemory.update({
        where: { id: existing.id },
        data,
      });
    } else {
      record = await this.prisma.client.temporalFlowMemory.create({
        data: {
          businessId: input.businessId,
          entityType: input.entityType,
          entityId: input.entityId ?? null,
          type: input.type,
          ...data,
        },
      });
    }

    if (record.confidence >= EMBEDDING_CONFIDENCE_THRESHOLD) {
      try {
        await this.semanticMemory.store({
          businessId: record.businessId,
          content: `${record.entityType}:${record.type} — ${record.content}`,
          sourceType: 'temporal_memory',
          sourceId: record.id,
          metadata: {
            entityType: record.entityType,
            entityId: record.entityId,
            type: record.type,
            sourceModule: record.sourceModule,
            confidence: record.confidence,
          },
        });
      } catch (err) {
        this.logger.warn(`Embedding failed for memory ${record.id}: ${(err as Error).message}`);
      }
    }

    return record;
  }

  async findByEntity(
    businessId: string,
    entityType: string,
    entityId?: string,
  ): Promise<TemporalFlowMemoryData[]> {
    return this.prisma.client.temporalFlowMemory.findMany({
      where: {
        businessId,
        entityType,
        ...(entityId !== undefined ? { entityId: entityId ?? null } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
  }

  async findMany(businessId: string, query: TemporalFlowMemoryQuery = {}): Promise<TemporalFlowMemoryData[]> {
    return this.prisma.client.temporalFlowMemory.findMany({
      where: {
        businessId,
        ...(query.entityType ? { entityType: query.entityType } : {}),
        ...(query.entityId !== undefined ? { entityId: query.entityId ?? null } : {}),
        ...(query.type ? { type: query.type } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: query.limit ?? 100,
    });
  }

  async searchMemory(businessId: string, query: string, limit = 10): Promise<ReturnType<SemanticMemoryService['search']>> {
    return this.semanticMemory.search({
      businessId,
      query,
      limit,
      sourceTypes: ['temporal_memory'],
      minSimilarity: 0.7,
    });
  }

  async summarizeThread(businessId: string, threadId: string): Promise<TemporalFlowMemoryData | null> {
    const events = await this.prisma.client.temporalFlowEvent.findMany({
      where: { businessId, threadId },
      orderBy: { occurredAt: 'desc' },
      take: 50,
    });

    if (!events.length) return null;

    const channels = this.distinct(events.map((e) => e.source).filter(Boolean));
    const types = this.distinct(events.map((e) => e.type).filter(Boolean));
    const intents = this.extractPayloadValues(events, 'intent');
    const sentiments = this.extractPayloadValues(events, 'sentiment');
    const urgencies = this.extractPayloadValues(events, 'urgency');

    const lastEvent = events[0];
    const content = [
      `Thread activity: ${events.length} event(s) across ${channels.join(', ') || 'unknown'}.`,
      types.length ? `Recent types: ${types.slice(0, 5).join(', ')}.` : '',
      intents.length ? `Detected intent: ${intents[0]}.` : '',
      sentiments.length ? `Sentiment: ${sentiments[0]}.` : '',
      urgencies.length ? `Urgency: ${urgencies[0]}.` : '',
      lastEvent?.title ? `Latest: ${lastEvent.title}.` : '',
    ]
      .filter(Boolean)
      .join(' ');

    const confidence = this.inferConfidence(events);

    return this.createMemory({
      businessId,
      entityType: 'thread',
      entityId: threadId,
      type: 'summary',
      content,
      sourceEventIds: events.map((e) => e.id),
      sourceModule: 'key_inbox',
      metadata: {
        eventCount: events.length,
        channels,
        topTypes: types.slice(0, 5),
        topIntent: intents[0] ?? null,
        topSentiment: sentiments[0] ?? null,
        topUrgency: urgencies[0] ?? null,
      },
      confidence,
    });
  }

  async summarizeContact(businessId: string, contactId: string): Promise<TemporalFlowMemoryData | null> {
    const events = await this.prisma.client.temporalFlowEvent.findMany({
      where: { businessId, contactId },
      orderBy: { occurredAt: 'desc' },
      take: 100,
    });

    if (!events.length) return null;

    const channels = this.distinct(events.map((e) => e.source).filter(Boolean));
    const intents = this.extractPayloadValues(events, 'intent');
    const topIntent = intents[0];

    const channelCounts = this.count(events.map((e) => e.source));
    const preferredChannel = Object.entries(channelCounts).sort((a, b) => b[1] - a[1])[0]?.[0];

    const content = [
      `Contact activity: ${events.length} event(s).`,
      preferredChannel ? `Preferred channel: ${preferredChannel}.` : '',
      topIntent ? `Most common intent: ${topIntent}.` : '',
      channels.length > 1 ? `Active on: ${channels.join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join(' ');

    return this.createMemory({
      businessId,
      entityType: 'contact',
      entityId: contactId,
      type: 'summary',
      content,
      sourceEventIds: events.map((e) => e.id),
      sourceModule: 'key_inbox',
      metadata: {
        eventCount: events.length,
        channels,
        preferredChannel: preferredChannel ?? null,
        topIntent: topIntent ?? null,
      },
      confidence: this.inferConfidence(events),
    });
  }

  async summarizeChannel(businessId: string, channel: string): Promise<TemporalFlowMemoryData | null> {
    const events = await this.prisma.client.temporalFlowEvent.findMany({
      where: { businessId, source: channel },
      orderBy: { occurredAt: 'desc' },
      take: 200,
    });

    if (!events.length) return null;

    const intents = this.extractPayloadValues(events, 'intent');
    const topIntent = intents[0];
    const leadLike = events.filter(
      (e) =>
        e.type?.includes('lead') ||
        (e.payload && typeof e.payload === 'object' && (e.payload as any).intent === 'lead_inquiry'),
    ).length;

    const content = [
      `Channel ${channel}: ${events.length} event(s).`,
      topIntent ? `Top intent: ${topIntent}.` : '',
      leadLike ? `${leadLike} lead-like interaction(s).` : '',
    ]
      .filter(Boolean)
      .join(' ');

    return this.createMemory({
      businessId,
      entityType: 'channel',
      entityId: channel,
      type: 'pattern',
      content,
      sourceEventIds: events.slice(0, 20).map((e) => e.id),
      sourceModule: 'key_inbox',
      metadata: {
        eventCount: events.length,
        topIntent: topIntent ?? null,
        leadLikeCount: leadLike,
      },
      confidence: Math.min(0.5 + events.length / 100, 0.95),
    });
  }

  async compactBusiness(businessId: string): Promise<{ threads: number; contacts: number; channels: number }> {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [threadIds, contactIds, channels] = await Promise.all([
      this.distinctThreadIds(businessId, since),
      this.distinctContactIds(businessId, since),
      this.distinctChannels(businessId, since),
    ]);

    const results = { threads: 0, contacts: 0, channels: 0 };

    for (const threadId of threadIds) {
      try {
        await this.summarizeThread(businessId, threadId);
        results.threads++;
      } catch (err) {
        this.logger.warn(`Thread compaction failed ${threadId}: ${(err as Error).message}`);
      }
    }

    for (const contactId of contactIds) {
      try {
        await this.summarizeContact(businessId, contactId);
        results.contacts++;
      } catch (err) {
        this.logger.warn(`Contact compaction failed ${contactId}: ${(err as Error).message}`);
      }
    }

    for (const channel of channels) {
      try {
        await this.summarizeChannel(businessId, channel);
        results.channels++;
      } catch (err) {
        this.logger.warn(`Channel compaction failed ${channel}: ${(err as Error).message}`);
      }
    }

    return results;
  }

  private async distinctThreadIds(businessId: string, since: Date): Promise<string[]> {
    const rows = await this.prisma.client.temporalFlowEvent.findMany({
      where: { businessId, threadId: { not: null }, occurredAt: { gte: since } },
      select: { threadId: true },
      distinct: ['threadId'],
      take: 500,
    });
    return rows.map((r) => r.threadId!).filter(Boolean);
  }

  private async distinctContactIds(businessId: string, since: Date): Promise<string[]> {
    const rows = await this.prisma.client.temporalFlowEvent.findMany({
      where: { businessId, contactId: { not: null }, occurredAt: { gte: since } },
      select: { contactId: true },
      distinct: ['contactId'],
      take: 500,
    });
    return rows.map((r) => r.contactId!).filter(Boolean);
  }

  private async distinctChannels(businessId: string, since: Date): Promise<string[]> {
    const rows = await this.prisma.client.temporalFlowEvent.findMany({
      where: { businessId, occurredAt: { gte: since } },
      select: { source: true },
      distinct: ['source'],
      take: 100,
    });
    return rows.map((r) => r.source).filter(Boolean);
  }

  private distinct<T>(arr: T[]): T[] {
    return Array.from(new Set(arr));
  }

  private count(arr: (string | null | undefined)[]): Record<string, number> {
    const totals: Record<string, number> = {};
    for (const item of arr) {
      if (!item) continue;
      totals[item] = (totals[item] ?? 0) + 1;
    }
    return totals;
  }

  private extractPayloadValues(events: { payload: unknown }[], key: string): string[] {
    const values: string[] = [];
    for (const event of events) {
      if (event.payload && typeof event.payload === 'object') {
        const v = (event.payload as Record<string, unknown>)[key];
        if (typeof v === 'string' && v) values.push(v);
      }
    }
    return this.distinct(values);
  }

  private inferConfidence(events: { importance?: string | null; genomeImpactPotential?: boolean }[]): number {
    const critical = events.filter((e) => e.importance === 'CRITICAL').length;
    const genome = events.filter((e) => e.genomeImpactPotential).length;
    const base = Math.min(0.5 + events.length / 50, 0.9);
    return Math.min(base + critical * 0.05 + genome * 0.05, 0.98);
  }
}
