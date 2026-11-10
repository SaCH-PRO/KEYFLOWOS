import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request } from 'express';
import { createClient } from '@supabase/supabase-js';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
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
 *
 * D-97 (W8-RISC-SIGNIN-CUTOFF; owner ruling, resolves D-39) closes F7-SEC-2
 * at this API instead: every session-ending event (account-disabled/hijacking,
 * sessions-revoked, tokens-revoked, token-revoked) also records a DURABLE
 * per-user sign-in cutoff on the User row (User.metaData.signInCutoffAt, the
 * event time in epoch seconds, never lowered), and the real AuthMiddleware
 * refuses every Supabase token whose ORIGINAL sign-in (the session's amr
 * timestamps, which a refresh carries over unchanged) is not after it, however
 * long ago the 65-minute ban and the 24h auth:revoked:user cutoff lapsed. The
 * hijacker's pre-event refresh token may still mint access tokens at GoTrue;
 * none of them is admitted here. The real user simply signs in again. The
 * provider global logout W7-RISC-REVOKE added (POST /logout under a user JWT
 * minted with SUPABASE_JWT_SECRET) is gone: R0-SEC-02 keeps that secret empty,
 * and D-97 says the provider global logout is not used. The UserIdentity row
 * an event resolves its user by is written at POST /identity/bootstrap from
 * the VERIFIED provider record, never from the request body (SEC-W7RR-1; end
 * to end against Postgres in test/risc-signin-cutoff.integration.test.ts).
 *
 * The real RiscService (signed RISC token, real jose verification against a
 * stubbed Google JWKS), the real SupabaseAdminService, the installed auth-js
 * client on a recording fetch, and the real AuthMiddleware and admin-token
 * verifier reading the cutoffs; one in-memory User row is what RiscService
 * writes and AuthMiddleware reads. GoTrue's ban semantics (Ban(): banned_until
 * = now + duration, overwriting; banned_until omitted when unset) and its
 * refresh (amr carried over to every access token a session's refresh token
 * mints) are modelled from its source, not observed. Nothing leaves the
 * process.
 */
describe('R0-ID-F4 review F4-C (R0-ID-F7) — a RISC event revokes the sessions locally and, on hijacking, pauses them at the provider, with call shapes the installed auth-js accepts', () => {
  const USER = '6f1c1d36-5d7e-4c38-9a3f-0b7a3b0e2c11';
  const SERVICE_KEY = 'service-role-key-f7';
  const GOOGLE_ISSUER = 'https://accounts.google.com/';
  const CLIENT_ID = 'f7-client.apps.googleusercontent.com';
  const JWKS_URI = 'https://risc.f7.test/certs';
  const ADMIN_CUTOFF = `admin:user:${USER}:revokedAt`;
  // The Google sub GoTrue holds for USER (its google identity), and the one a
  // RISC event names.
  const GOOGLE_SUB = 'google-sub-f7';
  const b64url = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const claimsOf = (jwt: string) => JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;

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
  type GoTrueState = {
    bannedUntil: number | null;
    refreshTokens: Set<string>;
    /** When the session behind each live refresh token signed in (epoch seconds). */
    signedInAt: Map<string, number>;
  };

  /**
   * GoTrue at fetch level, for the calls in question:
   *   - GET /admin/users/:id (the service-role key as bearer) returns the user,
   *     with its identities (the google one: provider id GOOGLE_SUB);
   *     banned_until is omitted while unset (models/user.go: omitempty).
   *   - PUT /admin/users/:id applies the attributes; ban_duration sets
   *     banned_until = now + duration, OVERWRITING whatever was there
   *     (models/user.go Ban()).
   *   - POST /logout takes the bearer as the user's JWT; a value that is not
   *     one is refused (bad_jwt) — the CR-2 refusal. D-97: nothing sends it
   *     on a RISC event any more; the cases assert it is never called.
   *   - POST /token?grant_type=refresh_token refuses while the user is banned
   *     (user_banned) and refuses a refresh token that is not live
   *     (refresh_token_not_found); otherwise it rotates the token and returns a
   *     new session whose access token carries the session's ORIGINAL sign-in
   *     in amr (a refresh carries amr over unchanged) and a fresh iat. A ban
   *     keeps the refresh tokens (F7-SEC-2).
   */
  function fakeGoTrue(order: string[], state: GoTrueState, mode: GoTrueMode = 'up') {
    const calls: Call[] = [];
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    const userBody = (id: string) => ({
      id,
      aud: 'authenticated',
      email: 'f7@example.com',
      identities: [
        {
          identity_id: '0b0d1a5e-7c1f-4f7e-9a51-2b7d3c4e5f60',
          id: GOOGLE_SUB,
          user_id: id,
          provider: 'google',
          identity_data: { sub: GOOGLE_SUB, email: 'f7@example.com', email_verified: true },
        },
      ],
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
        const signedInAt = state.signedInAt.get(presented) ?? Math.floor(Date.now() / 1000);
        state.refreshTokens.delete(presented);
        state.signedInAt.delete(presented);
        const rotated = `${presented}-r`;
        state.refreshTokens.add(rotated);
        state.signedInAt.set(rotated, signedInAt);
        const iat = Math.floor(Date.now() / 1000);
        return json(200, {
          access_token: `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: USER, session_id: 's-hijacker', role: 'authenticated', iat, exp: iat + 3600, amr: [{ method: 'oauth', timestamp: signedInAt }] })}.c2ln`,
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
      /**
       * SUPABASE_JWT_SECRET as the server holds it; null leaves it unset.
       * Default: empty, the Release 0 rule (R0-SEC-02). D-97: nothing on the
       * RISC path reads it any more, whatever it holds.
       */
      serverJwtSecret?: string | null;
      refreshTokens?: string[];
      /** When the sessions behind `refreshTokens` signed in (epoch seconds); default two hours ago. */
      signedInAt?: number;
    } = {},
  ) {
    const order: string[] = [];
    const signedInAt = opts.signedInAt ?? Math.floor(Date.now() / 1000) - 2 * 3600;
    const state: GoTrueState = {
      bannedUntil: opts.bannedUntil ?? null,
      refreshTokens: new Set(opts.refreshTokens ?? []),
      signedInAt: new Map((opts.refreshTokens ?? []).map((t) => [t, signedInAt])),
    };
    const gt = fakeGoTrue(order, state, opts.mode);
    const admin = new SupabaseAdminService();
    (admin as unknown as { client: unknown }).client = createClient('http://gotrue.f7.test', SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: gt.fetchImpl as unknown as typeof fetch },
    });
    // isConfigured reads the environment; the client itself is the injected one.
    process.env.SUPABASE_URL = 'http://gotrue.f7.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
    const serverJwtSecret = opts.serverJwtSecret === undefined ? '' : opts.serverJwtSecret;
    if (serverJwtSecret === null) delete process.env.SUPABASE_JWT_SECRET;
    else process.env.SUPABASE_JWT_SECRET = serverJwtSecret;
    const redis = memoryRedis(order, { down: opts.redisDown });
    const riscCreate = vi.fn(async (_args: unknown) => undefined);
    // The one User row: RiscService writes its metaData (the D-97 sign-in
    // cutoff, the googleSignInDisabled flag), AuthMiddleware reads it.
    const userRow: { role: string; deletedAt: Date | null; bannedAt: Date | null; metaData: Record<string, unknown> } = {
      role: 'USER',
      deletedAt: null,
      bannedAt: null,
      metaData: {},
    };
    const client = {
      riscEvent: { findUnique: vi.fn(async () => null), create: riscCreate },
      userIdentity: { findUnique: vi.fn(async () => ({ userId: USER })) },
      session: {
        deleteMany: vi.fn(async () => {
          order.push('local session deleteMany');
          return { count: 2 };
        }),
      },
      user: {
        findUnique: vi.fn(async () => ({ ...userRow, metaData: { ...userRow.metaData } })),
        update: vi.fn(async (args: { data: { metaData?: Record<string, unknown> } }) => {
          if (args.data.metaData) userRow.metaData = { ...args.data.metaData };
          return undefined;
        }),
      },
      // D-97 review SEC-W8RSC-1: RiscService changes User.metaData in a
      // transaction that first takes the User row lock; the one in-memory row
      // needs no lock, so the callback runs on this same client.
      $queryRaw: vi.fn(async () => []),
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(client)),
    };
    const prisma = { client };
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
    return { risc, admin, gt, state, redis, order, warn, prisma, userRow, actionTaken, audited };
  }

  /**
   * The real AuthMiddleware over the harness's Redis and User row. Token
   * verification is the stand-in (the fake GoTrue signs nothing): whatever is
   * presented verifies as USER, so what is under test is the middleware's
   * decision after verification — the cutoffs.
   */
  function realMiddleware(h: ReturnType<typeof build>) {
    const supabaseAuth = { getUserFromToken: vi.fn(async () => ({ id: USER, email: 'f7@example.com' })) };
    const mw = new AuthMiddleware(supabaseAuth as never, h.prisma as never, h.redis as never);
    return async (token: string) => {
      const req = { headers: { authorization: `Bearer ${token}` } } as unknown as Request & { user?: { id: string } };
      await mw.use(req, {} as never, () => undefined);
      return req.user?.id ?? null;
    };
  }

  /**
   * An access token of a session that signed in with `method` at
   * `authenticatedAt`, minted at `iat`, with GoTrue's server-set app_metadata
   * for a user holding a password and a linked Google identity. D-101
   * (W9-RISC-PASSWORD-CUTOFF) reads it to name the OAuth provider: GoTrue's
   * amr entry never does.
   */
  const signInToken = (
    method: string,
    authenticatedAt: number,
    iat: number,
    sessionId = 's-f7',
    appMetadata: Record<string, unknown> = { provider: 'email', providers: ['email', 'google'] },
  ) =>
    `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: USER, session_id: sessionId, role: 'authenticated', iat, exp: iat + 3600, amr: [{ method, timestamp: authenticatedAt }], app_metadata: appMetadata })}.c2ln`;
  /** An access token of a Google session that signed in at `authenticatedAt`, minted at `iat`. */
  const sessionToken = (authenticatedAt: number, iat: number, sessionId = 's-f7') =>
    signInToken('oauth', authenticatedAt, iat, sessionId);

  /**
   * The request POST /identity/bootstrap sees after AuthMiddleware verified its
   * bearer: GoTrue's server-set app_metadata says which providers the user
   * signed in with.
   */
  const bootstrapReq = (providers: string[]) => {
    const iat = Math.floor(Date.now() / 1000);
    const bearer = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: USER, role: 'authenticated', iat, exp: iat + 3600, app_metadata: { provider: providers[0], providers } })}.c2ln`;
    return { headers: { authorization: `Bearer ${bearer}` } } as unknown as Request;
  };

  async function riscToken(eventType: string, reason?: string) {
    const details: Record<string, unknown> = { subject: { subject_type: 'iss-sub', iss: GOOGLE_ISSUER, sub: GOOGLE_SUB } };
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
  const logoutCalls = (h: ReturnType<typeof build>) => h.gt.calls.filter((c) => c.call.startsWith('POST /auth/v1/logout'));

  it('account-disabled/hijacking: GoTrue is read, then receives the admin ban by user id under the service-role key, never POST /logout with the user id as its bearer', async () => {
    const h = build();
    await expect(h.risc.receiveEvent(await hijacking())).resolves.toEqual({ status: 202, processed: true });

    // D-97: no POST /logout at all — neither the CR-2 shape (the user id as
    // bearer) nor W7-RISC-REVOKE's server-minted user JWT.
    expect(logoutCalls(h)).toEqual([]);
    expect(h.gt.calls).toEqual([
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
      // D-97: no global sign-out before the ban is read.
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
    expect(h.gt.calls.map((c) => c.call)).toEqual([readCall]);
    expect(h.state.bannedUntil).toBe(indefinite);
    expect(h.actionTaken()).toBe('account_disabled_hijacking');
  });

  it('a ban that would lapse sooner than the RISC ban is extended to it', async () => {
    const h = build({ bannedUntil: Date.now() + 5 * 60 * 1000 });
    await h.risc.receiveEvent(await hijacking());
    expect(h.gt.calls.map((c) => c.call)).toEqual([readCall, banCall]);
    expect(h.state.bannedUntil).toBeGreaterThan(Date.now() + 3600 * 1000);
  });

  it.each([
    ['GoTrue answers 500 to the ban', 'admin_500', [readCall, banCall], 'provider_ban'],
    ['GoTrue answers 500 to the read (nothing is written blind)', 'read_500', [readCall], 'provider_ban'],
    ['the network is down', 'network_down', [readCall], 'provider_ban'],
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
    expect(h.gt.calls.map((c) => c.call)).toEqual([readCall, banCall]);
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
   * R0-ID-F7 review F7-SEC-2, closed by D-97 (W8-RISC-SIGNIN-CUTOFF). Before:
   * the ban PAUSED the pre-event session — GoTrue refuses a refresh while the
   * user is banned but keeps the refresh token — so once the 65-minute ban and
   * the 24h auth:revoked:user cutoff lapsed, the hijacker's refresh token
   * minted access tokens again and this API attached them with no new login
   * (W7-RISC-REVOKE's provider global logout never ran under the Release 0
   * rule: SUPABASE_JWT_SECRET empty). Now the event records a durable sign-in
   * cutoff on the User row, and the middleware compares it with the session's
   * ORIGINAL sign-in (amr, carried over by every refresh), not with the iat a
   * refresh renews.
   */
  it("R0-ID-F7 review F7-SEC-2, closed by D-97 (W8-RISC-SIGNIN-CUTOFF) in the Release 0 configuration (SUPABASE_JWT_SECRET empty): after account-disabled/hijacking, once the 65-minute ban and the 24h auth:revoked:user cutoff lapse, the hijacker's pre-event refresh token still mints access tokens at GoTrue and the real AuthMiddleware refuses every one of them by the durable sign-in cutoff on the User row; a fresh sign-in after the event is admitted", async () => {
    const h = build({ refreshTokens: ['w8-hijacker-rt'] });
    const hijacker = hijackerAuth(h.gt.fetchImpl);
    const attached = realMiddleware(h);

    // Before the event the hijacker's refreshed session is admitted here.
    const beforeEvent = await hijacker.refreshSession({ refresh_token: 'w8-hijacker-rt' });
    expect(beforeEvent.error).toBeNull();
    expect(await attached(beforeEvent.data.session?.access_token ?? '')).toBe(USER);

    const eventAt = Math.floor(Date.now() / 1000);
    await expect(h.risc.receiveEvent(await hijacking())).resolves.toEqual({ status: 202, processed: true });
    expect(h.actionTaken()).toBe('account_disabled_hijacking');
    expect(logoutCalls(h)).toEqual([]);
    const cutoff = h.userRow.metaData.signInCutoffAt;
    expect(cutoff).toBeGreaterThanOrEqual(eventAt);
    expect(cutoff).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));

    // Both temporary locks run out: the provider ban lapses, the Redis cutoffs expire.
    h.state.bannedUntil = Date.now() - 1000;
    h.redis.store.delete(logoutRevocationKey(USER));
    h.redis.store.delete(ADMIN_CUTOFF);

    // GoTrue still honours the pre-event refresh token (D-97 revokes nothing there) ...
    const afterLapse = await hijacker.refreshSession({ refresh_token: beforeEvent.data.session?.refresh_token ?? '' });
    expect(afterLapse.error).toBeNull();
    const minted = afterLapse.data.session?.access_token ?? '';
    expect(claimsOf(minted).iat).toBeGreaterThanOrEqual(cutoff as number);
    // ... and every access token it mints is refused here: its session signed in before the event.
    expect(await attached(minted)).toBeNull();

    // The real user signs in again: a session authenticated after the event is admitted.
    const now = Math.floor(Date.now() / 1000);
    expect(await attached(sessionToken(now + 2, now + 2, 's-fresh'))).toBe(USER);
  });

  it.each([
    ['sessions-revoked', RISC_EVENT_TYPES.SESSIONS_REVOKED],
    ['tokens-revoked', RISC_EVENT_TYPES.TOKENS_REVOKED],
    ['token-revoked', RISC_EVENT_TYPES.TOKEN_REVOKED],
  ])(
    "R0-ID-F7 review F7-SEC-2 / W7-RISC-REVOKE review SEC-W7RR-2, closed by D-97: %s sends GoTrue nothing (F7-CR-1) and records the durable sign-in cutoff too, so once the 24h auth:revoked:user cutoff lapses a token the pre-event refresh token mints is still refused, and a fresh sign-in is admitted",
    async (_name, eventType) => {
      const h = build({ refreshTokens: ['w8-user-rt'] });
      const holder = hijackerAuth(h.gt.fetchImpl);
      const attached = realMiddleware(h);

      await expect(h.risc.receiveEvent(await riscToken(eventType))).resolves.toEqual({ status: 202, processed: true });
      expect(h.gt.calls).toEqual([]);
      expect(h.actionTaken()).not.toContain('revocation_incomplete');
      expect(typeof h.userRow.metaData.signInCutoffAt).toBe('number');

      h.redis.store.delete(logoutRevocationKey(USER));
      h.redis.store.delete(ADMIN_CUTOFF);
      const refreshed = await holder.refreshSession({ refresh_token: 'w8-user-rt' });
      expect(refreshed.error).toBeNull();
      expect(await attached(refreshed.data.session?.access_token ?? '')).toBeNull();

      const now = Math.floor(Date.now() / 1000);
      expect(await attached(sessionToken(now + 2, now + 2, 's-fresh'))).toBe(USER);
    },
  );

  it('D-97: the durable sign-in cutoff is never lowered — a later event keeps the later time, an earlier time already recorded is raised to the event', async () => {
    const h = build();
    const later = Math.floor(Date.now() / 1000) + 3600;
    h.userRow.metaData = { signInCutoffAt: later, other: 'kept' };
    await h.risc.receiveEvent(await riscToken(RISC_EVENT_TYPES.SESSIONS_REVOKED));
    expect(h.userRow.metaData).toMatchObject({ signInCutoffAt: later, other: 'kept' });

    const h2 = build();
    h2.userRow.metaData = { signInCutoffAt: 1_000_000_000 };
    const eventAt = Math.floor(Date.now() / 1000);
    await h2.risc.receiveEvent(await riscToken(RISC_EVENT_TYPES.TOKEN_REVOKED));
    expect(h2.userRow.metaData.signInCutoffAt).toBeGreaterThanOrEqual(eventAt);
  });

  /**
   * W7-RISC-REVOKE review SEC-W7RR-1, closed by D-97 (W8-RISC-SIGNIN-CUTOFF):
   * RiscService.resolveUser maps the Google sub through UserIdentity, whose
   * only writer runs at POST /identity/bootstrap, and the handler never handed
   * it any identity, so in a deployment every event resolved to
   * no_matching_user. The handler now reads the identities of the VERIFIED
   * provider record (GoTrue's admin user record for the token's own subject,
   * under the service-role key) and never body.identities, whose upsert would
   * let a signed-in user claim another person's Google sub and redirect that
   * person's hijacking revocation. That the row then lets a RISC event resolve
   * the user is proven against Postgres in
   * test/risc-signin-cutoff.integration.test.ts.
   */
  it("R0-ID-F7 review F7-SEC-2 / W7-RISC-REVOKE review SEC-W7RR-1, closed by D-97: the real POST /identity/bootstrap handler, through the real SupabaseAdminService on GoTrue's admin API, hands bootstrapUser the identities of the verified provider record (the Google sub GoTrue holds for the token's user) and never body.identities", async () => {
    const h = build();
    const bootstrapUser = vi.fn(async (_input: Record<string, unknown>, _opts?: unknown) => ({ user: { id: USER }, business: { id: 'biz-f7' }, isNewBusiness: false }));
    const unused = {} as never;
    const ctrl = new IdentityController(
      { bootstrapUser } as never,
      unused,
      unused,
      unused,
      unused,
      unused,
      { client: {} } as never,
      h.admin,
      h.redis as never,
    );
    const forged = 'google-sub-of-someone-else';
    await ctrl.bootstrap(
      { company: 'F7 Co', identities: [{ provider: 'google', id: forged, identity_data: { sub: forged } }] } as never,
      { id: USER, email: 'f7@example.com' } as never,
      bootstrapReq(['google']),
    );

    expect(h.gt.calls).toEqual([{ call: readCall, authorization: `Bearer ${SERVICE_KEY}`, body: undefined }]);
    expect(bootstrapUser).toHaveBeenCalledTimes(1);
    const [input] = bootstrapUser.mock.calls[0];
    expect(input.identities).toEqual([
      expect.objectContaining({ provider: 'google', id: GOOGLE_SUB, identity_data: expect.objectContaining({ sub: GOOGLE_SUB }) }),
    ]);
    expect(JSON.stringify(bootstrapUser.mock.calls)).not.toContain(forged);
  });

  it.each([
    ['GoTrue answers 500', 'read_500' as GoTrueMode],
    ['the network is down', 'network_down' as GoTrueMode],
  ])('SEC-W7RR-1 (D-97): when the verified record cannot be read (%s) bootstrap still runs, with no identity at all — never the body one', async (_name, mode) => {
    const h = build({ mode });
    const bootstrapUser = vi.fn(async (_input: Record<string, unknown>, _opts?: unknown) => ({ user: { id: USER }, business: { id: 'biz-f7' }, isNewBusiness: false }));
    const unused = {} as never;
    const ctrl = new IdentityController({ bootstrapUser } as never, unused, unused, unused, unused, unused, { client: {} } as never, h.admin, h.redis as never);
    await ctrl.bootstrap(
      { identities: [{ provider: 'google', id: 'google-sub-forged-f7', identity_data: { sub: 'google-sub-forged-f7' } }] } as never,
      { id: USER, email: 'f7@example.com' } as never,
      bootstrapReq(['email', 'google']),
    );
    expect(bootstrapUser).toHaveBeenCalledTimes(1);
    expect(bootstrapUser.mock.calls[0][0].identities ?? []).toEqual([]);
    expect(JSON.stringify(bootstrapUser.mock.calls)).not.toContain('google-sub-forged-f7');
  });

  it('SEC-W7RR-1 (D-97): a bootstrap whose verified bearer names only email sign-in asks GoTrue nothing and forwards no identity, whatever body.identities says', async () => {
    const h = build();
    const bootstrapUser = vi.fn(async (_input: Record<string, unknown>, _opts?: unknown) => ({ user: { id: USER }, business: { id: 'biz-f7' }, isNewBusiness: false }));
    const unused = {} as never;
    const ctrl = new IdentityController({ bootstrapUser } as never, unused, unused, unused, unused, unused, { client: {} } as never, h.admin, h.redis as never);
    await ctrl.bootstrap(
      { identities: [{ provider: 'google', id: 'google-sub-forged-f7', identity_data: { sub: 'google-sub-forged-f7' } }] } as never,
      { id: USER, email: 'f7@example.com' } as never,
      bootstrapReq(['email']),
    );
    expect(h.gt.calls).toEqual([]);
    expect(bootstrapUser.mock.calls[0][0].identities ?? []).toEqual([]);
    expect(JSON.stringify(bootstrapUser.mock.calls)).not.toContain('google-sub-forged-f7');
  });

  // D-97 (R0-SEC-02 stands): the provider global logout W7-RISC-REVOKE added
  // is not used, whatever SUPABASE_JWT_SECRET holds.
  it.each([
    ['unset', null],
    ['empty (the Release 0 rule)', ''],
    ['set (not the Release 0 configuration)', 'w8-a-secret-the-risc-path-must-not-use'],
  ] as Array<[string, string | null]>)(
    'D-97 (R0-SEC-02 stands): with SUPABASE_JWT_SECRET %s, account-disabled/hijacking sends GoTrue no POST /logout and mints no user JWT — it reads and bans, records the durable sign-in cutoff, and names no failed leg',
    async (_name, serverJwtSecret) => {
      const h = build({ serverJwtSecret, refreshTokens: ['w8-hijacker-rt'] });
      await expect(h.risc.receiveEvent(await hijacking())).resolves.toEqual({ status: 202, processed: true });
      expect(h.gt.calls.map((c) => c.call)).toEqual([readCall, banCall]);
      expect(h.state.bannedUntil).toBeGreaterThan(Date.now() + 3600 * 1000);
      // GoTrue keeps the refresh token; this API refuses what it mints (above).
      expect(h.state.refreshTokens.has('w8-hijacker-rt')).toBe(true);
      expect(typeof h.userRow.metaData.signInCutoffAt).toBe('number');
      expect(h.actionTaken()).toBe('account_disabled_hijacking');
      expect(h.audited()?.outcome).toBe('success');
      expect(h.audited()?.metadata.revocationIncomplete).toBeUndefined();
      expect('revokeAllSessions' in h.admin).toBe(false);
    },
  );

  it('D-97: with the Supabase admin client not configured the ban is not sent and is named, while the durable sign-in cutoff and the local cutoff still hold', async () => {
    const h = build({ refreshTokens: ['w8-hijacker-rt'] });
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await expect(h.risc.receiveEvent(await hijacking())).resolves.toEqual({ status: 202, processed: true });
    expect(h.gt.calls).toEqual([]);
    expect(h.redis.store.get(logoutRevocationKey(USER))?.value).toMatch(/^\d+$/);
    expect(typeof h.userRow.metaData.signInCutoffAt).toBe('number');
    expect(h.actionTaken()).toBe('account_disabled_hijacking:revocation_incomplete:provider_ban');
  });

  // W7-RISC-REVOKE review SEC-W7RR-2 negative control (D-97): the events
  // that end no session send GoTrue nothing and record no cutoff at all,
  // neither the 24h one nor the durable sign-in cutoff. account-enabled
  // restores a recovered user: a cutoff there would sign that user out.
  it.each([
    ['account-enabled', RISC_EVENT_TYPES.ACCOUNT_ENABLED, undefined],
    ['account-credential-change-required', RISC_EVENT_TYPES.ACCOUNT_CREDENTIAL_CHANGE_REQUIRED, undefined],
    ['verification', RISC_EVENT_TYPES.VERIFICATION, undefined],
    ['account-disabled/bulk-account', RISC_EVENT_TYPES.ACCOUNT_DISABLED, 'bulk-account'],
  ] as Array<[string, string, string | undefined]>)(
    'D-97 negative control (SEC-W7RR-2): %s sends GoTrue nothing, the refresh tokens stay, no cutoff is recorded (neither the 24h one nor the durable sign-in cutoff), and the user stays signed in',
    async (_name, eventType, reason) => {
      const h = build({ refreshTokens: ['w7-user-rt'] });
      const attached = realMiddleware(h);
      await expect(h.risc.receiveEvent(await riscToken(eventType, reason))).resolves.toEqual({ status: 202, processed: true });
      expect(h.gt.calls).toEqual([]);
      expect(h.state.refreshTokens.has('w7-user-rt')).toBe(true);
      expect(h.redis.store.size).toBe(0);
      expect(h.userRow.metaData.signInCutoffAt).toBeUndefined();
      expect(h.actionTaken()).not.toContain('revocation_incomplete');
      const now = Math.floor(Date.now() / 1000);
      expect(await attached(sessionToken(now - 3600, now))).toBe(USER);
    },
  );

  it('D-97 negative control (SEC-W7RR-2): account-enabled after a hijacking leaves the durable sign-in cutoff where it was — the pre-event session stays refused, the sign-in after the event stays admitted', async () => {
    const h = build();
    const attached = realMiddleware(h);
    await h.risc.receiveEvent(await hijacking());
    const cutoff = h.userRow.metaData.signInCutoffAt;
    expect(typeof cutoff).toBe('number');
    h.redis.store.clear();

    await h.risc.receiveEvent(await riscToken(RISC_EVENT_TYPES.ACCOUNT_ENABLED));
    expect(h.userRow.metaData.signInCutoffAt).toBe(cutoff);
    expect(h.userRow.metaData.googleSignInDisabled).toBe(false);
    const now = Math.floor(Date.now() / 1000);
    expect(await attached(sessionToken(now - 3600, now))).toBeNull();
    expect(await attached(sessionToken(now + 2, now + 2, 's-fresh'))).toBe(USER);
  });

  it('D-97: boot says nothing about a provider sign-out RISC cannot make — there is none to miss, with SUPABASE_JWT_SECRET empty (the Release 0 rule) and a Google client id set', async () => {
    const h = build({ serverJwtSecret: '' });
    h.risc.onApplicationBootstrap();
    expect(h.warn.mock.calls.filter((c) => String(c[0]).startsWith('RISC: '))).toEqual([]);
    expect(h.gt.calls).toEqual([]);
  });

  /**
   * D-101 (W9-RISC-PASSWORD-CUTOFF; owner ruling, closes D-97 review
   * SEC-W8RSC-4). D-97 leaves the pre-event refresh token alive at GoTrue,
   * and a hijacker who knows (or, with that token, sets) the password could
   * open a NEW password session after the cutoff, which D-97 admitted. Now,
   * after a cutoff, the real AuthMiddleware admits only a new sign-in made
   * with Google or an emailed link until one such sign-in has CLEARED the
   * restriction (User.metaData.signInCutoffClearedAt, its authentication
   * time, written once under the User row lock RiscService takes). From then
   * on a session authenticated after the clearing is admitted by any method;
   * the password session authenticated between the cutoff and the clearing
   * (the hijacker's) stays refused. A later RISC event re-arms it.
   */
  it("D-101 (W9-RISC-PASSWORD-CUTOFF): after account-disabled/hijacking a password session authenticated after the cutoff is refused by the real AuthMiddleware; a Google session after the cutoff is admitted and records signInCutoffClearedAt once under the User row lock; then a password session authenticated after the clearing is admitted, while the password session authenticated between the cutoff and the clearing stays refused", async () => {
    const h = build();
    const attached = realMiddleware(h);
    await expect(h.risc.receiveEvent(await hijacking())).resolves.toEqual({ status: 202, processed: true });
    const cutoff = h.userRow.metaData.signInCutoffAt as number;
    expect(typeof cutoff).toBe('number');

    // The hijacker opens a new password session after the event: refused.
    const hijackerPassword = signInToken('password', cutoff + 1, cutoff + 1, 's-hijacker-password');
    expect(await attached(hijackerPassword)).toBeNull();
    expect(h.userRow.metaData.signInCutoffClearedAt).toBeUndefined();

    // The real user signs in with Google: admitted, and the restriction is cleared at that sign-in.
    const writesBefore = h.prisma.client.user.update.mock.calls.length;
    const locksBefore = h.prisma.client.$queryRaw.mock.calls.length;
    const google = signInToken('oauth', cutoff + 2, cutoff + 2, 's-real-google');
    expect(await attached(google)).toBe(USER);
    expect(h.userRow.metaData.signInCutoffClearedAt).toBe(cutoff + 2);
    expect(h.prisma.client.user.update.mock.calls.length).toBe(writesBefore + 1);
    const lock = h.prisma.client.$queryRaw.mock.calls[locksBefore] as unknown as [TemplateStringsArray, ...unknown[]];
    expect(lock[0].join('?').replace(/\s+/g, ' ').trim()).toBe('SELECT id FROM users WHERE id = ? FOR NO KEY UPDATE');
    expect(lock.slice(1)).toEqual([USER]);
    // Written once: the same session again (and a refresh of it) writes nothing.
    expect(await attached(google)).toBe(USER);
    expect(await attached(signInToken('oauth', cutoff + 2, cutoff + 600, 's-real-google'))).toBe(USER);
    expect(h.prisma.client.user.update.mock.calls.length).toBe(writesBefore + 1);
    // The cutoff itself and the flag the event wrote are kept.
    expect(h.userRow.metaData).toMatchObject({ signInCutoffAt: cutoff, googleSignInDisabled: true });

    // A password session the real user opens after the clearing is admitted ...
    expect(await attached(signInToken('password', cutoff + 3, cutoff + 3, 's-real-password'))).toBe(USER);
    // ... while the hijacker's, opened between the cutoff and the clearing, stays refused, refreshed or not.
    expect(await attached(hijackerPassword)).toBeNull();
    expect(await attached(signInToken('password', cutoff + 1, cutoff + 600, 's-hijacker-password'))).toBeNull();
  });

  it.each([
    ['a magic link in the implicit flow (amr otp)', 'otp'],
    ['a magic link in the PKCE flow (amr magiclink)', 'magiclink'],
  ])(
    'D-101 (W9-RISC-PASSWORD-CUTOFF): after sessions-revoked an emailed-link session — %s — clears the restriction like Google',
    async (_name, method) => {
      const h = build();
      const attached = realMiddleware(h);
      await h.risc.receiveEvent(await riscToken(RISC_EVENT_TYPES.SESSIONS_REVOKED));
      const cutoff = h.userRow.metaData.signInCutoffAt as number;
      expect(await attached(signInToken('password', cutoff + 1, cutoff + 1, 's-password'))).toBeNull();

      const emailOnly = { provider: 'email', providers: ['email'] };
      expect(await attached(signInToken(method, cutoff + 2, cutoff + 2, 's-link', emailOnly))).toBe(USER);
      expect(h.userRow.metaData.signInCutoffClearedAt).toBe(cutoff + 2);
      expect(await attached(signInToken('password', cutoff + 3, cutoff + 3, 's-password-2'))).toBe(USER);
      expect(await attached(signInToken('password', cutoff + 1, cutoff + 1, 's-password'))).toBeNull();
    },
  );

  it.each([
    ['an amr method GoTrue does not define', 'carrier-pigeon'],
    ['anonymous', 'anonymous'],
    ['sso/saml', 'sso/saml'],
  ])(
    'D-101 (W9-RISC-PASSWORD-CUTOFF): after tokens-revoked a session opened by %s is refused (fail closed) and clears nothing',
    async (_name, method) => {
      const h = build();
      const attached = realMiddleware(h);
      await h.risc.receiveEvent(await riscToken(RISC_EVENT_TYPES.TOKENS_REVOKED));
      const cutoff = h.userRow.metaData.signInCutoffAt as number;
      const writes = h.prisma.client.user.update.mock.calls.length;
      expect(await attached(signInToken(method, cutoff + 2, cutoff + 2, 's-other'))).toBeNull();
      expect(h.userRow.metaData.signInCutoffClearedAt).toBeUndefined();
      expect(h.prisma.client.user.update.mock.calls.length).toBe(writes);
      expect(await attached(signInToken('password', cutoff + 3, cutoff + 3, 's-password'))).toBeNull();
    },
  );

  it('D-101 (W9-RISC-PASSWORD-CUTOFF): a new RISC event re-arms the restriction — it records the new cutoff and removes the cleared marker, so a password session after it is refused until a Google sign-in clears it again', async () => {
    const h = build();
    const attached = realMiddleware(h);
    const now = Math.floor(Date.now() / 1000);
    // An earlier event, already cleared by a Google sign-in an hour ago.
    h.userRow.metaData = { signInCutoffAt: now - 7200, signInCutoffClearedAt: now - 3600, keep: 'me' };
    const before = signInToken('password', now - 1800, now - 1800, 's-password-before');
    expect(await attached(before)).toBe(USER);

    await expect(h.risc.receiveEvent(await riscToken(RISC_EVENT_TYPES.TOKEN_REVOKED))).resolves.toEqual({ status: 202, processed: true });
    const cutoff = h.userRow.metaData.signInCutoffAt as number;
    expect(cutoff).toBeGreaterThanOrEqual(now);
    expect(h.userRow.metaData.signInCutoffClearedAt).toBeUndefined();
    expect(h.userRow.metaData.keep).toBe('me');

    expect(await attached(before)).toBeNull();
    expect(await attached(signInToken('password', cutoff + 1, cutoff + 1, 's-password-after'))).toBeNull();
    expect(await attached(signInToken('oauth', cutoff + 2, cutoff + 2, 's-google-after'))).toBe(USER);
    expect(h.userRow.metaData.signInCutoffClearedAt).toBe(cutoff + 2);
    expect(await attached(signInToken('password', cutoff + 3, cutoff + 3, 's-password-later'))).toBe(USER);
    expect(await attached(signInToken('password', cutoff + 1, cutoff + 1, 's-password-after'))).toBeNull();
  });
});
