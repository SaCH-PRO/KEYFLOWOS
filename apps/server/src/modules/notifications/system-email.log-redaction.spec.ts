/**
 * PR196-SYSTEM-EMAIL (9B-D2, present in ours): SystemEmailService is the sink
 * every platform send goes through (sign-up verification, password reset,
 * receipts and alerts the platform owns), and sendTransactional logged the
 * recipient address on every outcome:
 *
 *   success          `Sent transactional email to <to> (id=...)`
 *   confirmed fail   `Resend send failed for <to>: ...`
 *   outcome unknown  `Resend send outcome unknown for <to>: ...`
 *
 * main.ts creates the app with no `logger` option, so Nest's default
 * ConsoleLogger prints every level: each line put a customer's or user's email
 * in the logs, which IA-044 / CF-029 (log_secret_pii_redaction) forbid. The fix
 * is at the sink, so every caller is covered. The logs keep what an operator
 * needs (the outcome, the provider id or error code) without the address, and a
 * provider error text that quotes the address is redacted before it is logged.
 *
 * The mail itself still goes to the recipient: only the logs change. No
 * provider traffic: the Resend client is a stand-in set on the service.
 */
import { ConsoleLogger, Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SystemEmailService } from './system-email.service';

const RECIPIENT = 'customer.d82@example.test';

type SendPayload = Record<string, unknown>;

function serviceWith(send: (payload: SendPayload) => Promise<unknown>) {
  const calls: SendPayload[] = [];
  const service = new SystemEmailService();
  Reflect.set(service, 'resend', {
    emails: {
      send: async (payload: SendPayload) => {
        calls.push(payload);
        return send(payload);
      },
    },
  });
  return { service, calls };
}

describe('SystemEmailService.sendTransactional logs no recipient address (9B-D2, D-82)', () => {
  const entries: string[] = [];

  beforeEach(() => {
    process.env.RESEND_API_KEY = 're_test_d82_not_a_key';
    process.env.EMAIL_FROM_ADDRESS = 'no-reply@platform.example.test';
    entries.length = 0;
    const record = (...args: unknown[]) => {
      entries.push(args.map((a) => (typeof a === 'string' ? a : a instanceof Error ? `${a.message} ${a.stack ?? ''}` : JSON.stringify(a))).join(' '));
    };
    for (const level of ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation(record as never);
      vi.spyOn(Logger, level).mockImplementation(record as never);
      vi.spyOn(ConsoleLogger.prototype, level).mockImplementation(record as never);
    }
    for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
      vi.spyOn(console, level).mockImplementation(record as never);
    }
  });

  afterEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM_ADDRESS;
    vi.restoreAllMocks();
  });

  function expectNoAddressLogged() {
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry).not.toContain(RECIPIENT);
      expect(entry).not.toContain('customer.d82');
    }
  }

  it('[9B-D2] RED-BEFORE: an accepted send logs its outcome and provider id, not the recipient', async () => {
    const { service } = serviceWith(async () => ({ data: { id: 'resend_ok_1' }, error: null }));

    await expect(service.sendTransactional({ to: RECIPIENT, subject: 'Verify your email', html: '<p>Hi</p>' }))
      .resolves.toEqual({ id: 'resend_ok_1' });

    expectNoAddressLogged();
    expect(entries.some((e) => e.includes('resend_ok_1'))).toBe(true);
  });

  it('[9B-D2] RED-BEFORE: a confirmed provider rejection logs no recipient, even when the provider text quotes it', async () => {
    const { service } = serviceWith(async () => ({
      data: null,
      error: { name: 'validation_error', message: `"${RECIPIENT}" is on the suppression list` },
    }));

    await expect(service.sendTransactional({ to: RECIPIENT, subject: 'Your receipt', html: '<p>Receipt</p>' }))
      .rejects.toMatchObject({ name: 'SystemEmailSendError', outcome: 'FAILED_CONFIRMED', providerCode: 'validation_error' });

    expectNoAddressLogged();
    expect(entries.some((e) => e.includes('validation_error'))).toBe(true);
  });

  it('[9B-D2] RED-BEFORE: an unknown outcome (lost response) logs no recipient, even when the transport error quotes it', async () => {
    const { service } = serviceWith(async () => {
      throw new Error(`socket hang up while sending to ${RECIPIENT}`);
    });

    await expect(service.sendTransactional({ to: RECIPIENT, subject: 'Reset your password', html: '<p>Reset</p>' }))
      .rejects.toMatchObject({ name: 'SystemEmailSendError', outcome: 'OUTCOME_UNKNOWN' });

    expectNoAddressLogged();
  });

  it('[D-82] platform transactional mail still sends: the payload goes to the recipient from the platform sender', async () => {
    const { service, calls } = serviceWith(async () => ({ data: { id: 'resend_ok_2' }, error: null }));

    await service.sendTransactional({ to: RECIPIENT, subject: 'Verify your email', html: '<p>Hi</p>', text: 'Hi' });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      to: RECIPIENT,
      from: 'Keyflow <no-reply@platform.example.test>',
      subject: 'Verify your email',
      html: '<p>Hi</p>',
    });
  });
});
