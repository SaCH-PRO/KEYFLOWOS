import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { RiscService } from './risc.service';
import { RISC_EVENT_TYPES } from './risc.types';
import { LOGOUT_REVOCATION_TTL_SECONDS, logoutRevocationKey } from '../../core/auth/auth.middleware';

describe('RiscService', () => {
  let service: RiscService;
  let prisma: ReturnType<typeof makePrisma>;
  let supabaseAdmin: ReturnType<typeof makeSupabaseAdmin>;
  let authSecurity: ReturnType<typeof makeAuthSecurity>;
  let redis: ReturnType<typeof makeRedis>;
  let order: string[];
  let keyPair: Awaited<ReturnType<typeof generateKeyPair>>;
  let jwk: Record<string, unknown>;
  let discoveryDoc: { issuer: string; jwks_uri: string };
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  const GOOGLE_ISSUER = 'https://accounts.google.com/';
  const CLIENT_ID = '123456789-abc.apps.googleusercontent.com';

  beforeEach(async () => {
    process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
    process.env.GOOGLE_CLIENT_IDS = '';

    keyPair = await generateKeyPair('RS256');
    jwk = await exportJWK(keyPair.publicKey);
    jwk.kid = 'test-key-1';
    jwk.use = 'sig';
    jwk.alg = 'RS256';

    discoveryDoc = {
      issuer: GOOGLE_ISSUER,
      jwks_uri: 'https://test.example.com/certs',
    };

    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://accounts.google.com/.well-known/risc-configuration') {
        return new Response(JSON.stringify(discoveryDoc), { status: 200 });
      }
      if (url === discoveryDoc.jwks_uri) {
        return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    });

    order = [];
    prisma = makePrisma();
    supabaseAdmin = makeSupabaseAdmin(order);
    authSecurity = makeAuthSecurity();
    redis = makeRedis(order);
    service = new RiscService(
      prisma as any,
      supabaseAdmin as any,
      authSecurity as any,
      { on: vi.fn(), emit: vi.fn() } as any,
      redis as never,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_IDS;
  });

  function makePrisma() {
    const client = {
      riscEvent: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(undefined),
        update: vi.fn().mockResolvedValue(undefined),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      userIdentity: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      session: {
        deleteMany: vi.fn().mockResolvedValue(undefined),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue(undefined),
      },
      // D-97 review SEC-W8RSC-1 / CR-W8RSC-1: RiscService changes
      // User.metaData in an interactive transaction that first takes the User
      // row lock (SELECT ... FOR NO KEY UPDATE). The stand-in runs the callback
      // on this same client, so the user.findUnique / user.update assertions
      // below still see every read and write; $queryRaw records the lock.
      $queryRaw: vi.fn(async (_strings: TemplateStringsArray, ..._values: unknown[]) => []),
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(client)),
    };
    return { client };
  }

  function makeSupabaseAdmin(callOrder: string[] = []) {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    // GET /admin/users/:id: the user's current ban (none by default).
    const getUserById = vi.fn(
      async (
        uid: string,
      ): Promise<{ data: { user: { id: string; banned_until?: string } | null }; error: { message: string } | null }> => {
        callOrder.push('provider getUserById');
        return { data: { user: { id: uid } }, error: null };
      },
    );
    const updateUserById = vi.fn(
      async (uid: string, _attrs: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> => {
        callOrder.push('provider updateUserById');
        return { data: { user: { id: uid } }, error: null };
      },
    );
    const client = { auth: { admin: { signOut, getUserById, updateUserById } } };
    return {
      isConfigured: vi.fn().mockReturnValue(true),
      getClient: vi.fn().mockReturnValue(client),
      // The SupabaseAdminService wrapper (CR-2), which takes an access JWT.
      signOut: vi.fn().mockResolvedValue(false),
      // A tripwire: the by-user-id global sign-out W7-RISC-REVOKE added, which
      // D-97 (W8-RISC-SIGNIN-CUTOFF) removed from SupabaseAdminService (it
      // needed SUPABASE_JWT_SECRET; R0-SEC-02 keeps it empty). Nothing may call
      // it; the cases below assert that.
      revokeAllSessions: vi.fn(async (_uid: string): Promise<boolean> => true),
      admin: client.auth.admin,
    };
  }

  /** In-memory stand-in for the REDIS_CLIENT the logout cutoff lives in. */
  function makeRedis(callOrder: string[] = []) {
    const store = new Map<string, { value: string; ttl: number }>();
    return {
      store,
      setex: vi.fn(async (k: string, ttl: number, v: string) => {
        callOrder.push(`setex ${k}`);
        store.set(k, { value: String(v), ttl });
        return 'OK';
      }),
      // set(key, value, 'EX', ttl): how POST /identity/logout writes the admin-token cutoff.
      set: vi.fn(async (k: string, v: string, mode?: string, ttl?: number) => {
        callOrder.push(`set ${k}`);
        store.set(k, { value: String(v), ttl: mode === 'EX' ? Number(ttl) : -1 });
        return 'OK';
      }),
      get: vi.fn(async (k: string) => store.get(k)?.value ?? null),
    };
  }

  function makeAuthSecurity() {
    return {
      audit: vi.fn().mockResolvedValue(undefined),
    };
  }

  async function makeToken(
    payload: Record<string, unknown>,
    audience: string = CLIENT_ID,
  ): Promise<string> {
    return new SignJWT(payload)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1', typ: 'JWT' })
      .setIssuer(GOOGLE_ISSUER)
      .setAudience(audience)
      .setIssuedAt()
      .sign(keyPair.privateKey);
  }

  function makeRiscPayload(eventType: string, subject: { sub: string; email?: string }, reason?: string) {
    const events: Record<string, { subject: Record<string, unknown>; reason?: string }> = {
      [eventType]: {
        subject: {
          subject_type: 'iss-sub',
          iss: GOOGLE_ISSUER,
          ...subject,
        },
      },
    };
    if (reason) events[eventType].reason = reason;
    return {
      iss: GOOGLE_ISSUER,
      aud: CLIENT_ID,
      iat: Math.floor(Date.now() / 1000),
      jti: `test-jti-${Math.random().toString(36).slice(2)}`,
      events,
    };
  }

  it('accepts and processes sessions-revoked events', async () => {
    const googleSub = 'google-user-123';
    const userId = 'user-123';
    prisma.client.userIdentity.findUnique.mockResolvedValue({ userId });

    const payload = makeRiscPayload(RISC_EVENT_TYPES.SESSIONS_REVOKED, { sub: googleSub });
    const token = await makeToken(payload);

    const result = await service.receiveEvent(token);

    expect(result.status).toBe(202);
    expect(result.processed).toBe(true);
    expect(prisma.client.session.deleteMany).toHaveBeenCalledWith({ where: { userId } });
    // R0-ID-F7 (R0-ID-F4 review F4-C): this asserted signOut(userId, 'global'),
    // the defect itself — auth-js sends that first argument as the bearer of
    // POST /logout and GoTrue refuses a user id. A RISC event carries no user
    // JWT, so the sessions are revoked here: the local logout cutoff and the
    // admin-token cutoff are written. Google also sends sessions-revoked for
    // ordinary account actions, so it does not ban the user at the provider
    // (that would refuse their own sign-in): only account-disabled/hijacking
    // does (R0-ID-F7 review F7-CR-1).
    expect(supabaseAdmin.admin.signOut).not.toHaveBeenCalled();
    expect(supabaseAdmin.signOut).not.toHaveBeenCalled();
    expect(supabaseAdmin.admin.updateUserById).not.toHaveBeenCalled();
    expect(redis.store.get(logoutRevocationKey(userId))?.value).toMatch(/^\d+$/);
    expect(redis.store.get(`admin:user:${userId}:revokedAt`)?.value).toMatch(/^\d+$/);
    expect(prisma.client.riscEvent.create).toHaveBeenCalled();
    expect(authSecurity.audit).toHaveBeenCalled();
  });

  it('deduplicates events with the same jti', async () => {
    const payload = makeRiscPayload(RISC_EVENT_TYPES.SESSIONS_REVOKED, { sub: 'google-user-123' });
    prisma.client.riscEvent.findUnique.mockResolvedValue({ jti: payload.jti });

    const token = await makeToken(payload);
    const result = await service.receiveEvent(token);

    expect(result.status).toBe(202);
    expect(result.processed).toBe(false);
    expect(prisma.client.session.deleteMany).not.toHaveBeenCalled();
  });

  it('returns 400 for a token signed with an unknown key', async () => {
    const wrongKeyPair = await generateKeyPair('RS256');
    const payload = makeRiscPayload(RISC_EVENT_TYPES.SESSIONS_REVOKED, { sub: 'google-user-123' });
    const token = await new SignJWT(payload)
      .setProtectedHeader({ alg: 'RS256', kid: 'unknown-key', typ: 'JWT' })
      .setIssuer(GOOGLE_ISSUER)
      .setAudience(CLIENT_ID)
      .setIssuedAt()
      .sign(wrongKeyPair.privateKey);

    const result = await service.receiveEvent(token);

    expect(result.status).toBe(400);
    expect(result.processed).toBe(false);
  });

  it('returns 400 for a token with the wrong audience', async () => {
    const payload = makeRiscPayload(RISC_EVENT_TYPES.SESSIONS_REVOKED, { sub: 'google-user-123' });
    const token = await makeToken(payload, 'wrong-client-id');

    const result = await service.receiveEvent(token);

    expect(result.status).toBe(400);
    expect(result.processed).toBe(false);
  });

  it('flags the user and terminates sessions on account-disabled/hijacking', async () => {
    const googleSub = 'google-user-123';
    const userId = 'user-123';
    prisma.client.userIdentity.findUnique.mockResolvedValue({ userId });
    prisma.client.user.findUnique.mockResolvedValue({ metaData: {} });

    const payload = makeRiscPayload(
      RISC_EVENT_TYPES.ACCOUNT_DISABLED,
      { sub: googleSub },
      'hijacking',
    );
    const token = await makeToken(payload);

    const result = await service.receiveEvent(token);

    expect(result.status).toBe(202);
    expect(prisma.client.session.deleteMany).toHaveBeenCalledWith({ where: { userId } });
    expect(prisma.client.user.update).toHaveBeenCalledWith({
      where: { id: userId },
      data: { metaData: { googleSignInDisabled: true } },
    });
  });

  it('logs verification events without terminating sessions', async () => {
    const payload = makeRiscPayload(RISC_EVENT_TYPES.VERIFICATION, { sub: 'google-user-123' }, undefined);
    (payload as any).events[RISC_EVENT_TYPES.VERIFICATION].state = 'test-state';

    const token = await makeToken(payload);
    const result = await service.receiveEvent(token);

    expect(result.status).toBe(202);
    expect(prisma.client.session.deleteMany).not.toHaveBeenCalled();
    expect(authSecurity.audit).toHaveBeenCalled();
  });

  /**
   * R0-ID-F7-RISC-SIGNOUT-SHAPE (R0-ID-F4 review F4-C), with its review
   * repairs: the session-ending events revoke the user's sessions with call
   * shapes that work. A RISC event carries no user JWT, so:
   *   - locally, for every session-ending event: the logout cutoff
   *     POST /identity/logout writes (auth:revoked:user:<id>, epoch seconds,
   *     LOGOUT_REVOCATION_TTL_SECONDS), which makes AuthMiddleware refuse every
   *     token of a session authenticated up to now, written FIRST so the
   *     provider cannot stand in its way; the admin-token cutoff the same logout
   *     writes (admin:user:<id>:revokedAt, ms, same TTL; F7-SEC-4); the local
   *     Session rows.
   *   - at the provider, for account-disabled/hijacking only (F7-CR-1): a ban by
   *     user id (auth-js admin.updateUserById(id, { ban_duration })), after
   *     reading the current one, so a longer ban already on the account is never
   *     cut short (F7-SEC-1, F7-CR-2). Never admin.signOut, whose first argument
   *     is a JWT. The ban PAUSES the Supabase session, it does not revoke it
   *     (F7-SEC-2, residual in test/supabase-admin.service.test.ts).
   *   - every leg that did not hold is named on RiscEvent.actionTaken and in the
   *     audit row (F7-SEC-3).
   */
  describe('R0-ID-F7 — session-ending events revoke with the call shapes auth-js accepts', () => {
    const USER = 'user-f7';
    const ADMIN_CUTOFF = `admin:user:${USER}:revokedAt`;
    const ending: Array<[string, string, string | undefined]> = [
      ['sessions-revoked', RISC_EVENT_TYPES.SESSIONS_REVOKED, undefined],
      ['tokens-revoked', RISC_EVENT_TYPES.TOKENS_REVOKED, undefined],
      ['token-revoked', RISC_EVENT_TYPES.TOKEN_REVOKED, undefined],
      ['account-disabled/hijacking', RISC_EVENT_TYPES.ACCOUNT_DISABLED, 'hijacking'],
    ];
    // Google also sends these for ordinary account actions (a password change,
    // revoking the app's access): they must not lock the user out of sign-in.
    const endingWithoutBan = ending.slice(0, 3);

    async function deliver(eventType: string, reason?: string) {
      prisma.client.userIdentity.findUnique.mockResolvedValue({ userId: USER });
      prisma.client.user.findUnique.mockResolvedValue({ metaData: {} });
      const token = await makeToken(makeRiscPayload(eventType, { sub: 'google-sub-f7' }, reason));
      return service.receiveEvent(token);
    }
    const deliverHijacking = () => deliver(RISC_EVENT_TYPES.ACCOUNT_DISABLED, 'hijacking');

    function stubLogger() {
      const logger = { warn: vi.fn(), debug: vi.fn(), log: vi.fn(), error: vi.fn() };
      (service as unknown as { logger: unknown }).logger = logger;
      return logger;
    }

    const persisted = () =>
      (prisma.client.riscEvent.create.mock.calls[0]?.[0] as { data: { actionTaken: string } } | undefined)?.data;
    const audited = () =>
      authSecurity.audit.mock.calls[0]?.[0] as
        | { outcome: string; reason: string; metadata: { actionTaken: string; revocationIncomplete?: string[] } }
        | undefined;

    it.each(ending)(
      '%s: writes the logout cutoff and the admin-token cutoff, deletes the local sessions; never signOut',
      async (_name, eventType, reason) => {
        const beforeMs = Date.now();
        const before = Math.floor(beforeMs / 1000);
        await expect(deliver(eventType, reason)).resolves.toEqual({ status: 202, processed: true });
        const afterMs = Date.now();
        const after = Math.floor(afterMs / 1000);

        const marker = redis.store.get(logoutRevocationKey(USER));
        expect(marker?.ttl).toBe(LOGOUT_REVOCATION_TTL_SECONDS);
        expect(Number(marker?.value)).toBeGreaterThanOrEqual(before);
        expect(Number(marker?.value)).toBeLessThanOrEqual(after);

        // F7-SEC-4: as POST /identity/logout writes it — ms, the same TTL.
        const adminCutoff = redis.store.get(ADMIN_CUTOFF);
        expect(adminCutoff?.ttl).toBe(LOGOUT_REVOCATION_TTL_SECONDS);
        expect(Number(adminCutoff?.value)).toBeGreaterThanOrEqual(beforeMs);
        expect(Number(adminCutoff?.value)).toBeLessThanOrEqual(afterMs);

        expect(supabaseAdmin.admin.signOut).not.toHaveBeenCalled();
        expect(supabaseAdmin.signOut).not.toHaveBeenCalled();
        expect(prisma.client.session.deleteMany).toHaveBeenCalledWith({ where: { userId: USER } });
      },
    );

    it.each(endingWithoutBan)(
      '%s: does not touch the provider (no ban, no read), so the user is not locked out of sign-in (F7-CR-1)',
      async (_name, eventType, reason) => {
        await deliver(eventType, reason);
        expect(supabaseAdmin.getClient).not.toHaveBeenCalled();
        expect(supabaseAdmin.admin.getUserById).not.toHaveBeenCalled();
        expect(supabaseAdmin.admin.updateUserById).not.toHaveBeenCalled();
        expect(redis.store.get(logoutRevocationKey(USER))?.value).toMatch(/^\d+$/);
      },
    );

    it('account-disabled/hijacking: reads the current ban, then bans at the provider by user id', async () => {
      await expect(deliverHijacking()).resolves.toEqual({ status: 202, processed: true });
      expect(supabaseAdmin.admin.getUserById).toHaveBeenCalledWith(USER);
      expect(supabaseAdmin.admin.updateUserById).toHaveBeenCalledTimes(1);
      expect(supabaseAdmin.admin.updateUserById).toHaveBeenCalledWith(USER, {
        ban_duration: expect.stringMatching(/^\d+s$/),
      });
    });

    it('the cutoffs are written BEFORE the provider is asked', async () => {
      await deliverHijacking();
      expect(order).toEqual([
        `setex ${logoutRevocationKey(USER)}`,
        `set ${ADMIN_CUTOFF}`,
        'provider getUserById',
        'provider updateUserById',
      ]);
    });

    it('the ban outlasts a default (1h) Supabase access token, so every live client meets it at its next refresh, and does not outlast the local cutoff', async () => {
      await deliverHijacking();
      const [, attrs] = supabaseAdmin.admin.updateUserById.mock.calls[0];
      const seconds = Number(/^(\d+)s$/.exec(String(attrs.ban_duration))?.[1]);
      expect(seconds).toBeGreaterThan(3600);
      expect(seconds).toBeLessThanOrEqual(LOGOUT_REVOCATION_TTL_SECONDS);
    });

    describe('F7-SEC-1 / F7-CR-2 — a longer ban already on the account is never cut short', () => {
      const banSeconds = async () => {
        await deliverHijacking();
        const [, attrs] = supabaseAdmin.admin.updateUserById.mock.calls[0] ?? [];
        return Number(/^(\d+)s$/.exec(String(attrs?.ban_duration))?.[1]);
      };

      it("an operator's indefinite ban (dashboard: 876000h) is left alone: no write, and the lock counts as held", async () => {
        supabaseAdmin.admin.getUserById.mockResolvedValueOnce({
          data: { user: { id: USER, banned_until: '2126-10-07T20:37:36Z' } },
          error: null,
        });
        await deliverHijacking();
        expect(supabaseAdmin.admin.getUserById).toHaveBeenCalledWith(USER);
        expect(supabaseAdmin.admin.updateUserById).not.toHaveBeenCalled();
        expect(persisted()?.actionTaken).toBe('account_disabled_hijacking');
        expect(audited()?.outcome).toBe('success');
      });

      it('a ban that ends LATER than the RISC ban would is left alone', async () => {
        supabaseAdmin.admin.getUserById.mockResolvedValueOnce({
          data: { user: { id: USER, banned_until: new Date(Date.now() + 3 * 3600 * 1000).toISOString() } },
          error: null,
        });
        await deliverHijacking();
        expect(supabaseAdmin.admin.updateUserById).not.toHaveBeenCalled();
      });

      it('a ban that ends SOONER than the RISC ban would is extended to it', async () => {
        supabaseAdmin.admin.getUserById.mockResolvedValueOnce({
          data: { user: { id: USER, banned_until: new Date(Date.now() + 5 * 60 * 1000).toISOString() } },
          error: null,
        });
        expect(await banSeconds()).toBeGreaterThan(3600);
      });

      it('an expired ban is replaced', async () => {
        supabaseAdmin.admin.getUserById.mockResolvedValueOnce({
          data: { user: { id: USER, banned_until: '2020-01-01T00:00:00Z' } },
          error: null,
        });
        expect(await banSeconds()).toBeGreaterThan(3600);
      });

      it.each([
        ['an error result', () => supabaseAdmin.admin.getUserById.mockResolvedValueOnce({ data: { user: null }, error: { message: 'gotrue read 500' } })],
        ['a throw', () => supabaseAdmin.admin.getUserById.mockRejectedValueOnce(new TypeError('fetch failed'))],
        [
          'an unreadable banned_until',
          () => supabaseAdmin.admin.getUserById.mockResolvedValueOnce({ data: { user: { id: USER, banned_until: 'forever' } }, error: null }),
        ],
      ] as Array<[string, () => void]>)(
        'the current ban cannot be read (%s): no ban is written blind over it, and the leg is named failed',
        async (_name, arrange) => {
          const logger = stubLogger();
          arrange();
          await expect(deliverHijacking()).resolves.toEqual({ status: 202, processed: true });
          expect(supabaseAdmin.admin.updateUserById).not.toHaveBeenCalled();
          expect(redis.store.get(logoutRevocationKey(USER))?.value).toMatch(/^\d+$/);
          expect(persisted()?.actionTaken).toBe('account_disabled_hijacking:revocation_incomplete:provider_ban');
          expect(logger.warn.mock.calls.some((c) => String(c[0]).includes(USER))).toBe(true);
        },
      );
    });

    it('a provider error result is logged, named failed, and the local cutoff still holds; the event is still accepted', async () => {
      const logger = stubLogger();
      supabaseAdmin.admin.updateUserById.mockResolvedValueOnce({ data: { user: null }, error: { message: 'gotrue 500' } });
      await expect(deliverHijacking()).resolves.toEqual({ status: 202, processed: true });
      expect(redis.store.get(logoutRevocationKey(USER))?.value).toMatch(/^\d+$/);
      expect(JSON.stringify(logger.warn.mock.calls)).toContain('gotrue 500');
      expect(persisted()?.actionTaken).toBe('account_disabled_hijacking:revocation_incomplete:provider_ban');
    });

    it('a provider throw is logged, named failed, and the local cutoff still holds; the event is still accepted', async () => {
      const logger = stubLogger();
      supabaseAdmin.admin.updateUserById.mockRejectedValueOnce(new TypeError('fetch failed'));
      await expect(deliverHijacking()).resolves.toEqual({ status: 202, processed: true });
      expect(redis.store.get(logoutRevocationKey(USER))?.value).toMatch(/^\d+$/);
      expect(JSON.stringify(logger.warn.mock.calls)).toContain('fetch failed');
      expect(persisted()?.actionTaken).toBe('account_disabled_hijacking:revocation_incomplete:provider_ban');
    });

    it('with Supabase not configured the local cutoff is still written, the provider is not touched, and the ban is named not done', async () => {
      supabaseAdmin.isConfigured.mockReturnValue(false);
      await deliverHijacking();
      expect(redis.store.get(logoutRevocationKey(USER))?.value).toMatch(/^\d+$/);
      expect(supabaseAdmin.getClient).not.toHaveBeenCalled();
      expect(persisted()?.actionTaken).toBe('account_disabled_hijacking:revocation_incomplete:provider_ban');
    });

    it('a Redis failure is logged and does not skip the local session delete or the provider ban', async () => {
      const logger = stubLogger();
      redis.setex.mockRejectedValueOnce(new Error('redis down'));
      await expect(deliverHijacking()).resolves.toEqual({ status: 202, processed: true });
      expect(prisma.client.session.deleteMany).toHaveBeenCalledWith({ where: { userId: USER } });
      expect(supabaseAdmin.admin.updateUserById).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(logger.warn.mock.calls)).toContain('redis down');
    });

    it('a local session-delete failure does not skip the cutoff or the provider ban', async () => {
      prisma.client.session.deleteMany.mockRejectedValueOnce(new Error('db down'));
      await deliverHijacking();
      expect(redis.store.get(logoutRevocationKey(USER))?.value).toMatch(/^\d+$/);
      expect(supabaseAdmin.admin.updateUserById).toHaveBeenCalledTimes(1);
    });

    describe('F7-SEC-3 — the RiscEvent row and the audit name every revocation leg that did not hold', () => {
      it.each(ending)('%s: every leg held: the action alone, audit outcome success, no revocation_incomplete', async (_name, eventType, reason) => {
        await deliver(eventType, reason);
        const action = persisted()?.actionTaken;
        expect(action).not.toContain('revocation_incomplete');
        expect(audited()).toMatchObject({ outcome: 'success', reason: `risc:${eventType}`, metadata: { actionTaken: action } });
        expect(audited()?.metadata.revocationIncomplete).toBeUndefined();
      });

      it('cutoff, admin cutoff, local sessions and provider ban all fail: each is named on actionTaken and in the audit, whose outcome is error', async () => {
        stubLogger();
        redis.setex.mockRejectedValueOnce(new Error('redis down'));
        redis.set.mockRejectedValueOnce(new Error('redis down'));
        prisma.client.session.deleteMany.mockRejectedValueOnce(new Error('db down'));
        supabaseAdmin.admin.updateUserById.mockResolvedValueOnce({ data: { user: null }, error: { message: 'gotrue 500' } });
        await expect(deliverHijacking()).resolves.toEqual({ status: 202, processed: true });

        const legs = ['revocation_marker', 'admin_cutoff', 'local_sessions', 'provider_ban'];
        expect(persisted()?.actionTaken).toBe(`account_disabled_hijacking:revocation_incomplete:${legs.join(',')}`);
        expect(audited()).toMatchObject({
          outcome: 'error',
          reason: `risc:${RISC_EVENT_TYPES.ACCOUNT_DISABLED}; revocation_incomplete: ${legs.join(', ')}`,
          metadata: { actionTaken: persisted()?.actionTaken, revocationIncomplete: legs },
        });
      });

      it('sessions-revoked with Redis down: the cutoffs are named, and with no cutoff the audit outcome is error', async () => {
        stubLogger();
        redis.setex.mockRejectedValueOnce(new Error('redis down'));
        redis.set.mockRejectedValueOnce(new Error('redis down'));
        await deliver(RISC_EVENT_TYPES.SESSIONS_REVOKED);
        expect(persisted()?.actionTaken).toBe('sessions_terminated:revocation_incomplete:revocation_marker,admin_cutoff');
        expect(audited()?.outcome).toBe('error');
      });

      it('only the local session delete fails: it is named, and with the cutoff holding the audit outcome stays success', async () => {
        stubLogger();
        prisma.client.session.deleteMany.mockRejectedValueOnce(new Error('db down'));
        await deliver(RISC_EVENT_TYPES.TOKEN_REVOKED);
        expect(persisted()?.actionTaken).toBe('token_revoked_sessions_terminated:revocation_incomplete:local_sessions');
        expect(audited()).toMatchObject({
          outcome: 'success',
          reason: `risc:${RISC_EVENT_TYPES.TOKEN_REVOKED}; revocation_incomplete: local_sessions`,
        });
      });
    });

    /**
     * D-97 (W8-RISC-SIGNIN-CUTOFF; owner ruling, resolves D-39), closing
     * R0-ID-F7 review F7-SEC-2: the ban only pauses the provider session and
     * the 24h logout cutoff lapses, so every session-ending event
     * (sessions-revoked, tokens-revoked, token-revoked,
     * account-disabled/hijacking) also records a DURABLE per-user sign-in
     * cutoff on the User row, User.metaData.signInCutoffAt (epoch seconds),
     * which AuthMiddleware compares with the ORIGINAL sign-in of every Supabase
     * token's session (auth.middleware.spec.ts, test/supabase-admin.service.test.ts).
     * It is merged into the metaData already there and never lowered. The
     * provider global logout W7-RISC-REVOKE added
     * (SupabaseAdminService.revokeAllSessions, which needed
     * SUPABASE_JWT_SECRET) is gone: R0-SEC-02 keeps that secret empty. The
     * events that end no session record no cutoff (SEC-W7RR-2).
     */
    describe('D-97 (W8-RISC-SIGNIN-CUTOFF) — a session-ending event records a durable sign-in cutoff on the User row; no provider global logout', () => {
      const cutoffWrites = () =>
        prisma.client.user.update.mock.calls
          .map((c) => c[0] as { where: { id: string }; data: { metaData?: Record<string, unknown> } })
          .filter((a) => a.data.metaData && 'signInCutoffAt' in a.data.metaData);

      it.each(ending)(
        '%s: writes User.metaData.signInCutoffAt (the event time, epoch seconds) for the resolved user, merged into the metaData already there',
        async (_name, eventType, reason) => {
          prisma.client.userIdentity.findUnique.mockResolvedValue({ userId: USER });
          prisma.client.user.findUnique.mockResolvedValue({ metaData: { keep: 'me', googleSignInDisabled: false } });
          const before = Math.floor(Date.now() / 1000);
          await expect(
            service.receiveEvent(await makeToken(makeRiscPayload(eventType, { sub: 'google-sub-f7' }, reason))),
          ).resolves.toEqual({ status: 202, processed: true });
          const after = Math.floor(Date.now() / 1000);

          const writes = cutoffWrites();
          expect(writes).toHaveLength(1);
          expect(writes[0].where).toEqual({ id: USER });
          expect(writes[0].data.metaData).toMatchObject({ keep: 'me' });
          const at = writes[0].data.metaData?.signInCutoffAt as number;
          expect(Number.isSafeInteger(at)).toBe(true);
          expect(at).toBeGreaterThanOrEqual(before);
          expect(at).toBeLessThanOrEqual(after);
          expect(persisted()?.actionTaken).not.toContain('revocation_incomplete');
        },
      );

      it('the cutoff is never lowered: a later one already recorded stays', async () => {
        const later = Math.floor(Date.now() / 1000) + 3600;
        prisma.client.userIdentity.findUnique.mockResolvedValue({ userId: USER });
        prisma.client.user.findUnique.mockResolvedValue({ metaData: { signInCutoffAt: later } });
        await service.receiveEvent(await makeToken(makeRiscPayload(RISC_EVENT_TYPES.SESSIONS_REVOKED, { sub: 'google-sub-f7' })));
        for (const w of cutoffWrites()) expect(w.data.metaData?.signInCutoffAt).toBe(later);
        expect(persisted()?.actionTaken).toBe('sessions_terminated');
      });

      it('it is recorded before the provider is asked (hijacking)', async () => {
        prisma.client.user.update.mockImplementation(async (args: { data: { metaData?: Record<string, unknown> } }) => {
          if (args.data.metaData && 'signInCutoffAt' in args.data.metaData) order.push('user signInCutoffAt');
          return undefined;
        });
        await deliverHijacking();
        expect(order.indexOf('user signInCutoffAt')).toBeGreaterThanOrEqual(0);
        expect(order.indexOf('user signInCutoffAt')).toBeLessThan(order.indexOf('provider getUserById'));
      });

      it.each([
        ['the write fails', () => prisma.client.user.update.mockRejectedValueOnce(new Error('db down')), true],
        ['the user row is missing', () => prisma.client.user.findUnique.mockResolvedValueOnce(null), false],
      ] as Array<[string, () => void, boolean]>)(
        'a cutoff that is not recorded (%s) is logged, named signin_cutoff on actionTaken and in the audit, whose outcome is error, and skips no other leg',
        async (_name, arrange, redelivered) => {
          const logger = stubLogger();
          prisma.client.userIdentity.findUnique.mockResolvedValue({ userId: USER });
          prisma.client.user.findUnique.mockResolvedValue({ metaData: {} });
          arrange();
          // D-97 review SEC-W8RSC-2: a failed write is not answered as handled
          // (503, so that Google delivers the event again); a user row that is
          // gone is answered 202 (no redelivery can write a cutoff on it).
          // Everything below holds either way.
          const answered = await service
            .receiveEvent(await makeToken(makeRiscPayload(RISC_EVENT_TYPES.SESSIONS_REVOKED, { sub: 'google-sub-f7' })))
            .catch((err: unknown) => err);
          if (redelivered) {
            expect(answered).toBeInstanceOf(ServiceUnavailableException);
            expect((answered as ServiceUnavailableException).getStatus()).toBe(503);
          } else {
            expect(answered).toEqual({ status: 202, processed: true });
          }
          expect(redis.store.get(logoutRevocationKey(USER))?.value).toMatch(/^\d+$/);
          expect(prisma.client.session.deleteMany).toHaveBeenCalledWith({ where: { userId: USER } });
          expect(persisted()?.actionTaken).toBe('sessions_terminated:revocation_incomplete:signin_cutoff');
          expect(audited()).toMatchObject({
            outcome: 'error',
            reason: `risc:${RISC_EVENT_TYPES.SESSIONS_REVOKED}; revocation_incomplete: signin_cutoff`,
          });
          expect(logger.warn.mock.calls.some((c) => String(c[0]).includes(USER))).toBe(true);
        },
      );

      it.each([
        ['account-disabled/hijacking (cutoff and flag)', RISC_EVENT_TYPES.ACCOUNT_DISABLED, 'hijacking', 2],
        ['account-disabled/bulk-account (flag)', RISC_EVENT_TYPES.ACCOUNT_DISABLED, 'bulk-account', 1],
        ['account-enabled (flag)', RISC_EVENT_TYPES.ACCOUNT_ENABLED, undefined, 1],
        ['sessions-revoked (cutoff)', RISC_EVENT_TYPES.SESSIONS_REVOKED, undefined, 1],
      ] as Array<[string, string, string | undefined, number]>)(
        'D-97 review SEC-W8RSC-1 / CR-W8RSC-1: %s — every User.metaData read-modify-write runs in one transaction that first takes the User row lock',
        async (_name, eventType, reason, writes) => {
          const steps: string[] = [];
          prisma.client.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
            steps.push('begin');
            const out = await fn(prisma.client);
            steps.push('commit');
            return out;
          });
          prisma.client.$queryRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
            steps.push(`lock ${strings.join('?').replace(/\s+/g, ' ').trim()} [${values.join(',')}]`);
            return [];
          });
          prisma.client.user.findUnique.mockImplementation(async () => {
            steps.push('read');
            return { metaData: {} };
          });
          prisma.client.user.update.mockImplementation(async () => {
            steps.push('write');
            return undefined;
          });
          prisma.client.userIdentity.findUnique.mockResolvedValue({ userId: USER });
          await service.receiveEvent(await makeToken(makeRiscPayload(eventType, { sub: 'google-sub-f7' }, reason)));
          const lock = `lock SELECT id FROM users WHERE id = ? FOR NO KEY UPDATE [${USER}]`;
          expect(steps).toEqual(Array.from({ length: writes }, () => ['begin', lock, 'read', 'write', 'commit']).flat());
        },
      );

      // D-101 (W9-RISC-PASSWORD-CUTOFF): after a cutoff only a Google or
      // emailed-link sign-in is admitted until one clears the restriction
      // (AuthMiddleware records User.metaData.signInCutoffClearedAt). A later
      // session-ending event sets the restriction again: its cutoff write
      // removes the cleared marker, in the same locked read-modify-write.
      it.each(ending)(
        'D-101 (W9-RISC-PASSWORD-CUTOFF): %s re-arms the restriction — the cutoff write removes signInCutoffClearedAt and raises the cutoff, in one transaction that first takes the User row lock',
        async (_name, eventType, reason) => {
          const steps: string[] = [];
          prisma.client.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
            steps.push('begin');
            const out = await fn(prisma.client);
            steps.push('commit');
            return out;
          });
          prisma.client.$queryRaw.mockImplementation(async () => {
            steps.push('lock');
            return [];
          });
          const earlier = Math.floor(Date.now() / 1000) - 7200;
          // One stored row: each locked read sees the previous write.
          let stored: Record<string, unknown> = { signInCutoffAt: earlier, signInCutoffClearedAt: earlier + 60, keep: 'me' };
          prisma.client.userIdentity.findUnique.mockResolvedValue({ userId: USER });
          prisma.client.user.findUnique.mockImplementation(async () => {
            steps.push('read');
            return { metaData: { ...stored } };
          });
          prisma.client.user.update.mockImplementation(async (args: { data: { metaData?: Record<string, unknown> } }) => {
            steps.push('write');
            if (args.data.metaData) stored = { ...args.data.metaData };
            return undefined;
          });
          const before = Math.floor(Date.now() / 1000);
          await service.receiveEvent(await makeToken(makeRiscPayload(eventType, { sub: 'google-sub-f7' }, reason)));

          // The cutoff write is the event's first metaData transaction.
          const first = cutoffWrites()[0];
          expect(first.data.metaData).not.toHaveProperty('signInCutoffClearedAt');
          expect(first.data.metaData).toMatchObject({ keep: 'me' });
          expect(first.data.metaData?.signInCutoffAt as number).toBeGreaterThanOrEqual(before);
          expect(steps.slice(0, 5)).toEqual(['begin', 'lock', 'read', 'write', 'commit']);
          expect(stored).not.toHaveProperty('signInCutoffClearedAt');
          expect(stored.signInCutoffAt as number).toBeGreaterThanOrEqual(before);
        },
      );

      it('D-101 (W9-RISC-PASSWORD-CUTOFF): re-arming never lowers the cutoff — a later cutoff already recorded stays, and the cleared marker is still removed', async () => {
        const later = Math.floor(Date.now() / 1000) + 3600;
        prisma.client.userIdentity.findUnique.mockResolvedValue({ userId: USER });
        prisma.client.user.findUnique.mockResolvedValue({ metaData: { signInCutoffAt: later, signInCutoffClearedAt: later + 60 } });
        await service.receiveEvent(await makeToken(makeRiscPayload(RISC_EVENT_TYPES.SESSIONS_REVOKED, { sub: 'google-sub-f7' })));
        const writes = cutoffWrites();
        expect(writes).toHaveLength(1);
        expect(writes[0].data.metaData).toEqual({ signInCutoffAt: later });
        expect(persisted()?.actionTaken).toBe('sessions_terminated');
      });

      it.each([
        ['account-enabled', RISC_EVENT_TYPES.ACCOUNT_ENABLED, undefined],
        ['account-disabled/bulk-account', RISC_EVENT_TYPES.ACCOUNT_DISABLED, 'bulk-account'],
      ] as Array<[string, string, string | undefined]>)(
        'D-101 (W9-RISC-PASSWORD-CUTOFF) negative control: %s ends no session and leaves the cutoff and the cleared marker where they were',
        async (_name, eventType, reason) => {
          const stored = { signInCutoffAt: 1_700_000_000, signInCutoffClearedAt: 1_700_000_600 };
          prisma.client.userIdentity.findUnique.mockResolvedValue({ userId: USER });
          prisma.client.user.findUnique.mockResolvedValue({ metaData: { ...stored } });
          await service.receiveEvent(await makeToken(makeRiscPayload(eventType, { sub: 'google-sub-f7' }, reason)));
          const metaWrites = prisma.client.user.update.mock.calls.map((c) => (c[0] as { data: { metaData?: Record<string, unknown> } }).data.metaData);
          expect(metaWrites.length).toBeGreaterThan(0);
          for (const m of metaWrites) expect(m).toMatchObject(stored);
        },
      );

      it('D-97 review SEC-W8RSC-2: the redelivery of an event whose cutoff did not hold is processed again, not dropped as a duplicate — the row is updated and the event answered 202 once the cutoff holds', async () => {
        stubLogger();
        prisma.client.userIdentity.findUnique.mockResolvedValue({ userId: USER });
        prisma.client.user.findUnique.mockResolvedValue({ metaData: {} });
        prisma.client.user.update.mockRejectedValueOnce(new Error('db down'));
        const token = await makeToken(makeRiscPayload(RISC_EVENT_TYPES.SESSIONS_REVOKED, { sub: 'google-sub-f7' }));

        await expect(service.receiveEvent(token)).rejects.toBeInstanceOf(ServiceUnavailableException);
        const first = persisted() as { jti: string; actionTaken: string };
        expect(first.actionTaken).toBe('sessions_terminated:revocation_incomplete:signin_cutoff');
        expect(audited()).toMatchObject({ outcome: 'error', metadata: { redeliveryRequested: true } });

        // Google delivers it again; the stored row names the failed cutoff.
        prisma.client.riscEvent.findUnique.mockResolvedValueOnce({ jti: first.jti, actionTaken: first.actionTaken });
        await expect(service.receiveEvent(token)).resolves.toEqual({ status: 202, processed: true });
        // The write that failed, then the redelivery's, which holds.
        expect(cutoffWrites()).toHaveLength(2);
        expect(prisma.client.riscEvent.create).toHaveBeenCalledTimes(1);
        expect(prisma.client.riscEvent.update).toHaveBeenCalledTimes(1);
        expect(prisma.client.riscEvent.update.mock.calls[0][0]).toMatchObject({
          where: { jti: first.jti },
          data: { userId: USER, actionTaken: 'sessions_terminated' },
        });
        expect(authSecurity.audit.mock.calls[1]?.[0]).toMatchObject({ outcome: 'success', metadata: { redelivery: true } });
      });

      it.each([
        ['every leg held', 'sessions_terminated'],
        ['only the provider ban failed', 'account_disabled_hijacking:revocation_incomplete:provider_ban'],
        ['only the Redis cutoffs failed', 'sessions_terminated:revocation_incomplete:revocation_marker,admin_cutoff'],
      ])(
        'D-97 review SEC-W8RSC-2 negative control: an event already recorded whose cutoff held (%s) is still a duplicate — 202, nothing runs again',
        async (_name, actionTaken) => {
          prisma.client.userIdentity.findUnique.mockResolvedValue({ userId: USER });
          prisma.client.riscEvent.findUnique.mockResolvedValueOnce({ jti: 'seen', actionTaken });
          await expect(deliver(RISC_EVENT_TYPES.SESSIONS_REVOKED)).resolves.toEqual({ status: 202, processed: false });
          expect(prisma.client.$transaction).not.toHaveBeenCalled();
          expect(redis.setex).not.toHaveBeenCalled();
          expect(prisma.client.riscEvent.create).not.toHaveBeenCalled();
          expect(prisma.client.riscEvent.update).not.toHaveBeenCalled();
        },
      );

      it.each(ending)(
        'D-97 review SEC-W8RSC-3 (documented residual): %s for a Google sub with no UserIdentity row ends no session, and is logged for the operator with the sub',
        async (_name, eventType, reason) => {
          const logger = stubLogger();
          prisma.client.userIdentity.findUnique.mockResolvedValue(null);
          const token = await makeToken(makeRiscPayload(eventType, { sub: 'google-sub-unmapped' }, reason));
          await expect(service.receiveEvent(token)).resolves.toEqual({ status: 202, processed: true });
          expect(persisted()).toMatchObject({ userId: null, actionTaken: 'no_matching_user' });
          expect(prisma.client.$transaction).not.toHaveBeenCalled();
          expect(logger.warn.mock.calls.some((c) => /SECURITY: RISC .*google-sub-unmapped.*matched no user/.test(String(c[0])))).toBe(true);
        },
      );

      it('D-97 review SEC-W8RSC-3 negative control: an event that ends no session is not logged as unmatched', async () => {
        const logger = stubLogger();
        prisma.client.userIdentity.findUnique.mockResolvedValue(null);
        await service.receiveEvent(await makeToken(makeRiscPayload(RISC_EVENT_TYPES.VERIFICATION, { sub: 'google-sub-unmapped' })));
        expect(logger.warn.mock.calls.some((c) => String(c[0]).includes('matched no user'))).toBe(false);
      });

      it.each([
        ['verification', RISC_EVENT_TYPES.VERIFICATION, undefined],
        ['account-enabled', RISC_EVENT_TYPES.ACCOUNT_ENABLED, undefined],
        ['account-disabled/bulk-account', RISC_EVENT_TYPES.ACCOUNT_DISABLED, 'bulk-account'],
        ['account-credential-change-required', RISC_EVENT_TYPES.ACCOUNT_CREDENTIAL_CHANGE_REQUIRED, undefined],
      ] as Array<[string, string, string | undefined]>)(
        'SEC-W7RR-2 negative control: %s records no sign-in cutoff',
        async (_name, eventType, reason) => {
          await deliver(eventType, reason);
          expect(cutoffWrites()).toEqual([]);
        },
      );

      it.each([
        ...ending,
        ['verification', RISC_EVENT_TYPES.VERIFICATION, undefined],
        ['account-enabled', RISC_EVENT_TYPES.ACCOUNT_ENABLED, undefined],
        ['account-disabled/bulk-account', RISC_EVENT_TYPES.ACCOUNT_DISABLED, 'bulk-account'],
      ] as Array<[string, string, string | undefined]>)(
        '%s: no provider global logout (R0-SEC-02 stands): never revokeAllSessions, never a signOut',
        async (_name, eventType, reason) => {
          await deliver(eventType, reason);
          expect(supabaseAdmin.revokeAllSessions).not.toHaveBeenCalled();
          expect(supabaseAdmin.signOut).not.toHaveBeenCalled();
          expect(supabaseAdmin.admin.signOut).not.toHaveBeenCalled();
          expect(persisted()?.actionTaken ?? '').not.toContain('provider_signout');
        },
      );
    });

    it.each([
      ['verification', RISC_EVENT_TYPES.VERIFICATION, undefined],
      ['account-enabled', RISC_EVENT_TYPES.ACCOUNT_ENABLED, undefined],
      ['account-disabled/bulk-account', RISC_EVENT_TYPES.ACCOUNT_DISABLED, 'bulk-account'],
      ['account-credential-change-required', RISC_EVENT_TYPES.ACCOUNT_CREDENTIAL_CHANGE_REQUIRED, undefined],
    ] as Array<[string, string, string | undefined]>)('%s: ends no session — no cutoff, no ban', async (_name, eventType, reason) => {
      await deliver(eventType, reason);
      expect(redis.setex).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
      expect(supabaseAdmin.admin.getUserById).not.toHaveBeenCalled();
      expect(supabaseAdmin.admin.updateUserById).not.toHaveBeenCalled();
      expect(supabaseAdmin.admin.signOut).not.toHaveBeenCalled();
      // Negative control (SEC-W7RR-2, D-97): nor any global sign-out.
      // account-enabled restores a recovered user; signing that user out
      // everywhere would undo the recovery.
      expect(supabaseAdmin.revokeAllSessions).not.toHaveBeenCalled();
      expect(supabaseAdmin.signOut).not.toHaveBeenCalled();
      expect(persisted()?.actionTaken).not.toContain('revocation_incomplete');
    });
  });

  it('erases events for a user on GDPR deletion request', async () => {
    prisma.client.riscEvent.deleteMany.mockResolvedValue({ count: 3 });
    const result = await service.eraseForUser('user-123');
    expect(result.deleted).toBe(3);
    expect(prisma.client.riscEvent.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-123' },
    });
  });
});
