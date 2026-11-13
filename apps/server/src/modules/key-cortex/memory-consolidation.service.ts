import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { KeyCortexCircadianService } from './key-cortex-circadian.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { keyCronsDisabled } from '../../core/config/env';

/** The AiMemory rows promotion writes: category, key prefix and source. */
const PROMOTED_CATEGORY = 'learning';
const PROMOTED_KEY_PREFIX = 'learned:';
const PROMOTED_SOURCE = 'key_cortex_learning';
/** How much of a cognition row's recommendation promotion copies. */
const PROMOTED_VALUE_LENGTH = 500;

/** The business-wide AiMemory key a cognition row of `functionId` is promoted into. */
function promotedKey(functionId: string | null): string {
  return `${PROMOTED_KEY_PREFIX}${functionId ?? 'general'}`;
}

/**
 * Nightly-style memory consolidation job.
 *
 * Foundation implementation:
 *  - Decays old low-confidence memories.
 *  - Resolves conflicts by confidence/recency.
 *  - Promotes high-confidence facts into structured AiMemory: only facts that
 *    belong to no member (W11-MEMORY-PROMOTE-SCOPE), withdrawing any an earlier
 *    run promoted from a member's own row.
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
            `withdrawn ${result.withdrawn}, resolved ${result.conflictsResolved}`,
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
    conflictsResolved: number;
  }> {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const decayed = await this.decayOldMemories(businessId, cutoff);
    const conflictsResolved = await this.resolveConflicts(businessId);
    const promoted = await this.promoteFacts(businessId);
    const withdrawn = await this.withdrawMemberPromotions(businessId);

    this.logger.log(
      `[run][${businessId}] decayed=${decayed} promoted=${promoted} withdrawn=${withdrawn} conflicts=${conflictsResolved}`,
    );
    return { decayed, promoted, withdrawn, conflictsResolved };
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
          await this.prisma.client.aiMemory.delete({ where: { id: item.id } });
          resolved++;
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
      await this.prisma.client.aiMemory.upsert({
        where: { businessId_category_key: { businessId, category: PROMOTED_CATEGORY, key } },
        create: {
          businessId,
          category: PROMOTED_CATEGORY,
          key,
          value: memory.recommendation.slice(0, PROMOTED_VALUE_LENGTH),
          source: PROMOTED_SOURCE,
          confidence: memory.confidence,
        },
        update: {
          value: memory.recommendation.slice(0, PROMOTED_VALUE_LENGTH),
          confidence: memory.confidence,
        },
      });
      promoted++;
    }
    return promoted;
  }

  /**
   * W11-MEMORY-PROMOTE-SCOPE (review SEC-W11MC-2): before the packet, promotion
   * copied a member's accepted row too, and those rows stay in AiMemory (served by
   * every reader above; none reads by key, so a reader cannot skip them) until
   * something removes them. This run withdraws each row promotion wrote
   * (learning:learned:<functionId>, source key_cortex_learning) whose value is what
   * promotion takes from a member's row of that function (the first 500 characters
   * of its recommendation) and from no member-less row of it: a provable copy of a
   * member's conversation. Whatever the source row's confidence or response is now
   * (it may have decayed below the bar since); the source row itself is untouched,
   * and stays its member's own memory. Rows promoted from member-less rows, and
   * learning memories anyone else wrote, are kept.
   */
  private async withdrawMemberPromotions(businessId: string): Promise<number> {
    const promotedRows = await this.prisma.client.aiMemory.findMany({
      where: {
        businessId,
        category: PROMOTED_CATEGORY,
        source: PROMOTED_SOURCE,
        key: { startsWith: PROMOTED_KEY_PREFIX },
      },
      select: { id: true, key: true, value: true },
    });

    let withdrawn = 0;
    for (const row of promotedRows) {
      const functionId = row.key.slice(PROMOTED_KEY_PREFIX.length);
      // A value shorter than the promoted length is a whole recommendation; one of
      // that length is the start of a longer one. Prisma's startsWith is a SQL LIKE
      // prefix that escapes nothing (%, _ and \ in the value would widen or miss the
      // match), so it reads only the value's leading run free of those characters;
      // the exact comparison is made below.
      const recommendation =
        row.value.length < PROMOTED_VALUE_LENGTH
          ? { equals: row.value }
          : { startsWith: row.value.split(/[\\%_]/, 1)[0] };
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
        (s) =>
          promotedKey(s.functionId) === row.key &&
          s.recommendation.slice(0, PROMOTED_VALUE_LENGTH) === row.value,
      );
      const fromAMember = promotedFrom.some((s) => s.userId !== null);
      const fromNoMember = promotedFrom.some((s) => s.userId === null);
      if (!fromAMember || fromNoMember) continue;

      // Only the row as read: one rewritten since (by a member-less promotion) stays.
      const removed = await this.prisma.client.aiMemory.deleteMany({
        where: { id: row.id, businessId, source: PROMOTED_SOURCE, value: row.value },
      });
      withdrawn += removed.count;
    }
    return withdrawn;
  }
}
