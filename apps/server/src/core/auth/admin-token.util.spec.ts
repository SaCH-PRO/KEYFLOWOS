/**
 * Admin token expiry.
 *
 * This exists because a code audit reported `payload.exp < Date.now()` as a
 * critical bug on the assumption that `exp` follows the JWT seconds convention,
 * and recommended dividing by 1000. It does not: buildAdminToken sets
 * `exp = Date.now() + 24h`, in MILLISECONDS. Applying that recommendation makes
 * exp (~1.7e12) always exceed now/1000 (~1.7e9), so expiry never fires and every
 * admin token becomes valid forever.
 *
 * These tests pin the units so the "fix" cannot be reapplied silently.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildAdminToken, verifyAdminToken } from './admin-token.util';

const SECRET = 'test-secret-value-for-admin-token-specs';

// verifyAdminToken reads the secret from ADMIN_JWT_SECRET; its second parameter
// is an optional Redis client, not the secret.
let priorSecret: string | undefined;
beforeAll(() => {
  priorSecret = process.env.ADMIN_JWT_SECRET;
  process.env.ADMIN_JWT_SECRET = SECRET;
});
afterAll(() => {
  if (priorSecret === undefined) delete process.env.ADMIN_JWT_SECRET;
  else process.env.ADMIN_JWT_SECRET = priorSecret;
});
const USER = { id: 'u1', email: 'admin@example.com', role: 'SUPER_ADMIN' };

/** Re-sign a payload so we can forge specific exp values. */
function signPayload(payload: Record<string, unknown>, secret: string): string {
  const { createHmac } = require('node:crypto') as typeof import('node:crypto');
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function basePayload(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    sub: USER.id,
    email: USER.email,
    role: USER.role,
    iat: now,
    exp: now + 24 * 60 * 60 * 1000,
    type: 'admin',
    jti: 'jti-1',
    ...overrides,
  };
}

describe('admin token expiry', () => {
  it('exp is issued in milliseconds, not seconds', () => {
    const token = buildAdminToken(USER, SECRET);
    const body = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
    ) as { exp: number; iat: number };

    // A seconds timestamp is ~1.7e9; a millisecond one ~1.7e12.
    expect(body.exp).toBeGreaterThan(1e12);
    expect(body.iat).toBeGreaterThan(1e12);
    // And the window is 24h expressed in ms.
    expect(body.exp - body.iat).toBe(24 * 60 * 60 * 1000);
  });

  it('accepts a freshly issued token', async () => {
    const token = buildAdminToken(USER, SECRET);
    await expect(verifyAdminToken(token)).resolves.toMatchObject({ id: USER.id });
  });

  it('REJECTS an expired token — the regression this guards against', async () => {
    // Expired one hour ago, in the same millisecond units the builder uses.
    const expired = signPayload(basePayload({ exp: Date.now() - 60 * 60 * 1000 }), SECRET);
    await expect(verifyAdminToken(expired)).resolves.toBeNull();
  });

  it('rejects a token that expired long ago', async () => {
    const ancient = signPayload(
      basePayload({ exp: Date.now() - 365 * 24 * 60 * 60 * 1000 }),
      SECRET,
    );
    await expect(verifyAdminToken(ancient)).resolves.toBeNull();
  });

  it('rejects a tampered signature', async () => {
    const token = buildAdminToken(USER, SECRET);
    const [h, b] = token.split('.');
    await expect(verifyAdminToken(`${h}.${b}.forged`)).resolves.toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const token = buildAdminToken(USER, 'some-other-secret');
    await expect(verifyAdminToken(token)).resolves.toBeNull();
  });

  it('rejects a non-admin token type', async () => {
    const wrongType = signPayload(basePayload({ type: 'user' }), SECRET);
    await expect(verifyAdminToken(wrongType)).resolves.toBeNull();
  });
});
