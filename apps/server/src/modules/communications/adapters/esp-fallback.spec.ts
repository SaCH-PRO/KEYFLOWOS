/**
 * Sending marketing email without a connected Gmail account.
 *
 * EmailAdapter is Gmail: `provider = 'GOOGLE'`, and it needs an OAuth token on
 * the connection. The registry mapped EMAIL straight onto it, so a business
 * that never connected Gmail had no way to send campaign or sequence email at
 * all — the CRM sequence dispatch added earlier today correctly refused every
 * step with "no active email channel is connected".
 *
 * Resend was already in the stack sending this product's transactional mail.
 * It simply was not reachable from the outbound queue.
 *
 * The choice is made on the CONNECTION rather than the platform, because a
 * business can have an EMAIL destination whose token has expired — failing
 * that with MISSING_CREDENTIALS while a working fallback sits unused is the
 * same "correct in isolation" failure this codebase keeps producing.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { AdapterRegistryService } from './adapter-registry.service';
import { ResendEmailAdapter } from './resend-email-adapter';
import { SystemEmailSendError, SystemEmailService } from '../../notifications/system-email.service';
import { AiMessageSenderService } from '../../ai/ai-message-sender.service';

const registry = () => new AdapterRegistryService();

afterEach(() => {
  delete process.env.MARKETING_ESP_FALLBACK;
});

describe('which adapter sends an email', () => {
  it('a connected Gmail account still sends through Gmail', () => {
    const a = registry().resolveEmailFor({ provider: 'GOOGLE', token: 'ya29.token' });
    expect(a?.provider).toBe('GOOGLE');
  });

  // D-82 (2026-11-09) reverses the two cases below. They read "falls back to
  // the platform ESP": business email now never relays through the platform
  // sender, so a business with no usable Gmail gets no adapter and its delivery
  // fails visibly (delivery-queue.business-mail.spec.ts).
  it('[D-82] RED-BEFORE: no connected account does not fall back to the platform sender: no adapter', () => {
    const a = registry().resolveEmailFor(null);
    expect(a).toBeNull();
  });

  it('[D-82] RED-BEFORE: a connection with no token (expired or disconnected) does not fall back either: no adapter', () => {
    const a = registry().resolveEmailFor({ provider: 'GOOGLE', token: null });
    expect(a).toBeNull();
  });

  it('non-email platforms are untouched', () => {
    const r = registry();
    expect(r.resolveByPlatform('WHATSAPP')?.provider).toBe('WHATSAPP');
    expect(r.resolveByPlatform('INSTAGRAM_BUSINESS')?.provider).toBe('META');
  });
});

describe('the fallback can be turned off', () => {
  it('is on when the flag is unset', () => {
    expect(ResendEmailAdapter.isEnabled()).toBe(true);
  });

  it('is off for off / false / 0', () => {
    for (const v of ['off', 'false', '0', 'OFF']) {
      process.env.MARKETING_ESP_FALLBACK = v;
      expect(ResendEmailAdapter.isEnabled(), v).toBe(false);
    }
  });

  it('refuses to send rather than silently doing nothing when disabled', async () => {
    process.env.MARKETING_ESP_FALLBACK = 'off';
    const adapter = new ResendEmailAdapter({ sendTransactional: vi.fn() } as never);
    const res = await adapter.publish(null, { platformId: 'a@b.test' }, { subject: 'x', textBody: 'y' });
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('ESP_FALLBACK_DISABLED');
  });
});

describe('the fallback adapter sends', () => {
  it('passes the recipient, subject and body through', async () => {
    const sendTransactional = vi.fn(async () => ({ id: 'msg_1' }));
    const adapter = new ResendEmailAdapter({ sendTransactional } as never);

    const res = await adapter.publish(null, { platformId: null }, {
      recipientEmail: 'customer@example.test',
      subject: 'Following up',
      textBody: 'Just checking in.',
    });

    expect(res.success).toBe(true);
    expect(res.externalPostId).toBe('msg_1');
    expect(sendTransactional).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'customer@example.test', subject: 'Following up' }),
    );
  });

  it('does not render a text body as raw markup', async () => {
    // The queue stores text. Passing it as html would show tags literally.
    const sendTransactional = vi.fn(async () => ({ id: 'm' }));
    const adapter = new ResendEmailAdapter({ sendTransactional } as never);
    await adapter.publish(null, {}, { recipientEmail: 'a@b.test', textBody: '5 < 6 & <b>bold</b>' });

    const html = sendTransactional.mock.calls[0][0].html as string;
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('<b>bold</b>');
  });

  it('refuses with no recipient rather than throwing', async () => {
    const adapter = new ResendEmailAdapter({ sendTransactional: vi.fn() } as never);
    const res = await adapter.publish(null, {}, { subject: 'x' });
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('MISSING_RECIPIENT');
  });

  it('treats "not configured" as permanent, not transient', () => {
    // Retrying a deployment state burns the delivery's retries against
    // something only a human can change.
    const adapter = new ResendEmailAdapter({ sendTransactional: vi.fn() } as never);
    const n = adapter.normalizeError(new Error('System email sender is not configured.'));
    expect(n.isTransient).toBe(false);
    expect(n.code).toBe('ESP_NOT_CONFIGURED');
  });

  it('treats rate limits as transient, so they retry', () => {
    const adapter = new ResendEmailAdapter({ sendTransactional: vi.fn() } as never);
    expect(adapter.normalizeError(new Error('rate limit exceeded')).isTransient).toBe(true);
  });

  it('passes a bound snapshot and stable idempotency key to SystemEmailService', async () => {
    const sendTransactional = vi.fn(async () => ({ id: 'msg_bound' }));
    const adapter = new ResendEmailAdapter({ sendTransactional } as never);

    const res = await adapter.publish(
      null,
      { platformId: 'mutable@example.test' },
      { recipientEmail: 'mutable@example.test', subject: 'mutable', textBody: 'mutable' },
      {
        effectId: 'delivery_1',
        attemptId: 'attempt_1',
        effectFingerprint: 'abc123',
        providerIdempotencyKey: 'keyflow/resend/delivery_1/abc123',
        providerPayloadSnapshot: {
          version: 1,
          provider: 'RESEND',
          businessId: 'biz_1',
          destinationId: 'dest_1',
          connectionId: 'conn_1',
          to: 'bound@example.test',
          from: 'Keyflow <no-reply@example.test>',
          subject: 'Bound subject',
          html: '<p>Bound</p>',
          text: 'Bound',
        },
      },
    );

    expect(res).toEqual(expect.objectContaining({ success: true, externalPostId: 'msg_bound' }));
    expect(sendTransactional).toHaveBeenCalledWith({
      to: 'bound@example.test',
      from: 'Keyflow <no-reply@example.test>',
      subject: 'Bound subject',
      html: '<p>Bound</p>',
      text: 'Bound',
      idempotencyKey: 'keyflow/resend/delivery_1/abc123',
    });
  });

  it('treats a concurrent idempotency collision as retryable without changing effect identity', () => {
    const adapter = new ResendEmailAdapter({ sendTransactional: vi.fn() } as never);
    const normalized = adapter.normalizeError(
      new SystemEmailSendError(
        'Concurrent request with the same idempotency key',
        'FAILED_CONFIRMED',
        'concurrent_idempotent_requests',
      ),
    );
    expect(normalized.isTransient).toBe(true);
    expect(normalized.code).toBe('concurrent_idempotent_requests');
  });

  it('treats provider success without a message id as OUTCOME_UNKNOWN', async () => {
    const adapter = new ResendEmailAdapter({
      sendTransactional: vi.fn(async () => ({ id: '' })),
    } as never);
    const result = await adapter.publish(
      null,
      {},
      { recipientEmail: 'a@b.test', subject: 'x', textBody: 'y' },
    );
    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('MISSING_PROVIDER_ID');
    expect(result.outcomeCertainty).toBe('OUTCOME_UNKNOWN');
  });

  it('marks a transport exception from SystemEmailService as OUTCOME_UNKNOWN', async () => {
    const sendTransactional = vi.fn(async () => {
      throw new SystemEmailSendError('socket closed after request', 'OUTCOME_UNKNOWN');
    });
    const adapter = new ResendEmailAdapter({ sendTransactional } as never);
    const result = await adapter.publish(
      null,
      {},
      { recipientEmail: 'a@b.test', subject: 'x', textBody: 'y' },
    );
    expect(result.success).toBe(false);
    expect(result.outcomeCertainty).toBe('OUTCOME_UNKNOWN');
    expect(result.isTransient).toBe(true);
  });
});

describe('D-82: business email never relays through the platform sender', () => {
  it('[D-82] RED-BEFORE: the registry never hands out the platform sender for business email, whatever the connection', () => {
    const r = registry();
    const connections = [
      null,
      undefined,
      {},
      { provider: 'GOOGLE', token: null },
      { provider: 'GOOGLE', token: '' },
      { provider: 'EMAIL', token: null },
      { provider: 'RESEND', token: 're_live_looking_token' },
      { provider: 'SMTP', token: 'smtp-token' },
      { provider: 'WHATSAPP', token: 'wa-token' },
    ];
    for (const c of connections) {
      expect(r.resolveEmailFor(c as never)?.provider, JSON.stringify(c)).not.toBe('RESEND');
    }
    expect(r.resolve('RESEND')).toBeNull();
    expect(r.listProviders()).not.toContain('RESEND');
    for (const platform of ['EMAIL', 'GOOGLE', 'RESEND', 'FACEBOOK', 'INSTAGRAM_BUSINESS', 'WHATSAPP']) {
      expect(r.resolveByPlatform(platform)?.provider, platform).not.toBe('RESEND');
    }
  });

  it('[D-82] a usable Gmail connection (GOOGLE or EMAIL provider with a token) still resolves to Gmail', () => {
    const r = registry();
    expect(r.resolveEmailFor({ provider: 'GOOGLE', token: 'ya29.token' })?.provider).toBe('GOOGLE');
    expect(r.resolveEmailFor({ provider: 'EMAIL', token: 'ya29.token' })?.provider).toBe('GOOGLE');
  });

  // Review repair SE-1: the AI message sender (the 1:1 email path behind
  // communications drafts/:id/send, the intake send_reply action and
  // CommunicationsService.sendMessage) fell back to
  // SystemEmailService.sendTransactional, the platform sender, when Gmail
  // failed. It no longer does; the full cases are in
  // apps/server/src/modules/ai/ai-message-sender.service.spec.ts.
  it('[D-82] RED-BEFORE: AiMessageSenderService email to a contact fails visibly without Gmail instead of relaying through SystemEmailService', async () => {
    const platformSend = vi.spyOn(SystemEmailService.prototype, 'sendTransactional').mockResolvedValue({ id: 'platform_relay_1' });
    const gmail = {
      sendEmail: vi.fn(async () => {
        throw new ServiceUnavailableException({ code: 'provider_not_configured', service: 'gmail', message: 'Gmail not connected' });
      }),
    };
    const client = {
      contact: { findFirst: vi.fn(async () => ({ id: 'c1', email: 'customer@example.test', firstName: null, lastName: null, phone: null, whatsappNumber: null, preferredChannel: null })) },
    };
    const sender = new AiMessageSenderService(
      { client } as never,
      { emit: vi.fn() } as never,
      gmail as never,
      undefined,
      { recordContactEvent: vi.fn(async () => undefined) } as never,
    );
    try {
      const result = await sender.sendMessage({ businessId: 'biz_a', contactId: 'c1', channel: 'email', body: 'Hello' });
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('EMAIL_ACCOUNT_NOT_CONNECTED');
      expect(platformSend).not.toHaveBeenCalled();
    } finally {
      platformSend.mockRestore();
    }
  });
});
