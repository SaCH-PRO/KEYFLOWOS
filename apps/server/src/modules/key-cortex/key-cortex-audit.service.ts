import { Injectable } from '@nestjs/common';
import { BusinessEventService } from '../business-events/business-event.service';
import { CreateBusinessEventInput, ActorType, EventSource } from '../business-events/dto/create-business-event.dto';

export interface KeyCortexAuditContext {
  businessId: string;
  actorType?: ActorType;
  actorId?: string;
  source?: EventSource;
  sessionId?: string;
  commandId?: string;
  correlationId?: string;
  proposalId?: string;
  riskScore?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Thin audit wrapper that ensures every KEY Cortex governance/execution event
 * is written to the unified BusinessEvent log with full identity lineage.
 */
@Injectable()
export class KeyCortexAuditService {
  constructor(private readonly businessEventService: BusinessEventService) {}

  async emit(
    eventType: string,
    action: string,
    subjectType: string,
    subjectId: string,
    ctx: KeyCortexAuditContext,
    before?: Record<string, unknown>,
    after?: Record<string, unknown>,
  ): Promise<void> {
    const input: CreateBusinessEventInput = {
      businessId: ctx.businessId,
      eventType,
      subjectType,
      subjectId,
      actorType: ctx.actorType ?? 'ai',
      actorId: ctx.actorId ?? 'key_ai',
      action,
      source: ctx.source ?? 'ai',
      approvalId: ctx.proposalId,
      riskScore: ctx.riskScore,
      metadata: ctx.metadata,
      sessionId: ctx.sessionId,
      commandId: ctx.commandId,
      correlationId: ctx.correlationId,
      before,
      after,
    };

    await this.businessEventService.emit(input);
  }
}
