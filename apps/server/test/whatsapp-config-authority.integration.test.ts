/**
 * R0-SEC2-WHATSAPP-CONFIG-AUTHORITY — the WhatsApp operator routes. REAL
 * database.
 *
 * FOUND BY the V1-21b final repair (wf_2cee856e-8ce): every operator route of
 * WhatsAppController (GET/PATCH businesses/:businessId/config, POST send,
 * POST test, GET status, GET conversations, GET conversations/:id,
 * GET templates, POST messages) carried AuthGuard and BusinessGuard only, so:
 *   - GET config answered the DECRYPTED config to any member: the Meta access
 *     token, the Twilio auth token and account SID, and the phoneNumberId the
 *     shared webhook routes inbound messages by;
 *   - PATCH config let any member replace the business's WhatsApp credentials,
 *     its sending identity (owner ruling D-11: the business profile, its
 *     sending identity and sibling business-config writes are OWNER only);
 *   - POST send and POST messages let any member send from the business
 *     number, and the conversation, template and status reads needed no scope.
 *
 * REQUIRED (cases below):
 *   C  GET config never answers a secret value to anyone: each credential is a
 *      `configured` flag, with its last 4 characters only for a member who may
 *      write the config; phoneNumberId only for that member too. GET status,
 *      the other route that carried phoneNumberId (as platformId), follows the
 *      same rule.
 *   W  PATCH config is OWNER only: 403 BUSINESS_PROFILE_OWNER_ONLY (the code
 *      every D-11 writer answers) with the Business row byte-identical. The
 *      owner is the OWNER membership or Business.ownerId, plus the SUPER_ADMIN
 *      platform bypass (the rule IdentityService.assertBusinessOwner,
 *      TemplatesService.assertProfileOwner and GmailService.assertConnectAuthority
 *      apply), bound to the route's business. A PATCH that omits a credential
 *      (or sends it blank, or echoes the GET view back) keeps the stored one:
 *      the masking must not let a resubmitted form wipe the tokens.
 *   S  POST send and POST messages need operations:write, and status,
 *      conversations, conversation detail, templates and POST test need
 *      operations:read: `operations` is the module key the KEY inbox routes
 *      (KeyInboxController, the inbox surface these conversations feed) require.
 *   F  A business the caller does not belong to answers 403 with nothing written.
 *   H  The webhooks (GET/POST webhook and webhook/:businessId) are unchanged:
 *      no session, the provider handshake and signature checks as before.
 *
 * NO PROVIDER TRAFFIC: sends run against a 'mock' provider config, global
 * fetch is replaced by a recorder that fails, WHATSAPP_BUSINESS_ACCOUNT_ID is
 * unset (templates never reach Meta), and every send case asserts the recorder
 * was not called.
 *
 * HOW THE APP IS COMPOSED (the contacts-visibility model): a real Nest app with
 * the real WhatsAppController, WhatsAppService, PrismaService, AuthGuard,
 * BusinessGuard, ModuleScopeGuard and the production GlobalHttpExceptionFilter,
 * against the database at DATABASE_URL. The one stand-in on the authorization
 * path is identity attachment: a test middleware reads `x-test-user`, loads
 * that seeded User row and attaches `{ id, email, role }` exactly as
 * AuthMiddleware does after token verification. WhatsAppService collaborators
 * the operator routes never reach on these paths (entity resolution, KEY inbox,
 * staff chat bridge, event bus, webhook ingress logger) are empty stand-ins.
 *
 * FIXTURES: every user, business, membership and conversation id has the
 * `k07w_` prefix (registered in test/helpers/fixture-prefixes.json, packet
 * 'R0-07 / R0-SEC2-WHATSAPP-CONFIG-AUTHORITY'), every unique column written
 * here (User.email) contains it, and every row is hard-deleted with
 * LIKE ${sqlLikePrefix(P)} in beforeAll and afterAll. No $transaction wrapping.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

// Load repo-root .env BEFORE importing anything that reads DATABASE_URL.
loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'k07w_';

const ID = {
  owner: `${P}owner`,             // OWNER membership + Business.ownerId of bizW
  coOwner: `${P}coOwner`,         // a second OWNER membership on bizW, not Business.ownerId
  admin: `${P}admin`,             // ADMIN, role defaults (settings: admin, operations: admin)
  staff: `${P}staff`,             // STAFF, role defaults (operations: read, settings: none)
  staffOpsW: `${P}staffOpsW`,     // STAFF, role defaults with operations: write
  staffNoOps: `${P}staffNoOps`,   // STAFF, role defaults with operations: none
  staffOwner: `${P}staffOwner`,   // STAFF on bizW; OWNER membership and Business.ownerId of bizO
  superAdmin: `${P}superAdmin`,   // User.role SUPER_ADMIN, no membership anywhere
  legacyOwner: `${P}legacyOwner`, // Business.ownerId of bizL, no membership row
  outsider: `${P}outsider`,       // OWNER of bizX, no membership on bizW
  bizW: `${P}bizW`,               // the business under test
  bizL: `${P}bizL`,               // the distinguished-owner control
  bizO: `${P}bizO`,               // the staff owner's own business
  bizX: `${P}bizX`,               // the outsider's business (foreign to every bizW member)
  convW: `${P}convW`,             // a seeded conversation on bizW
  msgW: `${P}msgW`,               // its inbound message
};
const USERS = [
  ID.owner, ID.coOwner, ID.admin, ID.staff, ID.staffOpsW, ID.staffNoOps,
  ID.staffOwner, ID.superAdmin, ID.legacyOwner, ID.outsider,
];
const emailOf = (id: string) => `${id}@k07w.test.local`;

/** Secret canaries: none of these may ever appear in a response body. */
const SECRET = {
  accessToken: `${P}META_ACCESS_TOKEN_SECRET_7c1e9a42`,
  authToken: `${P}TWILIO_AUTH_TOKEN_SECRET_5b8d3f61`,
  accountSid: `${P}TWILIO_ACCOUNT_SID_SECRET_ac93e27d`,
};
const PHONE_NUMBER_ID = '707070707070707';
const FROM_NUMBER = '+18685550100';
const last4 = (s: string) => s.slice(-4);

/** The stored config every config case starts from (a reset puts it back, encrypted as saveConfig stores it). */
const SEEDED_META = {
  provider: 'meta',
  phoneNumberId: PHONE_NUMBER_ID,
  fromNumber: FROM_NUMBER,
  accessToken: SECRET.accessToken,
  accountSid: SECRET.accountSid,
  authToken: SECRET.authToken,
};
/** The send cases' config: the mock provider sends nothing anywhere. */
const SEEDED_MOCK = { provider: 'mock', fromNumber: FROM_NUMBER };

/** The refusal code every D-11 owner-only writer answers. */
const PROFILE_CODE = 'BUSINESS_PROFILE_OWNER_ONLY';

let db: any;
let app: any;
let encryptToken: (s: string) => string | null;
let decryptToken: (s: string) => string | null;
const fetchCalls: string[] = [];
const savedEnv: Record<string, string | undefined> = {};
let realFetch: typeof globalThis.fetch | undefined;

async function cleanup() {
  for (const sql of [
    `DELETE FROM whatsapp_messages WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM whatsapp_contacts WHERE business_id LIKE ${sqlLikePrefix(P)} OR id LIKE ${sqlLikePrefix(P)}`,
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

/** metaData.whatsapp exactly as stored (ciphertext for the credentials). */
async function storedWhatsApp(id: string): Promise<Record<string, any> | null> {
  const rows = await db.$queryRawUnsafe(`SELECT meta_data->'whatsapp' AS wa FROM businesses WHERE id = $1`, id);
  return (rows[0]?.wa ?? null) as Record<string, any> | null;
}

/** The config at rest as saveConfig writes it: the three credentials encrypted, everything else plain. */
function atRest(config: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...config };
  for (const k of ['accessToken', 'authToken', 'accountSid']) {
    if (out[k]) out[k] = encryptToken(out[k]) as string;
  }
  return out;
}

/** Each case starts from a known config (and a sibling metaData key that must survive). Raw SQL. */
async function reset(businessId: string, config: Record<string, string> | null = SEEDED_META) {
  const meta: Record<string, unknown> = { otherKey: `${P}keep-me` };
  if (config) meta.whatsapp = atRest(config);
  await db.$executeRawUnsafe('UPDATE businesses SET meta_data = $2::jsonb WHERE id = $1', businessId, JSON.stringify(meta));
}

async function messageCount(businessId: string): Promise<{ contacts: number; messages: number }> {
  const [c] = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM whatsapp_contacts WHERE business_id = $1', businessId);
  const [m] = await db.$queryRawUnsafe('SELECT count(*)::int AS n FROM whatsapp_messages WHERE business_id = $1', businessId);
  return { contacts: c.n, messages: m.n };
}

/** Removes every conversation of bizW except the seeded one, so a refused send is visible as a count change. */
async function resetConversations() {
  await db.$executeRawUnsafe(`DELETE FROM whatsapp_messages WHERE business_id = $1 AND id <> $2`, ID.bizW, ID.msgW);
  await db.$executeRawUnsafe(`DELETE FROM whatsapp_contacts WHERE business_id = $1 AND id <> $2`, ID.bizW, ID.convW);
}

const http = () => request(app.getHttpServer());
const as = (r: any, actor?: string) => (actor ? r.set('x-test-user', actor) : r);
const getConfig = (actor: string, b: string) => as(http().get(`/whatsapp/businesses/${b}/config`), actor);
const patchConfig = (actor: string, b: string, body: Record<string, unknown>) =>
  as(http().patch(`/whatsapp/businesses/${b}/config`), actor).send(body);
const send = (actor: string, b: string, body: Record<string, unknown> = { to: '+18685550111', message: `${P}hello` }) =>
  as(http().post(`/whatsapp/businesses/${b}/send`), actor).send(body);
const sendDrawer = (actor: string, b: string, body: Record<string, unknown> = { toPhone: '+18685550122', body: `${P}drawer hello` }) =>
  as(http().post(`/whatsapp/businesses/${b}/messages`), actor).send(body);

/** The five operator reads (POST test included: it reads the config state). */
const READS: Array<{ label: string; call: (actor: string, b: string) => any }> = [
  { label: 'GET status', call: (a, b) => as(http().get(`/whatsapp/businesses/${b}/status`), a) },
  { label: 'GET conversations', call: (a, b) => as(http().get(`/whatsapp/businesses/${b}/conversations`), a) },
  { label: 'GET conversations/:id', call: (a, b) => as(http().get(`/whatsapp/businesses/${b}/conversations/${ID.convW}`), a) },
  { label: 'GET templates', call: (a, b) => as(http().get(`/whatsapp/businesses/${b}/templates`), a) },
  { label: 'POST test', call: (a, b) => as(http().post(`/whatsapp/businesses/${b}/test`), a) },
];

/** No secret value — plaintext or ciphertext — anywhere in a body. */
function expectNoSecret(body: unknown, label: string) {
  const text = JSON.stringify(body);
  for (const [k, v] of Object.entries(SECRET)) {
    expect(text.includes(v), `${label}: the ${k} plaintext is in the body: ${text}`).toBe(false);
  }
  expect(text.includes('enc:v1:'), `${label}: a credential ciphertext is in the body`).toBe(false);
}

function expectOwnerRefusal(res: { status: number; body: any }, label: string) {
  expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(403);
  expect(res.body?.code, `${label}: refusal code`).toBe(PROFILE_CODE);
  expectNoSecret(res.body, label);
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  ({ encryptToken, decryptToken } = await import('../src/core/crypto/token-crypto'));

  for (const k of ['WHATSAPP_VERIFY_TOKEN', 'WHATSAPP_APP_SECRET', 'WHATSAPP_BUSINESS_ACCOUNT_ID']) savedEnv[k] = process.env[k];
  process.env.WHATSAPP_VERIFY_TOKEN = `${P}verify`;
  process.env.WHATSAPP_APP_SECRET = `${P}app-secret`;
  delete process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    fetchCalls.push(String(input));
    throw new Error('k07w_: no provider traffic in this suite');
  }) as typeof globalThis.fetch;

  const { Test } = await import('@nestjs/testing');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { WhatsAppController } = await import('../src/modules/whatsapp/whatsapp.controller');
  const { WhatsAppService } = await import('../src/modules/whatsapp/whatsapp.service');
  const { WebhookIngressLoggerService } = await import('../src/core/connectors/webhook-ingress-logger.service');
  const { EntityResolutionService } = await import('../src/core/connectors/entity-resolution.service');
  const { KeyInboxService } = await import('../src/modules/key-inbox/key-inbox.service');
  const { StaffChatBridgeService } = await import('../src/modules/structure/staff-chat-bridge.service');

  const moduleRef = await Test.createTestingModule({
    controllers: [WhatsAppController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      WhatsAppService,
      { provide: EventEmitter2, useValue: { emit: () => true } },
      { provide: WebhookIngressLoggerService, useValue: { log: async () => undefined } },
      { provide: EntityResolutionService, useValue: {} },
      { provide: KeyInboxService, useValue: {} },
      { provide: StaffChatBridgeService, useValue: {} },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  // Identity attachment only, as AuthMiddleware attaches it from the User row.
  // No guard on these routes is overridden.
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
    await db.user.create({ data: { id, email: emailOf(id), name: id, role: id === ID.superAdmin ? 'SUPER_ADMIN' : 'USER' } });
  }
  for (const [businessId, ownerId] of [[ID.bizW, ID.owner], [ID.bizL, ID.legacyOwner], [ID.bizO, ID.staffOwner], [ID.bizX, ID.outsider]]) {
    await db.business.create({ data: { id: businessId, name: `${businessId}-name`, ownerId, currency: 'TTD' } });
    await reset(businessId);
  }
  const { ROLE_DEFAULT_SCOPES } = await import('../src/core/authority/module-vocabulary');
  const memberships: Array<{ userId: string; businessId: string; role: string; permissionScopes?: Record<string, string> }> = [
    { userId: ID.owner, businessId: ID.bizW, role: 'OWNER' },
    { userId: ID.coOwner, businessId: ID.bizW, role: 'OWNER' },
    { userId: ID.admin, businessId: ID.bizW, role: 'ADMIN' },
    { userId: ID.staff, businessId: ID.bizW, role: 'STAFF' },
    { userId: ID.staffOpsW, businessId: ID.bizW, role: 'STAFF', permissionScopes: { ...ROLE_DEFAULT_SCOPES.STAFF, operations: 'write' } },
    { userId: ID.staffNoOps, businessId: ID.bizW, role: 'STAFF', permissionScopes: { ...ROLE_DEFAULT_SCOPES.STAFF, operations: 'none' } },
    { userId: ID.staffOwner, businessId: ID.bizW, role: 'STAFF' },
    { userId: ID.staffOwner, businessId: ID.bizO, role: 'OWNER' },
    { userId: ID.outsider, businessId: ID.bizX, role: 'OWNER' },
  ];
  for (const m of memberships) {
    await db.membership.create({ data: { id: `${P}m_${m.userId.slice(P.length)}_${m.businessId.slice(P.length)}`, ...m } });
  }
  // One conversation on bizW with one inbound message (the detail route reads it).
  await db.whatsAppContact.create({
    data: { id: ID.convW, businessId: ID.bizW, phoneNumber: '+18685550199', displayName: `${P}customer`, lastMessageAt: new Date(), lastMessageSnippet: 'hi' },
  });
  await db.whatsAppMessage.create({
    data: { id: ID.msgW, businessId: ID.bizW, whatsappContactId: ID.convW, direction: 'INBOUND', body: 'hi', status: 'RECEIVED' },
  });
}, 60_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
  if (realFetch) globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}, 60_000);

beforeEach(() => {
  fetchCalls.length = 0;
});

describe('R0-SEC2 fixture sanity (real rows)', () => {
  it('[SEC2-X01] seeded four businesses, ten users and nine memberships; bizW stores the Meta config with its three credentials encrypted and phoneNumberId plain; bizL and the super admin have no membership', async () => {
    expect(await db.business.count({ where: { id: { startsWith: P } } })).toBe(4);
    expect(await db.user.count({ where: { id: { startsWith: P } } })).toBe(10);
    expect(await db.membership.count({ where: { id: { startsWith: P } } })).toBe(9);
    expect(await db.membership.count({ where: { businessId: ID.bizL } })).toBe(0);
    expect(await db.membership.count({ where: { userId: ID.superAdmin } })).toBe(0);
    expect(await db.business.count({ where: { ownerId: ID.coOwner } })).toBe(0);
    const wa = await storedWhatsApp(ID.bizW);
    expect(wa?.provider).toBe('meta');
    expect(wa?.phoneNumberId).toBe(PHONE_NUMBER_ID);
    for (const k of ['accessToken', 'authToken', 'accountSid'] as const) {
      expect(String(wa?.[k]).startsWith('enc:v1:'), `${k} is ciphertext at rest`).toBe(true);
      expect(decryptToken(wa?.[k])).toBe(SECRET[k]);
    }
    expect(await messageCount(ID.bizW)).toEqual({ contacts: 1, messages: 1 });
  });
});

describe('R0-SEC2 GET config never answers a secret value', () => {
  it('[SEC2-C01] RED-BEFORE: a STAFF member (role defaults) reads the config: 200 with the provider and fromNumber, each credential a configured flag with no characters of it, no phoneNumberId', async () => {
    await reset(ID.bizW);
    const res = await getConfig(ID.staff, ID.bizW);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expectNoSecret(res.body, 'STAFF GET config');
    expect(JSON.stringify(res.body).includes(PHONE_NUMBER_ID), 'STAFF sees phoneNumberId').toBe(false);
    const data = res.body.data;
    expect(data.provider).toBe('meta');
    expect(data.fromNumber).toBe(FROM_NUMBER);
    expect(data).not.toHaveProperty('phoneNumberId');
    for (const k of ['accessToken', 'authToken', 'accountSid']) {
      expect(data).not.toHaveProperty(k);
      expect(data.credentials?.[k]?.configured, `${k} configured flag`).toBe(true);
      expect(data.credentials?.[k]?.last4 ?? null, `${k}: no characters for a non-owner`).toBeNull();
    }
  });

  it('[SEC2-C02] RED-BEFORE: an ADMIN (role defaults: settings and operations admin) and a STAFF member granted operations:write read the same masked view: no secret, no phoneNumberId', async () => {
    await reset(ID.bizW);
    for (const actor of [ID.admin, ID.staffOpsW, ID.staffOwner]) {
      const res = await getConfig(actor, ID.bizW);
      expect(res.status, `${actor}: ${JSON.stringify(res.body)}`).toBe(200);
      expectNoSecret(res.body, `${actor} GET config`);
      expect(JSON.stringify(res.body).includes(PHONE_NUMBER_ID), `${actor} sees phoneNumberId`).toBe(false);
      expect(res.body.data.credentials.accessToken.configured).toBe(true);
    }
  });

  it('[SEC2-C03] RED-BEFORE: the owner, a co-owner (OWNER membership arm), the distinguished owner of bizL (Business.ownerId arm) and a SUPER_ADMIN get phoneNumberId and each credential\'s last 4 characters, never the value', async () => {
    for (const [actor, biz] of [[ID.owner, ID.bizW], [ID.coOwner, ID.bizW], [ID.legacyOwner, ID.bizL], [ID.superAdmin, ID.bizW]]) {
      await reset(biz);
      const res = await getConfig(actor, biz);
      expect(res.status, `${actor}: ${JSON.stringify(res.body)}`).toBe(200);
      expectNoSecret(res.body, `${actor} GET config`);
      const data = res.body.data;
      expect(data.phoneNumberId, `${actor}: phoneNumberId`).toBe(PHONE_NUMBER_ID);
      expect(data.fromNumber).toBe(FROM_NUMBER);
      for (const k of ['accessToken', 'authToken', 'accountSid'] as const) {
        expect(data).not.toHaveProperty(k);
        expect(data.credentials[k]).toEqual({ configured: true, last4: last4(SECRET[k]) });
      }
    }
  });

  it('[SEC2-C04] a Twilio config with no Meta token answers accessToken {configured:false}; an unconfigured business answers data null', async () => {
    await reset(ID.bizW, { provider: 'twilio', fromNumber: FROM_NUMBER, accountSid: SECRET.accountSid, authToken: SECRET.authToken });
    const res = await getConfig(ID.owner, ID.bizW);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expectNoSecret(res.body, 'owner GET twilio config');
    expect(res.body.data.credentials.accessToken).toEqual({ configured: false, last4: null });
    expect(res.body.data.credentials.authToken).toEqual({ configured: true, last4: last4(SECRET.authToken) });
    await reset(ID.bizW, null);
    const none = await getConfig(ID.staff, ID.bizW);
    expect(none.status).toBe(200);
    expect(none.body).toEqual({ data: null });
    await reset(ID.bizW);
  });

  it('[SEC2-C05] RED-BEFORE: GET status, the other route that answered phoneNumberId (as platformId), does not carry it to a STAFF member; the owner still sees it', async () => {
    await reset(ID.bizW);
    const staff = await READS[0].call(ID.staff, ID.bizW);
    expect(staff.status, JSON.stringify(staff.body)).toBe(200);
    expect(staff.body.connected).toBe(true);
    expect(staff.body.destination.displayName).toBe(FROM_NUMBER);
    expect(JSON.stringify(staff.body).includes(PHONE_NUMBER_ID), `STAFF status: ${JSON.stringify(staff.body)}`).toBe(false);
    expectNoSecret(staff.body, 'STAFF status');
    const owner = await READS[0].call(ID.owner, ID.bizW);
    expect(owner.status, JSON.stringify(owner.body)).toBe(200);
    expect(owner.body.destination.platformId).toBe(PHONE_NUMBER_ID);
    expectNoSecret(owner.body, 'owner status');
  });
});

describe('R0-SEC2 PATCH config is OWNER only (D-11 sending identity)', () => {
  const HOSTILE = {
    provider: 'meta',
    phoneNumberId: '999999999999999',
    fromNumber: '+18685559999',
    accessToken: `${P}ATTACKER_TOKEN`,
  };

  it('[SEC2-W01] RED-BEFORE: a STAFF member replaces the WhatsApp credentials: 403 BUSINESS_PROFILE_OWNER_ONLY, the Business row byte-identical', async () => {
    await reset(ID.bizW);
    const before = await businessRowText(ID.bizW);
    const res = await patchConfig(ID.staff, ID.bizW, HOSTILE);
    expect(await businessRowText(ID.bizW), `patch ${res.status}: the Business row is byte-identical`).toBe(before);
    expectOwnerRefusal(res, 'STAFF PATCH config');
  });

  it('[SEC2-W02] RED-BEFORE: an ADMIN (role defaults: settings admin), a STAFF member granted operations:write and a STAFF member who owns another business are refused the same way: 403, the Business row byte-identical', async () => {
    for (const actor of [ID.admin, ID.staffOpsW, ID.staffOwner]) {
      await reset(ID.bizW);
      const before = await businessRowText(ID.bizW);
      const res = await patchConfig(actor, ID.bizW, HOSTILE);
      expect(await businessRowText(ID.bizW), `${actor}: patch ${res.status}: the Business row is byte-identical`).toBe(before);
      expectOwnerRefusal(res, `${actor} PATCH config`);
    }
  });

  it('[SEC2-W03] RED-BEFORE: the owner check is bound to the route\'s business: a STAFF member of bizW who owns bizO, naming bizO in x-business-id, ?businessId= and the body, is refused on bizW (403) with the row byte-identical', async () => {
    await reset(ID.bizW);
    const before = await businessRowText(ID.bizW);
    const res = await as(http().patch(`/whatsapp/businesses/${ID.bizW}/config?businessId=${ID.bizO}`), ID.staffOwner)
      .set('x-business-id', ID.bizO)
      .send({ ...HOSTILE, businessId: ID.bizO });
    expect(await businessRowText(ID.bizW), `patch ${res.status}: the Business row is byte-identical`).toBe(before);
    expectOwnerRefusal(res, 'staff owner naming bizO');
  });

  it('[SEC2-W04] the owner replaces the config: 200, the credentials encrypted at rest, phoneNumberId plain (the shared webhook looks it up), the other metaData keys kept, the response carries no secret', async () => {
    await reset(ID.bizW);
    const next = { provider: 'meta', phoneNumberId: '808080808080808', fromNumber: '+18685550200', accessToken: `${P}NEW_OWNER_TOKEN_abcd` };
    const res = await patchConfig(ID.owner, ID.bizW, next);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ success: true });
    const wa = await storedWhatsApp(ID.bizW);
    expect(wa?.provider).toBe('meta');
    expect(wa?.phoneNumberId).toBe('808080808080808');
    expect(wa?.fromNumber).toBe('+18685550200');
    expect(String(wa?.accessToken).startsWith('enc:v1:')).toBe(true);
    expect(decryptToken(wa?.accessToken)).toBe(next.accessToken);
    const rows = await db.$queryRawUnsafe(`SELECT meta_data->>'otherKey' AS k FROM businesses WHERE id = $1`, ID.bizW);
    expect(rows[0].k).toBe(`${P}keep-me`);
    const read = await getConfig(ID.owner, ID.bizW);
    expect(read.body.data.credentials.accessToken).toEqual({ configured: true, last4: 'abcd' });
    expect(JSON.stringify(read.body).includes(next.accessToken)).toBe(false);
    await reset(ID.bizW);
  });

  it('[SEC2-W05] RED-BEFORE: a PATCH that omits the credentials, sends them blank or echoes the masked GET view back keeps the stored ones byte-identical (the mask never overwrites a token)', async () => {
    // (a) omitted: only the non-secret fields.
    await reset(ID.bizW);
    let stored = await storedWhatsApp(ID.bizW);
    let res = await patchConfig(ID.owner, ID.bizW, { provider: 'meta', phoneNumberId: PHONE_NUMBER_ID, fromNumber: '+18685550300' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    let after = await storedWhatsApp(ID.bizW);
    expect(after?.fromNumber).toBe('+18685550300');
    for (const k of ['accessToken', 'authToken', 'accountSid']) expect(after?.[k], `omitted ${k} kept`).toBe(stored?.[k]);

    // (b) blank strings and a mask-shaped string.
    await reset(ID.bizW);
    stored = await storedWhatsApp(ID.bizW);
    res = await patchConfig(ID.owner, ID.bizW, {
      provider: 'meta', phoneNumberId: PHONE_NUMBER_ID, fromNumber: FROM_NUMBER,
      accessToken: '', authToken: '   ', accountSid: `•••• ${last4(SECRET.accountSid)}`,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    after = await storedWhatsApp(ID.bizW);
    for (const k of ['accessToken', 'authToken', 'accountSid']) expect(after?.[k], `blank/mask ${k} kept`).toBe(stored?.[k]);

    // (c) the GET view sent straight back, with one field changed.
    await reset(ID.bizW);
    stored = await storedWhatsApp(ID.bizW);
    const view = (await getConfig(ID.owner, ID.bizW)).body.data;
    res = await patchConfig(ID.owner, ID.bizW, { ...view, fromNumber: '+18685550400' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    after = await storedWhatsApp(ID.bizW);
    expect(after?.fromNumber).toBe('+18685550400');
    expect(after?.phoneNumberId).toBe(PHONE_NUMBER_ID);
    for (const k of ['accessToken', 'authToken', 'accountSid']) expect(after?.[k], `echoed view: ${k} kept`).toBe(stored?.[k]);
    expect(after).not.toHaveProperty('credentials');
    await reset(ID.bizW);
  });

  it('[SEC2-W06] the co-owner (OWNER membership arm), the distinguished owner of bizL (Business.ownerId arm, no membership) and a SUPER_ADMIN may write the config', async () => {
    for (const [actor, biz] of [[ID.coOwner, ID.bizW], [ID.legacyOwner, ID.bizL], [ID.superAdmin, ID.bizW]]) {
      await reset(biz);
      const res = await patchConfig(actor, biz, { provider: 'meta', phoneNumberId: PHONE_NUMBER_ID, fromNumber: '+18685550500' });
      expect(res.status, `${actor}: ${JSON.stringify(res.body)}`).toBe(200);
      expect((await storedWhatsApp(biz))?.fromNumber, `${actor} wrote fromNumber`).toBe('+18685550500');
      await reset(biz);
    }
  });

  it('[SEC2-W07] RED-BEFORE (review SEC2-R1): an owner cannot store another business\'s credential ciphertext as its own: the owner of bizO PATCHes bizO with each of bizW\'s stored credentials (also with surrounding blanks): 400 WHATSAPP_CREDENTIAL_CIPHERTEXT, bizO byte-identical, no provider traffic', async () => {
    await reset(ID.bizW);
    await reset(ID.bizO, { provider: 'meta', fromNumber: '+18685550600' });
    const victim = await storedWhatsApp(ID.bizW);
    const before = await businessRowText(ID.bizO);
    for (const k of ['accessToken', 'authToken', 'accountSid'] as const) {
      const ciphertext = String(victim?.[k]);
      expect(ciphertext.startsWith('enc:v1:'), `bizW ${k} is ciphertext at rest`).toBe(true);
      for (const value of [ciphertext, `  ${ciphertext}  `]) {
        const res = await patchConfig(ID.staffOwner, ID.bizO, { provider: 'meta', fromNumber: '+18685550601', [k]: value });
        expect(await businessRowText(ID.bizO), `${k}: patch ${res.status}: bizO byte-identical`).toBe(before);
        expect(res.status, `${k}: ${JSON.stringify(res.body)}`).toBe(400);
        expect(res.body?.code, `${k}: refusal code`).toBe('WHATSAPP_CREDENTIAL_CIPHERTEXT');
        expectNoSecret(res.body, `${k} ciphertext refusal`);
      }
    }
    // The owner's own plaintext credential is still accepted and encrypted.
    const ok = await patchConfig(ID.staffOwner, ID.bizO, { provider: 'meta', fromNumber: '+18685550601', accessToken: `${P}BIZO_OWN_TOKEN_wxyz` });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const stored = await storedWhatsApp(ID.bizO);
    expect(decryptToken(stored?.accessToken)).toBe(`${P}BIZO_OWN_TOKEN_wxyz`);
    expect(fetchCalls).toEqual([]);
    await reset(ID.bizO);
  });

  it('[SEC2-W08] RED-BEFORE (review SEC2-R3): a phoneNumberId another business holds cannot be claimed: the owner of bizO PATCHes bizW\'s phoneNumberId: 409 WHATSAPP_PHONE_NUMBER_ID_IN_USE, bizO byte-identical, the webhook\'s routing predicate still matches bizW alone; bizW re-saving its own id and bizO taking a free id are accepted', async () => {
    // Only bizW holds PHONE_NUMBER_ID here (the default fixture config gives it to every business).
    await reset(ID.bizW);
    for (const biz of [ID.bizO, ID.bizL, ID.bizX]) await reset(biz, { provider: 'mock', fromNumber: '+18685550600' });
    // The shared webhook's routing predicate, over this suite's businesses.
    const routedTo = async (id: string) =>
      (await db.business.findMany({ where: { id: { startsWith: P }, metaData: { path: ['whatsapp', 'phoneNumberId'], equals: id } }, select: { id: true } }))
        .map((b: { id: string }) => b.id)
        .sort();
    const before = await businessRowText(ID.bizO);
    for (const phoneNumberId of [PHONE_NUMBER_ID, Number(PHONE_NUMBER_ID)]) {
      const res = await patchConfig(ID.staffOwner, ID.bizO, { provider: 'meta', phoneNumberId, fromNumber: '+18685550601', accessToken: `${P}BIZO_OWN_TOKEN_wxyz` });
      expect(await businessRowText(ID.bizO), `patch ${res.status}: bizO byte-identical`).toBe(before);
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body?.code).toBe('WHATSAPP_PHONE_NUMBER_ID_IN_USE');
      expect(JSON.stringify(res.body).includes(ID.bizW), 'the holder is not named').toBe(false);
    }
    expect(await routedTo(PHONE_NUMBER_ID)).toEqual([ID.bizW]);

    // The holder re-saving its own id is not a claim.
    const own = await patchConfig(ID.owner, ID.bizW, { provider: 'meta', phoneNumberId: PHONE_NUMBER_ID, fromNumber: '+18685550602' });
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    // A free id is accepted.
    const free = await patchConfig(ID.staffOwner, ID.bizO, { provider: 'meta', phoneNumberId: '616161616161616', fromNumber: '+18685550603' });
    expect(free.status, JSON.stringify(free.body)).toBe(200);
    expect(await routedTo('616161616161616')).toEqual([ID.bizO]);

    // A duplicate that predates the check does not lock its holder out of its own config.
    await reset(ID.bizO, { provider: 'meta', phoneNumberId: PHONE_NUMBER_ID, fromNumber: '+18685550600' });
    const legacyDup = await patchConfig(ID.owner, ID.bizW, { provider: 'meta', phoneNumberId: PHONE_NUMBER_ID, fromNumber: '+18685550604' });
    expect(legacyDup.status, JSON.stringify(legacyDup.body)).toBe(200);
    for (const biz of [ID.bizW, ID.bizO, ID.bizL, ID.bizX]) await reset(biz);
  });

  it('[SEC2-W09] two owners claiming the same free phoneNumberId at once: exactly one is stored, the other answers 409 (the claim is serialised)', async () => {
    const id = '626262626262626';
    await reset(ID.bizO, { provider: 'mock', fromNumber: '+18685550600' });
    await reset(ID.bizL, { provider: 'mock', fromNumber: '+18685550700' });
    const [a, b] = await Promise.all([
      patchConfig(ID.staffOwner, ID.bizO, { provider: 'meta', phoneNumberId: id, fromNumber: '+18685550605' }),
      patchConfig(ID.legacyOwner, ID.bizL, { provider: 'meta', phoneNumberId: id, fromNumber: '+18685550705' }),
    ]);
    expect([a.status, b.status].sort(), `${JSON.stringify(a.body)} / ${JSON.stringify(b.body)}`).toEqual([200, 409]);
    const holders = await db.business.findMany({ where: { metaData: { path: ['whatsapp', 'phoneNumberId'], equals: id } }, select: { id: true } });
    expect(holders.length, JSON.stringify(holders)).toBe(1);
    await reset(ID.bizO);
    await reset(ID.bizL);
  });
});

describe('R0-SEC2 sending and the inbox reads need an operations scope', () => {
  it('[SEC2-S01] RED-BEFORE: a STAFF member on role defaults (operations: read) cannot send from the business number: POST send and POST messages answer 403 and write no conversation or message', async () => {
    await reset(ID.bizW, SEEDED_MOCK);
    await resetConversations();
    const before = await messageCount(ID.bizW);
    const a = await send(ID.staff, ID.bizW);
    const b = await sendDrawer(ID.staff, ID.bizW);
    expect(await messageCount(ID.bizW), `send ${a.status} / messages ${b.status}: nothing written`).toEqual(before);
    expect(a.status, JSON.stringify(a.body)).toBe(403);
    expect(b.status, JSON.stringify(b.body)).toBe(403);
    expect(fetchCalls).toEqual([]);
    await reset(ID.bizW);
  });

  it('[SEC2-S02] RED-BEFORE: a STAFF member with operations: none is refused every inbox read (status, conversations, conversation detail, templates, POST test): 403 with no conversation in the body', async () => {
    await reset(ID.bizW);
    for (const { label, call } of READS) {
      const res = await call(ID.staffNoOps, ID.bizW);
      expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(403);
      expect(JSON.stringify(res.body).includes('+18685550199'), `${label}: conversation leaked`).toBe(false);
      expectNoSecret(res.body, label);
    }
    expect(fetchCalls).toEqual([]);
  });

  it('[SEC2-S03] a STAFF member on role defaults (operations: read) keeps every inbox read: 200 from status, conversations, conversation detail, templates and POST test, none carrying a secret', async () => {
    await reset(ID.bizW);
    for (const { label, call } of READS) {
      const res = await call(ID.staff, ID.bizW);
      expect([200, 201], `${label}: ${JSON.stringify(res.body)}`).toContain(res.status);
      expectNoSecret(res.body, label);
    }
    const list = await READS[1].call(ID.staff, ID.bizW);
    expect(list.body.map((c: any) => c.id)).toContain(ID.convW);
    const detail = await READS[2].call(ID.staff, ID.bizW);
    expect(detail.body.id).toBe(ID.convW);
    expect(fetchCalls).toEqual([]);
  });

  it('[SEC2-S04] a STAFF member granted operations: write, an ADMIN (operations: admin), the owner and a SUPER_ADMIN send from the business number (mock provider): one OUTBOUND SENT message per send, no provider traffic', async () => {
    for (const actor of [ID.staffOpsW, ID.admin, ID.owner, ID.superAdmin]) {
      await reset(ID.bizW, SEEDED_MOCK);
      await resetConversations();
      const before = await messageCount(ID.bizW);
      const a = await send(actor, ID.bizW);
      expect(a.status, `${actor} send: ${JSON.stringify(a.body)}`).toBe(201);
      expect(a.body.success, `${actor} send`).toBe(true);
      const b = await sendDrawer(actor, ID.bizW);
      expect(b.status, `${actor} messages: ${JSON.stringify(b.body)}`).toBe(201);
      expect(b.body.status, `${actor} messages`).toBe('SENT');
      const after = await messageCount(ID.bizW);
      expect(after.messages - before.messages, `${actor}: two messages recorded`).toBe(2);
      const outbound = await db.whatsAppMessage.count({ where: { businessId: ID.bizW, direction: 'OUTBOUND', status: 'SENT' } });
      expect(outbound, `${actor}: both SENT`).toBe(2);
    }
    expect(fetchCalls).toEqual([]);
    await resetConversations();
    await reset(ID.bizW);
  });

  it('[SEC2-S05] RED-BEFORE (review CR-SEC2-1): the distinguished owner of bizL (Business.ownerId, no membership row), whom PATCH config admits, keeps every inbox read and sends (mock provider): status connected, conversations, templates, POST test, POST send and POST messages', async () => {
    await reset(ID.bizL, SEEDED_MOCK);
    const reads = READS.filter(({ label }) => label !== 'GET conversations/:id');
    for (const { label, call } of reads) {
      const res = await call(ID.legacyOwner, ID.bizL);
      expect([200, 201], `${label}: ${JSON.stringify(res.body)}`).toContain(res.status);
      expectNoSecret(res.body, label);
    }
    const status = await READS[0].call(ID.legacyOwner, ID.bizL);
    expect(status.body.connected, JSON.stringify(status.body)).toBe(true);
    const before = await messageCount(ID.bizL);
    const a = await send(ID.legacyOwner, ID.bizL);
    expect(a.status, `send: ${JSON.stringify(a.body)}`).toBe(201);
    expect(a.body.success).toBe(true);
    const b = await sendDrawer(ID.legacyOwner, ID.bizL);
    expect(b.status, `messages: ${JSON.stringify(b.body)}`).toBe(201);
    expect(b.body.status).toBe('SENT');
    expect((await messageCount(ID.bizL)).messages - before.messages).toBe(2);
    expect(fetchCalls).toEqual([]);
    await db.$executeRawUnsafe('DELETE FROM whatsapp_messages WHERE business_id = $1', ID.bizL);
    await db.$executeRawUnsafe('DELETE FROM whatsapp_contacts WHERE business_id = $1', ID.bizL);
    await reset(ID.bizL);
  });

  it('[SEC2-S06] the owner arm is bound to the route\'s business: a STAFF member of bizW (operations: read) who owns bizO, naming bizO in x-business-id, ?businessId= and the body, is refused POST send and POST messages on bizW (403), nothing written', async () => {
    await reset(ID.bizW, SEEDED_MOCK);
    await resetConversations();
    const before = await messageCount(ID.bizW);
    const a = await as(http().post(`/whatsapp/businesses/${ID.bizW}/send?businessId=${ID.bizO}`), ID.staffOwner)
      .set('x-business-id', ID.bizO)
      .send({ to: '+18685550111', message: `${P}hello`, businessId: ID.bizO });
    const b = await as(http().post(`/whatsapp/businesses/${ID.bizW}/messages?businessId=${ID.bizO}`), ID.staffOwner)
      .set('x-business-id', ID.bizO)
      .send({ toPhone: '+18685550122', body: `${P}drawer hello`, businessId: ID.bizO });
    expect(await messageCount(ID.bizW), `send ${a.status} / messages ${b.status}: nothing written`).toEqual(before);
    expect(a.status, JSON.stringify(a.body)).toBe(403);
    expect(b.status, JSON.stringify(b.body)).toBe(403);
    expect(fetchCalls).toEqual([]);
    await reset(ID.bizW);
  });
});

describe('R0-SEC2 a business the caller does not belong to', () => {
  it('[SEC2-F01] the owner of bizX reads, writes, sends and lists on bizW: 403 on every route, bizW byte-identical and no message written', async () => {
    await reset(ID.bizW, SEEDED_MOCK);
    await resetConversations();
    const before = await businessRowText(ID.bizW);
    const counts = await messageCount(ID.bizW);
    // Thunks: a supertest request starts its own listener when created, so each is created when it is sent.
    const calls: Array<[string, () => any]> = [
      ['GET config', () => getConfig(ID.outsider, ID.bizW)],
      ['PATCH config', () => patchConfig(ID.outsider, ID.bizW, { provider: 'meta', accessToken: `${P}ATTACKER_TOKEN` })],
      ['POST send', () => send(ID.outsider, ID.bizW)],
      ['POST messages', () => sendDrawer(ID.outsider, ID.bizW)],
      ...READS.map(({ label, call }): [string, () => any] => [label, () => call(ID.outsider, ID.bizW)]),
    ];
    for (const [label, start] of calls) {
      const res = await start();
      expect(res.status, `${label}: ${JSON.stringify(res.body)}`).toBe(403);
      expectNoSecret(res.body, label);
    }
    expect(await businessRowText(ID.bizW), 'bizW byte-identical').toBe(before);
    expect(await messageCount(ID.bizW)).toEqual(counts);
    expect(fetchCalls).toEqual([]);
    await reset(ID.bizW);
  });

  it('[SEC2-F02] the owner of bizW PATCHes bizX\'s config naming bizW in x-business-id and ?businessId=: 403, bizX byte-identical', async () => {
    await reset(ID.bizX);
    const before = await businessRowText(ID.bizX);
    const res = await as(http().patch(`/whatsapp/businesses/${ID.bizX}/config?businessId=${ID.bizW}`), ID.owner)
      .set('x-business-id', ID.bizW)
      .send({ provider: 'meta', accessToken: `${P}ATTACKER_TOKEN`, businessId: ID.bizW });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(await businessRowText(ID.bizX), 'bizX byte-identical').toBe(before);
    const read = await getConfig(ID.owner, ID.bizX);
    expect(read.status).toBe(403);
    expectNoSecret(read.body, 'foreign GET config');
  });
});

describe('R0-SEC2 the webhooks are unchanged (no session, provider checks only)', () => {
  it('[SEC2-H01] GET webhook and GET webhook/:businessId answer the Meta handshake challenge without a session, and refuse a wrong verify token (403)', async () => {
    const q = `hub.mode=subscribe&hub.verify_token=${P}verify&hub.challenge=${P}challenge`;
    for (const url of ['/whatsapp/webhook', `/whatsapp/webhook/${ID.bizW}`]) {
      const ok = await http().get(`${url}?${q}`);
      expect(ok.status, `${url}: ${ok.text}`).toBe(200);
      expect(ok.text).toBe(`${P}challenge`);
      const bad = await http().get(`${url}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=x`);
      expect(bad.status, `${url} wrong token`).toBe(403);
    }
  });

  it('[SEC2-H02] POST webhook/:businessId with an unsigned Meta payload and no session is refused by the signature check (403, not 401) and writes nothing', async () => {
    await reset(ID.bizW);
    await resetConversations();
    const counts = await messageCount(ID.bizW);
    const payload = { object: 'whatsapp_business_account', entry: [{ changes: [{ value: { messages: [{ from: '18685550177', id: `${P}wamid1`, timestamp: '1700000000', text: { body: 'hi' } }] } }] }] };
    const res = await http().post(`/whatsapp/webhook/${ID.bizW}`).set('x-hub-signature-256', 'sha256=deadbeef').send(payload);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/signature/i);
    expect(await messageCount(ID.bizW)).toEqual(counts);
  });
});

/**
 * Review findings this packet cannot close inside its write set
 * (whatsapp.controller.ts, whatsapp.service.ts and these suites). Kept as
 * todos so the gap stays visible in every run of this suite.
 */
describe('R0-SEC2 follow-ups outside the write set', () => {
  it.todo('[SEC2-T01] (review SEC2-R2) GET /identity/businesses/:businessId and GET /identity/businesses answer metaData.whatsapp (phoneNumberId and the credential ciphertexts) to any member, operations:none included: IdentityService.sanitizeBusiness / getBusiness / listBusinesses must strip or mask metaData.whatsapp, and the d11-owner-writes static guard should list it (identity module, outside this write set)');
  it.todo('[SEC2-T02] (review SEC2-R1, second writer) PATCH /identity/businesses/:businessId merges any metaData key, so an owner can still write metaData.whatsapp (another business\'s credential ciphertext or phoneNumberId) past WhatsAppService.saveConfig\'s refusals: IdentityService.updateBusiness must refuse or drop metaData.whatsapp (identity module, outside this write set)');
  it.todo('[SEC2-T03] (review CR-SEC2-2) the web WhatsApp page (apps/web/src/app/app/whatsapp/page.tsx) and the manage drawer render a 403 from GET status as "not connected" with a Connect CTA; they must render it as no access (web, outside this write set; after the CR-SEC2-1 repair it reaches only members with operations: none)');
});
