import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CommerceService } from './commerce.service';

const TICK_MS = 60 * 60 * 1000; // hourly
const TARGET_HOUR = 8; // run once per business per UTC day at ~08:00

/**
 * R3: Daily scan that calls CommerceService.getStaleQuotes for every
 * business with at least one SENT quote. getStaleQuotes itself emits
 * `quote.stale` events which the QuoteStaleListener turns into
 * Action Queue cards. A coarse hourly tick + per-day-per-business
 * idempotency check keeps the runtime cheap while still firing once
 * per day even if the process restarts.
 *
 * Disabled outside production-style runtimes via DISABLE_SCHEDULERS=1
 * or NODE_ENV=test, mirroring InvoiceOverdueScheduler.
 */
@Injectable()
export class QuoteStaleScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QuoteStaleScheduler.name);
  private intervalRef: ReturnType<typeof setInterval> | null = null;
  private lastRunDateByBusiness = new Map<string, string>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CommerceService) private readonly commerce: CommerceService,
  ) {}

  onModuleInit() {
    if (process.env.DISABLE_SCHEDULERS === '1' || process.env.NODE_ENV === 'test') {
      this.logger.log('[QuoteStaleScheduler] Disabled via env');
      return;
    }
    this.logger.log(`[QuoteStaleScheduler] Starting — every ${TICK_MS / 60000}m, runs once/day at hour ${TARGET_HOUR} UTC`);
    this.intervalRef = setInterval(() => {
      void this.tick().catch((e) => this.logger.error(`Tick failed: ${(e as Error).message}`));
    }, TICK_MS);
  }

  onModuleDestroy() {
    if (this.intervalRef) clearInterval(this.intervalRef);
    this.intervalRef = null;
  }

  private async tick() {
    const now = new Date();
    if (now.getUTCHours() !== TARGET_HOUR) return;
    await this.runOnce();
  }

  /** Public for the verify-revenue.sh smoke script + tests. */
  async runOnce(): Promise<{ businessesScanned: number; staleQuotes: number }> {
    const dateKey = new Date().toISOString().slice(0, 10);
    // Only scan businesses that actually have at least one candidate
    // SENT quote — keeps the scan O(active commerce tenants) rather
    // than O(all businesses).
    const businesses = await this.prisma.client.quote.findMany({
      where: {
        deletedAt: null,
        status: 'SENT',
        viewedAt: null,
        acceptedAt: null,
        rejectedAt: null,
      },
      select: { businessId: true },
      distinct: ['businessId'],
    });
    let stale = 0;
    let scanned = 0;
    for (const { businessId } of businesses) {
      if (this.lastRunDateByBusiness.get(businessId) === dateKey) continue;
      try {
        const rows = await this.commerce.getStaleQuotes(businessId);
        stale += rows.length;
        scanned++;
        this.lastRunDateByBusiness.set(businessId, dateKey);
      } catch (e) {
        this.logger.warn(`Stale-quote scan failed for ${businessId}: ${(e as Error).message}`);
      }
    }
    if (scanned > 0) {
      this.logger.log(`[QuoteStaleScheduler] Scanned ${scanned} businesses, surfaced ${stale} stale quote(s)`);
    }
    return { businessesScanned: scanned, staleQuotes: stale };
  }
}
