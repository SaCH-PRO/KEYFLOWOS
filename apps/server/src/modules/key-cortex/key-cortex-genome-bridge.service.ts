import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { KeyCortexEventService } from './key-cortex-event.service';
import { KeyCortexEvidenceService } from './key-cortex-evidence.service';

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
  opportunities: Record<string, unknown> | null;
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
  ) {}

  async getGenomeIntelligence(businessId: string): Promise<GenomeIntelligence> {
    const genome = await this.prisma.client.businessGenome.findUnique({ where: { businessId } });
    const dnaScores = (genome?.dnaScores as Record<string, number>) ?? {};
    const stage = (genome?.stage as string) ?? 'unknown';
    const readiness = (genome?.executiveReadiness as number) ?? 0;
    return {
      businessId,
      dnaScores,
      genomeStage: stage,
      executiveReadiness: readiness,
      stage,
      readiness: [],
      recommendations: [],
      signals: [],
      crossDomainInsights: null,
      opportunities: null,
      generatedAt: new Date().toISOString(),
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
    _reason?: string,
  ): Promise<void> {
    this.logger.debug(`[updateDnaScore] ${businessId} ${section}=${score}`);
  }

  async getRankedRecommendations(
    businessId: string,
    _limit = 5,
    _filters?: Record<string, unknown>,
  ): Promise<RankedRecommendation[]> {
    this.logger.debug(`[getRankedRecommendations] ${businessId}`);
    return [];
  }

  async checkAutonomy(
    businessId: string,
    _action: string,
    _params?: Record<string, unknown>,
  ): Promise<AutonomyCheck> {
    this.logger.debug(`[checkAutonomy] ${businessId}`);
    return {
      allowed: false,
      tier: 'manual',
      requiresApproval: true,
      reason: 'Genome autonomy gate not implemented',
      gateResult: {},
    };
  }

  async triggerEvolution(
    businessId: string,
    _evidence: EvolutionEvidence,
  ): Promise<Array<Record<string, unknown>>> {
    this.logger.debug(`[triggerEvolution] ${businessId}`);
    return [];
  }

  async createEvolutionProposal(
    businessId: string,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    this.logger.debug(`[createEvolutionProposal] ${businessId}`);
    return { id: `gep_${Date.now()}`, businessId, ...input, status: 'PENDING' };
  }

  async getEvolutionHistory(businessId: string): Promise<Array<Record<string, unknown>>> {
    this.logger.debug(`[getEvolutionHistory] ${businessId}`);
    return [];
  }

  async detectOpportunities(businessId: string): Promise<Opportunity[]> {
    this.logger.debug(`[detectOpportunities] ${businessId}`);
    return [];
  }

  async recordOutcome(
    businessId: string,
    _outcome: OutcomeRecord,
  ): Promise<void> {
    this.logger.debug(`[recordOutcome] ${businessId}`);
  }

  async createGenomeSignal(
    businessId: string,
    _signal: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    this.logger.debug(`[createGenomeSignal] ${businessId}`);
    return { id: `sig_${Date.now()}`, businessId };
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
    if (this.evidenceService) {
      return this.evidenceService.createEvidence({ businessId, ...evidence } as any);
    }
    return { id: `ev_${Date.now()}`, businessId, ...evidence };
  }

  async reportActionOutcome(
    businessId: string,
    outcome: Record<string, unknown>,
    _metadata?: Record<string, unknown>,
  ): Promise<void> {
    this.logger.debug(`[reportActionOutcome] ${businessId}`);
    if (this.eventService) {
      await this.eventService.logActionExecuted(
        businessId,
        {
          module: String(outcome.module ?? 'key_cortex'),
          source: String(outcome.source ?? 'key_cortex'),
          action: String(outcome.action ?? 'unknown'),
          parameters: (outcome.parameters as Record<string, unknown>) ?? {},
          result: (outcome.result as 'success' | 'error') ?? 'success',
          executionTimeMs: Number(outcome.executionTimeMs ?? 0),
        },
      ).catch(() => undefined);
    }
  }

  async getCrossDomainInsights(_businessId: string): Promise<Array<Record<string, unknown>>> {
    return [];
  }

  async shouldActProactively(_businessId: string): Promise<boolean> {
    return false;
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
    };
  }
}
