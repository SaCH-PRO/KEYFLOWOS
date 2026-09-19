import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemEmailSendError, SystemEmailService } from './system-email.service';

type SendPayload = Record<string, unknown>;
type SendOptions = { idempotencyKey?: string };

class DeterministicResendSimulator {
  private readonly accepted = new Map<string, { canonical: string; id: string }>();
  private sequence = 0;
  mode: 'accept' | 'reject' | 'lose-response' = 'accept';

  readonly emails = {
    send: async (payload: SendPayload, options?: SendOptions) => {
      const key = options?.idempotencyKey;

      if (this.mode === 'reject') {
        return {
          data: null,
          error: { name: 'validation_error', message: 'rejected before effect' },
        };
      }

      const canonical = JSON.stringify(payload);
      if (key) {
        const prior = this.accepted.get(key);
        if (prior) {
          if (prior.canonical !== canonical) {
            return {
              data: null,
              error: {
                name: 'idempotency_key_in_use',
                message: 'same idempotency key used with different payload',
              },
            };
          }
          return { data: { id: prior.id }, error: null };
        }
      }

      const id = `sim_${++this.sequence}`;
      if (key) this.accepted.set(key, { canonical, id });

      if (this.mode === 'lose-response') {
        throw new Error('socket closed after provider accepted request');
      }
      return { data: { id }, error: null };
    },
  };
}

function serviceWith(simulator: DeterministicResendSimulator): SystemEmailService {
  const service = new SystemEmailService();
  Reflect.set(service, 'resend', simulator);
  return service;
}

const base = {
  to: 'customer@example.test',
  from: 'Keyflow <no-reply@example.test>',
  subject: 'Bound subject',
  html: '<p>Bound</p>',
  text: 'Bound',
};

describe('EXTFX deterministic Resend provider simulator', () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = 'test-key';
    process.env.EMAIL_FROM_ADDRESS = 'no-reply@example.test';
    process.env.EMAIL_FROM_NAME = 'Keyflow';
  });

  afterEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM_ADDRESS;
    delete process.env.EMAIL_FROM_NAME;
  });

  it('accept + id returns the provider object id', async () => {
    const simulator = new DeterministicResendSimulator();
    const service = serviceWith(simulator);

    await expect(service.sendTransactional({
      ...base,
      idempotencyKey: 'keyflow/resend/delivery_1/fp_1',
    })).resolves.toEqual({ id: 'sim_1' });
  });

  it('reject before effect is FAILED_CONFIRMED', async () => {
    const simulator = new DeterministicResendSimulator();
    simulator.mode = 'reject';
    const service = serviceWith(simulator);

    await expect(service.sendTransactional({
      ...base,
      idempotencyKey: 'keyflow/resend/delivery_1/fp_1',
    })).rejects.toMatchObject({
      name: 'SystemEmailSendError',
      outcome: 'FAILED_CONFIRMED',
      providerCode: 'validation_error',
    });
  });

  it('accept but response lost is OUTCOME_UNKNOWN', async () => {
    const simulator = new DeterministicResendSimulator();
    simulator.mode = 'lose-response';
    const service = serviceWith(simulator);

    await expect(service.sendTransactional({
      ...base,
      idempotencyKey: 'keyflow/resend/delivery_1/fp_1',
    })).rejects.toMatchObject({
      name: 'SystemEmailSendError',
      outcome: 'OUTCOME_UNKNOWN',
    });
  });

  it('same key + same payload returns the same provider object', async () => {
    const simulator = new DeterministicResendSimulator();
    const service = serviceWith(simulator);
    const args = { ...base, idempotencyKey: 'keyflow/resend/delivery_1/fp_1' };

    const first = await service.sendTransactional(args);
    const second = await service.sendTransactional(args);

    expect(first).toEqual({ id: 'sim_1' });
    expect(second).toEqual(first);
  });

  it('same key + different payload is a confirmed provider conflict', async () => {
    const simulator = new DeterministicResendSimulator();
    const service = serviceWith(simulator);
    const key = 'keyflow/resend/delivery_1/fp_1';

    await service.sendTransactional({ ...base, idempotencyKey: key });
    await expect(service.sendTransactional({
      ...base,
      subject: 'Changed subject',
      idempotencyKey: key,
    })).rejects.toMatchObject({
      name: 'SystemEmailSendError',
      outcome: 'FAILED_CONFIRMED',
      providerCode: 'idempotency_key_in_use',
    });
  });

  it('[EXTFX-P16] preserves the historical one-argument Resend call when no idempotency key is supplied', async () => {
    const calls: Array<{ payload: SendPayload; options?: SendOptions }> = [];
    const fake = {
      emails: {
        send: async (payload: SendPayload, options?: SendOptions) => {
          calls.push({ payload, options });
          return { data: { id: 'legacy_1' }, error: null };
        },
      },
    };
    const service = new SystemEmailService();
    Reflect.set(service, 'resend', fake);

    await expect(service.sendTransactional({
      to: base.to,
      subject: base.subject,
      html: base.html,
      text: base.text,
    })).resolves.toEqual({ id: 'legacy_1' });

    expect(calls).toHaveLength(1);
    expect(calls[0].options).toBeUndefined();
    expect(calls[0].payload).toMatchObject({
      from: base.from,
      to: base.to,
      subject: base.subject,
      html: base.html,
    });
  });
});
