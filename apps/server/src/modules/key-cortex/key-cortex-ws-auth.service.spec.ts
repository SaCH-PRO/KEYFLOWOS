import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import { KeyCortexWsAuthService, isAllowedWsOrigin } from './key-cortex-ws-auth.service';
import { buildAdminToken } from '../../core/auth/admin-token.util';
import { AuthMiddleware } from '../../core/auth/auth.middleware';
import { KeyCortexGateway } from './key-cortex.gateway';

/** Build a minimal fake Socket with a controllable handshake. */
function fakeSocket(opts: {
  authToken?: string;
  header?: string;
  queryUserId?: string;
}): any {
  return {
    id: 'sock_1',
    handshake: {
      auth: opts.authToken ? { token: opts.authToken } : {},
      headers: opts.header ? { authorization: opts.header } : {},
      query: opts.queryUserId ? { userId: opts.queryUserId } : {},
    },
  };
}

describe('KeyCortexWsAuthService', () => {
  let supabaseAuth: { getUserFromToken: ReturnType<typeof vi.fn> };
  let prisma: any;
  let service: KeyCortexWsAuthService;

  beforeEach(() => {
    supabaseAuth = { getUserFromToken: vi.fn() };
    prisma = {
      client: {
        user: { findUnique: vi.fn().mockResolvedValue({ role: 'USER' }) },
        business: { findFirst: vi.fn() },
      },
    };
    // redis undefined is fine — admin-token util treats it as "no revocation store".
    service = new KeyCortexWsAuthService(supabaseAuth as any, prisma as any, undefined as any);
  });

  describe('authenticateSocket', () => {
    it('accepts a valid Supabase JWT and derives identity from the token', async () => {
      supabaseAuth.getUserFromToken.mockResolvedValue({ id: 'u1', email: 'a@b.co' });
      const result = await service.authenticateSocket(fakeSocket({ authToken: 'valid.jwt' }));
      expect(result).toEqual({ userId: 'u1', email: 'a@b.co', role: 'USER' });
      expect(supabaseAuth.getUserFromToken).toHaveBeenCalledWith('valid.jwt');
    });

    it('resolves role from the database, not the token', async () => {
      supabaseAuth.getUserFromToken.mockResolvedValue({ id: 'u1', email: 'a@b.co' });
      prisma.client.user.findUnique.mockResolvedValue({ role: 'SUPER_ADMIN' });
      const result = await service.authenticateSocket(fakeSocket({ authToken: 'valid.jwt' }));
      expect(result?.role).toBe('SUPER_ADMIN');
    });

    it('returns null when no token is present (missing JWT)', async () => {
      const result = await service.authenticateSocket(fakeSocket({}));
      expect(result).toBeNull();
      expect(supabaseAuth.getUserFromToken).not.toHaveBeenCalled();
    });

    it('returns null for a malformed / invalid / expired token (getUserFromToken → null, no admin fallback)', async () => {
      supabaseAuth.getUserFromToken.mockResolvedValue(null);
      const result = await service.authenticateSocket(fakeSocket({ authToken: 'garbage' }));
      expect(result).toBeNull();
    });

    it('reads the token from the Authorization header as a fallback', async () => {
      supabaseAuth.getUserFromToken.mockResolvedValue({ id: 'u2', email: null });
      const result = await service.authenticateSocket(fakeSocket({ header: 'Bearer hdr.jwt' }));
      expect(result?.userId).toBe('u2');
      expect(supabaseAuth.getUserFromToken).toHaveBeenCalledWith('hdr.jwt');
    });

    it('NEVER derives identity from a client-supplied query userId (forged userId ignored)', async () => {
      supabaseAuth.getUserFromToken.mockResolvedValue({ id: 'real-user', email: null });
      const result = await service.authenticateSocket(
        fakeSocket({ authToken: 'valid.jwt', queryUserId: 'attacker' }),
      );
      expect(result?.userId).toBe('real-user');
      expect(result?.userId).not.toBe('attacker');
    });

    describe('admin HMAC-JWT fallback', () => {
      const OLD = process.env.ADMIN_JWT_SECRET;
      beforeEach(() => {
        process.env.ADMIN_JWT_SECRET = 'test-admin-secret';
      });
      afterEach(() => {
        if (OLD === undefined) delete process.env.ADMIN_JWT_SECRET;
        else process.env.ADMIN_JWT_SECRET = OLD;
      });

      it('falls back to a valid admin token when Supabase verification fails', async () => {
        supabaseAuth.getUserFromToken.mockResolvedValue(null);
        // The role is the User row's (ST-2-WS below), so the row says SUPER_ADMIN too.
        prisma.client.user.findUnique.mockResolvedValue({ role: 'SUPER_ADMIN', deletedAt: null, bannedAt: null });
        const token = buildAdminToken(
          { id: 'admin1', email: 'admin@keyflow.io', role: 'SUPER_ADMIN' },
          'test-admin-secret',
        );
        const result = await service.authenticateSocket(fakeSocket({ authToken: token }));
        expect(result).toEqual({ userId: 'admin1', email: 'admin@keyflow.io', role: 'SUPER_ADMIN' });
      });

      it('rejects an admin token signed with the wrong secret', async () => {
        supabaseAuth.getUserFromToken.mockResolvedValue(null);
        const token = buildAdminToken(
          { id: 'admin1', email: 'admin@keyflow.io', role: 'SUPER_ADMIN' },
          'a-different-secret',
        );
        const result = await service.authenticateSocket(fakeSocket({ authToken: token }));
        expect(result).toBeNull();
      });
    });
  });

  describe('verifyBusinessMembership', () => {
    it('allows the business owner', async () => {
      prisma.client.business.findFirst.mockResolvedValue({ id: 'b1' });
      await expect(service.verifyBusinessMembership('u1', 'USER', 'b1')).resolves.toBe(true);
    });

    it('allows a member', async () => {
      prisma.client.business.findFirst.mockResolvedValue({ id: 'b1' });
      await expect(service.verifyBusinessMembership('member1', 'USER', 'b1')).resolves.toBe(true);
    });

    it('rejects a non-member', async () => {
      prisma.client.business.findFirst.mockResolvedValue(null);
      await expect(service.verifyBusinessMembership('outsider', 'USER', 'b1')).resolves.toBe(false);
    });

    it('rejects a disabled (soft-deleted) business — findFirst returns null', async () => {
      // The soft-delete extension filters deletedAt IS NOT NULL out of findFirst,
      // so a disabled business is indistinguishable from "no membership": null → reject.
      prisma.client.business.findFirst.mockResolvedValue(null);
      await expect(service.verifyBusinessMembership('u1', 'USER', 'b-disabled')).resolves.toBe(false);
    });

    it('bypasses the membership check for SUPER_ADMIN', async () => {
      await expect(service.verifyBusinessMembership('admin', 'SUPER_ADMIN', 'b1')).resolves.toBe(true);
      expect(prisma.client.business.findFirst).not.toHaveBeenCalled();
    });

    it('rejects when businessId is empty', async () => {
      await expect(service.verifyBusinessMembership('u1', 'USER', '')).resolves.toBe(false);
    });

    // ST-WS-R2 (R0-ID-F6 review). The handshake businessId is client JSON; an
    // object reached findFirst as `id`, where Prisma reads it as a filter, so
    // { in: [ownBiz, foreignBiz] } was authorized for a member of ownBiz.
    // BusinessGuard's resolver accepts only a non-empty string; so does this.
    it('rejects a businessId that is not a non-empty string (a Prisma filter object, an array, a number), for SUPER_ADMIN too, without querying', async () => {
      prisma.client.business.findFirst.mockResolvedValue({ id: 'b_own' });
      const notAnId: unknown[] = [{ in: ['b_own', 'b_foreign'] }, { not: '' }, ['b_own', 'b_foreign'], 42, true];
      for (const businessId of notAnId) {
        for (const role of ['USER', 'SUPER_ADMIN']) {
          await expect(
            service.verifyBusinessMembership('u1', role, businessId),
            `${role} ${JSON.stringify(businessId)}`,
          ).resolves.toBe(false);
        }
      }
      expect(prisma.client.business.findFirst).not.toHaveBeenCalled();
    });

    it('queries membership with the string id unchanged', async () => {
      prisma.client.business.findFirst.mockResolvedValue({ id: 'b1' });
      await expect(service.verifyBusinessMembership('u1', 'USER', 'b1')).resolves.toBe(true);
      expect(prisma.client.business.findFirst).toHaveBeenCalledWith({
        where: { id: 'b1', OR: [{ ownerId: 'u1' }, { members: { some: { userId: 'u1' } } }] },
        select: { id: true },
      });
    });

    it('fails closed if the membership query throws', async () => {
      prisma.client.business.findFirst.mockRejectedValue(new Error('db down'));
      await expect(service.verifyBusinessMembership('u1', 'USER', 'b1')).resolves.toBe(false);
    });
  });

  describe('isAllowedWsOrigin', () => {
    const OLD = process.env.APP_URL;
    beforeEach(() => {
      process.env.APP_URL = 'https://app.keyflow.io';
    });
    afterEach(() => {
      if (OLD === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = OLD;
    });

    it('allows a configured origin', () => {
      expect(isAllowedWsOrigin('https://app.keyflow.io')).toBe(true);
    });

    it('allows a configured origin with a trailing slash', () => {
      expect(isAllowedWsOrigin('https://app.keyflow.io/')).toBe(true);
    });

    it('allows the localhost dev fallback', () => {
      expect(isAllowedWsOrigin('http://localhost:5000')).toBe(true);
    });

    it('rejects an unknown cross-origin', () => {
      expect(isAllowedWsOrigin('https://evil.example.com')).toBe(false);
    });

    it('allows requests without an Origin header (native/server/test clients)', () => {
      expect(isAllowedWsOrigin(undefined)).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// ST-2-WS (R0-ID-F6-WS-ADMIN-TOKEN). authenticateSocket had its own admin-token
// path: the role came from the token, and neither User.deletedAt, User.bannedAt
// nor a missing row refused it; its Supabase path read only the role, ignored
// the logout marker and fell back to USER when Postgres failed. So a demoted,
// deleted or banned SUPER_ADMIN still opened another tenant's socket
// (verifyBusinessMembership lets SUPER_ADMIN through, as BusinessGuard does).
// Required: the socket gets exactly the HTTP AuthMiddleware decision for the
// same bearer token — the parity case runs every scenario through
// AuthMiddleware.use as well.
// ---------------------------------------------------------------------------
describe('ST-2-WS — authenticateSocket applies the HTTP AuthMiddleware local-user checks to both token kinds', () => {
  const ADMIN_SECRET = 'ws-auth-spec-admin-secret-not-real';
  const ADMIN = { id: 'admin_ws', email: 'admin-ws@example.com', role: 'SUPER_ADMIN' };
  const USER = { id: 'user_ws', email: 'user-ws@example.com' };
  type Row = { role: string; deletedAt: Date | null; bannedAt: Date | null } | null;
  const ACTIVE = (role: string): Row => ({ role, deletedAt: null, bannedAt: null });

  let priorSecret: string | undefined;
  beforeAll(() => {
    priorSecret = process.env.ADMIN_JWT_SECRET;
    process.env.ADMIN_JWT_SECRET = ADMIN_SECRET;
  });
  afterAll(() => {
    if (priorSecret === undefined) delete process.env.ADMIN_JWT_SECRET;
    else process.env.ADMIN_JWT_SECRET = priorSecret;
  });

  const nowS = () => Math.floor(Date.now() / 1000);
  const b64url = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  /** A Supabase-shaped access token. Its signature is never checked here: getUserFromToken is the mocked verifier. */
  const supabaseJwt = (claims: Record<string, unknown> = {}) =>
    `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: USER.id, aud: 'authenticated', iat: nowS(), ...claims })}.sig`;
  const adminJwt = (secret = ADMIN_SECRET) => buildAdminToken(ADMIN, secret);

  interface Setup {
    /** What the Supabase verifier accepts; null (the default) rejects, so only the admin branch can attach. */
    supabaseUser?: { id: string; email?: string } | null;
    /** The User row findUnique answers; defaults to an active SUPER_ADMIN. */
    row?: Row;
    lookup?: () => Promise<unknown>;
    /** Redis keyspace (get; pttl answers -1 for a present key, -2 for an absent one). */
    keys?: Record<string, string>;
    redisDown?: boolean;
  }

  /** One set of collaborators; each transport below gets its own copy. */
  function collaborators(s: Setup) {
    const row = s.row === undefined ? ACTIVE('SUPER_ADMIN') : s.row;
    const store = new Map(Object.entries(s.keys ?? {}));
    const supabaseAuth = { getUserFromToken: vi.fn().mockResolvedValue(s.supabaseUser ?? null) };
    const prisma = {
      client: {
        user: { findUnique: vi.fn(s.lookup ?? (async () => row)) },
        business: { findFirst: vi.fn().mockResolvedValue(null) },
      },
    };
    const redis = {
      get: vi.fn(async (k: string) => {
        if (s.redisDown) throw new Error('redis down');
        return store.get(k) ?? null;
      }),
      pttl: vi.fn(async (k: string) => {
        if (s.redisDown) throw new Error('redis down');
        return store.has(k) ? -1 : -2;
      }),
    };
    return { supabaseAuth, prisma, redis };
  }

  function wsService(s: Setup) {
    const c = collaborators(s);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mocks
    return { service: new KeyCortexWsAuthService(c.supabaseAuth as any, c.prisma as any, c.redis as any), ...c };
  }

  async function viaSocket(s: Setup, token: string) {
    const c = wsService(s);
    return { identity: await c.service.authenticateSocket(fakeSocket({ authToken: token })), ...c };
  }

  /** The HTTP decision for the same token and the same collaborators, as the WsIdentity it would be. */
  async function viaHttp(s: Setup, token: string) {
    const c = collaborators(s);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mocks
    const mw = new AuthMiddleware(c.supabaseAuth as any, c.prisma as any, c.redis as any);
    const req = { headers: { authorization: `Bearer ${token}` }, query: {} } as unknown as Request;
    await mw.use(req, {} as Response, () => undefined);
    const user = (req as unknown as { user?: { id: string; email?: string | null; role: string } }).user;
    return user ? { userId: user.id, email: user.email ?? null, role: user.role } : null;
  }

  describe('the admin-token branch', () => {
    it('positive control: an admin token for an active SUPER_ADMIN row is attached, its role read from the row', async () => {
      const { identity, prisma } = await viaSocket({}, adminJwt());
      expect(identity).toEqual({ userId: ADMIN.id, email: ADMIN.email, role: 'SUPER_ADMIN' });
      expect(prisma.client.user.findUnique).toHaveBeenCalledWith({
        where: { id: ADMIN.id },
        select: { role: true, deletedAt: true, bannedAt: true },
      });
    });

    it('takes the role from the User row, not the token: a demoted row attaches as USER although the token says SUPER_ADMIN', async () => {
      const { identity } = await viaSocket({ row: ACTIVE('USER') }, adminJwt());
      expect(identity, 'the identity is still valid, only the role changed').not.toBeNull();
      expect(identity?.role, 'role came from the token claim, not the User row').toBe('USER');
    });

    it('is refused when User.deletedAt is set', async () => {
      const { identity } = await viaSocket({ row: { role: 'SUPER_ADMIN', deletedAt: new Date(), bannedAt: null } }, adminJwt());
      expect(identity).toBeNull();
    });

    it('is refused when User.bannedAt is set', async () => {
      const { identity } = await viaSocket({ row: { role: 'SUPER_ADMIN', deletedAt: null, bannedAt: new Date() } }, adminJwt());
      expect(identity).toBeNull();
    });

    it('is refused when the subject has no User row (no bootstrap window for an admin identity)', async () => {
      const { identity } = await viaSocket({ row: null }, adminJwt());
      expect(identity).toBeNull();
    });

    it('is refused when the User lookup fails (fails closed)', async () => {
      const { identity } = await viaSocket({ lookup: async () => { throw new Error('db down'); } }, adminJwt());
      expect(identity).toBeNull();
    });

    it('honours the admin revocation cutoff admin:user:<id>:revokedAt: a token issued before it is refused without reading the row; one issued after it is attached', async () => {
      const before = adminJwt();
      const revoked = await viaSocket({ keys: { [`admin:user:${ADMIN.id}:revokedAt`]: String(Date.now() + 1) } }, before);
      expect(revoked.identity).toBeNull();
      expect(revoked.prisma.client.user.findUnique).not.toHaveBeenCalled();

      const after = await viaSocket({ keys: { [`admin:user:${ADMIN.id}:revokedAt`]: String(Date.now() - 1000) } }, adminJwt());
      expect(after.identity).toEqual({ userId: ADMIN.id, email: ADMIN.email, role: 'SUPER_ADMIN' });
    });

    it('is refused when its jti is revoked (admin:jti:<jti>)', async () => {
      const token = adminJwt();
      const jti = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).jti as string;
      const { identity } = await viaSocket({ keys: { [`admin:jti:${jti}`]: '1' } }, token);
      expect(identity).toBeNull();
    });

    it('F1 (as HTTP): the per-user Supabase logout marker does not refuse an admin token and is not read; the row checks still run', async () => {
      const { identity, redis, prisma } = await viaSocket({ keys: { [`auth:revoked:user:${ADMIN.id}`]: String(nowS() + 60) } }, adminJwt());
      expect(identity).toEqual({ userId: ADMIN.id, email: ADMIN.email, role: 'SUPER_ADMIN' });
      expect(redis.get).not.toHaveBeenCalledWith(`auth:revoked:user:${ADMIN.id}`);
      expect(prisma.client.user.findUnique).toHaveBeenCalledTimes(1);
    });

    it('a token that fails admin verification never reaches the User row', async () => {
      const { identity, prisma } = await viaSocket({}, adminJwt('some-other-secret'));
      expect(identity).toBeNull();
      expect(prisma.client.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('the Supabase branch', () => {
    const supabase = (extra: Setup = {}): Setup => ({ supabaseUser: USER, row: ACTIVE('OWNER'), ...extra });
    const marker = (at: number | string) => ({ [`auth:revoked:user:${USER.id}`]: String(at) });

    it('the logout marker refuses a token whose session was authenticated at or before it, without reading the row', async () => {
      const at = nowS();
      const { identity, prisma } = await viaSocket(supabase({ keys: marker(at) }), supabaseJwt({ iat: at - 10 }));
      expect(identity).toBeNull();
      expect(prisma.client.user.findUnique).not.toHaveBeenCalled();
      expect((await viaSocket(supabase({ keys: marker(at) }), supabaseJwt({ iat: at }))).identity, 'same second').toBeNull();
    });

    it('a pre-logout session refreshed after the logout (new iat, same session_id and amr) is refused, and so is a session token that does not say when it began', async () => {
      const at = nowS() - 30;
      const refreshed = supabaseJwt({ iat: nowS(), session_id: 's1', amr: [{ method: 'password', timestamp: at - 60 }] });
      expect((await viaSocket(supabase({ keys: marker(at) }), refreshed)).identity).toBeNull();
      const noAmr = supabaseJwt({ iat: nowS(), session_id: 's1' });
      expect((await viaSocket(supabase({ keys: marker(at) }), noAmr)).identity).toBeNull();
    });

    it("the previous release's bare flag ('1') with no readable TTL refuses every token issued up to now", async () => {
      expect((await viaSocket(supabase({ keys: marker('1') }), supabaseJwt({ iat: nowS() - 5 }))).identity).toBeNull();
    });

    it('a session authenticated after the logout is attached, role from the User row', async () => {
      const at = nowS() - 60;
      const token = supabaseJwt({ iat: nowS(), session_id: 's2', amr: [{ method: 'password', timestamp: at + 30 }] });
      expect((await viaSocket(supabase({ keys: marker(at) }), token)).identity).toEqual({ userId: USER.id, email: USER.email, role: 'OWNER' });
    });

    it('is refused when User.deletedAt or User.bannedAt is set', async () => {
      expect((await viaSocket(supabase({ row: { role: 'OWNER', deletedAt: new Date(), bannedAt: null } }), supabaseJwt())).identity).toBeNull();
      expect((await viaSocket(supabase({ row: { role: 'OWNER', deletedAt: null, bannedAt: new Date() } }), supabaseJwt())).identity).toBeNull();
    });

    it('a Postgres failure refuses instead of falling back to USER', async () => {
      const { identity } = await viaSocket(supabase({ lookup: async () => { throw new Error('db down'); } }), supabaseJwt());
      expect(identity).toBeNull();
    });

    it('a subject with no User row yet is attached as USER (the bootstrap window, as HTTP)', async () => {
      expect((await viaSocket(supabase({ row: null }), supabaseJwt())).identity).toEqual({ userId: USER.id, email: USER.email, role: 'USER' });
    });

    it('a Redis outage is not a revocation: the database checks still decide (active attached, banned refused)', async () => {
      expect((await viaSocket(supabase({ redisDown: true }), supabaseJwt())).identity).toEqual({ userId: USER.id, email: USER.email, role: 'OWNER' });
      expect((await viaSocket(supabase({ redisDown: true, row: { role: 'OWNER', deletedAt: null, bannedAt: new Date() } }), supabaseJwt())).identity).toBeNull();
    });
  });

  it('parity: for every case the socket gets exactly the HTTP AuthMiddleware decision for the same bearer token', async () => {
    const at = nowS() - 30;
    const userMarker = { [`auth:revoked:user:${USER.id}`]: String(at) };
    const adminCutoff = { [`admin:user:${ADMIN.id}:revokedAt`]: String(Date.now() + 1) };
    const cases: Array<[string, Setup, () => string]> = [
      ['admin, active SUPER_ADMIN', {}, () => adminJwt()],
      ['admin, demoted row', { row: ACTIVE('USER') }, () => adminJwt()],
      ['admin, deletedAt', { row: { role: 'SUPER_ADMIN', deletedAt: new Date(), bannedAt: null } }, () => adminJwt()],
      ['admin, bannedAt', { row: { role: 'SUPER_ADMIN', deletedAt: null, bannedAt: new Date() } }, () => adminJwt()],
      ['admin, no row', { row: null }, () => adminJwt()],
      ['admin, lookup fails', { lookup: async () => { throw new Error('db down'); } }, () => adminJwt()],
      ['admin, issued before the admin cutoff', { keys: adminCutoff }, () => adminJwt()],
      ['admin, Supabase logout marker only', { keys: { [`auth:revoked:user:${ADMIN.id}`]: String(nowS() + 60) } }, () => adminJwt()],
      ['admin, wrong secret', {}, () => adminJwt('some-other-secret')],
      ['admin, Redis down', { redisDown: true }, () => adminJwt()],
      ['supabase, active', { supabaseUser: USER, row: ACTIVE('OWNER') }, () => supabaseJwt()],
      ['supabase, deletedAt', { supabaseUser: USER, row: { role: 'OWNER', deletedAt: new Date(), bannedAt: null } }, () => supabaseJwt()],
      ['supabase, bannedAt', { supabaseUser: USER, row: { role: 'OWNER', deletedAt: null, bannedAt: new Date() } }, () => supabaseJwt()],
      ['supabase, no row', { supabaseUser: USER, row: null }, () => supabaseJwt()],
      ['supabase, lookup fails', { supabaseUser: USER, lookup: async () => { throw new Error('db down'); } }, () => supabaseJwt()],
      ['supabase, pre-logout token', { supabaseUser: USER, row: ACTIVE('OWNER'), keys: userMarker }, () => supabaseJwt({ iat: at - 1 })],
      ['supabase, post-logout session', { supabaseUser: USER, row: ACTIVE('OWNER'), keys: userMarker }, () => supabaseJwt({ iat: at + 1 })],
      ['supabase, legacy flag', { supabaseUser: USER, row: ACTIVE('OWNER'), keys: { [`auth:revoked:user:${USER.id}`]: '1' } }, () => supabaseJwt()],
      ['supabase, Redis down', { supabaseUser: USER, row: ACTIVE('OWNER'), redisDown: true }, () => supabaseJwt()],
    ];
    const mismatches: string[] = [];
    for (const [label, setup, token] of cases) {
      const t = token();
      const http = await viaHttp(setup, t);
      const { identity } = await viaSocket(setup, t);
      if (JSON.stringify(identity) !== JSON.stringify(http)) {
        mismatches.push(`${label}: socket ${JSON.stringify(identity)} vs HTTP ${JSON.stringify(http)}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  describe('through the gateway: a demoted, deleted or banned SUPER_ADMIN never opens another tenant’s socket', () => {
    function gatewayFor(s: Setup) {
      const c = wsService(s);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- collaborators handleConnection never reaches
      const gateway = new KeyCortexGateway({} as any, {} as any, {} as any, {} as any, c.service);
      return { gateway, ...c };
    }
    function socketFor(token: string, businessId: unknown = 'foreign_biz') {
      return {
        id: 'sock_ws',
        handshake: { auth: { token, businessId }, headers: {}, query: {} },
        join: vi.fn(),
        emit: vi.fn(),
        disconnect: vi.fn(),
      };
    }

    it('positive control: an active SUPER_ADMIN admin token joins a foreign tenant (the SUPER_ADMIN bypass is unchanged, as BusinessGuard)', async () => {
      const { gateway } = gatewayFor({});
      const socket = socketFor(adminJwt());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake socket
      await gateway.handleConnection(socket as any);
      expect(socket.disconnect).not.toHaveBeenCalled();
      expect(socket.join).toHaveBeenCalledWith('business:foreign_biz');
    });

    it('a demoted row: the SUPER_ADMIN claim in the token does not bypass membership — the membership query runs, finds none, and the socket is disconnected', async () => {
      const { gateway, prisma } = gatewayFor({ row: ACTIVE('USER') });
      const socket = socketFor(adminJwt());
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake socket
      await gateway.handleConnection(socket as any);
      expect(prisma.client.business.findFirst).toHaveBeenCalled();
      expect(socket.disconnect).toHaveBeenCalledWith(true);
      expect(socket.join).not.toHaveBeenCalled();
    });

    it('a deleted or banned SUPER_ADMIN row: refused at authentication, before any membership check', async () => {
      for (const row of [
        { role: 'SUPER_ADMIN', deletedAt: new Date(), bannedAt: null },
        { role: 'SUPER_ADMIN', deletedAt: null, bannedAt: new Date() },
      ]) {
        const { gateway, prisma } = gatewayFor({ row });
        const socket = socketFor(adminJwt());
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake socket
        await gateway.handleConnection(socket as any);
        expect(socket.disconnect).toHaveBeenCalledWith(true);
        expect(socket.join).not.toHaveBeenCalled();
        expect(prisma.client.business.findFirst).not.toHaveBeenCalled();
      }
    });

    it('ST-WS-R2: a Prisma filter object as the handshake businessId is refused for a member and for SUPER_ADMIN — disconnected, no room joined, nothing stored', async () => {
      for (const row of [ACTIVE('USER'), ACTIVE('SUPER_ADMIN')]) {
        const { gateway, prisma } = gatewayFor({ row });
        // A member of b_own: the membership query would match b_own if it ran with the filter.
        prisma.client.business.findFirst.mockResolvedValue({ id: 'b_own' });
        const socket = socketFor(adminJwt(), { in: ['b_own', 'foreign_biz'] });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake socket
        await gateway.handleConnection(socket as any);
        expect(socket.disconnect, row?.role).toHaveBeenCalledWith(true);
        expect(socket.join, row?.role).not.toHaveBeenCalled();
        expect(prisma.client.business.findFirst, row?.role).not.toHaveBeenCalled();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- private client registry
        expect((gateway as any).clients.has(socket.id), row?.role).toBe(false);
      }
    });
  });

  // ST-WS-R1 (R0-ID-F6 review; fixed by R0-ID-F6b-WS-LIVE-REVOCATION): the
  // gateway re-asks this decision for an open socket before every action. What
  // that relies on is pinned here — authenticateSocket keeps no per-socket
  // state, so asking again for the same socket reads the User row again. The
  // open-socket cases are in key-cortex.gateway.spec.ts and, over a real socket,
  // in identity-boundary.integration.test.ts.
  it('ST-WS-R1 groundwork: authenticateSocket caches nothing per socket — the same socket asked again after its row is banned is refused', async () => {
    let row: Row = ACTIVE('SUPER_ADMIN');
    const { service, prisma } = wsService({ lookup: async () => row });
    const socket = fakeSocket({ authToken: adminJwt() });
    expect(await service.authenticateSocket(socket)).toEqual({ userId: ADMIN.id, email: ADMIN.email, role: 'SUPER_ADMIN' });
    row = { role: 'SUPER_ADMIN', deletedAt: null, bannedAt: new Date() };
    expect(await service.authenticateSocket(socket)).toBeNull();
    expect(prisma.client.user.findUnique).toHaveBeenCalledTimes(2);
  });

  // CR-3 (R0-ID-F6b review repair): the gateway's key:auth_refresh puts a token
  // the socket sent in-band through authenticateToken. It must be exactly the
  // decision authenticateSocket takes for that token in the handshake.
  describe('authenticateToken (the in-band token of key:auth_refresh)', () => {
    const cases: Array<[string, Setup, () => string]> = [
      ['admin token, active SUPER_ADMIN row', {}, () => adminJwt()],
      ['admin token, demoted row', { row: ACTIVE('USER') }, () => adminJwt()],
      ['admin token, banned row', { row: { role: 'SUPER_ADMIN', deletedAt: null, bannedAt: new Date() } }, () => adminJwt()],
      ['admin token, no row', { row: null }, () => adminJwt()],
      ['admin token, wrong secret', {}, () => adminJwt('another-secret-not-real')],
      ['Supabase token, member row', { supabaseUser: USER, row: ACTIVE('USER') }, () => supabaseJwt()],
      ['Supabase token, logged out', { supabaseUser: USER, row: ACTIVE('USER'), keys: { [`auth:revoked:user:${USER.id}`]: String(nowS() + 5) } }, () => supabaseJwt()],
      ['Supabase token, deleted row', { supabaseUser: USER, row: { role: 'USER', deletedAt: new Date(), bannedAt: null } }, () => supabaseJwt()],
    ];

    it('parity: for every case authenticateToken(token) is authenticateSocket’s decision for the same token in the handshake, which is the HTTP decision', async () => {
      for (const [label, setup, token] of cases) {
        const t = token();
        const viaToken = await wsService(setup).service.authenticateToken(t);
        const { identity: viaHandshake } = await viaSocket(setup, t);
        expect(viaToken, label).toEqual(viaHandshake);
        expect(viaToken, `${label} (HTTP)`).toEqual(await viaHttp(setup, t));
      }
      // The positive and the refused cases are both represented.
      expect(await wsService({}).service.authenticateToken(adminJwt())).toEqual({ userId: ADMIN.id, email: ADMIN.email, role: 'SUPER_ADMIN' });
    });

    it('reads the token as handshake.auth.token is read: a Bearer prefix is stripped; anything but a non-empty string is null without asking the verifier', async () => {
      const { service, supabaseAuth, prisma } = wsService({});
      expect(await service.authenticateToken(`Bearer ${adminJwt()}`)).toEqual({ userId: ADMIN.id, email: ADMIN.email, role: 'SUPER_ADMIN' });
      supabaseAuth.getUserFromToken.mockClear();
      prisma.client.user.findUnique.mockClear();
      for (const raw of [undefined, null, '', '   ', 'Bearer ', 42, { token: adminJwt() }]) {
        expect(await service.authenticateToken(raw), JSON.stringify(raw)).toBeNull();
      }
      expect(supabaseAuth.getUserFromToken).not.toHaveBeenCalled();
      expect(prisma.client.user.findUnique).not.toHaveBeenCalled();
    });
  });
});
