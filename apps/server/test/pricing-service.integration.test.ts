/**
 * TOF-TIER-PRICING-SCHEMA (P156): real-DB PostgreSQL proof for PricingService.
 *
 * Proves against live PostgreSQL (`product_tier_prices`, `products`, `contacts`):
 *  1. WHOLESALE tier price 80 on a 100 product resolves to 80 for a WHOLESALE contact,
 *     100 for a RETAIL contact, 100 for a null-tier contact, and 100 when contactId is omitted.
 *  2. Zero tier price (0) resolves to 0 (source: 'TIER') without falling back to basePrice.
 *  3. Strict tenant isolation: business A cannot read, replace, upsert, delete, or resolve
 *     business B's products, tier prices, or contacts (both directly and inside
 *     runWithTenantContext), always receiving NotFoundException while business B's rows
 *     remain byte-identical.
 *  4. Soft-deleted products and contacts are rejected with NotFoundException on every method.
 *  5. Contact visibility (D-133): a STAFF member with crm_view='owned' receives
 *     NotFoundException when resolving price or mutating pricingTier for an owner's PRIVATE
 *     contact, leaving that contact's pricingTier unchanged.
 *  6. Atomic replacement, single-tier upsert/delete, contact tier round-trip (set & clear),
 *     and invalid input rejections (duplicate tiers, negative/NaN/Infinity/>2 decimals, invalid tier).
 *
 * Fixture prefix: `v92c_` (registered in apps/server/test/helpers/fixture-prefixes.json).
 * Cleanup uses raw SQL with sqlLikePrefix(P) only.
 */
import 'reflect-metadata';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sqlLikePrefix } from './helpers/sql-like.js';

loadEnv({ path: path.resolve(__dirname, '../../../.env') });

const P = 'v92c_';

const ID = {
  ownerA: `${P}ownerA`,
  staffA: `${P}staffA`,
  ownerB: `${P}ownerB`,
  bizA: `${P}bizA`,
  bizB: `${P}bizB`,
  prodA: `${P}prodA`,
  prodADeleted: `${P}prodADel`,
  prodB: `${P}prodB`,
  contactWholesaleA: `${P}ctWholA`,
  contactRetailA: `${P}ctRetA`,
  contactNullA: `${P}ctNullA`,
  contactPrivateA: `${P}ctPrivA`,
  contactDeletedA: `${P}ctDelA`,
  contactB: `${P}ctB`,
};

let db: typeof import('@keyflow/db').db;
let tenant: typeof import('../src/core/tenant/tenant-context');
let service: import('../src/modules/commerce/pricing.service').PricingService;

async function cleanup() {
  for (const sql of [
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
  const [{ db: prismaClient, setTenantContextProvider }, tenantMod, { PricingService }] =
    await Promise.all([
      import('@keyflow/db'),
      import('../src/core/tenant/tenant-context'),
      import('../src/modules/commerce/pricing.service'),
    ]);

  db = prismaClient;
  tenant = tenantMod;
  setTenantContextProvider({
    getCurrentBusinessId: () => tenant.getCurrentBusinessId(),
  });

  service = new PricingService({ client: db } as any);

  await cleanup();

  await db.user.createMany({
    data: [
      { id: ID.ownerA, email: `${P}ownerA@example.test`, name: 'Owner A', role: 'USER' },
      { id: ID.staffA, email: `${P}staffA@example.test`, name: 'Staff A', role: 'USER' },
      { id: ID.ownerB, email: `${P}ownerB@example.test`, name: 'Owner B', role: 'USER' },
    ],
  });

  await db.business.createMany({
    data: [
      { id: ID.bizA, name: 'Pricing Biz A', slug: `${P}biz-a`, ownerId: ID.ownerA },
      { id: ID.bizB, name: 'Pricing Biz B', slug: `${P}biz-b`, ownerId: ID.ownerB },
    ],
  });

  await db.membership.createMany({
    data: [
      { userId: ID.ownerA, businessId: ID.bizA, role: 'OWNER' },
      {
        userId: ID.staffA,
        businessId: ID.bizA,
        role: 'STAFF',
        permissionScopes: { crm: 'read', crm_view: 'owned', revenue: 'write' },
      },
      { userId: ID.ownerB, businessId: ID.bizB, role: 'OWNER' },
    ],
  });

  await db.product.createMany({
    data: [
      { id: ID.prodA, businessId: ID.bizA, name: 'Widget A', price: 100, currency: 'TTD' },
      {
        id: ID.prodADeleted,
        businessId: ID.bizA,
        name: 'Deleted Widget A',
        price: 100,
        currency: 'TTD',
        deletedAt: new Date('2026-11-01T00:00:00.000Z'),
      },
      { id: ID.prodB, businessId: ID.bizB, name: 'Widget B', price: 200, currency: 'USD' },
    ],
  });

  await db.contact.createMany({
    data: [
      {
        id: ID.contactWholesaleA,
        businessId: ID.bizA,
        firstName: 'Wholesale',
        lastName: 'Buyer',
        email: `${P}wholesaleA@example.test`,
        pricingTier: 'WHOLESALE',
      },
      {
        id: ID.contactRetailA,
        businessId: ID.bizA,
        firstName: 'Retail',
        lastName: 'Buyer',
        email: `${P}retailA@example.test`,
        pricingTier: 'RETAIL',
      },
      {
        id: ID.contactNullA,
        businessId: ID.bizA,
        firstName: 'Default',
        lastName: 'Buyer',
        email: `${P}nullA@example.test`,
        pricingTier: null,
      },
      {
        id: ID.contactPrivateA,
        businessId: ID.bizA,
        firstName: 'Private',
        lastName: 'Client',
        email: `${P}privateA@example.test`,
        ownerId: ID.ownerA,
        visibility: 'PRIVATE',
        pricingTier: 'WHOLESALE',
      },
      {
        id: ID.contactDeletedA,
        businessId: ID.bizA,
        firstName: 'Deleted',
        lastName: 'Client',
        email: `${P}deletedA@example.test`,
        pricingTier: 'WHOLESALE',
        deletedAt: new Date('2026-11-01T00:00:00.000Z'),
      },
      {
        id: ID.contactB,
        businessId: ID.bizB,
        firstName: 'Foreign',
        lastName: 'Client',
        email: `${P}contactB@example.test`,
        pricingTier: 'RETAIL',
      },
    ],
  });

  await service.setProductTierPrices(ID.bizB, ID.prodB, [{ tier: 'WHOLESALE', price: 55 }]);
}, 30_000);

afterAll(async () => {
  await cleanup();
});

describe('PricingService real-DB PostgreSQL proof (v92c_)', () => {
  it('sets WHOLESALE 80 on a 100 product and resolves 80 for WHOLESALE, 100 for RETAIL/null/omitted', async () => {
    const saved = await service.setProductTierPrices(ID.bizA, ID.prodA, [
      { tier: ' wholesale ', price: 80 },
      { tier: 'VIP', price: 70 },
    ]);
    expect(saved.map((r) => ({ tier: r.tier, price: r.price }))).toEqual([
      { tier: 'VIP', price: 70 },
      { tier: 'WHOLESALE', price: 80 },
    ]);

    const wholesalePrice = await service.resolveProductPrice(
      ID.bizA,
      ID.prodA,
      ID.contactWholesaleA,
    );
    expect(wholesalePrice).toMatchObject({
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

    const retailPrice = await service.resolveProductPrice(ID.bizA, ID.prodA, ID.contactRetailA);
    expect(retailPrice).toMatchObject({
      basePrice: 100,
      effectivePrice: 100,
      price: 100,
      contactTier: 'RETAIL',
      appliedTier: null,
      source: 'BASE',
    });

    const nullTierPrice = await service.resolveProductPrice(ID.bizA, ID.prodA, ID.contactNullA);
    expect(nullTierPrice).toMatchObject({
      basePrice: 100,
      effectivePrice: 100,
      price: 100,
      contactTier: null,
      appliedTier: null,
      source: 'BASE',
    });

    const baseOnly = await service.resolveProductPrice(ID.bizA, ID.prodA);
    expect(baseOnly).toMatchObject({
      basePrice: 100,
      effectivePrice: 100,
      price: 100,
      contactId: null,
      appliedTier: null,
      source: 'BASE',
    });
  });

  it('honors a 0 tier price and supports atomic replacement, single upsert, and delete', async () => {
    const comp = await service.upsertProductTierPrice(ID.bizA, ID.prodA, 'WHOLESALE', 0);
    expect(comp.price).toBe(0);

    const zeroResolved = await service.resolveProductPrice(
      ID.bizA,
      ID.prodA,
      ID.contactWholesaleA,
    );
    expect(zeroResolved.effectivePrice).toBe(0);
    expect(zeroResolved.appliedTier).toBe('WHOLESALE');
    expect(zeroResolved.source).toBe('TIER');

    const replaced = await service.setProductTierPrices(ID.bizA, ID.prodA, [
      { tier: 'WHOLESALE', price: 75.5 },
      { tier: 'DISTRIBUTOR', price: 60 },
    ]);
    expect(replaced.map((r) => ({ tier: r.tier, price: r.price }))).toEqual([
      { tier: 'DISTRIBUTOR', price: 60 },
      { tier: 'WHOLESALE', price: 75.5 },
    ]);

    const delDist = await service.deleteProductTierPrice(ID.bizA, ID.prodA, 'DISTRIBUTOR');
    expect(delDist).toEqual({ deleted: true });
    const delAgain = await service.deleteProductTierPrice(ID.bizA, ID.prodA, 'DISTRIBUTOR');
    expect(delAgain).toEqual({ deleted: false });

    const listed = await service.listProductTierPrices(ID.bizA, ID.prodA);
    expect(listed.map((r) => ({ tier: r.tier, price: r.price }))).toEqual([
      { tier: 'WHOLESALE', price: 75.5 },
    ]);

    // Restore WHOLESALE = 80 for subsequent tests
    await service.upsertProductTierPrice(ID.bizA, ID.prodA, 'WHOLESALE', 80);
  });

  it('enforces strict tenant isolation and leaves Business B byte-identical', async () => {
    const beforeTierB = await db.productTierPrice.findMany({
      where: { businessId: ID.bizB, productId: ID.prodB },
    });
    const beforeContactB = await db.contact.findFirst({
      where: { id: ID.contactB, businessId: ID.bizB },
      select: { id: true, pricingTier: true, updatedAt: true },
    });

    const runCrossTenantChecks = async () => {
      await expect(service.listProductTierPrices(ID.bizA, ID.prodB)).rejects.toThrow(
        NotFoundException,
      );
      await expect(
        service.setProductTierPrices(ID.bizA, ID.prodB, [{ tier: 'WHOLESALE', price: 1 }]),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.upsertProductTierPrice(ID.bizA, ID.prodB, 'WHOLESALE', 1),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.deleteProductTierPrice(ID.bizA, ID.prodB, 'WHOLESALE'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.resolveProductPrice(ID.bizA, ID.prodB, ID.contactWholesaleA),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.resolveProductPrice(ID.bizA, ID.prodA, ID.contactB),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.setContactPricingTier(ID.bizA, ID.contactB, 'WHOLESALE'),
      ).rejects.toThrow(NotFoundException);
    };

    // Unscoped direct service calls
    await runCrossTenantChecks();
    // Inside active tenant context for Business A
    await tenant.runWithTenant(ID.bizA, ID.ownerA, runCrossTenantChecks);

    const afterTierB = await db.productTierPrice.findMany({
      where: { businessId: ID.bizB, productId: ID.prodB },
    });
    const afterContactB = await db.contact.findFirst({
      where: { id: ID.contactB, businessId: ID.bizB },
      select: { id: true, pricingTier: true, updatedAt: true },
    });

    expect(afterTierB).toEqual(beforeTierB);
    expect(afterContactB).toEqual(beforeContactB);
  });

  it('refuses soft-deleted products and soft-deleted contacts with NotFoundException', async () => {
    await expect(service.listProductTierPrices(ID.bizA, ID.prodADeleted)).rejects.toThrow(
      NotFoundException,
    );
    await expect(
      service.setProductTierPrices(ID.bizA, ID.prodADeleted, [{ tier: 'WHOLESALE', price: 50 }]),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.upsertProductTierPrice(ID.bizA, ID.prodADeleted, 'WHOLESALE', 50),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.deleteProductTierPrice(ID.bizA, ID.prodADeleted, 'WHOLESALE'),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.resolveProductPrice(ID.bizA, ID.prodADeleted, ID.contactWholesaleA),
    ).rejects.toThrow(NotFoundException);

    await expect(
      service.resolveProductPrice(ID.bizA, ID.prodA, ID.contactDeletedA),
    ).rejects.toThrow(NotFoundException);
    await expect(
      service.setContactPricingTier(ID.bizA, ID.contactDeletedA, 'RETAIL'),
    ).rejects.toThrow(NotFoundException);
  });

  it('enforces D-133 contact visibility for restricted staff actors on PRIVATE contacts', async () => {
    await expect(
      service.resolveProductPrice(ID.bizA, ID.prodA, ID.contactPrivateA, ID.staffA),
    ).rejects.toThrow(NotFoundException);

    await expect(
      service.setContactPricingTier(ID.bizA, ID.contactPrivateA, 'RETAIL', ID.staffA),
    ).rejects.toThrow(NotFoundException);

    // Owner sees and updates the PRIVATE contact cleanly
    const ownerResolved = await service.resolveProductPrice(
      ID.bizA,
      ID.prodA,
      ID.contactPrivateA,
      ID.ownerA,
    );
    expect(ownerResolved.effectivePrice).toBe(80);
    expect(ownerResolved.appliedTier).toBe('WHOLESALE');

    const ownerUpdated = await service.setContactPricingTier(
      ID.bizA,
      ID.contactPrivateA,
      'VIP',
      ID.ownerA,
    );
    expect(ownerUpdated).toEqual({ id: ID.contactPrivateA, pricingTier: 'VIP' });
  });

  it('round-trips setContactPricingTier (set & clear) and rejects invalid inputs without mutating rows', async () => {
    const before = await service.listProductTierPrices(ID.bizA, ID.prodA);

    await expect(
      service.setProductTierPrices(ID.bizA, ID.prodA, [
        { tier: 'wholesale', price: 80 },
        { tier: 'WHOLESALE', price: 70 },
      ]),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.upsertProductTierPrice(ID.bizA, ID.prodA, 'WHOLESALE', -5),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.upsertProductTierPrice(ID.bizA, ID.prodA, 'WHOLESALE', Number.NaN),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.upsertProductTierPrice(ID.bizA, ID.prodA, 'WHOLESALE', Number.POSITIVE_INFINITY),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.upsertProductTierPrice(ID.bizA, ID.prodA, 'WHOLESALE', 10.123),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.upsertProductTierPrice(ID.bizA, ID.prodA, 'BOGUS', 50),
    ).rejects.toThrow(BadRequestException);

    const after = await service.listProductTierPrices(ID.bizA, ID.prodA);
    expect(after).toEqual(before);

    // Contact pricingTier set -> clear round-trip
    const setRes = await service.setContactPricingTier(ID.bizA, ID.contactNullA, 'wholesale');
    expect(setRes).toEqual({ id: ID.contactNullA, pricingTier: 'WHOLESALE' });
    const priceWhenWholesale = await service.resolveProductPrice(
      ID.bizA,
      ID.prodA,
      ID.contactNullA,
    );
    expect(priceWhenWholesale.effectivePrice).toBe(80);

    const clearRes = await service.setContactPricingTier(ID.bizA, ID.contactNullA, null);
    expect(clearRes).toEqual({ id: ID.contactNullA, pricingTier: null });
    const priceWhenCleared = await service.resolveProductPrice(
      ID.bizA,
      ID.prodA,
      ID.contactNullA,
    );
    expect(priceWhenCleared.effectivePrice).toBe(100);
    expect(priceWhenCleared.source).toBe('BASE');

    // Empty set clears prodA tier prices without affecting prodB
    expect(await service.setProductTierPrices(ID.bizA, ID.prodA, [])).toEqual([]);
    expect(await service.listProductTierPrices(ID.bizA, ID.prodA)).toEqual([]);
    const prodBTiers = await service.listProductTierPrices(ID.bizB, ID.prodB);
    expect(prodBTiers).toHaveLength(1);
    expect(prodBTiers[0].price).toBe(55);
  });
});
