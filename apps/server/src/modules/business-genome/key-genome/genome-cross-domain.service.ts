import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { FinanceGenomeService } from './finance-genome.service';
import { CustomerSalesGenomeService } from './customer-sales-genome.service';
import { OperationsGenomeService } from './operations-genome.service';
import { MarketingGenomeService } from './marketing-genome.service';
import { GenomeMemoryService } from './genome-memory.service';
import { GenomeDepartmentService } from './genome-department.service';
import type {
  GenomeCrossDomainBottleneck,
  GenomeCrossDomainDomainKey,
  GenomeCrossDomainDomainScore,
  GenomeCrossDomainOpportunity,
  GenomeCrossDomainRecommendedFocus,
  GenomeCrossDomainRiskLevel,
  GenomeCrossDomainSnapshotData,
  ListGenomeCrossDomainSnapshotsQuery,
} from './key-genome.types';

function asJsonValue<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function riskToScore(risk: GenomeCrossDomainRiskLevel): number {
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

function overallRisk(risks: GenomeCrossDomainRiskLevel[]): GenomeCrossDomainRiskLevel {
  if (risks.includes('CRITICAL')) return 'CRITICAL';
  if (risks.includes('HIGH')) return 'HIGH';
  if (risks.includes('MEDIUM')) return 'MEDIUM';
  if (risks.includes('LOW')) return 'LOW';
  return 'UNKNOWN';
}

function toCrossDomainRisk(risk: string | undefined | null): GenomeCrossDomainRiskLevel {
  if (risk === 'LOW' || risk === 'MEDIUM' || risk === 'HIGH' || risk === 'CRITICAL' || risk === 'UNKNOWN') {
    return risk;
  }
  return 'UNKNOWN';
}

const DOMAIN_KEYS: GenomeCrossDomainDomainKey[] = [
  'finance',
  'customer_sales_revenue',
  'operations_delivery',
  'marketing_growth',
];

@Injectable()
export class GenomeCrossDomainService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly financeGenome: FinanceGenomeService,
    private readonly customerSalesGenome: CustomerSalesGenomeService,
    private readonly operationsGenome: OperationsGenomeService,
    private readonly marketingGenome: MarketingGenomeService,
    private readonly memory: GenomeMemoryService,
    private readonly departments: GenomeDepartmentService,
  ) {}

  async computeCrossDomainSnapshot(
    businessId: string,
    period?: string,
  ): Promise<GenomeCrossDomainSnapshotData> {
    const [
      financeSnapshot,
      customerSalesSnapshot,
      operationsSnapshot,
      marketingSnapshot,
      departments,
      evidenceSummary,
    ] = await Promise.all([
      this.financeGenome.computeFinanceSnapshot(businessId, period).catch(() => null),
      this.customerSalesGenome.computeCustomerSalesSnapshot(businessId, period).catch(() => null),
      this.operationsGenome.computeOperationsSnapshot(businessId, period).catch(() => null),
      this.marketingGenome.computeMarketingGrowthSnapshot(businessId, period).catch(() => null),
      this.departments.listDepartments(businessId),
      this.loadEvidenceSummary(businessId),
    ]);

    const domainScores: GenomeCrossDomainDomainScore[] = [
      {
        domain: 'finance',
        healthScore: financeSnapshot?.healthScore ?? 0,
        riskLevel: toCrossDomainRisk(financeSnapshot?.overallRisk),
        snapshotId: financeSnapshot?.id ?? null,
        computedAt: financeSnapshot?.computedAt ?? null,
      },
      {
        domain: 'customer_sales_revenue',
        healthScore: customerSalesSnapshot?.revenueQualityScore ?? 0,
        riskLevel: toCrossDomainRisk(customerSalesSnapshot?.overallRisk),
        snapshotId: customerSalesSnapshot?.id ?? null,
        computedAt: customerSalesSnapshot?.computedAt ?? null,
      },
      {
        domain: 'operations_delivery',
        healthScore: operationsSnapshot?.deliveryReadinessScore ?? 0,
        riskLevel: toCrossDomainRisk(operationsSnapshot?.overallRisk),
        snapshotId: operationsSnapshot?.id ?? null,
        computedAt: operationsSnapshot?.computedAt ?? null,
      },
      {
        domain: 'marketing_growth',
        healthScore: marketingSnapshot
          ? Math.round(
              (marketingSnapshot.channelDiversificationScore + marketingSnapshot.contentConsistencyScore) / 2,
            )
          : 0,
        riskLevel: toCrossDomainRisk(marketingSnapshot?.overallRisk),
        snapshotId: marketingSnapshot?.id ?? null,
        computedAt: marketingSnapshot?.computedAt ?? null,
      },
    ];

    const domainRisks = Object.fromEntries(
      domainScores.map((d) => [d.domain, d.riskLevel]),
    ) as Record<GenomeCrossDomainDomainKey, GenomeCrossDomainRiskLevel>;

    const overallHealthScore =
      domainScores.length === 0
        ? 0
        : Math.round(domainScores.reduce((sum, d) => sum + d.healthScore, 0) / domainScores.length);

    const overallRiskLevel = overallRisk(domainScores.map((d) => d.riskLevel));

    const readinessSummary = this.buildReadinessSummary(departments);

    const bottlenecks = this.buildBottlenecks(
      financeSnapshot,
      customerSalesSnapshot,
      operationsSnapshot,
      marketingSnapshot,
    );

    const opportunities = this.buildOpportunities(
      financeSnapshot,
      customerSalesSnapshot,
      operationsSnapshot,
      marketingSnapshot,
    );

    const recommendedFocus = this.buildRecommendedFocus(bottlenecks, domainScores);

    const snapshotRow = await this.prisma.client.genomeCrossDomainSnapshot.create({
      data: {
        businessId,
        period: period ?? null,
        overallHealthScore,
        overallRiskLevel,
        domainScores: asJsonValue(domainScores),
        domainRisks: asJsonValue(domainRisks),
        readinessSummary: asJsonValue(readinessSummary),
        evidenceSummary: asJsonValue(evidenceSummary),
        bottlenecks: asJsonValue(bottlenecks),
        opportunities: asJsonValue(opportunities),
        recommendedFocus: asJsonValue(recommendedFocus),
        computedAt: new Date(),
      },
    });

    await this.memory.createMemoryEvent({
      businessId,
      sourceType: 'CROSS_DOMAIN_GENOME',
      eventType: 'CROSS_DOMAIN_SNAPSHOT_COMPUTED',
      domain: 'CROSS_DOMAIN',
      section: 'CROSS_DOMAIN',
      title: 'Cross-domain snapshot computed',
      summary: `Overall risk ${overallRiskLevel}, health score ${overallHealthScore}. ${bottlenecks.length} bottleneck(s), ${opportunities.length} opportunity(ies).`,
      outcome: overallRiskLevel === 'CRITICAL' || overallRiskLevel === 'HIGH' ? 'MIXED' : 'SUCCESS',
      impactScore: overallHealthScore / 100,
      confidenceDelta: 0,
      metadata: { period: period ?? null, overallHealthScore, overallRiskLevel },
      occurredAt: new Date().toISOString(),
    });

    return this.toSnapshotDomain(snapshotRow);
  }

  async getLatestCrossDomainSnapshot(
    businessId: string,
  ): Promise<GenomeCrossDomainSnapshotData | null> {
    const row = await this.prisma.client.genomeCrossDomainSnapshot.findFirst({
      where: { businessId },
      orderBy: { computedAt: 'desc' },
    });
    return row ? this.toSnapshotDomain(row) : null;
  }

  async listCrossDomainSnapshots(
    businessId: string,
    filters: ListGenomeCrossDomainSnapshotsQuery = {},
  ): Promise<GenomeCrossDomainSnapshotData[]> {
    const rows = await this.prisma.client.genomeCrossDomainSnapshot.findMany({
      where: {
        businessId,
        ...(filters.period !== undefined ? { period: filters.period } : {}),
        ...(filters.riskLevel ? { overallRiskLevel: filters.riskLevel } : {}),
      },
      orderBy: { computedAt: 'desc' },
      take: filters.limit,
    });
    return rows.map((r) => this.toSnapshotDomain(r));
  }

  private async loadEvidenceSummary(businessId: string): Promise<{
    totalFacts: number;
    highConfidenceFacts: number;
    totalEvidence: number;
    verifiedEvidence: number;
  }> {
    const [facts, evidence] = await Promise.all([
      this.prisma.client.genomeFact.findMany({
        where: { businessId },
        select: { confidenceScore: true, verificationStatus: true },
      }),
      this.prisma.client.genomeEvidence.findMany({
        where: { businessId },
        select: { evidenceStrength: true },
      }),
    ]);

    return {
      totalFacts: facts.length,
      highConfidenceFacts: facts.filter((f) => (f.confidenceScore ?? 0) >= 0.7).length,
      totalEvidence: evidence.length,
      verifiedEvidence: evidence.filter((e) => (e.evidenceStrength ?? 0) >= 0.7).length,
    };
  }

  private buildReadinessSummary(departments: { code: string; readinessScore: number; riskLevel: string }[]) {
    const readyDepartments = departments
      .filter((d) => (d.readinessScore ?? 0) >= 70)
      .map((d) => d.code)
      .slice(0, 10);
    const atRiskDepartments = departments
      .filter(
        (d) =>
          d.riskLevel === 'HIGH' ||
          d.riskLevel === 'CRITICAL' ||
          (d.readinessScore ?? 0) < 70,
      )
      .map((d) => d.code)
      .slice(0, 10);
    const averageReadinessScore =
      departments.length === 0
        ? 0
        : Math.round(departments.reduce((sum, d) => sum + (d.readinessScore ?? 0), 0) / departments.length);

    return {
      averageReadinessScore,
      departmentCount: departments.length,
      readyDepartments,
      atRiskDepartments,
    };
  }

  private buildBottlenecks(
    finance: import('./key-genome.types').GenomeFinanceSnapshotData | null,
    customerSales: import('./key-genome.types').GenomeCustomerSalesSnapshotData | null,
    operations: import('./key-genome.types').GenomeOperationsSnapshotData | null,
    marketing: import('./key-genome.types').GenomeMarketingGrowthSnapshotData | null,
  ): GenomeCrossDomainBottleneck[] {
    const bottlenecks: GenomeCrossDomainBottleneck[] = [];

    if (finance) {
      const criticalFinance = finance.warnings.filter(
        (w) => w.severity === 'CRITICAL' || w.severity === 'HIGH',
      );
      for (const warning of criticalFinance.slice(0, 2)) {
        bottlenecks.push({
          domain: 'finance',
          label: warning.code,
          severity: toCrossDomainRisk(warning.severity),
          reason: warning.message,
        });
      }
    }

    if (customerSales) {
      const criticalSales = customerSales.warnings.filter(
        (w) => w.severity === 'CRITICAL' || w.severity === 'HIGH',
      );
      for (const warning of criticalSales.slice(0, 2)) {
        bottlenecks.push({
          domain: 'customer_sales_revenue',
          label: warning.code,
          severity: toCrossDomainRisk(warning.severity),
          reason: warning.message,
        });
      }
    }

    if (operations) {
      const criticalOps = operations.warnings.filter(
        (w) => w.severity === 'CRITICAL' || w.severity === 'HIGH',
      );
      for (const warning of criticalOps.slice(0, 2)) {
        bottlenecks.push({
          domain: 'operations_delivery',
          label: warning.code,
          severity: toCrossDomainRisk(warning.severity),
          reason: warning.message,
        });
      }
    }

    if (marketing) {
      const criticalMarketing = marketing.warnings.filter(
        (w) => w.severity === 'CRITICAL' || w.severity === 'HIGH',
      );
      for (const warning of criticalMarketing.slice(0, 2)) {
        bottlenecks.push({
          domain: 'marketing_growth',
          label: warning.type,
          severity: toCrossDomainRisk(warning.severity),
          reason: warning.message,
        });
      }
    }

    return bottlenecks;
  }

  private buildOpportunities(
    finance: import('./key-genome.types').GenomeFinanceSnapshotData | null,
    customerSales: import('./key-genome.types').GenomeCustomerSalesSnapshotData | null,
    operations: import('./key-genome.types').GenomeOperationsSnapshotData | null,
    marketing: import('./key-genome.types').GenomeMarketingGrowthSnapshotData | null,
  ): GenomeCrossDomainOpportunity[] {
    const opportunities: GenomeCrossDomainOpportunity[] = [];

    if (finance && finance.healthScore >= 70) {
      opportunities.push({
        domain: 'finance',
        label: 'Reinvest healthy cash position',
        potentialImpact: 'HIGH',
        reason: 'Finance health score is strong; capital can fuel growth or operational upgrades.',
      });
    }

    if (customerSales && (customerSales.ltvCacRatio ?? 0) >= 5) {
      opportunities.push({
        domain: 'customer_sales_revenue',
        label: 'Scale high-LTV acquisition',
        potentialImpact: 'HIGH',
        reason: 'LTV/CAC ratio is healthy; increasing acquisition spend may be efficient.',
      });
    }

    if (operations && (operations.deliveryReadinessScore ?? 0) >= 70) {
      opportunities.push({
        domain: 'operations_delivery',
        label: 'Automate documented processes',
        potentialImpact: 'MEDIUM',
        reason: 'Operations readiness is high enough to safely introduce automation.',
      });
    }

    if (marketing && (marketing.channelDiversificationScore ?? 0) >= 70) {
      opportunities.push({
        domain: 'marketing_growth',
        label: 'Increase channel investment',
        potentialImpact: 'MEDIUM',
        reason: 'Channel mix is diversified; marketing can absorb additional budget.',
      });
    }

    return opportunities;
  }

  private buildRecommendedFocus(
    bottlenecks: GenomeCrossDomainBottleneck[],
    domainScores: GenomeCrossDomainDomainScore[],
  ): GenomeCrossDomainRecommendedFocus[] {
    const focus: GenomeCrossDomainRecommendedFocus[] = [];

    // Sort domains by health score ascending (worst first), breaking ties by risk severity.
    const sorted = [...domainScores].sort((a, b) => {
      const scoreDiff = a.healthScore - b.healthScore;
      if (scoreDiff !== 0) return scoreDiff;
      return riskToScore(a.riskLevel) - riskToScore(b.riskLevel);
    });

    for (const domain of sorted) {
      const domainBottlenecks = bottlenecks.filter((b) => b.domain === domain.domain);
      const label = domainBottlenecks.length > 0 ? domainBottlenecks[0].label : 'Improve domain readiness';
      const reason =
        domainBottlenecks.length > 0
          ? domainBottlenecks[0].reason ?? `${domain.domain} has active bottlenecks`
          : `${domain.domain} has the lowest health score in the current snapshot`;

      focus.push({
        domain: domain.domain,
        priority: focus.length + 1,
        label,
        reason,
      });
    }

    return focus;
  }

  private toSnapshotDomain(row: {
    id: string;
    businessId: string;
    period: string | null;
    overallHealthScore: number;
    overallRiskLevel: string;
    domainScores: unknown;
    domainRisks: unknown;
    readinessSummary: unknown;
    evidenceSummary: unknown;
    bottlenecks: unknown;
    opportunities: unknown;
    recommendedFocus: unknown;
    computedAt: Date;
  }): GenomeCrossDomainSnapshotData {
    const domainScores = Array.isArray(row.domainScores)
      ? (row.domainScores as GenomeCrossDomainDomainScore[])
      : [];

    const domainRisks =
      typeof row.domainRisks === 'object' && row.domainRisks !== null
        ? (row.domainRisks as Record<GenomeCrossDomainDomainKey, GenomeCrossDomainRiskLevel>)
        : (Object.fromEntries(DOMAIN_KEYS.map((k) => [k, 'UNKNOWN' as GenomeCrossDomainRiskLevel])) as Record<
            GenomeCrossDomainDomainKey,
            GenomeCrossDomainRiskLevel
          >);

    return {
      id: row.id,
      businessId: row.businessId,
      period: row.period ?? null,
      overallHealthScore: row.overallHealthScore,
      overallRiskLevel: toCrossDomainRisk(row.overallRiskLevel),
      domainScores,
      domainRisks,
      readinessSummary:
        typeof row.readinessSummary === 'object' && row.readinessSummary !== null
          ? (row.readinessSummary as GenomeCrossDomainSnapshotData['readinessSummary'])
          : { averageReadinessScore: 0, departmentCount: 0, readyDepartments: [], atRiskDepartments: [] },
      evidenceSummary:
        typeof row.evidenceSummary === 'object' && row.evidenceSummary !== null
          ? (row.evidenceSummary as GenomeCrossDomainSnapshotData['evidenceSummary'])
          : { totalFacts: 0, highConfidenceFacts: 0, totalEvidence: 0, verifiedEvidence: 0 },
      bottlenecks: Array.isArray(row.bottlenecks)
        ? (row.bottlenecks as GenomeCrossDomainBottleneck[])
        : [],
      opportunities: Array.isArray(row.opportunities)
        ? (row.opportunities as GenomeCrossDomainOpportunity[])
        : [],
      recommendedFocus: Array.isArray(row.recommendedFocus)
        ? (row.recommendedFocus as GenomeCrossDomainRecommendedFocus[])
        : [],
      computedAt: row.computedAt.toISOString(),
    };
  }
}
