import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { FulfillmentRoutingService } from './fulfillment-routing.service';
import type { StoreOrderRoutingFailedPayload } from '../../core/event-bus/events.types';

type StoreOrderPaidPayload = {
  order: { id: string };
  businessId: string;
};

type FulfillmentRoute = { strategy?: string };

/**
 * Safety net + canonical fan-out: when `store_order.paid` fires we make sure
 * fulfillment routing has happened (it is also kicked off inline by the paid
 * path), and emit `store_order.fulfillment_routed` so CRM/notifications can
 * react on a single canonical event instead of poking the marketplace tables.
 *
 * Idempotent: `routeOrder` short-circuits when routes already exist.
 *
 * W9-STORE-PAID-LISTENERS (V18-T2, SEC-V18-3; D-18): routing runs only for an
 * order stored PAID in the event's business. PATCH .../orders/:id/status
 * 'paid' with no payment emits store_order.paid for a STANDARD order stored
 * UNPAID, and a queued or forged copy can name an unpaid order or another
 * business's order: routing reserved stock, moved the order to routed and
 * told CRM it was fulfilled (or, for another business, that routing failed).
 * Nothing is routed or emitted otherwise.
 */
@Injectable()
export class StoreOrderRoutingListener {
  private readonly logger = new Logger(StoreOrderRoutingListener.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FulfillmentRoutingService) private readonly routing: FulfillmentRoutingService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  @OnEvent('store_order.paid', { async: true })
  async onStoreOrderPaid(payload: StoreOrderPaidPayload) {
    const orderId = payload?.order?.id;
    if (!orderId) return;
    if (!(await this.isStoredOrderPaid(payload.businessId, orderId))) return;
    try {
      const routes = (await this.routing.routeOrder(payload.businessId, orderId)) as
        | FulfillmentRoute[]
        | null
        | undefined;
      const strategies = Array.from(
        new Set((routes ?? []).map((r) => r?.strategy).filter((s): s is string => Boolean(s))),
      );

      const order = await this.prisma.client.marketplaceOrder.findFirst({
        where: { id: orderId, businessId: payload.businessId },
        select: { customerEmail: true, customerName: true },
      });
      let contactId: string | null = null;
      if (order?.customerEmail) {
        const contact = await this.prisma.client.contact.findFirst({
          where: { businessId: payload.businessId, email: order.customerEmail, deletedAt: null },
          select: { id: true },
        });
        contactId = contact?.id ?? null;
      }

      this.events.emit('store_order.fulfillment_routed', {
        orderId,
        businessId: payload.businessId,
        contactId,
        strategies,
        routeCount: routes?.length ?? 0,
      });
    } catch (err: any) {
      const errMsg = (err as Error).message;
      this.logger.warn(
        `store_order.paid → routeOrder failed for ${orderId}: ${errMsg}`,
      );
      let contactId: string | null = null;
      try {
        const order = await this.prisma.client.marketplaceOrder.findFirst({
          where: { id: orderId, businessId: payload.businessId },
          select: { customerEmail: true },
        });
        if (order?.customerEmail) {
          const contact = await this.prisma.client.contact.findFirst({
            where: { businessId: payload.businessId, email: order.customerEmail, deletedAt: null },
            select: { id: true },
          });
          contactId = contact?.id ?? null;
        }
      } catch (err: any) {
          this.logger.warn(`; do not block the failure event: ${err instanceof Error ? err.message : err}`);
        }
      const failurePayload: StoreOrderRoutingFailedPayload = {
        businessId: payload.businessId,
        orderId,
        contactId,
        error: errMsg.slice(0, 500),
      };
      this.events.emit('store_order.routing_failed', failurePayload);
    }
  }

  /** W9-STORE-PAID-LISTENERS (V18-T2; D-18): the order, read in the event's business, is stored PAID. */
  private async isStoredOrderPaid(businessId: string, orderId: string): Promise<boolean> {
    if (!businessId || typeof orderId !== 'string') return false;
    try {
      const stored = await this.prisma.client.marketplaceOrder.findFirst({
        where: { id: orderId, businessId },
        select: { paymentStatus: true },
      });
      if ((stored?.paymentStatus ?? '').toUpperCase() === 'PAID') return true;
      this.logger.warn(
        `store_order.paid for order ${orderId} not stored PAID in business ${businessId} (${stored ? stored.paymentStatus : 'not found'}); not routed`,
      );
      return false;
    } catch (err) {
      this.logger.warn(`store_order.paid stored-order read failed for ${orderId}: ${(err as Error).message}`);
      return false;
    }
  }
}
