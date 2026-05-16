import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '../../core/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SystemEmailService } from '../notifications/system-email.service';

const TICK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const SCHEDULER_DISABLED = process.env.AI_USAGE_ALERT_SCHEDULER_DISABLED === '1' || process.env.NODE_ENV === 'test';

@Injectable()
export class AiUsageAlertSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiUsageAlertSchedulerService.name);
  private intervalRef: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private failureCounts = new Map<string, number>();
  private skipUntil = new Map<string, number>();
  private readonly MAX_FAILURES = 3;
  private readonly SKIP_DURATION_MS = 60 * 60 * 1000; // 1 hour

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ModuleRef) private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit() {
    if (SCHEDULER_DISABLED) {
      this.logger.log('AI usage alert scheduler disabled via env');
      return;
    }
    this.intervalRef = setInterval(() => {
      this.tick().catch((err) => this.logger.error('Alert tick failed', err));
    }, TICK_INTERVAL_MS);
    this.logger.log('AI usage alert scheduler started (5m interval)');
  }

  onModuleDestroy() {
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = null;
    }
  }

  async tick(): Promise<{ dispatched: number }> {
    if (this.running) return { dispatched: 0 };
    this.running = true;

    try {
      const unnotified = await this.prisma.client.aiUsageAlert.findMany({
        where: { notified: false },
        orderBy: { triggeredAt: 'desc' },
        take: 100,
      });

      if (unnotified.length === 0) {
        return { dispatched: 0 };
      }

      let dispatched = 0;
      for (const alert of unnotified) {
        const skipTime = this.skipUntil.get(alert.id) ?? 0;
        if (skipTime > Date.now()) {
          this.logger.debug(`Skipping alert ${alert.id} due to previous failures`);
          continue;
        }
        try {
          await this.dispatchAlert(alert);
          this.failureCounts.delete(alert.id);
          dispatched++;
        } catch (err) {
          const count = (this.failureCounts.get(alert.id) ?? 0) + 1;
          this.failureCounts.set(alert.id, count);
          this.logger.error(`Failed to dispatch alert ${alert.id} (attempt ${count}): ${(err as Error).message}`);
          if (count >= this.MAX_FAILURES) {
            this.skipUntil.set(alert.id, Date.now() + this.SKIP_DURATION_MS);
            this.logger.warn(`Alert ${alert.id} exceeded max failures; skipping for 1 hour`);
          }
        }
      }

      this.logger.log(`Dispatched ${dispatched}/${unnotified.length} AI usage alerts`);
      return { dispatched };
    } finally {
      this.running = false;
    }
  }

  private async dispatchAlert(alert: {
    id: string;
    businessId: string;
    type: string;
    threshold: number | null;
    metadata: unknown;
    triggeredAt: Date;
  }): Promise<void> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: alert.businessId },
      select: { name: true, email: true, ownerId: true },
    });

    if (!business) {
      this.logger.warn(`Business ${alert.businessId} not found for alert ${alert.id}`);
      await this.markNotified(alert.id);
      return;
    }

    // Resolve notification services lazily to avoid circular deps
    let notifications: NotificationsService | undefined;
    let systemEmail: SystemEmailService | undefined;
    try {
      notifications = this.moduleRef.get(NotificationsService, { strict: false });
    } catch {
      this.logger.warn('NotificationsService not available for alert dispatch');
    }
    try {
      systemEmail = this.moduleRef.get(SystemEmailService, { strict: false });
    } catch {
      this.logger.warn('SystemEmailService not available for alert dispatch');
    }

    const { title, body } = this.buildAlertContent(alert, business.name);

    // In-app notification
    if (notifications) {
      try {
        await notifications.create({
          businessId: alert.businessId,
          type: `ai_usage.${alert.type}`,
          title,
          body,
          data: { alertId: alert.id, threshold: alert.threshold, metadata: alert.metadata },
        });
      } catch (err) {
        this.logger.warn(`In-app notification failed for alert ${alert.id}: ${(err as Error).message}`);
      }
    }

    // Email notification
    if (systemEmail) {
      try {
        const recipientEmail = business.email || await this.resolveOwnerEmail(business.ownerId);
        if (recipientEmail) {
          await systemEmail.sendTransactional({
            to: recipientEmail,
            subject: title,
            html: `<p>${body}</p>`,
            text: body,
          });
        }
      } catch (err) {
        this.logger.warn(`Email notification failed for alert ${alert.id}: ${(err as Error).message}`);
      }
    }

    await this.markNotified(alert.id);
  }

  private async markNotified(alertId: string): Promise<void> {
    await this.prisma.client.aiUsageAlert.update({
      where: { id: alertId },
      data: { notified: true },
    });
  }

  private async resolveOwnerEmail(ownerId: string | null): Promise<string | null> {
    if (!ownerId) return null;
    const user = await this.prisma.client.user.findUnique({
      where: { id: ownerId },
      select: { email: true },
    });
    return user?.email ?? null;
  }

  private buildAlertContent(
    alert: { type: string; threshold: number | null; metadata: unknown },
    businessName: string,
  ): { title: string; body: string } {
    const meta = alert.metadata as Record<string, number> | undefined;
    const used = meta?.used ?? 0;
    const limit = meta?.limit ?? 0;
    const pct = meta?.pct ?? alert.threshold ?? 0;

    if (alert.type === 'credit_depleted') {
      return {
        title: `${businessName}: AI credits depleted`,
        body: `You have used ${used} of ${limit} AI credits this month. AI features are now blocked until your plan renews or you upgrade.`,
      };
    }

    if (alert.type === 'budget_threshold') {
      return {
        title: `${businessName}: AI credit usage at ${pct}%`,
        body: `You have used ${used} of ${limit} AI credits this month (${pct}% of your plan limit). Consider upgrading if you need more AI capacity.`,
      };
    }

    return {
      title: `${businessName}: AI usage alert`,
      body: `An AI usage alert was triggered for your business.`,
    };
  }
}
