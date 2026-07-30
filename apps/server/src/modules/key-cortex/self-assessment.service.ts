import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ValueLearningService } from './value-learning.service';

export interface SelfAssessmentReport {
  businessId: string;
  generatedAt: string;
  autonomyConsistencyScore: number;
  memoryRetrievalPrecisionScore: number;
  valueDriftScore: number;
  knowledgeGapCount: number;
  summary: string;
}

/**
 * Generates periodic "state of KEY" self-assessment reports.
 */
@Injectable()
export class SelfAssessmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly valueLearning: ValueLearningService,
  ) {}

  async generate(businessId: string): Promise<SelfAssessmentReport> {
    const [verdictCount, memoryCount, drift, pendingKnowledge] = await Promise.all([
      this.prisma.client.autonomyVerdict.count({ where: { businessId } }),
      this.prisma.client.aiMemory.count({ where: { businessId } }),
      this.valueLearning.detectDrift(businessId),
      this.prisma.client.knowledgeSource.count({ where: { businessId, status: 'pending' } }),
    ]);

    const blockedVerdicts = await this.prisma.client.autonomyVerdict.count({
      where: { businessId, allowed: false },
    });

    const autonomyConsistencyScore =
      verdictCount === 0 ? 1 : Math.max(0, 1 - blockedVerdicts / verdictCount);
    const memoryRetrievalPrecisionScore = Math.min(1, memoryCount / 10);
    const valueDriftScore = 1 - drift.driftScore;

    return {
      businessId,
      generatedAt: new Date().toISOString(),
      autonomyConsistencyScore,
      memoryRetrievalPrecisionScore,
      valueDriftScore,
      knowledgeGapCount: pendingKnowledge,
      summary: `Autonomy consistency ${Math.round(autonomyConsistencyScore * 100)}%; memory coverage ${Math.round(memoryRetrievalPrecisionScore * 100)}%; value alignment ${Math.round(valueDriftScore * 100)}%.`,
    };
  }
}
