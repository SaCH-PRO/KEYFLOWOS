import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy, NotFoundException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AdapterRegistryService } from './adapters/adapter-registry.service';

const POLL_INTERVAL_MS = 30_000;
const MAX_BATCH_SIZE = 20;
const BACKOFF_BASE_MS = 60_000;

@Injectable()
export class DeliveryQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeliveryQueueService.name);
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private processing = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdapterRegistryService) private readonly adapters: AdapterRegistryService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
  ) {}

  onModuleInit() {
    this.pollInterval = setInterval(() => this.tick(), POLL_INTERVAL_MS);
    this.logger.log('Delivery queue scheduler started (30s interval)');
  }

  onModuleDestroy() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  private async tick() {
    if (this.processing) return;
    this.processing = true;
    try {
      await this.processScheduledDeliveries();
      await this.processRetryDeliveries();
    } catch (err) {
      this.logger.error(`Delivery queue tick failed: ${(err as Error).message}`);
    } finally {
      this.processing = false;
    }
  }

  private async claimDeliveries(where: any): Promise<any[]> {
    const candidates = await this.prisma.client.outboundDelivery.findMany({
      where,
      select: { id: true, status: true },
      take: MAX_BATCH_SIZE,
      orderBy: { scheduledAt: 'asc' },
    });

    const claimed: any[] = [];
    for (const c of candidates) {
      const result = await this.prisma.client.outboundDelivery.updateMany({
        where: { id: c.id, status: c.status },
        data: { status: 'Sending' },
      });
      if (result.count > 0) {
        const full = await this.prisma.client.outboundDelivery.findUnique({
          where: { id: c.id },
          include: {
            destination: { include: { connection: true } },
            content: { include: { variants: true } },
            variant: true,
          },
        });
        if (full) claimed.push(full);
      }
    }
    return claimed;
  }

  private async processScheduledDeliveries() {
    const claimed = await this.claimDeliveries({
      status: { in: ['Queued', 'Scheduled'] },
      scheduledAt: { lte: new Date() },
    });

    for (const delivery of claimed) {
      await this.executeDelivery(delivery);
    }
  }

  private async processRetryDeliveries() {
    const claimed = await this.claimDeliveries({
      status: 'RetryPending',
      nextRetryAt: { lte: new Date() },
    });

    for (const delivery of claimed) {
      await this.executeDelivery(delivery);
    }
  }

  private async executeDelivery(delivery: any) {
    const { destination, content, variant } = delivery;
    if (!destination?.connection) {
      await this.failDelivery(delivery.id, 'NO_CONNECTION', 'Destination has no active connection', delivery.status);
      return;
    }

    const adapter = this.adapters.resolveByPlatform(destination.platform);
    if (!adapter) {
      await this.failDelivery(delivery.id, 'NO_ADAPTER', `No adapter for platform: ${destination.platform}`, delivery.status);
      return;
    }

    const effectiveVariant = variant || content?.variants?.find((v: any) => v.platform === destination.platform) || content?.variants?.find((v: any) => v.platform === 'DEFAULT');

    const destMeta = destination.destinationMeta as Record<string, unknown> | null;
    const contentMeta = content?.contentMeta as Record<string, unknown> | null;
    const variantMeta = effectiveVariant?.variantMeta as Record<string, unknown> | null;

    const recipientEmail =
      (variantMeta?.recipientEmail as string) ??
      (contentMeta?.recipientEmail as string) ??
      (destMeta?.recipientEmail as string) ??
      undefined;

    const payload = {
      textBody: effectiveVariant?.textBody ?? content?.body ?? '',
      htmlBody: effectiveVariant?.htmlBody,
      mediaUrls: effectiveVariant?.mediaUrls ?? [],
      subject: content?.subject,
      recipientEmail,
      meta: variantMeta ?? undefined,
    };

    try {
      const result = await adapter.publish(destination.connection, destination, payload);
      const attemptNumber = delivery.retryCount + 1;

      if (result.success) {
        await this.prisma.client.outboundDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'Published',
            sentAt: new Date(),
            externalPostId: result.externalPostId,
            externalUrl: result.externalUrl,
            resultSnapshot: result.raw ?? undefined,
            errorCode: null,
            errorMessage: null,
          },
        });

        await this.recordEvent(delivery.id, 'success', 'Sending', 'Published', attemptNumber);

        this.events.emit('content.published', { deliveryId: delivery.id, contentId: delivery.contentId, businessId: delivery.businessId, destinationId: delivery.destinationId });
        this.events.emit('delivery.completed', { deliveryId: delivery.id, contentId: delivery.contentId, businessId: delivery.businessId });

        await this.updateContentStatus(delivery.contentId);
      } else {
        const isTransient = result.isTransient ?? false;
        const newRetryCount = delivery.retryCount + 1;

        if (isTransient && newRetryCount < delivery.maxRetries) {
          const backoffMs = BACKOFF_BASE_MS * Math.pow(2, delivery.retryCount);
          const nextRetryAt = new Date(Date.now() + backoffMs);

          await this.prisma.client.outboundDelivery.update({
            where: { id: delivery.id },
            data: {
              status: 'RetryPending',
              retryCount: newRetryCount,
              nextRetryAt,
              errorCode: result.errorCode,
              errorMessage: result.errorMessage,
            },
          });

          await this.recordEvent(delivery.id, 'retry_scheduled', 'Sending', 'RetryPending', attemptNumber, result.errorCode, result.errorMessage);
        } else {
          await this.prisma.client.outboundDelivery.update({
            where: { id: delivery.id },
            data: {
              status: 'Failed',
              retryCount: newRetryCount,
              errorCode: result.errorCode,
              errorMessage: result.errorMessage,
              resultSnapshot: result.raw ?? undefined,
            },
          });

          await this.recordEvent(delivery.id, 'failure', 'Sending', 'Failed', attemptNumber, result.errorCode, result.errorMessage);

          this.events.emit('content.failed', { deliveryId: delivery.id, contentId: delivery.contentId, businessId: delivery.businessId, errorCode: result.errorCode });
          this.events.emit('delivery.failed', { deliveryId: delivery.id, contentId: delivery.contentId, businessId: delivery.businessId });

          await this.updateContentStatus(delivery.contentId);
        }
      }
    } catch (err) {
      const normalized = adapter.normalizeError(err);
      const newRetryCount = delivery.retryCount + 1;

      if (normalized.isTransient && newRetryCount < delivery.maxRetries) {
        const backoffMs = BACKOFF_BASE_MS * Math.pow(2, delivery.retryCount);
        await this.prisma.client.outboundDelivery.update({
          where: { id: delivery.id },
          data: { status: 'RetryPending', retryCount: newRetryCount, nextRetryAt: new Date(Date.now() + backoffMs), errorCode: normalized.code, errorMessage: normalized.message },
        });
        await this.recordEvent(delivery.id, 'retry_scheduled', 'Sending', 'RetryPending', newRetryCount, normalized.code, normalized.message);
      } else {
        await this.prisma.client.outboundDelivery.update({
          where: { id: delivery.id },
          data: { status: 'Failed', retryCount: newRetryCount, errorCode: normalized.code, errorMessage: normalized.message },
        });
        await this.recordEvent(delivery.id, 'failure', 'Sending', 'Failed', newRetryCount, normalized.code, normalized.message);
        this.events.emit('delivery.failed', { deliveryId: delivery.id, contentId: delivery.contentId, businessId: delivery.businessId });
        await this.updateContentStatus(delivery.contentId);
      }
    }
  }

  private async failDelivery(deliveryId: string, errorCode: string, errorMessage: string, statusBefore: string) {
    await this.prisma.client.outboundDelivery.update({
      where: { id: deliveryId },
      data: { status: 'Failed', errorCode, errorMessage },
    });
    await this.recordEvent(deliveryId, 'failure', statusBefore, 'Failed', 1, errorCode, errorMessage);
  }

  private async recordEvent(deliveryId: string, eventType: string, statusBefore: string, statusAfter: string, attemptNumber?: number, errorCode?: string, errorMessage?: string, resultData?: Record<string, unknown>) {
    await this.prisma.client.deliveryEvent.create({
      data: { deliveryId, eventType, statusBefore, statusAfter, attemptNumber, errorCode, errorMessage, resultData: resultData ?? undefined },
    });
  }

  private async updateContentStatus(contentId: string) {
    const deliveries = await this.prisma.client.outboundDelivery.findMany({
      where: { contentId },
      select: { status: true },
    });

    if (deliveries.length === 0) return;

    const statuses = deliveries.map(d => d.status);
    const allPublished = statuses.every(s => s === 'Published');
    const allFailed = statuses.every(s => s === 'Failed');
    const anyPending = statuses.some(s => ['Queued', 'Scheduled', 'Sending', 'RetryPending'].includes(s));

    let contentStatus: string;
    if (allPublished) contentStatus = 'Sent';
    else if (allFailed) contentStatus = 'Failed';
    else if (anyPending) contentStatus = 'Sending';
    else contentStatus = 'PartiallyFailed';

    await this.prisma.client.outboundContent.update({
      where: { id: contentId },
      data: {
        status: contentStatus,
        ...(contentStatus === 'Sent' ? { publishedAt: new Date() } : {}),
      },
    });
  }

  async publishNow(businessId: string, contentId: string, destinationIds: string[]) {
    const content = await this.prisma.client.outboundContent.findFirst({
      where: { id: contentId, businessId, deletedAt: null },
      include: { variants: true },
    });
    if (!content) throw new NotFoundException('Content not found');

    if (destinationIds.length === 0) throw new BadRequestException('At least one destination is required');

    const destinations = await this.prisma.client.channelDestination.findMany({
      where: { id: { in: destinationIds }, businessId, isActive: true },
    });

    if (destinations.length === 0) throw new BadRequestException('No valid active destinations found');

    const deliveries = await this.prisma.client.outboundDelivery.createManyAndReturn({
      data: destinations.map(dest => {
        const variant = content.variants.find(v => v.platform === dest.platform) || content.variants.find(v => v.platform === 'DEFAULT');
        return {
          contentId,
          variantId: variant?.id ?? null,
          destinationId: dest.id,
          businessId,
          status: 'Queued',
          scheduledAt: new Date(),
        };
      }),
    });

    await this.prisma.client.outboundContent.update({
      where: { id: contentId },
      data: { status: 'Queued' },
    });

    for (const delivery of deliveries) {
      await this.recordEvent(delivery.id, 'attempt', 'Queued', 'Queued', 0);
    }

    setTimeout(() => this.tick(), 500);

    return { queued: deliveries.length, deliveryIds: deliveries.map(d => d.id) };
  }

  async schedule(businessId: string, contentId: string, destinationIds: string[], scheduledAt: string) {
    const content = await this.prisma.client.outboundContent.findFirst({
      where: { id: contentId, businessId, deletedAt: null },
      include: { variants: true },
    });
    if (!content) throw new NotFoundException('Content not found');

    const scheduleDate = new Date(scheduledAt);
    if (scheduleDate <= new Date()) throw new BadRequestException('Scheduled date must be in the future');

    const destinations = await this.prisma.client.channelDestination.findMany({
      where: { id: { in: destinationIds }, businessId, isActive: true },
    });
    if (destinations.length === 0) throw new BadRequestException('No valid active destinations found');

    const deliveries = await this.prisma.client.outboundDelivery.createManyAndReturn({
      data: destinations.map(dest => {
        const variant = content.variants.find(v => v.platform === dest.platform) || content.variants.find(v => v.platform === 'DEFAULT');
        return {
          contentId,
          variantId: variant?.id ?? null,
          destinationId: dest.id,
          businessId,
          status: 'Scheduled',
          scheduledAt: scheduleDate,
        };
      }),
    });

    await this.prisma.client.outboundContent.update({
      where: { id: contentId },
      data: { status: 'Scheduled', scheduledAt: scheduleDate },
    });

    return { scheduled: deliveries.length, scheduledAt: scheduleDate.toISOString(), deliveryIds: deliveries.map(d => d.id) };
  }

  async reschedule(businessId: string, deliveryId: string, newScheduledAt: string) {
    const delivery = await this.prisma.client.outboundDelivery.findFirst({
      where: { id: deliveryId, businessId, status: { in: ['Scheduled', 'Queued'] } },
    });
    if (!delivery) throw new NotFoundException('Pending delivery not found');

    const newDate = new Date(newScheduledAt);
    if (newDate <= new Date()) throw new BadRequestException('New scheduled date must be in the future');

    const updated = await this.prisma.client.outboundDelivery.update({
      where: { id: deliveryId },
      data: { scheduledAt: newDate, status: 'Scheduled' },
    });

    await this.recordEvent(deliveryId, 'rescheduled', delivery.status, 'Scheduled', undefined, undefined, `Rescheduled to ${newDate.toISOString()}`);

    return updated;
  }

  async cancel(businessId: string, deliveryId: string) {
    const delivery = await this.prisma.client.outboundDelivery.findFirst({
      where: { id: deliveryId, businessId, status: { in: ['Scheduled', 'Queued', 'RetryPending'] } },
    });
    if (!delivery) throw new NotFoundException('Cancellable delivery not found');

    const updated = await this.prisma.client.outboundDelivery.update({
      where: { id: deliveryId },
      data: { status: 'Cancelled' },
    });

    await this.recordEvent(deliveryId, 'cancelled', delivery.status, 'Cancelled');

    await this.updateContentStatus(delivery.contentId);

    return updated;
  }

  async retry(businessId: string, deliveryId: string) {
    const delivery = await this.prisma.client.outboundDelivery.findFirst({
      where: { id: deliveryId, businessId, status: 'Failed' },
    });
    if (!delivery) throw new NotFoundException('Failed delivery not found');

    const updated = await this.prisma.client.outboundDelivery.update({
      where: { id: deliveryId },
      data: { status: 'Queued', scheduledAt: new Date(), errorCode: null, errorMessage: null, nextRetryAt: null },
    });

    await this.recordEvent(deliveryId, 'manual_retry', 'Failed', 'Queued');

    setTimeout(() => this.tick(), 500);

    return updated;
  }

  async getDeliverySummary(businessId: string, contentId: string) {
    const content = await this.prisma.client.outboundContent.findFirst({
      where: { id: contentId, businessId, deletedAt: null },
      select: { id: true, status: true, contentType: true, subject: true, scheduledAt: true, publishedAt: true },
    });
    if (!content) throw new NotFoundException('Content not found');

    const deliveries = await this.prisma.client.outboundDelivery.findMany({
      where: { contentId },
      include: { destination: true },
    });

    const totalDestinations = deliveries.length;
    const published = deliveries.filter(d => d.status === 'Published').length;
    const failed = deliveries.filter(d => d.status === 'Failed').length;
    const pending = deliveries.filter(d => ['Queued', 'Scheduled', 'Sending', 'RetryPending'].includes(d.status)).length;
    const cancelled = deliveries.filter(d => d.status === 'Cancelled').length;

    const lastAttempt = deliveries.reduce<Date | null>((max, d) => {
      const t = d.sentAt || d.updatedAt;
      return !max || t > max ? t : max;
    }, null);

    return {
      contentId: content.id,
      contentStatus: content.status,
      totalDestinations,
      published,
      failed,
      pending,
      cancelled,
      lastAttemptAt: lastAttempt?.toISOString() ?? null,
      deliveries: deliveries.map(d => ({
        id: d.id,
        destinationId: d.destinationId,
        platform: d.destination?.platform,
        displayName: d.destination?.displayName,
        status: d.status,
        sentAt: d.sentAt?.toISOString() ?? null,
        externalPostId: d.externalPostId,
        errorCode: d.errorCode,
        errorMessage: d.errorMessage,
        retryCount: d.retryCount,
      })),
    };
  }
}
