import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day
const GAP_DAYS = 14;

@Injectable()
export class SocialGapDetectorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SocialGapDetectorService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  onModuleInit() {
    // Run immediately on startup, then every 24h
    this.checkGaps().catch((e) => this.logger.error(`Initial gap check failed: ${(e as Error).message}`));
    this.timer = setInterval(() => {
      this.checkGaps().catch((e) => this.logger.error(`Gap check failed: ${(e as Error).message}`));
    }, CHECK_INTERVAL_MS);
    this.logger.log('Social gap detector started');
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async checkGaps() {
    const cutoff = new Date(Date.now() - GAP_DAYS * 24 * 60 * 60 * 1000);

    const businesses = await this.prisma.client.business.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });

    for (const business of businesses) {
      try {
        const latestPost = await this.prisma.client.socialPost.findFirst({
          where: { businessId: business.id, deletedAt: null },
          orderBy: { postedAt: 'desc' },
          select: { postedAt: true },
        });

        const daysSinceLastPost = latestPost?.postedAt
          ? Math.floor((Date.now() - new Date(latestPost.postedAt).getTime()) / (24 * 60 * 60 * 1000))
          : Infinity;

        if (!latestPost || daysSinceLastPost >= GAP_DAYS) {
          this.events.emit('content_calendar.gap_detected', {
            businessId: business.id,
            daysSinceLastPost: daysSinceLastPost === Infinity ? null : daysSinceLastPost,
            gapDays: GAP_DAYS,
          });
        }
      } catch (e) {
        this.logger.warn(`Gap check failed for business ${business.id}: ${(e as Error).message}`);
      }
    }
  }
}
