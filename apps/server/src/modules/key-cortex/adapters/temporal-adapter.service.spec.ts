import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TemporalAdapterService } from './temporal-adapter.service';
import { TemporalFlowMemoryService } from '../../temporal-flow/temporal-flow-memory.service';
import { TemporalFlowService } from '../../temporal-flow/temporal-flow.service';
import { ConnectorCommand } from '../key-cortex-connector.types';

const mkCmd = (action: string, parameters: Record<string, unknown> = {}): ConnectorCommand => ({
  module: 'temporal',
  action,
  parameters,
  businessId: 'biz_123',
  userId: 'user_456',
  source: 'key_cortex',
  timestamp: new Date(),
  correlationId: 'corr_001',
});

const READER_FILTER = { NOT: { module: 'payments' } };
const SIGHT = { filter: undefined, who: { reader: 'user_456', sight: () => true } };
const ACTOR = { id: 'user_456' };
const CHECKED_AT = new Date('2026-01-01T00:00:00Z');

describe('TemporalAdapterService', () => {
  let service: TemporalAdapterService;
  let memory: TemporalFlowMemoryService;
  let flow: TemporalFlowService;

  beforeEach(() => {
    memory = {
      createMemory: vi.fn(),
      findByEntity: vi.fn(),
      findMany: vi.fn(),
      findById: vi.fn(),
      searchMemory: vi.fn(),
      deleteMemory: vi.fn(),
      updateMemory: vi.fn(),
      getStats: vi.fn(),
    } as unknown as TemporalFlowMemoryService;

    // MEM-TEMPORAL-MEMORY-ROUTES-SIGHT: a command reads for its actor (TemporalFlowService.memorySight / readerFilter); this
    // stand-in's sight admits every memory, so the delegations below are what the projection hands on.
    flow = {
      list: vi.fn(),
      calendarRange: vi.fn(),
      readerFilter: vi.fn().mockResolvedValue(READER_FILTER),
      memorySight: vi.fn().mockResolvedValue(SIGHT),
      visibleMemories: vi.fn(async (_b: string, rows: unknown[]) => rows),
      visibleMemoryById: vi.fn(async (_b: string, id: string) => ({ id, updatedAt: CHECKED_AT, sourceEventIds: ['a'], metadata: {} })),
      // Delta A1/A2: writes under an actor land only on the row that was checked (its updatedAt unchanged).
      updateMemoryIfUnchanged: vi.fn(async (_b: string, row: { id: string }) => ({ id: row.id })),
      deleteMemoryIfUnchanged: vi.fn().mockResolvedValue(true),
      searchVisibleMemory: vi.fn(),
      listMemory: vi.fn(),
    } as unknown as TemporalFlowService;

    service = new TemporalAdapterService(memory, flow);
  });

  // ── Actions ───────────────────────────────────────────────────────────────

  it('store_memory creates a memory', async () => {
    (memory.createMemory as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'm1' });
    const result = await service.execute(mkCmd('store_memory', { key: 'k1', value: { x: 1 } }));
    expect(result.success).toBe(true);
    expect(memory.createMemory).toHaveBeenCalledWith(expect.objectContaining({ businessId: 'biz_123', entityType: 'business', entityId: 'k1' }));
  });

  it('recall_memory returns first memory', async () => {
    (memory.findByEntity as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'm1', content: 'hello' }]);
    const result = await service.execute(mkCmd('recall_memory', { key: 'k1' }));
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ id: 'm1', content: 'hello' });
    expect(flow.memorySight).toHaveBeenCalledWith('biz_123', ACTOR);
  });

  it('delete_memory deletes the row the actor\'s sight admitted, only while unchanged (delta A2), and returns status', async () => {
    const result = await service.execute(mkCmd('delete_memory', { memoryId: 'm1' }));
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ deleted: true, memoryId: 'm1' });
    expect(flow.deleteMemoryIfUnchanged).toHaveBeenCalledWith('biz_123', expect.objectContaining({ id: 'm1', updatedAt: CHECKED_AT }));
    expect(memory.deleteMemory).not.toHaveBeenCalled();
  });

  it('update_memory updates the row the actor\'s sight admitted, only while unchanged (delta A1)', async () => {
    const result = await service.execute(mkCmd('update_memory', { memoryId: 'm1', value: { x: 2 }, importance: 'high' }));
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ id: 'm1' });
    expect(flow.updateMemoryIfUnchanged).toHaveBeenCalledWith(
      'biz_123',
      expect.objectContaining({ id: 'm1', updatedAt: CHECKED_AT }),
      expect.objectContaining({ confidence: 0.9, content: JSON.stringify({ x: 2 }) }),
    );
    expect(memory.updateMemory).not.toHaveBeenCalled();
  });

  it('tag_memory merges tags onto the row the actor\'s sight admitted, only while unchanged (delta A1)', async () => {
    const result = await service.execute(mkCmd('tag_memory', { memoryId: 'm1', tags: ['b'] }));
    expect(result.success).toBe(true);
    expect(flow.visibleMemoryById).toHaveBeenCalledWith('biz_123', 'm1', SIGHT);
    expect(flow.updateMemoryIfUnchanged).toHaveBeenCalledWith(
      'biz_123',
      expect.objectContaining({ id: 'm1', updatedAt: CHECKED_AT }),
      expect.objectContaining({ sourceEventIds: ['a', 'b'] }),
    );
    expect(memory.updateMemory).not.toHaveBeenCalled();
  });

  it('delta A1: a conditional write that matched nothing (the row changed since the check) answers as a missing memory', async () => {
    (flow.updateMemoryIfUnchanged as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    // As for a missing memory: the adapter raises NotFoundException('Memory not found') (the connector answers it).
    await expect(service.execute(mkCmd('tag_memory', { memoryId: 'm1', tags: ['b'] }))).rejects.toThrow('Memory not found');
    await expect(service.execute(mkCmd('update_memory', { memoryId: 'm1', importance: 'high' }))).rejects.toThrow('Memory not found');
    (flow.visibleMemoryById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    await expect(service.execute(mkCmd('tag_memory', { memoryId: 'missing', tags: ['b'] }))).rejects.toThrow('Memory not found');
  });

  it('consolidate_memories stores merged summary', async () => {
    (memory.findByEntity as ReturnType<typeof vi.fn>).mockResolvedValue([{ content: 'A' }]);
    (memory.createMemory as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'm2' });
    const result = await service.execute(mkCmd('consolidate_memories', { keys: ['k1'], summaryKey: 'summary' }));
    expect(result.success).toBe(true);
    expect(memory.createMemory).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'summary' }));
  });

  // ── Queries ───────────────────────────────────────────────────────────────

  it('search_memories delegates to the actor\'s projected search (MEM-TEMPORAL-MEMORY-ROUTES-SIGHT)', async () => {
    (flow.searchVisibleMemory as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'm1' }]);
    const result = await service.execute(mkCmd('search_memories', { query: 'hello' }));
    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ id: 'm1' }]);
    expect(flow.memorySight).toHaveBeenCalledWith('biz_123', ACTOR);
    expect(flow.searchVisibleMemory).toHaveBeenCalledWith('biz_123', 'hello', 10, SIGHT);
    expect(memory.searchMemory).not.toHaveBeenCalled();
  });

  it('get_timeline uses calendarRange when from/to provided', async () => {
    (flow.calendarRange as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'e1' }]);
    const result = await service.execute(mkCmd('get_timeline', { from: '2026-01-01', to: '2026-01-31' }));
    expect(result.success).toBe(true);
    // D-238 (round-3 security M4): the timeline is read for the command's actor, so a financial KEY proposal's events are
    // withheld from an actor without revenue read.
    // MEM-TEMPORAL-MEMORY-ROUTES-SIGHT: and only the events of the modules the actor may read (readerFilter).
    expect(flow.readerFilter).toHaveBeenCalledWith('biz_123', ACTOR);
    expect(flow.calendarRange).toHaveBeenCalledWith('biz_123', '2026-01-01', '2026-01-31', { id: 'user_456' }, READER_FILTER);
  });

  it('RED-BEFORE (D-238): get_timeline without a range lists the timeline for the command actor', async () => {
    (flow.list as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'e1' }]);
    const result = await service.execute(mkCmd('get_timeline', {}));
    expect(result.success).toBe(true);
    expect(flow.list).toHaveBeenCalledWith('biz_123', expect.anything(), { id: 'user_456' }, READER_FILTER);
  });

  it('get_memory_stats returns stats', async () => {
    (memory.getStats as ReturnType<typeof vi.fn>).mockResolvedValue({ total: 5, byType: {} });
    const result = await service.execute(mkCmd('get_memory_stats', {}));
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ total: 5, byType: {} });
  });

  it('get_recent_memories returns recent memories', async () => {
    (flow.listMemory as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'm1' }]);
    const result = await service.execute(mkCmd('get_recent_memories', { limit: 5 }));
    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ id: 'm1' }]);
    // MEM-TEMPORAL-MEMORY-ROUTES-SIGHT: the actor's memories only (KEY's context assembly, with no actor, still reads
    // findMany: getRecentMemories called with no actor key).
    expect(flow.listMemory).toHaveBeenCalledWith('biz_123', { limit: 5 }, SIGHT);
    expect(memory.findMany).not.toHaveBeenCalled();
  });

  it('returns connectorFail for unknown action', async () => {
    const result = await service.execute(mkCmd('nonexistent'));
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown temporal action');
  });
});
