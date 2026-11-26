import { Injectable, Logger, Inject, HttpException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AiUsageService } from './ai-usage.service';
import {
  classifyAiMemoryWrite,
  classifyEmbeddingWrite,
  isMemoryRowDataClass,
  MEMORY_DATA_CLASS_RANK,
  type MemoryRowDataClass,
} from './memory-classification';

function sqlDataClassRank(col: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`CASE ${col}
    WHEN 'SECRET_BEARING' THEN 4
    WHEN 'PERSONAL' THEN 3
    WHEN 'REVENUE' THEN 2
    WHEN 'UNCLASSIFIED' THEN 1
    WHEN 'GENERAL' THEN 0
    ELSE -1
  END`;
}

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
 * current; a copy of a value the row no longer holds is neither written (insert) nor served (search), and
 * (FU-MEMORY-COPIES-REWRITE) the rewrite deletes it (upsertAiMemoryDroppingStaleCopies in ai-memory.service.ts).
 * apps/server/scripts/cleanup-stale-memory-copies.ts states the same test in its own SQL (the script imports only
 * @keyflow/db); apps/server/test/ai-memory-copies-rewrite.integration.test.ts V71I-07 holds the two to the same set.
 */
export function copyHoldsRowValue(content: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(${content} = m.value OR ${content} = (m.category || ': ' || m.key || ' = ' || m.value))`;
}

/**
 * FU-MEMORY-COPIES-REWRITE review SEC-FUMCR-1, SEC-FUMCR-2, COR-V71I-2: the AiMemory categories that hold
 * configuration, not memory. 'settings' holds ModelGatewayService's ai_preferences (the owner's BYOK provider keys, as
 * AES-GCM ciphertext) and routing table, and AiOversightService's autonomy settings; AiController already reserves it
 * (PUT and DELETE .../ai/memory refuse it), and those services read their own rows by key. No AI memory reader serves
 * such a row: AiMemoryService.getAll and getByCategory do not list it (GET .../ai/memory, the profile interview, KEY's
 * cortex memory), KEY's structured memory block (UnifiedMemoryRetrievalService) does not read it, and it has no
 * semantic copy: the backfill does not copy it (its value never reaches the embedding provider), store writes no copy
 * of it, search serves none made before, and apps/server/scripts/cleanup-stale-memory-copies.ts deletes those (reason
 * settings_row). So its writers, which upsert outside upsertAiMemoryDroppingStaleCopies (ai-memory.service.ts), leave
 * no copy of an old value behind: an owner's rotated key leaves nothing of the old ciphertext in ai_memory_embeddings.
 */
export const AI_MEMORY_SETTINGS_CATEGORIES: readonly string[] = ['settings'];

/**
 * MEM-DOC-EXTRACTION-SIGHT (D-234): the AiMemory category of an uploaded document's extracted data (provenance unknown:
 * it fails closed for a reader without revenue read). AiMemoryService re-exports it with its rule.
 */
export const DOCUMENT_EXTRACTION_CATEGORY = 'document_extraction';

/** Whether an AiMemory category holds configuration, not memory (AI_MEMORY_SETTINGS_CATEGORIES). */
export function isAiMemorySettingsCategory(category: string): boolean {
  return AI_MEMORY_SETTINGS_CATEGORIES.includes(category);
}

/** The Prisma filter that leaves the settings rows out of an AiMemory read (AI_MEMORY_SETTINGS_CATEGORIES). */
export function aiMemoryWithoutSettings(): { notIn: string[] } {
  return { notIn: [...AI_MEMORY_SETTINGS_CATEGORIES] };
}

/** SQL: the AiMemory row `m` is memory, not a settings row (AI_MEMORY_SETTINGS_CATEGORIES). */
function rowIsMemory(): Prisma.Sql {
  return Prisma.sql`m.category NOT IN (${Prisma.join([...AI_MEMORY_SETTINGS_CATEGORIES])})`;
}

/**
 * MEM-SEMANTIC-SIGHT: a reader's semantic read (search with visibleTo) reads pages of at least SEMANTIC_PAGE rows and at
 * most MAX_SEMANTIC_SCAN rows in all, as the reader's temporal timeline read does (TemporalFlowService.list): past that
 * the answer may be short.
 */
const SEMANTIC_PAGE = 50;
const MAX_SEMANTIC_SCAN = 5_000;

/** How many times a re-copy refused because its row was rewritten again meanwhile tries with what the row holds now. */
const RECOPY_ATTEMPTS = 3;

/** The AiMemory row fields a semantic copy is made from. */
export interface AiMemoryCopySource {
  id: string;
  businessId: string;
  category: string;
  key: string;
  value: string;
  confidence: number;
  dataClass?: string | null;
  moduleScope?: string[] | null;
}

/** A copy a rewrite deleted (upsertAiMemoryDroppingStaleCopies): its content and metadata as they were. */
export interface DroppedAiMemoryCopy {
  content: string;
  metadata: unknown;
}

/** The backfill's copy of a row: `<category>: <key> = <value>` (the entry form; the other form is the value alone). */
export function aiMemoryEntryCopy(row: Pick<AiMemoryCopySource, 'category' | 'key' | 'value'>): string {
  return `${row.category}: ${row.key} = ${row.value}`;
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
  dataClass?: MemoryRowDataClass | null;
  moduleScope?: string[] | null;
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
   * FU-MEMORY-COPIES-REWRITE review COR-V71I-4: the re-copies started in the background (recopyInBackground) and not
   * finished, by AiMemory row id. Each row's re-copy runs after the one before it, and store() waits for the row's.
   */
  private readonly recopies = new Map<string, Promise<void>>();

  /**
   * Embeds `content` and stores it. A copy of an AiMemory row (sourceType 'memory') is written only while that row is
   * still in the business and holds what the copy holds (see insert), so a row deleted or rewritten while its embedding
   * was being made gets no copy of the value it no longer holds. FU-MEMORY-COPIES-REWRITE: a copy of an AiMemory row
   * that the row already has (the same content; a rewrite re-copies the row in the forms it had before
   * UnifiedMemoryWriterService.store indexes it) is not embedded or written again; the row's re-copy in flight, if
   * any, is waited for first (review COR-V71I-4: the re-copy runs after the rewrite answers). Review SEC-FUMCR-1: a
   * settings row (AI_MEMORY_SETTINGS_CATEGORIES) is not copied, and its value is not sent to the embedding provider.
   */
  async store(input: StoreMemoryInput): Promise<string> {
    try {
      if (input.sourceType === AI_MEMORY_COPY_SOURCE_TYPE) {
        await this.recopies.get(input.sourceId);
        if ((await this.copyTarget(input)) !== 'missing') return input.sourceId;
      }
      await this.storeCopy(input);
      return input.sourceId;
    } catch (err: any) {
      this.logger.error(`Failed to store semantic memory: ${(err as Error).message}`);
      throw err;
    }
  }

  /**
   * Whether a copy with this content of the AiMemory row `input` names is worth making: 'present' (the row already has
   * it), 'not_memory' (the row is a settings row: it has no copy) or 'missing'. A row that is gone or holds another
   * value answers 'missing' here; insert refuses its copy.
   */
  private async copyTarget(input: Pick<StoreMemoryInput, 'businessId' | 'sourceId' | 'content'>): Promise<'present' | 'not_memory' | 'missing'> {
    const [found] = await this.prisma.client.$queryRaw<Array<{ settings: boolean; present: boolean }>>(
      Prisma.sql`SELECT
          EXISTS (SELECT 1 FROM "ai_memories" m
                   WHERE m.id = ${input.sourceId} AND m.business_id = ${input.businessId} AND NOT (${rowIsMemory()})) AS settings,
          EXISTS (SELECT 1 FROM "ai_memory_embeddings"
                   WHERE business_id = ${input.businessId} AND source_type = ${AI_MEMORY_COPY_SOURCE_TYPE}
                     AND source_id = ${input.sourceId} AND content = ${input.content}) AS present`,
    );
    if (found?.settings) return 'not_memory';
    return found?.present ? 'present' : 'missing';
  }

  /**
   * FU-MEMORY-COPIES-REWRITE review COR-V71I-4: runs recopyRewrittenRow in the background and returns at once, so the
   * rewrite it follows (which has committed) answers without waiting on the embedding provider (up to two calls per
   * row, each under the provider client's own timeout and retries). A row's re-copies run one after another, in the
   * order they were started; store() of a copy of that row waits for them (no duplicate of a form the re-copy writes).
   * A failure is logged and goes no further: the rewrite's old copies are gone either way, and the row is copied again
   * by its next rewrite or the next backfill. Re-copies still running when the process stops are lost the same way.
   */
  recopyInBackground(row: AiMemoryCopySource, dropped: DroppedAiMemoryCopy[]): void {
    if (dropped.length === 0) return;
    const before = this.recopies.get(row.id) ?? Promise.resolve();
    const run: Promise<void> = before
      .then(() => this.recopyRewrittenRow(row, dropped))
      .then(
        () => undefined,
        (err: unknown) => {
          this.logger.warn(`Could not copy rewritten memory ${row.id} again: ${err instanceof Error ? err.message : String(err)}`);
        },
      )
      .finally(() => {
        if (this.recopies.get(row.id) === run) this.recopies.delete(row.id);
      });
    this.recopies.set(row.id, run);
  }

  /**
   * Resolves once every re-copy started before or while it waits has finished: for a caller that must read the copies
   * a rewrite makes (the integration suites). Nothing waits for it on shutdown, where a slow provider would hold the
   * process; a re-copy cut off there is lost as described at recopyInBackground.
   */
  async recopiesSettled(): Promise<void> {
    while (this.recopies.size > 0) await Promise.all([...this.recopies.values()]);
  }

  /**
   * FU-MEMORY-COPIES-REWRITE: copies a rewritten AiMemory row again, of the value it holds now, in each form its
   * rewrite deleted (`dropped`, from upsertAiMemoryDroppingStaleCopies): the entry form (the backfill's
   * `<category>: <key> = <value>`, with the backfill's metadata) and the value form (UnifiedMemoryWriterService's, with
   * the deleted copy's metadata). A form the row already has (another re-copy or KEY's writer made it) is skipped. A
   * copy is written only while the row still holds the value it copies (insert). Review COR-V71I-1: when that insert
   * is refused the row was rewritten again meanwhile, and that rewrite may have found no copy to drop (this one was not
   * written yet), so it started no re-copy; the row is read again and copied with what it holds now, up to
   * RECOPY_ATTEMPTS times (a row deleted meanwhile is not copied). When the embedding path is off (no OpenAI key,
   * KEY_DISABLED, or the gateway's provider_unavailable: the same 503 for every form) nothing more is tried; any other
   * failure skips that form. Never throws for a form: the rewrite it follows has committed, and its old copies are gone
   * either way. Answers how many copies were written. recopyInBackground runs it after the rewrite has answered.
   */
  async recopyRewrittenRow(row: AiMemoryCopySource, dropped: DroppedAiMemoryCopy[]): Promise<number> {
    const entryPrefix = `${row.category}: ${row.key} = `;
    const wantsEntry = dropped.some((d) => d.content.startsWith(entryPrefix));
    const valueCopy = dropped.find((d) => !d.content.startsWith(entryPrefix));
    const valueMetadata =
      valueCopy && valueCopy.metadata && typeof valueCopy.metadata === 'object' && !Array.isArray(valueCopy.metadata)
        ? (valueCopy.metadata as Record<string, unknown>)
        : {};

    let current: AiMemoryCopySource | null = row;
    let written = 0;
    for (let attempt = 0; current && attempt < RECOPY_ATTEMPTS; attempt++) {
      const of: AiMemoryCopySource = current;
      const forms: Array<{ content: string; metadata: Record<string, unknown> }> = [];
      if (wantsEntry) {
        forms.push({ content: aiMemoryEntryCopy(of), metadata: { category: of.category, key: of.key, confidence: of.confidence } });
      }
      if (valueCopy) forms.push({ content: of.value, metadata: valueMetadata });

      const derived = classifyAiMemoryWrite({
        category: of.category,
        key: of.key,
        value: of.value,
        explicitDataClass: isMemoryRowDataClass(of.dataClass) ? of.dataClass : null,
        explicitModuleScope: of.moduleScope ?? null,
      });

      let refused = false;
      for (const form of forms) {
        const copy: StoreMemoryInput = {
          businessId: of.businessId,
          content: form.content,
          sourceType: AI_MEMORY_COPY_SOURCE_TYPE,
          sourceId: of.id,
          metadata: form.metadata,
          dataClass: derived.dataClass,
          moduleScope: derived.moduleScope,
        };
        try {
          const target = await this.copyTarget(copy);
          if (target === 'not_memory') return written;
          if (target === 'present') continue;
          if (await this.storeCopy(copy)) written++;
          else refused = true;
        } catch (err: unknown) {
          if (isAiProviderUnavailable(err)) {
            this.logger.debug(`Memory ${of.id} was rewritten and its old copies deleted; the embedding path is off, so it was not copied again`);
            return written;
          }
          this.logger.warn(`Could not copy rewritten memory ${of.id} again: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (!refused) return written;
      current = await this.prisma.client.aiMemory.findFirst({
        where: { id: of.id, businessId: of.businessId },
        select: {
          id: true,
          businessId: true,
          category: true,
          key: true,
          value: true,
          confidence: true,
          dataClass: true,
          moduleScope: true,
        },
      });
    }
    if (current) this.logger.warn(`Memory ${row.id} kept changing while it was copied again; it is copied by its next rewrite or backfill`);
    return written;
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
   * copies for the same reason. FU-MEMORY-COPIES-REWRITE review SEC-FUMCR-1: a settings row (AI_MEMORY_SETTINGS_CATEGORIES)
   * gets no copy. Other source types insert as before.
   *
   * MEM-CLASS-COLUMNS (P125, D-257): every embedding copy records `data_class` (most restrictive of source row and
   * caller classification) and `module_scope` (sorted deduplicated union of source row and caller module scopes).
   */
  private async insert(input: StoreMemoryInput, embedding: number[]): Promise<boolean> {
    const id = this.generateId();
    const vectorLiteral = `[${embedding.join(',')}]`;
    const classified = classifyEmbeddingWrite({
      sourceType: input.sourceType,
      content: input.content,
      metadata: input.metadata ?? null,
      explicitDataClass: isMemoryRowDataClass(input.dataClass) ? input.dataClass : null,
      explicitModuleScope: input.moduleScope ?? null,
    });
    const callerRank = MEMORY_DATA_CLASS_RANK[classified.dataClass];

    if (input.sourceType === 'temporal_memory') {
      await this.prisma.client.$executeRaw(
        Prisma.sql`INSERT INTO "ai_memory_embeddings" (id, business_id, content, source_type, source_id, embedding, metadata, data_class, module_scope, created_at)
        SELECT ${id}::text, ${input.businessId}::text, ${input.content}::text, ${input.sourceType}::text, ${input.sourceId}::text,
               ${vectorLiteral}::vector, ${JSON.stringify(input.metadata ?? {})}::jsonb,
               CASE WHEN ${sqlDataClassRank(Prisma.sql`t.data_class`)} >= ${callerRank}
                    THEN t.data_class
                    ELSE ${classified.dataClass}::text
               END,
               ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(t.module_scope, ARRAY[]::text[]) || ${classified.moduleScope}::text[]) AS x WHERE x IS NOT NULL ORDER BY x),
               NOW()
        FROM (VALUES (1)) AS _v(one)
        LEFT JOIN "temporal_flow_memories" t
          ON t.id = ${input.sourceId}::text AND t.business_id = ${input.businessId}::text`,
      );
      return true;
    }

    if (input.sourceType !== AI_MEMORY_COPY_SOURCE_TYPE) {
      await this.prisma.client.$executeRaw(
        Prisma.sql`INSERT INTO "ai_memory_embeddings" (id, business_id, content, source_type, source_id, embedding, metadata, data_class, module_scope, created_at)
        VALUES (${id}, ${input.businessId}, ${input.content}, ${input.sourceType}, ${input.sourceId}, ${vectorLiteral}::vector, ${input.metadata ?? {}}, ${classified.dataClass}, ${classified.moduleScope}::text[], NOW())`,
      );
      return true;
    }

    const written = await this.prisma.client.$executeRaw(
      Prisma.sql`WITH source AS (
          SELECT m.id, m.data_class, m.module_scope FROM "ai_memories" m
          WHERE m.id = ${input.sourceId} AND m.business_id = ${input.businessId}
            AND ${copyHoldsRowValue(Prisma.sql`${input.content}::text`)}
            AND ${rowIsMemory()}
          FOR SHARE
        )
        INSERT INTO "ai_memory_embeddings" (id, business_id, content, source_type, source_id, embedding, metadata, data_class, module_scope, created_at)
        SELECT ${id}::text, ${input.businessId}::text, ${input.content}::text, ${input.sourceType}::text, ${input.sourceId}::text,
               ${vectorLiteral}::vector, ${JSON.stringify(input.metadata ?? {})}::jsonb,
               CASE WHEN ${sqlDataClassRank(Prisma.sql`source.data_class`)} >= ${callerRank}
                    THEN source.data_class
                    ELSE ${classified.dataClass}::text
               END,
               ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(source.module_scope, ARRAY[]::text[]) || ${classified.moduleScope}::text[]) AS x WHERE x IS NOT NULL ORDER BY x),
               NOW()
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
    /**
     * MEM-DOC-EXTRACTION-SIGHT (D-234; orchestrator review COR-MDX-1): serve the copies of document extractions too (a
     * copy whose AiMemory row's category is DOCUMENT_EXTRACTION_CATEGORY, whatever its own metadata says). Only when
     * true: by default every such copy is left out before the limit, so a search for a reader without revenue read never
     * takes one and none takes a place in its limit. A caller passes true only for a reader whose sight reads revenue
     * (readsDocumentExtractions).
     */
    includeDocumentExtractionCopies?: boolean;
    /**
     * MEM-SEMANTIC-SIGHT (D-234, D-257): the reader projection (semanticHitsVisibleTo in semantic-memory-sight.ts):
     * whether each hit of a page, in rank order, may be handed to the reader. When given, the limit counts only the hits
     * it keeps: the read pages on, in a stable order (similarity, then id), past every hit it withholds, until the limit
     * is met, the matches end or MAX_SEMANTIC_SCAN rows have been read. A withheld hit takes no place and changes nothing
     * returned. Without it the read is as before (one page of `limit`). When it raises, the search answers as for any
     * other failure (nothing), never the hits of later pages.
     */
    visibleTo?: (hits: SemanticMemory[]) => Promise<boolean[]>;
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
      // are not served. FU-MEMORY-COPIES-REWRITE review SEC-FUMCR-1/2: nor is a copy of a settings row
      // (AI_MEMORY_SETTINGS_CATEGORIES); only a backfill run before the review repair made one.
      let query = Prisma.sql`
        SELECT id, content, source_type, source_id, metadata,
               1 - (embedding <=> ${vectorLiteral}::vector) as similarity,
               (embedding <=> ${vectorLiteral}::vector)::text as distance
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
                AND ${rowIsMemory()}
            )
          )
      `;

      if (params.sourceTypes && params.sourceTypes.length > 0) {
        query = Prisma.sql`${query} AND source_type IN (${Prisma.join(params.sourceTypes)})`;
      }

      if (params.includeDocumentExtractionCopies !== true) {
        query = Prisma.sql`${query} AND NOT (
          e.source_type = ${AI_MEMORY_COPY_SOURCE_TYPE}
          AND EXISTS (
            SELECT 1 FROM "ai_memories" dx
            WHERE dx.id = e.source_id AND dx.business_id = e.business_id AND dx.category = ${DOCUMENT_EXTRACTION_CATEGORY}
          )
        )`;
      }

      // Codex P2 on #226: a reader's read pages by keyset (similarity, then id), never by row offset: a copy written or
      // deleted ahead of the read position between two pages can neither shift a hit past the next page nor repeat one.
      // The cursor is the last row's distance as float8 text (exact: Postgres prints the shortest exact form) and its id.
      type Cursor = { distance: string; id: string };
      const distance = Prisma.sql`(embedding <=> ${vectorLiteral}::vector)`;
      const page = async (take: number, after?: Cursor): Promise<Array<SemanticMemory & { distance: string }>> => {
        const keyset = after
          ? Prisma.sql` AND (${distance} > ${after.distance}::float8 OR (${distance} = ${after.distance}::float8 AND e.id > ${after.id}))`
          : Prisma.empty;
        const results = await this.prisma.client.$queryRaw<Array<{
          id: string;
          content: string;
          source_type: string;
          source_id: string;
          metadata: any;
          similarity: number;
          distance: string;
        }>>(Prisma.sql`${query}${keyset} ORDER BY ${distance}, e.id LIMIT ${take}`);
        return results.map((r) => ({
          id: r.id,
          content: r.content,
          sourceType: r.source_type,
          sourceId: r.source_id,
          metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata,
          similarity: Number(r.similarity),
          distance: r.distance,
        }));
      };
      const strip = ({ distance: _distance, ...hit }: SemanticMemory & { distance: string }): SemanticMemory => hit;

      if (!params.visibleTo) return (await page(limit)).map(strip);

      // MEM-SEMANTIC-SIGHT: filtered before the limit is cut (see visibleTo). Each page doubles (fewer round trips past
      // many withheld hits); a hit is kept once.
      const want = Math.max(0, Math.trunc(limit) || 0);
      const visible: SemanticMemory[] = [];
      const seen = new Set<string>();
      let batch = Math.max(want * 4, SEMANTIC_PAGE);
      let after: Cursor | undefined;
      for (let scanned = 0; visible.length < want && scanned < MAX_SEMANTIC_SCAN; batch *= 2) {
        const take = Math.min(batch, MAX_SEMANTIC_SCAN - scanned);
        const rows = await page(take, after);
        if (rows.length === 0) break;
        const hits = rows.map(strip);
        const keep = await params.visibleTo(hits);
        hits.forEach((hit, i) => {
          if (keep[i] === true && !seen.has(hit.id)) {
            seen.add(hit.id);
            visible.push(hit);
          }
        });
        scanned += rows.length;
        const last = rows[rows.length - 1];
        after = { distance: last.distance, id: last.id };
        if (rows.length < take) break;
      }
      return visible.slice(0, want);
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
   * being made gets no copy; the answer counts the copies written. FU-MEMORY-COPIES-REWRITE review SEC-FUMCR-1/2: the
   * settings rows (AI_MEMORY_SETTINGS_CATEGORIES) are not read, so their values never reach the embedding provider.
   */
  async backfillFromAiMemory(businessId: string): Promise<number> {
    const memories = await this.prisma.client.aiMemory.findMany({
      where: { businessId, category: aiMemoryWithoutSettings() },
      take: 500,
    });

    let stored = 0;
    for (const memory of memories) {
      try {
        const classified = classifyAiMemoryWrite({
          category: memory.category,
          key: memory.key,
          value: memory.value,
          source: memory.source,
          explicitDataClass: isMemoryRowDataClass(memory.dataClass) ? memory.dataClass : null,
          explicitModuleScope: memory.moduleScope ?? null,
        });
        const written = await this.storeCopy({
          businessId,
          content: aiMemoryEntryCopy(memory),
          sourceType: AI_MEMORY_COPY_SOURCE_TYPE,
          sourceId: memory.id,
          metadata: { category: memory.category, key: memory.key, confidence: memory.confidence },
          dataClass: classified.dataClass,
          moduleScope: classified.moduleScope,
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
