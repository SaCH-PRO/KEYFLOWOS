import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { DeliveryQueueService } from './delivery-queue.service';
import type {
  ChannelAdapter,
  ProviderEffectMaterial,
  PublishResponse,
} from './adapters/channel-adapter.interface';

const material: ProviderEffectMaterial = {
  provider: 'RESEND',
  recipient: 'customer@example.test',
  sender: 'Keyflow <no-reply@keyflow.test>',
  subject: 'Bound subject',
  html: '<p>Bound body</p>',
  text: 'Bound body',
};

function baseDelivery(overrides: Record<string, unknown> = {}) {
  return {
    id: 'delivery_1',
    contentId: 'content_1',
    destinationId: 'destination_1',
    businessId: 'business_1',
    contactId: null,
    recipientEmail: 'customer@example.test',
    recipientPhone: null,
    status: 'Sending',
    retryCount: 0,
    maxRetries: 3,
    effectFingerprint: null,
    effectSnapshot: null,
    attemptSequence: 0,
    currentAttemptId: null,
    attemptStartedAt: null,
    attemptLeaseExpiresAt: null,
    providerOutcome: null,
    providerFirstAttemptAt: null,
    consequenceState: null,
    externalPostId: null,
    claimedFromStatus: 'Queued',
    destination: {
      platform: 'EMAIL',
      platformId: null,
      destinationMeta: null,
      connection: { provider: 'EMAIL', token: null },
    },
    content: {
      subject: 'Mutable subject',
      body: 'Mutable body',
      contentType: 'campaign_email',
      contentMeta: null,
      variants: [],
    },
    variant: {
      platform: 'EMAIL',
      textBody: 'Mutable body',
      htmlBody: '<p>Mutable body</p>',
      mediaUrls: [],
      variantMeta: { subject: 'Mutable subject' },
    },
    ...overrides,
  };
}

function harness(providerResult: PublishResponse) {
  const order: string[] = [];
  const provider = {
    provider: 'RESEND',
    prepareEffectMaterial: vi.fn(() => material),
    publish: vi.fn(async () => {
      order.push('provider');
      return providerResult;
    }),
    normalizeError: vi.fn(() => ({
      code: 'OUTCOME_UNKNOWN',
      message: 'unknown',
      isTransient: true,
      outcomeCertainty: 'OUTCOME_UNKNOWN' as const,
    })),
    getCapabilities: vi.fn(),
  } satisfies ChannelAdapter;

  let attemptClaimAvailable = true;
  const outboundUpdateMany = vi.fn(async (args: unknown) => {
    const data = (args as { data?: Record<string, unknown> }).data;
    if (data?.providerOutcome === 'ATTEMPT_IN_FLIGHT') {
      if (!attemptClaimAvailable) return { count: 0 };
      attemptClaimAvailable = false;
    }
    return { count: 1 };
  });

  const deliveryEventCreate = vi.fn(async () => ({ id: 'evt_1' }));
  const tx = {
    outboundDelivery: {
      updateMany: vi.fn(async (args: unknown) => {
        order.push('attempt-row');
        const result = await outboundUpdateMany(args);
        return result;
      }),
    },
    deliveryEvent: {
      create: vi.fn(async (args: unknown) => {
        order.push('attempt-event');
        return deliveryEventCreate(args);
      }),
    },
  };

  const outboundContentUpdate = vi.fn(async () => ({ id: 'content_1' }));
  const prisma = {
    client: {
      $transaction: vi.fn(async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx)),
      outboundDelivery: {
        updateMany: outboundUpdateMany,
        findMany: vi.fn(async () => [{ status: 'Published' }]),
        findFirst: vi.fn(),
      },
      deliveryEvent: {
        findFirst: vi.fn(async () => null),
        create: deliveryEventCreate,
      },
      outboundContent: {
        findUnique: vi.fn(async () => ({ contentMeta: null })),
        update: outboundContentUpdate,
      },
      emailCampaignContact: {
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    },
  };

  const adapters = {
    resolveEmailFor: vi.fn(() => provider),
    resolveByPlatform: vi.fn(() => null),
  };
  const events = { emit: vi.fn() };

  const service = new DeliveryQueueService(prisma as never, adapters as never, events as never);
  const privateService = service as unknown as {
    executeDelivery(delivery: unknown): Promise<void>;
    repairResendConsequences(delivery: unknown): Promise<void>;
  };

  return {
    service,
    privateService,
    prisma,
    provider,
    events,
    order,
    outboundUpdateMany,
    outboundContentUpdate,
    setAttemptClaimAvailable(value: boolean) {
      attemptClaimAvailable = value;
    },
  };
}

describe('Resend outbound effect certainty', () => {
  it('[EXTFX-P04] persists attempt ownership before invoking the provider', async () => {
    const h = harness({ success: true, externalPostId: 'email_1' });
    await h.privateService.executeDelivery(baseDelivery());

    expect(h.provider.publish).toHaveBeenCalledTimes(1);
    expect(h.order.indexOf('attempt-row')).toBeGreaterThanOrEqual(0);
    expect(h.order.indexOf('attempt-event')).toBeGreaterThan(h.order.indexOf('attempt-row'));
    expect(h.order.indexOf('provider')).toBeGreaterThan(h.order.indexOf('attempt-event'));
  });

  it('[EXTFX-P08/P09] confirmed provider success survives local consequence failure without resend', async () => {
    const h = harness({ success: true, externalPostId: 'email_1' });
    h.outboundContentUpdate.mockRejectedValueOnce(new Error('local aggregate write failed'));

    await h.privateService.executeDelivery(baseDelivery());

    expect(h.provider.publish).toHaveBeenCalledTimes(1);
    expect(h.outboundUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          providerOutcome: 'SUCCEEDED_CONFIRMED',
          consequenceState: 'INCOMPLETE',
        }),
      }),
    );
    expect(h.outboundUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          providerOutcome: undefined,
        }),
      }),
    ).not;

    await h.privateService.repairResendConsequences(
      baseDelivery({
        status: 'Published',
        providerOutcome: 'SUCCEEDED_CONFIRMED',
        consequenceState: 'INCOMPLETE',
        currentAttemptId: 'delivery_1:1',
        attemptSequence: 1,
        externalPostId: 'email_1',
      }),
    );

    expect(h.provider.publish).toHaveBeenCalledTimes(1);
    expect(h.outboundUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ consequenceState: 'COMPLETE' }),
      }),
    );
  });

  it('[EXTFX-P11] ambiguous provider outcome becomes bounded safe replay state', async () => {
    const h = harness({
      success: false,
      errorCode: 'OUTCOME_UNKNOWN',
      errorMessage: 'connection dropped',
      isTransient: true,
      outcomeCertainty: 'OUTCOME_UNKNOWN',
    });

    await h.privateService.executeDelivery(baseDelivery());

    expect(h.outboundUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          providerOutcome: 'OUTCOME_UNKNOWN',
          status: 'RetryPending',
          errorCode: 'OUTCOME_UNKNOWN_SAFE_REPLAY',
        }),
      }),
    );
  });

  it('[EXTFX-P14] blocks legacy RetryPending Resend rows with no provider evidence', async () => {
    const h = harness({ success: true, externalPostId: 'should_not_send' });

    await h.privateService.executeDelivery(
      baseDelivery({ claimedFromStatus: 'RetryPending', providerOutcome: null }),
    );

    expect(h.provider.publish).not.toHaveBeenCalled();
    expect(h.outboundUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'Failed',
          errorCode: 'LEGACY_PROVIDER_OUTCOME_AMBIGUOUS',
        }),
      }),
    );
  });

  it('[EXTFX-P05] a lost attempt CAS prevents a second provider invocation', async () => {
    const h = harness({ success: true, externalPostId: 'email_1' });
    h.setAttemptClaimAvailable(false);

    await h.privateService.executeDelivery(baseDelivery());

    expect(h.provider.publish).not.toHaveBeenCalled();
  });

  it('manual retry refuses provider-confirmed delivery', async () => {
    const h = harness({ success: true, externalPostId: 'email_1' });
    h.prisma.client.outboundDelivery.findFirst.mockResolvedValueOnce(
      baseDelivery({ status: 'Failed', providerOutcome: 'SUCCEEDED_CONFIRMED' }),
    );

    await expect(h.service.retry('business_1', 'delivery_1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('manual retry refuses unknown outcome after the provider replay window', async () => {
    const h = harness({ success: true, externalPostId: 'email_1' });
    h.prisma.client.outboundDelivery.findFirst.mockResolvedValueOnce(
      baseDelivery({
        status: 'Failed',
        providerOutcome: 'OUTCOME_UNKNOWN',
        providerFirstAttemptAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      }),
    );

    await expect(h.service.retry('business_1', 'delivery_1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('[EXTFX-P02] reuses a bound immutable snapshot even if source content changes', async () => {
    const h = harness({ success: true, externalPostId: 'email_1' });
    const { effectFingerprint } = await import('./effect-certainty');
    const boundFingerprint = effectFingerprint(material);

    await h.privateService.executeDelivery(
      baseDelivery({
        effectSnapshot: material,
        effectFingerprint: boundFingerprint,
        content: { subject: 'Changed', body: 'Changed', contentType: 'campaign_email', variants: [] },
        variant: { platform: 'EMAIL', textBody: 'Changed', htmlBody: '<p>Changed</p>', mediaUrls: [], variantMeta: { subject: 'Changed' } },
      }),
    );

    expect(h.provider.prepareEffectMaterial).not.toHaveBeenCalled();
    expect(h.provider.publish).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ material }),
    );
  });
});
