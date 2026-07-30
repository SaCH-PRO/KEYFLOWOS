import { Injectable, Logger } from '@nestjs/common';
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

  constructor(private readonly prisma: PrismaService) {}

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
