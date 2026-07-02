import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { FlowSignalImportance } from '@prisma/client';
import type { FlowSignalInput } from '../flow-signal/flow-signal.types';
import { FlowRouterService } from '../flow-signal/flow-router.service';
import { FlowSignalService } from '../flow-signal/flow-signal.service';
import { KeyCortexEvent, KeyCortexEventBusService } from './key-cortex-event-bus.service';

/**
 * Bridge from the legacy KEY Cortex event bus into the canonical FlowSignal
 * stream. Every event published on the bus (except flow-signal events) gets
 * normalized, routed into FINANCIAL / TEMPORAL / PEOPLE flows, and persisted
 * as a FlowSignal so that KEY roles can subscribe to it.
 */
@Injectable()
export class FlowSignalBridgeService implements OnModuleInit {
  private readonly logger = new Logger(FlowSignalBridgeService.name);

  constructor(
    private readonly eventBus: KeyCortexEventBusService,
    private readonly flowSignalService: FlowSignalService,
    private readonly flowRouter: FlowRouterService,
  ) {}

  onModuleInit(): void {
    this.eventBus.subscribeAll((event) => this.handle(event));
  }

  private async handle(event: KeyCortexEvent): Promise<void> {
    // Avoid infinite loops: flow signals themselves also publish bus events.
    if (event.source === 'flow_signal') {
      return;
    }

    // Skip events that already look like FlowSignal internal lifecycle events.
    if (event.type.startsWith('flow.')) {
      return;
    }

    const type = this.normalizeType(event.type);
    const input: FlowSignalInput = {
      businessId: event.businessId,
      userId: event.userId,
      source: event.source,
      type,
      module: this.inferModule(event.source, type),
      entityType: event.metadata?.entityType as string | undefined,
      entityId: event.metadata?.entityId as string | undefined,
      title: this.inferTitle(type, event),
      summary: this.inferSummary(event),
      occurredAt: event.timestamp,
      importance: this.inferImportance(event.metadata?.importance),
      payload: event.payload,
      signals: { eventId: event.id, correlationId: event.metadata?.correlationId },
      tags: [event.source, type.split('.')[0]],
    };

    const routed = this.flowRouter.route(input);

    // Ignore events that do not map onto any KEY flow.
    if (!routed.flows || routed.flows.length === 0) {
      return;
    }

    try {
      await this.flowSignalService.emit(routed);
      this.logger.debug(
        `[bridge] ${routed.type} → ${routed.flows.join(',')} (${routed.ownerRoleHint ?? 'unowned'})`,
      );
    } catch (err: unknown) {
      this.logger.warn(
        `[bridge] Failed to emit flow signal for ${event.type}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private normalizeType(type: string): string {
    // Convert underscore-style bus names like "proactive.invoice_overdue"
    // into dotted flow types like "invoice.overdue".
    let normalized = type.replace(/_/g, '.');
    if (normalized.startsWith('proactive.')) {
      normalized = normalized.slice('proactive.'.length);
    }
    return normalized;
  }

  private inferModule(source: string, type: string): string | undefined {
    const first = type.split('.')[0];
    const moduleMap: Record<string, string> = {
      key_inbox: 'inbox',
      temporal_flow: 'calendar',
      key_cortex: 'cortex',
      store_link: 'commerce',
      key_connector: 'connector',
      key_genome: 'genome',
      crm: 'crm',
      finance: 'finance',
      support: 'support',
      hr: 'hr',
    };
    return moduleMap[source] ?? moduleMap[first] ?? source;
  }

  private inferTitle(type: string, event: KeyCortexEvent): string {
    const humanType = type
      .split('.')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');

    const entity =
      event.metadata?.entityType && event.metadata?.entityId
        ? `${event.metadata.entityType} ${event.metadata.entityId.slice(0, 8)}`
        : undefined;

    return entity ? `${humanType}: ${entity}` : humanType;
  }

  private inferSummary(event: KeyCortexEvent): string {
    const summary =
      (event.payload?.summary as string) ??
      (event.payload?.message as string) ??
      (event.payload?.note as string);
    if (summary && typeof summary === 'string') {
      return summary;
    }
    return `${event.source} emitted ${event.type}`;
  }

  private inferImportance(importance?: string): FlowSignalImportance | undefined {
    if (importance === 'critical') return FlowSignalImportance.CRITICAL;
    if (importance === 'high') return FlowSignalImportance.HIGH;
    if (importance === 'low') return FlowSignalImportance.LOW;
    return FlowSignalImportance.NORMAL;
  }
}
