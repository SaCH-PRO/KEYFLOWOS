import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TaxLiabilityService } from './tax-liability.service';

const TICK_MS = 24 * 60 * 60 * 1000;

/**
 * FIN7 — Nightly tax liability rollup. Recomputes the current open
 * VAT/Business Levy period for every business. Idempotent: locked
 * (FILED/PAID) periods write AMENDED siblings instead of mutating.
 */
@Injectable()
export class TaxLiabilityRollupScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TaxLiabilityRollupScheduler.name);
  private intervalRef: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TaxLiabilityService) private readonly tax: TaxLiabilityService,
  ) {}

  onModuleInit(): void {
    if (process.env.DISABLE_SCHEDULERS === '1' || process.env.NODE_ENV === 'test') {
      this.logger.log('[TaxLiabilityRollup] disabled via env');
      return;
    }
    this.logger.log('[TaxLiabilityRollup] scheduler started (24h tick)');
    this.intervalRef = setInterval(() => {
      void this.runAll().catch((err) =>
        this.logger.error(`tick failed: ${(err as Error).message}`),
      );
    }, TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.intervalRef) clearInterval(this.intervalRef);
    this.intervalRef = null;
  }

  async runAll(): Promise<{ ok: number; failed: number }> {
    const businesses = await this.prisma.client.business.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    let ok = 0;
    let failed = 0;
    for (const b of businesses) {
      try {
        await this.tax.recompute(b.id);
        ok += 1;
      } catch (err: any) {
        failed += 1;
        this.logger.error(`rollup for business ${b.id} failed: ${(err as Error).message}`);
      }
    }
    this.logger.log(`[TaxLiabilityRollup] ${ok} ok, ${failed} failed`);
    return { ok, failed };
  }
}
