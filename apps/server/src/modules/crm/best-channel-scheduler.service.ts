import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { BestChannelService } from './best-channel.service';
import { safeInterval } from '../../core/scheduling/safe-interval';

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const STARTUP_DELAY_MS = 150 * 1000;
// Run at 03:30 UTC; growth-intelligence runs at 03:00, this picks up freshly-synced events.
const TARGET_HOUR_UTC = 3;
const TARGET_MINUTE_UTC = 30;

@Injectable()
export class BestChannelSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BestChannelSchedulerService.name);
  private intervalRef: ReturnType<typeof setInterval> | null = null;
  private startupTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastRunDateKey: string | null = null;
  private running = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BestChannelService) private readonly bestChannel: BestChannelService,
  ) {}

  onModuleInit() {
    this.startupTimeout = setTimeout(() => {
      void this.tick();
      this.intervalRef = safeInterval('BestChannelSchedulerService', CHECK_INTERVAL_MS, () => this.tick(), this.logger);
    }, STARTUP_DELAY_MS);
    this.logger.log(
      `Nightly best-channel recompute armed for ${TARGET_HOUR_UTC.toString().padStart(2, '0')}:${TARGET_MINUTE_UTC.toString().padStart(2, '0')} UTC`,
    );
  }

  onModuleDestroy() {
    if (this.startupTimeout) clearTimeout(this.startupTimeout);
    if (this.intervalRef) clearInterval(this.intervalRef);
    this.startupTimeout = null;
    this.intervalRef = null;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    const now = new Date();
    if (now.getUTCHours() !== TARGET_HOUR_UTC) return;
    if (now.getUTCMinutes() < TARGET_MINUTE_UTC) return;
    const dateKey = now.toISOString().split('T')[0];
    if (this.lastRunDateKey === dateKey) return;
    this.lastRunDateKey = dateKey;
    this.running = true;
    try {
      const result = await this.runNightly();
      this.logger.log(
        `Nightly best-channel recompute complete for ${dateKey}: ${result.processed} contacts across ${result.businesses} businesses (${result.failed} failures)`,
      );
    } catch (err: any) {
      this.logger.error(
        `Nightly best-channel recompute failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }

  async runNightly(): Promise<{ businesses: number; processed: number; failed: number }> {
    const businesses = await this.prisma.client.business.findMany({ select: { id: true } });
    let processed = 0;
    let failed = 0;
    for (const b of businesses) {
      try {
        const r = await this.bestChannel.recomputeAllForBusiness(b.id);
        processed += r.processed;
        failed += r.failed;
      } catch (err: any) {
        failed += 1;
        this.logger.warn(
          `Best-channel recompute failed for business ${b.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return { businesses: businesses.length, processed, failed };
  }
}
