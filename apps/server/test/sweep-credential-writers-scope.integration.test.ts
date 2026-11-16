/**
 * SWEEP-P0-SCOPES round 1 class repair, CLASS B — every member route (and KEY action) that writes,
 * replaces, clears or moves a business's provider credential needs settings admin (or the owner rule
 * where a ruling sets one), against a REAL database through the HTTP routes.
 *
 * The reviews found the class one route at a time (SEC-1 connector credentials, SV-2 channel and
 * social connections, SV-3 the Outlook consent start). RC-2: ShopifyController.connect (POST
 * /shopify/businesses/:b/connect) ran AuthGuard and BusinessGuard only and called
 * ConnectorCredentialsService.setCredentials with the body: any member replaced the business's
 * Shopify shop and token. The census spec now finds such routes by the call graph (CEN-10), and it
 * found these siblings, each pinned here by route family:
 *   - ShopifyController.connect (RC-2): ConnectorCredentialsService.setCredentials;
 *   - SupplierController create, update and delete connection: SupplierConnection.credentials (and
 *     its deactivation);
 *   - IntegrationHubController connect and disconnect: IntegrationConnection.authDataRef (connect
 *     write alone: a STAFF member given connect write bound the business's integration; connect write
 *     stays, settings admin is added);
 *   - ConnectController.disconnectSource for outlook_contacts: it cleared the Outlook contacts tokens
 *     (the Google branch already answers the D-99 owner rule; the Outlook consent start is settings
 *     admin since SV-3);
 *   - the KEY actions social.connect_account, social.disconnect_account (SocialAdapterService, any
 *     member KEY admitted wrote a social token) and settings.configure_integration
 *     (SettingsAdapterService, connect write alone; connect write stays), reached through every KEY door.
 * (CommunicationsController.syncFromSocial, which copies the social tokens over the business's channel
 * connections, is pinned with its siblings in sweep-channel-connections-scope; KeyConnectorController's
 * D-114 case in key-connector-authority.)
 *
 * The rule (as SEC-1 ruled the connector credentials): settings admin, OWNER and ADMIN by role default,
 * STAFF none; an explicit map binds every role (D-114 / D-140), so an ADMIN whose map says settings
 * 'none' is refused, and a STAFF member given settings 'admin' passes. A member with the module's own
 * write (connect write, storefront write, settings write) is not enough.
 *
 * Nothing on the authorization or persistence path is mocked: PrismaService, AuthGuard,
 * BusinessGuard, ModuleScopeGuard, the global ValidationPipe and GlobalHttpExceptionFilter, the real
 * controllers and their credential services (ConnectorCredentialsService, SupplierService,
 * IntegrationHubService, OutlookContactsSyncService, SocialConnectionsService) against DATABASE_URL.
 * The stand-ins: identity attachment (`x-test-user`), ShopifyService.testConnection (answers success
 * without calling Shopify) and the collaborators no case reaches. Every outbound fetch is recorded and
 * refused, so no case reaches a provider.
 *
 * Requires DATABASE_URL. Every seeded row carries the `v99q_` prefix and is hard-deleted by raw SQL
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

const P = 'v99q_';
const ID = {
  owner: `${P}owner`, // OWNER of bizA, no explicit map
  admin: `${P}admin`, // ADMIN of bizA, no explicit map (settings admin by role default)
  adminSetNone: `${P}adminSetNone`, // ADMIN of bizA, explicit settings 'none' but connect, storefront admin (D-114)
  staffNone: `${P}staffNone`, // STAFF of bizA, explicit settings/connect/storefront none
  staffDefault: `${P}staffDefault`, // STAFF of bizA, no explicit map (settings none by role default)
  moduleWrite: `${P}moduleWrite`, // STAFF of bizA, explicit settings 'write', connect 'write', storefront 'write' (not settings admin)
  settingsAdmin: `${P}settingsAdmin`, // STAFF of bizA, explicit settings 'admin' (every other module absent: none)
  connectAdmin: `${P}connectAdmin`, // STAFF of bizA, explicit settings 'admin' and connect 'write' (the integration hub keeps connect write)
  bizA: `${P}bizA`,
  provider: `${P}provider`, // an IntegrationProvider key (a global table)
};
const BELOW_SETTINGS_ADMIN = [ID.staffNone, ID.staffDefault, ID.moduleWrite, ID.adminSetNone];
const OWNER_SHOP_TOKEN = `${P}owner_shopify_token_SECRET`;

const outbound: string[] = [];
let db: any;
let app: any;
let credentials: any;
let socialAdapter: any;
let settingsAdapter: any;

async function cleanup() {
  for (const sql of [
    `DELETE FROM supplier_connections WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM integration_connections WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM integration_providers WHERE key LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM connector_statuses WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

const rowsOf = (table: string, column = 'business_id') =>
  db.$queryRawUnsafe(`SELECT to_jsonb(t)::text AS row FROM ${table} t WHERE ${column} LIKE ${sqlLikePrefix(P)} ORDER BY id`);
const outlookTokens = () =>
  db.business.findUnique({ where: { id: ID.bizA }, select: { msContactsAccessToken: true, msContactsRefreshToken: true, msContactsTokenExpiry: true } });

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    outbound.push(url);
    throw new Error(`v99q: no provider traffic (${url})`);
  }) as any);
  void realFetch;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { ShopifyController } = await import('../src/modules/shopify/shopify.controller');
  const { ShopifyService } = await import('../src/modules/shopify/shopify.service');
  const { ConnectorCredentialsService } = await import('../src/core/connectors/connector-credentials.service');
  const { SupplierController } = await import('../src/modules/supplier/supplier.controller');
  const { SupplierService } = await import('../src/modules/supplier/supplier.service');
  const { ProductNormalizationService } = await import('../src/modules/supplier/product-normalization.service');
  const { CrmRateLimitGuard } = await import('../src/modules/crm/guards/rate-limit.guard');
  const { IntegrationHubController } = await import('../src/modules/integration-hub/integration-hub.controller');
  const { IntegrationHubService } = await import('../src/modules/integration-hub/integration-hub.service');
  const { ConnectController } = await import('../src/modules/connect/connect.controller');
  const { GoogleFormsService } = await import('../src/modules/connect/google-forms.service');
  const { GoogleFormsMappingService } = await import('../src/modules/connect/google-forms-mapping.service');
  const { GoogleContactsSyncService } = await import('../src/modules/connect/google-contacts-sync.service');
  const { OutlookContactsSyncService } = await import('../src/modules/connect/outlook-contacts-sync.service');
  const { ContactSyncService } = await import('../src/modules/connect/contact-sync.service');
  const { SignatureParserService } = await import('../src/modules/connect/signature-parser.service');
  const { GoogleBusinessProfileService } = await import('../src/modules/connect/google-business-profile.service');
  const { ConnectorFormMappingService } = await import('../src/modules/connect/connector-form-mapping.service');
  const { CrmService } = await import('../src/modules/crm/crm.service');
  const { ContactAuditService } = await import('../src/modules/crm/privacy/contact-audit.service');
  const { SocialConnectionsService } = await import('../src/modules/social/social-connections.service');
  const { SocialAdapterService } = await import('../src/modules/key-cortex/adapters/social-adapter.service');
  const { SettingsAdapterService } = await import('../src/modules/key-cortex/adapters/settings-adapter.service');

  const moduleRef = await Test.createTestingModule({
    controllers: [ShopifyController, SupplierController, IntegrationHubController, ConnectController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      CrmRateLimitGuard,
      ConnectorCredentialsService,
      SupplierService,
      IntegrationHubService,
      OutlookContactsSyncService,
      SocialConnectionsService,
      // ShopifyService: the connection check answers success without calling Shopify.
      { provide: ShopifyService, useValue: { testConnection: async () => ({ success: true, shopName: 'v99q stub shop' }) } },
      { provide: ProductNormalizationService, useValue: {} },
      { provide: GoogleFormsService, useValue: {} },
      { provide: GoogleFormsMappingService, useValue: {} },
      { provide: GoogleContactsSyncService, useValue: { disconnect: async () => undefined } },
      { provide: ContactSyncService, useValue: {} },
      { provide: SignatureParserService, useValue: {} },
      { provide: GoogleBusinessProfileService, useValue: {} },
      { provide: ConnectorFormMappingService, useValue: {} },
      { provide: CrmService, useValue: {} },
      { provide: ContactAuditService, useValue: {} },
    ],
  }).compile();
  credentials = moduleRef.get(ConnectorCredentialsService);
  const prisma = moduleRef.get(PrismaService);
  const hub = moduleRef.get(IntegrationHubService);
  const socialConnections = moduleRef.get(SocialConnectionsService);
  // The KEY adapters, as KeyCortexConnectorService reaches them (their collaborators no case uses are stand-ins).
  socialAdapter = new SocialAdapterService({} as any, socialConnections, {} as any, {} as any, prisma);
  settingsAdapter = new SettingsAdapterService({} as any, hub, prisma);

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
  for (const id of Object.values(ID).filter((v) => !v.startsWith(`${P}biz`) && v !== ID.provider)) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role: 'USER' } });
  }
  await db.business.create({
    data: {
      id: ID.bizA,
      name: 'V99Q Biz A',
      ownerId: ID.owner,
      msContactsAccessToken: `${P}owner_outlook_access`,
      msContactsRefreshToken: `${P}owner_outlook_refresh`,
    },
  });
  const m = (user: string, role: string, permissionScopes?: Record<string, string>) =>
    db.membership.create({ data: { id: `${P}m_${user.slice(P.length)}`, userId: user, businessId: ID.bizA, role, permissionScopes: permissionScopes ?? undefined } });
  await m(ID.owner, 'OWNER');
  await m(ID.admin, 'ADMIN');
  await m(ID.adminSetNone, 'ADMIN', { settings: 'none', connect: 'admin', storefront: 'admin', crm: 'admin' });
  await m(ID.staffNone, 'STAFF', { settings: 'none', connect: 'none', storefront: 'none' });
  await m(ID.staffDefault, 'STAFF');
  await m(ID.moduleWrite, 'STAFF', { settings: 'write', connect: 'write', storefront: 'write' });
  await m(ID.settingsAdmin, 'STAFF', { settings: 'admin' });
  await m(ID.connectAdmin, 'STAFF', { settings: 'admin', connect: 'write' });
  await db.integrationProvider.create({ data: { key: ID.provider, name: 'V99Q Provider', category: 'test', authType: 'api_key' } });
}, 120_000);

afterAll(async () => {
  vi.restoreAllMocks();
  if (app) await app.close();
  if (db) await cleanup();
});

describe('RC-2: Shopify connect binds the business\'s Shopify shop and token (ConnectorCredentialsService.setCredentials)', () => {
  it('[CRW-SHP-01] RED-BEFORE: a member below settings admin (STAFF on defaults or with none, STAFF with connect, storefront and settings write, an ADMIN whose map says settings none) is refused with 403 and the owner\'s stored Shopify credentials are unchanged', async () => {
    const owner = await send('post', `/shopify/businesses/${ID.bizA}/connect`, ID.owner, { shopDomain: '203.0.113.82', accessToken: OWNER_SHOP_TOKEN });
    expect(owner.status).toBe(201);
    expect(await credentials.getCredentials(ID.bizA, 'shopify')).toEqual({ shopDomain: '203.0.113.82', accessToken: OWNER_SHOP_TOKEN });
    const before = await rowsOf('connector_statuses');
    for (const actor of BELOW_SETTINGS_ADMIN) {
      const res = await send('post', `/shopify/businesses/${ID.bizA}/connect`, actor, { shopDomain: '203.0.113.81', accessToken: `${P}attacker_shopify_token` });
      expect(res.status, actor).toBe(403);
      expect(String(res.body?.message ?? ''), actor).toMatch(/settings requires admin access/);
    }
    expect(await rowsOf('connector_statuses')).toEqual(before);
    expect(await credentials.getCredentials(ID.bizA, 'shopify')).toEqual({ shopDomain: '203.0.113.82', accessToken: OWNER_SHOP_TOKEN });
  });

  it('[CRW-SHP-02] settings admin binds it: an ADMIN on role defaults and a STAFF member given settings admin each connect (201), and the stored credentials are theirs', async () => {
    for (const actor of [ID.admin, ID.settingsAdmin]) {
      const res = await send('post', `/shopify/businesses/${ID.bizA}/connect`, actor, { shopDomain: '203.0.113.83', accessToken: `${P}${actor.slice(P.length)}_token` });
      expect(res.status, actor).toBe(201);
      expect(await credentials.getCredentials(ID.bizA, 'shopify'), actor).toEqual({ shopDomain: '203.0.113.83', accessToken: `${P}${actor.slice(P.length)}_token` });
    }
  });
});

describe('the supplier connection credentials (SupplierConnection.credentials)', () => {
  it('[CRW-SUP-01] RED-BEFORE: creating, changing or deactivating a supplier connection needs settings admin: every member below it gets 403 and no supplier connection row is written or changed', async () => {
    const created = await send('post', `/supplier/businesses/${ID.bizA}/connections`, ID.owner, { providerType: 'custom_api', displayName: 'Owner supplier', credentials: { apiKey: `${P}owner_supplier_key` } });
    expect(created.status).toBe(201);
    const before = await rowsOf('supplier_connections');
    for (const actor of BELOW_SETTINGS_ADMIN) {
      const c = await send('post', `/supplier/businesses/${ID.bizA}/connections`, actor, { providerType: 'custom_api', displayName: 'Attacker', credentials: { apiKey: `${P}attacker_key` } });
      expect(c.status, `${actor} create`).toBe(403);
      const u = await send('patch', `/supplier/businesses/${ID.bizA}/connections/${created.body.id}`, actor, { credentials: { apiKey: `${P}attacker_key` } });
      expect(u.status, `${actor} update`).toBe(403);
      const d = await send('delete', `/supplier/businesses/${ID.bizA}/connections/${created.body.id}`, actor);
      expect(d.status, `${actor} deactivate`).toBe(403);
      expect(String(c.body?.message ?? ''), actor).toMatch(/settings requires admin access/);
    }
    expect(await rowsOf('supplier_connections')).toEqual(before);
  });

  it('[CRW-SUP-02] a STAFF member given settings admin creates, changes and deactivates one', async () => {
    const c = await send('post', `/supplier/businesses/${ID.bizA}/connections`, ID.settingsAdmin, { providerType: 'custom_api', displayName: 'Admin supplier', credentials: { apiKey: `${P}admin_key` } });
    expect(c.status).toBe(201);
    expect((await send('patch', `/supplier/businesses/${ID.bizA}/connections/${c.body.id}`, ID.settingsAdmin, { displayName: 'Admin supplier 2' })).status).toBe(200);
    expect((await send('delete', `/supplier/businesses/${ID.bizA}/connections/${c.body.id}`, ID.settingsAdmin)).status).toBe(200);
  });
});

describe('the integration hub binding (IntegrationConnection.authDataRef)', () => {
  // Connect write stays (connect is none for every role by deliberate decision, module-vocabulary.ts):
  // binding an integration now needs it and settings admin.
  it('[CRW-HUB-01] RED-BEFORE: connecting or disconnecting an integration needs settings admin as well as connect write: a STAFF member with connect write and settings write, an ADMIN with connect admin whose map says settings none, and a settings admin without connect write are refused with 403 and nothing is written', async () => {
    const first = await send('post', `/integration-hub/businesses/${ID.bizA}/connections/${ID.provider}`, ID.connectAdmin, { authDataRef: `${P}admin_vault_ref` });
    expect(first.status).toBe(201);
    const before = await rowsOf('integration_connections');
    for (const actor of [...BELOW_SETTINGS_ADMIN, ID.settingsAdmin]) {
      const c = await send('post', `/integration-hub/businesses/${ID.bizA}/connections/${ID.provider}`, actor, { authDataRef: `${P}attacker_ref` });
      expect(c.status, `${actor} connect`).toBe(403);
      const d = await send('delete', `/integration-hub/businesses/${ID.bizA}/connections/${ID.provider}`, actor);
      expect(d.status, `${actor} disconnect`).toBe(403);
    }
    expect(await rowsOf('integration_connections')).toEqual(before);
  });

  it('[CRW-HUB-02] a member with settings admin and connect write (a STAFF member given both) connects and disconnects', async () => {
    expect((await send('post', `/integration-hub/businesses/${ID.bizA}/connections/${ID.provider}`, ID.connectAdmin, { authDataRef: `${P}admin_ref` })).status).toBe(201);
    expect((await send('delete', `/integration-hub/businesses/${ID.bizA}/connections/${ID.provider}`, ID.connectAdmin)).status).toBe(200);
  });
});

describe('the Outlook contacts disconnect (Business.msContacts* tokens)', () => {
  it('[CRW-OUT-01] RED-BEFORE: DELETE contact-sources/outlook_contacts needs settings admin (the Outlook consent start is settings admin, SV-3): every member below it gets 403 and the stored Outlook tokens stay', async () => {
    const before = await outlookTokens();
    expect(before?.msContactsRefreshToken).toBe(`${P}owner_outlook_refresh`);
    for (const actor of BELOW_SETTINGS_ADMIN) {
      const res = await send('delete', `/connect/businesses/${ID.bizA}/contact-sources/outlook_contacts`, actor);
      expect(res.status, actor).toBe(403);
      expect(String(res.body?.message ?? ''), actor).toMatch(/settings requires admin access/);
    }
    expect(await outlookTokens()).toEqual(before);
  });

  it('[CRW-OUT-02] settings admin disconnects it: the tokens are cleared', async () => {
    const res = await send('delete', `/connect/businesses/${ID.bizA}/contact-sources/outlook_contacts`, ID.settingsAdmin);
    expect(res.status).toBe(200);
    expect(await outlookTokens()).toEqual({ msContactsAccessToken: null, msContactsRefreshToken: null, msContactsTokenExpiry: null });
  });
});

describe('the KEY actions that bind a credential (every KEY door reaches them through the adapters)', () => {
  /** As KeyCortexConnectorService.execute answers an adapter that throws: a failure carrying the message. */
  const run = (adapter: any, cmd: unknown) =>
    adapter.execute(cmd).catch((e: unknown) => ({ success: false, error: e instanceof Error ? e.message : String(e) }));
  const command = (action: string, userId: string, parameters: Record<string, unknown>) => ({
    id: `${P}cmd_${action}_${userId.slice(P.length)}`,
    businessId: ID.bizA,
    userId,
    module: action.includes('integration') ? 'settings' : 'social',
    action,
    parameters,
  });

  it('[CRW-KEY-01] RED-BEFORE: social.connect_account and social.disconnect_account need settings admin: a member below it is answered a failure and no social connection is written or removed', async () => {
    await db.socialConnection.create({ data: { id: `${P}sc_owner`, businessId: ID.bizA, platform: 'FACEBOOK', platformId: `${P}page`, accountName: 'Owner page', token: `${P}owner_fb_token`, status: 'CONNECTED' } });
    const before = await rowsOf('social_connections');
    for (const actor of BELOW_SETTINGS_ADMIN) {
      const connect = await run(socialAdapter, command('connect_account', actor, { platform: 'facebook', handle: 'attacker', accessToken: `${P}attacker_fb_token` }));
      expect(connect.success, `${actor} connect`).toBe(false);
      expect(String(connect.error ?? ''), `${actor} connect`).toMatch(/settings requires admin access|Authentication required/);
      const disconnect = await run(socialAdapter, command('disconnect_account', actor, { accountId: `${P}sc_owner` }));
      expect(disconnect.success, `${actor} disconnect`).toBe(false);
    }
    expect(await rowsOf('social_connections')).toEqual(before);
  });

  it('[CRW-KEY-02] RED-BEFORE: settings.configure_integration needs settings admin as well as connect write: a STAFF member with connect write and settings write and an ADMIN with connect admin whose map says settings none are answered a failure, and nothing is written', async () => {
    const before = await rowsOf('integration_connections');
    for (const actor of [...BELOW_SETTINGS_ADMIN, ID.settingsAdmin]) {
      const res = await run(settingsAdapter, command('configure_integration', actor, { integration: ID.provider, config: { authDataRef: `${P}attacker_ref` }, enabled: true }));
      expect(res.success, actor).toBe(false);
    }
    expect(await rowsOf('integration_connections')).toEqual(before);
  });

  it('[CRW-KEY-03] settings admin may: the STAFF member given settings admin connects a social account through KEY, and the one given settings admin and connect write configures an integration', async () => {
    const res = await run(socialAdapter, command('connect_account', ID.settingsAdmin, { platform: 'linkedin', handle: 'admin', accessToken: `${P}admin_li_token` }));
    expect(res.success).toBe(true);
    expect(await db.socialConnection.count({ where: { businessId: ID.bizA, platform: 'LINKEDIN' } })).toBeGreaterThan(0);
    const configured = await run(settingsAdapter, command('configure_integration', ID.connectAdmin, { integration: ID.provider, config: { region: 'tt' }, enabled: true }));
    expect(configured.success).toBe(true);
  });

  it('[CRW-NET] no case reached a provider over the network', () => {
    expect(outbound).toEqual([]);
  });
});
