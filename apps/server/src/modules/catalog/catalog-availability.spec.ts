import { describe, expect, it, vi } from 'vitest';
import { CatalogService } from './catalog.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Task #584 (INV1) — verifies the public storefront stock projection
 * for `CatalogService.listPublicProducts`. Stock counts always come
 * from `inventoryStock.groupBy` (never a cached column on Product),
 * and `purchasable` is the single source of truth that downstream UI
 * uses to enable/disable Add-to-Cart.
 */
describe('CatalogService — listPublicProducts stock projection', () => {
  const businessId = 'biz_1';

  function makeService(opts: {
    products: any[];
    stock: { productId: string; quantity: number; reserved: number }[];
  }) {
    const prismaMock = {
      client: {
        product: {
          findMany: vi.fn().mockResolvedValue(opts.products),
        },
        inventoryStock: {
          groupBy: vi
            .fn()
            .mockResolvedValue(
              opts.stock.map((s) => ({
                productId: s.productId,
                _sum: { quantity: s.quantity, reserved: s.reserved },
              })),
            ),
        },
      },
    } as unknown as PrismaService;

    // listPublicProducts does not use the EventEmitter dep, so a stub is fine.
    return new CatalogService(prismaMock, { emit: vi.fn() } as any);
  }

  it('returns untracked products as always purchasable with stockStatus=untracked', async () => {
    const svc = makeService({
      products: [
        { id: 'p1', businessId, isActive: true, inventoryMode: 'untracked', outOfStockBehavior: 'hide' },
      ],
      stock: [],
    });
    const result = await svc.listPublicProducts(businessId);
    expect(result).toHaveLength(1);
    expect(result[0].purchasable).toBe(true);
    expect(result[0].stockStatus).toBe('untracked');
    expect(result[0].availableQuantity).toBeNull();
  });

  it('returns tracked products with positive stock as purchasable', async () => {
    const svc = makeService({
      products: [
        { id: 'p1', businessId, isActive: true, inventoryMode: 'tracked', outOfStockBehavior: 'hide' },
      ],
      stock: [{ productId: 'p1', quantity: 10, reserved: 2 }],
    });
    const result = await svc.listPublicProducts(businessId);
    expect(result).toHaveLength(1);
    expect(result[0].availableQuantity).toBe(8);
    expect(result[0].stockStatus).toBe('available');
    expect(result[0].purchasable).toBe(true);
  });

  it("filters tracked + zero-stock + behavior='hide' out of the public list", async () => {
    const svc = makeService({
      products: [
        { id: 'p1', businessId, isActive: true, inventoryMode: 'tracked', outOfStockBehavior: 'hide' },
      ],
      stock: [{ productId: 'p1', quantity: 0, reserved: 0 }],
    });
    const result = await svc.listPublicProducts(businessId);
    expect(result).toHaveLength(0);
  });

  it("returns tracked + zero-stock + behavior='show_oos' as not purchasable", async () => {
    const svc = makeService({
      products: [
        { id: 'p1', businessId, isActive: true, inventoryMode: 'tracked', outOfStockBehavior: 'show_oos' },
      ],
      stock: [{ productId: 'p1', quantity: 0, reserved: 0 }],
    });
    const result = await svc.listPublicProducts(businessId);
    expect(result).toHaveLength(1);
    expect(result[0].purchasable).toBe(false);
    expect(result[0].stockStatus).toBe('out_of_stock');
    expect(result[0].availableQuantity).toBe(0);
  });

  it("returns tracked + zero-stock + behavior='allow_backorder' as purchasable with status=backorder", async () => {
    const svc = makeService({
      products: [
        { id: 'p1', businessId, isActive: true, inventoryMode: 'tracked', outOfStockBehavior: 'allow_backorder' },
      ],
      stock: [{ productId: 'p1', quantity: 0, reserved: 0 }],
    });
    const result = await svc.listPublicProducts(businessId);
    expect(result).toHaveLength(1);
    expect(result[0].purchasable).toBe(true);
    expect(result[0].stockStatus).toBe('backorder');
    expect(result[0].availableQuantity).toBe(0);
  });

  it('marks tracked products with low stock (<= 3 available) as stockStatus=low', async () => {
    const svc = makeService({
      products: [
        { id: 'p1', businessId, isActive: true, inventoryMode: 'tracked', outOfStockBehavior: 'hide' },
      ],
      stock: [{ productId: 'p1', quantity: 5, reserved: 3 }],
    });
    const result = await svc.listPublicProducts(businessId);
    expect(result).toHaveLength(1);
    expect(result[0].stockStatus).toBe('low');
    expect(result[0].availableQuantity).toBe(2);
    expect(result[0].purchasable).toBe(true);
  });

});
