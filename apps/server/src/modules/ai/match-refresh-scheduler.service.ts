import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { BusinessMatchingService } from './business-matching.service';

const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const STALENESS_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class MatchRefreshSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MatchRefreshSchedulerService.name);
  private intervalRef: ReturnType<typeof setInterval> | null = null;
  private lastRunDate: string | null = null;

  constructor(
    @Inject(BusinessMatchingService) private readonly matching: BusinessMatchingService,
  ) {}

  onModuleInit() {
    this.logger.log('Starting match refresh scheduler — checking every hour');
    this.intervalRef = setInterval(() => {
      void this.checkAndRefresh();
    }, CHECK_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = null;
    }
    this.logger.log('Match refresh scheduler stopped');
  }

  private async checkAndRefresh(): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    if (this.lastRunDate === today) return;

    try {
      this.logger.log('Running daily match refresh cycle');
      const refreshed = await this.matching.refreshStaleMatches(STALENESS_MS);
      this.lastRunDate = today;
      this.logger.log(`Daily match refresh complete — ${refreshed} businesses refreshed`);
    } catch (err: any) {
      this.logger.error(`Match refresh cycle failed: ${(err as Error).message}`);
    }
  }
}
