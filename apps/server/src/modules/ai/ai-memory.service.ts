import { Injectable, Logger, Inject, Optional } from '@nestjs/common';
import { Prisma, type AiMemory } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AiExecutionLogService } from './ai-execution-log.service';
import {
  AI_MEMORY_COPY_SOURCE_TYPE,
  SemanticMemoryService,
  copyHoldsRowValue,
  type DroppedAiMemoryCopy,
} from './semantic-memory.service';
import { BlueprintService } from '../blueprint/blueprint.service';

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

export interface MemoryEntry {
  id: string;
  category: string;
  key: string;
  value: string;
  confidence: number;
  source: string;
  expiresAt: Date | null;
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
 * The scope is the business: only the named row's copies in this business go. Answers the row and the copies it
 * deleted (their content and metadata), so AiMemoryService.upsert can copy the row again with its new value
 * (SemanticMemoryService.recopyRewrittenRow). A failure rolls both back. apps/server/test/
 * ai-memory-copies-rewrite.integration.test.ts (V71I-09) holds every AiMemory upsert and update in apps/server/src to
 * this function, but for the named settings writers.
 */
export async function upsertAiMemoryDroppingStaleCopies(
  prisma: PrismaService,
  businessId: string,
  row: { category: string; key: string },
  write: AiMemoryWrite,
): Promise<{ row: AiMemory; dropped: DroppedAiMemoryCopy[] }> {
  const { category, key } = row;
  return prisma.client.$transaction(async (tx) => {
    const written = await tx.aiMemory.upsert({
      where: { businessId_category_key: { businessId, category, key } },
      create: { ...write.create, businessId, category, key },
      update: write.update,
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

  async getAll(businessId: string): Promise<MemoryEntry[]> {
    const records = await this.prisma.client.aiMemory.findMany({
      where: {
        businessId,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      orderBy: [{ category: 'asc' }, { updatedAt: 'desc' }],
    });
    return records;
  }

  async getByCategory(businessId: string, category: MemoryCategory): Promise<MemoryEntry[]> {
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
   * KEY_DISABLED nothing is embedded and the row keeps no copy until the next backfill). A row that had no copy gets
   * none: only POST .../agent/memory/backfill and KEY's writer (indexSemantic) start copying a row.
   */
  async upsert(businessId: string, input: MemoryUpsertInput): Promise<MemoryEntry> {
    const { category, key, value, confidence = 1.0, source = 'user', expiresAt = null } = input;

    const { row, dropped } = await upsertAiMemoryDroppingStaleCopies(
      this.prisma,
      businessId,
      { category, key },
      {
        create: { value, confidence, source, expiresAt },
        update: { value, confidence, source, expiresAt },
      },
    );
    if (dropped.length > 0 && this.semantic) await this.semantic.recopyRewrittenRow(row, dropped);
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

  async buildContextBlock(businessId: string): Promise<MemoryContextBlock> {
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

      const patterns: string[] = [];

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
        patterns.push(`Most used tools: ${topTools.map(([name, count]) => `${name} (${count}x)`).join(', ')}`);
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
        patterns.push(`Peak activity hour: ${h12}${ampm}`);
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
        patterns.push(`Most active day: ${dayNames[parseInt(peakDay[0])]}`);
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
        patterns.push(`Frequently failing tools: ${frequentFailures.map(([name, count]) => `${name} (${count} failures)`).join(', ')}`);
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
        patterns.push(`Most active modules: ${topModules.map(([name, count]) => `${name} (${count}x)`).join(', ')}`);
      }

      for (const pattern of patterns) {
        await this.upsert(businessId, {
          category: 'patterns',
          key: pattern.split(':')[0]?.trim().toLowerCase().replace(/\s+/g, '_') || 'general',
          value: pattern,
          confidence: 0.8,
          source: 'pattern_analysis',
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });
      }

      return patterns;
    } catch (err: any) {
      this.logger.error(`Pattern summarization failed: ${(err as Error).message}`);
      return [];
    }
  }
}
