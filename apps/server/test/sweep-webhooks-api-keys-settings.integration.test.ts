/**
 * SWEEP-P0-SCOPES (browser sweep 2026-11-13, BUG-001 blocker and BUG-013 major) — outbound
 * webhooks and API keys are settings territory, against a REAL database through the HTTP routes.
 *
 * BUG-001 (re-checked 2026-11-13): a STAFF member whose scope map says settings 'none' listed every
 * webhook of the business with its signing secret (GET /webhooks/businesses/:id/webhooks returned
 * the whole row) and registered a webhook that sends invoice events to any URL (POST 201, a new
 * secret in the answer). WebhooksController ran AuthGuard and BusinessGuard only.
 *
 * BUG-013: the same member created API keys (POST 201 with the raw kf_ key) and revoked the owner's
 * key (DELETE 200). ApiKeysController ran AuthGuard and BusinessGuard only.
 *
 * The rules this suite pins (the settings module, as the existing settings routes read it: OWNER
 * and ADMIN hold settings admin by role default, STAFF none; an explicit scope map binds every role,
 * D-114 / D-140):
 *   - webhook configuration reads (the list, the delivery log) need settings read; every webhook
 *     write (create, delete, enable/disable, send a test delivery) needs settings write;
 *   - a webhook's signing secret is answered in the create answer, and afterwards only to a member
 *     with settings admin (the owner and ADMINs by role default; review CR-5: the owner could no
 *     longer read an existing webhook's secret); a settings write member lists webhooks with their
 *     full URL and no secret; a settings read member gets the receiver's origin only (review SEC-3:
 *     for Slack, Zapier and Make hooks the URL path is itself the credential), in the list and in
 *     the delivery log;
 *   - a webhook's events carry other modules' records (invoices, contacts, bookings, store orders),
 *     so the member who creates one, or turns one back on, must hold read on the module of every
 *     event it subscribes to (revenue for invoice.*, crm with every contact in view for contact.*,
 *     bookings for booking.*, storefront for store_order.*, ...; review SEC-2, D-114, D-100); an
 *     event the server does not know is a 400; a contact row carries the stored money signals, so
 *     contact.* also needs revenue read (second review SV-1, D-100);
 *   - a booking event carries the booking's contact as the fixed person view (id, name, email;
 *     round 1 class repair, CLASS A: the phone too is withheld, as the invoice routes withhold it),
 *     never the whole row (second review SV-1: a PRIVATE contact's owner, internal note and money
 *     signals went to a bookings-read member's URL);
 *   - a webhook's signing secret and full URL go only to a reader who could have created it: the
 *     settings level above and the reads its events need (second review SV-5: an ADMIN bound by
 *     D-114 read the owner's invoice webhook's secret and signed forged invoice.paid deliveries);
 *   - a webhook URL must be http(s) to a public address: the repo's outbound-address guard
 *     (core/security/outbound-address.ts) refuses a loopback, private, link-local (cloud metadata)
 *     or otherwise non-public host at create (400, nothing written) and again at every delivery,
 *     which connects only to the address it checked (a stored row from before the check reaches
 *     nothing);
 *   - API keys are settings admin territory: listing needs settings read, creating and revoking need
 *     settings admin (review CR-3: an ADMIN who may create a key may revoke one; no ruling makes
 *     revoking owner-only, which stays an owner question in the census).
 *
 * Nothing on the authorization or persistence path is mocked: PrismaService, AuthGuard,
 * BusinessGuard, ModuleScopeGuard, the global ValidationPipe and GlobalHttpExceptionFilter,
 * WebhooksController, WebhookDispatcherService, ApiKeysController and ApiKeysService are real
 * against DATABASE_URL. The stand-ins: identity attachment (a test middleware reads `x-test-user`
 * and attaches the seeded user row as AuthMiddleware would), and the Stripe ledger door the legacy
 * Stripe route of WebhooksController hands events to (PaymentsService; never called here). A local
 * HTTP sink on 127.0.0.1 records any delivery that reaches it. Every "public" URL here is in
 * 203.0.113.0/24 (TEST-NET-3, documentation only), so no case can send a delivery anywhere real.
 *
 * Requires DATABASE_URL. Every seeded row carries the `v99w_` prefix and is hard-deleted by raw SQL
 * (sqlLikePrefix) in beforeAll and afterAll. Cases tagged RED-BEFORE fail on the unmodified code.
 */
import 'reflect-metadata';
import path from 'path';
import http from 'http';
import type { AddressInfo } from 'net';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { sqlLikePrefix } from './helpers/sql-like.js';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v99w_';
const ID = {
  owner: `${P}owner`, // OWNER of bizA, no explicit map (settings admin by role default)
  coOwner: `${P}coOwner`, // OWNER membership of bizA, not the recorded owner (D-125: an owner)
  admin: `${P}admin`, // ADMIN of bizA, no explicit map (settings admin by role default)
  adminNone: `${P}adminNone`, // ADMIN of bizA, explicit settings 'none' (an explicit map binds ADMIN too, D-114)
  staffNone: `${P}staffNone`, // STAFF of bizA, the sweep's member: settings/team/ai/connect/revenue/expenses none
  staffDefault: `${P}staffDefault`, // STAFF of bizA, no explicit map (settings none by role default)
  settingsRead: `${P}settingsRead`, // STAFF of bizA, explicit settings 'read'
  settingsWrite: `${P}settingsWrite`, // STAFF of bizA, explicit settings 'write' (revenue none: absent from the map)
  settingsWriteRevenue: `${P}settingsWriteRevenue`, // STAFF of bizA, explicit settings 'write' and revenue 'read'
  settingsWriteCrm: `${P}settingsWriteCrm`, // STAFF of bizA, explicit settings 'write' and crm 'read'
  settingsWriteCrmOwned: `${P}settingsWriteCrmOwned`, // STAFF of bizA, settings 'write', crm 'read' but crm_view 'owned' (their own book only)
  adminSettingsOnly: `${P}adminSettingsOnly`, // ADMIN of bizA, explicit {settings: admin, revenue: none, crm: none} (D-114 binds the ADMIN)
  settingsAdmin: `${P}settingsAdmin`, // STAFF of bizA, explicit settings 'admin' (every other module absent: none)
  settingsAdminRevenue: `${P}settingsAdminRevenue`, // STAFF of bizA, explicit settings 'admin' and revenue 'read' (crm none)
  settingsWriteCrmRevenue: `${P}settingsWriteCrmRevenue`, // STAFF of bizA, explicit settings 'write', crm 'read' and revenue 'read'
  outsider: `${P}outsider`, // OWNER of bizB, no membership in bizA
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
};

let db: any;
let app: any;
let dispatcher: any;
let MODULE_SCOPE_KEY = '';
const controllers: Record<string, any> = {};

/** The local sink: every request that reaches it, by path. */
const sinkHits: Array<{ path: string; body: string }> = [];
let sink: http.Server;
let sinkPort = 0;

async function cleanup() {
  for (const sql of [
    `DELETE FROM bookings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM services WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM webhooks WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM api_keys WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

const hooks = (biz: string = ID.bizA) => `/webhooks/businesses/${biz}/webhooks`;
const keys = (biz: string = ID.bizA) => `/api/businesses/${biz}/api-keys`;

let seq = 0;
/** A webhook row of `biz`, seeded directly (as one stored before this packet would be). */
async function seedWebhook(biz: string = ID.bizA, data: Record<string, unknown> = {}) {
  seq += 1;
  return db.webhook.create({
    data: {
      id: `${P}wh_${seq}`,
      businessId: biz,
      name: `${P}Owner ERP ${seq}`,
      url: 'https://203.0.113.10/v99w-erp',
      events: ['invoice.created', 'invoice.sent', 'invoice.paid'],
      secret: `${P}secret_${seq}_${'a'.repeat(40)}`,
      isActive: true,
      ...data,
    },
  });
}

async function seedApiKey(biz: string = ID.bizA) {
  seq += 1;
  return db.apiKey.create({
    data: { id: `${P}key_${seq}`, businessId: biz, name: `${P}Owner key ${seq}`, prefix: `kf_${String(seq).padStart(5, '0')}`, hashedKey: `${P}hash_${seq}`, scopes: ['contacts:read'] },
  });
}

async function webhookRows(biz: string = ID.bizA) {
  return db.$queryRawUnsafe(`SELECT to_jsonb(t)::text AS row FROM webhooks t WHERE business_id = '${biz}' ORDER BY id`);
}
async function apiKeyRows(biz: string = ID.bizA) {
  return db.$queryRawUnsafe(`SELECT to_jsonb(t)::text AS row FROM api_keys t WHERE business_id = '${biz}' ORDER BY id`);
}

/** The routes of a controller class through Nest's own metadata, with the guard chain and handler scope. */
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
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  sink = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      sinkHits.push({ path: req.url ?? '', body });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  await new Promise<void>((resolve) => sink.listen(0, '127.0.0.1', () => resolve()));
  sinkPort = (sink.address() as AddressInfo).port;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const scopeMod = await import('../src/core/auth/module-scope.guard');
  MODULE_SCOPE_KEY = scopeMod.MODULE_SCOPE_KEY;
  const { ModuleScopeGuard } = scopeMod;
  const { WebhooksController } = await import('../src/modules/webhooks/webhooks.controller');
  const { WebhookDispatcherService } = await import('../src/modules/webhooks/webhook-dispatcher.service');
  const { PaymentsService } = await import('../src/modules/payments/payments.service');
  const { ApiKeysController } = await import('../src/modules/api-keys/api-keys.controller');
  const { ApiKeysService } = await import('../src/modules/api-keys/api-keys.service');
  Object.assign(controllers, { WebhooksController, ApiKeysController });

  const moduleRef = await Test.createTestingModule({
    controllers: [WebhooksController, ApiKeysController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      WebhookDispatcherService,
      ApiKeysService,
      // The legacy Stripe route's ledger door; no case here reaches it.
      { provide: PaymentsService, useValue: { handleStripeWebhook: async () => { throw new Error('not under test'); } } },
    ],
  }).compile();
  dispatcher = moduleRef.get(WebhookDispatcherService);

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
  await db.business.create({ data: { id: ID.bizA, name: 'V99W Biz A', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizB, name: 'V99W Biz B', ownerId: ID.outsider } });
  const m = (user: string, biz: string, role: string, permissionScopes?: Record<string, string>) =>
    db.membership.create({
      data: { id: `${P}m_${user.slice(P.length)}_${biz.slice(P.length)}`, userId: user, businessId: biz, role, permissionScopes: permissionScopes ?? undefined },
    });
  await m(ID.owner, ID.bizA, 'OWNER');
  await m(ID.coOwner, ID.bizA, 'OWNER');
  await m(ID.admin, ID.bizA, 'ADMIN');
  await m(ID.adminNone, ID.bizA, 'ADMIN', { crm: 'admin', settings: 'none' });
  await m(ID.staffNone, ID.bizA, 'STAFF', { crm: 'read', settings: 'none', team: 'none', ai: 'none', connect: 'none', revenue: 'none', expenses: 'none' });
  await m(ID.staffDefault, ID.bizA, 'STAFF');
  await m(ID.settingsRead, ID.bizA, 'STAFF', { settings: 'read' });
  await m(ID.settingsWrite, ID.bizA, 'STAFF', { settings: 'write' });
  await m(ID.settingsWriteRevenue, ID.bizA, 'STAFF', { settings: 'write', revenue: 'read' });
  await m(ID.settingsWriteCrm, ID.bizA, 'STAFF', { settings: 'write', crm: 'read' });
  await m(ID.settingsWriteCrmOwned, ID.bizA, 'STAFF', { settings: 'write', crm: 'read', crm_view: 'owned' });
  await m(ID.adminSettingsOnly, ID.bizA, 'ADMIN', { settings: 'admin', revenue: 'none', crm: 'none' });
  await m(ID.settingsAdmin, ID.bizA, 'STAFF', { settings: 'admin' });
  await m(ID.settingsAdminRevenue, ID.bizA, 'STAFF', { settings: 'admin', revenue: 'read' });
  await m(ID.settingsWriteCrmRevenue, ID.bizA, 'STAFF', { settings: 'write', crm: 'read', revenue: 'read' });
  await m(ID.outsider, ID.bizB, 'OWNER');
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (sink) await new Promise<void>((resolve) => sink.close(() => resolve()));
  if (db) await cleanup();
});

describe('route census: webhooks.controller.ts and api-keys.controller.ts', () => {
  it("[WHK-C01] RED-BEFORE: every business route of WebhooksController runs AuthGuard, BusinessGuard, then ModuleScopeGuard, and requires settings: read for a GET, write for every other verb (the legacy signed Stripe route and health stay public)", () => {
    const routes = census(controllers.WebhooksController);
    const problems: string[] = [];
    for (const r of routes) {
      if (!r.path.startsWith('businesses/')) continue;
      for (const g of ['AuthGuard', 'BusinessGuard', 'ModuleScopeGuard']) {
        if (!r.guards.includes(g)) problems.push(`${r.key} does not run ${g}`);
      }
      if (r.guards.indexOf('ModuleScopeGuard') >= 0 && r.guards.indexOf('ModuleScopeGuard') < r.guards.indexOf('BusinessGuard')) {
        problems.push(`${r.key} runs ModuleScopeGuard before BusinessGuard`);
      }
      const want = r.method === 'GET' ? 'read' : 'write';
      if (r.scope?.module !== 'settings' || r.scope?.minLevel !== want) {
        problems.push(`${r.key} (${r.method} ${r.path}) requires ${r.scope ? `${r.scope.module}:${r.scope.minLevel}` : 'no module scope'}, not settings:${want}`);
      }
    }
    expect(routes.filter((r) => r.path.startsWith('businesses/')).length).toBe(6);
    expect(problems).toEqual([]);
  });

  it('[AK-C01] RED-BEFORE: ApiKeysController runs AuthGuard, BusinessGuard, then ModuleScopeGuard; list needs settings read, create and revoke settings admin', () => {
    const routes = census(controllers.ApiKeysController);
    const got = Object.fromEntries(routes.map((r) => [r.key, { guards: r.guards.filter((g) => ['AuthGuard', 'BusinessGuard', 'ModuleScopeGuard'].includes(g)), scope: r.scope }]));
    const chain = ['AuthGuard', 'BusinessGuard', 'ModuleScopeGuard'];
    expect(got).toEqual({
      'ApiKeysController.list': { guards: chain, scope: { module: 'settings', minLevel: 'read' } },
      'ApiKeysController.create': { guards: chain, scope: { module: 'settings', minLevel: 'admin' } },
      'ApiKeysController.revoke': { guards: chain, scope: { module: 'settings', minLevel: 'admin' } },
    });
  });
});

describe('BUG-001: webhook configuration and signing secrets are settings territory', () => {
  it('[WHK-01] RED-BEFORE: a member without settings read (the sweep member, STAFF on role defaults, an ADMIN whose explicit map says none) is refused the webhook list with 403, and the answer carries no secret', async () => {
    const wh = await seedWebhook();
    for (const actor of [ID.staffNone, ID.staffDefault, ID.adminNone]) {
      const res = await send('get', hooks(), actor);
      expect(res.status, actor).toBe(403);
      expect(JSON.stringify(res.body), actor).not.toContain(wh.secret);
      expect(String(res.body?.message ?? ''), actor).toMatch(/settings requires read access/);
    }
  });

  it('[WHK-02] (review CR-5; second review SV-5) a member with settings admin who reads the module of the webhook\'s events (the owner, a co-owner, an ADMIN on role defaults, a settings-admin STAFF member with revenue read for this invoice webhook) lists the webhooks with the full URL and the signing secret, so an existing webhook\'s secret can be read again', async () => {
    const wh = await seedWebhook();
    for (const actor of [ID.owner, ID.coOwner, ID.admin, ID.settingsAdminRevenue]) {
      const res = await send('get', hooks(), actor);
      expect(res.status, actor).toBe(200);
      const row = (res.body as any[]).find((w) => w.id === wh.id);
      expect(row, actor).toBeTruthy();
      expect(row.url, actor).toBe(wh.url);
      expect(row.secret, actor).toBe(wh.secret);
    }
  });

  it('[WHK-02b] RED-BEFORE (review SEC-3): a settings write member (who reads the events\' module: revenue for this invoice webhook) lists the full URL and no secret; a settings read member gets the receiver origin only (the path, where a Slack or Zapier hook carries its token, is hidden) and no secret', async () => {
    const wh = await seedWebhook(ID.bizA, { url: 'https://203.0.113.78/services/T0000/B0000/XXXXSLACKTOKENXXXX?k=v' });
    const writer = await send('get', hooks(), ID.settingsWriteRevenue);
    expect(writer.status).toBe(200);
    const writerRow = (writer.body as any[]).find((w) => w.id === wh.id);
    expect(writerRow.url).toBe(wh.url);
    expect(writerRow).not.toHaveProperty('secret');
    expect(JSON.stringify(writer.body)).not.toContain(wh.secret);

    const reader = await send('get', hooks(), ID.settingsRead);
    expect(reader.status).toBe(200);
    const readerRow = (reader.body as any[]).find((w) => w.id === wh.id);
    expect(readerRow, 'the row is listed').toBeTruthy();
    expect(readerRow.url).toBe('https://203.0.113.78/***');
    expect(readerRow.urlMasked).toBe(true);
    expect(readerRow).not.toHaveProperty('secret');
    expect(JSON.stringify(reader.body)).not.toContain('XXXXSLACKTOKENXXXX');
    expect(JSON.stringify(reader.body)).not.toContain(wh.secret);
  });

  it('[WHK-03] RED-BEFORE: creating a webhook needs settings write: the sweep member, STAFF on defaults and a settings:read member get 403 and nothing is written', async () => {
    const before = await webhookRows();
    for (const actor of [ID.staffNone, ID.staffDefault, ID.settingsRead, ID.adminNone]) {
      const res = await send('post', hooks(), actor, { url: 'https://203.0.113.10/jada-sink', events: ['invoice.created', 'invoice.sent', 'invoice.paid'], name: 'Jada' });
      expect(res.status, actor).toBe(403);
      expect(JSON.stringify(res.body), actor).not.toMatch(/"secret"/);
    }
    expect(await webhookRows()).toEqual(before);
  });

  it('[WHK-04] a member with settings write and revenue read (and the owner) creates an invoice webhook; the create answer carries the signing secret, and a later read by a settings write member does not', async () => {
    for (const actor of [ID.settingsWriteRevenue, ID.owner]) {
      const res = await send('post', hooks(), actor, { url: 'https://203.0.113.10/v99w-erp', events: ['invoice.paid'], name: `${P}${actor}` });
      expect(res.status, actor).toBe(201);
      expect(res.body.secret, actor).toMatch(/^[0-9a-f]{64}$/);
      const stored = await db.webhook.findUnique({ where: { id: res.body.id } });
      expect(stored.secret).toBe(res.body.secret);
      const list = await send('get', hooks(), ID.settingsWriteRevenue);
      expect(JSON.stringify(list.body), actor).not.toContain(res.body.secret);
    }
  });

  it('[WHK-05] RED-BEFORE: deleting, disabling and test-sending the owner\'s webhook need settings write: the sweep member and a settings:read member get 403 and the row is unchanged; no delivery is sent', async () => {
    const wh = await seedWebhook(ID.bizA, { url: `http://127.0.0.1:${sinkPort}/v99w-whk05` });
    const before = await webhookRows();
    for (const actor of [ID.staffNone, ID.settingsRead]) {
      const del = await send('delete', `${hooks()}/${wh.id}`, actor);
      expect(del.status, `${actor} delete`).toBe(403);
      const toggle = await send('post', `${hooks()}/${wh.id}/toggle`, actor, { isActive: false });
      expect(toggle.status, `${actor} toggle`).toBe(403);
      const test = await send('post', `${hooks()}/${wh.id}/test`, actor);
      expect(test.status, `${actor} test`).toBe(403);
    }
    expect(await webhookRows()).toEqual(before);
    expect(sinkHits.filter((h) => h.path === '/v99w-whk05')).toEqual([]);
  });

  it('[WHK-06] RED-BEFORE: the delivery log needs settings read, and answers a settings read member the receiver origin only (review SEC-3)', async () => {
    const wh = await seedWebhook(ID.bizA, { url: 'https://203.0.113.79/hooks/catch/123/SECRETPATH' });
    const refused = await send('get', `${hooks()}/${wh.id}/deliveries`, ID.staffNone);
    expect(refused.status).toBe(403);
    // A delivery log entry for this webhook, as the dispatcher records one (its in-memory log; no
    // delivery is attempted, so nothing leaves the machine).
    (dispatcher as any).addLog({
      id: `${P}log_06`, webhookId: wh.id, businessId: ID.bizA, event: 'invoice.paid', url: wh.url,
      status: 'failed', statusCode: 500, attempts: 1, duration: 3, error: 'HTTP 500', timestamp: new Date().toISOString(),
    });
    const ok = await send('get', `${hooks()}/${wh.id}/deliveries`, ID.settingsRead);
    expect(ok.status).toBe(200);
    expect((ok.body as any[]).length).toBeGreaterThan(0);
    for (const entry of ok.body as any[]) expect(entry.url).toBe('https://203.0.113.79/***');
    expect(JSON.stringify(ok.body)).not.toContain('SECRETPATH');
    const full = await send('get', `${hooks()}/${wh.id}/deliveries`, ID.settingsWriteRevenue);
    expect((full.body as any[])[0].url).toBe(wh.url);
  });

  it('[WHK-07] a member of another business is refused every webhook route of this one (BusinessGuard, unchanged)', async () => {
    const wh = await seedWebhook();
    expect((await send('get', hooks(), ID.outsider)).status).toBe(403);
    expect((await send('delete', `${hooks()}/${wh.id}`, ID.outsider)).status).toBe(403);
    expect(await db.webhook.findUnique({ where: { id: wh.id } })).toBeTruthy();
  });
});

describe('review SEC-2: a webhook delivers only what its creator may read', () => {
  it("[WHK-EV-01] RED-BEFORE: an ADMIN whose explicit map says settings admin but revenue and crm none (D-114) is refused 403 creating a webhook for invoice or contact events, and nothing is written", async () => {
    const before = await webhookRows();
    for (const events of [['invoice.paid'], ['invoice.sent', 'invoice.overdue'], ['contact.created'], ['invoice.paid', 'invoice.sent', 'contact.created']]) {
      const res = await send('post', hooks(), ID.adminSettingsOnly, { url: 'https://203.0.113.77/exfil', events });
      expect(res.status, events.join(',')).toBe(403);
      expect(String(res.body?.message ?? ''), events.join(',')).toMatch(/(revenue|crm) read access/);
      expect(JSON.stringify(res.body)).not.toMatch(/"secret"/);
    }
    expect(await webhookRows()).toEqual(before);
  });

  it('[WHK-EV-02] RED-BEFORE: a settings write member is refused an event whose module they cannot read (invoice.* without revenue read, contact.* without crm read, or with crm read limited to their own contacts, or without revenue read: second review SV-1, D-100, a contact row carries the stored money signals); the modules they hold are admitted', async () => {
    const before = await webhookRows();
    const refused: Array<[string, string[]]> = [
      [ID.settingsWrite, ['invoice.paid']],
      [ID.settingsWrite, ['contact.created']],
      [ID.settingsWriteRevenue, ['contact.updated']],
      [ID.settingsWriteCrm, ['invoice.paid']],
      [ID.settingsWriteCrmOwned, ['contact.created']],
      [ID.settingsWriteCrm, ['contact.created']],
    ];
    for (const [actor, events] of refused) {
      const res = await send('post', hooks(), actor, { url: 'https://203.0.113.77/exfil', events });
      expect(res.status, `${actor} ${events}`).toBe(403);
    }
    expect(await webhookRows()).toEqual(before);
    const crm = await send('post', hooks(), ID.settingsWriteCrmRevenue, { url: 'https://203.0.113.77/crm', events: ['contact.created', 'contact.updated'] });
    expect(crm.status).toBe(201);
    const revenue = await send('post', hooks(), ID.settingsWriteRevenue, { url: 'https://203.0.113.77/rev', events: ['invoice.paid'] });
    expect(revenue.status).toBe(201);
  });

  it('[WHK-EV-03] RED-BEFORE: an event the server does not know is refused 400 and nothing is written', async () => {
    const before = await webhookRows();
    const res = await send('post', hooks(), ID.owner, { url: 'https://203.0.113.77/x', events: ['invoice.paid', 'everything.*'] });
    expect(res.status).toBe(400);
    expect(String(res.body?.message ?? '')).toMatch(/Unknown webhook event: everything\.\*/);
    expect(await webhookRows()).toEqual(before);
  });

  it('[WHK-EV-04] RED-BEFORE: turning a webhook back on needs the same reads (a settings write member without revenue read cannot re-enable the owner\'s disabled invoice webhook); turning one off needs settings write only', async () => {
    const wh = await seedWebhook(ID.bizA, { isActive: false, events: ['invoice.paid'] });
    const refused = await send('post', `${hooks()}/${wh.id}/toggle`, ID.settingsWrite, { isActive: true });
    expect(refused.status).toBe(403);
    expect((await db.webhook.findUnique({ where: { id: wh.id } })).isActive).toBe(false);
    const ok = await send('post', `${hooks()}/${wh.id}/toggle`, ID.settingsWriteRevenue, { isActive: true });
    expect(ok.status).toBe(201);
    expect((await db.webhook.findUnique({ where: { id: wh.id } })).isActive).toBe(true);
    const off = await send('post', `${hooks()}/${wh.id}/toggle`, ID.settingsWrite, { isActive: false });
    expect(off.status).toBe(201);
    expect((await db.webhook.findUnique({ where: { id: wh.id } })).isActive).toBe(false);
  });

  it('[WHK-EV-05] the owner (every module by role default) subscribes to invoice, contact, booking and store order events', async () => {
    const res = await send('post', hooks(), ID.owner, { url: 'https://203.0.113.77/all', events: ['invoice.paid', 'contact.created', 'booking.created', 'store_order.created', 'post.published'] });
    expect(res.status).toBe(201);
  });
});

/**
 * Second review SV-1: booking.* is mapped to bookings read, and a booking event carried the booking's
 * contact whole (BookingsService reads the booking with include { contact: true }; the dispatcher
 * stripped businessId only), at data.contact and again at data.booking.contact. The bookings read
 * routes answer that contact as { id, firstName, lastName, email, phone }. A delivery now carries the
 * fixed person view, { id, firstName, lastName, email } (round 1 class repair: one view for every
 * family, sweep-webhook-payload-projection): no visibility or ownerId (a PRIVATE contact), no
 * notesInternal, no money signals (D-100).
 *
 * The deliveries are read from the dispatcher's own send step (sendWithLogging, replaced for these
 * cases by a recorder): what it would sign and POST. Nothing leaves the machine.
 */
// Round 1 class repair (CLASS A): every delivery is projected at one choke point, and a person row
// is delivered as the fixed person view (id, firstName, lastName, email; name for a member or staff
// row), whatever the family: the view every subscriber may read (the invoice routes withhold the phone
// from revenue readers). Booking deliveries lose the phone the bookings routes show (stricter).
describe('second review SV-1: a booking event carries the booking\'s contact as the fixed person view', () => {
  const CONTACT_KEYS = ['email', 'firstName', 'id', 'lastName'];
  /** Contact fields the bookings routes do not answer (a Booking row has none of these keys of its own). */
  const HIDDEN = ['visibility', 'ownerId', 'notesInternal', 'lifetimeValue', 'averageSpend', 'paymentReliability', 'riskFlags', 'leadScore'];

  async function seedPrivateBooking() {
    seq += 1;
    const contact = await db.contact.create({
      data: {
        id: `${P}c_private_${seq}`,
        businessId: ID.bizA,
        firstName: 'Private',
        lastName: `Client ${seq}`,
        email: `${P}private${seq}@client.example`,
        phone: `+1868555${String(1000 + seq)}`,
        visibility: 'PRIVATE',
        ownerId: ID.owner,
        notesInternal: `${P}Owner-only note: negotiating 40% discount`,
        lifetimeValue: 98765.43,
        averageSpend: 4321.09,
        paymentReliability: 37,
        riskFlags: ['poor_payment_history'],
      },
    });
    const service = await db.service.create({ data: { id: `${P}svc_${seq}`, businessId: ID.bizA, name: `${P}Consult`, duration: 60, price: 250 } });
    const startTime = new Date(Date.UTC(2031, 0, 1 + seq, 14, 0, 0));
    await db.booking.create({
      data: { id: `${P}bk_${seq}`, businessId: ID.bizA, contactId: contact.id, serviceId: service.id, startTime, endTime: new Date(startTime.getTime() + 3_600_000) },
    });
    // As BookingsService.createBooking and confirmBookingForPaidInvoice read it.
    const booking = await db.booking.findUnique({ where: { id: `${P}bk_${seq}` }, include: { contact: true } });
    return { contact, booking };
  }

  async function capture(run: () => Promise<void>) {
    const sent: Array<{ webhookId: string; event: string; body: any }> = [];
    const spy = vi.spyOn(dispatcher as any, 'sendWithLogging').mockImplementation((async (wh: any, event: string, _ts: string, body: string) => {
      sent.push({ webhookId: wh.id, event, body: JSON.parse(body) });
      return { status: 'success' } as any;
    }) as any);
    try {
      await run();
    } finally {
      spy.mockRestore();
    }
    return sent;
  }

  it('[WHK-BK-01] RED-BEFORE: booking.created and booking.confirmed deliveries carry the contact as { id, firstName, lastName, email } (round 1: the fixed person view, no phone) at data.contact and data.booking.contact; no visibility, owner, internal note or money signal of a PRIVATE contact', async () => {
    const wh = await seedWebhook(ID.bizA, { url: 'https://203.0.113.79/bookadmin-collector', events: ['booking.created', 'booking.confirmed', 'booking.completed'] });
    const { contact, booking } = await seedPrivateBooking();
    expect(booking.contact.notesInternal, 'the stand-in reads the contact whole, as BookingsService does').toContain('Owner-only note');

    const sent = await capture(async () => {
      await dispatcher.onBookingCreated({ booking, contact: booking.contact, businessId: ID.bizA, eventName: 'booking.created' });
      await dispatcher.onBookingConfirmed({ booking, contact: booking.contact, businessId: ID.bizA, eventName: 'booking.confirmed' });
    });
    const mine = sent.filter((s) => s.webhookId === wh.id);
    expect(mine.map((s) => s.event)).toEqual(['booking.created', 'booking.confirmed']);
    for (const delivery of mine) {
      const { data } = delivery.body;
      for (const [label, shown] of [['data.contact', data.contact], ['data.booking.contact', data.booking?.contact]] as const) {
        expect(Object.keys(shown ?? {}).sort(), `${delivery.event} ${label}`).toEqual(CONTACT_KEYS);
        expect(shown, `${delivery.event} ${label}`).toEqual({ id: contact.id, firstName: 'Private', lastName: contact.lastName, email: contact.email });
      }
      const text = JSON.stringify(delivery.body);
      expect(text, delivery.event).not.toContain('Owner-only note');
      expect(text, delivery.event).not.toContain('98765.43');
      expect(text, delivery.event).not.toContain('PRIVATE');
      for (const key of HIDDEN) expect(text, `${delivery.event} ${key}`).not.toContain(`"${key}"`);
      // The booking itself is delivered as the bookings routes answer it (its own fields stay).
      expect(data.booking.id, delivery.event).toBe(booking.id);
      expect(data.booking.serviceId, delivery.event).toBe(booking.serviceId);
    }
  });

  it('[WHK-BK-02] RED-BEFORE: a booking.completed delivery, and any booking event whose booking carries the contact whole, delivers the same four contact fields (round 1: no phone); a booking with no contact delivers contact null', async () => {
    const wh = await seedWebhook(ID.bizA, { url: 'https://203.0.113.79/bookadmin-collector-2', events: ['booking.completed', 'booking.created'] });
    const { contact, booking } = await seedPrivateBooking();
    const sent = await capture(async () => {
      await dispatcher.onBookingCompleted({ booking, contact: booking.contact, businessId: ID.bizA });
      await dispatcher.onBookingCreated({ booking: { ...booking, contact: undefined }, contact: undefined, businessId: ID.bizA });
    });
    const mine = sent.filter((s) => s.webhookId === wh.id);
    expect(mine.map((s) => s.event)).toEqual(['booking.completed', 'booking.created']);
    expect(mine[0].body.data.booking.contact).toEqual({ id: contact.id, firstName: 'Private', lastName: contact.lastName, email: contact.email });
    expect(JSON.stringify(mine[0].body)).not.toContain('Owner-only note');
    expect(mine[1].body.data.contact).toBeNull();
  });

  it('[WHK-BK-03] RED-BEFORE (D-100): a contact.* webhook delivers the stored contact row, money signals included, so its creator needs revenue read as well as crm read with every contact in view; settings write with crm read alone is refused with nothing written', async () => {
    const before = await webhookRows();
    const res = await send('post', hooks(), ID.settingsWriteCrm, { url: 'https://203.0.113.77/crm-only', events: ['contact.created'] });
    expect(res.status).toBe(403);
    expect(String(res.body?.message ?? '')).toMatch(/contact\.created needs revenue read access/);
    expect(await webhookRows()).toEqual(before);
    const ok = await send('post', hooks(), ID.settingsWriteCrmRevenue, { url: 'https://203.0.113.77/crm-rev', events: ['contact.created'] });
    expect(ok.status).toBe(201);
  });
});

/**
 * Second review SV-5: the CR-5 repair answered every webhook's signing secret, and its full URL, to
 * every settings admin member, whatever modules the webhook's events belong to. An ADMIN bound by
 * D-114 (revenue none, crm none) could not create an invoice.paid webhook, yet read the owner's
 * invoice webhook's secret (and signed forged invoice.paid deliveries to the owner's receiver with it)
 * and its full URL (for a Slack hook, the credential itself). A reader now gets a webhook's secret
 * and full URL only if they could have created it: the settings level as before, and the reads its
 * events need (assertMayReceiveEvents); otherwise no secret and the receiver origin only.
 */
describe('second review SV-5: a webhook\'s secret and full URL go only to a member who may receive its events', () => {
  it('[WHK-SV5-01] RED-BEFORE: a settings admin member who cannot read the events\' modules (an ADMIN bound by D-114, a settings-admin STAFF member) lists the owner\'s invoice and contact webhook with no secret and the receiver origin only, and its delivery log masked; the owner and an ADMIN on role defaults read both', async () => {
    const wh = await seedWebhook(ID.bizA, { url: 'https://203.0.113.78/services/T0000/B0000/XXXXSLACKTOKENXXXX', events: ['invoice.paid', 'contact.created'] });
    (dispatcher as any).addLog({
      id: `${P}log_sv5`, webhookId: wh.id, businessId: ID.bizA, event: 'invoice.paid', url: wh.url,
      status: 'success', statusCode: 200, attempts: 1, duration: 3, error: null, timestamp: new Date().toISOString(),
    });
    for (const actor of [ID.adminSettingsOnly, ID.settingsAdmin, ID.settingsAdminRevenue, ID.settingsWrite]) {
      const res = await send('get', hooks(), actor);
      expect(res.status, actor).toBe(200);
      const row = (res.body as any[]).find((w) => w.id === wh.id);
      expect(row, actor).toBeTruthy();
      expect(row, actor).not.toHaveProperty('secret');
      expect(row.url, actor).toBe('https://203.0.113.78/***');
      expect(row.urlMasked, actor).toBe(true);
      expect(JSON.stringify(res.body), actor).not.toContain(wh.secret);
      // (other webhooks of this business may carry the same token path and be readable to this member)
      expect(JSON.stringify(row), actor).not.toContain('XXXXSLACKTOKENXXXX');
      const log = await send('get', `${hooks()}/${wh.id}/deliveries`, actor);
      expect(log.status, actor).toBe(200);
      expect((log.body as any[]).length, actor).toBeGreaterThan(0);
      expect(JSON.stringify(log.body), actor).not.toContain('XXXXSLACKTOKENXXXX');
    }
    for (const actor of [ID.owner, ID.admin]) {
      const res = await send('get', hooks(), actor);
      const row = (res.body as any[]).find((w) => w.id === wh.id);
      expect(row.secret, actor).toBe(wh.secret);
      expect(row.url, actor).toBe(wh.url);
      expect(row.urlMasked, actor).toBeUndefined();
      const log = await send('get', `${hooks()}/${wh.id}/deliveries`, actor);
      expect((log.body as any[])[0].url, actor).toBe(wh.url);
    }
  });

  it('[WHK-SV5-02] the same reader is answered per webhook: a settings-admin member with revenue read reads the secret and URL of an invoice-only webhook, and not those of a webhook that also sends contact events', async () => {
    const invoiceOnly = await seedWebhook(ID.bizA, { url: 'https://203.0.113.78/v99w-invoice-only', events: ['invoice.paid'] });
    const mixed = await seedWebhook(ID.bizA, { url: 'https://203.0.113.78/v99w-mixed/SECRETPATH', events: ['invoice.paid', 'contact.updated'] });
    const res = await send('get', hooks(), ID.settingsAdminRevenue);
    expect(res.status).toBe(200);
    const a = (res.body as any[]).find((w) => w.id === invoiceOnly.id);
    const b = (res.body as any[]).find((w) => w.id === mixed.id);
    expect(a.secret).toBe(invoiceOnly.secret);
    expect(a.url).toBe(invoiceOnly.url);
    expect(b).not.toHaveProperty('secret');
    expect(b.url).toBe('https://203.0.113.78/***');
    expect(JSON.stringify(res.body)).not.toContain(mixed.secret);
  });
});

describe('BUG-001: a webhook URL goes through the outbound-address guard (core/security/outbound-address.ts)', () => {
  it('[WHK-SSRF-01] RED-BEFORE: creating a webhook to a loopback, private, link-local (cloud metadata), unspecified or localhost-named address answers 400 and writes nothing, even for the owner', async () => {
    const before = await webhookRows();
    for (const url of [
      'http://localhost:9/jada-sink',
      'http://127.0.0.1:9/jada-sink',
      'http://10.0.0.5/hook',
      'http://192.168.1.10/hook',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]/hook',
      'http://0.0.0.0/hook',
      'http://app.localhost/hook',
    ]) {
      const res = await send('post', hooks(), ID.owner, { url, events: ['invoice.paid'] });
      expect(res.status, url).toBe(400);
      expect(JSON.stringify(res.body), url).not.toMatch(/"secret"/);
    }
    expect(await webhookRows()).toEqual(before);
  });

  it('[WHK-SSRF-02] RED-BEFORE: a URL that is not http(s), or no URL at all, answers 400 (not a 201 carrying an error) and writes nothing', async () => {
    const before = await webhookRows();
    for (const body of [
      { url: 'ftp://203.0.113.10/hook', events: ['invoice.paid'] },
      { url: 'httpfoo', events: ['invoice.paid'] },
      { url: '', events: ['invoice.paid'] },
      { url: 'https://203.0.113.10/hook', events: [] },
    ]) {
      const res = await send('post', hooks(), ID.owner, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(await webhookRows()).toEqual(before);
  });

  it('[WHK-SSRF-03] RED-BEFORE: a stored webhook whose URL names a loopback address (a row from before the check) is never connected to: the test delivery fails as not public and the sink receives nothing', async () => {
    const wh = await seedWebhook(ID.bizA, { url: `http://127.0.0.1:${sinkPort}/v99w-ssrf03` });
    const res = await send('post', `${hooks()}/${wh.id}/test`, ID.owner);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('failed');
    expect(String(res.body.error)).toMatch(/not a public address/);
    expect(sinkHits.filter((h) => h.path === '/v99w-ssrf03')).toEqual([]);
  });

  it('[WHK-SSRF-04] RED-BEFORE: an event dispatched to a stored webhook with a loopback URL reaches nothing (the dispatcher checks every delivery, not only the test route)', async () => {
    // bizB holds no other webhook, so the dispatch has exactly this one target.
    await seedWebhook(ID.bizB, { url: `http://127.0.0.1:${sinkPort}/v99w-ssrf04`, events: ['invoice.paid'] });
    await dispatcher.onInvoicePaid({ businessId: ID.bizB, invoice: { id: `${P}inv_1`, total: 100 } });
    expect(sinkHits.filter((h) => h.path === '/v99w-ssrf04')).toEqual([]);
    const log = dispatcher.getDeliveryLogs(ID.bizB).find((l: any) => l.url.endsWith('/v99w-ssrf04'));
    expect(log?.status).toBe('failed');
    expect(String(log?.error)).toMatch(/not a public address/);
  });
});

describe('BUG-013: API keys are settings admin territory', () => {
  it('[AK-01] RED-BEFORE: creating an API key needs settings admin: the sweep member, STAFF on defaults, settings read and settings write members get 403 and no key is written', async () => {
    const before = await apiKeyRows();
    for (const actor of [ID.staffNone, ID.staffDefault, ID.settingsRead, ID.settingsWrite, ID.adminNone]) {
      const res = await send('post', keys(), actor, { name: 'Jada key', scopes: ['contacts:read'] });
      expect(res.status, actor).toBe(403);
      expect(JSON.stringify(res.body), actor).not.toMatch(/kf_[0-9a-f]{20}/);
    }
    expect(await apiKeyRows()).toEqual(before);
  });

  it('[AK-02] RED-BEFORE: listing API keys needs settings read', async () => {
    await seedApiKey();
    for (const actor of [ID.staffNone, ID.staffDefault, ID.adminNone]) {
      expect((await send('get', keys(), actor)).status, actor).toBe(403);
    }
    const ok = await send('get', keys(), ID.settingsRead);
    expect(ok.status).toBe(200);
    expect(JSON.stringify(ok.body)).not.toMatch(/hashed|hashedKey/i);
  });

  it("[AK-03] RED-BEFORE: no member below settings admin revokes the owner's key: the sweep member, STAFF on defaults, settings read and settings write members and an ADMIN whose map says none get 403 and the key stays live", async () => {
    const key = await seedApiKey();
    for (const actor of [ID.staffNone, ID.staffDefault, ID.settingsRead, ID.settingsWrite, ID.adminNone]) {
      const res = await send('delete', `${keys()}/${key.id}`, actor);
      expect(res.status, actor).toBe(403);
      expect(String(res.body?.message ?? ''), actor).toMatch(/settings requires admin access/);
    }
    const stored = await db.apiKey.findUnique({ where: { id: key.id } });
    expect(stored.revokedAt).toBeNull();
  });

  it('[AK-04] (review CR-3) settings admin revokes and creates: the owner, a co-owner, an ADMIN on role defaults and a settings-admin STAFF member each revoke a key (an ADMIN revokes the key they just created); the raw key is answered once, at create', async () => {
    for (const actor of [ID.owner, ID.coOwner, ID.admin, ID.settingsAdmin]) {
      const k = await seedApiKey();
      const res = await send('delete', `${keys()}/${k.id}`, actor);
      expect(res.status, actor).toBe(200);
      expect(res.body, actor).toEqual({ success: true });
      expect((await db.apiKey.findUnique({ where: { id: k.id } })).revokedAt, actor).not.toBeNull();
    }
    for (const actor of [ID.admin, ID.settingsAdmin, ID.owner]) {
      const res = await send('post', keys(), actor, { name: `${P}${actor}`, scopes: [] });
      expect(res.status, actor).toBe(201);
      expect(res.body.key, actor).toMatch(/^kf_[0-9a-f]{64}$/);
      const list = await send('get', keys(), actor);
      expect(JSON.stringify(list.body), actor).not.toContain(res.body.key);
      const revoke = await send('delete', `${keys()}/${res.body.apiKey.id}`, actor);
      expect(revoke.status, `${actor} revokes their own key`).toBe(200);
    }
  });

  it("[AK-05] a member of another business is refused (BusinessGuard, unchanged): the outsider cannot revoke bizA's key", async () => {
    const key = await seedApiKey();
    expect((await send('delete', `${keys()}/${key.id}`, ID.outsider)).status).toBe(403);
    expect((await db.apiKey.findUnique({ where: { id: key.id } })).revokedAt).toBeNull();
  });
});
