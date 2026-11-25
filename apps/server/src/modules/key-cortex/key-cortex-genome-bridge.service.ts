import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import {
  autonomyMapForReader,
  GENOME_RECOMMENDATION_POOL,
  GENOME_RECOMMENDATIONS_SERVED,
  GENOME_SIGNAL_POOL,
  GENOME_SIGNALS_SERVED,
  genomeRecommendationsForReader,
  readinessFromVisibleDna,
} from './genome-context-for-reader';
import { PrismaService } from '../../core/prisma/prisma.service';
import { KeyCortexEventService, actionResultOf, type KeyActionResult, type KeyCortexClaim } from './key-cortex-event.service';
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
import { dnaScoresForReader, isFinanceRecommendation, isFinanceSignal, isMoneyLabel } from '../business-genome/key-genome/genome-finance-scope';

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
  /**
   * FU-KEY-GENOME-READS-RESIDUAL round 8 (D-235): the newest NEW signals, of which `signals` are the first
   * GENOME_SIGNALS_SERVED. Unprojected business data, read only to project the signals for a reader without revenue read.
   */
  signalPool?: Array<Record<string, unknown>>;
  /** D-235 round 9: the top-ranked recommendations, of which `recommendations` are the first GENOME_RECOMMENDATIONS_SERVED. */
  recommendationPool?: Array<Record<string, unknown>>;
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
  /** What became of the action: it ran (success, error, partial) or never ran (pending_approval, blocked, skipped). */
  result: KeyActionResult;
  approvalRequired: boolean;
  details?: Record<string, unknown>;
  /** The turn or command the action ran in (business_events.correlation_id of its observation). */
  correlationId?: string;
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

  async getGenomeIntelligence(
    businessId: string,
    options: { readsRevenue?: boolean } = {},
  ): Promise<GenomeIntelligence> {
    const readsRevenue = options.readsRevenue !== false;
    const genome = await this.prisma.client.businessGenome.findUnique({ where: { businessId } });
    const rawDnaScores = (genome?.dnaScores as Record<string, number>) ?? {};
    const dnaScores = readsRevenue
      ? rawDnaScores
      : (dnaScoresForReader(rawDnaScores, false) as Record<string, number>);
    const stage = readsRevenue ? ((genome?.stage as string) ?? 'unknown') : 'restricted';
    const readiness = readsRevenue
      ? ((genome?.executiveReadiness as number) ?? 0)
      : readinessFromVisibleDna(dnaScores);

    // Load real signals, recommendations, opportunities, and readiness in parallel
    // Round 8 (D-235): the signals are read once as a pool, so a reader without revenue read is projected from more than
    // what is left of the newest twenty; the signals are its first twenty, as before.
    // W11-GENOME-RECS-DOMAIN (D-128/D-100): without revenue:read, skip the ranker
    // (which calls ensureSnapshot -> computeCrossDomainSnapshot and persists
    // CROSS_DOMAIN_GENOME memory events), opportunities, and cross-domain snapshot,
    // and read stored recommendations purely read-only with full-row finance filtering.
    const [signalPool, ranked, storedRecs, opportunities, crossDomain, rawModuleReadiness] =
      await Promise.all([
        this.loadSignals(businessId, { limit: GENOME_SIGNAL_POOL }),
        readsRevenue
          ? this.loadRankedRecommendations(businessId, GENOME_RECOMMENDATION_POOL)
          : Promise.resolve([]),
        readsRevenue
          ? Promise.resolve([])
          : this.loadStoredRecommendationsForNonRevenueReader(businessId, GENOME_RECOMMENDATION_POOL),
        readsRevenue ? this.loadOpportunities(businessId, 5) : Promise.resolve([]),
        readsRevenue ? this.loadCrossDomainSnapshot(businessId) : Promise.resolve(null),
        this.loadModuleReadiness(businessId),
      ]);

    const moduleReadiness = readsRevenue
      ? rawModuleReadiness
      : rawModuleReadiness.filter((m) => !isMoneyLabel(m.module));
    const rawAutonomyMap = this.buildAutonomyMap(moduleReadiness);
    const autonomyMap = readsRevenue ? rawAutonomyMap : autonomyMapForReader(rawAutonomyMap);

    const bridgedSignals = signalPool.map((s) => this.toBridgeSignal(s));
    const visibleSignals = readsRevenue
      ? bridgedSignals
      : bridgedSignals
          .filter(
            (s) =>
              s.isFinance !== true &&
              !isFinanceSignal({
                sourceModule: s.module as string | undefined,
                section: s.section as string | undefined,
                domain: s.domain as string | undefined,
                signalType: s.type as string | undefined,
                message: s.message,
              }),
          )
          .map(({ isFinance: _f, ...sig }) => sig);

    const visibleRecs = readsRevenue
      ? ranked.map((r) => this.toBridgeRecommendation(r))
      : storedRecs;

    return {
      businessId,
      dnaScores,
      genomeStage: stage,
      executiveReadiness: readiness,
      stage,
      readiness: moduleReadiness,
      // Round 9 (D-235): ranked once as a pool; the recommendations are its first ten, as before (the ranker sorts, then
      // takes the limit, so they are the same rows a limit of ten gives).
      recommendations: visibleRecs.slice(0, GENOME_RECOMMENDATIONS_SERVED),
      recommendationPool: visibleRecs,
      signals: visibleSignals.slice(0, GENOME_SIGNALS_SERVED),
      signalPool: visibleSignals,
      crossDomainInsights: crossDomain,
      opportunities: readsRevenue ? opportunities.map((o) => this.toBridgeOpportunity(o)) : [],
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
    return { ...input, id: created.id, businessId, status: 'PENDING' };
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
      // FU-KEY-EVENT-COLUMNS review (KEC-COR-1): the row says what became of the action (a pending approval, a block
      // or a skip is not a failure) and is on the action's correlation. The correlation id is its column, not a
      // parameter; the writer keeps the rest of the details only where they are allowed (the description, the
      // tool's data and the timestamp are withheld by name).
      const parameters = Object.fromEntries(Object.entries(outcome.details ?? {}).filter(([key]) => key !== 'correlationId'));
      await this.eventService
        .logActionExecuted(businessId, {
          module: outcome.module,
          source: 'key_cortex',
          action: outcome.action,
          parameters,
          result: outcome.result,
          executionTimeMs: 0,
          correlationId: outcome.correlationId,
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

  /**
   * Attach a piece of KEY's evidence to the genome, and keep it as KEY's cortex claim (owner ruling D-220,
   * FU-KEY-EVENT-COLUMNS).
   *
   * The genome's evidence store (GenomeEvidenceService, wired in production) is tried first, as before. The claim
   * itself (a pattern KEY detected, an action outcome, positive feedback, a DNA proposal) is then kept in
   * business_events through KeyCortexEventService.recordClaim, with or without the genome store: one row, its free
   * text (the description, a recommendation, a recipient) withheld by name. It used to fall back to
   * KeyCortexEvidenceService.createEvidence, which refuses every cortex claim (the `evidence` table is the business's
   * proof list, V61-07), so without the genome store the claim was lost and the caller's next step skipped. A claim
   * that cannot be kept is logged and costs nothing else.
   */
  async createEvidence(
    businessId: string,
    evidence: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    this.logger.debug(`[createEvidence] ${businessId}`);

    let attached: Record<string, unknown> | undefined;
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
        attached = created as unknown as Record<string, unknown>;
      } catch (err: any) {
        this.logger.warn(
          `[createEvidence] Genome evidence attach failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    let claim: Record<string, unknown> | undefined;
    if (this.eventService) {
      try {
        claim = (await this.eventService.recordClaim(businessId, cortexClaimOf(evidence))) as unknown as Record<string, unknown>;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const reason = message.split('\n').map((line) => line.trim()).filter(Boolean).pop() ?? 'unknown error';
        this.logger.warn(`[createEvidence] Cortex claim not kept: ${reason.slice(0, 300)}`);
      }
    }

    return attached ?? claim ?? { id: `ev_${Date.now()}`, businessId, ...evidence };
  }

  /**
   * Report what became of an action KEY ran (or was asked to run): kept once as its ACTION_EXECUTED observation, and,
   * when it succeeded, as KEY's cortex_action claim (D-220).
   *
   * FU-KEY-EVENT-COLUMNS review (KEC-COR-1): every caller (command execution, the query pipeline's processQuery and
   * streamQuery, reasoning, interaction, evolution) sends `{ actionId, status, description, result: the tool's data,
   * timestamp, correlationId }`. This read `outcome.result === 'success'` and `outcome.action`, which none of them
   * sends, so a real success was kept as a failed action called 'unknown' and its claim was never written. The status
   * is the outcome (actionResultOf; `result` is read as one only when it is a status word, as an older shape sent it),
   * the action is named by `action` or else `actionId`, and the correlation id goes to both rows.
   */
  async reportActionOutcome(
    businessId: string,
    outcome: Record<string, unknown>,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    this.logger.debug(`[reportActionOutcome] ${businessId}`);

    const result = actionResultOf(outcome.status) ?? actionResultOf(outcome.result) ?? 'error';
    const named = (value: unknown) => (typeof value === 'string' && value.trim() ? value : undefined);
    const action = named(outcome.action) ?? named(outcome.actionId) ?? 'unknown';
    const correlationId = named(metadata?.correlationId) ?? named(outcome.correlationId);

    // Record outcome for learning
    await this.recordOutcome(businessId, {
      success: result === 'success',
      module: String(outcome.module ?? 'key_cortex'),
      action,
      result,
      approvalRequired: result === 'pending_approval',
      details: { ...outcome, ...metadata },
      correlationId,
    });

    // Create evidence for successful actions
    if (result === 'success') {
      await this.createEvidence(businessId, {
        sourceModule: String(outcome.module ?? 'key_cortex'),
        sourceEntityType: 'cortex_action',
        sourceEntityId: action,
        description: `KEY executed ${action}: ${outcome.description ?? ''}`,
        evidenceStrength: 0.8,
        occurredAt: new Date().toISOString(),
        ...(correlationId ? { correlationId } : {}),
        ...metadata,
      }).catch(() => undefined);
    }

    // The outcome's ACTION_EXECUTED observation is recordOutcome's (above): logging it here too kept every outcome
    // twice once the event writer could write (FU-KEY-EVENT-COLUMNS).
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
    options: { readsRevenue?: boolean } = {},
  ): Promise<Record<string, unknown>> {
    const genome = await this.getGenomeIntelligence(businessId, options);
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

  /**
   * W11-GENOME-RECS-DOMAIN (D-128/D-100): read non-finance recommendations directly
   * from stored rows without invoking rankerService (which computes/writes a finance
   * cross-domain snapshot and CROSS_DOMAIN_GENOME memory events, and embeds money-weighted
   * financialViability/rankScore). Filters the full stored row (including diagnosis)
   * before mapping and projects through genomeRecommendationsForReader.
   */
  private async loadStoredRecommendationsForNonRevenueReader(
    businessId: string,
    limit: number,
  ): Promise<Array<Record<string, unknown>>> {
    const repo = this.prisma.client.genomeRecommendation;
    if (!repo || typeof repo.findMany !== 'function') return [];
    try {
      const rows = await repo.findMany({
        where: {
          businessId,
          status: { in: ['ACTIVE', 'ACCEPTED', 'APPLIED'] },
        },
        orderBy: [
          { expectedGainScore: 'desc' },
          { confidence: 'desc' },
          { createdAt: 'desc' },
        ],
        take: 200,
      });
      const safeBridged = rows
        .filter(
          (r) =>
            !isFinanceRecommendation({
              domain: r.domain,
              title: r.title,
              diagnosis: r.diagnosis,
            }),
        )
        .map((r) => ({
          id: r.id,
          title: r.title,
          description: r.recommendation,
          impact: r.riskLevel?.toLowerCase() ?? 'medium',
          category: r.domain,
          confidence: r.confidence,
        }));
      return genomeRecommendationsForReader(safeBridged, false).slice(0, limit);
    } catch (err: unknown) {
      this.logger.warn(
        `[loadStoredRecommendationsForNonRevenueReader] Failed: ${err instanceof Error ? err.message : String(err)}`,
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
      // FU-KEY-CHAT-GENOME-MONEY-SIGHT (BLOCKING-1): the finance rule (isFinanceSignal) reads these too.
      section: signal.section ?? null,
      domain: signal.domain ?? null,
      // CODEX-228 MAJOR-2: classify on the full stored row (field, evidence, proposedValue, sourceEntityType)
      // before projecting to the compact bridge shape, so money beyond truncated reason or in evidence/proposedValue
      // is withheld consistently with REST projections.
      isFinance: isFinanceSignal(signal),
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

const isClaimObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * FU-KEY-EVENT-COLUMNS (D-220): the cortex claim a piece of genome-bridge evidence makes. Its kind is the evidence's
 * `type` (pattern_detection, action_outcome, user_feedback_positive, dna_influence_proposal) or its source entity type
 * (cortex_action, from reportActionOutcome); its subject the pattern, proposal or action it names; its correlation and
 * session ids go to their columns; everything else is offered as details, which the event writer keeps only where
 * it is an allowed field (the description and every other free text are withheld).
 */
function cortexClaimOf(evidence: Record<string, unknown>): KeyCortexClaim {
  const nested = isClaimObject(evidence.metadata) ? evidence.metadata : {};
  const kind =
    typeof evidence.type === 'string' ? evidence.type
      : typeof evidence.sourceEntityType === 'string' ? evidence.sourceEntityType
        : 'cortex_claim';
  const details: Record<string, unknown> = {};
  for (const [key, value] of Object.entries({ ...evidence, ...nested })) {
    if (['type', 'source', 'metadata', 'correlationId', 'sessionId'].includes(key)) continue;
    details[key] = value;
  }
  const id = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
  const subjectId =
    kind === 'pattern_detection' ? id(nested.patternId)
      : kind === 'dna_influence_proposal' ? id(nested.proposalId)
        : kind === 'action_outcome' ? id(nested.actionType)
          : kind === 'cortex_action' ? id(evidence.sourceEntityId)
            : undefined;
  const subjectType =
    kind === 'pattern_detection' ? 'pattern'
      : kind === 'dna_influence_proposal' ? 'genome_proposal'
        : 'cortex_action';
  return {
    kind,
    source: 'key_cortex',
    subject: subjectId ? { type: subjectType, id: subjectId } : undefined,
    details,
    correlationId: id(nested.correlationId) ?? id(evidence.correlationId),
    sessionId: id(nested.sessionId) ?? id(evidence.sessionId),
  };
}
