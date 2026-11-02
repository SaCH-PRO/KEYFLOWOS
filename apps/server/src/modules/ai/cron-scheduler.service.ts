import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { QueueService } from './queue.service';
import { schedulersDisabled } from '../../core/config/env';

@Injectable()
export class CronSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(CronSchedulerService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(QueueService) private readonly queue: QueueService,
  ) {}

  async onModuleInit() {
    // V1-24b review (SEC-V124b-1): seeding every tenant's scheduled AgentTrigger
    // as a BullMQ repeatable at boot is a scheduler. With schedulers off no
    // trigger is read or registered; QueueService starts no cron worker either,
    // so a repeatable an earlier boot left in Redis does not fire here.
    if (schedulersDisabled()) {
      this.logger.log('Cron triggers not registered (DISABLE_SCHEDULERS, KF_DISABLE_SCHEDULERS or NODE_ENV=test)');
      return;
    }
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
