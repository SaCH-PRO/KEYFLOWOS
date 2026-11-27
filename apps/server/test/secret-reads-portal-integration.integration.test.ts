/**
 * FU-SECRET-READS-PORTAL-INTEGRATION (P145, V1-91 — P0 STOP-THE-LINE SECURITY FIX)
 * Real Postgres + real NestJS HTTP across AuthGuard, BusinessGuard, ModuleScopeGuard
 * and TenantInterceptor verifying closure of 3 live secret-read vulnerabilities:
 *
 *   1. PortalController.listAccess (GET /portal/businesses/:businessId/access):
 *      - SR-PORTAL-01: crm:none STAFF (explicit none, explicit map omitting crm, or JSON array [])
 *        receives 403; zero portal bearer tokens leaked.
 *      - SR-PORTAL-02: crm:read STAFF (explicit { crm: 'read' } and STAFF on role defaults)
 *        receives 200 projected via portalAccessView (`'token' in row === false`, token absent
 *        from serialized body, non-secret metadata + hasLiveLink intact).
 *      - SR-PORTAL-03: crm:write STAFF, OWNER, and SUPER_ADMIN receive 200 with live `token`
 *        preserved; direct PortalService.list(businessId) without actor (or null actor) fails
 *        closed (omits `token`); cross-tenant member receives 403; unauthenticated receives 401;
 *        public GET /portal/validate?token=... remains functional.
 *
 *   2. IntegrationHubController.getDashboard (GET /integration-hub/businesses/:businessId/dashboard)
 *      and sibling connection responses (connect / disconnect):
 *      - SR-IHUB-01: OWNER with connect:admin, STAFF with connect:read, STAFF with connect:admin,
 *        and SUPER_ADMIN receive 200 with connection metadata intact and ZERO `authData` or
 *        `authDataRef` keys or secret values anywhere in the response body (same for POST/DELETE
 *        connection responses).
 *      - SR-IHUB-02: connect:none STAFF, OWNER on role defaults (connect defaults to none),
 *        and cross-tenant member receive 403 with zero secrets leaked.
 *
 *   3. PresenceController.getDraft (GET /site/presence/businesses/:businessId/draft):
 *      - SR-DRAFT-01: content:none STAFF (explicit none, explicit map omitting content, or JSON
 *        array []) receives 403; zero `previewToken` leaked.
 *      - SR-DRAFT-02: content:read STAFF (explicit and role defaults), OWNER, and SUPER_ADMIN
 *        receive 200 with draft and previewToken intact; cross-tenant member receives 403;
 *        unauthenticated receives 401.
 *
 * Fixture prefix: `v91n_` (registered in `test/helpers/fixture-prefixes.json`,
 * cleaned up exclusively via raw SQL `LIKE ${sqlLikePrefix(P)}`).
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v91n_';
const HEADER = 'x-v91n-user';
const DAY_MS = 24 * 60 * 60 * 1000;

const ID = {
  ownerA: `${P}ownerA`,
  ownerAConnect: `${P}ownerAConnect`,
  staffDefaults: `${P}staffDef`,
  staffCrmNone: `${P}staffCrmNone`,
  staffCrmOmitted: `${P}staffCrmOmit`,
  staffArrayScopes: `${P}staffArray`,
  staffCrmRead: `${P}staffCrmRead`,
  staffCrmWrite: `${P}staffCrmWrite`,
  staffConnectNone: `${P}staffConnNone`,
  staffConnectRead: `${P}staffConnRead`,
  staffConnectAdmin: `${P}staffConnAdmin`,
  staffContentNone: `${P}staffContNone`,
  staffContentOmitted: `${P}staffContOmit`,
  staffContentRead: `${P}staffContRead`,
  ownerB: `${P}ownerB`,
  superAdmin: `${P}superAdmin`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  contactA: `${P}contactA`,
  portalAccessA: `${P}paA`,
  providerKey: `${P}provider`,
  provider2Key: `${P}provider2`,
  connA: `${P}connA`,
  draftA: `${P}draftA`,
};

const SECRETS = {
  portalToken: `${P}live_portal_bearer_token_91n_deadbeef`,
  authDataRef: `${P}vault_ref_super_secret_91n`,
  authDataApiKey: `${P}live_api_key_super_secret_91n`,
  authDataRefresh: `${P}refresh_token_super_secret_91n`,
  writeAuthDataRef: `${P}write_vault_ref_super_secret_91n`,
  previewToken: `${P}draft_preview_bearer_token_91n`,
};

let db: any;
let app: any;
let portalService: any;

const has = (o: unknown, k: string) =>
  !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

async function cleanup() {
  for (const sql of [
    `DELETE FROM portal_access WHERE business_id LIKE ${sqlLikePrefix(P)} OR contact_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM integration_sync_runs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM integration_connections WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM integration_providers WHERE key LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM site_pages_published WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM site_page_drafts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try {
      await db.$executeRawUnsafe(sql);
    } catch {
      /* best-effort */
    }
  }
}

function getAs(userId: string | null, url: string) {
  const r = request(app.getHttpServer()).get(url);
  return userId ? r.set(HEADER, userId) : r;
}

function postAs(userId: string | null, url: string, body: Record<string, unknown>) {
  const r = request(app.getHttpServer()).post(url).send(body);
  return userId ? r.set(HEADER, userId) : r;
}

function deleteAs(userId: string | null, url: string) {
  const r = request(app.getHttpServer()).delete(url);
  return userId ? r.set(HEADER, userId) : r;
}

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;
  const tenant = await import('../src/core/tenant/tenant-context');
  dbMod.setTenantContextProvider({ getCurrentBusinessId: tenant.getCurrentBusinessId });

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { APP_INTERCEPTOR } = await import('@nestjs/core');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { RateLimitGuard } = await import('../src/core/guards/rate-limit.guard');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { PortalController } = await import('../src/modules/portal/portal.controller');
  const { PortalService } = await import('../src/modules/portal/portal.service');
  const { IntegrationHubController } = await import(
    '../src/modules/integration-hub/integration-hub.controller'
  );
  const { IntegrationHubService } = await import(
    '../src/modules/integration-hub/integration-hub.service'
  );
  const { PresenceController } = await import('../src/modules/site/presence/presence.controller');
  const { PresenceService } = await import('../src/modules/site/presence/presence.service');
  const { PresenceOverviewService } = await import(
    '../src/modules/site/presence/presence-overview.service'
  );
  const { StorefrontIntelligenceService } = await import(
    '../src/modules/site/presence/storefront-intelligence.service'
  );

  const moduleRef = await Test.createTestingModule({
    controllers: [PortalController, IntegrationHubController, PresenceController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      PortalService,
      IntegrationHubService,
      PresenceService,
      { provide: EventEmitter2, useValue: { emit: () => true } },
      { provide: PresenceOverviewService, useValue: {} },
      { provide: StorefrontIntelligenceService, useValue: {} },
      { provide: REDIS_CLIENT, useValue: {} },
      { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
    ],
  })
    .overrideGuard(RateLimitGuard)
    .useValue({ canActivate: () => true })
    .compile();

  portalService = moduleRef.get(PortalService);

  app = moduleRef.createNestApplication();
  app.use(async (req: any, _res: any, next: any) => {
    const header = req.headers[HEADER];
    const id = typeof header === 'string' ? header : undefined;
    if (id && id.startsWith(P)) {
      const user = await db.user.findUnique({
        where: { id },
        select: { id: true, email: true, role: true },
      });
      if (user) req.user = { id: user.id, email: user.email, role: user.role };
    }
    next();
  });
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();

  await cleanup();

  // Seed users
  for (const [id, role] of [
    [ID.ownerA, 'USER'],
    [ID.ownerAConnect, 'USER'],
    [ID.staffDefaults, 'USER'],
    [ID.staffCrmNone, 'USER'],
    [ID.staffCrmOmitted, 'USER'],
    [ID.staffArrayScopes, 'USER'],
    [ID.staffCrmRead, 'USER'],
    [ID.staffCrmWrite, 'USER'],
    [ID.staffConnectNone, 'USER'],
    [ID.staffConnectRead, 'USER'],
    [ID.staffConnectAdmin, 'USER'],
    [ID.staffContentNone, 'USER'],
    [ID.staffContentOmitted, 'USER'],
    [ID.staffContentRead, 'USER'],
    [ID.ownerB, 'USER'],
    [ID.superAdmin, 'SUPER_ADMIN'],
  ] as const) {
    await db.user.create({
      data: { id, email: `${P}${id.slice(P.length)}@test.local`, name: id, role },
    });
  }

  // Seed businesses
  await db.business.create({
    data: { id: ID.bizA, name: 'V91N Biz A', slug: `${P}biz-a`, ownerId: ID.ownerA },
  });
  await db.business.create({
    data: { id: ID.bizB, name: 'V91N Biz B', slug: `${P}biz-b`, ownerId: ID.ownerB },
  });

  // Seed memberships
  const memberships: Array<[string, string, string, unknown]> = [
    [ID.ownerA, ID.bizA, 'OWNER', undefined],
    [ID.ownerAConnect, ID.bizA, 'OWNER', { connect: 'admin', settings: 'admin', crm: 'admin', content: 'admin' }],
    [ID.staffDefaults, ID.bizA, 'STAFF', undefined],
    [ID.staffCrmNone, ID.bizA, 'STAFF', { crm: 'none', content: 'read' }],
    [ID.staffCrmOmitted, ID.bizA, 'STAFF', { content: 'read' }],
    [ID.staffArrayScopes, ID.bizA, 'STAFF', []],
    [ID.staffCrmRead, ID.bizA, 'STAFF', { crm: 'read' }],
    [ID.staffCrmWrite, ID.bizA, 'STAFF', { crm: 'write' }],
    [ID.staffConnectNone, ID.bizA, 'STAFF', { connect: 'none', crm: 'read' }],
    [ID.staffConnectRead, ID.bizA, 'STAFF', { connect: 'read' }],
    [ID.staffConnectAdmin, ID.bizA, 'STAFF', { connect: 'admin', settings: 'admin' }],
    [ID.staffContentNone, ID.bizA, 'STAFF', { content: 'none', crm: 'read' }],
    [ID.staffContentOmitted, ID.bizA, 'STAFF', { crm: 'read' }],
    [ID.staffContentRead, ID.bizA, 'STAFF', { content: 'read' }],
    [ID.ownerB, ID.bizB, 'OWNER', undefined],
  ];
  let mIdx = 0;
  for (const [userId, businessId, role, permissionScopes] of memberships) {
    await db.membership.create({
      data: {
        id: `${P}m${mIdx++}`,
        userId,
        businessId,
        role,
        ...(permissionScopes !== undefined ? { permissionScopes } : {}),
      },
    });
  }

  // Seed portal contact + live portal access grant in bizA
  await db.contact.create({
    data: {
      id: ID.contactA,
      businessId: ID.bizA,
      firstName: 'V91N',
      lastName: 'Client',
      email: `${P}client@test.local`,
    },
  });
  await db.portalAccess.create({
    data: {
      id: ID.portalAccessA,
      businessId: ID.bizA,
      contactId: ID.contactA,
      token: SECRETS.portalToken,
      expiresAt: new Date(Date.now() + 30 * DAY_MS),
      enabled: true,
      settings: { invoices: true, projects: true, documents: false, bookings: true },
    },
  });

  // Seed integration providers + connection with authData and authDataRef in bizA
  await db.integrationProvider.create({
    data: {
      id: `${P}prov1`,
      key: ID.providerKey,
      name: 'V91N Stripe',
      category: 'payments',
      description: 'Test payment provider',
      authType: 'api_key',
      capabilities: ['payments.read'],
      scopes: ['payments.read'],
      status: 'ACTIVE',
    },
  });
  await db.integrationProvider.create({
    data: {
      id: `${P}prov2`,
      key: ID.provider2Key,
      name: 'V91N Secondary',
      category: 'payments',
      description: 'Test write provider',
      authType: 'api_key',
      capabilities: ['payments.read'],
      scopes: ['payments.read'],
      status: 'ACTIVE',
    },
  });
  await db.integrationConnection.create({
    data: {
      id: ID.connA,
      businessId: ID.bizA,
      providerKey: ID.providerKey,
      displayName: 'V91N Stripe Live',
      status: 'CONNECTED',
      authDataRef: SECRETS.authDataRef,
      authData: {
        apiKey: SECRETS.authDataApiKey,
        refreshToken: SECRETS.authDataRefresh,
      },
      scopes: ['payments.read'],
      settings: { mode: 'live' },
      healthScore: 98,
    },
  });

  // Seed SitePageDraft with live previewToken in bizA
  await db.sitePageDraft.create({
    data: {
      id: ID.draftA,
      businessId: ID.bizA,
      version: 2,
      status: 'PREVIEW',
      previewToken: SECRETS.previewToken,
      previewExpiresAt: new Date(Date.now() + DAY_MS),
      payload: {
        branding: { primaryColor: '#F97316', secondaryColor: '#14B8A6', fontPairing: 'inter-inter' },
        sections: [
          { id: 'sec_hero', type: 'hero', visible: true, data: { headline: 'V91N Draft Hero', subheadline: '', ctaLabel: 'Book now' } },
        ],
        seo: { robotsIndex: true },
        slug: `${P}biz-a`,
      },
    },
  });
}, 120_000);

afterAll(async () => {
  if (app) await app.close();
  if (db) await cleanup();
});

describe('FU-SECRET-READS-PORTAL-INTEGRATION (P145, V1-91)', () => {
  describe('1. PortalController.listAccess (GET /portal/businesses/:businessId/access)', () => {
    it.each([
      ['STAFF with explicit { crm: "none" }', ID.staffCrmNone],
      ['STAFF with explicit map omitting crm', ID.staffCrmOmitted],
      ['STAFF with JSON array [] permissionScopes', ID.staffArrayScopes],
    ])(
      '[SR-PORTAL-01] RED-BEFORE: %s receives 403 and zero portal bearer tokens leak',
      async (_label, userId) => {
        const res = await getAs(userId, `/portal/businesses/${ID.bizA}/access`);
        expect(res.status).toBe(403);
        expect(JSON.stringify(res.body)).not.toContain(SECRETS.portalToken);
      },
    );

    it.each([
      ['STAFF with explicit { crm: "read" }', ID.staffCrmRead],
      ['STAFF with role defaults (crm: read)', ID.staffDefaults],
    ])(
      '[SR-PORTAL-02] RED-BEFORE: %s receives 200 projected via portalAccessView (token key absent, secret absent)',
      async (_label, userId) => {
        const res = await getAs(userId, `/portal/businesses/${ID.bizA}/access`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThanOrEqual(1);
        const row = res.body.find((r: any) => r.id === ID.portalAccessA);
        expect(row).toBeDefined();
        expect('token' in row).toBe(false);
        expect(has(row, 'token')).toBe(false);
        expect(row.contactId).toBe(ID.contactA);
        expect(row.enabled).toBe(true);
        expect(row.hasLiveLink).toBe(true);
        expect(JSON.stringify(res.body)).not.toContain(SECRETS.portalToken);
      },
    );

    it.each([
      ['STAFF with explicit { crm: "write" }', ID.staffCrmWrite],
      ['OWNER with membership', ID.ownerA],
      ['SUPER_ADMIN with no membership', ID.superAdmin],
    ])(
      '[SR-PORTAL-03] CONTROL: %s receives 200 with live portal token preserved',
      async (_label, userId) => {
        const res = await getAs(userId, `/portal/businesses/${ID.bizA}/access`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        const row = res.body.find((r: any) => r.id === ID.portalAccessA);
        expect(row).toBeDefined();
        expect(row.token).toBe(SECRETS.portalToken);
      },
    );

    it('[SR-PORTAL-03] RED-BEFORE: direct PortalService.list(businessId) without actor (or null actor) fails closed and omits token', async () => {
      for (const actor of [undefined, null]) {
        const rows = await portalService.list(ID.bizA, actor);
        expect(Array.isArray(rows)).toBe(true);
        const row = rows.find((r: any) => r.id === ID.portalAccessA);
        expect(row).toBeDefined();
        expect('token' in row).toBe(false);
        expect(has(row, 'token')).toBe(false);
        expect(row.hasLiveLink).toBe(true);
        expect(JSON.stringify(rows)).not.toContain(SECRETS.portalToken);
      }
    });

    it('[SR-PORTAL-03] CONTROL: cross-tenant OWNER receives 403 and unauthenticated receives 401; public /portal/validate stays live', async () => {
      const cross = await getAs(ID.ownerB, `/portal/businesses/${ID.bizA}/access`);
      expect(cross.status).toBe(403);
      expect(JSON.stringify(cross.body)).not.toContain(SECRETS.portalToken);

      const unauth = await getAs(null, `/portal/businesses/${ID.bizA}/access`);
      expect(unauth.status).toBe(401);

      const pub = await getAs(null, `/portal/validate?token=${encodeURIComponent(SECRETS.portalToken)}`);
      expect(pub.status).toBe(200);
      expect(pub.body.valid).toBe(true);
      expect(pub.body.businessId).toBe(ID.bizA);
    });
  });

  describe('2. IntegrationHubController.getDashboard (GET /integration-hub/businesses/:businessId/dashboard)', () => {
    it.each([
      ['OWNER with explicit connect:admin', ID.ownerAConnect],
      ['STAFF with explicit { connect: "read" }', ID.staffConnectRead],
      ['STAFF with explicit { connect: "admin" }', ID.staffConnectAdmin],
      ['SUPER_ADMIN with no membership', ID.superAdmin],
    ])(
      '[SR-IHUB-01] RED-BEFORE: %s receives 200 with connection metadata intact and ZERO authData or authDataRef',
      async (_label, userId) => {
        const res = await getAs(userId, `/integration-hub/businesses/${ID.bizA}/dashboard`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body?.entries)).toBe(true);
        const entry = res.body.entries.find((e: any) => e.provider?.key === ID.providerKey);
        expect(entry).toBeDefined();
        expect(entry.connection).toBeDefined();
        const conn = entry.connection;
        expect(conn.id).toBe(ID.connA);
        expect(conn.businessId).toBe(ID.bizA);
        expect(conn.providerKey).toBe(ID.providerKey);
        expect(conn.displayName).toBe('V91N Stripe Live');
        expect(conn.status).toBe('CONNECTED');
        expect(conn.healthScore).toBe(98);
        expect('authData' in conn).toBe(false);
        expect('authDataRef' in conn).toBe(false);
        expect(has(conn, 'authData')).toBe(false);
        expect(has(conn, 'authDataRef')).toBe(false);
        const serialized = JSON.stringify(res.body);
        expect(serialized).not.toContain(SECRETS.authDataRef);
        expect(serialized).not.toContain(SECRETS.authDataApiKey);
        expect(serialized).not.toContain(SECRETS.authDataRefresh);
      },
    );

    it('[SR-IHUB-01] RED-BEFORE: POST connect and DELETE disconnect do not echo authDataRef or authData', async () => {
      const created = await postAs(
        ID.ownerAConnect,
        `/integration-hub/businesses/${ID.bizA}/connections/${ID.provider2Key}`,
        { authDataRef: SECRETS.writeAuthDataRef, scopes: ['payments.read'], settings: { env: 'test' } },
      );
      expect(created.status).toBe(201);
      expect('authData' in created.body).toBe(false);
      expect('authDataRef' in created.body).toBe(false);
      expect(JSON.stringify(created.body)).not.toContain(SECRETS.writeAuthDataRef);

      const disconnected = await deleteAs(
        ID.ownerAConnect,
        `/integration-hub/businesses/${ID.bizA}/connections/${ID.provider2Key}`,
      );
      expect(disconnected.status).toBe(200);
      expect(disconnected.body.status).toBe('DISCONNECTED');
      expect('authData' in disconnected.body).toBe(false);
      expect('authDataRef' in disconnected.body).toBe(false);
      expect(JSON.stringify(disconnected.body)).not.toContain(SECRETS.writeAuthDataRef);
    });

    it.each([
      ['STAFF with explicit { connect: "none" }', ID.staffConnectNone],
      ['STAFF with role defaults (connect: none)', ID.staffDefaults],
      ['OWNER with role defaults (connect: none)', ID.ownerA],
      ['cross-tenant OWNER of bizB', ID.ownerB],
    ])(
      '[SR-IHUB-02] CONTROL: %s receives 403 on integration-hub dashboard with zero secrets leaked',
      async (_label, userId) => {
        const res = await getAs(userId, `/integration-hub/businesses/${ID.bizA}/dashboard`);
        expect(res.status).toBe(403);
        const serialized = JSON.stringify(res.body);
        expect(serialized).not.toContain(SECRETS.authDataRef);
        expect(serialized).not.toContain(SECRETS.authDataApiKey);
        expect(serialized).not.toContain(SECRETS.authDataRefresh);
      },
    );
  });

  describe('3. PresenceController.getDraft (GET /site/presence/businesses/:businessId/draft)', () => {
    it.each([
      ['STAFF with explicit { content: "none" }', ID.staffContentNone],
      ['STAFF with explicit map omitting content', ID.staffContentOmitted],
      ['STAFF with JSON array [] permissionScopes', ID.staffArrayScopes],
    ])(
      '[SR-DRAFT-01] RED-BEFORE: %s receives 403 on presence draft and zero previewToken leaks',
      async (_label, userId) => {
        const res = await getAs(userId, `/site/presence/businesses/${ID.bizA}/draft`);
        expect(res.status).toBe(403);
        expect(JSON.stringify(res.body)).not.toContain(SECRETS.previewToken);
      },
    );

    it.each([
      ['STAFF with explicit { content: "read" }', ID.staffContentRead],
      ['STAFF with role defaults (content: read)', ID.staffDefaults],
      ['OWNER with membership', ID.ownerA],
      ['SUPER_ADMIN with no membership', ID.superAdmin],
    ])(
      '[SR-DRAFT-02] CONTROL: %s receives 200 with draft intact',
      async (_label, userId) => {
        const res = await getAs(userId, `/site/presence/businesses/${ID.bizA}/draft`);
        expect(res.status).toBe(200);
        expect(res.body?.draft?.id).toBe(ID.draftA);
        expect(res.body?.draft?.previewToken).toBe(SECRETS.previewToken);
        expect(res.body?.draft?.status).toBe('PREVIEW');
      },
    );

    it('[SR-DRAFT-02] CONTROL: cross-tenant OWNER receives 403 and unauthenticated receives 401', async () => {
      const cross = await getAs(ID.ownerB, `/site/presence/businesses/${ID.bizA}/draft`);
      expect(cross.status).toBe(403);
      expect(JSON.stringify(cross.body)).not.toContain(SECRETS.previewToken);

      const unauth = await getAs(null, `/site/presence/businesses/${ID.bizA}/draft`);
      expect(unauth.status).toBe(401);
    });
  });
});
