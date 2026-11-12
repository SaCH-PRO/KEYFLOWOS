import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TransactionalEmailService } from '../notifications/transactional-email.service';
import { appUrl } from '../../core/config/runtime-urls';
import { schedulersDisabled } from '../../core/config/env';

@Injectable()
export class AbandonedCartRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AbandonedCartRecoveryService.name);
  private interval: ReturnType<typeof setInterval> | null = null;
  private readonly CART_ABANDON_MS = 30 * 60 * 1000; // 30 minutes
  private readonly RECOVERY_DELAYS_HOURS = [24, 48, 72];

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TransactionalEmailService) private readonly transactionalEmail: TransactionalEmailService,
  ) {}

  onModuleInit() {
    if (schedulersDisabled()) {
      this.logger.log('Scheduler disabled (DISABLE_SCHEDULERS, KF_DISABLE_SCHEDULERS or NODE_ENV=test)');
      return;
    }
    this.interval = setInterval(() => {
      this.scanAndSchedule().catch((e) =>
        this.logger.error(`Abandoned cart scan failed: ${(e as Error).message}`),
      );
      this.sendRecoveryEmails().catch((e) =>
        this.logger.error(`Recovery send failed: ${(e as Error).message}`),
      );
    }, 60 * 60 * 1000); // hourly
  }

  onModuleDestroy() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async scanAndSchedule() {
    const cutoff = new Date(Date.now() - this.CART_ABANDON_MS);

    // Find cart.added events in the last window with no matching checkout.complete
    const cartEvents = await this.prisma.client.publicVisitorEvent.findMany({
      where: {
        type: 'cart.added',
        createdAt: { gte: new Date(cutoff.getTime() - 60 * 60 * 1000), lt: cutoff },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    for (const event of cartEvents) {
      const visitorId = event.visitorId;
      const businessId = event.businessId;
      const data = event.data as Record<string, any>;
      const productIds = data?.productIds ?? [];

      // Check if this visitor completed checkout after cart add
      const completed = await this.prisma.client.publicVisitorEvent.findFirst({
        where: {
          visitorId,
          businessId,
          type: 'checkout.complete',
          createdAt: { gte: event.createdAt },
        },
      });
      if (completed) continue;

      // Check if already scheduled
      const checkpoint = `abandoned_${visitorId}_${event.id.slice(-8)}`;
      const existing = await this.prisma.client.scheduledAgentJob.findFirst({
        where: { businessId, checkpoint },
      });
      if (existing) continue;

      // Schedule recovery sequence
      const contactEmail = data?.customerEmail ?? null;
      const contactName = data?.customerName ?? 'Valued Customer';

      for (const hours of this.RECOVERY_DELAYS_HOURS) {
        await this.prisma.client.scheduledAgentJob.create({
          data: {
            businessId,
            jobType: 'abandoned_cart_recovery',
            entityId: event.id,
            checkpoint: `${checkpoint}_h${hours}`,
            status: 'PENDING',
            scheduledFor: new Date(Date.now() + hours * 60 * 60 * 1000),
            payload: {
              visitorId,
              contactEmail,
              contactName,
              productIds,
              hour: hours,
            },
          },
        });
      }

      this.logger.log(`Scheduled abandoned cart recovery for visitor ${visitorId.slice(-8)}`);
    }
  }

  /**
   * V1-84 (FOLLOW3-D17-JOB-RUNNER-CLAIMS): the V1-35 claim, unchanged. Each job
   * is claimed before any effect by a compare-and-set on the version read
   * (PENDING, same updatedAt, still due; count === 1), so overlapping ticks or a
   * second server instance never send a recovery email twice. A job with no
   * recipient is closed by its claim. A failed execution marks the row FAILED
   * only while it is still this claim's. A claim that throws leaves the row
   * PENDING and ends this tick (logged by the interval). A lease for a crash
   * after the claim is V1+.
   */
  async sendRecoveryEmails() {
    const jobs = await this.prisma.client.scheduledAgentJob.findMany({
      where: {
        jobType: 'abandoned_cart_recovery',
        status: 'PENDING',
        scheduledFor: { lte: new Date() },
      },
      take: 50,
      orderBy: { scheduledFor: 'asc' },
    });

    for (const job of jobs) {
      const claimedAt = new Date();
      const claim = await this.prisma.client.scheduledAgentJob.updateMany({
        where: { id: job.id, status: 'PENDING', updatedAt: job.updatedAt, scheduledFor: { lte: claimedAt } },
        data: { status: 'COMPLETED', executedAt: claimedAt },
      });
      if (claim.count !== 1) continue; // taken by another claimant, cancelled, or re-armed after the read
      try {
        const p = job.payload as Record<string, any>;
        if (!p.contactEmail) continue; // nothing to send; the claim closed it COMPLETED

        const base = appUrl();
        const recoveryUrl = base ? `${base}/storefront/${job.businessId}?recover=${p.visitorId}` : undefined;
        const discountPercent = p.hour === 72 ? 10 : undefined; // final email: 10% off

        await this.transactionalEmail.send({
          businessId: job.businessId,
          type: 'booking_created', // reuse booking_created as generic reminder template; ideally add abandoned_cart template
          recipientEmail: p.contactEmail,
          recipientName: p.contactName,
          templateData: {
            serviceName: 'your cart',
            startTime: new Date(),
            businessUrl: recoveryUrl,
            discountPercent,
          },
          dedupeKey: `cart-recovery_${job.entityId}_${p.hour}`,
        });
      } catch (e) {
        this.logger.error(`Cart recovery failed for job ${job.id}: ${(e as Error).message}`);
        // Fenced to this claim: a row its writer re-armed during the execution keeps its new run.
        const failed = await this.prisma.client.scheduledAgentJob.updateMany({
          where: { id: job.id, status: 'COMPLETED', executedAt: claimedAt },
          data: { status: 'FAILED' },
        }).catch(() => null);
        if (failed && failed.count !== 1) {
          this.logger.warn(`Cart recovery job ${job.id} changed during its failed execution; left as its writer set it`);
        }
      }
    }
  }
}
