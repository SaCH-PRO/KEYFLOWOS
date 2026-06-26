import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { QueueService } from './queue.service';

@Injectable()
export class CronSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(CronSchedulerService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(QueueService) private readonly queue: QueueService,
  ) {}

  async onModuleInit() {
    // Seed cron triggers on boot
    await this.syncCronTriggers();
  }

  async syncCronTriggers(): Promise<void> {
    const triggers = await this.prisma.client.agentTrigger.findMany({
      where: {
        enabled: true,
        schedule: { not: null },
      },
    });

    for (const trigger of triggers) {
      if (!trigger.schedule) continue;
      try {
        await this.queue.enqueueCronTrigger(
          {
            triggerId: trigger.id,
            businessId: trigger.businessId,
            eventName: trigger.eventPattern,
            payload: {
              triggerId: trigger.id,
              name: trigger.name,
              objective: trigger.objective,
              condition: trigger.condition,
            },
          },
          trigger.schedule,
        );
        this.logger.log(`Registered cron trigger: ${trigger.name} (${trigger.schedule})`);
      } catch (err: any) {
        this.logger.error(`Failed to register cron trigger ${trigger.id}: ${(err as Error).message}`);
      }
    }
  }

  async addCronTrigger(triggerId: string): Promise<void> {
    const trigger = await this.prisma.client.agentTrigger.findUnique({
      where: { id: triggerId },
    });
    if (!trigger || !trigger.enabled || !trigger.schedule) return;

    await this.queue.enqueueCronTrigger(
      {
        triggerId: trigger.id,
        businessId: trigger.businessId,
        eventName: trigger.eventPattern,
        payload: {
          triggerId: trigger.id,
          name: trigger.name,
          objective: trigger.objective,
          condition: trigger.condition,
        },
      },
      trigger.schedule,
    );
  }

  async removeCronTrigger(triggerId: string): Promise<void> {
    await this.queue.removeCronTrigger(triggerId);
  }
}
