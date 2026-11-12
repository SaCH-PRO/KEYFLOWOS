/**
 * R0-SEC-02-VERIFYLOCAL-ISSUER (open defect 2 of the R0-14 review).
 *
 * `verifyLocal` used to accept any HS256 token signed with SUPABASE_JWT_SECRET
 * whose `iss` was absent or equal to SUPABASE_URL. Hosted Supabase never
 * issues either shape: GoTrue is served at `${SUPABASE_URL}/auth/v1`
 * (supabase-js builds that URL in SupabaseClient.ts:
 * `this.authUrl = new URL('auth/v1', baseUrl)`), and its access tokens carry
 * `iss = https://<ref>.supabase.co/auth/v1`
 * (https://supabase.com/docs/guides/auth/jwt-fields; `iss` is a required claim
 * in @supabase/auth-js RequiredClaims, src/lib/types.ts). So the secret
 * verified no real token, but anyone holding it could mint one for any `sub`
 * and `email`.
 *
 * Pinned rule:
 *   - with SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) set, a token is accepted
 *     only when `iss` is exactly `${SUPABASE_URL}/auth/v1`, `aud` is
 *     `authenticated` and `exp` is present and not passed;
 *   - with no Supabase URL there is no issuer to check against: the only
 *     accepted shape is a token with NO `iss`, and only when NODE_ENV is
 *     'test' (the shape the real-database harnesses mint). It is refused in
 *     production, in development and with NODE_ENV unset.
 *
 * Pure: no network (no anon key is set, so the getUser() fallback has no
 * client), and every env var the service reads is saved and restored.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SupabaseAuthService } from './supabase-auth.service';

const KEYS = [
  'NODE_ENV',
  'SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_JWT_SECRET',
] as const;
const saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

const SECRET = 'sec02-spec-signing-secret';
const URL_ = 'https://sec02-ref.supabase.co';
const HOSTED_ISS = `${URL_}/auth/v1`;
const SUB = 'sec02_user';
const EMAIL = 'sec02_user@test.local';

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

type Claims = Record<string, unknown>;

/** HS256 token; every default claim can be overridden, or dropped with `undefined`. */
function mint(overrides: Claims = {}, opts: { secret?: string; alg?: string } = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const claims: Claims = {
    sub: SUB,
    email: EMAIL,
    aud: 'authenticated',
    role: 'authenticated',
    iat: now,
    exp: now + 600,
    jti: randomUUID(),
    ...overrides,
  };
  for (const k of Object.keys(claims)) if (claims[k] === undefined) delete claims[k];
  const header = b64url({ alg: opts.alg ?? 'HS256', typ: 'JWT' });
  const body = b64url(claims);
  const sig = createHmac('sha256', opts.secret ?? SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function setEnv(values: Partial<Record<(typeof KEYS)[number], string | undefined>>) {
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

async function resolve(token: string) {
  // A fresh instance per call: the service caches only the getUser() client,
  // which never exists here because no anon key is set.
  return new SupabaseAuthService().getUserFromToken(token);
}

const fetchSpy = vi.fn(async () => {
  throw new Error('sec02: outbound fetch refused by the spec');
});
const realFetch = globalThis.fetch;

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  for (const k of KEYS) delete process.env[k];
  process.env.SUPABASE_JWT_SECRET = SECRET;
  fetchSpy.mockClear();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe.each(['production', 'development', 'test'])(
  'verifyLocal with SUPABASE_URL set (NODE_ENV=%s): only the hosted issuer shape is accepted',
  (nodeEnv) => {
    beforeEach(() => setEnv({ NODE_ENV: nodeEnv, SUPABASE_URL: URL_ }));

    it('accepts the hosted shape iss = SUPABASE_URL/auth/v1 with aud authenticated and a live exp', async () => {
      const user = await resolve(mint({ iss: HOSTED_ISS }));
      expect(user).toMatchObject({ id: SUB, email: EMAIL, aud: 'authenticated' });
    });

    it('accepts the hosted shape when SUPABASE_URL carries a trailing slash', async () => {
      setEnv({ SUPABASE_URL: `${URL_}/` });
      expect(await resolve(mint({ iss: HOSTED_ISS }))).toMatchObject({ id: SUB });
    });

    it('refuses a token with no iss (the shape no hosted project issues)', async () => {
      expect(await resolve(mint({ iss: undefined }))).toBeNull();
    });

    it('refuses a token with iss = SUPABASE_URL (no /auth/v1 suffix: the shape no hosted project issues)', async () => {
      expect(await resolve(mint({ iss: URL_ }))).toBeNull();
    });

    it("refuses another project's hosted issuer", async () => {
      expect(await resolve(mint({ iss: 'https://other-ref.supabase.co/auth/v1' }))).toBeNull();
    });

    it('refuses an issuer that only starts with the expected one', async () => {
      expect(await resolve(mint({ iss: `${HOSTED_ISS}/../../evil` }))).toBeNull();
      expect(await resolve(mint({ iss: `${HOSTED_ISS}x` }))).toBeNull();
    });

    it('refuses a token with no aud', async () => {
      expect(await resolve(mint({ iss: HOSTED_ISS, aud: undefined }))).toBeNull();
    });

    it('refuses aud = service_role', async () => {
      expect(await resolve(mint({ iss: HOSTED_ISS, aud: 'service_role' }))).toBeNull();
    });

    it('refuses a token with no exp', async () => {
      expect(await resolve(mint({ iss: HOSTED_ISS, exp: undefined }))).toBeNull();
    });

    it('refuses an expired token', async () => {
      const now = Math.floor(Date.now() / 1000);
      expect(await resolve(mint({ iss: HOSTED_ISS, iat: now - 1200, exp: now - 600 }))).toBeNull();
    });

    it('refuses a hosted-shape token signed with another secret', async () => {
      expect(await resolve(mint({ iss: HOSTED_ISS }, { secret: 'sec02-another-secret' }))).toBeNull();
    });

    it('refuses alg other than HS256', async () => {
      expect(await resolve(mint({ iss: HOSTED_ISS }, { alg: 'ES256' }))).toBeNull();
    });

    it('nothing left the process', () => {
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  },
);

describe('verifyLocal with only NEXT_PUBLIC_SUPABASE_URL set', () => {
  beforeEach(() => setEnv({ NODE_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: URL_ }));

  it('expects the hosted issuer derived from the fallback URL', async () => {
    expect(await resolve(mint({ iss: HOSTED_ISS }))).toMatchObject({ id: SUB });
    expect(await resolve(mint({ iss: undefined }))).toBeNull();
    expect(await resolve(mint({ iss: URL_ }))).toBeNull();
  });
});

describe('verifyLocal with no Supabase URL: the test-only path the real-database harnesses use', () => {
  it('NODE_ENV=test: a token with no iss is accepted (release0-journey, identity-boundary, onboarding-manual-complete and identity-local-auth mint this shape)', async () => {
    setEnv({ NODE_ENV: 'test' });
    expect(await resolve(mint({ iss: undefined }))).toMatchObject({ id: SUB, email: EMAIL });
  });

  it('NODE_ENV=test: aud and exp are still required', async () => {
    setEnv({ NODE_ENV: 'test' });
    expect(await resolve(mint({ iss: undefined, aud: undefined }))).toBeNull();
    expect(await resolve(mint({ iss: undefined, exp: undefined }))).toBeNull();
  });

  it('NODE_ENV=test: a token that carries an iss is refused, because there is no issuer to check it against', async () => {
    setEnv({ NODE_ENV: 'test' });
    expect(await resolve(mint({ iss: HOSTED_ISS }))).toBeNull();
    expect(await resolve(mint({ iss: 'https://attacker.example' }))).toBeNull();
  });

  it.each([['production'], ['development'], [undefined]])(
    'NODE_ENV=%s: the same no-iss token is refused (the path is test-only)',
    async (nodeEnv) => {
      setEnv({ NODE_ENV: nodeEnv });
      expect(await resolve(mint({ iss: undefined }))).toBeNull();
    },
  );

  it('nothing left the process', async () => {
    setEnv({ NODE_ENV: 'production' });
    await resolve(mint({ iss: undefined }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('verifyLocal with SUPABASE_JWT_SECRET unset', () => {
  it('refuses even the hosted shape, and with no anon key there is no getUser() fallback', async () => {
    setEnv({ NODE_ENV: 'production', SUPABASE_URL: URL_, SUPABASE_JWT_SECRET: undefined });
    expect(await resolve(mint({ iss: HOSTED_ISS }))).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
