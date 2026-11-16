import { Injectable, Logger, Inject, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AiUsageService } from './ai-usage.service';

/**
 * W7-AI-SERVICES-503 (the R0-07a rule; COST-LEDGER-001 section 7 item 7): the
 * structured 503 AiUsageService.trackEmbedding answers when no OpenAI key is
 * configured (provider_not_configured, also KEY_DISABLED), or the gateway's
 * provider_unavailable. search and backfillFromAiMemory rethrow it unchanged,
 * so GET .../agent/memory/search and POST .../agent/memory/backfill answer the
 * same 503 and code as the other AI routes instead of an empty 200; every other
 * failure keeps its old mapping (empty results, the memory skipped). The same
 * predicate as OpenAiVoiceProvider's (R0-34b).
 */
function isAiProviderUnavailable(err: unknown): err is HttpException {
  if (!(err instanceof HttpException) || err.getStatus() !== HttpStatus.SERVICE_UNAVAILABLE) return false;
  const body = err.getResponse();
  const code = typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : undefined;
  return code === 'provider_not_configured' || code === 'provider_unavailable';
}

/**
 * The source_type of an AiMemory row's semantic copies in ai_memory_embeddings (source_id is the row's id). Two writers
 * make them: backfillFromAiMemory (POST /ai/businesses/:id/agent/memory/backfill, content `<category>: <key> = <value>`)
 * and UnifiedMemoryWriterService.store with indexSemantic (content the value). Every AiMemory deletion removes them
 * (deleteAiMemoriesWithCopies in ai-memory.service.ts, W1F-MEMORY-COPIES).
 */
export const AI_MEMORY_COPY_SOURCE_TYPE = 'memory';

/**
 * W1F-MEMORY-COPIES (review SEC-W1FMC-1): whether the copy content `content` holds what the AiMemory row `m` holds now,
 * in either writer's form: the value (UnifiedMemoryWriterService.store) or `<category>: <key> = <value>`
 * (backfillFromAiMemory). A row is rewritten in place and keeps its id (PUT /ai/businesses/:id/ai/memory with the same
 * category and key, a document extracted again, a promotion into the same key: every writer upserts on business,
 * category and key, and none changes a row's category or key), so that the row exists does not say a copy of it is
 * current; a copy of a value the row no longer holds is neither written (insert) nor served (search).
 */
function copyHoldsRowValue(content: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(${content} = m.value OR ${content} = (m.category || ': ' || m.key || ' = ' || m.value))`;
}

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

  /**
   * Embeds `content` and stores it. A copy of an AiMemory row (sourceType 'memory') is written only while that row is
   * still in the business and holds what the copy holds (see insert), so a row deleted or rewritten while its embedding
   * was being made gets no copy of the value it no longer holds.
   */
  async store(input: StoreMemoryInput): Promise<string> {
    try {
      await this.storeCopy(input);
      return input.sourceId;
    } catch (err: any) {
      this.logger.error(`Failed to store semantic memory: ${(err as Error).message}`);
      throw err;
    }
  }

  /** store(), answering whether a row was written. */
  private async storeCopy(input: StoreMemoryInput): Promise<boolean> {
    const embedding = await this.generateEmbedding(input.businessId, input.content);
    const written = await this.insert(input, embedding);
    if (written) {
      this.events.emit('memory.stored', {
        businessId: input.businessId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      });
    }
    return written;
  }

  /**
   * W1F-MEMORY-COPIES: the embedding is a provider call, made after the caller read what it copies, and the row may be
   * deleted or rewritten in between (a member's DELETE .../ai/memory/:category/:key, the consolidation's withdrawal of a
   * member's promoted answer, the owner's PUT .../ai/memory of a new value, the document extracted again). Writing the
   * copy anyway put a value the row no longer holds back in front of every member (search and KEY's memory block read
   * it). So a copy of an AiMemory row (sourceType 'memory') is inserted only if the row is still in this business and
   * still holds what the copy holds (copyHoldsRowValue: the backfill's copy of the value it read, and, review
   * SEC-W1FMC-1, UnifiedMemoryWriterService.store's copy of the value it wrote); otherwise nothing is written. The row
   * is read FOR SHARE in the same statement: a deletion or rewrite that has not committed holds this insert until it
   * commits, and the row is then read again as it is (a plain read would see the old row and commit a copy the
   * deletion's copy delete, its snapshot taken, never sees). deleteAiMemoriesWithCopies deletes the rows before their
   * copies for the same reason. Other source types insert as before.
   */
  private async insert(input: StoreMemoryInput, embedding: number[]): Promise<boolean> {
    const id = this.generateId();
    const vectorLiteral = `[${embedding.join(',')}]`;
    if (input.sourceType !== AI_MEMORY_COPY_SOURCE_TYPE) {
      await this.prisma.client.$executeRaw(
        Prisma.sql`INSERT INTO "ai_memory_embeddings" (id, business_id, content, source_type, source_id, embedding, metadata, created_at)
        VALUES (${id}, ${input.businessId}, ${input.content}, ${input.sourceType}, ${input.sourceId}, ${vectorLiteral}::vector, ${input.metadata ?? {}}, NOW())`,
      );
      return true;
    }
    const written = await this.prisma.client.$executeRaw(
      Prisma.sql`WITH source AS (
          SELECT m.id FROM "ai_memories" m
          WHERE m.id = ${input.sourceId} AND m.business_id = ${input.businessId}
            AND ${copyHoldsRowValue(Prisma.sql`${input.content}::text`)}
          FOR SHARE
        )
        INSERT INTO "ai_memory_embeddings" (id, business_id, content, source_type, source_id, embedding, metadata, created_at)
        SELECT ${id}::text, ${input.businessId}::text, ${input.content}::text, ${input.sourceType}::text, ${input.sourceId}::text,
               ${vectorLiteral}::vector, ${JSON.stringify(input.metadata ?? {})}::jsonb, NOW()
        FROM source`,
    );
    if (written === 0) {
      this.logger.debug(`Skipped the semantic copy of memory ${input.sourceId}: the row is gone or changed since it was read`);
    }
    return written > 0;
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

      const vectorLiteral = `[${embedding.join(',')}]`;

      // W1F-MEMORY-COPIES: a copy of an AiMemory row is served only while its row is (it is still in the business and
      // has not expired, as AiMemoryService.getAll reads it) and only while it holds what the row holds now (review
      // SEC-W1FMC-1, copyHoldsRowValue: a row rewritten in place keeps its id). Copies a deletion left behind before
      // every deletion removed its copies (deleteAiMemoriesWithCopies), and copies of a value a row was rewritten from,
      // are not served.
      let query = Prisma.sql`
        SELECT id, content, source_type, source_id, metadata,
               1 - (embedding <=> ${vectorLiteral}::vector) as similarity
        FROM "ai_memory_embeddings" e
        WHERE business_id = ${params.businessId}
          AND 1 - (embedding <=> ${vectorLiteral}::vector) >= ${minSim}
          AND (
            e.source_type <> ${AI_MEMORY_COPY_SOURCE_TYPE}
            OR EXISTS (
              SELECT 1 FROM "ai_memories" m
              WHERE m.id = e.source_id AND m.business_id = e.business_id
                AND (m.expires_at IS NULL OR m.expires_at > NOW())
                AND ${copyHoldsRowValue(Prisma.sql`e.content`)}
            )
          )
      `;

      if (params.sourceTypes && params.sourceTypes.length > 0) {
        query = Prisma.sql`${query} AND source_type IN (${Prisma.join(params.sourceTypes)})`;
      }

      query = Prisma.sql`${query} ORDER BY embedding <=> ${vectorLiteral}::vector LIMIT ${limit}`;

      const results = await this.prisma.client.$queryRaw<Array<{
        id: string;
        content: string;
        source_type: string;
        source_id: string;
        metadata: any;
        similarity: number;
      }>>(query);

      return results.map((r) => ({
        id: r.id,
        content: r.content,
        sourceType: r.source_type,
        sourceId: r.source_id,
        metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata,
        similarity: Number(r.similarity),
      }));
    } catch (err: any) {
      // W7-AI-SERVICES-503 (R0-07a rule): embeddings not configured fails visibly.
      // TemporalFlowService, UnifiedMemoryRetrievalService and (since the
      // W7-AI-SERVICES-503 review repair, SEC503-1 / CR-503-1)
      // FlowOrchestratorService.buildSemanticMemorySection catch it: optional
      // enrichment of a turn that goes on without it.
      if (isAiProviderUnavailable(err)) throw err;
      this.logger.error(`Semantic search failed: ${(err as Error).message}`);
      return [];
    }
  }

  /**
   * Copies the business's AiMemory rows into ai_memory_embeddings. W1F-MEMORY-COPIES: each copy is written only while
   * its row still holds the value read here (insert), so a row deleted or rewritten while the copy's embedding was
   * being made gets no copy; the answer counts the copies written.
   */
  async backfillFromAiMemory(businessId: string): Promise<number> {
    const memories = await this.prisma.client.aiMemory.findMany({
      where: { businessId },
      take: 500,
    });

    let stored = 0;
    for (const memory of memories) {
      try {
        const written = await this.storeCopy({
          businessId,
          content: `${memory.category}: ${memory.key} = ${memory.value}`,
          sourceType: AI_MEMORY_COPY_SOURCE_TYPE,
          sourceId: memory.id,
          metadata: { category: memory.category, key: memory.key, confidence: memory.confidence },
        });
        if (written) stored++;
      } catch (err: any) {
          // W7-AI-SERVICES-503 (R0-07a rule): the provider refusal is the same for every
          // memory, so it stops the backfill and answers the 503; any other failure skips one.
          if (isAiProviderUnavailable(err)) throw err;
          this.logger.warn(`On error: ${err instanceof Error ? err.message : err}`);
        }
    }

    this.logger.log(`Backfilled ${stored} memories for ${businessId}`);
    return stored;
  }

  async deleteForSource(sourceType: string, sourceId: string): Promise<void> {
    await this.prisma.client.$executeRaw(
      Prisma.sql`DELETE FROM "ai_memory_embeddings" WHERE source_type = ${sourceType} AND source_id = ${sourceId}`,
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
