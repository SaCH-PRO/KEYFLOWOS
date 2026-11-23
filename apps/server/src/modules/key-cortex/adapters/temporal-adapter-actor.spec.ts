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
});
