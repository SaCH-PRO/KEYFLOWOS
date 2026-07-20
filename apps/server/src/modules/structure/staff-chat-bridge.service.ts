import { Injectable, Logger, Inject } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { StructureService } from './structure.service';
import { FlowOrchestratorService } from '../ai/flow-orchestrator.service';

export interface StaffChatBridgeResult {
  handled: boolean;
  reply?: string;
}

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
    @Inject(ModuleRef) private readonly moduleRef: ModuleRef,
  ) {}

  private getFlowOrchestrator() {
    return this.moduleRef.get(FlowOrchestratorService, { strict: false });
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

    const orchestrator = this.getFlowOrchestrator();
    const sessionId: string | undefined = assignment.activeFlowSessionId ?? undefined;
    const history = sessionId ? await orchestrator.getConversationHistory(businessId, sessionId) : [];

    const result = await orchestrator.chat(
      businessId,
      body,
      history,
      undefined,
      {
        surface: `staff_${channel}`,
        route: `/channel/${channel}`,
        hints: [
          `You are talking to ${displayName}, a staff member${assignment.jobRole ? ` (position: ${assignment.jobRole.name})` : ''} over ${channel === 'whatsapp' ? 'WhatsApp' : 'SMS'}, not the in-app chat. Keep replies short and text-message appropriate.`,
        ],
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
