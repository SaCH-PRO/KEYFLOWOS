import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import { AuthMiddleware } from './auth.middleware';
import { buildAdminToken } from './admin-token.util';
import { IdentityController } from '../../modules/identity/identity.controller';

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

  /** One Redis keyspace shared by the writer (IdentityController) and the reader (AuthMiddleware). */
  function memoryRedis(initial: Record<string, string> = {}) {
    const store = new Map<string, string>(Object.entries(initial));
    const ttl = new Map<string, number>();
    return {
      store,
      ttl,
      get: vi.fn(async (k: string) => store.get(k) ?? null),
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

    it("backward compatible: the previous release's bare flag ('1') is a revocation at an unknown time, so every token issued up to now is refused", async () => {
      const { mw } = middleware(marker('1'));
      expect(await attached(mw, jwt({ iat: NOW_S - 3600, exp: NOW_S + 60 })), 'issued an hour ago').toBeUndefined();
      expect(await attached(mw, jwt({ iat: NOW_S, exp: NOW_S + 3600 })), 'issued this second').toBeUndefined();
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
    function controller(redis: MemoryRedis) {
      const authSec = { enforce: vi.fn(async () => undefined), audit: vi.fn(async () => undefined) };
      const signupSvc = {
        signInWithPassword: vi.fn(async () => ({ userId: USER, email: 'st4@example.com', accessToken: 'fresh', refreshToken: 'r' })),
      };
      const supabaseAdmin = { signOut: vi.fn(async () => undefined) };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- collaborators the two handlers do not reach
      const unused: any = {};
      const ctrl = new IdentityController(
        unused, unused, unused,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test stub
        signupSvc as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test stub
        authSec as any,
        unused,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test stub
        { client: {} } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test stub
        supabaseAdmin as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test stub
        redis as any,
      );
      const req = { ip: '127.0.0.1', headers: {}, socket: {} } as unknown as Request;
      return {
        logout: () => ctrl.logout({ id: USER, email: 'st4@example.com' } as never, req),
        login: () => ctrl.login({ email: 'st4@example.com', password: 'pw' }, req),
        signupSvc,
      };
    }

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
