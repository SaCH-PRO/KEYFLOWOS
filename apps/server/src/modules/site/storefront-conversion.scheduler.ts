import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { StorefrontConversionService } from './storefront-conversion.service';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const HOURLY_MS = 60 * 60 * 1000;

/**
 * S2: Aggregate storefront funnel events into `storefront_conversion_daily`
 * once per hour. We re-aggregate the current UTC day (so the funnel reflects
 * the latest events) and the prior UTC day (so late-arriving events still
 * land in their bucket). The job runs across every business that has had a
 * storefront event in the last 48 hours — businesses with no activity are
 * skipped to keep the per-tick cost bounded.
 */
@Injectable()
export class StorefrontConversionScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StorefrontConversionScheduler.name);
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StorefrontConversionService) private readonly conversion: StorefrontConversionService,
  ) {}

  onModuleInit() {
    // Fire once a few seconds after boot so the first day's row exists
    // without waiting an hour.
    setTimeout(() => this.run().catch((e) => this.logger.error(`initial aggregation failed: ${(e as Error).message}`)), 15_000);
    this.interval = setInterval(() => {
      this.run().catch((e) => this.logger.error(`hourly aggregation failed: ${(e as Error).message}`));
    }, HOURLY_MS);
    this.logger.log('Storefront conversion aggregator started (hourly)');
  }

  onModuleDestroy() {
    if (this.interval) clearInterval(this.interval);
  }

  private async run() {
    const since = new Date(Date.now() - 2 * ONE_DAY_MS);
    let businesses: Array<{ businessId: string }>;
    try {
      businesses = await this.prisma.client.publicVisitorEvent.groupBy({
        by: ['businessId'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      });
    } catch (err) {
      this.logger.warn(`[conversion-scheduler] business scan failed: ${(err as Error).message}`);
      return;
    }
    if (businesses.length === 0) return;

    const today = this.startOfUtcDay(new Date());
    const yesterday = new Date(today.getTime() - ONE_DAY_MS);

    for (const { businessId } of businesses) {
      try {
        await this.conversion.aggregateDay(businessId, today);
        await this.conversion.aggregateDay(businessId, yesterday);
      } catch (err) {
        this.logger.warn(`[conversion-scheduler] business=${businessId} failed: ${(err as Error).message}`);
      }
    }
    this.logger.debug(`[conversion-scheduler] aggregated ${businesses.length} businesses for ${today.toISOString().slice(0, 10)} + prior day`);
  }

  private startOfUtcDay(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
}
