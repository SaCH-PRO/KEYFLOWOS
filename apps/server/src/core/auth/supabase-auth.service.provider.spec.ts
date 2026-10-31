/**
 * R0-SEC-02-VERIFYLOCAL-ISSUER review repair CR-1 (and the runtime half of
 * SEC02-R1).
 *
 * Before R0-SEC-02 no hosted token passed verifyLocal (the issuer check
 * compared `iss` with SUPABASE_URL, without `/auth/v1`), so every hosted token
 * went through `supabase.auth.getUser()`. That round trip refuses a token
 * whose GoTrue session is gone (403 session_not_found) and a banned user, and
 * two callers check nothing after getUserFromToken and rely on it:
 * IdentityPasswordService.completeReset (a used recovery link) and
 * KeyCortexWsAuthService.authenticateSocket (no logout-marker check).
 * R0-SEC-02 made the hosted shape verify locally, so with the project's real
 * legacy secret both accepted a revoked session until `exp`.
 *
 * Pinned rule: when the server has a provider client (a Supabase URL and an
 * anon key, the same pair the getUser() client is built from), getUser()
 * decides, even for a token verifyLocal would accept. verifyLocal decides
 * alone only when there is no provider client.
 *
 * `@supabase/supabase-js` createClient is replaced; nothing leaves the process.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';

const { getUser, createClient } = vi.hoisted(() => {
  const getUser = vi.fn();
  const createClient = vi.fn(() => ({ auth: { getUser } }));
  return { getUser, createClient };
});

vi.mock('@supabase/supabase-js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createClient,
}));

import { SupabaseAuthService } from './supabase-auth.service';
import { IdentityPasswordService } from '../../modules/identity/identity-password.service';
import { KeyCortexWsAuthService } from '../../modules/key-cortex/key-cortex-ws-auth.service';

const KEYS = [
  'NODE_ENV',
  'SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_JWT_SECRET',
  'ADMIN_JWT_SECRET',
] as const;
const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

const SECRET = 'cr1-spec-legacy-project-secret-at-least-32-chars';
const URL_ = 'https://cr1-ref.supabase.co';
const HOSTED_ISS = `${URL_}/auth/v1`;
const SUB = 'cr1_user';
const EMAIL = 'cr1_user@test.local';

const SESSION_GONE = {
  data: { user: null },
  error: { message: 'Session from session_id claim in JWT does not exist', status: 403 },
};

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/** A token of the hosted shape, signed with `secret`, carrying a session. */
function mintHosted(secret = SECRET): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const body = b64url({
    sub: SUB,
    email: EMAIL,
    iss: HOSTED_ISS,
    aud: 'authenticated',
    role: 'authenticated',
    iat: now,
    exp: now + 600,
    session_id: randomUUID(),
    amr: [{ method: 'recovery', timestamp: now }],
  });
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function setEnv(values: Partial<Record<(typeof KEYS)[number], string | undefined>>) {
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  for (const k of KEYS) delete process.env[k];
  setEnv({ NODE_ENV: 'production', SUPABASE_URL: URL_, SUPABASE_ANON_KEY: 'cr1-anon', SUPABASE_JWT_SECRET: SECRET });
  getUser.mockReset();
  createClient.mockClear();
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('getUserFromToken with a provider client: getUser() decides, even for a token verifyLocal accepts', () => {
  it('refuses a hosted-shape token signed with the configured secret when the provider says its session is gone', async () => {
    getUser.mockResolvedValue(SESSION_GONE);
    const token = mintHosted();
    expect(await new SupabaseAuthService().getUserFromToken(token)).toBeNull();
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(getUser).toHaveBeenCalledWith(token);
  });

  it('refuses it when the provider reports the user banned', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: SUB, email: EMAIL, aud: 'authenticated', banned_at: '2026-10-01T00:00:00Z' } },
      error: null,
    });
    expect(await new SupabaseAuthService().getUserFromToken(mintHosted())).toBeNull();
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it('answers with the provider user when the provider confirms the session', async () => {
    const providerUser = { id: SUB, email: EMAIL, aud: 'authenticated', app_metadata: { provider: 'email' } };
    getUser.mockResolvedValue({ data: { user: providerUser }, error: null });
    expect(await new SupabaseAuthService().getUserFromToken(mintHosted())).toBe(providerUser);
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it('SEC02-R1: a hosted-shape token minted with a public placeholder secret is refused when the provider refuses it', async () => {
    setEnv({ SUPABASE_JWT_SECRET: 'your-jwt-secret' });
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid JWT: signature is invalid', status: 403 } });
    expect(await new SupabaseAuthService().getUserFromToken(mintHosted('your-jwt-secret'))).toBeNull();
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it('the NEXT_PUBLIC_ URL and anon-key fallbacks count as a provider client', async () => {
    setEnv({
      SUPABASE_URL: undefined,
      SUPABASE_ANON_KEY: undefined,
      NEXT_PUBLIC_SUPABASE_URL: URL_,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'cr1-anon',
    });
    getUser.mockResolvedValue(SESSION_GONE);
    expect(await new SupabaseAuthService().getUserFromToken(mintHosted())).toBeNull();
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it('a provider that cannot be reached refuses the token (fail closed, as before R0-SEC-02)', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'fetch failed', status: 0 } });
    expect(await new SupabaseAuthService().getUserFromToken(mintHosted())).toBeNull();
  });
});

describe('getUserFromToken with no provider client: verifyLocal decides alone', () => {
  it('no anon key: the hosted shape is accepted locally and no client is built', async () => {
    setEnv({ SUPABASE_ANON_KEY: undefined });
    expect(await new SupabaseAuthService().getUserFromToken(mintHosted())).toMatchObject({ id: SUB, email: EMAIL });
    expect(createClient).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
  });
});

describe('callers that check nothing after getUserFromToken', () => {
  it('IdentityPasswordService.completeReset: a used recovery link (its session gone) cannot set the password again', async () => {
    getUser.mockResolvedValue(SESSION_GONE);
    const admin = {
      sendRecoveryEmail: vi.fn(async () => undefined),
      updateUserPassword: vi.fn(async () => undefined),
      signOut: vi.fn(async () => false),
    };
    const policy = { validate: vi.fn(async () => undefined) };
    const svc = new IdentityPasswordService(admin as never, new SupabaseAuthService(), policy as never);

    await expect(svc.completeReset(mintHosted(), 'a-new-long-password-1!')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(admin.signOut).not.toHaveBeenCalled();
    expect(admin.updateUserPassword).not.toHaveBeenCalled();
    expect(policy.validate).not.toHaveBeenCalled();
  });

  it('KeyCortexWsAuthService.authenticateSocket: a logged-out token (its session gone) does not open a socket', async () => {
    getUser.mockResolvedValue(SESSION_GONE);
    const prisma = { client: { user: { findUnique: vi.fn(async () => ({ role: 'USER' })) } } };
    const redis = { get: vi.fn(async () => null), exists: vi.fn(async () => 0) };
    const svc = new KeyCortexWsAuthService(new SupabaseAuthService(), prisma as never, redis as never);
    const client = { handshake: { auth: { token: mintHosted() }, headers: {} } };

    expect(await svc.authenticateSocket(client as never)).toBeNull();
    expect(prisma.client.user.findUnique).not.toHaveBeenCalled();
  });
});
