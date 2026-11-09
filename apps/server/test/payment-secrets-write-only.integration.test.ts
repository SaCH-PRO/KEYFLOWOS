/**
 * R0-SEC2c-PAYMENT-SECRETS-WRITE-ONLY — payment provider secrets are write-only.
 * REAL database.
 *
 * Business.metaData carries the payment gateway secrets the web payments tab
 * (apps/web/src/app/app/settings/business/payments-tab.tsx) writes through
 * PATCH /identity/businesses/:businessId: stripeSecretKey, stripeWebhookSecret,
 * paypalClientSecret and wipayApiKey. The payment services read them server
 * side, straight from Prisma (payments.service.ts, the stripe/paypal/wipay
 * connectors), never from a Business read.
 *
 * RED-BEFORE (R0-SEC2b review SEC2b-R3, deferred; base claude/elegant-curie-7azpsb
 * after trial-H): sanitizeBusiness (core/security/sanitize-business.ts) masked
 * only metaData.whatsapp, so every Business read answered the four secrets in
 * plaintext to every reader BusinessGuard admits: a STAFF member on role
 * defaults (settings: none), a STAFF member granted settings:write, an ADMIN,
 * the OWNER, a co-owner (OWNER membership), the distinguished owner
 * (Business.ownerId, no membership row) and a SUPER_ADMIN all received all four
 * keys from GET /identity/businesses/:businessId, and every member received
 * them for every business in GET /identity/businesses; the owner received them
 * in the PATCH response and the POST /identity/bootstrap answer. The payments
 * tab read them back into its form and PATCHed them all again on save. A PATCH
 * echoing a masked read back would have written the mask over the secret, and
 * there was no way to remove a stored secret (null was stored as null).
 *
 * GREEN-AFTER: every Business read answers each payment secret only as
 * {configured:true} (a blank or null stored value reads as absent: not
 * configured), to every reader; the stored row is unchanged by a read. On the
 * profile PATCH a secret is written only when a new non-blank string is sent;
 * an omitted, blank or mask-shaped value keeps the stored one; an explicit
 * null removes it. The write stays OWNER only (owner ruling D-11).
 *
 * HOW THE APP IS COMPOSED (the contacts-visibility model): a real Nest app with
 * the real IdentityController, IdentityService, PrismaService, AuthGuard and
 * BusinessGuard against the database at DATABASE_URL. The one stand-in on the
 * authorization path is identity attachment: a test middleware reads
 * `x-test-user`, loads that seeded User row and attaches `{ id, email, role }`
 * exactly as AuthMiddleware does after token verification. Collaborators the
 * business GET, PATCH and bootstrap paths never authorize with are stubs
 * (BlueprintService a no-op: its mirror is best-effort and asynchronous).
 * No provider is called: nothing on these paths reaches one.
 *
 * FIXTURES: every user, business and membership id has the `k07p_` prefix
 * (registered in test/helpers/fixture-prefixes.json), every unique column
 * written here (User.email, User.referralCode) contains it, and every row is
 * hard-deleted with LIKE ${sqlLikePrefix(P)} in beforeAll and afterAll. No
 * $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'k07p_';
const ID = {
  owner: `${P}owner`,             // OWNER membership + Business.ownerId of bizP
  coOwner: `${P}coOwner`,         // a second OWNER membership on bizP; Business.ownerId + OWNER of bizQ
  admin: `${P}admin`,             // ADMIN of bizP, role defaults (settings: admin)
  staff: `${P}staff`,             // STAFF of bizP, role defaults (settings: none)
  staffW: `${P}staffW`,           // STAFF of bizP, granted settings: write
  legacyOwner: `${P}legacyOwner`, // Business.ownerId of bizL, no membership row
  superAdmin: `${P}superAdmin`,   // User.role SUPER_ADMIN, no membership anywhere
  outsider: `${P}outsider`,       // OWNER of bizX, no membership on bizP
  bizP: `${P}bizP`,               // the business under test (all four secrets stored)
  bizL: `${P}bizL`,               // the distinguished-owner control (all four secrets stored)
  bizQ: `${P}bizQ`,               // no payment configuration at all
  bizX: `${P}bizX`,               // the outsider's business
};
const USERS = [ID.owner, ID.coOwner, ID.admin, ID.staff, ID.staffW, ID.legacyOwner, ID.superAdmin, ID.outsider];
const emailOf = (id: string) => `${id}@k07p.test.local`;

/** The four payment provider secrets (the packet's list). */
const SECRET_KEYS = ['stripeSecretKey', 'stripeWebhookSecret', 'paypalClientSecret', 'wipayApiKey'] as const;
type SecretKey = (typeof SECRET_KEYS)[number];

/** Secret canaries: none of these may ever appear in a response body. */
const SECRET: Record<SecretKey, string> = {
  stripeSecretKey: `sk_live_${P}STRIPE_SECRET_9f2c71ab`,
  stripeWebhookSecret: `whsec_${P}STRIPE_WEBHOOK_4d8e13f0`,
  paypalClientSecret: `${P}PAYPAL_CLIENT_SECRET_6a0b95c2`,
  wipayApiKey: `${P}WIPAY_API_KEY_31e7d4a8`,
};
/** The non-secret payment settings stored beside them; reads keep these as stored. */
const PUBLIC_META = {
  stripePublishableKey: `pk_live_${P}publishable`,
  paypalClientId: `${P}paypal-client-id`,
  wipayAccountNumber: `${P}wipay-account`,
  bankTransferEnabled: true,
  bankName: `${P}Republic Bank`,
  otherKey: `${P}keep-me`,
};
const MASKED = { configured: true };

let db: any;
let app: any;
let ValidationPipeClass: any;
let UpdateBusinessDtoClass: any;
let SiteServiceClass: any;

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

/** Put a business's metaData back to the seeded payment configuration (raw SQL: no writer under test runs). */
async function reset(businessId: string, meta: Record<string, unknown> = { ...SECRET, ...PUBLIC_META }) {
  await db.$executeRawUnsafe('UPDATE businesses SET meta_data = $2::jsonb WHERE id = $1', businessId, JSON.stringify(meta));
}

/** The Business row exactly as Postgres stores it, so "unchanged" means byte-identical. */
async function businessRowText(id: string): Promise<string> {
  const rows = await db.$queryRawUnsafe('SELECT row_to_json(b)::text AS j FROM businesses b WHERE b.id = $1', id);
  expect(rows.length, `business ${id} exists`).toBe(1);
  return rows[0].j as string;
}

/** The stored metaData, read straight from Postgres. */
async function storedMeta(id: string): Promise<Record<string, unknown>> {
  const rows = await db.$queryRawUnsafe('SELECT meta_data AS m FROM businesses WHERE id = $1', id);
  return (rows[0]?.m ?? {}) as Record<string, unknown>;
}

const http = () => request(app.getHttpServer());
function as(req: any, actor: string | null) {
  return actor ? req.set('x-test-user', actor) : req;
}
const getBusiness = (actor: string, businessId: string) => as(http().get(`/identity/businesses/${businessId}`), actor);
const listBusinesses = (actor: string) => as(http().get('/identity/businesses'), actor);
const patchBusiness = (actor: string | null, businessId: string, body: Record<string, unknown>) =>
  as(http().patch(`/identity/businesses/${businessId}`), actor).send(body);

/** The secret keys whose stored value appears anywhere in a response body. */
function leakedKeys(body: unknown): SecretKey[] {
  const text = JSON.stringify(body ?? null);
  return SECRET_KEYS.filter((k) => text.includes(SECRET[k]));
}

/** A Business read of a business storing all four secrets: each one {configured:true}, the rest kept. */
function expectMaskedBusiness(business: any, label: string) {
  expect(leakedKeys(business), `${label}: secret values in the body`).toEqual([]);
  for (const k of SECRET_KEYS) expect(business?.metaData?.[k], `${label}: metaData.${k}`).toEqual(MASKED);
  for (const [k, v] of Object.entries(PUBLIC_META)) expect(business?.metaData?.[k], `${label}: metaData.${k} kept`).toEqual(v);
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
  ({ SiteService: SiteServiceClass } = await import('../src/modules/site/site.service'));

  const moduleRef = await Test.createTestingModule({
    controllers: [IdentityController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      OptionalAuthGuard,
      IdentityService,
      // Not on the business GET, PATCH or bootstrap authorization path.
      { provide: BlueprintService, useValue: { inferFromOnboarding: async () => null } },
      { provide: DefaultTriggersService, useValue: {} },
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

  await cleanup(); // in case a prior run aborted

  for (const id of USERS) {
    await db.user.create({
      data: {
        id, email: emailOf(id), name: id, role: id === ID.superAdmin ? 'SUPER_ADMIN' : 'USER',
        // Prefixed, so bootstrap generates no unprefixed unique value.
        referralCode: `${id}_ref`,
      },
    });
  }
  for (const [businessId, ownerId] of [[ID.bizP, ID.owner], [ID.bizL, ID.legacyOwner], [ID.bizQ, ID.coOwner], [ID.bizX, ID.outsider]]) {
    await db.business.create({ data: { id: businessId, name: `${businessId}-name`, ownerId, currency: 'TTD' } });
  }
  await reset(ID.bizP);
  await reset(ID.bizL);
  await reset(ID.bizQ, { otherKey: `${P}keep-me` });
  await reset(ID.bizX);
  const memberships: Array<{ userId: string; businessId: string; role: string; permissionScopes?: Record<string, string> }> = [
    { userId: ID.owner, businessId: ID.bizP, role: 'OWNER' },
    { userId: ID.coOwner, businessId: ID.bizP, role: 'OWNER' },
    { userId: ID.coOwner, businessId: ID.bizQ, role: 'OWNER' },
    { userId: ID.admin, businessId: ID.bizP, role: 'ADMIN' },
    { userId: ID.staff, businessId: ID.bizP, role: 'STAFF' },
    { userId: ID.staffW, businessId: ID.bizP, role: 'STAFF', permissionScopes: { settings: 'write' } },
    { userId: ID.outsider, businessId: ID.bizX, role: 'OWNER' },
  ];
  for (const m of memberships) {
    await db.membership.create({ data: { id: `${P}m_${m.userId.slice(P.length)}_${m.businessId.slice(P.length)}`, ...m } });
  }
}, 60_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
}, 60_000);

describe('R0-SEC2c fixture sanity (real rows)', () => {
  it('[SEC2c-X01] seeded four businesses, eight users and seven memberships; bizP and bizL store the four payment secrets in plaintext metaData, bizQ none; bizL and the super admin have no membership', async () => {
    expect(await db.business.count({ where: { id: { startsWith: P } } })).toBe(4);
    expect(await db.user.count({ where: { id: { startsWith: P } } })).toBe(8);
    expect(await db.membership.count({ where: { id: { startsWith: P } } })).toBe(7);
    expect(await db.membership.count({ where: { businessId: ID.bizL } })).toBe(0);
    expect(await db.membership.count({ where: { userId: ID.superAdmin } })).toBe(0);
    for (const biz of [ID.bizP, ID.bizL]) {
      const meta = await storedMeta(biz);
      for (const k of SECRET_KEYS) expect(meta[k], `${biz} stores ${k}`).toBe(SECRET[k]);
    }
    const q = await storedMeta(ID.bizQ);
    for (const k of SECRET_KEYS) expect(q).not.toHaveProperty(k);
  });
});

describe('R0-SEC2c Business reads answer each payment secret as a {configured} marker, to every reader', () => {
  it('[SEC2c-R01] RED-BEFORE: GET /identity/businesses/:businessId answers the four payment secrets as {configured:true} only to every reader (STAFF on role defaults, STAFF with settings:write, ADMIN, the owner, the co-owner, the distinguished owner of bizL, SUPER_ADMIN), the non-secret payment settings kept', async () => {
    const readers: Array<[string, string]> = [
      [ID.staff, ID.bizP], [ID.staffW, ID.bizP], [ID.admin, ID.bizP], [ID.owner, ID.bizP],
      [ID.coOwner, ID.bizP], [ID.legacyOwner, ID.bizL], [ID.superAdmin, ID.bizP],
    ];
    // The census: which reader received which secret value.
    const census: Record<string, SecretKey[]> = {};
    for (const [actor, biz] of readers) {
      const res = await getBusiness(actor, biz);
      expect(res.status, `${actor} GET ${biz}: ${JSON.stringify(res.body)}`).toBe(200);
      const leaked = leakedKeys(res.body);
      if (leaked.length > 0) census[actor.slice(P.length)] = leaked;
    }
    expect(census, 'reader -> payment secret values received').toEqual({});
    for (const [actor, biz] of readers) {
      const res = await getBusiness(actor, biz);
      expectMaskedBusiness(res.body, `${actor} GET /identity/businesses/${biz}`);
    }
  });

  it('[SEC2c-R02] RED-BEFORE: GET /identity/businesses (the workspace list) answers every business masked: a STAFF member sees bizP masked, the co-owner sees bizP masked and bizQ (no payment configuration) with no secret key at all', async () => {
    const staffList = await listBusinesses(ID.staff);
    expect(staffList.status).toBe(200);
    expect(leakedKeys(staffList.body), 'STAFF list: secret values').toEqual([]);
    expectMaskedBusiness(staffList.body.find((b: any) => b.id === ID.bizP), 'STAFF list bizP');

    const coList = await listBusinesses(ID.coOwner);
    expect(coList.status).toBe(200);
    expect(coList.body.map((b: any) => b.id).sort()).toEqual([ID.bizP, ID.bizQ].sort());
    expect(leakedKeys(coList.body), 'co-owner list: secret values').toEqual([]);
    expectMaskedBusiness(coList.body.find((b: any) => b.id === ID.bizP), 'co-owner list bizP');
    const q = coList.body.find((b: any) => b.id === ID.bizQ);
    for (const k of SECRET_KEYS) expect(q.metaData, `bizQ has no ${k}`).not.toHaveProperty(k);
    expect(q.metaData.otherKey).toBe(`${P}keep-me`);
  });

  it('[SEC2c-R03] RED-BEFORE: POST /identity/bootstrap, the owner\'s sign-in call, answers the business it found with the payment secrets masked', async () => {
    const res = await as(http().post('/identity/bootstrap'), ID.owner).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.isNewBusiness).toBe(false);
    expect(res.body.business?.id).toBe(ID.bizP);
    expect(leakedKeys(res.body), 'bootstrap body: secret values').toEqual([]);
    expectMaskedBusiness(res.body.business, 'POST /identity/bootstrap business');
  });

  it('[SEC2c-R04] RED-BEFORE: a stored secret that is blank or null reads as absent (not configured), never as a marker or the stored value', async () => {
    await reset(ID.bizP, { ...SECRET, ...PUBLIC_META, stripeSecretKey: '', stripeWebhookSecret: '   ', paypalClientSecret: null });
    try {
      const res = await getBusiness(ID.owner, ID.bizP);
      expect(res.status).toBe(200);
      for (const k of ['stripeSecretKey', 'stripeWebhookSecret', 'paypalClientSecret']) {
        expect(res.body.metaData, `metaData.${k} (blank or null stored)`).not.toHaveProperty(k);
      }
      expect(res.body.metaData.wipayApiKey).toEqual(MASKED);
      expect(leakedKeys(res.body)).toEqual([]);
    } finally {
      await reset(ID.bizP);
    }
  });

  it('[SEC2c-R05] a read never changes the stored row: after every read above, by every reader, bizP and bizL are byte-identical and still hold the four secrets', async () => {
    const before = { p: await businessRowText(ID.bizP), l: await businessRowText(ID.bizL) };
    await getBusiness(ID.staff, ID.bizP);
    await getBusiness(ID.owner, ID.bizP);
    await getBusiness(ID.legacyOwner, ID.bizL);
    await listBusinesses(ID.coOwner);
    expect(await businessRowText(ID.bizP)).toBe(before.p);
    expect(await businessRowText(ID.bizL)).toBe(before.l);
    const meta = await storedMeta(ID.bizP);
    for (const k of SECRET_KEYS) expect(meta[k]).toBe(SECRET[k]);
  });
});

describe('R0-SEC2c PATCH /identity/businesses/:businessId writes payment secrets write-only (OWNER only, D-11)', () => {
  it('[SEC2c-W01] RED-BEFORE: the owner\'s PATCH that omits every secret (it edits the bank name and the publishable key) keeps the four stored secrets byte-identical, and the response carries markers only', async () => {
    await reset(ID.bizP);
    try {
      const res = await patchBusiness(ID.owner, ID.bizP, { metaData: { bankName: `${P}First Citizens`, stripePublishableKey: `pk_live_${P}rotated` } });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(leakedKeys(res.body), 'PATCH response: secret values').toEqual([]);
      for (const k of SECRET_KEYS) expect(res.body.metaData[k], `response metaData.${k}`).toEqual(MASKED);
      const meta = await storedMeta(ID.bizP);
      for (const k of SECRET_KEYS) expect(meta[k], `stored ${k}`).toBe(SECRET[k]);
      expect(meta.bankName).toBe(`${P}First Citizens`);
      expect(meta.stripePublishableKey).toBe(`pk_live_${P}rotated`);
    } finally {
      await reset(ID.bizP);
    }
  });

  it('[SEC2c-W02] RED-BEFORE: a PATCH that echoes the masked read back ({configured:true}), sends a blank secret, or sends the whole read metaData back keeps every stored secret byte-identical (the mask is never written over a secret)', async () => {
    await reset(ID.bizP);
    try {
      const echoed = await patchBusiness(ID.owner, ID.bizP, {
        metaData: { stripeSecretKey: MASKED, stripeWebhookSecret: { configured: false }, paypalClientSecret: '', wipayApiKey: '   ' },
      });
      expect(echoed.status, JSON.stringify(echoed.body)).toBe(200);
      let meta = await storedMeta(ID.bizP);
      for (const k of SECRET_KEYS) expect(meta[k], `stored ${k} after the echo`).toBe(SECRET[k]);

      // The read the tab (or any client) holds, sent back whole.
      const read = await getBusiness(ID.owner, ID.bizP);
      expect(read.status).toBe(200);
      const whole = await patchBusiness(ID.owner, ID.bizP, { metaData: read.body.metaData });
      expect(whole.status, JSON.stringify(whole.body)).toBe(200);
      meta = await storedMeta(ID.bizP);
      for (const k of SECRET_KEYS) expect(meta[k], `stored ${k} after the whole read is sent back`).toBe(SECRET[k]);
      for (const [k, v] of Object.entries(PUBLIC_META)) expect(meta[k], `stored ${k} kept`).toEqual(v);
    } finally {
      await reset(ID.bizP);
    }
  });

  it('[SEC2c-W03] RED-BEFORE: the owner replaces one secret: the new value is stored (surrounding blanks trimmed), the other three stay byte-identical, and neither the new nor the old value comes back', async () => {
    await reset(ID.bizP);
    const NEW = `sk_live_${P}ROTATED_77aa01c3`;
    try {
      const res = await patchBusiness(ID.owner, ID.bizP, { metaData: { stripeSecretKey: `  ${NEW}  ` } });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(JSON.stringify(res.body).includes(NEW), 'the new secret in the PATCH response').toBe(false);
      expect(leakedKeys(res.body)).toEqual([]);
      expect(res.body.metaData.stripeSecretKey).toEqual(MASKED);
      const meta = await storedMeta(ID.bizP);
      expect(meta.stripeSecretKey).toBe(NEW);
      for (const k of SECRET_KEYS.filter((s) => s !== 'stripeSecretKey')) expect(meta[k], `stored ${k}`).toBe(SECRET[k]);
      const read = await getBusiness(ID.staff, ID.bizP);
      expect(JSON.stringify(read.body).includes(NEW), 'the new secret in a member\'s read').toBe(false);
      expect(read.body.metaData.stripeSecretKey).toEqual(MASKED);
    } finally {
      await reset(ID.bizP);
    }
  });

  it('[SEC2c-W04] RED-BEFORE: an explicit clear (null) removes the stored secret: the key is gone from the stored metaData and from the read (not configured); the other secrets and the client id stay', async () => {
    await reset(ID.bizP);
    try {
      const res = await patchBusiness(ID.owner, ID.bizP, { metaData: { paypalClientSecret: null } });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.metaData).not.toHaveProperty('paypalClientSecret');
      const meta = await storedMeta(ID.bizP);
      expect(Object.prototype.hasOwnProperty.call(meta, 'paypalClientSecret'), 'stored paypalClientSecret key').toBe(false);
      expect(meta.paypalClientId).toBe(PUBLIC_META.paypalClientId);
      for (const k of SECRET_KEYS.filter((s) => s !== 'paypalClientSecret')) expect(meta[k], `stored ${k}`).toBe(SECRET[k]);
      const read = await getBusiness(ID.owner, ID.bizP);
      expect(read.body.metaData).not.toHaveProperty('paypalClientSecret');
      // Clearing a secret that is not stored is a no-op, not an error.
      const again = await patchBusiness(ID.owner, ID.bizP, { metaData: { paypalClientSecret: null } });
      expect(again.status).toBe(200);
      expect(Object.prototype.hasOwnProperty.call(await storedMeta(ID.bizP), 'paypalClientSecret')).toBe(false);
    } finally {
      await reset(ID.bizP);
    }
  });

  it('[SEC2c-W05] the write stays OWNER only (D-11): a STAFF member, a STAFF member granted settings:write, an ADMIN and the owner of another business sending a new secret or a clear are refused 403, the Business row byte-identical', async () => {
    await reset(ID.bizP);
    for (const actor of [ID.staff, ID.staffW, ID.admin, ID.outsider]) {
      for (const metaData of [{ stripeSecretKey: `sk_live_${P}hijack` }, { wipayApiKey: null, paypalClientSecret: null }]) {
        const before = await businessRowText(ID.bizP);
        const res = await patchBusiness(actor, ID.bizP, { metaData });
        expect(res.status, `${actor} ${JSON.stringify(metaData)}: ${JSON.stringify(res.body)}`).toBe(403);
        expect(leakedKeys(res.body)).toEqual([]);
        expect(await businessRowText(ID.bizP), `${actor}: the Business row is byte-identical`).toBe(before);
      }
    }
  });

  it('[SEC2c-W06] RED-BEFORE: every owner arm may write a secret (the co-owner, the distinguished owner of bizL with no membership, a SUPER_ADMIN): 200, the value stored, the response masked', async () => {
    const cases: Array<[string, string]> = [[ID.coOwner, ID.bizP], [ID.legacyOwner, ID.bizL], [ID.superAdmin, ID.bizP]];
    for (const [actor, biz] of cases) {
      await reset(biz);
      const NEW = `${P}WIPAY_NEW_${actor.slice(P.length)}`;
      try {
        const res = await patchBusiness(actor, biz, { metaData: { wipayApiKey: NEW } });
        expect(res.status, `${actor} on ${biz}: ${JSON.stringify(res.body)}`).toBe(200);
        expect(JSON.stringify(res.body).includes(NEW), `${actor}: the new secret in the response`).toBe(false);
        expect(leakedKeys(res.body)).toEqual([]);
        expect(res.body.metaData.wipayApiKey).toEqual(MASKED);
        expect((await storedMeta(biz)).wipayApiKey).toBe(NEW);
      } finally {
        await reset(biz);
      }
    }
  });

  it('[SEC2c-W07] the production body pipe (whitelist) keeps a new secret and an explicit null inside UpdateBusinessDto.metaData, so the service sees the clear', async () => {
    const pipe = new ValidationPipeClass({ whitelist: true, transform: true });
    const out = await pipe.transform(
      { metaData: { stripeSecretKey: 'sk_live_new', paypalClientSecret: null } },
      { type: 'body', metatype: UpdateBusinessDtoClass, data: undefined },
    );
    expect(out).toBeInstanceOf(UpdateBusinessDtoClass);
    expect(out.metaData).toEqual({ stripeSecretKey: 'sk_live_new', paypalClientSecret: null });
  });
});

/**
 * Review SEC2c-ST-1: Business.metaData is one jsonb column many writers
 * read-modify-write. The profile PATCH read the stored metaData, merged the
 * caller's bag and the secret writes over it, and wrote the whole value back,
 * so a writer that committed between that read and that write was undone, and
 * a second profile PATCH in flight wrote its stale copy (the cleared or
 * rotated secret included) over the first. The PATCH now takes the business
 * row (SELECT ... FOR NO KEY UPDATE, the lock GmailService takes on the same
 * row) before it reads, in one transaction with its write.
 *
 * HOW THE INTERLEAVING IS MADE: the test holds the business row in a
 * transaction of its own (a concurrent metaData writer mid-write), sends the
 * PATCHes, waits until Postgres shows each one waiting on that row lock, then
 * commits. Nothing is mocked: the requests run the real guards and the real
 * IdentityService against the database. The transaction is the simulated
 * concurrent writer, not a fixture wrapper: fixtures are still reset by raw SQL.
 */
async function holdBusinessRow(businessId: string, write?: (tx: any) => Promise<unknown>) {
  let release!: () => void;
  const released = new Promise<void>((r) => { release = r; });
  let ready!: () => void;
  const held = new Promise<void>((r) => { ready = r; });
  const done = db.$transaction(async (tx: any) => {
    await tx.$queryRawUnsafe('SELECT id FROM businesses WHERE id = $1 FOR NO KEY UPDATE', businessId);
    if (write) await write(tx);
    ready();
    await released;
  }, { maxWait: 10_000, timeout: 30_000 });
  await Promise.race([held, done]);
  return { commit: async () => { release(); await done; } };
}

/** Wait until `n` statements on the businesses table are waiting on a lock (the held row). */
async function waitForBusinessLockWaiters(n: number) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const rows = await db.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND position('businesses' in lower(query)) > 0`,
    );
    const seen = Number(rows[0]?.n ?? 0);
    if (seen >= n) return;
    if (Date.now() > deadline) throw new Error(`expected ${n} statement(s) waiting on the business row, saw ${seen}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/**
 * FOLLOW3-D12: a PrismaService over the real client in which one armed
 * `<model>.<op>` call (on the client, or on the client an interactive
 * $transaction hands its callback) stops before it runs until the test
 * releases it, so a writer can be held between its read and its write.
 */
function pausingPrisma(client: any) {
  let armed: { model: string; op: string; reached: () => void; release: Promise<void> } | undefined;
  const delegate = (d: any, model: string) => new Proxy(d, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const gate = armed;
        if (gate && gate.model === model && gate.op === prop) {
          armed = undefined;
          gate.reached();
          return gate.release.then(() => value.apply(target, args));
        }
        return value.apply(target, args);
      };
    },
  });
  const wrap = (c: any): any => new Proxy(c, {
    get(target, prop) {
      if (prop === 'business') return delegate(Reflect.get(target, prop), 'business');
      if (prop === '$transaction') {
        return (arg: any, opts?: any) => (typeof arg === 'function'
          ? target.$transaction((tx: any) => arg(wrap(tx)), opts)
          : target.$transaction(arg, opts));
      }
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return {
    service: { client: wrap(client) },
    pauseNext(model: string, op: string) {
      let reached!: () => void;
      let release!: () => void;
      const reachedP = new Promise<void>((r) => { reached = r; });
      const releaseP = new Promise<void>((r) => { release = r; });
      armed = { model, op, reached, release: releaseP };
      return { reached: reachedP, release };
    },
    disarm() { armed = undefined; },
  };
}

/** Wait until `p` has settled or a statement waits on a businesses row lock. */
async function committedOrWaitingOnBusinessRow(p: Promise<unknown>) {
  let settled = false;
  p.then(() => { settled = true; }, () => { settled = true; });
  const deadline = Date.now() + 10_000;
  for (;;) {
    if (settled) return 'committed';
    const rows = await db.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND position('businesses' in lower(query)) > 0`,
    );
    if (Number(rows[0]?.n ?? 0) > 0) return 'waiting';
    if (Date.now() > deadline) throw new Error('the PATCH neither committed nor waited on the business row');
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('R0-SEC2c concurrent metaData writers cannot undo a secret write (review SEC2c-ST-1)', () => {
  it('[SEC2c-C01] RED-BEFORE: the owner clears a secret while a co-owner\'s profile PATCH is in flight: the clear holds (no stale copy writes the secret back) and the co-owner\'s edit is kept', async () => {
    await reset(ID.bizP);
    const BANK = `${P}Scotiabank`;
    try {
      const hold = await holdBusinessRow(ID.bizP);
      let clear: Promise<any> | undefined;
      let edit: Promise<any> | undefined;
      try {
        clear = patchBusiness(ID.owner, ID.bizP, { metaData: { paypalClientSecret: null } }).then((r: any) => r);
        await waitForBusinessLockWaiters(1);
        edit = patchBusiness(ID.coOwner, ID.bizP, { metaData: { bankName: BANK } }).then((r: any) => r);
        await waitForBusinessLockWaiters(2);
      } finally {
        await hold.commit();
      }
      const [cleared, edited] = await Promise.all([clear, edit]);
      expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      expect(leakedKeys(cleared.body)).toEqual([]);
      expect(leakedKeys(edited.body)).toEqual([]);

      const meta = await storedMeta(ID.bizP);
      expect(Object.prototype.hasOwnProperty.call(meta, 'paypalClientSecret'), 'the cleared paypalClientSecret written back').toBe(false);
      expect(meta.bankName, 'the co-owner\'s edit').toBe(BANK);
      for (const k of SECRET_KEYS.filter((s) => s !== 'paypalClientSecret')) expect(meta[k], `stored ${k}`).toBe(SECRET[k]);
      expect(edited.body.metaData).not.toHaveProperty('paypalClientSecret');
    } finally {
      await reset(ID.bizP);
    }
  });

  it('[SEC2c-C02] RED-BEFORE: a metaData writer that commits while the owner\'s PATCH rotates one secret and clears another keeps its key, and the rotation and the clear both hold', async () => {
    await reset(ID.bizP);
    const NEW = `sk_live_${P}ROTATED_C02_5be1`;
    const EVENTS = [{ type: 'page_view', itemId: null, timestamp: '2026-11-02T00:00:00.000Z' }];
    try {
      // A concurrent writer that merges its own key into the stored value in
      // the database (jsonb ||), mid-write when the PATCH arrives.
      const hold = await holdBusinessRow(ID.bizP, (tx) => tx.$executeRawUnsafe(
        `UPDATE businesses SET meta_data = COALESCE(meta_data, '{}'::jsonb) || jsonb_build_object('storefrontEvents', $2::jsonb) WHERE id = $1`,
        ID.bizP, JSON.stringify(EVENTS),
      ));
      let rotate: Promise<any> | undefined;
      try {
        rotate = patchBusiness(ID.owner, ID.bizP, { metaData: { stripeSecretKey: NEW, wipayApiKey: null } }).then((r: any) => r);
        await waitForBusinessLockWaiters(1);
      } finally {
        await hold.commit();
      }
      const res = await rotate;
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(JSON.stringify(res.body).includes(NEW), 'the new secret in the PATCH response').toBe(false);
      expect(leakedKeys(res.body)).toEqual([]);

      const meta = await storedMeta(ID.bizP);
      expect(meta.storefrontEvents, 'the concurrent writer\'s key').toEqual(EVENTS);
      expect(meta.stripeSecretKey, 'the rotated secret').toBe(NEW);
      expect(Object.prototype.hasOwnProperty.call(meta, 'wipayApiKey'), 'the cleared wipayApiKey').toBe(false);
      expect(meta.stripeWebhookSecret).toBe(SECRET.stripeWebhookSecret);
      expect(meta.paypalClientSecret).toBe(SECRET.paypalClientSecret);
    } finally {
      await reset(ID.bizP);
    }
  });

  // Review SEC2c-ST-1, the other half (FOLLOW3-D12-METADATA-LOCKED-WRITES):
  // the public POST /site/businesses/:businessId/analytics/event
  // (SiteService.trackEvent, apps/server/src/modules/site/site.service.ts, no
  // authentication, 60 per minute) read the stored metaData without the row
  // lock and wrote the whole value back, so an event that read before an
  // owner's clear and wrote after it wrote the cleared secret back. It now takes
  // the row lock the profile PATCH takes (lockBusinessMeta, core/prisma/
  // business-meta.ts) before it reads. The interleaving is made by a
  // PrismaService that stops trackEvent's business.update until released (see
  // test/business-meta-writers.integration.test.ts, which covers the other
  // converted writers; core/prisma/business-meta-writers.spec.ts is the census).
  it('[SEC2c-C03] RED-BEFORE: a storefront event (SiteService.trackEvent) that has read metaData when the owner\'s PATCH clears stripeSecretKey: the clear holds (the secret is not stored again) and the event is recorded', async () => {
    await reset(ID.bizP);
    const pausing = pausingPrisma(db);
    const site = new SiteServiceClass(pausing.service, {});
    const pause = pausing.pauseNext('business', 'update');
    try {
      const tracking = site.trackEvent(ID.bizP, 'page_view');
      const first = await Promise.race([
        pause.reached.then(() => 'stopped at its write'),
        tracking.then(() => 'finished without writing', (e: any) => `failed: ${e?.message ?? e}`),
      ]);
      expect(first, 'trackEvent reaches business.update after its read').toBe('stopped at its write');
      const clear = patchBusiness(ID.owner, ID.bizP, { metaData: { stripeSecretKey: null } }).then((r: any) => r);
      await committedOrWaitingOnBusinessRow(clear);
      pause.release();
      const [tracked, cleared] = await Promise.all([tracking, clear]);
      expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
      expect(tracked).toEqual({ tracked: true });

      const meta = await storedMeta(ID.bizP);
      expect(Object.prototype.hasOwnProperty.call(meta, 'stripeSecretKey'), 'the cleared stripeSecretKey stored again').toBe(false);
      expect((meta.storefrontEvents as Array<{ type: string }> | undefined)?.map((e) => e.type), 'the storefront event').toEqual(['page_view']);
      for (const k of SECRET_KEYS.filter((s) => s !== 'stripeSecretKey')) expect(meta[k], `stored ${k}`).toBe(SECRET[k]);
      for (const [k, v] of Object.entries(PUBLIC_META)) expect(meta[k], `stored ${k} kept`).toEqual(v);
    } finally {
      pausing.disarm();
      await reset(ID.bizP);
    }
  });
});
