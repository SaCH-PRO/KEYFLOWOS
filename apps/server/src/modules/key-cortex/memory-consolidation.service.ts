import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { KeyCortexCircadianService } from './key-cortex-circadian.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { keyCronsDisabled } from '../../core/config/env';
import { deleteAiMemoriesWithCopies, upsertAiMemoryDroppingStaleCopies } from '../ai/ai-memory.service';
import { classifyAiMemoryWrite, modulesFromIdentifiers } from '../ai/memory-classification';
import { AI_MEMORY_COPY_SOURCE_TYPE, SemanticMemoryService } from '../ai/semantic-memory.service';

/** The AiMemory rows promotion writes: category, key prefix and source. */
const PROMOTED_CATEGORY = 'learning';
const PROMOTED_KEY_PREFIX = 'learned:';
const PROMOTED_SOURCE = 'key_cortex_learning';
/** How much of a cognition row's recommendation promotion copies, in UTF-16 units (see promotedValue). */
const PROMOTED_VALUE_LENGTH = 500;
/**
 * The semantic copies of AiMemory rows in ai_memory_embeddings: source_type 'memory', source_id the row's id.
 * POST /ai/businesses/:id/agent/memory/backfill (SemanticMemoryService.backfillFromAiMemory) writes one per row,
 * its content `<category>: <key> = <value>`, so a promoted row's copy starts with COPY_CONTENT_PREFIX.
 */
const COPY_SOURCE_TYPE = AI_MEMORY_COPY_SOURCE_TYPE;
const COPY_CONTENT_PREFIX = `${PROMOTED_CATEGORY}: ${PROMOTED_KEY_PREFIX}`;

/** The business-wide AiMemory key a cognition row of `functionId` is promoted into. */
function promotedKey(functionId: string | null): string {
  return `${PROMOTED_KEY_PREFIX}${functionId ?? 'general'}`;
}

/**
 * The value promotion takes from a recommendation: its first PROMOTED_VALUE_LENGTH UTF-16 units, cut on a code point.
 * W1F-MEMORY-COPIES: a plain slice(0, 500) split a character outside the Basic Multilingual Plane (an emoji) whose two
 * units straddle the cut, leaving a lone surrogate; Prisma refuses that string ("unexpected end of hex escape"), and
 * the refusal stopped run() for the business. So a cut that would end on a high surrogate ends one unit earlier, before
 * the whole character. Whole recommendations are well-formed (the database holds no lone surrogate).
 */
function promotedValue(recommendation: string): string {
  if (recommendation.length <= PROMOTED_VALUE_LENGTH) return recommendation;
  const last = recommendation.charCodeAt(PROMOTED_VALUE_LENGTH - 1);
  const splitsAPair = last >= 0xd800 && last <= 0xdbff;
  return recommendation.slice(0, splitsAPair ? PROMOTED_VALUE_LENGTH - 1 : PROMOTED_VALUE_LENGTH);
}

/**
 * The promoted row a backfill copy's content was made from (`learning: learned:<fn> = <value>`), or null. The key
 * ends at the first ' = ' (a function id is a slug and holds none).
 */
function promotedRowOfCopy(content: string): { key: string; value: string } | null {
  if (!content.startsWith(COPY_CONTENT_PREFIX)) return null;
  const rest = content.slice(`${PROMOTED_CATEGORY}: `.length);
  const at = rest.indexOf(' = ');
  return at < 0 ? null : { key: rest.slice(0, at), value: rest.slice(at + ' = '.length) };
}

/**
 * Nightly-style memory consolidation job.
 *
 * Foundation implementation:
 *  - Decays old low-confidence memories.
 *  - Resolves conflicts by confidence/recency.
 *  - Promotes high-confidence facts into structured AiMemory: only facts that
 *    belong to no member (W11-MEMORY-PROMOTE-SCOPE), withdrawing any an earlier
 *    run promoted from a member's own row, with their semantic copies.
 *
 * Every AiMemory row it deletes goes through deleteAiMemoriesWithCopies, so the
 * row's semantic copies go with it (W1F-MEMORY-COPIES).
 */
@Injectable()
export class MemoryConsolidationService {
  private readonly logger = new Logger(MemoryConsolidationService.name);

  /**
   * Businesses consolidated today, keyed by businessId -> local date.
   *
   * The sweep runs hourly and fires for any business currently in its own
   * resting hours, so without this a tenant would be consolidated once an hour
   * all night. In-memory is sufficient: a restart at worst repeats one night's
   * consolidation, and every operation here is idempotent by construction —
   * decay, conflict resolution and promotion all converge.
   */
  private readonly consolidatedOn = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly circadian?: KeyCortexCircadianService,
    // FU-MEMORY-COPIES-REWRITE review COR-V71I-3: copies a promoted row the door rewrote again (AiModule's, which
    // KeyCortexModule imports).
    @Optional() @Inject(SemanticMemoryService) private readonly semantic?: SemanticMemoryService,
  ) {}

  /**
   * The parasympathetic arm: repair and consolidation while nobody is working.
   *
   * This service existed, complete and correct, registered in providers AND
   * exports — and injected by nobody. Its own docblock called it "nightly-style"
   * and nothing ever made a night happen. `KeyCortexCircadianService
   * .isRestingHours()` was the matching half: correct, tested, and likewise
   * called from nowhere in production.
   *
   * HOURLY RATHER THAN AT A FIXED HOUR, deliberately. `businessesAtLocalHour(3)`
   * would fire each business exactly once — and exactly never if the process
   * happened to be restarting during that single minute. Sweeping every hour and
   * asking "is this business resting, and has it consolidated today" means a
   * missed window is caught later the same night.
   *
   * LOCAL resting hours, not the server's. The nightly jobs elsewhere in this
   * codebase use server time, so on a UTC host they run mid-evening for a
   * business in Trinidad — which is the opposite of resting.
   *
   * This makes no model calls. It is database work: decaying stale
   * low-confidence memories, resolving contradictions, promoting what has held
   * up. Consolidation during rest is the whole point of the arm.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async scheduledConsolidation(now: Date = new Date()): Promise<void> {
    // V1-24: KEY_DISABLED (or DISABLE_SCHEDULERS) stops this job before it reads anything.
    if (keyCronsDisabled()) return;
    const businesses = await this.prisma.client.business
      .findMany({ where: { deletedAt: null }, select: { id: true, timezone: true } })
      .catch(() => [] as Array<{ id: string; timezone: string | null }>);

    for (const business of businesses as Array<{ id: string; timezone: string | null }>) {
      const timezone = business.timezone ?? 'UTC';

      // Without the circadian service there is no way to know whose night it
      // is, and consolidating the whole estate on the server's clock would be
      // worse than waiting. Skip rather than guess.
      if (!this.circadian?.isRestingHours(timezone, now)) continue;

      const localDay = this.localDayKey(timezone, now);
      if (this.consolidatedOn.get(business.id) === localDay) continue;

      try {
        const result = await this.run(business.id);
        this.consolidatedOn.set(business.id, localDay);
        this.logger.log(
          `[consolidation] ${business.id}: decayed ${result.decayed}, promoted ${result.promoted}, ` +
            `withdrawn ${result.withdrawn} (copies ${result.withdrawnCopies}), resolved ${result.conflictsResolved}`,
        );
      } catch (err: unknown) {
        // One tenant failing must not stop the rest of the estate's night.
        this.logger.warn(
          `[consolidation] ${business.id} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /** Local calendar day, so "once tonight" means their night rather than UTC's. */
  private localDayKey(timezone: string, now: Date): string {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now);
    } catch {
      return now.toISOString().slice(0, 10);
    }
  }

  async run(businessId: string): Promise<{
    decayed: number;
    promoted: number;
    withdrawn: number;
    withdrawnCopies: number;
    conflictsResolved: number;
  }> {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    // W1F-MEMORY-COPIES: the withdrawal of a member's leaked promotion runs first, so no later step that fails (a
    // promotion the database refuses, a decay or conflict write) leaves the leak served for another night.
    const { rows: withdrawn, copies: withdrawnCopies } = await this.withdrawMemberPromotions(businessId);
    const decayed = await this.decayOldMemories(businessId, cutoff);
    const conflictsResolved = await this.resolveConflicts(businessId);
    const promoted = await this.promoteFacts(businessId);

    this.logger.log(
      `[run][${businessId}] decayed=${decayed} promoted=${promoted} withdrawn=${withdrawn} ` +
        `withdrawnCopies=${withdrawnCopies} conflicts=${conflictsResolved}`,
    );
    return { decayed, promoted, withdrawn, withdrawnCopies, conflictsResolved };
  }

  private async decayOldMemories(businessId: string, cutoff: Date): Promise<number> {
    const old = await this.prisma.client.cognitionMemory.findMany({
      where: { businessId, createdAt: { lt: cutoff }, confidence: { gt: 0.1 } },
    });

    let count = 0;
    for (const memory of old) {
      const newConfidence = Math.max(0.1, memory.confidence - 0.1);
      await this.prisma.client.cognitionMemory.update({
        where: { id: memory.id },
        data: { confidence: newConfidence },
      });
      count++;
    }
    return count;
  }

  private async resolveConflicts(businessId: string): Promise<number> {
    const memories = await this.prisma.client.aiMemory.findMany({
      where: { businessId },
    });

    const groups = new Map<string, typeof memories>();
    for (const m of memories) {
      const key = `${m.category}:${m.key}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(m);
    }

    let resolved = 0;
    for (const [, items] of groups) {
      if (items.length <= 1) continue;
      items.sort((a, b) => (b.confidence ?? 1) - (a.confidence ?? 1));
      const winner = items[0];
      for (const item of items.slice(1)) {
        if ((item.confidence ?? 1) < (winner.confidence ?? 1) * 0.5) {
          // W1F-MEMORY-COPIES: with its semantic copies. (ai_memories is unique on business, category and key, so a
          // group holds one row today and this is not reached.)
          const { rows } = await deleteAiMemoriesWithCopies(this.prisma, businessId, { id: item.id });
          resolved += rows;
        }
      }
    }
    return resolved;
  }

  /**
   * W11-MEMORY-PROMOTE-SCOPE (review SEC-W11MC-2, owner ruling D-130): promotion
   * writes the business-wide AiMemory row learning:learned:<functionId>, and every
   * reader of the business's AI memory renders it to every member (KEY chat's
   * memory block and chatMemoryFragments as [ai_memory], AiMemoryService behind
   * GET /businesses/:id/ai/memory and its context block). Only a cognition row that
   * names no member is business-wide (KEY's own outcome rows). A member's row
   * (CognitionMemory.userId) is what they typed and KEY's whole answer to them,
   * which D-130 keeps to that member, so it is not promoted. AiMemory has no
   * per-member shape, so nothing is promoted for a member.
   */
  private async promoteFacts(businessId: string): Promise<number> {
    const highConfidence = await this.prisma.client.cognitionMemory.findMany({
      where: { businessId, userId: null, confidence: { gte: 0.9 }, userResponse: 'accepted' },
      take: 50,
    });

    let promoted = 0;
    for (const memory of highConfidence) {
      const key = promotedKey(memory.functionId);
      const value = promotedValue(memory.recommendation);
      const classified = classifyAiMemoryWrite({
        category: PROMOTED_CATEGORY,
        key,
        value,
        source: PROMOTED_SOURCE,
        userId: memory.userId ?? null,
        explicitModuleScope: modulesFromIdentifiers(memory.functionId),
      });
      // FU-MEMORY-COPIES-REWRITE: a recommendation promoted into the same key rewrites the row in place; the door
      // deletes the copies of the value it replaces and (review COR-V71I-3) copies the row again with the new one.
      await upsertAiMemoryDroppingStaleCopies(this.prisma, businessId, { category: PROMOTED_CATEGORY, key }, {
        create: {
          value,
          source: PROMOTED_SOURCE,
          confidence: memory.confidence,
          dataClass: classified.dataClass,
          moduleScope: classified.moduleScope,
        },
        update: {
          value,
          confidence: memory.confidence,
          dataClass: classified.dataClass,
          moduleScope: classified.moduleScope,
        },
      }, this.semantic);
      promoted++;
    }
    return promoted;
  }

  /**
   * W11-MEMORY-PROMOTE-SCOPE (review SEC-W11MC-2): before the packet, promotion
   * copied a member's accepted row too, and those rows stay in AiMemory (served by
   * every reader above; none reads by key, so a reader cannot skip them) until
   * something removes them. This withdraws each row promotion wrote
   * (learning:learned:<functionId>, source key_cortex_learning) whose value is what
   * promotion takes from a member's row of that function (the first 500 characters
   * of its recommendation) and from no member-less row of it: a provable copy of a
   * member's conversation. Whatever the source row's confidence or response is now
   * (it may have decayed below the bar since); the source row itself is untouched,
   * and stays its member's own memory. Rows promoted from member-less rows, and
   * learning memories anyone else wrote, are kept. W1F-MEMORY-COPIES: run() calls it
   * first, before anything that can fail.
   *
   * Review SEC-W11MPS-1: a row also has semantic copies in ai_memory_embeddings
   * (POST .../agent/memory/backfill, which a settings admin may send since MEM-SEMANTIC-SIGHT), which members
   * read back as each copy's source allows (MEM-SEMANTIC-SIGHT's reader projection: GET .../agent/memory/search, the
   * flow chat's semantic section, and, since MEM-UNIFIED-SEMANTIC-SIGHT, KEY's memory block as [ai_memory_embedding]:
   * buildMemoryContext and chatMemoryFragments search them with the turn's query). A withdrawn row's copies (source_type 'memory',
   * source_id the row's id) go with it, in one transaction. A copy whose content is
   * a member's promoted answer (`learning: learned:<fn> = <value>`, by the same
   * rule) is withdrawn too, whatever row it names: its row may still exist holding
   * another value (a member-less row of the function is promoted into the same key
   * in place, as the base's nightly promotion also did), or be gone (a backfill
   * that read the row before it was withdrawn writes its copy after; the next run
   * removes it).
   *
   * Review SEC-W11MPS-2 / MPS-COR-1: run() calls it, and only the hourly sweep runs
   * run(), for a business in its local resting hours (20:00 to 07:00), once that
   * night; a KEY cron switch (keyCronsDisabled(): KEY_DISABLED, DISABLE_SCHEDULERS,
   * KF_DISABLE_SCHEDULERS, and any switch added there) stops the sweep before it
   * reads anything. Until it has run for a business, the rows and copies an earlier
   * promotion leaked there are still served (GET .../ai/memory reads no KEY switch).
   * So each business needs one full resting window with the KEY crons on before a
   * switch goes on, or this is run by hand once per business: it is public for that
   * one-shot repair, reads no switch, makes no model call, and is idempotent.
   */
  async withdrawMemberPromotions(businessId: string): Promise<{ rows: number; copies: number }> {
    const isMemberPromotion = this.memberPromotionRule(businessId);
    const promotedRows = await this.prisma.client.aiMemory.findMany({
      where: {
        businessId,
        category: PROMOTED_CATEGORY,
        source: PROMOTED_SOURCE,
        key: { startsWith: PROMOTED_KEY_PREFIX },
      },
      select: { id: true, key: true, value: true },
    });

    let rows = 0;
    let copies = 0;
    for (const row of promotedRows) {
      if (!(await isMemberPromotion(row.key, row.value))) continue;
      // Only the row as read: one rewritten since (by a member-less promotion) stays, with its copies. The door
      // deletes the row, then its copies, in one transaction (W1F-MEMORY-COPIES).
      const removed = await deleteAiMemoriesWithCopies(this.prisma, businessId, {
        id: row.id,
        source: PROMOTED_SOURCE,
        value: row.value,
      });
      rows += removed.rows;
      copies += removed.copies;
    }

    // Copies of a member's promoted answer whatever row they name (see above). The
    // prefix holds no LIKE pattern character.
    const promotedCopies = await this.prisma.client.aiMemoryEmbedding.findMany({
      where: { businessId, sourceType: COPY_SOURCE_TYPE, content: { startsWith: COPY_CONTENT_PREFIX } },
      select: { id: true, content: true },
    });
    for (const copy of promotedCopies) {
      const promoted = promotedRowOfCopy(copy.content);
      if (!promoted || !(await isMemberPromotion(promoted.key, promoted.value))) continue;
      const deleted = await this.prisma.client.aiMemoryEmbedding.deleteMany({
        where: { id: copy.id, businessId, sourceType: COPY_SOURCE_TYPE },
      });
      copies += deleted.count;
    }
    return { rows, copies };
  }

  /**
   * Whether `value` under the promoted `key` is what promotion takes from a member's
   * cognition row of that function and from no member-less row of it (see
   * withdrawMemberPromotions), answered once per key and value for one business.
   */
  private memberPromotionRule(businessId: string): (key: string, value: string) => Promise<boolean> {
    const answers = new Map<string, Promise<boolean>>();
    return (key, value) => {
      const id = JSON.stringify([key, value]);
      let answer = answers.get(id);
      if (!answer) {
        answer = this.isMemberPromotion(businessId, key, value);
        answers.set(id, answer);
      }
      return answer;
    };
  }

  private async isMemberPromotion(businessId: string, key: string, value: string): Promise<boolean> {
    if (!key.startsWith(PROMOTED_KEY_PREFIX)) return false;
    const functionId = key.slice(PROMOTED_KEY_PREFIX.length);
    // A value shorter than the promoted length is a whole recommendation; one of
    // that length is the start of a longer one, and so is one a unit shorter
    // (promotedValue cuts before a character that straddles the cut). Prisma's
    // startsWith is a SQL LIKE prefix that escapes nothing (%, _ and \ in the
    // value would widen or miss the match), so it reads only the value's leading
    // run free of those characters; the exact comparison is made below.
    const recommendation =
      value.length < PROMOTED_VALUE_LENGTH - 1
        ? { equals: value }
        : { startsWith: value.split(/[\\%_]/, 1)[0] };
    const sources = await this.prisma.client.cognitionMemory.findMany({
      where: {
        businessId,
        ...(functionId === 'general'
          ? { OR: [{ functionId: null }, { functionId: 'general' }] }
          : { functionId }),
        recommendation,
      },
      select: { userId: true, functionId: true, recommendation: true },
    });
    const promotedFrom = sources.filter(
      (s) => promotedKey(s.functionId) === key && promotedValue(s.recommendation) === value,
    );
    const fromAMember = promotedFrom.some((s) => s.userId !== null);
    const fromNoMember = promotedFrom.some((s) => s.userId === null);
    return fromAMember && !fromNoMember;
  }
}
