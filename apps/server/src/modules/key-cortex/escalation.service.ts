import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { AutonomyVerdict } from '../key-autonomy/autonomy-orchestrator.types';

export interface EscalationInput {
  businessId: string;
  actionKey: string;
  parameters?: Record<string, unknown>;
  verdict: AutonomyVerdict;
  confidence?: number;
  userId?: string;
}

/**
 * Decides when KEY should escalate to a human and creates the appropriate
 * ApprovalRequest with full autonomy context.
 */
@Injectable()
export class EscalationService {
  private readonly CONFIDENCE_THRESHOLD = 0.55;

  constructor(private readonly prisma: PrismaService) {}

  async shouldEscalate(input: EscalationInput): Promise<boolean> {
    if (!input.verdict.allowed || input.verdict.tier === 'manual') return true;
    if (input.verdict.requiresApproval) return true;
    if ((input.confidence ?? 1) < this.CONFIDENCE_THRESHOLD) return true;
    return false;
  }

  async escalate(input: EscalationInput): Promise<string> {
    const request = await this.prisma.client.approvalRequest.create({
      data: {
        businessId: input.businessId,
        requestType: 'ai_action',
        requesterId: input.userId ?? 'key_ai',
        title: `AI action requires approval: ${input.actionKey}`,
        description: input.verdict.reason,
        payload: {
          actionKey: input.actionKey,
          parameters: input.parameters ?? {},
          verdict: input.verdict,
          confidence: input.confidence,
        } as any,
        status: 'pending',
      },
    });

    return request.id;
  }
}
