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
import { AdapterRegistryService } from './adapter-registry.service';
import { ResendEmailAdapter } from './resend-email-adapter';

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
    const a = registry().resolveEmailFor(null);
    expect(a?.provider).toBe('RESEND');
  });

  it('a connection with no token falls back too — an expired account is not a usable one', () => {
    const a = registry().resolveEmailFor({ provider: 'GOOGLE', token: null });
    expect(a?.provider).toBe('RESEND');
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
});
