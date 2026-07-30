import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
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
  ) {}

  @OnEvent('store_order.created', { async: true })
  @OnEvent('store_order.paid', { async: true })
  @OnEvent('store_order.shipped', { async: true })
  @OnEvent('store_order.delivered', { async: true })
  @OnEvent('store_order.cancelled', { async: true })
  @OnEvent('store_order.refunded', { async: true })
  async onOrderChanged(payload: StoreOrderPayload): Promise<void> {
    const order = payload?.order;
    const businessId = payload?.businessId ?? (order as { businessId?: string })?.businessId;
    if (!businessId || !order) return;

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
