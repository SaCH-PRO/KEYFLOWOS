import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import { UnauthorizedException } from '@nestjs/common';
import { AuthMiddleware, logoutRevocationCutoff, signInCutoffVerdict } from './auth.middleware';
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
    // D-97 (W8-RISC-SIGNIN-CUTOFF): the Supabase branch also reads metaData,
    // where a RISC event records the durable sign-in cutoff.
    expect(prisma.client.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user_real' },
      select: { role: true, deletedAt: true, bannedAt: true, metaData: true },
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
        sendRecoveryEmail: vi.fn(async (_email: string, _redirectTo: string) => undefined),
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
        passwordSvc,
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

      it("F5-CR-1 / F5-SEC-1: this app's implicit-flow recovery link (amr otp) resets after the forgot-password request; the reset then cuts off every pre-reset token at the middleware, the recovery token included, its replay cannot set the password again, and the next login is attached", async () => {
        const redis = memoryRedis();
        const { mw } = middleware(redis);
        const c = controller(redis, {
          signOut: async () => true,
          loginToken: () => sessionToken('s-after-reset', Math.floor(Date.now() / 1000))(),
        });
        const preReset = sessionToken('s-before', NOW_S - 600)();
        expect(await attached(mw, preReset), 'a pre-reset session is attached before the reset').toBeTruthy();

        await c.passwordSvc.requestReset('st4@example.com', 'https://app.test/auth/reset-password');
        expect(c.supabaseAdmin.sendRecoveryEmail).toHaveBeenCalledWith('st4@example.com', 'https://app.test/auth/reset-password');

        // GoTrue verifyGet, implicit branch: issueRefreshToken(..., models.OTP, ...).
        vi.setSystemTime(NOW_MS + 60_000);
        const implicitRecovery = jwt({
          iat: NOW_S + 60,
          exp: NOW_S + 3660,
          session_id: 's-implicit-recovery',
          aal: 'aal1',
          amr: [{ method: 'otp', timestamp: NOW_S + 60 }],
        });
        await expect(c.reset(implicitRecovery)).resolves.toMatchObject({ status: 'ok' });
        expect(c.supabaseAdmin.updateUserPassword).toHaveBeenCalledWith(USER, 'CorrectHorseBattery9!');
        expect(redis.store.get(`auth:revoked:user:${USER}`), 'the reset wrote the logout cutoff').toBe(String(NOW_S + 60));

        expect(await attached(mw, preReset), 'the pre-reset session is cut off').toBeUndefined();
        expect(await attached(mw, implicitRecovery), 'so is the recovery session').toBeUndefined();

        vi.setSystemTime(NOW_MS + 90_000);
        await expect(c.reset(implicitRecovery), 'replay').rejects.toBeInstanceOf(UnauthorizedException);
        expect(c.supabaseAdmin.updateUserPassword).toHaveBeenCalledTimes(1);

        const out = (await c.login()) as { accessToken: string };
        expect(await attached(mw, out.accessToken), 'the next login is attached').toBeTruthy();
        expect(auditOf(c, 'password_reset_completed')).toEqual([
          expect.objectContaining({ outcome: 'success', userId: USER }),
          expect.objectContaining({ outcome: 'failure' }),
        ]);
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

/**
 * D-97 (W8-RISC-SIGNIN-CUTOFF; owner ruling, resolves D-39): a RISC
 * session-ending event records a durable per-user sign-in cutoff on the User
 * row (User.metaData.signInCutoffAt, epoch seconds; risc.service.ts). The
 * middleware refuses every Supabase token whose ORIGINAL sign-in — the
 * session's amr timestamps, which a refresh carries over — is at or before it,
 * with or without the 24h Redis logout marker, and attaches a session that
 * signed in after it: the real user simply signs in again.
 */
describe('D-97 — the durable RISC sign-in cutoff on the User row', () => {
  const USER = 'user_d97';
  const b64url = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const NOW = Math.floor(Date.now() / 1000);
  const CUTOFF = NOW - 600;
  const token = (claims: Record<string, unknown>) =>
    `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: USER, role: 'authenticated', ...claims })}.c2ln`;
  // A Google session as GoTrue mints it: amr 'oauth' and the server-set
  // app_metadata naming Google. D-101 (W9-RISC-PASSWORD-CUTOFF) reads that
  // claim, since GoTrue's amr entry never names the OAuth provider; a session
  // opened after a cutoff is admitted only when it is a Google or emailed-link
  // sign-in (see the D-101 block below).
  const session = (signedInAt: number, iat: number) =>
    token({
      session_id: 's-d97',
      iat,
      exp: iat + 3600,
      amr: [{ method: 'oauth', timestamp: signedInAt }],
      app_metadata: { provider: 'google', providers: ['google'] },
    });

  function middleware(metaData: unknown, opts: { marker?: string | null } = {}) {
    const supabaseAuth = { getUserFromToken: vi.fn().mockResolvedValue({ id: USER, email: 'd97@example.com' }) };
    const prisma = {
      client: { user: { findUnique: vi.fn().mockResolvedValue({ role: 'USER', deletedAt: null, bannedAt: null, metaData }) } },
    };
    const redis = { get: vi.fn(async () => opts.marker ?? null), pttl: vi.fn(async () => -2), set: vi.fn(async () => 'OK') };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test doubles
    const mw = new AuthMiddleware(supabaseAuth as any, prisma as any, redis as any);
    return async (bearer: string) => {
      const req = makeReq({ headers: { authorization: `Bearer ${bearer}` } });
      await mw.use(req, res, next);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inspecting augmented Request
      return ((req as any).user?.id as string | undefined) ?? null;
    };
  }

  it('D-97: refuses a token minted after the cutoff (a refresh) whose session signed in before it, with no Redis logout marker at all', async () => {
    const attached = middleware({ signInCutoffAt: CUTOFF });
    expect(await attached(session(CUTOFF - 3600, NOW))).toBeNull();
  });

  it('D-97: refuses a session that signed in exactly at the cutoff second (at or before, as the logout marker)', async () => {
    const attached = middleware({ signInCutoffAt: CUTOFF });
    expect(await attached(session(CUTOFF, NOW))).toBeNull();
  });

  it('D-97: attaches a session that signed in after the cutoff — the real user signing in again', async () => {
    const attached = middleware({ signInCutoffAt: CUTOFF, googleSignInDisabled: true });
    expect(await attached(session(CUTOFF + 1, NOW))).toBe(USER);
  });

  it('D-97: refuses, while a cutoff is set, a session token that cannot say when it signed in (session_id, no usable amr); the same token is attached when no cutoff is set', async () => {
    const noAmr = token({ session_id: 's-d97', iat: NOW, exp: NOW + 3600 });
    expect(await middleware({ signInCutoffAt: CUTOFF })(noAmr)).toBeNull();
    expect(await middleware({})(noAmr)).toBe(USER);
  });

  it('D-97: the durable cutoff holds on its own once the 24h Redis marker has lapsed, and with a marker older than it the later of the two decides', async () => {
    const older = String(CUTOFF - 7200);
    const attached = middleware({ signInCutoffAt: CUTOFF }, { marker: older });
    // After the old marker, before the durable cutoff: refused by the cutoff.
    expect(await attached(session(CUTOFF - 3600, NOW))).toBeNull();
    expect(await attached(session(CUTOFF + 1, NOW))).toBe(USER);
  });

  it.each([
    ['no metaData', null],
    ['metaData without a cutoff', { googleSignInDisabled: false }],
    ['a cutoff that is not a number', { signInCutoffAt: 'yesterday' }],
    ['metaData that is not an object', ['signInCutoffAt', CUTOFF]],
  ] as Array<[string, unknown]>)('D-97: a user row with %s is unaffected: a long-lived session is attached', async (_name, metaData) => {
    expect(await middleware(metaData)(session(CUTOFF - 3600, NOW))).toBe(USER);
  });

  it('D-97: the admin-token branch is not judged by the Supabase sign-in cutoff (its own 24h admin:user:<id>:revokedAt cutoff covers an admin token for its whole life)', async () => {
    const prevSecret = process.env.ADMIN_JWT_SECRET;
    process.env.ADMIN_JWT_SECRET = 'd97-admin-secret-not-real';
    try {
      const supabaseAuth = { getUserFromToken: vi.fn().mockResolvedValue(null) };
      const prisma = {
        client: {
          user: {
            findUnique: vi.fn().mockResolvedValue({ role: 'SUPER_ADMIN', deletedAt: null, bannedAt: null, metaData: { signInCutoffAt: NOW + 3600 } }),
          },
        },
      };
      const redis = { get: vi.fn(async () => null), set: vi.fn(async () => 'OK') };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test doubles
      const mw = new AuthMiddleware(supabaseAuth as any, prisma as any, redis as any);
      const admin = buildAdminToken({ id: USER, email: 'd97@example.com', role: 'SUPER_ADMIN' }, 'd97-admin-secret-not-real');
      const req = makeReq({ headers: { authorization: `Bearer ${admin}` } });
      await mw.use(req, res, next);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inspecting augmented Request
      expect((req as any).user).toEqual({ id: USER, email: 'd97@example.com', role: 'SUPER_ADMIN' });
      expect(prisma.client.user.findUnique).toHaveBeenCalledWith({ where: { id: USER }, select: { role: true, deletedAt: true, bannedAt: true } });
    } finally {
      if (prevSecret === undefined) delete process.env.ADMIN_JWT_SECRET;
      else process.env.ADMIN_JWT_SECRET = prevSecret;
    }
  });
});

/**
 * D-101 (W9-RISC-PASSWORD-CUTOFF; owner ruling, narrows SEC-W8RSC-4, review
 * SEC-W9RPC-2): after a D-97 sign-in cutoff the account accepts only a NEW
 * sign-in made with Google
 * or an emailed link, methods an attacker cannot produce from a stolen
 * refresh token or a known password. A session opened after the cutoff with
 * any other method (a password above all; anything not in the allow list:
 * fail closed) is refused until the real user has signed in once with Google
 * or the emailed link. That session CLEARS the restriction: the middleware
 * records User.metaData.signInCutoffClearedAt (when it records the clearing,
 * or the session's sign-in when that is later: review CR-W9RPC-3), once,
 * under the User row lock RiscService takes. From then on a session
 * authenticated AFTER the clearing is admitted by any method, while a session
 * authenticated between the cutoff and the clearing (the hijacker's password
 * session) stays refused.
 *
 * GoTrue's amr methods (supabase/auth internal/models/factor.go), and what
 * D-101 reads them as:
 *   oauth          an OAuth provider; GoTrue never names it in the entry, so
 *                  it is Google only when the token's server-set
 *                  app_metadata names Google as the user's only external
 *                  provider (the web's only OAuth door is provider=google).
 *   otp            the implicit flow's verification of an emailed link or
 *                  code (magic link, email OTP, signup, recovery, invite);
 *                  GoTrue also stamps an SMS code 'otp', so it counts only for
 *                  a user with no phone identity.
 *   magiclink, email/signup, recovery, invite
 *                  the PKCE flow's emailed links. A password-recovery link is
 *                  an emailed link: GoTrue marks it 'recovery' (PKCE) or 'otp'
 *                  (implicit, the same as a magic link).
 *   anything else  refused: password, totp, mfa/*, sso/saml, anonymous,
 *                  web3, passkey, token_refresh, email_change (its link goes
 *                  to the NEW address), or a method this list does not know.
 * The session's ORIGINAL sign-in (its earliest amr entry, what D-97's
 * sessionAuthenticatedAt reads) is the one judged: an MFA step-up later in
 * the session does not change how it signed in.
 */
describe('D-101 — after a RISC sign-in cutoff only a Google or emailed-link sign-in is accepted until it clears', () => {
  const USER = 'user_d101';
  const b64url = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const NOW = Math.floor(Date.now() / 1000);
  const CUTOFF = NOW - 3600;
  /** GoTrue's app_metadata for a user with a password and a linked Google identity. */
  const BOTH = { provider: 'email', providers: ['email', 'google'] };
  type AmrEntry = Record<string, unknown> | string;
  const token = (claims: Record<string, unknown>) =>
    `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: USER, role: 'authenticated', ...claims })}.c2ln`;
  /** An access token of a session whose amr is `amr`, minted at `iat`. app_metadata omitted when `appMeta` is null. */
  const signedIn = (amr: AmrEntry[], appMeta: unknown = BOTH, iat = NOW, sessionId = 's-d101') =>
    token({ session_id: sessionId, iat, exp: iat + 3600, amr, ...(appMeta === null ? {} : { app_metadata: appMeta }) });
  const by = (method: string, at: number, appMeta: unknown = BOTH) => signedIn([{ method, timestamp: at }], appMeta);
  const password = (at: number) => by('password', at);
  const google = (at: number) => by('oauth', at);
  const LOCK = `lock SELECT id FROM users WHERE id = ? FOR NO KEY UPDATE [${USER}]`;
  /** A session that signed in with `method` at `t`, its token minted then too (so its authentication time is `t`). */
  const fresh = (method: string, t: number) => signedIn([{ method, timestamp: t }], BOTH, t);

  // D-101 review CR-W9RPC-3: the cleared marker is dated when the middleware
  // records it, or at the session's sign-in when that is later. The clock is
  // held at NOW so the recorded time is exact.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW * 1000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * The real AuthMiddleware over one in-memory User row. Its metaData writes
   * go through the interactive transaction (recorded as begin / lock / read /
   * write / commit); `beforeLockedRead` changes the row the moment the lock is
   * taken (a RISC event that committed in between); `failWrites` makes that
   * many writes throw.
   */
  function harness(
    metaData: Record<string, unknown>,
    opts: { failWrites?: number; beforeLockedRead?: (meta: Record<string, unknown>) => Record<string, unknown> } = {},
  ) {
    const row = { role: 'USER', deletedAt: null as Date | null, bannedAt: null as Date | null, metaData: { ...metaData } };
    const steps: string[] = [];
    let failWrites = opts.failWrites ?? 0;
    let inTx = false;
    const client = {
      user: {
        findUnique: vi.fn(async () => {
          if (inTx) steps.push('read');
          return { ...row, metaData: { ...row.metaData } };
        }),
        update: vi.fn(async (args: { where: { id: string }; data: { metaData?: Record<string, unknown> } }) => {
          steps.push('write');
          if (failWrites > 0) {
            failWrites--;
            throw new Error('simulated database error');
          }
          if (args.data.metaData) row.metaData = { ...args.data.metaData };
          return undefined;
        }),
      },
      $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        steps.push(`lock ${strings.join('?').replace(/\s+/g, ' ').trim()} [${values.join(',')}]`);
        if (opts.beforeLockedRead) row.metaData = opts.beforeLockedRead({ ...row.metaData });
        return [];
      }),
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        steps.push('begin');
        inTx = true;
        try {
          const out = await fn(client);
          steps.push('commit');
          return out;
        } catch (err) {
          steps.push('rollback');
          throw err;
        } finally {
          inTx = false;
        }
      }),
    };
    const supabaseAuth = { getUserFromToken: vi.fn().mockResolvedValue({ id: USER, email: 'd101@example.com' }) };
    const redis = { get: vi.fn(async () => null), pttl: vi.fn(async () => -2), set: vi.fn(async () => 'OK') };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test doubles
    const mw = new AuthMiddleware(supabaseAuth as any, { client } as any, redis as any);
    const logger = { warn: vi.fn(), log: vi.fn(), debug: vi.fn(), error: vi.fn() };
    (mw as unknown as { logger: unknown }).logger = logger;
    const attached = async (bearer: string) => {
      const req = makeReq({ headers: { authorization: `Bearer ${bearer}` } });
      await mw.use(req, res, next);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- inspecting augmented Request
      return ((req as any).user?.id as string | undefined) ?? null;
    };
    return { row, steps, attached, client, logger };
  }

  it('D-101: a password session authenticated after the cutoff is refused (no user attached: the 401 every guarded route answers) and nothing is written', async () => {
    const h = harness({ signInCutoffAt: CUTOFF });
    expect(await h.attached(password(CUTOFF + 60))).toBeNull();
    expect(await h.attached(password(NOW))).toBeNull();
    expect(h.client.$transaction).not.toHaveBeenCalled();
    expect(h.row.metaData).toEqual({ signInCutoffAt: CUTOFF });
  });

  it('D-101: a Google session authenticated after the cutoff is admitted and records signInCutoffClearedAt (the time the middleware records it, CR-W9RPC-3) once, in one transaction that first takes the User row lock', async () => {
    const h = harness({ signInCutoffAt: CUTOFF, googleSignInDisabled: true });
    expect(await h.attached(google(CUTOFF + 120))).toBe(USER);
    expect(h.row.metaData).toEqual({ signInCutoffAt: CUTOFF, googleSignInDisabled: true, signInCutoffClearedAt: NOW });
    expect(h.steps).toEqual(['begin', LOCK, 'read', 'write', 'commit']);
  });

  it.each([
    ['otp (implicit flow: a magic link, an email code, a recovery link)', 'otp'],
    ['magiclink (PKCE magic link)', 'magiclink'],
    ['email/signup (PKCE signup confirmation link)', 'email/signup'],
    ['recovery (PKCE password-recovery link)', 'recovery'],
    ['invite (PKCE invite link)', 'invite'],
  ])('D-101: an emailed-link session — %s — clears the restriction like Google', async (_name, method) => {
    const h = harness({ signInCutoffAt: CUTOFF });
    expect(await h.attached(by(method, CUTOFF + 30, { provider: 'email', providers: ['email'] }))).toBe(USER);
    expect(h.row.metaData).toEqual({ signInCutoffAt: CUTOFF, signInCutoffClearedAt: NOW });
  });

  it.each([
    ['password', 'password'],
    ['totp', 'totp'],
    ['mfa/phone', 'mfa/phone'],
    ['mfa/webauthn', 'mfa/webauthn'],
    ['sso/saml', 'sso/saml'],
    ['anonymous', 'anonymous'],
    ['web3', 'web3'],
    ['passkey', 'passkey'],
    ['token_refresh', 'token_refresh'],
    ['email_change (its link goes to the NEW address)', 'email_change'],
    ['oauth_provider/authorization_code', 'oauth_provider/authorization_code'],
    ['a method GoTrue does not define', 'carrier-pigeon'],
    ['an empty method', ''],
  ])('D-101: a session opened after the cutoff by %s is refused (fail closed) and writes nothing', async (_name, method) => {
    const h = harness({ signInCutoffAt: CUTOFF });
    expect(await h.attached(by(method, CUTOFF + 30))).toBeNull();
    expect(h.client.$transaction).not.toHaveBeenCalled();
    expect(h.row.metaData).toEqual({ signInCutoffAt: CUTOFF });
  });

  it.each([
    ['no app_metadata at all', [{ method: 'oauth', timestamp: CUTOFF + 30 }], null],
    ['app_metadata naming no external provider', [{ method: 'oauth', timestamp: CUTOFF + 30 }], { provider: 'email', providers: ['email'] }],
    ['app_metadata naming another OAuth provider too', [{ method: 'oauth', timestamp: CUTOFF + 30 }], { provider: 'google', providers: ['google', 'github'] }],
    ['app_metadata naming only another OAuth provider', [{ method: 'oauth', timestamp: CUTOFF + 30 }], { provider: 'github', providers: ['github'] }],
    ['an amr entry naming another provider', [{ method: 'oauth', timestamp: CUTOFF + 30, provider: 'github' }], BOTH],
    ['an RFC-8176 string amr (no timestamp)', ['oauth'], BOTH],
  ] as Array<[string, AmrEntry[], unknown]>)('D-101: an oauth sign-in that does not show it was Google is refused — %s', async (_name, amr, appMeta) => {
    const h = harness({ signInCutoffAt: CUTOFF });
    expect(await h.attached(signedIn(amr, appMeta))).toBeNull();
    expect(h.client.$transaction).not.toHaveBeenCalled();
  });

  it('D-101: an otp session is an emailed link only for a user with no phone identity (GoTrue stamps an SMS code otp too), and only when app_metadata says so', async () => {
    const phone = harness({ signInCutoffAt: CUTOFF });
    expect(await phone.attached(by('otp', CUTOFF + 30, { provider: 'phone', providers: ['email', 'phone'] }))).toBeNull();
    const unknown = harness({ signInCutoffAt: CUTOFF });
    expect(await unknown.attached(by('otp', CUTOFF + 30, null))).toBeNull();
    expect(phone.client.$transaction).not.toHaveBeenCalled();
    expect(unknown.client.$transaction).not.toHaveBeenCalled();
  });

  it("D-101: the session's ORIGINAL sign-in decides — a password session stepped up with TOTP stays refused, a Google session stepped up with TOTP is admitted", async () => {
    const h = harness({ signInCutoffAt: CUTOFF });
    // GoTrue lists the most recent entry first.
    const stepped = (first: string) =>
      signedIn([
        { method: 'totp', timestamp: CUTOFF + 90 },
        { method: first, timestamp: CUTOFF + 30 },
      ]);
    expect(await h.attached(stepped('password'))).toBeNull();
    expect(h.row.metaData.signInCutoffClearedAt).toBeUndefined();
    expect(await h.attached(stepped('oauth'))).toBe(USER);
    expect(h.row.metaData.signInCutoffClearedAt).toBe(NOW);
  });

  it('D-101: a token with no session and no amr (its iat stands for its sign-in) is refused after the cutoff: it cannot say how it signed in', async () => {
    const h = harness({ signInCutoffAt: CUTOFF });
    expect(await h.attached(token({ iat: NOW, exp: NOW + 3600, app_metadata: BOTH }))).toBeNull();
    expect(h.client.$transaction).not.toHaveBeenCalled();
  });

  // D-113 (W10-RISC-RESET) amends this case: under D-101 as first worded a
  // password session after the clearing was admitted; it now waits for a
  // password reset after the cutoff (see the D-113 block below), while the
  // rest of the restriction (any other method) is cleared as before.
  it('D-101, amended by D-113 (W10-RISC-RESET): once cleared, a session of another method authenticated after the clearing is admitted, a password session after it is still refused without a password reset, and one authenticated between the cutoff and the clearing (or in the clearing second) stays refused; nothing more is written', async () => {
    const CLEARED = CUTOFF + 600;
    const h = harness({ signInCutoffAt: CUTOFF, signInCutoffClearedAt: CLEARED });
    expect(await h.attached(by('passkey', CLEARED + 1))).toBe(USER);
    expect(await h.attached(password(CLEARED + 1))).toBeNull();
    expect(await h.attached(by('passkey', CUTOFF + 300))).toBeNull();
    expect(await h.attached(password(CUTOFF + 300))).toBeNull();
    expect(await h.attached(by('passkey', CLEARED))).toBeNull();
    expect(await h.attached(password(CLEARED))).toBeNull();
    // Still refused by D-97: signed in before the cutoff.
    expect(await h.attached(google(CUTOFF - 60))).toBeNull();
    expect(h.client.$transaction).not.toHaveBeenCalled();
    expect(h.row.metaData).toEqual({ signInCutoffAt: CUTOFF, signInCutoffClearedAt: CLEARED });
  });

  it('D-101: the marker is written once — a later qualifying session (earlier or later than the clearing) is admitted and writes nothing', async () => {
    const h = harness({ signInCutoffAt: CUTOFF });
    expect(await h.attached(google(CUTOFF + 600))).toBe(USER);
    expect(await h.attached(google(CUTOFF + 300))).toBe(USER);
    expect(await h.attached(by('otp', CUTOFF + 900))).toBe(USER);
    expect(h.client.user.update).toHaveBeenCalledTimes(1);
    expect(h.row.metaData).toEqual({ signInCutoffAt: CUTOFF, signInCutoffClearedAt: NOW });
  });

  it('D-101: two qualifying requests that both read no marker write it once — the second re-reads the row under the lock and finds it', async () => {
    const h = harness({ signInCutoffAt: CUTOFF });
    // The second request's unlocked read happened before the first committed.
    const stale = { ...h.row, metaData: { signInCutoffAt: CUTOFF } };
    expect(await h.attached(google(CUTOFF + 600))).toBe(USER);
    h.client.user.findUnique.mockImplementationOnce(async () => stale);
    expect(await h.attached(google(CUTOFF + 700))).toBe(USER);
    expect(h.client.$transaction).toHaveBeenCalledTimes(2);
    expect(h.client.user.update).toHaveBeenCalledTimes(1);
    expect(h.row.metaData).toEqual({ signInCutoffAt: CUTOFF, signInCutoffClearedAt: NOW });
  });

  it('D-101: a cleared marker that is not after the current cutoff (left by an earlier cutoff) clears nothing — a password session after the cutoff is refused', async () => {
    const h = harness({ signInCutoffAt: CUTOFF, signInCutoffClearedAt: CUTOFF - 60 });
    expect(await h.attached(password(CUTOFF + 30))).toBeNull();
    // A Google session then replaces it with one that belongs to this cutoff.
    expect(await h.attached(google(CUTOFF + 30))).toBe(USER);
    expect(h.row.metaData).toEqual({ signInCutoffAt: CUTOFF, signInCutoffClearedAt: NOW });
  });

  it('D-101: when the clearing write fails the qualifying session is still admitted (logged), and the next request retries the write', async () => {
    const h = harness({ signInCutoffAt: CUTOFF }, { failWrites: 1 });
    expect(await h.attached(google(CUTOFF + 120))).toBe(USER);
    expect(h.row.metaData.signInCutoffClearedAt).toBeUndefined();
    expect(h.logger.warn.mock.calls.some((c) => String(c[0]).includes(USER))).toBe(true);
    // Until the marker holds, a password session is still refused.
    expect(await h.attached(password(CUTOFF + 300))).toBeNull();
    expect(await h.attached(google(CUTOFF + 120))).toBe(USER);
    expect(h.row.metaData.signInCutoffClearedAt).toBe(NOW);
    expect(h.client.user.update).toHaveBeenCalledTimes(2);
  });

  it('D-101: the write re-reads the row under the lock — a cutoff a new RISC event raised past the session meanwhile is not cleared, and that session is refused', async () => {
    const h = harness({ signInCutoffAt: CUTOFF }, { beforeLockedRead: (meta) => ({ ...meta, signInCutoffAt: NOW + 5 }) });
    expect(await h.attached(google(CUTOFF + 120))).toBeNull();
    expect(h.client.user.update).not.toHaveBeenCalled();
    expect(h.row.metaData).toEqual({ signInCutoffAt: NOW + 5 });
  });

  it('D-101 review CR-W9RPC-3: the clearing is dated when the middleware records it — a password session opened after the Google sign-in at GoTrue, and refused before that Google session first reached the API, stays refused after it', async () => {
    const h = harness({ signInCutoffAt: CUTOFF });
    const hijacker = password(CUTOFF + 200);
    expect(await h.attached(hijacker)).toBeNull();
    // The real user's Google session signed in at CUTOFF + 100 (another
    // device, or an app in the background) and reaches the API only now.
    expect(await h.attached(google(CUTOFF + 100))).toBe(USER);
    expect(h.row.metaData).toEqual({ signInCutoffAt: CUTOFF, signInCutoffClearedAt: NOW });
    // Dated at the Google sign-in (CUTOFF + 100) the marker would admit it now.
    expect(await h.attached(hijacker)).toBeNull();
    expect(await h.attached(signedIn([{ method: 'password', timestamp: CUTOFF + 200 }], BOTH, NOW + 30))).toBeNull();
    expect(await h.attached(fresh('password', NOW))).toBeNull();
    expect(await h.attached(fresh('passkey', NOW))).toBeNull();
    // A session of another method opened after the clearing was recorded is
    // admitted; a password one still waits for a password reset (D-113,
    // W10-RISC-RESET; it was admitted here under D-101 as first worded).
    expect(await h.attached(fresh('passkey', NOW + 1))).toBe(USER);
    expect(await h.attached(fresh('password', NOW + 1))).toBeNull();
    expect(h.client.user.update).toHaveBeenCalledTimes(1);
  });

  it("D-101 review CR-W9RPC-3: a qualifying sign-in the provider dates after this server's clock dates the clearing at that sign-in (the later of the two)", async () => {
    const h = harness({ signInCutoffAt: CUTOFF });
    expect(await h.attached(fresh('oauth', NOW + 20))).toBe(USER);
    expect(h.row.metaData).toEqual({ signInCutoffAt: CUTOFF, signInCutoffClearedAt: NOW + 20 });
    expect(await h.attached(fresh('passkey', NOW + 20))).toBeNull();
    expect(await h.attached(fresh('passkey', NOW + 21))).toBe(USER);
    // D-113 (W10-RISC-RESET): a password session waits for a password reset.
    expect(await h.attached(fresh('password', NOW + 21))).toBeNull();
  });

  /**
   * D-113 (W10-RISC-RESET; owner ruling, extends D-101: reviews SEC-W9RPC-1/2).
   * After a cutoff a PASSWORD session is admitted only when it was
   * authenticated after the password reset the user completed through KEYFLOW
   * after the cutoff (User.metaData.passwordResetAfterCutoffAt, which
   * IdentityPasswordService.completeReset records under the User row lock); a
   * Google or emailed-link sign-in clears only the rest of the restriction. A
   * session whose sign-in method cannot be read counts as a password one
   * (fail closed).
   */
  it('D-113 (W10-RISC-RESET): a password session after the cutoff is admitted only when authenticated after passwordResetAfterCutoffAt, with or without a clearing — before the reset, or in its second, it stays refused; nothing is written', async () => {
    const RESET = CUTOFF + 900;
    const cleared = harness({ signInCutoffAt: CUTOFF, signInCutoffClearedAt: CUTOFF + 600, passwordResetAfterCutoffAt: RESET });
    expect(await cleared.attached(password(RESET + 1))).toBe(USER);
    expect(await cleared.attached(password(RESET))).toBeNull();
    expect(await cleared.attached(password(CUTOFF + 700))).toBeNull();
    // A reset whose clearing was not recorded still admits the password session after it.
    const resetOnly = harness({ signInCutoffAt: CUTOFF, passwordResetAfterCutoffAt: RESET });
    expect(await resetOnly.attached(password(RESET + 1))).toBe(USER);
    expect(await resetOnly.attached(password(RESET - 1))).toBeNull();
    // ... but not the rest of the restriction: another method waits for a clearing.
    expect(await resetOnly.attached(by('passkey', RESET + 1))).toBeNull();
    expect(cleared.client.$transaction).not.toHaveBeenCalled();
    expect(resetOnly.client.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['not after the current cutoff (left by an earlier cutoff)', CUTOFF - 60],
    ['exactly the cutoff second', CUTOFF],
    ['not a number', 'yesterday'],
  ] as Array<[string, unknown]>)('D-113 (W10-RISC-RESET): a password reset record %s admits no password session', async (_name, resetAt) => {
    const h = harness({ signInCutoffAt: CUTOFF, signInCutoffClearedAt: CUTOFF + 600, passwordResetAfterCutoffAt: resetAt });
    expect(await h.attached(password(CUTOFF + 601))).toBeNull();
    expect(await h.attached(password(NOW))).toBeNull();
  });

  it('D-113 (W10-RISC-RESET): a session whose sign-in method cannot be read counts as a password sign-in — a token with no session and no amr is refused after a clearing until a reset', async () => {
    const noAmr = token({ iat: NOW, exp: NOW + 3600, app_metadata: BOTH });
    expect(await harness({ signInCutoffAt: CUTOFF, signInCutoffClearedAt: CUTOFF + 600 }).attached(noAmr)).toBeNull();
    expect(
      await harness({ signInCutoffAt: CUTOFF, signInCutoffClearedAt: CUTOFF + 600, passwordResetAfterCutoffAt: CUTOFF + 900 }).attached(noAmr),
    ).toBe(USER);
  });

  it("D-113 (W10-RISC-RESET): the session's ORIGINAL sign-in decides — a password session stepped up with TOTP after the reset is admitted only when the password sign-in itself came after the reset", async () => {
    const RESET = CUTOFF + 900;
    const h = harness({ signInCutoffAt: CUTOFF, signInCutoffClearedAt: CUTOFF + 600, passwordResetAfterCutoffAt: RESET });
    // GoTrue lists the most recent entry first.
    const stepped = (passwordAt: number) =>
      signedIn([
        { method: 'totp', timestamp: RESET + 100 },
        { method: 'password', timestamp: passwordAt },
      ]);
    expect(await h.attached(stepped(RESET + 10))).toBe(USER);
    expect(await h.attached(stepped(RESET - 10))).toBeNull();
  });

  it('D-113 (W10-RISC-RESET): signInCutoffVerdict names why a session is refused — password_reset_required, google_or_email_link_required, signed_in_before_cutoff — and is null without a cutoff', () => {
    const meta = { signInCutoffAt: CUTOFF, signInCutoffClearedAt: CUTOFF + 600 };
    expect(signInCutoffVerdict(meta, password(CUTOFF + 700))).toEqual({ admitted: false, refusal: 'password_reset_required' });
    expect(signInCutoffVerdict({ signInCutoffAt: CUTOFF }, by('passkey', CUTOFF + 30))).toEqual({
      admitted: false,
      refusal: 'google_or_email_link_required',
    });
    expect(signInCutoffVerdict(meta, password(CUTOFF - 1))).toEqual({ admitted: false, refusal: 'signed_in_before_cutoff' });
    expect(signInCutoffVerdict({ signInCutoffAt: CUTOFF }, google(CUTOFF + 30))).toEqual({ admitted: true, clearingAt: CUTOFF + 30 });
    expect(signInCutoffVerdict(meta, google(CUTOFF + 30))).toEqual({ admitted: true, clearingAt: null });
    expect(signInCutoffVerdict({ ...meta, passwordResetAfterCutoffAt: CUTOFF + 900 }, password(CUTOFF + 901))).toEqual({
      admitted: true,
      clearingAt: null,
    });
    expect(signInCutoffVerdict({ googleSignInDisabled: true }, password(NOW))).toBeNull();
  });

  it('D-101 negative control: with no cutoff on the row a password session is admitted and nothing is written', async () => {
    const h = harness({ googleSignInDisabled: false });
    expect(await h.attached(password(NOW - 86_400))).toBe(USER);
    expect(h.client.$transaction).not.toHaveBeenCalled();
  });
});
