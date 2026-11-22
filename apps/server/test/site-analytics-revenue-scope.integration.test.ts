/**
 * FU-SITE-ANALYTICS-REVENUE-SCOPE — GET /site/businesses/:businessId/analytics
 * withholds paid revenue and the invoice-derived counts from a member without
 * revenue read (REAL database). Owner rulings D-100 and D-234.
 *
 * Found by the NAV-A1 security review (2026-11-22): the route sits behind
 * AuthGuard and BusinessGuard only, and answered every member of the business
 * `revenue.inPeriod` (the sum of the business's PAID invoices in the period)
 * and `invoices.total` / `invoices.inPeriod` (invoice counts: sales volume,
 * D-234). The Your page hub's Overview tab rendered "Revenue (30d)" from it.
 *
 * Pinned here:
 *   - a member whose revenue level is none (explicit scope map without
 *     revenue, or with revenue: 'none'; a stored JSON array) receives neither
 *     `revenue` nor `invoices`: the keys are absent, not zero; the rest of the
 *     analytics (period, bookings, catalog, storefrontEvents) is unchanged;
 *   - the OWNER, a STAFF member on role defaults (revenue read), a member with
 *     an explicit revenue: 'read', and a platform SUPER_ADMIN receive the
 *     response as before, figures included;
 *   - the level is read in the business BusinessGuard admitted: a member who
 *     reads revenue in another business does not carry it here, and a member
 *     of another business is refused (403) and learns nothing.
 *
 * WHAT IS REAL: PrismaService, AuthGuard, BusinessGuard, SiteController and
 * SiteService against DATABASE_URL, in two pipelines (TenantInterceptor and
 * the tenant extension installed, as main.ts does; and the handler alone).
 * Stand-ins: identity attachment (a test middleware reads `x-v86s-user` and
 * attaches the seeded user row, as AuthMiddleware does after token
 * verification) and the controller's collaborators for its other routes (empty
 * objects; this route reaches none of them), plus AiUsageService (empty; the
 * analytics read does not use it).
 *
 * Every seeded row carries the `v86s_` prefix and is hard-deleted by raw SQL
 * with sqlLikePrefix() in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v86s_';
const HEADER = 'x-v86s-user';

const ID = {
  ownerA: `${P}ownerA`, // OWNER of bizA
  staffDefaults: `${P}staffDef`, // STAFF of bizA, no scope map: role defaults (revenue read)
  storefrontOnly: `${P}storeOnly`, // STAFF of bizA, explicit { storefront: 'read' } (revenue missing: none)
  revenueNone: `${P}revNone`, // ADMIN of bizA, explicit { storefront: 'admin', revenue: 'none' }
  arrayScopes: `${P}array`, // STAFF of bizA, permissionScopes stored as a JSON array (every module none)
  revenueReader: `${P}revRead`, // STAFF of bizA, explicit { storefront: 'read', revenue: 'read' }
  dual: `${P}dual`, // { storefront: 'read' } in bizA, OWNER of bizB
  ownerB: `${P}ownerB`, // OWNER of bizB
  superAdmin: `${P}super`, // role SUPER_ADMIN, no membership
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  contactA: `${P}contactA`,
  contactB: `${P}contactB`,
};

/** The collaborators SiteController holds for its other routes; GET analytics reaches none of them. */
const OFF_BOUNDARY = new Set([
  'StoreOrderService', 'PromoCodeService', 'IntakeService', 'QualificationService', 'CustomerReferralService',
  'CaseStudyService', 'PaymentsService', 'StorefrontConversionService', 'AiUsageService',
  // PublicRateLimitGuard's Redis client (the guard sits on the public routes only, not on this one).
  'Symbol(REDIS_CLIENT)',
]);

type Pipeline = 'production' | 'bare';
const PIPELINES: Pipeline[] = ['production', 'bare'];

let db: any;
const apps: Partial<Record<Pipeline, any>> = {};

async function cleanup() {
  for (const sql of [
    `DELETE FROM invoices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM bookings WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM contacts WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM memberships WHERE business_id LIKE ${sqlLikePrefix(P)} OR user_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM businesses WHERE id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM users WHERE id LIKE ${sqlLikePrefix(P)}`,
  ]) {
    try { await db.$executeRawUnsafe(sql); } catch { /* best-effort */ }
  }
}

function get(pipeline: Pipeline, user: string, businessId: string) {
  return request(apps[pipeline]!.getHttpServer())
    .get(`/site/businesses/${businessId}/analytics`)
    .set(HEADER, user)
    .query({ days: '30' });
}

const describeBody = (res: { status: number; body: unknown }) => `${res.status} ${JSON.stringify(res.body)}`;

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
  const { SiteController } = await import('../src/modules/site/site.controller');
  const { SiteService } = await import('../src/modules/site/site.service');

  const build = async (pipeline: Pipeline) => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SiteController],
      providers: [
        PrismaService,
        AuthGuard,
        BusinessGuard,
        SiteService,
        ...(pipeline === 'production' ? [{ provide: APP_INTERCEPTOR, useClass: TenantInterceptor }] : []),
      ],
    })
      .useMocker((token: any) => {
        const name = typeof token === 'function' ? token.name : String(token);
        return OFF_BOUNDARY.has(name) ? {} : undefined;
      })
      .compile();

    const nest = moduleRef.createNestApplication();
    nest.use(async (req: any, _res: any, next: any) => {
      const header = req.headers[HEADER];
      const id = typeof header === 'string' ? header : undefined;
      if (id && id.startsWith(P)) {
        const user = await db.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
        if (user) req.user = { id: user.id, email: user.email, role: user.role };
      }
      next();
    });
    nest.useGlobalFilters(new GlobalHttpExceptionFilter());
    nest.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await nest.init();
    return nest;
  };
  apps.production = await build('production');
  apps.bare = await build('bare');

  await cleanup();

  for (const [id, role] of [
    [ID.ownerA, 'USER'], [ID.staffDefaults, 'USER'], [ID.storefrontOnly, 'USER'], [ID.revenueNone, 'USER'],
    [ID.arrayScopes, 'USER'], [ID.revenueReader, 'USER'], [ID.dual, 'USER'], [ID.ownerB, 'USER'],
    [ID.superAdmin, 'SUPER_ADMIN'],
  ] as const) {
    await db.user.create({ data: { id, email: `${P}${id.slice(P.length)}@test.local`, role } });
  }
  await db.business.create({ data: { id: ID.bizA, name: 'V86S Biz A', ownerId: ID.ownerA } });
  await db.business.create({ data: { id: ID.bizB, name: 'V86S Biz B', ownerId: ID.ownerB } });
  const memberships: Array<[string, string, string, unknown]> = [
    [ID.ownerA, ID.bizA, 'OWNER', undefined],
    [ID.staffDefaults, ID.bizA, 'STAFF', undefined],
    [ID.storefrontOnly, ID.bizA, 'STAFF', { storefront: 'read' }],
    [ID.revenueNone, ID.bizA, 'ADMIN', { storefront: 'admin', revenue: 'none' }],
    [ID.arrayScopes, ID.bizA, 'STAFF', []],
    [ID.revenueReader, ID.bizA, 'STAFF', { storefront: 'read', revenue: 'read' }],
    [ID.dual, ID.bizA, 'STAFF', { storefront: 'read' }],
    [ID.dual, ID.bizB, 'OWNER', undefined],
    [ID.ownerB, ID.bizB, 'OWNER', undefined],
  ];
  let n = 0;
  for (const [userId, businessId, role, permissionScopes] of memberships) {
    await db.membership.create({
      data: { id: `${P}m${n++}`, userId, businessId, role, ...(permissionScopes !== undefined ? { permissionScopes } : {}) },
    });
  }
  await db.contact.create({ data: { id: ID.contactA, businessId: ID.bizA, firstName: 'V86S', lastName: 'Alpha' } });
  await db.contact.create({ data: { id: ID.contactB, businessId: ID.bizB, firstName: 'V86S', lastName: 'Bravo' } });
  const paidAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  // bizA: two PAID invoices in the period (150 + 250 = 400) and one SENT.
  await db.invoice.create({ data: { id: `${P}invA1`, businessId: ID.bizA, contactId: ID.contactA, invoiceNumber: `${P}A-1`, status: 'PAID', total: 150, paidAt } });
  await db.invoice.create({ data: { id: `${P}invA2`, businessId: ID.bizA, contactId: ID.contactA, invoiceNumber: `${P}A-2`, status: 'PAID', total: 250, paidAt } });
  await db.invoice.create({ data: { id: `${P}invA3`, businessId: ID.bizA, contactId: ID.contactA, invoiceNumber: `${P}A-3`, status: 'SENT', total: 999 } });
  // bizB: one PAID invoice of 7000.
  await db.invoice.create({ data: { id: `${P}invB1`, businessId: ID.bizB, contactId: ID.contactB, invoiceNumber: `${P}B-1`, status: 'PAID', total: 7000, paidAt } });
}, 120_000);

afterAll(async () => {
  for (const app of Object.values(apps)) await app?.close();
  if (db) await cleanup();
});

/** The analytics fields every member who passes BusinessGuard keeps. */
function expectStorefrontAnalytics(body: any) {
  expect(body.period?.days).toBe(30);
  expect(typeof body.period?.since).toBe('string');
  expect(body.bookings).toEqual({ total: 0, inPeriod: 0, last7Days: 0 });
  expect(body.catalog).toEqual({ products: 0, services: 0 });
  expect(body.storefrontEvents).toEqual({});
}

describe.each(PIPELINES)('GET site/businesses/:b/analytics, %s pipeline', (pipeline) => {
  describe('a member without revenue read: revenue and invoice counts withheld (absent, not zero), the rest kept', () => {
    it.each([
      ['explicit { storefront: read } (revenue missing)', ID.storefrontOnly],
      ['explicit { revenue: none }', ID.revenueNone],
      ['permissionScopes stored as a JSON array', ID.arrayScopes],
      ['revenue read in another business only (dual)', ID.dual],
    ])('%s', async (_label, user) => {
      const res = await get(pipeline, user, ID.bizA);
      expect(res.status, describeBody(res)).toBe(200);
      expect(Object.prototype.hasOwnProperty.call(res.body, 'revenue'), describeBody(res)).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(res.body, 'invoices'), describeBody(res)).toBe(false);
      expectStorefrontAnalytics(res.body);
    });
  });

  describe('owner and revenue readers: unchanged, figures included', () => {
    it.each([
      ['OWNER', ID.ownerA],
      ['STAFF on role defaults (revenue read)', ID.staffDefaults],
      ['explicit { revenue: read }', ID.revenueReader],
      ['platform SUPER_ADMIN', ID.superAdmin],
    ])('%s', async (_label, user) => {
      const res = await get(pipeline, user, ID.bizA);
      expect(res.status, describeBody(res)).toBe(200);
      expect(res.body.revenue, describeBody(res)).toEqual({ inPeriod: 400 });
      expect(res.body.invoices, describeBody(res)).toEqual({ total: 3, inPeriod: 3 });
      expectStorefrontAnalytics(res.body);
    });
  });

  describe('cross-tenant', () => {
    it("the dual member reads bizB's own figures as its OWNER, never bizA's", async () => {
      const res = await get(pipeline, ID.dual, ID.bizB);
      expect(res.status, describeBody(res)).toBe(200);
      expect(res.body.revenue).toEqual({ inPeriod: 7000 });
      expect(res.body.invoices).toEqual({ total: 1, inPeriod: 1 });
    });

    it("a member of another business is refused and learns nothing of bizA", async () => {
      const res = await get(pipeline, ID.ownerB, ID.bizA);
      expect(res.status, describeBody(res)).toBe(403);
      expect(res.body.revenue).toBeUndefined();
    });
  });
});
