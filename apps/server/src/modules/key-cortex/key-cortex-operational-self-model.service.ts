import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  CapabilityContractService,
  type CapabilityDefinition,
} from '../capabilities/capability-contract.service';
import { KeyCortexMetacognitionService } from './key-cortex-metacognition.service';
import type { SelfModel } from './key-cortex-consciousness.types';

export type OperationalSelfModelSectionName =
  | 'goals'
  | 'pendingDecisions'
  | 'metacognition';

export type OperationalSelfModelSectionState =
  | { status: 'available' }
  | { status: 'unavailable'; error: string };

export interface OperationalSelfModelGoal {
  id: string;
  title: string;
  status: string;
  priority: number;
  targetDate: string | null;
}

export interface OperationalSelfModelPendingDecision {
  id: string;
  status: string;
  capabilityName: string | null;
  riskLevel: string;
  createdAt: string;
}

export type OperationalSelfModelMetacognition = Pick<
  SelfModel,
  | 'recommendationAccuracy'
  | 'actionSuccessRate'
  | 'userApprovalRate'
  | 'predictionAccuracy'
  | 'knowledgeGaps'
  | 'dataGaps'
>;

export interface OperationalSelfModel {
  identity: {
    agent: 'KEY';
    stableAcrossProviders: true;
  };
  scope: {
    businessId: string;
    userId?: string;
  };
  capabilities: {
    total: number;
    byOwner: Record<string, number>;
    byFamily: Record<string, number>;
    byRiskTier: Record<string, number>;
    sample: Array<
      Pick<CapabilityDefinition, 'name' | 'ownerModule' | 'family' | 'riskTier'>
    >;
  };
  goals: OperationalSelfModelGoal[] | null;
  pendingDecisions: OperationalSelfModelPendingDecision[] | null;
  byRiskLevel: Record<string, number> | null;
  metacognition: OperationalSelfModelMetacognition | null;
  sections: Record<OperationalSelfModelSectionName, OperationalSelfModelSectionState>;
  unavailableSections: OperationalSelfModelSectionName[];
  limitations: string[];
  generatedAt: string;
}

const ACTIVE_GOAL_STATUSES = ['ACTIVE', 'PLANNED', 'IN_PROGRESS'] as const;

function sanitizeSectionError(
  section: OperationalSelfModelSectionName,
  reason: unknown,
): string {
  const code =
    typeof reason === 'object' &&
    reason !== null &&
    'code' in reason &&
    typeof (reason as { code?: unknown }).code === 'string'
      ? (reason as { code: string }).code
      : undefined;
  if (code && /^P\d{4}$/.test(code)) {
    return `${section} data source unavailable (Prisma ${code})`;
  }
  return `${section} data source unavailable`;
}

function diagnosticMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return String(reason);
}

/**
 * Read-only operational projection of KEY's current self-state.
 *
 * This service deliberately owns no authoritative state. It composes existing
 * semantic owners so KEY can answer "what can I do, in what scope, with what
 * limitations?" without creating another identity or capability database.
 *
 * D-141:
 *   - Uses uppercase AiGoal statuses ('ACTIVE', 'PLANNED', 'IN_PROGRESS').
 *   - Projects KeyActionProposal.riskLevel (not non-existent riskTier) and
 *     summarizes pending proposals by riskLevel.
 *   - Never swallows Prisma/dependency failures as empty arrays; each section
 *     is evaluated via Promise.allSettled and reports explicit unavailable state
 *     when its backing read rejects.
 */
@Injectable()
export class KeyCortexOperationalSelfModelService {
  private readonly logger = new Logger(KeyCortexOperationalSelfModelService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CapabilityContractService)
    private readonly capabilityContracts: CapabilityContractService,
    @Inject(KeyCortexMetacognitionService)
    private readonly metacognition: KeyCortexMetacognitionService,
  ) {}

  async build(businessId: string, userId?: string): Promise<OperationalSelfModel> {
    const [goalsResult, proposalsResult, metacognitionResult] =
      await Promise.allSettled([
        this.prisma.client.aiGoal.findMany({
          where: {
            businessId,
            status: { in: [...ACTIVE_GOAL_STATUSES] },
          },
          orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
          take: 10,
          select: {
            id: true,
            title: true,
            status: true,
            priority: true,
            targetDate: true,
          },
        }),
        this.prisma.client.keyActionProposal.findMany({
          where: { businessId, status: 'PENDING' },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            status: true,
            capabilityName: true,
            riskLevel: true,
            createdAt: true,
          },
        }),
        this.metacognition.buildSelfModel(businessId),
      ]);

    const stats = this.capabilityContracts.stats();
    const definitions = this.capabilityContracts.list();
    const limitations: string[] = [];
    const unavailableSections: OperationalSelfModelSectionName[] = [];

    let goals: OperationalSelfModelGoal[] | null = null;
    let goalsSection: OperationalSelfModelSectionState;
    if (goalsResult.status === 'fulfilled') {
      goalsSection = { status: 'available' };
      goals = goalsResult.value.map((goal) => ({
        id: goal.id,
        title: goal.title,
        status: goal.status,
        priority: goal.priority,
        targetDate: goal.targetDate ? new Date(goal.targetDate).toISOString() : null,
      }));
    } else {
      this.logger.warn(
        `[OperationalSelfModel] goals unavailable for business=${businessId}: ${diagnosticMessage(goalsResult.reason)}`,
      );
      const error = sanitizeSectionError('goals', goalsResult.reason);
      goalsSection = { status: 'unavailable', error };
      unavailableSections.push('goals');
      limitations.push(`Section "goals" is unavailable: ${error}.`);
    }

    let pendingDecisions: OperationalSelfModelPendingDecision[] | null = null;
    let byRiskLevel: Record<string, number> | null = null;
    let pendingDecisionsSection: OperationalSelfModelSectionState;
    if (proposalsResult.status === 'fulfilled') {
      pendingDecisionsSection = { status: 'available' };
      const counts: Record<string, number> = {};
      pendingDecisions = proposalsResult.value.map((proposal) => {
        counts[proposal.riskLevel] = (counts[proposal.riskLevel] ?? 0) + 1;
        return {
          id: proposal.id,
          status: proposal.status,
          capabilityName: proposal.capabilityName ?? null,
          riskLevel: proposal.riskLevel,
          createdAt: new Date(proposal.createdAt).toISOString(),
        };
      });
      byRiskLevel = counts;
    } else {
      this.logger.warn(
        `[OperationalSelfModel] pendingDecisions unavailable for business=${businessId}: ${diagnosticMessage(proposalsResult.reason)}`,
      );
      const error = sanitizeSectionError('pendingDecisions', proposalsResult.reason);
      pendingDecisionsSection = { status: 'unavailable', error };
      unavailableSections.push('pendingDecisions');
      limitations.push(`Section "pendingDecisions" is unavailable: ${error}.`);
    }

    let metacognition: OperationalSelfModelMetacognition | null = null;
    let metacognitionSection: OperationalSelfModelSectionState;
    if (metacognitionResult.status === 'fulfilled') {
      metacognitionSection = { status: 'available' };
      const model = metacognitionResult.value;
      metacognition = {
        recommendationAccuracy: model.recommendationAccuracy,
        actionSuccessRate: model.actionSuccessRate,
        userApprovalRate: model.userApprovalRate,
        predictionAccuracy: model.predictionAccuracy,
        knowledgeGaps: model.knowledgeGaps,
        dataGaps: model.dataGaps,
      };
      if (model.knowledgeGaps.length > 0) {
        limitations.push(
          `Known knowledge gaps: ${model.knowledgeGaps.slice(0, 3).join('; ')}`,
        );
      }
      if (model.dataGaps.length > 0) {
        limitations.push(
          `Known data gaps: ${model.dataGaps.slice(0, 3).join('; ')}`,
        );
      }
    } else {
      this.logger.warn(
        `[OperationalSelfModel] metacognition unavailable for business=${businessId}: ${diagnosticMessage(metacognitionResult.reason)}`,
      );
      const error = sanitizeSectionError('metacognition', metacognitionResult.reason);
      metacognitionSection = { status: 'unavailable', error };
      unavailableSections.push('metacognition');
      limitations.push(`Section "metacognition" is unavailable: ${error}.`);
    }

    // Homeostasis currently performs active body sensing. R1-D is a request-safe
    // read projection, so it must not trigger that background-grade fan-out.
    // Be explicit rather than inventing a healthy default.
    limitations.push(
      'Operational health is not sampled on this request path; health-aware action admission remains a separate control.',
    );

    return {
      identity: {
        agent: 'KEY',
        stableAcrossProviders: true,
      },
      scope: {
        businessId,
        ...(userId ? { userId } : {}),
      },
      capabilities: {
        total: stats.total,
        byOwner: stats.byOwner,
        byFamily: stats.byFamily,
        byRiskTier: stats.byRiskTier,
        sample: definitions.slice(0, 25).map((definition) => ({
          name: definition.name,
          ownerModule: definition.ownerModule,
          family: definition.family,
          riskTier: definition.riskTier,
        })),
      },
      goals,
      pendingDecisions,
      byRiskLevel,
      metacognition,
      sections: {
        goals: goalsSection,
        pendingDecisions: pendingDecisionsSection,
        metacognition: metacognitionSection,
      },
      unavailableSections,
      limitations,
      generatedAt: new Date().toISOString(),
    };
  }
}
