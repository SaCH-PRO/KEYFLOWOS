import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  GenomeSalesMotionData,
  ListGenomeSalesMotionsQuery,
  UpsertGenomeSalesMotionInput,
} from './key-genome.types';

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function toDomain(row: {
  id: string;
  businessId: string;
  name: string;
  description: string | null;
  motionType: string;
  stage: string | null;
  conversionRate: number | null;
  averageDealSize: number | null;
  cycleDays: number | null;
  volume: number | null;
  channel: string | null;
  revenueContribution: number | null;
  costPerLead: number | null;
  isActive: boolean;
  confidence: number;
  sourceModule: string | null;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): GenomeSalesMotionData {
  return {
    id: row.id,
    businessId: row.businessId,
    name: row.name,
    description: row.description,
    motionType: row.motionType,
    stage: row.stage,
    conversionRate: row.conversionRate,
    averageDealSize: row.averageDealSize,
    cycleDays: row.cycleDays,
    volume: row.volume,
    channel: row.channel,
    revenueContribution: row.revenueContribution,
    costPerLead: row.costPerLead,
    isActive: row.isActive,
    confidence: row.confidence,
    sourceModule: row.sourceModule,
    sourceEntityType: row.sourceEntityType,
    sourceEntityId: row.sourceEntityId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class GenomeSalesMotionService {
  constructor(private readonly prisma: PrismaService) {}

  async upsertMotion(input: UpsertGenomeSalesMotionInput): Promise<GenomeSalesMotionData> {
    const confidence = clamp(input.confidence ?? 0.5);
    const now = new Date();

    const row = await this.prisma.client.genomeSalesMotion.create({
      data: {
        businessId: input.businessId,
        name: input.name,
        description: input.description ?? null,
        motionType: input.motionType,
        stage: input.stage ?? null,
        conversionRate: input.conversionRate ?? null,
        averageDealSize: input.averageDealSize ?? null,
        cycleDays: input.cycleDays ?? null,
        volume: input.volume ?? null,
        channel: input.channel ?? null,
        revenueContribution: input.revenueContribution ?? null,
        costPerLead: input.costPerLead ?? null,
        isActive: input.isActive ?? true,
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

  async listMotions(
    businessId: string,
    filters: ListGenomeSalesMotionsQuery = {},
  ): Promise<GenomeSalesMotionData[]> {
    const where: Prisma.GenomeSalesMotionWhereInput = { businessId };

    if (filters.motionType) {
      where.motionType = filters.motionType;
    }
    if (filters.stage) {
      where.stage = filters.stage;
    }
    if (filters.channel) {
      where.channel = filters.channel;
    }
    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive;
    }
    if (filters.minConfidence !== undefined) {
      where.confidence = { gte: filters.minConfidence };
    }

    const rows = await this.prisma.client.genomeSalesMotion.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: filters.limit,
    });

    return rows.map(toDomain);
  }

  async deleteMotion(businessId: string, motionId: string): Promise<{ deleted: true }> {
    const existing = await this.prisma.client.genomeSalesMotion.findFirst({
      where: { id: motionId, businessId },
    });

    if (!existing) {
      throw new NotFoundException('Sales motion not found');
    }

    await this.prisma.client.genomeSalesMotion.delete({
      where: { id: motionId },
    });

    return { deleted: true };
  }
}
