import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Subject, Observable } from 'rxjs';

export interface StreamEnvelope {
  data: {
    type: string;
    timestamp: string;
    businessId: string;
    payload: Record<string, unknown>;
  };
}

@Injectable()
export class EventStreamService implements OnModuleInit {
  private readonly logger = new Logger(EventStreamService.name);
  private streams = new Map<string, Set<Subject<StreamEnvelope>>>();

  onModuleInit() {
    this.logger.log('EventStreamService initialized');
  }

  subscribe(businessId: string): { observable: Observable<StreamEnvelope>; cleanup: () => void } {
    const subject = new Subject<StreamEnvelope>();
    const set = this.streams.get(businessId) ?? new Set();
    set.add(subject);
    this.streams.set(businessId, set);

    const cleanup = () => {
      const s = this.streams.get(businessId);
      if (s) {
        s.delete(subject);
        if (s.size === 0) this.streams.delete(businessId);
      }
      subject.complete();
    };

    return { observable: subject.asObservable(), cleanup };
  }

  broadcast(businessId: string, type: string, payload: Record<string, unknown>): void {
    const set = this.streams.get(businessId);
    if (!set || set.size === 0) return;

    const envelope: StreamEnvelope = {
      data: {
        type,
        timestamp: new Date().toISOString(),
        businessId,
        payload,
      },
    };

    for (const subject of set) {
      try {
        subject.next(envelope);
      } catch (err) {
        this.logger.warn(`SSE broadcast failed: ${(err as Error).message}`);
      }
    }
  }

  getConnectionCount(businessId?: string): number {
    if (businessId) {
      return this.streams.get(businessId)?.size ?? 0;
    }
    let total = 0;
    for (const set of this.streams.values()) {
      total += set.size;
    }
    return total;
  }

  // ---------- Event Listeners ----------

  @OnEvent('evidence.submitted')
  onEvidenceSubmitted(payload: { evidence: { businessId: string; id: string; evidenceType: string }; linkedType: string; linkedId: string }) {
    this.broadcast(payload.evidence.businessId, 'evidence.submitted', {
      evidenceId: payload.evidence.id,
      evidenceType: payload.evidence.evidenceType,
      linkedType: payload.linkedType,
      linkedId: payload.linkedId,
    });
  }

  @OnEvent('evidence.verified')
  onEvidenceVerified(payload: { evidence: { businessId: string; id: string }; verifierId: string }) {
    this.broadcast(payload.evidence.businessId, 'evidence.verified', {
      evidenceId: payload.evidence.id,
      verifierId: payload.verifierId,
    });
  }

  @OnEvent('evidence.deleted')
  onEvidenceDeleted(payload: { evidence: { businessId: string; id: string }; deletedBy: string }) {
    this.broadcast(payload.evidence.businessId, 'evidence.deleted', {
      evidenceId: payload.evidence.id,
      deletedBy: payload.deletedBy,
    });
  }

  @OnEvent('task.assigned')
  onTaskAssigned(payload: { businessId: string; taskType: string; taskId: string; assignableType: string; assignableId: string }) {
    this.broadcast(payload.businessId, 'task.assigned', {
      taskType: payload.taskType,
      taskId: payload.taskId,
      assignableType: payload.assignableType,
      assignableId: payload.assignableId,
    });
  }

  @OnEvent('task.unassigned')
  onTaskUnassigned(payload: { businessId: string; taskType: string; taskId: string; assignableType: string; assignableId: string }) {
    this.broadcast(payload.businessId, 'task.unassigned', {
      taskType: payload.taskType,
      taskId: payload.taskId,
      assignableType: payload.assignableType,
      assignableId: payload.assignableId,
    });
  }

  @OnEvent('task.transferred')
  onTaskTransferred(payload: { businessId: string; fromType: string; fromId: string; toType: string; toId: string; count: number }) {
    this.broadcast(payload.businessId, 'task.transferred', {
      fromType: payload.fromType,
      fromId: payload.fromId,
      toType: payload.toType,
      toId: payload.toId,
      count: payload.count,
    });
  }

  @OnEvent('business_event.anomaly_detected')
  onAnomalyDetected(payload: { businessId: string; actorId: string; anomalyType: string; details: Record<string, unknown> }) {
    this.broadcast(payload.businessId, 'anomaly.detected', {
      actorId: payload.actorId,
      anomalyType: payload.anomalyType,
      details: payload.details,
    });
  }
}
