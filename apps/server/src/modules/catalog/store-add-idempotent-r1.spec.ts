import { ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { CatalogService } from './catalog.service';
import type { PrismaService } from '../../core/prisma/prisma.service';

/**
 * P204 / V1-91 (`FU-STORE-ADD-IDEMPOTENT`) R1 correctness regression tests:
 *   - [R1-COR-01]: `createService` uses deterministic `orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]`
 *     when looking up an existing live listing so legacy duplicates with identical timestamps tie-break deterministically.
 *   - [R1-COR-02]: `restoreService` selects `source_product_id, deleted_at`, succeeds on trashed rows
 *     (both standalone and non-conflicting product-backed), and throws `NotFoundException` (404)
 *     on nonexistent, foreign-business, and already-live (`deleted_at === null`) rows without
 *     calling `service.update` or emitting `catalog.service.updated`.
 */
describe('CatalogService — P204 R1 correctness regressions [R1-COR-01/02]', () => {
  function makeHarness(overrides?: {
    queryRawResult?: Array<{ source_product_id: string | null; deleted_at: Date | null }>;
    productFindFirst?: unknown;
    serviceFindFirst?: unknown;
    serviceCreate?: unknown;
    serviceUpdate?: unknown;
  }) {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      $queryRaw: vi.fn().mockResolvedValue(overrides?.queryRawResult ?? []),
      product: {
        findFirst: vi.fn().mockResolvedValue(overrides?.productFindFirst ?? { id: 'prod_1' }),
      },
      service: {
        findFirst: vi.fn().mockResolvedValue(overrides?.serviceFindFirst ?? null),
        create: vi.fn().mockResolvedValue(
          overrides?.serviceCreate ?? { id: 'svc_created', businessId: 'biz_1', sourceProductId: 'prod_1' },
        ),
        update: vi.fn().mockResolvedValue(
          overrides?.serviceUpdate ?? { id: 'svc_restored', businessId: 'biz_1', deletedAt: null },
        ),
      },
    };

    const prismaMock = {
      client: {
        ...tx,
        $transaction: vi.fn(async (cb: (innerTx: typeof tx) => Promise<unknown>) => cb(tx)),
      },
    } as unknown as PrismaService;

    const eventsMock = { emit: vi.fn() };
    const catalog = new CatalogService(prismaMock, eventsMock as any);

    return { catalog, tx, prismaMock, eventsMock };
  }

  it('[R1-COR-01] createService queries existingListing with deterministic orderBy [{ createdAt: "asc" }, { id: "asc" }]', async () => {
    const existing = {
      id: 'svc_a',
      businessId: 'biz_1',
      name: 'Lamp',
      duration: 30,
      price: 100,
      sourceProductId: 'prod_1',
      deletedAt: null,
    };
    const { catalog, tx, eventsMock } = makeHarness({
      productFindFirst: { id: 'prod_1' },
      serviceFindFirst: existing,
    });

    const result = await catalog.createService({
      businessId: 'biz_1',
      name: 'Lamp',
      duration: 30,
      price: 100,
      sourceProductId: 'prod_1',
    });

    expect(result).toBe(existing);
    expect(tx.service.findFirst).toHaveBeenCalledWith({
      where: {
        businessId: 'biz_1',
        sourceProductId: 'prod_1',
        deletedAt: null,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(tx.service.create).not.toHaveBeenCalled();
    expect(eventsMock.emit).not.toHaveBeenCalled();
  });

  it('[R1-COR-02] restoreService succeeds on a trashed standalone service (source_product_id = null) and emits catalog.service.updated', async () => {
    const restoredRow = { id: 'svc_1', businessId: 'biz_1', sourceProductId: null, deletedAt: null };
    const { catalog, tx, eventsMock } = makeHarness({
      queryRawResult: [{ source_product_id: null, deleted_at: new Date('2026-01-01T00:00:00Z') }],
      serviceUpdate: restoredRow,
    });

    const result = await catalog.restoreService('biz_1', 'svc_1');

    expect(result).toBe(restoredRow);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.service.update).toHaveBeenCalledWith({
      where: { id: 'svc_1', businessId: 'biz_1' },
      data: { deletedAt: null },
    });
    expect(eventsMock.emit).toHaveBeenCalledTimes(1);
    expect(eventsMock.emit).toHaveBeenCalledWith('catalog.service.updated', {
      service: restoredRow,
      businessId: 'biz_1',
    });
  });

  it('[R1-COR-02] restoreService succeeds on a trashed product-backed service when no live conflict exists', async () => {
    const restoredRow = { id: 'svc_2', businessId: 'biz_1', sourceProductId: 'prod_1', deletedAt: null };
    const { catalog, tx, eventsMock } = makeHarness({
      queryRawResult: [{ source_product_id: 'prod_1', deleted_at: new Date('2026-01-01T00:00:00Z') }],
      productFindFirst: { id: 'prod_1' },
      serviceFindFirst: null,
      serviceUpdate: restoredRow,
    });

    const result = await catalog.restoreService('biz_1', 'svc_2');

    expect(result).toBe(restoredRow);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.product.findFirst).toHaveBeenCalledWith({
      where: { id: 'prod_1', businessId: 'biz_1', deletedAt: null },
      select: { id: true },
    });
    expect(tx.service.findFirst).toHaveBeenCalledWith({
      where: {
        businessId: 'biz_1',
        sourceProductId: 'prod_1',
        deletedAt: null,
        id: { not: 'svc_2' },
      },
      select: { id: true },
    });
    expect(tx.service.update).toHaveBeenCalledWith({
      where: { id: 'svc_2', businessId: 'biz_1' },
      data: { deletedAt: null },
    });
    expect(eventsMock.emit).toHaveBeenCalledTimes(1);
  });

  it('[R1-COR-02] restoreService throws ConflictException (409) on trashed product-backed service when another live listing exists', async () => {
    const { catalog, tx, eventsMock } = makeHarness({
      queryRawResult: [{ source_product_id: 'prod_1', deleted_at: new Date('2026-01-01T00:00:00Z') }],
      productFindFirst: { id: 'prod_1' },
      serviceFindFirst: { id: 'svc_live_other' },
    });

    await expect(catalog.restoreService('biz_1', 'svc_trashed')).rejects.toBeInstanceOf(ConflictException);
    expect(tx.service.update).not.toHaveBeenCalled();
    expect(eventsMock.emit).not.toHaveBeenCalled();
  });

  it('[R1-COR-02] restoreService throws NotFoundException (404) on nonexistent serviceId or foreign businessId without updating or emitting', async () => {
    const { catalog, tx, eventsMock } = makeHarness({
      queryRawResult: [],
    });

    await expect(catalog.restoreService('biz_foreign', 'svc_missing')).rejects.toThrow(NotFoundException);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.service.update).not.toHaveBeenCalled();
    expect(eventsMock.emit).not.toHaveBeenCalled();
  });

  it('[R1-COR-02] restoreService throws NotFoundException (404) on already-live service (deleted_at === null) without updating or emitting', async () => {
    const { catalog, tx, eventsMock } = makeHarness({
      queryRawResult: [{ source_product_id: 'prod_1', deleted_at: null }],
    });

    await expect(catalog.restoreService('biz_1', 'svc_already_live')).rejects.toThrow(NotFoundException);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.service.update).not.toHaveBeenCalled();
    expect(eventsMock.emit).not.toHaveBeenCalled();
  });
});
