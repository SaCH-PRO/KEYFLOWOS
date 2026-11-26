import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { Prisma, type AiMemory } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiExecutionLogService } from './ai-execution-log.service';
import {
  AI_MEMORY_COPY_SOURCE_TYPE,
  SemanticMemoryService,
  aiMemoryWithoutSettings,
  copyHoldsRowValue,
  isAiMemorySettingsCategory,
  type DroppedAiMemoryCopy,
  DOCUMENT_EXTRACTION_CATEGORY,
} from './semantic-memory.service';
import { BlueprintService } from '../blueprint/blueprint.service';
import {
  classifyAiMemoryWrite,
  isMemoryRowDataClass,
  mergeMemoryClassifications,
  modulesFromIdentifiers,
  mostRestrictiveDataClass,
  unionModuleScopes,
  type MemoryRowDataClass,
} from './memory-classification';

export type MemoryCategory =
  | 'goals'
  | 'tone'
  | 'riskTolerance'
  | 'outreachStyle'
  | 'reportingCadence'
  | 'priorities'
  | 'bottlenecks'
  | 'corrections'
  | 'patterns'
  | 'preferences'
  | 'learned_corrections'
  | 'execution_patterns'
  | 'role_activity'
  | 'user_preference'
  | 'business_fact'
  | 'past_decision'
  | 'failed_attempt'
  | 'successful_action'
  | 'communication_style'
  | 'risk_tolerance'
  | 'common_workflow'
  | 'current_goal'
  | 'long_term_strategy'
  | 'document_extraction';

export type MemorySource = 'user' | 'inferred' | 'approval_signal' | 'pattern_analysis' | 'feedback_loop' | 'role_engine';

/**
 * MEM-DOC-EXTRACTION-SIGHT (D-234, D-257): the category KeyCortexDocumentService.extractData stores an uploaded document's
 * extracted data under (key = the document's id). The document carries no classification (KeyDocument has only its file
 * type), so an extraction may be an invoice or a statement: its provenance is unknown and it fails closed. Only a member
 * reader with revenue read is handed one (the owner, a revenue reader); a member without revenue read and a turn with no
 * member reader are not. The surfaces covered, rows and their semantic copies alike:
 *  - KEY's prompt memory: the /ai flow chat's perception block and its "RELEVANT CONTEXT FROM MEMORY" section (chat and
 *    stream, the staff bridge), POST /cortex/chat's buildMemoryContext and the pipeline's chatMemoryFragments
 *    (UnifiedMemoryRetrievalService.documentExtractions, readersOwnPromptMemory);
 *  - SemanticMemoryService.search, which leaves every copy out unless asked (includeDocumentExtractionCopies), and
 *    GET .../agent/memory/search over it;
 *  - GET .../ai/memory (whole and by category), GET .../ai/profile/status and the profile interview's prompt.
 * GET .../ai/memory/context renders no extraction for anyone. The owners' digest counts them (it goes to the owners).
 * Classifying documents so that non-financial extractions reach more readers is a later packet (open question Q4c).
 */
export { DOCUMENT_EXTRACTION_CATEGORY };

/** MEM-DOC-EXTRACTION-SIGHT: `entries` without the document extractions (DOCUMENT_EXTRACTION_CATEGORY), in order. */
export function withoutDocumentExtractions<T extends { category: string }>(entries: readonly T[]): T[] {
  return entries.filter((entry) => entry.category !== DOCUMENT_EXTRACTION_CATEGORY);
}

export interface MemoryEntry {
  id: string;
  category: string;
  key: string;
  value: string;
  confidence: number;
  source: string;
  expiresAt: Date | null;
  dataClass?: string | null;
  moduleScope?: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface MemoryUpsertInput {
  category: MemoryCategory;
  key: string;
  value: string;
  confidence?: number;
  source?: MemorySource;
  expiresAt?: Date | null;
  dataClass?: MemoryRowDataClass;
  moduleScope?: string[];
}

export interface MemoryContextBlock {
  goals: string[];
  tone: string | null;
  riskTolerance: string | null;
  outreachStyle: string | null;
  reportingCadence: string | null;
  priorities: string[];
  bottlenecks: string[];
  corrections: string[];
  /**
   * Lessons from KEY's own execution failures, distinct from `corrections`.
   *
   * `corrections` is what the USER rejected or corrected — a preference.
   * These come from FeedbackLoopService after a tool actually failed, so they
   * are operational rather than preferential, and they must not be blended
   * into "respect these" or the model will read a stale failure as a standing
   * instruction from the owner.
   */
  learnedCorrections: string[];
  patterns: string[];
}

/**
 * How many rows one batch of deleteAiMemoriesWithCopies reads and deletes. Under @keyflow/db's findMany cap (its
 * defaultTakeExtension answers at most 1000 rows, inside a transaction too), so a batch reads all it asks for.
 */
const AI_MEMORY_DELETE_BATCH = 500;

/**
 * W1F-MEMORY-COPIES: the one way an AiMemory row is deleted. A row has semantic copies in ai_memory_embeddings
 * (source_type AI_MEMORY_COPY_SOURCE_TYPE, source_id the row's id), and every member reads them back (GET
 * .../agent/memory/search, and KEY's memory block as [ai_memory_embedding]), so a deletion that left them kept serving
 * the deleted value; before this door only the consolidation's withdrawal removed them (W11-MEMORY-PROMOTE-SCOPE).
 * Deletes every row of the business that matches `where`, with the copies of every row that is gone. The rows are read
 * in id order, AI_MEMORY_DELETE_BATCH at a time, each batch after the last id the one before read, until a batch reads
 * fewer (review COR-W1FMC-1 / SEC-W1FMC-2: one read is capped at 1000 rows, and a deletion that deleted only the rows
 * it read left the rest, served with their copies). Each batch is one transaction:
 *   - the batch's rows first, then their copies, each its own statement: deleting a row locks it until the commit, so
 *     a backfill that writes a copy of it (which takes a share lock on the row, see SemanticMemoryService.insert)
 *     either wrote before the row was deleted (its copy is committed, and the copy delete, a later statement, sees it)
 *     or waits for the commit and then finds the row gone and writes nothing;
 *   - a matched row that is still there once the delete has run (a concurrent write changed it so `where` no longer
 *     matches) keeps its copies; one a concurrent deletion removed first is gone, and its copies go here too.
 * A failure stops the deletion: the batches before it are deleted (each row with its copies), the rest are not.
 * The scope is the business: `where` cannot name another business's rows, and only this business's copies go.
 * Returns how many rows and copies were deleted. apps/server/test/ai-memory-copies.integration.test.ts holds every
 * AiMemory deletion in apps/server/src to this function.
 */
export async function deleteAiMemoriesWithCopies(
  prisma: PrismaService,
  businessId: string,
  where: Prisma.AiMemoryWhereInput,
): Promise<{ rows: number; copies: number }> {
  const scoped: Prisma.AiMemoryWhereInput = { ...where, businessId };
  let rows = 0;
  let copies = 0;
  let after: string | undefined;
  for (;;) {
    const batch = await prisma.client.$transaction(async (tx) => {
      const matched = (
        await tx.aiMemory.findMany({
          where: after === undefined ? scoped : { AND: [scoped, { id: { gt: after } }] },
          select: { id: true },
          orderBy: { id: 'asc' },
          take: AI_MEMORY_DELETE_BATCH,
        })
      ).map((r) => r.id);
      if (matched.length === 0) return { matched, rows: 0, copies: 0 };
      const deleted = await tx.aiMemory.deleteMany({ where: { ...scoped, id: { in: matched } } });
      const kept = new Set(
        (await tx.aiMemory.findMany({ where: { businessId, id: { in: matched } }, select: { id: true } })).map((r) => r.id),
      );
      const gone = matched.filter((id) => !kept.has(id));
      if (gone.length === 0) return { matched, rows: deleted.count, copies: 0 };
      const removed = await tx.aiMemoryEmbedding.deleteMany({
        where: { businessId, sourceType: AI_MEMORY_COPY_SOURCE_TYPE, sourceId: { in: gone } },
      });
      return { matched, rows: deleted.count, copies: removed.count };
    });
    rows += batch.rows;
    copies += batch.copies;
    if (batch.matched.length < AI_MEMORY_DELETE_BATCH) return { rows, copies };
    after = batch.matched[batch.matched.length - 1];
  }
}

/**
 * What copies a rewritten row again (SemanticMemoryService.recopyInBackground): the door hands it the row and the
 * copies its rewrite deleted, once the rewrite has committed.
 */
export type AiMemoryRecopier = Pick<SemanticMemoryService, 'recopyInBackground'>;

/** What an AiMemory write sets, besides the business, category and key that name the row. */
export interface AiMemoryWrite {
  create: Omit<Prisma.AiMemoryUncheckedCreateInput, 'id' | 'businessId' | 'category' | 'key'>;
  update: Omit<Prisma.AiMemoryUncheckedUpdateInput, 'id' | 'businessId' | 'category' | 'key'>;
}

/**
 * FU-MEMORY-COPIES-REWRITE (owner ruling D-221): the one way an AiMemory row is written in place. Every writer upserts a
 * row on its business, category and key, so a rewrite keeps the row's id, and the row's semantic copies in
 * ai_memory_embeddings (source_type AI_MEMORY_COPY_SOURCE_TYPE, source_id the row's id) were left holding the value it
 * held before. W1F-MEMORY-COPIES stopped serving them (search and KEY's memory block serve a copy only while it holds
 * what its row holds) but they stayed at rest: the owner's PUT of a new value left the old text in the table.
 * Upserts the row, then deletes the row's copies that do not hold what it now holds (copyHoldsRowValue), in one
 * transaction:
 *   - the row first, then its copies, each its own statement: the upsert locks the row until the commit, so a backfill
 *     that writes a copy of the old value (which takes a share lock on the row and re-reads it, see
 *     SemanticMemoryService.insert) either wrote before the rewrite (its copy is committed, and the deletion, a later
 *     statement, sees it) or waits for the commit and then finds the row holding the new value and writes nothing;
 *   - a write that does not change the value (a new confidence, an expiry) deletes nothing: every copy still holds it.
 * The scope is the business: only the named row's copies in this business go. A failure rolls both back. Answers the
 * row and the copies it deleted (their content and metadata). Once the transaction has committed, a rewrite that
 * deleted copies hands them to `recopier`, which copies the row again with its new value in each form it had, in the
 * background (review COR-V71I-3: every writer through the door, not only AiMemoryService.upsert; review COR-V71I-4: the
 * writer does not wait on the embedding provider). `recopier` is undefined only where no SemanticMemoryService is
 * wired (unit tests); the row then has no copy until the next backfill. apps/server/test/
 * ai-memory-copies-rewrite.integration.test.ts holds every AiMemory upsert and update in apps/server/src to this
 * function, but for the named settings writers, whose rows have no copy (V71I-09, V71I-13), and every call of it to
 * pass a re-copier (V71I-15).
 */
export async function upsertAiMemoryDroppingStaleCopies(
  prisma: PrismaService,
  businessId: string,
  row: { category: string; key: string },
  write: AiMemoryWrite,
  recopier: AiMemoryRecopier | undefined,
): Promise<{ row: AiMemory; dropped: DroppedAiMemoryCopy[] }> {
  const { category, key } = row;
  const createValue = typeof write.create.value === 'string' ? write.create.value : null;
  const rawCreateClass = isMemoryRowDataClass(write.create.dataClass) ? write.create.dataClass : null;
  const rawUpdateClass =
    typeof write.update.dataClass === 'string' && isMemoryRowDataClass(write.update.dataClass)
      ? write.update.dataClass
      : null;
  const rawCreateScope = Array.isArray(write.create.moduleScope) ? write.create.moduleScope : undefined;
  const rawUpdateScope = Array.isArray(write.update.moduleScope) ? write.update.moduleScope : undefined;

  const createClassified = classifyAiMemoryWrite({
    category,
    key,
    value: createValue,
    source: typeof write.create.source === 'string' ? write.create.source : null,
    explicitDataClass: rawCreateClass,
    explicitModuleScope: rawCreateScope ?? null,
  });

  const explicitUpdateClass =
    rawCreateClass || rawUpdateClass
      ? mostRestrictiveDataClass([rawCreateClass, rawUpdateClass])
      : null;
  const explicitUpdateScope = unionModuleScopes(rawCreateScope, rawUpdateScope);

  const rewritten = await prisma.client.$transaction(async (tx) => {
    const existing = await tx.aiMemory.findUnique({
      where: { businessId_category_key: { businessId, category, key } },
      select: { value: true, dataClass: true, moduleScope: true },
    });

    const effectiveUpdateValue =
      typeof write.update.value === 'string'
        ? write.update.value
        : (existing?.value ?? createValue);

    const updateClassifiedBase = classifyAiMemoryWrite({
      category,
      key,
      value: effectiveUpdateValue,
      source: typeof write.create.source === 'string' ? write.create.source : null,
      explicitDataClass: explicitUpdateClass,
      explicitModuleScope: explicitUpdateScope,
    });

    const updateClassified = existing
      ? mergeMemoryClassifications([
          {
            dataClass: isMemoryRowDataClass(existing.dataClass) ? existing.dataClass : null,
            moduleScope: Array.isArray(existing.moduleScope) ? existing.moduleScope : null,
          },
          updateClassifiedBase,
        ])
      : updateClassifiedBase;

    const written = await tx.aiMemory.upsert({
      where: { businessId_category_key: { businessId, category, key } },
      create: {
        ...write.create,
        businessId,
        category,
        key,
        dataClass: createClassified.dataClass,
        moduleScope: createClassified.moduleScope,
      },
      update: {
        ...write.update,
        dataClass: updateClassified.dataClass,
        moduleScope: updateClassified.moduleScope,
      },
    });
    const dropped = await tx.$queryRaw<DroppedAiMemoryCopy[]>(
      Prisma.sql`DELETE FROM "ai_memory_embeddings" e
        USING "ai_memories" m
        WHERE m.id = ${written.id} AND m.business_id = ${businessId}
          AND e.business_id = m.business_id AND e.source_type = ${AI_MEMORY_COPY_SOURCE_TYPE} AND e.source_id = m.id
          AND NOT ${copyHoldsRowValue(Prisma.sql`e.content`)}
        RETURNING e.content, e.metadata`,
    );
    return { row: written, dropped };
  });
  if (rewritten.dropped.length > 0) recopier?.recopyInBackground(rewritten.row, rewritten.dropped);
  return rewritten;
}

@Injectable()
export class AiMemoryService {
  private readonly logger = new Logger(AiMemoryService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiExecutionLogService) private readonly executionLog: AiExecutionLogService,
    @Inject(BlueprintService) private readonly blueprint: BlueprintService,
    // FU-MEMORY-COPIES-REWRITE: copies a rewritten row again (upsert). AiModule provides it beside this service.
    @Optional() @Inject(SemanticMemoryService) private readonly semantic?: SemanticMemoryService,
  ) {}

  /**
   * The business's AI memory rows that have not expired. FU-MEMORY-COPIES-REWRITE review SEC-FUMCR-2: not the settings
   * rows (AI_MEMORY_SETTINGS_CATEGORIES: the owner's AI preferences with the BYOK keys' ciphertext, the routing table,
   * the autonomy settings), which are configuration their own services read by key: GET .../ai/memory (any member),
   * the profile interview's prompt and KEY's cortex memory read this.
   */
  async getAll(businessId: string): Promise<MemoryEntry[]> {
    const records = await this.prisma.client.aiMemory.findMany({
      where: {
        businessId,
        category: aiMemoryWithoutSettings(),
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      orderBy: [{ category: 'asc' }, { updatedAt: 'desc' }],
    });
    return records;
  }

  /** The category's rows that have not expired; none for a settings category (review SEC-FUMCR-2, as getAll). */
  async getByCategory(businessId: string, category: MemoryCategory): Promise<MemoryEntry[]> {
    if (isAiMemorySettingsCategory(category)) return [];
    return this.prisma.client.aiMemory.findMany({
      where: {
        businessId,
        category,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async get(businessId: string, category: MemoryCategory, key: string): Promise<MemoryEntry | null> {
    return this.prisma.client.aiMemory.findUnique({
      where: {
        businessId_category_key: { businessId, category, key },
      },
    });
  }

  /**
   * Writes the row (FU-MEMORY-COPIES-REWRITE: through upsertAiMemoryDroppingStaleCopies, so a rewrite deletes the
   * copies of the value the row held). A rewrite that deleted copies copies the row again with its new value, one copy
   * per form it had, when the embedding path is on (SemanticMemoryService.recopyRewrittenRow; with no OpenAI key or
   * KEY_DISABLED nothing is embedded and the row keeps no copy until the next backfill). Review COR-V71I-4: the copy
   * is made after this answers (recopyInBackground), so PUT .../ai/memory, .../bulk and the writers that call this do
   * not wait on the embedding provider. A row that had no copy gets none: only POST .../agent/memory/backfill and KEY's
   * writer (indexSemantic) start copying a row.
   */
  async upsert(businessId: string, input: MemoryUpsertInput): Promise<MemoryEntry> {
    const {
      category,
      key,
      value,
      confidence = 1.0,
      source = 'user',
      expiresAt = null,
      dataClass,
      moduleScope,
    } = input;
    const classified = classifyAiMemoryWrite({
      category,
      key,
      value,
      source,
      explicitDataClass: dataClass ?? null,
      explicitModuleScope: moduleScope ?? null,
    });

    const { row } = await upsertAiMemoryDroppingStaleCopies(
      this.prisma,
      businessId,
      { category, key },
      {
        create: {
          value,
          confidence,
          source,
          expiresAt,
          dataClass: classified.dataClass,
          moduleScope: classified.moduleScope,
        },
        update: {
          value,
          confidence,
          source,
          expiresAt,
          dataClass: classified.dataClass,
          moduleScope: classified.moduleScope,
        },
      },
      this.semantic,
    );
    return row;
  }

  async upsertMany(businessId: string, inputs: MemoryUpsertInput[]): Promise<MemoryEntry[]> {
    const results: MemoryEntry[] = [];
    for (const input of inputs) {
      results.push(await this.upsert(businessId, input));
    }
    return results;
  }

  /** Deletes the row and its semantic copies (W1F-MEMORY-COPIES: deleteAiMemoriesWithCopies). False when there was none. */
  async remove(businessId: string, category: MemoryCategory, key: string): Promise<boolean> {
    try {
      const { rows } = await deleteAiMemoriesWithCopies(this.prisma, businessId, { category, key });
      return rows > 0;
    } catch (err) {
      this.logger.warn(`Failed to remove memory ${category}:${key}: ${(err as Error).message}`);
      return false;
    }
  }

  /** Deletes every row of the category and their semantic copies (W1F-MEMORY-COPIES); answers how many rows. */
  async removeCategory(businessId: string, category: MemoryCategory): Promise<number> {
    const { rows } = await deleteAiMemoriesWithCopies(this.prisma, businessId, { category });
    return rows;
  }

  /**
   * MEM-PATTERNS-SIGHT (D-257, D-100, D-234, D-203): `opts.patternVisible`, when given, is asked of each 'patterns' row
   * (PatternDetectorService stores "N overdue invoices totaling X"), and a row it refuses is left out of the block. A
   * caller that renders the block into a reader's prompt passes the reader's rule (the flow chat: turnPatternVisibility);
   * with none every pattern is kept, as before.
   */
  async buildContextBlock(
    businessId: string,
    opts: { patternVisible?: (row: Pick<MemoryEntry, 'category' | 'key' | 'value'>) => boolean } = {},
  ): Promise<MemoryContextBlock> {
    const [memories, blueprint] = await Promise.all([
      this.getAll(businessId),
      this.blueprint.getBlueprint(businessId).catch((err) => {
        this.logger.warn(`Failed to load blueprint for memory context: ${(err as Error).message}`);
        return null;
      }),
    ]);

    const block: MemoryContextBlock = {
      goals: [],
      tone: null,
      riskTolerance: null,
      outreachStyle: null,
      reportingCadence: null,
      priorities: [],
      bottlenecks: [],
      corrections: [],
      learnedCorrections: [],
      patterns: [],
    };

    // Prefer canonical Business Blueprint for structured DNA, fall back to legacy AiMemory.
    if (blueprint) {
      if (blueprint.goals.northStar) block.goals.push(blueprint.goals.northStar);
      if (blueprint.goals.ninetyDayGoals?.length) block.goals.push(...blueprint.goals.ninetyDayGoals);
      if (blueprint.goals.twelveMonthGoals?.length) block.goals.push(...blueprint.goals.twelveMonthGoals);
      if (blueprint.goals.priorities?.length) block.priorities.push(...blueprint.goals.priorities);
      block.tone = blueprint.brand.tone || blueprint.aiPreferences.tone || null;
      block.riskTolerance = blueprint.constraints.riskTolerance || null;
      block.outreachStyle = blueprint.aiPreferences.outreachStyle || null;
      block.reportingCadence = blueprint.aiPreferences.reportingCadence || null;
    }

    for (const mem of memories) {
      switch (mem.category) {
        case 'goals':
          if (!block.goals.includes(mem.value)) block.goals.push(mem.value);
          break;
        case 'tone':
          if (mem.key === 'preferred' && !block.tone) block.tone = mem.value;
          break;
        case 'riskTolerance':
          if (mem.key === 'level' && !block.riskTolerance) block.riskTolerance = mem.value;
          break;
        case 'outreachStyle':
          if (mem.key === 'preferred') block.outreachStyle = mem.value;
          break;
        case 'reportingCadence':
          if (mem.key === 'preferred') block.reportingCadence = mem.value;
          break;
        case 'priorities':
          if (!block.priorities.includes(mem.value)) block.priorities.push(mem.value);
          break;
        case 'bottlenecks':
          if (!block.bottlenecks.includes(mem.value)) block.bottlenecks.push(mem.value);
          break;
        case 'corrections':
          if (!block.corrections.includes(mem.value)) block.corrections.push(mem.value);
          break;
        case 'learned_corrections': {
          // FeedbackLoopService writes this category on every failed tool
          // execution and nothing read it, so the loop never closed. The
          // stored value is JSON — surface the lesson, not the blob.
          let lesson = mem.value;
          try {
            const parsed = JSON.parse(mem.value) as { learnedPattern?: string; reason?: string };
            lesson = parsed.learnedPattern || parsed.reason || mem.value;
          } catch {
            // Pre-JSON rows, or a truncated write. The raw value is still
            // better context than dropping it.
          }
          if (!block.learnedCorrections.includes(lesson)) block.learnedCorrections.push(lesson);
          break;
        }
        case 'patterns':
          if (opts.patternVisible && !opts.patternVisible(mem)) break;
          if (!block.patterns.includes(mem.value)) block.patterns.push(mem.value);
          break;
      }
    }

    return block;
  }

  buildPromptSection(ctx: MemoryContextBlock): string {
    const lines: string[] = [];

    if (ctx.tone) lines.push(`- Preferred communication tone: ${ctx.tone}`);
    if (ctx.riskTolerance) lines.push(`- Risk tolerance: ${ctx.riskTolerance}`);
    if (ctx.outreachStyle) lines.push(`- Outreach style: ${ctx.outreachStyle}`);
    if (ctx.reportingCadence) lines.push(`- Reporting cadence: ${ctx.reportingCadence}`);
    if (ctx.goals.length > 0) lines.push(`- Business goals: ${ctx.goals.join('; ')}`);
    if (ctx.priorities.length > 0) lines.push(`- Current priorities: ${ctx.priorities.join('; ')}`);
    if (ctx.bottlenecks.length > 0) lines.push(`- Known bottlenecks: ${ctx.bottlenecks.join('; ')}`);
    if (ctx.corrections.length > 0) lines.push(`- User corrections (respect these): ${ctx.corrections.join('; ')}`);
    if (ctx.learnedCorrections.length > 0)
      lines.push(`- Lessons from past failures: ${ctx.learnedCorrections.join('; ')}`);
    if (ctx.patterns.length > 0) lines.push(`- Behavioral patterns: ${ctx.patterns.join('; ')}`);

    if (lines.length === 0) return '';

    return `\nUSER PREFERENCES & MEMORY:\n${lines.join('\n')}`;
  }

  async recordApprovalSignal(
    businessId: string,
    toolName: string,
    resolution: 'approved' | 'rejected' | 'deferred',
    context?: { rationale?: string; inputPayload?: Record<string, unknown> },
  ): Promise<void> {
    try {
      const signalKey = `${resolution}_${toolName}`;
      const existing = await this.get(businessId, 'corrections', signalKey);
      const toolModules = modulesFromIdentifiers(toolName);

      if (resolution === 'rejected') {
        const description = context?.rationale
          ? `User rejected ${toolName}: ${context.rationale}`
          : `User rejected ${toolName} action`;

        await this.upsert(businessId, {
          category: 'corrections',
          key: signalKey,
          value: description,
          confidence: existing ? Math.min(existing.confidence + 0.1, 1.0) : 0.7,
          source: 'approval_signal',
          moduleScope: toolModules,
        });
      }

      if (resolution === 'approved') {
        const rejectionKey = `rejected_${toolName}`;
        const rejectionMemory = await this.get(businessId, 'corrections', rejectionKey);
        if (rejectionMemory && rejectionMemory.confidence > 0.3) {
          await this.upsert(businessId, {
            category: 'corrections',
            key: rejectionKey,
            value: rejectionMemory.value,
            confidence: rejectionMemory.confidence - 0.15,
            source: 'approval_signal',
            moduleScope: toolModules,
          });
        }
      }
    } catch (err: any) {
      this.logger.error(`Failed to record approval signal: ${(err as Error).message}`);
    }
  }

  async summarizePatterns(businessId: string): Promise<string[]> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    try {
      const logs = await this.prisma.client.aiExecutionLog.findMany({
        where: {
          businessId,
          createdAt: { gte: thirtyDaysAgo },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          action: true,
          toolName: true,
          module: true,
          success: true,
          createdAt: true,
          riskTier: true,
        },
      });

      if (logs.length < 5) return [];

      const patternItems: Array<{ text: string; moduleScope: string[] }> = [];
      const toolModules = new Map<string, Set<string>>();
      for (const log of logs) {
        if (!log.toolName) continue;
        const set = toolModules.get(log.toolName) ?? new Set<string>();
        if (log.module) set.add(log.module);
        for (const m of modulesFromIdentifiers(log.toolName, log.action)) set.add(m);
        toolModules.set(log.toolName, set);
      }

      const toolCounts: Record<string, number> = {};
      for (const log of logs) {
        if (log.toolName) {
          toolCounts[log.toolName] = (toolCounts[log.toolName] || 0) + 1;
        }
      }
      const topTools = Object.entries(toolCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3);
      if (topTools.length > 0) {
        patternItems.push({
          text: `Most used tools: ${topTools.map(([name, count]) => `${name} (${count}x)`).join(', ')}`,
          moduleScope: unionModuleScopes(...topTools.map(([name]) => toolModules.get(name))),
        });
      }

      const hourCounts: Record<number, number> = {};
      for (const log of logs) {
        const hour = new Date(log.createdAt).getHours();
        hourCounts[hour] = (hourCounts[hour] || 0) + 1;
      }
      const peakHour = Object.entries(hourCounts)
        .sort(([, a], [, b]) => b - a)[0];
      if (peakHour) {
        const h = parseInt(peakHour[0]);
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
        patternItems.push({
          text: `Peak activity hour: ${h12}${ampm}`,
          moduleScope: [],
        });
      }

      const dayCounts: Record<number, number> = {};
      for (const log of logs) {
        const day = new Date(log.createdAt).getDay();
        dayCounts[day] = (dayCounts[day] || 0) + 1;
      }
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const peakDay = Object.entries(dayCounts)
        .sort(([, a], [, b]) => b - a)[0];
      if (peakDay) {
        patternItems.push({
          text: `Most active day: ${dayNames[parseInt(peakDay[0])]}`,
          moduleScope: [],
        });
      }

      const failedTools: Record<string, number> = {};
      for (const log of logs) {
        if (!log.success && log.toolName) {
          failedTools[log.toolName] = (failedTools[log.toolName] || 0) + 1;
        }
      }
      const frequentFailures = Object.entries(failedTools)
        .filter(([, count]) => count >= 3)
        .sort(([, a], [, b]) => b - a);
      if (frequentFailures.length > 0) {
        patternItems.push({
          text: `Frequently failing tools: ${frequentFailures.map(([name, count]) => `${name} (${count} failures)`).join(', ')}`,
          moduleScope: unionModuleScopes(...frequentFailures.map(([name]) => toolModules.get(name))),
        });
      }

      const moduleCounts: Record<string, number> = {};
      for (const log of logs) {
        if (log.module) {
          moduleCounts[log.module] = (moduleCounts[log.module] || 0) + 1;
        }
      }
      const topModules = Object.entries(moduleCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3);
      if (topModules.length > 0) {
        patternItems.push({
          text: `Most active modules: ${topModules.map(([name, count]) => `${name} (${count}x)`).join(', ')}`,
          moduleScope: unionModuleScopes(topModules.map(([name]) => name)),
        });
      }

      for (const item of patternItems) {
        await this.upsert(businessId, {
          category: 'patterns',
          key: item.text.split(':')[0]?.trim().toLowerCase().replace(/\s+/g, '_') || 'general',
          value: item.text,
          confidence: 0.8,
          source: 'pattern_analysis',
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          moduleScope: item.moduleScope,
        });
      }

      return patternItems.map((item) => item.text);
    } catch (err: any) {
      this.logger.error(`Pattern summarization failed: ${(err as Error).message}`);
      return [];
    }
  }
}
