/**
 * MEM-TEMPORAL-SCOPE (review round 2 repairs): TemporalFlowMemoryService's by-id writes carry the tenant
 * predicate in the query itself, refuse an absent business or id before any query, and map only Prisma's
 * P2025 (no row matched) to the not-found refusal. The real-database proof is
 * test/temporal-memory-scope.integration.test.ts; these cases pin the query shapes and the error mapping.
 */
import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TemporalFlowMemoryService } from './temporal-flow-memory.service';

function makeService() {
  const tfm = {
    findFirst: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const prisma = { client: { temporalFlowMemory: tfm } } as any;
  const semanticMemory = { store: vi.fn().mockResolvedValue(null) } as any;
  return { service: new TemporalFlowMemoryService(prisma, semanticMemory), tfm };
}

describe('MEM-TEMPORAL-SCOPE: TemporalFlowMemoryService by-id writes', () => {
  it('updateMemory maps P2025 to NotFoundException("Memory not found")', async () => {
    const { service, tfm } = makeService();
    tfm.update.mockRejectedValue(Object.assign(new Error('No record was found for an update.'), { code: 'P2025' }));
    const err = await service.updateMemory('biz', 'm1', { content: 'x' }).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect(err.message).toBe('Memory not found');
    expect(tfm.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'm1', businessId: 'biz' } }));
  });

  it('updateMemory rethrows any other error unchanged', async () => {
    const { service, tfm } = makeService();
    const boom = Object.assign(new Error('connection lost'), { code: 'P1001' });
    tfm.update.mockRejectedValue(boom);
    await expect(service.updateMemory('biz', 'm1', { content: 'x' })).rejects.toBe(boom);
  });

  it.each([undefined, '', 42, null])('an absent business (%s) is refused before any query', async (businessId) => {
    const { service, tfm } = makeService();
    expect(await service.findById(businessId as any, 'm1')).toBeNull();
    expect(await service.deleteMemory(businessId as any, 'm1')).toBe(false);
    await expect(service.updateMemory(businessId as any, 'm1', { content: 'x' })).rejects.toThrow('Memory not found');
    expect(tfm.findFirst).not.toHaveBeenCalled();
    expect(tfm.deleteMany).not.toHaveBeenCalled();
    expect(tfm.update).not.toHaveBeenCalled();
  });

  it('createMemory rewrites an existing memory with the business in the update where', async () => {
    const { service, tfm } = makeService();
    tfm.findFirst.mockResolvedValue({ id: 'm1', businessId: 'biz' });
    tfm.update.mockResolvedValue({ id: 'm1', businessId: 'biz', confidence: 0.5 });
    await service.createMemory({
      businessId: 'biz', entityType: 'business', entityId: 'k', type: 'insight', content: 'c', sourceModule: 'x',
    } as any);
    expect(tfm.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'm1', businessId: 'biz' } }));
  });

  it.each([undefined, '', 42, null, { not: 'x' }, { in: ['m1'] }, ['m1']])(
    'a memory id that is not a non-empty string (%o) is refused before any query',
    async (memoryId) => {
      const { service, tfm } = makeService();
      expect(await service.findById('biz', memoryId as any)).toBeNull();
      expect(await service.deleteMemory('biz', memoryId as any)).toBe(false);
      await expect(service.updateMemory('biz', memoryId as any, { content: 'x' })).rejects.toThrow('Memory not found');
      expect(tfm.findFirst).not.toHaveBeenCalled();
      expect(tfm.deleteMany).not.toHaveBeenCalled();
      expect(tfm.update).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, '', null])('createMemory with no business (%s) writes nothing', async (businessId) => {
    const { service, tfm } = makeService();
    await expect(
      service.createMemory({
        businessId, entityType: 'business', entityId: 'k', type: 'insight', content: 'c', sourceModule: 'x',
      } as any),
    ).rejects.toThrow();
    expect(tfm.findFirst).not.toHaveBeenCalled();
    expect(tfm.update).not.toHaveBeenCalled();
    expect(tfm.create).not.toHaveBeenCalled();
  });

  it('findById reads with the id and the business in its own where', async () => {
    const { service, tfm } = makeService();
    tfm.findFirst.mockResolvedValue(null);
    await service.findById('biz', 'm1');
    expect(tfm.findFirst).toHaveBeenCalledWith({ where: { id: 'm1', businessId: 'biz' } });
  });

  it('deleteMemory deletes with the id and the business in its own where', async () => {
    const { service, tfm } = makeService();
    expect(await service.deleteMemory('biz', 'm1')).toBe(true);
    expect(tfm.deleteMany).toHaveBeenCalledWith({ where: { id: 'm1', businessId: 'biz' } });
    tfm.deleteMany.mockResolvedValue({ count: 0 });
    expect(await service.deleteMemory('biz', 'm2')).toBe(false);
  });

  it('createMemory refuses an absent business with BadRequestException', async () => {
    const { service } = makeService();
    const err = await service
      .createMemory({ businessId: undefined, entityType: 'business', entityId: 'k', type: 'insight', content: 'c', sourceModule: 'x' } as any)
      .catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
  });

  it.each([{ not: 'x' }, { in: ['k'] }, ['k'], 42, ''])('createMemory refuses an entity id %o before any query', async (entityId) => {
    const { service, tfm } = makeService();
    const err = await service
      .createMemory({ businessId: 'biz', entityType: 'business', entityId, type: 'insight', content: 'c', sourceModule: 'x' } as any)
      .catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(tfm.findFirst).not.toHaveBeenCalled();
    expect(tfm.update).not.toHaveBeenCalled();
    expect(tfm.create).not.toHaveBeenCalled();
  });

  it('createMemory still accepts an absent entity id (a business-level memory)', async () => {
    const { service, tfm } = makeService();
    tfm.findFirst.mockResolvedValue(null);
    tfm.create.mockResolvedValue({ id: 'm9', businessId: 'biz', confidence: 0.5 });
    await service.createMemory({ businessId: 'biz', entityType: 'business', type: 'insight', content: 'c', sourceModule: 'x' } as any);
    expect(tfm.findFirst).toHaveBeenCalledWith({ where: expect.objectContaining({ businessId: 'biz', entityId: null }) });
  });

  it.each([{ not: 'x' }, ['k'], 42])('findByEntity with an entity id %o reads nothing', async (entityId) => {
    const { service } = makeService();
    const tfm = (service as any).prisma.client.temporalFlowMemory;
    tfm.findMany = vi.fn().mockResolvedValue([{ id: 'other' }]);
    expect(await service.findByEntity('biz', 'business', entityId as any)).toEqual([]);
    expect(tfm.findMany).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 42])('findByEntity and findMany with an absent business (%s) read nothing', async (businessId) => {
    const { service } = makeService();
    const tfm = (service as any).prisma.client.temporalFlowMemory;
    tfm.findMany = vi.fn().mockResolvedValue([{ id: 'other' }]);
    expect(await service.findByEntity(businessId as any, 'business', 'k')).toEqual([]);
    expect(await service.findMany(businessId as any, {})).toEqual([]);
    expect(tfm.findMany).not.toHaveBeenCalled();
  });

  it.each([{ not: 'x' }, ['k'], 42])('findMany with an entity id %o reads nothing', async (entityId) => {
    const { service } = makeService();
    const tfm = (service as any).prisma.client.temporalFlowMemory;
    tfm.findMany = vi.fn().mockResolvedValue([{ id: 'other' }]);
    expect(await service.findMany('biz', { entityId } as any)).toEqual([]);
    expect(tfm.findMany).not.toHaveBeenCalled();
  });
});
