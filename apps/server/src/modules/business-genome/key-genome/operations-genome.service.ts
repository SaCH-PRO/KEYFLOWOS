import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { GenomeOperationalProcessService } from './genome-operational-process.service';
import { GenomeDeliveryCapabilityService } from './genome-delivery-capability.service';
import { GenomeSignalService } from './genome-signal.service';
import { GenomeRecommendationService } from './genome-recommendation.service';
import { GenomeMemoryService } from './genome-memory.service';
import { DepartmentReadinessService } from './department-readiness.service';
import { FinanceGenomeService } from './finance-genome.service';
import { CustomerSalesGenomeService } from './customer-sales-genome.service';
import type {
  CreateGenomeRecommendationInput,
  CreateGenomeSignalInput,
  GenomeOperationsRecommendation,
  GenomeOperationsRiskLevel,
  GenomeOperationsSnapshotData,
  GenomeOperationsWarning,
  ListGenomeOperationsSnapshotsQuery,
} from './key-genome.types';

function asJsonValue<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function toRiskScore(risk: GenomeOperationsRiskLevel): number {
  switch (risk) {
    case 'LOW':
      return 100;
    case 'MEDIUM':
      return 65;
    case 'HIGH':
      return 35;
    case 'CRITICAL':
      return 10;
    default:
      return 40;
  }
}

function overallRisk(risks: GenomeOperationsRiskLevel[]): GenomeOperationsRiskLevel {
  if (risks.includes('CRITICAL')) return 'CRITICAL';
  if (risks.includes('HIGH')) return 'HIGH';
  if (risks.includes('MEDIUM')) return 'MEDIUM';
  if (risks.includes('LOW')) return 'LOW';
  return 'UNKNOWN';
}

function sopRisk(sopCoverageRate: number | undefined, processCount: number): GenomeOperationsRiskLevel {
  if (processCount === 0) return 'UNKNOWN';
  if (sopCoverageRate === undefined) return 'MEDIUM';
  if (sopCoverageRate < 0.3) return 'HIGH';
  if (sopCoverageRate < 0.6) return 'MEDIUM';
  return 'LOW';
}

function capacityRisk(averageUtilization: number | undefined, overloadedCount: number): GenomeOperationsRiskLevel {
  if (overloadedCount > 0) return 'CRITICAL';
  if (averageUtilization === undefined) return 'UNKNOWN';
  if (averageUtilization > 1) return 'CRITICAL';
  if (averageUtilization > 0.9) return 'HIGH';
  if (averageUtilization > 0.75) return 'MEDIUM';
  return 'LOW';
}

function qualityRisk(
  avgQuality: number | undefined,
  avgReliability: number | undefined,
  highRiskProcessCount: number,
): GenomeOperationsRiskLevel {
  if (highRiskProcessCount > 0) return 'HIGH';
  if (avgQuality === undefined && avgReliability === undefined) return 'UNKNOWN';
  const qualityLow = avgQuality !== undefined && avgQuality < 60;
  const reliabilityLow = avgReliability !== undefined && avgReliability < 60;
  if (qualityLow || reliabilityLow) return 'HIGH';
  return 'LOW';
}

function computeDeliveryReadinessScore(
  sopCoverageRate: number | undefined,
  averageMaturity: number | undefined,
  averageUtilization: number | undefined,
  avgQuality: number | undefined,
  avgReliability: number | undefined,
  confidence: number,
): number {
  const sopScore = sopCoverageRate !== undefined ? sopCoverageRate * 100 : 40;
  const maturityScore = averageMaturity !== undefined ? averageMaturity : 40;
  const capacityScore = averageUtilization !== undefined ? Math.max(0, 100 - averageUtilization * 100) : 50;
  const qualityScore = avgQuality !== undefined && avgReliability !== undefined
    ? ((avgQuality + avgReliability) / 2)
    : 50;

  return clamp(
    sopScore * 0.25 +
      maturityScore * 0.25 +
      capacityScore * 0.25 +
      qualityScore * 0.15 +
      confidence * 0.1,
    0,
    100,
  );
}

@Injectable()
export class OperationsGenomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly processes: GenomeOperationalProcessService,
    private readonly capabilities: GenomeDeliveryCapabilityService,
    @Inject(forwardRef(() => FinanceGenomeService))
    @Inject(forwardRef(() => FinanceGenomeService)) private readonly financeGenome: FinanceGenomeService,
    @Inject(forwardRef(() => CustomerSalesGenomeService)) private readonly customerSalesGenome: CustomerSalesGenomeService,
    private readonly signals: GenomeSignalService,
    @Inject(forwardRef(() => GenomeRecommendationService))
    @Inject(forwardRef(() => GenomeRecommendationService)) private readonly recommendations: GenomeRecommendationService,
    private readonly memory: GenomeMemoryService,
    @Inject(forwardRef(() => DepartmentReadinessService))
    @Inject(forwardRef(() => DepartmentReadinessService)) private readonly departmentReadiness: DepartmentReadinessService,
  ) {}

  async computeOperationsSnapshot(
    businessId: string,
    period?: string,
  ): Promise<GenomeOperationsSnapshotData> {
    const [processes, capabilities, financeSnapshot, salesSnapshot] = await Promise.all([
      this.processes.listProcesses(businessId),
      this.capabilities.listCapabilities(businessId),
      this.financeGenome.getLatestFinanceSnapshot(businessId),
      this.customerSalesGenome.getLatestCustomerSalesSnapshot(businessId),
    ]);

    const processCount = processes.length;
    const documentedCount = processes.filter((p) => p.documented).length;
    const processesWithSop = processes.filter((p) => p.hasSop).length;
    const sopCoverageRate = processCount > 0 ? processesWithSop / processCount : undefined;

    const averageProcessMaturity = processCount > 0
      ? processes.reduce((sum, p) => sum + p.maturityScore, 0) / processCount
      : undefined;

    const capCount = capabilities.length;
    const averageUtilizationRate = capCount > 0
      ? capabilities.reduce((sum, c) => sum + (c.utilizationRate ?? 0), 0) / capCount
      : undefined;

    const averageLeadTimeDays = capCount > 0
      ? capabilities.reduce((sum, c) => sum + (c.averageLeadTimeDays ?? 0), 0) / capCount
      : undefined;

    const avgQuality = capCount > 0
      ? capabilities.reduce((sum, c) => sum + (c.qualityScore ?? 0), 0) / capCount
      : undefined;

    const avgReliability = capCount > 0
      ? capabilities.reduce((sum, c) => sum + (c.reliabilityScore ?? 0), 0) / capCount
      : undefined;

    const bottleneckCount = processes.reduce((sum, p) => sum + p.bottlenecks.length, 0);
    const highRiskProcessCount = processes.filter((p) => p.riskLevel === 'HIGH' || p.riskLevel === 'CRITICAL').length;
    const overloadedCapabilityCount = capabilities.filter((c) => (c.utilizationRate ?? 0) > 1).length;

    const sopRiskLevel = sopRisk(sopCoverageRate, processCount);
    const capRisk = capacityRisk(averageUtilizationRate, overloadedCapabilityCount);
    const qualRisk = qualityRisk(avgQuality, avgReliability, highRiskProcessCount);
    const overall = overallRisk([sopRiskLevel, capRisk, qualRisk]);

    const missingInputs: string[] = [];
    if (processCount === 0) missingInputs.push('operational_processes');
    if (capCount === 0) missingInputs.push('delivery_capabilities');
    if (sopCoverageRate === undefined || sopCoverageRate < 1) missingInputs.push('sop_coverage');
    if (averageUtilizationRate === undefined) missingInputs.push('utilization_rate');
    if (avgQuality === undefined) missingInputs.push('quality_score');
    if (avgReliability === undefined) missingInputs.push('reliability_score');
    if (averageLeadTimeDays === undefined) missingInputs.push('lead_time');
    if (!financeSnapshot) missingInputs.push('finance_snapshot');
    if (!salesSnapshot) missingInputs.push('customer_sales_snapshot');

    const warnings: GenomeOperationsWarning[] = [];
    const recs: GenomeOperationsRecommendation[] = [];

    if (sopRiskLevel === 'HIGH' || sopRiskLevel === 'CRITICAL') {
      warnings.push({
        code: 'LOW_SOP_COVERAGE',
        message: `SOP coverage is ${sopCoverageRate ? (sopCoverageRate * 100).toFixed(0) : 0}%.`,
        severity: sopRiskLevel,
      });
      recs.push({
        title: 'Document core delivery SOPs',
        reason: 'SOP coverage is too low for operational reliability.',
        priority: sopRiskLevel === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
        suggestedAction: 'Prioritize SOPs for delivery, fulfillment, and quality processes.',
      });
    }

    if (capRisk === 'CRITICAL' || capRisk === 'HIGH' || capRisk === 'MEDIUM') {
      warnings.push({
        code: 'CAPACITY_RISK',
        message: capRisk === 'CRITICAL'
          ? 'Delivery capacity is overloaded.'
          : `Average utilization is ${averageUtilizationRate ? (averageUtilizationRate * 100).toFixed(0) : 0}%.`,
        severity: capRisk,
      });
      recs.push({
        title: capRisk === 'CRITICAL' ? 'Urgently increase delivery capacity' : 'Plan capacity increase',
        reason: 'Capacity cannot support current demand reliably.',
        priority: capRisk === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
        suggestedAction: 'Add capacity, reduce backlog, or adjust sales commitments.',
      });
    }

    if (qualRisk === 'HIGH' || qualRisk === 'CRITICAL') {
      warnings.push({
        code: 'QUALITY_RISK',
        message: 'Delivery quality or reliability is below healthy thresholds.',
        severity: qualRisk,
      });
      recs.push({
        title: 'Investigate quality failures',
        reason: 'Quality/reliability scores indicate delivery risk.',
        priority: qualRisk,
        suggestedAction: 'Review failure data and add quality checkpoints.',
      });
    }

    if (bottleneckCount > 0) {
      warnings.push({
        code: 'DELIVERY_BOTTLENECK',
        message: `${bottleneckCount} operational bottleneck(s) detected.`,
        severity: highRiskProcessCount > 0 ? 'HIGH' : 'MEDIUM',
      });
    }

    if (missingInputs.length > 0) {
      recs.push({
        title: 'Record missing operations inputs',
        reason: `Missing inputs: ${missingInputs.join(', ')}.`,
        priority: 'MEDIUM',
        suggestedAction: 'Add processes, capabilities, and relevant metrics.',
      });
    }

    if (processCount === 0) {
      recs.push({
        title: 'Define operational processes',
        reason: 'No operational processes are recorded.',
        priority: 'HIGH',
        suggestedAction: 'Map delivery, support, and fulfillment processes.',
      });
    }

    if (capCount === 0) {
      recs.push({
        title: 'Define delivery capabilities',
        reason: 'No delivery capabilities are recorded.',
        priority: 'HIGH',
        suggestedAction: 'Document capacity, utilization, and lead time for each capability.',
      });
    }

    const confidence = missingInputs.length === 0 ? 0.9 : Math.max(0.4, 0.9 - missingInputs.length * 0.05);
    const deliveryReadinessScore = computeDeliveryReadinessScore(
      sopCoverageRate,
      averageProcessMaturity,
      averageUtilizationRate,
      avgQuality,
      avgReliability,
      confidence * 100,
    );

    const snapshotRow = await this.prisma.client.genomeOperationsSnapshot.create({
      data: {
        businessId,
        period: period ?? null,
        processCount,
        documentedCount,
        sopCoverageRate: sopCoverageRate ?? null,
        averageProcessMaturity: averageProcessMaturity ?? null,
        averageUtilizationRate: averageUtilizationRate ?? null,
        averageLeadTimeDays: averageLeadTimeDays ?? null,
        bottleneckCount,
        highRiskProcessCount,
        overloadedCapabilityCount,
        deliveryReadinessScore,
        qualityRisk: qualRisk,
        capacityRisk: capRisk,
        sopRisk: sopRiskLevel,
        overallRisk: overall,
        missingInputs: asJsonValue(missingInputs),
        warnings: asJsonValue(warnings),
        recommendations: asJsonValue(recs),
        computedAt: new Date(),
      },
    });

    await this.memory.createMemoryEvent({
      businessId,
      sourceType: 'OPERATIONS_GENOME',
      eventType: 'OPERATIONS_SNAPSHOT_COMPUTED',
      domain: 'OPERATIONS',
      section: 'OPERATIONS_DELIVERY',
      title: 'Operations snapshot computed',
      summary: `Overall risk ${overall}, readiness ${deliveryReadinessScore.toFixed(0)}. ${warnings.length} warning(s), ${missingInputs.length} missing input(s).`,
      outcome: overall === 'CRITICAL' || overall === 'HIGH' ? 'MIXED' : 'SUCCESS',
      impactScore: deliveryReadinessScore / 100,
      confidenceDelta: 0,
      metadata: { period: period ?? null, deliveryReadinessScore, overallRisk: overall },
      occurredAt: new Date().toISOString(),
    });

    const departments: string[] = ['COO_OPERATIONS', 'PRODUCT_SERVICE', 'CUSTOMER_SUCCESS', 'RISK'];
    if (overall === 'CRITICAL') departments.push('CEO_STRATEGY');
    await Promise.all(departments.map((code) => this.departmentReadiness.computeOneDepartment(businessId, code)));

    return this.toSnapshotDomain(snapshotRow);
  }

  async getLatestOperationsSnapshot(businessId: string): Promise<GenomeOperationsSnapshotData | null> {
    const row = await this.prisma.client.genomeOperationsSnapshot.findFirst({
      where: { businessId },
      orderBy: { computedAt: 'desc' },
    });
    return row ? this.toSnapshotDomain(row) : null;
  }

  async listOperationsSnapshots(
    businessId: string,
    filters: ListGenomeOperationsSnapshotsQuery = {},
  ): Promise<GenomeOperationsSnapshotData[]> {
    const rows = await this.prisma.client.genomeOperationsSnapshot.findMany({
      where: {
        businessId,
        ...(filters.period !== undefined ? { period: filters.period } : {}),
        ...(filters.riskLevel ? { overallRisk: filters.riskLevel } : {}),
      },
      orderBy: { computedAt: 'desc' },
      take: filters.limit,
    });
    return rows.map((r) => this.toSnapshotDomain(r));
  }

  async generateOperationsSignals(businessId: string): Promise<import('./key-genome.types').GenomeSignalData[]> {
    const snapshot = await this.getLatestOperationsSnapshot(businessId);
    if (!snapshot) {
      return [];
    }

    const inputs: CreateGenomeSignalInput[] = [];

    for (const warning of snapshot.warnings) {
      let signalType: string;
      switch (warning.code) {
        case 'LOW_SOP_COVERAGE':
        case 'DELIVERY_BOTTLENECK':
          signalType = 'MISSING_FACT';
          break;
        case 'CAPACITY_RISK':
        case 'QUALITY_RISK':
          signalType = 'RISK_PATTERN';
          break;
        default:
          signalType = 'OPERATIONS_PATTERN';
      }

      inputs.push({
        businessId,
        sourceModule: 'operations',
        sourceEntityType: 'OPERATIONS_GENOME',
        signalType,
        section: 'OPERATIONS_DELIVERY',
        domain: 'operations',
        field: warning.code,
        reason: warning.message,
        confidence: warning.severity === 'CRITICAL' ? 0.95 : warning.severity === 'HIGH' ? 0.85 : 0.7,
      });
    }

    if (snapshot.missingInputs.length > 0) {
      inputs.push({
        businessId,
        sourceModule: 'operations',
        sourceEntityType: 'OPERATIONS_GENOME',
        signalType: 'MISSING_FACT',
        section: 'OPERATIONS_DELIVERY',
        domain: 'operations',
        field: 'missing_inputs',
        reason: `Missing operations inputs: ${snapshot.missingInputs.join(', ')}`,
        confidence: 0.75,
      });
    }

    const signals = await this.signals.createSignals(inputs);

    if (signals.length > 0) {
      await this.memory.createMemoryEvent({
        businessId,
        sourceType: 'OPERATIONS_GENOME',
        eventType: 'OPERATIONS_SIGNAL_GENERATED',
        domain: 'OPERATIONS',
        section: 'OPERATIONS_DELIVERY',
        title: 'Operations signals generated',
        summary: `${signals.length} operations signal(s) generated from latest snapshot.`,
        outcome: 'SUCCESS',
        impactScore: 0.5,
        confidenceDelta: 0,
        metadata: { count: signals.length },
        occurredAt: new Date().toISOString(),
      });
    }

    return signals;
  }

  async generateOperationsRecommendations(
    businessId: string,
  ): Promise<import('./key-genome.types').GenomeRecommendationData[]> {
    const snapshot = await this.getLatestOperationsSnapshot(businessId);
    if (!snapshot) {
      return [];
    }

    const created: Promise<import('./key-genome.types').GenomeRecommendationData>[] = [];
    for (const rec of snapshot.recommendations) {
      const input: CreateGenomeRecommendationInput = {
        businessId,
        domain: 'OPERATIONS',
        title: rec.title,
        insight: rec.reason,
        diagnosis: rec.reason,
        recommendation: rec.suggestedAction ?? rec.title,
        expectedGain: 'Improve delivery readiness and reduce operational risk.',
        expectedGainScore:
          rec.priority === 'CRITICAL' ? 90 : rec.priority === 'HIGH' ? 70 : rec.priority === 'MEDIUM' ? 50 : 30,
        riskLevel: rec.priority === 'CRITICAL' ? 'CRITICAL' : rec.priority === 'HIGH' ? 'HIGH' : rec.priority === 'MEDIUM' ? 'MEDIUM' : 'LOW',
        effortLevel: rec.priority === 'CRITICAL' ? 'HIGH' : 'MEDIUM',
        confidence: 0.75,
        source: 'READINESS_GAP',
      };
      created.push(this.recommendations.createRecommendation(input));
    }

    const recommendations = await Promise.all(created);

    if (recommendations.length > 0) {
      await this.memory.createMemoryEvent({
        businessId,
        sourceType: 'OPERATIONS_GENOME',
        eventType: 'OPERATIONS_RECOMMENDATION_GENERATED',
        domain: 'OPERATIONS',
        section: 'OPERATIONS_DELIVERY',
        title: 'Operations recommendations generated',
        summary: `${recommendations.length} operations recommendation(s) created.`,
        outcome: 'SUCCESS',
        impactScore: 0.5,
        confidenceDelta: 0,
        metadata: { count: recommendations.length },
        occurredAt: new Date().toISOString(),
      });
    }

    return recommendations;
  }

  private toSnapshotDomain(row: {
    id: string;
    businessId: string;
    period: string | null;
    processCount: number;
    documentedCount: number;
    sopCoverageRate: number | null;
    averageProcessMaturity: number | null;
    averageUtilizationRate: number | null;
    averageLeadTimeDays: number | null;
    bottleneckCount: number;
    highRiskProcessCount: number;
    overloadedCapabilityCount: number;
    deliveryReadinessScore: number;
    qualityRisk: string;
    capacityRisk: string;
    sopRisk: string;
    overallRisk: string;
    missingInputs: unknown;
    warnings: unknown;
    recommendations: unknown;
    computedAt: Date;
  }): GenomeOperationsSnapshotData {
    return {
      id: row.id,
      businessId: row.businessId,
      period: row.period ?? null,
      processCount: row.processCount,
      documentedCount: row.documentedCount,
      sopCoverageRate: row.sopCoverageRate ?? null,
      averageProcessMaturity: row.averageProcessMaturity ?? null,
      averageUtilizationRate: row.averageUtilizationRate ?? null,
      averageLeadTimeDays: row.averageLeadTimeDays ?? null,
      bottleneckCount: row.bottleneckCount,
      highRiskProcessCount: row.highRiskProcessCount,
      overloadedCapabilityCount: row.overloadedCapabilityCount,
      deliveryReadinessScore: row.deliveryReadinessScore,
      qualityRisk: row.qualityRisk as GenomeOperationsSnapshotData['qualityRisk'],
      capacityRisk: row.capacityRisk as GenomeOperationsSnapshotData['capacityRisk'],
      sopRisk: row.sopRisk as GenomeOperationsSnapshotData['sopRisk'],
      overallRisk: row.overallRisk as GenomeOperationsSnapshotData['overallRisk'],
      missingInputs: Array.isArray(row.missingInputs) ? (row.missingInputs as string[]) : [],
      warnings: Array.isArray(row.warnings) ? (row.warnings as GenomeOperationsWarning[]) : [],
      recommendations: Array.isArray(row.recommendations)
        ? (row.recommendations as GenomeOperationsRecommendation[])
        : [],
      computedAt: row.computedAt.toISOString(),
    };
  }
}
