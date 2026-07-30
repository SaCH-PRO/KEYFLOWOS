import { Injectable, Inject, Logger } from '@nestjs/common';
import { BusinessEventService } from '../business-events/business-event.service';
import type { KeyExecutableActionType } from './key-action-proposal.types';

export interface ActionAuditEntry {
  businessId: string;
  actionType: KeyExecutableActionType | string;
  actorId: string;
  actorType: 'human' | 'ai' | 'system';
  proposalId?: string | null;
  source?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  payload?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  rollbackActions?: unknown[];
  error?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * ActionAuditService records every automated KEY action to the immutable
 * BusinessEvent audit trail, including before/after snapshots and rollback
 * payloads. It is intentionally fire-and-forget: audit failures are logged,
 * never thrown, so they cannot break an executing action.
 */
@Injectable()
export class ActionAuditService {
  private readonly logger = new Logger(ActionAuditService.name);

  constructor(
    @Inject(BusinessEventService) private readonly events: BusinessEventService,
  ) {}

  async recordExecuted(entry: ActionAuditEntry): Promise<void> {
    await this.emit({
      ...entry,
      eventType: 'key_action.executed',
      action: 'execute',
      subjectType: 'KeyActionProposal',
      subjectId: entry.proposalId ?? 'unknown',
      after: entry.after ?? undefined,
      metadata: {
        ...entry.metadata,
        actionType: entry.actionType,
        rollbackActions: entry.rollbackActions,
      },
    });
  }

  async recordBlocked(entry: ActionAuditEntry & { reason: string }): Promise<void> {
    await this.emit({
      ...entry,
      eventType: 'key_action.blocked',
      action: 'block',
      subjectType: 'KeyActionProposal',
      subjectId: entry.proposalId ?? 'unknown',
      metadata: {
        ...entry.metadata,
        actionType: entry.actionType,
        reason: entry.reason,
      },
    });
  }

  async recordFailed(entry: ActionAuditEntry & { error: string }): Promise<void> {
    await this.emit({
      ...entry,
      eventType: 'key_action.failed',
      action: 'fail',
      subjectType: 'KeyActionProposal',
      subjectId: entry.proposalId ?? 'unknown',
      metadata: {
        ...entry.metadata,
        actionType: entry.actionType,
        error: entry.error,
      },
    });
  }

  private async emit(
    input: ActionAuditEntry & {
      eventType: string;
      action: string;
      subjectType: string;
      subjectId: string;
    },
  ): Promise<void> {
    try {
      await this.events.emit({
        businessId: input.businessId,
        eventType: input.eventType,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        actorType: input.actorType,
        actorId: input.actorId,
        action: input.action,
        before: input.before ?? undefined,
        after: input.after ?? undefined,
        source: (input.source as any) ?? 'ai',
        metadata: {
          proposalId: input.proposalId,
          payload: input.payload,
          result: input.result,
          rollbackActions: input.rollbackActions,
          ...input.metadata,
        },
      });
    } catch (err: any) {
      this.logger.error(
        `Action audit emit failed for ${input.actionType}: ${(err as Error).message}`,
      );
    }
  }
}
