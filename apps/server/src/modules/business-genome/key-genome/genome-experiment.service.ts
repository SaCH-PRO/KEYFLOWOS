import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { OutcomeLearningService } from './outcome-learning.service';
import type {
  CreateGenomeExperimentInput,
  ExperimentStatus,
  GenomeExperimentData,
  ListGenomeExperimentsQuery,
  RecommendationOutcome,
} from './key-genome.types';

function toDomain(row: {
  id: string;
  businessId: string;
  hypothesis: string;
  action: string;
  successMetric: string;
  baselineValue: number | null;
  targetValue: number | null;
  durationDays: number;
  riskLevel: string;
  status: string;
  result: unknown;
  createdAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
}): GenomeExperimentData {
  const createdAt = row.createdAt.toISOString();
  return {
    id: row.id,
    businessId: row.businessId,
    hypothesis: row.hypothesis,
    action: row.action,
    successMetric: row.successMetric,
    baselineValue: row.baselineValue ?? null,
    targetValue: row.targetValue ?? null,
    durationDays: row.durationDays,
    riskLevel: row.riskLevel as GenomeExperimentData['riskLevel'],
    status: row.status as GenomeExperimentData['status'],
    result: row.result ? (row.result as Record<string, unknown>) : null,
    createdAt,
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class GenomeExperimentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outcomeLearning: OutcomeLearningService,
  ) {}

  async createExperiment(input: CreateGenomeExperimentInput): Promise<GenomeExperimentData> {
    const created = await this.prisma.client.genomeExperiment.create({
      data: {
        businessId: input.businessId,
        hypothesis: input.hypothesis,
        action: input.action,
        successMetric: input.successMetric,
        baselineValue: input.baselineValue ?? null,
        targetValue: input.targetValue ?? null,
        durationDays: input.durationDays ?? 14,
        riskLevel: input.riskLevel ?? 'LOW',
        status: 'PROPOSED',
      },
    });

    return toDomain(created);
  }

  async listExperiments(
    businessId: string,
    filters: ListGenomeExperimentsQuery = {},
  ): Promise<GenomeExperimentData[]> {
    const rows = await this.prisma.client.genomeExperiment.findMany({
      where: {
        businessId,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.recommendationId ? { id: filters.recommendationId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: filters.limit,
    });

    return rows.map(toDomain);
  }

  async getExperiment(businessId: string, experimentId: string): Promise<GenomeExperimentData> {
    const row = await this.prisma.client.genomeExperiment.findUnique({
      where: { id: experimentId },
    });

    if (!row || row.businessId !== businessId) {
      throw new NotFoundException('Genome experiment not found');
    }

    return toDomain(row);
  }

  async startExperiment(businessId: string, experimentId: string): Promise<GenomeExperimentData> {
    await this.getExperiment(businessId, experimentId);

    const updated = await this.prisma.client.genomeExperiment.update({
      where: { id: experimentId },
      data: { status: 'RUNNING' as ExperimentStatus, startedAt: new Date() },
    });

    await this.outcomeLearning.recordExperimentStarted(businessId, toDomain(updated));

    return toDomain(updated);
  }

  async completeExperiment(
    businessId: string,
    experimentId: string,
    outcome?: RecommendationOutcome,
  ): Promise<GenomeExperimentData> {
    await this.getExperiment(businessId, experimentId);

    const result = outcome
      ? {
          success: outcome.success,
          notes: outcome.notes,
          measuredValue: outcome.measuredValue,
        }
      : null;

    const updated = await this.prisma.client.genomeExperiment.update({
      where: { id: experimentId },
      data: {
        status: 'COMPLETED' as ExperimentStatus,
        endedAt: new Date(),
        result: result ?? undefined,
      },
    });

    await this.outcomeLearning.recordExperimentCompleted(businessId, toDomain(updated), outcome);

    return toDomain(updated);
  }

  async failExperiment(
    businessId: string,
    experimentId: string,
    outcome?: RecommendationOutcome,
  ): Promise<GenomeExperimentData> {
    await this.getExperiment(businessId, experimentId);

    const result = outcome
      ? {
          success: false,
          notes: outcome.notes,
          measuredValue: outcome.measuredValue,
        }
      : null;

    const updated = await this.prisma.client.genomeExperiment.update({
      where: { id: experimentId },
      data: {
        status: 'FAILED' as ExperimentStatus,
        endedAt: new Date(),
        result: result ?? undefined,
      },
    });

    await this.outcomeLearning.recordExperimentFailed(businessId, toDomain(updated), outcome);

    return toDomain(updated);
  }

  async cancelExperiment(businessId: string, experimentId: string): Promise<GenomeExperimentData> {
    await this.getExperiment(businessId, experimentId);

    const updated = await this.prisma.client.genomeExperiment.update({
      where: { id: experimentId },
      data: { status: 'CANCELLED' as ExperimentStatus, endedAt: new Date() },
    });

    await this.outcomeLearning.recordExperimentCancelled(businessId, toDomain(updated));

    return toDomain(updated);
  }

}
