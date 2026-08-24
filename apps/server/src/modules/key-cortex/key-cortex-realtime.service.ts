/**
 * KEY Cortex Realtime Service
 * Bridges KEY Cortex domain events → WebSocket pushes.
 *
 * Listens on the NestJS EventEmitter for KEY-related events
 * (insights, alerts, approvals, actions, suggestions, health)
 * and forwards them to connected browser clients via the
 * KeyCortexGateway.
 *
 * Also runs a periodic health-push job every 5 min so dashboards
 * stay fresh even when no explicit events fire.
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Interval } from '@nestjs/schedule';
import { KeyCortexGateway } from './key-cortex.gateway';
import { KeyCortexInsightService } from './key-cortex-insight.service';
import { runGuarded } from '../../core/scheduling/safe-interval';

// ------------------------------------------------------------------
// Event payload types
// ------------------------------------------------------------------

interface ActionExecutedPayload {
  businessId: string;
  action: string;
  result: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

interface ApprovalRequestedPayload {
  businessId: string;
  approvalId: string;
  description: string;
  rationale: string;
  requestedBy?: string;
}

interface InsightGeneratedPayload {
  businessId: string;
  title: string;
  description: string;
  confidence: number;
  source?: string;
}

interface AlertPayload {
  businessId: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical' | 'success';
  actionId?: string;
}

interface SuggestionPayload {
  businessId: string;
  id: string;
  title: string;
  description: string;
  impact: string;
}

interface HealthUpdatePayload {
  businessId: string;
  score: number;
  trends: unknown[];
  alerts: unknown[];
}

// ------------------------------------------------------------------
// Service
// ------------------------------------------------------------------

@Injectable()
export class KeyCortexRealtimeService implements OnModuleInit {
  private readonly logger = new Logger(KeyCortexRealtimeService.name);

  constructor(
    private readonly gateway: KeyCortexGateway,
    private readonly insightService: KeyCortexInsightService,
  ) {}

  onModuleInit() {
    this.logger.log('KEY Realtime service initialized — listening for domain events');
  }

  // ================================================================
  // Action events
  // ================================================================

  /** Forward action-executed events as activity pushes. */
  @OnEvent('key.action.executed', { async: true })
  async onActionExecuted(payload: ActionExecutedPayload) {
    this.logger.debug(`Action executed event: ${payload.action} (biz:${payload.businessId})`);

    this.gateway.pushActivity(payload.businessId, {
      type: 'action',
      description: `KEY executed: ${payload.action}`,
      timestamp: new Date(),
    });

    // If a specific user triggered it, send them a direct confirmation
    if (payload.userId) {
      this.gateway.streamResponse(payload.userId, {
        type: 'action',
        content: `Action completed: ${payload.action}`,
        metadata: { result: payload.result, ...payload.metadata },
      });
    }
  }

  /** Forward action-failed events so the UI can show an error toast. */
  @OnEvent('key.action.failed', { async: true })
  async onActionFailed(payload: ActionExecutedPayload & { error: string }) {
    this.logger.warn(`Action failed event: ${payload.action} — ${payload.error}`);

    this.gateway.pushActivity(payload.businessId, {
      type: 'action_failed',
      description: `KEY action failed: ${payload.action} — ${payload.error}`,
      timestamp: new Date(),
    });

    this.gateway.pushAlert(payload.businessId, {
      title: 'Action Failed',
      message: `${payload.action} could not be completed.`,
      severity: 'warning',
    });
  }

  // ================================================================
  // Approval events
  // ================================================================

  /** Forward approval-requested events as approval pushes. */
  @OnEvent('key.approval.requested', { async: true })
  async onApprovalRequested(payload: ApprovalRequestedPayload) {
    this.logger.debug(`Approval requested: ${payload.approvalId} (biz:${payload.businessId})`);

    this.gateway.pushApprovalRequest(payload.businessId, {
      approvalId: payload.approvalId,
      description: payload.description,
      rationale: payload.rationale,
    });
  }

  /** Notify clients when an approval was resolved (approved or rejected). */
  @OnEvent('key.approval.resolved', { async: true })
  async onApprovalResolved(payload: {
    businessId: string;
    approvalId: string;
    status: 'approved' | 'rejected';
    resolvedBy: string;
  }) {
    this.logger.debug(`Approval resolved: ${payload.approvalId} → ${payload.status}`);

    this.gateway.pushActivity(payload.businessId, {
      type: 'approval_resolved',
      description: `Approval ${payload.approvalId} was ${payload.status}`,
      timestamp: new Date(),
    });
  }

  // ================================================================
  // Insight events
  // ================================================================

  /** Forward insight-generated events as insight pushes. */
  @OnEvent('key.insight.generated', { async: true })
  async onInsightGenerated(payload: InsightGeneratedPayload) {
    this.logger.debug(`Insight generated: ${payload.title} (biz:${payload.businessId})`);

    this.gateway.pushInsight(payload.businessId, {
      title: payload.title,
      description: payload.description,
      confidence: payload.confidence,
    });
  }

  // ================================================================
  // Alert events
  // ================================================================

  /** Forward alert events as alert pushes. */
  @OnEvent('key.alert', { async: true })
  async onAlert(payload: AlertPayload) {
    this.logger.debug(`Alert event: ${payload.title} [${payload.severity}] (biz:${payload.businessId})`);

    this.gateway.pushAlert(payload.businessId, {
      title: payload.title,
      message: payload.message,
      severity: payload.severity,
      actionId: payload.actionId,
    });
  }

  // ================================================================
  // Suggestion events
  // ================================================================

  /** Forward suggestion events as suggestion pushes. */
  @OnEvent('key.suggestion', { async: true })
  async onSuggestion(payload: SuggestionPayload) {
    this.logger.debug(`Suggestion event: ${payload.title} (biz:${payload.businessId})`);

    this.gateway.pushSuggestion(payload.businessId, payload);
  }

  // ================================================================
  // Health events
  // ================================================================

  /** Forward health-update events as health pushes. */
  @OnEvent('key.health.update', { async: true })
  async onHealthUpdate(payload: HealthUpdatePayload) {
    this.logger.debug(`Health update: score=${payload.score} (biz:${payload.businessId})`);

    this.gateway.pushHealthUpdate(payload.businessId, payload);
  }

  /** Periodic health push every 5 minutes — keeps dashboards fresh. */
  @Interval(300_000)
  // Nest's SchedulerOrchestrator mounts @Interval with a raw
  // `setInterval(target, ms)` — no wrapper — so an async handler that rejects
  // becomes an unhandled rejection, and main.ts exits(1) on those. (@Cron is
  // NOT affected: the cron library catches both paths itself. Verified
  // empirically, not assumed.) The work stays in handlePeriodicHealthPush() so callers and
  // tests are unchanged; only the scheduled entry point is guarded.
  handlePeriodicHealthPushTick(): void {
    runGuarded('KeyCortexRealtimeService', () => this.handlePeriodicHealthPush(), this.logger);
  }

  async handlePeriodicHealthPush() {
    this.logger.debug('Running periodic health push');

    // Gather all unique businessIds from currently connected clients
    const businessIds = new Set<string>();
    // Access the gateway's client map via a helper
    // Since we can't directly access private fields, we use the gateway's
    // public methods to iterate.
    // Instead, we push to all businesses that have had recent activity
    // by querying the insight service for active businesses.
    try {
      const activeBusinesses = await this.insightService.getActiveBusinessIds?.() ?? [];
      for (const businessId of activeBusinesses) {
        const connectedCount = this.gateway.getConnectedCount(businessId);
        if (connectedCount === 0) continue;

        // Fetch latest health snapshot and push
        const health = await this.insightService.getBusinessHealth(businessId);
        if (health) {
          this.gateway.pushHealthUpdate(businessId, {
            score: health.score ?? 0,
            trends: health.trends ?? [],
            alerts: health.alerts ?? [],
          });
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Periodic health push failed: ${message}`);
    }
  }

  // ================================================================
  // Streaming events (reasoning chunks)
  // ================================================================

  /** Forward reasoning chunks so the UI can render real-time thought streams. */
  @OnEvent('key.reasoning.chunk', { async: true })
  async onReasoningChunk(payload: {
    userId: string;
    chunk: { type: string; content: string; done?: boolean; metadata?: Record<string, unknown> };
  }) {
    this.gateway.streamResponse(payload.userId, {
      type: payload.chunk.type as 'text' | 'action' | 'thought' | 'error',
      content: payload.chunk.content,
      done: payload.chunk.done,
      metadata: payload.chunk.metadata,
    });
  }

  // ================================================================
  // Connection statistics (for monitoring / ops)
  // ================================================================

  /** Emit current connection stats to any monitoring dashboard. */
  @OnEvent('key.stats.requested', { async: true })
  async onStatsRequested(payload: { requestId: string; businessId?: string }) {
    const stats = {
      totalConnections: this.gateway.getTotalConnections?.() ?? 0,
      timestamp: new Date().toISOString(),
    };

    if (payload.businessId) {
      this.gateway.pushActivity(payload.businessId, {
        type: 'stats',
        description: `Connected clients: ${stats.totalConnections}`,
        timestamp: new Date(),
      });
    }
  }
}
