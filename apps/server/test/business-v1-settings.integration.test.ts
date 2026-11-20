/**
 * V1-63 BIZ-SETTINGS-SERVER — the per-business v1 settings: what the business
 * sells (services, products or both), the Advanced CRM switch, and the depth
 * of each hub (owner ruling D-150 'hubs': seven hubs shaped by what you sell;
 * depth lives inside hubs and is stored on the business, never in the
 * browser). REAL database.
 *
 * WHERE THEY LIVE: three keys in Business.metaData (no migration): sells
 * ('services' | 'products' | 'both'), advancedCrm (boolean) and depth (hub ->
 * 'standard' | 'advanced', for the hubs today, customers, sales, schedule,
 * money, page and settings). They are written only through the owner-only
 * profile PATCH (PATCH /identity/businesses/:businessId, owner ruling D-11:
 * a STAFF or ADMIN is refused whatever scopes it holds, settings:write
 * included), in the transaction that holds the business row lock (the
 * statement lockBusinessMeta runs, core/prisma/business-meta.ts), and every
 * member reads them from GET /identity/businesses/:businessId as top-level
 * sells, advancedCrm and depth. A key that is absent (every business that
 * existed before this packet) reads as sells 'both', advancedCrm false and
 * every hub 'standard', so an existing business keeps every v1 hub.
 *
 * RED-BEFORE (int/v1-base e3e33ee1): UpdateBusinessDto has no sells,
 * advancedCrm or depth, so the production body pipe (whitelist: true) strips
 * them: the owner's PATCH {sells:'services'} answers 200 and stores nothing,
 * an unknown value is never refused, and GET answers none of the three. The
 * metaData bag the PATCH merges stores any value under those keys
 * (metaData.sells 'retail' included).
 *
 * GREEN-AFTER: the owner writes and reads back each key (a partial depth
 * merges per hub); an unknown value is refused 400 with nothing written,
 * through the field and through the metaData bag alike, and by the service
 * itself (the path an in-process caller such as the KEY settings adapter
 * takes); a STAFF or ADMIN with settings:write is refused 403 with the row
 * byte-identical; a concurrent metaData writer and a co-owner's PATCH in
 * flight do not lose a setting.
 *
 * HOW THE APP IS COMPOSED (the R0-09 model, test/identity-business-config):
 * a real Nest app with the real IdentityController, IdentityService,
 * PrismaService, AuthGuard and BusinessGuard against the database at
 * DATABASE_URL. The one stand-in on the authorization path is identity
 * attachment: a test middleware reads `x-test-user`, loads that seeded User
 * row and attaches `{ id, email, role }` as AuthMiddleware does after token
 * verification. Collaborators the PATCH and GET paths never authorize with
 * are stubs (BlueprintService a no-op recorder).
 *
 * THE BODY PIPE: production runs one global ValidationPipe({ whitelist: true,
 * transform: true }) whose metatype for @Body() comes from the parameter
 * types tsc emits; vitest's esbuild transform emits none, so this app
 * reflects the types tsc emits for the PATCH handlers (design:paramtypes:
 * UpdateBusinessDto for the profile PATCH's body, see THE BODY PIPE FOR THE
 * DOOR below) and installs the production pipe. The current-user decorator
 * passes through untouched (a custom decorator). The pipe over
 * UpdateBusinessDto is also run directly ([V63E-D01], [V63E-D02]), as
 * R0-09-O03 does.
 *
 * REVIEW REPAIR SEC-V63-1 ([V63E-S01..S04]): a depth names each hub at most
 * once, so the refusal of a depth that is not one is bounded whatever the
 * body holds: more entries than there are hubs is one problem naming the
 * count, and a refused entry's name comes back cut short. Before the repair
 * every entry was a problem repeating its name, and the body pipe answers
 * before the controller's D-11 check, so any member could ask for a refusal
 * many times the size of its body.
 *
 * BIZ-SETTINGS-ADMIN-DOOR ([V63E-A04], [V63E-AD01..AD09]; owner ruling
 * D-150 'hubs' adopts the product-audit Settings hub text: the Advanced CRM
 * switch and the other advanced depth choices are a server-side business
 * setting that only the owner or an admin can change). advancedCrm and depth
 * get a second door, PATCH /identity/businesses/:businessId/advanced-settings
 * (IdentityService.updateAdvancedSettings), open to the owner (an OWNER
 * membership, the D-11 owner rule) or a member whose role is ADMIN and whose
 * settings level is admin (the ADMIN preset, or an explicit map granting it);
 * a SUPER_ADMIN keeps the platform bypass. A STAFF member (whatever its
 * scopes, settings admin included) and an ADMIN whose map grants settings
 * write only are refused 403 before the body is read, with the row
 * byte-identical. What the business sells stays owner-only (D-11 lists 'what
 * you sell' in the business profile): the door takes advancedCrm and depth
 * only, and refuses sells, any other key, an empty body and a value V1-63
 * refuses with 400 BUSINESS_SETTING_INVALID, bounded as SEC-V63-1 bounds it.
 * The door writes under lockBusinessMeta (a depth merges per hub, as the
 * profile PATCH merges it) and, in the same transaction, one
 * team_activity_logs row naming the actor, its standing and each named
 * setting before and after. The profile PATCH is unchanged: the owner sets
 * all three there, everyone else is refused (D-11); GET answers all three to
 * every member. [V63E-A01] is re-pinned by [V63E-A04]: the ADMIN refused on
 * the profile PATCH is admitted on the door for advancedCrm and depth and
 * refused sells on both.
 *
 * RED-BEFORE for the door (pkt/V1-BIZ-SETTINGS-ADMIN-DOOR at 172afb2f): no
 * route PATCH .../advanced-settings exists (404 for every actor) and
 * IdentityService has no updateAdvancedSettings, so an ADMIN with settings
 * admin can change neither setting anywhere: the profile PATCH refuses it
 * 403 ([V63E-A01]).
 *
 * THE BODY PIPE FOR THE DOOR: the door declares its body
 * Record<string, unknown>, for which tsc emits Object, and the global
 * ValidationPipe validates no Object body: the service receives the body as
 * sent and refuses a key it does not take (a DTO class would let the
 * whitelist pipe drop sells silently). This app reflects the parameter types
 * tsc emits for the two PATCH handlers (UpdateBusinessDto for the profile
 * PATCH, Object for the door) and installs the production pipe itself.
 *
 * NO PROVIDER IS CALLED: nothing on these paths reaches one.
 *
 * FIXTURES: every user, business and membership id has the `v63e_` prefix
 * (registered in test/helpers/fixture-prefixes.json for V1-63
 * BIZ-SETTINGS-SERVER; BIZ-SETTINGS-ADMIN-DOOR extends this suite under the
 * same prefix), every User.email contains it, and every row is hard-deleted
 * with LIKE ${sqlLikePrefix(P)} in beforeAll and afterAll, the door's
 * team_activity_logs rows (business_id or user_id under the prefix)
 * included. No $transaction wraps a fixture; the transactions in [V63E-C01]
 * and [V63E-AD09] are the simulated concurrent writers.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v63e_';
const ID = {
  owner: `${P}owner`,         // OWNER membership (and Business.ownerId) of bizA and bizFresh
  coOwner: `${P}coOwner`,     // a second OWNER membership on bizA
  staff: `${P}staff`,         // STAFF of bizA, role defaults (settings: none)
  staffW: `${P}staffW`,       // STAFF of bizA, granted settings: write
  staffA: `${P}staffA`,       // STAFF of bizA, granted settings: admin (BIZ-SETTINGS-ADMIN-DOOR: a STAFF, not an ADMIN)
  admin: `${P}admin`,         // ADMIN of bizA, role defaults (settings: admin)
  adminW: `${P}adminW`,       // ADMIN of bizA, ADMIN defaults with settings: write
  nonMember: `${P}nonMember`, // no membership anywhere
  ownerB: `${P}ownerB`,       // OWNER of bizB only
  bizA: `${P}bizA`,           // the business under test
  bizFresh: `${P}bizFresh`,   // never written by a test: the defaults
  bizB: `${P}bizB`,           // another tenant
};
const USERS = [ID.owner, ID.coOwner, ID.staff, ID.staffW, ID.staffA, ID.admin, ID.adminW, ID.nonMember, ID.ownerB];
/** A platform SUPER_ADMIN the service is called for directly ([V63E-AD08]); no User row, no membership. */
const PLATFORM = `${P}platform`;
const emailOf = (id: string) => `${id}@v63e.test.local`;

/** The seven v1 hubs (D-150, D-151), in the order GET answers them. */
const HUBS = ['today', 'customers', 'sales', 'schedule', 'money', 'page', 'settings'] as const;
const ALL_STANDARD = Object.fromEntries(HUBS.map((h) => [h, 'standard']));
const DEFAULTS = { sells: 'both', advancedCrm: false, depth: ALL_STANDARD };

/** bizA's other metaData keys: a settings write leaves each as it was. */
const OTHER_META = { bankName: `${P}Republic`, paymentMethods: ['cash', 'bank_transfer'], cashEnabled: true };

/** The code the PATCH answers a settings value it does not know with (field or metaData bag). */
const SETTING_INVALID = 'BUSINESS_SETTING_INVALID';

/** BIZ-SETTINGS-ADMIN-DOOR: the code the owner-or-admin door refuses a member it does not admit with. */
const DOOR_FORBIDDEN = 'BUSINESS_ADVANCED_SETTINGS_FORBIDDEN';
/** BIZ-SETTINGS-ADMIN-DOOR: the team_activity_logs action of a write through the door. */
const DOOR_AUDIT_ACTION = 'advanced_settings_changed';

let db: any;
let app: any;
let identityService: any;
let lockBusinessMeta: (tx: any, businessId: string) => Promise<{ metaData: unknown } | null>;
let ValidationPipeClass: any;
let UpdateBusinessDtoClass: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM team_activity_logs WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
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

async function storedMeta(id: string): Promise<Record<string, any>> {
  const row = await db.business.findUnique({ where: { id }, select: { metaData: true } });
  return (row?.metaData ?? {}) as Record<string, any>;
}

/** Put bizA back: the profile columns the tests touch and its metaData. */
async function resetBizA(meta: Record<string, unknown> = OTHER_META) {
  await db.business.update({
    where: { id: ID.bizA },
    data: { name: `${P}bizA-name`, tagline: null, currency: 'TTD', timezone: 'America/Port_of_Spain', metaData: meta },
  });
}

function patch(actor: string | null, businessId: string, body: Record<string, unknown>) {
  const req = request(app.getHttpServer()).patch(`/identity/businesses/${businessId}`).send(body);
  return actor ? req.set('x-test-user', actor) : req;
}

function get(actor: string, businessId: string) {
  return request(app.getHttpServer()).get(`/identity/businesses/${businessId}`).set('x-test-user', actor);
}

/** BIZ-SETTINGS-ADMIN-DOOR: PATCH /identity/businesses/:businessId/advanced-settings (the owner-or-admin door). */
function door(actor: string | null, businessId: string, body: unknown) {
  const req = request(app.getHttpServer()).patch(`/identity/businesses/${businessId}/advanced-settings`).send(body as any);
  return actor ? req.set('x-test-user', actor) : req;
}

/** The door's audit rows on a business, oldest first. */
async function doorAuditRows(businessId: string): Promise<any[]> {
  return db.teamActivityLog.findMany({ where: { businessId, action: DOOR_AUDIT_ACTION }, orderBy: { createdAt: 'asc' } });
}

/** The three settings a Business read answers. */
function settingsOf(body: Record<string, unknown>) {
  return { sells: body.sells, advancedCrm: body.advancedCrm, depth: body.depth };
}

/** The production body pipe over UpdateBusinessDto. */
function runPipe(body: unknown) {
  const pipe = new ValidationPipeClass({ whitelist: true, transform: true });
  return pipe.transform(body, { type: 'body', metatype: UpdateBusinessDtoClass, data: undefined });
}

/**
 * Hold bizA's row as a concurrent metaData writer would: lockBusinessMeta on
 * its own transaction, then `write` (under the lock), then wait for commit()
 * (the payment-secrets SEC2c-C0x harness, with the real helper).
 */
async function holdBusinessRow(businessId: string, write?: (tx: any, meta: Record<string, unknown>) => Promise<unknown>) {
  let release!: () => void;
  const released = new Promise<void>((r) => { release = r; });
  let ready!: (pid: number) => void;
  const held = new Promise<number>((r) => { ready = r; });
  const done = db.$transaction(async (tx: any) => {
    const rows = await tx.$queryRawUnsafe('SELECT pg_backend_pid() AS pid');
    const business = await lockBusinessMeta(tx, businessId);
    if (write) await write(tx, (business?.metaData as Record<string, unknown> | null) ?? {});
    ready(Number(rows[0].pid));
    await released;
  }, { maxWait: 10_000, timeout: 30_000 });
  const pid = await Promise.race([held, done.then(() => { throw new Error('the holding transaction ended before it held the row'); })]);
  return { pid, commit: async () => { release(); await done; } };
}

/** Wait until `n` backends wait on the row `hold` holds (directly, or queued behind such a waiter). */
async function waitForBusinessLockWaiters(hold: { pid: number }, n: number) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const rows = await db.$queryRawUnsafe(
      `WITH RECURSIVE behind(pid) AS (
         SELECT a.pid FROM pg_stat_activity a WHERE $1::int = ANY(pg_blocking_pids(a.pid))
         UNION
         SELECT a.pid FROM pg_stat_activity a JOIN behind b ON b.pid = ANY(pg_blocking_pids(a.pid))
       )
       SELECT count(*)::int AS n FROM behind`,
      hold.pid,
    );
    const seen = Number(rows[0]?.n ?? 0);
    if (seen >= n) return;
    if (Date.now() > deadline) throw new Error(`expected ${n} statement(s) waiting on the held business row, saw ${seen}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const common = await import('@nestjs/common');
  ValidationPipeClass = common.ValidationPipe;
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  ({ lockBusinessMeta } = await import('../src/core/prisma/business-meta'));
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

  const moduleRef = await Test.createTestingModule({
    controllers: [IdentityController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      OptionalAuthGuard,
      IdentityService,
      { provide: BlueprintService, useValue: { inferFromOnboarding: async () => null } },
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
  // The parameter types tsc emits for the two PATCH handlers (vitest emits none; see the header): the
  // profile PATCH's body is UpdateBusinessDto, the door's is Record<string, unknown> (Object), and
  // AuthenticatedUser is an interface (Object). Then the production pipe itself.
  Reflect.defineMetadata('design:paramtypes', [String, UpdateBusinessDtoClass, Object], IdentityController.prototype, 'updateBusiness');
  Reflect.defineMetadata('design:paramtypes', [String, Object, Object], IdentityController.prototype, 'updateAdvancedSettings');
  app.useGlobalPipes(new ValidationPipeClass({ whitelist: true, transform: true }));
  // Identity attachment only, as AuthMiddleware attaches it from the User row. No guard is overridden.
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
  identityService = moduleRef.get(IdentityService);

  await cleanup(); // in case a prior run aborted

  for (const id of USERS) {
    await db.user.create({ data: { id, email: emailOf(id), name: id, role: 'USER' } });
  }
  await db.business.create({
    data: { id: ID.bizA, name: `${P}bizA-name`, ownerId: ID.owner, currency: 'TTD', timezone: 'America/Port_of_Spain', metaData: OTHER_META },
  });
  await db.business.create({ data: { id: ID.bizFresh, name: `${P}bizFresh-name`, ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizB, name: `${P}bizB-name`, ownerId: ID.ownerB } });
  const { ROLE_DEFAULT_SCOPES } = await import('../src/core/authority/module-vocabulary');
  const memberships: Array<{ userId: string; businessId: string; role: string; permissionScopes?: Record<string, string> }> = [
    { userId: ID.owner, businessId: ID.bizA, role: 'OWNER' },
    { userId: ID.coOwner, businessId: ID.bizA, role: 'OWNER' },
    { userId: ID.staff, businessId: ID.bizA, role: 'STAFF' },
    { userId: ID.staffW, businessId: ID.bizA, role: 'STAFF', permissionScopes: { settings: 'write' } },
    { userId: ID.staffA, businessId: ID.bizA, role: 'STAFF', permissionScopes: { settings: 'admin' } },
    { userId: ID.admin, businessId: ID.bizA, role: 'ADMIN' },
    { userId: ID.adminW, businessId: ID.bizA, role: 'ADMIN', permissionScopes: { ...ROLE_DEFAULT_SCOPES.ADMIN, settings: 'write' } },
    { userId: ID.owner, businessId: ID.bizFresh, role: 'OWNER' },
    { userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' },
  ];
  for (const m of memberships) {
    await db.membership.create({ data: { id: `${P}m_${m.userId.slice(P.length)}_${m.businessId.slice(P.length)}`, ...m } });
  }
}, 60_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
}, 60_000);

describe('V1-63 fixture sanity (real rows)', () => {
  it('[V63E-X01] seeded three tenants, nine users and nine memberships; no business stores a v1 setting', async () => {
    expect(await db.business.count({ where: { id: { startsWith: P } } })).toBe(3);
    expect(await db.user.count({ where: { id: { startsWith: P } } })).toBe(9);
    expect(await db.membership.count({ where: { id: { startsWith: P } } })).toBe(9);
    for (const id of [ID.bizA, ID.bizFresh, ID.bizB]) {
      const meta = await storedMeta(id);
      for (const key of ['sells', 'advancedCrm', 'depth']) expect(meta, `${id} metaData.${key}`).not.toHaveProperty(key);
    }
  });
});

describe('V1-63 the production body pipe keeps sells, advancedCrm and depth, and refuses an unknown value', () => {
  it('[V63E-D01] RED-BEFORE: the pipe (whitelist: true) over UpdateBusinessDto keeps the three settings beside a profile field', async () => {
    const body = { sells: 'services', advancedCrm: true, depth: { money: 'advanced', customers: 'standard' }, currency: 'USD' };
    const out = await runPipe(body);
    expect(out).toBeInstanceOf(UpdateBusinessDtoClass);
    expect({ ...out }).toEqual(body);
    for (const sells of ['services', 'products', 'both']) expect({ ...(await runPipe({ sells })) }).toEqual({ sells });
    for (const advancedCrm of [true, false]) expect({ ...(await runPipe({ advancedCrm })) }).toEqual({ advancedCrm });
    const everyHub = Object.fromEntries(HUBS.map((h, i) => [h, i % 2 === 0 ? 'advanced' : 'standard']));
    expect({ ...(await runPipe({ depth: everyHub })) }).toEqual({ depth: everyHub });
    expect({ ...(await runPipe({ depth: {} })) }, 'an empty depth changes no hub').toEqual({ depth: {} });
  });

  it('[V63E-D02] RED-BEFORE: the pipe refuses (400) each unknown value, naming the field', async () => {
    const refused: Array<[string, Record<string, unknown>]> = [
      ['sells', { sells: 'retail' }],
      ['sells', { sells: 'SERVICES' }],
      ['sells', { sells: '' }],
      ['sells', { sells: null }],
      ['sells', { sells: ['services'] }],
      ['advancedCrm', { advancedCrm: 'true' }],
      ['advancedCrm', { advancedCrm: 1 }],
      ['advancedCrm', { advancedCrm: null }],
      ['depth', { depth: { crm: 'advanced' } }],
      ['depth', { depth: { money: 'expert' } }],
      ['depth', { depth: { money: null } }],
      ['depth', { depth: { money: true } }],
      ['depth', { depth: 'advanced' }],
      ['depth', { depth: ['money'] }],
      ['depth', { depth: null }],
    ];
    for (const [field, body] of refused) {
      let error: any;
      try { await runPipe(body); } catch (e) { error = e; }
      expect(error, `${JSON.stringify(body)} is refused`).toBeDefined();
      expect(error.getStatus?.(), JSON.stringify(body)).toBe(400);
      expect(JSON.stringify(error.getResponse?.()), `${JSON.stringify(body)}: the refusal names ${field}`).toContain(field);
    }
  });
});

describe('V1-63 GET /identity/businesses/:businessId answers the three settings; an absent key is the default', () => {
  it('[V63E-G01] RED-BEFORE: a business that stores no setting reads sells both, advancedCrm false and every hub standard, to the owner and to a STAFF member, and the read writes nothing', async () => {
    const before = await businessRowText(ID.bizFresh);
    const read = await get(ID.owner, ID.bizFresh);
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(settingsOf(read.body)).toEqual(DEFAULTS);
    expect(Object.keys(read.body.depth), 'depth answers the seven hubs in order').toEqual([...HUBS]);
    expect(await businessRowText(ID.bizFresh), 'the read wrote nothing').toBe(before);

    await resetBizA();
    const staffRead = await get(ID.staff, ID.bizA);
    expect(staffRead.status, JSON.stringify(staffRead.body)).toBe(200);
    expect(settingsOf(staffRead.body)).toEqual(DEFAULTS);
  });

  it('[V63E-G02] RED-BEFORE: a stored value that is not a setting reads as that key\'s default (a valid hub entry beside it still counts)', async () => {
    await resetBizA({ ...OTHER_META, sells: 'retail', advancedCrm: 'yes', depth: { money: 'expert', crm: 'advanced', sales: 'advanced' } });
    try {
      const read = await get(ID.owner, ID.bizA);
      expect(read.status, JSON.stringify(read.body)).toBe(200);
      expect(settingsOf(read.body)).toEqual({ sells: 'both', advancedCrm: false, depth: { ...ALL_STANDARD, sales: 'advanced' } });

      await resetBizA({ depth: 'advanced', sells: 'products' });
      const stringDepth = await get(ID.owner, ID.bizA);
      expect(stringDepth.status, JSON.stringify(stringDepth.body)).toBe(200);
      expect(settingsOf(stringDepth.body)).toEqual({ sells: 'products', advancedCrm: false, depth: ALL_STANDARD });
    } finally {
      await resetBizA();
    }
  });
});

describe('V1-63 the OWNER writes and reads back each setting through PATCH /identity/businesses/:businessId', () => {
  it('[V63E-W01] RED-BEFORE: sells services, then products, then both: each stored in metaData.sells and read back by the owner and a STAFF member; the other metaData keys and profile columns are untouched', async () => {
    await resetBizA();
    for (const sells of ['services', 'products', 'both']) {
      const res = await patch(ID.owner, ID.bizA, { sells });
      expect(res.status, `${sells}: ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body.sells, `${sells}: the PATCH response`).toBe(sells);
      const meta = await storedMeta(ID.bizA);
      expect(meta.sells, `${sells}: stored`).toBe(sells);
      for (const [k, v] of Object.entries(OTHER_META)) expect(meta[k], `${sells}: metaData.${k} kept`).toEqual(v);
      expect(meta, `${sells}: no other setting written`).not.toHaveProperty('advancedCrm');
      expect(meta).not.toHaveProperty('depth');
      for (const actor of [ID.owner, ID.staff]) {
        const read = await get(actor, ID.bizA);
        expect(read.status).toBe(200);
        expect(settingsOf(read.body), `${sells}: read by ${actor}`).toEqual({ ...DEFAULTS, sells });
      }
    }
    const row = await db.business.findUnique({ where: { id: ID.bizA } });
    expect({ name: row.name, currency: row.currency, timezone: row.timezone }).toEqual({ name: `${P}bizA-name`, currency: 'TTD', timezone: 'America/Port_of_Spain' });
  });

  it('[V63E-W02] RED-BEFORE: advancedCrm true, then false: stored as a boolean and read back', async () => {
    await resetBizA();
    for (const advancedCrm of [true, false]) {
      const res = await patch(ID.owner, ID.bizA, { advancedCrm });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.advancedCrm).toBe(advancedCrm);
      expect((await storedMeta(ID.bizA)).advancedCrm).toBe(advancedCrm);
      const read = await get(ID.staff, ID.bizA);
      expect(settingsOf(read.body)).toEqual({ ...DEFAULTS, advancedCrm });
    }
  });

  it('[V63E-W03] RED-BEFORE: depth writes merge per hub (a hub not named keeps its stored depth) and GET answers every hub', async () => {
    await resetBizA();
    const steps: Array<[Record<string, string>, Record<string, string>]> = [
      [{ money: 'advanced' }, { money: 'advanced' }],
      [{ customers: 'advanced', sales: 'advanced' }, { money: 'advanced', customers: 'advanced', sales: 'advanced' }],
      [{ sales: 'standard' }, { money: 'advanced', customers: 'advanced', sales: 'standard' }],
      [{}, { money: 'advanced', customers: 'advanced', sales: 'standard' }],
    ];
    for (const [write, stored] of steps) {
      const res = await patch(ID.owner, ID.bizA, { depth: write });
      expect(res.status, `${JSON.stringify(write)}: ${JSON.stringify(res.body)}`).toBe(200);
      expect((await storedMeta(ID.bizA)).depth, `${JSON.stringify(write)}: stored`).toEqual(stored);
      const read = await get(ID.owner, ID.bizA);
      expect(read.body.depth, `${JSON.stringify(write)}: read`).toEqual({ ...ALL_STANDARD, ...stored });
      expect(res.body.depth, `${JSON.stringify(write)}: the PATCH response`).toEqual(read.body.depth);
    }
  });

  it('[V63E-W04] RED-BEFORE: all three settings and a profile field in one PATCH: each applied, and the PATCH response answers the same settings and Business keys as GET', async () => {
    await resetBizA();
    const res = await patch(ID.owner, ID.bizA, { sells: 'products', advancedCrm: true, depth: { schedule: 'advanced' }, tagline: `${P}tagline` });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const expected = { sells: 'products', advancedCrm: true, depth: { ...ALL_STANDARD, schedule: 'advanced' } };
    expect(settingsOf(res.body)).toEqual(expected);
    expect(res.body.tagline).toBe(`${P}tagline`);
    const read = await get(ID.owner, ID.bizA);
    expect(settingsOf(read.body)).toEqual(expected);
    expect(Object.keys(res.body).sort(), 'PATCH and GET answer the same Business keys').toEqual(Object.keys(read.body).sort());
    const meta = await storedMeta(ID.bizA);
    expect({ sells: meta.sells, advancedCrm: meta.advancedCrm, depth: meta.depth }).toEqual({ sells: 'products', advancedCrm: true, depth: { schedule: 'advanced' } });
  });
});

describe('V1-63 an unknown value is refused with 400 and nothing is written', () => {
  it('[V63E-V01] RED-BEFORE: over HTTP, each unknown value is refused 400 and the Business row is byte-identical (a profile field beside it is not written either)', async () => {
    await resetBizA();
    await patch(ID.owner, ID.bizA, { sells: 'services', advancedCrm: true, depth: { money: 'advanced' } });
    for (const body of [
      { sells: 'retail' },
      { sells: null },
      { advancedCrm: 'yes' },
      { depth: { crm: 'advanced' } },
      { depth: { money: 'expert' } },
      { depth: 'advanced' },
      { tagline: `${P}not-written`, sells: 'wholesale' },
    ]) {
      const before = await businessRowText(ID.bizA);
      const res = await patch(ID.owner, ID.bizA, body);
      expect(res.status, `${JSON.stringify(body)}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(await businessRowText(ID.bizA), `${JSON.stringify(body)}: the row is byte-identical`).toBe(before);
    }
    const meta = await storedMeta(ID.bizA);
    expect({ sells: meta.sells, advancedCrm: meta.advancedCrm, depth: meta.depth }).toEqual({ sells: 'services', advancedCrm: true, depth: { money: 'advanced' } });
  });

  it(`[V63E-V02] RED-BEFORE: the metaData bag cannot store an unknown value under a settings key: 400 ${SETTING_INVALID}, the row byte-identical`, async () => {
    await resetBizA();
    for (const metaData of [
      { sells: 'retail' },
      { sells: null },
      { advancedCrm: 'yes' },
      { advancedCrm: null },
      { depth: { money: 'expert' } },
      { depth: { crm: 'advanced' } },
      { depth: 'advanced' },
      { depth: null },
      { bankName: `${P}not-written`, sells: 'wholesale' },
    ]) {
      const before = await businessRowText(ID.bizA);
      const res = await patch(ID.owner, ID.bizA, { metaData });
      expect(res.status, `${JSON.stringify(metaData)}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.code, JSON.stringify(res.body)).toBe(SETTING_INVALID);
      expect(await businessRowText(ID.bizA), `${JSON.stringify(metaData)}: the row is byte-identical`).toBe(before);
    }
  });

  it('[V63E-V03] RED-BEFORE: a valid value in the metaData bag writes the same setting (a bag depth merges per hub, as the field does), and the field wins over the bag', async () => {
    await resetBizA();
    expect((await patch(ID.owner, ID.bizA, { depth: { money: 'advanced' } })).status).toBe(200);
    const res = await patch(ID.owner, ID.bizA, { metaData: { sells: 'products', advancedCrm: true, depth: { customers: 'advanced' } } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    let meta = await storedMeta(ID.bizA);
    expect({ sells: meta.sells, advancedCrm: meta.advancedCrm, depth: meta.depth }).toEqual({ sells: 'products', advancedCrm: true, depth: { money: 'advanced', customers: 'advanced' } });
    for (const [k, v] of Object.entries(OTHER_META)) expect(meta[k], `metaData.${k} kept`).toEqual(v);

    const both = await patch(ID.owner, ID.bizA, { sells: 'services', depth: { money: 'standard' }, metaData: { sells: 'products', depth: { money: 'advanced', sales: 'advanced' } } });
    expect(both.status, JSON.stringify(both.body)).toBe(200);
    meta = await storedMeta(ID.bizA);
    expect(meta.sells, 'the field wins').toBe('services');
    expect(meta.depth, 'per hub: the field wins on money, the bag adds sales').toEqual({ money: 'standard', customers: 'advanced', sales: 'advanced' });
    expect(settingsOf((await get(ID.owner, ID.bizA)).body)).toEqual({ sells: 'services', advancedCrm: true, depth: { ...ALL_STANDARD, money: 'standard', customers: 'advanced', sales: 'advanced' } });

    // A client that echoes a read's metaData back (comprehensive-cards.tsx spreads it) rewrites the same valid values.
    const echoed = await patch(ID.owner, ID.bizA, { metaData: { ...(await storedMeta(ID.bizA)), paymentMethods: ['cash'] } });
    expect(echoed.status, JSON.stringify(echoed.body)).toBe(200);
    meta = await storedMeta(ID.bizA);
    expect({ sells: meta.sells, advancedCrm: meta.advancedCrm, depth: meta.depth, paymentMethods: meta.paymentMethods })
      .toEqual({ sells: 'services', advancedCrm: true, depth: { money: 'standard', customers: 'advanced', sales: 'advanced' }, paymentMethods: ['cash'] });
  });

  it(`[V63E-V04] RED-BEFORE: the service itself refuses an unknown value (${SETTING_INVALID}) with nothing written, without the HTTP pipe (the path an in-process caller such as the KEY settings adapter takes)`, async () => {
    await resetBizA();
    for (const input of [{ sells: 'retail' }, { advancedCrm: 'yes' }, { depth: { money: 'expert' } }, { depth: [] }, { name: `${P}not-written`, sells: null }]) {
      const before = await businessRowText(ID.bizA);
      let error: any;
      try { await identityService.updateBusiness(ID.bizA, input); } catch (e) { error = e; }
      expect(error, `${JSON.stringify(input)} is refused`).toBeDefined();
      expect(error.getStatus?.(), JSON.stringify(input)).toBe(400);
      expect(error.getResponse?.().code, JSON.stringify(input)).toBe(SETTING_INVALID);
      expect(await businessRowText(ID.bizA), `${JSON.stringify(input)}: the row is byte-identical`).toBe(before);
    }
    const result = await identityService.updateBusiness(ID.bizA, { sells: 'services', advancedCrm: false, depth: { page: 'advanced' } });
    expect(settingsOf(result)).toEqual({ sells: 'services', advancedCrm: false, depth: { ...ALL_STANDARD, page: 'advanced' } });
  });
});

/**
 * Review SEC-V63-1: a depth names each hub at most once, so the refusal of a
 * depth that is not one is bounded whatever the body holds. Before the repair
 * the pipe (and the service, for the metaData bag) built one problem per entry,
 * each repeating the entry's name, so a 50 KB body of junk entries was answered
 * with a refusal many times its size, and the body pipe answers it before the
 * controller's D-11 check (assertBusinessOwner), so any member could ask for
 * it. After: a depth with more entries than there are hubs is refused with one
 * problem that names the count, and a refused entry's name is cut short.
 */
describe('V1-63 the refusal of a depth that is not one is bounded (review SEC-V63-1)', () => {
  /** A depth of `n` entries, none a hub: k0 .. k(n-1), each 1 (about 50 KB for 5,000). */
  const junkDepth = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, 1]));
  const JUNK = 5_000;
  /** Seven entries (no more than there are hubs), none a hub, each name 9,000 characters long (about 63 KB). */
  const LONG = 'x'.repeat(9_000);
  const longKeyDepth = () => Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`${LONG}${i}`, 'advanced']));
  /** The most a refusal of a depth may weigh, whatever the body held. */
  const MAX_REFUSAL_BYTES = 4_096;
  /** A stretch no refusal may repeat: no entry's name comes back whole. */
  const ECHO = 'x'.repeat(64);

  async function pipeRefusal(body: unknown): Promise<{ status: number | undefined; response: any; bytes: number }> {
    let error: any;
    try { await runPipe(body); } catch (e) { error = e; }
    expect(error, 'the pipe refuses').toBeDefined();
    const response = error.getResponse?.();
    return { status: error.getStatus?.(), response, bytes: Buffer.byteLength(JSON.stringify(response)) };
  }

  it('[V63E-S01] RED-BEFORE: the body pipe refuses a depth of more entries than there are hubs with one problem naming the count, none of the entries; seven long names come back cut short', async () => {
    const many = await pipeRefusal({ depth: junkDepth(JUNK) });
    expect(many.status).toBe(400);
    expect(many.bytes, `the refusal of ${JUNK} entries weighs ${many.bytes} bytes`).toBeLessThanOrEqual(MAX_REFUSAL_BYTES);
    const messages: string[] = many.response.message;
    expect(messages, 'one message').toHaveLength(1);
    expect(messages[0]).toContain('depth');
    expect(messages[0], 'it names the count').toContain(String(JUNK));
    expect(JSON.stringify(many.response), 'no entry is named').not.toMatch(/\bk\d+\b/);

    // Eight entries (the seven hubs and one more) are one more than a depth can name.
    const everyHub = Object.fromEntries(HUBS.map((h) => [h, 'advanced']));
    const eight = await pipeRefusal({ depth: { ...everyHub, v63eExtra: 'advanced' } });
    expect(eight.status).toBe(400);
    expect(eight.response.message).toHaveLength(1);
    expect(eight.response.message[0]).toContain('depth');

    const long = await pipeRefusal({ depth: longKeyDepth() });
    expect(long.status).toBe(400);
    expect(long.bytes, `the refusal of seven long names weighs ${long.bytes} bytes`).toBeLessThanOrEqual(MAX_REFUSAL_BYTES);
    expect(JSON.stringify(long.response), 'no name comes back whole').not.toContain(ECHO);
    expect(JSON.stringify(long.response)).toContain('depth');

    // The seven hubs, every one named, are still a depth (the bound is the hub count).
    expect({ ...(await runPipe({ depth: everyHub })) }).toEqual({ depth: everyHub });
  });

  it(`[V63E-S02] RED-BEFORE: over HTTP the owner's depth of ${JUNK} junk entries, as the field and in the metaData bag, and seven long names are refused 400 with a bounded body and nothing written`, async () => {
    await resetBizA();
    for (const [label, body] of [
      ['field, many entries', { depth: junkDepth(JUNK) }],
      ['metaData bag, many entries', { metaData: { depth: junkDepth(JUNK) } }],
      ['field, long names', { depth: longKeyDepth() }],
      ['metaData bag, long names', { metaData: { depth: longKeyDepth() } }],
    ] as const) {
      const before = await businessRowText(ID.bizA);
      const res = await patch(ID.owner, ID.bizA, body);
      const bytes = Buffer.byteLength(res.text ?? '');
      expect(res.status, `${label}: ${res.text?.slice(0, 300)}`).toBe(400);
      expect(bytes, `${label}: the refusal weighs ${bytes} bytes`).toBeLessThanOrEqual(MAX_REFUSAL_BYTES);
      expect(res.text, `${label}: no entry is named`).not.toMatch(/\bk\d+\b/);
      expect(res.text, `${label}: no name comes back whole`).not.toContain(ECHO);
      if ('metaData' in body) {
        expect(res.body.code, label).toBe(SETTING_INVALID);
        expect(res.body.problems, `${label}: one problem`).toHaveLength(label.endsWith('many entries') ? 1 : 7);
      }
      expect(await businessRowText(ID.bizA), `${label}: the row is byte-identical`).toBe(before);
    }
  });

  it('[V63E-S03] RED-BEFORE: the service itself (no pipe) answers one problem for a depth of more entries than there are hubs, field and metaData bag alike', async () => {
    await resetBizA();
    for (const input of [{ depth: junkDepth(JUNK) }, { metaData: { depth: junkDepth(JUNK) } }]) {
      const before = await businessRowText(ID.bizA);
      let error: any;
      try { await identityService.updateBusiness(ID.bizA, input); } catch (e) { error = e; }
      expect(error, 'refused').toBeDefined();
      expect(error.getStatus?.()).toBe(400);
      const response = error.getResponse?.();
      expect(response.code).toBe(SETTING_INVALID);
      expect(response.problems, 'one problem').toHaveLength(1);
      expect(Buffer.byteLength(JSON.stringify(response))).toBeLessThanOrEqual(MAX_REFUSAL_BYTES);
      expect(await businessRowText(ID.bizA), 'the row is byte-identical').toBe(before);
    }
  });

  it('[V63E-S04] RED-BEFORE: a member who is not the owner (STAFF with settings none, ADMIN with settings admin) sending the same depth is refused with a bounded body that names no entry, and nothing is written', async () => {
    // The body pipe runs before the controller's D-11 check for every profile
    // field (an order this packet does not change), so the field's refusal may
    // be the pipe's 400 rather than the owner check's 403; either way it is
    // bounded. The metaData bag reaches the owner check first: 403.
    await resetBizA();
    for (const actor of [ID.staff, ID.admin]) {
      for (const [label, body] of [
        ['field, many entries', { depth: junkDepth(JUNK) }],
        ['field, long names', { depth: longKeyDepth() }],
        ['metaData bag, many entries', { metaData: { depth: junkDepth(JUNK) } }],
      ] as const) {
        const before = await businessRowText(ID.bizA);
        const res = await patch(actor, ID.bizA, body);
        const bytes = Buffer.byteLength(res.text ?? '');
        if ('metaData' in body) expect(res.status, `${actor} ${label}: ${res.text?.slice(0, 300)}`).toBe(403);
        else expect([400, 403], `${actor} ${label}: ${res.text?.slice(0, 300)}`).toContain(res.status);
        expect(bytes, `${actor} ${label}: the refusal weighs ${bytes} bytes`).toBeLessThanOrEqual(MAX_REFUSAL_BYTES);
        expect(res.text, `${actor} ${label}: no entry is named`).not.toMatch(/\bk\d+\b/);
        expect(res.text, `${actor} ${label}: no name comes back whole`).not.toContain(ECHO);
        expect(res.body, label).not.toHaveProperty('sells');
        expect(await businessRowText(ID.bizA), `${actor} ${label}: the row is byte-identical`).toBe(before);
      }
    }
  });
});

describe('V1-63 the profile PATCH stays the owner-only door for all three settings (owner ruling D-11); BIZ-SETTINGS-ADMIN-DOOR re-pins A01 (D-150)', () => {
  const ATTEMPT = { sells: 'products', advancedCrm: true, depth: { money: 'advanced' } };

  it('[V63E-A01] on the profile PATCH, a STAFF or ADMIN member is refused 403 whatever its settings scope (none, write, admin), as are a non-member and another tenant\'s owner; no identity is 401; the row is byte-identical each time', async () => {
    await resetBizA();
    for (const [actor, status, label] of [
      [ID.staff, 403, 'STAFF, settings:none'],
      [ID.staffW, 403, 'STAFF, settings:write'],
      [ID.staffA, 403, 'STAFF, settings:admin'],
      [ID.admin, 403, 'ADMIN, settings:admin'],
      [ID.adminW, 403, 'ADMIN, settings:write'],
      [ID.nonMember, 403, 'non-member'],
      [ID.ownerB, 403, "the owner of B on A's path"],
      [null, 401, 'no identity'],
    ] as const) {
      for (const body of [ATTEMPT, { metaData: ATTEMPT }]) {
        const before = await businessRowText(ID.bizA);
        const res = await patch(actor, ID.bizA, body);
        expect(res.status, `${label} ${JSON.stringify(body)}: ${JSON.stringify(res.body)}`).toBe(status);
        expect(res.body, label).not.toHaveProperty('sells');
        expect(await businessRowText(ID.bizA), `${label}: the Business row is byte-identical`).toBe(before);
      }
    }
  });

  it('[V63E-A02] RED-BEFORE: the members refused the write still read the owner\'s settings; a non-member reads nothing (403)', async () => {
    await resetBizA();
    expect((await patch(ID.owner, ID.bizA, ATTEMPT)).status).toBe(200);
    const expected = { sells: 'products', advancedCrm: true, depth: { ...ALL_STANDARD, money: 'advanced' } };
    for (const actor of [ID.staff, ID.staffW, ID.staffA, ID.admin, ID.adminW, ID.coOwner]) {
      const read = await get(actor, ID.bizA);
      expect(read.status, `${actor}: ${JSON.stringify(read.body)}`).toBe(200);
      expect(settingsOf(read.body), actor).toEqual(expected);
    }
    const outside = await get(ID.nonMember, ID.bizA);
    expect(outside.status).toBe(403);
    expect(outside.body).not.toHaveProperty('sells');
  });

  it('[V63E-A03] RED-BEFORE: positive control: a co-owner (a second OWNER membership) writes the settings (200), so the refusals are not vacuous', async () => {
    await resetBizA();
    const res = await patch(ID.coOwner, ID.bizA, { sells: 'services', advancedCrm: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const meta = await storedMeta(ID.bizA);
    expect({ sells: meta.sells, advancedCrm: meta.advancedCrm }).toEqual({ sells: 'services', advancedCrm: true });
  });

  it('[V63E-A04] RED-BEFORE (BIZ-SETTINGS-ADMIN-DOOR re-pins A01, owner ruling D-150): the ADMIN with settings admin that A01 refuses on the profile PATCH (403) sets advancedCrm and depth through PATCH .../advanced-settings (200), and is refused sells there (400) and on the profile PATCH (403)', async () => {
    await resetBizA();
    const profile = await patch(ID.admin, ID.bizA, { advancedCrm: true });
    expect(profile.status, `the profile PATCH: ${JSON.stringify(profile.body)}`).toBe(403);
    expect(await storedMeta(ID.bizA), 'the profile PATCH wrote nothing').not.toHaveProperty('advancedCrm');

    const res = await door(ID.admin, ID.bizA, { advancedCrm: true, depth: { money: 'advanced' } });
    expect(res.status, `the door: ${JSON.stringify(res.body)}`).toBe(200);
    expect(settingsOf(res.body)).toEqual({ sells: 'both', advancedCrm: true, depth: { ...ALL_STANDARD, money: 'advanced' } });
    const meta = await storedMeta(ID.bizA);
    expect({ advancedCrm: meta.advancedCrm, depth: meta.depth }).toEqual({ advancedCrm: true, depth: { money: 'advanced' } });

    const before = await businessRowText(ID.bizA);
    const sellsOnDoor = await door(ID.admin, ID.bizA, { sells: 'products' });
    expect(sellsOnDoor.status, `sells on the door: ${JSON.stringify(sellsOnDoor.body)}`).toBe(400);
    expect(sellsOnDoor.body.code).toBe(SETTING_INVALID);
    const sellsOnProfile = await patch(ID.admin, ID.bizA, { sells: 'products' });
    expect(sellsOnProfile.status, `sells on the profile PATCH: ${JSON.stringify(sellsOnProfile.body)}`).toBe(403);
    expect(await businessRowText(ID.bizA), 'sells refused on both doors: the row is byte-identical').toBe(before);
    expect((await storedMeta(ID.bizA)).sells, 'sells was never written').toBeUndefined();
  });
});

/** The body every member the door refuses sends ([V63E-AD03]). */
const DOOR_ATTEMPT = { advancedCrm: true, depth: { money: 'advanced' } };

describe('BIZ-SETTINGS-ADMIN-DOOR the owner or an ADMIN with settings admin changes advancedCrm and depth (owner ruling D-150); sells stays owner-only (D-11)', () => {
  it('[V63E-AD01] RED-BEFORE: an ADMIN with settings admin (role defaults) sets advancedCrm true then false, and depth hub by hub, through PATCH .../advanced-settings (200): each stored in metaData and read back by GET to the ADMIN and a STAFF member; sells, the other metaData keys and the profile columns are untouched; the response answers the same keys as GET', async () => {
    await resetBizA({ ...OTHER_META, sells: 'products' });
    for (const advancedCrm of [true, false]) {
      const res = await door(ID.admin, ID.bizA, { advancedCrm });
      expect(res.status, `${advancedCrm}: ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body.advancedCrm, `${advancedCrm}: the response`).toBe(advancedCrm);
      expect((await storedMeta(ID.bizA)).advancedCrm, `${advancedCrm}: stored as a boolean`).toBe(advancedCrm);
      for (const actor of [ID.admin, ID.staff]) {
        const read = await get(actor, ID.bizA);
        expect(read.status).toBe(200);
        expect(settingsOf(read.body), `${advancedCrm}: read by ${actor}`).toEqual({ sells: 'products', advancedCrm, depth: ALL_STANDARD });
      }
    }

    const steps: Array<[Record<string, string>, Record<string, string>]> = [
      [{ money: 'advanced' }, { money: 'advanced' }],
      [{ customers: 'advanced', sales: 'advanced' }, { money: 'advanced', customers: 'advanced', sales: 'advanced' }],
      [{ sales: 'standard' }, { money: 'advanced', customers: 'advanced', sales: 'standard' }],
      [{}, { money: 'advanced', customers: 'advanced', sales: 'standard' }],
    ];
    for (const [write, stored] of steps) {
      const res = await door(ID.admin, ID.bizA, { depth: write });
      expect(res.status, `${JSON.stringify(write)}: ${JSON.stringify(res.body)}`).toBe(200);
      expect((await storedMeta(ID.bizA)).depth, `${JSON.stringify(write)}: a depth merges per hub`).toEqual(stored);
      const read = await get(ID.staff, ID.bizA);
      expect(read.body.depth, `${JSON.stringify(write)}: read`).toEqual({ ...ALL_STANDARD, ...stored });
      expect(res.body.depth, `${JSON.stringify(write)}: the response`).toEqual(read.body.depth);
    }

    const both = await door(ID.admin, ID.bizA, { advancedCrm: true, depth: { schedule: 'advanced' } });
    expect(both.status, JSON.stringify(both.body)).toBe(200);
    const read = await get(ID.admin, ID.bizA);
    const expected = { sells: 'products', advancedCrm: true, depth: { ...ALL_STANDARD, money: 'advanced', customers: 'advanced', sales: 'standard', schedule: 'advanced' } };
    expect(settingsOf(read.body)).toEqual(expected);
    expect(settingsOf(both.body)).toEqual(expected);
    expect(Object.keys(both.body).sort(), 'the door and GET answer the same Business keys').toEqual(Object.keys(read.body).sort());

    const meta = await storedMeta(ID.bizA);
    expect(meta.sells, 'sells untouched').toBe('products');
    for (const [k, v] of Object.entries(OTHER_META)) expect(meta[k], `metaData.${k} kept`).toEqual(v);
    const row = await db.business.findUnique({ where: { id: ID.bizA } });
    expect({ name: row.name, tagline: row.tagline, currency: row.currency, timezone: row.timezone })
      .toEqual({ name: `${P}bizA-name`, tagline: null, currency: 'TTD', timezone: 'America/Port_of_Spain' });
  });

  it('[V63E-AD02] RED-BEFORE: the owner and a co-owner set advancedCrm and depth through the same door (200) and read them back; the owner\'s profile PATCH still takes all three settings (D-11 unchanged)', async () => {
    await resetBizA();
    const owner = await door(ID.owner, ID.bizA, { advancedCrm: true, depth: { money: 'advanced' } });
    expect(owner.status, JSON.stringify(owner.body)).toBe(200);
    const coOwner = await door(ID.coOwner, ID.bizA, { depth: { page: 'advanced' } });
    expect(coOwner.status, JSON.stringify(coOwner.body)).toBe(200);
    expect(settingsOf((await get(ID.owner, ID.bizA)).body)).toEqual({ sells: 'both', advancedCrm: true, depth: { ...ALL_STANDARD, money: 'advanced', page: 'advanced' } });

    const profile = await patch(ID.owner, ID.bizA, { sells: 'services', advancedCrm: false, depth: { money: 'standard' } });
    expect(profile.status, JSON.stringify(profile.body)).toBe(200);
    const meta = await storedMeta(ID.bizA);
    expect({ sells: meta.sells, advancedCrm: meta.advancedCrm, depth: meta.depth }).toEqual({ sells: 'services', advancedCrm: false, depth: { money: 'standard', page: 'advanced' } });
  });

  it('[V63E-AD03] RED-BEFORE: STAFF (settings none), STAFF granted settings write, STAFF granted settings admin (a STAFF, not an ADMIN), an ADMIN whose map grants settings write only, a non-member and another tenant\'s owner are refused 403 on the door (the members with the door\'s code, before the body is read: a junk body is refused 403 too, bounded); no identity is 401; the row is byte-identical and no audit row is written', async () => {
    await resetBizA();
    const auditBefore = (await doorAuditRows(ID.bizA)).length;
    const junk = { sells: 'products', depth: Object.fromEntries(Array.from({ length: 5_000 }, (_, i) => [`k${i}`, 1])) };
    for (const [actor, status, code, label] of [
      [ID.staff, 403, DOOR_FORBIDDEN, 'STAFF, settings:none'],
      [ID.staffW, 403, DOOR_FORBIDDEN, 'STAFF, settings:write'],
      [ID.staffA, 403, DOOR_FORBIDDEN, 'STAFF, settings:admin'],
      [ID.adminW, 403, DOOR_FORBIDDEN, 'ADMIN, settings:write'],
      [ID.nonMember, 403, undefined, 'non-member'],
      [ID.ownerB, 403, undefined, "the owner of B on A's path"],
      [null, 401, undefined, 'no identity'],
    ] as const) {
      for (const body of [DOOR_ATTEMPT, { advancedCrm: false }, junk]) {
        const before = await businessRowText(ID.bizA);
        const res = await door(actor, ID.bizA, body);
        const shown = (res.text ?? '').slice(0, 300);
        expect(res.status, `${label}: ${shown}`).toBe(status);
        if (code) expect(res.body.code, `${label}: ${shown}`).toBe(code);
        expect(Buffer.byteLength(res.text ?? ''), `${label}: a bounded refusal`).toBeLessThanOrEqual(4_096);
        expect(res.text, `${label}: no entry is named`).not.toMatch(/\bk\d+\b/);
        expect(res.body, label).not.toHaveProperty('advancedCrm');
        expect(await businessRowText(ID.bizA), `${label}: the Business row is byte-identical`).toBe(before);
      }
    }
    expect((await doorAuditRows(ID.bizA)).length, 'no refused attempt writes an audit row').toBe(auditBefore);
    expect(await storedMeta(ID.bizA)).not.toHaveProperty('advancedCrm');
  });

  it(`[V63E-AD04] RED-BEFORE: an ADMIN is refused sells everywhere: on the door (400 ${SETTING_INVALID} naming sells, alone and beside a valid advancedCrm, nothing written) and on the profile PATCH as a field and in the metaData bag (403); the owner is refused sells on the door too (sells is the profile's) and sets it through the profile PATCH`, async () => {
    await resetBizA();
    for (const actor of [ID.admin, ID.owner]) {
      for (const body of [{ sells: 'products' }, { sells: 'products', advancedCrm: true }, { advancedCrm: true, depth: { money: 'advanced' }, sells: 'services' }]) {
        const before = await businessRowText(ID.bizA);
        const res = await door(actor, ID.bizA, body);
        expect(res.status, `${actor} ${JSON.stringify(body)}: ${JSON.stringify(res.body)}`).toBe(400);
        expect(res.body.code).toBe(SETTING_INVALID);
        expect(JSON.stringify(res.body.problems), `${actor}: the refusal names sells`).toContain('sells');
        expect(await businessRowText(ID.bizA), `${actor} ${JSON.stringify(body)}: the row is byte-identical`).toBe(before);
      }
    }
    for (const body of [{ sells: 'products' }, { metaData: { sells: 'products' } }]) {
      const before = await businessRowText(ID.bizA);
      const res = await patch(ID.admin, ID.bizA, body);
      expect(res.status, `the profile PATCH ${JSON.stringify(body)}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(await businessRowText(ID.bizA)).toBe(before);
    }
    expect((await storedMeta(ID.bizA)).sells, 'no refused attempt wrote sells').toBeUndefined();
    const owner = await patch(ID.owner, ID.bizA, { sells: 'products' });
    expect(owner.status, JSON.stringify(owner.body)).toBe(200);
    expect((await storedMeta(ID.bizA)).sells).toBe('products');
  });

  it(`[V63E-AD05] RED-BEFORE: the door takes advancedCrm and depth only: a value V1-63 refuses, a key the door does not take (a profile field, the metaData bag), an empty body and a body that is not an object are refused 400 ${SETTING_INVALID} with the row byte-identical and no audit row`, async () => {
    await resetBizA();
    const auditBefore = (await doorAuditRows(ID.bizA)).length;
    for (const body of [
      { advancedCrm: 'yes' },
      { advancedCrm: null },
      { advancedCrm: 1 },
      { depth: { crm: 'advanced' } },
      { depth: { money: 'expert' } },
      { depth: { money: null } },
      { depth: 'advanced' },
      { depth: null },
      { depth: ['money'] },
      { tagline: `${P}not-written` },
      { name: `${P}not-written`, advancedCrm: true },
      { metaData: { advancedCrm: true } },
      { advancedCrm: true, metaData: { bankName: `${P}not-written` } },
      {},
      [],
      [{ advancedCrm: true }],
    ] as unknown[]) {
      const before = await businessRowText(ID.bizA);
      const res = await door(ID.admin, ID.bizA, body);
      expect(res.status, `${JSON.stringify(body)}: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.code, `${JSON.stringify(body)}: ${JSON.stringify(res.body)}`).toBe(SETTING_INVALID);
      expect(Array.isArray(res.body.problems) && res.body.problems.length > 0, `${JSON.stringify(body)}: the problems are listed`).toBe(true);
      expect(await businessRowText(ID.bizA), `${JSON.stringify(body)}: the row is byte-identical`).toBe(before);
    }
    expect((await doorAuditRows(ID.bizA)).length, 'no refused write writes an audit row').toBe(auditBefore);
  });

  it('[V63E-AD06] RED-BEFORE: the door\'s refusal is bounded as SEC-V63-1 bounds the profile PATCH\'s: a depth of 5,000 junk entries is one problem naming the count, 5,000 keys the door does not take are one problem naming the count, and a long key name comes back cut short; each body weighs at most 4,096 bytes and nothing is written', async () => {
    await resetBizA();
    const JUNK = 5_000;
    const LONG = 'x'.repeat(9_000);
    const ECHO = 'x'.repeat(64);
    const cases: Array<[string, unknown, number | undefined]> = [
      ['a depth of junk entries', { depth: Object.fromEntries(Array.from({ length: JUNK }, (_, i) => [`k${i}`, 1])) }, 1],
      ['keys the door does not take', Object.fromEntries(Array.from({ length: JUNK }, (_, i) => [`k${i}`, 1])), 1],
      ['two long key names', { [`${LONG}a`]: true, [`${LONG}b`]: true }, 2],
      ['seven long depth entries', { depth: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`${LONG}${i}`, 'advanced'])) }, 7],
      ['long names beside sells and a junk depth', { sells: 'x', [`${LONG}a`]: 1, depth: Object.fromEntries(Array.from({ length: JUNK }, (_, i) => [`k${i}`, 1])) }, undefined],
    ];
    for (const [label, body, problems] of cases) {
      const before = await businessRowText(ID.bizA);
      const res = await door(ID.admin, ID.bizA, body);
      const bytes = Buffer.byteLength(res.text ?? '');
      expect(res.status, `${label}: ${(res.text ?? '').slice(0, 300)}`).toBe(400);
      expect(res.body.code, label).toBe(SETTING_INVALID);
      expect(bytes, `${label}: the refusal weighs ${bytes} bytes`).toBeLessThanOrEqual(4_096);
      expect(res.text, `${label}: no entry is named`).not.toMatch(/\bk\d+\b/);
      expect(res.text, `${label}: no name comes back whole`).not.toContain(ECHO);
      if (problems !== undefined) expect(res.body.problems, `${label}: ${problems} problem(s)`).toHaveLength(problems);
      if (label === 'keys the door does not take') expect(res.body.problems[0], 'it names the count').toContain(String(JUNK));
      expect(await businessRowText(ID.bizA), `${label}: the row is byte-identical`).toBe(before);
    }
  });

  it('[V63E-AD07] RED-BEFORE: every write through the door writes one team_activity_logs row in its transaction naming the actor (user id, standing OWNER or ADMIN), module settings, the business as the entity and each named setting before and after; a refused write writes none', async () => {
    await resetBizA();
    await db.$executeRawUnsafe('DELETE FROM team_activity_logs WHERE business_id = $1', ID.bizA);

    const admin = await door(ID.admin, ID.bizA, { advancedCrm: true, depth: { money: 'advanced' } });
    expect(admin.status, JSON.stringify(admin.body)).toBe(200);
    let rows = await doorAuditRows(ID.bizA);
    expect(rows, 'one row for the ADMIN\'s write').toHaveLength(1);
    expect({ userId: rows[0].userId, module: rows[0].module, entityType: rows[0].entityType, entityId: rows[0].entityId })
      .toEqual({ userId: ID.admin, module: 'settings', entityType: 'business', entityId: ID.bizA });
    expect(rows[0].meta).toEqual({
      actorStanding: 'ADMIN',
      changes: { advancedCrm: { from: false, to: true }, depth: { money: { from: 'standard', to: 'advanced' } } },
    });

    expect((await door(ID.staff, ID.bizA, { advancedCrm: false })).status).toBe(403);
    expect((await door(ID.admin, ID.bizA, { sells: 'products' })).status).toBe(400);
    expect((await door(ID.admin, ID.bizA, { advancedCrm: 'no' })).status).toBe(400);
    expect(await doorAuditRows(ID.bizA), 'a refused write writes no row').toHaveLength(1);

    const owner = await door(ID.owner, ID.bizA, { depth: { money: 'standard', sales: 'advanced' } });
    expect(owner.status, JSON.stringify(owner.body)).toBe(200);
    rows = await doorAuditRows(ID.bizA);
    expect(rows).toHaveLength(2);
    expect(rows[1].userId).toBe(ID.owner);
    expect(rows[1].meta).toEqual({
      actorStanding: 'OWNER',
      changes: { depth: { money: { from: 'advanced', to: 'standard' }, sales: { from: 'standard', to: 'advanced' } } },
    });
  });

  it('[V63E-AD08] RED-BEFORE: the service itself (no HTTP) admits a platform SUPER_ADMIN, the bypass BusinessGuard and the profile PATCH grant, and its audit row names that actor with standing SUPER_ADMIN; it refuses no actor (401) and a STAFF member (403) before it reads the body, the row byte-identical', async () => {
    await resetBizA();
    const result = await identityService.updateAdvancedSettings(ID.bizA, { advancedCrm: true }, { id: PLATFORM, role: 'SUPER_ADMIN' });
    expect(result.advancedCrm).toBe(true);
    const rows = await doorAuditRows(ID.bizA);
    const last = rows[rows.length - 1];
    expect({ userId: last.userId, standing: last.meta?.actorStanding }).toEqual({ userId: PLATFORM, standing: 'SUPER_ADMIN' });

    for (const [actor, status, label] of [
      [undefined, 401, 'no actor'],
      [{ id: ID.staff, role: 'USER' }, 403, 'STAFF, settings:none'],
      [{ id: ID.staffA, role: 'USER' }, 403, 'STAFF, settings:admin'],
    ] as const) {
      const before = await businessRowText(ID.bizA);
      let error: any;
      try { await identityService.updateAdvancedSettings(ID.bizA, { sells: 'products', depth: 'junk' }, actor); } catch (e) { error = e; }
      expect(error, `${label} is refused`).toBeDefined();
      expect(error.getStatus?.(), `${label}: refused before the body is read`).toBe(status);
      expect(await businessRowText(ID.bizA), `${label}: the row is byte-identical`).toBe(before);
    }
  });

  it('[V63E-AD09] RED-BEFORE: a concurrent profile PATCH loses neither key: while a lockBusinessMeta writer holds the row, an ADMIN\'s door write (advancedCrm, depth.sales), the owner\'s profile PATCH (sells, depth.money, metaData.bankName) and a co-owner\'s door write (depth.schedule) queue behind it; after the holder commits every write is kept', async () => {
    await resetBizA();
    const BANK = `${P}FirstCitizens`;
    try {
      const hold = await holdBusinessRow(ID.bizA, (tx, meta) =>
        tx.business.update({ where: { id: ID.bizA }, data: { metaData: { ...meta, v63eHeld: 'held' } } }));
      let adminWrite: Promise<any> | undefined;
      let ownerWrite: Promise<any> | undefined;
      let coOwnerWrite: Promise<any> | undefined;
      try {
        adminWrite = door(ID.admin, ID.bizA, { advancedCrm: true, depth: { sales: 'advanced' } }).then((r: any) => r);
        await waitForBusinessLockWaiters(hold, 1);
        ownerWrite = patch(ID.owner, ID.bizA, { sells: 'services', depth: { money: 'advanced' }, metaData: { bankName: BANK } }).then((r: any) => r);
        await waitForBusinessLockWaiters(hold, 2);
        coOwnerWrite = door(ID.coOwner, ID.bizA, { depth: { schedule: 'advanced' } }).then((r: any) => r);
        await waitForBusinessLockWaiters(hold, 3);
      } finally {
        await hold.commit();
      }
      const [a, o, c] = await Promise.all([adminWrite, ownerWrite, coOwnerWrite]);
      expect(a.status, `the ADMIN's door write: ${JSON.stringify(a.body)}`).toBe(200);
      expect(o.status, `the owner's profile PATCH: ${JSON.stringify(o.body)}`).toBe(200);
      expect(c.status, `the co-owner's door write: ${JSON.stringify(c.body)}`).toBe(200);

      const meta = await storedMeta(ID.bizA);
      expect(meta.v63eHeld, 'the holding writer\'s key').toBe('held');
      expect(meta.advancedCrm, 'the ADMIN\'s advancedCrm').toBe(true);
      expect(meta.sells, 'the owner\'s sells').toBe('services');
      expect(meta.bankName, 'the owner\'s bankName').toBe(BANK);
      expect(meta.depth, 'every hub each writer named').toEqual({ sales: 'advanced', money: 'advanced', schedule: 'advanced' });
      expect(meta.paymentMethods, 'an untouched key').toEqual(OTHER_META.paymentMethods);
      expect(settingsOf((await get(ID.staff, ID.bizA)).body))
        .toEqual({ sells: 'services', advancedCrm: true, depth: { ...ALL_STANDARD, sales: 'advanced', money: 'advanced', schedule: 'advanced' } });
    } finally {
      await resetBizA();
    }
    // Above the default: a write that never queues fails the lock-waiter wait (10 s) and still commits the holder.
  }, 30_000);
});

describe('V1-63 a concurrent metaData writer cannot lose a setting (the business row lock)', () => {
  it('[V63E-C01] RED-BEFORE: a lockBusinessMeta writer holds the row while the owner\'s sells PATCH, a co-owner\'s advancedCrm-and-bankName PATCH and a second lockBusinessMeta writer queue behind it: every write is kept', async () => {
    await resetBizA();
    const BANK = `${P}Scotiabank`;
    try {
      const hold = await holdBusinessRow(ID.bizA, (tx, meta) =>
        tx.business.update({ where: { id: ID.bizA }, data: { metaData: { ...meta, v63eHeld: 'held' } } }));
      let sells: Promise<any> | undefined;
      let crm: Promise<any> | undefined;
      let after: Promise<unknown> | undefined;
      try {
        sells = patch(ID.owner, ID.bizA, { sells: 'services' }).then((r: any) => r);
        await waitForBusinessLockWaiters(hold, 1);
        crm = patch(ID.coOwner, ID.bizA, { advancedCrm: true, depth: { money: 'advanced' }, metaData: { bankName: BANK } }).then((r: any) => r);
        await waitForBusinessLockWaiters(hold, 2);
        after = db.$transaction(async (tx: any) => {
          const business = await lockBusinessMeta(tx, ID.bizA);
          const meta = (business?.metaData as Record<string, unknown> | null) ?? {};
          await tx.business.update({ where: { id: ID.bizA }, data: { metaData: { ...meta, v63eAfter: 'after' } } });
        }, { maxWait: 10_000, timeout: 30_000 });
        await waitForBusinessLockWaiters(hold, 3);
      } finally {
        await hold.commit();
      }
      const [sold, crmed] = await Promise.all([sells, crm, after]);
      expect(sold.status, JSON.stringify(sold.body)).toBe(200);
      expect(crmed.status, JSON.stringify(crmed.body)).toBe(200);

      const meta = await storedMeta(ID.bizA);
      expect(meta.v63eHeld, 'the holding writer\'s key').toBe('held');
      expect(meta.sells, 'the owner\'s sells').toBe('services');
      expect(meta.advancedCrm, 'the co-owner\'s advancedCrm').toBe(true);
      expect(meta.depth, 'the co-owner\'s depth').toEqual({ money: 'advanced' });
      expect(meta.bankName, 'the co-owner\'s bankName').toBe(BANK);
      expect(meta.v63eAfter, 'the later writer\'s key').toBe('after');
      expect(meta.paymentMethods, 'an untouched key').toEqual(OTHER_META.paymentMethods);
      expect(settingsOf((await get(ID.staff, ID.bizA)).body)).toEqual({ sells: 'services', advancedCrm: true, depth: { ...ALL_STANDARD, money: 'advanced' } });
    } finally {
      await resetBizA();
    }
  });
});
