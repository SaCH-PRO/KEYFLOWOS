/**
 * MEM-TEMPORAL-SCOPE (review round 2 repairs): TemporalFlowMemoryService's by-id writes carry the tenant
 * predicate in the query itself, refuse an absent business or id before any query, and map only Prisma's
 * P2025 (no row matched) to the not-found refusal. The real-database proof is
 * test/temporal-memory-scope.integration.test.ts; these cases pin the query shapes and the error mapping.
 */
import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
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
});
