import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  KEY_GENOME_DEPARTMENTS,
  type GenomeDepartmentDefinition,
} from './key-genome-departments';
import type {
  DepartmentGenomeSummary,
  GenomeDepartmentData,
  ListGenomeDepartmentsQuery,
  RiskLevel,
} from './key-genome.types';

function asJsonValue<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function toDomain(row: {
  id: string;
  businessId: string;
  code: string;
  name: string;
  description: string | null;
  primarySections: unknown;
  supportingSections: unknown;
  impactedModules: unknown;
  coreCapabilities: unknown;
  maturityScore: number;
  readinessScore: number;
  confidenceScore: number;
  riskLevel: string;
  autonomySensitive: boolean;
  automationAllowed: boolean;
  gapSummary: unknown;
  recommendedActions: unknown;
  lastComputedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): GenomeDepartmentData {
  return {
    id: row.id,
    businessId: row.businessId,
    code: row.code,
    name: row.name,
    description: row.description,
    primarySections: Array.isArray(row.primarySections) ? (row.primarySections as string[]) : [],
    supportingSections: Array.isArray(row.supportingSections)
      ? (row.supportingSections as string[])
      : [],
    impactedModules: Array.isArray(row.impactedModules) ? (row.impactedModules as string[]) : [],
    coreCapabilities: Array.isArray(row.coreCapabilities) ? (row.coreCapabilities as string[]) : [],
    maturityScore: row.maturityScore,
    readinessScore: row.readinessScore,
    confidenceScore: row.confidenceScore,
    riskLevel: row.riskLevel as RiskLevel,
    autonomySensitive: row.autonomySensitive,
    automationAllowed: row.automationAllowed,
    gapSummary: Array.isArray(row.gapSummary) ? (row.gapSummary as GenomeDepartmentData['gapSummary']) : [],
    recommendedActions: Array.isArray(row.recommendedActions)
      ? (row.recommendedActions as GenomeDepartmentData['recommendedActions'])
      : [],
    lastComputedAt: row.lastComputedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function definitionToInput(
  businessId: string,
  definition: GenomeDepartmentDefinition,
): Prisma.GenomeDepartmentCreateInput {
  return {
    business: { connect: { id: businessId } },
    code: definition.code,
    name: definition.name,
    description: definition.description,
    primarySections: asJsonValue(definition.primarySections),
    supportingSections: asJsonValue(definition.supportingSections),
    impactedModules: asJsonValue(definition.impactedModules),
    coreCapabilities: asJsonValue(definition.coreCapabilities),
    autonomySensitive: definition.autonomySensitive,
  };
}

@Injectable()
export class GenomeDepartmentService {
  constructor(private readonly prisma: PrismaService) {}

  async seedDepartments(businessId: string): Promise<GenomeDepartmentData[]> {
    const results: GenomeDepartmentData[] = [];

    for (const definition of KEY_GENOME_DEPARTMENTS) {
      const existing = await this.prisma.client.genomeDepartment.findUnique({
        where: { businessId_code: { businessId, code: definition.code } },
      });

      if (existing) {
        const updated = await this.prisma.client.genomeDepartment.update({
          where: { id: existing.id },
          data: {
            name: definition.name,
            description: definition.description,
            primarySections: asJsonValue(definition.primarySections),
            supportingSections: asJsonValue(definition.supportingSections),
            impactedModules: asJsonValue(definition.impactedModules),
            coreCapabilities: asJsonValue(definition.coreCapabilities),
            autonomySensitive: definition.autonomySensitive,
          },
        });
        results.push(toDomain(updated));
      } else {
        const created = await this.prisma.client.genomeDepartment.create({
          data: definitionToInput(businessId, definition),
        });
        results.push(toDomain(created));
      }
    }

    return results;
  }

  async listDepartments(
    businessId: string,
    filters: ListGenomeDepartmentsQuery = {},
  ): Promise<GenomeDepartmentData[]> {
    const where: Prisma.GenomeDepartmentWhereInput = { businessId };

    if (filters.riskLevel) {
      where.riskLevel = filters.riskLevel;
    }

    if (filters.automationAllowed !== undefined) {
      where.automationAllowed = filters.automationAllowed;
    }

    if (filters.minReadinessScore !== undefined) {
      where.readinessScore = { gte: filters.minReadinessScore };
    }

    const rows = await this.prisma.client.genomeDepartment.findMany({
      where,
      orderBy: [{ readinessScore: 'desc' }, { maturityScore: 'desc' }],
      take: filters.limit,
    });

    return rows.map(toDomain);
  }

  async getDepartment(businessId: string, code: string): Promise<GenomeDepartmentData> {
    const row = await this.prisma.client.genomeDepartment.findUnique({
      where: { businessId_code: { businessId, code } },
    });

    if (!row) {
      throw new NotFoundException(`Genome department ${code} not found`);
    }

    return toDomain(row);
  }

  async upsertDepartmentSnapshot(
    businessId: string,
    data: Partial<GenomeDepartmentData> & { code: string },
  ): Promise<GenomeDepartmentData> {
    const existing = await this.prisma.client.genomeDepartment.findUnique({
      where: { businessId_code: { businessId, code: data.code } },
    });

    const updateData: Prisma.GenomeDepartmentUpdateInput = {
      maturityScore: data.maturityScore !== undefined ? clamp(data.maturityScore) : undefined,
      readinessScore: data.readinessScore !== undefined ? clamp(data.readinessScore) : undefined,
      confidenceScore: data.confidenceScore !== undefined ? clamp(data.confidenceScore) : undefined,
      riskLevel: data.riskLevel,
      automationAllowed: data.automationAllowed,
      gapSummary: data.gapSummary !== undefined ? asJsonValue(data.gapSummary) : undefined,
      recommendedActions:
        data.recommendedActions !== undefined ? asJsonValue(data.recommendedActions) : undefined,
      lastComputedAt: new Date(),
    };

    if (existing) {
      const updated = await this.prisma.client.genomeDepartment.update({
        where: { id: existing.id },
        data: updateData,
      });
      return toDomain(updated);
    }

    const definition = KEY_GENOME_DEPARTMENTS.find((d) => d.code === data.code);
    if (!definition) {
      throw new NotFoundException(`Unknown department code: ${data.code}`);
    }

    const created = await this.prisma.client.genomeDepartment.create({
      data: {
        business: { connect: { id: businessId } },
        code: definition.code,
        name: definition.name,
        description: definition.description,
        primarySections: asJsonValue(definition.primarySections),
        supportingSections: asJsonValue(definition.supportingSections),
        impactedModules: asJsonValue(definition.impactedModules),
        coreCapabilities: asJsonValue(definition.coreCapabilities),
        autonomySensitive: definition.autonomySensitive,
        maturityScore: clamp(data.maturityScore ?? 0),
        readinessScore: clamp(data.readinessScore ?? 0),
        confidenceScore: clamp(data.confidenceScore ?? 0),
        riskLevel: data.riskLevel ?? 'MEDIUM',
        automationAllowed: data.automationAllowed ?? false,
        gapSummary: asJsonValue(data.gapSummary ?? []),
        recommendedActions: asJsonValue(data.recommendedActions ?? []),
        lastComputedAt: new Date(),
      },
    });

    return toDomain(created);
  }

  async summary(businessId: string): Promise<DepartmentGenomeSummary> {
    const departments = await this.listDepartments(businessId);

    const strongestDepartments = [...departments]
      .sort((a, b) => b.maturityScore - a.maturityScore)
      .slice(0, 3);

    const weakestDepartments = [...departments]
      .filter((d) => d.maturityScore < 70)
      .sort((a, b) => a.maturityScore - b.maturityScore)
      .slice(0, 5);

    const blockedDepartments = departments.filter(
      (d) => !d.automationAllowed || d.riskLevel === 'HIGH' || d.riskLevel === 'CRITICAL',
    );

    const automationReadyDepartments = departments.filter((d) => d.automationAllowed);

    const overallDepartmentMaturity =
      departments.length === 0
        ? 0
        : departments.reduce((sum, d) => sum + d.maturityScore, 0) / departments.length;

    const overallDepartmentReadiness =
      departments.length === 0
        ? 0
        : departments.reduce((sum, d) => sum + d.readinessScore, 0) / departments.length;

    return {
      businessId,
      generatedAt: new Date().toISOString(),
      departments,
      strongestDepartments,
      weakestDepartments,
      blockedDepartments,
      automationReadyDepartments,
      overallDepartmentMaturity: Math.round(overallDepartmentMaturity),
      overallDepartmentReadiness: Math.round(overallDepartmentReadiness),
    };
  }
}
