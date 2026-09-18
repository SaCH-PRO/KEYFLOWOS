import { describe, it, expect, vi, afterEach } from 'vitest';
import { AdapterRegistryService } from './adapter-registry.service';
import { ResendEmailAdapter } from './resend-email-adapter';
import { SystemEmailSendError } from '../../notifications/system-email.service';

const registry = () => new AdapterRegistryService();

afterEach(() => {
  delete process.env.MARKETING_ESP_FALLBACK;
});

describe('which adapter sends an email', () => {
  it('a connected Gmail account still sends through Gmail', () => {
    const a = registry().resolveEmailFor({ provider: 'GOOGLE', token: 'ya29.token' });
    expect(a?.provider).toBe('GOOGLE');
  });

  it('no connected account falls back to the platform ESP', () => {
    expect(registry().resolveEmailFor(null)?.provider).toBe('RESEND');
  });

  it('a connection with no token falls back too', () => {
    expect(registry().resolveEmailFor({ provider: 'GOOGLE', token: null })?.provider).toBe('RESEND');
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

  it('refuses to send when disabled', async () => {
    process.env.MARKETING_ESP_FALLBACK = 'off';
    const adapter = new ResendEmailAdapter({ sendTransactional: vi.fn() } as never);
    const res = await adapter.publish(null, { platformId: 'a@b.test' }, { subject: 'x', textBody: 'y' });
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('ESP_FALLBACK_DISABLED');
    expect(res.outcomeCertainty).toBe('FAILED_CONFIRMED');
  });
});

describe('the fallback adapter sends', () => {
  it('passes recipient, subject and body through on the legacy path', async () => {
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

  it('uses immutable effect material and the stable provider idempotency key when supplied', async () => {
    const sendTransactional = vi.fn(async () => ({ id: 'msg_2' }));
    const adapter = new ResendEmailAdapter({ sendTransactional } as never);

    const res = await adapter.publish(
      null,
      {},
      { recipientEmail: 'mutable@example.test', subject: 'Mutable', textBody: 'Mutable' },
      {
        effectId: 'delivery_1',
        attemptId: 'delivery_1:1',
        effectFingerprint: 'abc',
        providerIdempotencyKey: 'keyflow/outbound-delivery/delivery_1/abc',
        material: {
          provider: 'RESEND',
          recipient: 'bound@example.test',
          sender: 'Keyflow <no-reply@keyflow.test>',
          subject: 'Bound',
          html: '<p>Bound</p>',
          text: 'Bound',
        },
      },
    );

    expect(res.success).toBe(true);
    expect(sendTransactional).toHaveBeenCalledWith({
      to: 'bound@example.test',
      from: 'Keyflow <no-reply@keyflow.test>',
      subject: 'Bound',
      html: '<p>Bound</p>',
      text: 'Bound',
      idempotencyKey: 'keyflow/outbound-delivery/delivery_1/abc',
    });
  });

  it('does not render a text body as raw markup', async () => {
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
    expect(res.errorCode).toBe('EMAIL_ERROR');
    expect(res.outcomeCertainty).toBe('FAILED_CONFIRMED');
  });

  it('classifies an ambiguous network/provider exception as outcome unknown', () => {
    const adapter = new ResendEmailAdapter({ sendTransactional: vi.fn() } as never);
    const n = adapter.normalizeError(new SystemEmailSendError('socket closed', 'OUTCOME_UNKNOWN'));
    expect(n.outcomeCertainty).toBe('OUTCOME_UNKNOWN');
    expect(n.isTransient).toBe(true);
  });

  it('treats rate limits as transient confirmed failures', () => {
    const adapter = new ResendEmailAdapter({ sendTransactional: vi.fn() } as never);
    const n = adapter.normalizeError(new Error('rate limit exceeded'));
    expect(n.isTransient).toBe(true);
    expect(n.outcomeCertainty).toBe('FAILED_CONFIRMED');
  });
});
