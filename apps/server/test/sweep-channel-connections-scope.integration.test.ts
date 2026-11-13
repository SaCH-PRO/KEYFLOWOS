/**
 * SWEEP-P0-SCOPES second review repair (findings SV-2 and SV-3, major) — the SEC-1 credential class
 * through the modules/ routes that bind a business's channel or account credential, against a REAL
 * database through the HTTP routes.
 *
 * SV-2 (pre-existing, reproduced by the review on a real database):
 *   - CommunicationsController ran AuthGuard and BusinessGuard only on the channel connection writes,
 *     and PATCH .../connections/:id handed the raw body to ChannelConnectionService.update, which ran
 *     prisma.channelConnection.update({ where: { id }, data }). A STAFF member whose map says settings
 *     'none' overwrote the owner's email connection's token and account; a member of two businesses
 *     sent { businessId: <their own business> } and moved the owner's credentialed connection (its
 *     encrypted token and refresh token) into a business they own.
 *   - SocialController.manualConnect, the same class: the member replaced the business's FACEBOOK
 *     connection with a token of their own.
 * SV-3: MicrosoftOAuthController.buildAuthUrl (GET .../connect/microsoft/businesses/:b/auth-url) ran
 *   AuthGuard and BusinessGuard only. Its signed state carries the businessId alone, and the public
 *   callback writes the Outlook contacts tokens onto that business, so any member who completes the
 *   consent with their own Microsoft account replaces the owner's Outlook connection (the SEC-1
 *   QuickBooks swap again). The census counted write verbs only, so this GET had no row.
 *
 * The rules this suite pins (as SEC-1 ruled the connector credentials: settings admin, OWNER and ADMIN
 * by role default, STAFF none; an explicit map binds every role, D-114 / D-140):
 *   - creating, changing and deleting a channel connection, and connecting WhatsApp, need settings
 *     admin (ModuleScopeGuard, 403 before the handler);
 *   - a channel connection's update writes only its own fields (label, account, token, refresh
 *     token, expiry, scopes, health, provider meta): a businessId, id or provider in the body is not
 *     written, so no member moves a connection to another business, whatever their level;
 *   - SocialController's connection writes (manual connect, OAuth start, OAuth callback, delete) need
 *     settings admin;
 *   - the Outlook contacts consent URL (the state the callback trusts) needs settings admin;
 *   - the connection reads stay open to members and answer no token (the census's secret-read rows).
 *
 * Nothing on the authorization or persistence path is mocked: PrismaService, AuthGuard,
 * BusinessGuard, ModuleScopeGuard, the global ValidationPipe and GlobalHttpExceptionFilter,
 * CommunicationsController with ChannelConnectionService, SocialController with
 * SocialConnectionsService, and MicrosoftOAuthController with MicrosoftOAuthService are real against
 * DATABASE_URL. The stand-ins: identity attachment (`x-test-user`, as AuthMiddleware attaches it), the
 * collaborators no case reaches (content, delivery and AI services; the social post, analytics and
 * ingestion services), and dummy Microsoft OAuth settings, so the consent URL is built and nothing is
 * sent to Microsoft. No provider is reached.
 *
 * Requires DATABASE_URL. Every seeded row carries the `v99m_` prefix and is hard-deleted by raw SQL
 * (sqlLikePrefix) in beforeAll and afterAll. Cases tagged RED-BEFORE fail on the unmodified code.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v99m_';
const ID = {
  owner: `${P}owner`, // OWNER of bizA (its recorded owner) and OWNER of bizC
  admin: `${P}admin`, // ADMIN of bizA, no explicit map (settings admin by role default)
  adminSetNone: `${P}adminSetNone`, // ADMIN of bizA, explicit settings 'none' (D-114)
  staffNone: `${P}staffNone`, // STAFF of bizA, the sweep's member: settings/connect/content none
  setRead: `${P}setRead`, // STAFF of bizA, explicit settings 'read'
  settingsAdmin: `${P}settingsAdmin`, // STAFF of bizA, explicit settings 'admin'
  dual: `${P}dual`, // STAFF of bizA with an all-none map, and OWNER of bizC
  bizA: `${P}bizA`,
  bizC: `${P}bizC`,
};

const OWNER_TOKEN = `${P}owner_app_password_SECRET`;
const OWNER_REFRESH = `${P}owner_refresh_SECRET`;

const MICROSOFT_ENV: Record<string, string> = {
  MICROSOFT_CLIENT_ID: `${P}dummy-client-id`,
  MICROSOFT_REDIRECT_URI: 'http://localhost:3000/api/connect/microsoft/callback',
  MICROSOFT_STATE_SECRET: `${P}dummy-state-secret-0123456789abcdef`,
};
const savedEnv: Record<string, string | undefined> = {};

/**
 * Every outbound fetch the server code under test attempts (WhatsApp's validation, a provider token
 * exchange): recorded and refused, so no case reaches a provider whatever the code does.
 */
const outbound: string[] = [];

let db: any;
let app: any;
let MODULE_SCOPE_KEY = '';
const controllers: Record<string, any> = {};

async function cleanup() {
  for (const sql of [
    `DELETE FROM channel_destinations WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM channel_connections WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM social_connections WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

type Verb = 'get' | 'post' | 'patch' | 'delete';
function send(verb: Verb, url: string, actor: string | undefined, body?: unknown) {
  let r = (request(app.getHttpServer()) as any)[verb](url);
  if (actor) r = r.set('x-test-user', actor);
  return body === undefined ? r : r.send(body);
}

const comms = (biz: string = ID.bizA) => `/communications/businesses/${biz}`;
const social = (biz: string = ID.bizA) => `/social/businesses/${biz}`;
const microsoft = (biz: string = ID.bizA) => `/connect/microsoft/businesses/${biz}/auth-url`;

/** Every channel connection row, whole (the encrypted token and refresh token included): what "nothing written" compares. */
async function channelRows() {
  return db.$queryRawUnsafe(`SELECT to_jsonb(t)::text AS row FROM channel_connections t WHERE business_id LIKE ${sqlLikePrefix(P)} ORDER BY id`);
}
async function socialRows() {
  return db.$queryRawUnsafe(`SELECT to_jsonb(t)::text AS row FROM social_connections t WHERE business_id LIKE ${sqlLikePrefix(P)} ORDER BY id`);
}

/** The owner's credentialed email connection, created through the route as the owner would. */
async function ownerConnection() {
  const res = await send('post', `${comms()}/connections`, ID.owner, {
    provider: 'EMAIL',
    label: 'Owner mailbox',
    accountEmail: 'owner@biz-a.example',
    token: OWNER_TOKEN,
    refreshToken: OWNER_REFRESH,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

let seq = 0;
async function seedFacebook() {
  seq += 1;
  return db.socialConnection.create({
    data: { id: `${P}fb_${seq}`, businessId: ID.bizA, platform: 'FACEBOOK', platformId: `${P}owner_page_${seq}`, accountName: 'Owner page', token: `${P}owner_fb_token_${seq}` },
  });
}

function census(cls: any) {
  const classGuards: any[] = Reflect.getMetadata(GUARDS_METADATA, cls) ?? [];
  return Object.getOwnPropertyNames(cls.prototype)
    .filter((name) => name !== 'constructor')
    .flatMap((name) => {
      const fn = cls.prototype[name];
      const routePath = Reflect.getMetadata(PATH_METADATA, fn);
      if (routePath === undefined) return [];
      const methodGuards: any[] = Reflect.getMetadata(GUARDS_METADATA, fn) ?? [];
      return [{
        key: `${cls.name}.${name}`,
        method: RequestMethod[Reflect.getMetadata(METHOD_METADATA, fn)] as string,
        path: routePath as string,
        guards: [...classGuards, ...methodGuards].map((g) => g.name as string),
        scope: Reflect.getMetadata(MODULE_SCOPE_KEY, fn) as { module: string; minLevel: string } | undefined,
      }];
    });
}

beforeAll(async () => {
  for (const [k, v] of Object.entries(MICROSOFT_ENV)) {
    savedEnv[k] = process.env[k];
    process.env[k] = v;
  }
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    outbound.push(String(input));
    throw new Error('outbound fetch refused in this suite');
  }));
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { Logger, ValidationPipe } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const scopeMod = await import('../src/core/auth/module-scope.guard');
  MODULE_SCOPE_KEY = scopeMod.MODULE_SCOPE_KEY;
  const { CommunicationsController } = await import('../src/modules/communications/communications.controller');
  const { ChannelConnectionService } = await import('../src/modules/communications/channel-connection.service');
  const { OutboundContentService } = await import('../src/modules/communications/outbound-content.service');
  const { DeliveryQueueService } = await import('../src/modules/communications/delivery-queue.service');
  const { ContentAiService } = await import('../src/modules/communications/content-ai.service');
  const { SocialController } = await import('../src/modules/social/social.controller');
  const { SocialService } = await import('../src/modules/social/social.service');
  const { SocialConnectionsService } = await import('../src/modules/social/social-connections.service');
  const { SocialAnalyticsService } = await import('../src/modules/social/social-analytics.service');
  const { MetaSocialIngestionService } = await import('../src/modules/social/meta-social-ingestion.service');
  const { WebhookIngressLoggerService } = await import('../src/core/connectors/webhook-ingress-logger.service');
  const { MicrosoftOAuthController } = await import('../src/modules/connect/microsoft-oauth.controller');
  const { MicrosoftOAuthService } = await import('../src/modules/connect/microsoft-oauth.service');
  const { ConnectorActivityService } = await import('../src/core/connectors/connector-activity.service');
  Object.assign(controllers, { CommunicationsController, SocialController, MicrosoftOAuthController });

  Logger.overrideLogger(false);
  const moduleRef = await Test.createTestingModule({
    controllers: [CommunicationsController, SocialController, MicrosoftOAuthController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      scopeMod.ModuleScopeGuard,
      ChannelConnectionService,
      SocialConnectionsService,
      MicrosoftOAuthService,
      { provide: EventEmitter2, useValue: { emit: () => true } },
      { provide: OutboundContentService, useValue: {} },
      { provide: DeliveryQueueService, useValue: {} },
      { provide: ContentAiService, useValue: {} },
      { provide: SocialService, useValue: {} },
      { provide: SocialAnalyticsService, useValue: {} },
      { provide: MetaSocialIngestionService, useValue: {} },
      { provide: WebhookIngressLoggerService, useValue: {} },
      { provide: ConnectorActivityService, useValue: {} },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
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

  for (const id of Object.values(ID).filter((v) => !v.startsWith(`${P}biz`))) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V99M Biz A', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizC, name: 'V99M Biz C', ownerId: ID.dual } });
  const m = (user: string, biz: string, role: string, permissionScopes?: Record<string, string>) =>
    db.membership.create({
      data: { id: `${P}m_${user.slice(P.length)}_${biz.slice(P.length)}`, userId: user, businessId: biz, role, permissionScopes: permissionScopes ?? undefined },
    });
  const NONE = { crm: 'none', revenue: 'none', bookings: 'none', projects: 'none', content: 'none', expenses: 'none', automations: 'none', storefront: 'none', settings: 'none', ai: 'none', team: 'none', analytics: 'none', operations: 'none', connect: 'none' };
  await m(ID.owner, ID.bizA, 'OWNER');
  await m(ID.owner, ID.bizC, 'OWNER');
  await m(ID.admin, ID.bizA, 'ADMIN');
  await m(ID.adminSetNone, ID.bizA, 'ADMIN', { crm: 'admin', content: 'admin', settings: 'none' });
  await m(ID.staffNone, ID.bizA, 'STAFF', { crm: 'read', settings: 'none', team: 'none', ai: 'none', connect: 'none', content: 'none', revenue: 'none', expenses: 'none' });
  await m(ID.setRead, ID.bizA, 'STAFF', { settings: 'read', content: 'write' });
  await m(ID.settingsAdmin, ID.bizA, 'STAFF', { settings: 'admin' });
  await m(ID.dual, ID.bizA, 'STAFF', NONE);
  await m(ID.dual, ID.bizC, 'OWNER');
}, 120_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  if (app) await app.close();
  if (db) await cleanup();
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

/** The members below settings admin. */
const BELOW_SETTINGS_ADMIN = [ID.staffNone, ID.setRead, ID.adminSetNone, ID.dual];

describe('route census: the credential-binding routes of communications, social and connect/microsoft', () => {
  const GATED: Record<string, string[]> = {
    // Round 1 class repair (CLASS B): syncFromSocial copies the social tokens over the business's channel connections.
    CommunicationsController: ['createConnection', 'updateConnection', 'deleteConnection', 'connectWhatsApp', 'syncFromSocial'],
    SocialController: ['manualConnect', 'oauthStart', 'oauthCallback', 'deleteConnection'],
    MicrosoftOAuthController: ['buildAuthUrl'],
  };

  it('[CHN-C01] RED-BEFORE: each route that sets, replaces or clears a business credential (or starts a consent whose state binds one) runs AuthGuard, BusinessGuard, then ModuleScopeGuard and requires settings admin', () => {
    const problems: string[] = [];
    for (const [cls, handlers] of Object.entries(GATED)) {
      const routes = Object.fromEntries(census(controllers[cls]).map((r) => [r.key.split('.')[1], r]));
      for (const h of handlers) {
        const r = routes[h];
        if (!r) { problems.push(`${cls}.${h} is not a route`); continue; }
        const chain = r.guards.filter((g) => ['AuthGuard', 'BusinessGuard', 'ModuleScopeGuard'].includes(g));
        if (chain.join(',') !== 'AuthGuard,BusinessGuard,ModuleScopeGuard') problems.push(`${cls}.${h} runs ${chain.join(',') || 'no member guard'}`);
        if (r.scope?.module !== 'settings' || r.scope?.minLevel !== 'admin') {
          problems.push(`${cls}.${h} (${r.method} ${r.path}) requires ${r.scope ? `${r.scope.module}:${r.scope.minLevel}` : 'no module scope'}, not settings:admin`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('[CHN-C02] the connection reads keep no module requirement (they answer no token: the census secret-read rows)', () => {
    const comm = Object.fromEntries(census(controllers.CommunicationsController).map((r) => [r.key.split('.')[1], r]));
    const soc = Object.fromEntries(census(controllers.SocialController).map((r) => [r.key.split('.')[1], r]));
    for (const r of [comm.listConnections, comm.getConnection, soc.listConnections, soc.oauthAvailability]) {
      expect(r, 'route exists').toBeTruthy();
      expect(r.scope, r.key).toBeUndefined();
    }
  });
});

describe('SV-2: a channel connection is the business\'s credential (communications)', () => {
  it("[CHN-SYNC-01] RED-BEFORE (round 1 class repair): POST connections/sync-from-social copies every social connection's token over the business's channel connection of that provider; a member below settings admin is refused with 403 and no channel connection is created or overwritten", async () => {
    await db.socialConnection.create({ data: { id: `${P}sc_sync`, businessId: ID.bizA, platform: 'LINKEDIN', platformId: `${P}li_page`, accountName: 'Owner LinkedIn', token: `${P}owner_li_token_SECRET`, status: 'CONNECTED' } });
    const before = await channelRows();
    for (const actor of BELOW_SETTINGS_ADMIN) {
      const res = await send('post', `${comms()}/connections/sync-from-social`, actor, {});
      expect(res.status, actor).toBe(403);
      expect(String(res.body?.message ?? ''), actor).toMatch(/settings requires admin access/);
    }
    expect(await channelRows()).toEqual(before);
    const ok = await send('post', `${comms()}/connections/sync-from-social`, ID.settingsAdmin, {});
    expect([200, 201]).toContain(ok.status);
    await db.$executeRawUnsafe(`DELETE FROM channel_destinations WHERE business_id LIKE ${sqlLikePrefix(P)} AND connection_id IN (SELECT id FROM channel_connections WHERE provider = 'LINKEDIN' AND business_id LIKE ${sqlLikePrefix(P)})`).catch(() => undefined);
    await db.$executeRawUnsafe(`DELETE FROM channel_connections WHERE provider = 'LINKEDIN' AND business_id LIKE ${sqlLikePrefix(P)}`);
    await db.socialConnection.delete({ where: { id: `${P}sc_sync` } });
  });

  it("[CHN-01] RED-BEFORE: a member below settings admin is refused PATCH of the owner's connection with 403 (a new token and account), and the row (its encrypted token included) is unchanged", async () => {
    const id = await ownerConnection();
    const before = await channelRows();
    for (const actor of BELOW_SETTINGS_ADMIN) {
      const res = await send('patch', `${comms()}/connections/${id}`, actor, { token: `${P}attacker_token`, accountEmail: 'attacker@evil.example' });
      expect(res.status, actor).toBe(403);
      expect(String(res.body?.message ?? ''), actor).toMatch(/settings requires admin access/);
    }
    expect(await channelRows()).toEqual(before);
  });

  it("[CHN-02] RED-BEFORE: a member of two businesses is refused moving the owner's credentialed connection into their own business (PATCH { businessId }): 403, the row stays in bizA with its tokens, and the owner still lists it", async () => {
    const id = await ownerConnection();
    const before = await channelRows();
    const res = await send('patch', `${comms()}/connections/${id}`, ID.dual, { businessId: ID.bizC });
    expect(res.status).toBe(403);
    expect(await channelRows()).toEqual(before);
    const owned = await send('get', `${comms()}/connections`, ID.owner);
    expect((owned.body as any[]).map((c) => c.id)).toContain(id);
    const theirs = await send('get', `${comms(ID.bizC)}/connections`, ID.dual);
    expect((theirs.body as any[]).map((c) => c.id)).not.toContain(id);
  });

  it('[CHN-03] RED-BEFORE: an update writes only the connection\'s own fields: the owner (OWNER of both businesses) sending { businessId: bizC, id, provider } with a new label changes the label and nothing else; the row stays in bizA', async () => {
    const id = await ownerConnection();
    const res = await send('patch', `${comms()}/connections/${id}`, ID.owner, { businessId: ID.bizC, id: `${P}forced_id`, provider: 'WHATSAPP', label: 'Owner mailbox (renamed)' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = await db.channelConnection.findUnique({ where: { id } });
    expect(row.businessId).toBe(ID.bizA);
    expect(row.provider).toBe('EMAIL');
    expect(row.label).toBe('Owner mailbox (renamed)');
    expect(await db.channelConnection.findUnique({ where: { id: `${P}forced_id` } })).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain(OWNER_TOKEN);
  });

  it('[CHN-04] RED-BEFORE: creating a connection, deleting the owner\'s, and connecting WhatsApp need settings admin: a member below it gets 403 and nothing is written', async () => {
    const id = await ownerConnection();
    const before = await channelRows();
    for (const actor of BELOW_SETTINGS_ADMIN) {
      const create = await send('post', `${comms()}/connections`, actor, { provider: 'EMAIL', accountEmail: 'attacker@evil.example', token: `${P}attacker_token` });
      expect(create.status, `${actor} create`).toBe(403);
      const del = await send('delete', `${comms()}/connections/${id}`, actor);
      expect(del.status, `${actor} delete`).toBe(403);
      const wa = await send('post', `${comms()}/whatsapp/connect`, actor, { accessToken: `${P}attacker_wa`, waBusinessAccountId: '1' });
      expect(wa.status, `${actor} whatsapp connect`).toBe(403);
    }
    expect(await channelRows()).toEqual(before);
    expect(outbound, 'a refused WhatsApp connect reaches no provider').toEqual([]);
  });

  it('[CHN-05] RED-BEFORE: a creation writes no field the body names beyond the connection\'s own: { businessId: bizC, id } in the owner\'s create body is not written', async () => {
    const res = await send('post', `${comms()}/connections`, ID.owner, { provider: 'EMAIL', accountEmail: 'second@biz-a.example', token: `${P}t2`, businessId: ID.bizC, id: `${P}forced_create` });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.id).not.toBe(`${P}forced_create`);
    const row = await db.channelConnection.findUnique({ where: { id: res.body.id } });
    expect(row.businessId).toBe(ID.bizA);
  });

  it('[CHN-06] settings admin admits: an ADMIN on role defaults and a settings-admin STAFF member update a connection; an ADMIN deletes one; the list stays open to every member and answers no token', async () => {
    const id = await ownerConnection();
    for (const actor of [ID.admin, ID.settingsAdmin]) {
      const res = await send('patch', `${comms()}/connections/${id}`, actor, { label: `${P}by ${actor}` });
      expect(res.status, actor).toBe(200);
    }
    for (const actor of [ID.staffNone, ID.setRead]) {
      const list = await send('get', `${comms()}/connections`, actor);
      expect(list.status, actor).toBe(200);
      expect(JSON.stringify(list.body), actor).not.toContain(OWNER_TOKEN);
      expect(JSON.stringify(list.body), actor).not.toContain(OWNER_REFRESH);
    }
    const del = await send('delete', `${comms()}/connections/${id}`, ID.admin);
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ deleted: true });
  });
});

describe('SV-2: a social connection is the business\'s credential (social)', () => {
  it("[SOC-01] RED-BEFORE: a member below settings admin is refused POST .../connections/facebook/manual with 403, and the owner's FACEBOOK connection is unchanged", async () => {
    await seedFacebook();
    const before = await socialRows();
    for (const actor of BELOW_SETTINGS_ADMIN) {
      const res = await send('post', `${social()}/connections/facebook/manual`, actor, { token: `${P}attacker_fb_token`, platformId: 'attacker_page' });
      expect(res.status, actor).toBe(403);
      expect(String(res.body?.message ?? ''), actor).toMatch(/settings requires admin access/);
    }
    expect(await socialRows()).toEqual(before);
  });

  it("[SOC-02] RED-BEFORE: a member below settings admin is refused starting or completing an OAuth connection and deleting the owner's connection (403), and nothing is written", async () => {
    await seedFacebook();
    const before = await socialRows();
    for (const actor of BELOW_SETTINGS_ADMIN) {
      expect((await send('post', `${social()}/connections/facebook/oauth/start`, actor, {})).status, `${actor} start`).toBe(403);
      expect((await send('post', `${social()}/connections/facebook/oauth/callback`, actor, { code: 'c', state: 's' })).status, `${actor} callback`).toBe(403);
      expect((await send('delete', `${social()}/connections/facebook`, actor)).status, `${actor} delete`).toBe(403);
    }
    expect(await socialRows()).toEqual(before);
  });

  it('[SOC-03] settings admin admits: the owner connects a page by token; an ADMIN reaches the OAuth start and callback (answered by their own checks: no app credentials, no such state) and deletes the connection', async () => {
    const res = await send('post', `${social()}/connections/linkedin/manual`, ID.owner, { token: `${P}owner_li_token`, platformId: `${P}owner_li`, accountName: 'Owner LinkedIn' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await db.socialConnection.findFirst({ where: { businessId: ID.bizA, platform: 'LINKEDIN', platformId: `${P}owner_li` } })).toBeTruthy();
    const start = await send('post', `${social()}/connections/linkedin/oauth/start`, ID.admin, {});
    expect(start.status).toBe(400);
    expect(String(start.body?.message ?? '')).toMatch(/No OAuth credentials configured/);
    const callback = await send('post', `${social()}/connections/linkedin/oauth/callback`, ID.admin, { code: 'c', state: `${P}no-such-state` });
    expect(callback.status).toBe(400);
    expect(String(callback.body?.message ?? '')).toMatch(/Invalid or expired OAuth state/);
    const del = await send('delete', `${social()}/connections/linkedin`, ID.settingsAdmin);
    expect(del.status).toBe(200);
    expect(await db.socialConnection.findFirst({ where: { businessId: ID.bizA, platform: 'LINKEDIN' } })).toBeNull();
  });
});

describe('SV-3: the Outlook contacts consent binds the business, so its start is settings admin territory', () => {
  it('[MSO-01] RED-BEFORE: a member below settings admin (the sweep member, settings read, an ADMIN whose map says settings none) is refused GET .../connect/microsoft/businesses/:b/auth-url with 403: no signed state is issued', async () => {
    for (const actor of [ID.staffNone, ID.setRead, ID.adminSetNone]) {
      const res = await send('get', microsoft(), actor);
      expect(res.status, actor).toBe(403);
      expect(String(res.body?.message ?? ''), actor).toMatch(/settings requires admin access/);
      expect(JSON.stringify(res.body), actor).not.toContain('login.microsoftonline.com');
    }
  });

  it('[MSO-02] the owner and an ADMIN on role defaults get the consent URL, its state naming the business and (round 3, WPH2-1) the member who starts it; a settings admin whose explicit map names no crm read does not (the account receives the business\'s contacts)', async () => {
    for (const actor of [ID.owner, ID.admin]) {
      const res = await send('get', microsoft(), actor);
      expect(res.status, actor).toBe(200);
      const url = new URL(res.body.authUrl);
      expect(url.host, actor).toBe('login.microsoftonline.com');
      // MicrosoftOAuthService.signState: base64 of `${JSON payload}.${hex HMAC}`.
      const decoded = Buffer.from(url.searchParams.get('state') ?? '', 'base64').toString('utf8');
      const payload = JSON.parse(decoded.slice(0, decoded.lastIndexOf('.')));
      expect(payload.businessId, actor).toBe(ID.bizA);
      expect(payload.boundBy, actor).toBe(actor);
    }
    const refused = await send('get', microsoft(), ID.settingsAdmin);
    expect(refused.status).toBe(403);
    expect(String(refused.body?.message ?? '')).toMatch(/crm read access \(you have none\)/);
  });

  it('[MSO-03] a member of another business is refused (BusinessGuard, unchanged)', async () => {
    const res = await send('get', microsoft(ID.bizC), ID.admin);
    expect(res.status).toBe(403);
  });
});
