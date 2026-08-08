import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../core/prisma/prisma.service';

/**
 * Facts older than this (without re-verification) are marked STALE so the
 * genome's freshness scoring reflects reality instead of pretending
 * year-old answers are current.
 */
const STALE_AFTER_DAYS = 90;
const ACTIVE_STATUSES = ['USER_VERIFIED', 'INFERRED', 'UNVERIFIED_IMPORTED'];

@Injectable()
export class GenomeDecayService {
  private readonly logger = new Logger(GenomeDecayService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async markStaleFacts(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000);
    try {
      const result = await this.prisma.client.genomeFact.updateMany({
        where: {
          verificationStatus: { in: ACTIVE_STATUSES },
          updatedAt: { lt: cutoff },
        },
        data: { verificationStatus: 'STALE' },
      });
      if (result.count > 0) {
        this.logger.log(`Marked ${result.count} genome facts as STALE (idle > ${STALE_AFTER_DAYS}d)`);
      }
    } catch (err) {
      this.logger.error(
        `Genome decay sweep failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
