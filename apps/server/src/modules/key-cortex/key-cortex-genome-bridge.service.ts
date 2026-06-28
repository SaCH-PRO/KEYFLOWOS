import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { KeyCortexEventService } from './key-cortex-event.service';
import { KeyCortexEvidenceService } from './key-cortex-evidence.service';

// Key Genome domain services (optional — graceful degradation)
import { GenomeRecommendationRankerService } from '../business-genome/key-genome/genome-recommendation-ranker.service';
import { GenomeAutonomyGateService } from '../business-genome/key-genome/genome-autonomy-gate.service';
import { GenomeOpportunityDetectorService } from '../business-genome/key-genome/genome-opportunity-detector.service';
import { GenomeCrossDomainService } from '../business-genome/key-genome/genome-cross-domain.service';
import { GenomeSignalService } from '../business-genome/key-genome/genome-signal.service';
import { GenomeModuleReadinessService } from '../business-genome/key-genome/genome-module-readiness.service';
import { GenomeEvidenceService } from '../business-genome/key-genome/genome-evidence.service';
import { GenomeRecommendationOutcomeService } from '../business-genome/key-genome/genome-recommendation-outcome.service';
import { GenomeOutcomeLearningService } from '../business-genome/key-genome/genome-outcome-learning.service';
import {
  GenomeCrossDomainDomainKey,
  GenomeRankedRecommendation,
} from '../business-genome/key-genome/key-genome.types';

export interface GenomeIntelligence {
  businessId: string;
  dnaScores: Record<string, number>;
  genomeStage: string;
  executiveReadiness: number;
  stage: string;
  readiness: Array<{
    module: string;
    readinessScore: number;
    automationAllowed: boolean;
    riskLevel: string;
  }>;
  recommendations: Array<Record<string, unknown>>;
  signals: Array<Record<string, unknown>>;
  crossDomainInsights: Record<string, unknown> | null;
  opportunities: Array<Record<string, unknown>>;
  generatedAt: string;
  autonomyMap: Record<string, boolean>;
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
  gateResult: Record<string, unknown>;
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
  module: string;
  action: string;
  result: 'success' | 'error' | 'partial';
  approvalRequired: boolean;
  details?: Record<string, unknown>;
}

interface DnaScores {
  scores: Record<string, number>;
  confidence: Record<string, number>;
  stage: string;
  executiveReadiness: number;
}

@Injectable()
export class KeyCortexGenomeBridgeService {
  private readonly logger = new Logger(KeyCortexGenomeBridgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(KeyCortexEventService) private readonly eventService?: KeyCortexEventService,
    @Optional() @Inject(KeyCortexEvidenceService) private readonly evidenceService?: KeyCortexEvidenceService,

    // Key Genome domain services (optional for graceful degradation)
    @Optional() @Inject(GenomeRecommendationRankerService)
    private readonly rankerService?: GenomeRecommendationRankerService,
    @Optional() @Inject(GenomeAutonomyGateService)
    private readonly autonomyGateService?: GenomeAutonomyGateService,
    @Optional() @Inject(GenomeOpportunityDetectorService)
    private readonly opportunityDetectorService?: GenomeOpportunityDetectorService,
    @Optional() @Inject(GenomeCrossDomainService)
    private readonly crossDomainService?: GenomeCrossDomainService,
    @Optional() @Inject(GenomeSignalService)
    private readonly signalService?: GenomeSignalService,
    @Optional() @Inject(GenomeModuleReadinessService)
    private readonly moduleReadinessService?: GenomeModuleReadinessService,
    @Optional() @Inject(GenomeEvidenceService)
    private readonly genomeEvidenceService?: GenomeEvidenceService,
    @Optional() @Inject(GenomeRecommendationOutcomeService)
    private readonly outcomeService?: GenomeRecommendationOutcomeService,
    @Optional() @Inject(GenomeOutcomeLearningService)
    private readonly outcomeLearningService?: GenomeOutcomeLearningService,
  ) {}

  async getGenomeIntelligence(businessId: string): Promise<GenomeIntelligence> {
    const genome = await this.prisma.client.businessGenome.findUnique({ where: { businessId } });
    const dnaScores = (genome?.dnaScores as Record<string, number>) ?? {};
    const stage = (genome?.stage as string) ?? 'unknown';
    const readiness = (genome?.executiveReadiness as number) ?? 0;

    // Load real signals, recommendations, opportunities, and readiness in parallel
    const [signals, ranked, opportunities, crossDomain, moduleReadiness] = await Promise.all([
      this.loadSignals(businessId),
      this.loadRankedRecommendations(businessId, 10),
      this.loadOpportunities(businessId, 5),
      this.loadCrossDomainSnapshot(businessId),
      this.loadModuleReadiness(businessId),
    ]);

    const autonomyMap = this.buildAutonomyMap(moduleReadiness);

    return {
      businessId,
      dnaScores,
      genomeStage: stage,
      executiveReadiness: readiness,
      stage,
      readiness: moduleReadiness,
      recommendations: ranked.map((r) => this.toBridgeRecommendation(r)),
      signals: signals.map((s) => this.toBridgeSignal(s)),
      crossDomainInsights: crossDomain,
      opportunities: opportunities.map((o) => this.toBridgeOpportunity(o)),
      generatedAt: new Date().toISOString(),
      autonomyMap,
    };
  }

  async getDnaScores(businessId: string): Promise<DnaScores> {
    const genome = await this.prisma.client.businessGenome.findUnique({ where: { businessId } });
    const scores = (genome?.dnaScores as Record<string, number>) ?? {};
    return {
      scores,
      confidence: {},
      stage: (genome?.stage as string) ?? 'unknown',
      executiveReadiness: (genome?.executiveReadiness as number) ?? 0,
    };
  }

  async updateDnaScore(
    businessId: string,
    section: string,
    score: number,
    reason?: string,
  ): Promise<void> {
    this.logger.debug(`[updateDnaScore] ${businessId} ${section}=${score}`);
    const genome = await this.prisma.client.businessGenome.findUnique({ where: { businessId } });
    const dnaScores = { ...(genome?.dnaScores as Record<string, number> ?? {}), [section]: score };
    await this.prisma.client.businessGenome.upsert({
      where: { businessId },
      create: {
        businessId,
        dnaScores,
        stage: 'active',
        executiveReadiness: score,
      },
      update: {
        dnaScores,
        executiveReadiness: score,
      },
    });

    if (this.eventService) {
      await this.eventService
        .logActionExecuted(businessId, {
          module: 'genome',
          source: 'key_cortex_genome_bridge',
          action: 'update_dna_score',
          parameters: { section, score, reason },
          result: 'success',
          executionTimeMs: 0,
        })
        .catch(() => undefined);
    }
  }

  async getRankedRecommendations(
    businessId: string,
    limit = 5,
    filters?: Record<string, unknown>,
  ): Promise<RankedRecommendation[]> {
    this.logger.debug(`[getRankedRecommendations] ${businessId}`);
    const ranked = await this.loadRankedRecommendations(businessId, limit, filters);
    return ranked.map((r) => this.toBridgeRankedRecommendation(r));
  }

  async checkAutonomy(
    businessId: string,
    action: string,
    params?: Record<string, unknown>,
  ): Promise<AutonomyCheck> {
    this.logger.debug(`[checkAutonomy] ${businessId} action=${action}`);

    if (!this.autonomyGateService) {
      return {
        allowed: false,
        tier: 'manual',
        requiresApproval: true,
        reason: 'Genome autonomy gate service unavailable',
        gateResult: {},
      };
    }

    try {
      const result = await this.autonomyGateService.checkGate({
        businessId,
        actionType: action,
        payload: params ?? {},
        proposedBy: 'key_cortex',
      });

      const decision = result.decision;
      const allowed = decision === 'ALLOW';
      const requiresApproval = decision === 'ALLOW_WITH_APPROVAL';
      const tier: AutonomyCheck['tier'] =
        decision === 'ALLOW' ? 'full' : decision === 'ALLOW_WITH_APPROVAL' ? 'supervised' : 'manual';

      return {
        allowed,
        tier,
        requiresApproval,
        reason: result.blockingReasons.join('; ') || result.approvalReasons.join('; ') || 'Autonomy gate evaluated',
        gateResult: result as unknown as Record<string, unknown>,
      };
    } catch (err: any) {
      this.logger.warn(
        `[checkAutonomy] Gate failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        allowed: false,
        tier: 'manual',
        requiresApproval: true,
        reason: 'Autonomy gate evaluation failed',
        gateResult: { error: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  async triggerEvolution(
    businessId: string,
    evidence: EvolutionEvidence,
  ): Promise<Array<Record<string, unknown>>> {
    this.logger.debug(`[triggerEvolution] ${businessId}`);
    // Persist as an evolution proposal
    const proposal = await this.createEvolutionProposal(businessId, {
      section: evidence.section,
      proposedPatch: evidence.proposedPatch,
      reason: evidence.reason,
      evidence: evidence.evidence,
      confidence: evidence.confidence,
      autoDetect: evidence.autoDetect,
    });
    return [proposal];
  }

  async createEvolutionProposal(
    businessId: string,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    this.logger.debug(`[createEvolutionProposal] ${businessId}`);
    const created = await this.prisma.client.genomeEvolutionProposal.create({
      data: {
        businessId,
        section: (input.section as string) ?? 'general',
        proposedPatch: input.proposedPatch as never,
        reason: (input.reason as string) ?? '',
        evidence: (input.evidence as string[]) ?? [],
        confidence: (input.confidence as number) ?? 0.5,
        status: 'PENDING',
      },
    });
    return { id: created.id, businessId, ...input, status: 'PENDING' };
  }

  async getEvolutionHistory(businessId: string): Promise<Array<Record<string, unknown>>> {
    this.logger.debug(`[getEvolutionHistory] ${businessId}`);
    const rows = await this.prisma.client.genomeEvolutionProposal.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((r: any) => ({
      id: r.id,
      businessId: r.businessId,
      section: r.section,
      proposedPatch: r.proposedPatch,
      reason: r.reason,
      status: r.status,
      createdAt: r.createdAt,
    }));
  }

  async detectOpportunities(businessId: string): Promise<Opportunity[]> {
    this.logger.debug(`[detectOpportunities] ${businessId}`);
    const result = await this.loadOpportunities(businessId, 10);
    return result.map((o) => ({
      id: o.id,
      label: o.label,
      affectedDomains: o.affectedDomains,
      potentialImpact: o.potentialImpact,
      confidence: o.confidence,
      estimatedValueScore: o.estimatedValueScore,
      suggestedAction: o.suggestedAction,
      requiredConditions: o.requiredConditions,
      evidence: o.evidence,
    }));
  }

  async recordOutcome(
    businessId: string,
    outcome: OutcomeRecord,
  ): Promise<void> {
    this.logger.debug(`[recordOutcome] ${businessId}`);

    // Find the most relevant active recommendation to link
    const recommendation = await this.prisma.client.genomeRecommendation.findFirst({
      where: { businessId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });

    if (this.outcomeService && recommendation) {
      try {
        await this.outcomeService.recordOutcome({
          businessId,
          recommendationId: recommendation.id,
          decision: outcome.success ? 'APPLIED' : 'DISMISSED',
          decidedBy: 'key_cortex',
          linkedActionType: outcome.action,
          linkedActionId: outcome.details?.actionId as string | undefined,
        });
      } catch (err: any) {
        this.logger.warn(
          `[recordOutcome] Outcome service failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Also write a CognitionMemory entry for closed-loop learning
    try {
      await this.prisma.client.cognitionMemory.create({
        data: {
          businessId,
          roleId: 'key_cortex',
          query: outcome.action,
          recommendation: `${outcome.module}.${outcome.action}`,
          userResponse: outcome.result,
          actualOutcome: outcome.success ? 'success' : 'error',
          confidence: outcome.success ? 1 : 0,
          lessonsLearned: [outcome.success ? 'Action succeeded' : 'Action failed or was blocked'],
          confidenceDelta: outcome.success ? 0.05 : -0.05,
        },
      });
    } catch (err: any) {
      this.logger.warn(
        `[recordOutcome] CognitionMemory create failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (this.eventService) {
      await this.eventService
        .logActionExecuted(businessId, {
          module: outcome.module,
          source: 'key_cortex',
          action: outcome.action,
          parameters: outcome.details ?? {},
          result: outcome.success ? 'success' : 'error',
          executionTimeMs: 0,
        })
        .catch(() => undefined);
    }
  }

  async createGenomeSignal(
    businessId: string,
    signal: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    this.logger.debug(`[createGenomeSignal] ${businessId}`);
    if (!this.signalService) {
      return { id: `sig_${Date.now()}`, businessId, ...signal };
    }
    const created = await this.signalService.createSignal({
      businessId,
      sourceModule: (signal.sourceModule as string) ?? 'key_cortex',
      sourceEntityType: (signal.sourceEntityType as string) ?? null,
      sourceEntityId: (signal.sourceEntityId as string) ?? null,
      signalType: (signal.signalType as string) ?? 'insight',
      section: (signal.section as string) ?? 'general',
      domain: (signal.domain as string) ?? 'general',
      field: (signal.field as string) ?? null,
      reason: (signal.reason as string) ?? '',
      proposedValue: signal.proposedValue,
      evidence: (signal.evidence as any[]) ?? [],
      confidence: (signal.confidence as number) ?? 0.5,
    });
    return created as unknown as Record<string, unknown>;
  }

  async createSignal(
    businessId: string,
    signal: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.createGenomeSignal(businessId, signal);
  }

  async createEvidence(
    businessId: string,
    evidence: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    this.logger.debug(`[createEvidence] ${businessId}`);

    if (this.genomeEvidenceService) {
      try {
        const created = await this.genomeEvidenceService.attachEvidence({
          businessId,
          factId: (evidence.factId as string) ?? null,
          sourceModule: (evidence.sourceModule as string) ?? 'key_cortex',
          sourceEntityType: (evidence.sourceEntityType as string) ?? 'cortex_action',
          sourceEntityId: (evidence.sourceEntityId as string) ?? null,
          summary: (evidence.description as string) ?? (evidence.summary as string) ?? '',
          evidenceStrength: (evidence.evidenceStrength as number) ?? 0.7,
          occurredAt: evidence.occurredAt ? new Date(evidence.occurredAt as string).toISOString() : new Date().toISOString(),
        });
        return created as unknown as Record<string, unknown>;
      } catch (err: any) {
        this.logger.warn(
          `[createEvidence] Genome evidence attach failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (this.evidenceService) {
      return this.evidenceService.createEvidence({ businessId, ...evidence } as any);
    }

    return { id: `ev_${Date.now()}`, businessId, ...evidence };
  }

  async reportActionOutcome(
    businessId: string,
    outcome: Record<string, unknown>,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    this.logger.debug(`[reportActionOutcome] ${businessId}`);

    // Record outcome for learning
    await this.recordOutcome(businessId, {
      success: (outcome.result as string) === 'success',
      module: String(outcome.module ?? 'key_cortex'),
      action: String(outcome.action ?? 'unknown'),
      result: (outcome.result as 'success' | 'error' | 'partial') ?? 'success',
      approvalRequired: false,
      details: { ...outcome, ...metadata },
    });

    // Create evidence for successful actions
    if ((outcome.result as string) === 'success') {
      await this.createEvidence(businessId, {
        sourceModule: String(outcome.module ?? 'key_cortex'),
        sourceEntityType: 'cortex_action',
        sourceEntityId: String(outcome.actionId ?? ''),
        description: `KEY executed ${outcome.action}: ${outcome.description ?? ''}`,
        evidenceStrength: 0.8,
        occurredAt: new Date().toISOString(),
        ...metadata,
      }).catch(() => undefined);
    }

    // Emit event for monitoring
    if (this.eventService) {
      await this.eventService
        .logActionExecuted(businessId, {
          module: String(outcome.module ?? 'key_cortex'),
          source: String(outcome.source ?? 'key_cortex'),
          action: String(outcome.action ?? 'unknown'),
          parameters: { ...(outcome.parameters as Record<string, unknown> ?? {}), ...metadata },
          result: (outcome.result as 'success' | 'error') ?? 'success',
          executionTimeMs: Number(outcome.executionTimeMs ?? 0),
        })
        .catch(() => undefined);
    }
  }

  async getCrossDomainInsights(businessId: string): Promise<Array<Record<string, unknown>>> {
    this.logger.debug(`[getCrossDomainInsights] ${businessId}`);
    const snapshot = await this.loadCrossDomainSnapshot(businessId);
    return snapshot ? [snapshot] : [];
  }

  async shouldActProactively(businessId: string): Promise<boolean> {
    this.logger.debug(`[shouldActProactively] ${businessId}`);
    const signals = await this.loadSignals(businessId, { limit: 20 });
    const hasCritical = signals.some(
      (s: any) => s.status === 'NEW' && (s.signalType === 'risk' || s.signalType === 'urgent'),
    );
    if (hasCritical) return true;

    const opportunities = await this.loadOpportunities(businessId, 3);
    return opportunities.some((o) => o.potentialImpact === 'HIGH' && o.confidence >= 0.7);
  }

  async enrichContextWithGenome(
    businessId: string,
    context: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const genome = await this.getGenomeIntelligence(businessId);
    return {
      ...context,
      genomeStage: genome.genomeStage,
      executiveReadiness: genome.executiveReadiness,
      dnaScores: genome.dnaScores,
      recommendations: genome.recommendations.slice(0, 5),
      signals: genome.signals.slice(0, 5),
      opportunities: genome.opportunities,
      autonomyMap: genome.autonomyMap,
    };
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async loadSignals(
    businessId: string,
    options: { limit?: number; status?: string } = {},
  ): Promise<any[]> {
    if (!this.signalService) return [];
    try {
      return await this.signalService.listSignals(businessId, {
        status: options.status ?? 'NEW',
        limit: options.limit ?? 20,
      });
    } catch (err: any) {
      this.logger.warn(
        `[loadSignals] Failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  private async loadRankedRecommendations(
    businessId: string,
    limit = 5,
    filters?: Record<string, unknown>,
  ): Promise<GenomeRankedRecommendation[]> {
    if (!this.rankerService) return [];
    try {
      const result = await this.rankerService.rankRecommendations(businessId, {
        limit,
        ...(filters ?? {}),
      });
      return result.rankedRecommendations;
    } catch (err: any) {
      this.logger.warn(
        `[loadRankedRecommendations] Failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  private async loadOpportunities(
    businessId: string,
    limit = 5,
  ): Promise<any[]> {
    if (!this.opportunityDetectorService) return [];
    try {
      const result = await this.opportunityDetectorService.detectOpportunities(businessId, { limit });
      return result.prioritizedOpportunities;
    } catch (err: any) {
      this.logger.warn(
        `[loadOpportunities] Failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  private async loadCrossDomainSnapshot(
    businessId: string,
  ): Promise<Record<string, unknown> | null> {
    if (!this.crossDomainService) return null;
    try {
      const snapshot = await this.crossDomainService.getLatestCrossDomainSnapshot(businessId);
      return snapshot as Record<string, unknown> | null;
    } catch (err: any) {
      this.logger.warn(
        `[loadCrossDomainSnapshot] Failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private async loadModuleReadiness(
    businessId: string,
  ): Promise<Array<{ module: string; readinessScore: number; automationAllowed: boolean; riskLevel: string }>> {
    if (!this.moduleReadinessService) return [];
    try {
      const readiness = await this.moduleReadinessService.getReadiness(businessId);
      const list = Array.isArray(readiness) ? readiness : [];
      return list.map((r: any) => ({
        module: r.module,
        readinessScore: r.readinessScore,
        automationAllowed: r.automationAllowed ?? r.readinessScore >= 70,
        riskLevel: r.riskLevel,
      }));
    } catch (err: any) {
      this.logger.warn(
        `[loadModuleReadiness] Failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  private buildAutonomyMap(
    readiness: Array<{ module: string; readinessScore: number; automationAllowed: boolean }>,
  ): Record<string, boolean> {
    const map: Record<string, boolean> = {};
    for (const r of readiness) {
      map[r.module] = r.automationAllowed;
    }
    return map;
  }

  private toBridgeRecommendation(rec: GenomeRankedRecommendation): Record<string, unknown> {
    return {
      id: rec.id,
      title: rec.title,
      description: rec.recommendation,
      impact: rec.riskLevel?.toLowerCase() ?? 'medium',
      category: rec.domain,
      confidence: rec.confidence,
      genomeScore: rec.rankScore,
    };
  }

  private toBridgeRankedRecommendation(rec: GenomeRankedRecommendation): RankedRecommendation {
    return {
      id: rec.id,
      domain: rec.domain,
      title: rec.title,
      insight: rec.insight,
      recommendation: rec.recommendation,
      confidence: rec.confidence,
      impact: rec.expectedGainScore ?? 50,
      effort: rec.effortLevel,
      rankScore: rec.rankScore,
      rankReason: rec.rankReason,
      riskLevel: rec.riskLevel,
      financialViability: rec.financialViability,
      capacityGating: rec.capacityGating,
      safeToExecute: rec.readinessGating?.blockingDomains?.length === 0,
    };
  }

  private toBridgeSignal(signal: any): Record<string, unknown> {
    return {
      id: signal.id,
      type: signal.signalType ?? 'info',
      message: signal.reason ?? '',
      module: signal.sourceModule ?? 'general',
      severity: this.signalSeverity(signal),
      createdAt: signal.createdAt,
    };
  }

  private signalSeverity(signal: any): string {
    const type = (signal.signalType as string)?.toLowerCase() ?? '';
    if (type.includes('risk') || type.includes('urgent') || type.includes('critical')) return 'high';
    if (type.includes('warning')) return 'medium';
    return 'low';
  }

  private toBridgeOpportunity(opp: any): Record<string, unknown> {
    return {
      id: opp.id,
      title: opp.label,
      estimatedValue: opp.estimatedValueScore ?? 0,
      category: opp.affectedDomains?.join(', ') ?? 'general',
      confidence: opp.confidence,
    };
  }
}
