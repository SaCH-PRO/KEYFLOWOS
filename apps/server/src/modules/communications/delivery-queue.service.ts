import { Inject, Injectable, Logger, OnModuleInit, OnModuleDestroy, NotFoundException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AdapterRegistryService } from './adapters/adapter-registry.service';
import { safeInterval } from '../../core/scheduling/safe-interval';
import { Prisma } from '@prisma/client';
import { createHmac } from 'node:crypto';
import type {
  ChannelAdapter,
  ProviderEffectMaterial,
  PublishPayload,
  PublishResponse,
} from './adapters/channel-adapter.interface';
import {
  effectFingerprint,
  isInsideResendIdempotencyWindow,
  resendIdempotencyKey,
} from './effect-certainty';

const POLL_INTERVAL_MS = 30_000;
const MAX_BATCH_SIZE = 20;
const BACKOFF_BASE_MS = 60_000;
const DEFAULT_TIMEZONE = 'America/Port_of_Spain';
const RESEND_ATTEMPT_LEASE_MS = 5 * 60_000;

interface ResendVariantRecord {
  platform?: string;
  textBody?: string | null;
  htmlBody?: string | null;
  mediaUrls?: string[];
  variantMeta?: unknown;
}

interface ResendDeliveryRecord {
  id: string;
  contentId: string;
  destinationId: string;
  businessId: string;
  contactId?: string | null;
  recipientEmail?: string | null;
  recipientPhone?: string | null;
  status: string;
  retryCount: number;
  maxRetries: number;
  effectFingerprint?: string | null;
  effectSnapshot?: unknown;
  attemptSequence?: number;
  currentAttemptId?: string | null;
  attemptStartedAt?: Date | null;
  attemptLeaseExpiresAt?: Date | null;
  providerOutcome?: string | null;
  providerFirstAttemptAt?: Date | null;
  consequenceState?: string | null;
  externalPostId?: string | null;
  externalUrl?: string | null;
  resultSnapshot?: unknown;
  claimedFromStatus?: string;
  destination?: {
    platform?: string;
    platformId?: string | null;
    destinationMeta?: unknown;
    connection?: unknown;
  } | null;
  content?: {
    body?: string | null;
    subject?: string | null;
    contentType?: string | null;
    contentMeta?: unknown;
    variants?: ResendVariantRecord[];
  } | null;
  variant?: ResendVariantRecord | null;
}

function isProviderEffectMaterial(value: unknown): value is ProviderEffectMaterial {
  if (!value || typeof value !== 'object') return false;
  const material = value as Partial<ProviderEffectMaterial>;
  return (
    typeof material.provider === 'string'
    && typeof material.recipient === 'string'
    && typeof material.subject === 'string'
    && typeof material.html === 'string'
    && (material.sender === undefined || typeof material.sender === 'string')
    && (material.text === undefined || typeof material.text === 'string')
  );
}

function resolveScheduledAtUtc(scheduledAt: string, timezone?: string): Date {
  const tz = timezone || DEFAULT_TIMEZONE;
  try {
    const formatted = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).format(new Date());
    void formatted;

    const localDate = new Date(scheduledAt);
    if (isNaN(localDate.getTime())) throw new Error('Invalid date');

    const inputStr = scheduledAt.includes('T') ? scheduledAt : `${scheduledAt}T00:00:00`;
    const hasOffset = /[+-]\d{2}:\d{2}$|Z$/.test(inputStr);
    if (hasOffset) {
      return new Date(inputStr);
    }

    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const nowInTz: Record<string, string> = {};
    for (const p of parts) nowInTz[p.type] = p.value;

    const nowUtc = new Date();
    const nowTzDate = new Date(`${nowInTz.year}-${nowInTz.month}-${nowInTz.day}T${nowInTz.hour}:${nowInTz.minute}:${nowInTz.second}Z`);
    const offsetMs = nowUtc.getTime() - nowTzDate.getTime();

    const naiveMs = new Date(inputStr + 'Z').getTime();
    return new Date(naiveMs + offsetMs);
  } catch {
    return new Date(scheduledAt);
  }
}

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
    this.pollInterval = safeInterval('DeliveryQueueService', POLL_INTERVAL_MS, () => this.tick(), this.logger);
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
      await this.processResendConsequenceRepairs();
      await this.recoverStaleResendAttempts();
      await this.processScheduledDeliveries();
      await this.processRetryDeliveries();
    } catch (err: any) {
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
        if (full) claimed.push({ ...full, claimedFromStatus: c.status });
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

  private resolveDeliveryAdapter(delivery: ResendDeliveryRecord): ChannelAdapter | null {
    const destination = delivery.destination;
    if (!destination?.connection) return null;
    const isEmailPlatform = destination.platform === 'EMAIL' || destination.platform === 'GOOGLE';
    return isEmailPlatform
      ? this.adapters.resolveEmailFor(destination.connection as { provider?: string | null; token?: string | null })
      : this.adapters.resolveByPlatform(destination.platform ?? '');
  }

  private async executeDelivery(delivery: unknown) {
    const candidate = delivery as ResendDeliveryRecord;
    const adapter = this.resolveDeliveryAdapter(candidate);
    if (adapter?.provider === 'RESEND') {
      await this.executeResendDelivery(candidate, adapter);
      return;
    }
    await this.executeLegacyDelivery(delivery as never);
  }

  private buildResendPublishPayload(delivery: ResendDeliveryRecord): PublishPayload {
    const destination = delivery.destination;
    const content = delivery.content;
    const variant =
      delivery.variant
      ?? content?.variants?.find((v) => v.platform === destination?.platform)
      ?? content?.variants?.find((v) => v.platform === 'DEFAULT');

    const destMeta = (destination?.destinationMeta ?? null) as Record<string, unknown> | null;
    const contentMeta = (content?.contentMeta ?? null) as Record<string, unknown> | null;
    const variantMeta = (variant?.variantMeta ?? null) as Record<string, unknown> | null;

    const recipientEmail =
      delivery.recipientEmail
      ?? (variantMeta?.recipientEmail as string | undefined)
      ?? (contentMeta?.recipientEmail as string | undefined)
      ?? (destMeta?.recipientEmail as string | undefined);

    const recipientPhone =
      delivery.recipientPhone
      ?? (variantMeta?.recipientPhone as string | undefined);

    const mergedMeta: Record<string, unknown> = { ...(variantMeta ?? {}) };
    if (recipientPhone) mergedMeta.recipientPhone = recipientPhone;
    if (delivery.contactId) mergedMeta.contactId = delivery.contactId;

    const previewText = variantMeta?.previewText as string | undefined;
    const senderName = variantMeta?.senderName as string | undefined;
    if (previewText) mergedMeta.previewText = previewText;
    if (senderName) mergedMeta.senderName = senderName;

    const trackingSecret = process.env.TRACKING_HMAC_SECRET;
    if (trackingSecret && content?.contentType === 'campaign_email') {
      // Tracking identity is delivery-bound and therefore stable for retries.
      const token = createHmac('sha256', trackingSecret).update(delivery.id).digest('hex').slice(0, 16);
      mergedMeta.deliveryId = delivery.id;
      mergedMeta.trackingToken = token;
    }

    return {
      textBody: variant?.textBody ?? content?.body ?? '',
      htmlBody: variant?.htmlBody ?? undefined,
      mediaUrls: variant?.mediaUrls ?? [],
      subject: (variantMeta?.subject as string | undefined) ?? content?.subject ?? undefined,
      recipientEmail: recipientEmail ?? undefined,
      meta: Object.keys(mergedMeta).length > 0 ? mergedMeta : undefined,
    };
  }

  private async executeResendDelivery(delivery: ResendDeliveryRecord, adapter: ChannelAdapter) {
    if (!delivery.destination?.connection) {
      await this.failDelivery(
        delivery.id,
        delivery.contentId,
        delivery.businessId,
        'NO_CONNECTION',
        'Destination has no active connection',
        'Sending',
      );
      return;
    }

    if (delivery.providerOutcome === 'SUCCEEDED_CONFIRMED') {
      await this.repairResendConsequences(delivery);
      return;
    }

    if (
      delivery.providerOutcome === 'OUTCOME_UNKNOWN'
      && !isInsideResendIdempotencyWindow(delivery.providerFirstAttemptAt)
    ) {
      await this.blockUnknownOutsideReplayWindow(delivery);
      return;
    }

    if (
      !delivery.providerOutcome
      && delivery.claimedFromStatus === 'RetryPending'
    ) {
      await this.markLegacyAmbiguousResend(delivery);
      return;
    }

    const payload = this.buildResendPublishPayload(delivery);
    if (!adapter.prepareEffectMaterial) {
      throw new Error('RESEND adapter must expose prepareEffectMaterial for effect certainty');
    }

    let material: ProviderEffectMaterial;
    let fingerprint: string;

    if (isProviderEffectMaterial(delivery.effectSnapshot)) {
      material = delivery.effectSnapshot;
      fingerprint = effectFingerprint(material);
      if (delivery.effectFingerprint && delivery.effectFingerprint !== fingerprint) {
        await this.prisma.client.outboundDelivery.updateMany({
          where: { id: delivery.id, businessId: delivery.businessId },
          data: {
            status: 'Failed',
            errorCode: 'EFFECT_SNAPSHOT_FINGERPRINT_MISMATCH',
            errorMessage: 'Stored outbound effect snapshot does not match its fingerprint',
          },
        });
        return;
      }
    } else {
      try {
        material = await adapter.prepareEffectMaterial(
          delivery.destination.connection,
          delivery.destination,
          payload,
        );
        fingerprint = effectFingerprint(material);
      } catch (error) {
        const normalized = adapter.normalizeError(error);
        await this.prisma.client.outboundDelivery.updateMany({
          where: { id: delivery.id, businessId: delivery.businessId, status: 'Sending' },
          data: {
            status: 'Failed',
            providerOutcome: 'FAILED_CONFIRMED',
            consequenceState: 'NOT_STARTED',
            nextRetryAt: null,
            errorCode: normalized.code,
            errorMessage: normalized.message,
          },
        });
        await this.recordEvent(
          delivery.id,
          'failure',
          'Sending',
          'Failed',
          undefined,
          normalized.code,
          normalized.message,
          { phase: 'PRE_PROVIDER_MATERIALIZATION' },
        );
        return;
      }
    }

    const attemptNumber = (delivery.attemptSequence ?? 0) + 1;
    const attemptId = `${delivery.id}:${attemptNumber}`;
    const attemptStartedAt = new Date();
    const firstAttemptAt = delivery.providerFirstAttemptAt ?? attemptStartedAt;
    const leaseExpiresAt = new Date(attemptStartedAt.getTime() + RESEND_ATTEMPT_LEASE_MS);
    const providerIdempotencyKey = resendIdempotencyKey(delivery.id, fingerprint);

    const allocated = await this.prisma.client.$transaction(async (tx) => {
      const claimed = await tx.outboundDelivery.updateMany({
        where: {
          id: delivery.id,
          businessId: delivery.businessId,
          status: 'Sending',
          attemptSequence: delivery.attemptSequence ?? 0,
        },
        data: {
          effectFingerprint: fingerprint,
          effectSnapshot: material as unknown as Prisma.InputJsonValue,
          attemptSequence: attemptNumber,
          currentAttemptId: attemptId,
          attemptStartedAt,
          attemptLeaseExpiresAt: leaseExpiresAt,
          providerOutcome: 'ATTEMPT_IN_FLIGHT',
          providerFirstAttemptAt: firstAttemptAt,
          consequenceState: delivery.consequenceState ?? 'NOT_STARTED',
        },
      });
      if (claimed.count !== 1) return false;

      await tx.deliveryEvent.create({
        data: {
          deliveryId: delivery.id,
          eventType: 'attempt_started',
          statusBefore: 'Sending',
          statusAfter: 'Sending',
          attemptNumber,
          attemptId,
          resultData: {
            effectFingerprint: fingerprint,
            provider: 'RESEND',
          },
        },
      });
      return true;
    });

    if (!allocated) {
      this.logger.warn(`delivery.attempt.ownership_lost deliveryId=${delivery.id}`);
      return;
    }

    this.logger.log(
      `delivery.provider.dispatching ${JSON.stringify({
        deliveryId: delivery.id,
        businessId: delivery.businessId,
        effectId: delivery.id,
        attemptId,
        attemptNumber,
        provider: 'RESEND',
      })}`,
    );

    let result: PublishResponse;
    try {
      result = await adapter.publish(
        delivery.destination.connection,
        delivery.destination,
        payload,
        {
          effectId: delivery.id,
          attemptId,
          effectFingerprint: fingerprint,
          providerIdempotencyKey,
          material,
        },
      );
    } catch (error) {
      const normalized = adapter.normalizeError(error);
      result = {
        success: false,
        errorCode: normalized.code,
        errorMessage: normalized.message,
        isTransient: normalized.isTransient,
        outcomeCertainty: normalized.outcomeCertainty,
      };
    }

    await this.applyResendProviderResult(
      delivery,
      result,
      attemptId,
      attemptNumber,
      firstAttemptAt,
    );
  }

  private async applyResendProviderResult(
    delivery: ResendDeliveryRecord,
    result: PublishResponse,
    attemptId: string,
    attemptNumber: number,
    firstAttemptAt: Date,
  ) {
    const resultSnapshot = result.raw as Prisma.InputJsonValue | undefined;

    if (result.success) {
      await this.prisma.client.outboundDelivery.updateMany({
        where: {
          id: delivery.id,
          businessId: delivery.businessId,
        },
        data: {
          status: 'Published',
          sentAt: new Date(),
          externalPostId: result.externalPostId,
          externalUrl: result.externalUrl,
          resultSnapshot,
          providerOutcome: 'SUCCEEDED_CONFIRMED',
          consequenceState: 'INCOMPLETE',
          attemptLeaseExpiresAt: null,
          errorCode: null,
          errorMessage: null,
          nextRetryAt: null,
        },
      });

      this.logger.log(
        `delivery.provider.confirmed ${JSON.stringify({
          deliveryId: delivery.id,
          businessId: delivery.businessId,
          effectId: delivery.id,
          attemptId,
          externalPostId: result.externalPostId ?? null,
        })}`,
      );

      await this.repairResendConsequences({
        ...delivery,
        status: 'Published',
        currentAttemptId: attemptId,
        attemptSequence: attemptNumber,
        providerOutcome: 'SUCCEEDED_CONFIRMED',
        consequenceState: 'INCOMPLETE',
        externalPostId: result.externalPostId ?? null,
      });
      return;
    }

    const newRetryCount = delivery.retryCount + 1;
    const errorCode = result.errorCode ?? 'EMAIL_ERROR';
    const errorMessage = result.errorMessage ?? 'Email provider rejected the request';
    const errorSnapshot = {
      errorCode,
      errorMessage,
      outcomeCertainty: result.outcomeCertainty ?? 'FAILED_CONFIRMED',
    };

    if (result.outcomeCertainty === 'OUTCOME_UNKNOWN') {
      const safeReplay =
        isInsideResendIdempotencyWindow(firstAttemptAt)
        && newRetryCount < delivery.maxRetries;
      const nextRetryAt = safeReplay
        ? new Date(Date.now() + BACKOFF_BASE_MS * Math.pow(2, delivery.retryCount))
        : null;

      await this.prisma.client.outboundDelivery.updateMany({
        where: {
          id: delivery.id,
          businessId: delivery.businessId,
          currentAttemptId: attemptId,
          providerOutcome: 'ATTEMPT_IN_FLIGHT',
        },
        data: {
          status: safeReplay ? 'RetryPending' : 'Failed',
          providerOutcome: 'OUTCOME_UNKNOWN',
          retryCount: newRetryCount,
          nextRetryAt,
          attemptLeaseExpiresAt: null,
          errorCode: safeReplay ? 'OUTCOME_UNKNOWN_SAFE_REPLAY' : 'OUTCOME_RECONCILIATION_REQUIRED',
          errorMessage,
          resultSnapshot: errorSnapshot as Prisma.InputJsonValue,
        },
      });

      await this.ensureAttemptEvent(
        delivery.id,
        attemptId,
        'outcome_unknown',
        'Sending',
        safeReplay ? 'RetryPending' : 'Failed',
        attemptNumber,
        errorCode,
        errorMessage,
        errorSnapshot,
      );
      return;
    }

    const retryable = (result.isTransient ?? false) && newRetryCount < delivery.maxRetries;
    const nextRetryAt = retryable
      ? new Date(Date.now() + BACKOFF_BASE_MS * Math.pow(2, delivery.retryCount))
      : null;

    await this.prisma.client.outboundDelivery.updateMany({
      where: {
        id: delivery.id,
        businessId: delivery.businessId,
        currentAttemptId: attemptId,
        providerOutcome: 'ATTEMPT_IN_FLIGHT',
      },
      data: {
        status: retryable ? 'RetryPending' : 'Failed',
        providerOutcome: 'FAILED_CONFIRMED',
        retryCount: newRetryCount,
        nextRetryAt,
        attemptLeaseExpiresAt: null,
        errorCode,
        errorMessage,
        resultSnapshot: errorSnapshot as Prisma.InputJsonValue,
      },
    });

    await this.ensureAttemptEvent(
      delivery.id,
      attemptId,
      retryable ? 'retry_scheduled' : 'failure',
      'Sending',
      retryable ? 'RetryPending' : 'Failed',
      attemptNumber,
      errorCode,
      errorMessage,
      errorSnapshot,
    );

    if (!retryable) {
      if (delivery.contactId) {
        await this.updateCampaignContactStatus(delivery.contentId, delivery.contactId, 'BOUNCED');
      }
      this.events.emit('content.failed', {
        deliveryId: delivery.id,
        contentId: delivery.contentId,
        businessId: delivery.businessId,
        errorCode,
      });
      this.events.emit('delivery.failed', {
        deliveryId: delivery.id,
        contentId: delivery.contentId,
        businessId: delivery.businessId,
      });
      await this.updateContentStatus(delivery.contentId);
    }
  }

  private async repairResendConsequences(delivery: ResendDeliveryRecord) {
    if (delivery.providerOutcome !== 'SUCCEEDED_CONFIRMED') return;

    const attemptId =
      delivery.currentAttemptId
      ?? `${delivery.id}:${Math.max(delivery.attemptSequence ?? 1, 1)}`;
    const attemptNumber = Math.max(delivery.attemptSequence ?? 1, 1);

    await this.prisma.client.outboundDelivery.updateMany({
      where: {
        id: delivery.id,
        businessId: delivery.businessId,
        providerOutcome: 'SUCCEEDED_CONFIRMED',
      },
      data: { consequenceState: 'REPAIRING' },
    });

    try {
      await this.ensureAttemptEvent(
        delivery.id,
        attemptId,
        'success',
        'Sending',
        'Published',
        attemptNumber,
        undefined,
        undefined,
        delivery.externalPostId ? { externalPostId: delivery.externalPostId } : undefined,
      );

      if (delivery.contactId && delivery.recipientEmail) {
        await this.updateCampaignContactStatus(
          delivery.contentId,
          delivery.contactId,
          'SENT',
          true,
        );
      }

      await this.updateContentStatus(delivery.contentId);

      try {
        this.events.emit('content.published', {
          deliveryId: delivery.id,
          contentId: delivery.contentId,
          businessId: delivery.businessId,
          destinationId: delivery.destinationId,
        });
        this.events.emit('delivery.completed', {
          deliveryId: delivery.id,
          contentId: delivery.contentId,
          businessId: delivery.businessId,
        });
      } catch (eventError) {
        this.logger.warn(
          `delivery.derivative_notification.failed deliveryId=${delivery.id} error=${
            eventError instanceof Error ? eventError.message : String(eventError)
          }`,
        );
      }

      await this.prisma.client.outboundDelivery.updateMany({
        where: {
          id: delivery.id,
          businessId: delivery.businessId,
          providerOutcome: 'SUCCEEDED_CONFIRMED',
        },
        data: {
          consequenceState: 'COMPLETE',
          status: 'Published',
          errorCode: null,
          errorMessage: null,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.client.outboundDelivery.updateMany({
        where: {
          id: delivery.id,
          businessId: delivery.businessId,
          providerOutcome: 'SUCCEEDED_CONFIRMED',
        },
        data: {
          consequenceState: 'INCOMPLETE',
          status: 'Published',
          errorCode: 'CONSEQUENCE_REPAIR_REQUIRED',
          errorMessage: message,
        },
      });
      this.logger.error(
        `delivery.consequence.repair_failed deliveryId=${delivery.id} error=${message}`,
      );
    }
  }

  private async processResendConsequenceRepairs() {
    const rows = await this.prisma.client.outboundDelivery.findMany({
      where: {
        providerOutcome: 'SUCCEEDED_CONFIRMED',
        consequenceState: { in: ['INCOMPLETE', 'REPAIRING'] },
      },
      include: {
        destination: { include: { connection: true } },
        content: { include: { variants: true } },
        variant: true,
      },
      take: MAX_BATCH_SIZE,
      orderBy: { updatedAt: 'asc' },
    });

    for (const row of rows) {
      const delivery = row as unknown as ResendDeliveryRecord;
      if (this.resolveDeliveryAdapter(delivery)?.provider === 'RESEND') {
        await this.repairResendConsequences(delivery);
      }
    }
  }

  private async recoverStaleResendAttempts() {
    const now = new Date();
    const rows = await this.prisma.client.outboundDelivery.findMany({
      where: {
        status: 'Sending',
        providerOutcome: 'ATTEMPT_IN_FLIGHT',
        attemptLeaseExpiresAt: { lte: now },
      },
      include: {
        destination: { include: { connection: true } },
        content: { include: { variants: true } },
        variant: true,
      },
      take: MAX_BATCH_SIZE,
      orderBy: { attemptLeaseExpiresAt: 'asc' },
    });

    for (const row of rows) {
      const delivery = row as unknown as ResendDeliveryRecord;
      if (this.resolveDeliveryAdapter(delivery)?.provider !== 'RESEND') continue;

      const newRetryCount = delivery.retryCount + 1;
      const safeReplay =
        isInsideResendIdempotencyWindow(delivery.providerFirstAttemptAt, now)
        && newRetryCount < delivery.maxRetries;

      await this.prisma.client.outboundDelivery.updateMany({
        where: {
          id: delivery.id,
          businessId: delivery.businessId,
          providerOutcome: 'ATTEMPT_IN_FLIGHT',
          currentAttemptId: delivery.currentAttemptId ?? undefined,
        },
        data: {
          status: safeReplay ? 'RetryPending' : 'Failed',
          providerOutcome: 'OUTCOME_UNKNOWN',
          retryCount: newRetryCount,
          nextRetryAt: safeReplay ? now : null,
          attemptLeaseExpiresAt: null,
          errorCode: safeReplay
            ? 'STALE_ATTEMPT_OUTCOME_UNKNOWN'
            : 'OUTCOME_RECONCILIATION_REQUIRED',
          errorMessage: safeReplay
            ? 'Attempt lease expired; same-effect replay is permitted inside Resend idempotency window'
            : 'Attempt outcome is unknown outside safe provider replay policy',
        },
      });
    }
  }

  private async blockUnknownOutsideReplayWindow(delivery: ResendDeliveryRecord) {
    await this.prisma.client.outboundDelivery.updateMany({
      where: { id: delivery.id, businessId: delivery.businessId },
      data: {
        status: 'Failed',
        nextRetryAt: null,
        errorCode: 'OUTCOME_RECONCILIATION_REQUIRED',
        errorMessage: 'Provider outcome is unknown outside the Resend idempotency replay window',
      },
    });
  }

  private async markLegacyAmbiguousResend(delivery: ResendDeliveryRecord) {
    await this.prisma.client.outboundDelivery.updateMany({
      where: { id: delivery.id, businessId: delivery.businessId },
      data: {
        status: 'Failed',
        providerOutcome: null,
        nextRetryAt: null,
        errorCode: 'LEGACY_PROVIDER_OUTCOME_AMBIGUOUS',
        errorMessage: 'Legacy retry state has no provider outcome evidence and cannot be auto-resent safely',
      },
    });
  }

  private async ensureAttemptEvent(
    deliveryId: string,
    attemptId: string,
    eventType: string,
    statusBefore: string,
    statusAfter: string,
    attemptNumber: number,
    errorCode?: string,
    errorMessage?: string,
    resultData?: Record<string, unknown>,
  ) {
    const existing = await this.prisma.client.deliveryEvent.findFirst({
      where: { deliveryId, eventType, attemptId },
      select: { id: true },
    });
    if (existing) return;

    await this.prisma.client.deliveryEvent.create({
      data: {
        deliveryId,
        eventType,
        statusBefore,
        statusAfter,
        attemptNumber,
        attemptId,
        errorCode,
        errorMessage,
        resultData: resultData as Prisma.InputJsonValue | undefined,
      },
    });
  }

  private async executeLegacyDelivery(delivery: any) {
    const { destination, content, variant } = delivery;
    if (!destination?.connection) {
      await this.failDelivery(delivery.id, delivery.contentId, delivery.businessId, 'NO_CONNECTION', 'Destination has no active connection', 'Sending');
      return;
    }

    // Email picks its adapter from the CONNECTION, not just the platform: Gmail
    // when there is a usable token, the platform ESP when there is not. A
    // business that never connected an account, or whose token expired, used to
    // fail every email delivery with MISSING_CREDENTIALS while a working
    // fallback sat unreachable. See adapters/resend-email-adapter.ts.
    const isEmailPlatform = destination.platform === 'EMAIL' || destination.platform === 'GOOGLE';
    const adapter = isEmailPlatform
      ? this.adapters.resolveEmailFor(destination.connection)
      : this.adapters.resolveByPlatform(destination.platform);
    if (!adapter) {
      await this.failDelivery(delivery.id, delivery.contentId, delivery.businessId, 'NO_ADAPTER', `No adapter for platform: ${destination.platform}`, 'Sending');
      return;
    }

    const effectiveVariant = variant || content?.variants?.find((v: any) => v.platform === destination.platform) || content?.variants?.find((v: any) => v.platform === 'DEFAULT');

    const destMeta = destination.destinationMeta as Record<string, unknown> | null;
    const contentMeta = content?.contentMeta as Record<string, unknown> | null;
    const variantMeta = effectiveVariant?.variantMeta as Record<string, unknown> | null;

    const recipientEmail =
      delivery.recipientEmail ??
      (variantMeta?.recipientEmail as string) ??
      (contentMeta?.recipientEmail as string) ??
      (destMeta?.recipientEmail as string) ??
      undefined;

    const recipientPhone =
      delivery.recipientPhone ??
      (variantMeta?.recipientPhone as string) ??
      undefined;

    const mergedMeta: Record<string, unknown> = { ...(variantMeta ?? {}) };
    if (recipientPhone) mergedMeta.recipientPhone = recipientPhone;
    if (delivery.contactId) mergedMeta.contactId = delivery.contactId;

    const variantSubject = variantMeta?.subject as string | undefined;
    const previewText = variantMeta?.previewText as string | undefined;
    const senderName = variantMeta?.senderName as string | undefined;

    const effectiveSubject = variantSubject || content?.subject;

    if (previewText) mergedMeta.previewText = previewText;
    if (senderName) mergedMeta.senderName = senderName;

    const trackingSecret = process.env.TRACKING_HMAC_SECRET;
    if (trackingSecret && content?.contentType === 'campaign_email') {
      const { createHmac } = await import('crypto');
      const token = createHmac('sha256', trackingSecret).update(delivery.id).digest('hex').slice(0, 16);
      mergedMeta.deliveryId = delivery.id;
      mergedMeta.trackingToken = token;
    }

    const payload = {
      textBody: effectiveVariant?.textBody ?? content?.body ?? '',
      htmlBody: effectiveVariant?.htmlBody,
      mediaUrls: effectiveVariant?.mediaUrls ?? [],
      subject: effectiveSubject,
      recipientEmail,
      meta: Object.keys(mergedMeta).length > 0 ? mergedMeta : undefined,
    };

    try {
      const result = await adapter.publish(destination.connection, destination, payload);
      const attemptNumber = delivery.retryCount + 1;
      const resultSnapshot = result.raw ?? undefined;

      if (result.success) {
        await this.prisma.client.outboundDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'Published',
            sentAt: new Date(),
            externalPostId: result.externalPostId,
            externalUrl: result.externalUrl,
            resultSnapshot,
            errorCode: null,
            errorMessage: null,
          },
        });

        await this.recordEvent(delivery.id, 'success', 'Sending', 'Published', attemptNumber, undefined, undefined, resultSnapshot);

        this.events.emit('content.published', { deliveryId: delivery.id, contentId: delivery.contentId, businessId: delivery.businessId, destinationId: delivery.destinationId });
        this.events.emit('delivery.completed', { deliveryId: delivery.id, contentId: delivery.contentId, businessId: delivery.businessId });

        if (delivery.contactId && delivery.recipientEmail) {
          await this.updateCampaignContactStatus(delivery.contentId, delivery.contactId, 'SENT');
        }

        await this.updateContentStatus(delivery.contentId);
      } else {
        const isTransient = result.isTransient ?? false;
        const newRetryCount = delivery.retryCount + 1;
        const errorSnapshot = { errorCode: result.errorCode, errorMessage: result.errorMessage, raw: resultSnapshot };

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

          await this.recordEvent(delivery.id, 'retry_scheduled', 'Sending', 'RetryPending', attemptNumber, result.errorCode, result.errorMessage, errorSnapshot);
        } else {
          await this.prisma.client.outboundDelivery.update({
            where: { id: delivery.id },
            data: {
              status: 'Failed',
              retryCount: newRetryCount,
              errorCode: result.errorCode,
              errorMessage: result.errorMessage,
              resultSnapshot,
            },
          });

          await this.recordEvent(delivery.id, 'failure', 'Sending', 'Failed', attemptNumber, result.errorCode, result.errorMessage, errorSnapshot);

          if (delivery.contactId) {
            await this.updateCampaignContactStatus(delivery.contentId, delivery.contactId, 'BOUNCED');
          }

          this.events.emit('content.failed', { deliveryId: delivery.id, contentId: delivery.contentId, businessId: delivery.businessId, errorCode: result.errorCode });
          this.events.emit('delivery.failed', { deliveryId: delivery.id, contentId: delivery.contentId, businessId: delivery.businessId });

          await this.updateContentStatus(delivery.contentId);
        }
      }
    } catch (err: any) {
      const normalized = adapter.normalizeError(err);
      const newRetryCount = delivery.retryCount + 1;
      const errorSnapshot = { errorCode: normalized.code, errorMessage: normalized.message };

      if (normalized.isTransient && newRetryCount < delivery.maxRetries) {
        const backoffMs = BACKOFF_BASE_MS * Math.pow(2, delivery.retryCount);
        await this.prisma.client.outboundDelivery.update({
          where: { id: delivery.id },
          data: { status: 'RetryPending', retryCount: newRetryCount, nextRetryAt: new Date(Date.now() + backoffMs), errorCode: normalized.code, errorMessage: normalized.message },
        });
        await this.recordEvent(delivery.id, 'retry_scheduled', 'Sending', 'RetryPending', newRetryCount, normalized.code, normalized.message, errorSnapshot);
      } else {
        await this.prisma.client.outboundDelivery.update({
          where: { id: delivery.id },
          data: { status: 'Failed', retryCount: newRetryCount, errorCode: normalized.code, errorMessage: normalized.message },
        });
        await this.recordEvent(delivery.id, 'failure', 'Sending', 'Failed', newRetryCount, normalized.code, normalized.message, errorSnapshot);

        this.events.emit('content.failed', { deliveryId: delivery.id, contentId: delivery.contentId, businessId: delivery.businessId, errorCode: normalized.code });
        this.events.emit('delivery.failed', { deliveryId: delivery.id, contentId: delivery.contentId, businessId: delivery.businessId });

        await this.updateContentStatus(delivery.contentId);
      }
    }
  }

  private async failDelivery(deliveryId: string, contentId: string, businessId: string, errorCode: string, errorMessage: string, statusBefore: string) {
    await this.prisma.client.outboundDelivery.update({
      where: { id: deliveryId },
      data: { status: 'Failed', errorCode, errorMessage },
    });
    await this.recordEvent(deliveryId, 'failure', statusBefore, 'Failed', 1, errorCode, errorMessage, { errorCode, errorMessage });

    this.events.emit('content.failed', { deliveryId, contentId, businessId, errorCode });
    this.events.emit('delivery.failed', { deliveryId, contentId, businessId });

    await this.updateContentStatus(contentId);
  }

  private async recordEvent(
    deliveryId: string,
    eventType: string,
    statusBefore: string,
    statusAfter: string,
    attemptNumber?: number,
    errorCode?: string,
    errorMessage?: string,
    resultData?: Record<string, unknown>,
    attemptId?: string,
  ) {
    await this.prisma.client.deliveryEvent.create({
      data: {
        deliveryId,
        eventType,
        statusBefore,
        statusAfter,
        attemptNumber,
        attemptId,
        errorCode,
        errorMessage,
        resultData: resultData as Prisma.InputJsonValue | undefined,
      },
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
    const allCancelled = statuses.every(s => s === 'Cancelled');
    const anyPending = statuses.some(s => ['Queued', 'Scheduled', 'Sending', 'RetryPending'].includes(s));

    let contentStatus: string;
    if (allCancelled) contentStatus = 'Cancelled';
    else if (allPublished) contentStatus = 'Sent';
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
      include: { connection: { select: { provider: true, healthState: true, accountEmail: true } } },
    });

    if (destinations.length === 0) throw new BadRequestException('No valid active destinations found');

    const contentMeta = content.contentMeta as Record<string, unknown> | null;
    const segmentTags = (contentMeta?.segmentTags as string[] | undefined) ?? [];
    const hasMessagingDest = destinations.some(
      d => d.connection.provider === 'EMAIL' || d.connection.provider === 'GOOGLE' || d.connection.provider === 'WHATSAPP',
    );
    const isAudienceSend = hasMessagingDest && (content.contentType === 'campaign_email' || content.contentType === 'whatsapp_message' || segmentTags.length > 0);

    if (content.contentType === 'campaign_email') {
      await this.validateEmailCampaignPreSend(content, destinations);
    }

    const deliveryData: Array<{
      contentId: string; variantId: string | null; destinationId: string;
      businessId: string; status: string; scheduledAt: Date;
      contactId: string | null; recipientEmail: string | null; recipientPhone: string | null;
    }> = [];

    if (isAudienceSend) {
      const recipients = await this.expandRecipientsForDelivery(businessId, segmentTags);

      if (recipients.length === 0) {
        throw new BadRequestException('No eligible recipients found. Check your audience segments and ensure contacts are not suppressed.');
      }

      for (const dest of destinations) {
        const variant = content.variants.find(v => v.platform === dest.platform) || content.variants.find(v => v.platform === 'DEFAULT');
        const isWhatsApp = dest.connection.provider === 'WHATSAPP';
        const isEmail = dest.connection.provider === 'EMAIL' || dest.connection.provider === 'GOOGLE';

        if (isEmail || isWhatsApp) {
          for (const r of recipients) {
            if (isEmail && !r.email) continue;
            if (isWhatsApp && !r.phone) continue;
            deliveryData.push({
              contentId, variantId: variant?.id ?? null, destinationId: dest.id,
              businessId, status: 'Queued', scheduledAt: new Date(),
              contactId: r.id, recipientEmail: isEmail ? r.email : null, recipientPhone: isWhatsApp ? r.phone : null,
            });
          }
        } else {
          deliveryData.push({
            contentId, variantId: variant?.id ?? null, destinationId: dest.id,
            businessId, status: 'Queued', scheduledAt: new Date(),
            contactId: null, recipientEmail: null, recipientPhone: null,
          });
        }
      }
    } else {
      for (const dest of destinations) {
        const variant = content.variants.find(v => v.platform === dest.platform) || content.variants.find(v => v.platform === 'DEFAULT');
        deliveryData.push({
          contentId, variantId: variant?.id ?? null, destinationId: dest.id,
          businessId, status: 'Queued', scheduledAt: new Date(),
          contactId: null, recipientEmail: null, recipientPhone: null,
        });
      }
    }

    if (deliveryData.length === 0) throw new BadRequestException('No eligible recipients found for this audience');

    const deliveries = await this.prisma.client.outboundDelivery.createManyAndReturn({ data: deliveryData });

    await this.prisma.client.outboundContent.update({
      where: { id: contentId },
      data: { status: 'Queued' },
    });

    for (const delivery of deliveries) {
      await this.recordEvent(delivery.id, 'attempt', 'Queued', 'Queued', 0);
    }

    if (content.contentType === 'campaign_email') {
      await this.ensureCampaignAndContacts(businessId, contentId, content, deliveryData);
    }

    setTimeout(() => this.tick(), 500);

    return { queued: deliveries.length, deliveryIds: deliveries.map(d => d.id) };
  }

  private async expandRecipientsForDelivery(businessId: string, segmentTags: string[]): Promise<Array<{ id: string; email: string | null; phone: string | null }>> {
    const where: Record<string, unknown> = {
      businessId, deletedAt: null,
      doNotContact: { not: true },
      marketingOptIn: { not: false },
    };
    if (segmentTags.length > 0) {
      where.tags = { hasSome: segmentTags };
    }

    const contacts = await this.prisma.client.contact.findMany({
      where,
      select: { id: true, email: true, phone: true },
      take: 10000,
    });

    return contacts.map(c => ({ id: c.id, email: c.email, phone: c.phone }));
  }

  private async validateEmailCampaignPreSend(
    content: { subject?: string | null; body?: string | null; contentMeta?: unknown },
    destinations: Array<{ id: string; connection: { provider: string; healthState?: string; accountEmail?: string | null } }>,
  ) {
    const errors: string[] = [];

    if (!content.subject || content.subject.trim().length === 0) {
      errors.push('Email subject is required');
    }

    if (!content.body || content.body.trim().length === 0) {
      errors.push('Email body is required');
    }

    const emailDestinations = destinations.filter(
      d => d.connection.provider === 'EMAIL' || d.connection.provider === 'GOOGLE',
    );
    if (emailDestinations.length === 0) {
      errors.push('At least one email-capable destination is required for email campaigns');
    }

    const unhealthySenders = emailDestinations.filter(d => d.connection.healthState && d.connection.healthState !== 'Connected');
    if (unhealthySenders.length > 0) {
      errors.push(`Sender connection is unhealthy (${unhealthySenders[0].connection.healthState}). Please reconnect in Studio.`);
    }

    const sendersWithoutEmail = emailDestinations.filter(d => !d.connection.accountEmail);
    if (sendersWithoutEmail.length > 0 && emailDestinations.length === sendersWithoutEmail.length) {
      errors.push('No sender email configured. Set up your sender identity in Content Studio.');
    }

    if (errors.length > 0) {
      throw new BadRequestException(`Email campaign validation failed: ${errors.join('; ')}`);
    }
  }

  private async ensureCampaignAndContacts(
    businessId: string,
    contentId: string,
    content: { subject?: string | null; body?: string | null; contentMeta?: unknown },
    deliveryData: Array<{ contactId: string | null; recipientEmail: string | null }>,
  ) {
    try {
      const existingMeta = content.contentMeta as Record<string, unknown> | null;
      let campaignId = existingMeta?.campaignId as string | undefined;

      if (!campaignId) {
        const segmentTags = (existingMeta?.segmentTags as string[] | undefined) ?? [];
        const campaign = await this.prisma.client.emailCampaign.create({
          data: {
            businessId,
            name: content.subject || 'Email Campaign',
            subject: content.subject || '',
            body: content.body || '',
            status: 'SENDING',
            totalRecipients: deliveryData.filter(d => d.recipientEmail).length,
            segmentFilter: segmentTags.length > 0 ? { tags: segmentTags } : undefined,
          },
        });
        campaignId = campaign.id;

        await this.prisma.client.outboundContent.update({
          where: { id: contentId },
          data: { contentMeta: { ...(existingMeta ?? {}), campaignId } },
        });
      }

      const campaignContactData = deliveryData
        .filter(d => d.contactId && d.recipientEmail)
        .map(d => ({
          campaignId: campaignId as string,
          contactId: d.contactId as string,
          email: d.recipientEmail as string,
          businessId,
          status: 'PENDING',
        }));

      if (campaignContactData.length > 0) {
        await this.prisma.client.emailCampaignContact.createMany({
          data: campaignContactData,
          skipDuplicates: true,
        });
      }
    } catch (err: any) {
      this.logger.warn(`Failed to create campaign tracking: ${(err as Error).message}`);
    }
  }

  async trackOpen(deliveryId: string) {
    const delivery = await this.prisma.client.outboundDelivery.findUnique({
      where: { id: deliveryId },
      select: { contentId: true, contactId: true, businessId: true },
    });
    if (!delivery || !delivery.contactId) return;
    await this.updateCampaignContactStatus(delivery.contentId, delivery.contactId, 'OPENED');
    this.events.emit('delivery.opened', { deliveryId, contentId: delivery.contentId, businessId: delivery.businessId });
  }

  async trackClick(deliveryId: string) {
    const delivery = await this.prisma.client.outboundDelivery.findUnique({
      where: { id: deliveryId },
      select: { contentId: true, contactId: true, businessId: true },
    });
    if (!delivery || !delivery.contactId) return;
    await this.updateCampaignContactStatus(delivery.contentId, delivery.contactId, 'CLICKED');
    this.events.emit('delivery.clicked', { deliveryId, contentId: delivery.contentId, businessId: delivery.businessId });
  }

  private async updateCampaignContactStatus(
    contentId: string,
    contactId: string,
    status: string,
    throwOnError = false,
  ) {
    try {
      const contentMeta = (await this.prisma.client.outboundContent.findUnique({
        where: { id: contentId },
        select: { contentMeta: true },
      }))?.contentMeta as Record<string, unknown> | null;

      const campaignId = contentMeta?.campaignId as string | undefined;
      if (!campaignId) return;

      const updateData: Record<string, unknown> = { status };
      if (status === 'SENT') updateData.sentAt = new Date();
      if (status === 'OPENED') updateData.openedAt = new Date();
      if (status === 'CLICKED') updateData.clickedAt = new Date();
      if (status === 'BOUNCED') updateData.bouncedAt = new Date();

      await this.prisma.client.emailCampaignContact.updateMany({
        where: { campaignId, contactId },
        data: updateData,
      });
    } catch (err: any) {
      if (throwOnError) throw err;
      this.logger.warn(`Failed to update campaign contact status: ${(err as Error).message}`);
    }
  }

  async schedule(businessId: string, contentId: string, destinationIds: string[], scheduledAt: string, timezone?: string) {
    const content = await this.prisma.client.outboundContent.findFirst({
      where: { id: contentId, businessId, deletedAt: null },
      include: { variants: true },
    });
    if (!content) throw new NotFoundException('Content not found');

    const tz = timezone || content.timezone || DEFAULT_TIMEZONE;
    const scheduleDate = resolveScheduledAtUtc(scheduledAt, tz);
    if (scheduleDate <= new Date()) throw new BadRequestException('Scheduled date must be in the future');

    const destinations = await this.prisma.client.channelDestination.findMany({
      where: { id: { in: destinationIds }, businessId, isActive: true },
      include: { connection: { select: { provider: true, healthState: true, accountEmail: true } } },
    });
    if (destinations.length === 0) throw new BadRequestException('No valid active destinations found');

    const contentMeta = content.contentMeta as Record<string, unknown> | null;
    const segmentTags = (contentMeta?.segmentTags as string[] | undefined) ?? [];
    const hasMessagingDest = destinations.some(
      d => d.connection.provider === 'EMAIL' || d.connection.provider === 'GOOGLE' || d.connection.provider === 'WHATSAPP',
    );
    const isAudienceSend = hasMessagingDest && (content.contentType === 'campaign_email' || content.contentType === 'whatsapp_message' || segmentTags.length > 0);

    if (content.contentType === 'campaign_email') {
      await this.validateEmailCampaignPreSend(content, destinations);
    }

    const deliveryData: Array<{
      contentId: string; variantId: string | null; destinationId: string;
      businessId: string; status: string; scheduledAt: Date;
      contactId: string | null; recipientEmail: string | null; recipientPhone: string | null;
    }> = [];

    if (isAudienceSend) {
      const recipients = await this.expandRecipientsForDelivery(businessId, segmentTags);

      if (recipients.length === 0) {
        throw new BadRequestException('No eligible recipients found. Check your audience segments and ensure contacts are not suppressed.');
      }

      for (const dest of destinations) {
        const variant = content.variants.find(v => v.platform === dest.platform) || content.variants.find(v => v.platform === 'DEFAULT');
        const isWhatsApp = dest.connection.provider === 'WHATSAPP';
        const isEmail = dest.connection.provider === 'EMAIL' || dest.connection.provider === 'GOOGLE';

        if (isEmail || isWhatsApp) {
          for (const r of recipients) {
            if (isEmail && !r.email) continue;
            if (isWhatsApp && !r.phone) continue;
            deliveryData.push({
              contentId, variantId: variant?.id ?? null, destinationId: dest.id,
              businessId, status: 'Scheduled', scheduledAt: scheduleDate,
              contactId: r.id, recipientEmail: isEmail ? r.email : null, recipientPhone: isWhatsApp ? r.phone : null,
            });
          }
        } else {
          deliveryData.push({
            contentId, variantId: variant?.id ?? null, destinationId: dest.id,
            businessId, status: 'Scheduled', scheduledAt: scheduleDate,
            contactId: null, recipientEmail: null, recipientPhone: null,
          });
        }
      }
    } else {
      for (const dest of destinations) {
        const variant = content.variants.find(v => v.platform === dest.platform) || content.variants.find(v => v.platform === 'DEFAULT');
        deliveryData.push({
          contentId, variantId: variant?.id ?? null, destinationId: dest.id,
          businessId, status: 'Scheduled', scheduledAt: scheduleDate,
          contactId: null, recipientEmail: null, recipientPhone: null,
        });
      }
    }

    if (deliveryData.length === 0) throw new BadRequestException('No eligible recipients found for this audience');

    const deliveries = await this.prisma.client.outboundDelivery.createManyAndReturn({ data: deliveryData });

    await this.prisma.client.outboundContent.update({
      where: { id: contentId },
      data: { status: 'Scheduled', scheduledAt: scheduleDate, timezone: tz },
    });

    if (content.contentType === 'campaign_email') {
      await this.ensureCampaignAndContacts(businessId, contentId, content, deliveryData);
    }

    return { scheduled: deliveries.length, scheduledAt: scheduleDate.toISOString(), timezone: tz, deliveryIds: deliveries.map(d => d.id) };
  }

  async reschedule(businessId: string, deliveryId: string, newScheduledAt: string, timezone?: string) {
    const delivery = await this.prisma.client.outboundDelivery.findFirst({
      where: { id: deliveryId, businessId, status: { in: ['Scheduled', 'Queued'] } },
      include: { content: { select: { timezone: true } } },
    });
    if (!delivery) throw new NotFoundException('Pending delivery not found');

    const contentRecord = delivery.content as { timezone?: string } | null;
    const tz = timezone || contentRecord?.timezone || DEFAULT_TIMEZONE;
    const newDate = resolveScheduledAtUtc(newScheduledAt, tz);
    if (newDate <= new Date()) throw new BadRequestException('New scheduled date must be in the future');

    const updated = await this.prisma.client.outboundDelivery.update({
      where: { id: deliveryId },
      data: { scheduledAt: newDate, status: 'Scheduled' },
    });

    await this.recordEvent(deliveryId, 'rescheduled', delivery.status, 'Scheduled', undefined, undefined, `Rescheduled to ${newDate.toISOString()} (${tz})`);

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
      include: { destination: { include: { connection: true } } },
    });
    if (!delivery) throw new NotFoundException('Failed delivery not found');

    const resendDelivery = this.resolveDeliveryAdapter(
      delivery as unknown as ResendDeliveryRecord,
    )?.provider === 'RESEND';

    if (delivery.providerOutcome === 'SUCCEEDED_CONFIRMED') {
      throw new BadRequestException('Provider already confirmed this delivery; only consequence repair is allowed');
    }
    if (
      delivery.providerOutcome === 'OUTCOME_UNKNOWN'
      && !isInsideResendIdempotencyWindow(delivery.providerFirstAttemptAt)
    ) {
      throw new BadRequestException('Provider outcome is unknown outside the safe replay window; reconciliation is required');
    }
    if (resendDelivery && !delivery.providerOutcome) {
      throw new BadRequestException(
        'Legacy Resend provider outcome is ambiguous; automatic resend is not safe',
      );
    }

    const updated = await this.prisma.client.outboundDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'Queued',
        scheduledAt: new Date(),
        errorCode: null,
        errorMessage: null,
        nextRetryAt: null,
      },
    });

    await this.recordEvent(deliveryId, 'manual_retry', 'Failed', 'Queued');
    setTimeout(() => this.tick(), 500);
    return updated;
  }

  async getDeliverySummary(businessId: string, contentId: string) {
    const content = await this.prisma.client.outboundContent.findFirst({
      where: { id: contentId, businessId, deletedAt: null },
      select: { id: true, status: true, contentType: true, subject: true, scheduledAt: true, publishedAt: true, timezone: true },
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
      timezone: content.timezone,
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

  async listDeliveries(businessId: string, opts?: { status?: string; channel?: string; contentId?: string; contentType?: string; dateFrom?: string; dateTo?: string; limit?: number; offset?: number }) {
    const where: Record<string, unknown> = { businessId };
    if (opts?.status) where.status = opts.status;
    if (opts?.contentId) where.contentId = opts.contentId;
    if (opts?.contentType) where.content = { ...(where.content as Record<string, unknown> || {}), contentType: opts.contentType };
    if (opts?.dateFrom || opts?.dateTo) {
      const createdAtFilter: Record<string, Date> = {};
      if (opts?.dateFrom) createdAtFilter.gte = new Date(opts.dateFrom);
      if (opts?.dateTo) createdAtFilter.lte = new Date(opts.dateTo);
      where.createdAt = createdAtFilter;
    }

    const take = Math.min(opts?.limit || 50, 200);
    const skip = opts?.offset || 0;

    const includeRelations = {
      destination: { select: { platform: true, displayName: true, label: true } },
      content: { select: { id: true, subject: true, contentType: true, status: true } },
    };

    const fullWhere = opts?.channel
      ? { ...where, destination: { ...(where.destination as Record<string, unknown> || {}), platform: opts.channel.toUpperCase() } }
      : where;

    const deliveries = await this.prisma.client.outboundDelivery.findMany({
      where: fullWhere,
      include: includeRelations,
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });

    const total = await this.prisma.client.outboundDelivery.count({ where: fullWhere });

    return { deliveries, total, limit: take, offset: skip };
  }

  async getDeliveryEvents(businessId: string, deliveryId: string) {
    const delivery = await this.prisma.client.outboundDelivery.findFirst({
      where: { id: deliveryId, businessId },
      select: { id: true },
    });
    if (!delivery) throw new NotFoundException('Delivery not found');

    return this.prisma.client.deliveryEvent.findMany({
      where: { deliveryId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async retryAllFailed(businessId: string, contentId: string) {
    const failed = await this.prisma.client.outboundDelivery.findMany({
      where: { businessId, contentId, status: 'Failed' },
      include: { destination: { include: { connection: true } } },
    });

    const eligible = failed.filter((delivery) => {
      if (delivery.providerOutcome === 'SUCCEEDED_CONFIRMED') return false;
      if (delivery.providerOutcome === 'OUTCOME_UNKNOWN') {
        return isInsideResendIdempotencyWindow(delivery.providerFirstAttemptAt);
      }
      const isResend = this.resolveDeliveryAdapter(
        delivery as unknown as ResendDeliveryRecord,
      )?.provider === 'RESEND';
      if (isResend && !delivery.providerOutcome) return false;
      return true;
    });

    if (eligible.length === 0) return { retried: 0, blocked: failed.length };

    await this.prisma.client.outboundDelivery.updateMany({
      where: { id: { in: eligible.map((f) => f.id) }, status: 'Failed' },
      data: {
        status: 'Queued',
        scheduledAt: new Date(),
        errorCode: null,
        errorMessage: null,
        nextRetryAt: null,
      },
    });

    for (const delivery of eligible) {
      await this.recordEvent(delivery.id, 'manual_retry', 'Failed', 'Queued');
    }

    setTimeout(() => this.tick(), 500);
    return { retried: eligible.length, blocked: failed.length - eligible.length };
  }
}
