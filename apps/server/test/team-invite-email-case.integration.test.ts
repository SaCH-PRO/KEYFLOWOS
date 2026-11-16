/**
 * V1-63 (SWP-TEAM-INVITE-SERVER), sweep BUG-016: team invites are one person
 * per address whatever the letter case, and the team list marks pending invites.
 *
 * The sweep (team-roles, recheck M58): the owner invites an address, invites it
 * again (400 'User is already a team member'), then invites it in UPPER CASE:
 * 201, a second member and a second `users` row under the upper-case address.
 * inviteTeamMember looked the address up with an exact, case-sensitive match
 * and stored it as typed, so the capitalised repeat was a new person, and a
 * mixed-case invite never met the lower-case address a sign-in carries: the
 * invitation could not be accepted.
 *
 * Pinned here, through the real HTTP routes on a real database:
 *   - POST .../team trims and lower-cases the address, and finds an existing
 *     holder (an account, or a placeholder an older invite stored in mixed case)
 *     case-insensitively: a repeat in any case is refused (400), no second user;
 *   - an address with no usable shape is refused (400) before anything is written;
 *   - the match is literal: '_' and '%' in an address are characters, not patterns;
 *   - GET .../team and GET .../team/dashboard carry `invitePending` (true for a
 *     member who has never signed in, the invite placeholder; false otherwise)
 *     and never the user's metadata;
 *   - a lower-case sign-in (POST /identity/bootstrap) claims a mixed-case invite,
 *     including a placeholder stored in mixed case before this fix, under the
 *     same ownership proof R0-SEC-01 requires (unproven: 409, nothing written).
 *
 * Review repairs (V1-63 review): an invite joins a holder of the address a person
 * can still reach, and only such a holder's membership makes it a repeat. A
 * placeholder an older invite left that no sign-in can adopt (beside an account,
 * or one of several case variants) neither blocks the invite (COR-63-1: the
 * account is added) nor receives it (COR-63-2: a placeholder under the lower-case
 * address is made, which the sign-in adopts). A placeholder named after its own
 * address keeps that rule on adoption: its name is derived again from the new
 * address, so GET .../task-assignments/options does not offer the member by the
 * address before the '@' (COR-63-3). Nothing is merged; the stale rows stay.
 *
 * Harness (as test/identity-local-auth.integration.test.ts, R0-SEC-01): the real
 * AuthMiddleware and AuthGuard, the real IdentityController and IdentityService on
 * the real PrismaService, the real BusinessGuard and ModuleScopeGuard, and for
 * GET .../task-assignments/options the real TaskAssignmentController and
 * TaskAssignmentService behind the real RateLimitGuard. Tokens are
 * HS256 on the test-only verifyLocal path (NODE_ENV=test, no Supabase URL), signed
 * with a secret built at run time. The only Supabase call bootstrap can make (the
 * service-role user lookup that proves an invitee owns its address) is a recording
 * stand-in, and global fetch is a tap that refuses every call; the suite asserts it
 * was never used.
 *
 * RESOURCES: fixture prefix v63d_ (registered in test/helpers/fixture-prefixes.json,
 * packet V1-63 (SWP-TEAM-INVITE-SERVER)). Every seeded id, sub and address carries
 * it (addresses in any letter case, so cleanup compares lower(email)). Rows the
 * routes create get generated ids: an invite placeholder is found by its prefixed
 * address or by its membership in the prefixed business, a bootstrap business by
 * its prefixed owner. Everything is hard-deleted by raw SQL through
 * sqlLikePrefix(P) before every case and after the suite.
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

const P = 'v63d_';

/** Test-only HS256 secret, assembled at run time (no secret-shaped literal). */
const SIGNING_SECRET = [P, 'team', 'invite', 'case', 'signing'].join('-');

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
  /** A signed-up account (no invite marker, a referral code from its bootstrap). */
  account: `${P}account`,
  /** A placeholder an invite stored in mixed case before this fix. */
  legacyPlaceholder: `${P}legacy_placeholder`,
  /** An account whose address differs from an invited one only where the invite has '_' or '%'. */
  wildAccount: `${P}wild_account`,
  /** Subs that sign in (bootstrap). */
  ivySub: `${P}ivy_sub`,
  leoSub: `${P}leo_sub`,
  zedSub: `${P}zed_sub`,
  /** V1-63 review COR-63-1: a placeholder an older invite left beside the account, in another letter case. */
  stalePlaceholder: `${P}stale_placeholder`,
  /** V1-63 review COR-63-2: two placeholders older invites left for one address, in two letter cases. */
  zedPlaceholderA: `${P}zed_ph_a`,
  zedPlaceholderB: `${P}zed_ph_b`,
  /** V1-63 review COR-63-2: two more businesses of the owner, where those older invites hang. */
  biz2: `${P}biz2`,
  biz3: `${P}biz3`,
};

const EMAIL = {
  owner: `${P}owner@test.local`,
  ivy: `${P}ivy@test.local`,
  account: `${P}account@test.local`,
  legacy: `${P}leo@test.local`,
  wildAccount: `${P}wildXcard@test.local`,
  zed: `${P}zed@test.local`,
};

/** 'v63d_Ivy@Test.Local': the same address as a person might type it. */
function mixedCase(email: string): string {
  const [local, domain] = email.split('@');
  const title = (s: string) => s.replace(/(^|[._])([a-z])/g, (_m, sep: string, c: string) => sep + c.toUpperCase());
  return `${title(local)}@${title(domain)}`;
}

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

function invite(email: unknown, role = 'STAFF') {
  const body: Record<string, unknown> = { role };
  if (email !== undefined) body.email = email;
  return request(app.getHttpServer())
    .post(`/identity/businesses/${ID.biz}/team`)
    .set('Authorization', `Bearer ${ownerToken()}`)
    .set('x-business-id', ID.biz)
    .send(body);
}

function teamList() {
  return request(app.getHttpServer())
    .get(`/identity/businesses/${ID.biz}/team`)
    .set('Authorization', `Bearer ${ownerToken()}`)
    .set('x-business-id', ID.biz);
}

function teamDashboard() {
  return request(app.getHttpServer())
    .get(`/identity/businesses/${ID.biz}/team/dashboard`)
    .set('Authorization', `Bearer ${ownerToken()}`)
    .set('x-business-id', ID.biz);
}

/** GET .../task-assignments/options: how co-members are offered a member (assigneeMemberLabel). */
function assigneeOptions() {
  return request(app.getHttpServer())
    .get(`/businesses/${ID.biz}/task-assignments/options`)
    .set('Authorization', `Bearer ${ownerToken()}`)
    .set('x-business-id', ID.biz);
}

function bootstrap(sub: string, email: string, body: Record<string, unknown> = {}) {
  return request(app.getHttpServer())
    .post('/identity/bootstrap')
    .set('Authorization', `Bearer ${token(sub, email)}`)
    .send(body);
}

/** Every users row holding an address, compared case-insensitively. */
async function holdersOf(email: string): Promise<Array<{ id: string; email: string; meta_data: unknown }>> {
  return db.$queryRawUnsafe('SELECT id, email, meta_data FROM users WHERE lower(email) = lower($1) ORDER BY id', email);
}

/** The memberships of the inviting business, with each member's stored address. */
async function members(): Promise<Array<{ user_id: string; role: string; email: string }>> {
  return db.$queryRawUnsafe(
    'SELECT m.user_id, m.role, u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.business_id = $1 ORDER BY m.role, u.email',
    ID.biz,
  );
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

/** A placeholder as inviteTeamMember wrote it before this fix: the address as typed, mixed case. */
async function seedLegacyPlaceholder(withMembership: boolean) {
  await db.user.create({
    data: {
      id: ID.legacyPlaceholder,
      email: mixedCase(EMAIL.legacy),
      name: 'leo',
      role: 'USER',
      metaData: { invitePlaceholder: true },
    },
  });
  if (withMembership) {
    await db.membership.create(
      skipTenantIsolation({ data: { userId: ID.legacyPlaceholder, businessId: ID.biz, role: 'STAFF' } }),
    );
  }
}

/**
 * A placeholder exactly as inviteTeamMember wrote it before V1-63 for an address typed `typed`:
 * the address as typed, the name derived from it (typed.split('@')[0]), the invite marker, and
 * a STAFF membership in each of `businessIds`.
 */
async function seedPreFixPlaceholder(id: string, typed: string, businessIds: string[]) {
  await db.user.create({
    data: { id, email: typed, name: typed.split('@')[0], role: 'USER', metaData: { invitePlaceholder: true } },
  });
  for (const businessId of businessIds) {
    await db.membership.create(skipTenantIsolation({ data: { userId: id, businessId, role: 'STAFF' } }));
  }
}

/** Another business of the owner (the owner's OWNER membership included). */
async function seedOwnerBusiness(id: string) {
  await db.business.create({ data: { id, name: `${P}${id.slice(P.length)} business`, ownerId: ID.owner } });
  await db.membership.create(skipTenantIsolation({ data: { userId: ID.owner, businessId: id, role: 'OWNER' } }));
}

/** The members of the inviting business as {user_id: role}, independent of collation order. */
async function memberRoles(): Promise<Record<string, string>> {
  return Object.fromEntries((await members()).map((m) => [m.user_id, m.role]));
}

beforeAll(async () => {
  for (const k of PINNED_KEYS) saved[k] = process.env[k];
  for (const k of PINNED_KEYS) delete process.env[k];
  // The test-only verifyLocal path: a configured secret, no Supabase URL, NODE_ENV=test.
  process.env.SUPABASE_JWT_SECRET = SIGNING_SECRET;

  globalThis.fetch = (async (input: unknown) => {
    outbound.push(String(input instanceof Request ? input.url : input));
    throw new Error('v63d: outbound fetch refused by the test');
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
  const { RateLimitGuard } = await import('../src/core/guards/rate-limit.guard');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { TaskAssignmentController } = await import('../src/modules/task-assignments/task-assignment.controller');
  const { TaskAssignmentService } = await import('../src/modules/task-assignments/task-assignment.service');
  const { TaskAssignmentRecommenderService } = await import('../src/modules/task-assignments/task-assignment-recommender.service');
  const { BusinessEventService } = await import('../src/modules/business-events/business-event.service');

  const client = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 2, lazyConnect: false });
  redis = client;

  // Collaborators the team and bootstrap routes never call: a call into one throws.
  const notOnThesePaths = {};

  const moduleRef = await Test.createTestingModule({
    // TaskAssignmentController: only GET .../task-assignments/options (review COR-63-3), which
    // shows how co-members see a member adopted at sign-in.
    controllers: [IdentityController, TaskAssignmentController],
    providers: [
      PrismaService,
      SupabaseAuthService,
      AuthMiddleware,
      AuthGuard,
      RateLimitGuard,
      { provide: REDIS_CLIENT, useValue: client },
      TaskAssignmentService,
      { provide: EventEmitter2, useValue: notOnThesePaths },
      { provide: BusinessEventService, useValue: notOnThesePaths },
      { provide: TaskAssignmentRecommenderService, useValue: notOnThesePaths },
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

  // TaskAssignmentController's constructor names its services by type only (no @Inject), which
  // vitest's esbuild transform gives Nest no metadata for (as in
  // projects-budget-assignee-scope.integration.test.ts): hand it the real service. Its guards
  // (AuthGuard, BusinessGuard, RateLimitGuard) are resolved by Nest as usual.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- private constructor fields
  const taskAssignments = moduleRef.get(TaskAssignmentController) as any;
  taskAssignments.service ??= moduleRef.get(TaskAssignmentService);

  app = moduleRef.createNestApplication();
  configureNestApp(app);
  const middleware = moduleRef.get(AuthMiddleware);
  app.use((req: never, res: never, next: () => void) => middleware.use(req, res, next));
  await app.init();

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

describe('BUG-016 — one invitation per person, whatever the letter case (V1-63 SWP-TEAM-INVITE-SERVER)', () => {
  it('the sweep repro: a repeat is refused (400) in the same case and in UPPER and Mixed case; one member, one user (RED: 201 and two)', async () => {
    const first = await invite(EMAIL.ivy);
    expect(first.status, JSON.stringify(first.body)).toBe(201);

    const sameCase = await invite(EMAIL.ivy);
    expect(sameCase.status, JSON.stringify(sameCase.body)).toBe(400);
    expect(sameCase.body.message).toBe('User is already a team member');

    for (const variant of [EMAIL.ivy.toUpperCase(), mixedCase(EMAIL.ivy), `  ${mixedCase(EMAIL.ivy)}  `]) {
      const repeat = await invite(variant);
      expect(repeat.status, `${variant}: ${JSON.stringify(repeat.body)}`).toBe(400);
      expect(repeat.body.message).toBe('User is already a team member');
    }

    expect(await holdersOf(EMAIL.ivy)).toEqual([expect.objectContaining({ id: first.body.userId, email: EMAIL.ivy })]);
    expect(await members()).toEqual([
      { user_id: ID.owner, role: 'OWNER', email: EMAIL.owner },
      { user_id: first.body.userId, role: 'STAFF', email: EMAIL.ivy },
    ]);
  });

  it('the address is stored trimmed and in lower case: an invite typed in Mixed case with spaces creates one placeholder under the lower-case address (RED: stored as typed)', async () => {
    const res = await invite(`  ${mixedCase(EMAIL.ivy)}  `);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.user.email).toBe(EMAIL.ivy);

    const stored = await db.$queryRawUnsafe('SELECT email, name, meta_data FROM users WHERE id = $1', res.body.userId);
    expect(stored).toEqual([{ email: EMAIL.ivy, name: EMAIL.ivy.split('@')[0], meta_data: { invitePlaceholder: true } }]);

    const activity = await db.$queryRawUnsafe(
      "SELECT title, meta FROM team_activity_logs WHERE business_id = $1 AND action = 'member_invited'",
      ID.biz,
    );
    expect(activity).toEqual([{ title: `Invited ${EMAIL.ivy} as STAFF`, meta: { invitedEmail: EMAIL.ivy, role: 'STAFF' } }]);
  });

  it('a capitalised invite of an existing account adds that account: no placeholder is created and it is not pending (RED: a second, unclaimable user)', async () => {
    await db.user.create({
      data: { id: ID.account, email: EMAIL.account, name: 'Ada', role: 'USER', referralCode: `${P}ACCOUNT`.toUpperCase() },
    });

    const res = await invite(EMAIL.account.toUpperCase());
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.userId).toBe(ID.account);

    expect(await holdersOf(EMAIL.account)).toEqual([expect.objectContaining({ id: ID.account, email: EMAIL.account })]);
    expect(await members()).toEqual([
      { user_id: ID.owner, role: 'OWNER', email: EMAIL.owner },
      { user_id: ID.account, role: 'STAFF', email: EMAIL.account },
    ]);

    const list = await teamList();
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.find((m: { userId: string }) => m.userId === ID.account)).toMatchObject({ invitePending: false });
  });

  it('a placeholder an older invite stored in Mixed case still blocks a repeat: its lower-case address is refused and no second user is created (RED: 201)', async () => {
    await seedLegacyPlaceholder(true);

    const res = await invite(EMAIL.legacy);
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.message).toBe('User is already a team member');

    expect((await holdersOf(EMAIL.legacy)).map((h) => h.id)).toEqual([ID.legacyPlaceholder]);
    expect(await members()).toEqual([
      { user_id: ID.owner, role: 'OWNER', email: EMAIL.owner },
      { user_id: ID.legacyPlaceholder, role: 'STAFF', email: mixedCase(EMAIL.legacy) },
    ]);
  });

  it.each([
    { label: "'_'", typed: `${P}wild_card@test.local` },
    { label: "'%'", typed: `${P}wild%card@test.local` },
  ])('the match is literal: inviting an address with $label never reaches an account whose address differs at that character', async ({ typed }) => {
    await db.user.create({ data: { id: ID.wildAccount, email: EMAIL.wildAccount, name: 'Wild', role: 'USER' } });

    const res = await invite(typed);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.userId).not.toBe(ID.wildAccount);
    expect(res.body.user.email).toBe(typed);
    expect(await footprint(ID.wildAccount)).toEqual({ users: 1, memberships: 0, businesses: 0 });
  });

  it('two invites of one address in different case at the same moment: one is created, the other refused; one member, one user (RED: two 201s)', async () => {
    for (const round of ['a', 'b', 'c']) {
      const email = `${P}race_${round}@test.local`;
      const answers = await Promise.all([invite(email), invite(email.toUpperCase())]);
      const statuses = answers.map((a) => a.status).sort();
      expect(statuses, JSON.stringify(answers.map((a) => a.body))).toEqual([201, 400]);
      const refused = answers.find((a) => a.status === 400)!;
      expect(refused.body.message).toBe('User is already a team member');
      expect(await holdersOf(email)).toHaveLength(1);
    }
    const staff = (await members()).filter((m) => m.role === 'STAFF');
    expect(staff.map((m) => m.email)).toEqual([`${P}race_a@test.local`, `${P}race_b@test.local`, `${P}race_c@test.local`]);
  });

  it.each([
    { label: 'no address', typed: undefined },
    { label: 'an empty address', typed: '' },
    { label: 'only spaces', typed: '   ' },
    { label: 'no @', typed: `${P}nobody.test.local` },
    { label: 'a space inside', typed: `${P}no body@test.local` },
    { label: 'not a string', typed: 42 },
  ])('an invite with $label is refused (400) and writes nothing (RED: stored as a user, or a 500)', async ({ typed }) => {
    const res = await invite(typed);
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(await members()).toEqual([{ user_id: ID.owner, role: 'OWNER', email: EMAIL.owner }]);
    const blank = await db.$queryRawUnsafe("SELECT count(*)::int AS n FROM users WHERE btrim(email) = '' OR email = $1", String(typed));
    expect(blank).toEqual([{ n: 0 }]);
  });
});

describe('BUG-016 — the team list marks pending invites (invitePending)', () => {
  it('GET .../team: a member who has never signed in is pending, the owner and an account are not; no user metadata is exposed (RED: no invitePending)', async () => {
    await db.user.create({ data: { id: ID.account, email: EMAIL.account, name: 'Ada', role: 'USER' } });
    expect((await invite(EMAIL.account)).status).toBe(201);
    const placeholder = await invite(EMAIL.ivy);
    expect(placeholder.status).toBe(201);

    const res = await teamList();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const byUser = Object.fromEntries(res.body.map((m: { userId: string; invitePending: unknown }) => [m.userId, m.invitePending]));
    expect(byUser).toEqual({ [ID.owner]: false, [ID.account]: false, [placeholder.body.userId]: true });
    for (const m of res.body) {
      expect(Object.keys(m.user).sort()).toEqual(['avatarUrl', 'email', 'firstName', 'id', 'lastName', 'name']);
    }
    expect(JSON.stringify(res.body)).not.toContain('invitePlaceholder');
  });

  it('GET .../team/dashboard (what the Team page reads) carries the same invitePending per member (RED: absent)', async () => {
    const placeholder = await invite(mixedCase(EMAIL.ivy));
    expect(placeholder.status).toBe(201);

    const res = await teamDashboard();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const byUser = Object.fromEntries(
      res.body.members.map((m: { userId: string; invitePending: unknown }) => [m.userId, m.invitePending]),
    );
    expect(byUser).toEqual({ [ID.owner]: false, [placeholder.body.userId]: true });
    expect(JSON.stringify(res.body)).not.toContain('invitePlaceholder');
  });
});

describe('V1-63 review repairs — an invite lands on a holder a person can still reach', () => {
  it('COR-63-1: an account beside a placeholder an older invite left in another letter case is invited (201), whatever that placeholder holds here; a repeat is then refused (RED: 400 "already a team member", the account never gets access)', async () => {
    await db.user.create({
      data: { id: ID.account, email: EMAIL.account, name: 'Ada', role: 'USER', referralCode: `${P}ACCOUNT`.toUpperCase() },
    });
    // Left by a capitalised invite of the account before V1-63. Bootstrap never adopts it: the
    // account's owner signs in as the account, and a new sign-in with the address meets the
    // account (409 account_email_in_use).
    await seedPreFixPlaceholder(ID.stalePlaceholder, mixedCase(EMAIL.account), [ID.biz]);

    const res = await invite(EMAIL.account);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.userId).toBe(ID.account);
    expect(await footprint(ID.account)).toEqual({ users: 1, memberships: 1, businesses: 0 });
    expect(await memberRoles()).toEqual({ [ID.owner]: 'OWNER', [ID.account]: 'STAFF', [ID.stalePlaceholder]: 'STAFF' });
    // Nothing is merged: the stale row stays, listed as the pending invitation it is, for the owner to remove.
    expect((await holdersOf(EMAIL.account)).map((h) => h.id).sort()).toEqual([ID.account, ID.stalePlaceholder].sort());

    const list = await teamList();
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const pending = Object.fromEntries(list.body.map((m: { userId: string; invitePending: unknown }) => [m.userId, m.invitePending]));
    expect(pending).toEqual({ [ID.owner]: false, [ID.account]: false, [ID.stalePlaceholder]: true });

    for (const variant of [EMAIL.account, mixedCase(EMAIL.account), EMAIL.account.toUpperCase()]) {
      const repeat = await invite(variant);
      expect(repeat.status, `${variant}: ${JSON.stringify(repeat.body)}`).toBe(400);
      expect(repeat.body.message).toBe('User is already a team member');
    }
    expect(await footprint(ID.account)).toEqual({ users: 1, memberships: 1, businesses: 0 });
  });

  it('COR-63-2: with two placeholders older invites left in two letter cases and no row under the lower-case address, the invite makes one under it; the confirmed sign-in claims it, then a repeat is refused (RED: the invite hangs on a case variant no sign-in can adopt)', async () => {
    await seedOwnerBusiness(ID.biz2);
    await seedOwnerBusiness(ID.biz3);
    const variantA = mixedCase(EMAIL.zed);
    const variantB = EMAIL.zed.toUpperCase();
    await seedPreFixPlaceholder(ID.zedPlaceholderA, variantA, [ID.biz2]);
    await seedPreFixPlaceholder(ID.zedPlaceholderB, variantB, [ID.biz3]);

    const inv = await invite(EMAIL.zed);
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    expect([ID.zedPlaceholderA, ID.zedPlaceholderB]).not.toContain(inv.body.userId);
    expect(inv.body.user.email).toBe(EMAIL.zed);
    const stored = await db.$queryRawUnsafe('SELECT email, meta_data FROM users WHERE id = $1', inv.body.userId);
    expect(stored).toEqual([{ email: EMAIL.zed, meta_data: { invitePlaceholder: true } }]);

    supabaseAdmin.records.set(ID.zedSub, confirmed(ID.zedSub, EMAIL.zed));
    const res = await bootstrap(ID.zedSub, EMAIL.zed, { company: `${P}zed co` });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.user).toMatchObject({ id: ID.zedSub, email: EMAIL.zed });
    expect(supabaseAdmin.lookups).toEqual([ID.zedSub]);

    expect(await memberRoles()).toEqual({ [ID.owner]: 'OWNER', [ID.zedSub]: 'STAFF' });
    expect(await footprint(ID.zedSub)).toEqual({ users: 1, memberships: 2, businesses: 1 });
    // The two older rows are left as they were (no merge).
    expect(await footprint(ID.zedPlaceholderA)).toEqual({ users: 1, memberships: 1, businesses: 0 });
    expect(await footprint(ID.zedPlaceholderB)).toEqual({ users: 1, memberships: 1, businesses: 0 });

    const list = await teamList();
    expect(list.body.find((m: { userId: string }) => m.userId === ID.zedSub)).toMatchObject({ invitePending: false });

    const repeat = await invite(variantA);
    expect(repeat.status, JSON.stringify(repeat.body)).toBe(400);
    expect(repeat.body.message).toBe('User is already a team member');
  });

  it('guard for COR-63-2: a single placeholder an older invite left in another letter case still receives the invite, and the lower-case sign-in claims its memberships here and elsewhere', async () => {
    await seedOwnerBusiness(ID.biz2);
    await seedPreFixPlaceholder(ID.zedPlaceholderA, mixedCase(EMAIL.zed), [ID.biz2]);

    const inv = await invite(EMAIL.zed);
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    expect(inv.body.userId).toBe(ID.zedPlaceholderA);
    expect((await holdersOf(EMAIL.zed)).map((h) => h.id)).toEqual([ID.zedPlaceholderA]);

    supabaseAdmin.records.set(ID.zedSub, confirmed(ID.zedSub, EMAIL.zed));
    const res = await bootstrap(ID.zedSub, EMAIL.zed, { company: `${P}zed co` });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await memberRoles()).toEqual({ [ID.owner]: 'OWNER', [ID.zedSub]: 'STAFF' });
    // STAFF here and in biz2, and its own new business.
    expect(await footprint(ID.zedSub)).toEqual({ users: 1, memberships: 3, businesses: 1 });
    expect(await footprint(ID.zedPlaceholderA)).toEqual({ users: 0, memberships: 0, businesses: 0 });
  });

  it('COR-63-3: a pre-fix placeholder named after its own address (the old letter case) is adopted under the name derived from the new address, so co-members are not shown the email local part (RED: kept "V63d_Leo", offered by it)', async () => {
    await seedPreFixPlaceholder(ID.legacyPlaceholder, mixedCase(EMAIL.legacy), [ID.biz]);
    supabaseAdmin.records.set(ID.leoSub, confirmed(ID.leoSub, EMAIL.legacy));

    const res = await bootstrap(ID.leoSub, EMAIL.legacy, { company: `${P}leo co` });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const rows = await db.$queryRawUnsafe('SELECT id, name, email FROM users WHERE id = $1', ID.leoSub);
    expect(rows).toEqual([{ id: ID.leoSub, name: EMAIL.legacy.split('@')[0], email: EMAIL.legacy }]);

    const options = await assigneeOptions();
    expect(options.status, JSON.stringify(options.body)).toBe(200);
    expect(options.body.find((o: { id: string }) => o.id === ID.leoSub)).toEqual({
      type: 'User',
      id: ID.leoSub,
      name: `Unnamed member (…${ID.leoSub.slice(-4)})`,
    });
    // No option is named by the address before the '@', in either letter case.
    const names = options.body.map((o: { name: string }) => o.name.toLowerCase());
    expect(names).not.toContain(EMAIL.legacy.split('@')[0]);
  });

  it('COR-63-3 guard: a name the placeholder did not derive from its own address is kept on adoption', async () => {
    // seedLegacyPlaceholder names the row 'leo', which is not its address's local part.
    await seedLegacyPlaceholder(true);
    supabaseAdmin.records.set(ID.leoSub, confirmed(ID.leoSub, EMAIL.legacy));

    const res = await bootstrap(ID.leoSub, EMAIL.legacy, { company: `${P}leo co` });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const rows = await db.$queryRawUnsafe('SELECT name FROM users WHERE id = $1', ID.leoSub);
    expect(rows).toEqual([{ name: 'leo' }]);
  });
});

describe('BUG-016 — a lower-case sign-in claims a mixed-case invite (R0-SEC-01 proof unchanged)', () => {
  it('an invite typed in Mixed case is claimed by the lower-case sign-in: the STAFF membership moves to the sub, one user, no longer pending (RED: a second user; the invite stays pending)', async () => {
    const inv = await invite(mixedCase(EMAIL.ivy));
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    supabaseAdmin.records.set(ID.ivySub, confirmed(ID.ivySub, EMAIL.ivy));

    const res = await bootstrap(ID.ivySub, EMAIL.ivy, { company: `${P}ivy co` });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.user).toMatchObject({ id: ID.ivySub, email: EMAIL.ivy });

    expect(await holdersOf(EMAIL.ivy)).toEqual([expect.objectContaining({ id: ID.ivySub })]);
    expect(await members()).toEqual([
      { user_id: ID.owner, role: 'OWNER', email: EMAIL.owner },
      { user_id: ID.ivySub, role: 'STAFF', email: EMAIL.ivy },
    ]);
    expect(await footprint(ID.ivySub)).toEqual({ users: 1, memberships: 2, businesses: 1 });
    expect(supabaseAdmin.lookups).toEqual([ID.ivySub]);

    const list = await teamList();
    expect(list.body.find((m: { userId: string }) => m.userId === ID.ivySub)).toMatchObject({ invitePending: false });
  });

  it('a placeholder stored in Mixed case before this fix is claimed by the lower-case sign-in, with proof (RED: 201 with a fresh account; the old invite stays unclaimed)', async () => {
    await seedLegacyPlaceholder(true);
    supabaseAdmin.records.set(ID.leoSub, confirmed(ID.leoSub, EMAIL.legacy));

    const res = await bootstrap(ID.leoSub, EMAIL.legacy, { company: `${P}leo co` });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.user).toMatchObject({ id: ID.leoSub, email: EMAIL.legacy });

    expect(await holdersOf(EMAIL.legacy)).toEqual([expect.objectContaining({ id: ID.leoSub, email: EMAIL.legacy })]);
    expect(await footprint(ID.legacyPlaceholder)).toEqual({ users: 0, memberships: 0, businesses: 0 });
    expect(await members()).toEqual([
      { user_id: ID.owner, role: 'OWNER', email: EMAIL.owner },
      { user_id: ID.leoSub, role: 'STAFF', email: EMAIL.legacy },
    ]);
    expect(supabaseAdmin.lookups).toEqual([ID.leoSub]);
  });

  it.each([
    { label: 'verification is off on this deployment', setup: () => setVerification(false) },
    { label: 'Supabase has not confirmed the address', setup: () => supabaseAdmin.records.set(ID.leoSub, { id: ID.leoSub, email: EMAIL.legacy, email_confirmed_at: null }) },
  ])('negative control: when $label, the case-insensitive claim of a pending invite answers 409 invite_email_unverified and writes nothing (RED: 201, a fresh account)', async ({ setup }) => {
    await seedLegacyPlaceholder(true);
    setup();

    const res = await bootstrap(ID.leoSub, EMAIL.legacy, { company: `${P}mallory co` });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe('invite_email_unverified');

    expect(await footprint(ID.leoSub)).toEqual({ users: 0, memberships: 0, businesses: 0 });
    expect((await holdersOf(EMAIL.legacy)).map((h) => h.id)).toEqual([ID.legacyPlaceholder]);
    expect(await members()).toEqual([
      { user_id: ID.owner, role: 'OWNER', email: EMAIL.owner },
      { user_id: ID.legacyPlaceholder, role: 'STAFF', email: mixedCase(EMAIL.legacy) },
    ]);
  });

  it('nothing left the server: no fetch was attempted', () => {
    expect(outbound).toEqual([]);
  });
});
