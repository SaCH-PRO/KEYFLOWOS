import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { CalendarProjectionService } from '../calendar-projection.service';
import { mapMarketplaceOrder, SourceMarketplaceOrder } from '../projection-mappers';

interface StoreOrderPayload {
  businessId?: string;
  order: SourceMarketplaceOrder;
}

@Injectable()
export class CalendarOrdersListener {
  private readonly logger = new Logger(CalendarOrdersListener.name);

  constructor(
    @Inject(CalendarProjectionService)
    private readonly projection: CalendarProjectionService,
    // W10-STORE-ORDER-PAID (V18-T2b): the stored order behind a store_order.paid (PrismaModule is global).
    @Inject(PrismaService)
    private readonly prisma: PrismaService,
  ) {}

  @OnEvent('store_order.created', { async: true })
  @OnEvent('store_order.shipped', { async: true })
  @OnEvent('store_order.delivered', { async: true })
  @OnEvent('store_order.cancelled', { async: true })
  @OnEvent('store_order.refunded', { async: true })
  async onOrderChanged(payload: StoreOrderPayload): Promise<void> {
    const order = payload?.order;
    const businessId = payload?.businessId ?? (order as { businessId?: string })?.businessId;
    if (!businessId || !order) return;
    await this.project(order, businessId);
  }

  /**
   * W10-STORE-ORDER-PAID (V18-T2b, review STL-SEC-2 / CR-W9SPL-1; D-112, D-18):
   * a paid order is projected only when it is stored PAID in the event's
   * business, and from its stored row, as the W9 listeners read it. PATCH
   * .../orders/:id/status 'paid' alone (open to any member) emitted
   * store_order.paid for a STANDARD order stored UNPAID (no longer since the
   * W10-STORE-ORDER-PAID review, SEC-SOP-2), and a queued or forged
   * copy can name an unpaid order or another business's order, which was
   * projected into the business the event named. Nothing is projected otherwise.
   */
  @OnEvent('store_order.paid', { async: true })
  async onOrderPaid(payload: StoreOrderPayload): Promise<void> {
    const orderId = payload?.order?.id;
    const businessId = payload?.businessId;
    if (!businessId || typeof orderId !== 'string') return;
    const stored = (await this.prisma.client.marketplaceOrder
      .findFirst({
        where: { id: orderId, businessId },
        select: { id: true, orderNumber: true, status: true, paymentStatus: true, total: true, currency: true, metadata: true },
      })
      .catch((err: unknown) => {
        this.logger.warn(`store_order.paid stored-order read failed for ${orderId}: ${(err as Error).message}`);
        return null;
      })) as SourceMarketplaceOrder | null;
    if ((stored?.paymentStatus ?? '').toUpperCase() !== 'PAID') {
      this.logger.warn(
        `store_order.paid for order ${orderId} not stored PAID in business ${businessId} (${stored ? stored.paymentStatus : 'not found'}); not projected`,
      );
      return;
    }
    await this.project(stored as SourceMarketplaceOrder, businessId);
  }

  private async project(order: SourceMarketplaceOrder, businessId: string): Promise<void> {
    const input = mapMarketplaceOrder(order, businessId);
    if (!input) {
      // No expected ship/delivery hint; nothing to project at order level.
      return;
    }
    try {
      await this.projection.upsertFromSource(input);
    } catch (err: any) {
      this.logger.warn(
        `marketplace_order projection failed id=${order.id}: ${(err as Error).message}`,
      );
    }
  }
}
