import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  effectFingerprint,
  isInsideResendIdempotencyWindow,
  resendIdempotencyKey,
  RESEND_IDEMPOTENCY_WINDOW_MS,
} from './effect-certainty';

const material = {
  provider: 'RESEND',
  recipient: 'customer@example.test',
  sender: 'Keyflow <no-reply@keyflow.test>',
  subject: 'Hello',
  html: '<p>Hello</p>',
  text: 'Hello',
};

describe('outbound delivery effect certainty helpers', () => {
  it('[EXTFX-P02] canonicalization is key-order stable', () => {
    expect(canonicalJson({ b: 2, a: { z: 1, y: 2 } }))
      .toBe(canonicalJson({ a: { y: 2, z: 1 }, b: 2 }));
  });

  it('[EXTFX-P02] same provider material has the same fingerprint', () => {
    expect(effectFingerprint(material)).toBe(effectFingerprint({ ...material }));
  });

  it('[EXTFX-P03] material recipient/subject/body/sender changes alter the fingerprint', () => {
    const base = effectFingerprint(material);
    expect(effectFingerprint({ ...material, recipient: 'other@example.test' })).not.toBe(base);
    expect(effectFingerprint({ ...material, subject: 'Other' })).not.toBe(base);
    expect(effectFingerprint({ ...material, html: '<p>Other</p>' })).not.toBe(base);
    expect(effectFingerprint({ ...material, sender: 'Other <other@keyflow.test>' })).not.toBe(base);
  });

  it('[EXTFX-P06] same effect and fingerprint produce the same provider key', () => {
    const fp = effectFingerprint(material);
    expect(resendIdempotencyKey('delivery_1', fp)).toBe(resendIdempotencyKey('delivery_1', fp));
  });

  it('[EXTFX-P07] a different effect produces a different provider key', () => {
    const fp = effectFingerprint(material);
    expect(resendIdempotencyKey('delivery_1', fp)).not.toBe(resendIdempotencyKey('delivery_2', fp));
  });

  it('keeps Resend idempotency keys below the provider 256-character limit', () => {
    const key = resendIdempotencyKey('x'.repeat(400), effectFingerprint(material));
    expect(key.length).toBeLessThanOrEqual(256);
  });

  it('recognizes the verified 24-hour Resend replay window', () => {
    const now = new Date('2026-09-18T12:00:00Z');
    expect(isInsideResendIdempotencyWindow(new Date(now.getTime() - RESEND_IDEMPOTENCY_WINDOW_MS + 1), now)).toBe(true);
    expect(isInsideResendIdempotencyWindow(new Date(now.getTime() - RESEND_IDEMPOTENCY_WINDOW_MS), now)).toBe(false);
  });
});
