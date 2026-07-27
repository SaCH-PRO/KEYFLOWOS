import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../core/prisma/prisma.service';

/**
 * GDPR retention worker for Cross-Account Protection (RISC) events.
 *
 * RISC security event tokens contain a Google Account identifier
 * (`providerSubject`) which is personal data. They are retained only for
 * security investigation and then purged automatically. The default retention
 * is 90 days and can be changed with `RISC_EVENT_RETENTION_DAYS`.
 */
@Injectable()
export class RiscRetentionService {
  private readonly logger = new Logger(RiscRetentionService.name);
  private readonly defaultRetentionDays = 90;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Number of days to keep RISC events before permanent deletion.
   */
  private retentionDays(): number {
    const raw = (process.env.RISC_EVENT_RETENTION_DAYS || '').trim();
    if (!raw) return this.defaultRetentionDays;
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed) || parsed < 1) return this.defaultRetentionDays;
    return parsed;
  }

  /**
   * Daily cleanup of expired RISC event rows.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeExpiredEvents(): Promise<{ deleted: number }> {
    const retentionDays = this.retentionDays();
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    try {
      const result = await this.prisma.client.riscEvent.deleteMany({
        where: { receivedAt: { lt: cutoff } },
      });
      const deleted = (result as unknown as { count?: number }).count ?? 0;
      this.logger.log(`Purged ${deleted} RISC event(s) older than ${retentionDays} days`);
      return { deleted };
    } catch (err: unknown) {
      this.logger.error(
        `RISC event retention purge failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
  }
}
