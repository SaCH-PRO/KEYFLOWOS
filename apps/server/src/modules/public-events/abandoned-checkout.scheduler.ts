import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CrmService } from '../crm/crm.service';
import { CrmTimelineService } from '../crm/crm-timeline.service';

const TICK_MS = 30 * 60 * 1000;
const ABANDON_AFTER_HOURS = 6;
const ABANDON_HORIZON_HOURS = 72;
const BATCH_SIZE = 100;
const TASK_SOURCE = 'abandoned-checkout';
const ABANDONED_FLAG_KEY = 'abandonedFollowupAt';

/**
 * Periodically scans MarketplaceOrder rows that look like abandoned
 * storefront checkouts (PENDING + UNPAID, customerEmail present, older
 * than ABANDON_AFTER_HOURS) and creates a ContactTask for the seller to
 * follow up. Idempotent — flagged orders are skipped via metadata.
 */
@Injectable()
export class AbandonedCheckoutScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AbandonedCheckoutScheduler.name);
  private intervalRef: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CrmService) private readonly crm: CrmService,
    @Inject(CrmTimelineService) private readonly timeline: CrmTimelineService,
  ) {}

  onModuleInit() {
    if (process.env.DISABLE_SCHEDULERS === '1' || process.env.NODE_ENV === 'test') {
      this.logger.log('[AbandonedCheckoutScheduler] Disabled via env');
      return;
    }
    this.logger.log(`[AbandonedCheckoutScheduler] Starting — every ${TICK_MS / 60000}m`);
    this.intervalRef = setInterval(() => {
      void this.runOnce().catch((e) =>
        this.logger.error(`Tick failed: ${(e as Error).message}`),
      );
    }, TICK_MS);
  }

  onModuleDestroy() {
    if (this.intervalRef) clearInterval(this.intervalRef);
    this.intervalRef = null;
  }

  async runOnce(): Promise<{ scanned: number; tasksCreated: number }> {
    const olderThan = new Date(Date.now() - ABANDON_AFTER_HOURS * 60 * 60 * 1000);
    const horizon = new Date(Date.now() - ABANDON_HORIZON_HOURS * 60 * 60 * 1000);

    const candidates = await this.prisma.client.marketplaceOrder.findMany({
      where: {
        status: 'PENDING',
        paymentStatus: { in: ['UNPAID', 'PENDING'] },
        type: 'STOREFRONT',
        customerEmail: { not: null },
        createdAt: { lt: olderThan, gte: horizon },
      },
      select: {
        id: true,
        businessId: true,
        orderNumber: true,
        customerName: true,
        customerEmail: true,
        customerPhone: true,
        total: true,
        currency: true,
        metadata: true,
      },
      take: BATCH_SIZE,
    });

    let tasksCreated = 0;
    for (const order of candidates) {
      const meta =
        order.metadata && typeof order.metadata === 'object' && !Array.isArray(order.metadata)
          ? (order.metadata as Record<string, unknown>)
          : {};
      if (meta[ABANDONED_FLAG_KEY]) continue;

      try {
        const contact = await this.crm.findOrCreateContact(order.businessId, {
          firstName: order.customerName?.split(/\s+/)[0] ?? null,
          lastName: order.customerName?.split(/\s+/).slice(1).join(' ') || null,
          email: order.customerEmail,
          phone: order.customerPhone,
          source: 'storefront',
          sourceDetail: `order:${order.orderNumber}`,
        });
        if (!contact) continue;

        await this.prisma.client.contactTask.create({
          data: {
            businessId: order.businessId,
            contactId: contact.id,
            title: `Abandoned checkout: follow up on order ${order.orderNumber} (${order.currency} ${order.total.toFixed(2)})`,
            status: 'OPEN',
            priority: 'MEDIUM',
            dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
            source: TASK_SOURCE,
          },
        });

        try {
          await this.timeline.logContactEvent({
            businessId: order.businessId,
            contactId: contact.id,
            type: 'checkout.abandoned',
            data: {
              orderId: order.id,
              orderNumber: order.orderNumber,
              total: order.total,
              currency: order.currency,
            },
            source: 'storefront',
            actorType: 'SYSTEM',
          });
        } catch (err) {
          this.logger.debug?.(`[AbandonedCheckout] timeline log skipped: ${(err as Error).message}`);
        }

        await this.prisma.client.marketplaceOrder.update({
          where: { id: order.id },
          data: {
            metadata: { ...meta, [ABANDONED_FLAG_KEY]: new Date().toISOString() },
          },
        });

        tasksCreated++;
      } catch (err) {
        this.logger.warn(
          `[AbandonedCheckout] failed for order=${order.id}: ${(err as Error).message}`,
        );
      }
    }

    if (tasksCreated > 0) {
      this.logger.log(
        `[AbandonedCheckoutScheduler] Created ${tasksCreated}/${candidates.length} follow-up tasks`,
      );
    }
    return { scanned: candidates.length, tasksCreated };
  }
}
