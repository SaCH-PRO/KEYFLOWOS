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
 * installs the same pipe options for the body with UpdateBusinessDto as its
 * expected type (the route's declared body type). Params and the current-user
 * decorator pass through untouched. The pipe over UpdateBusinessDto is also
 * run directly ([V63E-D01], [V63E-D02]), as R0-09-O03 does.
 *
 * REVIEW REPAIR SEC-V63-1 ([V63E-S01..S04]): a depth names each hub at most
 * once, so the refusal of a depth that is not one is bounded whatever the
 * body holds: more entries than there are hubs is one problem naming the
 * count, and a refused entry's name comes back cut short. Before the repair
 * every entry was a problem repeating its name, and the body pipe answers
 * before the controller's D-11 check, so any member could ask for a refusal
 * many times the size of its body.
 *
 * NO PROVIDER IS CALLED: nothing on these paths reaches one.
 *
 * FIXTURES: every user, business and membership id has the `v63e_` prefix
 * (registered in test/helpers/fixture-prefixes.json for V1-63
 * BIZ-SETTINGS-SERVER), every User.email contains it, and every row is
 * hard-deleted with LIKE ${sqlLikePrefix(P)} in beforeAll and afterAll. No
 * $transaction wraps a fixture; the transactions in [V63E-C01] are the
 * simulated concurrent writers.
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
  admin: `${P}admin`,         // ADMIN of bizA, role defaults (settings: admin)
  adminW: `${P}adminW`,       // ADMIN of bizA, ADMIN defaults with settings: write
  nonMember: `${P}nonMember`, // no membership anywhere
  ownerB: `${P}ownerB`,       // OWNER of bizB only
  bizA: `${P}bizA`,           // the business under test
  bizFresh: `${P}bizFresh`,   // never written by a test: the defaults
  bizB: `${P}bizB`,           // another tenant
};
const USERS = [ID.owner, ID.coOwner, ID.staff, ID.staffW, ID.admin, ID.adminW, ID.nonMember, ID.ownerB];
const emailOf = (id: string) => `${id}@v63e.test.local`;

/** The seven v1 hubs (D-150, D-151), in the order GET answers them. */
const HUBS = ['today', 'customers', 'sales', 'schedule', 'money', 'page', 'settings'] as const;
const ALL_STANDARD = Object.fromEntries(HUBS.map((h) => [h, 'standard']));
const DEFAULTS = { sells: 'both', advancedCrm: false, depth: ALL_STANDARD };

/** bizA's other metaData keys: a settings write leaves each as it was. */
const OTHER_META = { bankName: `${P}Republic`, paymentMethods: ['cash', 'bank_transfer'], cashEnabled: true };

/** The code the PATCH answers a settings value it does not know with (field or metaData bag). */
const SETTING_INVALID = 'BUSINESS_SETTING_INVALID';

let db: any;
let app: any;
let identityService: any;
let lockBusinessMeta: (tx: any, businessId: string) => Promise<{ metaData: unknown } | null>;
let ValidationPipeClass: any;
let UpdateBusinessDtoClass: any;

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
  // The production body pipe options, with the route's declared body type (see the header).
  const bodyPipe = new ValidationPipeClass({ whitelist: true, transform: true, expectedType: UpdateBusinessDtoClass });
  app.useGlobalPipes({
    transform: (value: unknown, metadata: { type: string }) => (metadata.type === 'body' ? bodyPipe.transform(value, metadata) : value),
  });
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
  it('[V63E-X01] seeded three tenants, eight users and eight memberships; no business stores a v1 setting', async () => {
    expect(await db.business.count({ where: { id: { startsWith: P } } })).toBe(3);
    expect(await db.user.count({ where: { id: { startsWith: P } } })).toBe(8);
    expect(await db.membership.count({ where: { id: { startsWith: P } } })).toBe(8);
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

describe('V1-63 the settings ride the owner-only door (owner ruling D-11)', () => {
  const ATTEMPT = { sells: 'products', advancedCrm: true, depth: { money: 'advanced' } };

  it('[V63E-A01] a STAFF or ADMIN member is refused 403 whatever its settings scope (none, write, admin), as are a non-member and another tenant\'s owner; no identity is 401; the row is byte-identical each time', async () => {
    await resetBizA();
    for (const [actor, status, label] of [
      [ID.staff, 403, 'STAFF, settings:none'],
      [ID.staffW, 403, 'STAFF, settings:write'],
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
    for (const actor of [ID.staff, ID.staffW, ID.admin, ID.adminW, ID.coOwner]) {
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
