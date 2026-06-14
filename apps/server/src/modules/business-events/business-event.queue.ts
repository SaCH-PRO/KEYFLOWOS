import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
import { Queue, Worker, Job } from 'bullmq';
import { REDIS_CLIENT } from '../../core/redis/redis.constants';
import type { Redis } from 'ioredis';
import { BusinessEventService } from './business-event.service';
import { BusinessEventAnomalyService } from './business-event-anomaly.service';

export interface BusinessEventJob {
  businessId: string;
  eventType: string;
  subjectType: string;
  subjectId: string;
  actorType: string;
  actorId: string;
  action: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  source?: string;
  metadata?: Record<string, unknown>;
  evidenceIds?: string[];
  messageIds?: string[];
  approvalId?: string;
  riskScore?: number;
}

@Injectable()
export class BusinessEventQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BusinessEventQueueService.name);
  readonly queue: Queue<BusinessEventJob>;
  private worker?: Worker<BusinessEventJob>;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(BusinessEventService) private readonly events: BusinessEventService,
    @Inject(BusinessEventAnomalyService) private readonly anomaly: BusinessEventAnomalyService,
  ) {
    this.queue = new Queue<BusinessEventJob>('business-events', { connection: redis });
  }

  async onModuleInit() {
    this.worker = new Worker<BusinessEventJob>(
      'business-events',
      async (job) => this.process(job),
      {
        connection: this.redis,
        concurrency: 10,
        stalledInterval: 30_000,
        maxStalledCount: 2,
      },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(`Business event job ${job?.id} failed: ${err.message}`);
    });

    this.logger.log('BusinessEvent worker initialized');
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue.close();
  }

  async enqueue(job: BusinessEventJob, options?: { delay?: number; priority?: number }): Promise<Job<BusinessEventJob>> {
    return this.queue.add(
      `event:${job.eventType}:${job.subjectId}`,
      job,
      {
        priority: options?.priority ?? 5,
        delay: options?.delay,
        removeOnComplete: { age: 24 * 3600, count: 5000 },
        removeOnFail: { age: 7 * 24 * 3600, count: 1000 },
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    );
  }

  private async process(job: Job<BusinessEventJob>) {
    const data = job.data;
    await this.events.emit({
      businessId: data.businessId,
      eventType: data.eventType,
      subjectType: data.subjectType,
      subjectId: data.subjectId,
      actorType: data.actorType as any,
      actorId: data.actorId,
      action: data.action,
      before: data.before,
      after: data.after,
      source: data.source as any,
      metadata: data.metadata,
      evidenceIds: data.evidenceIds,
      messageIds: data.messageIds,
      approvalId: data.approvalId,
      riskScore: data.riskScore,
    });

    // Anomaly detection on significant events
    await this.anomaly.inspect(data);
  }

  async getHealth(): Promise<{ queueDepth: number; workerStatus: string }> {
    const waiting = await this.queue.getWaitingCount();
    const delayed = await this.queue.getDelayedCount();
    return {
      queueDepth: waiting + delayed,
      workerStatus: this.worker ? 'running' : 'stopped',
    };
  }
}
