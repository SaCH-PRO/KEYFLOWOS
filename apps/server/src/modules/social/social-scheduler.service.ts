import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SocialPublishingService } from './social-publishing.service';

const TICK_INTERVAL_MS = 60_000;
const MAX_BATCH = 25;

@Injectable()
export class SocialSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SocialSchedulerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SocialPublishingService) private readonly publishing: SocialPublishingService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      this.tick().catch((e) => this.logger.error(`Scheduler tick failed: ${(e as Error).message}`));
    }, TICK_INTERVAL_MS);
    this.logger.log(`Social scheduler started (tick every ${TICK_INTERVAL_MS / 1000}s)`);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const due = await this.prisma.client.socialPost.findMany({
        where: {
          status: 'SCHEDULED',
          scheduledAt: { lte: new Date() },
          deletedAt: null,
        },
        orderBy: { scheduledAt: 'asc' },
        take: MAX_BATCH,
      });

      for (const post of due) {
        await this.dispatch(post);
      }
    } finally {
      this.running = false;
    }
  }

  private async dispatch(post: { id: string; businessId: string; channelIds: string[] }) {
    const claim = await this.prisma.client.socialPost.updateMany({
      where: { id: post.id, status: 'SCHEDULED' },
      data: { status: 'PUBLISHING' },
    });
    if (claim.count === 0) return;

    try {
      const results = await this.publishing.publishToChannels(
        post.businessId,
        post.id,
        post.channelIds && post.channelIds.length > 0 ? post.channelIds : undefined,
      );
      const firstSuccess = results.find((r) => r.success);
      const firstError = results.find((r) => !r.success);
      const anySuccess = results.some((r) => r.success);

      await this.prisma.client.socialPost.update({
        where: { id: post.id },
        data: {
          status: anySuccess ? 'POSTED' : 'FAILED',
          postedAt: anySuccess ? new Date() : undefined,
          failedAt: anySuccess ? null : new Date(),
          externalPostId: firstSuccess?.platformPostId ?? null,
          externalUrl: firstSuccess?.externalUrl ?? null,
          lastError: anySuccess ? null : firstError?.error ?? 'Publish failed',
        },
      });

      this.events.emit('social.scheduled.dispatched', {
        postId: post.id,
        businessId: post.businessId,
        success: anySuccess,
      });
    } catch (err: any) {
      await this.prisma.client.socialPost.update({
        where: { id: post.id },
        data: {
          status: 'FAILED',
          failedAt: new Date(),
          lastError: err instanceof Error ? err.message : String(err),
        },
      });
      this.logger.error(`Failed to dispatch scheduled post ${post.id}: ${(err as Error).message}`);
    }
  }
}
