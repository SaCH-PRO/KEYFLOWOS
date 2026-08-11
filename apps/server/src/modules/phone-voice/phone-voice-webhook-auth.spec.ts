/**
 * The inbound voice webhook refuses what it cannot verify.
 *
 * WHAT THIS WAS, AND WHY IT LOOKED FINE. The route called
 * `assertValidTwilioSignature(req)` on its first line, so in review it read as
 * protected. The verifier's first two lines were:
 *
 *     const token = process.env.TWILIO_AUTH_TOKEN;
 *     if (!token) return; // dev convenience; production must configure the token
 *
 * and nothing enforced the comment. Measured 2026-08-10 against the live
 * server: `.env.production` carried no TWILIO_* variables at all, so the check
 * returned immediately and `POST /cortex/phone/inbound?businessId=<anything>`
 * accepted an attacker-supplied tenant id and answered with TwiML carrying the
 * voice-bridge WebSocket URL for that business.
 *
 * An unconfigured verifier that accepts everything is worse than no endpoint:
 * the absence of a check is visible, and a check that silently opts out is not.
 * Same shape as the CI gate in scripts/deploy.sh, fixed the same way — fail
 * closed, with an escape hatch that has to be typed on purpose.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PhoneVoiceController } from './phone-voice.controller';

type Res = { type: (t: string) => Res; send: (b: string) => void };

function makeRes(): Res & { sent: string | null } {
  const r: any = { sent: null };
  r.type = () => r;
  r.send = (b: string) => {
    r.sent = b;
  };
  return r;
}

const req = () =>
  ({ headers: {}, originalUrl: '/api/v1/cortex/phone/inbound?businessId=biz_x', body: {} }) as never;

describe('inbound voice webhook authentication', () => {
  const saved = { ...process.env };
  let ctrl: PhoneVoiceController;

  beforeEach(() => {
    ctrl = new PhoneVoiceController();
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.PHONE_VOICE_ALLOW_UNVERIFIED;
  });

  afterEach(() => {
    process.env = { ...saved };
    vi.restoreAllMocks();
  });

  it('refuses when TWILIO_AUTH_TOKEN is not configured — the live production case', () => {
    const res = makeRes();
    expect(() => ctrl.inbound('biz_x', req(), res as never)).toThrow(/not configured/i);
    expect(res.sent, 'no TwiML may be emitted to an unverified caller').toBeNull();
  });

  it('does not leak the voice-bridge URL for an arbitrary businessId', () => {
    // The specific harm. businessId comes straight off the query string, and
    // the response body is a stream URL scoped to it.
    const res = makeRes();
    expect(() => ctrl.inbound('someone-elses-business', req(), res as never)).toThrow();
    expect(res.sent).toBeNull();
  });

  it('still rejects a bad signature when the token IS configured', () => {
    process.env.TWILIO_AUTH_TOKEN = 'test-token';
    const res = makeRes();
    // No x-twilio-signature header, so validateRequest fails.
    expect(() => ctrl.inbound('biz_x', req(), res as never)).toThrow(/signature/i);
    expect(res.sent).toBeNull();
  });

  it('the escape hatch works, and only when set to exactly 1', () => {
    process.env.PHONE_VOICE_ALLOW_UNVERIFIED = '1';
    const res = makeRes();
    ctrl.inbound('biz_x', req(), res as never);
    expect(res.sent, 'the documented dev bypass must still function').toMatch(/<Stream url="ws/);

    // Anything else is not an opt-out. A bypass that triggers on 'true',
    // 'yes' or '0' is one someone enables by accident.
    for (const v of ['true', 'yes', '0', '']) {
      process.env.PHONE_VOICE_ALLOW_UNVERIFIED = v;
      const r2 = makeRes();
      expect(
        () => ctrl.inbound('biz_x', req(), r2 as never),
        `PHONE_VOICE_ALLOW_UNVERIFIED=${JSON.stringify(v)} must not open the gate`,
      ).toThrow();
    }
  });

  it('missing businessId is still rejected before anything else', () => {
    const res = makeRes();
    expect(() => ctrl.inbound('', req(), res as never)).toThrow(/businessId/i);
  });
});
