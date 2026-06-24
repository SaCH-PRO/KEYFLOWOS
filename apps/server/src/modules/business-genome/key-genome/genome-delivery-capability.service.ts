import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  GenomeDeliveryCapabilityData,
  GenomeDeliveryCapabilityRecommendation,
  GenomeOperationsRiskLevel,
  ListGenomeDeliveryCapabilitiesQuery,
  UpsertGenomeDeliveryCapabilityInput,
} from './key-genome.types';

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function toRiskLevel(risk: string): GenomeOperationsRiskLevel {
  if (risk === 'LOW' || risk === 'MEDIUM' || risk === 'HIGH' || risk === 'CRITICAL' || risk === 'UNKNOWN') {
    return risk;
  }
  return 'UNKNOWN';
}

function scoreCapability(
  input: UpsertGenomeDeliveryCapabilityInput,
): {
  riskLevel: GenomeOperationsRiskLevel;
  constraints: GenomeDeliveryCapabilityData['constraints'];
  recommendations: GenomeDeliveryCapabilityRecommendation[];
} {
  const constraints: GenomeDeliveryCapabilityData['constraints'] = [];
  const recommendations: GenomeDeliveryCapabilityRecommendation[] = [];

  const utilization = input.utilizationRate;
  if (utilization !== undefined && utilization !== null) {
    if (utilization > 1) {
      constraints.push({ label: 'Overloaded', reason: `Utilization is ${(utilization * 100).toFixed(0)}%.`, severity: 'CRITICAL' });
      recommendations.push({
        title: `Increase capacity for ${input.name}`,
        reason: 'Utilization exceeds 100%.',
        priority: 'CRITICAL',
        suggestedAction: 'Add capacity, reduce backlog, or throttle demand.',
      });
    } else if (utilization > 0.9) {
      constraints.push({ label: 'Near capacity', reason: `Utilization is ${(utilization * 100).toFixed(0)}%.`, severity: 'HIGH' });
      recommendations.push({
        title: `Plan capacity increase for ${input.name}`,
        reason: 'Utilization is above 90%.',
        priority: 'HIGH',
        suggestedAction: 'Model demand growth and expand capacity before breakdown.',
      });
    } else if (utilization > 0.75) {
      constraints.push({ label: 'Elevated utilization', reason: `Utilization is ${(utilization * 100).toFixed(0)}%.`, severity: 'MEDIUM' });
    }
  }

  if (input.backlogVolume !== undefined && input.backlogVolume !== null && input.backlogVolume > 0) {
    const severity: GenomeOperationsRiskLevel =
      input.averageLeadTimeDays !== undefined && input.averageLeadTimeDays !== null && input.averageLeadTimeDays > 14 ? 'HIGH' : 'MEDIUM';
    constraints.push({ label: 'Backlog', reason: `Backlog volume is ${input.backlogVolume}.`, severity });
    if (severity === 'HIGH') {
      recommendations.push({
        title: `Triage backlog for ${input.name}`,
        reason: 'Backlog is high and lead times are long.',
        priority: 'HIGH',
        suggestedAction: 'Create backlog triage process and prioritize by value.',
      });
    }
  }

  if (input.qualityScore !== undefined && input.qualityScore !== null && input.qualityScore < 60) {
    const severity: GenomeOperationsRiskLevel = input.qualityScore < 40 ? 'CRITICAL' : 'HIGH';
    constraints.push({ label: 'Low quality score', reason: `Quality score is ${input.qualityScore}.`, severity });
    recommendations.push({
      title: `Improve quality for ${input.name}`,
      reason: 'Quality score is below healthy threshold.',
      priority: severity,
      suggestedAction: 'Review quality checkpoints and failure data.',
    });
  }

  if (input.reliabilityScore !== undefined && input.reliabilityScore !== null && input.reliabilityScore < 60) {
    const severity: GenomeOperationsRiskLevel = input.reliabilityScore < 40 ? 'CRITICAL' : 'HIGH';
    constraints.push({ label: 'Low reliability score', reason: `Reliability score is ${input.reliabilityScore}.`, severity });
    recommendations.push({
      title: `Improve reliability for ${input.name}`,
      reason: 'Reliability score is below healthy threshold.',
      priority: severity,
      suggestedAction: 'Identify top reasons for missed delivery and add buffers.',
    });
  }

  const riskLevel =
    constraints.some((c) => c.severity === 'CRITICAL') ? 'CRITICAL'
    : constraints.some((c) => c.severity === 'HIGH') ? 'HIGH'
    : constraints.some((c) => c.severity === 'MEDIUM') ? 'MEDIUM'
    : constraints.some((c) => c.severity === 'LOW') ? 'LOW'
    : 'UNKNOWN';

  return { riskLevel, constraints, recommendations };
}

function toDomain(row: {
  id: string;
  businessId: string;
  name: string;
  description: string | null;
  capabilityType: string;
  currentCapacity: number | null;
  maxCapacity: number | null;
  capacityUnit: string | null;
  utilizationRate: number | null;
  backlogVolume: number | null;
  averageLeadTimeDays: number | null;
  qualityScore: number | null;
  reliabilityScore: number | null;
  riskLevel: string;
  confidence: number;
  constraints: unknown;
  dependencies: unknown;
  recommendations: unknown;
  sourceModule: string | null;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): GenomeDeliveryCapabilityData {
  return {
    id: row.id,
    businessId: row.businessId,
    name: row.name,
    description: row.description,
    capabilityType: row.capabilityType,
    currentCapacity: row.currentCapacity,
    maxCapacity: row.maxCapacity,
    capacityUnit: row.capacityUnit,
    utilizationRate: row.utilizationRate,
    backlogVolume: row.backlogVolume,
    averageLeadTimeDays: row.averageLeadTimeDays,
    qualityScore: row.qualityScore,
    reliabilityScore: row.reliabilityScore,
    riskLevel: toRiskLevel(row.riskLevel),
    confidence: row.confidence,
    constraints: Array.isArray(row.constraints) ? (row.constraints as GenomeDeliveryCapabilityData['constraints']) : [],
    dependencies: Array.isArray(row.dependencies) ? (row.dependencies as GenomeDeliveryCapabilityData['dependencies']) : [],
    recommendations: Array.isArray(row.recommendations)
      ? (row.recommendations as GenomeDeliveryCapabilityData['recommendations'])
      : [],
    sourceModule: row.sourceModule,
    sourceEntityType: row.sourceEntityType,
    sourceEntityId: row.sourceEntityId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class GenomeDeliveryCapabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async upsertCapability(input: UpsertGenomeDeliveryCapabilityInput): Promise<GenomeDeliveryCapabilityData> {
    const confidence = clamp(input.confidence ?? 0.5);
    const scored = scoreCapability(input);
    const now = new Date();

    const row = await this.prisma.client.genomeDeliveryCapability.create({
      data: {
        businessId: input.businessId,
        name: input.name,
        description: input.description ?? null,
        capabilityType: input.capabilityType,
        currentCapacity: input.currentCapacity ?? null,
        maxCapacity: input.maxCapacity ?? null,
        capacityUnit: input.capacityUnit ?? null,
        utilizationRate: input.utilizationRate ?? null,
        backlogVolume: input.backlogVolume ?? null,
        averageLeadTimeDays: input.averageLeadTimeDays ?? null,
        qualityScore: input.qualityScore ?? null,
        reliabilityScore: input.reliabilityScore ?? null,
        riskLevel: scored.riskLevel,
        confidence,
        constraints: scored.constraints as unknown as Prisma.InputJsonValue,
        dependencies: [] as unknown as Prisma.InputJsonValue,
        recommendations: scored.recommendations as unknown as Prisma.InputJsonValue,
        sourceModule: input.sourceModule ?? null,
        sourceEntityType: input.sourceEntityType ?? null,
        sourceEntityId: input.sourceEntityId ?? null,
        createdAt: now,
        updatedAt: now,
      },
    });

    return toDomain(row);
  }

  async listCapabilities(
    businessId: string,
    filters: ListGenomeDeliveryCapabilitiesQuery = {},
  ): Promise<GenomeDeliveryCapabilityData[]> {
    const where: Prisma.GenomeDeliveryCapabilityWhereInput = { businessId };

    if (filters.capabilityType) {
      where.capabilityType = filters.capabilityType;
    }
    if (filters.minConfidence !== undefined) {
      where.confidence = { gte: filters.minConfidence };
    }

    const rows = await this.prisma.client.genomeDeliveryCapability.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: filters.limit,
    });

    return rows.map(toDomain);
  }

  async deleteCapability(businessId: string, capabilityId: string): Promise<{ deleted: true }> {
    const existing = await this.prisma.client.genomeDeliveryCapability.findFirst({
      where: { id: capabilityId, businessId },
    });

    if (!existing) {
      throw new NotFoundException('Delivery capability not found');
    }

    await this.prisma.client.genomeDeliveryCapability.delete({
      where: { id: capabilityId },
    });

    return { deleted: true };
  }
}
