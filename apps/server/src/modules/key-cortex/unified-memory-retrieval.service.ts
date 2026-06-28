import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SemanticMemoryService } from '../ai/semantic-memory.service';
import type { MemoryFragment, MemoryRetrievalOptions, MemorySourceType } from './unified-memory.types';

interface RawMemoryRow {
  id: string;
  createdAt: Date;
  content?: string;
  summary?: string;
  title?: string;
  confidence?: number;
  entityId?: string | null;
  entityType?: string | null;
  sourceType?: string;
  sourceEntityId?: string | null;
  eventType?: string;
  type?: string;
  metadata?: any;
  similarity?: number;
  category?: string;
  key?: string;
  value?: string;
  userResponse?: string;
  recommendation?: string;
  lessonsLearned?: string[];
}

/**
 * Single retrieval layer over all KEY memory stores.
 *
 * Hides the fragmentation between:
 *  - AiMemory / AiMemoryEmbedding (preferences, facts, semantic search)
 *  - GenomeMemoryEvent (recommendation/experiment/action outcomes)
 *  - TemporalFlowMemory (timeline summaries and patterns)
 *  - CognitionMemory (per-query learning)
 *
 * Returns a ranked list of normalized MemoryFragments for the reasoning engine.
 */
@Injectable()
export class UnifiedMemoryRetrievalService {
  private readonly logger = new Logger(UnifiedMemoryRetrievalService.name);
  /** Recency half-life in days. */
  private readonly RECENCY_HALF_LIFE_DAYS = 30;
  private readonly DECAY_CUTOFF_DAYS = 90;

  constructor(
    private readonly prisma: PrismaService,
    private readonly semanticMemory: SemanticMemoryService,
  ) {}

  async retrieveContext(
    businessId: string,
    options: MemoryRetrievalOptions = {},
  ): Promise<MemoryFragment[]> {
    const limit = options.limit ?? 20;
    const now = Date.now();
    const halfLifeMs = this.RECENCY_HALF_LIFE_DAYS * 24 * 60 * 60 * 1000;

    const [structuredRows, semanticRows] = await Promise.all([
      this.loadStructuredMemory(businessId, options),
      options.query ? this.loadSemanticMemory(businessId, options.query, options) : [],
    ]);

    const allRows = [...structuredRows, ...semanticRows];

    const decayCutoffMs = this.DECAY_CUTOFF_DAYS * 24 * 60 * 60 * 1000;

    const fragments = allRows.map((row) => {
      const sourceType = row.sourceType as MemorySourceType;
      const ageMs = now - new Date(row.createdAt).getTime();
      let recencyScore = Math.exp(-ageMs / halfLifeMs);
      if (ageMs > decayCutoffMs) {
        recencyScore *= 0.8;
      }
      const relevanceScore =
        row.similarity ?? (row.confidence ? row.confidence * 0.5 + 0.5 : 0.5);
      const sourceWeight = this.sourceWeight(sourceType);
      let rankScore =
        (relevanceScore * 0.45 + recencyScore * 0.35 + sourceWeight * 0.2);

      if (options.entityId && (row.entityId ?? row.sourceEntityId) === options.entityId) {
        rankScore *= 1.2;
      }

      return {
        id: row.id,
        sourceType,
        title: this.extractTitle(row),
        content: this.extractContent(row),
        timestamp: new Date(row.createdAt),
        confidence: row.confidence ?? 0.5,
        relevanceScore,
        recencyScore,
        rankScore,
        entityId: row.entityId ?? row.sourceEntityId ?? null,
        entityType: row.entityType ?? null,
        metadata: this.safeMetadata(row.metadata),
      } as MemoryFragment;
    });

    const filtered = fragments.filter((f) => {
      if (options.sourceTypes && !options.sourceTypes.includes(f.sourceType)) return false;
      if (options.entityId && f.entityId !== options.entityId) return false;
      if (options.entityType && f.entityType !== options.entityType) return false;
      if (options.minRankScore && f.rankScore < options.minRankScore) return false;
      return true;
    });

    filtered.sort((a, b) => b.rankScore - a.rankScore);

    return filtered.slice(0, limit);
  }

  private async loadStructuredMemory(
    businessId: string,
    options: MemoryRetrievalOptions,
  ): Promise<RawMemoryRow[]> {
    const since = options.boostRecency !== false ? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) : undefined;
    const whereBase: any = { businessId };
    if (since) whereBase.createdAt = { gte: since };

    const [aiMemories, genomeEvents, temporalMemories, cognitionMemories, cognitiveEvents] = await Promise.all([
      this.prisma.client.aiMemory.findMany({
        where: whereBase,
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { id: true, category: true, key: true, value: true, confidence: true, createdAt: true },
      }),
      this.prisma.client.genomeMemoryEvent.findMany({
        where: whereBase,
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          sourceType: true,
          sourceEntityId: true,
          eventType: true,
          title: true,
          summary: true,
          confidenceDelta: true,
          createdAt: true,
          metadata: true,
        },
      }),
      this.prisma.client.temporalFlowMemory.findMany({
        where: whereBase,
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          entityType: true,
          entityId: true,
          type: true,
          content: true,
          confidence: true,
          createdAt: true,
          metadata: true,
        },
      }),
      this.prisma.client.cognitionMemory.findMany({
        where: whereBase,
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          userId: true,
          roleId: true,
          query: true,
          recommendation: true,
          userResponse: true,
          confidence: true,
          lessonsLearned: true,
          createdAt: true,
          metadata: true,
        },
      }),
      this.prisma.client.cognitiveEvent.findMany({
        where: whereBase,
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          sourceType: true,
          sourceId: true,
          eventType: true,
          payload: true,
          confidence: true,
          createdAt: true,
        },
      }),
    ]).catch((err: any) => {
      this.logger.warn(`Structured memory load failed: ${err instanceof Error ? err.message : String(err)}`);
      return [[], [], [], [], []];
    });

    const rows: RawMemoryRow[] = [];

    for (const m of aiMemories as any[]) {
      rows.push({
        id: m.id,
        sourceType: 'ai_memory',
        category: m.category,
        key: m.key,
        value: m.value,
        content: `${m.category}.${m.key}: ${m.value}`,
        confidence: m.confidence ?? 1,
        createdAt: m.createdAt,
      });
    }

    for (const e of genomeEvents as any[]) {
      rows.push({
        id: e.id,
        sourceType: 'genome_memory_event',
        sourceEntityId: e.sourceEntityId,
        eventType: e.eventType,
        title: e.title,
        summary: e.summary,
        content: e.summary ?? e.title,
        confidence: e.confidenceDelta ? 0.5 + e.confidenceDelta / 2 : 0.5,
        createdAt: e.createdAt,
        metadata: e.metadata,
      });
    }

    for (const t of temporalMemories as any[]) {
      rows.push({
        id: t.id,
        sourceType: 'temporal_flow_memory',
        entityType: t.entityType,
        entityId: t.entityId,
        type: t.type,
        content: t.content,
        confidence: t.confidence,
        createdAt: t.createdAt,
        metadata: t.metadata,
      });
    }

    for (const c of cognitionMemories as any[]) {
      const lessons = Array.isArray(c.lessonsLearned) ? c.lessonsLearned.join(' ') : '';
      rows.push({
        id: c.id,
        sourceType: 'cognition_memory',
        content: `Query: ${c.query}\nRecommendation: ${c.recommendation}\nUser response: ${c.userResponse}\nLessons: ${lessons}`,
        confidence: c.confidence,
        createdAt: c.createdAt,
        metadata: c.metadata,
      });
    }

    for (const e of cognitiveEvents as any[]) {
      rows.push({
        id: e.id,
        sourceType: 'cognitive_event',
        sourceEntityId: e.sourceId,
        eventType: e.eventType,
        content: `${e.eventType}: ${JSON.stringify(e.payload)}`,
        confidence: e.confidence,
        createdAt: e.createdAt,
        metadata: { sourceType: e.sourceType },
      });
    }

    return rows;
  }

  private async loadSemanticMemory(
    businessId: string,
    query: string,
    options: MemoryRetrievalOptions,
  ): Promise<RawMemoryRow[]> {
    try {
      const results = await this.semanticMemory.search({
        businessId,
        query,
        limit: options.limit ?? 20,
        sourceTypes: options.sourceTypes?.filter((s) =>
          ['ai_memory_embedding', 'memory', 'event', 'conversation', 'document'].includes(s as string),
        ) as any,
        minSimilarity: 0.65,
      });

      return results.map((r) => ({
        id: r.id,
        sourceType: 'ai_memory_embedding' as MemorySourceType,
        content: r.content,
        similarity: r.similarity,
        confidence: r.similarity,
        createdAt: r.metadata?.createdAt ? new Date(r.metadata.createdAt as string) : new Date(),
        metadata: r.metadata,
      }));
    } catch (err: any) {
      this.logger.warn(`Semantic memory search failed: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  private sourceWeight(sourceType: MemorySourceType): number {
    switch (sourceType) {
      case 'ai_memory':
        return 0.85;
      case 'ai_memory_embedding':
        return 0.8;
      case 'genome_memory_event':
        return 0.9;
      case 'temporal_flow_memory':
        return 0.75;
      case 'cognition_memory':
        return 0.8;
      case 'cognitive_event':
        return 0.75;
      case 'conversation':
        return 0.7;
      default:
        return 0.5;
    }
  }

  private extractTitle(row: RawMemoryRow): string {
    return row.title ?? row.eventType ?? row.type ?? row.category ?? row.key ?? 'Memory fragment';
  }

  private extractContent(row: RawMemoryRow): string {
    return row.content ?? row.summary ?? row.value ?? row.recommendation ?? '';
  }

  private safeMetadata(metadata: any): Record<string, unknown> | undefined {
    if (!metadata) return undefined;
    if (typeof metadata === 'object') return metadata as Record<string, unknown>;
    try {
      return JSON.parse(metadata) as Record<string, unknown>;
    } catch {
      return { raw: metadata };
    }
  }
}
