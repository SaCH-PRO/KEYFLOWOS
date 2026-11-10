import { Injectable, Logger, Inject } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { StructureService } from './structure.service';
import { FlowOrchestratorService } from '../ai/flow-orchestrator.service';
import { AiOversightService } from '../ai/ai-oversight.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { JobRolePolicyService } from './job-role-policy.service';

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
 * Governance (V1-21b): KEY's tools are bounded by the position's envelope
 * (JobRolePolicyService.envelopeForPosition), and a reply approval by the tier
 * the holder has over HTTP (AiOversightService.resolveApprovalByAssignment ->
 * approvalTierForPosition). A message is acted on once per provider message id.
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

  private getJobRolePolicy() {
    return this.moduleRef.get(JobRolePolicyService, { strict: false });
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

  /**
   * Claim a staff message by its provider message id, once (V1-21b review 9 WB-3). The provider
   * signature covers the message id, so a request replayed with its signature (from a delivery
   * log, a proxy log) carries the same id: it is acted on once. 'unidentified' is a message that
   * came with no id, which cannot be shown not to be a replay. A Twilio signature covers the
   * parameter names and values run together, so a replay can move a name/value boundary and carry
   * a new id (V1-21c WB3-SHIFT): WhatsAppController claims each Twilio delivery by its signature
   * before it reaches here.
   */
  private async claimMessage(
    businessId: string,
    channel: 'whatsapp' | 'sms',
    externalId: string | null | undefined,
  ): Promise<'claimed' | 'duplicate' | 'unidentified'> {
    if (typeof externalId !== 'string' || !externalId.trim()) return 'unidentified';
    try {
      await this.prisma.client.webhookEvent.create({
        data: { provider: `staff_${channel}`, providerEventId: `${businessId}:${externalId.trim()}`, eventType: 'staff_message', businessId },
      });
      return 'claimed';
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2002') return 'duplicate';
      throw err;
    }
  }

  async routeInboundMessage(
    businessId: string,
    fromPhone: string,
    body: string,
    channel: 'whatsapp' | 'sms',
    externalId?: string | null,
  ): Promise<StaffChatBridgeResult> {
    if (!body?.trim()) return { handled: false };

    const assignment = await this.structure.resolveStaffByPhone(businessId, fromPhone);
    if (!assignment) return { handled: false };

    // A staff message is acted on once (V1-21b review 9 WB-3): a replay of a signed request is
    // dropped here, before it can resolve an approval or run a KEY tool. Nothing is sent back.
    const claim = await this.claimMessage(businessId, channel, externalId);
    if (claim === 'duplicate') {
      this.logger.warn(`Dropped a repeated inbound ${channel} message ${externalId} for staff position ${assignment.id}`);
      return { handled: true };
    }

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
        if (decision && claim === 'unidentified') {
          // No provider message id: it could be a replay, so it decides nothing (WB-3).
          return { handled: true, reply: "I couldn't apply that: the message arrived without a message id. Open the app to decide instead." };
        }
        if (decision) {
          // AiOversightService caps the reply by the tier the holder has over HTTP (review 9 WB-1).
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

    // Position-scoped governance: the staff position's JobRole.permissions
    // decide which tools KEY may use in this conversation. A position with no
    // JobRole (deleted: onDelete SetNull, or never set) gets the baseline
    // envelope, never none — no envelope would let the text-detected crew
    // decide (V1-21b review 3 IC-2). A membership-backed position is bounded
    // by the holder's Membership scopes, which HTTP enforces (review 4 IC3-1),
    // read as HTTP reads them (review 7 INP4-2), and every position by the
    // members whose phone it is (review 7 INP4-3).
    const policy = this.getJobRolePolicy();
    const envelope = policy.envelopeForPosition(assignment);
    // W9-KEY-DISPATCH-INCLUDES (review CR-W7CTC-2; owner rulings D-73, D-88): this turn has no
    // principal, so call_create_task, which records the member the command runs for as the caller,
    // runs for the holder of a membership-backed position (assignment.userId, when HTTP lets that
    // member in here): chat() dispatches it with them as onBehalfOfUserId. A contact-only position
    // has none, is not offered the tool (envelopeForPosition), and is refused it at dispatch.
    const holderUserId = policy.holderForPosition(assignment);

    const hints = [
      `You are talking to ${displayName}, a staff member${assignment.jobRole ? ` (position: ${assignment.jobRole.name})` : ''} over ${channel === 'whatsapp' ? 'WhatsApp' : 'SMS'}, not the in-app chat. Keep replies short and text-message appropriate.`,
    ];
    if (envelope) {
      hints.push(
        `${displayName}'s position is ${envelope.jobRoleName}. Only use tools within that position's scope; politely decline requests outside it and suggest they ask a manager.`,
      );
    }
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
      undefined,
      // The envelope travels as chat()'s server-only argument, never in pageContext, which is
      // the shape a member's client sends (V1-21b review 7 ENV-FORGE); so does the holder (CR-W7CTC-2).
      { jobRoleEnvelope: envelope, positionHolderUserId: holderUserId },
    );

    if (!assignment.activeFlowSessionId && result.sessionId) {
      await this.structure.setActiveFlowSession(assignment.id, result.sessionId);
    }

    return { handled: true, reply: result.reply };
  }
}
