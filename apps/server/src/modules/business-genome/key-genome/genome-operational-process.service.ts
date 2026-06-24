import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  GenomeOperationalProcessData,
  GenomeOperationalProcessRecommendation,
  GenomeOperationsRiskLevel,
  ListGenomeOperationalProcessesQuery,
  UpsertGenomeOperationalProcessInput,
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

function scoreProcess(
  input: UpsertGenomeOperationalProcessInput,
): {
  maturityScore: number;
  riskLevel: GenomeOperationsRiskLevel;
  bottlenecks: GenomeOperationalProcessData['bottlenecks'];
  missingInputs: string[];
  recommendations: GenomeOperationalProcessRecommendation[];
} {
  const bottlenecks: GenomeOperationalProcessData['bottlenecks'] = [];
  const missingInputs: string[] = [];
  const recommendations: GenomeOperationalProcessRecommendation[] = [];

  const isCore = ['DELIVERY', 'FULFILLMENT', 'QUALITY', 'ONBOARDING'].includes(input.processType);

  if (!input.hasSop) {
    missingInputs.push('sop');
    if (isCore) {
      bottlenecks.push({ label: 'Missing SOP', reason: 'Core process has no documented SOP.', severity: 'HIGH' });
      recommendations.push({
        title: `Document SOP for ${input.name}`,
        reason: 'Core delivery process lacks standard operating procedure.',
        priority: 'HIGH',
        suggestedAction: 'Write step-by-step SOP and assign an owner.',
      });
    }
  }

  if (!input.ownerRole) {
    missingInputs.push('owner');
    bottlenecks.push({ label: 'Unowned process', reason: 'No owner role is assigned.', severity: 'MEDIUM' });
    recommendations.push({
      title: `Assign owner to ${input.name}`,
      reason: 'Process has no accountable owner.',
      priority: 'MEDIUM',
      suggestedAction: 'Define owner role in operating constitution.',
    });
  }

  if (input.failureRate !== undefined && input.failureRate !== null && input.failureRate > 0.15) {
    const severity: GenomeOperationsRiskLevel = input.failureRate > 0.3 ? 'CRITICAL' : 'HIGH';
    bottlenecks.push({ label: 'High failure rate', reason: `Failure rate is ${(input.failureRate * 100).toFixed(0)}%.`, severity });
    recommendations.push({
      title: `Reduce failure rate in ${input.name}`,
      reason: 'Failure rate exceeds healthy thresholds.',
      priority: severity,
      suggestedAction: 'Root-cause failures and add checkpoints.',
    });
  }

  if (input.reworkRate !== undefined && input.reworkRate !== null && input.reworkRate > 0.2) {
    const severity: GenomeOperationsRiskLevel = input.reworkRate > 0.35 ? 'HIGH' : 'MEDIUM';
    bottlenecks.push({ label: 'High rework rate', reason: `Rework rate is ${(input.reworkRate * 100).toFixed(0)}%.`, severity });
    recommendations.push({
      title: `Reduce rework in ${input.name}`,
      reason: 'Rework is consuming capacity.',
      priority: severity,
      suggestedAction: 'Clarify inputs and acceptance criteria.',
    });
  }

  if (input.handoffCount !== undefined && input.handoffCount !== null && input.handoffCount > 3) {
    bottlenecks.push({ label: 'Many handoffs', reason: `${input.handoffCount} handoffs increase coordination risk.`, severity: 'MEDIUM' });
    recommendations.push({
      title: `Simplify handoffs in ${input.name}`,
      reason: 'Too many handoffs create delay and error risk.',
      priority: 'MEDIUM',
      suggestedAction: 'Map process and reduce handoff count.',
    });
  }

  let maturityScore = 50;
  if (input.hasSop) maturityScore += 20;
  if (input.documented) maturityScore += 10;
  if (input.ownerRole) maturityScore += 10;
  if (input.averageCycleTimeHours !== undefined && input.averageCycleTimeHours !== null && input.averageCycleTimeHours > 0) maturityScore += 10;
  if (bottlenecks.length > 0) maturityScore -= Math.min(bottlenecks.length * 10, 30);
  maturityScore = Math.max(0, Math.min(100, maturityScore));

  const riskLevel =
    bottlenecks.some((b) => b.severity === 'CRITICAL') ? 'CRITICAL'
    : bottlenecks.some((b) => b.severity === 'HIGH') ? 'HIGH'
    : bottlenecks.some((b) => b.severity === 'MEDIUM') ? 'MEDIUM'
    : bottlenecks.some((b) => b.severity === 'LOW') ? 'LOW'
    : 'UNKNOWN';

  return { maturityScore, riskLevel, bottlenecks, missingInputs, recommendations };
}

function toDomain(row: {
  id: string;
  businessId: string;
  name: string;
  description: string | null;
  processType: string;
  ownerRole: string | null;
  frequency: string | null;
  documented: boolean;
  hasSop: boolean;
  averageCycleTimeHours: number | null;
  failureRate: number | null;
  reworkRate: number | null;
  handoffCount: number | null;
  automationCandidate: boolean;
  autonomySensitive: boolean;
  maturityScore: number;
  riskLevel: string;
  confidence: number;
  bottlenecks: unknown;
  missingInputs: unknown;
  recommendations: unknown;
  sourceModule: string | null;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): GenomeOperationalProcessData {
  return {
    id: row.id,
    businessId: row.businessId,
    name: row.name,
    description: row.description,
    processType: row.processType,
    ownerRole: row.ownerRole,
    frequency: row.frequency,
    documented: row.documented,
    hasSop: row.hasSop,
    averageCycleTimeHours: row.averageCycleTimeHours,
    failureRate: row.failureRate,
    reworkRate: row.reworkRate,
    handoffCount: row.handoffCount,
    automationCandidate: row.automationCandidate,
    autonomySensitive: row.autonomySensitive,
    maturityScore: row.maturityScore,
    riskLevel: toRiskLevel(row.riskLevel),
    confidence: row.confidence,
    bottlenecks: Array.isArray(row.bottlenecks) ? (row.bottlenecks as GenomeOperationalProcessData['bottlenecks']) : [],
    missingInputs: Array.isArray(row.missingInputs) ? (row.missingInputs as string[]) : [],
    recommendations: Array.isArray(row.recommendations)
      ? (row.recommendations as GenomeOperationalProcessData['recommendations'])
      : [],
    sourceModule: row.sourceModule,
    sourceEntityType: row.sourceEntityType,
    sourceEntityId: row.sourceEntityId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class GenomeOperationalProcessService {
  constructor(private readonly prisma: PrismaService) {}

  async upsertProcess(input: UpsertGenomeOperationalProcessInput): Promise<GenomeOperationalProcessData> {
    const confidence = clamp(input.confidence ?? 0.5);
    const scored = scoreProcess(input);
    const now = new Date();

    const row = await this.prisma.client.genomeOperationalProcess.create({
      data: {
        businessId: input.businessId,
        name: input.name,
        description: input.description ?? null,
        processType: input.processType,
        ownerRole: input.ownerRole ?? null,
        frequency: input.frequency ?? null,
        documented: input.documented ?? false,
        hasSop: input.hasSop ?? false,
        averageCycleTimeHours: input.averageCycleTimeHours ?? null,
        failureRate: input.failureRate ?? null,
        reworkRate: input.reworkRate ?? null,
        handoffCount: input.handoffCount ?? null,
        automationCandidate: input.automationCandidate ?? false,
        autonomySensitive: input.autonomySensitive ?? false,
        maturityScore: scored.maturityScore,
        riskLevel: scored.riskLevel,
        confidence,
        bottlenecks: scored.bottlenecks as unknown as Prisma.InputJsonValue,
        missingInputs: scored.missingInputs as unknown as Prisma.InputJsonValue,
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

  async listProcesses(
    businessId: string,
    filters: ListGenomeOperationalProcessesQuery = {},
  ): Promise<GenomeOperationalProcessData[]> {
    const where: Prisma.GenomeOperationalProcessWhereInput = { businessId };

    if (filters.processType) {
      where.processType = filters.processType;
    }
    if (filters.ownerRole) {
      where.ownerRole = filters.ownerRole;
    }
    if (filters.hasSop !== undefined) {
      where.hasSop = filters.hasSop;
    }
    if (filters.minConfidence !== undefined) {
      where.confidence = { gte: filters.minConfidence };
    }

    const rows = await this.prisma.client.genomeOperationalProcess.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: filters.limit,
    });

    return rows.map(toDomain);
  }

  async deleteProcess(businessId: string, processId: string): Promise<{ deleted: true }> {
    const existing = await this.prisma.client.genomeOperationalProcess.findFirst({
      where: { id: processId, businessId },
    });

    if (!existing) {
      throw new NotFoundException('Operational process not found');
    }

    await this.prisma.client.genomeOperationalProcess.delete({
      where: { id: processId },
    });

    return { deleted: true };
  }
}
