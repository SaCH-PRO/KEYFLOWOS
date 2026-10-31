/**
 * R0-14-AUTH-LOCAL-SIGNIN (D-02 option C: hosted Supabase free tier) — the
 * auth-boundary facts docs/auth-pathway.md asks a Release 0 operator to rely
 * on, measured at the REAL boundary.
 *
 * Under D-02 option C the packet changes no identity code. What it does change
 * is operator guidance, and two review findings showed that guidance resting on
 * unproven claims:
 *
 *   ST-R014-2  `SUPABASE_JWT_SECRET` was described as inert with a hosted
 *              project. It is not: `verifyLocal` accepts any HS256 token signed
 *              with it whose `iss` is absent or equals SUPABASE_URL, and
 *              .env.example shipped a public placeholder as its value. The
 *              Release 0 rule is now "leave it empty". The first block proves
 *              that rule closes the forged-token path; the second pins the
 *              hazard the doc describes, so the doc goes stale loudly when a
 *              code packet fixes the issuer check.
 *   ST-R014-1  POST /identity/bootstrap moved another user's row, role,
 *              memberships and businesses to the caller on an email match. R0-14
 *              held it as it.todo; R0-SEC-01-BOOTSTRAP-TAKEOVER turned those
 *              into the real-database cases of the last block, which run the
 *              real IdentityController and IdentityService behind the same
 *              real AuthMiddleware and AuthGuard.
 *
 * Nothing on the boundary is mocked: the real AuthMiddleware (real
 * SupabaseAuthService, real PrismaService against DATABASE_URL, real Redis for
 * the revocation lookup) runs in front of the real AuthGuard under
 * configureNestApp. The only test-owned piece is a probe route that returns
 * what the middleware attached, so the assertion is about the boundary and not
 * about any controller behind it.
 *
 * No network: SUPABASE_URL is a fake host and no anon key is set, so the
 * getUser() fallback has no client and never runs; global fetch is replaced by
 * a recorder that refuses every call, and the suite asserts it was never used.
 *
 * RESOURCES: fixture prefix k14a_ (docs/reconstruction/BUILD-MAP-001.md, R0-14
 * row; registered in test/helpers/fixture-prefixes.json). The first two blocks
 * write no rows: their forged `sub` values carry the prefix and are checked
 * absent from `users` by exact id, before and after. The bootstrap block
 * (R0-SEC-01) seeds and creates users, businesses and memberships whose ids,
 * owner ids and emails carry the prefix; they are hard-deleted by raw SQL
 * through sqlLikePrefix(P) before every case and after the suite, with no
 * $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { createHmac, randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { AuthGuard } from '../src/core/auth/auth.guard';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL (the
// shell / CI env wins because dotenv never overrides an existing variable).
// Every Supabase variable it may bring in is pinned below.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'k14a_';
const FAKE_SUPABASE_URL = 'https://k14a-example-ref.supabase.co';
/** The value .env.example carried for SUPABASE_JWT_SECRET before this repair. */
const FORMER_PLACEHOLDER = 'your-supabase-jwt-signing-secret';
const OTHER_SECRET = `${P}a-secret-nobody-configured`;

const PINNED_KEYS = [
  'SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_JWT_SECRET',
  'ADMIN_JWT_SECRET',
  // The invite block sets it per case; NODE_ENV=test leaves it off when unset.
  'AUTH_REQUIRE_EMAIL_VERIFICATION',
] as const;
const saved: Partial<Record<(typeof PINNED_KEYS)[number], string | undefined>> = {};

const SUBS = {
  noIssEmpty: `${P}forger_noiss_empty`,
  urlIssEmpty: `${P}forger_urliss_empty`,
  noIssPlaceholder: `${P}forger_noiss_placeholder`,
  urlIssPlaceholder: `${P}forger_urliss_placeholder`,
  hostedIss: `${P}forger_hostediss`,
  wrongSecret: `${P}forger_wrongsecret`,
};
const VICTIM_EMAIL = `${P}victim@test.local`;

/**
 * R0-SEC-01: the bootstrap block signs its tokens with this test-only secret
 * and no `iss`, the shape the spawned-server suites mint, so the real
 * AuthMiddleware accepts them through verifyLocal.
 */
const BOOT_SECRET = `${P}bootstrap-signing-secret`;
const BOOT = {
  /** A plain owner (role USER) holding the OWNER membership of its business. */
  owner: `${P}boot_owner`,
  ownerBiz: `${P}boot_owner_biz`,
  /** A SUPER_ADMIN that also owns a business. */
  admin: `${P}boot_admin`,
  adminBiz: `${P}boot_admin_biz`,
  /** Signs in with its own address, then names a victim's in the body. */
  attacker: `${P}boot_attacker`,
  /** A different sub whose token email claim IS a victim's address. */
  claimer: `${P}boot_claimer`,
  /** A first-time caller with nothing in the database. */
  fresh: `${P}boot_fresh`,
};
/** Every bootstrap-block address embeds the prefix: users.email is globally unique. */
const bootEmail = (id: string) => `${id}@test.local`;

@Controller('k14a-probe')
class K14aProbeController {
  @UseGuards(AuthGuard)
  @Get('whoami')
  whoami(@Req() req: { user: { id: string; email: string; role: string } }) {
    return { id: req.user.id, email: req.user.email, role: req.user.role };
  }
}

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/** HS256 token in the shape the spawned-server suites mint, `iss` optional. */
function forge(secret: string, claims: { sub: string; email: string; iss?: string }): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const body = b64url({
    ...claims,
    aud: 'authenticated',
    role: 'authenticated',
    iat: now,
    exp: now + 600,
    jti: randomUUID(),
  });
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function setSecret(value: string | undefined) {
  if (value === undefined) delete process.env.SUPABASE_JWT_SECRET;
  else process.env.SUPABASE_JWT_SECRET = value;
}

/**
 * Review repair (SEC01-T1, CR-1): the only Supabase call bootstrap can make is
 * the service-role user lookup that proves an invitee owns its address. The
 * controller's SupabaseAdminService is this recording stand-in: `records` is
 * what the Supabase project would answer, `lookups` every id asked about. It
 * makes no network call.
 */
type SupabaseRecord = { id: string; email: string; email_confirmed_at: string | null };
const supabaseAdmin = {
  records: new Map<string, SupabaseRecord>(),
  lookups: [] as string[],
  isConfigured: () => true,
  getClient: () => ({
    auth: {
      admin: {
        getUserById: async (id: string) => {
          supabaseAdmin.lookups.push(id);
          const user = supabaseAdmin.records.get(id);
          return user
            ? { data: { user }, error: null }
            : { data: { user: null }, error: { message: 'User not found', status: 404 } };
        },
      },
    },
  }),
};

let app: INestApplication;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the @keyflow/db client is loaded dynamically after env
let db: any;
let skipTenantIsolation: <T extends object>(args: T) => T;
let redis: { quit: () => Promise<unknown> } | undefined;
const outbound: string[] = [];
const realFetch = globalThis.fetch;

async function rowsForForgedSubs(): Promise<number> {
  return db.user.count({ where: { id: { in: Object.values(SUBS) } } });
}

/**
 * Hard-delete every row the bootstrap block seeds or the bootstrap route
 * creates. The businesses bootstrap creates get generated ids, so they are
 * found by their prefixed owner; an invite placeholder gets a generated id, so
 * it is found by its prefixed email. Raw SQL: User and Business are
 * soft-deleted models, so the client's deleteMany would only set deletedAt.
 *
 * The forged-sub ids (SUBS) are left out on purpose (review repair CR-2): the
 * "no row for a forged sub" checks in beforeAll and afterAll run after this
 * cleanup, and they could never fail if it deleted those rows first.
 */
async function cleanupBootstrapRows() {
  const owned = `(SELECT id FROM businesses WHERE id LIKE ${sqlLikePrefix(P)} OR owner_id LIKE ${sqlLikePrefix(P)})`;
  const prefixedUsers = `(SELECT id FROM users WHERE (id LIKE ${sqlLikePrefix(P)} OR email LIKE ${sqlLikePrefix(P)}) AND NOT (id = ANY($1::text[])))`;
  const forged = Object.values(SUBS);
  for (const sql of [
    `DELETE FROM team_activity_logs WHERE business_id IN ${owned} OR user_id IN ${prefixedUsers}`,
    `DELETE FROM memberships WHERE business_id IN ${owned} OR user_id IN ${prefixedUsers}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)} OR owner_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM sessions WHERE user_id IN ${prefixedUsers}`,
    `DELETE FROM user_identities WHERE user_id IN ${prefixedUsers}`,
    `DELETE FROM users WHERE id IN ${prefixedUsers}`,
  ]) {
    if (sql.includes('$1')) await db.$executeRawUnsafe(sql, forged);
    else await db.$executeRawUnsafe(sql);
  }
}

beforeAll(async () => {
  for (const k of PINNED_KEYS) saved[k] = process.env[k];
  for (const k of PINNED_KEYS) delete process.env[k];
  process.env.SUPABASE_URL = FAKE_SUPABASE_URL;

  globalThis.fetch = (async (input: unknown) => {
    outbound.push(String(input instanceof Request ? input.url : input));
    throw new Error('k14a: outbound fetch refused by the test');
  }) as typeof fetch;

  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  skipTenantIsolation = dbMod.skipTenantIsolation;

  const { Test } = await import('@nestjs/testing');
  const IORedis = (await import('ioredis')).default;
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { SupabaseAuthService } = await import('../src/core/auth/supabase-auth.service');
  const { AuthMiddleware } = await import('../src/core/auth/auth.middleware');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { configureNestApp } = await import('../src/app-bootstrap');
  // R0-SEC-01: the real bootstrap route. IdentityController and IdentityService
  // are the shipped classes on the real PrismaService; only collaborators the
  // bootstrap path never calls are stood in (the service's blueprint and
  // default-trigger services; the controller's signup, password, AI-usage,
  // business-context and auth-security services). The Supabase-admin service
  // is the recording stand-in above. The team invite and removal routes run
  // behind the real BusinessGuard and ModuleScopeGuard.
  const { IdentityController } = await import('../src/modules/identity/identity.controller');
  const { IdentityService } = await import('../src/modules/identity/identity.service');
  const { IdentitySignupService } = await import('../src/modules/identity/identity-signup.service');
  const { IdentityPasswordService } = await import('../src/modules/identity/identity-password.service');
  const { AuthSecurityService } = await import('../src/modules/identity/auth-security.service');
  const { BusinessContextService } = await import('../src/modules/identity/business-context.service');
  const { AiUsageService } = await import('../src/modules/ai/ai-usage.service');
  const { SupabaseAdminService } = await import('../src/core/auth/supabase-admin.service');
  const { BlueprintService } = await import('../src/modules/blueprint/blueprint.service');
  const { DefaultTriggersService } = await import('../src/modules/ai/default-triggers.service');

  const client = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: 2,
    lazyConnect: false,
  });
  redis = client;

  // Empty objects: a call into one would throw, so the bootstrap cases also
  // show none of them is on the path.
  const notUsedByBootstrap = {};

  const moduleRef = await Test.createTestingModule({
    controllers: [K14aProbeController, IdentityController],
    providers: [
      PrismaService,
      SupabaseAuthService,
      AuthMiddleware,
      AuthGuard,
      { provide: REDIS_CLIENT, useValue: client },
      IdentityService,
      { provide: BlueprintService, useValue: notUsedByBootstrap },
      { provide: DefaultTriggersService, useValue: notUsedByBootstrap },
      { provide: IdentitySignupService, useValue: notUsedByBootstrap },
      { provide: IdentityPasswordService, useValue: notUsedByBootstrap },
      { provide: AuthSecurityService, useValue: notUsedByBootstrap },
      { provide: BusinessContextService, useValue: notUsedByBootstrap },
      { provide: AiUsageService, useValue: notUsedByBootstrap },
      { provide: SupabaseAdminService, useValue: supabaseAdmin },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  configureNestApp(app);
  // AppModule applies this middleware with consumer.apply(AuthMiddleware)
  // .forRoutes('*'); the DI-built instance is applied here the same way.
  const middleware = moduleRef.get(AuthMiddleware);
  app.use((req: never, res: never, next: () => void) => middleware.use(req, res, next));
  await app.init();

  await cleanupBootstrapRows();
  expect(await rowsForForgedSubs()).toBe(0);
}, 60_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  if (db) {
    await cleanupBootstrapRows();
    expect(await rowsForForgedSubs()).toBe(0);
  }
  if (app) await app.close();
  if (redis) await redis.quit();
  for (const k of PINNED_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function whoami(token?: string) {
  const req = request(app.getHttpServer()).get('/k14a-probe/whoami');
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
}

describe('Release 0 rule: SUPABASE_JWT_SECRET left empty closes the forged-token path (ST-R014-2)', () => {
  it('control: no bearer token answers 401', async () => {
    setSecret(undefined);
    const res = await whoami();
    expect(res.status).toBe(401);
  });

  it('a token with no iss, signed with the former placeholder, answers 401', async () => {
    setSecret(undefined);
    const res = await whoami(forge(FORMER_PLACEHOLDER, { sub: SUBS.noIssEmpty, email: VICTIM_EMAIL }));
    expect(res.status).toBe(401);
  });

  it('a token with iss = SUPABASE_URL, signed with the former placeholder, answers 401', async () => {
    setSecret('');
    const res = await whoami(
      forge(FORMER_PLACEHOLDER, { sub: SUBS.urlIssEmpty, email: VICTIM_EMAIL, iss: FAKE_SUPABASE_URL }),
    );
    expect(res.status).toBe(401);
  });

  it('nothing left the server: the getUser() fallback had no client, and no fetch was attempted', () => {
    expect(outbound).toEqual([]);
  });
});

describe('CHARACTERIZATION — the acceptance path the doc warns about (flips when a code packet fixes verifyLocal)', () => {
  // These pass today and SHOULD start failing once the issuer check requires
  // the hosted `iss` shape. When they do, update docs/auth-pathway.md (the
  // verifyLocal caveat and open defect 2) in the same change.
  it('with the secret set to the former placeholder, a forged token with no iss passes AuthGuard and its email claim is attached', async () => {
    setSecret(FORMER_PLACEHOLDER);
    const res = await whoami(forge(FORMER_PLACEHOLDER, { sub: SUBS.noIssPlaceholder, email: VICTIM_EMAIL }));
    expect(res.status).toBe(200);
    // Role comes from the local row; with none, the bootstrap default.
    expect(res.body).toEqual({ id: SUBS.noIssPlaceholder, email: VICTIM_EMAIL, role: 'USER' });
  });

  it('with the secret set, a forged token with iss = SUPABASE_URL also passes AuthGuard', async () => {
    setSecret(FORMER_PLACEHOLDER);
    const res = await whoami(
      forge(FORMER_PLACEHOLDER, { sub: SUBS.urlIssPlaceholder, email: VICTIM_EMAIL, iss: FAKE_SUPABASE_URL }),
    );
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(SUBS.urlIssPlaceholder);
  });

  it('with the secret set, the hosted shape iss = SUPABASE_URL/auth/v1 is refused (so the secret verifies no real hosted token)', async () => {
    setSecret(FORMER_PLACEHOLDER);
    const res = await whoami(
      forge(FORMER_PLACEHOLDER, { sub: SUBS.hostedIss, email: VICTIM_EMAIL, iss: `${FAKE_SUPABASE_URL}/auth/v1` }),
    );
    expect(res.status).toBe(401);
  });

  it('negative control: with the secret set, a token signed with another secret is refused', async () => {
    setSecret(FORMER_PLACEHOLDER);
    const res = await whoami(forge(OTHER_SECRET, { sub: SUBS.wrongSecret, email: VICTIM_EMAIL }));
    expect(res.status).toBe(401);
  });

  it('still nothing left the server', () => {
    expect(outbound).toEqual([]);
  });
});

// ── R0-SEC-01-BOOTSTRAP-TAKEOVER (was ST-R014-1, open defect 1) ──────────────
//
// Kernel K1 (Tenant Genesis & Identity): a local User is bound to the verified
// token subject, never to a client-supplied attribute. Pinned design:
//   (a) the bootstrap email is the verified token's `email` claim; a body
//       `email` is IGNORED (no 400: the web sends the address the user typed,
//       which may differ from the token's only in case or whitespace);
//   (b) when a User with a different id already holds the token's email,
//       bootstrap answers 409 {code:'account_email_in_use'} and writes nothing:
//       no User row, no membership, no business, and the holder's row, role,
//       memberships and Business.ownerId are untouched;
//   (c) moving a row to a new sub (same person, new Supabase project) is an
//       operator step, not something bootstrap does (docs/auth-pathway.md).
// The reviewer measured, before the fix: 201 {id: <attacker>, email: <victim>,
// role: SUPER_ADMIN}, with the victim's OWNER membership and businesses.owner_id
// re-pointed to the attacker.

type VictimState = {
  user: { id: string; email: string; role: string; deleted_at: Date | null } | null;
  emailHolders: string[];
  businessOwner: string | null;
  members: Array<{ user_id: string; role: string }>;
};

async function victimState(id: string, businessId: string): Promise<VictimState> {
  const users = await db.$queryRawUnsafe(
    'SELECT id, email, role, deleted_at FROM users WHERE id = $1',
    id,
  );
  const holders = await db.$queryRawUnsafe('SELECT id FROM users WHERE email = $1 ORDER BY id', bootEmail(id));
  const biz = await db.$queryRawUnsafe('SELECT owner_id FROM businesses WHERE id = $1', businessId);
  const members = await db.$queryRawUnsafe(
    'SELECT user_id, role FROM memberships WHERE business_id = $1 ORDER BY user_id',
    businessId,
  );
  return {
    user: users[0] ?? null,
    emailHolders: holders.map((r: { id: string }) => r.id),
    businessOwner: biz[0]?.owner_id ?? null,
    members,
  };
}

function intact(id: string, role: 'USER' | 'SUPER_ADMIN'): VictimState {
  return {
    user: { id, email: bootEmail(id), role, deleted_at: null },
    emailHolders: [id],
    businessOwner: id,
    members: [{ user_id: id, role: 'OWNER' }],
  };
}

/** What a caller id holds: its User row, its memberships, the businesses it owns. */
async function footprint(id: string): Promise<{ users: number; memberships: number; businesses: number }> {
  const rows = await db.$queryRawUnsafe(
    'SELECT (SELECT count(*)::int FROM users WHERE id = $1) AS users, ' +
      '(SELECT count(*)::int FROM memberships WHERE user_id = $1) AS memberships, ' +
      '(SELECT count(*)::int FROM businesses WHERE owner_id = $1) AS businesses',
    id,
  );
  return rows[0];
}

async function seedVictim(id: string, businessId: string, role: 'USER' | 'SUPER_ADMIN') {
  await db.user.create({ data: { id, email: bootEmail(id), name: id, role } });
  await db.business.create({ data: { id: businessId, name: `${P}${role} business`, ownerId: id } });
  await db.membership.create(skipTenantIsolation({ data: { userId: id, businessId, role: 'OWNER' } }));
}

function bootstrap(token: string, body: Record<string, unknown> = {}) {
  return request(app.getHttpServer()).post('/identity/bootstrap').set('Authorization', `Bearer ${token}`).send(body);
}

const token = (sub: string, email: string) => forge(BOOT_SECRET, { sub, email });

const VICTIMS = [
  { label: 'a plain owner (USER)', id: BOOT.owner, biz: BOOT.ownerBiz, role: 'USER' as const },
  { label: 'a SUPER_ADMIN', id: BOOT.admin, biz: BOOT.adminBiz, role: 'SUPER_ADMIN' as const },
];

describe('R0-SEC-01 — POST /identity/bootstrap binds by verified subject and never moves an existing user to another caller', () => {
  beforeEach(async () => {
    setSecret(BOOT_SECRET);
    await cleanupBootstrapRows();
    for (const v of VICTIMS) await seedVictim(v.id, v.biz, v.role);
  });

  it('fixture: each victim holds its own row, role and the OWNER membership of the business it owns', async () => {
    for (const v of VICTIMS) expect(await victimState(v.id, v.biz)).toEqual(intact(v.id, v.role));
  });

  it.each(VICTIMS)(
    "negative control: a body `email` naming $label's address is ignored — the caller (own sub, own email) gets only its own account, and the victim is untouched",
    async (v) => {
      const res = await bootstrap(token(BOOT.attacker, bootEmail(BOOT.attacker)), {
        email: bootEmail(v.id),
        company: `${P}attacker co`,
        firstName: 'Mallory',
      });

      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.user).toMatchObject({ id: BOOT.attacker, email: bootEmail(BOOT.attacker), role: 'USER' });
      expect(res.body.business.id).not.toBe(v.biz);
      expect(await victimState(v.id, v.biz)).toEqual(intact(v.id, v.role));
      expect(await footprint(BOOT.attacker)).toEqual({ users: 1, memberships: 1, businesses: 1 });
    },
  );

  it.each(VICTIMS)(
    "negative control: a token whose own `email` claim is $label's address, under a different sub, answers 409 account_email_in_use and writes nothing",
    async (v) => {
      const res = await bootstrap(token(BOOT.claimer, bootEmail(v.id)), { company: `${P}claimer co`, firstName: 'Mallory' });

      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body.code).toBe('account_email_in_use');
      expect(JSON.stringify(res.body)).not.toContain(v.id);
      expect(await victimState(v.id, v.biz)).toEqual(intact(v.id, v.role));
      expect(await footprint(BOOT.claimer)).toEqual({ users: 0, memberships: 0, businesses: 0 });
    },
  );

  it('negative control: that token cannot dodge the 409 by sending a free address in the body (the body email is ignored both ways)', async () => {
    const res = await bootstrap(token(BOOT.claimer, bootEmail(BOOT.admin)), { email: bootEmail(BOOT.claimer) });

    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe('account_email_in_use');
    expect(await victimState(BOOT.admin, BOOT.adminBiz)).toEqual(intact(BOOT.admin, 'SUPER_ADMIN'));
    expect(await footprint(BOOT.claimer)).toEqual({ users: 0, memberships: 0, businesses: 0 });
    const freeAddress = await db.$queryRawUnsafe('SELECT id FROM users WHERE email = $1', bootEmail(BOOT.claimer));
    expect(freeAddress).toEqual([]);
  });

  it('negative control: repeating the claim changes nothing, and the victim still signs in with its own token afterwards', async () => {
    for (let i = 0; i < 3; i += 1) {
      const res = await bootstrap(token(BOOT.claimer, bootEmail(BOOT.admin)));
      expect(res.status).toBe(409);
    }
    const own = await bootstrap(token(BOOT.admin, bootEmail(BOOT.admin)));
    expect(own.status, JSON.stringify(own.body)).toBe(201);
    expect(own.body.user).toMatchObject({ id: BOOT.admin, role: 'SUPER_ADMIN' });
    expect(own.body.business.id).toBe(BOOT.adminBiz);
    expect(await victimState(BOOT.admin, BOOT.adminBiz)).toEqual(intact(BOOT.admin, 'SUPER_ADMIN'));
    expect(await footprint(BOOT.claimer)).toEqual({ users: 0, memberships: 0, businesses: 0 });
  });

  it.each(VICTIMS)(
    'positive control: $label, returning with its own sub, is idempotent — same row, same role, its own business, no new membership',
    async (v) => {
      for (let i = 0; i < 2; i += 1) {
        const res = await bootstrap(token(v.id, bootEmail(v.id)), { company: `${P}ignored co` });
        expect(res.status, JSON.stringify(res.body)).toBe(201);
        expect(res.body.user).toMatchObject({ id: v.id, email: bootEmail(v.id), role: v.role });
        expect(res.body.business.id).toBe(v.biz);
        expect(res.body.isNewBusiness).toBe(false);
      }
      expect(await victimState(v.id, v.biz)).toEqual(intact(v.id, v.role));
      expect(await footprint(v.id)).toEqual({ users: 1, memberships: 1, businesses: 1 });
    },
  );

  it('positive control (journey step 1): a first-time caller gets its own User, its own business and one OWNER membership; a second call is idempotent', async () => {
    const t = token(BOOT.fresh, bootEmail(BOOT.fresh));
    const first = await bootstrap(t, { company: `${P}fresh co`, firstName: 'Riley' });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.user).toMatchObject({ id: BOOT.fresh, email: bootEmail(BOOT.fresh), role: 'USER' });
    expect(first.body.isNewBusiness).toBe(true);

    const again = await bootstrap(t, { company: `${P}fresh co`, firstName: 'Riley' });
    expect(again.status).toBe(201);
    expect(again.body.business.id).toBe(first.body.business.id);
    expect(again.body.isNewBusiness).toBe(false);

    const members = await db.$queryRawUnsafe(
      'SELECT user_id, role FROM memberships WHERE business_id = $1',
      first.body.business.id,
    );
    expect(members).toEqual([{ user_id: BOOT.fresh, role: 'OWNER' }]);
    expect(await footprint(BOOT.fresh)).toEqual({ users: 1, memberships: 1, businesses: 1 });
    for (const v of VICTIMS) expect(await victimState(v.id, v.biz)).toEqual(intact(v.id, v.role));
  });

  it('bootstrap never contacted Supabase: no fetch was attempted, and no account collision asked for an ownership proof', () => {
    expect(outbound).toEqual([]);
    expect(supabaseAdmin.lookups).toEqual([]);
  });
});

// ── R0-SEC-01 review repair (SEC01-T1, CR-1): team invitations ───────────────
//
// inviteTeamMember creates a placeholder User (generated id, role USER, the
// invited address) for an address with no account, and hangs the pending
// membership on it. R0-SEC-01's 409 treated that row as an account, so an
// invitation to anyone without an account could never be accepted, and any
// signed-up user (OWNER of its own bootstrap business) could lock an address
// out of sign-up for good by inviting it and removing the membership. Pinned
// design:
//   (a) the placeholder carries a server-set marker; bootstrap adopts only a
//       marked row nobody ever signed in as, re-checked inside the move's
//       transaction; every other holder is still an account (409
//       account_email_in_use, the block above);
//   (b) a pending membership grants authority in the inviting business, so it
//       moves to the caller only when the caller is proven to own the address:
//       AUTH_REQUIRE_EMAIL_VERIFICATION on, and the Supabase user with the
//       token's sub holds the address with email_confirmed_at set. Otherwise
//       409 invite_email_unverified, and nothing is written;
//   (c) a placeholder whose invitation was removed carries nothing, and the
//       owner of the address bootstraps through it without any proof.

const INV = {
  inviteeSub: `${P}inv_invitee_sub`,
  inviteeEmail: `${P}inv_invitee@test.local`,
  /** The real owner of an address a stranger invited and then un-invited. */
  victimSub: `${P}inv_victim_sub`,
  victimEmail: `${P}inv_victim@test.local`,
  /** A row that holds the marker but is no longer a never-bound placeholder. */
  boundId: `${P}inv_bound`,
  /** A pre-repair invite placeholder, or any account: no marker. */
  legacyId: `${P}inv_legacy`,
};

const confirmed = (id: string, email: string): SupabaseRecord => ({
  id,
  email,
  email_confirmed_at: '2026-10-01T00:00:00Z',
});

/** The inviter is BOOT.owner, OWNER of BOOT.ownerBiz, through the real team route. */
function invite(email: string, role = 'STAFF') {
  return request(app.getHttpServer())
    .post(`/identity/businesses/${BOOT.ownerBiz}/team`)
    .set('Authorization', `Bearer ${token(BOOT.owner, bootEmail(BOOT.owner))}`)
    .set('x-business-id', BOOT.ownerBiz)
    .send({ email, role });
}

function uninvite(membershipId: string) {
  return request(app.getHttpServer())
    .delete(`/identity/businesses/${BOOT.ownerBiz}/team/${membershipId}`)
    .set('Authorization', `Bearer ${token(BOOT.owner, bootEmail(BOOT.owner))}`)
    .set('x-business-id', BOOT.ownerBiz);
}

async function holdersOf(email: string): Promise<Array<{ id: string; role: string; referral_code: string | null }>> {
  return db.$queryRawUnsafe('SELECT id, role, referral_code FROM users WHERE email = $1', email);
}

async function inviterMembers(): Promise<Array<{ user_id: string; role: string }>> {
  return db.$queryRawUnsafe(
    'SELECT user_id, role FROM memberships WHERE business_id = $1 ORDER BY role, user_id',
    BOOT.ownerBiz,
  );
}

function setVerification(on: boolean) {
  process.env.AUTH_REQUIRE_EMAIL_VERIFICATION = on ? 'true' : 'false';
}

describe("R0-SEC-01 review repair — a team invitation is accepted on the invitee's first bootstrap, and cannot lock an address out (SEC01-T1, CR-1)", () => {
  beforeEach(async () => {
    setSecret(BOOT_SECRET);
    await cleanupBootstrapRows();
    await seedVictim(BOOT.owner, BOOT.ownerBiz, 'USER');
    supabaseAdmin.records.clear();
    supabaseAdmin.lookups.length = 0;
    setVerification(true);
  });

  it('fixture: the real invite route creates a marked placeholder (generated id, role USER) holding the STAFF membership', async () => {
    const inv = await invite(INV.inviteeEmail);
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);

    const rows = await db.$queryRawUnsafe(
      'SELECT id, role, referral_code, meta_data FROM users WHERE email = $1',
      INV.inviteeEmail,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id.startsWith(P)).toBe(false);
    expect(rows[0]).toMatchObject({ role: 'USER', referral_code: null, meta_data: { invitePlaceholder: true } });
    expect(await inviterMembers()).toEqual([
      { user_id: BOOT.owner, role: 'OWNER' },
      { user_id: rows[0].id, role: 'STAFF' },
    ]);
  });

  it('positive control: the invitee, proven to own the address, bootstraps (201) and the STAFF membership moves to its sub', async () => {
    const inv = await invite(INV.inviteeEmail);
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    const [placeholder] = await holdersOf(INV.inviteeEmail);
    supabaseAdmin.records.set(INV.inviteeSub, confirmed(INV.inviteeSub, INV.inviteeEmail));

    const res = await bootstrap(token(INV.inviteeSub, INV.inviteeEmail), { firstName: 'Ivy', company: `${P}ivy co` });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.user).toMatchObject({ id: INV.inviteeSub, email: INV.inviteeEmail, role: 'USER' });
    expect(res.body.business.id).not.toBe(BOOT.ownerBiz);
    expect(await inviterMembers()).toEqual([
      { user_id: BOOT.owner, role: 'OWNER' },
      { user_id: INV.inviteeSub, role: 'STAFF' },
    ]);
    expect(await holdersOf(INV.inviteeEmail)).toEqual([expect.objectContaining({ id: INV.inviteeSub, role: 'USER' })]);
    expect(await footprint(placeholder.id)).toEqual({ users: 0, memberships: 0, businesses: 0 });
    // Its own workspace too, as for any first bootstrap: STAFF in the inviting business plus OWNER of its own.
    expect(await footprint(INV.inviteeSub)).toEqual({ users: 1, memberships: 2, businesses: 1 });
    expect(supabaseAdmin.lookups).toEqual([INV.inviteeSub]);
    expect(await victimState(BOOT.owner, BOOT.ownerBiz)).toMatchObject({
      user: { id: BOOT.owner, role: 'USER' },
      businessOwner: BOOT.owner,
    });

    const again = await bootstrap(token(INV.inviteeSub, INV.inviteeEmail));
    expect(again.status).toBe(201);
    expect(again.body.business.id).toBe(res.body.business.id);
    expect(await footprint(INV.inviteeSub)).toEqual({ users: 1, memberships: 2, businesses: 1 });
  });

  it.each([
    {
      label: 'email verification is off (sign-up confirms the address without proving it)',
      verification: false,
      record: (sub: string, email: string): SupabaseRecord | null => confirmed(sub, email),
    },
    {
      label: 'the Supabase user has not confirmed the address',
      verification: true,
      record: (sub: string, email: string): SupabaseRecord | null => ({ id: sub, email, email_confirmed_at: null }),
    },
    {
      label: 'the Supabase user for the sub holds another address',
      verification: true,
      record: (sub: string): SupabaseRecord | null => confirmed(sub, `${P}inv_other@test.local`),
    },
    {
      label: 'Supabase has no user for the sub',
      verification: true,
      record: (): SupabaseRecord | null => null,
    },
  ])(
    'negative control: when $label, the pending invitation answers 409 invite_email_unverified and nothing is written',
    async ({ verification, record }) => {
      const inv = await invite(INV.inviteeEmail);
      expect(inv.status, JSON.stringify(inv.body)).toBe(201);
      const [placeholder] = await holdersOf(INV.inviteeEmail);
      setVerification(verification);
      const answer = record(INV.inviteeSub, INV.inviteeEmail);
      if (answer) supabaseAdmin.records.set(INV.inviteeSub, answer);

      for (let i = 0; i < 2; i += 1) {
        const res = await bootstrap(token(INV.inviteeSub, INV.inviteeEmail), { company: `${P}mallory co` });
        expect(res.status, JSON.stringify(res.body)).toBe(409);
        expect(res.body.code).toBe('invite_email_unverified');
      }

      expect(await holdersOf(INV.inviteeEmail)).toEqual([{ id: placeholder.id, role: 'USER', referral_code: null }]);
      expect(await inviterMembers()).toEqual([
        { user_id: BOOT.owner, role: 'OWNER' },
        { user_id: placeholder.id, role: 'STAFF' },
      ]);
      expect(await footprint(INV.inviteeSub)).toEqual({ users: 0, memberships: 0, businesses: 0 });
    },
  );

  it('recovery: after a 409 invite_email_unverified, the same sign-in bootstraps once Supabase has the address confirmed', async () => {
    expect((await invite(INV.inviteeEmail)).status).toBe(201);
    supabaseAdmin.records.set(INV.inviteeSub, { id: INV.inviteeSub, email: INV.inviteeEmail, email_confirmed_at: null });
    const before = await bootstrap(token(INV.inviteeSub, INV.inviteeEmail));
    expect(before.status).toBe(409);

    supabaseAdmin.records.set(INV.inviteeSub, confirmed(INV.inviteeSub, INV.inviteeEmail));
    const after = await bootstrap(token(INV.inviteeSub, INV.inviteeEmail));
    expect(after.status, JSON.stringify(after.body)).toBe(201);
    expect(await inviterMembers()).toEqual([
      { user_id: BOOT.owner, role: 'OWNER' },
      { user_id: INV.inviteeSub, role: 'STAFF' },
    ]);
  });

  it('lockout closed: invite then remove leaves a placeholder that no longer blocks the real owner, who bootstraps without proof and gains nothing', async () => {
    setVerification(false);
    const inv = await invite(INV.victimEmail);
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    const del = await uninvite(inv.body.id);
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    const [placeholder] = await holdersOf(INV.victimEmail);
    expect(await footprint(placeholder.id)).toEqual({ users: 1, memberships: 0, businesses: 0 });

    const res = await bootstrap(token(INV.victimSub, INV.victimEmail), { company: `${P}victim co` });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.user).toMatchObject({ id: INV.victimSub, email: INV.victimEmail, role: 'USER' });
    expect(res.body.isNewBusiness).toBe(true);
    expect(await footprint(INV.victimSub)).toEqual({ users: 1, memberships: 1, businesses: 1 });
    expect(await footprint(placeholder.id)).toEqual({ users: 0, memberships: 0, businesses: 0 });
    expect(await inviterMembers()).toEqual([{ user_id: BOOT.owner, role: 'OWNER' }]);
    // Nothing to move, so no proof was asked for.
    expect(supabaseAdmin.lookups).toEqual([]);

    const again = await bootstrap(token(INV.victimSub, INV.victimEmail));
    expect(again.status).toBe(201);
    expect(again.body.business.id).toBe(res.body.business.id);
  });

  it.each([
    {
      label: 'carries the marker but has been signed in as (it has a referral code)',
      id: INV.boundId,
      data: { referralCode: `${P}INVBND`, metaData: { invitePlaceholder: true } },
    },
    {
      label: 'carries the marker but is a SUPER_ADMIN',
      id: INV.boundId,
      data: { role: 'SUPER_ADMIN', metaData: { invitePlaceholder: true } },
    },
    {
      label: 'has no marker (an invite placeholder created before this repair, or any other account)',
      id: INV.legacyId,
      data: {},
    },
  ])(
    'negative control: a holder that $label stays an account: 409 account_email_in_use even with proof, nothing moves',
    async ({ id, data }) => {
      const email = bootEmail(id);
      await db.user.create({ data: { id, email, name: id, role: 'USER', ...data } });
      await db.membership.create(skipTenantIsolation({ data: { userId: id, businessId: BOOT.ownerBiz, role: 'STAFF' } }));
      supabaseAdmin.records.set(BOOT.claimer, confirmed(BOOT.claimer, email));

      const res = await bootstrap(token(BOOT.claimer, email));
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body.code).toBe('account_email_in_use');
      expect((await holdersOf(email)).map((r) => r.id)).toEqual([id]);
      expect(await inviterMembers()).toEqual([
        { user_id: BOOT.owner, role: 'OWNER' },
        { user_id: id, role: 'STAFF' },
      ]);
      expect(await footprint(BOOT.claimer)).toEqual({ users: 0, memberships: 0, businesses: 0 });
    },
  );

  it('no fetch was attempted: the ownership proof went only to the Supabase-admin stand-in', () => {
    expect(outbound).toEqual([]);
  });
});
