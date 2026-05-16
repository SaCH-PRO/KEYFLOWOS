import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

interface ActorWindow {
  actions: Map<string, number[]>; // action -> timestamps
  deletions: number[];
  updates: number[];
}

interface BusinessWindow {
  actors: Map<string, ActorWindow>;
  entitySequences: Map<string, string[]>; // entityKey -> [action1, action2, ...]
}

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const DELETE_THRESHOLD = 20;
const UPDATE_THRESHOLD = 50;

@Injectable()
export class BusinessEventAnomalyService {
  private readonly logger = new Logger(BusinessEventAnomalyService.name);
  private windows = new Map<string, BusinessWindow>(); // businessId -> window

  constructor(private readonly events: EventEmitter2) {}

  async inspect(event: {
    businessId: string;
    actorId: string;
    action: string;
    subjectType: string;
    subjectId: string;
    eventType: string;
  }): Promise<void> {
    const now = Date.now();
    const window = this.getOrCreateWindow(event.businessId);
    const actorWindow = this.getOrCreateActorWindow(window, event.actorId);

    // Track action timestamps
    const actionKey = event.action.toLowerCase();
    const timestamps = actorWindow.actions.get(actionKey) ?? [];
    timestamps.push(now);
    actorWindow.actions.set(actionKey, timestamps);

    if (actionKey === 'delete') {
      actorWindow.deletions.push(now);
    }
    if (actionKey === 'update') {
      actorWindow.updates.push(now);
    }

    // Track entity sequences
    const entityKey = `${event.subjectType}:${event.subjectId}`;
    const sequence = window.entitySequences.get(entityKey) ?? [];
    sequence.push(actionKey);
    window.entitySequences.set(entityKey, sequence);

    // Check thresholds
    const recentDeletions = actorWindow.deletions.filter((t) => now - t < WINDOW_MS);
    const recentUpdates = actorWindow.updates.filter((t) => now - t < WINDOW_MS);

    if (recentDeletions.length >= DELETE_THRESHOLD) {
      this.fireAnomaly(event.businessId, event.actorId, 'mass_deletion', {
        deletionCount: recentDeletions.length,
        windowMinutes: 60,
      });
    }

    if (recentUpdates.length >= UPDATE_THRESHOLD) {
      this.fireAnomaly(event.businessId, event.actorId, 'mass_update', {
        updateCount: recentUpdates.length,
        windowMinutes: 60,
      });
    }

    // Check unusual sequence: delete -> create -> delete same entity
    const seq = window.entitySequences.get(entityKey) ?? [];
    if (seq.length >= 3) {
      const lastThree = seq.slice(-3);
      if (lastThree[0] === 'delete' && lastThree[1] === 'create' && lastThree[2] === 'delete') {
        this.fireAnomaly(event.businessId, event.actorId, 'suspicious_entity_cycle', {
          entityType: event.subjectType,
          entityId: event.subjectId,
          sequence: lastThree,
        });
        // Reset to avoid duplicate alerts
        window.entitySequences.set(entityKey, []);
      }
    }

    // Cleanup old entries periodically (every 100 events per business)
    if (Math.random() < 0.01) {
      this.cleanup(window, now);
    }
  }

  private getOrCreateWindow(businessId: string): BusinessWindow {
    let w = this.windows.get(businessId);
    if (!w) {
      w = { actors: new Map(), entitySequences: new Map() };
      this.windows.set(businessId, w);
    }
    return w;
  }

  private getOrCreateActorWindow(window: BusinessWindow, actorId: string): ActorWindow {
    let a = window.actors.get(actorId);
    if (!a) {
      a = { actions: new Map(), deletions: [], updates: [] };
      window.actors.set(actorId, a);
    }
    return a;
  }

  private cleanup(window: BusinessWindow, now: number) {
    for (const actorWindow of window.actors.values()) {
      actorWindow.deletions = actorWindow.deletions.filter((t) => now - t < WINDOW_MS);
      actorWindow.updates = actorWindow.updates.filter((t) => now - t < WINDOW_MS);
      for (const [action, timestamps] of actorWindow.actions) {
        const filtered = timestamps.filter((t) => now - t < WINDOW_MS);
        if (filtered.length === 0) {
          actorWindow.actions.delete(action);
        } else {
          actorWindow.actions.set(action, filtered);
        }
      }
    }
  }

  private fireAnomaly(
    businessId: string,
    actorId: string,
    anomalyType: string,
    details: Record<string, unknown>,
  ) {
    this.logger.warn(`Anomaly detected: ${anomalyType} by ${actorId} in business ${businessId}`);
    this.events.emit('business_event.anomaly_detected', {
      businessId,
      actorId,
      anomalyType,
      details,
      timestamp: new Date().toISOString(),
    });
  }
}
