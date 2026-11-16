/**
 * SWEEP-P0-SCOPES review repair (finding SEC-1, blocker) — a connector's credentials and its inbound
 * webhook signing secret are settings admin territory, against a REAL database through the HTTP
 * routes of ConnectorController (core/connectors/connector.controller.ts).
 *
 * SEC-1 (reproduced by the review on a real database): ConnectorController ran AuthGuard and
 * BusinessGuard only, and the REST scope census did not read core/, so none of its routes was
 * listed. A STAFF member whose map says settings 'none' (the sweep's member):
 *   - read GET .../webhook-info/webhook_form: the inbound form webhook's signing secret, created on
 *     the first read and answered on every read, and with it forged form submissions (leads and
 *     contacts) through POST /webhooks/forms/:businessId/webhook_form;
 *   - overwrote the owner's QuickBooks credentials with POST .../credentials/quickbooks (a realm of
 *     their own: every later accounting sync goes to their company);
 *   - and, the same class, cleared them (DELETE .../credentials/:type, or POST .../disconnect/:type
 *     and .../reconnect/:type, which clear a connector's stored credentials first).
 *
 * The rules this suite pins (the settings module, as the API key and webhook routes read it: OWNER
 * and ADMIN hold settings admin by role default, STAFF none; an explicit map binds every role,
 * D-114 / D-140):
 *   - GET .../webhook-info/:type and POST .../credentials/:type need settings admin
 *     (ModuleScopeGuard, 403 before the handler: no secret is created, nothing is written);
 *   - DELETE .../credentials/:type, POST .../disconnect/:type and POST .../reconnect/:type need
 *     settings admin for every connector the Google owner rules do not already govern (gmail:
 *     GMAIL_OWNER_ONLY, D-11; the Google Suite connections: GOOGLE_CONNECT_OWNER_ONLY, D-99; their
 *     suites, gmail-connect-binding and google-consent-owner, pin those), checked in the handler
 *     before anything is cleared;
 *   - GET .../credentials/:type (the masked form) and the status reads stay open to members;
 *   - the handler checks read a membership exactly as ModuleScopeGuard does (second review SV-4): a
 *     stored JSON array is an explicit map in which every module is none, not "no map" (the role
 *     defaults), so an ADMIN whose scopes the owner set to [] is refused the clearing routes too.
 *
 * Nothing on the authorization or persistence path is mocked: PrismaService, AuthGuard,
 * BusinessGuard, ModuleScopeGuard, the global ValidationPipe and GlobalHttpExceptionFilter,
 * ConnectorController and ConnectorCredentialsService (connector_statuses, encrypted) are real
 * against DATABASE_URL. The stand-ins: identity attachment (`x-test-user`, as AuthMiddleware
 * attaches it), and the connector registry, which answers the connectors' metadata (QuickBooks'
 * credential form, the generic webhook form) and whose disconnect / reconnect clear the stored
 * credentials through the real ConnectorCredentialsService, as QuickBooksConnector.disconnect does.
 * No provider is reached.
 *
 * Requires DATABASE_URL. Every seeded row carries the `v99k_` prefix and is hard-deleted by raw SQL
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

const P = 'v99k_';
const ID = {
  owner: `${P}owner`, // OWNER of bizA, no explicit map (settings admin by role default)
  admin: `${P}admin`, // ADMIN of bizA, no explicit map (settings admin by role default)
  adminNone: `${P}adminNone`, // ADMIN of bizA, explicit settings 'none' (an explicit map binds ADMIN too, D-114)
  adminArray: `${P}adminArray`, // ADMIN of bizA whose stored scopes are a JSON array [] (second review SV-4: an explicit map, every module none)
  staffNone: `${P}staffNone`, // STAFF of bizA, the sweep's member: settings/team/ai/connect/revenue/expenses none
  staffDefault: `${P}staffDefault`, // STAFF of bizA, no explicit map (settings none by role default)
  settingsWrite: `${P}settingsWrite`, // STAFF of bizA, explicit settings 'write'
  settingsAdmin: `${P}settingsAdmin`, // STAFF of bizA, explicit settings 'admin'
  outsider: `${P}outsider`, // OWNER of bizB, no membership in bizA
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
};

/** The owner's QuickBooks connection, as stored before any case. */
const OWNER_QBO = { accessToken: `${P}owner_real_token`, realmId: `${P}owner_realm` };

let db: any;
let app: any;
let credentials: any;
let MODULE_SCOPE_KEY = '';
let ConnectorControllerClass: any;

/** The connectors' metadata, as the registry answers it (QuickBooks' credential form, the generic webhook form). */
const META: Record<string, Record<string, unknown>> = {
  quickbooks: {
    type: 'quickbooks',
    name: 'QuickBooks Online',
    authType: 'api_key',
    credentialFields: [
      { key: 'accessToken', label: 'Access token', type: 'password', required: true, secret: true },
      { key: 'realmId', label: 'Realm ID (Company ID)', type: 'text', required: true },
    ],
  },
  webhook_form: { type: 'webhook_form', name: 'Webhook form', authType: 'none', supportsWebhook: true, credentialFields: [] },
};
const registry = {
  get: (type: string) => (META[type] ? { meta: META[type] } : undefined),
  getHealth: async (type: string) => ({ type, status: 'connected' }),
  // As QuickBooksConnector.disconnect: the stored credentials are cleared.
  disconnectConnector: vi.fn(async (type: string, businessId: string) => credentials.clearCredentials(businessId, type)),
  reconnectConnector: vi.fn(async (type: string, businessId: string) => {
    await credentials.clearCredentials(businessId, type);
    return { connected: false };
  }),
};

async function cleanup() {
  for (const sql of [
    `DELETE FROM connector_statuses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

const conn = (biz: string = ID.bizA) => `/connectors/businesses/${biz}`;

/** Every connector_statuses row of `biz`, whole: what "nothing written" compares. */
async function connectorRows(biz: string = ID.bizA) {
  return db.$queryRawUnsafe(`SELECT to_jsonb(t)::text AS row FROM connector_statuses t WHERE business_id = '${biz}' ORDER BY connector_type`);
}

async function seedOwnerQuickBooks() {
  await credentials.setCredentials(ID.bizA, 'quickbooks', { ...OWNER_QBO }, { accountLabel: 'Owner company' });
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
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { Logger, ValidationPipe } = await import('@nestjs/common');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const scopeMod = await import('../src/core/auth/module-scope.guard');
  MODULE_SCOPE_KEY = scopeMod.MODULE_SCOPE_KEY;
  const { ConnectorController } = await import('../src/core/connectors/connector.controller');
  ConnectorControllerClass = ConnectorController;
  const { ConnectorRegistryService } = await import('../src/core/connectors/connector-registry.service');
  const { ConnectorActivityService } = await import('../src/core/connectors/connector-activity.service');
  const { ConnectorHealthMonitorService } = await import('../src/core/connectors/connector-health-monitor.service');
  const { ConnectorCredentialsService } = await import('../src/core/connectors/connector-credentials.service');

  Logger.overrideLogger(false);

  const moduleRef = await Test.createTestingModule({
    controllers: [ConnectorController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      scopeMod.ModuleScopeGuard,
      ConnectorCredentialsService,
      { provide: ConnectorRegistryService, useValue: registry },
      { provide: ConnectorActivityService, useValue: {} },
      { provide: ConnectorHealthMonitorService, useValue: {} },
    ],
  }).compile();
  credentials = moduleRef.get(ConnectorCredentialsService);

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
  await db.business.create({ data: { id: ID.bizA, name: 'V99K Biz A', ownerId: ID.owner } });
  await db.business.create({ data: { id: ID.bizB, name: 'V99K Biz B', ownerId: ID.outsider } });
  const m = (user: string, biz: string, role: string, permissionScopes?: Record<string, string> | unknown[]) =>
    db.membership.create({
      data: { id: `${P}m_${user.slice(P.length)}_${biz.slice(P.length)}`, userId: user, businessId: biz, role, permissionScopes: permissionScopes ?? undefined },
    });
  await m(ID.owner, ID.bizA, 'OWNER');
  await m(ID.admin, ID.bizA, 'ADMIN');
  await m(ID.adminNone, ID.bizA, 'ADMIN', { crm: 'admin', settings: 'none' });
  // As the owner's team route stores it (PATCH .../team/:m/permissions { scopes: [] } answers 200).
  await m(ID.adminArray, ID.bizA, 'ADMIN', []);
  await m(ID.staffNone, ID.bizA, 'STAFF', { crm: 'read', settings: 'none', team: 'none', ai: 'none', connect: 'none', revenue: 'none', expenses: 'none' });
  await m(ID.staffDefault, ID.bizA, 'STAFF');
  await m(ID.settingsWrite, ID.bizA, 'STAFF', { settings: 'write' });
  // Round 2 class repair (CLASS A, WHP-1): binding QuickBooks (an export connector) also needs revenue and crm read.
  await m(ID.settingsAdmin, ID.bizA, 'STAFF', { settings: 'admin', revenue: 'read', crm: 'read' });
  await m(ID.outsider, ID.bizB, 'OWNER');
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

/** The members below settings admin: the sweep member, STAFF on defaults, settings write, an ADMIN whose map says none. */
const BELOW_SETTINGS_ADMIN = [ID.staffNone, ID.staffDefault, ID.settingsWrite, ID.adminNone];

describe('route census: core/connectors/connector.controller.ts', () => {
  it('[CON-C01] RED-BEFORE: ConnectorController runs AuthGuard, BusinessGuard, then ModuleScopeGuard; webhook-info and POST credentials require settings admin on the handler', () => {
    const routes = census(ConnectorControllerClass);
    const byKey = Object.fromEntries(routes.map((r) => [r.key, r]));
    for (const r of routes) {
      const chain = r.guards.filter((g) => ['AuthGuard', 'BusinessGuard', 'ModuleScopeGuard'].includes(g));
      expect(chain, r.key).toEqual(['AuthGuard', 'BusinessGuard', 'ModuleScopeGuard']);
    }
    expect(byKey['ConnectorController.getWebhookInfo'].scope).toEqual({ module: 'settings', minLevel: 'admin' });
    expect(byKey['ConnectorController.saveCredentials'].scope).toEqual({ module: 'settings', minLevel: 'admin' });
    // The masked credential form and the status reads keep no module requirement.
    for (const key of ['getCredentials', 'getDashboard', 'getStatuses', 'getHealth', 'listConnectors']) {
      expect(byKey[`ConnectorController.${key}`].scope, key).toBeUndefined();
    }
  });
});

describe('SEC-1: the inbound webhook signing secret is settings admin territory', () => {
  it('[CON-01] RED-BEFORE: a member below settings admin (the sweep member, STAFF on defaults, settings write, an ADMIN whose map says none) is refused GET webhook-info with 403; no secret is created or answered', async () => {
    const before = await connectorRows();
    for (const actor of BELOW_SETTINGS_ADMIN) {
      const res = await send('get', `${conn()}/webhook-info/webhook_form`, actor);
      expect(res.status, actor).toBe(403);
      expect(String(res.body?.message ?? ''), actor).toMatch(/settings requires admin access/);
      expect(JSON.stringify(res.body), actor).not.toMatch(/"secret"|x-keyflow-signature: [0-9a-f]/);
    }
    expect(await connectorRows()).toEqual(before);
    expect(await credentials.getCredentials(ID.bizA, 'webhook_form')).toBeNull();
  });

  it('[CON-02] the owner, an ADMIN and a settings-admin member read the webhook info: the secret is created once and the same secret is answered after', async () => {
    const first = await send('get', `${conn()}/webhook-info/webhook_form`, ID.owner);
    expect(first.status).toBe(200);
    expect(first.body.secret).toMatch(/^[0-9a-f]{48}$/);
    expect(first.body.url).toContain(`/webhooks/forms/${ID.bizA}/webhook_form`);
    for (const actor of [ID.admin, ID.settingsAdmin, ID.owner]) {
      const again = await send('get', `${conn()}/webhook-info/webhook_form`, actor);
      expect(again.status, actor).toBe(200);
      expect(again.body.secret, actor).toBe(first.body.secret);
    }
    // ... and still refused below settings admin once it exists.
    const refused = await send('get', `${conn()}/webhook-info/webhook_form`, ID.staffNone);
    expect(refused.status).toBe(403);
    expect(JSON.stringify(refused.body)).not.toContain(first.body.secret);
  });
});

describe("SEC-1: a connector's credentials are settings admin territory", () => {
  it("[CON-03] RED-BEFORE: a member below settings admin is refused POST credentials/quickbooks with 403, and the owner's stored credentials are unchanged", async () => {
    await seedOwnerQuickBooks();
    const before = await connectorRows();
    for (const actor of BELOW_SETTINGS_ADMIN) {
      const res = await send('post', `${conn()}/credentials/quickbooks`, actor, { values: { accessToken: `${P}attacker_token`, realmId: `${P}attacker_realm` } });
      expect(res.status, actor).toBe(403);
      expect(String(res.body?.message ?? ''), actor).toMatch(/settings requires admin access/);
    }
    expect(await connectorRows()).toEqual(before);
    expect(await credentials.getCredentials(ID.bizA, 'quickbooks')).toEqual(OWNER_QBO);
  });

  it("[CON-04] RED-BEFORE: a member below settings admin is refused clearing the owner's QuickBooks credentials (DELETE credentials, disconnect, reconnect) with 403; the registry is not reached and the credentials stay", async () => {
    await seedOwnerQuickBooks();
    registry.disconnectConnector.mockClear();
    registry.reconnectConnector.mockClear();
    const before = await connectorRows();
    for (const actor of BELOW_SETTINGS_ADMIN) {
      const del = await send('delete', `${conn()}/credentials/quickbooks`, actor);
      expect(del.status, `${actor} delete`).toBe(403);
      expect(String(del.body?.message ?? ''), `${actor} delete`).toMatch(/settings requires admin access/);
      const disconnect = await send('post', `${conn()}/disconnect/quickbooks`, actor);
      expect(disconnect.status, `${actor} disconnect`).toBe(403);
      const reconnect = await send('post', `${conn()}/reconnect/quickbooks`, actor);
      expect(reconnect.status, `${actor} reconnect`).toBe(403);
    }
    expect(registry.disconnectConnector).not.toHaveBeenCalled();
    expect(registry.reconnectConnector).not.toHaveBeenCalled();
    expect(await connectorRows()).toEqual(before);
    expect(await credentials.getCredentials(ID.bizA, 'quickbooks')).toEqual(OWNER_QBO);
  });

  it("[CON-SV4-01] RED-BEFORE (second review SV-4): an ADMIN whose stored scopes are a JSON array is read as ModuleScopeGuard reads it (an explicit map with every module none), so the handler checks refuse them too: DELETE credentials, disconnect and reconnect of the owner's QuickBooks answer 403 and nothing is cleared, as GET webhook-info (the guard) already does", async () => {
    await seedOwnerQuickBooks();
    registry.disconnectConnector.mockClear();
    registry.reconnectConnector.mockClear();
    const before = await connectorRows();
    const guarded = await send('get', `${conn()}/webhook-info/webhook_form`, ID.adminArray);
    expect(guarded.status, 'the guard').toBe(403);
    expect(String(guarded.body?.message ?? '')).toMatch(/settings requires admin access \(you have none\)/);
    const del = await send('delete', `${conn()}/credentials/quickbooks`, ID.adminArray);
    expect(del.status, 'delete').toBe(403);
    expect(String(del.body?.message ?? '')).toMatch(/settings requires admin access \(you have none\)/);
    expect((await send('post', `${conn()}/disconnect/quickbooks`, ID.adminArray)).status, 'disconnect').toBe(403);
    expect((await send('post', `${conn()}/reconnect/quickbooks`, ID.adminArray)).status, 'reconnect').toBe(403);
    expect(registry.disconnectConnector).not.toHaveBeenCalled();
    expect(registry.reconnectConnector).not.toHaveBeenCalled();
    expect(await connectorRows()).toEqual(before);
    expect(await credentials.getCredentials(ID.bizA, 'quickbooks')).toEqual(OWNER_QBO);
  });

  it('[CON-SV4-02] RED-BEFORE (second review SV-4): memberModuleLevel reads a stored JSON array as ModuleScopeGuard does: an explicit map in which every module is none (an object map and a missing map are read as before)', async () => {
    const { memberModuleLevel } = await import('../src/core/auth/member-module-level');
    const prisma = { client: db };
    expect(await memberModuleLevel(prisma as any, ID.bizA, { id: ID.adminArray, role: 'USER' }, 'settings')).toBe('none');
    expect(await memberModuleLevel(prisma as any, ID.bizA, { id: ID.adminArray, role: 'USER' }, 'crm')).toBe('none');
    expect(await memberModuleLevel(prisma as any, ID.bizA, { id: ID.admin, role: 'USER' }, 'settings')).toBe('admin');
    expect(await memberModuleLevel(prisma as any, ID.bizA, { id: ID.adminNone, role: 'USER' }, 'crm')).toBe('admin');
    expect(await memberModuleLevel(prisma as any, ID.bizA, { id: ID.adminNone, role: 'USER' }, 'settings')).toBe('none');
  });

  it('[CON-05] settings admin admits: the owner, an ADMIN and a settings-admin STAFF member save QuickBooks credentials; an ADMIN clears them and disconnects', async () => {
    for (const [actor, realm] of [[ID.owner, 'r_owner'], [ID.admin, 'r_admin'], [ID.settingsAdmin, 'r_staff']]) {
      const res = await send('post', `${conn()}/credentials/quickbooks`, actor, { values: { accessToken: `${P}${realm}_token`, realmId: `${P}${realm}` } });
      expect(res.status, actor).toBe(201);
      expect(res.body.success, actor).toBe(true);
      expect((await credentials.getCredentials(ID.bizA, 'quickbooks'))?.realmId, actor).toBe(`${P}${realm}`);
    }
    const del = await send('delete', `${conn()}/credentials/quickbooks`, ID.admin);
    expect(del.status).toBe(200);
    expect(await credentials.getCredentials(ID.bizA, 'quickbooks')).toBeNull();
    await seedOwnerQuickBooks();
    const disconnect = await send('post', `${conn()}/disconnect/quickbooks`, ID.settingsAdmin);
    expect([200, 201]).toContain(disconnect.status);
    expect(await credentials.getCredentials(ID.bizA, 'quickbooks')).toBeNull();
  });

  it('[CON-06] the masked credential form stays open to members and answers no secret: GET credentials/quickbooks gives the sweep member the field schema and a masked access token', async () => {
    await seedOwnerQuickBooks();
    const res = await send('get', `${conn()}/credentials/quickbooks`, ID.staffNone);
    expect(res.status).toBe(200);
    expect(res.body.isConfigured).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(OWNER_QBO.accessToken);
    expect(String(res.body.values?.accessToken ?? '')).toMatch(/^••••/);
  });

  it('[CON-07] a member of another business is refused (BusinessGuard, unchanged)', async () => {
    await seedOwnerQuickBooks();
    expect((await send('get', `${conn()}/webhook-info/webhook_form`, ID.outsider)).status).toBe(403);
    expect((await send('post', `${conn()}/credentials/quickbooks`, ID.outsider, { values: { accessToken: 'x', realmId: 'y' } })).status).toBe(403);
    expect((await send('delete', `${conn()}/credentials/quickbooks`, ID.outsider)).status).toBe(403);
    expect(await credentials.getCredentials(ID.bizA, 'quickbooks')).toEqual(OWNER_QBO);
  });
});
