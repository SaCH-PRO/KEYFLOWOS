import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { StorefrontIntelligenceService } from './storefront-intelligence.service';

const TICK_MS = 60 * 60 * 1000; // hourly probe; only acts at the configured UTC hour
const RUN_HOUR_UTC = parseInt(process.env.PRESENCE_INSIGHTS_HOUR_UTC ?? '3', 10);

/**
 * Nightly job that regenerates `PresenceInsightSnapshot` rows for every
 * business that has any storefront activity in the last 30 days. Hourly
 * tick is intentional — staggered restarts can't miss the window.
 */
@Injectable()
export class StorefrontIntelligenceScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StorefrontIntelligenceScheduler.name);
  private intervalRef: ReturnType<typeof setInterval> | null = null;
  private lastRunDay: string | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StorefrontIntelligenceService) private readonly intelligence: StorefrontIntelligenceService,
  ) {}

  onModuleInit() {
    if (process.env.DISABLE_SCHEDULERS === '1' || process.env.NODE_ENV === 'test') {
      this.logger.log('[StorefrontIntelligenceScheduler] Disabled via env');
      return;
    }
    this.logger.log(
      `[StorefrontIntelligenceScheduler] Starting — regen @ ${RUN_HOUR_UTC}:00 UTC`,
    );
    this.intervalRef = setInterval(() => {
      void this.maybeRun().catch((e) =>
        this.logger.error(`Tick failed: ${(e as Error).message}`),
      );
    }, TICK_MS);
  }

  onModuleDestroy() {
    if (this.intervalRef) clearInterval(this.intervalRef);
    this.intervalRef = null;
  }

  private async maybeRun() {
    const now = new Date();
    if (now.getUTCHours() !== RUN_HOUR_UTC) return;
    const todayKey = now.toISOString().slice(0, 10);
    if (this.lastRunDay === todayKey) return;
    this.lastRunDay = todayKey;

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 30);

    // Only target businesses with any storefront signal — avoids scanning
    // every row in the businesses table on a quiet night. We paginate via a
    // stable id cursor so all eligible businesses are covered (no silent cap).
    const PAGE_SIZE = 200;
    let cursor: string | undefined = undefined;
    let regenerated = 0;
    let failed = 0;
    let scanned = 0;
    // Hard ceiling protects against runaway loops in pathological data; well
    // above any realistic production scale.
    const MAX_PAGES = 500;
    for (let page = 0; page < MAX_PAGES; page++) {
      const batch: { id: string }[] = await this.prisma.client.business.findMany({
        where: {
          deletedAt: null,
          OR: [
            { presenceDailyStats: { some: { day: { gte: since } } } },
            { marketplaceOrders: { some: { createdAt: { gte: since } } } },
            { bookings: { some: { deletedAt: null, createdAt: { gte: since } } } },
          ],
        },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: PAGE_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (batch.length === 0) break;
      scanned += batch.length;
      for (const b of batch) {
        try {
          await this.intelligence.regenerate(b.id, 30);
          regenerated++;
        } catch (e) {
          failed++;
          this.logger.warn(`regenerate failed for ${b.id}: ${(e as Error).message}`);
        }
      }
      cursor = batch[batch.length - 1].id;
      if (batch.length < PAGE_SIZE) break;
    }
    this.logger.log(
      `[StorefrontIntelligenceScheduler] regenerated=${regenerated} failed=${failed} businesses=${scanned}`,
    );
  }
}
