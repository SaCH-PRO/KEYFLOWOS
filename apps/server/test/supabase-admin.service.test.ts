import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request } from 'express';
import { createClient } from '@supabase/supabase-js';
import { exportJWK, generateKeyPair, jwtVerify, SignJWT, type JWTPayload } from 'jose';
import { SupabaseAdminService } from '../src/core/auth/supabase-admin.service';
import { AuthMiddleware, LOGOUT_REVOCATION_TTL_SECONDS, logoutRevocationKey } from '../src/core/auth/auth.middleware';
import { buildAdminToken, verifyAdminToken } from '../src/core/auth/admin-token.util';
import { RiscService } from '../src/modules/risc/risc.service';
import { RISC_EVENT_TYPES } from '../src/modules/risc/risc.types';
import { IdentityController } from '../src/modules/identity/identity.controller';
import {
  IdentityPasswordService,
  recoveryRequestKey,
  recoveryUseKey,
} from '../src/modules/identity/identity-password.service';

/**
 * Unit tests for SupabaseAdminService.findUserByEmail pagination.
 *
 * The Supabase admin API does not expose a direct `getUserByEmail`, so we
 * paginate through `listUsers`. These tests confirm the service walks
 * past the first page when looking up a user — a previous regression
 * only checked page 1, causing resend-verification to silently fail for
 * any user beyond the first 200 entries.
 */
describe('SupabaseAdminService.findUserByEmail pagination', () => {
  function makeUser(email: string, id: string) {
    return { id, email } as { id: string; email: string };
  }

  function buildService(pages: Array<{ users: ReturnType<typeof makeUser>[]; error?: { message: string } }>) {
    const listUsers = vi.fn(async ({ page }: { page: number; perPage: number }) => {
      const idx = page - 1;
      const slice = pages[idx];
      if (!slice) return { data: { users: [] }, error: null };
      if (slice.error) return { data: null, error: slice.error };
      return { data: { users: slice.users }, error: null };
    });
    const svc = new SupabaseAdminService();
    (svc as unknown as { client: unknown }).client = {
      auth: { admin: { listUsers } },
    };
    return { svc, listUsers };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('finds a user on the first page without paginating further', async () => {
    const target = makeUser('found@example.com', 'u-1');
    const { svc, listUsers } = buildService([
      { users: [target, makeUser('other@example.com', 'u-2')] },
    ]);
    const result = await svc.findUserByEmail('found@example.com');
    expect(result?.id).toBe('u-1');
    expect(listUsers).toHaveBeenCalledTimes(1);
  });

  it('continues paginating when the first page is full and finds the user on a later page', async () => {
    const fullFirstPage = Array.from({ length: 200 }, (_, i) => makeUser(`user${i}@example.com`, `u-${i}`));
    const target = makeUser('late@example.com', 'u-late');
    const { svc, listUsers } = buildService([
      { users: fullFirstPage },
      { users: [target] },
    ]);
    const result = await svc.findUserByEmail('late@example.com');
    expect(result?.id).toBe('u-late');
    expect(listUsers).toHaveBeenCalledTimes(2);
  });

  it('stops paginating once a page returns fewer than perPage results', async () => {
    const fullFirstPage = Array.from({ length: 200 }, (_, i) => makeUser(`user${i}@example.com`, `u-${i}`));
    const partialSecondPage = Array.from({ length: 5 }, (_, i) => makeUser(`extra${i}@example.com`, `e-${i}`));
    const { svc, listUsers } = buildService([
      { users: fullFirstPage },
      { users: partialSecondPage },
    ]);
    const result = await svc.findUserByEmail('does-not-exist@example.com');
    expect(result).toBeNull();
    expect(listUsers).toHaveBeenCalledTimes(2);
  });

  it('returns null and stops paginating on an API error', async () => {
    const { svc, listUsers } = buildService([
      { users: [], error: { message: 'rate limited' } },
    ]);
    const result = await svc.findUserByEmail('whoever@example.com');
    expect(result).toBeNull();
    expect(listUsers).toHaveBeenCalledTimes(1);
  });

  it('matches emails case-insensitively', async () => {
    const target = makeUser('Mixed.Case@Example.com', 'u-mixed');
    const { svc } = buildService([{ users: [target] }]);
    const result = await svc.findUserByEmail('  MIXED.case@example.COM  ');
    expect(result?.id).toBe('u-mixed');
  });
});

/**
 * CR-2 (R0-ID-F4-LOGOUT-SUPABASE-SIGNOUT): the Supabase session revocation
 * call shape.
 *
 * auth-js (installed 2.94.0) declares `GoTrueAdminApi.signOut(jwt: string,
 * scope)` and sends that first argument as the `Authorization: Bearer` of
 * `POST <auth>/logout?scope=<scope>`; GoTrue revokes the sessions of the user
 * that JWT belongs to (global: all, others: all but the JWT's own session).
 * The installed GoTrueAdminApi has no method that revokes sessions by user id.
 * Until this packet SupabaseAdminService.signOut was handed the USER ID, so
 * GoTrue received a bearer that is not a JWT, refused it, and nothing was ever
 * revoked: the refresh tokens kept working at Supabase after every logout.
 *
 * Every case here is provider-free: where the request shape matters the
 * auth-js client is the real one, on a recording `fetch` that never leaves the
 * process.
 */
describe('CR-2 — SupabaseAdminService.signOut takes the JWT auth-js admin.signOut expects', () => {
  const b64url = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  /** A Supabase-shaped access token. Nothing here verifies its signature. */
  const accessJwt = (claims: Record<string, unknown> = {}) =>
    `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: 'u-cr2', session_id: 's-cr2', role: 'authenticated', ...claims })}.c2ln`;
  const USER_ID = '6f1c1d36-5d7e-4c38-9a3f-0b7a3b0e2c11';

  type Call = { url: string; method: string; headers: Record<string, string> };

  /** The real auth-js admin client behind the real service, on a fetch that records and never leaves the process. */
  function realClient(respond: (call: Call) => Response = () => new Response(null, { status: 204 })) {
    const calls: Call[] = [];
    const fetchStub = vi.fn(async (input: unknown, init?: { method?: string; headers?: unknown }) => {
      const headers: Record<string, string> = {};
      new Headers(init?.headers as Record<string, string> | undefined).forEach((v, k) => {
        headers[k.toLowerCase()] = v;
      });
      const call = { url: String(input), method: init?.method ?? 'GET', headers };
      calls.push(call);
      return respond(call);
    });
    const svc = new SupabaseAdminService();
    (svc as unknown as { client: unknown }).client = createClient('http://supabase.cr2.test', 'service-role-key-cr2', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetchStub as unknown as typeof fetch },
    });
    const warn = vi.fn();
    (svc as unknown as { logger: unknown }).logger = { warn, debug: vi.fn(), log: vi.fn(), error: vi.fn() };
    return { svc, calls, fetchStub, warn };
  }

  it("the installed auth-js sends signOut's first argument as the bearer of POST /logout?scope=…: the access JWT reaches GoTrue, and the service reports success", async () => {
    const { svc, calls } = realClient();
    const token = accessJwt();

    await expect(svc.signOut(token, 'global')).resolves.toBe(true);

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('http://supabase.cr2.test/auth/v1/logout?scope=global');
    expect(calls[0].headers.authorization).toBe(`Bearer ${token}`);
  });

  it("passes the scope through: 'others' keeps the JWT's own session", async () => {
    const { svc, calls } = realClient();
    const token = accessJwt();
    await expect(svc.signOut(token, 'others')).resolves.toBe(true);
    expect(calls[0].url).toBe('http://supabase.cr2.test/auth/v1/logout?scope=others');
    expect(calls[0].headers.authorization).toBe(`Bearer ${token}`);
  });

  it('refuses a value that is not a JWT — a bare user id, the CR-2 call shape — without calling auth-js, and reports failure', async () => {
    const { svc, fetchStub, warn } = realClient();
    for (const notAJwt of [USER_ID, '', 'a.b', 'a..c']) {
      await expect(svc.signOut(notAJwt, 'global'), JSON.stringify(notAJwt)).resolves.toBe(false);
    }
    expect(fetchStub).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('a GoTrue error result is reported as false, never thrown, and the JWT never reaches the log', async () => {
    const { svc, warn } = realClient(
      () =>
        new Response(
          JSON.stringify({ code: 403, error_code: 'session_not_found', msg: 'Session from session_id claim in JWT does not exist' }),
          { status: 403, headers: { 'content-type': 'application/json' } },
        ),
    );
    const token = accessJwt();

    await expect(svc.signOut(token, 'global')).resolves.toBe(false);

    expect(warn).toHaveBeenCalled();
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain(token);
    expect(logged).not.toContain(token.split('.')[1]);
  });

  it('a thrown failure (network, unconfigured client) is reported as false, never thrown, and the JWT never reaches the log', async () => {
    const { svc, warn } = realClient(() => {
      throw new TypeError('fetch failed');
    });
    const token = accessJwt();
    await expect(svc.signOut(token, 'global')).resolves.toBe(false);

    const unconfigured = new SupabaseAdminService();
    const warn2 = vi.fn();
    (unconfigured as unknown as { logger: unknown }).logger = { warn: warn2, debug: vi.fn() };
    const saved = { ...process.env };
    delete process.env.SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      await expect(unconfigured.signOut(token, 'global')).resolves.toBe(false);
    } finally {
      process.env = saved;
    }

    for (const calls of [warn.mock.calls, warn2.mock.calls]) {
      expect(calls.length).toBeGreaterThan(0);
      expect(JSON.stringify(calls)).not.toContain(token.split('.')[1]);
    }
  });
});

/**
 * CR-2 at the callers: the REAL IdentityController handlers and the REAL
 * IdentityPasswordService, with the provider behind a recording stub (or, in
 * the end-to-end case, the real SupabaseAdminService and auth-js client on a
 * recording fetch).
 */
describe("CR-2 — the callers hand SupabaseAdminService.signOut the caller's JWT", () => {
  const b64url = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const USER = 'u-cr2-callers';
  const accessJwt = (claims: Record<string, unknown> = {}) =>
    `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: USER, session_id: 's-1', role: 'authenticated', ...claims })}.c2ln`;
  /**
   * This app's recovery-link access token (R0-ID-F5 review F5-CR-1/CR-2): the
   * implicit flow, so GoTrue's verifyGet stamps amr 'otp' (issueRefreshToken(...,
   * models.OTP, ...)), opened a moment ago, after the forgot-password request
   * the harness records.
   */
  const recoveryJwt = () => {
    const openedAt = Math.floor(Date.now() / 1000) - 30;
    return accessJwt({ iat: openedAt, exp: openedAt + 3600, email: 'cr2@example.com', amr: [{ method: 'otp', timestamp: openedAt }] });
  };

  function memoryRedis(order: string[]) {
    const store = new Map<string, string>();
    return {
      store,
      setex: vi.fn(async (k: string, _s: number, v: string) => {
        order.push(`setex ${k}`);
        store.set(k, String(v));
        return 'OK';
      }),
      set: vi.fn(async (k: string, v: string) => {
        order.push(`set ${k}`);
        store.set(k, String(v));
        return 'OK';
      }),
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      del: vi.fn(async () => 0),
    };
  }

  function harness(
    opts: {
      signOut?: (jwt: string, scope: string) => Promise<unknown>;
      supabaseAdmin?: unknown;
    } = {},
  ) {
    const order: string[] = [];
    const redis = memoryRedis(order);
    // The forgot-password request the recovery link answers (written by
    // requestReset; seeded here so it stays out of `order`).
    redis.store.set(recoveryRequestKey('cr2@example.com'), String(Math.floor(Date.now() / 1000) - 120));
    const audit = vi.fn(async (_entry: Record<string, unknown>) => undefined);
    const authSec = { enforce: vi.fn(async () => undefined), audit };
    const signupSvc = { signInWithPassword: vi.fn(async () => ({ userId: USER, accessToken: 'a', refreshToken: 'r' })) };
    const supabaseAdmin = opts.supabaseAdmin ?? {
      signOut: vi.fn(async (jwt: string, scope: string) => {
        order.push('provider signOut');
        return opts.signOut ? opts.signOut(jwt, scope) : true;
      }),
      updateUserPassword: vi.fn(async () => {
        order.push('provider updateUserPassword');
      }),
    };
    const auth = { getUserFromToken: vi.fn(async () => ({ id: USER, email: 'cr2@example.com' })) };
    const policy = { validate: vi.fn(async () => undefined) };
    // R0-ID-F5: the reset reads the local User row and the logout marker (this redis, no marker).
    const passwordPrisma = { client: { user: { findUnique: vi.fn(async () => ({ deletedAt: null, bannedAt: null })) } } };
    const passwordSvc = new IdentityPasswordService(
      supabaseAdmin as never,
      auth as never,
      policy as never,
      passwordPrisma as never,
      redis as never,
    );
    const unused = {} as never;
    const ctrl = new IdentityController(
      unused,
      unused,
      unused,
      signupSvc as never,
      authSec as never,
      passwordSvc,
      { client: {} } as never,
      supabaseAdmin as never,
      redis as never,
    );
    const req = (bearer?: string) =>
      ({
        ip: '127.0.0.1',
        headers: bearer === undefined ? {} : { authorization: `Bearer ${bearer}` },
        socket: {},
      }) as unknown as Request;
    const user = { id: USER, email: 'cr2@example.com' } as never;
    return {
      ctrl,
      req,
      user,
      supabaseAdmin: supabaseAdmin as { signOut: ReturnType<typeof vi.fn> },
      audit,
      order,
      redis,
    };
  }

  const auditOf = (audit: ReturnType<typeof vi.fn>, event: string) =>
    audit.mock.calls.map((c) => c[0] as Record<string, unknown>).filter((e) => e.event === event);

  describe('POST /identity/logout', () => {
    it("passes the caller's bearer access token — not the user id — to signOut with scope 'global'", async () => {
      const h = harness();
      const token = accessJwt();
      await expect(h.ctrl.logout(h.user, h.req(token))).resolves.toEqual({ status: 'logged_out' });
      expect(h.supabaseAdmin.signOut).toHaveBeenCalledTimes(1);
      expect(h.supabaseAdmin.signOut).toHaveBeenCalledWith(token, 'global');
      expect(h.supabaseAdmin.signOut).not.toHaveBeenCalledWith(USER, expect.anything());
      expect(auditOf(h.audit, 'logout')).toEqual([expect.objectContaining({ outcome: 'success', reason: undefined })]);
    });

    it('writes the local revocation (the R0-ID-F3 marker, then the admin cutoff) BEFORE asking the provider', async () => {
      const h = harness();
      await h.ctrl.logout(h.user, h.req(accessJwt()));
      expect(h.order).toEqual([`setex auth:revoked:user:${USER}`, `set admin:user:${USER}:revokedAt`, 'provider signOut']);
    });

    it('a provider sign-out that fails (false, or a throw) is logged and named in the audit row, never thrown past the local revocation', async () => {
      const failures = [
        async () => false,
        async () => {
          throw new Error('supabase timeout');
        },
      ];
      for (const signOut of failures) {
        const h = harness({ signOut });
        await expect(h.ctrl.logout(h.user, h.req(accessJwt()))).resolves.toEqual({ status: 'logged_out' });
        expect(h.redis.store.get(`auth:revoked:user:${USER}`), 'marker written').toMatch(/^\d+$/);
        expect(auditOf(h.audit, 'logout')).toEqual([
          expect.objectContaining({ outcome: 'success', reason: 'revocation_incomplete: provider_signout' }),
        ]);
      }
    });

    it('an admin local-auth token is never forwarded to Supabase; the provider leg is named as not done', async () => {
      const h = harness();
      const adminLike = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: USER, type: 'admin', jti: 'j' })}.c2ln`;
      await expect(h.ctrl.logout(h.user, h.req(adminLike))).resolves.toEqual({ status: 'logged_out' });
      expect(h.supabaseAdmin.signOut).not.toHaveBeenCalled();
      expect(h.redis.store.get(`auth:revoked:user:${USER}`)).toMatch(/^\d+$/);
      expect(auditOf(h.audit, 'logout')).toEqual([
        expect.objectContaining({ outcome: 'success', reason: 'revocation_incomplete: provider_signout' }),
      ]);
    });

    it("end to end through the real SupabaseAdminService and the installed auth-js: GoTrue receives POST /logout?scope=global bearing the caller's JWT (recording fetch, no provider traffic)", async () => {
      const calls: Array<{ url: string; authorization: string | null }> = [];
      const svc = new SupabaseAdminService();
      (svc as unknown as { client: unknown }).client = createClient('http://supabase.cr2.test', 'service-role-key-cr2', {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          fetch: (async (input: unknown, init?: { headers?: unknown }) => {
            calls.push({
              url: String(input),
              authorization: new Headers(init?.headers as Record<string, string>).get('authorization'),
            });
            return new Response(null, { status: 204 });
          }) as unknown as typeof fetch,
        },
      });
      const h = harness({ supabaseAdmin: svc });
      const token = accessJwt();
      await h.ctrl.logout(h.user, h.req(token));
      expect(calls).toEqual([{ url: 'http://supabase.cr2.test/auth/v1/logout?scope=global', authorization: `Bearer ${token}` }]);
      expect(auditOf(h.audit, 'logout')).toEqual([expect.objectContaining({ outcome: 'success', reason: undefined })]);
    });
  });

  describe('POST /identity/change-password', () => {
    const body = { currentPassword: 'OldButValid2026!', newPassword: 'BrandNewOne2026!' } as never;

    it("revokes the OTHER sessions with the caller's own bearer JWT (scope 'others' keeps that JWT's session)", async () => {
      const h = harness();
      const token = accessJwt();
      await h.ctrl.changePassword(body, h.user, h.req(token));
      expect(h.supabaseAdmin.signOut).toHaveBeenCalledWith(token, 'others');
      expect(h.supabaseAdmin.signOut).not.toHaveBeenCalledWith(USER, expect.anything());
      expect(auditOf(h.audit, 'password_changed')).toEqual([expect.objectContaining({ outcome: 'success', reason: undefined })]);
    });

    it('a failed provider sign-out is named in the success audit row, not thrown', async () => {
      const h = harness({ signOut: async () => false });
      await expect(h.ctrl.changePassword(body, h.user, h.req(accessJwt()))).resolves.toMatchObject({ status: 'ok' });
      expect(auditOf(h.audit, 'password_changed')).toEqual([
        expect.objectContaining({ outcome: 'success', reason: 'revocation_incomplete: provider_signout' }),
      ]);
    });

    it('asks the provider to sign out BEFORE it sets the password (R0-ID-F4 review F4-A / CR-1)', async () => {
      const h = harness();
      await h.ctrl.changePassword(body, h.user, h.req(accessJwt()));
      expect(h.order).toEqual(['provider signOut', 'provider updateUserPassword']);
    });
  });

  describe('POST /identity/reset-password', () => {
    it("revokes every session with the recovery link's access token (the JWT the caller presents), scope 'global'", async () => {
      const h = harness();
      const recoveryToken = recoveryJwt();
      await h.ctrl.resetPassword({ accessToken: recoveryToken, password: 'CorrectHorseBattery9!' } as never, h.req());
      expect(h.supabaseAdmin.signOut).toHaveBeenCalledWith(recoveryToken, 'global');
      expect(h.supabaseAdmin.signOut).not.toHaveBeenCalledWith(USER, expect.anything());
      expect(auditOf(h.audit, 'password_reset_completed')).toEqual([
        expect.objectContaining({ outcome: 'success', reason: undefined }),
      ]);
    });

    it('a failed provider sign-out is named in the success audit row, not thrown', async () => {
      const h = harness({
        signOut: async () => {
          throw new Error('supabase timeout');
        },
      });
      await expect(
        h.ctrl.resetPassword({ accessToken: recoveryJwt(), password: 'CorrectHorseBattery9!' } as never, h.req()),
      ).resolves.toMatchObject({ status: 'ok' });
      expect(auditOf(h.audit, 'password_reset_completed')).toEqual([
        expect.objectContaining({ outcome: 'success', reason: 'revocation_incomplete: provider_signout' }),
      ]);
    });

    it('asks the provider to sign out BEFORE it sets the password (R0-ID-F4 review F4-A / CR-1)', async () => {
      const h = harness();
      await h.ctrl.resetPassword({ accessToken: recoveryJwt(), password: 'CorrectHorseBattery9!' } as never, h.req());
      // R0-ID-F5 review F5-SEC-1: the recovery session is claimed (single use)
      // before any provider call, and the logout cutoff is written once the
      // password is set.
      expect(h.order).toEqual([
        `set ${recoveryUseKey('session:s-1')}`,
        'provider signOut',
        'provider updateUserPassword',
        `setex auth:revoked:user:${USER}`,
      ]);
    });
  });
});

/**
 * R0-ID-F4 review F4-A / CR-1: the password flows against GoTrue's own session
 * semantics, not a stub where every sign-out succeeds.
 *
 * The fake below is a fetch-level model of supabase/auth (GoTrue) master, read
 * from its source, not run:
 *   - PUT /admin/users/:id with a password: adminUserUpdate runs
 *     user.UpdatePassword(tx, nil), which calls models.Logout(tx, userId) —
 *     every session of the user ends (admin.go, models/user.go).
 *   - POST /logout: maybeLoadUserOrSession refuses a JWT whose session_id row
 *     does not exist, 403 error_code session_not_found (auth.go); otherwise
 *     'global' ends every session of the JWT's user, 'others' all but the
 *     JWT's own (logout.go).
 * Behind it: the real SupabaseAdminService, the installed auth-js client, the
 * real IdentityPasswordService and the real IdentityController handlers.
 * Nothing leaves the process.
 *
 * Before this repair the sign-out was sent AFTER the password update, found
 * its session already gone, and every successful reset and change wrote
 * 'revocation_incomplete: provider_signout' while no session was left.
 */
describe('R0-ID-F4 review F4-A — password flows against GoTrue session semantics', () => {
  const b64url = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const USER = '6f1c1d36-5d7e-4c38-9a3f-0b7a3b0e2c11';
  const jwtFor = (sessionId: string) =>
    `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: USER, session_id: sessionId, role: 'authenticated' })}.c2ln`;
  /**
   * The recovery link's access token as GoTrue issues it for this app's
   * implicit flow (R0-ID-F5 review F5-CR-2): verifyGet's implicit branch,
   * issueRefreshToken(..., models.OTP, ...), so amr 'otp', opened a moment ago.
   */
  const recoveryJwtFor = (sessionId: string) => {
    const openedAt = Math.floor(Date.now() / 1000) - 30;
    return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: USER, session_id: sessionId, role: 'authenticated', aal: 'aal1', email: 'f4a@example.com', iat: openedAt, exp: openedAt + 3600, amr: [{ method: 'otp', timestamp: openedAt }] })}.c2ln`;
  };

  function fakeGoTrue(sessions: Map<string, string>, opts: { logoutDown?: boolean } = {}) {
    /** Each provider call, with the sessions left right after it. */
    const log: Array<{ call: string; sessionsAfter: string[] }> = [];
    const record = (call: string) => log.push({ call, sessionsAfter: [...sessions.keys()].sort() });
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    const fetchImpl = async (input: unknown, init?: { method?: string; headers?: unknown; body?: unknown }) => {
      const url = new URL(String(input));
      const method = init?.method ?? 'GET';
      const call = `${method} ${url.pathname}${url.search}`;
      const adminUser = url.pathname.match(/^\/auth\/v1\/admin\/users\/([^/]+)$/);
      if (adminUser && method === 'PUT') {
        const body = JSON.parse(String(init?.body ?? '{}')) as { password?: string };
        if (body.password) {
          for (const [sid, uid] of [...sessions]) if (uid === adminUser[1]) sessions.delete(sid);
        }
        record(call);
        return json(200, { id: adminUser[1] });
      }
      if (url.pathname === '/auth/v1/logout' && method === 'POST') {
        if (opts.logoutDown) {
          record(call);
          return json(500, { code: 500, error_code: 'unexpected_failure', msg: 'Error logging out user' });
        }
        const bearer = (new Headers(init?.headers as Record<string, string>).get('authorization') ?? '').replace('Bearer ', '');
        const claims = JSON.parse(Buffer.from(bearer.split('.')[1] ?? '', 'base64url').toString('utf8')) as {
          sub: string;
          session_id: string;
        };
        if (!sessions.has(claims.session_id)) {
          record(call);
          return json(403, { code: 403, error_code: 'session_not_found', msg: 'Session from session_id claim in JWT does not exist' });
        }
        const scope = url.searchParams.get('scope') ?? 'global';
        for (const [sid, uid] of [...sessions]) {
          if (uid !== claims.sub) continue;
          if (scope === 'others' && sid === claims.session_id) continue;
          if (scope === 'local' && sid !== claims.session_id) continue;
          sessions.delete(sid);
        }
        record(call);
        return new Response(null, { status: 204 });
      }
      record(call);
      return json(404, {});
    };
    return { log, fetchImpl };
  }

  function build(sessions: Map<string, string>, opts: { logoutDown?: boolean } = {}) {
    const gt = fakeGoTrue(sessions, opts);
    const admin = new SupabaseAdminService();
    (admin as unknown as { client: unknown }).client = createClient('http://gotrue.f4a.test', 'service-role-key-f4a', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: gt.fetchImpl as unknown as typeof fetch },
    });
    (admin as unknown as { logger: unknown }).logger = { warn: vi.fn(), debug: vi.fn(), log: vi.fn(), error: vi.fn() };
    const audit = vi.fn(async (_entry: Record<string, unknown>) => undefined);
    const authSec = { enforce: vi.fn(async () => undefined), audit };
    const signupSvc = { signInWithPassword: vi.fn(async () => ({})) };
    const auth = { getUserFromToken: vi.fn(async () => ({ id: USER, email: 'f4a@example.com' })) };
    const policy = { validate: vi.fn(async () => undefined) };
    // No logout marker; the forgot-password request the implicit-flow link
    // answers, made two minutes ago (R0-ID-F5 review F5-CR-1).
    const requestedAt = String(Math.floor(Date.now() / 1000) - 120);
    const redis = {
      setex: vi.fn(async () => 'OK'),
      set: vi.fn(async () => 'OK'),
      get: vi.fn(async (k: string) => (k === recoveryRequestKey('f4a@example.com') ? requestedAt : null)),
      del: vi.fn(async () => 1),
    };
    // R0-ID-F5: the reset reads the local User row and the logout marker (this redis, no marker).
    const passwordPrisma = { client: { user: { findUnique: vi.fn(async () => ({ deletedAt: null, bannedAt: null })) } } };
    const passwordSvc = new IdentityPasswordService(admin, auth as never, policy as never, passwordPrisma as never, redis as never);
    const unused = {} as never;
    const ctrl = new IdentityController(
      unused,
      unused,
      unused,
      signupSvc as never,
      authSec as never,
      passwordSvc,
      { client: {} } as never,
      admin,
      redis as never,
    );
    return { ctrl, audit, gt };
  }

  const req = (bearer?: string) =>
    ({ ip: '127.0.0.1', headers: bearer ? { authorization: `Bearer ${bearer}` } : {}, socket: {} }) as unknown as Request;
  const auditRows = (audit: ReturnType<typeof vi.fn>) => audit.mock.calls.map((c) => c[0] as Record<string, unknown>);

  it('reset-password: the global sign-out reaches GoTrue while the recovery session exists, ends every session, and the success audit row names no failed leg', async () => {
    const sessions = new Map([
      ['s-recovery', USER],
      ['s-attacker', USER],
    ]);
    const { ctrl, audit, gt } = build(sessions);

    await expect(
      ctrl.resetPassword({ accessToken: recoveryJwtFor('s-recovery'), password: 'CorrectHorseBattery9!' } as never, req()),
    ).resolves.toMatchObject({ status: 'ok' });

    expect(gt.log).toEqual([
      { call: 'POST /auth/v1/logout?scope=global', sessionsAfter: [] },
      { call: `PUT /auth/v1/admin/users/${USER}`, sessionsAfter: [] },
    ]);
    expect(auditRows(audit)).toEqual([
      expect.objectContaining({ event: 'password_reset_completed', outcome: 'success', reason: undefined }),
    ]);
  });

  it("change-password: the 'others' sign-out ends the other session while the caller's exists, and the success audit row names no failed leg", async () => {
    const sessions = new Map([
      ['s-caller', USER],
      ['s-attacker', USER],
    ]);
    const { ctrl, audit, gt } = build(sessions);

    await expect(
      ctrl.changePassword(
        { currentPassword: 'OldButValid2026!', newPassword: 'BrandNewOne2026!' } as never,
        { id: USER, email: 'f4a@example.com' } as never,
        req(jwtFor('s-caller')),
      ),
    ).resolves.toMatchObject({ status: 'ok' });

    // The explicit sweep revoked the other session and kept the caller's; the
    // admin update then ended the caller's too (GoTrue's own behaviour, which
    // this service cannot avoid with an admin update).
    expect(gt.log).toEqual([
      { call: 'POST /auth/v1/logout?scope=others', sessionsAfter: ['s-caller'] },
      { call: `PUT /auth/v1/admin/users/${USER}`, sessionsAfter: [] },
    ]);
    expect(auditRows(audit)).toEqual([
      expect.objectContaining({ event: 'password_changed', outcome: 'success', reason: undefined }),
    ]);
  });

  it('the audit signal still fires when the provider sign-out really fails: logout endpoint down, the reset still completes and its row names provider_signout', async () => {
    const sessions = new Map([['s-recovery', USER]]);
    const { ctrl, audit, gt } = build(sessions, { logoutDown: true });

    await expect(
      ctrl.resetPassword({ accessToken: recoveryJwtFor('s-recovery'), password: 'CorrectHorseBattery9!' } as never, req()),
    ).resolves.toMatchObject({ status: 'ok' });

    expect(gt.log.map((e) => e.call)).toEqual(['POST /auth/v1/logout?scope=global', `PUT /auth/v1/admin/users/${USER}`]);
    expect(auditRows(audit)).toEqual([
      expect.objectContaining({
        event: 'password_reset_completed',
        outcome: 'success',
        reason: 'revocation_incomplete: provider_signout',
      }),
    ]);
  });

  // R0-ID-F4 review F4-C is no longer a todo here: it is the describe below
  // (R0-ID-F7-RISC-SIGNOUT-SHAPE).
});

/**
 * R0-ID-F4 review F4-C, fixed by R0-ID-F7-RISC-SIGNOUT-SHAPE and its review
 * repairs: a cross-account protection (RISC) event that requires ending the
 * user's sessions.
 *
 * Until this packet RiscService.terminateUserSessions called
 * client.auth.admin.signOut(userId, 'global'): auth-js sends that first
 * argument as the bearer of POST /logout (the CR-2 shape), GoTrue refuses a
 * user id as a JWT, and no local logout cutoff was written, so a
 * sessions-revoked or account-hijacking event ended nothing but the local
 * Session rows.
 *
 * A RISC event carries no user JWT. The installed auth-js (2.94.0) admin API
 * has no call that ends sessions by user id (signOut takes a JWT; there is no
 * admin sessions API); the call it does have that takes a user id is
 * updateUserById, whose AdminUserAttributes.ban_duration bans the user for a
 * Go duration. So the handler now:
 *   1. for every session-ending event, writes the logout cutoff
 *      POST /identity/logout writes (auth:revoked:user:<id>), so AuthMiddleware
 *      refuses every token of a session authenticated up to the event — FIRST,
 *      so nothing the provider does can stand in its way — and the admin-token
 *      cutoff the same logout writes (admin:user:<id>:revokedAt; F7-SEC-4);
 *   2. for account-disabled/hijacking only (F7-CR-1: Google sends the others
 *      for ordinary account actions too, and a ban refuses the user's own
 *      sign-in), bans the user at the provider by id for a duration that
 *      outlasts the default access-token lifetime, after reading the current
 *      ban so that a longer one is never cut short (F7-SEC-1, F7-CR-2);
 *   3. names every leg that did not hold on RiscEvent.actionTaken and in the
 *      audit (F7-SEC-3).
 * The ban PAUSES the provider session; it does not revoke it (F7-SEC-2).
 * W7-RISC-REVOKE (D-39, the provider global logout): before the ban,
 * account-disabled/hijacking also asks GoTrue for POST /logout?scope=global
 * under a short-lived user JWT the server mints with the project's JWT secret
 * (sub = the user, NO session_id claim), which GoTrue's Logout handler answers
 * by deleting every session of the user and with them every refresh token. A
 * live case shows it where SUPABASE_JWT_SECRET holds that secret. F7-SEC-2 is
 * NOT closed end to end (W7-RISC-REVOKE review): under the Release 0 rule the
 * secret is empty and the sign-out never runs (CR-W7RR-1); sessions-revoked,
 * tokens-revoked and token-revoked revoke nothing at the provider (CR-W7RR-2);
 * and no deployment writes the UserIdentity row a RISC event resolves its user
 * by (SEC-W7RR-1). Each is an it.todo at the end of this describe.
 *
 * The real RiscService (signed RISC token, real jose verification against a
 * stubbed Google JWKS), the real SupabaseAdminService, the installed auth-js
 * client on a recording fetch, and the real AuthMiddleware and admin-token
 * verifier reading the cutoffs. GoTrue's ban semantics (Ban(): banned_until =
 * now + duration, overwriting; banned_until omitted when unset) are modelled
 * from its source, not observed. Nothing leaves the process.
 */
describe('R0-ID-F4 review F4-C (R0-ID-F7) — a RISC event revokes the sessions locally and, on hijacking, pauses them at the provider, with call shapes the installed auth-js accepts', () => {
  const USER = '6f1c1d36-5d7e-4c38-9a3f-0b7a3b0e2c11';
  const SERVICE_KEY = 'service-role-key-f7';
  const GOOGLE_ISSUER = 'https://accounts.google.com/';
  const CLIENT_ID = 'f7-client.apps.googleusercontent.com';
  const JWKS_URI = 'https://risc.f7.test/certs';
  const ADMIN_CUTOFF = `admin:user:${USER}:revokedAt`;
  // W7-RISC-REVOKE: the project's JWT secret, as GoTrue holds it and as the
  // server reads it from SUPABASE_JWT_SECRET. Obviously fake.
  const PROJECT_JWT_SECRET = 'w7-gotrue-project-jwt-secret-not-a-real-one';
  const b64url = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

  let keyPair: Awaited<ReturnType<typeof generateKeyPair>>;
  const savedEnv = { ...process.env };

  beforeEach(async () => {
    process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
    process.env.GOOGLE_CLIENT_IDS = '';
    keyPair = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(keyPair.publicKey)), kid: 'f7-key', use: 'sig', alg: 'RS256' };
    // Google's discovery document and JWKS only. The Supabase client below is
    // handed its own fetch, so nothing of the provider goes through this one.
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === 'https://accounts.google.com/.well-known/risc-configuration') {
        return new Response(JSON.stringify({ issuer: GOOGLE_ISSUER, jwks_uri: JWKS_URI }), { status: 200 });
      }
      if (url === JWKS_URI) return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
      return new Response('not found', { status: 404 });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...savedEnv };
  });

  type Call = { call: string; authorization: string | null; body: unknown };
  type GoTrueMode = 'up' | 'admin_500' | 'read_500' | 'network_down';

  /**
   * GoTrue at fetch level, for the calls in question:
   *   - GET /admin/users/:id (the service-role key as bearer) returns the user;
   *     banned_until is omitted while unset (models/user.go: omitempty).
   *   - PUT /admin/users/:id applies the attributes; ban_duration sets
   *     banned_until = now + duration, OVERWRITING whatever was there
   *     (models/user.go Ban()).
   *   - POST /logout takes the bearer as the user's JWT; a value that is not
   *     one is refused (bad_jwt) — the CR-2 refusal. W7-RISC-REVOKE: the JWT
   *     is verified as GoTrue verifies an HS256 token without a kid (against
   *     the project's JWT secret; bad_jwt otherwise), its sub must be a user
   *     (user_not_found), and a session_id claim must name a live session
   *     (session_not_found). With no session_id claim the Logout handler
   *     deletes every session of the user and so every refresh token
   *     (models.Logout), whatever the scope. A ban does not stand in its way.
   *   - POST /token?grant_type=refresh_token refuses while the user is banned
   *     (user_banned) and refuses a refresh token that is not live
   *     (refresh_token_not_found); otherwise it rotates the token and returns a
   *     new session. A ban keeps the refresh tokens (F7-SEC-2).
   */
  function fakeGoTrue(
    order: string[],
    state: { bannedUntil: number | null; refreshTokens: Set<string> },
    mode: GoTrueMode = 'up',
  ) {
    const calls: Call[] = [];
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    const userBody = (id: string) => ({
      id,
      aud: 'authenticated',
      ...(state.bannedUntil !== null ? { banned_until: new Date(state.bannedUntil).toISOString() } : {}),
    });
    const fetchImpl = async (input: unknown, init?: { method?: string; headers?: unknown; body?: unknown }) => {
      const url = new URL(String(input));
      const call = `${init?.method ?? 'GET'} ${url.pathname}${url.search}`;
      const authorization = new Headers(init?.headers as Record<string, string>).get('authorization');
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ call, authorization, body });
      order.push(`provider ${call}`);
      if (mode === 'network_down') throw new TypeError('fetch failed');
      const adminUser = url.pathname.match(/^\/auth\/v1\/admin\/users\/([^/]+)$/);
      if (adminUser && init?.method === 'PUT') {
        if (mode === 'admin_500') return json(500, { code: 500, error_code: 'unexpected_failure', msg: 'Database error updating user' });
        const ban = (body as { ban_duration?: string } | undefined)?.ban_duration;
        const seconds = ban ? Number(/^(\d+)s$/.exec(ban)?.[1] ?? NaN) : NaN;
        if (Number.isFinite(seconds)) state.bannedUntil = Date.now() + seconds * 1000;
        return json(200, userBody(adminUser[1]));
      }
      if (adminUser && (init?.method ?? 'GET') === 'GET') {
        if (mode === 'read_500') return json(500, { code: 500, error_code: 'unexpected_failure', msg: 'Database error finding user' });
        return json(200, userBody(adminUser[1]));
      }
      if (url.pathname === '/auth/v1/logout') {
        const bearer = (authorization ?? '').replace('Bearer ', '');
        if (bearer.split('.').length !== 3) {
          return json(403, { code: 403, error_code: 'bad_jwt', msg: 'invalid JWT: token contains an invalid number of segments' });
        }
        let claims: JWTPayload;
        try {
          ({ payload: claims } = await jwtVerify(bearer, new TextEncoder().encode(PROJECT_JWT_SECRET), { algorithms: ['HS256'] }));
        } catch {
          return json(403, { code: 403, error_code: 'bad_jwt', msg: 'invalid JWT: unable to parse or verify signature' });
        }
        if (claims.sub !== USER) {
          return json(403, { code: 403, error_code: 'user_not_found', msg: 'User from sub claim in JWT does not exist' });
        }
        if (claims.session_id) {
          return json(403, { code: 403, error_code: 'session_not_found', msg: 'Session from session_id claim in JWT does not exist' });
        }
        state.refreshTokens.clear();
        return new Response(null, { status: 204 });
      }
      if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
        const presented = (body as { refresh_token?: string } | undefined)?.refresh_token ?? '';
        if (state.bannedUntil !== null && state.bannedUntil > Date.now()) {
          return json(400, { code: 400, error_code: 'user_banned', msg: 'User is banned' });
        }
        if (!state.refreshTokens.has(presented)) {
          return json(400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' });
        }
        state.refreshTokens.delete(presented);
        const rotated = `${presented}-r`;
        state.refreshTokens.add(rotated);
        const iat = Math.floor(Date.now() / 1000);
        return json(200, {
          access_token: `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: USER, session_id: 's-hijacker', role: 'authenticated', iat, exp: iat + 3600 })}.c2ln`,
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: iat + 3600,
          refresh_token: rotated,
          user: userBody(USER),
        });
      }
      return json(404, {});
    };
    return { calls, fetchImpl };
  }

  /** The hijacker's own supabase-js client (anon key), on the same fake GoTrue. */
  function hijackerAuth(fetchImpl: unknown) {
    return createClient('http://gotrue.f7.test', 'w7-anon-key-not-real', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: fetchImpl as typeof fetch },
    }).auth;
  }

  function memoryRedis(order: string[], opts: { down?: boolean } = {}) {
    const store = new Map<string, { value: string; ttl: number }>();
    return {
      store,
      setex: vi.fn(async (k: string, ttl: number, v: string) => {
        order.push(`setex ${k}`);
        if (opts.down) throw new Error('redis down');
        store.set(k, { value: String(v), ttl });
        return 'OK';
      }),
      set: vi.fn(async (k: string, v: string, mode?: string, ttl?: number) => {
        order.push(`set ${k}`);
        if (opts.down) throw new Error('redis down');
        store.set(k, { value: String(v), ttl: mode === 'EX' ? Number(ttl) : -1 });
        return 'OK';
      }),
      get: vi.fn(async (k: string) => store.get(k)?.value ?? null),
      pttl: vi.fn(async (k: string) => (store.has(k) ? (store.get(k)?.ttl ?? 0) * 1000 : -2)),
    };
  }

  function build(
    opts: {
      mode?: GoTrueMode;
      redisDown?: boolean;
      bannedUntil?: number | null;
      /** SUPABASE_JWT_SECRET as the server holds it; null leaves it unset. Default: the project's. */
      serverJwtSecret?: string | null;
      refreshTokens?: string[];
    } = {},
  ) {
    const order: string[] = [];
    const state = { bannedUntil: opts.bannedUntil ?? null, refreshTokens: new Set(opts.refreshTokens ?? []) };
    const gt = fakeGoTrue(order, state, opts.mode);
    const admin = new SupabaseAdminService();
    (admin as unknown as { client: unknown }).client = createClient('http://gotrue.f7.test', SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: gt.fetchImpl as unknown as typeof fetch },
    });
    // isConfigured reads the environment; the client itself is the injected one.
    process.env.SUPABASE_URL = 'http://gotrue.f7.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
    const serverJwtSecret = opts.serverJwtSecret === undefined ? PROJECT_JWT_SECRET : opts.serverJwtSecret;
    if (serverJwtSecret === null) delete process.env.SUPABASE_JWT_SECRET;
    else process.env.SUPABASE_JWT_SECRET = serverJwtSecret;
    const redis = memoryRedis(order, { down: opts.redisDown });
    const riscCreate = vi.fn(async (_args: unknown) => undefined);
    const prisma = {
      client: {
        riscEvent: { findUnique: vi.fn(async () => null), create: riscCreate },
        userIdentity: { findUnique: vi.fn(async () => ({ userId: USER })) },
        session: {
          deleteMany: vi.fn(async () => {
            order.push('local session deleteMany');
            return { count: 2 };
          }),
        },
        user: { findUnique: vi.fn(async () => ({ metaData: {} })), update: vi.fn(async () => undefined) },
      },
    };
    const audit = vi.fn(async (_entry: unknown) => undefined);
    const risc = new RiscService(
      prisma as never,
      admin,
      { audit } as never,
      { on: vi.fn(), emit: vi.fn() } as never,
      redis as never,
    );
    const warn = vi.fn();
    (risc as unknown as { logger: unknown }).logger = { warn, debug: vi.fn(), log: vi.fn(), error: vi.fn() };
    const actionTaken = () => (riscCreate.mock.calls[0]?.[0] as { data: { actionTaken: string } } | undefined)?.data.actionTaken;
    const audited = () => audit.mock.calls[0]?.[0] as { outcome: string; reason: string; metadata: Record<string, unknown> } | undefined;
    return { risc, admin, gt, state, redis, order, warn, prisma, actionTaken, audited };
  }

  async function riscToken(eventType: string, reason?: string) {
    const details: Record<string, unknown> = { subject: { subject_type: 'iss-sub', iss: GOOGLE_ISSUER, sub: 'google-sub-f7' } };
    if (reason) details.reason = reason;
    return new SignJWT({ jti: `f7-${Math.random().toString(36).slice(2)}`, events: { [eventType]: details } })
      .setProtectedHeader({ alg: 'RS256', kid: 'f7-key', typ: 'JWT' })
      .setIssuer(GOOGLE_ISSUER)
      .setAudience(CLIENT_ID)
      .setIssuedAt()
      .sign(keyPair.privateKey);
  }
  const hijacking = () => riscToken(RISC_EVENT_TYPES.ACCOUNT_DISABLED, 'hijacking');

  const readCall = `GET /auth/v1/admin/users/${USER}`;
  const banCall = `PUT /auth/v1/admin/users/${USER}`;
  // W7-RISC-REVOKE (D-39): the global sign-out under the server-minted user JWT.
  const logoutCall = 'POST /auth/v1/logout?scope=global';
  const JWT_BEARER = /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

  it('account-disabled/hijacking: GoTrue is read, then receives the admin ban by user id under the service-role key, never POST /logout with the user id as its bearer', async () => {
    const h = build();
    await expect(h.risc.receiveEvent(await hijacking())).resolves.toEqual({ status: 202, processed: true });

    // W7-RISC-REVOKE (D-39): the one POST /logout is the global sign-out, and
    // its bearer is a user JWT; never the user id (the CR-2 shape).
    expect(h.gt.calls.filter((c) => c.call.startsWith('POST /auth/v1/logout') && c.authorization === `Bearer ${USER}`)).toEqual([]);
    expect(h.gt.calls).toEqual([
      { call: logoutCall, authorization: expect.stringMatching(JWT_BEARER), body: undefined },
      { call: readCall, authorization: `Bearer ${SERVICE_KEY}`, body: undefined },
      { call: banCall, authorization: `Bearer ${SERVICE_KEY}`, body: { ban_duration: expect.stringMatching(/^\d+s$/) } },
    ]);
    expect(JSON.stringify(h.gt.calls)).not.toContain(`Bearer ${USER}`);
    expect(h.actionTaken()).toBe('account_disabled_hijacking');
  });

  it.each([
    ['sessions-revoked', RISC_EVENT_TYPES.SESSIONS_REVOKED],
    ['tokens-revoked', RISC_EVENT_TYPES.TOKENS_REVOKED],
    ['token-revoked', RISC_EVENT_TYPES.TOKEN_REVOKED],
  ])(
    '%s: no provider traffic at all — no ban, so GoTrue keeps letting the user sign in (F7-CR-1) — and the local cutoffs are written',
    async (_name, eventType) => {
      const h = build();
      await expect(h.risc.receiveEvent(await riscToken(eventType))).resolves.toEqual({ status: 202, processed: true });
      expect(h.gt.calls).toEqual([]);
      expect(h.state.bannedUntil).toBeNull();
      expect(h.redis.store.get(logoutRevocationKey(USER))?.value).toMatch(/^\d+$/);
      expect(h.redis.store.get(ADMIN_CUTOFF)?.value).toMatch(/^\d+$/);
    },
  );

  it('the local logout cutoff is written FIRST (then the admin-token cutoff, the Session rows, then the provider), in the format and TTL POST /identity/logout uses', async () => {
    const h = build();
    const beforeMs = Date.now();
    const before = Math.floor(beforeMs / 1000);
    await h.risc.receiveEvent(await hijacking());
    const afterMs = Date.now();
    const after = Math.floor(afterMs / 1000);

    expect(h.order).toEqual([
      `setex ${logoutRevocationKey(USER)}`,
      `set ${ADMIN_CUTOFF}`,
      'local session deleteMany',
      // W7-RISC-REVOKE (D-39): the global sign-out, before the ban is read.
      `provider ${logoutCall}`,
      `provider ${readCall}`,
      `provider ${banCall}`,
    ]);
    const marker = h.redis.store.get(logoutRevocationKey(USER));
    expect(marker?.ttl).toBe(LOGOUT_REVOCATION_TTL_SECONDS);
    expect(Number(marker?.value)).toBeGreaterThanOrEqual(before);
    expect(Number(marker?.value)).toBeLessThanOrEqual(after);
    const adminCutoff = h.redis.store.get(ADMIN_CUTOFF);
    expect(adminCutoff?.ttl).toBe(LOGOUT_REVOCATION_TTL_SECONDS);
    expect(Number(adminCutoff?.value)).toBeGreaterThanOrEqual(beforeMs);
    expect(Number(adminCutoff?.value)).toBeLessThanOrEqual(afterMs);
  });

  it.each([
    ['sessions-revoked', RISC_EVENT_TYPES.SESSIONS_REVOKED, undefined],
    ['account-disabled/hijacking', RISC_EVENT_TYPES.ACCOUNT_DISABLED, 'hijacking'],
  ] as Array<[string, string, string | undefined]>)(
    '%s: the real AuthMiddleware then refuses a token of a session authenticated before the event (a refreshed one included) and attaches one authenticated after it',
    async (_name, eventType, reason) => {
      const h = build();
      await h.risc.receiveEvent(await riscToken(eventType, reason));

      const now = Math.floor(Date.now() / 1000);
      const tokenFor = (authenticatedAt: number, iat: number) =>
        `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: USER, session_id: 's-f7', role: 'authenticated', iat, exp: iat + 3600, amr: [{ method: 'oauth', timestamp: authenticatedAt }] })}.c2ln`;
      const supabaseAuth = { getUserFromToken: vi.fn(async () => ({ id: USER, email: 'f7@example.com' })) };
      const prisma = { client: { user: { findUnique: vi.fn(async () => ({ role: 'USER', deletedAt: null, bannedAt: null })) } } };
      const mw = new AuthMiddleware(supabaseAuth as never, prisma as never, h.redis as never);
      const attached = async (token: string) => {
        const req = { headers: { authorization: `Bearer ${token}` } } as unknown as Request & { user?: { id: string } };
        await mw.use(req, {} as never, () => undefined);
        return req.user?.id ?? null;
      };

      // Signed in an hour ago; this access token minted just now by a refresh.
      expect(await attached(tokenFor(now - 3600, now))).toBeNull();
      // A session the user opens after the event.
      expect(await attached(tokenFor(now + 2, now + 2))).toBe(USER);
    },
  );

  it.each([
    ['sessions-revoked', RISC_EVENT_TYPES.SESSIONS_REVOKED, undefined],
    ['account-disabled/hijacking', RISC_EVENT_TYPES.ACCOUNT_DISABLED, 'hijacking'],
  ] as Array<[string, string, string | undefined]>)(
    '%s: an admin local-auth token issued before the event is refused by the real verifier, one issued after it is accepted, as after POST /identity/logout (F7-SEC-4)',
    async (_name, eventType, reason) => {
      const secret = 'f7-admin-secret';
      process.env.ADMIN_JWT_SECRET = secret;
      const h = build();
      const identity = { id: USER, email: 'f7@example.com', role: 'ADMIN' };
      const before = buildAdminToken(identity, secret);
      await new Promise((r) => setTimeout(r, 5));
      await h.risc.receiveEvent(await riscToken(eventType, reason));
      await new Promise((r) => setTimeout(r, 5));
      const afterEvent = buildAdminToken(identity, secret);

      expect(await verifyAdminToken(before, h.redis as never)).toBeNull();
      expect(await verifyAdminToken(afterEvent, h.redis as never)).toEqual(identity);
    },
  );

  it('the ban outlasts a default (1h) Supabase access token — every live client meets it at its next refresh — and does not outlast the local cutoff', async () => {
    const h = build();
    await h.risc.receiveEvent(await hijacking());
    const ban = (h.gt.calls.find((c) => c.call === banCall)?.body as { ban_duration?: string } | undefined)?.ban_duration ?? '';
    const seconds = Number(/^(\d+)s$/.exec(ban)?.[1]);
    expect(seconds).toBeGreaterThan(3600);
    expect(seconds).toBeLessThanOrEqual(LOGOUT_REVOCATION_TTL_SECONDS);
  });

  it("an operator's indefinite ban already on the account survives a hijacking event: GoTrue is read, not written, and banned_until is unchanged (F7-SEC-1, F7-CR-2)", async () => {
    const indefinite = Date.now() + 100 * 365 * 24 * 3600 * 1000; // the dashboard's "permanent" ban
    const h = build({ bannedUntil: indefinite });
    await expect(h.risc.receiveEvent(await hijacking())).resolves.toEqual({ status: 202, processed: true });
    // W7-RISC-REVOKE (D-39): the global sign-out runs whatever ban is on the account.
    expect(h.gt.calls.map((c) => c.call)).toEqual([logoutCall, readCall]);
    expect(h.state.bannedUntil).toBe(indefinite);
    expect(h.actionTaken()).toBe('account_disabled_hijacking');
  });

  it('a ban that would lapse sooner than the RISC ban is extended to it', async () => {
    const h = build({ bannedUntil: Date.now() + 5 * 60 * 1000 });
    await h.risc.receiveEvent(await hijacking());
    expect(h.gt.calls.map((c) => c.call)).toEqual([logoutCall, readCall, banCall]);
    expect(h.state.bannedUntil).toBeGreaterThan(Date.now() + 3600 * 1000);
  });

  it.each([
    // W7-RISC-REVOKE (D-39): the global sign-out comes first; it holds while
    // only the admin API fails, and fails with the network.
    ['GoTrue answers 500 to the ban', 'admin_500', [logoutCall, readCall, banCall], 'provider_ban'],
    ['GoTrue answers 500 to the read (nothing is written blind)', 'read_500', [logoutCall, readCall], 'provider_ban'],
    ['the network is down', 'network_down', [logoutCall, readCall], 'provider_signout,provider_ban'],
  ] as Array<[string, GoTrueMode, string[], string]>)(
    'a provider failure (%s) is logged, named on actionTaken, does not skip the local cutoff, and the event is still accepted',
    async (_name, mode, expectedCalls, failedLegs) => {
      const h = build({ mode });
      await expect(h.risc.receiveEvent(await hijacking())).resolves.toEqual({ status: 202, processed: true });
      expect(h.gt.calls.map((c) => c.call)).toEqual(expectedCalls);
      expect(h.state.bannedUntil).toBeNull();
      expect(h.redis.store.get(logoutRevocationKey(USER))?.value).toMatch(/^\d+$/);
      expect(h.warn.mock.calls.some((c) => String(c[0]).includes(USER))).toBe(true);
      expect(h.actionTaken()).toBe(`account_disabled_hijacking:revocation_incomplete:${failedLegs}`);
      expect(h.audited()?.outcome).toBe('success');
    },
  );

  it('a Redis failure is logged and does not skip the provider ban', async () => {
    const h = build({ redisDown: true });
    await expect(h.risc.receiveEvent(await hijacking())).resolves.toEqual({ status: 202, processed: true });
    expect(h.gt.calls.map((c) => c.call)).toEqual([logoutCall, readCall, banCall]);
    expect(JSON.stringify(h.warn.mock.calls)).toContain('redis down');
  });

  it('F7-SEC-3: Redis down and GoTrue refusing the ban — the RiscEvent row and the audit name every failed leg; the audit outcome is error', async () => {
    const h = build({ mode: 'admin_500', redisDown: true });
    await expect(h.risc.receiveEvent(await hijacking())).resolves.toEqual({ status: 202, processed: true });
    expect(h.redis.store.size).toBe(0);
    const legs = ['revocation_marker', 'admin_cutoff', 'provider_ban'];
    expect(h.actionTaken()).toBe(`account_disabled_hijacking:revocation_incomplete:${legs.join(',')}`);
    expect(h.audited()).toMatchObject({
      outcome: 'error',
      reason: `risc:${RISC_EVENT_TYPES.ACCOUNT_DISABLED}; revocation_incomplete: ${legs.join(', ')}`,
      metadata: { actionTaken: h.actionTaken(), revocationIncomplete: legs },
    });
  });

  it('F7-SEC-3: sessions-revoked with Redis down — not recorded as sessions_terminated / success', async () => {
    const h = build({ redisDown: true });
    await h.risc.receiveEvent(await riscToken(RISC_EVENT_TYPES.SESSIONS_REVOKED));
    expect(h.actionTaken()).toBe('sessions_terminated:revocation_incomplete:revocation_marker,admin_cutoff');
    expect(h.audited()?.outcome).toBe('error');
  });

  /**
   * R0-ID-F7 review F7-SEC-2, W7-RISC-REVOKE (D-39: the provider global
   * logout, not a schema cutoff), where SUPABASE_JWT_SECRET holds the
   * project's JWT secret. Before: a ban PAUSES the pre-event session — GoTrue
   * refuses a refresh while the user is banned but keeps the refresh token, and
   * a ban does not log the user out — so once the 65-minute ban and the 24h
   * auth:revoked:user cutoff lapsed, the hijacker's refresh token minted
   * sessions again with no new login. Now the handler also sends
   * POST /logout?scope=global under a short-lived user JWT minted with that
   * secret (no session_id claim), and GoTrue deletes every session and refresh
   * token of the user. This does NOT close F7-SEC-2 (review CR-W7RR-1): a
   * Release 0 server leaves the secret empty, and there the residual stands
   * (the it.todo cases below). sessions-revoked/tokens-revoked/token-revoked
   * keep no provider traffic (F7-CR-1, pinned above; CR-W7RR-2 below).
   */
  it("R0-ID-F7 review F7-SEC-2, W7-RISC-REVOKE (D-39), where SUPABASE_JWT_SECRET is set (not the Release 0 configuration): account-disabled/hijacking REVOKES the pre-event Supabase session instead of only pausing it — once the 65-minute ban and the 24h auth:revoked:user cutoff lapse, the hijacker's refresh token is refused by GoTrue (refresh_token_not_found) and mints no session", async () => {
    const h = build({ refreshTokens: ['w7-hijacker-rt'] });
    const hijacker = hijackerAuth(h.gt.fetchImpl);

    // Before the event the hijacker's refresh token mints sessions (and rotates).
    const beforeEvent = await hijacker.refreshSession({ refresh_token: 'w7-hijacker-rt' });
    expect(beforeEvent.error).toBeNull();
    const held = beforeEvent.data.session?.refresh_token ?? '';
    expect(held).toBe('w7-hijacker-rt-r');

    await expect(h.risc.receiveEvent(await hijacking())).resolves.toEqual({ status: 202, processed: true });
    expect(h.actionTaken()).toBe('account_disabled_hijacking');
    expect(h.state.refreshTokens.size).toBe(0);

    // Both locks run out: the provider ban lapses and the local cutoffs expire.
    h.state.bannedUntil = Date.now() - 1000;
    h.redis.store.delete(logoutRevocationKey(USER));
    h.redis.store.delete(ADMIN_CUTOFF);

    const afterLapse = await hijacker.refreshSession({ refresh_token: held });
    expect(afterLapse.data.session).toBeNull();
    expect(afterLapse.error?.code).toBe('refresh_token_not_found');
  });

  it('W7-RISC-REVOKE (D-39): the global sign-out bearer is a user JWT the project secret signs (HS256 without kid, sub the user, role and aud authenticated, no session_id, expiring within two minutes), never the user id or the service-role key', async () => {
    const h = build();
    const nowSeconds = Math.floor(Date.now() / 1000);
    await h.risc.receiveEvent(await hijacking());

    const logout = h.gt.calls.find((c) => c.call === logoutCall);
    expect(logout?.authorization).toMatch(JWT_BEARER);
    expect(logout?.authorization).not.toBe(`Bearer ${USER}`);
    expect(logout?.authorization).not.toBe(`Bearer ${SERVICE_KEY}`);
    const bearer = (logout?.authorization ?? '').replace('Bearer ', '');
    const { payload, protectedHeader } = await jwtVerify(bearer, new TextEncoder().encode(PROJECT_JWT_SECRET), {
      algorithms: ['HS256'],
      audience: 'authenticated',
      issuer: 'http://gotrue.f7.test/auth/v1',
    });
    expect(protectedHeader.kid).toBeUndefined();
    expect(payload).toMatchObject({ sub: USER, role: 'authenticated', aud: 'authenticated' });
    expect(payload.session_id).toBeUndefined();
    expect(payload.iat).toBeGreaterThanOrEqual(nowSeconds - 1);
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBeGreaterThan(0);
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBeLessThanOrEqual(120);
  });

  it.each([
    ['unset', null],
    // W7-RISC-REVOKE review CR-W7RR-1: the Release 0 rule (DEPLOYMENT.md, docs/auth-pathway.md).
    ['empty (the Release 0 rule)', ''],
  ] as Array<[string, string | null]>)('W7-RISC-REVOKE (D-39): with SUPABASE_JWT_SECRET %s no user JWT can be minted — no POST /logout is sent, the ban still applies, and provider_signout is named on actionTaken and in the audit', async (_name, serverJwtSecret) => {
    const h = build({ serverJwtSecret, refreshTokens: ['w7-hijacker-rt'] });
    await expect(h.risc.receiveEvent(await hijacking())).resolves.toEqual({ status: 202, processed: true });
    expect(h.gt.calls.map((c) => c.call)).toEqual([readCall, banCall]);
    expect(h.state.bannedUntil).toBeGreaterThan(Date.now() + 3600 * 1000);
    expect(h.state.refreshTokens.has('w7-hijacker-rt')).toBe(true);
    expect(h.warn.mock.calls.some((c) => String(c[0]).includes(USER))).toBe(true);
    expect(h.actionTaken()).toBe('account_disabled_hijacking:revocation_incomplete:provider_signout');
    expect(h.audited()).toMatchObject({
      outcome: 'success',
      reason: `risc:${RISC_EVENT_TYPES.ACCOUNT_DISABLED}; revocation_incomplete: provider_signout`,
      metadata: { revocationIncomplete: ['provider_signout'] },
    });
  });

  it('W7-RISC-REVOKE (D-39): GoTrue refusing the minted JWT (SUPABASE_JWT_SECRET is not the project secret) is logged without the token, named provider_signout, and does not skip the ban', async () => {
    const h = build({ serverJwtSecret: 'w7-another-projects-jwt-secret-not-real-either', refreshTokens: ['w7-hijacker-rt'] });
    const adminWarn = vi.fn();
    (h.admin as unknown as { logger: unknown }).logger = { warn: adminWarn, debug: vi.fn(), log: vi.fn(), error: vi.fn() };
    await expect(h.risc.receiveEvent(await hijacking())).resolves.toEqual({ status: 202, processed: true });

    expect(h.gt.calls.map((c) => c.call)).toEqual([logoutCall, readCall, banCall]);
    expect(h.state.refreshTokens.has('w7-hijacker-rt')).toBe(true);
    expect(h.state.bannedUntil).toBeGreaterThan(Date.now() + 3600 * 1000);
    expect(h.actionTaken()).toBe('account_disabled_hijacking:revocation_incomplete:provider_signout');
    expect(adminWarn).toHaveBeenCalled();
    const bearer = (h.gt.calls.find((c) => c.call === logoutCall)?.authorization ?? '').replace('Bearer ', '');
    expect(bearer.length).toBeGreaterThan(20);
    expect(JSON.stringify([adminWarn.mock.calls, h.warn.mock.calls])).not.toContain(bearer);
  });

  it('W7-RISC-REVOKE (D-39): with the Supabase admin client not configured neither the sign-out nor the ban is sent, and both are named on actionTaken', async () => {
    const h = build({ refreshTokens: ['w7-hijacker-rt'] });
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await expect(h.risc.receiveEvent(await hijacking())).resolves.toEqual({ status: 202, processed: true });
    expect(h.gt.calls).toEqual([]);
    expect(h.redis.store.get(logoutRevocationKey(USER))?.value).toMatch(/^\d+$/);
    expect(h.actionTaken()).toBe('account_disabled_hijacking:revocation_incomplete:provider_signout,provider_ban');
  });

  // W7-RISC-REVOKE review SEC-W7RR-2 (D-39): the events that end no session
  // send nothing to GoTrue either, with the secret that lets the sign-out run.
  // account-enabled restores a recovered user: a global sign-out there would
  // log that user out everywhere.
  it.each([
    ['account-enabled', RISC_EVENT_TYPES.ACCOUNT_ENABLED, undefined],
    ['account-credential-change-required', RISC_EVENT_TYPES.ACCOUNT_CREDENTIAL_CHANGE_REQUIRED, undefined],
    ['verification', RISC_EVENT_TYPES.VERIFICATION, undefined],
    ['account-disabled/bulk-account', RISC_EVENT_TYPES.ACCOUNT_DISABLED, 'bulk-account'],
  ] as Array<[string, string, string | undefined]>)(
    'W7-RISC-REVOKE review SEC-W7RR-2 (D-39): %s sends GoTrue nothing — no global sign-out, no ban, no read — and the refresh tokens stay',
    async (_name, eventType, reason) => {
      const h = build({ refreshTokens: ['w7-user-rt'] });
      await expect(h.risc.receiveEvent(await riscToken(eventType, reason))).resolves.toEqual({ status: 202, processed: true });
      expect(h.gt.calls).toEqual([]);
      expect(h.state.refreshTokens.has('w7-user-rt')).toBe(true);
      expect(h.redis.store.size).toBe(0);
      expect(h.actionTaken()).not.toContain('revocation_incomplete');
    },
  );

  // W7-RISC-REVOKE review CR-W7RR-1 (D-39): a server that can accept a RISC
  // event but cannot revoke at the provider says so at boot.
  it.each([
    ['unset', null],
    ['empty (the Release 0 rule)', ''],
  ] as Array<[string, string | null]>)(
    'W7-RISC-REVOKE review CR-W7RR-1 (D-39): with SUPABASE_JWT_SECRET %s and a Google client id set, boot warns that a hijacking event cannot revoke the Supabase sessions',
    async (_name, serverJwtSecret) => {
      const h = build({ serverJwtSecret });
      h.risc.onApplicationBootstrap();
      const said = h.warn.mock.calls.map((c) => String(c[0])).filter((m) => m.startsWith('RISC: '));
      expect(said).toHaveLength(1);
      expect(said[0]).toContain('SUPABASE_JWT_SECRET is empty');
      expect(said[0]).toContain('cannot revoke');
      expect(said[0]).toContain('F7-SEC-2');
      expect(h.gt.calls).toEqual([]);
    },
  );

  it('W7-RISC-REVOKE review CR-W7RR-1 (D-39): no boot warning where the sign-out can run, nor where RISC accepts no event (no Google client id)', async () => {
    const withSecret = build();
    withSecret.risc.onApplicationBootstrap();
    expect(withSecret.warn.mock.calls.filter((c) => String(c[0]).startsWith('RISC: '))).toEqual([]);

    const noRisc = build({ serverJwtSecret: '' });
    process.env.GOOGLE_CLIENT_ID = '';
    process.env.GOOGLE_CLIENT_IDS = '';
    noRisc.risc.onApplicationBootstrap();
    expect(noRisc.warn.mock.calls.filter((c) => String(c[0]).startsWith('RISC: '))).toEqual([]);
  });

  // The residuals of R0-ID-F7 review F7-SEC-2 that W7-RISC-REVOKE leaves open,
  // found by its review. Each keeps the prefix release0-index.json explains
  // F7-SEC-2 under (status OPEN), so the Release 0 item is not counted closed.
  it.todo(
    "R0-ID-F7 review F7-SEC-2 (residual, needs a follow-up packet; W7-RISC-REVOKE review CR-W7RR-1, D-39 has no recorded owner ruling): under the Release 0 rule SUPABASE_JWT_SECRET is EMPTY (docs/auth-pathway.md, DEPLOYMENT.md, env.spec.ts), so SupabaseAdminService.revokeAllSessions mints no user JWT and sends no POST /logout: on account-disabled/hijacking only the 65-minute ban and the 24h auth:revoked:user cutoff hold, and once both lapse the hijacker's pre-event refresh token mints sessions again (reproduced on this harness with serverJwtSecret null and ''). The live W7-RISC-REVOKE case above holds only where the secret is set. Fix: an owner ruling on D-39 that amends the Release 0 rule for this secret, or a revocation by user id that needs no server-held HS256 secret.",
  );
  it.todo(
    "R0-ID-F7 review F7-SEC-2 (residual, needs a follow-up packet; W7-RISC-REVOKE review CR-W7RR-2, needs a ruling): sessions-revoked, tokens-revoked and token-revoked send nothing to the provider (F7-CR-1 forbids the ban, and the required cases above pin no provider traffic), so the pre-event refresh token stays live at GoTrue and only the 24h auth:revoked:user cutoff refuses its sessions; once it lapses that token's sessions are attached again with no new login, while RiscEvent.actionTaken records a clean sessions_terminated. Fix: a ruling extending the provider global sign-out (which signs the user out but does not lock them out) to these events, or a durable cutoff.",
  );
  it.todo(
    "R0-ID-F7 review F7-SEC-2 (residual, needs a follow-up packet; W7-RISC-REVOKE review SEC-W7RR-1, outside its write set): in a deployment no RISC event reaches a user, so no revocation leg runs. RiscService.resolveUser maps the Google sub through UserIdentity, whose only writer (IdentityService.persistUserIdentities) runs only when bootstrapUser is handed identities, and POST /identity/bootstrap has never forwarded body.identities (since adcb2aeb; the web callback sends them): every event resolves to no_matching_user. Fix in identity: read the identities on the server from GoTrue (admin.getUserById(user.id).identities), never from the request body, whose upsert would let a signed-in user claim another person's Google sub and redirect that person's hijacking revocation.",
  );
});
