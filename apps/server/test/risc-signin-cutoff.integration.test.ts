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
  // D-97 review repairs (SEC-W8RSC-1..3, CR-W8RSC-1).
  raceFlag: `${P}u_race_flag`,
  raceEnable: `${P}u_race_enable`,
  flaky: `${P}u_flaky`,
  legacy: `${P}u_legacy`,
  // D-101 (W9-RISC-PASSWORD-CUTOFF).
  d101: `${P}u_d101`,
  d101Race: `${P}u_d101_race`,
};
const EMAIL = {
  victim: `${P}victim@test.local`,
  attacker: `${P}attacker@test.local`,
  hijacked: `${P}hijacked@test.local`,
  calm: `${P}calm@test.local`,
  raceFlag: `${P}race-flag@test.local`,
  raceEnable: `${P}race-enable@test.local`,
  flaky: `${P}flaky@test.local`,
  legacy: `${P}legacy@test.local`,
  d101: `${P}d101@test.local`,
  d101Race: `${P}d101-race@test.local`,
};
/** The Google subs GoTrue holds for each user (its verified google identity). */
const GSUB = {
  victim: `${P}gsub-victim`,
  attacker: `${P}gsub-attacker`,
  hijacked: `${P}gsub-hijacked`,
  calm: `${P}gsub-calm`,
  raceFlag: `${P}gsub-race-flag`,
  raceEnable: `${P}gsub-race-enable`,
  flaky: `${P}gsub-flaky`,
  legacy: `${P}gsub-legacy`,
  d101: `${P}gsub-d101`,
  d101Race: `${P}gsub-d101-race`,
};
type Who = keyof typeof ID;
const WHO = Object.keys(ID) as Who[];
const whoIs = (id: string): Who | undefined => WHO.find((w) => ID[w] === id);
/** A Google sub no GoTrue record holds: what a client could put in body.identities. */
const FORGED_SUB = `${P}gsub-forged`;

let db: any;
let app: any;
let risc: any;
let prismaService: any;
let RiscServiceCtor: any;
const quietLogger = { warn: () => undefined, log: () => undefined, debug: () => undefined, error: () => undefined };
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

/**
 * A Supabase-shaped access token (no iss: the local-verification test shape)
 * of a session that signed in at `signedInAt`, by Google unless `method` says
 * otherwise (D-101: a password session's user also holds an email identity).
 */
async function accessToken(
  user: Who,
  signedInAt: number,
  iat = Math.floor(Date.now() / 1000),
  sessionId = `${user}-session`,
  method = 'oauth',
) {
  return new SignJWT({
    email: EMAIL[user],
    role: 'authenticated',
    session_id: sessionId,
    amr: [{ method, timestamp: signedInAt }],
    // GoTrue's server-set claim after a Google sign-in: bootstrap reads the
    // verified provider record only for a bearer that names one, and D-101
    // reads it to name the OAuth provider (GoTrue's amr entry never does).
    app_metadata: method === 'oauth' ? { provider: 'google', providers: ['google'] } : { provider: 'email', providers: ['email', 'google'] },
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(ID[user])
    .setAudience('authenticated')
    .setIssuedAt(iat)
    .setExpirationTime(iat + 3600)
    .sign(new TextEncoder().encode(JWT_SECRET));
}

/** A Google-signed (test key) RISC security event token. */
async function signRisc(googleSub: string, eventType: string, reason?: string) {
  const details: Record<string, unknown> = { subject: { subject_type: 'iss-sub', iss: GOOGLE_ISSUER, sub: googleSub } };
  if (reason) details.reason = reason;
  const jti = `${P}jti-${++jtiSeq}-${Date.now()}`;
  const token = await new SignJWT({ jti, events: { [eventType]: details } })
    .setProtectedHeader({ alg: 'RS256', kid: 'v94a-key', typ: 'JWT' })
    .setIssuer(GOOGLE_ISSUER)
    .setAudience(GOOGLE_CLIENT)
    .setIssuedAt()
    .sign(keyPair.privateKey);
  return { jti, token };
}

async function riscEvent(googleSub: string, eventType: string, reason?: string) {
  const { jti, token } = await signRisc(googleSub, eventType, reason);
  const result = await risc.receiveEvent(token);
  const row = await db.riscEvent.findUnique({ where: { jti } });
  return { result, row };
}

/** A RiscService like `risc`, over another Prisma stand-in (to inject a database failure). */
function riscOn(prisma: unknown) {
  const svc = new RiscServiceCtor(
    prisma as never,
    supabaseAdminStub as never,
    { audit: async () => undefined } as never,
    { on: () => undefined, emit: () => true } as never,
    redis as never,
  );
  (svc as { logger: unknown }).logger = quietLogger;
  return svc;
}

/**
 * Wait until `n` backends of this database wait on a lock (pg_stat_activity),
 * so a test knows both RISC deliveries reached the User row before it lets
 * them through.
 */
async function waitForLockWaiters(n: number) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const [{ waiting }] = await db.$queryRaw`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`;
    if (waiting >= n) return;
    if (Date.now() > deadline) throw new Error(`only ${waiting} of ${n} backends reached the row lock`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function metaOf(id: string): Promise<Record<string, unknown>> {
  const row = await db.user.findUnique({ where: { id }, select: { metaData: true } });
  return (row?.metaData ?? {}) as Record<string, unknown>;
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
  RiscServiceCtor = RiscService;
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

  prismaService = moduleRef.get(PrismaService);
  risc = riscOn(prismaService);

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
  /**
   * D-97 review SEC-W8RSC-1 / CR-W8RSC-1: the durable cutoff and the
   * googleSignInDisabled flag share User.metaData, and each writer read the
   * bag and wrote it back whole. Here both deliveries reach the User row while
   * another transaction holds its lock, so both have read before either
   * writes: unlocked, the flag write (whichever lands last) carried the stale
   * bag back and erased signInCutoffAt, while the event row still said
   * sessions_terminated. Each writer now takes the row lock before it reads,
   * so the second reads the first's committed result.
   */
  it.each([
    ['account-disabled/bulk-account', 'raceFlag', 'ACCOUNT_DISABLED', 'bulk-account', true, 'account_disabled_flagged'],
    ['account-enabled', 'raceEnable', 'ACCOUNT_ENABLED', undefined, false, 'account_enabled'],
  ] as Array<[string, Who, string, string | undefined, boolean, string]>)(
    'D-97 review SEC-W8RSC-1 / CR-W8RSC-1: %s (flag writer) delivered together with sessions-revoked (cutoff writer) for the same user keeps both keys — the durable cutoff is not lost, and once the 24h cutoff lapses a refreshed pre-event token is still refused',
    async (_name, who, flagEvent, reason, flag, flagAction) => {
      expect((await bootstrap(who)).status).toBe(201);
      const signedIn = Math.floor(Date.now() / 1000) - 3600;
      expect((await me(await accessToken(who, signedIn))).status).toBe(200);

      let release!: () => void;
      const released = new Promise<void>((r) => (release = r));
      let held!: () => void;
      const lockHeld = new Promise<void>((r) => (held = r));
      const holder = db.$transaction(
        async (tx: any) => {
          await tx.$queryRaw`SELECT id FROM users WHERE id = ${ID[who]} FOR UPDATE`;
          held();
          await released;
        },
        { timeout: 20_000 },
      );
      await lockHeld;
      const both = Promise.all([
        riscEvent(GSUB[who], RISC_EVENT_TYPES[flagEvent], reason),
        riscEvent(GSUB[who], RISC_EVENT_TYPES.SESSIONS_REVOKED),
      ]);
      await waitForLockWaiters(2);
      release();
      await holder;
      const [flagged, revoked] = await both;

      expect(flagged.row).toMatchObject({ userId: ID[who], actionTaken: flagAction });
      expect(revoked.row).toMatchObject({ userId: ID[who], actionTaken: 'sessions_terminated' });
      const meta = await metaOf(ID[who]);
      expect(meta.googleSignInDisabled).toBe(flag);
      expect(typeof meta.signInCutoffAt).toBe('number');

      redisStore.delete(logoutRevocationKey(ID[who]));
      redisStore.delete(`admin:user:${ID[who]}:revokedAt`);
      const refreshed = await accessToken(who, signedIn, Math.floor(Date.now() / 1000));
      expect((await me(refreshed)).status).toBe(401);
    },
  );

  it('D-97 review SEC-W8RSC-1: the same pair delivered together with no lock held, 8 rounds — the durable cutoff survives every round', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const id = `${P}u_round_${i}`;
      await db.user.create({ data: { id, email: `${P}round-${i}@test.local`, name: `${P}round ${i}`, role: 'USER' } });
      await db.userIdentity.create({ data: { userId: id, provider: 'google', providerSubject: `${P}gsub-round-${i}` } });
      ids.push(id);
    }
    for (let i = 0; i < ids.length; i++) {
      await Promise.all([
        riscEvent(`${P}gsub-round-${i}`, RISC_EVENT_TYPES.ACCOUNT_DISABLED, 'bulk-account'),
        riscEvent(`${P}gsub-round-${i}`, RISC_EVENT_TYPES.SESSIONS_REVOKED),
      ]);
    }
    for (const id of ids) {
      const meta = await metaOf(id);
      expect(meta).toMatchObject({ googleSignInDisabled: true });
      expect(typeof meta.signInCutoffAt).toBe('number');
    }
  });

  it('D-97 review SEC-W8RSC-2: when the durable cutoff write fails the event is answered 503 (not 202), the row names signin_cutoff, and Google\'s redelivery of the same token is processed again — it records the cutoff, so a refreshed pre-event token stays refused once the 24h cutoff lapses', async () => {
    expect((await bootstrap('flaky')).status).toBe(201);
    const signedIn = Math.floor(Date.now() / 1000) - 3600;

    // The first User.metaData transaction (the cutoff: it runs before the
    // flag) fails once, as a transient database error would.
    let failNext = true;
    const client = prismaService.client;
    const flakyClient = new Proxy(client, {
      get(target: any, prop: string | symbol) {
        if (prop === '$transaction' && failNext) {
          failNext = false;
          return async () => {
            throw new Error('simulated transient database error');
          };
        }
        const value = target[prop];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const flaky = riscOn({ client: flakyClient });

    const { jti, token } = await signRisc(GSUB.flaky, RISC_EVENT_TYPES.ACCOUNT_DISABLED, 'hijacking');
    const first = await flaky.receiveEvent(token).catch((err: unknown) => err);
    const { ServiceUnavailableException } = await import('@nestjs/common');
    expect(first).toBeInstanceOf(ServiceUnavailableException);
    expect((first as InstanceType<typeof ServiceUnavailableException>).getStatus()).toBe(503);
    expect(await db.riscEvent.findUnique({ where: { jti } })).toMatchObject({
      userId: ID.flaky,
      actionTaken: 'account_disabled_hijacking:revocation_incomplete:signin_cutoff',
    });
    expect(await cutoffOf(ID.flaky)).toBeUndefined();

    // Google delivers the same token again: processed, not deduplicated.
    const before = Math.floor(Date.now() / 1000);
    await expect(flaky.receiveEvent(token)).resolves.toEqual({ status: 202, processed: true });
    expect(await db.riscEvent.findUnique({ where: { jti } })).toMatchObject({ userId: ID.flaky, actionTaken: 'account_disabled_hijacking' });
    expect(await db.riscEvent.count({ where: { jti } })).toBe(1);
    const cutoff = await cutoffOf(ID.flaky);
    expect(typeof cutoff).toBe('number');
    expect(cutoff as number).toBeGreaterThanOrEqual(before);
    expect(await metaOf(ID.flaky)).toMatchObject({ googleSignInDisabled: true });

    // A third delivery is a duplicate now.
    await expect(flaky.receiveEvent(token)).resolves.toEqual({ status: 202, processed: false });

    redisStore.delete(logoutRevocationKey(ID.flaky));
    redisStore.delete(`admin:user:${ID.flaky}:revokedAt`);
    expect((await me(await accessToken('flaky', signedIn, Math.floor(Date.now() / 1000)))).status).toBe(401);
  });

  it('D-97 review SEC-W8RSC-3 (documented residual): an account with no UserIdentity row (last signed in before W8-RISC-SIGNIN-CUTOFF) is not reached by a hijacking event — no cutoff, no 24h cutoff, logged for the operator with the Google sub — until its owner signs in again and bootstrap writes the row', async () => {
    await db.user.create({ data: { id: ID.legacy, email: EMAIL.legacy, name: `${P}legacy`, role: 'USER' } });
    const warn = vi.fn();
    (risc as { logger: unknown }).logger = { ...quietLogger, warn };
    try {
      const unmatched = await riscEvent(GSUB.legacy, RISC_EVENT_TYPES.ACCOUNT_DISABLED, 'hijacking');
      expect(unmatched.row).toMatchObject({ userId: null, actionTaken: 'no_matching_user' });
      expect(await cutoffOf(ID.legacy)).toBeUndefined();
      expect(redisStore.has(logoutRevocationKey(ID.legacy))).toBe(false);
      expect(warn.mock.calls.some((c) => String(c[0]).includes(GSUB.legacy) && String(c[0]).includes('matched no user'))).toBe(true);
    } finally {
      (risc as { logger: unknown }).logger = quietLogger;
    }

    // The owner signs in with Google again: bootstrap writes the row, and the next event reaches the account.
    expect((await bootstrap('legacy')).status).toBe(201);
    const reached = await riscEvent(GSUB.legacy, RISC_EVENT_TYPES.ACCOUNT_DISABLED, 'hijacking');
    expect(reached.row).toMatchObject({ userId: ID.legacy, actionTaken: 'account_disabled_hijacking' });
    expect(typeof (await cutoffOf(ID.legacy))).toBe('number');
  });

  /**
   * D-101 (W9-RISC-PASSWORD-CUTOFF; owner ruling, narrows D-97 review
   * SEC-W8RSC-4: review SEC-W9RPC-2): after a cutoff the account accepts only
   * a new sign-in made with Google or an emailed link. A password session
   * opened after the cutoff (the hijacker's, with the password they know or
   * set through the pre-event GoTrue session) is refused until the real user
   * signs in once with Google or the emailed link; that session clears the
   * restriction (users.meta_data.signInCutoffClearedAt), written once under
   * the User row lock RiscService takes, dated when it is recorded or at the
   * sign-in if later (review CR-W9RPC-3). The clearing sign-ins below are
   * dated 20s or more after the event, ahead of this server's clock however
   * slow the run, so the clearing is dated at them.
   */
  it('D-101 (W9-RISC-PASSWORD-CUTOFF): against Postgres, after a RISC cutoff a password session is refused; a Google session is admitted and records signInCutoffClearedAt; a password session authenticated after the clearing is admitted while the one between the cutoff and the clearing stays refused; a new RISC event re-arms the restriction', async () => {
    expect((await bootstrap('d101')).status).toBe(201);
    await riscEvent(GSUB.d101, RISC_EVENT_TYPES.ACCOUNT_DISABLED, 'hijacking');
    const cutoff = (await cutoffOf(ID.d101)) as number;
    expect(typeof cutoff).toBe('number');

    const hijacker = await accessToken('d101', cutoff + 1, cutoff + 1, 'd101-hijacker', 'password');
    expect((await me(hijacker)).status).toBe(401);
    expect((await metaOf(ID.d101)).signInCutoffClearedAt).toBeUndefined();

    const google = await accessToken('d101', cutoff + 20, cutoff + 20, 'd101-google');
    const admitted = await me(google);
    expect(admitted.status).toBe(200);
    expect(admitted.body).toMatchObject({ id: ID.d101 });
    expect(await metaOf(ID.d101)).toMatchObject({ signInCutoffAt: cutoff, signInCutoffClearedAt: cutoff + 20, googleSignInDisabled: true });

    expect((await me(await accessToken('d101', cutoff + 21, cutoff + 21, 'd101-password', 'password'))).status).toBe(200);
    expect((await me(hijacker)).status).toBe(401);
    // A refresh of the hijacker's session: new iat (verifyLocal refuses one more than 60s ahead), same original sign-in.
    expect((await me(await accessToken('d101', cutoff + 1, cutoff + 30, 'd101-hijacker', 'password'))).status).toBe(401);

    // A later session-ending event re-arms it: the marker goes with the new cutoff.
    await riscEvent(GSUB.d101, RISC_EVENT_TYPES.SESSIONS_REVOKED);
    const rearmed = await metaOf(ID.d101);
    expect(rearmed.signInCutoffClearedAt).toBeUndefined();
    const next = rearmed.signInCutoffAt as number;
    expect(next).toBeGreaterThanOrEqual(cutoff);
    expect((await me(await accessToken('d101', next + 4, next + 4, 'd101-password-2', 'password'))).status).toBe(401);
    expect((await me(await accessToken('d101', next + 20, next + 20, 'd101-google-2'))).status).toBe(200);
    expect((await metaOf(ID.d101)).signInCutoffClearedAt).toBe(next + 20);
  });

  it('D-101 (W9-RISC-PASSWORD-CUTOFF): the cleared marker is written once, under the User row lock — two Google sessions queued behind a held lock write it once (the first in the queue; the second re-reads it under the lock), and a later qualifying session leaves the row untouched', async () => {
    expect((await bootstrap('d101Race')).status).toBe(201);
    await riscEvent(GSUB.d101Race, RISC_EVENT_TYPES.SESSIONS_REVOKED);
    const cutoff = (await cutoffOf(ID.d101Race)) as number;
    expect(typeof cutoff).toBe('number');
    const first = await accessToken('d101Race', cutoff + 30, cutoff + 30, 'd101-race-first');
    const second = await accessToken('d101Race', cutoff + 40, cutoff + 40, 'd101-race-second');

    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    let held!: () => void;
    const lockHeld = new Promise<void>((r) => (held = r));
    const holder = db.$transaction(
      async (tx: any) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${ID.d101Race} FOR UPDATE`;
        held();
        await released;
      },
      { timeout: 20_000 },
    );
    await lockHeld;
    // Both requests read the row (no marker) and queue on its lock, in order.
    const firstRes = me(first).then((r) => r);
    await waitForLockWaiters(1);
    expect((await metaOf(ID.d101Race)).signInCutoffClearedAt).toBeUndefined();
    const secondRes = me(second).then((r) => r);
    await waitForLockWaiters(2);
    release();
    await holder;
    const [a, b] = await Promise.all([firstRes, secondRes]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    // Unlocked, or without the re-read, the second would have overwritten it with cutoff + 40.
    expect((await metaOf(ID.d101Race)).signInCutoffClearedAt).toBe(cutoff + 30);

    const xminOf = async () => {
      const [{ xmin }] = await db.$queryRaw`SELECT xmin::text AS xmin FROM users WHERE id = ${ID.d101Race}`;
      return xmin as string;
    };
    const settled = await xminOf();
    expect((await me(await accessToken('d101Race', cutoff + 50, cutoff + 50, 'd101-race-third'))).status).toBe(200);
    expect((await me(second)).status).toBe(200);
    expect(await xminOf()).toBe(settled);
    expect((await metaOf(ID.d101Race)).signInCutoffClearedAt).toBe(cutoff + 30);
  });

  /**
   * D-101 review SEC-W9RPC-1 / CR-W9RPC-1 (confirmed; the fix is outside
   * W9-RISC-PASSWORD-CUTOFF's write set). The product's only emailed link is
   * the password-recovery link, and the web posts its session in the BODY of
   * POST /identity/reset-password, never as a bearer, so AuthMiddleware never
   * judges it and IdentityPasswordService.completeReset records no clearing.
   * completeReset then writes the logout cutoff, and the password sign-in the
   * web sends the user to ("Password updated. Please sign in.") is refused on
   * every request; after account-disabled/hijacking, when Google sign-in waits
   * on Google recovering the account, the user has no way in. Follow-up:
   * completeReset calls recordSignInCutoffCleared (core/auth/auth.middleware.ts)
   * with the recovery session's authentication time once the password is
   * updated, and this case runs against Postgres with the real
   * IdentityPasswordService.
   */
  it.todo(
    'D-101 review SEC-W9RPC-1 / CR-W9RPC-1: after a RISC cutoff, a completed POST /identity/reset-password (the recovery session in the body, as the web sends it) records signInCutoffClearedAt, so the password session the user then opens is admitted while the hijacker\'s earlier one stays refused',
  );

  /**
   * D-101 review CR-W9RPC-2 (confirmed; outside the write set): after a
   * cutoff, POST /identity/login (and /identity/refresh) still answer status
   * 'authenticated' and audit login_success for a password session
   * AuthMiddleware refuses on every request; the web stores the token, its
   * bootstrap gets a 401 and it shows a generic error. Follow-up in
   * identity.controller.ts.
   */
  it.todo(
    'D-101 review CR-W9RPC-2: after a RISC cutoff, POST /identity/login (and /identity/refresh) neither answers authenticated nor audits login_success for a password session AuthMiddleware refuses, and says to sign in with Google or an emailed link',
  );
});
