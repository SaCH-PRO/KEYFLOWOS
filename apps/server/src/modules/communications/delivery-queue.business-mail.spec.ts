/**
 * PR196-SYSTEM-EMAIL (owner ruling D-82): business email never relays through
 * the platform sender.
 *
 * The communications outbound queue (campaign, sequence and content email)
 * picked its email adapter from the connection: Gmail when it carried a token,
 * otherwise the RESEND adapter, which sends through SystemEmailService from the
 * platform's own address ("Keyflow <EMAIL_FROM_ADDRESS>", the sign-in sender).
 * That is the 9B-D1 sibling relay present in ours: a business with no mailbox
 * (or an expired one) sent its mail from the platform domain.
 *
 * Under D-82:
 *   - no usable Gmail: no adapter; the delivery fails visibly with
 *     EMAIL_ACCOUNT_NOT_CONNECTED and a message saying to connect Gmail; the
 *     platform sender is never called;
 *   - a connected Gmail still sends through Gmail;
 *   - a delivery bound to a platform send before D-82 whose outcome is unknown
 *     is neither replayed through the platform sender nor re-sent through Gmail
 *     (it may already have landed): it fails as reconciliation-required, and a
 *     manual retry is refused.
 *
 * The REAL AdapterRegistryService (with its real adapters) is used. The Resend
 * client is mocked at the module boundary and the platform sender is fully
 * configured, so a relay would fire if one existed; Gmail's HTTP call goes to a
 * stubbed fetch. No provider traffic.
 */
import { BadRequestException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resendSend = vi.hoisted(() => vi.fn(async () => ({ data: { id: 'platform_relay_1' }, error: null })));
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: resendSend };
  },
}));

import { DeliveryQueueService } from './delivery-queue.service';
import { AdapterRegistryService } from './adapters/adapter-registry.service';
import {
  buildResendEffectSnapshot,
  fingerprintResendEffect,
  resendProviderIdempotencyKey,
} from './adapters/resend-effect';

type Row = Record<string, any>;

const CUSTOMER = 'customer.d82@example.test';

function delivery(connection: Row | null, overrides: Row = {}): Row {
  return {
    id: 'delivery_d82',
    contentId: 'content_d82',
    variantId: null,
    destinationId: 'destination_d82',
    businessId: 'biz_d82',
    contactId: null,
    recipientEmail: CUSTOMER,
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
    destination: {
      id: 'destination_d82',
      platform: 'EMAIL',
      platformId: 'owner@business.example.test',
      displayName: 'Business',
      destinationMeta: null,
      connection,
    },
    content: {
      id: 'content_d82',
      subject: 'Our spring offer',
      body: 'Hello from the business',
      contentType: 'campaign_email',
      contentMeta: null,
      variants: [],
    },
    variant: null,
    ...overrides,
  };
}

/** A delivery bound to a platform (Resend) send before D-82, as EXTFX-001 wrote it. */
function boundToPlatformSend(connection: Row, overrides: Row = {}): Row {
  const base = delivery(connection);
  const snapshot = buildResendEffectSnapshot({
    businessId: base.businessId,
    destinationId: base.destinationId,
    connectionId: connection.id,
    from: 'Keyflow <no-reply@platform.example.test>',
    payload: { recipientEmail: CUSTOMER, subject: 'Our spring offer', textBody: 'Hello from the business' },
  });
  const fingerprint = fingerprintResendEffect(snapshot);
  return delivery(connection, {
    effectSnapshot: snapshot,
    effectFingerprint: fingerprint,
    providerIdempotencyKey: resendProviderIdempotencyKey(base.id, fingerprint),
    providerOutcome: 'OUTCOME_UNKNOWN',
    providerFirstAttemptAt: new Date(Date.now() - 5 * 60 * 1000),
    attemptSequence: 1,
    currentAttemptId: 'attempt_pre_d82',
    retryCount: 1,
    errorCode: 'STALE_ATTEMPT_OUTCOME_UNKNOWN',
    ...overrides,
  });
}

/**
 * A platform send the queue marked reconciliation-required without binding it,
 * as markResendBindingAmbiguous (LEGACY_RESEND_OUTCOME_AMBIGUOUS) leaves it:
 * providerOutcome OUTCOME_UNKNOWN, no snapshot, fingerprint or idempotency key.
 */
function legacyAmbiguous(connection: Row, overrides: Row = {}): Row {
  return delivery(connection, {
    status: 'Failed',
    retryCount: 1,
    providerOutcome: 'OUTCOME_UNKNOWN',
    errorCode: 'PROVIDER_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED',
    errorMessage: 'Resend effect binding is ambiguous: LEGACY_RESEND_OUTCOME_AMBIGUOUS',
    ...overrides,
  });
}

function harness(row: Row) {
  const events: Row[] = [];
  const apply = (data: Row) => {
    for (const [k, v] of Object.entries(data)) {
      row[k] = v && typeof v === 'object' && 'increment' in v ? (row[k] ?? 0) + Number((v as Row).increment) : v;
    }
  };
  const client = {
    outboundDelivery: {
      update: vi.fn(async ({ data }: Row) => { apply(data); return { ...row }; }),
      updateMany: vi.fn(async ({ data }: Row) => { apply(data); return { count: 1 }; }),
      findUnique: vi.fn(async () => ({ ...row })),
      findFirst: vi.fn(async ({ where }: Row) => {
        if (where.businessId && where.businessId !== row.businessId) return null;
        if (where.status && where.status !== row.status) return null;
        return { ...row };
      }),
      findMany: vi.fn(async () => [{ status: row.status }]),
    },
    deliveryEvent: {
      create: vi.fn(async ({ data }: Row) => { events.push(data); return data; }),
      findFirst: vi.fn(async () => null),
    },
    outboundContent: {
      findUnique: vi.fn(async () => ({ contentMeta: null })),
      update: vi.fn(async () => ({})),
    },
    emailCampaignContact: { updateMany: vi.fn(async () => ({ count: 1 })) },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const service = new DeliveryQueueService({ client } as any, new AdapterRegistryService(), { emit: vi.fn() } as any);
  return { service, row, events, client };
}

describe('the outbound email queue never relays business email through the platform sender (D-82)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.RESEND_API_KEY = 're_test_d82_not_a_key';
    process.env.EMAIL_FROM_ADDRESS = 'no-reply@platform.example.test';
    process.env.EMAIL_FROM_NAME = 'Keyflow';
    delete process.env.MARKETING_ESP_FALLBACK;
    resendSend.mockClear();
    fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id: 'gmail_msg_1' }), text: async () => '' }));
    vi.stubGlobal('fetch', fetchSpy);
    // retry() schedules a queue tick with setTimeout; keep it from running
    // after the test against the stand-in client.
    vi.useFakeTimers({ toFake: ['setTimeout'] });
  });

  afterEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM_ADDRESS;
    delete process.env.EMAIL_FROM_NAME;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  for (const [label, connection] of [
    ['no Gmail account connected (EMAIL connection, no token)', { id: 'connection_d82', provider: 'EMAIL', token: null, accountEmail: 'owner@business.example.test' }],
    ['a Gmail connection whose token is gone (expired or disconnected)', { id: 'connection_d82', provider: 'GOOGLE', token: null, accountEmail: 'owner@business.example.test' }],
  ] as const) {
    it(`[D-82] RED-BEFORE: ${label}: no platform send, the delivery fails visibly with EMAIL_ACCOUNT_NOT_CONNECTED`, async () => {
      const h = harness(delivery({ ...connection }));

      await (h.service as any).executeDelivery({ ...h.row });

      expect(resendSend).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(h.row.status).toBe('Failed');
      expect(h.row.errorCode).toBe('EMAIL_ACCOUNT_NOT_CONNECTED');
      expect(h.row.errorMessage).toMatch(/Gmail/);
      expect(h.row.errorMessage).toMatch(/connect/i);
      expect(h.row.errorMessage).not.toContain(CUSTOMER);
      expect(h.row.effectSnapshot).toBeNull();
      expect(h.events).toContainEqual(expect.objectContaining({ eventType: 'failure', errorCode: 'EMAIL_ACCOUNT_NOT_CONNECTED' }));
    });
  }

  it('[D-82] a connected Gmail account still sends the business email through Gmail', async () => {
    const h = harness(delivery({ id: 'connection_d82', provider: 'GOOGLE', token: 'ya29.test-token', accountEmail: 'owner@business.example.test' }));

    await (h.service as any).executeDelivery({ ...h.row });

    expect(resendSend).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain('gmail.googleapis.com');
    expect(h.row.status).toBe('Published');
    expect(h.row.externalPostId).toBe('gmail_msg_1');
  });

  it('[D-82] RED-BEFORE: a pre-D-82 platform send with an unknown outcome is not replayed through the platform sender: reconciliation required', async () => {
    const connection = { id: 'connection_d82', provider: 'EMAIL', token: null };
    const h = harness(boundToPlatformSend(connection));

    await (h.service as any).executeDelivery({ ...h.row });

    expect(resendSend).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(h.row.status).toBe('Failed');
    expect(h.row.errorCode).toBe('PROVIDER_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED');
    expect(h.row.providerOutcome).toBe('OUTCOME_UNKNOWN');
    expect(h.row.nextRetryAt).toBeNull();
  });

  it('[D-82] RED-BEFORE: a pre-D-82 platform send with an unknown outcome is not re-sent through a since-connected Gmail either (it may have landed)', async () => {
    const connection = { id: 'connection_d82', provider: 'GOOGLE', token: 'ya29.test-token' };
    const h = harness(boundToPlatformSend(connection));

    await (h.service as any).executeDelivery({ ...h.row });

    expect(resendSend).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(h.row.status).toBe('Failed');
    expect(h.row.errorCode).toBe('PROVIDER_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED');
    expect(h.row.providerOutcome).toBe('OUTCOME_UNKNOWN');
  });

  it('[D-82] a pre-D-82 platform send that is confirmed sent is not sent again through Gmail: only its local consequences are completed', async () => {
    const connection = { id: 'connection_d82', provider: 'GOOGLE', token: 'ya29.test-token' };
    const h = harness(boundToPlatformSend(connection, {
      providerOutcome: 'SUCCEEDED_CONFIRMED',
      consequenceState: 'INCOMPLETE',
      externalPostId: 'platform_relay_0',
      errorCode: null,
    }));

    await (h.service as any).executeDelivery({ ...h.row });

    expect(resendSend).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(h.row.providerOutcome).toBe('SUCCEEDED_CONFIRMED');
    expect(h.row.consequenceState).toBe('COMPLETE');
    expect(h.row.externalPostId).toBe('platform_relay_0');
  });

  it('[D-82] RED-BEFORE: manual retry of a pre-D-82 platform send with an unknown outcome is refused (400), not re-queued', async () => {
    const connection = { id: 'connection_d82', provider: 'GOOGLE', token: 'ya29.test-token' };
    const h = harness(boundToPlatformSend(connection, { status: 'Failed', errorCode: 'PROVIDER_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED' }));

    await expect(h.service.retry('biz_d82', h.row.id)).rejects.toBeInstanceOf(BadRequestException);
    expect(h.client.outboundDelivery.update).not.toHaveBeenCalled();
    expect(h.row.status).toBe('Failed');
  });

  // Review repair SE-2 / CR-SE-1: a platform send the queue marked
  // reconciliation-required WITHOUT binding it. markResendBindingAmbiguous
  // (LEGACY_RESEND_OUTCOME_AMBIGUOUS, PARTIAL_EFFECT_BINDING) writes
  // providerOutcome OUTCOME_UNKNOWN and no snapshot or idempotency key; only
  // the Resend path writes providerOutcome, so that is platform-send history
  // too. Before the repair the packet re-queued these rows (the base refused
  // them), the no-Gmail failure overwrote the reconciliation code, and a later
  // retry with Gmail connected sent the email a second time.
  for (const [label, connection] of [
    ['no Gmail', { id: 'connection_d82', provider: 'EMAIL', token: null }],
    ['Gmail connected since', { id: 'connection_d82', provider: 'GOOGLE', token: 'ya29.test-token' }],
  ] as const) {
    it(`[D-82] RED-BEFORE: ${label}: manual retry of an unbound reconciliation-required platform send is refused (400), its marker kept`, async () => {
      const h = harness(legacyAmbiguous({ ...connection }));

      await expect(h.service.retry('biz_d82', h.row.id)).rejects.toBeInstanceOf(BadRequestException);

      expect(h.client.outboundDelivery.update).not.toHaveBeenCalled();
      expect(h.row.status).toBe('Failed');
      expect(h.row.errorCode).toBe('PROVIDER_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED');
      expect(h.row.providerOutcome).toBe('OUTCOME_UNKNOWN');
    });

    it(`[D-82] RED-BEFORE: ${label}: retryAllFailed counts an unbound reconciliation-required platform send as blocked`, async () => {
      const h = harness(legacyAmbiguous({ ...connection }));
      h.client.outboundDelivery.findMany.mockImplementation(async () => [{ ...h.row }]);

      const result = await h.service.retryAllFailed('biz_d82', 'content_d82');

      expect(result).toEqual({ retried: 0, blocked: 1 });
      expect(h.client.outboundDelivery.updateMany).not.toHaveBeenCalled();
      expect(h.row.status).toBe('Failed');
      expect(h.row.errorCode).toBe('PROVIDER_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED');
    });

    it(`[D-82] RED-BEFORE: ${label}: if such a row is picked up anyway it is sent through neither sender and stays reconciliation-required`, async () => {
      const h = harness(legacyAmbiguous({ ...connection }, { status: 'Sending' }));

      await (h.service as any).executeDelivery({ ...h.row });

      expect(resendSend).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(h.row.status).toBe('Failed');
      expect(h.row.errorCode).toBe('PROVIDER_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED');
      expect(h.row.providerOutcome).toBe('OUTCOME_UNKNOWN');
    });
  }

  it('[D-82] RED-BEFORE: chain: no-Gmail retry, then Gmail connected and retried again: never re-sent', async () => {
    const h = harness(legacyAmbiguous({ id: 'connection_d82', provider: 'EMAIL', token: null }));
    await expect(h.service.retry('biz_d82', h.row.id)).rejects.toBeInstanceOf(BadRequestException);

    h.row.destination.connection = { id: 'connection_d82', provider: 'GOOGLE', token: 'ya29.test-token' };
    await expect(h.service.retry('biz_d82', h.row.id)).rejects.toBeInstanceOf(BadRequestException);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(resendSend).not.toHaveBeenCalled();
    expect(h.row.errorCode).toBe('PROVIDER_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED');
  });

  it('[D-82] a plain Gmail delivery (no platform history) that lost its token still fails as EMAIL_ACCOUNT_NOT_CONNECTED and stays retryable', async () => {
    const h = harness(delivery({ id: 'connection_d82', provider: 'GOOGLE', token: null }, { retryCount: 1 }));

    await (h.service as any).executeDelivery({ ...h.row });
    expect(h.row.status).toBe('Failed');
    expect(h.row.errorCode).toBe('EMAIL_ACCOUNT_NOT_CONNECTED');

    h.row.destination.connection = { id: 'connection_d82', provider: 'GOOGLE', token: 'ya29.test-token' };
    await h.service.retry('biz_d82', h.row.id);
    expect(h.row.status).toBe('Queued');
  });

  it('[D-82] a pre-D-82 platform send proven failed may be retried; it then goes through Gmail, never the platform sender', async () => {
    const connection = { id: 'connection_d82', provider: 'GOOGLE', token: 'ya29.test-token' };
    const h = harness(boundToPlatformSend(connection, { status: 'Failed', providerOutcome: 'FAILED_CONFIRMED', errorCode: 'validation_error' }));

    await h.service.retry('biz_d82', h.row.id);
    expect(h.row.status).toBe('Queued');

    h.row.status = 'Sending';
    await (h.service as any).executeDelivery({ ...h.row });

    expect(resendSend).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(h.row.status).toBe('Published');
  });
});
