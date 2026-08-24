/**
 * Token refresh, which was the last auth flow still going browser-to-Supabase.
 *
 * Moving it server-side is worth less than moving recovery was — refresh trades
 * a token rather than changing a credential — so the tests here are narrow and
 * about the two things that are easy to get wrong and expensive when wrong.
 *
 * ROTATION. Supabase issues a NEW refresh token on every use. A caller that
 * keeps the old one is holding a spent credential, and its next refresh fails
 * looking like an expiry rather than a bug — an intermittent, unreproducible
 * logout. When Supabase omits the new token, the presented one must be echoed
 * back rather than `undefined` reaching the client's storage.
 *
 * UNIFORM FAILURE. Expired, already-rotated, revoked by a logout, or never
 * valid: the caller does the same thing in all four cases (sign in again), and
 * distinguishing them would tell whoever holds a stolen token which kind it is.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { IdentitySignupService } from './identity-signup.service';

function build() {
  return new IdentitySignupService({} as never, {} as never, {} as never);
}

const OLD = 'refresh-token-old';

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })),
  );
}

describe('refreshSession', () => {
  it('returns the rotated refresh token, not the one it was given', async () => {
    stubFetch(200, { access_token: 'new-access', refresh_token: 'refresh-token-new' });

    const out = await build().refreshSession(OLD);

    expect(out.accessToken).toBe('new-access');
    // The whole reason the client must store what comes back.
    expect(out.refreshToken).toBe('refresh-token-new');
  });

  it('echoes the presented token when Supabase does not rotate', async () => {
    // Supabase has a short reuse window in which it may not issue a new token.
    // Returning undefined here would have the client persist `undefined` and
    // sign the user out on the next attempt.
    stubFetch(200, { access_token: 'new-access' });

    const out = await build().refreshSession(OLD);

    expect(out.refreshToken).toBe(OLD);
  });

  it('rejects every failure mode with one indistinguishable error', async () => {
    for (const body of [
      { error: 'invalid_grant', error_description: 'Invalid Refresh Token' },
      { msg: 'Token expired' },
      {},
    ]) {
      stubFetch(400, body);
      await expect(build().refreshSession(OLD)).rejects.toBeInstanceOf(UnauthorizedException);
    }
  });

  it('treats a 200 with no access token as a failure', async () => {
    // Trusting res.ok alone would hand the client `accessToken: undefined` and
    // present it as a successful refresh.
    stubFetch(200, { refresh_token: 'only-this' });
    await expect(build().refreshSession(OLD)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('surfaces an unreachable auth service as retryable, not as expiry', async () => {
    // A network failure means "try again", not "your session ended". Telling a
    // signed-in user to sign in again because of a blip is a bad trade.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    await expect(build().refreshSession(OLD)).rejects.toBeInstanceOf(BadRequestException);
  });
});
