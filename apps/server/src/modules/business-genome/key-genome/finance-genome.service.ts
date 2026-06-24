import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { GenomeFactService } from './genome-fact.service';

import { GenomeSignalService } from './genome-signal.service';
import { GenomeRecommendationService } from './genome-recommendation.service';
import { GenomeMemoryService } from './genome-memory.service';

import { DepartmentReadinessService } from './department-readiness.service';
import type {
  CreateGenomeRecommendationInput,
  CreateGenomeSignalInput,
  GenomeFinanceRecommendation,
  GenomeFinanceRiskLevel,
  GenomeFinanceSnapshotData,
  GenomeFinanceWarning,
  GenomeFinancialMetricData,
  ListGenomeFinanceSnapshotsQuery,
  UpsertGenomeFinancialMetricInput,
} from './key-genome.types';
import { GenomeFinancialMetricService } from './genome-financial-metric.service';

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

function toRiskScore(risk: GenomeFinanceRiskLevel): number {
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

function computeRunway(
  cashOnHand?: number,
  monthlyExpenses?: number,
): { value?: number; risk: GenomeFinanceRiskLevel } {
  if (cashOnHand === undefined || monthlyExpenses === undefined || monthlyExpenses <= 0) {
    return { risk: 'UNKNOWN' };
  }
  const runway = cashOnHand / monthlyExpenses;
  let risk: GenomeFinanceRiskLevel;
  if (runway < 1) risk = 'CRITICAL';
  else if (runway <= 3) risk = 'HIGH';
  else if (runway <= 6) risk = 'MEDIUM';
  else risk = 'LOW';
  return { value: runway, risk };
}

function computeMarginPercent(numerator?: number, denominator?: number): number | undefined {
  if (numerator === undefined || denominator === undefined || denominator === 0) {
    return undefined;
  }
  return (numerator / denominator) * 100;
}

function marginRisk(netMarginPercent?: number): GenomeFinanceRiskLevel {
  if (netMarginPercent === undefined) return 'UNKNOWN';
  if (netMarginPercent < 0) return 'CRITICAL';
  if (netMarginPercent <= 10) return 'MEDIUM';
  return 'LOW';
}

function grossMarginRisk(grossMarginPercent?: number): GenomeFinanceRiskLevel {
  if (grossMarginPercent === undefined) return 'UNKNOWN';
  if (grossMarginPercent < 0) return 'CRITICAL';
  if (grossMarginPercent <= 20) return 'HIGH';
  if (grossMarginPercent <= 40) return 'MEDIUM';
  return 'LOW';
}

function cashFlowRisk(runwayRisk: GenomeFinanceRiskLevel, payableRisk: GenomeFinanceRiskLevel): GenomeFinanceRiskLevel {
  if (runwayRisk === 'CRITICAL' || payableRisk === 'CRITICAL') return 'CRITICAL';
  if (runwayRisk === 'HIGH' || payableRisk === 'HIGH') return 'HIGH';
  if (runwayRisk === 'MEDIUM' || payableRisk === 'MEDIUM') return 'MEDIUM';
  if (runwayRisk === 'LOW' && payableRisk === 'LOW') return 'LOW';
  return 'UNKNOWN';
}

function receivablesRisk(accountsReceivable?: number, revenue?: number): GenomeFinanceRiskLevel {
  if (accountsReceivable === undefined || revenue === undefined || revenue <= 0) return 'UNKNOWN';
  const ratio = accountsReceivable / revenue;
  if (ratio > 1.5) return 'HIGH';
  if (ratio > 0.75) return 'MEDIUM';
  return 'LOW';
}

function payablesRisk(accountsPayable?: number, cashOnHand?: number): GenomeFinanceRiskLevel {
  if (accountsPayable === undefined || cashOnHand === undefined) return 'UNKNOWN';
  if (cashOnHand <= 0) return accountsPayable > 0 ? 'CRITICAL' : 'UNKNOWN';
  const ratio = accountsPayable / cashOnHand;
  if (ratio > 1) return 'HIGH';
  if (ratio > 0.5) return 'MEDIUM';
  return 'LOW';
}

function taxReserveRisk(taxReserve?: number, revenue?: number): GenomeFinanceRiskLevel {
  if (taxReserve === undefined) return 'MEDIUM';
  if (revenue === undefined || revenue <= 0) return 'UNKNOWN';
  if (taxReserve === 0) return 'HIGH';
  const ratio = taxReserve / revenue;
  if (ratio < 0.05) return 'HIGH';
  if (ratio < 0.1) return 'MEDIUM';
  return 'LOW';
}

function pricingRisk(averageTicket?: number, costStructure?: string): GenomeFinanceRiskLevel {
  if (averageTicket === undefined) return 'UNKNOWN';
  if (!costStructure || costStructure.trim().length === 0) return 'MEDIUM';
  if (averageTicket <= 0) return 'CRITICAL';
  return 'LOW';
}

function overallRisk(risks: GenomeFinanceRiskLevel[]): GenomeFinanceRiskLevel {
  if (risks.includes('CRITICAL')) return 'CRITICAL';
  if (risks.includes('HIGH')) return 'HIGH';
  if (risks.includes('MEDIUM')) return 'MEDIUM';
  if (risks.includes('LOW')) return 'LOW';
  return 'UNKNOWN';
}

@Injectable()
export class FinanceGenomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metricService: GenomeFinancialMetricService,
    private readonly factService: GenomeFactService,
    private readonly signals: GenomeSignalService,
    private readonly recommendations: GenomeRecommendationService,
    private readonly memory: GenomeMemoryService,
    private readonly departmentReadiness: DepartmentReadinessService,
  ) {}

  async computeFinanceSnapshot(
    businessId: string,
    period?: string,
  ): Promise<GenomeFinanceSnapshotData> {
    const metrics = await this.metricService.getLatestMetricsByType(businessId);
    const currency = 'TTD';

    const revenue = toMetricNumber(metrics.REVENUE);
    const grossProfit = toMetricNumber(metrics.GROSS_PROFIT);
    const netProfit = toMetricNumber(metrics.NET_PROFIT);
    const monthlyExpenses = toMetricNumber(metrics.MONTHLY_EXPENSE);
    const cashOnHand = toMetricNumber(metrics.CASH_ON_HAND);
    const accountsReceivable = toMetricNumber(metrics.ACCOUNTS_RECEIVABLE);
    const accountsPayable = toMetricNumber(metrics.ACCOUNTS_PAYABLE);
    const taxReserve = toMetricNumber(metrics.TAX_RESERVE);
    const averageTicket = toMetricNumber(metrics.AVERAGE_ORDER_VALUE);

    const [currencyFact, costStructureFact, avgTicketFact, reservePolicyFact] = await Promise.all([
      this.factService.getFact(businessId, 'FINANCIAL', 'finance', 'currency'),
      this.factService.getFact(businessId, 'FINANCIAL', 'finance', 'cost_structure'),
      this.factService.getFact(businessId, 'FINANCIAL', 'finance', 'avg_ticket'),
      this.factService.getFact(businessId, 'FINANCIAL', 'finance', 'reserve_policy'),
    ]);

    const costStructureValue =
      typeof costStructureFact?.value.raw === 'string' ? costStructureFact.value.raw : undefined;
    const factAvgTicket =
      typeof avgTicketFact?.value.raw === 'number'
        ? avgTicketFact.value.raw
        : typeof avgTicketFact?.value.raw === 'string'
          ? Number(avgTicketFact.value.raw)
          : undefined;

    const finalAverageTicket = averageTicket ?? factAvgTicket;

    const missingInputs: string[] = [];
    if (revenue === undefined) missingInputs.push('revenue');
    if (monthlyExpenses === undefined) missingInputs.push('monthly_expenses');
    if (cashOnHand === undefined) missingInputs.push('cash_on_hand');
    if (!currencyFact) missingInputs.push('finance.currency');
    if (!costStructureFact) missingInputs.push('finance.cost_structure');
    if (finalAverageTicket === undefined) missingInputs.push('average_ticket');

    const warnings: GenomeFinanceWarning[] = [];
    const recs: GenomeFinanceRecommendation[] = [];

    const runway = computeRunway(cashOnHand, monthlyExpenses);
    if (runway.risk === 'CRITICAL') {
      warnings.push({ code: 'LOW_RUNWAY', message: `Runway is ${runway.value?.toFixed(1)} months — critically low.`, severity: 'CRITICAL' });
      recs.push({ title: 'Reduce monthly burn or increase cash reserves', reason: 'Runway is below one month.', priority: 'CRITICAL', suggestedAction: 'Review non-essential expenses and accelerate receivables.' });
    } else if (runway.risk === 'HIGH') {
      warnings.push({ code: 'LOW_RUNWAY', message: `Runway is ${runway.value?.toFixed(1)} months — below three months.`, severity: 'HIGH' });
      recs.push({ title: 'Build cash runway', reason: 'Runway is below three months.', priority: 'HIGH', suggestedAction: 'Create a 90-day cash-flow forecast.' });
    }

    const grossMarginPercent = computeMarginPercent(grossProfit, revenue);
    const netMarginPercent = computeMarginPercent(netProfit, revenue);

    const grossRisk = grossMarginRisk(grossMarginPercent);
    if (grossRisk === 'HIGH' || grossRisk === 'CRITICAL') {
      warnings.push({ code: 'LOW_GROSS_MARGIN', message: `Gross margin is ${grossMarginPercent?.toFixed(1)}%.`, severity: grossRisk });
      recs.push({ title: 'Review cost structure and pricing', reason: 'Gross margin is unhealthy.', priority: grossRisk === 'CRITICAL' ? 'CRITICAL' : 'HIGH', suggestedAction: 'Audit direct costs and consider pricing adjustments.' });
    }

    const netRisk = marginRisk(netMarginPercent);
    if (netRisk === 'CRITICAL') {
      warnings.push({ code: 'NEGATIVE_NET_MARGIN', message: `Net margin is negative (${netMarginPercent?.toFixed(1)}%).`, severity: 'CRITICAL' });
      recs.push({ title: 'Address negative net margin', reason: 'Business is losing money on each dollar of revenue.', priority: 'CRITICAL', suggestedAction: 'Reduce overhead or improve unit economics.' });
    } else if (netRisk === 'MEDIUM') {
      warnings.push({ code: 'LOW_NET_MARGIN', message: `Net margin is ${netMarginPercent?.toFixed(1)}% — below 10%.`, severity: 'MEDIUM' });
      recs.push({ title: 'Improve net margin', reason: 'Net margin is below healthy thresholds.', priority: 'MEDIUM', suggestedAction: 'Identify highest-contribution offers and cut low-value spend.' });
    }

    const cfRisk = cashFlowRisk(runway.risk, payablesRisk(accountsPayable, cashOnHand));
    if (cfRisk === 'HIGH' || cfRisk === 'CRITICAL') {
      warnings.push({ code: 'CASH_FLOW_RISK', message: 'Cash flow position is at risk.', severity: cfRisk });
      recs.push({ title: 'Create cash-flow forecast', reason: 'Cash flow risk detected.', priority: cfRisk === 'CRITICAL' ? 'CRITICAL' : 'HIGH', suggestedAction: 'Model next 90 days of inflows and outflows.' });
    }

    const arRisk = receivablesRisk(accountsReceivable, revenue);
    if (arRisk === 'HIGH' || arRisk === 'MEDIUM') {
      warnings.push({ code: 'RECEIVABLES_RISK', message: 'Accounts receivable are elevated relative to revenue.', severity: arRisk });
      recs.push({ title: 'Follow up receivables', reason: 'Outstanding receivables may strain cash flow.', priority: arRisk, suggestedAction: 'Send payment reminders and tighten payment terms.' });
    }

    const taxRisk = taxReserveRisk(taxReserve, revenue);
    if (taxRisk === 'HIGH' || taxRisk === 'MEDIUM') {
      warnings.push({ code: 'TAX_RESERVE_RISK', message: 'Tax reserve is insufficient for current revenue.', severity: taxRisk });
      recs.push({ title: 'Set minimum tax reserve', reason: 'Tax reserve is too low.', priority: taxRisk, suggestedAction: 'Allocate a percentage of revenue to tax reserves monthly.' });
    }

    const priceRisk = pricingRisk(finalAverageTicket, costStructureValue);
    if (priceRisk === 'CRITICAL' || priceRisk === 'MEDIUM') {
      warnings.push({ code: 'PRICING_RISK', message: priceRisk === 'CRITICAL' ? 'Average ticket is zero or negative.' : 'Pricing model or cost structure is undefined.', severity: priceRisk });
      recs.push({ title: 'Validate pricing model', reason: 'Pricing health cannot be confirmed.', priority: priceRisk === 'CRITICAL' ? 'CRITICAL' : 'MEDIUM', suggestedAction: 'Document cost structure and average ticket.' });
    }

    if (missingInputs.length > 0) {
      recs.push({ title: 'Increase financial fact confidence', reason: `Missing inputs: ${missingInputs.join(', ')}.`, priority: 'MEDIUM', suggestedAction: 'Record missing finance metrics and verify financial facts.' });
    }

    if (!reservePolicyFact) {
      recs.push({ title: 'Define reserve policy', reason: 'No reserve policy fact is recorded.', priority: 'LOW', suggestedAction: 'Document target cash reserve and reinvestment rules.' });
    }

    const marginComponent = toRiskScore(grossRisk) * 0.15 + toRiskScore(netRisk) * 0.15;
    const cashFlowComponent = toRiskScore(cfRisk) * 0.35;
    const revenueComponent = revenue !== undefined && revenue > 0 ? 80 : 40;
    const taxComponent = toRiskScore(taxRisk) * 0.1;
    const confidenceComponent = missingInputs.length === 0 ? 90 : Math.max(30, 90 - missingInputs.length * 10);

    const healthScore = clamp(
      cashFlowComponent +
        marginComponent +
        revenueComponent * 0.15 +
        taxComponent +
        confidenceComponent * 0.1,
      0,
      100,
    );

    const overall = overallRisk([runway.risk, grossRisk, netRisk, cfRisk, arRisk, taxRisk, priceRisk]);

    const snapshotRow = await this.prisma.client.genomeFinanceSnapshot.create({
      data: {
        businessId,
        period: period ?? null,
        currency,
        revenue: revenue ?? null,
        grossProfit: grossProfit ?? null,
        netProfit: netProfit ?? null,
        monthlyExpenses: monthlyExpenses ?? null,
        cashOnHand: cashOnHand ?? null,
        accountsReceivable: accountsReceivable ?? null,
        accountsPayable: accountsPayable ?? null,
        taxReserve: taxReserve ?? null,
        grossMarginPercent: grossMarginPercent ?? null,
        netMarginPercent: netMarginPercent ?? null,
        runwayMonths: runway.value ?? null,
        averageTicket: finalAverageTicket ?? null,
        healthScore,
        cashFlowRisk: cfRisk,
        marginRisk: netRisk,
        pricingRisk: priceRisk,
        taxRisk,
        overallRisk: overall,
        missingInputs: asJsonValue(missingInputs),
        warnings: asJsonValue(warnings),
        recommendations: asJsonValue(recs),
        computedAt: new Date(),
      },
    });

    await this.memory.createMemoryEvent({
      businessId,
      sourceType: 'FINANCE_GENOME',
      eventType: 'FINANCE_SNAPSHOT_COMPUTED',
      domain: 'FINANCIAL',
      section: 'FINANCIAL',
      title: 'Finance snapshot computed',
      summary: `Overall risk ${overall}, health score ${healthScore.toFixed(0)}. ${warnings.length} warning(s), ${missingInputs.length} missing input(s).`,
      outcome: overall === 'CRITICAL' || overall === 'HIGH' ? 'MIXED' : 'SUCCESS',
      impactScore: healthScore / 100,
      confidenceDelta: 0,
      metadata: { period: period ?? null, healthScore, overallRisk: overall },
      occurredAt: new Date().toISOString(),
    });

    await this.departmentReadiness.computeOneDepartment(businessId, 'CFO_FINANCE');

    return this.toSnapshotDomain(snapshotRow);
  }

  async getLatestFinanceSnapshot(businessId: string): Promise<GenomeFinanceSnapshotData | null> {
    const row = await this.prisma.client.genomeFinanceSnapshot.findFirst({
      where: { businessId },
      orderBy: { computedAt: 'desc' },
    });
    return row ? this.toSnapshotDomain(row) : null;
  }

  async listFinanceSnapshots(
    businessId: string,
    filters: ListGenomeFinanceSnapshotsQuery = {},
  ): Promise<GenomeFinanceSnapshotData[]> {
    const rows = await this.prisma.client.genomeFinanceSnapshot.findMany({
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

  async generateFinanceSignals(businessId: string): Promise<import('./key-genome.types').GenomeSignalData[]> {
    const snapshot = await this.getLatestFinanceSnapshot(businessId);
    if (!snapshot) {
      return [];
    }

    const inputs: CreateGenomeSignalInput[] = [];

    for (const warning of snapshot.warnings) {
      let signalType: string;
      switch (warning.code) {
        case 'MISSING_FINANCE_METRIC':
          signalType = 'MISSING_FACT';
          break;
        case 'PRICING_RISK':
          signalType = 'REVENUE_PATTERN';
          break;
        default:
          signalType = 'RISK_PATTERN';
      }

      inputs.push({
        businessId,
        sourceModule: 'finance',
        sourceEntityType: 'FINANCE_GENOME',
        signalType,
        section: 'FINANCIAL',
        domain: 'finance',
        field: warning.code,
        reason: warning.message,
        confidence: warning.severity === 'CRITICAL' ? 0.95 : warning.severity === 'HIGH' ? 0.85 : 0.7,
      });
    }

    const signals = await this.signals.createSignals(inputs);

    if (signals.length > 0) {
      await this.memory.createMemoryEvent({
        businessId,
        sourceType: 'FINANCE_GENOME',
        eventType: 'FINANCE_SIGNAL_GENERATED',
        domain: 'FINANCIAL',
        section: 'FINANCIAL',
        title: 'Finance signals generated',
        summary: `${signals.length} finance signal(s) generated from latest snapshot.`,
        outcome: 'SUCCESS',
        impactScore: 0.5,
        confidenceDelta: 0,
        metadata: { count: signals.length },
        occurredAt: new Date().toISOString(),
      });
    }

    return signals;
  }

  async generateFinanceRecommendations(
    businessId: string,
  ): Promise<import('./key-genome.types').GenomeRecommendationData[]> {
    const snapshot = await this.getLatestFinanceSnapshot(businessId);
    if (!snapshot) {
      return [];
    }

    const created: Promise<import('./key-genome.types').GenomeRecommendationData>[] = [];
    for (const rec of snapshot.recommendations) {
      const input: CreateGenomeRecommendationInput = {
        businessId,
        domain: 'FINANCIAL',
        title: rec.title,
        insight: rec.reason,
        diagnosis: rec.reason,
        recommendation: rec.suggestedAction ?? rec.title,
        expectedGain: 'Improve financial health and reduce risk.',
        expectedGainScore: rec.priority === 'CRITICAL' ? 90 : rec.priority === 'HIGH' ? 70 : rec.priority === 'MEDIUM' ? 50 : 30,
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
        sourceType: 'FINANCE_GENOME',
        eventType: 'FINANCE_RECOMMENDATION_GENERATED',
        domain: 'FINANCIAL',
        section: 'FINANCIAL',
        title: 'Finance recommendations generated',
        summary: `${recommendations.length} finance recommendation(s) created.`,
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
    revenue: number | null;
    grossProfit: number | null;
    netProfit: number | null;
    monthlyExpenses: number | null;
    cashOnHand: number | null;
    accountsReceivable: number | null;
    accountsPayable: number | null;
    taxReserve: number | null;
    grossMarginPercent: number | null;
    netMarginPercent: number | null;
    runwayMonths: number | null;
    averageTicket: number | null;
    healthScore: number;
    cashFlowRisk: string;
    marginRisk: string;
    pricingRisk: string;
    taxRisk: string;
    overallRisk: string;
    missingInputs: unknown;
    warnings: unknown;
    recommendations: unknown;
    computedAt: Date;
  }): GenomeFinanceSnapshotData {
    return {
      id: row.id,
      businessId: row.businessId,
      period: row.period ?? null,
      currency: row.currency,
      revenue: row.revenue ?? null,
      grossProfit: row.grossProfit ?? null,
      netProfit: row.netProfit ?? null,
      monthlyExpenses: row.monthlyExpenses ?? null,
      cashOnHand: row.cashOnHand ?? null,
      accountsReceivable: row.accountsReceivable ?? null,
      accountsPayable: row.accountsPayable ?? null,
      taxReserve: row.taxReserve ?? null,
      grossMarginPercent: row.grossMarginPercent ?? null,
      netMarginPercent: row.netMarginPercent ?? null,
      runwayMonths: row.runwayMonths ?? null,
      averageTicket: row.averageTicket ?? null,
      healthScore: row.healthScore,
      cashFlowRisk: row.cashFlowRisk as GenomeFinanceSnapshotData['cashFlowRisk'],
      marginRisk: row.marginRisk as GenomeFinanceSnapshotData['marginRisk'],
      pricingRisk: row.pricingRisk as GenomeFinanceSnapshotData['pricingRisk'],
      taxRisk: row.taxRisk as GenomeFinanceSnapshotData['taxRisk'],
      overallRisk: row.overallRisk as GenomeFinanceSnapshotData['overallRisk'],
      missingInputs: Array.isArray(row.missingInputs) ? (row.missingInputs as string[]) : [],
      warnings: Array.isArray(row.warnings) ? (row.warnings as GenomeFinanceWarning[]) : [],
      recommendations: Array.isArray(row.recommendations) ? (row.recommendations as GenomeFinanceRecommendation[]) : [],
      computedAt: row.computedAt.toISOString(),
    };
  }
}
