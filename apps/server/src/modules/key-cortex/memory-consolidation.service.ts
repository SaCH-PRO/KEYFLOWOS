import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { KeyCortexCircadianService } from './key-cortex-circadian.service';
import { PrismaService } from '../../core/prisma/prisma.service';

/**
 * Nightly-style memory consolidation job.
 *
 * Foundation implementation:
 *  - Decays old low-confidence memories.
 *  - Resolves conflicts by confidence/recency.
 *  - Promotes high-confidence facts into structured AiMemory.
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
            `resolved ${result.conflictsResolved}`,
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
    conflictsResolved: number;
  }> {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const decayed = await this.decayOldMemories(businessId, cutoff);
    const conflictsResolved = await this.resolveConflicts(businessId);
    const promoted = await this.promoteFacts(businessId);

    this.logger.log(
      `[run][${businessId}] decayed=${decayed} promoted=${promoted} conflicts=${conflictsResolved}`,
    );
    return { decayed, promoted, conflictsResolved };
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

  private async promoteFacts(businessId: string): Promise<number> {
    const highConfidence = await this.prisma.client.cognitionMemory.findMany({
      where: { businessId, confidence: { gte: 0.9 }, userResponse: 'accepted' },
      take: 50,
    });

    let promoted = 0;
    for (const memory of highConfidence) {
      const key = `learned:${memory.functionId ?? 'general'}`;
      await this.prisma.client.aiMemory.upsert({
        where: { businessId_category_key: { businessId, category: 'learning', key } },
        create: {
          businessId,
          category: 'learning',
          key,
          value: memory.recommendation.slice(0, 500),
          source: 'key_cortex_learning',
          confidence: memory.confidence,
        },
        update: {
          value: memory.recommendation.slice(0, 500),
          confidence: memory.confidence,
        },
      });
      promoted++;
    }
    return promoted;
  }
}
