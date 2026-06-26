import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  CreateGenomeContentStrategyInput,
  GenomeContentStrategyData,
  UpdateGenomeContentStrategyInput,
} from './key-genome.types';

function asJsonValue<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function toDomain(row: {
  id: string;
  businessId: string;
  pillars: string[];
  cadence: string | null;
  formats: string[];
  distributionChannels: string[];
  contentGoals: unknown;
  confidence: number;
  sourceModule: string | null;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): GenomeContentStrategyData {
  return {
    id: row.id,
    businessId: row.businessId,
    pillars: row.pillars,
    cadence: row.cadence,
    formats: row.formats,
    distributionChannels: row.distributionChannels,
    contentGoals:
      typeof row.contentGoals === 'object' && row.contentGoals !== null
        ? (row.contentGoals as Record<string, unknown>)
        : {},
    confidence: row.confidence,
    sourceModule: row.sourceModule,
    sourceEntityType: row.sourceEntityType,
    sourceEntityId: row.sourceEntityId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface FindManyGenomeContentStrategiesQuery {
  minConfidence?: number;
  limit?: number;
}

@Injectable()
export class GenomeContentStrategyService {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    businessId: string,
    filters: FindManyGenomeContentStrategiesQuery = {},
  ): Promise<GenomeContentStrategyData[]> {
    const where: Prisma.GenomeContentStrategyWhereInput = { businessId };

    if (filters.minConfidence !== undefined) {
      where.confidence = { gte: filters.minConfidence };
    }

    const rows = await this.prisma.client.genomeContentStrategy.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: filters.limit,
    });

    return rows.map(toDomain);
  }

  async findById(
    businessId: string,
    strategyId: string,
  ): Promise<GenomeContentStrategyData | null> {
    const row = await this.prisma.client.genomeContentStrategy.findFirst({
      where: { id: strategyId, businessId },
    });
    return row ? toDomain(row) : null;
  }

  async create(
    businessId: string,
    input: CreateGenomeContentStrategyInput,
  ): Promise<GenomeContentStrategyData> {
    const existingCount = await this.prisma.client.genomeContentStrategy.count({
      where: { businessId },
    });
    if (existingCount > 0) {
      // Soft guard: multiple strategies are allowed, but this is unusual.
      console.warn(
        `Business ${businessId} already has a content strategy; creating an additional one.`,
      );
    }

    const confidence = clamp(input.confidence ?? 0.5);
    const now = new Date();

    const row = await this.prisma.client.genomeContentStrategy.create({
      data: {
        businessId,
        pillars: input.pillars,
        cadence: input.cadence ?? null,
        formats: input.formats,
        distributionChannels: input.distributionChannels ?? [],
        contentGoals: asJsonValue(input.contentGoals ?? {}),
        confidence,
        sourceModule: input.sourceModule ?? null,
        sourceEntityType: input.sourceEntityType ?? null,
        sourceEntityId: input.sourceEntityId ?? null,
        createdAt: now,
        updatedAt: now,
      },
    });

    return toDomain(row);
  }

  async update(
    businessId: string,
    strategyId: string,
    input: UpdateGenomeContentStrategyInput,
  ): Promise<GenomeContentStrategyData> {
    const existing = await this.prisma.client.genomeContentStrategy.findFirst({
      where: { id: strategyId, businessId },
    });
    if (!existing) {
      throw new NotFoundException('Content strategy not found');
    }

    const data: Prisma.GenomeContentStrategyUpdateInput = {};
    if (input.pillars !== undefined) data.pillars = input.pillars;
    if (input.cadence !== undefined) data.cadence = input.cadence;
    if (input.formats !== undefined) data.formats = input.formats;
    if (input.distributionChannels !== undefined) {
      data.distributionChannels = input.distributionChannels;
    }
    if (input.contentGoals !== undefined) data.contentGoals = asJsonValue(input.contentGoals);
    if (input.confidence !== undefined) data.confidence = clamp(input.confidence);

    const row = await this.prisma.client.genomeContentStrategy.update({
      where: { id: strategyId },
      data,
    });

    return toDomain(row);
  }

  async delete(businessId: string, strategyId: string): Promise<{ deleted: true }> {
    const existing = await this.prisma.client.genomeContentStrategy.findFirst({
      where: { id: strategyId, businessId },
    });
    if (!existing) {
      throw new NotFoundException('Content strategy not found');
    }

    await this.prisma.client.genomeContentStrategy.delete({
      where: { id: strategyId },
    });

    return { deleted: true };
  }
}
