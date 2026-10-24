import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  CapabilityContractService,
  type CapabilityDefinition,
} from '../capabilities/capability-contract.service';
import { KeyCortexMetacognitionService } from './key-cortex-metacognition.service';
import type { SelfModel } from './key-cortex-consciousness.types';

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
    sample: Array<Pick<CapabilityDefinition, 'name' | 'ownerModule' | 'family' | 'riskTier'>>;
  };
  goals: Array<{
    id: string;
    title: string;
    status: string;
    priority: string | number | null;
    targetDate: string | null;
  }>;
  pendingDecisions: Array<{
    id: string;
    status: string;
    capabilityName: string | null;
    riskTier: number | null;
    createdAt: string;
  }>;
  metacognition: Pick<
    SelfModel,
    | 'recommendationAccuracy'
    | 'actionSuccessRate'
    | 'userApprovalRate'
    | 'predictionAccuracy'
    | 'knowledgeGaps'
    | 'dataGaps'
  >;
  limitations: string[];
  generatedAt: string;
}

/**
 * Read-only operational projection of KEY's current self-state.
 *
 * This service deliberately owns no authoritative state. It composes existing
 * semantic owners so KEY can answer "what can I do, in what scope, with what
 * limitations?" without creating another identity or capability database.
 */
@Injectable()
export class KeyCortexOperationalSelfModelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly capabilityContracts: CapabilityContractService,
    private readonly metacognition: KeyCortexMetacognitionService,
  ) {}

  async build(businessId: string, userId?: string): Promise<OperationalSelfModel> {
    const [goals, proposals, metacognitiveModel] = await Promise.all([
      (this.prisma.client as any).aiGoal.findMany({
        where: {
          businessId,
          status: { in: ['active', 'planned', 'in_progress'] },
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
      }).catch(() => []),
      (this.prisma.client as any).keyActionProposal.findMany({
        where: { businessId, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          status: true,
          capabilityName: true,
          riskTier: true,
          createdAt: true,
        },
      }).catch(() => []),
      this.metacognition.buildSelfModel(businessId),
    ]);

    const stats = this.capabilityContracts.stats();
    const definitions = this.capabilityContracts.list();
    const limitations: string[] = [];

    if (metacognitiveModel.knowledgeGaps.length > 0) {
      limitations.push(
        `Known knowledge gaps: ${metacognitiveModel.knowledgeGaps.slice(0, 3).join('; ')}`,
      );
    }
    if (metacognitiveModel.dataGaps.length > 0) {
      limitations.push(
        `Known data gaps: ${metacognitiveModel.dataGaps.slice(0, 3).join('; ')}`,
      );
    }

    // Homeostasis currently performs active body sensing. R1-D is a request-safe
    // read projection, so it must not trigger that background-grade fan-out.
    // R1-C will attach cached/approved health state once a request-safe source is
    // canonical. Be explicit rather than inventing a healthy default.
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
      goals: goals.map((goal: any) => ({
        id: goal.id,
        title: goal.title,
        status: goal.status,
        priority: goal.priority ?? null,
        targetDate: goal.targetDate ? new Date(goal.targetDate).toISOString() : null,
      })),
      pendingDecisions: proposals.map((proposal: any) => ({
        id: proposal.id,
        status: proposal.status,
        capabilityName: proposal.capabilityName ?? null,
        riskTier: proposal.riskTier ?? null,
        createdAt: new Date(proposal.createdAt).toISOString(),
      })),
      metacognition: {
        recommendationAccuracy: metacognitiveModel.recommendationAccuracy,
        actionSuccessRate: metacognitiveModel.actionSuccessRate,
        userApprovalRate: metacognitiveModel.userApprovalRate,
        predictionAccuracy: metacognitiveModel.predictionAccuracy,
        knowledgeGaps: metacognitiveModel.knowledgeGaps,
        dataGaps: metacognitiveModel.dataGaps,
      },
      limitations,
      generatedAt: new Date().toISOString(),
    };
  }
}
