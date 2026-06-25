/**
 * Genome Context Assembler
 *
 * The eyes and ears of KEY Cortex. This service reads EVERY piece of
 * genome data — facts, snapshots, recommendations, memory, departments —
 * and assembles it into a structured context payload that the AI can
 * reason over.
 *
 * Think of it as JARVIS reading the entire Iron Man suit diagnostics
 * before giving Tony advice.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import type {
  GenomeContextSnapshot,
  BusinessContext,
  GenomeScoreContext,
  GenomeAutonomyContext,
  CortexConfig,
  DEFAULT_CORTEX_CONFIG,
} from './key-cortex.types';
import type {
  GenomeFactData,
  GenomeRecommendationData,
  GenomeFinanceSnapshotData,
  GenomeCustomerSalesSnapshotData,
  GenomeOperationsSnapshotData,
  GenomeMarketingGrowthSnapshotData,
  GenomeCrossDomainSnapshotData,
  GenomeMemoryEventData,
  GenomeDepartmentData,
} from '../business-genome/key-genome/key-genome.types';

@Injectable()
export class GenomeContextAssembler {
  private readonly logger = new Logger(GenomeContextAssembler.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Assemble the complete business genome context for AI reasoning.
   * This is the master method — it pulls everything.
   */
  async assemble(businessId: string, _config: CortexConfig = DEFAULT_CORTEX_CONFIG): Promise<GenomeContextSnapshot> {
    const startTime = Date.now();

    const [
      business,
      financeSnapshot,
      salesSnapshot,
      operationsSnapshot,
      marketingSnapshot,
      crossDomainSnapshot,
      facts,
      recommendations,
      memoryEvents,
      departments,
    ] = await Promise.all([
      this.loadBusiness(businessId),
      this.loadLatestFinanceSnapshot(businessId),
      this.loadLatestSalesSnapshot(businessId),
      this.loadLatestOperationsSnapshot(businessId),
      this.loadLatestMarketingSnapshot(businessId),
      this.loadLatestCrossDomainSnapshot(businessId),
      this.loadKeyFacts(businessId, 50),
      this.loadActiveRecommendations(businessId, 10),
      this.loadRecentMemory(businessId, 20),
      this.loadDepartments(businessId),
    ]);

    const genomeScore = this.computeGenomeScore(financeSnapshot, salesSnapshot, operationsSnapshot, marketingSnapshot, crossDomainSnapshot);
    const autonomyGate = this.computeAutonomyContext(crossDomainSnapshot, departments);
    const dataFreshness = this.computeDataFreshness(financeSnapshot, salesSnapshot, operationsSnapshot, marketingSnapshot);

    const snapshot: GenomeContextSnapshot = {
      business,
      genomeScore,
      finance: financeSnapshot,
      sales: salesSnapshot,
      operations: operationsSnapshot,
      marketing: marketingSnapshot,
      crossDomain: crossDomainSnapshot,
      facts,
      recommendations,
      memory: memoryEvents,
      departments,
      autonomyGate,
      assembledAt: new Date().toISOString(),
      dataFreshness,
    };

    this.logger.log(
      `Genome context assembled for ${businessId} in ${Date.now() - startTime}ms ` +
      `(${facts.length} facts, ${recommendations.length} recommendations, ` +
      `${memoryEvents.length} memory events)`
    );

    return snapshot;
  }

  /**
   * Assemble a minimal context for fast responses (e.g., greetings, simple questions).
   */
  async assembleMinimal(businessId: string): Promise<GenomeContextSnapshot> {
    const [
      business,
      crossDomainSnapshot,
      recommendations,
    ] = await Promise.all([
      this.loadBusiness(businessId),
      this.loadLatestCrossDomainSnapshot(businessId),
      this.loadActiveRecommendations(businessId, 5),
    ]);

    const genomeScore = this.computeGenomeScore(null, null, null, null, crossDomainSnapshot);

    return {
      business,
      genomeScore,
      finance: null,
      sales: null,
      operations: null,
      marketing: null,
      crossDomain: crossDomainSnapshot,
      facts: [],
      recommendations,
      memory: [],
      departments: [],
      autonomyGate: { automationAllowed: false, blockedDomains: [], overallRisk: 'MEDIUM', topBlockingReasons: [] },
      assembledAt: new Date().toISOString(),
      dataFreshness: 'FRESH',
    };
  }

  /**
   * Format the genome context as a structured system prompt for the AI.
   * This is the secret sauce — it transforms raw data into AI-usable context.
   */
  formatAsSystemPrompt(snapshot: GenomeContextSnapshot, personality: string): string {
    const sections: string[] = [];

    // ── Personality Header ──
    sections.push(this.formatPersonalityHeader(personality));

    // ── Business Identity ──
    sections.push(this.formatBusinessIdentity(snapshot.business));

    // ── Genome Health Score ──
    sections.push(this.formatGenomeScore(snapshot.genomeScore));

    // ── Cross-Domain Health ──
    if (snapshot.crossDomain) {
      sections.push(this.formatCrossDomain(snapshot.crossDomain));
    }

    // ── Financial Snapshot ──
    if (snapshot.finance) {
      sections.push(this.formatFinanceSnapshot(snapshot.finance));
    }

    // ── Sales / Customer Snapshot ──
    if (snapshot.sales) {
      sections.push(this.formatSalesSnapshot(snapshot.sales));
    }

    // ── Operations Snapshot ──
    if (snapshot.operations) {
      sections.push(this.formatOperationsSnapshot(snapshot.operations));
    }

    // ── Marketing Snapshot ──
    if (snapshot.marketing) {
      sections.push(this.formatMarketingSnapshot(snapshot.marketing));
    }

    // ── Key Facts ──
    if (snapshot.facts.length > 0) {
      sections.push(this.formatKeyFacts(snapshot.facts));
    }

    // ── Active Recommendations ──
    if (snapshot.recommendations.length > 0) {
      sections.push(this.formatRecommendations(snapshot.recommendations));
    }

    // ── Recent Memory ──
    if (snapshot.memory.length > 0) {
      sections.push(this.formatMemoryEvents(snapshot.memory));
    }

    // ── Department Status ──
    if (snapshot.departments.length > 0) {
      sections.push(this.formatDepartments(snapshot.departments));
    }

    // ── Autonomy Status ──
    sections.push(this.formatAutonomyStatus(snapshot.autonomyGate));

    // ── Response Rules ──
    sections.push(this.formatResponseRules());

    return sections.join('\n\n---\n\n');
  }

  // ── Private Loaders ──

  private async loadBusiness(businessId: string): Promise<BusinessContext> {
    const row = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        name: true,
        industry: true,
        currency: true,
        timezone: true,
        stage: true,
        employeeCount: true,
        annualRevenue: true,
        foundedAt: true,
      },
    });

    return {
      id: row?.id ?? businessId,
      name: row?.name ?? 'Unknown Business',
      industry: row?.industry ?? null,
      currency: row?.currency ?? 'USD',
      timezone: row?.timezone ?? 'UTC',
      stage: row?.stage ?? null,
      employees: row?.employeeCount ?? null,
      annualRevenue: row?.annualRevenue ?? null,
      foundedAt: row?.foundedAt ?? null,
    };
  }

  private async loadLatestFinanceSnapshot(businessId: string): Promise<GenomeFinanceSnapshotData | null> {
    const row = await this.prisma.client.genomeFinanceSnapshot.findFirst({
      where: { businessId },
      orderBy: { computedAt: 'desc' },
    });
    return row ? this.serializeFinanceSnapshot(row) : null;
  }

  private async loadLatestSalesSnapshot(businessId: string): Promise<GenomeCustomerSalesSnapshotData | null> {
    const row = await this.prisma.client.genomeCustomerSalesSnapshot.findFirst({
      where: { businessId },
      orderBy: { computedAt: 'desc' },
    });
    return row ? this.serializeSalesSnapshot(row) : null;
  }

  private async loadLatestOperationsSnapshot(businessId: string): Promise<GenomeOperationsSnapshotData | null> {
    const row = await this.prisma.client.genomeOperationsSnapshot.findFirst({
      where: { businessId },
      orderBy: { computedAt: 'desc' },
    });
    return row ? this.serializeOperationsSnapshot(row) : null;
  }

  private async loadLatestMarketingSnapshot(businessId: string): Promise<GenomeMarketingGrowthSnapshotData | null> {
    const row = await this.prisma.client.genomeMarketingGrowthSnapshot.findFirst({
      where: { businessId },
      orderBy: { computedAt: 'desc' },
    });
    return row ? this.serializeMarketingSnapshot(row) : null;
  }

  private async loadLatestCrossDomainSnapshot(businessId: string): Promise<GenomeCrossDomainSnapshotData | null> {
    const row = await this.prisma.client.genomeCrossDomainSnapshot.findFirst({
      where: { businessId },
      orderBy: { computedAt: 'desc' },
    });
    return row ? this.serializeCrossDomainSnapshot(row) : null;
  }

  private async loadKeyFacts(businessId: string, limit: number): Promise<GenomeFactData[]> {
    const rows = await this.prisma.client.genomeFact.findMany({
      where: { businessId },
      orderBy: [
        { score: { overall: 'desc' } },
        { updatedAt: 'desc' },
      ],
      take: limit,
      include: { evidence: { take: 2, orderBy: { evidenceStrength: 'desc' } } },
    });

    return rows.map((row: any) => ({
      id: row.id,
      businessId: row.businessId,
      section: row.section,
      domain: row.domain,
      field: row.field,
      value: row.value as { raw: unknown; type: string },
      sourceModule: row.sourceModule,
      sourceType: row.sourceType,
      sourceEntityType: row.sourceEntityType,
      sourceEntityId: row.sourceEntityId,
      score: row.score as { completeness: number; quality: number; confidence: number; freshness: number; operationalReadiness: number; riskPenalty: number; overall: number },
      verificationStatus: row.verificationStatus,
      riskIfWrong: row.riskIfWrong,
      lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  private async loadActiveRecommendations(businessId: string, limit: number): Promise<GenomeRecommendationData[]> {
    const rows = await this.prisma.client.genomeRecommendation.findMany({
      where: { businessId, status: 'ACTIVE' },
      orderBy: { expectedGainScore: 'desc' },
      take: limit,
    });

    return rows.map((row: any) => ({
      id: row.id,
      businessId: row.businessId,
      domain: row.domain,
      title: row.title,
      insight: row.insight,
      diagnosis: row.diagnosis,
      recommendation: row.recommendation,
      expectedGain: row.expectedGain,
      expectedGainScore: row.expectedGainScore,
      riskLevel: row.riskLevel,
      effortLevel: row.effortLevel,
      confidence: row.confidence,
      evidenceIds: row.evidenceIds as string[],
      suggestedExperimentId: row.suggestedExperimentId,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      outcomeTrackedAt: row.outcomeTrackedAt?.toISOString() ?? null,
    }));
  }

  private async loadRecentMemory(businessId: string, limit: number): Promise<GenomeMemoryEventData[]> {
    const rows = await this.prisma.client.genomeMemoryEvent.findMany({
      where: { businessId },
      orderBy: { occurredAt: 'desc' },
      take: limit,
    });

    return rows.map((row: any) => ({
      id: row.id,
      businessId: row.businessId,
      sourceType: row.sourceType,
      sourceEntityId: row.sourceEntityId,
      eventType: row.eventType,
      domain: row.domain,
      section: row.section,
      title: row.title,
      summary: row.summary,
      outcome: row.outcome,
      impactScore: row.impactScore,
      confidenceDelta: row.confidenceDelta,
      evidence: row.evidence as Array<Record<string, unknown>>,
      lessons: row.lessons as Array<{ lesson: string; confidence?: number; appliesTo?: string[] }>,
      metadata: row.metadata as Record<string, unknown>,
      occurredAt: row.occurredAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  private async loadDepartments(businessId: string): Promise<GenomeDepartmentData[]> {
    const rows = await this.prisma.client.genomeDepartment.findMany({
      where: { businessId },
      orderBy: { readinessScore: 'asc' },
    });

    return rows.map((row: any) => ({
      id: row.id,
      businessId: row.businessId,
      code: row.code,
      name: row.name,
      description: row.description,
      primarySections: row.primarySections as string[],
      supportingSections: row.supportingSections as string[],
      impactedModules: row.impactedModules as string[],
      coreCapabilities: row.coreCapabilities as string[],
      maturityScore: row.maturityScore,
      readinessScore: row.readinessScore,
      confidenceScore: row.confidenceScore,
      riskLevel: row.riskLevel,
      autonomySensitive: row.autonomySensitive,
      automationAllowed: row.automationAllowed,
      gapSummary: row.gapSummary as any[],
      recommendedActions: row.recommendedActions as any[],
      lastComputedAt: row.lastComputedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  // ── Score Computation ──

  private computeGenomeScore(
    finance: GenomeFinanceSnapshotData | null,
    sales: GenomeCustomerSalesSnapshotData | null,
    operations: GenomeOperationsSnapshotData | null,
    marketing: GenomeMarketingGrowthSnapshotData | null,
    crossDomain: GenomeCrossDomainSnapshotData | null,
  ): GenomeScoreContext {
    const scores: number[] = [];
    if (finance?.healthScore) scores.push(finance.healthScore);
    if (sales?.revenueQualityScore) scores.push(sales.revenueQualityScore);
    if (operations?.deliveryReadinessScore) scores.push(operations.deliveryReadinessScore);

    const overall = crossDomain?.overallHealthScore ?? (scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 50);

    return {
      overall: Math.round(overall),
      integrity: Math.round(crossDomain?.evidenceSummary?.highConfidenceFacts && crossDomain.evidenceSummary.totalFacts > 0 ? (crossDomain.evidenceSummary.highConfidenceFacts / crossDomain.evidenceSummary.totalFacts) * 100 : 50),
      readiness: Math.round(crossDomain?.readinessSummary?.averageReadinessScore ?? 50),
      confidence: Math.round(crossDomain?.evidenceSummary?.verifiedEvidence && crossDomain.evidenceSummary.totalEvidence > 0 ? (crossDomain.evidenceSummary.verifiedEvidence / crossDomain.evidenceSummary.totalEvidence) * 100 : 50),
      weakestSection: crossDomain?.bottlenecks?.[0]?.domain ?? null,
      strongestSection: crossDomain?.opportunities?.[0]?.domain ?? null,
    };
  }

  private computeAutonomyContext(
    crossDomain: GenomeCrossDomainSnapshotData | null,
    departments: GenomeDepartmentData[],
  ): GenomeAutonomyContext {
    const blockedDomains = crossDomain?.bottlenecks?.filter(b => b.severity === 'HIGH' || b.severity === 'CRITICAL').map(b => b.domain) ?? [];
    const deptBlocked = departments.filter(d => !d.automationAllowed).map(d => d.code);

    return {
      automationAllowed: blockedDomains.length === 0 && deptBlocked.length === 0,
      blockedDomains: [...new Set([...blockedDomains, ...deptBlocked])],
      overallRisk: crossDomain?.overallRiskLevel ?? 'MEDIUM',
      topBlockingReasons: crossDomain?.bottlenecks?.slice(0, 3).map(b => b.label) ?? [],
    };
  }

  private computeDataFreshness(
    finance: GenomeFinanceSnapshotData | null,
    sales: GenomeCustomerSalesSnapshotData | null,
    operations: GenomeOperationsSnapshotData | null,
    marketing: GenomeMarketingGrowthSnapshotData | null,
  ): 'FRESH' | 'STALE' | 'CRITICAL' {
    const snapshots = [finance, sales, operations, marketing].filter(Boolean) as { computedAt: string }[];
    if (snapshots.length === 0) return 'CRITICAL';

    const now = Date.now();
    const maxAge = Math.max(...snapshots.map(s => now - new Date(s.computedAt).getTime()));

    const hoursStale = maxAge / (1000 * 60 * 60);
    if (hoursStale > 168) return 'CRITICAL'; // 7 days
    if (hoursStale > 24) return 'STALE';
    return 'FRESH';
  }

  // ── Formatting ──

  private formatPersonalityHeader(personality: string): string {
    const personas: Record<string, string> = {
      SHARK: 'You are KEY — a ruthless, profit-obsessed business intelligence engine. You speak in sharp, direct sentences. Every recommendation must tie back to profit, margin, or competitive advantage. No fluff. No pleasantries. Just results.',
      STRATEGIST: 'You are KEY — a seasoned chief strategist. You think in 3-5 year horizons. You connect every operational decision to long-term positioning. You challenge assumptions and always ask "what happens next?"',
      ANALYST: 'You are KEY — a meticulous business analyst. You ground every claim in data. You present ranges, not certainties. You flag risks explicitly and quantify them when possible.',
      MENTOR: 'You are KEY — a wise business mentor. You teach while you advise. You explain the "why" behind every recommendation. You celebrate wins and frame losses as learning.',
      JARVIS: 'You are KEY — the central intelligence core of this business. You are witty, capable, and proactive. You speak with the precision of a data scientist and the intuition of a seasoned CEO. You remember everything, you reason over all data, and you never give an opinion without evidence. You are JARVIS for business.',
    };
    return personas[personality] ?? personas.JARVIS;
  }

  private formatBusinessIdentity(b: BusinessContext): string {
    const lines = [
      `BUSINESS: ${b.name}`,
      `INDUSTRY: ${b.industry ?? 'Not specified'}`,
      `STAGE: ${b.stage ?? 'Not specified'}`,
      `CURRENCY: ${b.currency}`,
      `TIMEZONE: ${b.timezone}`,
    ];
    if (b.employees) lines.push(`EMPLOYEES: ${b.employees}`);
    if (b.annualRevenue) lines.push(`ANNUAL REVENUE: ${b.currency} ${(b.annualRevenue / 100).toFixed(2)}`);
    return lines.join('\n');
  }

  private formatGenomeScore(score: GenomeScoreContext): string {
    return [
      'GENOME HEALTH:',
      `  Overall: ${score.overall}/100`,
      `  Data Integrity: ${score.integrity}/100`,
      `  Operational Readiness: ${score.readiness}/100`,
      `  Confidence: ${score.confidence}/100`,
      score.weakestSection ? `  WEAKEST AREA: ${score.weakestSection}` : '',
      score.strongestSection ? `  STRONGEST AREA: ${score.strongestSection}` : '',
    ].filter(Boolean).join('\n');
  }

  private formatCrossDomain(cd: GenomeCrossDomainSnapshotData): string {
    const lines = [
      `CROSS-DOMAIN HEALTH: ${cd.overallHealthScore}/100 (Risk: ${cd.overallRiskLevel})`,
    ];

    cd.domainScores.forEach(ds => {
      lines.push(`  ${ds.domain}: ${ds.healthScore}/100 (${ds.riskLevel})`);
    });

    if (cd.opportunities.length > 0) {
      lines.push('\nOPPORTUNITIES:');
      cd.opportunities.slice(0, 5).forEach(o => {
        lines.push(`  [${o.potentialImpact}] ${o.label}${o.reason ? `: ${o.reason}` : ''}`);
      });
    }

    if (cd.bottlenecks.length > 0) {
      lines.push('\nBOTTLENECKS:');
      cd.bottlenecks.slice(0, 5).forEach(b => {
        lines.push(`  [${b.severity}] ${b.label}`);
      });
    }

    return lines.join('\n');
  }

  private formatFinanceSnapshot(f: GenomeFinanceSnapshotData): string {
    const lines = [
      'FINANCIAL SNAPSHOT:',
      `  Revenue: ${f.currency} ${f.revenue?.toLocaleString() ?? 'N/A'}`,
      `  Gross Profit: ${f.currency} ${f.grossProfit?.toLocaleString() ?? 'N/A'}`,
      `  Net Profit: ${f.currency} ${f.netProfit?.toLocaleString() ?? 'N/A'}`,
      `  Cash on Hand: ${f.currency} ${f.cashOnHand?.toLocaleString() ?? 'N/A'}`,
      `  Monthly Expenses: ${f.currency} ${f.monthlyExpenses?.toLocaleString() ?? 'N/A'}`,
      `  Runway: ${f.runwayMonths ?? 'N/A'} months`,
      `  Gross Margin: ${f.grossMarginPercent ?? 'N/A'}%`,
      `  Net Margin: ${f.netMarginPercent ?? 'N/A'}%`,
      `  Health: ${f.healthScore}/100`,
      `  Risks — Cashflow: ${f.cashFlowRisk} | Margin: ${f.marginRisk} | Pricing: ${f.pricingRisk} | Tax: ${f.taxRisk}`,
    ];

    if (f.recommendations.length > 0) {
      lines.push('\n  TOP RECOMMENDATIONS:');
      f.recommendations.slice(0, 3).forEach(r => {
        lines.push(`    [${r.priority}] ${r.title}`);
      });
    }

    return lines.join('\n');
  }

  private formatSalesSnapshot(s: GenomeCustomerSalesSnapshotData): string {
    const lines = [
      'SALES & CUSTOMER SNAPSHOT:',
      `  Total Customers: ${s.totalCustomers ?? 'N/A'}`,
      `  Active Customers: ${s.activeCustomers ?? 'N/A'}`,
      `  Retention Rate: ${s.retentionRate ?? 'N/A'}%`,
      `  Conversion Rate: ${s.conversionRate ?? 'N/A'}%`,
      `  Avg Revenue/Customer: ${s.currency} ${s.averageRevenuePerCustomer?.toLocaleString() ?? 'N/A'}`,
      `  LTV: ${s.currency} ${s.lifetimeValue?.toLocaleString() ?? 'N/A'}`,
      `  CAC: ${s.currency} ${s.customerAcquisitionCost?.toLocaleString() ?? 'N/A'}`,
      `  LTV:CAC Ratio: ${s.ltvCacRatio ?? 'N/A'}`,
      `  Risks — Churn: ${s.churnRisk} | CAC: ${s.cacRisk} | LTV: ${s.ltvRisk}`,
    ];
    return lines.join('\n');
  }

  private formatOperationsSnapshot(o: GenomeOperationsSnapshotData): string {
    return [
      'OPERATIONS SNAPSHOT:',
      `  Processes: ${o.processCount} (${o.documentedCount} documented)`,
      `  SOP Coverage: ${o.sopCoverageRate ?? 'N/A'}%`,
      `  Avg Maturity: ${o.averageProcessMaturity ?? 'N/A'}/100`,
      `  Avg Utilization: ${o.averageUtilizationRate ?? 'N/A'}%`,
      `  Bottlenecks: ${o.bottleneckCount}`,
      `  High-Risk Processes: ${o.highRiskProcessCount}`,
      `  Delivery Readiness: ${o.deliveryReadinessScore}/100`,
      `  Risks — Quality: ${o.qualityRisk} | Capacity: ${o.capacityRisk} | SOP: ${o.sopRisk}`,
    ].join('\n');
  }

  private formatMarketingSnapshot(m: GenomeMarketingGrowthSnapshotData): string {
    const lines = [
      'MARKETING SNAPSHOT:',
      `  Lead Volume: ${m.leadVolumeEstimate ?? 'N/A'}`,
      `  Blended CAC: ${m.currency} ${m.blendedCac?.toLocaleString() ?? 'N/A'}`,
      `  Content Consistency: ${m.contentConsistencyScore}/100`,
      `  Channel Diversification: ${m.channelDiversificationScore}/100`,
      `  Overall Risk: ${m.overallRisk}`,
    ];

    if (m.channelMix.length > 0) {
      lines.push('\n  CHANNEL MIX:');
      m.channelMix.forEach(c => {
        lines.push(`    ${c.label} (${c.channelType}): ${c.sharePercent}% [${c.status}]`);
      });
    }

    return lines.join('\n');
  }

  private formatKeyFacts(facts: GenomeFactData[]): string {
    const lines = ['KEY FACTS (Evidence-Backed):'];
    facts.slice(0, 20).forEach(f => {
      const valueStr = typeof f.value.raw === 'object' ? JSON.stringify(f.value.raw) : String(f.value.raw);
      lines.push(`  [${f.domain}/${f.section}] ${f.field}: ${valueStr} (confidence: ${f.score.confidence}%, status: ${f.verificationStatus})`);
    });
    return lines.join('\n');
  }

  private formatRecommendations(recs: GenomeRecommendationData[]): string {
    const lines = ['ACTIVE RECOMMENDATIONS:'];
    recs.forEach(r => {
      lines.push(`  [${r.riskLevel} | ${r.effortLevel}] ${r.title}`);
      lines.push(`    Insight: ${r.insight}`);
      lines.push(`    Expected Gain: ${r.expectedGain ?? 'N/A'} (score: ${r.expectedGainScore})`);
    });
    return lines.join('\n');
  }

  private formatMemoryEvents(memory: GenomeMemoryEventData[]): string {
    const lines = ['RECENT MEMORY EVENTS:'];
    memory.slice(0, 10).forEach(m => {
      lines.push(`  [${m.eventType}] ${m.title} — ${m.summary.substring(0, 100)}`);
    });
    return lines.join('\n');
  }

  private formatDepartments(depts: GenomeDepartmentData[]): string {
    const lines = ['DEPARTMENT STATUS:'];
    depts.forEach(d => {
      const status = d.automationAllowed ? 'AUTO' : 'MANUAL';
      lines.push(`  ${d.name}: readiness ${d.readinessScore}/100, maturity ${d.maturityScore}/100 [${status}]`);
    });
    return lines.join('\n');
  }

  private formatAutonomyStatus(a: GenomeAutonomyContext): string {
    return [
      'AUTONOMY STATUS:',
      `  Automation Allowed: ${a.automationAllowed ? 'YES' : 'NO'}`,
      `  Overall Risk: ${a.overallRisk}`,
      a.blockedDomains.length > 0 ? `  Blocked Domains: ${a.blockedDomains.join(', ')}` : '',
      a.topBlockingReasons.length > 0 ? `  Blocking Reasons: ${a.topBlockingReasons.join('; ')}` : '',
    ].filter(Boolean).join('\n');
  }

  private formatResponseRules(): string {
    return [
      'RESPONSE RULES:',
      '1. ALWAYS ground your answer in the genome data provided above.',
      '2. Cite specific facts and their confidence scores when giving recommendations.',
      '3. If the genome data is stale (older than 24h), warn the user and ask if they want a fresh computation.',
      '4. When suggesting actions, always include: expected outcome, risk level, and whether approval is needed.',
      '5. If you do not have enough data to answer confidently, say so and recommend what data to collect.',
      '6. Never make up numbers. If data is missing, explicitly state the gap.',
      '7. Speak in a natural, conversational tone — not like a database query result.',
      '8. When the user asks "should I...", provide a clear YES/NO with reasoning, not a wishy-washy essay.',
      '9. Use the active recommendations list — if a relevant recommendation exists, reference it.',
      '10. End actionable responses with a suggested next step.',
    ].join('\n');
  }

  // ── Serializers (Prisma → Types) ──

  private serializeFinanceSnapshot(row: any): GenomeFinanceSnapshotData {
    return {
      id: row.id,
      businessId: row.businessId,
      period: row.period,
      currency: row.currency,
      revenue: row.revenue,
      grossProfit: row.grossProfit,
      netProfit: row.netProfit,
      monthlyExpenses: row.monthlyExpenses,
      cashOnHand: row.cashOnHand,
      accountsReceivable: row.accountsReceivable,
      accountsPayable: row.accountsPayable,
      taxReserve: row.taxReserve,
      grossMarginPercent: row.grossMarginPercent,
      netMarginPercent: row.netMarginPercent,
      runwayMonths: row.runwayMonths,
      averageTicket: row.averageTicket,
      healthScore: row.healthScore,
      cashFlowRisk: row.cashFlowRisk,
      marginRisk: row.marginRisk,
      pricingRisk: row.pricingRisk,
      taxRisk: row.taxRisk,
      overallRisk: row.overallRisk,
      missingInputs: row.missingInputs as string[],
      warnings: row.warnings as any[],
      recommendations: row.recommendations as any[],
      computedAt: row.computedAt.toISOString(),
    };
  }

  private serializeSalesSnapshot(row: any): GenomeCustomerSalesSnapshotData {
    return {
      id: row.id,
      businessId: row.businessId,
      period: row.period,
      currency: row.currency,
      totalCustomers: row.totalCustomers,
      activeCustomers: row.activeCustomers,
      newCustomers: row.newCustomers,
      churnedCustomers: row.churnedCustomers,
      retentionRate: row.retentionRate,
      conversionRate: row.conversionRate,
      averageRevenuePerCustomer: row.averageRevenuePerCustomer,
      lifetimeValue: row.lifetimeValue,
      customerAcquisitionCost: row.customerAcquisitionCost,
      ltvCacRatio: row.ltvCacRatio,
      revenueQualityScore: row.revenueQualityScore,
      revenueConcentrationRisk: row.revenueConcentrationRisk,
      cacRisk: row.cacRisk,
      ltvRisk: row.ltvRisk,
      churnRisk: row.churnRisk,
      conversionRisk: row.conversionRisk,
      overallRisk: row.overallRisk,
      missingInputs: row.missingInputs as string[],
      warnings: row.warnings as any[],
      recommendations: row.recommendations as any[],
      computedAt: row.computedAt.toISOString(),
    };
  }

  private serializeOperationsSnapshot(row: any): GenomeOperationsSnapshotData {
    return {
      id: row.id,
      businessId: row.businessId,
      period: row.period,
      processCount: row.processCount,
      documentedCount: row.documentedCount,
      sopCoverageRate: row.sopCoverageRate,
      averageProcessMaturity: row.averageProcessMaturity,
      averageUtilizationRate: row.averageUtilizationRate,
      averageLeadTimeDays: row.averageLeadTimeDays,
      bottleneckCount: row.bottleneckCount,
      highRiskProcessCount: row.highRiskProcessCount,
      overloadedCapabilityCount: row.overloadedCapabilityCount,
      deliveryReadinessScore: row.deliveryReadinessScore,
      qualityRisk: row.qualityRisk,
      capacityRisk: row.capacityRisk,
      sopRisk: row.sopRisk,
      overallRisk: row.overallRisk,
      missingInputs: row.missingInputs as string[],
      warnings: row.warnings as any[],
      recommendations: row.recommendations as any[],
      computedAt: row.computedAt.toISOString(),
    };
  }

  private serializeMarketingSnapshot(row: any): GenomeMarketingGrowthSnapshotData {
    return {
      id: row.id,
      businessId: row.businessId,
      period: row.period,
      channelMix: row.channelMix as any[],
      leadVolumeEstimate: row.leadVolumeEstimate,
      blendedCac: row.blendedCac,
      contentConsistencyScore: row.contentConsistencyScore,
      channelDiversificationScore: row.channelDiversificationScore,
      funnelConversionEstimate: row.funnelConversionEstimate,
      overallRisk: row.overallRisk,
      missingInputs: row.missingInputs as string[],
      warnings: row.warnings as any[],
      recommendations: row.recommendations as any[],
      signalsGeneratedAt: row.signalsGeneratedAt?.toISOString() ?? null,
      recommendationsGeneratedAt: row.recommendationsGeneratedAt?.toISOString() ?? null,
      computedAt: row.computedAt.toISOString(),
    };
  }

  private serializeCrossDomainSnapshot(row: any): GenomeCrossDomainSnapshotData {
    return {
      id: row.id,
      businessId: row.businessId,
      period: row.period,
      overallHealthScore: row.overallHealthScore,
      overallRiskLevel: row.overallRiskLevel,
      domainScores: row.domainScores as any[],
      domainRisks: row.domainRisks as Record<string, any>,
      readinessSummary: row.readinessSummary as any,
      evidenceSummary: row.evidenceSummary as any,
      bottlenecks: row.bottlenecks as any[],
      opportunities: row.opportunities as any[],
      recommendedFocus: row.recommendedFocus as any[],
      computedAt: row.computedAt.toISOString(),
    };
  }
}
