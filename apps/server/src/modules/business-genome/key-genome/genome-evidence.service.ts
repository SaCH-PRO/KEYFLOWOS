import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type { AttachGenomeEvidenceInput, GenomeEvidenceData } from './key-genome.types';

function toDomain(row: {
  id: string;
  businessId: string;
  factId: string | null;
  sourceModule: string;
  sourceEntityType: string;
  sourceEntityId: string | null;
  summary: string;
  evidenceStrength: number;
  occurredAt: Date | null;
  createdAt: Date;
}): GenomeEvidenceData {
  return {
    id: row.id,
    businessId: row.businessId,
    factId: row.factId,
    sourceModule: row.sourceModule,
    sourceEntityType: row.sourceEntityType,
    sourceEntityId: row.sourceEntityId,
    summary: row.summary,
    evidenceStrength: row.evidenceStrength,
    occurredAt: row.occurredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class GenomeEvidenceService {
  constructor(private readonly prisma: PrismaService) {}

  async attachEvidence(input: AttachGenomeEvidenceInput): Promise<GenomeEvidenceData> {
    const existing = input.factId
      ? await this.prisma.client.genomeEvidence.findFirst({
          where: {
            businessId: input.businessId,
            factId: input.factId,
            sourceModule: input.sourceModule,
            sourceEntityType: input.sourceEntityType,
            sourceEntityId: input.sourceEntityId ?? null,
          },
        })
      : null;

    const now = new Date();
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : null;

    if (existing) {
      const row = await this.prisma.client.genomeEvidence.update({
        where: { id: existing.id },
        data: {
          summary: input.summary,
          evidenceStrength: input.evidenceStrength ?? existing.evidenceStrength,
          occurredAt,
        },
      });
      return toDomain(row);
    }

    const row = await this.prisma.client.genomeEvidence.create({
      data: {
        businessId: input.businessId,
        factId: input.factId ?? null,
        sourceModule: input.sourceModule,
        sourceEntityType: input.sourceEntityType,
        sourceEntityId: input.sourceEntityId ?? null,
        summary: input.summary,
        evidenceStrength: input.evidenceStrength ?? 0.5,
        occurredAt,
        createdAt: now,
      },
    });

    return toDomain(row);
  }

  async evidenceForFact(businessId: string, factId: string): Promise<GenomeEvidenceData[]> {
    const rows = await this.prisma.client.genomeEvidence.findMany({
      where: { businessId, factId },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map(toDomain);
  }

  async evidenceSummary(
    businessId: string,
    factId: string,
  ): Promise<{ count: number; averageStrength: number; latestEvidenceAt: string | null }> {
    const aggregations = await this.prisma.client.genomeEvidence.aggregate({
      where: { businessId, factId },
      _avg: { evidenceStrength: true },
      _count: { id: true },
      _max: { createdAt: true },
    });

    return {
      count: aggregations._count.id,
      averageStrength: aggregations._avg.evidenceStrength ?? 0,
      latestEvidenceAt: aggregations._max.createdAt?.toISOString() ?? null,
    };
  }
}
