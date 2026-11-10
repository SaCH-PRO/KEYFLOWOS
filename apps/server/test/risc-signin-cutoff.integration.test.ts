/**
 * W8-RISC-SIGNIN-CUTOFF (owner ruling D-97, resolving D-39) — against Postgres.
 *
 * Closes R0-ID-F7 review F7-SEC-2 end to end, with its two W7-RISC-REVOKE
 * review findings:
 *
 *   SEC-W7RR-1  RiscService.resolveUser maps a Google sub to a user only
 *               through UserIdentity, and nothing wrote that table: POST
 *               /identity/bootstrap never handed bootstrapUser any identity,
 *               so every RISC event resolved to no_matching_user and no
 *               revocation leg ran. Bootstrap now persists UserIdentity from
 *               the VERIFIED provider record (GoTrue's admin user record for
 *               the token's own subject, read with the service-role client),
 *               never from body.identities, whose upsert would let a signed-in
 *               user claim another person's Google sub.
 *   F7-SEC-2    A hijacking event banned the user at Supabase for 65 minutes
 *               and wrote a 24h logout cutoff in Redis; GoTrue kept the
 *               hijacker's refresh token, so once both lapsed its sessions
 *               were attached again with no new login. D-97: the event records
 *               a DURABLE sign-in cutoff on the User row
 *               (users.meta_data.signInCutoffAt), and AuthMiddleware refuses
 *               every token whose ORIGINAL sign-in (amr, carried over by every
 *               refresh) is not after it. The real user simply signs in again.
 *   SEC-W7RR-2  The events that end no session (account-enabled,
 *               account-credential-change-required, verification) record no
 *               cutoff.
 *
 * HOW THE APP IS COMPOSED (in process, real database)
 * ---------------------------------------------------
 * The real IdentityController and IdentityService over the real PrismaService,
 * the real AuthMiddleware and AuthGuard, and the real SupabaseAuthService
 * verifying HS256 tokens locally (SUPABASE_URL and the anon key pinned empty, a
 * test-only SUPABASE_JWT_SECRET, NODE_ENV=test: the shape identity-boundary and
 * identity-local-auth mint, with no `iss`). The real RiscService on the same
 * PrismaService, fed RISC tokens signed with a test RSA key whose JWKS (and
 * Google's discovery document) a stubbed fetch serves. GoTrue's admin API is a
 * stub (SupabaseAdminService): the verified user record with its identities,
 * and the ban by user id. Redis is an in-memory map shared by the middleware
 * and RiscService. Nothing leaves the process.
 *
 * FIXTURES: every row carries the `v94a_` prefix (users from the token sub,
 * their identities, RISC events by jti) or hangs off a `v94a_` user (the
 * bootstrap workspace and membership); hard-deleted by raw SQL in FK order in
 * beforeAll and afterAll. No $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000 });

const P = 'v94a_';

// Pinned BEFORE the repo-root .env is read (dotenv never overrides a key that
// is already present): no provider client, so SupabaseAuthService verifies
// locally; a test-only HS256 secret; a Google client id RISC accepts.
const JWT_SECRET = 'v94a-risc-signin-cutoff-test-jwt-secret-not-real';
const GOOGLE_CLIENT = 'v94a-client.apps.googleusercontent.com';
const GOOGLE_ISSUER = 'https://accounts.google.com/';
const JWKS_URI = 'https://risc.v94a.test/certs';
const PINNED: Record<string, string> = {
  SUPABASE_URL: '',
  NEXT_PUBLIC_SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
  SUPABASE_JWT_SECRET: JWT_SECRET,
  GOOGLE_CLIENT_ID: GOOGLE_CLIENT,
  GOOGLE_CLIENT_IDS: '',
};
const savedEnv: Record<string, string | undefined> = {};
for (const [k, v] of Object.entries(PINNED)) {
  savedEnv[k] = process.env[k];
  process.env[k] = v;
}
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const ID = {
  victim: `${P}u_victim`,
  attacker: `${P}u_attacker`,
  hijacked: `${P}u_hijacked`,
  calm: `${P}u_calm`,
};
const EMAIL = {
  victim: `${P}victim@test.local`,
  attacker: `${P}attacker@test.local`,
  hijacked: `${P}hijacked@test.local`,
  calm: `${P}calm@test.local`,
};
/** The Google subs GoTrue holds for each user (its verified google identity). */
const GSUB = {
  victim: `${P}gsub-victim`,
  attacker: `${P}gsub-attacker`,
  hijacked: `${P}gsub-hijacked`,
  calm: `${P}gsub-calm`,
};
type Who = keyof typeof ID;
const WHO = Object.keys(ID) as Who[];
const whoIs = (id: string): Who | undefined => WHO.find((w) => ID[w] === id);
/** A Google sub no GoTrue record holds: what a client could put in body.identities. */
const FORGED_SUB = `${P}gsub-forged`;

let db: any;
let app: any;
let risc: any;
let keyPair: Awaited<ReturnType<typeof generateKeyPair>>;
let jtiSeq = 0;

/** The in-memory Redis AuthMiddleware and RiscService share. */
const redisStore = new Map<string, string>();
const redis = {
  get: async (k: string) => redisStore.get(k) ?? null,
  set: async (k: string, v: string) => {
    redisStore.set(k, String(v));
    return 'OK';
  },
  setex: async (k: string, _ttl: number, v: string) => {
    redisStore.set(k, String(v));
    return 'OK';
  },
  pttl: async (k: string) => (redisStore.has(k) ? 86_400_000 : -2),
  del: async (k: string) => (redisStore.delete(k) ? 1 : 0),
};

/** GoTrue's admin API: the verified user record (with its google identity) and the ban by id. */
const gotrueAdmin = {
  getUserById: vi.fn(async (id: string) => {
    const who = whoIs(id);
    return {
      data: {
        user: {
          id,
          email: who ? EMAIL[who] : null,
          identities: who
            ? [
                {
                  identity_id: `${id}-google-identity`,
                  id: GSUB[who],
                  user_id: id,
                  provider: 'google',
                  identity_data: { sub: GSUB[who], email_verified: true },
                },
              ]
            : [],
        },
      },
      error: null,
    };
  }),
  updateUserById: vi.fn(async (id: string) => ({ data: { user: { id } }, error: null })),
};
const supabaseAdminStub = {
  isConfigured: () => true,
  getClient: () => ({ auth: { admin: gotrueAdmin } }),
  signOut: vi.fn(async () => false),
};

async function cleanup() {
  for (const sql of [
    `DELETE FROM risc_events WHERE jti LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM user_identities WHERE user_id LIKE ${sqlLikePrefix(P)} OR provider_subject LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE owner_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort */
    }
  }
}

/** A Supabase-shaped access token (no iss: the local-verification test shape) of a session that signed in at `signedInAt`. */
async function accessToken(user: Who, signedInAt: number, iat = Math.floor(Date.now() / 1000), sessionId = `${user}-session`) {
  return new SignJWT({
    email: EMAIL[user],
    role: 'authenticated',
    session_id: sessionId,
    amr: [{ method: 'oauth', timestamp: signedInAt }],
    // GoTrue's server-set claim after a Google sign-in: bootstrap reads the
    // verified provider record only for a bearer that names one.
    app_metadata: { provider: 'google', providers: ['google'] },
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(ID[user])
    .setAudience('authenticated')
    .setIssuedAt(iat)
    .setExpirationTime(iat + 3600)
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function riscEvent(googleSub: string, eventType: string, reason?: string) {
  const details: Record<string, unknown> = { subject: { subject_type: 'iss-sub', iss: GOOGLE_ISSUER, sub: googleSub } };
  if (reason) details.reason = reason;
  const jti = `${P}jti-${++jtiSeq}-${Date.now()}`;
  const token = await new SignJWT({ jti, events: { [eventType]: details } })
    .setProtectedHeader({ alg: 'RS256', kid: 'v94a-key', typ: 'JWT' })
    .setIssuer(GOOGLE_ISSUER)
    .setAudience(GOOGLE_CLIENT)
    .setIssuedAt()
    .sign(keyPair.privateKey);
  const result = await risc.receiveEvent(token);
  const row = await db.riscEvent.findUnique({ where: { jti } });
  return { result, row };
}

const me = (bearer: string) => request(app.getHttpServer()).get('/identity/me').set('Authorization', `Bearer ${bearer}`);

async function bootstrap(user: Who, body: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return request(app.getHttpServer())
    .post('/identity/bootstrap')
    .set('Authorization', `Bearer ${await accessToken(user, now - 60)}`)
    .send({ company: `${P}${user} Co`, ...body });
}

async function cutoffOf(id: string): Promise<unknown> {
  const row = await db.user.findUnique({ where: { id }, select: { metaData: true } });
  return (row?.metaData as Record<string, unknown> | null)?.signInCutoffAt;
}

let RISC_EVENT_TYPES: Record<string, string>;
let logoutRevocationKey: (id: string) => string;

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  keyPair = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(keyPair.publicKey)), kid: 'v94a-key', use: 'sig', alg: 'RS256' };
  // Google's RISC discovery document and JWKS; any other fetch is refused (no provider traffic).
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url === 'https://accounts.google.com/.well-known/risc-configuration') {
      return new Response(JSON.stringify({ issuer: GOOGLE_ISSUER, jwks_uri: JWKS_URI }), { status: 200 });
    }
    if (url === JWKS_URI) return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
    return new Response('no provider traffic in this suite', { status: 599 });
  });

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { AuthMiddleware, logoutRevocationKey: markerKey } = await import('../src/core/auth/auth.middleware');
  logoutRevocationKey = markerKey;
  const { SupabaseAuthService } = await import('../src/core/auth/supabase-auth.service');
  const { SupabaseAdminService } = await import('../src/core/auth/supabase-admin.service');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { IdentityController } = await import('../src/modules/identity/identity.controller');
  const { IdentityService } = await import('../src/modules/identity/identity.service');
  const { IdentitySignupService } = await import('../src/modules/identity/identity-signup.service');
  const { BusinessContextService } = await import('../src/modules/identity/business-context.service');
  const { AuthSecurityService } = await import('../src/modules/identity/auth-security.service');
  const { IdentityPasswordService } = await import('../src/modules/identity/identity-password.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
  const { BlueprintService } = await import('../src/modules/blueprint/blueprint.service');
  const { DefaultTriggersService } = await import('../src/modules/ai/default-triggers.service');
  const { RiscService } = await import('../src/modules/risc/risc.service');
  ({ RISC_EVENT_TYPES } = await import('../src/modules/risc/risc.types'));

  const moduleRef = await Test.createTestingModule({
    controllers: [IdentityController],
    providers: [
      PrismaService,
      AuthGuard,
      AuthMiddleware,
      SupabaseAuthService,
      IdentityService,
      // Not on the bootstrap or /identity/me path.
      { provide: BlueprintService, useValue: { inferFromOnboarding: async () => null } },
      { provide: DefaultTriggersService, useValue: {} },
      { provide: IdentitySignupService, useValue: {} },
      { provide: BusinessContextService, useValue: {} },
      { provide: AiUsageService, useValue: {} },
      { provide: AuthSecurityService, useValue: { enforce: async () => undefined, audit: async () => undefined } },
      { provide: IdentityPasswordService, useValue: {} },
      { provide: SupabaseAdminService, useValue: supabaseAdminStub },
      { provide: REDIS_CLIENT, useValue: redis },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  const middleware = moduleRef.get(AuthMiddleware);
  app.use((req: any, res: any, next: any) => middleware.use(req, res, next));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  risc = new RiscService(
    moduleRef.get(PrismaService) as never,
    supabaseAdminStub as never,
    { audit: async () => undefined } as never,
    { on: () => undefined, emit: () => true } as never,
    redis as never,
  );
  (risc as { logger: unknown }).logger = { warn: () => undefined, log: () => undefined, debug: () => undefined, error: () => undefined };

  await cleanup(); // in case a prior run aborted
});

afterAll(async () => {
  await cleanup();
  await app?.close();
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('W8-RISC-SIGNIN-CUTOFF (D-97) — UserIdentity from the verified record, and a durable sign-in cutoff, against Postgres', () => {
  it('SEC-W7RR-1 (D-97): a real POST /identity/bootstrap writes UserIdentity from the verified provider record, and a RISC event for that Google sub then resolves the user', async () => {
    const res = await bootstrap('victim');
    expect(res.status).toBe(201);

    const rows = await db.userIdentity.findMany({ where: { userId: ID.victim }, select: { provider: true, providerSubject: true } });
    expect(rows).toEqual([{ provider: 'google', providerSubject: GSUB.victim }]);
    expect(gotrueAdmin.getUserById).toHaveBeenCalledWith(ID.victim);

    const { result, row } = await riscEvent(GSUB.victim, RISC_EVENT_TYPES.SESSIONS_REVOKED);
    expect(result).toEqual({ status: 202, processed: true });
    expect(row).toMatchObject({ userId: ID.victim, providerSubject: GSUB.victim, actionTaken: 'sessions_terminated' });
  });

  it('SEC-W7RR-1 (D-97): a body-supplied identity is ignored — another person\'s Google sub sent in body.identities is never mapped to the caller, and a RISC event naming it resolves no user', async () => {
    const res = await bootstrap('attacker', {
      identities: [
        { provider: 'google', id: FORGED_SUB, identity_data: { sub: FORGED_SUB } },
        { provider: 'google', id: GSUB.victim, identity_data: { sub: GSUB.victim } },
      ],
    });
    expect(res.status).toBe(201);

    expect(await db.userIdentity.findMany({ where: { providerSubject: FORGED_SUB } })).toEqual([]);
    const rows = await db.userIdentity.findMany({ where: { userId: ID.attacker }, select: { providerSubject: true } });
    expect(rows).toEqual([{ providerSubject: GSUB.attacker }]);

    const forged = await riscEvent(FORGED_SUB, RISC_EVENT_TYPES.SESSIONS_REVOKED);
    expect(forged.row).toMatchObject({ userId: null, actionTaken: 'no_matching_user' });
  });

  it("R0-ID-F7 review F7-SEC-2, closed by D-97: after account-disabled/hijacking the User row holds a durable sign-in cutoff; once the 24h Redis cutoff lapses, a token refreshed after the event from a pre-event sign-in is still refused by the real AuthMiddleware, and a fresh sign-in is admitted", async () => {
    expect((await bootstrap('hijacked')).status).toBe(201);
    // The user's session signed in an hour ago and works.
    const signedIn = Math.floor(Date.now() / 1000) - 3600;
    expect((await me(await accessToken('hijacked', signedIn))).status).toBe(200);

    const before = Math.floor(Date.now() / 1000);
    const { row } = await riscEvent(GSUB.hijacked, RISC_EVENT_TYPES.ACCOUNT_DISABLED, 'hijacking');
    const after = Math.floor(Date.now() / 1000);
    expect(row).toMatchObject({ userId: ID.hijacked, actionTaken: 'account_disabled_hijacking' });

    const cutoff = await cutoffOf(ID.hijacked);
    expect(typeof cutoff).toBe('number');
    expect(cutoff as number).toBeGreaterThanOrEqual(before);
    expect(cutoff as number).toBeLessThanOrEqual(after);
    expect(gotrueAdmin.updateUserById).toHaveBeenCalledWith(ID.hijacked, { ban_duration: expect.stringMatching(/^\d+s$/) });

    // The 24h Redis logout cutoff lapses.
    redisStore.delete(logoutRevocationKey(ID.hijacked));
    redisStore.delete(`admin:user:${ID.hijacked}:revokedAt`);

    // A refresh of the pre-event session: minted now, same original sign-in.
    const refreshed = await accessToken('hijacked', signedIn, Math.floor(Date.now() / 1000));
    const refused = await me(refreshed);
    expect(refused.status).toBe(401);

    // The real user signs in again after the event.
    const fresh = Math.floor(Date.now() / 1000) + 2;
    const admitted = await me(await accessToken('hijacked', fresh, fresh, 'hijacked-new-session'));
    expect(admitted.status).toBe(200);
    expect(admitted.body).toMatchObject({ id: ID.hijacked });
  });

  it('SEC-W7RR-2 negative control (D-97): account-enabled, account-credential-change-required and verification record no cutoff — the user stays signed in; account-enabled after the hijacking leaves that cutoff where it was', async () => {
    expect((await bootstrap('calm')).status).toBe(201);
    const signedIn = Math.floor(Date.now() / 1000) - 3600;
    for (const eventType of [
      RISC_EVENT_TYPES.ACCOUNT_ENABLED,
      RISC_EVENT_TYPES.ACCOUNT_CREDENTIAL_CHANGE_REQUIRED,
      RISC_EVENT_TYPES.VERIFICATION,
    ]) {
      const { row } = await riscEvent(GSUB.calm, eventType);
      expect(row).toMatchObject({ userId: ID.calm });
      expect(await cutoffOf(ID.calm)).toBeUndefined();
      expect(redisStore.has(logoutRevocationKey(ID.calm))).toBe(false);
      expect((await me(await accessToken('calm', signedIn))).status).toBe(200);
    }

    const hijackedCutoff = await cutoffOf(ID.hijacked);
    expect(typeof hijackedCutoff).toBe('number');
    await riscEvent(GSUB.hijacked, RISC_EVENT_TYPES.ACCOUNT_ENABLED);
    expect(await cutoffOf(ID.hijacked)).toBe(hijackedCutoff);
    expect((await me(await accessToken('hijacked', (hijackedCutoff as number) - 60))).status).toBe(401);
  });
});
