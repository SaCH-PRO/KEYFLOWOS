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
 *   - a webhook's signing secret is answered once, to the member who created it, in the create
 *     answer; no read answers it afterwards, to anyone (the owner included): today every reader got
 *     it, so the safer of the two is kept;
 *   - a webhook URL must be http(s) to a public address: the repo's outbound-address guard
 *     (core/security/outbound-address.ts) refuses a loopback, private, link-local (cloud metadata)
 *     or otherwise non-public host at create (400, nothing written) and again at every delivery,
 *     which connects only to the address it checked (a stored row from before the check reaches
 *     nothing);
 *   - API keys are settings admin territory: listing needs settings read, creating needs settings
 *     admin, and revoking needs the owner-level right (an OWNER membership, D-116 / D-125) besides,
 *     since a key records no creator (no schema change here), so any key may be the owner's or
 *     another member's.
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
  settingsWrite: `${P}settingsWrite`, // STAFF of bizA, explicit settings 'write'
  settingsAdmin: `${P}settingsAdmin`, // STAFF of bizA, explicit settings 'admin'
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
  await m(ID.settingsAdmin, ID.bizA, 'STAFF', { settings: 'admin' });
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

  it('[WHK-02] RED-BEFORE: no read answers a signing secret after creation, to anyone: the owner, a co-owner, an ADMIN and a settings:read member list the webhooks without it', async () => {
    const wh = await seedWebhook();
    for (const actor of [ID.owner, ID.coOwner, ID.admin, ID.settingsRead]) {
      const res = await send('get', hooks(), actor);
      expect(res.status, actor).toBe(200);
      const row = (res.body as any[]).find((w) => w.id === wh.id);
      expect(row, actor).toBeTruthy();
      expect(row.url).toBe(wh.url);
      expect(row, actor).not.toHaveProperty('secret');
      expect(JSON.stringify(res.body), actor).not.toContain(wh.secret);
    }
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

  it('[WHK-04] a member with settings write (and the owner) creates a webhook; the create answer carries the signing secret once, and a later read does not', async () => {
    for (const actor of [ID.settingsWrite, ID.owner]) {
      const res = await send('post', hooks(), actor, { url: 'https://203.0.113.10/v99w-erp', events: ['invoice.paid'], name: `${P}${actor}` });
      expect(res.status, actor).toBe(201);
      expect(res.body.secret, actor).toMatch(/^[0-9a-f]{64}$/);
      const stored = await db.webhook.findUnique({ where: { id: res.body.id } });
      expect(stored.secret).toBe(res.body.secret);
      const list = await send('get', hooks(), actor);
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

  it('[WHK-06] RED-BEFORE: the delivery log needs settings read', async () => {
    const wh = await seedWebhook();
    const refused = await send('get', `${hooks()}/${wh.id}/deliveries`, ID.staffNone);
    expect(refused.status).toBe(403);
    const ok = await send('get', `${hooks()}/${wh.id}/deliveries`, ID.settingsRead);
    expect(ok.status).toBe(200);
  });

  it('[WHK-07] a member of another business is refused every webhook route of this one (BusinessGuard, unchanged)', async () => {
    const wh = await seedWebhook();
    expect((await send('get', hooks(), ID.outsider)).status).toBe(403);
    expect((await send('delete', `${hooks()}/${wh.id}`, ID.outsider)).status).toBe(403);
    expect(await db.webhook.findUnique({ where: { id: wh.id } })).toBeTruthy();
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

describe('BUG-013: API keys are settings admin territory, and revoking one is the owner\'s', () => {
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

  it("[AK-03] RED-BEFORE: no member below the owner-level right revokes the owner's key: the sweep member, settings read/write/admin STAFF and an ADMIN get 403 and the key stays live", async () => {
    const key = await seedApiKey();
    for (const actor of [ID.staffNone, ID.staffDefault, ID.settingsRead, ID.settingsWrite, ID.settingsAdmin, ID.admin, ID.adminNone]) {
      const res = await send('delete', `${keys()}/${key.id}`, actor);
      expect(res.status, actor).toBe(403);
    }
    const stored = await db.apiKey.findUnique({ where: { id: key.id } });
    expect(stored.revokedAt).toBeNull();
  });

  it('[AK-04] the owner and a co-owner (an OWNER membership, D-125) revoke a key; an ADMIN and a settings-admin member create one, and the raw key is answered once', async () => {
    const k1 = await seedApiKey();
    expect((await send('delete', `${keys()}/${k1.id}`, ID.owner)).status).toBe(200);
    expect((await db.apiKey.findUnique({ where: { id: k1.id } })).revokedAt).not.toBeNull();
    const k2 = await seedApiKey();
    expect((await send('delete', `${keys()}/${k2.id}`, ID.coOwner)).status).toBe(200);
    expect((await db.apiKey.findUnique({ where: { id: k2.id } })).revokedAt).not.toBeNull();
    for (const actor of [ID.admin, ID.settingsAdmin, ID.owner]) {
      const res = await send('post', keys(), actor, { name: `${P}${actor}`, scopes: [] });
      expect(res.status, actor).toBe(201);
      expect(res.body.key, actor).toMatch(/^kf_[0-9a-f]{64}$/);
      const list = await send('get', keys(), actor);
      expect(JSON.stringify(list.body), actor).not.toContain(res.body.key);
    }
  });

  it("[AK-05] a member of another business is refused (BusinessGuard, unchanged): the outsider cannot revoke bizA's key", async () => {
    const key = await seedApiKey();
    expect((await send('delete', `${keys()}/${key.id}`, ID.outsider)).status).toBe(403);
    expect((await db.apiKey.findUnique({ where: { id: key.id } })).revokedAt).toBeNull();
  });
});
