import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
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
      redis as any,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_IDS;
  });

  function makePrisma() {
    return {
      client: {
        riscEvent: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue(undefined),
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
      },
    };
  }

  function makeSupabaseAdmin(callOrder: string[] = []) {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const updateUserById = vi.fn(
      async (uid: string, _attrs: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> => {
        callOrder.push('provider updateUserById');
        return { data: { user: { id: uid } }, error: null };
      },
    );
    const client = { auth: { admin: { signOut, updateUserById } } };
    return {
      isConfigured: vi.fn().mockReturnValue(true),
      getClient: vi.fn().mockReturnValue(client),
      // The SupabaseAdminService wrapper (CR-2), which takes an access JWT.
      signOut: vi.fn().mockResolvedValue(false),
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
    // POST /logout and GoTrue refuses a user id. With no user JWT in a RISC
    // event the provider leg is the admin ban by user id, and the local logout
    // cutoff is written.
    expect(supabaseAdmin.admin.signOut).not.toHaveBeenCalled();
    expect(supabaseAdmin.signOut).not.toHaveBeenCalled();
    expect(supabaseAdmin.admin.updateUserById).toHaveBeenCalledWith(userId, {
      ban_duration: expect.stringMatching(/^\d+s$/),
    });
    expect(redis.store.get(logoutRevocationKey(userId))?.value).toMatch(/^\d+$/);
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
   * R0-ID-F7-RISC-SIGNOUT-SHAPE (R0-ID-F4 review F4-C): the session-ending
   * events end the user's sessions with call shapes that work. A RISC event
   * carries no user JWT, so:
   *   - locally: the logout cutoff POST /identity/logout writes
   *     (auth:revoked:user:<id>, epoch seconds, LOGOUT_REVOCATION_TTL_SECONDS),
   *     which makes AuthMiddleware refuse every token of a session
   *     authenticated up to now. Written FIRST, so the provider cannot stand in
   *     its way.
   *   - at the provider: auth-js admin.updateUserById(id, { ban_duration }),
   *     the installed admin call that takes a user id. Never admin.signOut,
   *     whose first argument is a JWT.
   */
  describe('R0-ID-F7 — session-ending events revoke with the call shapes auth-js accepts', () => {
    const USER = 'user-f7';
    const ending: Array<[string, string, string | undefined]> = [
      ['sessions-revoked', RISC_EVENT_TYPES.SESSIONS_REVOKED, undefined],
      ['tokens-revoked', RISC_EVENT_TYPES.TOKENS_REVOKED, undefined],
      ['token-revoked', RISC_EVENT_TYPES.TOKEN_REVOKED, undefined],
      ['account-disabled/hijacking', RISC_EVENT_TYPES.ACCOUNT_DISABLED, 'hijacking'],
    ];

    async function deliver(eventType: string, reason?: string) {
      prisma.client.userIdentity.findUnique.mockResolvedValue({ userId: USER });
      prisma.client.user.findUnique.mockResolvedValue({ metaData: {} });
      const token = await makeToken(makeRiscPayload(eventType, { sub: 'google-sub-f7' }, reason));
      return service.receiveEvent(token);
    }

    function stubLogger() {
      const logger = { warn: vi.fn(), debug: vi.fn(), log: vi.fn(), error: vi.fn() };
      (service as unknown as { logger: unknown }).logger = logger;
      return logger;
    }

    it.each(ending)(
      '%s: writes the logout cutoff, then bans at the provider by user id; never signOut',
      async (_name, eventType, reason) => {
        const before = Math.floor(Date.now() / 1000);
        await expect(deliver(eventType, reason)).resolves.toEqual({ status: 202, processed: true });
        const after = Math.floor(Date.now() / 1000);

        const marker = redis.store.get(logoutRevocationKey(USER));
        expect(marker?.ttl).toBe(LOGOUT_REVOCATION_TTL_SECONDS);
        expect(Number(marker?.value)).toBeGreaterThanOrEqual(before);
        expect(Number(marker?.value)).toBeLessThanOrEqual(after);

        expect(supabaseAdmin.admin.updateUserById).toHaveBeenCalledTimes(1);
        expect(supabaseAdmin.admin.updateUserById).toHaveBeenCalledWith(USER, {
          ban_duration: expect.stringMatching(/^\d+s$/),
        });
        expect(supabaseAdmin.admin.signOut).not.toHaveBeenCalled();
        expect(supabaseAdmin.signOut).not.toHaveBeenCalled();
        expect(prisma.client.session.deleteMany).toHaveBeenCalledWith({ where: { userId: USER } });
      },
    );

    it('the cutoff is written BEFORE the provider is asked', async () => {
      await deliver(RISC_EVENT_TYPES.SESSIONS_REVOKED);
      expect(order).toEqual([`setex ${logoutRevocationKey(USER)}`, 'provider updateUserById']);
    });

    it('the ban outlasts a default (1h) Supabase access token, so every live client meets it at its next refresh, and does not outlast the local cutoff (it is not an account suspension)', async () => {
      await deliver(RISC_EVENT_TYPES.SESSIONS_REVOKED);
      const [, attrs] = supabaseAdmin.admin.updateUserById.mock.calls[0];
      const seconds = Number(/^(\d+)s$/.exec(String(attrs.ban_duration))?.[1]);
      expect(seconds).toBeGreaterThan(3600);
      expect(seconds).toBeLessThanOrEqual(LOGOUT_REVOCATION_TTL_SECONDS);
    });

    it('a provider error result is logged and the local cutoff still holds; the event is still accepted', async () => {
      const logger = stubLogger();
      supabaseAdmin.admin.updateUserById.mockResolvedValueOnce({ data: { user: null }, error: { message: 'gotrue 500' } });
      await expect(deliver(RISC_EVENT_TYPES.SESSIONS_REVOKED)).resolves.toEqual({ status: 202, processed: true });
      expect(redis.store.get(logoutRevocationKey(USER))?.value).toMatch(/^\d+$/);
      expect(JSON.stringify(logger.warn.mock.calls)).toContain('gotrue 500');
    });

    it('a provider throw is logged and the local cutoff still holds; the event is still accepted', async () => {
      const logger = stubLogger();
      supabaseAdmin.admin.updateUserById.mockRejectedValueOnce(new TypeError('fetch failed'));
      await expect(deliver(RISC_EVENT_TYPES.SESSIONS_REVOKED)).resolves.toEqual({ status: 202, processed: true });
      expect(redis.store.get(logoutRevocationKey(USER))?.value).toMatch(/^\d+$/);
      expect(JSON.stringify(logger.warn.mock.calls)).toContain('fetch failed');
    });

    it('with Supabase not configured the local cutoff is still written and the provider is not touched', async () => {
      supabaseAdmin.isConfigured.mockReturnValue(false);
      await deliver(RISC_EVENT_TYPES.SESSIONS_REVOKED);
      expect(redis.store.get(logoutRevocationKey(USER))?.value).toMatch(/^\d+$/);
      expect(supabaseAdmin.getClient).not.toHaveBeenCalled();
    });

    it('a Redis failure is logged and does not skip the local session delete or the provider ban', async () => {
      const logger = stubLogger();
      redis.setex.mockRejectedValueOnce(new Error('redis down'));
      await expect(deliver(RISC_EVENT_TYPES.SESSIONS_REVOKED)).resolves.toEqual({ status: 202, processed: true });
      expect(prisma.client.session.deleteMany).toHaveBeenCalledWith({ where: { userId: USER } });
      expect(supabaseAdmin.admin.updateUserById).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(logger.warn.mock.calls)).toContain('redis down');
    });

    it('a local session-delete failure does not skip the cutoff or the provider ban', async () => {
      prisma.client.session.deleteMany.mockRejectedValueOnce(new Error('db down'));
      await deliver(RISC_EVENT_TYPES.SESSIONS_REVOKED);
      expect(redis.store.get(logoutRevocationKey(USER))?.value).toMatch(/^\d+$/);
      expect(supabaseAdmin.admin.updateUserById).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['verification', RISC_EVENT_TYPES.VERIFICATION, undefined],
      ['account-enabled', RISC_EVENT_TYPES.ACCOUNT_ENABLED, undefined],
      ['account-disabled/bulk-account', RISC_EVENT_TYPES.ACCOUNT_DISABLED, 'bulk-account'],
      ['account-credential-change-required', RISC_EVENT_TYPES.ACCOUNT_CREDENTIAL_CHANGE_REQUIRED, undefined],
    ] as Array<[string, string, string | undefined]>)('%s: ends no session — no cutoff, no ban', async (_name, eventType, reason) => {
      await deliver(eventType, reason);
      expect(redis.setex).not.toHaveBeenCalled();
      expect(supabaseAdmin.admin.updateUserById).not.toHaveBeenCalled();
      expect(supabaseAdmin.admin.signOut).not.toHaveBeenCalled();
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
