import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  CreateGenomeGrowthChannelInput,
  GenomeGrowthChannelData,
  UpdateGenomeGrowthChannelInput,
} from './key-genome.types';

function asJsonValue<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[_\s]+/g, '_');
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function toDomain(row: {
  id: string;
  businessId: string;
  key: string;
  label: string;
  channelType: string;
  status: string;
  monthlyBudget: number | null;
  currency: string;
  targetCac: number | null;
  targetConversionRate: number | null;
  assumptions: unknown;
  evidenceIds: string[];
  confidence: number;
  sourceModule: string | null;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): GenomeGrowthChannelData {
  return {
    id: row.id,
    businessId: row.businessId,
    key: row.key,
    label: row.label,
    channelType: row.channelType as GenomeGrowthChannelData['channelType'],
    status: row.status as GenomeGrowthChannelData['status'],
    monthlyBudget: row.monthlyBudget,
    currency: row.currency,
    targetCac: row.targetCac,
    targetConversionRate: row.targetConversionRate,
    assumptions:
      typeof row.assumptions === 'object' && row.assumptions !== null
        ? (row.assumptions as Record<string, unknown>)
        : {},
    evidenceIds: Array.isArray(row.evidenceIds) ? row.evidenceIds : [],
    confidence: row.confidence,
    sourceModule: row.sourceModule,
    sourceEntityType: row.sourceEntityType,
    sourceEntityId: row.sourceEntityId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface FindManyGenomeGrowthChannelsQuery {
  status?: string;
  channelType?: string;
  minConfidence?: number;
  limit?: number;
}

@Injectable()
export class GenomeGrowthChannelService {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    businessId: string,
    filters: FindManyGenomeGrowthChannelsQuery = {},
  ): Promise<GenomeGrowthChannelData[]> {
    const where: Prisma.GenomeGrowthChannelWhereInput = { businessId };

    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.channelType) {
      where.channelType = filters.channelType;
    }
    if (filters.minConfidence !== undefined) {
      where.confidence = { gte: filters.minConfidence };
    }

    const rows = await this.prisma.client.genomeGrowthChannel.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: filters.limit,
    });

    return rows.map(toDomain);
  }

  async findById(businessId: string, channelId: string): Promise<GenomeGrowthChannelData | null> {
    const row = await this.prisma.client.genomeGrowthChannel.findFirst({
      where: { id: channelId, businessId },
    });
    return row ? toDomain(row) : null;
  }

  async create(
    businessId: string,
    input: CreateGenomeGrowthChannelInput,
  ): Promise<GenomeGrowthChannelData> {
    const normalizedKey = normalizeKey(input.key);
    if (!normalizedKey) {
      throw new BadRequestException('Channel key is required');
    }

    const existing = await this.prisma.client.genomeGrowthChannel.findFirst({
      where: {
        businessId,
        key: normalizedKey,
      },
    });
    if (existing) {
      throw new BadRequestException(
        `Channel key "${input.key}" already exists for this business`,
      );
    }

    const confidence = clamp(input.confidence ?? 0.5);
    const now = new Date();

    const row = await this.prisma.client.genomeGrowthChannel.create({
      data: {
        businessId,
        key: normalizedKey,
        label: input.label,
        channelType: input.channelType,
        status: input.status ?? 'ACTIVE',
        monthlyBudget: input.monthlyBudget ?? null,
        currency: input.currency ?? 'TTD',
        targetCac: input.targetCac ?? null,
        targetConversionRate: input.targetConversionRate ?? null,
        assumptions: asJsonValue(input.assumptions ?? {}),
        evidenceIds: input.evidenceIds ?? [],
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
    channelId: string,
    input: UpdateGenomeGrowthChannelInput,
  ): Promise<GenomeGrowthChannelData> {
    const existing = await this.prisma.client.genomeGrowthChannel.findFirst({
      where: { id: channelId, businessId },
    });
    if (!existing) {
      throw new NotFoundException('Growth channel not found');
    }

    const data: Prisma.GenomeGrowthChannelUpdateInput = {};
    if (input.label !== undefined) data.label = input.label;
    if (input.channelType !== undefined) data.channelType = input.channelType;
    if (input.status !== undefined) data.status = input.status;
    if (input.monthlyBudget !== undefined) data.monthlyBudget = input.monthlyBudget;
    if (input.currency !== undefined) data.currency = input.currency;
    if (input.targetCac !== undefined) data.targetCac = input.targetCac;
    if (input.targetConversionRate !== undefined) {
      data.targetConversionRate = input.targetConversionRate;
    }
    if (input.assumptions !== undefined) data.assumptions = asJsonValue(input.assumptions);
    if (input.evidenceIds !== undefined) data.evidenceIds = input.evidenceIds;
    if (input.confidence !== undefined) data.confidence = clamp(input.confidence);

    const row = await this.prisma.client.genomeGrowthChannel.update({
      where: { id: channelId },
      data,
    });

    return toDomain(row);
  }

  async delete(businessId: string, channelId: string): Promise<{ deleted: true }> {
    const existing = await this.prisma.client.genomeGrowthChannel.findFirst({
      where: { id: channelId, businessId },
    });
    if (!existing) {
      throw new NotFoundException('Growth channel not found');
    }

    await this.prisma.client.genomeGrowthChannel.delete({
      where: { id: channelId },
    });

    return { deleted: true };
  }
}
