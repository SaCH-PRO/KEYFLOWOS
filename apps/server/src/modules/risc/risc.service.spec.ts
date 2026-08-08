import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { RiscService } from './risc.service';
import { RISC_EVENT_TYPES } from './risc.types';

describe('RiscService', () => {
  let service: RiscService;
  let prisma: ReturnType<typeof makePrisma>;
  let supabaseAdmin: ReturnType<typeof makeSupabaseAdmin>;
  let authSecurity: ReturnType<typeof makeAuthSecurity>;
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

    prisma = makePrisma();
    supabaseAdmin = makeSupabaseAdmin();
    authSecurity = makeAuthSecurity();
    service = new RiscService(
      prisma as any,
      supabaseAdmin as any,
      authSecurity as any,
      { on: vi.fn(), emit: vi.fn() } as any,
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

  function makeSupabaseAdmin() {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    return {
      isConfigured: vi.fn().mockReturnValue(true),
      getClient: vi.fn().mockReturnValue({
        auth: {
          admin: {
            signOut,
          },
        },
      }),
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
    expect(supabaseAdmin.getClient().auth.admin.signOut).toHaveBeenCalledWith(userId, 'global');
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

  it('erases events for a user on GDPR deletion request', async () => {
    prisma.client.riscEvent.deleteMany.mockResolvedValue({ count: 3 });
    const result = await service.eraseForUser('user-123');
    expect(result.deleted).toBe(3);
    expect(prisma.client.riscEvent.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-123' },
    });
  });
});
