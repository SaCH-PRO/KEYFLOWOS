import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PricingService } from './pricing.service';
import { PrismaService } from '../../core/prisma/prisma.service';

describe('PricingService', () => {
  let service: PricingService;
  let prisma: {
    client: {
      product: { findFirst: ReturnType<typeof vi.fn> };
      productTierPrice: {
        findUnique: ReturnType<typeof vi.fn>;
        upsert: ReturnType<typeof vi.fn>;
        findMany: ReturnType<typeof vi.fn>;
      };
      contact: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    };
  };

  beforeEach(() => {
    prisma = {
      client: {
        product: { findFirst: vi.fn() },
        productTierPrice: { findUnique: vi.fn(), upsert: vi.fn(), findMany: vi.fn() },
        contact: { findFirst: vi.fn(), update: vi.fn() },
      },
    };
    service = new PricingService(prisma as unknown as PrismaService);
  });

  describe('resolveUnitPrice', () => {
    it('returns the product retail price for the RETAIL tier without a tier lookup', async () => {
      prisma.client.product.findFirst.mockResolvedValue({ price: 100 });
      const price = await service.resolveUnitPrice('biz', 'prod', 'RETAIL');
      expect(price).toBe(100);
      expect(prisma.client.productTierPrice.findUnique).not.toHaveBeenCalled();
    });

    it('returns the tier override for a non-retail tier when one exists', async () => {
      prisma.client.product.findFirst.mockResolvedValue({ price: 100 });
      prisma.client.productTierPrice.findUnique.mockResolvedValue({ price: 70 });
      const price = await service.resolveUnitPrice('biz', 'prod', 'WHOLESALE');
      expect(price).toBe(70);
    });

    it('falls back to the retail price when a non-retail tier has no override', async () => {
      prisma.client.product.findFirst.mockResolvedValue({ price: 100 });
      prisma.client.productTierPrice.findUnique.mockResolvedValue(null);
      const price = await service.resolveUnitPrice('biz', 'prod', 'WHOLESALE');
      expect(price).toBe(100);
    });

    it('throws when the product does not exist for the business', async () => {
      prisma.client.product.findFirst.mockResolvedValue(null);
      await expect(service.resolveUnitPrice('biz', 'missing', 'WHOLESALE')).rejects.toThrow(/not found/);
    });
  });

  describe('getContactTier', () => {
    it('defaults to RETAIL for an anonymous (no contact) line', async () => {
      expect(await service.getContactTier('biz', null)).toBe('RETAIL');
      expect(prisma.client.contact.findFirst).not.toHaveBeenCalled();
    });

    it('returns the contact pricing tier when set', async () => {
      prisma.client.contact.findFirst.mockResolvedValue({ pricingTier: 'WHOLESALE' });
      expect(await service.getContactTier('biz', 'c1')).toBe('WHOLESALE');
    });

    it('defaults to RETAIL when the contact has no tier', async () => {
      prisma.client.contact.findFirst.mockResolvedValue({ pricingTier: null });
      expect(await service.getContactTier('biz', 'c1')).toBe('RETAIL');
    });
  });

  describe('resolveLineItems', () => {
    it('honours an explicit unit price as a manual override (no product lookup)', async () => {
      prisma.client.contact.findFirst.mockResolvedValue({ pricingTier: 'WHOLESALE' });
      const lines = await service.resolveLineItems('biz', 'c1', [
        { description: 'Custom', quantity: 2, unitPrice: 55 },
      ]);
      expect(lines[0].unitPrice).toBe(55);
      expect(lines[0].total).toBe(110);
      expect(prisma.client.product.findFirst).not.toHaveBeenCalled();
    });

    it('prices a product line at the contact tier when no unitPrice is given', async () => {
      prisma.client.contact.findFirst.mockResolvedValue({ pricingTier: 'WHOLESALE' });
      prisma.client.product.findFirst.mockResolvedValue({ price: 100 });
      prisma.client.productTierPrice.findUnique.mockResolvedValue({ price: 70 });
      const lines = await service.resolveLineItems('biz', 'c1', [
        { description: 'Unit A', quantity: 3, productId: 'prod' },
      ]);
      expect(lines[0].unitPrice).toBe(70);
      expect(lines[0].total).toBe(210);
    });

    it('throws when a line has neither a unitPrice nor a productId', async () => {
      prisma.client.contact.findFirst.mockResolvedValue({ pricingTier: 'RETAIL' });
      await expect(
        service.resolveLineItems('biz', 'c1', [{ description: 'Mystery', quantity: 1 }]),
      ).rejects.toThrow(/neither a unitPrice nor a productId/);
    });
  });

  describe('setTierPrice', () => {
    it('refuses to set a RETAIL tier override (retail lives on the product)', async () => {
      await expect(service.setTierPrice('biz', 'prod', 'RETAIL', 10)).rejects.toThrow(/RETAIL/);
    });

    it('upserts a non-retail tier price', async () => {
      prisma.client.productTierPrice.upsert.mockResolvedValue({ id: 'x', tier: 'WHOLESALE', price: 70 });
      const row = await service.setTierPrice('biz', 'prod', 'WHOLESALE', 70);
      expect(row.price).toBe(70);
      expect(prisma.client.productTierPrice.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { productId_tier: { productId: 'prod', tier: 'WHOLESALE' } } }),
      );
    });
  });
});
