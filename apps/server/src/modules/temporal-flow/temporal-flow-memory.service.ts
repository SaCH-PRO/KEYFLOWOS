import { Injectable, Logger, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SemanticMemoryService } from '../ai/semantic-memory.service';
import {
  classifyTemporalMemoryWrite,
  isMemoryRowDataClass,
  mergeMemoryClassifications,
  normalizeModuleScope,
  type MemoryRowDataClass,
  type TemporalEventProvenance,
} from '../ai/memory-classification';
import type {
  CreateTemporalFlowMemoryInput,
  TemporalFlowMemoryData,
  TemporalFlowMemoryQuery,
} from './temporal-flow-memory.types';
import {
  buildDbMemoryClassPreFilter,
  getMemoryClassReadMode,
  projectTemporalMemoryRowsForReader,
  type MemoryReaderContext,
} from '../key-cortex/memory-class-read-projection';

const EMBEDDING_CONFIDENCE_THRESHOLD = 0.7;

/**
 * An id or business a by-id query can use: a non-empty string. Prisma drops an undefined field from a
 * where, so an absent id or business must never reach one (it would widen it).
 */
function isKey(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** An entity id a where can use: absent (null or undefined: a business-level memory) or a non-empty string. */
function isEntityId(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || isKey(value);
}

@Injectable()
export class TemporalFlowMemoryService {
  private readonly logger = new Logger(TemporalFlowMemoryService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SemanticMemoryService) private readonly semanticMemory: SemanticMemoryService,
  ) {}

  /**
   * Resolves source `temporal_flow_events` for non-opaque temporal memories so
   * provenance classification can inspect every referenced event (or fail closed
   * when any referenced event is missing).
   */
  async resolveSourceEvents(
    businessId: string,
    sourceEventIds: readonly string[],
    client: typeof this.prisma.client = this.prisma.client,
  ): Promise<{ sourceEvents: TemporalEventProvenance[]; hasMissingSourceEvents: boolean }> {
    const uniqueIds = Array.from(new Set(sourceEventIds));
    if (uniqueIds.length === 0) {
      return { sourceEvents: [], hasMissingSourceEvents: false };
    }
    if (!client.temporalFlowEvent?.findMany) {
      return { sourceEvents: [], hasMissingSourceEvents: true };
    }
    const fetched =
      (await client.temporalFlowEvent.findMany({
        where: { businessId, id: { in: uniqueIds } },
        select: {
          id: true,
          source: true,
          type: true,
          module: true,
          entityType: true,
          title: true,
          summary: true,
          description: true,
        },
      })) ?? [];
    return {
      sourceEvents: fetched,
      hasMissingSourceEvents: fetched.length < uniqueIds.length,
    };
  }

  async createMemory(input: CreateTemporalFlowMemoryInput): Promise<TemporalFlowMemoryData> {
    // MEM-TEMPORAL-SCOPE: without a business the lookup and the rewrite below would have no tenant predicate.
    if (!isKey(input.businessId)) throw new BadRequestException('Temporal memory needs a business');
    // An operator object ({not}, {in}) as the entity id would match, and rewrite, another memory.
    if (!isEntityId(input.entityId)) throw new BadRequestException('Temporal memory entity id must be a non-empty string');
    const existing = await this.prisma.client.temporalFlowMemory.findFirst({
      where: {
        businessId: input.businessId,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        type: input.type,
      },
    });

    let sourceEvents: TemporalEventProvenance[] = input.sourceEvents ?? [];
    let hasMissingSourceEvents = false;
    if (
      input.sourceEvents === undefined &&
      (input.sourceEventIds?.length ?? 0) > 0 &&
      input.entityType !== 'business' &&
      input.sourceModule !== 'key_cortex'
    ) {
      const resolved = await this.resolveSourceEvents(input.businessId, input.sourceEventIds ?? []);
      sourceEvents = resolved.sourceEvents;
      hasMissingSourceEvents = resolved.hasMissingSourceEvents;
    }

    const classified = classifyTemporalMemoryWrite({
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      type: input.type,
      sourceModule: input.sourceModule,
      content: input.content,
      sourceEvents,
      sourceEventIds: input.sourceEventIds ?? [],
      hasMissingSourceEvents,
      explicitDataClass: input.dataClass ?? null,
      explicitModuleScope: input.moduleScope ?? null,
    });

    // R1-SEC-02: re-summarization onto an existing row never weakens data_class or drops module_scope.
    const effective = existing
      ? mergeMemoryClassifications([
          {
            dataClass: isMemoryRowDataClass((existing as { dataClass?: unknown }).dataClass)
              ? ((existing as { dataClass?: MemoryRowDataClass }).dataClass ?? null)
              : null,
            moduleScope: Array.isArray((existing as { moduleScope?: unknown }).moduleScope)
              ? ((existing as { moduleScope?: string[] }).moduleScope ?? null)
              : null,
          },
          classified,
        ])
      : classified;

    const data = {
      content: input.content,
      sourceEventIds: input.sourceEventIds ?? [],
      sourceModule: input.sourceModule,
      metadata: input.metadata ?? {},
      confidence: input.confidence ?? 0.5,
      dataClass: effective.dataClass,
      moduleScope: effective.moduleScope,
    };

    let record;
    if (existing) {
      record = await this.prisma.client.temporalFlowMemory.update({
        // MEM-TEMPORAL-SCOPE: the tenant predicate is in the update itself.
        where: { id: existing.id, businessId: input.businessId },
        data,
      });
    } else {
      record = await this.prisma.client.temporalFlowMemory.create({
        data: {
          // Spread FIRST: a caller-supplied `data` must not be able to name its
          // own tenant. See core/auth/tenant-body-override.spec.ts.
          ...data,
          businessId: input.businessId,
          entityType: input.entityType,
          entityId: input.entityId ?? null,
          type: input.type,
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
          dataClass: effective.dataClass,
          moduleScope: effective.moduleScope,
        });
      } catch (err: any) {
        this.logger.warn(`Embedding failed for memory ${record.id}: ${(err as Error).message}`);
      }
    }

    return record;
  }

  private async projectRowsForReader(
    businessId: string,
    rows: TemporalFlowMemoryData[],
    readerContext: MemoryReaderContext,
    path: string,
  ): Promise<TemporalFlowMemoryData[]> {
    if (rows.length === 0) return rows;
    const legacyEventIds = new Set<string>();
    for (const row of rows) {
      const dc = (row as { dataClass?: string | null }).dataClass;
      if (!dc && row.entityType !== 'business' && row.sourceModule !== 'key_cortex') {
        for (const id of row.sourceEventIds ?? []) legacyEventIds.add(id);
      }
    }
    let events: Map<string, TemporalEventProvenance> | undefined;
    if (legacyEventIds.size > 0) {
      const resolved = await this.resolveSourceEvents(businessId, [...legacyEventIds]);
      events = new Map(
        resolved.sourceEvents
          .filter((e): e is TemporalEventProvenance & { id: string } => typeof e.id === 'string')
          .map((e) => [e.id, e]),
      );
    }
    return projectTemporalMemoryRowsForReader(rows, readerContext, {
      businessId,
      path,
      logger: this.logger,
      events,
    });
  }

  async findByEntity(
    businessId: string,
    entityType: string,
    entityId?: string,
    readerContext?: MemoryReaderContext,
  ): Promise<TemporalFlowMemoryData[]> {
    // MEM-TEMPORAL-SCOPE: no business, or an entity id that is not a string (an operator object, a list),
    // matches nothing.
    if (!isKey(businessId) || !isEntityId(entityId)) return [];
    const preFilter =
      readerContext && getMemoryClassReadMode() === 'ACTIVE'
        ? buildDbMemoryClassPreFilter(readerContext)
        : undefined;
    const rows = await this.prisma.client.temporalFlowMemory.findMany({
      where: {
        businessId,
        entityType,
        ...(entityId !== undefined ? { entityId: entityId ?? null } : {}),
        ...(preFilter ? { AND: [preFilter] } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    if (!readerContext) return rows;
    return this.projectRowsForReader(businessId, rows, readerContext, 'TemporalFlowMemoryService.findByEntity');
  }

  async findMany(
    businessId: string,
    query: TemporalFlowMemoryQuery = {},
    readerContext?: MemoryReaderContext,
  ): Promise<TemporalFlowMemoryData[]> {
    if (!isKey(businessId) || !isEntityId(query.entityId)) return [];
    const limit = query.limit ?? 100;
    const preFilter =
      readerContext && getMemoryClassReadMode() === 'ACTIVE'
        ? buildDbMemoryClassPreFilter(readerContext)
        : undefined;
    const rows = await this.prisma.client.temporalFlowMemory.findMany({
      where: {
        businessId,
        ...(query.entityType ? { entityType: query.entityType } : {}),
        ...(query.entityId !== undefined ? { entityId: query.entityId ?? null } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(preFilter ? { AND: [preFilter] } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
    if (!readerContext) return rows;
    const projected = await this.projectRowsForReader(
      businessId,
      rows,
      readerContext,
      'TemporalFlowMemoryService.findMany',
    );
    return projected.slice(0, limit);
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

  /**
   * MEM-TEMPORAL-SCOPE: one memory of this business by id, or null. A foreign id reads as a missing one.
   */
  async findById(
    businessId: string,
    memoryId: string,
    readerContext?: MemoryReaderContext,
  ): Promise<TemporalFlowMemoryData | null> {
    if (!isKey(businessId) || !isKey(memoryId)) return null;
    const row = await this.prisma.client.temporalFlowMemory.findFirst({ where: { id: memoryId, businessId } });
    if (!row || !readerContext) return row;
    const [visible] = await this.projectRowsForReader(
      businessId,
      [row],
      readerContext,
      'TemporalFlowMemoryService.findById',
    );
    return visible ?? null;
  }

  async deleteMemory(businessId: string, memoryId: string): Promise<boolean> {
    // MEM-TEMPORAL-SCOPE: the tenant predicate is in the delete itself, not only in a read before it.
    // Prisma drops an undefined field from a where, so without an id deleteMany would match every row
    // of the business: no id deletes nothing.
    if (!isKey(businessId) || !isKey(memoryId)) return false;
    const { count } = await this.prisma.client.temporalFlowMemory.deleteMany({
      where: { id: memoryId, businessId },
    });
    return count > 0;
  }

  /**
   * MEM-TEMPORAL-SCOPE: updates one memory of this business. The id and the business are both in the
   * update's own where, so another business's id is refused exactly as a missing id is (NotFoundException
   * 'Memory not found'), and nothing is written.
   */
  async updateMemory(
    businessId: string,
    memoryId: string,
    patch: {
      content?: string;
      confidence?: number;
      sourceEventIds?: string[];
      metadata?: Record<string, unknown>;
      dataClass?: MemoryRowDataClass;
      moduleScope?: string[];
    },
  ): Promise<TemporalFlowMemoryData> {
    if (!isKey(businessId) || !isKey(memoryId)) throw new NotFoundException('Memory not found');
    const runUpdate = async (tx: typeof this.prisma.client) => {
      const existing = await tx.temporalFlowMemory.findFirst({
        where: { id: memoryId, businessId },
      });
      let nextDataClass: MemoryRowDataClass | undefined = patch.dataClass;
      let nextModuleScope: string[] | undefined =
        patch.moduleScope !== undefined ? normalizeModuleScope(patch.moduleScope) : undefined;

      if (existing) {
        const effectiveSourceEventIds =
          patch.sourceEventIds ?? (Array.isArray(existing.sourceEventIds) ? existing.sourceEventIds : []);
        const isOpaque = existing.entityType === 'business' || existing.sourceModule === 'key_cortex';
        let sourceEvents: TemporalEventProvenance[] = [];
        let hasMissingSourceEvents = false;
        if (!isOpaque && effectiveSourceEventIds.length > 0) {
          const resolved = await this.resolveSourceEvents(businessId, effectiveSourceEventIds, tx);
          sourceEvents = resolved.sourceEvents;
          hasMissingSourceEvents = resolved.hasMissingSourceEvents;
        }
        const patchTags = Array.isArray(patch.metadata?.tags)
          ? patch.metadata.tags.filter((t): t is string => typeof t === 'string')
          : [];
        const reclassified = classifyTemporalMemoryWrite({
          entityType: existing.entityType,
          entityId: existing.entityId,
          type: existing.type,
          sourceModule: existing.sourceModule,
          content: patch.content ?? existing.content,
          sourceEvents,
          sourceEventIds: effectiveSourceEventIds,
          hasMissingSourceEvents,
          tags: patchTags,
          explicitDataClass: patch.dataClass ?? null,
          explicitModuleScope: patch.moduleScope ?? null,
        });
        const merged = mergeMemoryClassifications([
          {
            dataClass: isMemoryRowDataClass((existing as { dataClass?: unknown }).dataClass)
              ? ((existing as { dataClass?: MemoryRowDataClass }).dataClass ?? null)
              : null,
            moduleScope: Array.isArray((existing as { moduleScope?: unknown }).moduleScope)
              ? ((existing as { moduleScope?: string[] }).moduleScope ?? null)
              : null,
          },
          reclassified,
        ]);
        nextDataClass = merged.dataClass;
        nextModuleScope = merged.moduleScope;
      }

      return tx.temporalFlowMemory.update({
        where: { id: memoryId, businessId },
        data: {
          content: patch.content,
          confidence: patch.confidence,
          sourceEventIds: patch.sourceEventIds,
          metadata: patch.metadata,
          ...(nextDataClass !== undefined ? { dataClass: nextDataClass } : {}),
          ...(nextModuleScope !== undefined ? { moduleScope: nextModuleScope } : {}),
        },
      });
    };

    try {
      return typeof this.prisma.client.$transaction === 'function'
        ? await this.prisma.client.$transaction((tx) => runUpdate(tx as unknown as typeof this.prisma.client))
        : await runUpdate(this.prisma.client);
    } catch (err) {
      // P2025: no row matched the where (missing, or another business's).
      if ((err as { code?: unknown } | null)?.code === 'P2025') {
        throw new NotFoundException('Memory not found');
      }
      throw err;
    }
  }

  async getStats(businessId: string, readerContext?: MemoryReaderContext) {
    if (readerContext && getMemoryClassReadMode() === 'ACTIVE') {
      const visible = await this.findMany(businessId, { limit: 1000 }, readerContext);
      const byType: Record<string, number> = {};
      for (const row of visible) {
        byType[row.type] = (byType[row.type] ?? 0) + 1;
      }
      return { total: visible.length, byType };
    }
    const [total, byType] = await Promise.all([
      this.prisma.client.temporalFlowMemory.count({ where: { businessId } }),
      this.prisma.client.temporalFlowMemory.groupBy({
        by: ['type'],
        where: { businessId },
        _count: { id: true },
      }),
    ]);
    return {
      total,
      byType: byType.reduce((acc: Record<string, number>, cur: { type: string; _count: { id: number } }) => {
        acc[cur.type] = cur._count.id;
        return acc;
      }, {} as Record<string, number>),
    };
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
      sourceEvents: events,
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
      sourceEvents: events,
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
      sourceEvents: events,
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
      } catch (err: any) {
        this.logger.warn(`Thread compaction failed ${threadId}: ${(err as Error).message}`);
      }
    }

    for (const contactId of contactIds) {
      try {
        await this.summarizeContact(businessId, contactId);
        results.contacts++;
      } catch (err: any) {
        this.logger.warn(`Contact compaction failed ${contactId}: ${(err as Error).message}`);
      }
    }

    for (const channel of channels) {
      try {
        await this.summarizeChannel(businessId, channel);
        results.channels++;
      } catch (err: any) {
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
