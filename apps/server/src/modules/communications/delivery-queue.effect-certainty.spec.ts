import { BadRequestException, NotFoundException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeliveryQueueService } from './delivery-queue.service';
import { ChannelAdapter } from './adapters/channel-adapter.interface';

type Row = Record<string, any>;

function baseDelivery(overrides: Row = {}): Row {
  return {
    id: 'delivery_1',
    contentId: 'content_1',
    variantId: null,
    destinationId: 'destination_1',
    businessId: 'biz_1',
    contactId: null,
    recipientEmail: 'customer@example.test',
    recipientPhone: null,
    status: 'Sending',
    scheduledAt: new Date(),
    sentAt: null,
    externalPostId: null,
    externalUrl: null,
    errorCode: null,
    errorMessage: null,
    retryCount: 0,
    maxRetries: 3,
    nextRetryAt: null,
    resultSnapshot: null,
    effectFingerprint: null,
    effectSnapshot: null,
    attemptSequence: 0,
    currentAttemptId: null,
    attemptStartedAt: null,
    attemptLeaseExpiresAt: null,
    providerOutcome: null,
    providerFirstAttemptAt: null,
    providerIdempotencyKey: null,
    consequenceState: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    destination: {
      id: 'destination_1',
      platform: 'EMAIL',
      platformId: null,
      displayName: 'Email',
      destinationMeta: null,
      connection: { id: 'connection_1', provider: 'EMAIL', token: null },
    },
    content: {
      id: 'content_1',
      subject: 'Hello',
      body: 'Body',
      contentType: 'campaign_email',
      contentMeta: null,
      variants: [],
    },
    variant: null,
    ...overrides,
  };
}

function applyData(row: Row, data: Row) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'increment' in value) {
      row[key] = (row[key] ?? 0) + Number((value as Row).increment);
    } else {
      row[key] = value;
    }
  }
  row.updatedAt = new Date();
}

function makeHarness(options?: {
  delivery?: Row;
  publish?: ChannelAdapter['publish'];
  contentUpdateFails?: boolean;
  derivativeThrows?: boolean;
}) {
  const row = options?.delivery ?? baseDelivery();
  const deliveryEvents: Row[] = [];
  let contentUpdateFails = options?.contentUpdateFails ?? false;

  const outboundDelivery = {
    update: vi.fn(async ({ data }: Row) => {
      applyData(row, data);
      return { ...row };
    }),
    updateMany: vi.fn(async ({ where, data }: Row) => {
      if (where.id && where.id !== row.id) return { count: 0 };
      if (where.status && typeof where.status === 'string' && where.status !== row.status) return { count: 0 };
      if (where.providerOutcome && where.providerOutcome !== row.providerOutcome) return { count: 0 };
      if (where.currentAttemptId && where.currentAttemptId !== row.currentAttemptId) return { count: 0 };
      applyData(row, data);
      return { count: 1 };
    }),
    findUnique: vi.fn(async ({ where }: Row) => where.id === row.id ? { ...row } : null),
    findFirst: vi.fn(async ({ where }: Row) => {
      if (where.id && where.id !== row.id) return null;
      if (where.businessId && where.businessId !== row.businessId) return null;
      if (where.status && typeof where.status === 'string' && where.status !== row.status) return null;
      return { ...row };
    }),
    findMany: vi.fn(async ({ where }: Row) => {
      if (where?.contentId) return [{ status: row.status }];
      if (where?.providerOutcome && where.providerOutcome !== row.providerOutcome) return [];
      if (where?.consequenceState && where.consequenceState !== row.consequenceState) return [];
      if (where?.status && typeof where.status === 'string' && where.status !== row.status) return [];
      return [{ ...row }];
    }),
  };

  const deliveryEvent = {
    create: vi.fn(async ({ data }: Row) => {
      deliveryEvents.push({ id: `event_${deliveryEvents.length + 1}`, ...data });
      return deliveryEvents.at(-1);
    }),
    findFirst: vi.fn(async ({ where }: Row) => deliveryEvents.find((e) =>
      e.deliveryId === where.deliveryId &&
      e.eventType === where.eventType &&
      (!where.attemptId || e.attemptId === where.attemptId),
    ) ?? null),
  };

  const outboundContent = {
    findUnique: vi.fn(async () => ({ contentMeta: null })),
    update: vi.fn(async () => {
      if (contentUpdateFails) throw new Error('injected local consequence failure');
      return {};
    }),
  };

  const client = {
    outboundDelivery,
    deliveryEvent,
    outboundContent,
    emailCampaignContact: { updateMany: vi.fn(async () => ({ count: 1 })) },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };

  const adapter: ChannelAdapter = {
    provider: 'RESEND',
    publish: options?.publish ?? vi.fn(async () => ({ success: true, externalPostId: 'resend_1' })),
    normalizeError: vi.fn(() => ({ code: 'UNKNOWN', message: 'unknown', isTransient: true })),
    getCapabilities: vi.fn(() => ({
      supports_text_post: false,
      supports_image_post: false,
      supports_video_post: false,
      supports_scheduled_post: false,
      supports_campaign_email: true,
      supports_template_message: false,
    })),
  };

  const adapters = {
    resolveEmailFor: vi.fn(() => adapter),
    resolveByPlatform: vi.fn(() => null),
  };
  const events = {
    emit: options?.derivativeThrows
      ? vi.fn(() => { throw new Error('injected derivative listener failure'); })
      : vi.fn(),
  };
  const service = new DeliveryQueueService({ client } as any, adapters as any, events as any);

  return {
    service,
    row,
    deliveryEvents,
    client,
    adapter,
    events,
    setContentUpdateFails(value: boolean) { contentUpdateFails = value; },
  };
}

function invocationRow(row: Row): Row {
  return {
    ...row,
    destination: row.destination,
    content: row.content,
    variant: row.variant,
  };
}

describe('Resend effect certainty in DeliveryQueueService', () => {
  beforeEach(() => {
    process.env.EMAIL_FROM_ADDRESS = 'no-reply@example.test';
    process.env.EMAIL_FROM_NAME = 'Keyflow';
  });

  afterEach(() => {
    delete process.env.EMAIL_FROM_ADDRESS;
    delete process.env.EMAIL_FROM_NAME;
    vi.restoreAllMocks();
  });

  it('[EXTFX-P01/P06] keeps the delivery effect id and provider key stable across attempts', async () => {
    const contexts: Array<{ effectId: string; attemptId: string; providerIdempotencyKey?: string }> = [];
    const h = makeHarness({
      publish: vi.fn(async (_connection, _destination, _payload, context) => {
        if (context) contexts.push({
          effectId: context.effectId,
          attemptId: context.attemptId,
          providerIdempotencyKey: context.providerIdempotencyKey,
        });
        return {
          success: false,
          isTransient: true,
          errorCode: 'NETWORK_UNKNOWN',
          errorMessage: 'response lost',
          outcomeCertainty: 'OUTCOME_UNKNOWN',
        };
      }),
    });

    const execute = Reflect.get(h.service, 'executeDelivery') as (delivery: Row) => Promise<void>;
    await execute.call(h.service, invocationRow(h.row));
    h.row.status = 'Sending';
    await execute.call(h.service, invocationRow(h.row));

    expect(contexts).toHaveLength(2);
    expect(contexts[0].effectId).toBe(h.row.id);
    expect(contexts[1].effectId).toBe(h.row.id);
    expect(contexts[0].attemptId).not.toBe(contexts[1].attemptId);
    expect(contexts[0].providerIdempotencyKey).toBe(contexts[1].providerIdempotencyKey);
  });

  it('[EXTFX-P04] durably allocates an attempt before provider invocation', async () => {
    const h = makeHarness();
    h.adapter.publish = vi.fn(async () => {
      expect(h.row.currentAttemptId).toBeTruthy();
      expect(h.row.providerOutcome).toBe('ATTEMPT_IN_FLIGHT');
      expect(h.deliveryEvents.some((e) =>
        e.eventType === 'attempt_started' && e.attemptId === h.row.currentAttemptId,
      )).toBe(true);
      return { success: true, externalPostId: 'resend_1' };
    });

    await (h.service as any).executeDelivery(invocationRow(h.row));

    expect(h.adapter.publish).toHaveBeenCalledTimes(1);
    expect(h.row.providerOutcome).toBe('SUCCEEDED_CONFIRMED');
  });

  it('[EXTFX-P08] provider success never regresses when a local consequence fails', async () => {
    const h = makeHarness({ contentUpdateFails: true });
    await (h.service as any).executeDelivery(invocationRow(h.row));

    expect(h.adapter.publish).toHaveBeenCalledTimes(1);
    expect(h.row.status).toBe('Published');
    expect(h.row.providerOutcome).toBe('SUCCEEDED_CONFIRMED');
    expect(h.row.consequenceState).toBe('INCOMPLETE');
    expect(h.row.externalPostId).toBe('resend_1');
  });

  it('[EXTFX-P09/P10] a restarted worker repairs incomplete consequences without resending', async () => {
    const h = makeHarness({ contentUpdateFails: true });
    await (h.service as any).executeDelivery(invocationRow(h.row));
    expect(h.row.consequenceState).toBe('INCOMPLETE');
    expect(h.adapter.publish).toHaveBeenCalledTimes(1);

    h.setContentUpdateFails(false);
    const secondWorker = new DeliveryQueueService(
      { client: h.client } as any,
      { resolveEmailFor: vi.fn(() => h.adapter), resolveByPlatform: vi.fn() } as any,
      { emit: vi.fn() } as any,
    );
    await (secondWorker as any).processConsequenceRepairs();

    expect(h.row.providerOutcome).toBe('SUCCEEDED_CONFIRMED');
    expect(h.row.consequenceState).toBe('COMPLETE');
    expect(h.adapter.publish).toHaveBeenCalledTimes(1);
    expect(h.deliveryEvents.filter((e) => e.eventType === 'success')).toHaveLength(1);
  });

  it('[EXTFX-P11] unknown outcome replays only inside the 24-hour idempotency window', async () => {
    const h = makeHarness({
      publish: vi.fn(async () => ({
        success: false,
        isTransient: true,
        errorCode: 'NETWORK_UNKNOWN',
        errorMessage: 'response lost',
        outcomeCertainty: 'OUTCOME_UNKNOWN',
      })),
    });

    await (h.service as any).executeDelivery(invocationRow(h.row));
    expect(h.row.providerOutcome).toBe('OUTCOME_UNKNOWN');
    expect(h.row.status).toBe('RetryPending');
    expect(h.adapter.publish).toHaveBeenCalledTimes(1);

    h.row.status = 'Sending';
    h.row.providerFirstAttemptAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await (h.service as any).executeDelivery(invocationRow(h.row));

    expect(h.adapter.publish).toHaveBeenCalledTimes(1);
    expect(h.row.status).toBe('Failed');
    expect(h.row.providerOutcome).toBe('OUTCOME_UNKNOWN');
    expect(h.row.errorCode).toBe('PROVIDER_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED');
  });

  it('[EXTFX-P13] derivative event failure cannot regress provider/consequence truth', async () => {
    const h = makeHarness({ derivativeThrows: true });
    await (h.service as any).executeDelivery(invocationRow(h.row));

    expect(h.adapter.publish).toHaveBeenCalledTimes(1);
    expect(h.row.providerOutcome).toBe('SUCCEEDED_CONFIRMED');
    expect(h.row.consequenceState).toBe('COMPLETE');
    expect(h.row.status).toBe('Published');
  });

  it('[EXTFX-P14] blocks manual retry of a legacy ambiguous Resend failure', async () => {
    const h = makeHarness({
      delivery: baseDelivery({ status: 'Failed', retryCount: 1, providerOutcome: null }),
    });

    await expect(h.service.retry('biz_1', h.row.id)).rejects.toBeInstanceOf(BadRequestException);
    expect(h.client.outboundDelivery.update).not.toHaveBeenCalled();
  });

  it('[EXTFX-P12] tenant scope is required before manual retry can see a delivery', async () => {
    const h = makeHarness({
      delivery: baseDelivery({ status: 'Failed', providerOutcome: 'FAILED_CONFIRMED' }),
    });

    await expect(h.service.retry('biz_other', h.row.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(h.client.outboundDelivery.update).not.toHaveBeenCalled();
  });

  it('[EXTFX-P05] two claimers cannot both win the same status generation', async () => {
    const row = baseDelivery({ status: 'Queued' });
    let claimed = false;
    const makePrisma = () => ({
      client: {
        outboundDelivery: {
          findMany: vi.fn(async () => [{ id: row.id, status: 'Queued' }]),
          updateMany: vi.fn(async () => {
            if (claimed) return { count: 0 };
            claimed = true;
            return { count: 1 };
          }),
          findUnique: vi.fn(async () => ({ ...row, status: 'Sending' })),
        },
      },
    });
    const adapters = { resolveEmailFor: vi.fn(), resolveByPlatform: vi.fn() };
    const events = { emit: vi.fn() };
    const a = new DeliveryQueueService(makePrisma() as any, adapters as any, events as any);
    const b = new DeliveryQueueService(makePrisma() as any, adapters as any, events as any);

    const [one, two] = await Promise.all([
      (a as any).claimDeliveries({ status: 'Queued' }),
      (b as any).claimDeliveries({ status: 'Queued' }),
    ]);

    expect(one.length + two.length).toBe(1);
  });
});
