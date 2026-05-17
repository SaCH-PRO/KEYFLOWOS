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
    } catch (err) {
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
      } catch (err) {
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
}
