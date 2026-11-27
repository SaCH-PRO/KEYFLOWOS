/**
 * V1-66 (TOF-TIER-PRICING-ROUTES): real-DB PostgreSQL HTTP proof for the tiered
 * pricing routes on CommerceController:
 *   - GET  /commerce/businesses/:businessId/products/:productId/tier-prices    (revenue:read)
 *   - PUT  /commerce/businesses/:businessId/products/:productId/tier-prices    (revenue:write + TeamAuditInterceptor)
 *   - GET  /commerce/businesses/:businessId/products/:productId/price?contactId= (revenue:read, D-133 contact visibility)
 *   - PUT  /commerce/businesses/:businessId/contacts/:contactId/pricing-tier   (revenue:write + TeamAuditInterceptor, D-133)
 *
 * REAL PostgreSQL database, REAL NestJS HTTP pipeline behind REAL AuthGuard,
 * BusinessGuard, ModuleScopeGuard, TeamAuditInterceptor, TenantInterceptor,
 * GlobalHttpExceptionFilter and ValidationPipe.
 *
 * Fixture prefix: `v66a_` (registered in apps/server/test/helpers/fixture-prefixes.json).
 * Hard-deleted by raw SQL via sqlLikePrefix(P) in beforeAll and afterAll.
 */
import 'reflect-metadata';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v66a_';
const HEADER = 'x-v66a-user';

const ID = {
  ownerA: `${P}owner_a`,
  revReadA: `${P}rev_read_a`,
  revWriteOwnedCrmA: `${P}rev_write_own_a`,
  noRevA: `${P}no_rev_a`,
  ownerB: `${P}owner_b`,
  bizA: `${P}biz_a`,
  bizB: `${P}biz_b`,
  prodA: `${P}prod_a`,
  prodADeleted: `${P}prod_a_del`,
  prodB: `${P}prod_b`,
  contactWholesaleA: `${P}ct_whol_a`,
  contactRetailA: `${P}ct_ret_a`,
  contactNullA: `${P}ct_null_a`,
  contactPrivateOwnerA: `${P}ct_priv_a`,
  contactOwnedByStaffA: `${P}ct_staff_a`,
  contactDeletedA: `${P}ct_del_a`,
  contactB: `${P}ct_b`,
};

let db: typeof import('@keyflow/db').db;
let app: import('@nestjs/common').INestApplication;
let pricingService: import('../src/modules/commerce/pricing.service').PricingService;

async function cleanup() {
  for (const sql of [
    `DELETE FROM team_audit_logs WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM product_tier_prices WHERE business_id LIKE ${sqlLikePrefix(P)}`,
    `DELETE FROM products WHERE business_id LIKE ${sqlLikePrefix(P)}`,
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

beforeAll(async () => {
  const dbMod = await import('@keyflow/db');
  db = dbMod.db;

  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { EventEmitter2 } = await import('@nestjs/event-emitter');
  const { GlobalHttpExceptionFilter } = await import('../src/core/filters/http-exception.filter');
  const { PrismaService } = await import('../src/core/prisma/prisma.service');
  const { AuthGuard } = await import('../src/core/auth/auth.guard');
  const { BusinessGuard } = await import('../src/core/auth/business.guard');
  const { ModuleScopeGuard } = await import('../src/core/auth/module-scope.guard');
  const { TeamAuditInterceptor } = await import('../src/core/interceptors/team-audit.interceptor');
  const { TenantInterceptor } = await import('../src/core/tenant/tenant.interceptor');
  const { CommerceController } = await import('../src/modules/commerce/commerce.controller');
  const { CommerceService } = await import('../src/modules/commerce/commerce.service');
  const { PricingService } = await import('../src/modules/commerce/pricing.service');
  const { TimeEntryService } = await import('../src/modules/time-tracking/time-entry.service');
  const { InvoiceReceiptBuilderService } = await import('../src/modules/commerce/invoice-receipt-builder.service');
  const { GmailService } = await import('../src/modules/commerce/gmail.service');
  const { CommerceVisionService } = await import('../src/modules/commerce/commerce-vision.service');
  const { SubscriptionsService } = await import('../src/modules/subscriptions/subscriptions.service');
  const { StoreReadinessService } = await import('../src/modules/commerce/store-readiness.service');
  const { PaymentEvidenceService } = await import('../src/modules/commerce/payment-evidence.service');
  const { FinanceSettingsService } = await import('../src/modules/finance/finance-settings.service');
  const { PlanLimitGuard } = await import('../src/modules/subscriptions/plan-limit.guard');
  const { PublicRateLimitGuard } = await import('../src/core/guards/public-rate-limit.guard');

  const prismaStub = { client: db };
  const noop = {};

  const moduleRef = await Test.createTestingModule({
    controllers: [CommerceController],
    providers: [
      { provide: PrismaService, useValue: prismaStub },
      { provide: EventEmitter2, useValue: new EventEmitter2() },
      PricingService,
      { provide: CommerceService, useValue: noop },
      { provide: TimeEntryService, useValue: noop },
      { provide: InvoiceReceiptBuilderService, useValue: noop },
      { provide: GmailService, useValue: noop },
      { provide: CommerceVisionService, useValue: noop },
      { provide: SubscriptionsService, useValue: noop },
      { provide: StoreReadinessService, useValue: noop },
      { provide: PaymentEvidenceService, useValue: noop },
      { provide: FinanceSettingsService, useValue: noop },
      AuthGuard,
      BusinessGuard,
      ModuleScopeGuard,
      TeamAuditInterceptor,
      TenantInterceptor,
      { provide: PlanLimitGuard, useValue: { canActivate: () => true } },
      { provide: PublicRateLimitGuard, useValue: { canActivate: () => true } },
    ],
  }).compile();

  app = moduleRef.createNestApplication();
  app.use((req: any, _res: any, next: () => void) => {
    const uid = req.headers[HEADER];
    if (typeof uid === 'string' && uid.trim().length > 0) {
      req.user = { id: uid.trim(), role: 'USER', email: `${uid.trim()}@v66a.test.local` };
    }
    next();
  });
  app.useGlobalInterceptors(moduleRef.get(TenantInterceptor));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new GlobalHttpExceptionFilter());
  await app.init();

  pricingService = moduleRef.get(PricingService);

  await cleanup();

  await db.user.createMany({
    data: [
      { id: ID.ownerA, email: `${ID.ownerA}@v66a.test.local`, name: 'Owner A' },
      { id: ID.revReadA, email: `${ID.revReadA}@v66a.test.local`, name: 'RevRead A' },
      { id: ID.revWriteOwnedCrmA, email: `${ID.revWriteOwnedCrmA}@v66a.test.local`, name: 'RevWriteOwned A' },
      { id: ID.noRevA, email: `${ID.noRevA}@v66a.test.local`, name: 'NoRev A' },
      { id: ID.ownerB, email: `${ID.ownerB}@v66a.test.local`, name: 'Owner B' },
    ],
  });

  await db.business.createMany({
    data: [
      { id: ID.bizA, name: 'Biz A Tier', slug: `${P}biz-a`, ownerId: ID.ownerA, currency: 'TTD' },
      { id: ID.bizB, name: 'Biz B Tier', slug: `${P}biz-b`, ownerId: ID.ownerB, currency: 'TTD' },
    ],
  });

  await db.membership.createMany({
    data: [
      { userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' },
      {
        userId: ID.revReadA,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { revenue: 'read', crm: 'read' },
      },
      {
        userId: ID.revWriteOwnedCrmA,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { revenue: 'write', crm: 'read', crm_view: 'owned' },
      },
      {
        userId: ID.noRevA,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { revenue: 'none', bookings: 'write' },
      },
      { userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' },
    ],
  });

  await db.product.createMany({
    data: [
      { id: ID.prodA, businessId: ID.bizA, name: 'Cocoa Butter', price: 100, currency: 'TTD' },
      {
        id: ID.prodADeleted,
        businessId: ID.bizA,
        name: 'Retired Item',
        price: 100,
        currency: 'TTD',
        deletedAt: new Date(),
      },
      { id: ID.prodB, businessId: ID.bizB, name: 'Foreign Item', price: 200, currency: 'TTD' },
    ],
  });

  await db.productTierPrice.create({
    data: {
      businessId: ID.bizB,
      productId: ID.prodB,
      tier: 'WHOLESALE',
      price: 150,
    },
  });

  await db.contact.createMany({
    data: [
      {
        id: ID.contactWholesaleA,
        businessId: ID.bizA,
        firstName: 'Wendy',
        lastName: 'Wholesale',
        pricingTier: 'WHOLESALE',
        visibility: 'SHARED',
        ownerId: ID.ownerA,
      },
      {
        id: ID.contactRetailA,
        businessId: ID.bizA,
        firstName: 'Ricky',
        lastName: 'Retail',
        pricingTier: 'RETAIL',
        visibility: 'SHARED',
        ownerId: ID.ownerA,
      },
      {
        id: ID.contactNullA,
        businessId: ID.bizA,
        firstName: 'Nadia',
        lastName: 'Default',
        pricingTier: null,
        visibility: 'SHARED',
        ownerId: ID.ownerA,
      },
      {
        id: ID.contactPrivateOwnerA,
        businessId: ID.bizA,
        firstName: 'Private',
        lastName: 'Owner',
        pricingTier: 'WHOLESALE',
        visibility: 'PRIVATE',
        ownerId: ID.ownerA,
      },
      {
        id: ID.contactOwnedByStaffA,
        businessId: ID.bizA,
        firstName: 'Staff',
        lastName: 'Book',
        pricingTier: 'RETAIL',
        visibility: 'SHARED',
        ownerId: ID.revWriteOwnedCrmA,
      },
      {
        id: ID.contactDeletedA,
        businessId: ID.bizA,
        firstName: 'Deleted',
        lastName: 'Contact',
        pricingTier: 'WHOLESALE',
        visibility: 'SHARED',
        ownerId: ID.ownerA,
        deletedAt: new Date(),
      },
      {
        id: ID.contactB,
        businessId: ID.bizB,
        firstName: 'Foreign',
        lastName: 'Buyer',
        pricingTier: 'WHOLESALE',
        visibility: 'SHARED',
        ownerId: ID.ownerB,
      },
    ],
  });
}, 60_000);

afterAll(async () => {
  await cleanup();
  await app?.close();
});

describe('V1-66 (TOF-TIER-PRICING-ROUTES): tiered pricing HTTP routes on Postgres', () => {
  it('[TP-01] RED-BEFORE: PUT WHOLESALE 80 then GET tier-prices and GET price?contactId= resolves 80 for WHOLESALE, 100 for RETAIL/null/omitted, and records audit', async () => {
    const putRes = await request(app.getHttpServer())
      .put(`/commerce/businesses/${ID.bizA}/products/${ID.prodA}/tier-prices`)
      .set(HEADER, ID.ownerA)
      .send({
        tierPrices: [
          { tier: 'WHOLESALE', price: 80 },
          { tier: 'VIP', price: 0 },
        ],
      });

    expect(putRes.status).toBe(200);
    expect(putRes.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ businessId: ID.bizA, productId: ID.prodA, tier: 'WHOLESALE', price: 80 }),
        expect.objectContaining({ businessId: ID.bizA, productId: ID.prodA, tier: 'VIP', price: 0 }),
      ]),
    );

    const listRes = await request(app.getHttpServer())
      .get(`/commerce/businesses/${ID.bizA}/products/${ID.prodA}/tier-prices`)
      .set(HEADER, ID.revReadA);
    expect(listRes.status).toBe(200);
    expect(listRes.body).toHaveLength(2);

    const wholesalePrice = await request(app.getHttpServer())
      .get(`/commerce/businesses/${ID.bizA}/products/${ID.prodA}/price`)
      .query({ contactId: ID.contactWholesaleA })
      .set(HEADER, ID.revReadA);
    expect(wholesalePrice.status).toBe(200);
    expect(wholesalePrice.body).toMatchObject({
      productId: ID.prodA,
      basePrice: 100,
      effectivePrice: 80,
      price: 80,
      currency: 'TTD',
      contactId: ID.contactWholesaleA,
      contactTier: 'WHOLESALE',
      appliedTier: 'WHOLESALE',
      source: 'TIER',
    });

    const retailPrice = await request(app.getHttpServer())
      .get(`/commerce/businesses/${ID.bizA}/products/${ID.prodA}/price`)
      .query({ contactId: ID.contactRetailA })
      .set(HEADER, ID.revReadA);
    expect(retailPrice.status).toBe(200);
    expect(retailPrice.body).toMatchObject({
      productId: ID.prodA,
      basePrice: 100,
      effectivePrice: 100,
      price: 100,
      contactTier: 'RETAIL',
      appliedTier: null,
      source: 'BASE',
    });

    const noContactPrice = await request(app.getHttpServer())
      .get(`/commerce/businesses/${ID.bizA}/products/${ID.prodA}/price`)
      .set(HEADER, ID.revReadA);
    expect(noContactPrice.status).toBe(200);
    expect(noContactPrice.body).toMatchObject({
      effectivePrice: 100,
      price: 100,
      contactId: null,
      source: 'BASE',
    });

    // TeamAuditInterceptor records product tier price update (fire-and-forget async write, poll briefly)
    let auditCount = 0;
    for (let i = 0; i < 15; i++) {
      auditCount = await db.teamAuditLog.count({
        where: { businessId: ID.bizA, userId: ID.ownerA, module: 'revenue', action: 'product_tier_prices_updated' },
      });
      if (auditCount > 0) break;
      await new Promise((r) => setTimeout(r, 30));
    }
    expect(auditCount).toBeGreaterThanOrEqual(1);
  });

  it('[TP-02] RED-BEFORE: PUT contacts/:id/pricing-tier updates tier (including 0-price VIP and clearing to null) and affects GET price', async () => {
    const setVip = await request(app.getHttpServer())
      .put(`/commerce/businesses/${ID.bizA}/contacts/${ID.contactNullA}/pricing-tier`)
      .set(HEADER, ID.ownerA)
      .send({ pricingTier: 'vip' });
    expect(setVip.status).toBe(200);
    expect(setVip.body).toEqual({ id: ID.contactNullA, pricingTier: 'VIP' });

    const vipPrice = await request(app.getHttpServer())
      .get(`/commerce/businesses/${ID.bizA}/products/${ID.prodA}/price`)
      .query({ contactId: ID.contactNullA })
      .set(HEADER, ID.ownerA);
    expect(vipPrice.status).toBe(200);
    expect(vipPrice.body).toMatchObject({ effectivePrice: 0, price: 0, appliedTier: 'VIP', source: 'TIER' });

    const clearTier = await request(app.getHttpServer())
      .put(`/commerce/businesses/${ID.bizA}/contacts/${ID.contactNullA}/pricing-tier`)
      .set(HEADER, ID.ownerA)
      .send({ pricingTier: null });
    expect(clearTier.status).toBe(200);
    expect(clearTier.body).toEqual({ id: ID.contactNullA, pricingTier: null });

    const resetPrice = await request(app.getHttpServer())
      .get(`/commerce/businesses/${ID.bizA}/products/${ID.prodA}/price`)
      .query({ contactId: ID.contactNullA })
      .set(HEADER, ID.ownerA);
    expect(resetPrice.status).toBe(200);
    expect(resetPrice.body).toMatchObject({ effectivePrice: 100, price: 100, appliedTier: null, source: 'BASE' });
  });

  it('[TP-03] RED-BEFORE: AuthGuard and ModuleScopeGuard enforce 401 unauth, 403 for revenue:none, and 403 on PUT for revenue:read', async () => {
    // Unauthenticated -> 401 on all 4 routes
    for (const req of [
      request(app.getHttpServer()).get(`/commerce/businesses/${ID.bizA}/products/${ID.prodA}/tier-prices`),
      request(app.getHttpServer())
        .put(`/commerce/businesses/${ID.bizA}/products/${ID.prodA}/tier-prices`)
        .send({ tierPrices: [{ tier: 'WHOLESALE', price: 50 }] }),
      request(app.getHttpServer()).get(`/commerce/businesses/${ID.bizA}/products/${ID.prodA}/price`),
      request(app.getHttpServer())
        .put(`/commerce/businesses/${ID.bizA}/contacts/${ID.contactRetailA}/pricing-tier`)
        .send({ pricingTier: 'WHOLESALE' }),
    ]) {
      expect((await req).status).toBe(401);
    }

    // revenue:none -> 403 on all 4 routes
    for (const req of [
      request(app.getHttpServer())
        .get(`/commerce/businesses/${ID.bizA}/products/${ID.prodA}/tier-prices`)
        .set(HEADER, ID.noRevA),
      request(app.getHttpServer())
        .put(`/commerce/businesses/${ID.bizA}/products/${ID.prodA}/tier-prices`)
        .set(HEADER, ID.noRevA)
        .send({ tierPrices: [{ tier: 'WHOLESALE', price: 50 }] }),
      request(app.getHttpServer())
        .get(`/commerce/businesses/${ID.bizA}/products/${ID.prodA}/price`)
        .set(HEADER, ID.noRevA),
      request(app.getHttpServer())
        .put(`/commerce/businesses/${ID.bizA}/contacts/${ID.contactRetailA}/pricing-tier`)
        .set(HEADER, ID.noRevA)
        .send({ pricingTier: 'WHOLESALE' }),
    ]) {
      expect((await req).status).toBe(403);
    }

    // revenue:read -> 403 on both PUT routes, leaving stored rows unchanged
    const putProdRes = await request(app.getHttpServer())
      .put(`/commerce/businesses/${ID.bizA}/products/${ID.prodA}/tier-prices`)
      .set(HEADER, ID.revReadA)
      .send({ tierPrices: [{ tier: 'WHOLESALE', price: 1 }] });
    expect(putProdRes.status).toBe(403);

    const putContactRes = await request(app.getHttpServer())
      .put(`/commerce/businesses/${ID.bizA}/contacts/${ID.contactRetailA}/pricing-tier`)
      .set(HEADER, ID.revReadA)
      .send({ pricingTier: 'WHOLESALE' });
    expect(putContactRes.status).toBe(403);

    const unchangedTier = await db.productTierPrice.findFirst({
      where: { businessId: ID.bizA, productId: ID.prodA, tier: 'WHOLESALE' },
    });
    expect(unchangedTier?.price).toBe(80);
    const unchangedContact = await db.contact.findUnique({ where: { id: ID.contactRetailA } });
    expect(unchangedContact?.pricingTier).toBe('RETAIL');
  });

  it('[TP-04] RED-BEFORE: cross-tenant isolation across all 4 routes and PricingService leaves business B byte-identical', async () => {
    const beforeTierB = await db.productTierPrice.findMany({
      where: { businessId: ID.bizB },
      orderBy: { tier: 'asc' },
    });
    const beforeContactB = await db.contact.findUnique({ where: { id: ID.contactB } });

    // Owner A targeting Biz B path -> 403 (BusinessGuard)
    expect(
      (
        await request(app.getHttpServer())
          .get(`/commerce/businesses/${ID.bizB}/products/${ID.prodB}/tier-prices`)
          .set(HEADER, ID.ownerA)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app.getHttpServer())
          .put(`/commerce/businesses/${ID.bizB}/products/${ID.prodB}/tier-prices`)
          .set(HEADER, ID.ownerA)
          .send({ tierPrices: [{ tier: 'WHOLESALE', price: 1 }] })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app.getHttpServer())
          .get(`/commerce/businesses/${ID.bizB}/products/${ID.prodB}/price`)
          .query({ contactId: ID.contactB })
          .set(HEADER, ID.ownerA)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app.getHttpServer())
          .put(`/commerce/businesses/${ID.bizB}/contacts/${ID.contactB}/pricing-tier`)
          .set(HEADER, ID.ownerA)
          .send({ pricingTier: 'RETAIL' })
      ).status,
    ).toBe(403);

    // Owner A targeting Biz A path with Biz B productId / contactId -> 404
    expect(
      (
        await request(app.getHttpServer())
          .get(`/commerce/businesses/${ID.bizA}/products/${ID.prodB}/tier-prices`)
          .set(HEADER, ID.ownerA)
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app.getHttpServer())
          .put(`/commerce/businesses/${ID.bizA}/products/${ID.prodB}/tier-prices`)
          .set(HEADER, ID.ownerA)
          .send({ tierPrices: [{ tier: 'WHOLESALE', price: 1 }] })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app.getHttpServer())
          .get(`/commerce/businesses/${ID.bizA}/products/${ID.prodB}/price`)
          .set(HEADER, ID.ownerA)
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app.getHttpServer())
          .get(`/commerce/businesses/${ID.bizA}/products/${ID.prodA}/price`)
          .query({ contactId: ID.contactB })
          .set(HEADER, ID.ownerA)
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app.getHttpServer())
          .put(`/commerce/businesses/${ID.bizA}/contacts/${ID.contactB}/pricing-tier`)
          .set(HEADER, ID.ownerA)
          .send({ pricingTier: 'RETAIL' })
      ).status,
    ).toBe(404);

    // Direct PricingService cross-tenant calls also reject with NotFound
    await expect(pricingService.listProductTierPrices(ID.bizA, ID.prodB)).rejects.toMatchObject({ status: 404 });
    await expect(
      pricingService.setProductTierPrices(ID.bizA, ID.prodB, [{ tier: 'WHOLESALE', price: 1 }]),
    ).rejects.toMatchObject({ status: 404 });
    await expect(pricingService.setContactPricingTier(ID.bizA, ID.contactB, 'RETAIL')).rejects.toMatchObject({
      status: 404,
    });
    await expect(pricingService.resolveProductPrice(ID.bizA, ID.prodA, ID.contactB)).rejects.toMatchObject({
      status: 404,
    });

    // Business B rows byte-identical
    const afterTierB = await db.productTierPrice.findMany({
      where: { businessId: ID.bizB },
      orderBy: { tier: 'asc' },
    });
    const afterContactB = await db.contact.findUnique({ where: { id: ID.contactB } });
    expect(afterTierB).toEqual(beforeTierB);
    expect(afterContactB).toEqual(beforeContactB);
  });

  it('[TP-05] RED-BEFORE (D-133): member with crm_view=owned receives 404 for hidden contact on GET price and PUT pricing-tier, but succeeds on own contact', async () => {
    const hiddenPrice = await request(app.getHttpServer())
      .get(`/commerce/businesses/${ID.bizA}/products/${ID.prodA}/price`)
      .query({ contactId: ID.contactPrivateOwnerA })
      .set(HEADER, ID.revWriteOwnedCrmA);
    expect(hiddenPrice.status).toBe(404);

    const hiddenPut = await request(app.getHttpServer())
      .put(`/commerce/businesses/${ID.bizA}/contacts/${ID.contactPrivateOwnerA}/pricing-tier`)
      .set(HEADER, ID.revWriteOwnedCrmA)
      .send({ pricingTier: 'RETAIL' });
    expect(hiddenPut.status).toBe(404);

    // Owner's private contact remains unchanged
    const privateAfter = await db.contact.findUnique({ where: { id: ID.contactPrivateOwnerA } });
    expect(privateAfter?.pricingTier).toBe('WHOLESALE');

    // Own contact succeeds
    const ownPut = await request(app.getHttpServer())
      .put(`/commerce/businesses/${ID.bizA}/contacts/${ID.contactOwnedByStaffA}/pricing-tier`)
      .set(HEADER, ID.revWriteOwnedCrmA)
      .send({ pricingTier: 'WHOLESALE' });
    expect(ownPut.status).toBe(200);
    expect(ownPut.body).toEqual({ id: ID.contactOwnedByStaffA, pricingTier: 'WHOLESALE' });

    const ownPrice = await request(app.getHttpServer())
      .get(`/commerce/businesses/${ID.bizA}/products/${ID.prodA}/price`)
      .query({ contactId: ID.contactOwnedByStaffA })
      .set(HEADER, ID.revWriteOwnedCrmA);
    expect(ownPrice.status).toBe(200);
    expect(ownPrice.body).toMatchObject({ effectivePrice: 80, appliedTier: 'WHOLESALE', source: 'TIER' });
  });

  it('[TP-06] RED-BEFORE: soft-deleted entities return 404 and invalid payloads / query shapes return 400', async () => {
    expect(
      (
        await request(app.getHttpServer())
          .get(`/commerce/businesses/${ID.bizA}/products/${ID.prodADeleted}/tier-prices`)
          .set(HEADER, ID.ownerA)
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app.getHttpServer())
          .get(`/commerce/businesses/${ID.bizA}/products/${ID.prodA}/price`)
          .query({ contactId: ID.contactDeletedA })
          .set(HEADER, ID.ownerA)
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app.getHttpServer())
          .put(`/commerce/businesses/${ID.bizA}/contacts/${ID.contactDeletedA}/pricing-tier`)
          .set(HEADER, ID.ownerA)
          .send({ pricingTier: 'RETAIL' })
      ).status,
    ).toBe(404);

    // Invalid tier / negative price / duplicate tier / missing array / repeated contactId -> 400
    expect(
      (
        await request(app.getHttpServer())
          .put(`/commerce/businesses/${ID.bizA}/products/${ID.prodA}/tier-prices`)
          .set(HEADER, ID.ownerA)
          .send({ tierPrices: [{ tier: 'SUPER_SECRET', price: 10 }] })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app.getHttpServer())
          .put(`/commerce/businesses/${ID.bizA}/products/${ID.prodA}/tier-prices`)
          .set(HEADER, ID.ownerA)
          .send({ tierPrices: [{ tier: 'WHOLESALE', price: -5 }] })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app.getHttpServer())
          .put(`/commerce/businesses/${ID.bizA}/products/${ID.prodA}/tier-prices`)
          .set(HEADER, ID.ownerA)
          .send({
            tierPrices: [
              { tier: 'WHOLESALE', price: 80 },
              { tier: 'wholesale', price: 75 },
            ],
          })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app.getHttpServer())
          .put(`/commerce/businesses/${ID.bizA}/products/${ID.prodA}/tier-prices`)
          .set(HEADER, ID.ownerA)
          .send({ tierPrices: 'not-an-array' })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app.getHttpServer())
          .put(`/commerce/businesses/${ID.bizA}/contacts/${ID.contactRetailA}/pricing-tier`)
          .set(HEADER, ID.ownerA)
          .send({ pricingTier: 'BOGUS' })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app.getHttpServer())
          .get(
            `/commerce/businesses/${ID.bizA}/products/${ID.prodA}/price?contactId=${ID.contactWholesaleA}&contactId=${ID.contactRetailA}`,
          )
          .set(HEADER, ID.ownerA)
      ).status,
    ).toBe(400);
  });
});
