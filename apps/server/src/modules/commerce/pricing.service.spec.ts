/**
 * TOF-TIER-PRICING-SCHEMA (P156): unit spec for tenant-bound PricingService.
 *
 * Verifies:
 *  - WHOLESALE tier price 80 on a 100 product resolves to 80 for a WHOLESALE contact
 *    and 100 for a RETAIL contact (or null tier / unmatched tier / no contactId).
 *  - Zero tier price (0) is honored and does not fall back to base price.
 *  - Foreign, missing, or soft-deleted product or contact throws NotFoundException
 *    and writes nothing.
 *  - Every Prisma read/write explicitly scopes by businessId (and deletedAt: null on
 *    soft-deleted models Product and Contact).
 *  - Input validation rejects invalid tiers, duplicate tiers after normalization,
 *    negative prices, NaN/Infinity, > 2 decimal places, and overflow amounts.
 *  - Contact visibility (D-133): restricted staff actors receive NotFoundException
 *    for contacts they may not open.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DEFAULT_PRICING_TIER,
  PRICING_TIERS,
  PricingService,
  assertValidTierPrice,
  normalizePricingTier,
} from './pricing.service';

const BIZ_A = 'biz_a';
const PROD_A = 'prod_a';
const PROD_FOREIGN = 'prod_b';
const CONTACT_WHOLESALE = 'contact_wholesale';
const CONTACT_RETAIL = 'contact_retail';
const CONTACT_NULL_TIER = 'contact_null';
const CONTACT_VIP = 'contact_vip';
const CONTACT_FOREIGN = 'contact_b';
const NOW = new Date('2026-11-27T00:00:00.000Z');

function createMockPrisma() {
  const client: any = {
    product: {
      findFirst: vi.fn(),
    },
    productTierPrice: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    contact: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    membership: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => fn(client)),
  };
  return { client };
}

describe('PricingService (TOF-TIER-PRICING-SCHEMA)', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let service: PricingService;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    service = new PricingService(mockPrisma as any);
  });

  describe('tier & price validation helpers', () => {
    it('exports canonical pricing tiers with RETAIL default', () => {
      expect(DEFAULT_PRICING_TIER).toBe('RETAIL');
      expect(PRICING_TIERS).toContain('RETAIL');
      expect(PRICING_TIERS).toContain('WHOLESALE');
      expect(PRICING_TIERS).toContain('VIP');
      expect(PRICING_TIERS).toContain('DISTRIBUTOR');
    });

    it('normalizes valid tiers with trim and uppercase', () => {
      expect(normalizePricingTier('  wholesale ')).toBe('WHOLESALE');
      expect(normalizePricingTier('retail')).toBe('RETAIL');
      expect(normalizePricingTier('Vip')).toBe('VIP');
      expect(normalizePricingTier('distributor')).toBe('DISTRIBUTOR');
    });

    it.each(['', '   ', 'UNKNOWN', 'BULK', null, undefined, 123])(
      'rejects invalid tier %j with BadRequestException',
      (raw) => {
        expect(() => normalizePricingTier(raw)).toThrow(BadRequestException);
      },
    );

    it('accepts valid non-negative prices up to 2 decimals and normalizes -0', () => {
      expect(assertValidTierPrice(0)).toBe(0);
      expect(Object.is(assertValidTierPrice(-0), 0)).toBe(true);
      expect(assertValidTierPrice(80)).toBe(80);
      expect(assertValidTierPrice(19.99)).toBe(19.99);
      expect(assertValidTierPrice(1.15)).toBe(1.15);
    });

    it.each([-0.01, -100, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 10.123, 1e-7, 1e15, '80', null, undefined])(
      'rejects invalid price %j with BadRequestException',
      (raw) => {
        expect(() => assertValidTierPrice(raw)).toThrow(BadRequestException);
      },
    );
  });

  describe('resolveProductPrice', () => {
    it('returns 80 for a WHOLESALE contact when WHOLESALE tier price is 80 on a 100 product', async () => {
      mockPrisma.client.product.findFirst.mockResolvedValue({
        id: PROD_A,
        price: 100,
        currency: 'TTD',
      });
      mockPrisma.client.contact.findFirst.mockResolvedValue({
        id: CONTACT_WHOLESALE,
        pricingTier: 'WHOLESALE',
      });
      mockPrisma.client.productTierPrice.findFirst.mockResolvedValue({
        tier: 'WHOLESALE',
        price: 80,
      });

      const resolved = await service.resolveProductPrice(BIZ_A, PROD_A, CONTACT_WHOLESALE);

      expect(resolved).toEqual({
        productId: PROD_A,
        basePrice: 100,
        effectivePrice: 80,
        price: 80,
        currency: 'TTD',
        contactId: CONTACT_WHOLESALE,
        contactTier: 'WHOLESALE',
        appliedTier: 'WHOLESALE',
        source: 'TIER',
      });

      expect(mockPrisma.client.product.findFirst).toHaveBeenCalledWith({
        where: { id: PROD_A, businessId: BIZ_A, deletedAt: null },
        select: { id: true, price: true, currency: true },
      });
      expect(mockPrisma.client.contact.findFirst).toHaveBeenCalledWith({
        where: { id: CONTACT_WHOLESALE, businessId: BIZ_A, deletedAt: null },
        select: { id: true, pricingTier: true },
      });
      expect(mockPrisma.client.productTierPrice.findFirst).toHaveBeenCalledWith({
        where: { businessId: BIZ_A, productId: PROD_A, tier: 'WHOLESALE' },
        select: { tier: true, price: true },
      });
    });

    it('returns 100 (base price) for a RETAIL contact when only WHOLESALE tier price exists', async () => {
      mockPrisma.client.product.findFirst.mockResolvedValue({
        id: PROD_A,
        price: 100,
        currency: 'TTD',
      });
      mockPrisma.client.contact.findFirst.mockResolvedValue({
        id: CONTACT_RETAIL,
        pricingTier: 'RETAIL',
      });
      mockPrisma.client.productTierPrice.findFirst.mockResolvedValue(null);

      const resolved = await service.resolveProductPrice(BIZ_A, PROD_A, CONTACT_RETAIL);

      expect(resolved).toEqual({
        productId: PROD_A,
        basePrice: 100,
        effectivePrice: 100,
        price: 100,
        currency: 'TTD',
        contactId: CONTACT_RETAIL,
        contactTier: 'RETAIL',
        appliedTier: null,
        source: 'BASE',
      });
    });

    it('falls back to base price when contact has null pricingTier without querying tier prices', async () => {
      mockPrisma.client.product.findFirst.mockResolvedValue({
        id: PROD_A,
        price: 100,
        currency: 'USD',
      });
      mockPrisma.client.contact.findFirst.mockResolvedValue({
        id: CONTACT_NULL_TIER,
        pricingTier: null,
      });

      const resolved = await service.resolveProductPrice(BIZ_A, PROD_A, CONTACT_NULL_TIER);

      expect(resolved).toEqual({
        productId: PROD_A,
        basePrice: 100,
        effectivePrice: 100,
        price: 100,
        currency: 'USD',
        contactId: CONTACT_NULL_TIER,
        contactTier: null,
        appliedTier: null,
        source: 'BASE',
      });
      expect(mockPrisma.client.productTierPrice.findFirst).not.toHaveBeenCalled();
    });

    it('falls back to base price when contact tier has no matching ProductTierPrice row', async () => {
      mockPrisma.client.product.findFirst.mockResolvedValue({
        id: PROD_A,
        price: 100,
        currency: 'TTD',
      });
      mockPrisma.client.contact.findFirst.mockResolvedValue({
        id: CONTACT_VIP,
        pricingTier: 'VIP',
      });
      mockPrisma.client.productTierPrice.findFirst.mockResolvedValue(null);

      const resolved = await service.resolveProductPrice(BIZ_A, PROD_A, CONTACT_VIP);

      expect(resolved.effectivePrice).toBe(100);
      expect(resolved.price).toBe(100);
      expect(resolved.contactTier).toBe('VIP');
      expect(resolved.appliedTier).toBeNull();
      expect(resolved.source).toBe('BASE');
    });

    it('honors a 0 tier price instead of falling back to basePrice', async () => {
      mockPrisma.client.product.findFirst.mockResolvedValue({
        id: PROD_A,
        price: 100,
        currency: 'TTD',
      });
      mockPrisma.client.contact.findFirst.mockResolvedValue({
        id: CONTACT_WHOLESALE,
        pricingTier: 'WHOLESALE',
      });
      mockPrisma.client.productTierPrice.findFirst.mockResolvedValue({
        tier: 'WHOLESALE',
        price: 0,
      });

      const resolved = await service.resolveProductPrice(BIZ_A, PROD_A, CONTACT_WHOLESALE);

      expect(resolved.effectivePrice).toBe(0);
      expect(resolved.price).toBe(0);
      expect(resolved.appliedTier).toBe('WHOLESALE');
      expect(resolved.source).toBe('TIER');
    });

    it.each([undefined, null, '', '   '])(
      'returns base price when contactId is omitted (%j)',
      async (contactId) => {
        mockPrisma.client.product.findFirst.mockResolvedValue({
          id: PROD_A,
          price: 100,
          currency: 'TTD',
        });

        const resolved = await service.resolveProductPrice(BIZ_A, PROD_A, contactId);

        expect(resolved).toEqual({
          productId: PROD_A,
          basePrice: 100,
          effectivePrice: 100,
          price: 100,
          currency: 'TTD',
          contactId: null,
          contactTier: null,
          appliedTier: null,
          source: 'BASE',
        });
        expect(mockPrisma.client.contact.findFirst).not.toHaveBeenCalled();
      },
    );

    it('throws NotFoundException for a foreign or missing product', async () => {
      mockPrisma.client.product.findFirst.mockResolvedValue(null);

      await expect(
        service.resolveProductPrice(BIZ_A, PROD_FOREIGN, CONTACT_WHOLESALE),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.client.contact.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.client.productTierPrice.findFirst).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a foreign or soft-deleted contact', async () => {
      mockPrisma.client.product.findFirst.mockResolvedValue({
        id: PROD_A,
        price: 100,
        currency: 'TTD',
      });
      mockPrisma.client.contact.findFirst.mockResolvedValue(null);

      await expect(
        service.resolveProductPrice(BIZ_A, PROD_A, CONTACT_FOREIGN),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.client.productTierPrice.findFirst).not.toHaveBeenCalled();
    });

    it('applies D-133 contact visibility when actorUserId is a restricted member', async () => {
      mockPrisma.client.product.findFirst.mockResolvedValue({
        id: PROD_A,
        price: 100,
        currency: 'TTD',
      });
      mockPrisma.client.user.findUnique.mockResolvedValue({ id: 'staff_1', role: 'USER' });
      mockPrisma.client.membership.findUnique.mockResolvedValue({
        userId: 'staff_1',
        businessId: BIZ_A,
        role: 'STAFF',
        permissionScopes: { crm: 'read', crm_view: 'owned' },
      });
      mockPrisma.client.contact.findFirst.mockResolvedValue(null);

      await expect(
        service.resolveProductPrice(BIZ_A, PROD_A, CONTACT_WHOLESALE, 'staff_1'),
      ).rejects.toThrow(NotFoundException);

      const whereArg = mockPrisma.client.contact.findFirst.mock.calls[0][0].where;
      expect(whereArg.id).toBe(CONTACT_WHOLESALE);
      expect(whereArg.businessId).toBe(BIZ_A);
      expect(whereArg.deletedAt).toBeNull();
      expect(whereArg.AND).toBeDefined();
    });
  });

  describe('listProductTierPrices', () => {
    it('lists tier prices scoped to businessId and productId after verifying product ownership', async () => {
      mockPrisma.client.product.findFirst.mockResolvedValue({ id: PROD_A });
      const rows = [
        { id: 'tp_1', businessId: BIZ_A, productId: PROD_A, tier: 'WHOLESALE', price: 80, createdAt: NOW, updatedAt: NOW },
      ];
      mockPrisma.client.productTierPrice.findMany.mockResolvedValue(rows);

      const result = await service.listProductTierPrices(BIZ_A, PROD_A);

      expect(result).toEqual(rows);
      expect(mockPrisma.client.product.findFirst).toHaveBeenCalledWith({
        where: { id: PROD_A, businessId: BIZ_A, deletedAt: null },
        select: { id: true },
      });
      expect(mockPrisma.client.productTierPrice.findMany).toHaveBeenCalledWith({
        where: { businessId: BIZ_A, productId: PROD_A },
        orderBy: { tier: 'asc' },
      });
    });

    it('throws NotFoundException for a foreign product', async () => {
      mockPrisma.client.product.findFirst.mockResolvedValue(null);

      await expect(service.listProductTierPrices(BIZ_A, PROD_FOREIGN)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.client.productTierPrice.findMany).not.toHaveBeenCalled();
    });
  });

  describe('setProductTierPrices', () => {
    it('replaces tier prices atomically inside a transaction with tenant-scoped queries', async () => {
      mockPrisma.client.product.findFirst.mockResolvedValue({ id: PROD_A });
      mockPrisma.client.productTierPrice.deleteMany.mockResolvedValue({ count: 1 });
      mockPrisma.client.productTierPrice.findFirst
        .mockResolvedValueOnce({ id: 'tp_existing' }) // WHOLESALE exists
        .mockResolvedValueOnce(null); // VIP new
      mockPrisma.client.productTierPrice.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.client.productTierPrice.create.mockResolvedValue({
        id: 'tp_vip',
        businessId: BIZ_A,
        productId: PROD_A,
        tier: 'VIP',
        price: 70,
        createdAt: NOW,
        updatedAt: NOW,
      });
      const finalRows = [
        { id: 'tp_vip', businessId: BIZ_A, productId: PROD_A, tier: 'VIP', price: 70, createdAt: NOW, updatedAt: NOW },
        { id: 'tp_existing', businessId: BIZ_A, productId: PROD_A, tier: 'WHOLESALE', price: 80, createdAt: NOW, updatedAt: NOW },
      ];
      mockPrisma.client.productTierPrice.findMany.mockResolvedValue(finalRows);

      const res = await service.setProductTierPrices(BIZ_A, PROD_A, [
        { tier: ' wholesale ', price: 80 },
        { tier: 'vip', price: 70 },
      ]);

      expect(res).toEqual(finalRows);
      expect(mockPrisma.client.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.client.productTierPrice.deleteMany).toHaveBeenCalledWith({
        where: { businessId: BIZ_A, productId: PROD_A, tier: { notIn: ['WHOLESALE', 'VIP'] } },
      });
      expect(mockPrisma.client.productTierPrice.updateMany).toHaveBeenCalledWith({
        where: { id: 'tp_existing', businessId: BIZ_A, productId: PROD_A },
        data: { price: 80 },
      });
      expect(mockPrisma.client.productTierPrice.create).toHaveBeenCalledWith({
        data: { businessId: BIZ_A, productId: PROD_A, tier: 'VIP', price: 70 },
      });
    });

    it('clears all tier prices for the product when passed an empty array', async () => {
      mockPrisma.client.product.findFirst.mockResolvedValue({ id: PROD_A });
      mockPrisma.client.productTierPrice.deleteMany.mockResolvedValue({ count: 2 });

      const res = await service.setProductTierPrices(BIZ_A, PROD_A, []);

      expect(res).toEqual([]);
      expect(mockPrisma.client.productTierPrice.deleteMany).toHaveBeenCalledWith({
        where: { businessId: BIZ_A, productId: PROD_A },
      });
    });

    it('rejects duplicate tiers after normalization before touching the database', async () => {
      await expect(
        service.setProductTierPrices(BIZ_A, PROD_A, [
          { tier: 'wholesale', price: 80 },
          { tier: ' WHOLESALE ', price: 75 },
        ]),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.client.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a foreign product with NotFoundException and mutates nothing', async () => {
      mockPrisma.client.product.findFirst.mockResolvedValue(null);

      await expect(
        service.setProductTierPrices(BIZ_A, PROD_FOREIGN, [{ tier: 'WHOLESALE', price: 80 }]),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.client.productTierPrice.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.client.productTierPrice.create).not.toHaveBeenCalled();
      expect(mockPrisma.client.productTierPrice.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('upsertProductTierPrice & deleteProductTierPrice', () => {
    it('creates a tier price when absent and updates when present', async () => {
      mockPrisma.client.product.findFirst.mockResolvedValue({ id: PROD_A });
      const created = { id: 'tp_1', businessId: BIZ_A, productId: PROD_A, tier: 'WHOLESALE', price: 80, createdAt: NOW, updatedAt: NOW };
      mockPrisma.client.productTierPrice.findFirst.mockResolvedValueOnce(null);
      mockPrisma.client.productTierPrice.create.mockResolvedValueOnce(created);

      const first = await service.upsertProductTierPrice(BIZ_A, PROD_A, 'wholesale', 80);
      expect(first).toEqual(created);

      const updated = { ...created, price: 75.5 };
      mockPrisma.client.productTierPrice.findFirst
        .mockResolvedValueOnce({ id: 'tp_1' })
        .mockResolvedValueOnce(updated);
      mockPrisma.client.productTierPrice.updateMany.mockResolvedValueOnce({ count: 1 });

      const second = await service.upsertProductTierPrice(BIZ_A, PROD_A, 'WHOLESALE', 75.5);
      expect(second).toEqual(updated);
      expect(mockPrisma.client.productTierPrice.updateMany).toHaveBeenCalledWith({
        where: { id: 'tp_1', businessId: BIZ_A, productId: PROD_A },
        data: { price: 75.5 },
      });
    });

    it('throws NotFoundException on upsert or delete for a foreign product', async () => {
      mockPrisma.client.product.findFirst.mockResolvedValue(null);

      await expect(
        service.upsertProductTierPrice(BIZ_A, PROD_FOREIGN, 'WHOLESALE', 80),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.deleteProductTierPrice(BIZ_A, PROD_FOREIGN, 'WHOLESALE'),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.client.productTierPrice.deleteMany).not.toHaveBeenCalled();
    });

    it('deletes a tier price scoped to businessId and productId', async () => {
      mockPrisma.client.product.findFirst.mockResolvedValue({ id: PROD_A });
      mockPrisma.client.productTierPrice.deleteMany.mockResolvedValue({ count: 1 });

      const res = await service.deleteProductTierPrice(BIZ_A, PROD_A, 'wholesale');

      expect(res).toEqual({ deleted: true });
      expect(mockPrisma.client.productTierPrice.deleteMany).toHaveBeenCalledWith({
        where: { businessId: BIZ_A, productId: PROD_A, tier: 'WHOLESALE' },
      });
    });
  });

  describe('setContactPricingTier', () => {
    it('sets normalized pricingTier on an owned contact and clears with null', async () => {
      mockPrisma.client.contact.updateMany.mockResolvedValue({ count: 1 });

      const setRes = await service.setContactPricingTier(BIZ_A, CONTACT_WHOLESALE, 'wholesale');
      expect(setRes).toEqual({ id: CONTACT_WHOLESALE, pricingTier: 'WHOLESALE' });
      expect(mockPrisma.client.contact.updateMany).toHaveBeenCalledWith({
        where: { id: CONTACT_WHOLESALE, businessId: BIZ_A, deletedAt: null },
        data: { pricingTier: 'WHOLESALE' },
      });

      const clearRes = await service.setContactPricingTier(BIZ_A, CONTACT_WHOLESALE, null);
      expect(clearRes).toEqual({ id: CONTACT_WHOLESALE, pricingTier: null });
      expect(mockPrisma.client.contact.updateMany).toHaveBeenLastCalledWith({
        where: { id: CONTACT_WHOLESALE, businessId: BIZ_A, deletedAt: null },
        data: { pricingTier: null },
      });
    });

    it('throws NotFoundException when contact is foreign or soft-deleted', async () => {
      mockPrisma.client.contact.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.setContactPricingTier(BIZ_A, CONTACT_FOREIGN, 'WHOLESALE'),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects invalid tier strings with BadRequestException before hitting DB', async () => {
      await expect(
        service.setContactPricingTier(BIZ_A, CONTACT_WHOLESALE, 'NOT_A_TIER'),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.client.contact.updateMany).not.toHaveBeenCalled();
    });
  });
});
