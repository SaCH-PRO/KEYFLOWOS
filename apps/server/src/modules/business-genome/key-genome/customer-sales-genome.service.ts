import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { GenomeFinancialMetricService } from './genome-financial-metric.service';
import { GenomeCustomerSegmentService } from './genome-customer-segment.service';
import { GenomeSalesMotionService } from './genome-sales-motion.service';
import { GenomeSignalService } from './genome-signal.service';
import { GenomeRecommendationService } from './genome-recommendation.service';
import { GenomeMemoryService } from './genome-memory.service';
import { DepartmentReadinessService } from './department-readiness.service';
import type {
  CreateGenomeRecommendationInput,
  CreateGenomeSignalInput,
  GenomeCustomerSalesRecommendation,
  GenomeCustomerSalesRiskLevel,
  GenomeCustomerSalesSnapshotData,
  GenomeCustomerSalesWarning,
  GenomeCustomerSegmentData,
  GenomeFinancialMetricData,
  GenomeSalesMotionData,
  ListGenomeCustomerSalesSnapshotsQuery,
} from './key-genome.types';

function asJsonValue<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function toMetricNumber(metric?: GenomeFinancialMetricData | null): number | undefined {
  if (!metric) return undefined;
  return typeof metric.value === 'number' ? metric.value : undefined;
}

function toRiskScore(risk: GenomeCustomerSalesRiskLevel): number {
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

function overallRisk(risks: GenomeCustomerSalesRiskLevel[]): GenomeCustomerSalesRiskLevel {
  if (risks.includes('CRITICAL')) return 'CRITICAL';
  if (risks.includes('HIGH')) return 'HIGH';
  if (risks.includes('MEDIUM')) return 'MEDIUM';
  if (risks.includes('LOW')) return 'LOW';
  return 'UNKNOWN';
}

function weightedSegmentChurn(segments: GenomeCustomerSegmentData[]): number | undefined {
  const withData = segments.filter((s) => s.churnRate != null && s.estimatedSize != null);
  if (withData.length === 0) return undefined;
  const totalSize = withData.reduce((sum, s) => sum + (s.estimatedSize ?? 0), 0);
  if (totalSize <= 0) return undefined;
  return withData.reduce((sum, s) => sum + (s.churnRate ?? 0) * (s.estimatedSize ?? 0), 0) / totalSize;
}

function weightedSegmentLtv(segments: GenomeCustomerSegmentData[]): number | undefined {
  const withData = segments.filter((s) => s.lifetimeValue != null && s.estimatedSize != null);
  if (withData.length === 0) return undefined;
  const totalSize = withData.reduce((sum, s) => sum + (s.estimatedSize ?? 0), 0);
  if (totalSize <= 0) return undefined;
  return withData.reduce((sum, s) => sum + (s.lifetimeValue ?? 0) * (s.estimatedSize ?? 0), 0) / totalSize;
}

function weightedSegmentCac(segments: GenomeCustomerSegmentData[]): number | undefined {
  const withData = segments.filter((s) => s.acquisitionCost != null && s.estimatedSize != null);
  if (withData.length === 0) return undefined;
  const totalSize = withData.reduce((sum, s) => sum + (s.estimatedSize ?? 0), 0);
  if (totalSize <= 0) return undefined;
  return withData.reduce((sum, s) => sum + (s.acquisitionCost ?? 0) * (s.estimatedSize ?? 0), 0) / totalSize;
}

function weightedMotionConversion(motions: GenomeSalesMotionData[]): number | undefined {
  const active = motions.filter((m) => m.isActive);
  const withData = active.filter((m) => m.conversionRate != null && m.volume != null);
  if (withData.length === 0) return undefined;
  const totalVolume = withData.reduce((sum, m) => sum + (m.volume ?? 0), 0);
  if (totalVolume <= 0) return undefined;
  return (
    withData.reduce((sum, m) => sum + (m.conversionRate ?? 0) * (m.volume ?? 0), 0) / totalVolume
  );
}

function revenueConcentrationRisk(segments: GenomeCustomerSegmentData[]): GenomeCustomerSalesRiskLevel {
  if (segments.length === 0) return 'UNKNOWN';
  const withRevenue = segments.filter((s) => s.averageRevenue != null && s.estimatedSize != null);
  if (withRevenue.length === 0) return 'UNKNOWN';
  const totalRevenue = withRevenue.reduce(
    (sum, s) => sum + (s.averageRevenue ?? 0) * (s.estimatedSize ?? 0),
    0,
  );
  if (totalRevenue <= 0) return 'UNKNOWN';
  const maxShare = Math.max(
    ...withRevenue.map((s) => ((s.averageRevenue ?? 0) * (s.estimatedSize ?? 0)) / totalRevenue),
  );
  if (maxShare > 0.8) return 'HIGH';
  if (maxShare > 0.5) return 'MEDIUM';
  return 'LOW';
}

function cacRisk(
  cac: number | undefined,
  ltvCacRatio: number | undefined,
): GenomeCustomerSalesRiskLevel {
  if (cac === undefined) return 'UNKNOWN';
  if (ltvCacRatio === undefined) return 'MEDIUM';
  if (ltvCacRatio < 1) return 'CRITICAL';
  if (ltvCacRatio < 3) return 'HIGH';
  if (ltvCacRatio < 5) return 'MEDIUM';
  return 'LOW';
}

function ltvRisk(ltv: number | undefined, ltvCacRatio: number | undefined): GenomeCustomerSalesRiskLevel {
  if (ltv === undefined) return 'UNKNOWN';
  if (ltvCacRatio === undefined) return 'MEDIUM';
  if (ltvCacRatio < 1) return 'CRITICAL';
  if (ltvCacRatio < 3) return 'HIGH';
  if (ltvCacRatio < 5) return 'MEDIUM';
  return 'LOW';
}

function churnRisk(churnRate: number | undefined): GenomeCustomerSalesRiskLevel {
  if (churnRate === undefined) return 'UNKNOWN';
  if (churnRate > 0.2) return 'HIGH';
  if (churnRate > 0.1) return 'MEDIUM';
  return 'LOW';
}

function conversionRisk(conversionRate: number | undefined): GenomeCustomerSalesRiskLevel {
  if (conversionRate === undefined) return 'UNKNOWN';
  if (conversionRate < 0.01) return 'HIGH';
  if (conversionRate < 0.03) return 'MEDIUM';
  return 'LOW';
}

function computeRevenueQualityScore(
  ltvCacRatio: number | undefined,
  conversionRate: number | undefined,
  churnRate: number | undefined,
  concentrationRisk: GenomeCustomerSalesRiskLevel,
  missingInputs: string[],
): number {
  let score = 50;

  if (ltvCacRatio !== undefined) {
    if (ltvCacRatio >= 5) score += 30;
    else if (ltvCacRatio >= 3) score += 20;
    else if (ltvCacRatio >= 1) score += 10;
    else score -= 20;
  } else {
    score -= 10;
  }

  if (conversionRate !== undefined) {
    if (conversionRate >= 0.05) score += 20;
    else if (conversionRate >= 0.03) score += 10;
    else if (conversionRate >= 0.01) score += 5;
    else score -= 10;
  } else {
    score -= 10;
  }

  if (churnRate !== undefined) {
    if (churnRate > 0.2) score -= 20;
    else if (churnRate > 0.1) score -= 10;
  } else {
    score -= 5;
  }

  if (concentrationRisk === 'HIGH') score -= 20;
  else if (concentrationRisk === 'MEDIUM') score -= 10;

  score -= Math.min(missingInputs.length * 5, 25);

  return clamp(score, 0, 100);
}

@Injectable()
export class CustomerSalesGenomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financialMetrics: GenomeFinancialMetricService,
    private readonly segments: GenomeCustomerSegmentService,
    private readonly motions: GenomeSalesMotionService,
    private readonly signals: GenomeSignalService,
    @Inject(forwardRef(() => GenomeRecommendationService))
    @Inject(forwardRef(() => GenomeRecommendationService)) private readonly recommendations: GenomeRecommendationService,
    private readonly memory: GenomeMemoryService,
    @Inject(forwardRef(() => DepartmentReadinessService))
    @Inject(forwardRef(() => DepartmentReadinessService)) private readonly departmentReadiness: DepartmentReadinessService,
  ) {}

  async computeCustomerSalesSnapshot(
    businessId: string,
    period?: string,
  ): Promise<GenomeCustomerSalesSnapshotData> {
    const currency = 'TTD';

    const [metrics, segments, motions] = await Promise.all([
      this.financialMetrics.getLatestMetricsByType(businessId),
      this.segments.listSegments(businessId),
      this.motions.listMotions(businessId, { isActive: true }),
    ]);

    const revenue = toMetricNumber(metrics.REVENUE);
    const cac = toMetricNumber(metrics.CUSTOMER_ACQUISITION_COST) ?? weightedSegmentCac(segments);
    const ltv = toMetricNumber(metrics.LIFETIME_VALUE) ?? weightedSegmentLtv(segments);
    const aov = toMetricNumber(metrics.AVERAGE_ORDER_VALUE);
    const grossMargin = toMetricNumber(metrics.GROSS_MARGIN_PERCENT);

    const totalCustomers = segments.length > 0
      ? segments.reduce((sum, s) => sum + (s.estimatedSize ?? 0), 0)
      : undefined;

    const churnRate = weightedSegmentChurn(segments);
    const retentionRate = churnRate !== undefined ? clamp(1 - churnRate, 0, 1) : undefined;
    const conversionRate = weightedMotionConversion(motions);
    const averageRevenuePerCustomer =
      revenue !== undefined && totalCustomers !== undefined && totalCustomers > 0
        ? revenue / totalCustomers
        : undefined;
    const ltvCacRatio = ltv !== undefined && cac !== undefined && cac > 0 ? ltv / cac : undefined;

    const missingInputs: string[] = [];
    if (segments.length === 0) missingInputs.push('customer_segments');
    if (motions.length === 0) missingInputs.push('sales_motions');
    if (revenue === undefined) missingInputs.push('revenue');
    if (cac === undefined) missingInputs.push('customer_acquisition_cost');
    if (ltv === undefined) missingInputs.push('lifetime_value');
    if (conversionRate === undefined) missingInputs.push('conversion_rate');
    if (aov === undefined) missingInputs.push('average_order_value');
    if (grossMargin === undefined) missingInputs.push('gross_margin_percent');

    const warnings: GenomeCustomerSalesWarning[] = [];
    const recs: GenomeCustomerSalesRecommendation[] = [];

    const concRisk = revenueConcentrationRisk(segments);
    if (concRisk === 'HIGH' || concRisk === 'MEDIUM') {
      warnings.push({
        code: 'REVENUE_CONCENTRATION',
        message: 'Revenue is concentrated in a small number of customer segments.',
        severity: concRisk,
      });
      recs.push({
        title: 'Diversify customer base',
        reason: 'Revenue concentration increases vulnerability.',
        priority: concRisk === 'HIGH' ? 'HIGH' : 'MEDIUM',
        suggestedAction: 'Identify and develop additional customer segments.',
      });
    }

    const cacRiskLevel = cacRisk(cac, ltvCacRatio);
    if (cacRiskLevel === 'CRITICAL' || cacRiskLevel === 'HIGH' || cacRiskLevel === 'MEDIUM') {
      warnings.push({
        code: 'CAC_RISK',
        message: cacRiskLevel === 'CRITICAL'
          ? 'Customer acquisition cost exceeds lifetime value.'
          : 'Customer acquisition cost is high relative to lifetime value.',
        severity: cacRiskLevel,
      });
      recs.push({
        title: cacRiskLevel === 'CRITICAL' ? 'Fix unit economics urgently' : 'Improve CAC/LTV ratio',
        reason: 'Acquisition economics are unhealthy.',
        priority: cacRiskLevel === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
        suggestedAction: 'Reduce acquisition cost or increase lifetime value.',
      });
    }

    const ltvRiskLevel = ltvRisk(ltv, ltvCacRatio);
    if (ltvRiskLevel === 'CRITICAL' || ltvRiskLevel === 'HIGH' || ltvRiskLevel === 'MEDIUM') {
      warnings.push({
        code: 'LTV_RISK',
        message: 'Lifetime value is low relative to acquisition cost.',
        severity: ltvRiskLevel,
      });
      recs.push({
        title: 'Increase lifetime value',
        reason: 'LTV does not support sustainable growth.',
        priority: ltvRiskLevel === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
        suggestedAction: 'Design upsell, retention, and repeat-purchase programs.',
      });
    }

    const churnRiskLevel = churnRisk(churnRate);
    if (churnRiskLevel === 'HIGH' || churnRiskLevel === 'MEDIUM') {
      warnings.push({
        code: 'CHURN_RISK',
        message: `Customer churn is ${churnRiskLevel === 'HIGH' ? 'high' : 'elevated'}.`,
        severity: churnRiskLevel,
      });
      recs.push({
        title: 'Reduce churn',
        reason: 'Churn is eroding the customer base.',
        priority: churnRiskLevel,
        suggestedAction: 'Review at-risk segments and improve onboarding.',
      });
    }

    const convRisk = conversionRisk(conversionRate);
    if (convRisk === 'HIGH' || convRisk === 'MEDIUM') {
      warnings.push({
        code: 'CONVERSION_RISK',
        message: 'Sales conversion rate is below healthy benchmarks.',
        severity: convRisk,
      });
      recs.push({
        title: 'Improve sales conversion',
        reason: 'Conversion rate is weak.',
        priority: convRisk,
        suggestedAction: 'Audit funnel stages and test messaging.',
      });
    }

    if (missingInputs.length > 0) {
      recs.push({
        title: 'Record missing customer/sales inputs',
        reason: `Missing inputs: ${missingInputs.join(', ')}.`,
        priority: 'MEDIUM',
        suggestedAction: 'Add customer segments, sales motions, and financial metrics.',
      });
    }

    if (segments.length === 0) {
      recs.push({
        title: 'Define customer segments',
        reason: 'No customer segments are recorded.',
        priority: 'HIGH',
        suggestedAction: 'Create segments based on value, behavior, or channel.',
      });
    }

    if (motions.length === 0) {
      recs.push({
        title: 'Define sales motions',
        reason: 'No sales motions are recorded.',
        priority: 'HIGH',
        suggestedAction: 'Document inbound, outbound, referral, and partnership motions.',
      });
    }

    const revenueQualityScore = computeRevenueQualityScore(
      ltvCacRatio,
      conversionRate,
      churnRate,
      concRisk,
      missingInputs,
    );

    const overall = overallRisk([concRisk, cacRiskLevel, ltvRiskLevel, churnRiskLevel, convRisk]);

    const snapshotRow = await this.prisma.client.genomeCustomerSalesSnapshot.create({
      data: {
        businessId,
        period: period ?? null,
        currency,
        totalCustomers: totalCustomers ?? null,
        activeCustomers:
          totalCustomers !== undefined && retentionRate !== undefined
            ? totalCustomers * retentionRate
            : null,
        newCustomers: null,
        churnedCustomers:
          totalCustomers !== undefined && churnRate !== undefined ? totalCustomers * churnRate : null,
        retentionRate: retentionRate ?? null,
        conversionRate: conversionRate ?? null,
        averageRevenuePerCustomer: averageRevenuePerCustomer ?? null,
        lifetimeValue: ltv ?? null,
        customerAcquisitionCost: cac ?? null,
        ltvCacRatio: ltvCacRatio ?? null,
        revenueQualityScore,
        revenueConcentrationRisk: concRisk,
        cacRisk: cacRiskLevel,
        ltvRisk: ltvRiskLevel,
        churnRisk: churnRiskLevel,
        conversionRisk: convRisk,
        overallRisk: overall,
        missingInputs: asJsonValue(missingInputs),
        warnings: asJsonValue(warnings),
        recommendations: asJsonValue(recs),
        computedAt: new Date(),
      },
    });

    await this.memory.createMemoryEvent({
      businessId,
      sourceType: 'CUSTOMER_SALES_GENOME',
      eventType: 'CUSTOMER_SALES_SNAPSHOT_COMPUTED',
      domain: 'SALES',
      section: 'SALES',
      title: 'Customer/sales snapshot computed',
      summary: `Overall risk ${overall}, revenue quality ${revenueQualityScore.toFixed(0)}. ${warnings.length} warning(s), ${missingInputs.length} missing input(s).`,
      outcome: overall === 'CRITICAL' || overall === 'HIGH' ? 'MIXED' : 'SUCCESS',
      impactScore: revenueQualityScore / 100,
      confidenceDelta: 0,
      metadata: { period: period ?? null, revenueQualityScore, overallRisk: overall },
      occurredAt: new Date().toISOString(),
    });

    await Promise.all([
      this.departmentReadiness.computeOneDepartment(businessId, 'SALES'),
      this.departmentReadiness.computeOneDepartment(businessId, 'CUSTOMER_SUCCESS'),
      this.departmentReadiness.computeOneDepartment(businessId, 'PRODUCT_SERVICE'),
      this.departmentReadiness.computeOneDepartment(businessId, 'CMO_MARKETING'),
      this.departmentReadiness.computeOneDepartment(businessId, 'CFO_FINANCE'),
    ]);

    return this.toSnapshotDomain(snapshotRow);
  }

  async getLatestCustomerSalesSnapshot(
    businessId: string,
  ): Promise<GenomeCustomerSalesSnapshotData | null> {
    const row = await this.prisma.client.genomeCustomerSalesSnapshot.findFirst({
      where: { businessId },
      orderBy: { computedAt: 'desc' },
    });
    return row ? this.toSnapshotDomain(row) : null;
  }

  async listCustomerSalesSnapshots(
    businessId: string,
    filters: ListGenomeCustomerSalesSnapshotsQuery = {},
  ): Promise<GenomeCustomerSalesSnapshotData[]> {
    const rows = await this.prisma.client.genomeCustomerSalesSnapshot.findMany({
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

  async generateCustomerSalesSignals(businessId: string): Promise<import('./key-genome.types').GenomeSignalData[]> {
    const snapshot = await this.getLatestCustomerSalesSnapshot(businessId);
    if (!snapshot) {
      return [];
    }

    const inputs: CreateGenomeSignalInput[] = [];

    for (const warning of snapshot.warnings) {
      let signalType: string;
      switch (warning.code) {
        case 'CONVERSION_RISK':
          signalType = 'CUSTOMER_PATTERN';
          break;
        case 'REVENUE_CONCENTRATION':
          signalType = 'REVENUE_PATTERN';
          break;
        default:
          signalType = 'RISK_PATTERN';
      }

      inputs.push({
        businessId,
        sourceModule: 'crm',
        sourceEntityType: 'CUSTOMER_SALES_GENOME',
        signalType,
        section: 'SALES',
        domain: 'customer_sales',
        field: warning.code,
        reason: warning.message,
        confidence: warning.severity === 'CRITICAL' ? 0.95 : warning.severity === 'HIGH' ? 0.85 : 0.7,
      });
    }

    if (snapshot.missingInputs.length > 0) {
      inputs.push({
        businessId,
        sourceModule: 'crm',
        sourceEntityType: 'CUSTOMER_SALES_GENOME',
        signalType: 'MISSING_FACT',
        section: 'SALES',
        domain: 'customer_sales',
        field: 'missing_inputs',
        reason: `Missing customer/sales inputs: ${snapshot.missingInputs.join(', ')}`,
        confidence: 0.75,
      });
    }

    const signals = await this.signals.createSignals(inputs);

    if (signals.length > 0) {
      await this.memory.createMemoryEvent({
        businessId,
        sourceType: 'CUSTOMER_SALES_GENOME',
        eventType: 'CUSTOMER_SALES_SIGNAL_GENERATED',
        domain: 'SALES',
        section: 'SALES',
        title: 'Customer/sales signals generated',
        summary: `${signals.length} customer/sales signal(s) generated from latest snapshot.`,
        outcome: 'SUCCESS',
        impactScore: 0.5,
        confidenceDelta: 0,
        metadata: { count: signals.length },
        occurredAt: new Date().toISOString(),
      });
    }

    return signals;
  }

  async generateCustomerSalesRecommendations(
    businessId: string,
  ): Promise<import('./key-genome.types').GenomeRecommendationData[]> {
    const snapshot = await this.getLatestCustomerSalesSnapshot(businessId);
    if (!snapshot) {
      return [];
    }

    const created: Promise<import('./key-genome.types').GenomeRecommendationData>[] = [];
    for (const rec of snapshot.recommendations) {
      const input: CreateGenomeRecommendationInput = {
        businessId,
        domain: 'SALES',
        title: rec.title,
        insight: rec.reason,
        diagnosis: rec.reason,
        recommendation: rec.suggestedAction ?? rec.title,
        expectedGain: 'Improve customer/sales economics and reduce risk.',
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
        sourceType: 'CUSTOMER_SALES_GENOME',
        eventType: 'CUSTOMER_SALES_RECOMMENDATION_GENERATED',
        domain: 'SALES',
        section: 'SALES',
        title: 'Customer/sales recommendations generated',
        summary: `${recommendations.length} customer/sales recommendation(s) created.`,
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
    currency: string;
    totalCustomers: number | null;
    activeCustomers: number | null;
    newCustomers: number | null;
    churnedCustomers: number | null;
    retentionRate: number | null;
    conversionRate: number | null;
    averageRevenuePerCustomer: number | null;
    lifetimeValue: number | null;
    customerAcquisitionCost: number | null;
    ltvCacRatio: number | null;
    revenueQualityScore: number;
    revenueConcentrationRisk: string;
    cacRisk: string;
    ltvRisk: string;
    churnRisk: string;
    conversionRisk: string;
    overallRisk: string;
    missingInputs: unknown;
    warnings: unknown;
    recommendations: unknown;
    computedAt: Date;
  }): GenomeCustomerSalesSnapshotData {
    return {
      id: row.id,
      businessId: row.businessId,
      period: row.period ?? null,
      currency: row.currency,
      totalCustomers: row.totalCustomers ?? null,
      activeCustomers: row.activeCustomers ?? null,
      newCustomers: row.newCustomers ?? null,
      churnedCustomers: row.churnedCustomers ?? null,
      retentionRate: row.retentionRate ?? null,
      conversionRate: row.conversionRate ?? null,
      averageRevenuePerCustomer: row.averageRevenuePerCustomer ?? null,
      lifetimeValue: row.lifetimeValue ?? null,
      customerAcquisitionCost: row.customerAcquisitionCost ?? null,
      ltvCacRatio: row.ltvCacRatio ?? null,
      revenueQualityScore: row.revenueQualityScore,
      revenueConcentrationRisk: row.revenueConcentrationRisk as GenomeCustomerSalesSnapshotData['revenueConcentrationRisk'],
      cacRisk: row.cacRisk as GenomeCustomerSalesSnapshotData['cacRisk'],
      ltvRisk: row.ltvRisk as GenomeCustomerSalesSnapshotData['ltvRisk'],
      churnRisk: row.churnRisk as GenomeCustomerSalesSnapshotData['churnRisk'],
      conversionRisk: row.conversionRisk as GenomeCustomerSalesSnapshotData['conversionRisk'],
      overallRisk: row.overallRisk as GenomeCustomerSalesSnapshotData['overallRisk'],
      missingInputs: Array.isArray(row.missingInputs) ? (row.missingInputs as string[]) : [],
      warnings: Array.isArray(row.warnings) ? (row.warnings as GenomeCustomerSalesWarning[]) : [],
      recommendations: Array.isArray(row.recommendations)
        ? (row.recommendations as GenomeCustomerSalesRecommendation[])
        : [],
      computedAt: row.computedAt.toISOString(),
    };
  }
}
