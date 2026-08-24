import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CustomerJourneyService } from './customer-journey.service';
import { GrowthIntelligenceService } from './growth-intelligence.service';
import { safeInterval } from '../../core/scheduling/safe-interval';

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const STARTUP_DELAY_MS = 120 * 1000;
// Run at 03:00 UTC, one hour after the nightly connector sync window so the
// recompute consumes the freshly-synced data.
const TARGET_HOUR_UTC = 3;

export interface NightlyJourneyRecomputeResult {
  businesses: number;
  journeysRecomputed: number;
  insightsRefreshed: number;
  failed: number;
}

/**
 * Once per night: re-evaluate every CustomerJourney's healthScore / riskLevel
 * and regenerate growth insights so the dashboard reflects current reality
 * even when no realtime events have fired (e.g. churn risk based on time
 * since last touch).
 */
@Injectable()
export class GrowthIntelligenceSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GrowthIntelligenceSchedulerService.name);
  private intervalRef: ReturnType<typeof setInterval> | null = null;
  private startupTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastRunDateKey: string | null = null;
  private running = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CustomerJourneyService) private readonly journeys: CustomerJourneyService,
    @Inject(GrowthIntelligenceService) private readonly growth: GrowthIntelligenceService,
  ) {}

  onModuleInit() {
    this.startupTimeout = setTimeout(() => {
      void this.tick();
      this.intervalRef = safeInterval('GrowthIntelligenceSchedulerService', CHECK_INTERVAL_MS, () => this.tick(), this.logger);
    }, STARTUP_DELAY_MS);
    this.logger.log(
      `Nightly journey recompute scheduler armed for ${TARGET_HOUR_UTC.toString().padStart(2, '0')}:00 UTC (poll every ${CHECK_INTERVAL_MS / 60000} min)`,
    );
  }

  onModuleDestroy() {
    if (this.startupTimeout) {
      clearTimeout(this.startupTimeout);
      this.startupTimeout = null;
    }
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    const now = new Date();
    if (now.getUTCHours() !== TARGET_HOUR_UTC) return;
    const dateKey = now.toISOString().split('T')[0];
    if (this.lastRunDateKey === dateKey) return;
    this.lastRunDateKey = dateKey;
    this.running = true;
    try {
      const result = await this.runNightlyRecompute();
      this.logger.log(
        `Nightly journey recompute complete for ${dateKey}: ${result.journeysRecomputed} journeys, ${result.insightsRefreshed} insight refreshes across ${result.businesses} businesses (${result.failed} failures)`,
      );
    } catch (err: any) {
      this.logger.error(
        `Nightly journey recompute failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * For every business in the system, recompute all CustomerJourney health
   * scores and regenerate growth insights. Per-business failures are caught
   * so one tenant's bad data cannot stall the rest of the run.
   */
  async runNightlyRecompute(): Promise<NightlyJourneyRecomputeResult> {
    const businesses = await this.prisma.client.business.findMany({
      select: { id: true },
    });

    let journeysRecomputed = 0;
    let insightsRefreshed = 0;
    let failed = 0;

    for (const business of businesses) {
      try {
        const recompute = await this.journeys.recomputeAllForBusiness(business.id);
        journeysRecomputed += recompute.processed;
        if (recompute.failed > 0) failed += recompute.failed;
      } catch (err: any) {
        failed += 1;
        this.logger.warn(
          `Recompute failed for business ${business.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      try {
        await this.growth.generateInsights(business.id);
        insightsRefreshed += 1;
      } catch (err: any) {
        failed += 1;
        this.logger.warn(
          `Insight regeneration failed for business ${business.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return {
      businesses: businesses.length,
      journeysRecomputed,
      insightsRefreshed,
      failed,
    };
  }
}
