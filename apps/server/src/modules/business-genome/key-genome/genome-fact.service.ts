import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type { GenomeFactData, GenomeFactValue, UpsertGenomeFactInput } from './key-genome.types';

function inferValueType(raw: unknown): GenomeFactValue['type'] {
  if (raw === null || raw === undefined) return 'JSON';
  if (Array.isArray(raw)) return 'LIST';
  if (typeof raw === 'boolean') return 'BOOLEAN';
  if (typeof raw === 'number') return 'NUMBER';
  if (raw instanceof Date) return 'DATE';
  if (typeof raw === 'string') {
    const iso = /^\d{4}-\d{2}-\d{2}/;
    return iso.test(raw) && !Number.isNaN(Date.parse(raw)) ? 'DATE' : 'STRING';
  }
  return 'JSON';
}

function normalizeValue(raw: unknown): GenomeFactValue {
  const type = inferValueType(raw);
  if (type === 'DATE' && raw instanceof Date) {
    return { raw: raw.toISOString(), type };
  }
  return { raw: raw ?? null, type };
}

function toDomain(row: {
  id: string;
  businessId: string;
  section: string;
  domain: string;
  field: string;
  value: unknown;
  valueType: string;
  sourceModule: string | null;
  sourceType: string;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  completenessScore: number;
  qualityScore: number;
  confidenceScore: number;
  freshnessScore: number;
  operationalReadinessScore: number;
  verificationStatus: string;
  riskIfWrong: string;
  lastVerifiedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): GenomeFactData {
  const normalized = normalizeValue(row.value);
  return {
    id: row.id,
    businessId: row.businessId,
    section: row.section,
    domain: row.domain,
    field: row.field,
    value: normalized,
    sourceModule: row.sourceModule,
    sourceType: row.sourceType,
    sourceEntityType: row.sourceEntityType,
    sourceEntityId: row.sourceEntityId,
    score: {
      completeness: row.completenessScore,
      quality: row.qualityScore,
      confidence: row.confidenceScore,
      freshness: row.freshnessScore,
      operationalReadiness: row.operationalReadinessScore,
      riskPenalty: 0,
      overall: 0,
    },
    verificationStatus: row.verificationStatus as GenomeFactData['verificationStatus'],
    riskIfWrong: row.riskIfWrong as GenomeFactData['riskIfWrong'],
    lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class GenomeFactService {
  constructor(private readonly prisma: PrismaService) {}

  async upsertFact(input: UpsertGenomeFactInput): Promise<GenomeFactData> {
    const normalized: GenomeFactValue = input.value.type
      ? { raw: input.value.raw, type: input.value.type }
      : normalizeValue(input.value.raw);
    const now = new Date();

    const row = await this.prisma.client.genomeFact.upsert({
      where: {
        businessId_section_domain_field: {
          businessId: input.businessId,
          section: input.section,
          domain: input.domain,
          field: input.field,
        },
      },
      update: {
        value: normalized.raw === null ? Prisma.JsonNull : (normalized.raw as Prisma.InputJsonValue),
        valueType: normalized.type,
        sourceModule: input.sourceModule ?? null,
        sourceType: input.sourceType,
        sourceEntityType: input.sourceEntityType ?? null,
        sourceEntityId: input.sourceEntityId ?? null,
        updatedAt: now,
      },
      create: {
        businessId: input.businessId,
        section: input.section,
        domain: input.domain,
        field: input.field,
        value: normalized.raw === null ? Prisma.JsonNull : (normalized.raw as Prisma.InputJsonValue),
        valueType: normalized.type,
        sourceModule: input.sourceModule ?? null,
        sourceType: input.sourceType,
        sourceEntityType: input.sourceEntityType ?? null,
        sourceEntityId: input.sourceEntityId ?? null,
        completenessScore: 0,
        qualityScore: 0,
        confidenceScore: 0,
        freshnessScore: 0,
        operationalReadinessScore: 0,
        verificationStatus: 'UNVERIFIED_IMPORTED',
        riskIfWrong: 'MEDIUM',
        updatedAt: now,
      },
    });

    return toDomain(row);
  }

  async getFact(
    businessId: string,
    section: string,
    domain: string,
    field: string,
  ): Promise<GenomeFactData | null> {
    const row = await this.prisma.client.genomeFact.findUnique({
      where: {
        businessId_section_domain_field: {
          businessId,
          section,
          domain,
          field,
        },
      },
    });

    return row ? toDomain(row) : null;
  }

  async listFacts(
    businessId: string,
    filters?: { section?: string; domain?: string; verificationStatus?: string },
  ): Promise<GenomeFactData[]> {
    const rows = await this.prisma.client.genomeFact.findMany({
      where: {
        businessId,
        ...(filters?.section ? { section: filters.section } : {}),
        ...(filters?.domain ? { domain: filters.domain } : {}),
        ...(filters?.verificationStatus ? { verificationStatus: filters.verificationStatus } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map(toDomain);
  }

  async countFacts(businessId: string): Promise<number> {
    return this.prisma.client.genomeFact.count({ where: { businessId } });
  }
}
