import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { Request, Response } from 'express';
import { AuthMiddleware } from './auth.middleware';
import { buildAdminToken } from './admin-token.util';

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
   * resolveLocalUser checks, so a deleted, banned or logged-out admin kept
   * access and a demoted one kept SUPER_ADMIN. It now runs the same
   * resolveLocalUser path, takes the role from the User row, and — unlike a
   * Supabase token — refuses a subject with no User row (no bootstrap window
   * for an admin identity).
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
     * answers per key: the admin-token jti / revokedAt keys are never revoked
     * here, so a refusal can only come from the local-user checks under test.
     */
    function adminMiddleware(opts: {
      row?: { role: string; deletedAt: Date | null; bannedAt: Date | null } | null;
      userRevoked?: boolean;
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
        get: vi.fn(async (key: string) => (key === `auth:revoked:user:${ADMIN.id}` && opts.userRevoked ? '1' : null)),
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

    it('does not attach when the logout revocation marker is present', async () => {
      const { mw, redis } = adminMiddleware({ userRevoked: true });
      expect(await run(mw)).toBeUndefined();
      expect(redis.get).toHaveBeenCalledWith(`auth:revoked:user:${ADMIN.id}`);
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
