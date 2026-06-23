import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
import { Queue, Worker, Job } from 'bullmq';
import { REDIS_CLIENT } from '../../core/redis/redis.constants';
import type { Redis } from 'ioredis';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TemporalFlowMemoryService } from './temporal-flow-memory.service';
import { TemporalFlowGenomeBridgeService } from './temporal-flow-genome-bridge.service';

export interface TemporalFlowMemoryJob {
  businessId: string;
  operation: 'compact' | 'detect_patterns';
  threadId?: string;
  contactId?: string;
  channel?: string;
}

@Injectable()
export class TemporalFlowMemoryQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TemporalFlowMemoryQueueService.name);
  readonly queue: Queue<TemporalFlowMemoryJob>;
  private worker?: Worker<TemporalFlowMemoryJob>;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TemporalFlowMemoryService) private readonly memoryService: TemporalFlowMemoryService,
    @Inject(TemporalFlowGenomeBridgeService) private readonly genomeBridge: TemporalFlowGenomeBridgeService,
  ) {
    this.queue = new Queue<TemporalFlowMemoryJob>('temporal-flow-memory', { connection: this.redis });
  }

  async onModuleInit() {
    try {
      await this.redis.ping();
    } catch (err) {
      this.logger.warn(`Redis unavailable; temporal flow memory worker disabled: ${(err as Error).message}`);
      return;
    }

    this.worker = new Worker<TemporalFlowMemoryJob>(
      'temporal-flow-memory',
      async (job) => this.process(job),
      {
        connection: this.redis,
        concurrency: 3,
        stalledInterval: 30_000,
        maxStalledCount: 2,
      },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(`Temporal flow memory job ${job?.id} failed: ${err.message}`);
    });

    // Schedule periodic compaction every 6 hours
    try {
      const existing = await this.queue.getRepeatableJobs();
      const match = existing.find((r) => r.id === 'temporal-flow-memory-periodic-compact');
      if (match) {
        await this.queue.removeRepeatableByKey(match.key);
      }

      await this.queue.add(
        'periodic-compact',
        { businessId: 'ALL', operation: 'compact' },
        {
          jobId: 'temporal-flow-memory-periodic-compact',
          repeat: { pattern: '0 */6 * * *', tz: 'UTC' },
          removeOnComplete: { count: 50 },
          removeOnFail: { count: 20 },
        },
      );
    } catch (err) {
      this.logger.warn(`Failed to schedule periodic compaction: ${(err as Error).message}`);
    }

    this.logger.log('TemporalFlowMemory worker initialized');
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue.close();
  }

  async enqueue(job: TemporalFlowMemoryJob, options?: { delay?: number; priority?: number }): Promise<Job<TemporalFlowMemoryJob>> {
    return this.queue.add(
      `tf-memory:${job.operation}:${job.businessId}`,
      job,
      {
        priority: options?.priority ?? 5,
        delay: options?.delay,
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600, count: 200 },
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    );
  }

  private async process(job: Job<TemporalFlowMemoryJob>): Promise<void> {
    const data = job.data;

    if (data.operation === 'compact') {
      if (data.businessId === 'ALL') {
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const rows = await this.prisma.client.temporalFlowEvent.findMany({
          where: { occurredAt: { gte: since } },
          select: { businessId: true },
          distinct: ['businessId'],
          take: 1000,
        });
        for (const row of rows) {
          try {
            await this.memoryService.compactBusiness(row.businessId);
          } catch (err) {
            this.logger.warn(`Compaction failed for ${row.businessId}: ${(err as Error).message}`);
          }
        }
        return;
      }

      const { threads, contacts, channels } = await this.memoryService.compactBusiness(data.businessId);
      this.logger.log(`Compacted ${threads} threads, ${contacts} contacts, ${channels} channels for ${data.businessId}`);
      return;
    }

    if (data.operation === 'detect_patterns') {
      await this.genomeBridge.detectPatterns(data.businessId);
      return;
    }
  }
}
