/**
 * MEM-TEMPORAL-MEMORY-ROUTES-SIGHT (review round 1): a TemporalAdapterService method called with no `actor` key (KEY's
 * context assembly, which applies its own reader) reads as before; one called with an actor of null (a command naming
 * no user) reads through the null actor's sight, never the unprojected store.
 */
import { describe, it, expect, vi } from 'vitest';
import { TemporalAdapterService } from './temporal-adapter.service';

function make() {
  const memory = { findMany: vi.fn().mockResolvedValue([{ id: 'raw' }]), searchMemory: vi.fn().mockResolvedValue([{ id: 'raw' }]) } as any;
  const sight = { filter: undefined, who: { reader: null, sight: () => false } };
  const flow = {
    memorySight: vi.fn().mockResolvedValue(sight),
    listMemory: vi.fn().mockResolvedValue([]),
    searchVisibleMemory: vi.fn().mockResolvedValue([]),
  } as any;
  return { service: new TemporalAdapterService(memory, flow), memory, flow, sight };
}

describe('TemporalAdapterService: the actor decides the read', () => {
  it('no actor key (context assembly): getRecentMemories and searchMemories read the store as before', async () => {
    const { service, memory, flow } = make();
    expect(await service.getRecentMemories({ businessId: 'b', limit: 3 })).toEqual([{ id: 'raw' }]);
    expect(await service.searchMemories({ businessId: 'b', query: 'q', limit: 3 })).toEqual([{ id: 'raw' }]);
    expect(memory.findMany).toHaveBeenCalledWith('b', { limit: 3 });
    expect(memory.searchMemory).toHaveBeenCalledWith('b', 'q', 3);
    expect(flow.memorySight).not.toHaveBeenCalled();
  });

  it('a command with no user (actor null): the null actor\'s sight, never the raw store', async () => {
    const { service, memory, flow, sight } = make();
    const res = await service.execute({ module: 'temporal', action: 'get_recent_memories', parameters: { limit: 3 }, businessId: 'b', source: 'key_cortex', timestamp: new Date(), correlationId: 'c' } as any);
    expect(res.success).toBe(true);
    expect(res.data).toEqual([]);
    const found = await service.execute({ module: 'temporal', action: 'search_memories', parameters: { query: 'q' }, businessId: 'b', source: 'key_cortex', timestamp: new Date(), correlationId: 'c' } as any);
    expect(found.data).toEqual([]);
    expect(flow.memorySight).toHaveBeenCalledWith('b', null);
    expect(flow.listMemory).toHaveBeenCalledWith('b', { limit: 3 }, sight);
    expect(memory.findMany).not.toHaveBeenCalled();
    expect(memory.searchMemory).not.toHaveBeenCalled();
  });

  it('delta (b): delete_memory answers { deleted: false } when the guarded delete matches nothing (the row changed since the check)', async () => {
    const { service, memory, flow } = make();
    flow.visibleMemoryById = vi.fn().mockResolvedValue({ id: 'm1', updatedAt: new Date(), content: 'c' });
    flow.deleteMemoryIfUnchanged = vi.fn().mockResolvedValue(false);
    memory.deleteMemory = vi.fn();
    const res = await service.execute({ module: 'temporal', action: 'delete_memory', parameters: { memoryId: 'm1' }, businessId: 'b', userId: 'u', source: 'key_cortex', timestamp: new Date(), correlationId: 'c' } as any);
    expect(res.data).toEqual({ deleted: false, memoryId: 'm1' });
    expect(memory.deleteMemory).not.toHaveBeenCalled();
  });

  it('delta (b): with no actor key, update, tag and delete keep their old behaviour (the memory service, no sight, no conditional write)', async () => {
    const { service, memory, flow } = make();
    memory.updateMemory = vi.fn().mockResolvedValue({ id: 'm1' });
    memory.deleteMemory = vi.fn().mockResolvedValue(true);
    memory.findById = vi.fn().mockResolvedValue({ id: 'm1', sourceEventIds: ['a'], metadata: { k: 1 } });
    flow.updateMemoryIfUnchanged = vi.fn();
    flow.deleteMemoryIfUnchanged = vi.fn();
    expect(await service.updateMemory({ businessId: 'b', memoryId: 'm1', importance: 'high' })).toEqual({ id: 'm1' });
    expect(memory.updateMemory).toHaveBeenCalledWith('b', 'm1', { content: undefined, confidence: 0.9 });
    expect(await service.tagMemory({ businessId: 'b', memoryId: 'm1', tags: ['b'] })).toEqual({ id: 'm1' });
    expect(memory.findById).toHaveBeenCalledWith('b', 'm1');
    expect(memory.updateMemory).toHaveBeenCalledWith('b', 'm1', { sourceEventIds: ['a', 'b'], metadata: { k: 1, tags: ['a', 'b'] } });
    expect(await service.deleteMemory({ businessId: 'b', memoryId: 'm1' })).toEqual({ deleted: true, memoryId: 'm1' });
    expect(memory.deleteMemory).toHaveBeenCalledWith('b', 'm1');
    expect(flow.memorySight).not.toHaveBeenCalled();
    expect(flow.updateMemoryIfUnchanged).not.toHaveBeenCalled();
    expect(flow.deleteMemoryIfUnchanged).not.toHaveBeenCalled();
  });
});
