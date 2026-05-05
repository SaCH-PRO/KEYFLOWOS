import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CrmDataQualityService } from './crm-data-quality.service';

const SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000; // nightly
const STARTUP_DELAY_MS = 60 * 1000;
const PER_BUSINESS_GAP_MS = 1500;

/**
 * Drives the nightly contact data-quality scan. Walks every active business
 * sequentially with a small gap so a large fleet doesn't saturate the DB.
 * Failures are logged but never abort the queue — one bad business shouldn't
 * stop the others from being scanned.
 */
@Injectable()
export class CrmDataQualityScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CrmDataQualityScheduler.name);
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private intervalRef: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(@Inject(CrmDataQualityService) private readonly dq: CrmDataQualityService) {}

  onModuleInit(): void {
    if (process.env.KF_DISABLE_SCHEDULERS === '1') {
      this.logger.log('Data-quality scheduler disabled via KF_DISABLE_SCHEDULERS');
      return;
    }
    this.startupTimer = setTimeout(() => {
      void this.runOnce();
      this.intervalRef = setInterval(() => void this.runOnce(), SCAN_INTERVAL_MS);
    }, STARTUP_DELAY_MS);
  }

  onModuleDestroy(): void {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    if (this.intervalRef) clearInterval(this.intervalRef);
    this.startupTimer = null;
    this.intervalRef = null;
  }

  async runOnce(): Promise<void> {
    if (this.running) {
      this.logger.warn('Skipping data-quality run: previous run still in progress');
      return;
    }
    this.running = true;
    try {
      const ids = await this.dq.listAllBusinessIds();
      this.logger.log(`Starting nightly data-quality scan for ${ids.length} businesses`);
      for (const id of ids) {
        try {
          await this.dq.scanBusiness(id);
        } catch (err) {
          this.logger.warn(`Data-quality scan failed for ${id}: ${(err as Error).message}`);
        }
        if (PER_BUSINESS_GAP_MS > 0) {
          await new Promise((res) => setTimeout(res, PER_BUSINESS_GAP_MS));
        }
      }
    } catch (err) {
      this.logger.error(`Nightly data-quality run errored: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
