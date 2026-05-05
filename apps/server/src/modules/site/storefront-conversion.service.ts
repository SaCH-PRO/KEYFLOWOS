import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';

type ConversionKind = 'product' | 'service' | 'overall';

const VIEW_TYPES = new Set(['product.viewed', 'service.viewed', 'storefront.viewed']);
const CART_TYPES = new Set(['cart.updated', 'cart.added']);
const CHECKOUT_TYPES = new Set(['checkout.started']);
const ORDER_TYPES = new Set(['store_order.created', 'payment.completed']);
const BOOKING_TYPES = new Set(['booking.created']);

/**
 * Aggregates the public storefront funnel into daily rows
 * (`storefront_conversion_daily`) so dashboards/S4 reports don't have to
 * re-scan PublicVisitorEvent every time. Idempotent by (businessId, day,
 * kind, refId): re-running for the same day overwrites counters with the
 * latest scan, so cron retries are safe.
 *
 * Wired by SiteModule and called from a daily cron + ad-hoc by the
 * /conversion-funnel endpoint to backfill on demand.
 */
@Injectable()
export class StorefrontConversionService {
  private readonly logger = new Logger(StorefrontConversionService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  /**
   * Aggregate storefront events for a single business + day into the
   * StorefrontConversionDaily table. Returns the number of rows upserted.
   */
  async aggregateDay(businessId: string, day: Date): Promise<number> {
    const dayStart = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    const dayEnd = new Date(dayStart.getTime() + 86400000);

    const events = await this.prisma.client.publicVisitorEvent.findMany({
      where: {
        businessId,
        createdAt: { gte: dayStart, lt: dayEnd },
      },
      select: { type: true, data: true },
    });

    type Counters = {
      views: number;
      cartAdds: number;
      checkouts: number;
      orders: number;
      bookings: number;
      revenue: number;
    };
    const make = (): Counters => ({
      views: 0,
      cartAdds: 0,
      checkouts: 0,
      orders: 0,
      bookings: 0,
      revenue: 0,
    });

    const overall = make();
    const byProduct = new Map<string, Counters>();
    const byService = new Map<string, Counters>();

    const bump = (
      bucket: Counters,
      field: keyof Counters,
      amount = 1,
    ) => {
      bucket[field] += amount;
    };

    for (const evt of events) {
      const data = (evt.data && typeof evt.data === 'object' && !Array.isArray(evt.data)
        ? (evt.data as Record<string, unknown>)
        : {}) as Record<string, unknown>;
      const productId = typeof data.productId === 'string' ? data.productId : null;
      const serviceId = typeof data.serviceId === 'string' ? data.serviceId : null;
      const total = Number(data.total ?? 0) || 0;

      const targetMap = productId
        ? byProduct
        : serviceId
        ? byService
        : null;
      const targetKey = productId ?? serviceId ?? null;
      const target = targetMap && targetKey
        ? (targetMap.get(targetKey) ?? (targetMap.set(targetKey, make()).get(targetKey) as Counters))
        : null;

      if (VIEW_TYPES.has(evt.type)) {
        bump(overall, 'views');
        if (target) bump(target, 'views');
      } else if (CART_TYPES.has(evt.type)) {
        bump(overall, 'cartAdds');
        if (target) bump(target, 'cartAdds');
      } else if (CHECKOUT_TYPES.has(evt.type)) {
        bump(overall, 'checkouts');
        if (target) bump(target, 'checkouts');
      } else if (ORDER_TYPES.has(evt.type)) {
        if (evt.type === 'store_order.created') {
          bump(overall, 'orders');
          if (target) bump(target, 'orders');
        }
        if (evt.type === 'payment.completed' && total > 0) {
          bump(overall, 'revenue', total);
          if (target) bump(target, 'revenue', total);
        }
      } else if (BOOKING_TYPES.has(evt.type)) {
        bump(overall, 'bookings');
        if (target) bump(target, 'bookings');
      }
    }

    let upserts = 0;
    const writeRow = async (kind: ConversionKind, refId: string, c: Counters) => {
      try {
        await this.prisma.client.storefrontConversionDaily.upsert({
          where: {
            businessId_day_kind_refId: { businessId, day: dayStart, kind, refId },
          },
          create: {
            businessId,
            day: dayStart,
            kind,
            refId,
            views: c.views,
            cartAdds: c.cartAdds,
            checkouts: c.checkouts,
            orders: c.orders,
            bookings: c.bookings,
            revenue: c.revenue,
          },
          update: {
            views: c.views,
            cartAdds: c.cartAdds,
            checkouts: c.checkouts,
            orders: c.orders,
            bookings: c.bookings,
            revenue: c.revenue,
          },
        });
        upserts++;
      } catch (err) {
        this.logger.warn(
          `[conversion-daily] upsert failed business=${businessId} day=${dayStart.toISOString()} kind=${kind} ref=${refId}: ${(err as Error).message}`,
        );
      }
    };

    await writeRow('overall', '', overall);
    for (const [productId, c] of byProduct.entries()) {
      await writeRow('product', productId, c);
    }
    for (const [serviceId, c] of byService.entries()) {
      await writeRow('service', serviceId, c);
    }
    return upserts;
  }

  /**
   * Read funnel for a business across a time range (defaults to last 30 days).
   * Used by /conversion-funnel endpoints.
   */
  async getFunnel(
    businessId: string,
    options?: { from?: Date; to?: Date; kind?: ConversionKind; refId?: string },
  ) {
    const to = options?.to ?? new Date();
    const from = options?.from ?? new Date(to.getTime() - 30 * 86400000);
    const where: Prisma.StorefrontConversionDailyWhereInput = {
      businessId,
      day: { gte: from, lte: to },
    };
    if (options?.kind) where.kind = options.kind;
    if (options?.refId !== undefined) where.refId = options.refId;

    const rows = await this.prisma.client.storefrontConversionDaily.findMany({
      where,
      orderBy: { day: 'asc' },
    });
    return rows;
  }
}
