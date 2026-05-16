import { Injectable, Inject, Logger } from '@nestjs/common';
import { BusinessEventService } from './business-event.service';
import { BusinessEventQueueService, BusinessEventJob } from './business-event.queue';

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenMaxCalls: number;
}

@Injectable()
export class ResilientEmitterService {
  private readonly logger = new Logger(ResilientEmitterService.name);
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private lastFailureTime = 0;
  private halfOpenCalls = 0;

  private readonly config: CircuitBreakerConfig = {
    failureThreshold: 5,
    resetTimeoutMs: 30_000,
    halfOpenMaxCalls: 1,
  };

  constructor(
    @Inject(BusinessEventService) private readonly events: BusinessEventService,
    @Inject(BusinessEventQueueService) private readonly queue: BusinessEventQueueService,
  ) {}

  get circuitState(): CircuitState {
    if (this.state === 'OPEN') {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.config.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
        this.halfOpenCalls = 0;
        this.logger.warn('Circuit breaker entering HALF_OPEN');
      }
    }
    return this.state;
  }

  async emit(job: BusinessEventJob): Promise<void> {
    const state = this.circuitState;

    if (state === 'OPEN') {
      this.logger.warn('Circuit OPEN: enqueueing business event for later replay');
      try {
        await this.queue.enqueue(job, { priority: 1 });
      } catch (err) {
        this.logger.error(`Failed to enqueue event: ${(err as Error).message}`);
      }
      return;
    }

    if (state === 'HALF_OPEN') {
      if (this.halfOpenCalls >= this.config.halfOpenMaxCalls) {
        this.logger.warn('Circuit HALF_OPEN limit reached: enqueueing business event');
        try {
          await this.queue.enqueue(job, { priority: 1 });
        } catch (err) {
          this.logger.error(`Failed to enqueue event: ${(err as Error).message}`);
        }
        return;
      }
      this.halfOpenCalls++;
    }

    try {
      // Primary path: enqueue to BullMQ for async processing
      await this.queue.enqueue(job);
      this.onSuccess();
    } catch (queueErr) {
      this.logger.warn(`Queue enqueue failed: ${(queueErr as Error).message}. Falling back to sync emit.`);
      try {
        await this.events.emit({
          businessId: job.businessId,
          eventType: job.eventType,
          subjectType: job.subjectType,
          subjectId: job.subjectId,
          actorType: job.actorType as any,
          actorId: job.actorId,
          action: job.action,
          before: job.before,
          after: job.after,
          source: job.source as any,
          metadata: job.metadata,
          evidenceIds: job.evidenceIds,
          messageIds: job.messageIds,
          approvalId: job.approvalId,
          riskScore: job.riskScore,
        });
        this.onSuccess();
      } catch (emitErr) {
        this.onFailure();
        this.logger.error(`Sync emit also failed: ${(emitErr as Error).message}`);
      }
    }
  }

  private onSuccess() {
    if (this.state === 'HALF_OPEN') {
      this.logger.log('Circuit breaker closing');
      this.state = 'CLOSED';
    }
    this.failures = 0;
  }

  private onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.failures >= this.config.failureThreshold) {
      this.logger.error(`Circuit breaker opening after ${this.failures} consecutive failures`);
      this.state = 'OPEN';
    }
  }
}
