import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  GenomeCustomerSegmentData,
  ListGenomeCustomerSegmentsQuery,
  UpsertGenomeCustomerSegmentInput,
} from './key-genome.types';

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function toDomain(row: {
  id: string;
  businessId: string;
  name: string;
  description: string | null;
  segmentType: string;
  estimatedSize: number | null;
  averageRevenue: number | null;
  averageCost: number | null;
  lifetimeValue: number | null;
  acquisitionCost: number | null;
  churnRate: number | null;
  conversionRate: number | null;
  channel: string | null;
  tags: string[];
  confidence: number;
  sourceModule: string | null;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): GenomeCustomerSegmentData {
  return {
    id: row.id,
    businessId: row.businessId,
    name: row.name,
    description: row.description,
    segmentType: row.segmentType,
    estimatedSize: row.estimatedSize,
    averageRevenue: row.averageRevenue,
    averageCost: row.averageCost,
    lifetimeValue: row.lifetimeValue,
    acquisitionCost: row.acquisitionCost,
    churnRate: row.churnRate,
    conversionRate: row.conversionRate,
    channel: row.channel,
    tags: row.tags,
    confidence: row.confidence,
    sourceModule: row.sourceModule,
    sourceEntityType: row.sourceEntityType,
    sourceEntityId: row.sourceEntityId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class GenomeCustomerSegmentService {
  constructor(private readonly prisma: PrismaService) {}

  async upsertSegment(input: UpsertGenomeCustomerSegmentInput): Promise<GenomeCustomerSegmentData> {
    const confidence = clamp(input.confidence ?? 0.5);
    const now = new Date();

    const row = await this.prisma.client.genomeCustomerSegment.create({
      data: {
        businessId: input.businessId,
        name: input.name,
        description: input.description ?? null,
        segmentType: input.segmentType,
        estimatedSize: input.estimatedSize ?? null,
        averageRevenue: input.averageRevenue ?? null,
        averageCost: input.averageCost ?? null,
        lifetimeValue: input.lifetimeValue ?? null,
        acquisitionCost: input.acquisitionCost ?? null,
        churnRate: input.churnRate ?? null,
        conversionRate: input.conversionRate ?? null,
        channel: input.channel ?? null,
        tags: input.tags ?? [],
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

  async listSegments(
    businessId: string,
    filters: ListGenomeCustomerSegmentsQuery = {},
  ): Promise<GenomeCustomerSegmentData[]> {
    const where: Prisma.GenomeCustomerSegmentWhereInput = { businessId };

    if (filters.segmentType) {
      where.segmentType = filters.segmentType;
    }
    if (filters.channel) {
      where.channel = filters.channel;
    }
    if (filters.minConfidence !== undefined) {
      where.confidence = { gte: filters.minConfidence };
    }

    const rows = await this.prisma.client.genomeCustomerSegment.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: filters.limit,
    });

    return rows.map(toDomain);
  }

  async deleteSegment(businessId: string, segmentId: string): Promise<{ deleted: true }> {
    const existing = await this.prisma.client.genomeCustomerSegment.findFirst({
      where: { id: segmentId, businessId },
    });

    if (!existing) {
      throw new NotFoundException('Customer segment not found');
    }

    await this.prisma.client.genomeCustomerSegment.delete({
      where: { id: segmentId },
    });

    return { deleted: true };
  }
}
