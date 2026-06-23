import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AiUsageService } from './ai-usage.service';

export interface SemanticMemory {
  id: string;
  content: string;
  sourceType: string;
  sourceId: string;
  metadata: Record<string, any>;
  similarity: number;
}

export interface StoreMemoryInput {
  businessId: string;
  content: string;
  sourceType: 'memory' | 'event' | 'conversation' | 'document' | 'action' | 'temporal_memory';
  sourceId: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class SemanticMemoryService {
  private readonly logger = new Logger(SemanticMemoryService.name);
  private readonly EMBEDDING_MODEL = 'text-embedding-3-small';
  private readonly EMBEDDING_DIM = 1536;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(AiUsageService) private readonly aiUsage: AiUsageService,
  ) {}

  async store(input: StoreMemoryInput): Promise<string> {
    try {
      const embedding = await this.generateEmbedding(input.businessId, input.content);

      const record = await this.prisma.client.$executeRawUnsafe(
        `INSERT INTO "ai_memory_embeddings" (id, business_id, content, source_type, source_id, embedding, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6::vector, $7, NOW())`,
        this.generateId(),
        input.businessId,
        input.content,
        input.sourceType,
        input.sourceId,
        `[${embedding.join(',')}]`,
        JSON.stringify(input.metadata ?? {}),
      );

      this.events.emit('memory.stored', {
        businessId: input.businessId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      });

      return input.sourceId;
    } catch (err) {
      this.logger.error(`Failed to store semantic memory: ${(err as Error).message}`);
      throw err;
    }
  }

  async search(params: {
    businessId: string;
    query: string;
    limit?: number;
    sourceTypes?: string[];
    minSimilarity?: number;
  }): Promise<SemanticMemory[]> {
    try {
      const embedding = await this.generateEmbedding(params.businessId, params.query);
      const limit = params.limit ?? 5;
      const minSim = params.minSimilarity ?? 0.7;

      let sourceFilter = '';
      if (params.sourceTypes && params.sourceTypes.length > 0) {
        sourceFilter = `AND source_type IN (${params.sourceTypes.map((_, i) => `$${i + 4}`).join(',')})`;
      }

      const query = `
        SELECT id, content, source_type, source_id, metadata,
               1 - (embedding <=> $3::vector) as similarity
        FROM "ai_memory_embeddings"
        WHERE business_id = $1
          AND 1 - (embedding <=> $3::vector) >= $2
          ${sourceFilter}
        ORDER BY embedding <=> $3::vector
        LIMIT ${limit}
      `;

      const args: any[] = [params.businessId, minSim, `[${embedding.join(',')}]`];
      if (params.sourceTypes) args.push(...params.sourceTypes);

      const results = await this.prisma.client.$queryRawUnsafe<Array<{
        id: string;
        content: string;
        source_type: string;
        source_id: string;
        metadata: any;
        similarity: number;
      }>>(query, ...args);

      return results.map((r) => ({
        id: r.id,
        content: r.content,
        sourceType: r.source_type,
        sourceId: r.source_id,
        metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata,
        similarity: Number(r.similarity),
      }));
    } catch (err) {
      this.logger.error(`Semantic search failed: ${(err as Error).message}`);
      return [];
    }
  }

  async backfillFromAiMemory(businessId: string): Promise<number> {
    const memories = await this.prisma.client.aiMemory.findMany({
      where: { businessId },
      take: 500,
    });

    let stored = 0;
    for (const memory of memories) {
      try {
        await this.store({
          businessId,
          content: `${memory.category}: ${memory.key} = ${memory.value}`,
          sourceType: 'memory',
          sourceId: memory.id,
          metadata: { category: memory.category, key: memory.key, confidence: memory.confidence },
        });
        stored++;
      } catch (err) {
          this.logger.warn(`On error: ${err instanceof Error ? err.message : err}`);
        }
    }

    this.logger.log(`Backfilled ${stored} memories for ${businessId}`);
    return stored;
  }

  async deleteForSource(sourceType: string, sourceId: string): Promise<void> {
    await this.prisma.client.$executeRawUnsafe(
      `DELETE FROM "ai_memory_embeddings" WHERE source_type = $1 AND source_id = $2`,
      sourceType,
      sourceId,
    );
  }

  private async generateEmbedding(businessId: string, text: string): Promise<number[]> {
    const embeddings = await this.aiUsage.trackEmbedding(
      businessId,
      undefined,
      'semantic_embedding',
      [text.slice(0, 8000)],
      this.EMBEDDING_MODEL,
    );
    return embeddings[0] ?? [];
  }

  private generateId(): string {
    return `emb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}
