/**
 * MEM-TEMPORAL-MEMORY-ROUTES-SIGHT (delta A1/A2, orchestrator follow-up): KEY's conditional write and delete land only on
 * the row the actor's sight admitted: same business, same id, same updatedAt AND the same content. The content term
 * closes a rewrite stamped in the same millisecond as the checked write (@updatedAt is the app clock's).
 */
import { describe, it, expect, vi } from 'vitest';
import { TemporalFlowService } from './temporal-flow.service';

const CHECKED = { id: 'm1', updatedAt: new Date('2026-01-01T00:00:00.000Z'), content: 'thread:summary — opening hours' };

function make() {
  const update = vi.fn().mockResolvedValue({ id: 'm1' });
  const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
  const prisma = { client: { temporalFlowMemory: { update, deleteMany } } } as any;
  return { service: new TemporalFlowService(prisma), update, deleteMany };
}

describe('TemporalFlowService: the conditional write and delete name the checked row whole', () => {
  it('updateMemoryIfUnchanged: where carries the business, id, updatedAt and content of the checked row', async () => {
    const { service, update } = make();
    await service.updateMemoryIfUnchanged('biz_1', CHECKED, { confidence: 0.9 });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'm1', businessId: 'biz_1', updatedAt: CHECKED.updatedAt, content: CHECKED.content } }),
    );
  });

  it('deleteMemoryIfUnchanged: where carries the business, id, updatedAt and content of the checked row', async () => {
    const { service, deleteMany } = make();
    expect(await service.deleteMemoryIfUnchanged('biz_1', CHECKED)).toBe(true);
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: 'm1', businessId: 'biz_1', updatedAt: CHECKED.updatedAt, content: CHECKED.content } });
  });

  it('a write or delete that matches nothing answers null / false', async () => {
    const { service, update, deleteMany } = make();
    update.mockRejectedValueOnce(Object.assign(new Error('no row'), { code: 'P2025' }));
    deleteMany.mockResolvedValueOnce({ count: 0 });
    expect(await service.updateMemoryIfUnchanged('biz_1', CHECKED, { confidence: 0.9 })).toBeNull();
    expect(await service.deleteMemoryIfUnchanged('biz_1', CHECKED)).toBe(false);
  });
});
