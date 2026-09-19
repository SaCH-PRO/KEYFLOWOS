import { describe, expect, it } from 'vitest';
import {
  buildResendEffectSnapshot,
  fingerprintResendEffect,
  parseResendEffectSnapshot,
  resendProviderIdempotencyKey,
} from './resend-effect';

const base = () => buildResendEffectSnapshot({
  businessId: 'biz_1',
  destinationId: 'dest_1',
  connectionId: 'conn_1',
  from: 'Keyflow <no-reply@example.test>',
  payload: {
    recipientEmail: 'customer@example.test',
    subject: 'Subject',
    textBody: 'Body',
  },
});

describe('Resend effect identity', () => {
  it('[EXTFX-P02] identical material payload produces the same fingerprint', () => {
    expect(fingerprintResendEffect(base())).toBe(fingerprintResendEffect(base()));
  });

  it('[EXTFX-P03] material recipient/sender/subject/body changes alter the fingerprint', () => {
    const original = fingerprintResendEffect(base());
    const changedRecipient = { ...base(), to: 'other@example.test' };
    const changedSender = { ...base(), from: 'Other <other@example.test>' };
    const changedSubject = { ...base(), subject: 'Other subject' };
    const changedBody = { ...base(), text: 'Other body', html: '<pre style="font:inherit;white-space:pre-wrap">Other body</pre>' };

    for (const changed of [changedRecipient, changedSender, changedSubject, changedBody]) {
      expect(fingerprintResendEffect(changed)).not.toBe(original);
    }
  });

  it('[EXTFX-P06] the same effect/fingerprint gets the same provider key', () => {
    const fp = fingerprintResendEffect(base());
    expect(resendProviderIdempotencyKey('delivery_1', fp))
      .toBe(resendProviderIdempotencyKey('delivery_1', fp));
  });

  it('[EXTFX-P07] a different effect id gets a different provider key', () => {
    const fp = fingerprintResendEffect(base());
    expect(resendProviderIdempotencyKey('delivery_1', fp))
      .not.toBe(resendProviderIdempotencyKey('delivery_2', fp));
  });

  it('rejects malformed stored snapshots rather than falling back to mutable payload', () => {
    expect(() => parseResendEffectSnapshot({ provider: 'RESEND' })).toThrow('Invalid Resend effect snapshot');
  });
});
