import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  GenomeFinancialMetricData,
  ListGenomeFinancialMetricsQuery,
  UpsertGenomeFinancialMetricInput,
} from './key-genome.types';

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function toDomain(row: {
  id: string;
  businessId: string;
  metricType: string;
  period: string | null;
  value: number;
  currency: string;
  sourceModule: string | null;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  confidence: number;
  notes: string | null;
  occurredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): GenomeFinancialMetricData {
  return {
    id: row.id,
    businessId: row.businessId,
    metricType: row.metricType,
    period: row.period ?? null,
    value: row.value,
    currency: row.currency,
    sourceModule: row.sourceModule,
    sourceEntityType: row.sourceEntityType,
    sourceEntityId: row.sourceEntityId,
    confidence: row.confidence,
    notes: row.notes,
    occurredAt: row.occurredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class GenomeFinancialMetricService {
  constructor(private readonly prisma: PrismaService) {}

  async upsertMetric(input: UpsertGenomeFinancialMetricInput): Promise<GenomeFinancialMetricData> {
    const confidence = clamp(input.confidence ?? 0.5);
    const now = new Date();
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : now;

    const row = await this.prisma.client.genomeFinancialMetric.upsert({
      where: {
        businessId_metricType_period: {
          businessId: input.businessId,
          metricType: input.metricType,
          period: input.period ?? '',
        },
      },
      create: {
        businessId: input.businessId,
        metricType: input.metricType,
        period: input.period ?? '',
        value: input.value,
        currency: input.currency ?? 'TTD',
        sourceModule: input.sourceModule ?? null,
        sourceEntityType: input.sourceEntityType ?? null,
        sourceEntityId: input.sourceEntityId ?? null,
        confidence,
        notes: input.notes ?? null,
        occurredAt,
        createdAt: now,
        updatedAt: now,
      },
      update: {
        value: input.value,
        currency: input.currency ?? 'TTD',
        sourceModule: input.sourceModule ?? null,
        sourceEntityType: input.sourceEntityType ?? null,
        sourceEntityId: input.sourceEntityId ?? null,
        confidence,
        notes: input.notes ?? null,
        occurredAt,
        updatedAt: now,
      },
    });

    return toDomain(row);
  }

  async listMetrics(
    businessId: string,
    filters: ListGenomeFinancialMetricsQuery = {},
  ): Promise<GenomeFinancialMetricData[]> {
    const where: Prisma.GenomeFinancialMetricWhereInput = { businessId };

    if (filters.metricType) {
      where.metricType = filters.metricType;
    }
    if (filters.period !== undefined) {
      where.period = filters.period;
    }
    if (filters.currency) {
      where.currency = filters.currency;
    }
    if (filters.minConfidence !== undefined) {
      where.confidence = { gte: filters.minConfidence };
    }

    const rows = await this.prisma.client.genomeFinancialMetric.findMany({
      where,
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      take: filters.limit,
    });

    return rows.map(toDomain);
  }

  async getLatestMetric(
    businessId: string,
    metricType: string,
  ): Promise<GenomeFinancialMetricData | null> {
    const row = await this.prisma.client.genomeFinancialMetric.findFirst({
      where: { businessId, metricType },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
    });

    return row ? toDomain(row) : null;
  }

  async getLatestMetricsByType(
    businessId: string,
  ): Promise<Record<string, GenomeFinancialMetricData>> {
    const rows = await this.prisma.client.genomeFinancialMetric.findMany({
      where: { businessId },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
    });

    const map: Record<string, GenomeFinancialMetricData> = {};
    for (const row of rows) {
      if (!map[row.metricType]) {
        map[row.metricType] = toDomain(row);
      }
    }

    return map;
  }

  async deleteMetric(businessId: string, metricId: string): Promise<{ deleted: true }> {
    const existing = await this.prisma.client.genomeFinancialMetric.findFirst({
      where: { id: metricId, businessId },
    });

    if (!existing) {
      throw new NotFoundException('Financial metric not found');
    }

    await this.prisma.client.genomeFinancialMetric.delete({
      where: { id: metricId },
    });

    return { deleted: true };
  }
}
