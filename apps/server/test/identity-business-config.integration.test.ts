/**
 * R0-09-ID-HARDEN — business profile writes are OWNER only (owner ruling D-11),
 * onboardingComplete leaves the generic PATCH, and SUPER_ADMIN promotion on
 * boot is gated on SUPER_ADMIN_EMAIL. REAL database.
 *
 * RED-BEFORE (the R0 working branch at 8dd45935, which carries R0-ID-F1..F4):
 *   - PATCH /identity/businesses/:businessId had only AuthGuard and
 *     BusinessGuard, so any member — a STAFF with settings:none included —
 *     rewrote the tenant's name, slug, currency, timezone, tax rate and store
 *     settings (identity.controller.ts updateBusiness, BUILD-MAP M04, CF-28,
 *     identity-boundary ST-3).
 *   - The generic PATCH wrote onboardingComplete (identity.service.ts
 *     updateBusiness), bypassing the onboarding concierge's completion gate
 *     (CF-22).
 *   - SeedService.seedSuperAdmin looked up a hard-coded email on every
 *     onApplicationBootstrap and promoted it to SUPER_ADMIN, a role every guard
 *     bypasses (seed.service.ts).
 *
 * OWNER RULING D-11 (2026-10-31): editing the business profile is OWNER only,
 * regardless of granted scopes. It replaces the queue entry's settings:write
 * wording, so an explicit settings:write grant is refused here too. SUPER_ADMIN
 * keeps the platform bypass the existing guard (BusinessGuard) already grants;
 * that is pinned below, not widened.
 *
 * HOW THE APP IS COMPOSED (the contacts-visibility model): a real Nest app with
 * the real IdentityController, IdentityService, PrismaService, AuthGuard and
 * BusinessGuard against the database at DATABASE_URL. The one stand-in on the
 * authorization path is identity attachment: a test middleware reads
 * `x-test-user`, loads that seeded User row and attaches `{ id, email, role }`
 * exactly as AuthMiddleware does after token verification. Collaborators the
 * PATCH and GET routes never authorize with are stubs; BlueprintService is a
 * recorder (its mirror is best-effort and would otherwise write blueprint rows
 * asynchronously after the response).
 *
 * The production global ValidationPipe (whitelist: true) needs the parameter
 * types tsc emits, which vitest's esbuild transform does not, so an in-process
 * body is NOT whitelisted here. The onboardingComplete cases therefore prove
 * two layers separately: the HTTP cases send the field straight to the service
 * (which must ignore it), and one case runs the production pipe over
 * UpdateBusinessDto directly (which must strip it). The spawned-server proof of
 * the same rule is in identity-boundary.integration.test.ts (ST-3 block).
 *
 * The SeedService cases run the real promotion against the real User table.
 * The packet's own isolated database is the only place they may run (every
 * spawned server runs the seed on boot against the database it is given).
 *
 * FIXTURES: every row has the `k09a_` prefix (registered in
 * test/helpers/fixture-prefixes.json) and is hard-deleted with
 * LIKE ${sqlLikePrefix(P)} in beforeAll and afterAll. No $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'k09a_';
const ID = {
  owner: `${P}owner`,             // OWNER of bizA (ownerId + OWNER membership); also OWNER of bizDone
  staff: `${P}staff`,             // STAFF of bizA, role-default scopes (settings: none)
  staffW: `${P}staffW`,           // STAFF of bizA, explicit { settings: write }
  admin: `${P}admin`,             // ADMIN of bizA, role-default scopes (settings: admin)
  adminW: `${P}adminW`,           // ADMIN of bizA, ADMIN defaults with settings: write
  nonMember: `${P}nonMember`,     // no membership anywhere
  ownerB: `${P}ownerB`,           // OWNER of bizB only
  legacyOwner: `${P}legacyOwner`, // Business.ownerId of bizC, no membership row (founding-membership backfill window)
  superAdmin: `${P}superAdmin`,   // User.role SUPER_ADMIN, no membership
  promoteMe: `${P}promoteMe`,     // USER; the configured SUPER_ADMIN_EMAIL in S02
  bystander: `${P}bystander`,     // USER; never configured
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  bizC: `${P}bizC`,
  bizDone: `${P}bizDone`,         // onboarding completed through the concierge path
};
const USERS = [
  ID.owner, ID.staff, ID.staffW, ID.admin, ID.adminW, ID.nonMember, ID.ownerB, ID.legacyOwner, ID.superAdmin,
  ID.promoteMe, ID.bystander,
];
const emailOf = (id: string) => `${id}@k09a.test.local`;
const COMPLETED_AT = new Date('2026-10-01T12:00:00.000Z');
/** A configured SUPER_ADMIN_EMAIL that no User row has. */
const NOBODY_EMAIL = `${P}nobody@k09a.test.local`;

/** What a non-owner tries to write. */
const HIJACK = { name: `${P}hijacked-name`, currency: 'XXX', timezone: 'Pacific/Kiritimati', defaultTaxRate: 99, storeEnabled: false };

let db: any;
let app: any;
let prismaService: any;
let SeedServiceClass: any;
let ValidationPipeClass: any;
let UpdateBusinessDtoClass: any;
let identityService: any;
let SECRET_FIELDS: readonly string[] = [];
const blueprintCalls: Array<{ businessId: string; answers: Record<string, unknown> }> = [];

async function cleanup() {
  for (const sql of [
    `DELETE FROM business_blueprints WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)} OR owner_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort: cascades cover most of these */ }
  }
}

/** The Business row exactly as Postgres stores it, so "unchanged" means byte-identical. */
async function businessRowText(id: string): Promise<string> {
  const rows = await db.$queryRawUnsafe('SELECT row_to_json(b)::text AS j FROM businesses b WHERE b.id = $1', id);
  expect(rows.length, `business ${id} exists`).toBe(1);
  return rows[0].j as string;
}

function patch(actor: string | null, businessId: string, body: Record<string, unknown>) {
  const req = request(app.getHttpServer()).patch(`/identity/businesses/${businessId}`).send(body);
  return actor ? req.set('x-test-user', actor) : req;
}

function get(actor: string, businessId: string) {
  return request(app.getHttpServer()).get(`/identity/businesses/${businessId}`).set('x-test-user', actor);
}

/** A refused profile write: the status, no Business fields in the body, and the row byte-identical. */
async function expectRefused(actor: string | null, businessId: string, status: number, label: string) {
  const before = await businessRowText(businessId);
  const res = await patch(actor, businessId, { ...HIJACK, slug: `${P}hijacked-slug` });
  expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(status);
  for (const key of ['name', 'slug', 'currency', 'timezone', 'ownerId', 'defaultTaxRate']) expect(res.body).not.toHaveProperty(key);
  expect(await businessRowText(businessId), `${label}: the Business row is byte-identical`).toBe(before);
}

/** A SeedService over a recorder of the real client: which User model methods it calls. */
function recordingSeed() {
  const userCalls: string[] = [];
  const client = new Proxy(db, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop !== 'user') return value;
      return new Proxy(value, {
        get(t, method, r) {
          const fn = Reflect.get(t, method, r);
          if (typeof fn !== 'function') return fn;
          return (...args: unknown[]) => {
            userCalls.push(String(method));
            return fn.apply(t, args);
          };
        },
      });
    },
  });
  const seed = new SeedServiceClass({ client }, {}, {});
  return { seed, userCalls };
}

async function roles(): Promise<Record<string, string>> {
  const rows = await db.user.findMany({ where: { id: { in: USERS } }, select: { id: true, role: true } });
  return Object.fromEntries(rows.map((r: { id: string; role: string }) => [r.id, r.role]));
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const common = await import('@nestjs/common');
  ValidationPipeClass = common.ValidationPipe;
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { OptionalAuthGuard } = await import('../src/core/auth/optional-auth.guard');
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
  ({ UpdateBusinessDto: UpdateBusinessDtoClass } = await import('../src/modules/identity/dto/update-business.dto'));
  ({ SeedService: SeedServiceClass } = await import('../src/core/seed/seed.service'));

  const moduleRef = await Test.createTestingModule({
    controllers: [IdentityController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      OptionalAuthGuard,
      IdentityService,
      {
        provide: BlueprintService,
        useValue: {
          inferFromOnboarding: async (businessId: string, answers: Record<string, unknown>) => {
            blueprintCalls.push({ businessId, answers });
            return null;
          },
        },
      },
      { provide: DefaultTriggersService, useValue: {} },
      // Not on the PATCH or GET business path.
      { provide: IdentitySignupService, useValue: {} },
      { provide: BusinessContextService, useValue: {} },
      { provide: AiUsageService, useValue: {} },
      { provide: AuthSecurityService, useValue: {} },
      { provide: IdentityPasswordService, useValue: {} },
      { provide: SupabaseAdminService, useValue: {} },
      { provide: REDIS_CLIENT, useValue: {} },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  // Identity attachment only, as AuthMiddleware attaches it from the User row.
  // No guard is overridden.
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  await app.init();
  prismaService = moduleRef.get(PrismaService);
  identityService = moduleRef.get(IdentityService);
  ({ BUSINESS_SECRET_FIELDS: SECRET_FIELDS } = await import('../src/core/security/sanitize-business'));

  await cleanup(); // in case a prior run aborted

  for (const id of USERS) {
    await db.user.create({ data: { id, email: emailOf(id), name: id, role: id === ID.superAdmin ? 'SUPER_ADMIN' : 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: `${P}bizA-name`, ownerId: ID.owner, currency: 'TTD', timezone: 'America/Port_of_Spain', defaultTaxRate: 0 } });
  await db.business.create({ data: { id: ID.bizB, name: `${P}bizB-name`, ownerId: ID.ownerB } });
  await db.business.create({ data: { id: ID.bizC, name: `${P}bizC-name`, ownerId: ID.legacyOwner } });
  await db.business.create({
    data: { id: ID.bizDone, name: `${P}bizDone-name`, ownerId: ID.owner, onboardingComplete: true, onboardingCompletedAt: COMPLETED_AT },
  });
  const { ROLE_DEFAULT_SCOPES } = await import('../src/core/authority/module-vocabulary');
  const memberships: Array<{ userId: string; businessId: string; role: string; permissionScopes?: Record<string, string> }> = [
    { userId: ID.owner, businessId: ID.bizA, role: 'OWNER' },
    { userId: ID.staff, businessId: ID.bizA, role: 'STAFF' },
    { userId: ID.staffW, businessId: ID.bizA, role: 'STAFF', permissionScopes: { settings: 'write' } },
    { userId: ID.admin, businessId: ID.bizA, role: 'ADMIN' },
    { userId: ID.adminW, businessId: ID.bizA, role: 'ADMIN', permissionScopes: { ...ROLE_DEFAULT_SCOPES.ADMIN, settings: 'write' } },
    { userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' },
    { userId: ID.owner, businessId: ID.bizDone, role: 'OWNER' },
  ];
  for (const m of memberships) {
    await db.membership.create({ data: { id: `${P}m_${m.userId.slice(P.length)}_${m.businessId.slice(P.length)}`, ...m } });
  }
}, 60_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
}, 60_000);

describe('R0-09 fixture sanity (real rows)', () => {
  it('[R0-09-X01] seeded four tenants, eleven users and seven memberships; bizC has no membership and the super admin none', async () => {
    expect(await db.business.count({ where: { id: { startsWith: P } } })).toBe(4);
    expect(await db.user.count({ where: { id: { startsWith: P } } })).toBe(11);
    expect(await db.membership.count({ where: { id: { startsWith: P } } })).toBe(7);
    expect(await db.membership.count({ where: { businessId: ID.bizC } })).toBe(0);
    expect(await db.membership.count({ where: { userId: ID.superAdmin } })).toBe(0);
    expect(prismaService.client).toBe(db);
  });
});

describe('R0-09 PATCH /identity/businesses/:businessId is OWNER only (D-11)', () => {
  it('[R0-09-P01] RED-BEFORE: a STAFF member with role-default scopes (settings:none) is refused (403) and the Business row is byte-identical', async () => {
    await expectRefused(ID.staff, ID.bizA, 403, 'STAFF, settings:none');
  });

  it('[R0-09-P02] a STAFF member granted settings:write is refused (403): the profile is owner-only, not scope-gated', async () => {
    await expectRefused(ID.staffW, ID.bizA, 403, 'STAFF, settings:write');
  });

  it('[R0-09-P03] an ADMIN with role-default scopes (settings:admin) is refused (403), row byte-identical', async () => {
    await expectRefused(ID.admin, ID.bizA, 403, 'ADMIN, settings:admin');
  });

  it('[R0-09-P04] an ADMIN granted settings:write is refused (403), row byte-identical', async () => {
    await expectRefused(ID.adminW, ID.bizA, 403, 'ADMIN, settings:write');
  });

  it('[R0-09-P05] a non-member is refused (403), row byte-identical', async () => {
    await expectRefused(ID.nonMember, ID.bizA, 403, 'non-member');
  });

  it("[R0-09-P06] the OWNER of B on A's path is refused (403), A's row byte-identical", async () => {
    await expectRefused(ID.ownerB, ID.bizA, 403, "owner of B on A's path");
  });

  it('[R0-09-P07] an unauthenticated request is refused (401), row byte-identical', async () => {
    await expectRefused(null, ID.bizA, 401, 'no identity');
  });

  it('[R0-09-P08] positive control: the OWNER changes currency and timezone (200), and GET reflects them', async () => {
    const res = await patch(ID.owner, ID.bizA, { currency: 'USD', timezone: 'America/New_York' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const read = await get(ID.owner, ID.bizA);
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(read.body).toMatchObject({ id: ID.bizA, currency: 'USD', timezone: 'America/New_York', name: `${P}bizA-name` });
    // The members who were refused above still read the same values.
    const staffRead = await get(ID.staff, ID.bizA);
    expect(staffRead.status).toBe(200);
    expect(staffRead.body).toMatchObject({ currency: 'USD', timezone: 'America/New_York' });
  });

  it("[R0-09-P09] positive control: the OWNER of B edits B on B's path (200), so the cross-tenant denial is not vacuous", async () => {
    const res = await patch(ID.ownerB, ID.bizB, { timezone: 'Europe/London' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await db.business.findUnique({ where: { id: ID.bizB } })).timezone).toBe('Europe/London');
  });

  it("[R0-09-P10] owner ruling D-104 (W10-OWNER-MEMBERSHIP; was pinned: edits its own business): the distinguished owner (Business.ownerId) with no membership row is refused by BusinessGuard (403 'No access to this business'), the timezone unchanged", async () => {
    const before = (await db.business.findUnique({ where: { id: ID.bizC } })).timezone;
    const res = await patch(ID.legacyOwner, ID.bizC, { timezone: 'Asia/Tokyo' });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body).toMatchObject({ statusCode: 403, message: 'No access to this business' });
    expect((await db.business.findUnique({ where: { id: ID.bizC } })).timezone).toBe(before);
    expect(before).not.toBe('Asia/Tokyo');
  });

  it('[R0-09-P11] pinned: a SUPER_ADMIN with no membership keeps the platform bypass BusinessGuard already grants (200)', async () => {
    const res = await patch(ID.superAdmin, ID.bizC, { timezone: 'Africa/Lagos' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await db.business.findUnique({ where: { id: ID.bizC } })).timezone).toBe('Africa/Lagos');
  });
});

/**
 * R0-09 review R09-ST-1: updateBusiness returned the raw Prisma row, so the
 * OWNER's (and a SUPER_ADMIN's) PATCH response carried every Business OAuth
 * access and refresh token in plaintext, and so did the KEY settings adapter's
 * connector result (it returns IdentityService.updateBusiness as is). GET
 * already redacts them through sanitizeBusiness.
 */
describe('R0-09 the profile write never returns Business OAuth credentials (review R09-ST-1)', () => {
  const SECRET = `${P}secret-oauth-token`;
  const isCredentialKey = (k: string) => /(Access|Refresh)Token$/.test(k);

  /** Every redacted column holds a recognisable secret, so a leak cannot hide behind a null. */
  async function plantSecrets(businessId: string) {
    expect(SECRET_FIELDS.length, 'the redaction list is not empty').toBeGreaterThan(0);
    await db.business.update({
      where: { id: businessId },
      data: Object.fromEntries(SECRET_FIELDS.map((f) => [f, `${SECRET}-${f}`])),
    });
    const row = await db.business.findUnique({ where: { id: businessId } });
    for (const f of SECRET_FIELDS) expect(row[f], `${f} is planted`).toBe(`${SECRET}-${f}`);
  }

  function expectNoCredentials(body: Record<string, unknown>, label: string) {
    for (const f of SECRET_FIELDS) expect(body, `${label}: ${f}`).not.toHaveProperty(f);
    expect(Object.keys(body).filter(isCredentialKey), `${label}: access/refresh token keys`).toEqual([]);
    expect(JSON.stringify(body), `${label}: no planted secret anywhere in the body`).not.toContain(SECRET);
  }

  it('[R0-09-P12] RED-BEFORE: the OWNER\'s PATCH answers 200 with no access or refresh token in the body, and the same keys GET returns', async () => {
    await plantSecrets(ID.bizA);
    const res = await patch(ID.owner, ID.bizA, { tagline: `${P}tagline` });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ id: ID.bizA, tagline: `${P}tagline` });
    expectNoCredentials(res.body, 'OWNER PATCH');

    const read = await get(ID.owner, ID.bizA);
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expectNoCredentials(read.body, 'OWNER GET');
    expect(Object.keys(res.body).sort(), 'PATCH and GET expose the same Business keys').toEqual(Object.keys(read.body).sort());

    // The write did not touch the stored credentials: redaction is on the way out only.
    const row = await db.business.findUnique({ where: { id: ID.bizA } });
    for (const f of SECRET_FIELDS) expect(row[f], `${f} still stored`).toBe(`${SECRET}-${f}`);
  });

  it('[R0-09-P13] RED-BEFORE: the SUPER_ADMIN bypass PATCH and the service result the KEY settings adapter returns carry no access or refresh token', async () => {
    await plantSecrets(ID.bizC);
    const res = await patch(ID.superAdmin, ID.bizC, { timezone: 'Asia/Dubai' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expectNoCredentials(res.body, 'SUPER_ADMIN PATCH');

    // settings-adapter.service.ts update_business_profile / update_branding return this value as the connector result.
    const result = await identityService.updateBusiness(ID.bizC, { timezone: 'Asia/Kolkata', primaryColor: '#123456' });
    expect(result).toMatchObject({ id: ID.bizC, timezone: 'Asia/Kolkata', primaryColor: '#123456' });
    expectNoCredentials(result, 'IdentityService.updateBusiness result');
  });
});

describe('R0-09 onboardingComplete is not writable through the generic PATCH', () => {
  it('[R0-09-O01] RED-BEFORE: the OWNER sending onboardingComplete:true gets 200, the other fields apply and the flag stays false', async () => {
    const res = await patch(ID.owner, ID.bizA, { onboardingComplete: true, defaultTaxRate: 12.5 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = await db.business.findUnique({ where: { id: ID.bizA } });
    expect(row.defaultTaxRate).toBe(12.5);
    expect(row.onboardingComplete).toBe(false);
    expect(row.onboardingCompletedAt).toBeNull();
  });

  it('[R0-09-O02] RED-BEFORE: onboardingComplete:false does not un-complete a business either; the completion time is kept', async () => {
    const res = await patch(ID.owner, ID.bizDone, { onboardingComplete: false, timezone: 'Europe/Paris' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = await db.business.findUnique({ where: { id: ID.bizDone } });
    expect(row.timezone).toBe('Europe/Paris');
    expect(row.onboardingComplete).toBe(true);
    expect(row.onboardingCompletedAt?.toISOString()).toBe(COMPLETED_AT.toISOString());
  });

  it('[R0-09-O03] RED-BEFORE: the production body pipe (whitelist) strips onboardingComplete from UpdateBusinessDto and keeps the profile fields', async () => {
    const pipe = new ValidationPipeClass({ whitelist: true, transform: true });
    const out = await pipe.transform(
      { onboardingComplete: true, currency: 'USD', timezone: 'UTC' },
      { type: 'body', metatype: UpdateBusinessDtoClass, data: undefined },
    );
    expect(out).toBeInstanceOf(UpdateBusinessDtoClass);
    expect(out).not.toHaveProperty('onboardingComplete');
    expect({ ...out }).toEqual({ currency: 'USD', timezone: 'UTC' });
  });
});

describe('R0-09 SUPER_ADMIN promotion on boot is gated on SUPER_ADMIN_EMAIL', () => {
  it('[R0-09-S01] RED-BEFORE: with SUPER_ADMIN_EMAIL unset the seed reads and writes no User row, and every user keeps its role', async () => {
    const before = await roles();
    const { seed, userCalls } = recordingSeed();
    await seed.seedSuperAdmin({});
    await seed.seedSuperAdmin({ SUPER_ADMIN_EMAIL: '   ' });
    expect(userCalls, 'User model calls with the variable unset or blank').toEqual([]);
    expect(await roles()).toEqual(before);
  });

  it('[R0-09-S02] RED-BEFORE: with SUPER_ADMIN_EMAIL set, exactly that user is promoted; a second boot writes nothing', async () => {
    const { seed, userCalls } = recordingSeed();
    await seed.seedSuperAdmin({ SUPER_ADMIN_EMAIL: emailOf(ID.promoteMe) });
    const after = await roles();
    expect(after[ID.promoteMe]).toBe('SUPER_ADMIN');
    for (const id of USERS.filter((u) => u !== ID.promoteMe && u !== ID.superAdmin)) expect(after[id], id).toBe('USER');
    expect(userCalls.filter((m) => m !== 'findUnique' && m !== 'findFirst')).toEqual(['update']);

    const again = recordingSeed();
    await again.seed.seedSuperAdmin({ SUPER_ADMIN_EMAIL: emailOf(ID.promoteMe) });
    expect(again.userCalls.filter((m) => m !== 'findUnique' && m !== 'findFirst'), 'already promoted: no write').toEqual([]);
  });

  it('[R0-09-S03] with SUPER_ADMIN_EMAIL naming no user, the seed creates nobody and writes nothing', async () => {
    const usersBefore = await db.user.count({ where: { id: { startsWith: P } } });
    const { seed, userCalls } = recordingSeed();
    await seed.seedSuperAdmin({ SUPER_ADMIN_EMAIL: NOBODY_EMAIL });
    expect(userCalls.filter((m) => m !== 'findUnique' && m !== 'findFirst')).toEqual([]);
    expect(await db.user.count({ where: { id: { startsWith: P } } })).toBe(usersBefore);
    expect(await db.user.findUnique({ where: { email: NOBODY_EMAIL } })).toBeNull();
  });
});
