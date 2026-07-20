import { Injectable, Logger, Inject } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { StructureService } from './structure.service';
import { FlowOrchestratorService } from '../ai/flow-orchestrator.service';
import { AiOversightService } from '../ai/ai-oversight.service';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface StaffChatBridgeResult {
  handled: boolean;
  reply?: string;
}

const APPROVE_KEYWORDS = /^\s*(yes|y|approve|approved|ok|okay|confirm|confirmed|👍|✅)\b/i;
const REJECT_KEYWORDS = /^\s*(no|n|reject|rejected|deny|denied|cancel|👎|❌)\b/i;

/**
 * Lets a staff position (full account or contact-only) talk to KEY directly
 * over WhatsApp/SMS, the same conversational engine that powers the in-app
 * chat — same tools, same governance tiers. Inbound handlers (WhatsAppService,
 * InboundCommunicationsService) call routeInboundMessage() BEFORE falling back
 * to their normal customer-contact intake pipeline; an unmatched phone number
 * (the common case) returns { handled: false } and the caller proceeds as before.
 *
 * NOTE: this only wires the transport (staff phone -> KEY chat -> reply back
 * on the same channel). It does not yet scope tool/approval access to the
 * caller's specific JobRole — that still comes from the global business
 * autonomy mode and RoleEngine text-based detection, same as any other
 * session. Position-specific governance is a follow-up.
 */
@Injectable()
export class StaffChatBridgeService {
  private readonly logger = new Logger(StaffChatBridgeService.name);

  constructor(
    @Inject(StructureService) private readonly structure: StructureService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ModuleRef) private readonly moduleRef: ModuleRef,
  ) {}

  private getFlowOrchestrator() {
    return this.moduleRef.get(FlowOrchestratorService, { strict: false });
  }

  private getOversight() {
    return this.moduleRef.get(AiOversightService, { strict: false });
  }

  /** Simple, deliberately conservative yes/no parse — anything else is ambiguous. */
  private parseReplyDecision(body: string): 'approved' | 'rejected' | null {
    const trimmed = body.trim();
    if (APPROVE_KEYWORDS.test(trimmed)) return 'approved';
    if (REJECT_KEYWORDS.test(trimmed)) return 'rejected';
    return null;
  }

  async routeInboundMessage(
    businessId: string,
    fromPhone: string,
    body: string,
    channel: 'whatsapp' | 'sms',
  ): Promise<StaffChatBridgeResult> {
    if (!body?.trim()) return { handled: false };

    const assignment = await this.structure.resolveStaffByPhone(businessId, fromPhone);
    if (!assignment) return { handled: false };

    const displayName = assignment.contactName || assignment.contactEmail || assignment.userId || assignment.id;
    this.logger.log(`Routing inbound ${channel} message from staff position ${assignment.id} (${displayName}) to KEY chat`);

    // If this position has opted into reply-based approval, check for a
    // pending item routed to them before falling into general chat.
    let pendingApprovalHint: string | undefined;
    if (assignment.autoApprovalViaReply) {
      const pending = await this.prisma.client.aiApprovalItem.findFirst({
        where: { businessId, status: 'pending', approverAssignmentId: assignment.id },
        orderBy: { createdAt: 'asc' },
      });
      if (pending) {
        const decision = this.parseReplyDecision(body);
        if (decision) {
          try {
            const oversight = this.getOversight();
            await oversight.resolveApprovalByAssignment(pending.id, businessId, assignment.id, decision);
            return { handled: true, reply: `Got it — I've ${decision} "${pending.title}".` };
          } catch (err) {
            return { handled: true, reply: `I couldn't apply that: ${err instanceof Error ? err.message : 'unknown error'}. Open the app to decide instead.` };
          }
        }
        pendingApprovalHint = `${displayName} has a pending approval: "${pending.title}" (Tier ${pending.riskTier}). If this message is a reply to it, gently ask them to say YES or NO; otherwise just help with what they asked.`;
      }
    }

    const orchestrator = this.getFlowOrchestrator();
    const sessionId: string | undefined = assignment.activeFlowSessionId ?? undefined;
    const history = sessionId ? await orchestrator.getConversationHistory(businessId, sessionId) : [];

    const hints = [
      `You are talking to ${displayName}, a staff member${assignment.jobRole ? ` (position: ${assignment.jobRole.name})` : ''} over ${channel === 'whatsapp' ? 'WhatsApp' : 'SMS'}, not the in-app chat. Keep replies short and text-message appropriate.`,
    ];
    if (pendingApprovalHint) hints.push(pendingApprovalHint);

    const result = await orchestrator.chat(
      businessId,
      body,
      history,
      undefined,
      {
        surface: `staff_${channel}`,
        route: `/channel/${channel}`,
        hints,
      },
      undefined,
      undefined,
      sessionId,
    );

    if (!assignment.activeFlowSessionId && result.sessionId) {
      await this.structure.setActiveFlowSession(assignment.id, result.sessionId);
    }

    return { handled: true, reply: result.reply };
  }
}
