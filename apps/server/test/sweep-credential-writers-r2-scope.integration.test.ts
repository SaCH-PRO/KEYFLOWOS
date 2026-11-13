/**
 * SWEEP-P0-SCOPES round 2 class repair, CLASS B — the credential writers the round 2 hunt found
 * (CW-1..CW-4) need settings admin, or the Google owner rule (D-99), against a REAL database through
 * the HTTP routes.
 *
 * Each was a membership-only route whose write the round 1 call graph could not see, because its
 * leaves were a fixed list of models and columns (CW-5). The census graph now takes its leaves from
 * the schema and the binding rules (rest-scope-census.spec.ts, CEN-10e) and found exactly these:
 *   - CW-1: PUT /ai/businesses/:b/ai/preferences wrote, replaced and cleared the business's BYOK
 *     provider keys (ai_memories settings / ai_preferences): every AI call of the business then ran on
 *     the key a STAFF member typed. Now settings admin.
 *   - CW-2: POST /communications/businesses/:b/connections/:c/destinations replaced a page's own
 *     access token (ChannelDestination.destinationMeta) or added a page under the owner's credentialed
 *     connection, and PATCH .../destinations/:d/toggle turned the owner's page off. Now settings admin,
 *     as the connection writes are (SV-2); and a destination read answers no access token.
 *   - CW-3: POST /connect/businesses/:b/business-profile/active-location moved the account and
 *     location the owner's Google Business Profile tokens act on (Business.bpAccountId,
 *     bpLocationId). Now the Google owner rule (D-99: GOOGLE_CONNECT_OWNER_ONLY), as the calendar
 *     settings doors answer for calendarId.
 *   - CW-4: POST /connectors/businesses/:b/authenticate/:type is Connect: for WhatsApp it records a
 *     connected verification that lifts the explicit disconnect only settings admin may write. Now
 *     settings admin (the Google owner rules for those connections), and so is POST smoke/whatsapp,
 *     whose passed check records the same.
 *
 * The rule (as SEC-1 ruled the connector credentials): settings admin, OWNER and ADMIN by role default,
 * STAFF none; an explicit map binds every role (D-114 / D-140), so an ADMIN whose map says settings
 * 'none' and an ADMIN whose stored scopes are a JSON array (every module none, SV-4) are refused, and a
 * STAFF member given settings 'admin' passes. Settings write is not enough. A member of two businesses
 * is held to the business the route names.
 *
 * Nothing on the authorization or persistence path is mocked: PrismaService, AuthGuard, BusinessGuard,
 * ModuleScopeGuard, the global ValidationPipe and GlobalHttpExceptionFilter, the real controllers
 * (AiController, CommunicationsController, ConnectController, ConnectorController) and the services
 * that write (ModelGatewayService, ChannelConnectionService, GoogleBusinessProfileService,
 * ConnectorRegistryService with the real WhatsAppConnector, ConnectorCredentialsService) against
 * DATABASE_URL. The stand-ins: identity attachment (`x-test-user`) and the collaborators no case
 * reaches (Nest's useMocker). Every outbound fetch is recorded and refused, so no case reaches a
 * provider. WHATSAPP_ACCESS_TOKEN and BYOK_ENCRYPTION_SECRET are dummy values for this suite.
 *
 * Requires DATABASE_URL. Every seeded row carries the `v99y_` prefix and is hard-deleted by raw SQL
 * (sqlLikePrefix) in beforeAll and afterAll. Cases tagged RED-BEFORE fail on the unmodified code.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v99y_';
const ID = {
  owner: `${P}owner`, // OWNER of bizA, no explicit map
  admin: `${P}admin`, // ADMIN of bizA, no explicit map (settings admin by role default)
  staffDefault: `${P}staffDefault`, // STAFF of bizA, no explicit map (settings none by role default)
  staffNone: `${P}staffNone`, // STAFF of bizA, every module none
  setWrite: `${P}setWrite`, // STAFF of bizA, explicit settings 'write'
  adminSetNone: `${P}adminSetNone`, // ADMIN of bizA, explicit { settings: none } (D-114)
  adminArray: `${P}adminArray`, // ADMIN of bizA whose stored scopes are a JSON array [] (SV-4)
  dual: `${P}dual`, // STAFF (every module none) of bizA, OWNER of bizC
  settingsAdmin: `${P}settingsAdmin`, // STAFF of bizA, explicit settings 'admin'
  bizA: `${P}bizA`,
  bizC: `${P}bizC`,
  connMeta: `${P}conn_meta`,
  destPage: `${P}dest_page`,
};
const BELOW_SETTINGS_ADMIN = [ID.staffDefault, ID.staffNone, ID.setWrite, ID.adminSetNone, ID.adminArray, ID.dual];
const NON_OWNERS = [...BELOW_SETTINGS_ADMIN, ID.admin, ID.settingsAdmin];
const OWNER_PAGE_TOKEN = `${P}owner_page_access_token_SECRET`;
const EVERY_MODULE_NONE = {
  settings: 'none', crm: 'none', revenue: 'none', bookings: 'none', projects: 'none', content: 'none', expenses: 'none', automations: 'none',
  storefront: 'none', ai: 'none', team: 'none', analytics: 'none', operations: 'none', connect: 'none',
};

const outbound: string[] = [];
let db: any;
let app: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM channel_destinations WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM channel_connections WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM ai_memories WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM connector_statuses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

type Verb = 'get' | 'post' | 'put' | 'patch' | 'delete';
function send(verb: Verb, url: string, actor: string | undefined, body?: unknown) {
  let r = (request(app.getHttpServer()) as any)[verb](url);
  if (actor) r = r.set('x-test-user', actor);
  return body === undefined ? r : r.send(body);
}

const rowsOf = (table: string, column = 'business_id') =>
  db.$queryRawUnsafe(`SELECT to_jsonb(t)::text AS row FROM ${table} t WHERE ${column} LIKE ${sqlLikePrefix(P)} ORDER BY id`);
const bpBinding = () => db.business.findUnique({ where: { id: ID.bizA }, select: { bpAccountId: true, bpLocationId: true, bpAccessToken: true } });
const whatsappRow = async () => {
  const row = await db.connectorStatus.findUnique({ where: { businessId_connectorType: { businessId: ID.bizA, connectorType: 'whatsapp' } } });
  return { status: row?.status ?? null, record: (row?.metadata as any)?.whatsappVerification ?? null };
};

const savedEnv = { WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID, BYOK_ENCRYPTION_SECRET: process.env.BYOK_ENCRYPTION_SECRET };

beforeAll(async () => {
  process.env.WHATSAPP_ACCESS_TOKEN = `${P}dummy_platform_token`;
  delete process.env.WHATSAPP_PHONE_NUMBER_ID;
  process.env.BYOK_ENCRYPTION_SECRET = `${P}dummy_byok_secret_for_this_suite_only`;

  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    outbound.push(url);
    throw new Error(`v99y: no provider traffic (${url})`);
  }) as any);

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { AiController } = await import('../src/modules/ai/ai.controller');
  const { ModelGatewayService } = await import('../src/modules/ai/model-gateway.service');
  const { CommunicationsController } = await import('../src/modules/communications/communications.controller');
  const { ChannelConnectionService } = await import('../src/modules/communications/channel-connection.service');
  const { ConnectController } = await import('../src/modules/connect/connect.controller');
  const { GoogleBusinessProfileService } = await import('../src/modules/connect/google-business-profile.service');
  const { ConnectorController } = await import('../src/core/connectors/connector.controller');
  const { ConnectorRegistryService } = await import('../src/core/connectors/connector-registry.service');
  const { ConnectorCredentialsService } = await import('../src/core/connectors/connector-credentials.service');
  const { WhatsAppConnector } = await import('../src/core/connectors/implementations/whatsapp.connector');

  const moduleRef = await Test.createTestingModule({
    controllers: [AiController, CommunicationsController, ConnectController, ConnectorController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      CrmRateLimitGuard,
      ModelGatewayService,
      ChannelConnectionService,
      // its constructor names PrismaService by type only (no @Inject), which the test transform does not carry
      { provide: GoogleBusinessProfileService, useFactory: (prisma: any) => new GoogleBusinessProfileService(prisma), inject: [PrismaService] },
      ConnectorRegistryService,
      ConnectorCredentialsService,
      WhatsAppConnector,
      { provide: EventEmitter2, useValue: { emit: () => true, emitAsync: async () => [], on: () => undefined } },
    ],
  })
    .useMocker(() => ({}))
    .compile();
  moduleRef.get(ConnectorRegistryService).register(moduleRef.get(WhatsAppConnector));

  app = moduleRef.createNestApplication({ logger: false });
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers['x-test-user'];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup();
  for (const id of [ID.owner, ID.admin, ID.staffDefault, ID.staffNone, ID.setWrite, ID.adminSetNone, ID.adminArray, ID.dual, ID.settingsAdmin]) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({
    data: { id: ID.bizA, name: 'V99Y Biz A', ownerId: ID.owner, bpAccessToken: `${P}owner_bp_access`, bpRefreshToken: `${P}owner_bp_refresh`, bpAccountId: 'acct_owner_1', bpLocationId: 'loc_owner_storefront' },
  });
  await db.business.create({ data: { id: ID.bizC, name: 'V99Y Biz C', ownerId: ID.dual } });
  const m = (user: string, role: string, permissionScopes?: unknown, biz = ID.bizA) =>
    db.membership.create({ data: { id: `${P}m_${user.slice(P.length)}_${biz.slice(P.length)}`, userId: user, businessId: biz, role, permissionScopes: permissionScopes ?? undefined } });
  await m(ID.owner, 'OWNER');
  await m(ID.admin, 'ADMIN');
  await m(ID.staffDefault, 'STAFF');
  await m(ID.staffNone, 'STAFF', EVERY_MODULE_NONE);
  await m(ID.setWrite, 'STAFF', { settings: 'write' });
  await m(ID.adminSetNone, 'ADMIN', { settings: 'none', crm: 'admin', content: 'admin', ai: 'admin', connect: 'admin' });
  await m(ID.adminArray, 'ADMIN', []);
  await m(ID.dual, 'STAFF', EVERY_MODULE_NONE);
  await m(ID.dual, 'OWNER', undefined, ID.bizC);
  await m(ID.settingsAdmin, 'STAFF', { settings: 'admin' });
  await db.channelConnection.create({ data: { id: ID.connMeta, businessId: ID.bizA, provider: 'META', label: 'Owner Meta', token: `${P}owner_meta_token` } });
  await db.channelDestination.create({
    data: { id: ID.destPage, businessId: ID.bizA, connectionId: ID.connMeta, platform: 'FACEBOOK_PAGE', platformId: 'page_owner_123', displayName: 'Owner page', destinationMeta: { accessToken: OWNER_PAGE_TOKEN } },
  });
}, 120_000);

afterAll(async () => {
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  if (app) await app.close();
  if (db) await cleanup();
});

describe('CW-1: the business\'s BYOK provider keys (ai_memories settings / ai_preferences)', () => {
  const prefs = `/ai/businesses/${ID.bizA}/ai/preferences`;

  it('[CW2-AI-01] RED-BEFORE: a member below settings admin (STAFF on defaults or with none, STAFF with settings write, an ADMIN whose map says settings none, an ADMIN with scopes [], a member who owns another business) is refused with 403 writing, replacing or clearing a BYOK key, and the stored preferences are unchanged', async () => {
    const owner = await send('put', prefs, ID.owner, { byokOpenai: `${P}sk-owner-openai-SECRET`, byokAnthropic: `${P}sk-ant-owner-SECRET` });
    expect(owner.status).toBe(200);
    const before = await rowsOf('ai_memories');
    expect(before.length).toBe(1);
    for (const actor of BELOW_SETTINGS_ADMIN) {
      const write = await send('put', prefs, actor, { byokOpenai: `${P}sk-attacker-${actor.slice(P.length)}` });
      expect(write.status, `${actor} write`).toBe(403);
      expect(String(write.body?.message ?? ''), actor).toMatch(/settings requires admin access/);
      const clear = await send('put', prefs, actor, { byokAnthropic: null });
      expect(clear.status, `${actor} clear`).toBe(403);
    }
    expect(await rowsOf('ai_memories')).toEqual(before);
  });

  it('[CW2-AI-02] settings admin writes them: an ADMIN on role defaults and a STAFF member given settings admin each get 200 and the stored row changes', async () => {
    for (const actor of [ID.admin, ID.settingsAdmin]) {
      const before = await rowsOf('ai_memories');
      const res = await send('put', prefs, actor, { byokOpenai: `${P}sk-${actor.slice(P.length)}` });
      expect(res.status, actor).toBe(200);
      expect(await rowsOf('ai_memories'), actor).not.toEqual(before);
    }
  });
});

describe('CW-2: a page destination\'s own access token (ChannelDestination.destinationMeta)', () => {
  const dests = `/communications/businesses/${ID.bizA}`;

  it('[CW2-DST-01] RED-BEFORE: a member below settings admin is refused with 403 replacing the owner\'s page token, adding a page under the owner\'s connection, or turning the owner\'s page off, and no destination row changes', async () => {
    const before = await rowsOf('channel_destinations');
    for (const actor of BELOW_SETTINGS_ADMIN) {
      const replace = await send('post', `${dests}/connections/${ID.connMeta}/destinations`, actor, {
        platform: 'FACEBOOK_PAGE', platformId: 'page_owner_123', destinationMeta: { accessToken: `${P}attacker_page_token_${actor.slice(P.length)}` },
      });
      expect(replace.status, `${actor} replace`).toBe(403);
      expect(String(replace.body?.message ?? ''), actor).toMatch(/settings requires admin access/);
      const add = await send('post', `${dests}/connections/${ID.connMeta}/destinations`, actor, {
        platform: 'INSTAGRAM_BUSINESS', platformId: 'ig_attacker_999', destinationMeta: { accessToken: `${P}attacker_ig_token` },
      });
      expect(add.status, `${actor} add`).toBe(403);
      const toggle = await send('patch', `${dests}/destinations/${ID.destPage}/toggle`, actor, { isActive: false });
      expect(toggle.status, `${actor} toggle`).toBe(403);
    }
    expect(await rowsOf('channel_destinations')).toEqual(before);
  });

  it('[CW2-DST-02] RED-BEFORE: a destination read answers no access token (GET destinations, as any member)', async () => {
    const res = await send('get', `${dests}/destinations`, ID.staffDefault);
    expect(res.status).toBe(200);
    expect(res.body.map((d: any) => d.id)).toContain(ID.destPage);
    expect(res.body.filter((d: any) => d.destinationMeta?.accessToken !== undefined).map((d: any) => d.id)).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain(OWNER_PAGE_TOKEN);
  });

  it('[CW2-DST-03] settings admin manages destinations: a STAFF member given settings admin adds one (201) and toggles it (200), and no answer carries a token', async () => {
    const add = await send('post', `${dests}/connections/${ID.connMeta}/destinations`, ID.settingsAdmin, {
      platform: 'INSTAGRAM_BUSINESS', platformId: 'ig_admin_1', destinationMeta: { accessToken: `${P}admin_ig_token` },
    });
    expect(add.status).toBe(201);
    expect(JSON.stringify(add.body)).not.toContain(`${P}admin_ig_token`);
    const toggle = await send('patch', `${dests}/destinations/${add.body.id}/toggle`, ID.settingsAdmin, { isActive: false });
    expect(toggle.status).toBe(200);
    expect(JSON.stringify(toggle.body)).not.toContain(`${P}admin_ig_token`);
    expect((await db.channelDestination.findUnique({ where: { id: add.body.id } })).isActive).toBe(false);
  });
});

describe('CW-3: the Google Business Profile account and location the owner\'s tokens act on (D-99)', () => {
  const loc = `/connect/businesses/${ID.bizA}/business-profile/active-location`;

  it('[CW2-BP-01] RED-BEFORE: every member who is not the owner, an ADMIN and a settings admin included, is refused with 403 GOOGLE_CONNECT_OWNER_ONLY, and the stored account and location are unchanged', async () => {
    const before = await bpBinding();
    for (const actor of NON_OWNERS) {
      const res = await send('post', loc, actor, { accountId: `acct_${actor.slice(P.length)}`, locationId: `loc_${actor.slice(P.length)}` });
      expect(res.status, actor).toBe(403);
      expect(JSON.stringify(res.body), actor).toMatch(/GOOGLE_CONNECT_OWNER_ONLY/);
    }
    expect(await bpBinding()).toEqual(before);
  });

  it('[CW2-BP-02] the owner sets them (201)', async () => {
    const res = await send('post', loc, ID.owner, { accountId: 'acct_owner_2', locationId: 'loc_owner_2' });
    expect(res.status).toBe(201);
    expect(await bpBinding()).toMatchObject({ bpAccountId: 'acct_owner_2', bpLocationId: 'loc_owner_2' });
  });
});

describe('CW-4: Connect (POST authenticate/:type) and a passed WhatsApp smoke test lift an explicit disconnect', () => {
  const conn = `/connectors/businesses/${ID.bizA}`;

  it('[CW2-CON-01] RED-BEFORE: after the owner\'s explicit WhatsApp disconnect, a member below settings admin is refused Connect (authenticate) and the smoke test with 403, and the disconnect stands', async () => {
    expect((await send('post', `${conn}/disconnect/whatsapp`, ID.owner)).status).toBe(201);
    const after = await whatsappRow();
    expect(after).toMatchObject({ status: 'disconnected', record: { state: 'disconnected' } });
    for (const actor of BELOW_SETTINGS_ADMIN) {
      const auth = await send('post', `${conn}/authenticate/whatsapp`, actor);
      expect(auth.status, `${actor} authenticate`).toBe(403);
      expect(String(auth.body?.message ?? ''), actor).toMatch(/settings requires admin access/);
      const smoke = await send('post', `${conn}/smoke/whatsapp`, actor);
      expect(smoke.status, `${actor} smoke`).toBe(403);
    }
    expect(await whatsappRow()).toEqual(after);
    expect((await send('get', `${conn}/health/whatsapp`, ID.owner)).body?.status).toBe('disconnected');
  });

  it('[CW2-CON-02] RED-BEFORE: Connect of a Google connection is the owner\'s (D-99): an ADMIN on role defaults gets 403 GOOGLE_CONNECT_OWNER_ONLY', async () => {
    const res = await send('post', `${conn}/authenticate/google_calendar`, ID.admin);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).toMatch(/GOOGLE_CONNECT_OWNER_ONLY/);
  });

  it('[CW2-CON-03] settings admin connects WhatsApp again (the platform path, no provider call): 201 connected', async () => {
    const res = await send('post', `${conn}/authenticate/whatsapp`, ID.settingsAdmin);
    expect(res.status).toBe(201);
    expect(res.body?.connected).toBe(true);
    expect((await whatsappRow()).record?.state).toBe('connected');
  });

  it('[CW2-NET] no case reached a provider over the network', () => {
    expect(outbound).toEqual([]);
  });
});
