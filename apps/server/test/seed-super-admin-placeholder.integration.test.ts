/**
 * FU-SEED-SUPERADMIN-PLACEHOLDER (V1-71; source: wave-2 run wf_3679ac84-da1, chain
 * server-sec-platform-a, open issue SEC-V63-1): the super-admin seed never promotes a
 * team-invite placeholder, so the real admin's first sign-in is not refused.
 *
 * RED-BEFORE: SeedService.seedSuperAdmin promoted any users row whose email equals
 * SUPER_ADMIN_EMAIL to SUPER_ADMIN, the invite placeholder inviteTeamMember makes for an
 * address with no account included (meta_data.invitePlaceholder true). Invites are stored
 * lower-cased (V1-63), so an invite of the admin's address typed in any letter case is
 * such a row. Bootstrap adopts a placeholder only while it is still exactly what the
 * invite made (assertAdoptableInvitePlaceholder: role USER among the rest), so the
 * promoted placeholder was an account to it: the admin's first sign-in got 409
 * account_email_in_use, with or without proof of the address, and the invitation could
 * never be accepted.
 *
 * Required (packet definition of done), through the real HTTP routes on a real database:
 *   - the seed leaves the placeholder a USER, on every boot, and writes nothing to it;
 *   - the admin's first sign-in adopts it under the ordinary rules (with proof of the
 *     address when a membership is pending; without, when the invitation was removed),
 *     and an unproven sign-in gets the ordinary 409 invite_email_unverified;
 *   - once adopted the row is no longer a placeholder, and the next seed run promotes
 *     it as it promotes any account; a further run writes nothing;
 *   - the invite answer for SUPER_ADMIN_EMAIL is the same as for any other address
 *     (inviteTeamMember is NOT taught to refuse the admin's address: a distinct answer
 *     would let anyone with team:write probe for it).
 * The seed's log lines never carry the configured address.
 *
 * Harness (as test/team-invite-email-case.integration.test.ts, V1-63): the real
 * AuthMiddleware and AuthGuard, the real IdentityController and IdentityService on the
 * real PrismaService, the real BusinessGuard and ModuleScopeGuard. Tokens are HS256 on the
 * test-only verifyLocal path (NODE_ENV=test, no Supabase URL), signed with a secret built
 * at run time. The only Supabase call bootstrap can make (the service-role user lookup
 * that proves an invitee owns its address) is a recording stand-in, and global fetch is a
 * tap that refuses every call; the suite asserts it was never used. The SeedService is
 * the real class over the same PrismaService, constructed directly (not a provider, so
 * app.init runs no other seeder), and is given SUPER_ADMIN_EMAIL through its `env`
 * parameter: process.env is never set.
 *
 * RESOURCES: fixture prefix v71c_ (registered in test/helpers/fixture-prefixes.json,
 * packet V1-71 (FU-SEED-SUPERADMIN-PLACEHOLDER)). Every seeded id, sub and address carries
 * it, and the configured SUPER_ADMIN_EMAIL is a fixture address built from it at run time.
 * Rows the routes create get generated ids: an invite placeholder is found by its prefixed
 * address or by its membership in the prefixed business, a bootstrap business by its
 * prefixed owner. Everything is hard-deleted by raw SQL through sqlLikePrefix(P) before
 * every case and after the suite.
 */
import 'reflect-metadata';
import path from 'path';
import { createHmac, randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v71c_';

/** Test-only HS256 secret, assembled at run time (no secret-shaped literal). */
const SIGNING_SECRET = [P, 'seed', 'super', 'admin', 'signing'].join('-');

const PINNED_KEYS = [
  'SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_JWT_SECRET',
  'ADMIN_JWT_SECRET',
  'AUTH_REQUIRE_EMAIL_VERIFICATION',
] as const;
const saved: Partial<Record<(typeof PINNED_KEYS)[number], string | undefined>> = {};

const ID = {
  owner: `${P}owner`,
  biz: `${P}biz`,
  /** The Supabase subject of the person SUPER_ADMIN_EMAIL names. */
  adminSub: `${P}admin_sub`,
};

const EMAIL = {
  owner: [P, 'owner', '@', 'test.local'].join(''),
  /** The configured SUPER_ADMIN_EMAIL of this suite (a fixture address, lower case as a sign-in carries it). */
  admin: [P, 'platform.admin', '@', 'test.local'].join(''),
  /** Any other address an owner invites. */
  other: [P, 'other.person', '@', 'test.local'].join(''),
};

/** The env the seed is given: SUPER_ADMIN_EMAIL names the admin's address. */
const SEED_ENV = { SUPER_ADMIN_EMAIL: EMAIL.admin } as NodeJS.ProcessEnv;

/** 'V71c_Platform.Admin@Test.Local': the same address as a person might type it. */
function mixedCase(email: string): string {
  const [local, domain] = email.split('@');
  const title = (s: string) => s.replace(/(^|[._])([a-z])/g, (_m, sep: string, c: string) => sep + c.toUpperCase());
  return `${title(local)}@${title(domain)}`;
}

/** The ways an owner may type the admin's address into the invite form. */
const TYPED = [
  { label: 'as stored (lower case)', typed: () => EMAIL.admin },
  { label: 'in UPPER case', typed: () => EMAIL.admin.toUpperCase() },
  { label: 'in Mixed case with spaces', typed: () => `  ${mixedCase(EMAIL.admin)} ` },
];

type SupabaseRecord = { id: string; email: string; email_confirmed_at: string | null };
/**
 * The controller's SupabaseAdminService: `records` is what the Supabase project
 * would answer for a sub, `lookups` every id asked about. It makes no network call.
 */
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
const confirmed = (id: string, email: string): SupabaseRecord => ({ id, email, email_confirmed_at: '2026-11-01T00:00:00Z' });

let app: INestApplication;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the @keyflow/db client is loaded after env
let db: any;
let skipTenantIsolation: <T extends object>(args: T) => T;
let redis: { quit: () => Promise<unknown> } | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- SeedService is imported after env
let seed: any;

/** Every line the seed logged (any level), for the "never prints the address" check. */
const seedLog: string[] = [];

/** Outbound fetch tap: every attempted call is recorded and refused. */
const outbound: string[] = [];
const realFetch = globalThis.fetch;

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/** An HS256 access token in the shape the real-database harnesses mint (no iss). */
function token(sub: string, email: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const body = b64url({ sub, email, aud: 'authenticated', role: 'authenticated', iat: now, exp: now + 600, jti: randomUUID() });
  const sig = createHmac('sha256', SIGNING_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

const ownerToken = () => token(ID.owner, EMAIL.owner);

function invite(email: string, role = 'STAFF') {
  return request(app.getHttpServer())
    .post(`/identity/businesses/${ID.biz}/team`)
    .set('Authorization', `Bearer ${ownerToken()}`)
    .set('x-business-id', ID.biz)
    .send({ email, role });
}

function removeMember(membershipId: string) {
  return request(app.getHttpServer())
    .delete(`/identity/businesses/${ID.biz}/team/${membershipId}`)
    .set('Authorization', `Bearer ${ownerToken()}`)
    .set('x-business-id', ID.biz);
}

function teamList() {
  return request(app.getHttpServer())
    .get(`/identity/businesses/${ID.biz}/team`)
    .set('Authorization', `Bearer ${ownerToken()}`)
    .set('x-business-id', ID.biz);
}

function bootstrap(sub: string, email: string, body: Record<string, unknown> = {}) {
  return request(app.getHttpServer())
    .post('/identity/bootstrap')
    .set('Authorization', `Bearer ${token(sub, email)}`)
    .send(body);
}

/** One boot's super-admin step against this database, with SUPER_ADMIN_EMAIL = the admin's address. */
async function seedBoot(): Promise<void> {
  await seed.seedSuperAdmin(SEED_ENV);
}

/** Every users row holding an address (compared case-insensitively), as stored. */
async function holdersOf(email: string): Promise<Array<{ id: string; email: string; role: string; meta_data: unknown }>> {
  return db.$queryRawUnsafe('SELECT id, email, role, meta_data FROM users WHERE lower(email) = lower($1) ORDER BY id', email);
}

/** A users row exactly as Postgres stores it, so "unchanged" means byte-identical. */
async function userRowText(id: string): Promise<string> {
  const rows = await db.$queryRawUnsafe('SELECT row_to_json(u)::text AS j FROM users u WHERE u.id = $1', id);
  expect(rows.length, `user ${id} exists`).toBe(1);
  return rows[0].j as string;
}

/** The members of the inviting business as {user_id: role}. */
async function memberRoles(): Promise<Record<string, string>> {
  const rows: Array<{ user_id: string; role: string }> = await db.$queryRawUnsafe(
    'SELECT user_id, role FROM memberships WHERE business_id = $1',
    ID.biz,
  );
  return Object.fromEntries(rows.map((m) => [m.user_id, m.role]));
}

/** What a sub holds: its User row, its memberships, the businesses it owns. */
async function footprint(id: string): Promise<{ users: number; memberships: number; businesses: number }> {
  const rows = await db.$queryRawUnsafe(
    'SELECT (SELECT count(*)::int FROM users WHERE id = $1) AS users, ' +
      '(SELECT count(*)::int FROM memberships WHERE user_id = $1) AS memberships, ' +
      '(SELECT count(*)::int FROM businesses WHERE owner_id = $1) AS businesses',
    id,
  );
  return rows[0];
}

function setVerification(on: boolean) {
  process.env.AUTH_REQUIRE_EMAIL_VERIFICATION = on ? 'true' : 'false';
}

/**
 * An invite answer with what names the person (membership id, user id, address, the
 * name derived from it) and the clock replaced by tokens: two invites answered alike
 * normalise to the same value.
 */
function normalisedInviteAnswer(body: { id: string; userId: string }, address: string): unknown {
  const local = address.split('@')[0];
  const text = JSON.stringify(body)
    .split(body.id).join('<membership>')
    .split(body.userId).join('<user>')
    .split(address).join('<address>')
    .split(local).join('<local>')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<time>');
  return JSON.parse(text);
}

/**
 * Hard-delete every row this suite seeds or its routes create. Raw SQL: Business
 * is a soft-deleted model, so the client's deleteMany would only set deletedAt.
 */
async function cleanup() {
  const rows: Array<{ id: string }> = await db.$queryRawUnsafe(
    `SELECT id FROM users WHERE id LIKE ${sqlLikePrefix(P)} OR lower(email) LIKE ${sqlLikePrefix(P)} ` +
      `UNION SELECT m.user_id AS id FROM memberships m JOIN users u ON u.id = m.user_id ` +
      `WHERE m.business_id LIKE ${sqlLikePrefix(P)} AND u.meta_data ->> 'invitePlaceholder' = 'true'`,
  );
  const ids = rows.map((r) => r.id);
  const owned = `(SELECT id FROM businesses WHERE id LIKE ${sqlLikePrefix(P)} OR owner_id = ANY($1::text[]))`;
  for (const sql of [
    `DELETE FROM team_activity_logs WHERE business_id IN ${owned} OR user_id = ANY($1::text[])`,
    `DELETE FROM memberships WHERE business_id IN ${owned} OR user_id = ANY($1::text[])`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)} OR owner_id = ANY($1::text[])`,
    `DELETE FROM sessions WHERE user_id = ANY($1::text[])`,
    `DELETE FROM user_identities WHERE user_id = ANY($1::text[])`,
    `DELETE FROM users WHERE id = ANY($1::text[])`,
  ]) {
    await db.$executeRawUnsafe(sql, ids);
  }
}

async function seedOwner() {
  await db.user.create({ data: { id: ID.owner, email: EMAIL.owner, name: 'Owner', role: 'USER' } });
  await db.business.create({ data: { id: ID.biz, name: `${P}business`, ownerId: ID.owner } });
  await db.membership.create(skipTenantIsolation({ data: { userId: ID.owner, businessId: ID.biz, role: 'OWNER' } }));
}

beforeAll(async () => {
  for (const k of PINNED_KEYS) saved[k] = process.env[k];
  for (const k of PINNED_KEYS) delete process.env[k];
  // The test-only verifyLocal path: a configured secret, no Supabase URL, NODE_ENV=test.
  process.env.SUPABASE_JWT_SECRET = SIGNING_SECRET;

  globalThis.fetch = (async (input: unknown) => {
    outbound.push(String(input instanceof Request ? input.url : input));
    throw new Error('v71c: outbound fetch refused by the test');
  }) as typeof fetch;

  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  skipTenantIsolation = dbMod.skipTenantIsolation;

  const { Test } = await import('@nestjs/testing');
  const IORedis = (await import('ioredis')).default;
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { SupabaseAuthService } = await import('../src/core/auth/supabase-auth.service');
  const { AuthMiddleware } = await import('../src/core/auth/auth.middleware');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { configureNestApp } = await import('../src/app-bootstrap');
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
  const { SeedService } = await import('../src/core/seed/seed.service');

  const client = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });
  redis = client;

  // Collaborators the team, bootstrap and seed paths never call: a call into one throws.
  const notOnThesePaths = {};

  const moduleRef = await Test.createTestingModule({
    controllers: [IdentityController],
    providers: [
      PrismaService,
      SupabaseAuthService,
      AuthMiddleware,
      AuthGuard,
      { provide: REDIS_CLIENT, useValue: client },
      IdentityService,
      { provide: BlueprintService, useValue: notOnThesePaths },
      { provide: DefaultTriggersService, useValue: notOnThesePaths },
      { provide: IdentitySignupService, useValue: notOnThesePaths },
      { provide: IdentityPasswordService, useValue: notOnThesePaths },
      { provide: AuthSecurityService, useValue: notOnThesePaths },
      { provide: BusinessContextService, useValue: notOnThesePaths },
      { provide: AiUsageService, useValue: notOnThesePaths },
      { provide: SupabaseAdminService, useValue: supabaseAdmin },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  configureNestApp(app);
  const middleware = moduleRef.get(AuthMiddleware);
  app.use((req: never, res: never, next: () => void) => middleware.use(req, res, next));
  await app.init();

  // The real seeder over the app's PrismaService. Only seedSuperAdmin is called; its
  // logger is a recorder so the suite can check what it prints.
  seed = new SeedService(moduleRef.get(PrismaService), supabaseAdmin as never, moduleRef.get(IdentityService));
  const record = (message: unknown) => {
    seedLog.push(String(message));
  };
  seed.logger = { log: record, warn: record, error: record, debug: record, verbose: record };

  await cleanup();
}, 60_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  if (db) await cleanup();
  if (app) await app.close();
  if (redis) await redis.quit();
  for (const k of PINNED_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

beforeEach(async () => {
  await cleanup();
  await seedOwner();
  supabaseAdmin.records.clear();
  supabaseAdmin.lookups.length = 0;
  setVerification(true);
});

describe('FU-SEED-SUPERADMIN-PLACEHOLDER — the super-admin seed never promotes a team-invite placeholder (V1-71, SEC-V63-1)', () => {
  it.each(TYPED)(
    'an owner invites SUPER_ADMIN_EMAIL $label: the seed leaves the placeholder a USER, marker intact and the row byte-identical, on every boot (RED: promoted to SUPER_ADMIN)',
    async ({ typed }) => {
      const inv = await invite(typed());
      expect(inv.status, JSON.stringify(inv.body)).toBe(201);
      expect(inv.body.user.email).toBe(EMAIL.admin);
      const placeholderId: string = inv.body.userId;
      const before = await userRowText(placeholderId);

      for (let boot = 1; boot <= 3; boot++) {
        await seedBoot();
        expect(await holdersOf(EMAIL.admin), `boot ${boot}`).toEqual([
          { id: placeholderId, email: EMAIL.admin, role: 'USER', meta_data: { invitePlaceholder: true } },
        ]);
        expect(await userRowText(placeholderId), `boot ${boot}: the placeholder row is byte-identical`).toBe(before);
      }

      // Still the pending invitation it was.
      const list = await teamList();
      expect(list.status, JSON.stringify(list.body)).toBe(200);
      expect(list.body.find((m: { userId: string }) => m.userId === placeholderId)).toMatchObject({ invitePending: true, role: 'STAFF' });
    },
  );

  it.each(TYPED)(
    'invited $label, then a boot: the admin\'s first confirmed sign-in adopts the invitation (201, STAFF here, a USER); the next boot promotes the adopted account and a further boot writes nothing (RED: 409 account_email_in_use)',
    async ({ typed }) => {
      const inv = await invite(typed());
      expect(inv.status, JSON.stringify(inv.body)).toBe(201);
      const placeholderId: string = inv.body.userId;
      await seedBoot();

      supabaseAdmin.records.set(ID.adminSub, confirmed(ID.adminSub, EMAIL.admin));
      const res = await bootstrap(ID.adminSub, EMAIL.admin, { company: `${P}admin co` });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.user).toMatchObject({ id: ID.adminSub, email: EMAIL.admin, role: 'USER' });
      expect(supabaseAdmin.lookups).toEqual([ID.adminSub]);

      // Adopted: one row under the address, the sub's, no longer a placeholder; the STAFF
      // membership moved to it; the placeholder is gone.
      const adopted = await holdersOf(EMAIL.admin);
      expect(adopted).toHaveLength(1);
      expect(adopted[0]).toMatchObject({ id: ID.adminSub, email: EMAIL.admin, role: 'USER' });
      expect((adopted[0].meta_data as Record<string, unknown> | null)?.invitePlaceholder).not.toBe(true);
      expect(await memberRoles()).toEqual({ [ID.owner]: 'OWNER', [ID.adminSub]: 'STAFF' });
      expect(await footprint(placeholderId)).toEqual({ users: 0, memberships: 0, businesses: 0 });
      expect(await footprint(ID.adminSub)).toEqual({ users: 1, memberships: 2, businesses: 1 });

      // The next boot promotes the account as it promotes any account.
      await seedBoot();
      expect((await holdersOf(EMAIL.admin)).map((h) => [h.id, h.role])).toEqual([[ID.adminSub, 'SUPER_ADMIN']]);
      const promoted = await userRowText(ID.adminSub);

      // Already promoted: a further boot writes nothing.
      await seedBoot();
      expect(await userRowText(ID.adminSub), 'a further boot leaves the row byte-identical').toBe(promoted);
      // Promotion moved no membership: still STAFF in the inviting business.
      expect(await memberRoles()).toEqual({ [ID.owner]: 'OWNER', [ID.adminSub]: 'STAFF' });
    },
  );

  it('after a boot, an unproven sign-in for the address gets the ordinary answer for a pending invitation, 409 invite_email_unverified, and writes nothing; the placeholder stays a USER (RED: 409 account_email_in_use)', async () => {
    const inv = await invite(mixedCase(EMAIL.admin));
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    const placeholderId: string = inv.body.userId;
    await seedBoot();
    const before = await userRowText(placeholderId);

    // Supabase has not confirmed the address.
    supabaseAdmin.records.set(ID.adminSub, { id: ID.adminSub, email: EMAIL.admin, email_confirmed_at: null });
    const res = await bootstrap(ID.adminSub, EMAIL.admin, { company: `${P}mallory co` });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe('invite_email_unverified');

    expect(await footprint(ID.adminSub)).toEqual({ users: 0, memberships: 0, businesses: 0 });
    expect(await userRowText(placeholderId), 'the placeholder row is byte-identical').toBe(before);
    expect(await memberRoles()).toEqual({ [ID.owner]: 'OWNER', [placeholderId]: 'STAFF' });
  });

  it('an invitation the owner removed leaves a placeholder with no membership: a boot leaves it a USER, the sign-in adopts it with no proof needed, the next boot promotes it (RED: 409 account_email_in_use)', async () => {
    const inv = await invite(EMAIL.admin.toUpperCase());
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    const placeholderId: string = inv.body.userId;
    const removed = await removeMember(inv.body.id);
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    await seedBoot();
    const afterBoot = (await holdersOf(EMAIL.admin)).map((h) => [h.id, h.role]);

    // No membership is pending, so no proof is asked for (adoptInvitePlaceholder).
    const res = await bootstrap(ID.adminSub, EMAIL.admin, { company: `${P}admin co` });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(afterBoot, 'the boot left the placeholder a USER').toEqual([[placeholderId, 'USER']]);
    expect(res.body.user).toMatchObject({ id: ID.adminSub, email: EMAIL.admin, role: 'USER' });
    expect(supabaseAdmin.lookups).toEqual([]);
    expect(await footprint(placeholderId)).toEqual({ users: 0, memberships: 0, businesses: 0 });
    expect(await footprint(ID.adminSub)).toEqual({ users: 1, memberships: 1, businesses: 1 });

    await seedBoot();
    expect((await holdersOf(EMAIL.admin)).map((h) => [h.id, h.role])).toEqual([[ID.adminSub, 'SUPER_ADMIN']]);
  });

  it('the invite answer for SUPER_ADMIN_EMAIL is the same as for any other address, before and after a boot, and so is a repeat\'s refusal: the route reveals nothing about the configured address', async () => {
    // A boot with nobody under the address yet: it creates and promotes nobody.
    await seedBoot();
    expect(await holdersOf(EMAIL.admin)).toEqual([]);

    const forAdmin = await invite(mixedCase(EMAIL.admin));
    const forOther = await invite(mixedCase(EMAIL.other));
    expect(forAdmin.status, JSON.stringify(forAdmin.body)).toBe(201);
    expect(forOther.status, JSON.stringify(forOther.body)).toBe(201);
    expect(normalisedInviteAnswer(forAdmin.body, EMAIL.admin)).toEqual(normalisedInviteAnswer(forOther.body, EMAIL.other));

    await seedBoot();

    // The error answer carries the clock (timestamp); everything else is compared as is.
    const withoutClock = (body: Record<string, unknown>) => ({ ...body, timestamp: '<time>' });
    for (const variant of [(e: string) => e, (e: string) => e.toUpperCase(), mixedCase]) {
      const repeatAdmin = await invite(variant(EMAIL.admin));
      const repeatOther = await invite(variant(EMAIL.other));
      expect(repeatAdmin.status, JSON.stringify(repeatAdmin.body)).toBe(400);
      expect(repeatOther.status, JSON.stringify(repeatOther.body)).toBe(400);
      expect(withoutClock(repeatAdmin.body)).toEqual(withoutClock(repeatOther.body));
    }

    // Both are pending invitations alike on the team list.
    const list = await teamList();
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const pending = Object.fromEntries(list.body.map((m: { userId: string; invitePending: unknown }) => [m.userId, m.invitePending]));
    expect(pending).toEqual({ [ID.owner]: false, [forAdmin.body.userId]: true, [forOther.body.userId]: true });
    // And both are USERs: the boots promoted neither.
    expect((await holdersOf(EMAIL.admin)).map((h) => h.role)).toEqual(['USER']);
    expect((await holdersOf(EMAIL.other)).map((h) => h.role)).toEqual(['USER']);
  });

  it('the seed never prints the configured address, in any letter case', () => {
    expect(seedLog.length, 'the seed logged at all in this suite').toBeGreaterThan(0);
    const leaked = seedLog.filter((line) => line.toLowerCase().includes(EMAIL.admin.toLowerCase()));
    expect(leaked).toEqual([]);
  });

  it('nothing left the server: no fetch was attempted', () => {
    expect(outbound).toEqual([]);
  });
});
