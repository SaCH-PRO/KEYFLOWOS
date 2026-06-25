import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';

const HALF_LIFE_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function decayWeight(observedAt: Date): number {
  const ageDays = (Date.now() - observedAt.getTime()) / MS_PER_DAY;
  return Math.exp(-(Math.LN2 * ageDays) / HALF_LIFE_DAYS);
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

@Injectable()
export class GenomeOutcomeLearningService {
  constructor(private readonly prisma: PrismaService) {}

  async getLearnedImpact(
    businessId: string,
    domain: string,
    actionType?: string,
  ): Promise<number> {
    const outcomes = await this.prisma.client.genomeRecommendationOutcome.findMany({
      where: {
        businessId,
        domain,
        observedAt: { not: null },
        impactScore: { not: null },
        ...(actionType ? { actionType: { contains: actionType, mode: 'insensitive' } } : {}),
      },
      orderBy: { observedAt: 'desc' },
      take: 50,
    });

    if (outcomes.length === 0) return 0;

    let weightedSum = 0;
    let totalWeight = 0;
    for (const o of outcomes) {
      const weight = decayWeight(o.observedAt!);
      weightedSum += (o.impactScore ?? 0) * weight;
      totalWeight += weight;
    }

    return totalWeight > 0 ? clamp(weightedSum / totalWeight, -1, 1) : 0;
  }

  async applyOutcomeToConfidence(
    businessId: string,
    domain: string,
    actionType: string,
    impactScore: number,
  ): Promise<void> {
    const learningRate = 0.05;
    const delta = clamp(impactScore * learningRate, -0.2, 0.2);

    const recs = await this.prisma.client.genomeRecommendation.findMany({
      where: {
        businessId,
        domain,
        status: 'ACTIVE',
      },
      select: { id: true, confidence: true },
    });

    await Promise.all(
      recs.map((rec) =>
        this.prisma.client.genomeRecommendation.update({
          where: { id: rec.id },
          data: { confidence: clamp(rec.confidence + delta) },
        }),
      ),
    );
  }
}
