import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import { UnauthorizedException } from '@nestjs/common';
import { AuthMiddleware, logoutRevocationCutoff } from './auth.middleware';
import { buildAdminToken } from './admin-token.util';
import { IdentityController } from '../../modules/identity/identity.controller';
import { IdentityPasswordService } from '../../modules/identity/identity-password.service';

function makeMiddleware(
  supabaseUser?: { id: string; email?: string } | null,
  role = 'USER',
  deletedAt: Date | null = null,
  bannedAt: Date | null = null,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
  const supabaseAuth: any = {
    getUserFromToken: vi.fn().mockResolvedValue(supabaseUser ?? null),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
  const prisma: any = {
    client: {
      user: {
        findUnique: vi.fn().mockResolvedValue({ role, deletedAt, bannedAt }),
      },
    },
  };
  const mockRedis = { get: () => Promise.resolve(null), set: () => Promise.resolve('OK') } as any;
  return { mw: new AuthMiddleware(supabaseAuth, prisma, mockRedis), supabaseAuth, prisma };
}

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    query: {},
    ...overrides,
  } as Request;
}

const next = () => {};
const res = {} as Response;

describe('AuthMiddleware (post-bypass-removal)', () => {
  it('does not attach a user when no Authorization header is present', async () => {
    const { mw, supabaseAuth } = makeMiddleware();
    const req = makeReq();
    await mw.use(req, res, next);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inspecting augmented Request
    expect((req as any).user).toBeUndefined();
    expect(supabaseAuth.getUserFromToken).not.toHaveBeenCalled();
  });

  it('attaches user with DB role when Supabase verifies a real token', async () => {
    const { mw, supabaseAuth, prisma } = makeMiddleware(
      { id: 'user_real', email: 'real@example.com' },
      'OWNER',
    );
    const req = makeReq({ headers: { authorization: 'Bearer real-jwt-here' } });
    await mw.use(req, res, next);
    expect(supabaseAuth.getUserFromToken).toHaveBeenCalledWith('real-jwt-here');
    expect(prisma.client.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user_real' },
      select: { role: true, deletedAt: true, bannedAt: true },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inspecting augmented Request
    expect((req as any).user).toEqual({
      id: 'user_real',
      email: 'real@example.com',
      role: 'OWNER',
    });
  });

  it('does not attach a user when Supabase rejects the token', async () => {
    const { mw } = makeMiddleware(null);
    const req = makeReq({ headers: { authorization: 'Bearer invalid-token' } });
    await mw.use(req, res, next);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inspecting augmented Request
    expect((req as any).user).toBeUndefined();
  });

  it('does not attach a user when Supabase verification throws', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
    const supabaseAuth: any = {
      getUserFromToken: vi.fn().mockRejectedValue(new Error('network down')),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
    const prisma: any = { client: { user: { findUnique: vi.fn() } } };
    const mockRedis = { get: () => Promise.resolve(null), set: () => Promise.resolve('OK') } as any;
    const mw = new AuthMiddleware(supabaseAuth, prisma, mockRedis);
    const req = makeReq({ headers: { authorization: 'Bearer x' } });
    await mw.use(req, res, next);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inspecting augmented Request
    expect((req as any).user).toBeUndefined();
  });

  it('does not attach a user if the Prisma lookup fails', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
    const supabaseAuth: any = {
      getUserFromToken: vi.fn().mockResolvedValue({ id: 'u1', email: 'a@b.com' }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
    const prisma: any = {
      client: {
        user: { findUnique: vi.fn().mockRejectedValue(new Error('db down')) },
      },
    };
    const mockRedis = { get: () => Promise.resolve(null), set: () => Promise.resolve('OK') } as any;
    const mw = new AuthMiddleware(supabaseAuth, prisma, mockRedis);
    const req = makeReq({ headers: { authorization: 'Bearer t' } });
    await mw.use(req, res, next);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inspecting augmented Request
    expect((req as any).user).toBeUndefined();
  });

  it('does not attach a deleted user', async () => {
    const { mw } = makeMiddleware({ id: 'u1', email: 'a@b.com' }, 'USER', new Date());
    const req = makeReq({ headers: { authorization: 'Bearer t' } });
    await mw.use(req, res, next);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inspecting augmented Request
    expect((req as any).user).toBeUndefined();
  });

  it('does not attach a banned user', async () => {
    const { mw } = makeMiddleware({ id: 'u1', email: 'a@b.com' }, 'USER', null, new Date());
    const req = makeReq({ headers: { authorization: 'Bearer t' } });
    await mw.use(req, res, next);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inspecting augmented Request
    expect((req as any).user).toBeUndefined();
  });

  it('does not attach a revoked user', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
    const supabaseAuth: any = {
      getUserFromToken: vi.fn().mockResolvedValue({ id: 'u1', email: 'a@b.com' }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
    const prisma: any = {
      client: {
        user: { findUnique: vi.fn().mockResolvedValue({ role: 'USER', deletedAt: null, bannedAt: null }) },
      },
    };
    const mockRedis = { get: vi.fn().mockResolvedValue('1'), set: () => Promise.resolve('OK') } as any;
    const mw = new AuthMiddleware(supabaseAuth, prisma, mockRedis);
    const req = makeReq({ headers: { authorization: 'Bearer t' } });
    await mw.use(req, res, next);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inspecting augmented Request
    expect((req as any).user).toBeUndefined();
    expect(mockRedis.get).toHaveBeenCalledWith('auth:revoked:user:u1');
  });

  /**
   * The bug this suite failed to catch, and the reason it failed to catch it.
   *
   * `makeMiddleware` above always resolves findUnique to a row. So every test
   * here ran as an already-bootstrapped user, and the one case that matters for
   * signup — NO ROW YET — was never exercised. 7d6fd587 rejected on `!dbUser`
   * and shipped green.
   *
   * In production that meant: signup creates the Supabase user, the client calls
   * /identity/bootstrap to create the local row, the middleware rejects because
   * there is no local row, and bootstrap is the only thing that creates one.
   * Every new account was stranded on the signup form, looking at
   * "Authentication required", with a working login it never learned about.
   */
  describe('a user who has not bootstrapped yet', () => {
    function withNoLocalRow(revoked: string | null = null) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
      const supabaseAuth: any = {
        getUserFromToken: vi.fn().mockResolvedValue({ id: 'new_user', email: 'new@b.com' }),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
      const prisma: any = { client: { user: { findUnique: vi.fn().mockResolvedValue(null) } } };
      const redis = { get: vi.fn().mockResolvedValue(revoked), set: () => Promise.resolve('OK') } as any;
      return new AuthMiddleware(supabaseAuth, prisma, redis);
    }

    it('is attached, so it can reach /identity/bootstrap', async () => {
      const mw = withNoLocalRow();
      const req = makeReq({ headers: { authorization: 'Bearer t' } });
      await mw.use(req, res, next);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inspecting augmented Request
      const user = (req as any).user;
      expect(user, 'a brand-new account cannot bootstrap, so it cannot sign up').toBeTruthy();
      expect(user.id).toBe('new_user');
    });

    it('gets the default role, not an elevated one', async () => {
      const mw = withNoLocalRow();
      const req = makeReq({ headers: { authorization: 'Bearer t' } });
      await mw.use(req, res, next);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inspecting augmented Request
      expect((req as any).user.role).toBe('USER');
    });

    it('is STILL rejected when the token has been revoked', async () => {
      // The absent-row branch must not become a way around logout. Revocation
      // is checked before the row lookup precisely so this holds.
      const mw = withNoLocalRow('1');
      const req = makeReq({ headers: { authorization: 'Bearer t' } });
      await mw.use(req, res, next);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inspecting augmented Request
      expect((req as any).user, 'a revoked token was accepted because no row existed').toBeUndefined();
    });
  });

  /**
   * ST-2 (R0-ID-F2-ADMIN-TOKEN-LOCAL-USER). When Supabase does not verify the
   * token, the middleware falls back to an admin HMAC token. That branch used to
   * attach verifyAdminToken's result as-is: role from the TOKEN, and none of the
   * resolveLocalUser checks, so a deleted or banned admin kept access and a
   * demoted one kept SUPER_ADMIN. It now runs the same resolveLocalUser row
   * checks, takes the role from the User row, and — unlike a Supabase token —
   * refuses a subject with no User row (no bootstrap window for an admin
   * identity). Its logout revocation is the admin token's own issue-time
   * cutoff (admin:user:<id>:revokedAt), not the per-user Supabase logout marker
   * (review finding F1: honouring that marker locked the admin out of every
   * later admin login for 24h).
   */
  describe('admin-token fallback (ST-2): the same local-user checks as a Supabase token', () => {
    const ADMIN_SECRET = 'auth-middleware-spec-admin-secret-not-real';
    const ADMIN = { id: 'admin_1', email: 'admin@example.com', role: 'SUPER_ADMIN' };
    let priorSecret: string | undefined;
    beforeAll(() => {
      priorSecret = process.env.ADMIN_JWT_SECRET;
      process.env.ADMIN_JWT_SECRET = ADMIN_SECRET;
    });
    afterAll(() => {
      if (priorSecret === undefined) delete process.env.ADMIN_JWT_SECRET;
      else process.env.ADMIN_JWT_SECRET = priorSecret;
    });

    /**
     * Supabase rejects the token, so only the admin branch can attach. Redis
     * answers per key: the admin-token jti key is never revoked here, and the
     * admin cutoff (admin:user:<id>:revokedAt) is set only when a case passes
     * adminRevokedAt, so any other refusal comes from the local-user checks.
     */
    function adminMiddleware(opts: {
      row?: { role: string; deletedAt: Date | null; bannedAt: Date | null } | null;
      userRevoked?: boolean;
      adminRevokedAt?: number;
      lookup?: () => Promise<unknown>;
    } = {}) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
      const supabaseAuth: any = { getUserFromToken: vi.fn().mockResolvedValue(null) };
      const row = opts.row === undefined ? { role: 'SUPER_ADMIN', deletedAt: null, bannedAt: null } : opts.row;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
      const prisma: any = {
        client: { user: { findUnique: vi.fn(opts.lookup ?? (async () => row)) } },
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
      const redis: any = {
        get: vi.fn(async (key: string) => {
          if (key === `auth:revoked:user:${ADMIN.id}`) return opts.userRevoked ? '1' : null;
          if (key === `admin:user:${ADMIN.id}:revokedAt`) return opts.adminRevokedAt === undefined ? null : String(opts.adminRevokedAt);
          return null;
        }),
        set: () => Promise.resolve('OK'),
      };
      return { mw: new AuthMiddleware(supabaseAuth, prisma, redis), prisma, redis };
    }

    async function run(mw: AuthMiddleware, token = buildAdminToken(ADMIN, ADMIN_SECRET)) {
      const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
      await mw.use(req, res, next);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inspecting augmented Request
      return (req as any).user;
    }

    it('positive control: an admin token for an active SUPER_ADMIN row is attached, role read from the row', async () => {
      const { mw, prisma } = adminMiddleware();
      expect(await run(mw)).toEqual({ id: ADMIN.id, email: ADMIN.email, role: 'SUPER_ADMIN' });
      expect(prisma.client.user.findUnique).toHaveBeenCalledWith({
        where: { id: ADMIN.id },
        select: { role: true, deletedAt: true, bannedAt: true },
      });
    });

    it('takes the role from the User row, not the token: a demoted row attaches as USER', async () => {
      const { mw } = adminMiddleware({ row: { role: 'USER', deletedAt: null, bannedAt: null } });
      const user = await run(mw);
      expect(user, 'the identity is still valid, only the role changed').toBeTruthy();
      expect(user.role, 'role came from the token claim, not the User row').toBe('USER');
    });

    it('does not attach when User.deletedAt is set', async () => {
      const { mw } = adminMiddleware({ row: { role: 'SUPER_ADMIN', deletedAt: new Date(), bannedAt: null } });
      expect(await run(mw)).toBeUndefined();
    });

    it('does not attach when User.bannedAt is set', async () => {
      const { mw } = adminMiddleware({ row: { role: 'SUPER_ADMIN', deletedAt: null, bannedAt: new Date() } });
      expect(await run(mw)).toBeUndefined();
    });

    it('F1: the per-user logout marker does not refuse an admin token — it has no issue time and nothing on the admin login path clears it', async () => {
      // POST /identity/logout sets auth:revoked:user:<id> for 24h; only
      // POST /identity/login (Supabase) deletes it. Honouring it here refused
      // every token a later POST /api/admin/auth/login issued, for 24h.
      const { mw, redis, prisma } = adminMiddleware({ userRevoked: true });
      expect(await run(mw)).toEqual({ id: ADMIN.id, email: ADMIN.email, role: 'SUPER_ADMIN' });
      expect(redis.get).not.toHaveBeenCalledWith(`auth:revoked:user:${ADMIN.id}`);
      // The row checks still ran.
      expect(prisma.client.user.findUnique).toHaveBeenCalledTimes(1);
    });

    it('an admin token issued before the admin cutoff (admin:user:<id>:revokedAt, POST /api/admin/auth/logout) is refused without reading the User row', async () => {
      const token = buildAdminToken(ADMIN, ADMIN_SECRET);
      const { mw, prisma } = adminMiddleware({ adminRevokedAt: Date.now() + 1 });
      expect(await run(mw, token)).toBeUndefined();
      expect(prisma.client.user.findUnique).not.toHaveBeenCalled();
    });

    it('an admin token issued after the admin cutoff is attached: admin logout followed by admin login does not lock the admin out', async () => {
      const { mw } = adminMiddleware({ adminRevokedAt: Date.now() - 1000 });
      expect(await run(mw, buildAdminToken(ADMIN, ADMIN_SECRET))).toEqual({ id: ADMIN.id, email: ADMIN.email, role: 'SUPER_ADMIN' });
    });

    it('does not attach when the subject has no User row (no bootstrap window for an admin token)', async () => {
      const { mw } = adminMiddleware({ row: null });
      expect(await run(mw)).toBeUndefined();
    });

    it('does not attach when the User lookup fails (fails closed, like the Supabase branch)', async () => {
      const { mw } = adminMiddleware({ lookup: async () => { throw new Error('db down'); } });
      expect(await run(mw)).toBeUndefined();
    });

    it('does not consult the User row for a token that fails admin verification', async () => {
      const { mw, prisma } = adminMiddleware();
      expect(await run(mw, buildAdminToken(ADMIN, 'some-other-secret'))).toBeUndefined();
      expect(prisma.client.user.findUnique).not.toHaveBeenCalled();
    });
  });

  it('ignores legacy dev sentinel tokens (no special handling)', async () => {
    // The middleware just forwards the token to Supabase; sentinel tokens
    // will fail Supabase verification and result in no user attached.
    const { mw } = makeMiddleware(null);
    const req = makeReq({
      headers: { authorization: 'Bearer keyflow-dev-bypass-token' },
    });
    await mw.use(req, res, next);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inspecting augmented Request
    expect((req as any).user).toBeUndefined();
  });
});

/**
 * ST-4 (R0-ID-F3-REVOCATION-IAT-CUTOFF). The logout revocation marker
 * `auth:revoked:user:<id>` used to be a bare flag ('1') with no issue time, and
 * POST /identity/login deleted it. So any access token issued before a logout —
 * a stolen one included — was admitted again after the next login, until its
 * own exp. The marker now holds the revocation time in epoch seconds, login
 * leaves it alone, and the middleware refuses a token whose iat is at or before
 * that time (or that carries no iat at all) while a token issued after it is
 * attached.
 *
 * Review repairs: the time compared is when the token's SESSION was
 * authenticated (amr), not its iat, so a pre-logout session refreshed after the
 * logout stays refused while the provider sign-out revokes nothing (ST4-R1, F1);
 * and a bare '1' left by the previous release is read by its TTL as the time it
 * was written, so it no longer locks the next login out (F2).
 */
describe('ST-4 — logout revocation is an issue-time cutoff, not a per-user flag', () => {
  const USER = 'u_st4';
  const NOW_MS = Date.parse('2026-10-31T12:00:00.000Z');
  const NOW_S = Math.floor(NOW_MS / 1000);
  const DAY_S = 24 * 60 * 60;

  const b64url = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  /** A JWT-shaped token. Its signature is never checked here: getUserFromToken is the mocked verifier. */
  const jwt = (claims: Record<string, unknown>) =>
    `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: USER, aud: 'authenticated', ...claims })}.sig`;

  /**
   * One Redis keyspace shared by the writer (IdentityController) and the reader
   * (AuthMiddleware). `initialTtl` seeds remaining TTLs in seconds; time does not
   * run them down (only Date is faked).
   */
  function memoryRedis(initial: Record<string, string> = {}, initialTtl: Record<string, number> = {}) {
    const store = new Map<string, string>(Object.entries(initial));
    const ttl = new Map<string, number>(Object.entries(initialTtl));
    return {
      store,
      ttl,
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      // Redis semantics: remaining ms, -1 when the key has no TTL, -2 when it does not exist.
      pttl: vi.fn(async (k: string) => (!store.has(k) ? -2 : ttl.has(k) ? ttl.get(k)! * 1000 : -1)),
      setex: vi.fn(async (k: string, seconds: number, v: string) => {
        store.set(k, String(v));
        ttl.set(k, seconds);
        return 'OK';
      }),
      set: vi.fn(async (k: string, v: string, ...args: unknown[]) => {
        store.set(k, String(v));
        const ex = args.findIndex((a) => typeof a === 'string' && a.toUpperCase() === 'EX');
        if (ex >= 0) ttl.set(k, Number(args[ex + 1]));
        else ttl.delete(k);
        return 'OK';
      }),
      del: vi.fn(async (...keys: unknown[]) => {
        let n = 0;
        for (const k of keys.flat() as string[]) {
          if (store.delete(k)) n++;
          ttl.delete(k);
        }
        return n;
      }),
    };
  }
  type MemoryRedis = ReturnType<typeof memoryRedis>;

  /** The real middleware: the mocked verifier accepts every token as USER, the row is active. */
  function middleware(redis: MemoryRedis) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
    const supabaseAuth: any = { getUserFromToken: vi.fn().mockResolvedValue({ id: USER, email: 'st4@example.com' }) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
    const prisma: any = {
      client: { user: { findUnique: vi.fn().mockResolvedValue({ role: 'OWNER', deletedAt: null, bannedAt: null }) } },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
    return { mw: new AuthMiddleware(supabaseAuth, prisma, redis as any), prisma };
  }

  async function attached(mw: AuthMiddleware, token: string) {
    const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
    await mw.use(req, res, next);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inspecting augmented Request
    return (req as any).user as { id: string; role: string } | undefined;
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW_MS);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('the middleware reads the marker as a revocation time (epoch seconds)', () => {
    const marker = (value: string) => memoryRedis({ [`auth:revoked:user:${USER}`]: value });

    it('refuses a token issued before the revocation time, without reading the User row', async () => {
      const { mw, prisma } = middleware(marker(String(NOW_S)));
      expect(await attached(mw, jwt({ iat: NOW_S - 600, exp: NOW_S + 3000 }))).toBeUndefined();
      expect(prisma.client.user.findUnique).not.toHaveBeenCalled();
    });

    it('refuses a token issued in the same second as the revocation (at or before is refused)', async () => {
      const { mw } = middleware(marker(String(NOW_S)));
      expect(await attached(mw, jwt({ iat: NOW_S, exp: NOW_S + 3600 }))).toBeUndefined();
    });

    it('attaches a token issued after the revocation time, role from the User row', async () => {
      const { mw } = middleware(marker(String(NOW_S - 1)));
      expect(await attached(mw, jwt({ iat: NOW_S, exp: NOW_S + 3600 }))).toEqual({
        id: USER,
        email: 'st4@example.com',
        role: 'OWNER',
      });
    });

    it('refuses a token with no iat, or a non-numeric one, once a marker exists; the same token is attached with no marker', async () => {
      const { mw } = middleware(marker(String(NOW_S - 3600)));
      expect(await attached(mw, jwt({ exp: NOW_S + 3600 })), 'JWT without iat').toBeUndefined();
      expect(await attached(mw, jwt({ iat: 'later', exp: NOW_S + 3600 })), 'non-numeric iat').toBeUndefined();
      expect(await attached(mw, 'opaque-token'), 'no decodable payload').toBeUndefined();

      const { mw: unmarked } = middleware(memoryRedis());
      expect(await attached(unmarked, jwt({ exp: NOW_S + 3600 })), 'no marker: iat is not required').toBeTruthy();
      expect(await attached(unmarked, 'opaque-token'), 'no marker: opaque token still attached').toBeTruthy();
    });

    it("backward compatible: the previous release's bare flag ('1') with no readable TTL is a revocation at an unknown time, so every token issued up to now is refused", async () => {
      const { mw } = middleware(marker('1'));
      expect(await attached(mw, jwt({ iat: NOW_S - 3600, exp: NOW_S + 60 })), 'issued an hour ago').toBeUndefined();
      expect(await attached(mw, jwt({ iat: NOW_S, exp: NOW_S + 3600 })), 'issued this second').toBeUndefined();
    });

    /**
     * Review findings ST4-R1 / F1. Supabase mints a new access token, with a new
     * iat, every time a session's refresh token is used, and the provider
     * sign-out does not revoke refresh tokens today (CR-2). With an iat cutoff,
     * any surviving refresh token — another device, or a stolen one — got back
     * in on its next refresh after the logout, with no login in between. The
     * cutoff is compared against when the token's SESSION was authenticated.
     */
    describe('the cutoff is when the token’s session was authenticated (amr), not when the token was minted (iat)', () => {
      const pw = (timestamp: number) => ({ method: 'password', timestamp });

      it('refuses a token minted AFTER the logout by refreshing a session authenticated BEFORE it; attaches a token of a session authenticated after it', async () => {
        const { mw } = middleware(marker(String(NOW_S)));
        const refreshed = jwt({ iat: NOW_S + 300, exp: NOW_S + 3900, session_id: 's-before', amr: [pw(NOW_S - 600)] });
        expect(await attached(mw, refreshed), 'pre-logout session, refreshed after the logout').toBeUndefined();
        const relogin = jwt({ iat: NOW_S + 300, exp: NOW_S + 3900, session_id: 's-after', amr: [pw(NOW_S + 200)] });
        expect(await attached(mw, relogin), 'session authenticated after the logout').toEqual({
          id: USER,
          email: 'st4@example.com',
          role: 'OWNER',
        });
      });

      it('a session authenticated in the same second as the logout is refused (at or before is refused)', async () => {
        const { mw } = middleware(marker(String(NOW_S)));
        expect(await attached(mw, jwt({ iat: NOW_S + 60, exp: NOW_S + 3660, session_id: 's', amr: [pw(NOW_S)] }))).toBeUndefined();
      });

      it('an MFA step-up after the logout does not revive a pre-logout session: the earliest amr entry is the session start', async () => {
        const { mw } = middleware(marker(String(NOW_S)));
        const token = jwt({
          iat: NOW_S + 120,
          exp: NOW_S + 3720,
          session_id: 's-before',
          amr: [{ method: 'totp', timestamp: NOW_S + 100 }, pw(NOW_S - 600)],
        });
        expect(await attached(mw, token)).toBeUndefined();
      });

      it('a session token (session_id) that does not say when its session began is refused while a marker exists, whatever its iat; attached with no marker', async () => {
        const cases: Array<[string, Record<string, unknown>]> = [
          ['no amr', { session_id: 's1' }],
          ['empty amr', { session_id: 's1', amr: [] }],
          ['amr without timestamps', { session_id: 's1', amr: [{ method: 'password' }] }],
          ['amr as plain strings', { session_id: 's1', amr: ['pwd'] }],
          ['one amr entry without a timestamp', { session_id: 's1', amr: [pw(NOW_S + 200), { method: 'totp' }] }],
        ];
        const { mw } = middleware(marker(String(NOW_S)));
        const { mw: unmarked } = middleware(memoryRedis());
        for (const [label, claims] of cases) {
          const token = jwt({ iat: NOW_S + 300, exp: NOW_S + 3900, ...claims });
          expect(await attached(mw, token), `${label}: refused with a marker`).toBeUndefined();
          expect(await attached(unmarked, token), `${label}: attached with no marker`).toBeTruthy();
        }
      });

      it('never later than iat: an amr timestamp after the token iat does not move the session start past it', async () => {
        const { mw } = middleware(marker(String(NOW_S)));
        expect(await attached(mw, jwt({ iat: NOW_S - 10, exp: NOW_S + 3590, session_id: 's', amr: [pw(NOW_S + 500)] }))).toBeUndefined();
      });
    });

    /**
     * Review finding F2. The previous release wrote the marker only as
     * setex(key, 86400, '1'). Read as "revoked now" on every request, it locked
     * out a user who logged out in the 24h before the deploy: the next login
     * answered 'authenticated' and every token it issued got a 401. Its PTTL
     * still says when it was written.
     */
    describe("the previous release's bare flag ('1') is read by its TTL as the time it was written", () => {
      const KEY = `auth:revoked:user:${USER}`;
      /** A bare '1' written `agoS` seconds before NOW by setex(key, 86400, '1'). */
      const legacy = (agoS: number) => memoryRedis({ [KEY]: '1' }, { [KEY]: DAY_S - agoS });

      it('written 10 minutes ago: a session authenticated after it is attached; one authenticated before it, or within the 1s margin, is refused', async () => {
        const { mw } = middleware(legacy(600));
        const session = (startedAt: number) =>
          jwt({ iat: NOW_S, exp: NOW_S + 3600, session_id: `s${startedAt}`, amr: [{ method: 'password', timestamp: startedAt }] });
        expect(await attached(mw, session(NOW_S - 300)), 'login 5 minutes ago, after the legacy logout').toBeTruthy();
        expect(await attached(mw, jwt({ iat: NOW_S - 300, exp: NOW_S + 3300 })), 'no-session token minted after it').toBeTruthy();
        expect(await attached(mw, session(NOW_S - 900)), 'session from before the legacy logout').toBeUndefined();
        expect(await attached(mw, session(NOW_S - 600)), 'the second of the legacy logout').toBeUndefined();
        expect(await attached(mw, session(NOW_S - 599)), 'within the 1s margin').toBeUndefined();
        expect(await attached(mw, jwt({ iat: NOW_S - 1200, exp: NOW_S + 2400 })), 'access token minted before it').toBeUndefined();
      });

      it('written this instant (the full 24h left): every token issued up to now is still refused', async () => {
        const { mw } = middleware(legacy(0));
        expect(await attached(mw, jwt({ iat: NOW_S, exp: NOW_S + 3600 }))).toBeUndefined();
      });

      it('fails closed to "revoked now" when the TTL cannot vouch for the write time: no TTL, a TTL over 24h, a PTTL error', async () => {
        const over = memoryRedis({ [KEY]: '1' }, { [KEY]: DAY_S + 60 });
        const failing = memoryRedis({ [KEY]: '1' });
        failing.pttl.mockRejectedValue(new Error('redis down'));
        for (const [label, redis] of [['no TTL', marker('1')], ['TTL over 24h', over], ['PTTL error', failing]] as const) {
          const { mw } = middleware(redis);
          expect(await attached(mw, jwt({ iat: NOW_S, exp: NOW_S + 3600 })), `${label}: token minted now`).toBeUndefined();
        }
      });

      it('only the bare flag is read by its TTL; any other value that is not a revocation time is "revoked now", and a revocation time never reads the TTL', async () => {
        expect(logoutRevocationCutoff('1', NOW_MS, (DAY_S - 600) * 1000)).toBe(NOW_S - 599);
        expect(logoutRevocationCutoff('2', NOW_MS, (DAY_S - 600) * 1000)).toBe(NOW_S);
        expect(logoutRevocationCutoff('true', NOW_MS, (DAY_S - 600) * 1000)).toBe(NOW_S);
        expect(logoutRevocationCutoff('1', NOW_MS, null)).toBe(NOW_S);
        expect(logoutRevocationCutoff('1', NOW_MS, 0)).toBe(NOW_S);
        expect(logoutRevocationCutoff(String(NOW_S - 5), NOW_MS, 1000)).toBe(NOW_S - 5);

        const redis = marker(String(NOW_S - 5));
        const { mw } = middleware(redis);
        await attached(mw, jwt({ iat: NOW_S, exp: NOW_S + 3600 }));
        expect(redis.pttl).not.toHaveBeenCalled();
      });
    });
  });

  /**
   * The writer and the reader on one Redis keyspace: the REAL
   * IdentityController.logout and IdentityController.login handlers (only the
   * provider calls are stubbed — signInWithPassword succeeds, signOut is a
   * no-op) followed by the real middleware. This is where login's effect on the
   * marker is pinned; the provider-free integration suite cannot run the login
   * leg.
   */
  describe('the real logout and login handlers, then the middleware', () => {
    function controller(
      redis: MemoryRedis,
      opts: {
        /** The access token Supabase hands signInWithPassword's caller. */
        loginToken?: () => string;
        /** The access token Supabase hands refreshSession's caller. */
        refreshToken?: () => string;
        /** What SupabaseAdminService.signOut resolves to: false is its failure report. */
        signOut?: () => Promise<unknown>;
        /** The local User row the password service reads (null: not bootstrapped yet). Active by default. */
        userRow?: { deletedAt: Date | null; bannedAt: Date | null } | null;
      } = {},
    ) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- audit entries inspected by the cases
      const authSec = { enforce: vi.fn(async () => undefined), audit: vi.fn(async (_entry: any) => undefined) };
      const signupSvc = {
        signInWithPassword: vi.fn(async () => ({
          userId: USER,
          email: 'st4@example.com',
          accessToken: opts.loginToken ? opts.loginToken() : 'fresh',
          refreshToken: 'r',
        })),
        refreshSession: vi.fn(async () => ({ accessToken: opts.refreshToken ? opts.refreshToken() : 'refreshed', refreshToken: 'r2' })),
      };
      const supabaseAdmin = {
        signOut: vi.fn(opts.signOut ?? (async () => undefined)),
        updateUserPassword: vi.fn(async (_userId: string, _password: string) => undefined),
      };
      // The REAL IdentityPasswordService behind POST /identity/reset-password,
      // on the same Redis keyspace the logout writes and the middleware reads.
      // Like the middleware mock above, the verifier accepts every token as
      // USER: a signature Supabase accepts is exactly what a stolen token has.
      const passwordPrisma = {
        client: {
          user: {
            findUnique: vi.fn(async () => (opts.userRow === undefined ? { deletedAt: null, bannedAt: null } : opts.userRow)),
          },
        },
      };
      const passwordSvc = new IdentityPasswordService(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test stub
        supabaseAdmin as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test stub
        { getUserFromToken: vi.fn(async () => ({ id: USER, email: 'st4@example.com' })) } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test stub
        { validate: vi.fn(async () => undefined) } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test stub
        passwordPrisma as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test stub
        redis as any,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- collaborators the handlers do not reach
      const unused: any = {};
      const ctrl = new IdentityController(
        unused, unused, unused,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test stub
        signupSvc as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test stub
        authSec as any,
        passwordSvc,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test stub
        { client: {} } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test stub
        supabaseAdmin as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test stub
        redis as any,
      );
      // The bearer AuthMiddleware authenticated the request with: logout hands
      // it to SupabaseAdminService.signOut (CR-2, R0-ID-F4: auth-js
      // admin.signOut takes the access JWT, not the user id).
      const callerToken = jwt({ iat: NOW_S - 600, exp: NOW_S + 3000, session_id: 's-caller' });
      const req = { ip: '127.0.0.1', headers: { authorization: `Bearer ${callerToken}` }, socket: {} } as unknown as Request;
      return {
        callerToken,
        logout: () => ctrl.logout({ id: USER, email: 'st4@example.com' } as never, req),
        login: () => ctrl.login({ email: 'st4@example.com', password: 'pw' }, req),
        refresh: () => ctrl.refresh({ refreshToken: 'pre-logout-refresh-token' } as never, req),
        /** POST /identity/reset-password: public, no bearer; the body's access token is its only credential. */
        reset: (accessToken: string) =>
          ctrl.resetPassword(
            { accessToken, password: 'CorrectHorseBattery9!' } as never,
            { ip: '127.0.0.1', headers: {}, socket: {} } as unknown as Request,
          ),
        signupSvc,
        supabaseAdmin,
        authSec,
        passwordPrisma,
      };
    }

    /** A Supabase session access token as GoTrue mints it: minted now, carrying its session's id and authentication time. */
    const sessionToken = (sessionId: string, authenticatedAt: number, method = 'password') => () => {
      const iat = Math.floor(Date.now() / 1000);
      return jwt({ iat, exp: iat + 3600, session_id: sessionId, amr: [{ method, timestamp: authenticatedAt }] });
    };
    /** The access token in a recovery link: a session GoTrue authenticated by the recovery verification. */
    const recoveryToken = (sessionId: string, authenticatedAt: number) => sessionToken(sessionId, authenticatedAt, 'recovery')();

    it('ST4-R1 / F1: with the provider sign-out failing (signOut resolves false: provider down, or the refresh tokens otherwise left alive), a pre-logout session refreshed through the real POST /identity/refresh after the logout is refused, with no login in between; the next login is attached; the audit names the failed leg', async () => {
      const redis = memoryRedis();
      const { mw } = middleware(redis);
      let loginSessionStart = 0;
      const c = controller(redis, {
        signOut: async () => false,
        // Supabase refreshes the pre-logout session s-before (authenticated 10 minutes before the logout).
        refreshToken: sessionToken('s-before', NOW_S - 600),
        // The next login opens a new session, authenticated when it happens.
        loginToken: () => sessionToken('s-after', (loginSessionStart = Math.floor(Date.now() / 1000)))(),
      });
      const t1 = sessionToken('s-before', NOW_S - 600)();
      expect(await attached(mw, t1), 'T1 before logout').toBeTruthy();

      await c.logout();
      expect(c.supabaseAdmin.signOut).toHaveBeenCalledWith(c.callerToken, 'global');
      expect(c.supabaseAdmin.signOut).not.toHaveBeenCalledWith(USER, expect.anything());
      expect(await attached(mw, t1), 'T1 after logout').toBeUndefined();
      expect(c.authSec.audit).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'logout', outcome: 'success', reason: 'revocation_incomplete: provider_signout' }),
      );

      vi.setSystemTime(NOW_MS + 5_000);
      const refreshed = (await c.refresh()) as { accessToken: string };
      expect(c.signupSvc.refreshSession).toHaveBeenCalledTimes(1);
      expect(await attached(mw, refreshed.accessToken), 'pre-logout session refreshed after the logout').toBeUndefined();

      vi.setSystemTime(NOW_MS + 65_000);
      const again = (await c.refresh()) as { accessToken: string };
      expect(await attached(mw, again.accessToken), 'refreshed again a minute later').toBeUndefined();

      const out = (await c.login()) as { accessToken: string };
      expect(loginSessionStart).toBe(NOW_S + 65);
      expect(await attached(mw, out.accessToken), 'the next login').toEqual({ id: USER, email: 'st4@example.com', role: 'OWNER' });
      expect(await attached(mw, again.accessToken), 'the pre-logout session, after the next login').toBeUndefined();
    });

    it('a logout whose provider sign-out succeeds is audited without a reason; one whose marker write fails is audited as an error', async () => {
      const ok = controller(memoryRedis(), { signOut: async () => true });
      await ok.logout();
      expect(ok.authSec.audit).toHaveBeenCalledWith(expect.objectContaining({ event: 'logout', outcome: 'success', reason: undefined }));

      const broken = memoryRedis();
      broken.setex.mockRejectedValue(new Error('redis down'));
      const failing = controller(broken, { signOut: async () => false });
      await expect(failing.logout()).resolves.toEqual({ status: 'logged_out' });
      expect(failing.authSec.audit).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'logout',
          outcome: 'error',
          reason: 'revocation_incomplete: provider_signout, revocation_marker',
        }),
      );
    });

    it("F2: a bare '1' left by a logout 10 minutes before the deploy — the real login's token is attached, a session from before that logout stays refused", async () => {
      const KEY = `auth:revoked:user:${USER}`;
      const redis = memoryRedis({ [KEY]: '1' }, { [KEY]: DAY_S - 600 });
      const { mw } = middleware(redis);
      const c = controller(redis, { loginToken: () => sessionToken('s-new', Math.floor(Date.now() / 1000))() });
      const preLogout = sessionToken('s-old', NOW_S - 900)();
      expect(await attached(mw, preLogout), 'session from before the legacy logout').toBeUndefined();

      const out = (await c.login()) as { status: string; accessToken: string };
      expect(out.status).toBe('authenticated');
      expect(await attached(mw, out.accessToken), 'the login after the deploy').toEqual({ id: USER, email: 'st4@example.com', role: 'OWNER' });
      expect(await attached(mw, preLogout), 'session from before the legacy logout, after the login').toBeUndefined();
      expect(redis.store.get(KEY), 'login leaves the marker alone').toBe('1');
    });

    /**
     * Review finding ST4-R2 (R0-ID-F5-RESET-PASSWORD-RECOVERY). POST
     * /identity/reset-password is public: the access token in its body is the
     * only credential, and completeReset accepted any token Supabase verifies.
     * So a stolen pre-logout token the middleware refuses could still set a new
     * password and take the account over. The real logout handler, the real
     * reset handler and the real middleware, on one Redis keyspace.
     */
    describe('ST4-R2: POST /identity/reset-password honours the logout cutoff and accepts only a recovery session', () => {
      const auditOf = (c: ReturnType<typeof controller>, event: string) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- audit entries recorded by the stub
        c.authSec.audit.mock.calls.map((call: any[]) => call[0]).filter((e: { event: string }) => e.event === event);

      it('a recovery session opened BEFORE the logout cannot set the password after it, though Supabase still verifies its token; a recovery session opened after the logout can (positive control)', async () => {
        const redis = memoryRedis();
        const { mw } = middleware(redis);
        const c = controller(redis, { signOut: async () => true });
        const preLogoutRecovery = recoveryToken('s-recovery-before', NOW_S - 600);

        await c.logout();
        expect(await attached(mw, preLogoutRecovery), 'the middleware refuses it').toBeUndefined();
        await expect(c.reset(preLogoutRecovery), 'and so does the reset').rejects.toBeInstanceOf(UnauthorizedException);
        expect(c.supabaseAdmin.updateUserPassword).not.toHaveBeenCalled();
        expect(c.supabaseAdmin.signOut, 'only the logout reached the provider').toHaveBeenCalledTimes(1);
        expect(auditOf(c, 'password_reset_completed')).toEqual([expect.objectContaining({ outcome: 'failure' })]);

        vi.setSystemTime(NOW_MS + 5_000);
        const postLogoutRecovery = recoveryToken('s-recovery-after', NOW_S + 5);
        await expect(c.reset(postLogoutRecovery)).resolves.toMatchObject({ status: 'ok' });
        expect(c.supabaseAdmin.signOut).toHaveBeenLastCalledWith(postLogoutRecovery, 'global');
        expect(c.supabaseAdmin.updateUserPassword).toHaveBeenCalledWith(USER, 'CorrectHorseBattery9!');
        expect(auditOf(c, 'password_reset_completed')).toEqual([
          expect.objectContaining({ outcome: 'failure' }),
          expect.objectContaining({ outcome: 'success', userId: USER }),
        ]);
      });

      it('an ordinary session token is not a recovery session: neither a stolen pre-logout one nor one the middleware attaches (the next login) can set the password', async () => {
        const redis = memoryRedis();
        const { mw } = middleware(redis);
        const c = controller(redis, { loginToken: () => sessionToken('s-after', Math.floor(Date.now() / 1000))() });
        const stolen = sessionToken('s-before', NOW_S - 600)();

        await expect(c.reset(stolen), 'stolen password-session token, before any logout').rejects.toBeInstanceOf(UnauthorizedException);

        await c.logout();
        await expect(c.reset(stolen), 'the same token after the logout').rejects.toBeInstanceOf(UnauthorizedException);

        vi.setSystemTime(NOW_MS + 5_000);
        const out = (await c.login()) as { accessToken: string };
        expect(await attached(mw, out.accessToken), 'the next login is attached').toBeTruthy();
        await expect(c.reset(out.accessToken), 'but it is not a recovery session').rejects.toBeInstanceOf(UnauthorizedException);

        expect(c.supabaseAdmin.updateUserPassword).not.toHaveBeenCalled();
      });

      it('a recovery session of a deleted or banned user cannot set the password, as the middleware refuses its other tokens', async () => {
        for (const row of [
          { deletedAt: new Date(NOW_MS - 1000), bannedAt: null },
          { deletedAt: null, bannedAt: new Date(NOW_MS - 1000) },
        ]) {
          const c = controller(memoryRedis(), { userRow: row });
          await expect(c.reset(recoveryToken('s-recovery', NOW_S - 60))).rejects.toBeInstanceOf(UnauthorizedException);
          expect(c.passwordPrisma.client.user.findUnique).toHaveBeenCalledWith({
            where: { id: USER },
            select: { deletedAt: true, bannedAt: true },
          });
          expect(c.supabaseAdmin.updateUserPassword).not.toHaveBeenCalled();
        }
      });
    });

    it('logout writes the revocation time in epoch seconds, with a TTL at or above the longest token lifetime (24h)', async () => {
      const redis = memoryRedis();
      await controller(redis).logout();
      expect(redis.store.get(`auth:revoked:user:${USER}`)).toBe(String(NOW_S));
      expect(redis.ttl.get(`auth:revoked:user:${USER}`)).toBeGreaterThanOrEqual(DAY_S);
    });

    it('T1 (issued before logout) stays refused after the next login, while T2 (minted after logout) is attached', async () => {
      const redis = memoryRedis();
      const { mw } = middleware(redis);
      const { logout, login, signupSvc } = controller(redis);
      const t1 = jwt({ iat: NOW_S - 600, exp: NOW_S + 3000 });
      expect(await attached(mw, t1), 'T1 before logout').toBeTruthy();

      await logout();
      expect(await attached(mw, t1), 'T1 after logout').toBeUndefined();

      vi.setSystemTime(NOW_MS + 5_000);
      const out = await login();
      expect(signupSvc.signInWithPassword).toHaveBeenCalledTimes(1);
      expect(out).toMatchObject({ status: 'authenticated', accessToken: 'fresh' });

      expect(await attached(mw, t1), 'T1 after the next login (the stolen-token case)').toBeUndefined();
      const t2 = jwt({ iat: NOW_S + 5, exp: NOW_S + 3605 });
      expect(await attached(mw, t2), 'T2, issued by the next login').toEqual({ id: USER, email: 'st4@example.com', role: 'OWNER' });

      expect(redis.del, 'login no longer deletes the revocation marker').not.toHaveBeenCalled();
      expect(redis.store.get(`auth:revoked:user:${USER}`), 'the cutoff survives the login unchanged').toBe(String(NOW_S));
    });

    it("backward compatible: the next logout rewrites a bare flag ('1') left by the previous release in the new format", async () => {
      const redis = memoryRedis({ [`auth:revoked:user:${USER}`]: '1' });
      await controller(redis).logout();
      expect(redis.store.get(`auth:revoked:user:${USER}`)).toBe(String(NOW_S));
      expect(redis.ttl.get(`auth:revoked:user:${USER}`)).toBeGreaterThanOrEqual(DAY_S);
      const { mw } = middleware(redis);
      expect(await attached(mw, jwt({ iat: NOW_S + 1, exp: NOW_S + 3601 })), 'a token issued after the rewrite').toBeTruthy();
    });

    describe('admin tokens (ST-4, admin half): POST /identity/logout revokes them by issue time too', () => {
      const ADMIN_SECRET = 'auth-middleware-spec-st4-admin-secret-not-real';
      let priorSecret: string | undefined;
      beforeAll(() => {
        priorSecret = process.env.ADMIN_JWT_SECRET;
        process.env.ADMIN_JWT_SECRET = ADMIN_SECRET;
      });
      afterAll(() => {
        if (priorSecret === undefined) delete process.env.ADMIN_JWT_SECRET;
        else process.env.ADMIN_JWT_SECRET = priorSecret;
      });

      /** Supabase rejects every token here, so only the admin-token branch can attach. */
      function adminMiddleware(redis: MemoryRedis) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
        const supabaseAuth: any = { getUserFromToken: vi.fn().mockResolvedValue(null) };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
        const prisma: any = {
          client: { user: { findUnique: vi.fn().mockResolvedValue({ role: 'SUPER_ADMIN', deletedAt: null, bannedAt: null }) } },
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
        return new AuthMiddleware(supabaseAuth, prisma, redis as any);
      }

      it('an admin token issued before POST /identity/logout is refused, one issued after it is attached, and the next login brings the old one back neither', async () => {
        const redis = memoryRedis();
        const mw = adminMiddleware(redis);
        const { logout, login } = controller(redis);
        const admin = { id: USER, email: 'st4@example.com', role: 'SUPER_ADMIN' };
        const before = buildAdminToken(admin, ADMIN_SECRET); // iat = NOW_MS (milliseconds)
        expect(await attached(mw, before), 'pre-logout admin token before logout').toBeTruthy();

        vi.setSystemTime(NOW_MS + 1_000);
        await logout();
        expect(redis.store.get(`admin:user:${USER}:revokedAt`), 'the admin cutoff, in milliseconds like the admin token iat').toBe(
          String(NOW_MS + 1_000),
        );
        expect(redis.ttl.get(`admin:user:${USER}:revokedAt`), 'outlives every admin token issued before it (24h lifetime)').toBeGreaterThanOrEqual(DAY_S);
        expect(await attached(mw, before), 'pre-logout admin token after logout').toBeUndefined();

        vi.setSystemTime(NOW_MS + 2_000);
        const after = buildAdminToken(admin, ADMIN_SECRET);
        expect(await attached(mw, after), 'admin token issued after logout').toEqual({ id: USER, email: admin.email, role: 'SUPER_ADMIN' });

        await login();
        expect(await attached(mw, before), 'pre-logout admin token after the next login').toBeUndefined();
        expect(await attached(mw, after), 'post-logout admin token after the next login').toBeTruthy();
      });
    });
  });
});
