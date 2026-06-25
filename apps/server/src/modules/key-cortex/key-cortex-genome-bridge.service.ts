/**
 * KEY <-> Genome Deep Integration Bridge
 *
 * The critical orchestration layer that connects KEY Cortex to the Business Genome
 * system. This service enables bidirectional intelligence flow:
 *
 *   KEY -> Genome: Action outcomes, observations, signals, evidence
 *   Genome -> KEY: DNA scores, recommendations, autonomy decisions, opportunities
 *
 * v1 -- Initial bridge with 12 integration methods:
 *   getGenomeIntelligence, getRankedRecommendations, checkAutonomy,
 *   triggerEvolution, detectOpportunities, recordOutcome,
 *   createGenomeSignal, getDnaScores, getCrossDomainInsights,
 *   shouldActProactively, enrichContextWithGenome, reportActionOutcome
 */

import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { BusinessGenomeService } from '../business-genome/business-genome.service';
import { GenomeEvolutionService } from '../business-genome/genome-evolution/genome-evolution.service';
import { GenomeOpportunityDetectorService } from '../business-genome/key-genome/genome-opportunity-detector.service';
import { GenomeRecommendationService } from '../business-genome/key-genome/genome-recommendation.service';
import { GenomeRecommendationRankerService } from '../business-genome/key-genome/genome-recommendation-ranker.service';
import { OutcomeLearningService } from '../business-genome/key-genome/outcome-learning.service';
import { GenomeAutonomyGateService } from '../business-genome/key-genome/genome-autonomy-gate.service';
import { GenomeSignalService } from '../business-genome/key-genome/genome-signal.service';
import { GenomeScoringService } from '../business-genome/key-genome/genome-scoring.service';
import { GenomeCrossDomainService } from '../business-genome/key-genome/genome-cross-domain.service';
import { BlueprintService } from '../blueprint/blueprint.service';
import { TemporalFlowService } from '../temporal-flow/temporal-flow.service';
import { KeyCortexEventService } from './key-cortex-event.service';
import { KeyCortexEvidenceService } from './key-cortex-evidence.service';

import type {
  GenomeRecommendationData,
  GenomeRankedRecommendation,
  GenomeRecommendationRankingResult,
  GenomeSignalData,
  GenomeCrossDomainSnapshotData,
  GenomeCrossDomainOpportunityCandidate,
  GenomeAutonomyGateResult,
  GenomeEvolutionProposalData,
  GenomeOpportunityDetectionResult,
  KeyGenomeScore,
  GenomeIntegrityResult,
  GenomeLearningSummary,
  CreateGenomeSignalInput,
  RecommendationOutcome,
} from '../business-genome/key-genome/key-genome.types';
import type { GenomeEvolutionProposalInput } from '../business-genome/genome-evolution.types';

// ---------------------------------------------------------------------------
// Bridge-specific type definitions
// ---------------------------------------------------------------------------

export interface GenomeIntelligence {
  businessId: string;
  dnaScores: GenomeIntegrityResult;
  stage: string;
  readiness: Array<{
    module: string;
    readinessScore: number;
    automationAllowed: boolean;
    riskLevel: string;
  }>;
  recommendations: GenomeRecommendationData[];
  signals: GenomeSignalData[];
  crossDomainInsights: GenomeCrossDomainSnapshotData | null;
  opportunities: GenomeOpportunityDetectionResult | null;
  generatedAt: string;
}

export interface RankedRecommendation {
  id: string;
  domain: string;
  title: string;
  insight: string;
  recommendation: string;
  confidence: number;
  impact: number;
  effort: 'LOW' | 'MEDIUM' | 'HIGH';
  rankScore: number;
  rankReason: string;
  riskLevel: string;
  financialViability: string;
  capacityGating: string;
  safeToExecute: boolean;
}

export interface AutonomyCheck {
  allowed: boolean;
  tier: 'full' | 'supervised' | 'manual';
  requiresApproval: boolean;
  reason: string;
  gateResult: GenomeAutonomyGateResult;
}

export interface EvolutionEvidence {
  section: string;
  proposedPatch: Record<string, unknown>;
  reason: string;
  evidence?: string[];
  confidence?: number;
  autoDetect?: boolean;
}

export interface Opportunity {
  id: string;
  label: string;
  affectedDomains: string[];
  potentialImpact: 'LOW' | 'MEDIUM' | 'HIGH';
  confidence: number;
  estimatedValueScore: number;
  suggestedAction: string;
  requiredConditions: string[];
  evidence: string[];
}

export interface OutcomeRecord {
  success: boolean;
  notes?: string;
  measuredValue?: number;
}

export interface SignalInput {
  sourceModule: string;
  signalType: string;
  section: string;
  domain: string;
  field?: string | null;
  proposedValue?: unknown;
  reason: string;
  evidence?: Array<{
    sourceModule: string;
    sourceEntityType: string;
    sourceEntityId?: string | null;
    summary: string;
    evidenceStrength?: number;
    occurredAt?: string | null;
  }>;
  confidence?: number;
}

export interface GenomeSignal {
  id: string;
  signalType: string;
  section: string;
  domain: string;
  confidence: number;
  status: string;
  reason: string;
  createdAt: string;
}

export interface DnaScores {
  businessId: string;
  overallIntegrity: number;
  overallScore: number;
  stage: string;
  sectionScores: Array<{
    section: string;
    integrity: number;
    confidence: number;
    weight: number;
  }>;
  factScores: Array<{
    section: string;
    domain: string;
    field: string;
    overall: number;
    confidence: number;
    freshness: number;
  }>;
  trends: {
    integrity: 'improving' | 'stable' | 'declining' | 'unknown';
    confidence: 'improving' | 'stable' | 'declining' | 'unknown';
  };
  computedAt: string;
}

export interface CrossDomainInsight {
  domain: string;
  healthScore: number;
  riskLevel: string;
  bottlenecks: Array<{
    label: string;
    severity: string;
    reason?: string;
  }>;
  opportunities: Array<{
    label: string;
    potentialImpact: string;
    reason?: string;
  }>;
  recommendedFocus: Array<{
    priority: number;
    label: string;
    reason: string;
  }>;
  actionRecommendations: string[];
}

export interface ProposedAction {
  type: string;
  title: string;
  rationale: string;
  expectedImpact: string;
  confidence: number;
  requiresApproval: boolean;
  affectedDomains: string[];
}

export interface EnrichedContext {
  genome: {
    dnaIntegrity: number;
    stage: string;
    topRecommendations: Array<{
      title: string;
      domain: string;
      confidence: number;
    }>;
    recentSignals: Array<{
      type: string;
      domain: string;
      confidence: number;
    }>;
    autonomyTier: string;
    overallRisk: string;
  };
  baseContext: Record<string, unknown>;
  enrichedAt: string;
}

@Injectable()
export class KeyCortexGenomeBridgeService {
  private readonly logger = new Logger(KeyCortexGenomeBridgeService.name);

  // Simple in-memory cache for trend detection (businessId -> last score)
  private readonly scoreHistory = new Map<string, { integrity: number; confidence: number; at: number }>();

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(BusinessGenomeService) private readonly genome?: BusinessGenomeService,
    @Optional() @Inject(GenomeEvolutionService) private readonly evolution?: GenomeEvolutionService,
    @Optional() @Inject(GenomeOpportunityDetectorService) private readonly opportunityDetector?: GenomeOpportunityDetectorService,
    @Optional() @Inject(GenomeRecommendationService) private readonly recommendation?: GenomeRecommendationService,
    @Optional() @Inject(GenomeRecommendationRankerService) private readonly ranker?: GenomeRecommendationRankerService,
    @Optional() @Inject(OutcomeLearningService) private readonly outcomeLearning?: OutcomeLearningService,
    @Optional() @Inject(GenomeAutonomyGateService) private readonly autonomyGate?: GenomeAutonomyGateService,
    @Optional() @Inject(GenomeSignalService) private readonly signal?: GenomeSignalService,
    @Optional() @Inject(GenomeScoringService) private readonly scoring?: GenomeScoringService,
    @Optional() @Inject(GenomeCrossDomainService) private readonly crossDomain?: GenomeCrossDomainService,
    private readonly blueprint: BlueprintService,
    private readonly temporal: TemporalFlowService,
    private readonly eventService: KeyCortexEventService,
    private readonly evidenceService: KeyCortexEvidenceService,
  ) {}

  // =========================================================================
  // 1. getGenomeIntelligence -- Aggregate ALL genome data for AI consumption
  // =========================================================================

  async getGenomeIntelligence(businessId: string): Promise<GenomeIntelligence> {
    this.logger.debug(`[getGenomeIntelligence] businessId=${businessId}`);

    if (!this.recommendation) throw new Error('Genome recommendation service not available');
    if (!this.signal) throw new Error('Genome signal service not available');
    if (!this.crossDomain) throw new Error('Genome cross-domain service not available');
    if (!this.opportunityDetector) throw new Error('Genome opportunity detector service not available');

    const [
      dnaScores,
      recommendations,
      signals,
      crossDomainInsights,
      opportunities,
    ] = await Promise.allSettled([
      this.blueprint.calculateGenomeIntegrity(businessId),
      this.recommendation.listRecommendations(businessId, { status: 'ACTIVE', limit: 10 }),
      this.signal.listSignals(businessId, { limit: 10 }),
      this.crossDomain.getLatestCrossDomainSnapshot(businessId),
      this.opportunityDetector.detectOpportunities(businessId, { limit: 10 }),
    ]);

    const dnaResult = dnaScores.status === 'fulfilled' ? dnaScores.value : null;
    const stage = dnaResult?.genomeStage ?? 'UNKNOWN';

    // Derive readiness from DNA scores
    let readiness: GenomeIntelligence['readiness'] = [];
    if (dnaResult?.readinessBreakdown) {
      readiness = Object.entries(dnaResult.readinessBreakdown).map(([module, score]) => ({
        module,
        readinessScore: typeof score === 'number' ? score : 0,
        automationAllowed: (typeof score === 'number' ? score : 0) >= 70,
        riskLevel: (typeof score === 'number' ? score : 0) < 40 ? 'HIGH' : (typeof score === 'number' ? score : 0) < 70 ? 'MEDIUM' : 'LOW',
      }));
    }

    const result: GenomeIntelligence = {
      businessId,
      dnaScores: dnaResult ?? ({} as GenomeIntegrityResult),
      stage,
      readiness,
      recommendations: recommendations.status === 'fulfilled' ? recommendations.value : [],
      signals: signals.status === 'fulfilled' ? signals.value : [],
      crossDomainInsights: crossDomainInsights.status === 'fulfilled' ? crossDomainInsights.value : null,
      opportunities: opportunities.status === 'fulfilled' ? opportunities.value : null,
      generatedAt: new Date().toISOString(),
    };

    this.logEvent(businessId, 'genome_intelligence_retrieved', {
      stage,
      recommendationCount: result.recommendations.length,
      signalCount: result.signals.length,
    });

    return result;
  }

  // =========================================================================
  // 2. getRankedRecommendations -- Genome-ranked recommendations with context
  // =========================================================================

  async getRankedRecommendations(
    businessId: string,
    context?: string,
  ): Promise<RankedRecommendation[]> {
    this.logger.debug(`[getRankedRecommendations] businessId=${businessId} context=${context ?? 'none'}`);

    if (!this.recommendation) throw new Error('Genome recommendation service not available');
    if (!this.ranker) throw new Error('Genome recommendation ranker service not available');

    // Generate fresh recommendations, then rank them
    await this.recommendation.generateRecommendations({
      businessId,
      sources: ['READINESS_GAP', 'SIGNAL', 'WEAK_SECTION'],
      maxRecommendations: 20,
    });

    const rankingResult: GenomeRecommendationRankingResult = await this.ranker.rankRecommendations(
      businessId,
      { status: 'ACTIVE', limit: 10 },
    );

    let ranked = rankingResult.rankedRecommendations;

    // Filter by context if provided
    if (context) {
      const ctx = context.toUpperCase();
      ranked = ranked.filter((r) => {
        const d = r.domain.toUpperCase();
        if (ctx.includes('FINANCE')) return d.includes('FINANCE') || d.includes('FINANCIAL');
        if (ctx.includes('SALES') || ctx.includes('CUSTOMER')) return d.includes('SALES') || d.includes('CUSTOMER') || d.includes('REVENUE');
        if (ctx.includes('MARKETING')) return d.includes('MARKET');
        if (ctx.includes('OPERATION')) return d.includes('OPERATION') || d.includes('DELIVERY');
        return d.includes(ctx);
      });
    }

    const mapped: RankedRecommendation[] = ranked.map((r) => ({
      id: r.id,
      domain: r.domain,
      title: r.title,
      insight: r.insight,
      recommendation: r.recommendation,
      confidence: r.confidence,
      impact: r.expectedGainScore,
      effort: r.effortLevel,
      rankScore: r.rankScore,
      rankReason: r.rankReason,
      riskLevel: r.riskLevel,
      financialViability: r.financialViability,
      capacityGating: r.capacityGating,
      safeToExecute: r.capacityGating !== 'HARD_CONSTRAINT' && r.riskLevel !== 'CRITICAL' && r.rankScore >= 40,
    }));

    this.logEvent(businessId, 'ranked_recommendations_retrieved', {
      context: context ?? 'all',
      count: mapped.length,
      topRankScore: mapped[0]?.rankScore ?? 0,
    });

    return mapped;
  }

  // =========================================================================
  // 3. checkAutonomy -- Check if KEY can execute autonomously
  // =========================================================================

  async checkAutonomy(
    businessId: string,
    action: string,
    params?: Record<string, unknown>,
  ): Promise<AutonomyCheck> {
    this.logger.debug(`[checkAutonomy] businessId=${businessId} action=${action}`);

    if (!this.autonomyGate) throw new Error('Genome autonomy gate service not available');

    const gateResult: GenomeAutonomyGateResult = await this.autonomyGate.checkGate({
      businessId,
      actionType: action,
      payload: params,
      proposedBy: 'KEY',
    });

    // Map gate decision to autonomy tier
    let tier: AutonomyCheck['tier'] = 'manual';
    let requiresApproval = true;

    switch (gateResult.decision) {
      case 'ALLOW':
        tier = 'full';
        requiresApproval = false;
        break;
      case 'ALLOW_WITH_APPROVAL':
        tier = 'supervised';
        requiresApproval = true;
        break;
      case 'NEEDS_MORE_EVIDENCE':
        tier = 'manual';
        requiresApproval = true;
        break;
      case 'BLOCK':
        tier = 'manual';
        requiresApproval = true;
        break;
    }

    const result: AutonomyCheck = {
      allowed: gateResult.decision === 'ALLOW' || gateResult.decision === 'ALLOW_WITH_APPROVAL',
      tier,
      requiresApproval,
      reason: gateResult.recommendedNextStep,
      gateResult,
    };

    this.logEvent(businessId, 'autonomy_check', {
      action,
      decision: gateResult.decision,
      tier,
      requiresApproval,
      riskLevel: gateResult.riskLevel,
    });

    return result;
  }

  // =========================================================================
  // 4. triggerEvolution -- Trigger genome evolution from KEY observations
  // =========================================================================

  async triggerEvolution(
    businessId: string,
    evidence: EvolutionEvidence,
  ): Promise<GenomeEvolutionProposalData[]> {
    this.logger.debug(`[triggerEvolution] businessId=${businessId} section=${evidence.section}`);

    if (!this.evolution) throw new Error('Genome evolution service not available');

    let proposals: GenomeEvolutionProposalData[] = [];

    if (evidence.autoDetect) {
      // Auto-detect evolution proposals from temporal flow signals
      proposals = await this.evolution.generateFromTemporalFlow(businessId, 'KEY');
    } else {
      // Create a specific evolution proposal from KEY's evidence
      const input: GenomeEvolutionProposalInput = {
        section: evidence.section as import('../business-genome/blueprint/blueprint.types').DnaSectionKey,
        proposedPatch: evidence.proposedPatch,
        reason: evidence.reason,
        evidence: evidence.evidence ?? [],
        confidence: evidence.confidence ?? 0.7,
        createdBy: 'KEY',
        sourceEventIds: [],
      };

      const proposal = await this.evolution.create(businessId, input);
      proposals = [proposal];
    }

    this.logEvent(businessId, 'evolution_triggered', {
      autoDetect: evidence.autoDetect ?? false,
      section: evidence.section,
      proposalCount: proposals.length,
    });

    return proposals;
  }

  // =========================================================================
  // 5. detectOpportunities -- Genome opportunity detection
  // =========================================================================

  async detectOpportunities(businessId: string): Promise<Opportunity[]> {
    this.logger.debug(`[detectOpportunities] businessId=${businessId}`);

    if (!this.opportunityDetector) throw new Error('Genome opportunity detector service not available');

    // Get DNA context for enrichment
    const [detectionResult, dnaScores] = await Promise.allSettled([
      this.opportunityDetector.detectOpportunities(businessId, {
        includeRiskMitigation: true,
        limit: 20,
      }),
      this.blueprint.calculateGenomeIntegrity(businessId),
    ]);

    const result = detectionResult.status === 'fulfilled' ? detectionResult.value : null;

    if (!result) {
      this.logger.warn(`[detectOpportunities] Failed to detect opportunities for ${businessId}`);
      return [];
    }

    // Map to Opportunity type, ranking by revenue potential x confidence
    const opportunities: Opportunity[] = result.prioritizedOpportunities.map((opp) => ({
      id: opp.id,
      label: opp.label,
      affectedDomains: opp.affectedDomains as string[],
      potentialImpact: opp.potentialImpact,
      confidence: opp.confidence,
      estimatedValueScore: opp.estimatedValueScore,
      suggestedAction: opp.suggestedAction,
      requiredConditions: opp.requiredConditions,
      evidence: opp.evidence,
    }));

    // Sort by estimatedValueScore * confidence descending
    opportunities.sort((a, b) => (b.estimatedValueScore * b.confidence) - (a.estimatedValueScore * a.confidence));

    this.logEvent(businessId, 'opportunities_detected', {
      count: opportunities.length,
      topScore: opportunities[0]?.estimatedValueScore ?? 0,
      dnaIntegrity: dnaScores.status === 'fulfilled' ? dnaScores.value.genomeIntegrity : null,
    });

    return opportunities;
  }

  // =========================================================================
  // 6. recordOutcome -- Feed action outcomes back into genome learning
  // =========================================================================

  async recordOutcome(
    businessId: string,
    recommendationId: string,
    outcome: OutcomeRecord,
  ): Promise<void> {
    this.logger.debug(`[recordOutcome] businessId=${businessId} recommendationId=${recommendationId}`);

    if (!this.recommendation) throw new Error('Genome recommendation service not available');
    if (!this.outcomeLearning) throw new Error('Genome outcome learning service not available');

    const recommendation = await this.recommendation.getRecommendation(businessId, recommendationId).catch(() => null);

    const recOutcome: RecommendationOutcome = {
      success: outcome.success,
      notes: outcome.notes,
      measuredValue: outcome.measuredValue,
    };

    // Feed into outcome learning
    if (recommendation) {
      await this.outcomeLearning.recordRecommendationOutcome(businessId, recommendation, recOutcome);
    }

    // Create evidence if outcome was successful
    if (outcome.success && recommendation) {
      await this.evidenceService?.createEvidence?.(businessId, {
        sourceModule: 'key_cortex',
        sourceEntityType: 'KeyAction',
        summary: `Successful outcome recorded for recommendation "${recommendation.title}". ${outcome.notes ?? ''}`,
        evidenceStrength: 0.8,
      }).catch(() => {
        // Evidence service may not be available yet
      });
    }

    // Update recommendation ranker with outcome via memory
    await this.outcomeLearning.computeLearningSummary(businessId).catch(() => null);

    this.logEvent(businessId, 'outcome_recorded', {
      recommendationId,
      success: outcome.success,
      measuredValue: outcome.measuredValue,
    });
  }

  // =========================================================================
  // 7. createGenomeSignal -- Create a signal from KEY's observations
  // =========================================================================

  async createGenomeSignal(
    businessId: string,
    signal: SignalInput,
  ): Promise<GenomeSignal> {
    this.logger.debug(`[createGenomeSignal] businessId=${businessId} type=${signal.signalType}`);

    if (!this.signal) throw new Error('Genome signal service not available');

    const input: CreateGenomeSignalInput = {
      businessId,
      sourceModule: 'key_autonomy',
      sourceEntityType: 'KeyCortex',
      signalType: signal.signalType,
      section: signal.section,
      domain: signal.domain,
      field: signal.field ?? null,
      proposedValue: signal.proposedValue,
      reason: signal.reason,
      evidence: signal.evidence ?? [],
      confidence: signal.confidence ?? 0.6,
    };

    const created: GenomeSignalData = await this.signal.createSignal(input);

    const result: GenomeSignal = {
      id: created.id,
      signalType: created.signalType,
      section: created.section,
      domain: created.domain,
      confidence: created.confidence,
      status: created.status,
      reason: created.reason,
      createdAt: created.createdAt,
    };

    this.logEvent(businessId, 'genome_signal_created', {
      signalId: created.id,
      signalType: signal.signalType,
      domain: signal.domain,
      genomeSignal: true,
    });

    return result;
  }

  // =========================================================================
  // 8. getDnaScores -- Current DNA scores with trends
  // =========================================================================

  async getDnaScores(businessId: string): Promise<DnaScores> {
    this.logger.debug(`[getDnaScores] businessId=${businessId}`);

    if (!this.scoring) throw new Error('Genome scoring service not available');

    const [integrity, facts] = await Promise.allSettled([
      this.blueprint.calculateGenomeIntegrity(businessId),
      this.scoring.computeFactScores(businessId),
    ]);

    const integrityResult = integrity.status === 'fulfilled' ? integrity.value : null;
    const factData = facts.status === 'fulfilled' ? facts.value : [];

    // Compute trends by comparing with historical scores
    const history = this.scoreHistory.get(businessId);
    let integrityTrend: DnaScores['trends']['integrity'] = 'unknown';
    let confidenceTrend: DnaScores['trends']['confidence'] = 'unknown';

    if (history && integrityResult) {
      integrityTrend = integrityResult.genomeIntegrity > history.integrity + 2
        ? 'improving'
        : integrityResult.genomeIntegrity < history.integrity - 2
          ? 'declining'
          : 'stable';

      const currentConfidence = integrityResult.genomeDnaConfidence
        ? Object.values(integrityResult.genomeDnaConfidence).reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0) /
          Math.max(1, Object.values(integrityResult.genomeDnaConfidence).length)
        : 0;
      confidenceTrend = currentConfidence > history.confidence + 2
        ? 'improving'
        : currentConfidence < history.confidence - 2
          ? 'declining'
          : 'stable';
    }

    // Store current scores for next comparison
    if (integrityResult) {
      const avgConfidence = integrityResult.genomeDnaConfidence
        ? Object.values(integrityResult.genomeDnaConfidence).reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0) /
          Math.max(1, Object.values(integrityResult.genomeDnaConfidence).length)
        : 0;
      this.scoreHistory.set(businessId, {
        integrity: integrityResult.genomeIntegrity,
        confidence: avgConfidence,
        at: Date.now(),
      });
    }

    // Build section scores from DNA sections
    const sectionScores = integrityResult?.dnaSections?.map((s) => ({
      section: s.key,
      integrity: s.integrity,
      confidence: s.confidence,
      weight: 0, // Will be filled from ontology if needed
    })) ?? [];

    // Build fact scores
    const factScores = factData.map((f) => ({
      section: f.section,
      domain: f.domain,
      field: f.field,
      overall: f.score.overall,
      confidence: f.score.confidence,
      freshness: f.score.freshness,
    }));

    const result: DnaScores = {
      businessId,
      overallIntegrity: integrityResult?.genomeIntegrity ?? 0,
      overallScore: integrityResult?.executiveReadinessScore ?? 0,
      stage: integrityResult?.genomeStage ?? 'UNKNOWN',
      sectionScores,
      factScores,
      trends: {
        integrity: integrityTrend,
        confidence: confidenceTrend,
      },
      computedAt: new Date().toISOString(),
    };

    return result;
  }

  // =========================================================================
  // 9. getCrossDomainInsights -- Cross-domain pattern analysis
  // =========================================================================

  async getCrossDomainInsights(businessId: string): Promise<CrossDomainInsight[]> {
    this.logger.debug(`[getCrossDomainInsights] businessId=${businessId}`);

    if (!this.crossDomain) throw new Error('Genome cross-domain service not available');
    if (!this.outcomeLearning) throw new Error('Genome outcome learning service not available');

    const [snapshot, learningSummary] = await Promise.allSettled([
      this.crossDomain.computeCrossDomainSnapshot(businessId),
      this.outcomeLearning.computeLearningSummary(businessId),
    ]);

    const snap = snapshot.status === 'fulfilled' ? snapshot.value : null;

    if (!snap) {
      this.logger.warn(`[getCrossDomainInsights] No snapshot available for ${businessId}`);
      return [];
    }

    const insights: CrossDomainInsight[] = snap.domainScores.map((ds) => {
      const domainBottlenecks = snap.bottlenecks.filter((b) => b.domain === ds.domain);
      const domainOpportunities = snap.opportunities.filter((o) => o.domain === ds.domain);
      const domainFocus = snap.recommendedFocus.filter((f) => f.domain === ds.domain);

      // Build action recommendations from focus items
      const actionRecommendations = domainFocus.map(
        (f) => `${f.priority}. ${f.label}: ${f.reason}`,
      );

      return {
        domain: ds.domain,
        healthScore: ds.healthScore,
        riskLevel: ds.riskLevel,
        bottlenecks: domainBottlenecks.map((b) => ({
          label: b.label,
          severity: b.severity,
          reason: b.reason,
        })),
        opportunities: domainOpportunities.map((o) => ({
          label: o.label,
          potentialImpact: o.potentialImpact,
          reason: o.reason,
        })),
        recommendedFocus: domainFocus.map((f) => ({
          priority: f.priority,
          label: f.label,
          reason: f.reason,
        })),
        actionRecommendations,
      };
    });

    this.logEvent(businessId, 'cross_domain_insights_retrieved', {
      domainCount: insights.length,
      overallRisk: snap.overallRiskLevel,
      overallHealth: snap.overallHealthScore,
    });

    return insights;
  }

  // =========================================================================
  // 10. shouldActProactively -- Crown jewel: decide if KEY should act
  // =========================================================================

  async shouldActProactively(
    businessId: string,
  ): Promise<{ shouldAct: boolean; actions: ProposedAction[]; reason: string }> {
    this.logger.debug(`[shouldActProactively] businessId=${businessId}`);

    if (!this.signal) throw new Error('Genome signal service not available');
    if (!this.autonomyGate) throw new Error('Genome autonomy gate service not available');

    // Gather all intelligence in parallel
    const [dnaScores, signals, autonomy, opportunities] = await Promise.allSettled([
      this.getDnaScores(businessId),
      this.signal.listSignals(businessId, { status: 'NEW', minConfidence: 0.7, limit: 20 }),
      this.checkAutonomy(businessId, 'proactive_action'),
      this.detectOpportunities(businessId),
    ]);

    const dna = dnaScores.status === 'fulfilled' ? dnaScores.value : null;
    const sigs = signals.status === 'fulfilled' ? signals.value : [];
    const auto = autonomy.status === 'fulfilled' ? autonomy.value : null;
    const opps = opportunities.status === 'fulfilled' ? opportunities.value : [];

    const proposedActions: ProposedAction[] = [];
    const reasoningParts: string[] = [];
    let shouldAct = false;

    // Check 1: High-confidence signals that haven't been reviewed
    const criticalSignals = sigs.filter(
      (s) => s.confidence >= 0.85 && (s.signalType === 'RISK_PATTERN' || s.signalType === 'READINESS_BLOCKER'),
    );
    if (criticalSignals.length > 0) {
      shouldAct = true;
      reasoningParts.push(`${criticalSignals.length} critical signal(s) detected requiring immediate attention.`);
      for (const sig of criticalSignals.slice(0, 3)) {
        proposedActions.push({
          type: 'REVIEW_SIGNAL',
          title: `Review ${sig.signalType} in ${sig.domain}`,
          rationale: `High-confidence (${Math.round(sig.confidence * 100)}%) signal detected: ${sig.reason}`,
          expectedImpact: 'HIGH',
          confidence: sig.confidence,
          requiresApproval: auto?.tier !== 'full',
          affectedDomains: [sig.domain],
        });
      }
    }

    // Check 2: DNA integrity declining
    if (dna?.trends.integrity === 'declining') {
      shouldAct = true;
      reasoningParts.push(`DNA integrity is declining (overall: ${dna.overallIntegrity}%).`);
      const weakestSection = dna.sectionScores.sort((a, b) => a.integrity - b.integrity)[0];
      if (weakestSection) {
        proposedActions.push({
          type: 'STRENGTHEN_DNA',
          title: `Strengthen ${weakestSection.section} DNA`,
          rationale: `Weakest section at ${weakestSection.integrity}% integrity, dragging down genome quality.`,
          expectedImpact: 'MEDIUM',
          confidence: 0.7,
          requiresApproval: false,
          affectedDomains: [weakestSection.section],
        });
      }
    }

    // Check 3: Low DNA integrity overall
    if (dna && dna.overallIntegrity < 50) {
      shouldAct = true;
      reasoningParts.push(`Overall DNA integrity is low (${dna.overallIntegrity}%).`);
      proposedActions.push({
        type: 'GENOME_SETUP',
        title: 'Guide business genome setup',
        rationale: `Genome integrity below 50% significantly limits autonomous operations.`,
        expectedImpact: 'HIGH',
        confidence: 0.8,
        requiresApproval: false,
        affectedDomains: ['CROSS_DOMAIN'],
      });
    }

    // Check 4: High-value opportunities
    const topOpportunities = opps.filter((o) => o.potentialImpact === 'HIGH' && o.confidence >= 0.6);
    if (topOpportunities.length > 0) {
      shouldAct = true;
      reasoningParts.push(`${topOpportunities.length} high-value opportunity(ies) available.`);
      for (const opp of topOpportunities.slice(0, 2)) {
        proposedActions.push({
          type: 'PURSUE_OPPORTUNITY',
          title: opp.label,
          rationale: `Estimated value score ${opp.estimatedValueScore} with ${Math.round(opp.confidence * 100)}% confidence.`,
          expectedImpact: opp.potentialImpact,
          confidence: opp.confidence,
          requiresApproval: auto?.tier !== 'full',
          affectedDomains: opp.affectedDomains,
        });
      }
    }

    // Check 5: Unchecked positive signals
    const positiveSignals = sigs.filter(
      (s) => s.confidence >= 0.75 && (s.signalType === 'REVENUE_PATTERN' || s.signalType === 'CUSTOMER_PATTERN'),
    );
    if (positiveSignals.length > 0 && !shouldAct) {
      shouldAct = true;
      reasoningParts.push(`${positiveSignals.length} positive pattern(s) detected that could be actioned.`);
      for (const sig of positiveSignals.slice(0, 2)) {
        proposedActions.push({
          type: 'ACT_ON_SIGNAL',
          title: `Act on ${sig.signalType} in ${sig.domain}`,
          rationale: `Positive signal with ${Math.round(sig.confidence * 100)}% confidence: ${sig.reason}`,
          expectedImpact: 'MEDIUM',
          confidence: sig.confidence,
          requiresApproval: auto?.tier === 'manual',
          affectedDomains: [sig.domain],
        });
      }
    }

    // Final autonomy check: if manual tier, suggest actions but require approval
    if (auto?.tier === 'manual' && proposedActions.length > 0) {
      reasoningParts.push('All actions require manual approval due to current autonomy tier.');
    }

    // If no specific triggers but genome is healthy, still suggest a wellness check
    if (!shouldAct && dna && dna.overallIntegrity >= 60) {
      reasoningParts.push('Genome is healthy; no immediate action required. Periodic wellness check recommended.');
    }

    const result = {
      shouldAct,
      actions: proposedActions,
      reason: reasoningParts.join(' ') || 'No actionable conditions detected.',
    };

    this.logEvent(businessId, 'proactive_decision', {
      shouldAct,
      actionCount: proposedActions.length,
      autonomyTier: auto?.tier ?? 'unknown',
      signalCount: sigs.length,
      opportunityCount: opps.length,
      dnaIntegrity: dna?.overallIntegrity ?? 0,
    });

    return result;
  }

  // =========================================================================
  // 11. enrichContextWithGenome -- Add genome intelligence to any context
  // =========================================================================

  async enrichContextWithGenome(
    businessId: string,
    baseContext: Record<string, unknown> = {},
  ): Promise<EnrichedContext> {
    this.logger.debug(`[enrichContextWithGenome] businessId=${businessId}`);

    if (!this.recommendation) throw new Error('Genome recommendation service not available');
    if (!this.signal) throw new Error('Genome signal service not available');
    if (!this.autonomyGate) throw new Error('Genome autonomy gate service not available');

    const [dnaScores, recommendations, signals, autonomy] = await Promise.allSettled([
      this.blueprint.calculateGenomeIntegrity(businessId),
      this.recommendation.listRecommendations(businessId, { status: 'ACTIVE', limit: 5 }),
      this.signal.listSignals(businessId, { limit: 5 }),
      this.autonomyGate.checkGate({
        businessId,
        actionType: 'context_enrichment',
      }),
    ]);

    const dna = dnaScores.status === 'fulfilled' ? dnaScores.value : null;
    const recs = recommendations.status === 'fulfilled' ? recommendations.value : [];
    const sigs = signals.status === 'fulfilled' ? signals.value : [];
    const auto = autonomy.status === 'fulfilled' ? autonomy.value : null;

    // Map autonomy gate decision to tier string
    const autonomyTier = auto?.decision === 'ALLOW'
      ? 'full'
      : auto?.decision === 'ALLOW_WITH_APPROVAL'
        ? 'supervised'
        : 'manual';

    const enriched: EnrichedContext = {
      genome: {
        dnaIntegrity: dna?.genomeIntegrity ?? 0,
        stage: dna?.genomeStage ?? 'UNKNOWN',
        topRecommendations: recs.map((r) => ({
          title: r.title,
          domain: r.domain,
          confidence: r.confidence,
        })),
        recentSignals: sigs.map((s) => ({
          type: s.signalType,
          domain: s.domain,
          confidence: s.confidence,
        })),
        autonomyTier,
        overallRisk: auto?.riskLevel ?? 'UNKNOWN',
      },
      baseContext,
      enrichedAt: new Date().toISOString(),
    };

    return enriched;
  }

  // =========================================================================
  // 12. reportActionOutcome -- Report KEY action outcome back to genome
  // =========================================================================

  async reportActionOutcome(
    businessId: string,
    action: string,
    result: 'success' | 'error' | 'ignored',
    details?: Record<string, unknown>,
  ): Promise<void> {
    this.logger.debug(`[reportActionOutcome] businessId=${businessId} action=${action} result=${result}`);

    if (!this.outcomeLearning) throw new Error('Genome outcome learning service not available');
    if (!this.signal) throw new Error('Genome signal service not available');

    // Update outcome learning
    await this.outcomeLearning.recordActionOutcome(
      businessId,
      action,
      result === 'success' ? 'EXECUTED' : result === 'error' ? 'FAILED' : 'BLOCKED',
      details ?? null,
    ).catch((err) => {
      this.logger.warn(`[reportActionOutcome] Outcome learning record failed: ${(err as Error).message}`);
    });

    // Create evidence if successful
    if (result === 'success') {
      await this.evidenceService?.createEvidence?.(businessId, {
        sourceModule: 'key_cortex',
        sourceEntityType: 'KeyActionOutcome',
        summary: `KEY action "${action}" completed successfully. ${details?.summary ?? ''}`,
        evidenceStrength: 0.75,
      }).catch(() => {
        // Evidence service may not be available yet
      });

      // If the action had a significant positive outcome, create a positive signal
      const impactScore = details?.impactScore as number | undefined;
      if (impactScore && impactScore > 0.7) {
        await this.signal.createSignal({
          businessId,
          sourceModule: 'key_autonomy',
          sourceEntityType: 'KeyActionOutcome',
          signalType: 'REVENUE_PATTERN',
          section: 'business',
          domain: action,
          reason: `High-impact KEY action outcome: ${action} scored ${impactScore}`,
          confidence: Math.min(1, impactScore),
        }).catch(() => {
          // Signal creation is best-effort
        });
      }
    }

    // Update genome signals if needed for error cases
    if (result === 'error') {
      await this.signal.createSignal({
        businessId,
        sourceModule: 'key_autonomy',
        sourceEntityType: 'KeyActionOutcome',
        signalType: 'RISK_PATTERN',
        section: 'operations',
        domain: action,
        reason: `KEY action "${action}" failed: ${details?.errorMessage ?? 'Unknown error'}`,
        confidence: 0.6,
      }).catch(() => {
        // Signal creation is best-effort
      });
    }

    this.logEvent(businessId, 'action_outcome_reported', {
      action,
      result,
      details: details ? Object.keys(details) : [],
    });
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  /**
   * Safely log an event through the event service if available.
   */
  private logEvent(
    businessId: string,
    type: string,
    payload: Record<string, unknown>,
  ): void {
    try {
      this.eventService?.emit?.(businessId, `genome_bridge.${type}`, payload).catch(() => {
        // Silently ignore event emission failures
      });
    } catch {
      // Event service may not be available yet
    }
  }
}
