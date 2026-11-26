/**
 * FU-PRESENCE-REVENUE-SCOPE (P100, D-100 / D-104) — real-Postgres + real-HTTP
 * integration proof that the Presence Command Center read routes enforce
 * module-scope and CRM contact visibility:
 *
 *   - GET /site/presence/businesses/:businessId/overview:
 *       withholds `kpis.revenue` (key absent, not zero) and skips the paid
 *       order/invoice revenue queries when the caller's `revenue` module level
 *       is below `read` (explicit `{ revenue: 'none' }`, explicit map omitting
 *       `revenue`, ADMIN with `revenue: 'none'`, or stored JSON array `[]`).
 *       Non-money KPIs (`visits`, `leadsCaptured`, `ordersCreated`,
 *       `bookingsCreated`) stay intact.
 *   - GET /site/presence/businesses/:businessId/today-stats:
 *       withholds `events.revenue` and `recentOrders[].total` when the caller
 *       lacks `revenue:read`; keeps non-money traffic and order fulfilment
 *       fields.
 *   - GET /site/presence/businesses/:businessId/leads:
 *       returns `{ items: [] }` (skipping the contact read — zero leakage of
 *       `email`, `phone`, `whatsappNumber`, or `PRIVATE` contacts) when the
 *       caller's `crm` module level is below `read` (explicit `{ crm: 'none' }`,
 *       explicit map omitting `crm`, ADMIN with `crm: 'none'`, or JSON array
 *       `[]`); and when `crm:read` is held, enforces CRM contact visibility
 *       (`resolveCrmAccess` + `visibilityClause`: hides `OWNER`'s `PRIVATE`
 *       leads from non-owner staff, and restricts `crm_view: 'owned'` staff to
 *       their own leads).
 *   - Controls & boundaries:
 *       `OWNER` (with membership), `STAFF` on role defaults (`permissionScopes`
 *       null), `STAFF` with explicit `{ revenue: 'read', crm: 'read' }`, and
 *       `SUPER_ADMIN` (no membership) see expected revenue & leads; cross-tenant
 *       `OWNER` of `bizB` -> 403; `Business.ownerId` without a `Membership` row
 *       (D-104) -> 403; unauthenticated -> 401; direct service call
 *       `getOverview(businessId)` without `actor` remains backward-compatible.
 *
 * Fixture prefix: `v97p_` (registered in `test/helpers/fixture-prefixes.json`,
 * cleaned up with `sqlLikePrefix(P)`).
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v97p_';
const HEADER = 'x-v97p-user';

const ID = {
  ownerA: `${P}ownerA`,
  staffDefaults: `${P}staffDef`,
  staffRevNone: `${P}staffRevNone`,
  staffStoreOnly: `${P}staffStoreOnly`,
  adminRevCrmNone: `${P}adminNone`,
  staffArrayScopes: `${P}staffArray`,
  staffCrmNone: `${P}staffCrmNone`,
  staffExplicitRead: `${P}staffRead`,
  staffOwned: `${P}staffOwned`,
  ownerB: `${P}ownerB`,
  ownerNoMember: `${P}ownerNoMem`,
  superAdmin: `${P}superAdmin`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  bizNoMember: `${P}bizNoMem`,
  leadTeam: `${P}leadTeam`,
  leadPrivate: `${P}leadPriv`,
  leadOwned: `${P}leadOwned`,
  leadBizB: `${P}leadBizB`,
};

const SEEDED_EMAILS = {
  team: `${P}lead-team@test.local`,
  priv: `${P}lead-private@test.local`,
  owned: `${P}lead-owned@test.local`,
  bizB: `${P}lead-bizb@test.local`,
};

const SEEDED_PHONES = {
  team: '+18685550101',
  priv: '+18685550102',
  owned: '+18685550103',
};

let db: any;
let app: any;
let overviewService: any;

const has = (o: unknown, k: string) =>
  !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

async function cleanup() {
  for (const sql of [
    `DELETE FROM revenue_actions WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM presence_daily_stats WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM public_events WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM bookings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM services WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM marketplace_orders WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

function reqAs(userId: string | null, url: string) {
  const r = request(app.getHttpServer()).get(url);
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
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { REDIS_CLIENT } = await import('../src/core/redis/redis.constants');
  const { PresenceController } = await import('../src/modules/site/presence/presence.controller');
  const { PresenceOverviewService } = await import('../src/modules/site/presence/presence-overview.service');
  const { PresenceService } = await import('../src/modules/site/presence/presence.service');
  const { StorefrontIntelligenceService } = await import(
    '../src/modules/site/presence/storefront-intelligence.service'
  );
  const { RevenueActionService } = await import('../src/modules/commerce/revenue-action.service');
  const { StoreOrderService } = await import('../src/modules/site/store-order.service');
  const { PresenceStatsService } = await import('../src/modules/public-events/presence-stats.service');

  const moduleRef = await Test.createTestingModule({
    controllers: [PresenceController],
    providers: [
      PrismaService,
      AuthGuard,
      BusinessGuard,
      PresenceOverviewService,
      PresenceStatsService,
      {
        provide: PresenceService,
        useValue: {
          getSectionCompleteness: async () => ({
            score: 50,
            sections: [],
            seoComplete: false,
            brandingComplete: false,
          }),
        },
      },
      { provide: StorefrontIntelligenceService, useValue: {} },
      { provide: RevenueActionService, useValue: {} },
      { provide: StoreOrderService, useValue: {} },
      { provide: REDIS_CLIENT, useValue: {} },
      { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
    ],
  }).compile();

  overviewService = moduleRef.get(PresenceOverviewService);

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
    [ID.staffDefaults, 'USER'],
    [ID.staffRevNone, 'USER'],
    [ID.staffStoreOnly, 'USER'],
    [ID.adminRevCrmNone, 'USER'],
    [ID.staffArrayScopes, 'USER'],
    [ID.staffCrmNone, 'USER'],
    [ID.staffExplicitRead, 'USER'],
    [ID.staffOwned, 'USER'],
    [ID.ownerB, 'USER'],
    [ID.ownerNoMember, 'USER'],
    [ID.superAdmin, 'SUPER_ADMIN'],
  ] as const) {
    await db.user.create({
      data: { id, email: `${P}${id.slice(P.length)}@test.local`, name: id, role },
    });
  }

  // Seed businesses
  await db.business.create({
    data: { id: ID.bizA, name: 'V97P Biz A', slug: `${P}biz-a`, ownerId: ID.ownerA, storeEnabled: true },
  });
  await db.business.create({
    data: { id: ID.bizB, name: 'V97P Biz B', slug: `${P}biz-b`, ownerId: ID.ownerB, storeEnabled: true },
  });
  await db.business.create({
    data: { id: ID.bizNoMember, name: 'V97P Biz NoMem', slug: `${P}biz-nomem`, ownerId: ID.ownerNoMember },
  });

  // Seed memberships (note: ownerNoMember has NO membership row for bizNoMember; superAdmin has NO membership row)
  const memberships: Array<[string, string, string, unknown]> = [
    [ID.ownerA, ID.bizA, 'OWNER', undefined],
    [ID.staffDefaults, ID.bizA, 'STAFF', undefined],
    [ID.staffRevNone, ID.bizA, 'STAFF', { revenue: 'none', crm: 'read' }],
    [ID.staffStoreOnly, ID.bizA, 'STAFF', { storefront: 'read' }],
    [ID.adminRevCrmNone, ID.bizA, 'ADMIN', { storefront: 'admin', revenue: 'none', crm: 'none' }],
    [ID.staffArrayScopes, ID.bizA, 'STAFF', []],
    [ID.staffCrmNone, ID.bizA, 'STAFF', { crm: 'none', revenue: 'read' }],
    [ID.staffExplicitRead, ID.bizA, 'STAFF', { revenue: 'read', crm: 'read' }],
    [ID.staffOwned, ID.bizA, 'STAFF', { revenue: 'read', crm: 'read', crm_view: 'owned' }],
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

  // Seed 3 storefront leads in bizA (TEAM unowned, PRIVATE owned by ownerA, TEAM owned by staffOwned)
  // plus 1 storefront lead in bizB
  await db.contact.createMany({
    data: [
      {
        id: ID.leadTeam,
        businessId: ID.bizA,
        firstName: 'Team',
        lastName: 'Lead',
        email: SEEDED_EMAILS.team,
        phone: SEEDED_PHONES.team,
        whatsappNumber: SEEDED_PHONES.team,
        source: 'storefront',
        visibility: 'TEAM',
        ownerId: null,
      },
      {
        id: ID.leadPrivate,
        businessId: ID.bizA,
        firstName: 'Private',
        lastName: 'Lead',
        email: SEEDED_EMAILS.priv,
        phone: SEEDED_PHONES.priv,
        whatsappNumber: SEEDED_PHONES.priv,
        source: 'storefront',
        visibility: 'PRIVATE',
        ownerId: ID.ownerA,
      },
      {
        id: ID.leadOwned,
        businessId: ID.bizA,
        firstName: 'Owned',
        lastName: 'Lead',
        email: SEEDED_EMAILS.owned,
        phone: SEEDED_PHONES.owned,
        whatsappNumber: SEEDED_PHONES.owned,
        source: 'storefront',
        visibility: 'TEAM',
        ownerId: ID.staffOwned,
      },
      {
        id: ID.leadBizB,
        businessId: ID.bizB,
        firstName: 'Other',
        lastName: 'BizLead',
        email: SEEDED_EMAILS.bizB,
        phone: '+18685550199',
        whatsappNumber: '+18685550199',
        source: 'storefront',
        visibility: 'TEAM',
        ownerId: ID.ownerB,
      },
    ],
  });

  // Seed paid invoice (250) + paid marketplace order (175) in bizA => overview kpis.revenue = 425
  const paidAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await db.invoice.create({
    data: {
      id: `${P}invA1`,
      businessId: ID.bizA,
      contactId: ID.leadTeam,
      invoiceNumber: `${P}INV-A1`,
      status: 'PAID',
      total: 250,
      paidAt,
    },
  });
  await db.marketplaceOrder.create({
    data: {
      id: `${P}ordA1`,
      businessId: ID.bizA,
      orderNumber: `${P}ORD-A1`,
      customerName: 'V97P Buyer',
      status: 'COMPLETED',
      paymentStatus: 'PAID',
      total: 175,
      subtotal: 175,
    },
  });
  // Seed bizB paid invoice (9000)
  await db.invoice.create({
    data: {
      id: `${P}invB1`,
      businessId: ID.bizB,
      contactId: ID.leadBizB,
      invoiceNumber: `${P}INV-B1`,
      status: 'PAID',
      total: 9000,
      paidAt,
    },
  });

  // Seed today's public events: 1 page_view + 1 payment.completed (amount 50)
  // => today-stats events.revenue = 175 (today order) + 50 (payment event) = 225
  await db.publicEvent.createMany({
    data: [
      {
        id: `${P}ev1`,
        businessId: ID.bizA,
        visitorId: `${P}vis1`,
        type: 'page_view',
        payload: {},
      },
      {
        id: `${P}ev2`,
        businessId: ID.bizA,
        visitorId: `${P}vis1`,
        type: 'payment.completed',
        payload: { amount: 50 },
      },
    ],
  });

  // Seed a service and 2 today bookings in bizA (one TEAM contact, one OWNER PRIVATE contact)
  // for R1-SEC-02 today-stats PII/visibility checks.
  const now = new Date();
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000);
  await db.service.create({
    data: {
      id: `${P}svcA1`,
      businessId: ID.bizA,
      name: 'V97P Consultation',
      price: 100,
      duration: 60,
    },
  });
  await db.booking.createMany({
    data: [
      {
        id: `${P}bkTeam`,
        businessId: ID.bizA,
        contactId: ID.leadTeam,
        serviceId: `${P}svcA1`,
        startTime: now,
        endTime: inOneHour,
        status: 'CONFIRMED',
      },
      {
        id: `${P}bkPriv`,
        businessId: ID.bizA,
        contactId: ID.leadPrivate,
        serviceId: `${P}svcA1`,
        startTime: now,
        endTime: inOneHour,
        status: 'CONFIRMED',
      },
    ],
  });
}, 120_000);

afterAll(async () => {
  // Let any fire-and-forget syncCardsToQueue promises settle before hard-deleting fixtures.
  await new Promise((r) => setTimeout(r, 250));
  if (app) await app.close();
  if (db) await cleanup();
});

describe('FU-PRESENCE-REVENUE-SCOPE (P100, D-100 / D-104)', () => {
  describe('GET /site/presence/businesses/:businessId/overview — revenue scope', () => {
    it.each([
      ['STAFF with { revenue: "none" }', ID.staffRevNone],
      ['STAFF with explicit map omitting revenue ({ storefront: "read" })', ID.staffStoreOnly],
      ['ADMIN with explicit { revenue: "none" }', ID.adminRevCrmNone],
      ['STAFF with JSON array [] permissionScopes', ID.staffArrayScopes],
    ])(
      'RED-BEFORE: %s receives 200 with kpis.revenue omitted and non-money KPIs intact',
      async (_label, userId) => {
        const res = await reqAs(userId, `/site/presence/businesses/${ID.bizA}/overview?days=30`);
        expect(res.status).toBe(200);
        expect(res.body?.kpis).toBeDefined();
        expect(has(res.body.kpis, 'revenue')).toBe(false);
        expect(res.body.kpis.visits).toBeGreaterThanOrEqual(1);
        expect(res.body.kpis.leadsCaptured).toBe(3);
        expect(res.body.kpis.ordersCreated).toBe(1);
        expect(typeof res.body.kpis.bookingsCreated).toBe('number');
      },
    );

    it.each([
      ['OWNER with membership', ID.ownerA],
      ['STAFF with role defaults (permissionScopes: null)', ID.staffDefaults],
      ['STAFF with explicit { revenue: "read", crm: "read" }', ID.staffExplicitRead],
      ['SUPER_ADMIN with no membership', ID.superAdmin],
    ])('CONTROL: %s receives exact kpis.revenue (425)', async (_label, userId) => {
      const res = await reqAs(userId, `/site/presence/businesses/${ID.bizA}/overview?days=30`);
      expect(res.status).toBe(200);
      expect(res.body?.kpis?.revenue).toBe(425);
      expect(res.body?.kpis?.ordersCreated).toBe(1);
      expect(res.body?.kpis?.leadsCaptured).toBe(3);
    });

    it('CONTROL: direct overviewService.getOverview(businessId) without actor remains backward-compatible', async () => {
      const result = await overviewService.getOverview(ID.bizA);
      expect(result.kpis.revenue).toBe(425);
      expect(result.kpis.leadsCaptured).toBe(3);
    });
  });

  describe('GET /site/presence/businesses/:businessId/today-stats — revenue scope', () => {
    it.each([
      ['STAFF with { revenue: "none" }', ID.staffRevNone],
      ['STAFF with explicit map omitting revenue', ID.staffStoreOnly],
      ['ADMIN with explicit { revenue: "none" }', ID.adminRevCrmNone],
      ['STAFF with JSON array [] permissionScopes', ID.staffArrayScopes],
    ])(
      'RED-BEFORE: %s receives 200 with events.revenue and recentOrders[].total omitted',
      async (_label, userId) => {
        const res = await reqAs(userId, `/site/presence/businesses/${ID.bizA}/today-stats`);
        expect(res.status).toBe(200);
        expect(has(res.body?.events, 'revenue')).toBe(false);
        expect(res.body?.events?.views).toBeGreaterThanOrEqual(1);
        expect(Array.isArray(res.body?.recentOrders)).toBe(true);
        for (const o of res.body.recentOrders) {
          expect(has(o, 'total')).toBe(false);
        }
      },
    );

    it.each([
      ['OWNER with membership', ID.ownerA],
      ['STAFF with role defaults', ID.staffDefaults],
      ['STAFF with explicit revenue:read', ID.staffExplicitRead],
      ['SUPER_ADMIN with no membership', ID.superAdmin],
    ])('CONTROL: %s receives exact events.revenue (225) and order total (175)', async (_label, userId) => {
      const res = await reqAs(userId, `/site/presence/businesses/${ID.bizA}/today-stats`);
      expect(res.status).toBe(200);
      expect(res.body?.events?.revenue).toBe(225);
      expect(res.body?.recentOrders?.[0]?.total).toBe(175);
    });
  });

  describe('GET /site/presence/businesses/:businessId/leads — CRM scope & contact visibility', () => {
    it.each([
      ['STAFF with { crm: "none" }', ID.staffCrmNone],
      ['STAFF with explicit map omitting crm ({ storefront: "read" })', ID.staffStoreOnly],
      ['ADMIN with explicit { crm: "none" }', ID.adminRevCrmNone],
      ['STAFF with JSON array [] permissionScopes', ID.staffArrayScopes],
    ])(
      'RED-BEFORE: %s receives 200 { items: [] } with zero contact PII leaked',
      async (_label, userId) => {
        const res = await reqAs(userId, `/site/presence/businesses/${ID.bizA}/leads`);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ items: [] });
        const serialized = JSON.stringify(res.body);
        expect(serialized).not.toContain(SEEDED_EMAILS.team);
        expect(serialized).not.toContain(SEEDED_EMAILS.priv);
        expect(serialized).not.toContain(SEEDED_EMAILS.owned);
        expect(serialized).not.toContain(SEEDED_PHONES.team);
        expect(serialized).not.toContain(SEEDED_PHONES.priv);
        expect(serialized).not.toContain(SEEDED_PHONES.owned);
      },
    );

    it('RED-BEFORE: STAFF with crm:read sees TEAM leads with PII but NOT OWNER PRIVATE lead', async () => {
      const res = await reqAs(ID.staffExplicitRead, `/site/presence/businesses/${ID.bizA}/leads`);
      expect(res.status).toBe(200);
      const ids = (res.body?.items ?? []).map((c: any) => c.id);
      expect(ids).toContain(ID.leadTeam);
      expect(ids).toContain(ID.leadOwned);
      expect(ids).not.toContain(ID.leadPrivate);
      const teamLead = res.body.items.find((c: any) => c.id === ID.leadTeam);
      expect(teamLead.email).toBe(SEEDED_EMAILS.team);
      expect(teamLead.phone).toBe(SEEDED_PHONES.team);
      expect(teamLead.whatsappNumber).toBe(SEEDED_PHONES.team);
      expect(JSON.stringify(res.body)).not.toContain(SEEDED_EMAILS.priv);
    });

    it('RED-BEFORE: STAFF with role defaults (permissionScopes: null) sees TEAM leads but NOT OWNER PRIVATE lead', async () => {
      const res = await reqAs(ID.staffDefaults, `/site/presence/businesses/${ID.bizA}/leads`);
      expect(res.status).toBe(200);
      const ids = (res.body?.items ?? []).map((c: any) => c.id);
      expect(ids).toContain(ID.leadTeam);
      expect(ids).toContain(ID.leadOwned);
      expect(ids).not.toContain(ID.leadPrivate);
    });

    it('RED-BEFORE: STAFF with { crm: "read", crm_view: "owned" } sees ONLY their own storefront lead', async () => {
      const res = await reqAs(ID.staffOwned, `/site/presence/businesses/${ID.bizA}/leads`);
      expect(res.status).toBe(200);
      const ids = (res.body?.items ?? []).map((c: any) => c.id);
      expect(ids).toEqual([ID.leadOwned]);
      expect(res.body.items[0].email).toBe(SEEDED_EMAILS.owned);
      expect(res.body.items[0].phone).toBe(SEEDED_PHONES.owned);
      expect(res.body.items[0].whatsappNumber).toBe(SEEDED_PHONES.owned);
    });

    it.each([
      ['OWNER with membership', ID.ownerA],
      ['SUPER_ADMIN with no membership', ID.superAdmin],
    ])('CONTROL: %s sees all 3 bizA storefront leads including OWNER PRIVATE lead', async (_label, userId) => {
      const res = await reqAs(userId, `/site/presence/businesses/${ID.bizA}/leads`);
      expect(res.status).toBe(200);
      const ids = (res.body?.items ?? []).map((c: any) => c.id);
      expect(ids).toHaveLength(3);
      expect(ids).toEqual(expect.arrayContaining([ID.leadTeam, ID.leadPrivate, ID.leadOwned]));
      expect(ids).not.toContain(ID.leadBizB);
    });
  });

  describe('Tenant isolation, D-104 membership gate, and authentication', () => {
    it.each([
      ['overview', `/site/presence/businesses/${ID.bizA}/overview?days=30`],
      ['leads', `/site/presence/businesses/${ID.bizA}/leads`],
      ['today-stats', `/site/presence/businesses/${ID.bizA}/today-stats`],
    ])('CONTROL: cross-tenant OWNER of bizB calling bizA %s -> 403', async (_name, url) => {
      const res = await reqAs(ID.ownerB, url);
      expect(res.status).toBe(403);
    });

    it.each([
      ['overview', `/site/presence/businesses/${ID.bizNoMember}/overview?days=30`],
      ['leads', `/site/presence/businesses/${ID.bizNoMember}/leads`],
      ['today-stats', `/site/presence/businesses/${ID.bizNoMember}/today-stats`],
    ])('CONTROL (D-104): Business.ownerId with NO Membership row calling %s -> 403', async (_name, url) => {
      const res = await reqAs(ID.ownerNoMember, url);
      expect(res.status).toBe(403);
    });

    it.each([
      ['overview', `/site/presence/businesses/${ID.bizA}/overview?days=30`],
      ['leads', `/site/presence/businesses/${ID.bizA}/leads`],
      ['today-stats', `/site/presence/businesses/${ID.bizA}/today-stats`],
    ])('CONTROL: unauthenticated caller on %s -> 401', async (_name, url) => {
      const res = await reqAs(null, url);
      expect(res.status).toBe(401);
    });
  });

  describe('R1 security repair regressions (R1-SEC-01, R1-SEC-02)', () => {
    it('[R1-SEC-01] direct getOverviewForReader(bizA, undefined), listStorefrontLeads(bizA, {}, undefined), and getTodayStats(bizA, undefined) all fail closed', async () => {
      const overview = await overviewService.getOverviewForReader(ID.bizA, undefined);
      expect(has(overview?.kpis, 'revenue')).toBe(false);
      expect(overview?.kpis?.ordersCreated).toBe(1);

      const leads = await overviewService.listStorefrontLeads(ID.bizA, {}, undefined);
      expect(leads).toEqual({ items: [] });

      const stats = await overviewService.getTodayStats(ID.bizA, undefined);
      expect(has(stats?.events, 'revenue')).toBe(false);
      expect(Array.isArray(stats?.recentOrders)).toBe(true);
      expect(stats.recentOrders.length).toBeGreaterThanOrEqual(1);
      for (const o of stats.recentOrders) {
        expect(has(o, 'total')).toBe(false);
        expect(has(o, 'customerName')).toBe(false);
      }
      expect(Array.isArray(stats?.recentBookings)).toBe(true);
      expect(stats.recentBookings.length).toBeGreaterThanOrEqual(2);
      for (const b of stats.recentBookings) {
        expect(has(b, 'contactName')).toBe(false);
      }
    });

    it.each([
      ['STAFF with { crm: "none" }', ID.staffCrmNone],
      ['STAFF with explicit map omitting crm ({ storefront: "read" })', ID.staffStoreOnly],
      ['ADMIN with explicit { crm: "none" }', ID.adminRevCrmNone],
      ['STAFF with JSON array [] permissionScopes', ID.staffArrayScopes],
    ])(
      '[R1-SEC-02] GET today-stats withholds recentOrders[].customerName and recentBookings[].contactName for %s',
      async (_label, userId) => {
        const res = await reqAs(userId, `/site/presence/businesses/${ID.bizA}/today-stats`);
        expect(res.status).toBe(200);
        expect(res.body.recentOrders.length).toBeGreaterThanOrEqual(1);
        for (const o of res.body.recentOrders) {
          expect(has(o, 'customerName')).toBe(false);
        }
        expect(res.body.recentBookings.length).toBeGreaterThanOrEqual(2);
        for (const b of res.body.recentBookings) {
          expect(has(b, 'contactName')).toBe(false);
        }
        const serialized = JSON.stringify(res.body);
        expect(serialized).not.toContain('V97P Buyer');
        expect(serialized).not.toContain('Team Lead');
        expect(serialized).not.toContain('Private Lead');
      },
    );

    it.each([
      ['STAFF with explicit { revenue: "read", crm: "read" }', ID.staffExplicitRead],
      ['STAFF with role defaults (permissionScopes: null)', ID.staffDefaults],
    ])(
      '[R1-SEC-02] GET today-stats hides OWNER PRIVATE booking contactName while showing TEAM booking contactName for %s',
      async (_label, userId) => {
        const res = await reqAs(userId, `/site/presence/businesses/${ID.bizA}/today-stats`);
        expect(res.status).toBe(200);
        expect(res.body.recentOrders[0]?.customerName).toBe('V97P Buyer');
        const teamBk = res.body.recentBookings.find((b: any) => b.id === `${P}bkTeam`);
        const privBk = res.body.recentBookings.find((b: any) => b.id === `${P}bkPriv`);
        expect(teamBk?.contactName).toBe('Team Lead');
        expect(privBk).toBeDefined();
        expect(has(privBk, 'contactName')).toBe(false);
        expect(JSON.stringify(res.body)).not.toContain('Private Lead');
      },
    );

    it('[R1-SEC-02] GET today-stats hides non-owned booking contactNames for STAFF with { crm: "read", crm_view: "owned" }', async () => {
      const res = await reqAs(ID.staffOwned, `/site/presence/businesses/${ID.bizA}/today-stats`);
      expect(res.status).toBe(200);
      const teamBk = res.body.recentBookings.find((b: any) => b.id === `${P}bkTeam`);
      const privBk = res.body.recentBookings.find((b: any) => b.id === `${P}bkPriv`);
      expect(has(teamBk, 'contactName')).toBe(false);
      expect(has(privBk, 'contactName')).toBe(false);
      expect(JSON.stringify(res.body)).not.toContain('Team Lead');
      expect(JSON.stringify(res.body)).not.toContain('Private Lead');
    });

    it.each([
      ['OWNER with membership', ID.ownerA],
      ['SUPER_ADMIN with no membership', ID.superAdmin],
    ])(
      '[R1-SEC-02] CONTROL: %s sees customerName and both TEAM and OWNER PRIVATE booking contactNames on today-stats',
      async (_label, userId) => {
        const res = await reqAs(userId, `/site/presence/businesses/${ID.bizA}/today-stats`);
        expect(res.status).toBe(200);
        expect(res.body.recentOrders[0]?.customerName).toBe('V97P Buyer');
        const teamBk = res.body.recentBookings.find((b: any) => b.id === `${P}bkTeam`);
        const privBk = res.body.recentBookings.find((b: any) => b.id === `${P}bkPriv`);
        expect(teamBk?.contactName).toBe('Team Lead');
        expect(privBk?.contactName).toBe('Private Lead');
      },
    );
  });
});
