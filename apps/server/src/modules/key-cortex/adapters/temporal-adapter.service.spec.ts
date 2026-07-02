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

describe('TemporalAdapterService', () => {
  let service: TemporalAdapterService;
  let memory: TemporalFlowMemoryService;
  let flow: TemporalFlowService;

  beforeEach(() => {
    memory = {
      createMemory: vi.fn(),
      findByEntity: vi.fn(),
      findMany: vi.fn(),
      searchMemory: vi.fn(),
      deleteMemory: vi.fn(),
      updateMemory: vi.fn(),
      getStats: vi.fn(),
    } as unknown as TemporalFlowMemoryService;

    flow = {
      list: vi.fn(),
      calendarRange: vi.fn(),
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
  });

  it('delete_memory deletes and returns status', async () => {
    (memory.deleteMemory as ReturnType<typeof vi.fn>).mockResolvedValue(true);
    const result = await service.execute(mkCmd('delete_memory', { memoryId: 'm1' }));
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ deleted: true, memoryId: 'm1' });
  });

  it('update_memory updates existing memory', async () => {
    (memory.updateMemory as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'm1' });
    const result = await service.execute(mkCmd('update_memory', { memoryId: 'm1', value: { x: 2 }, importance: 'high' }));
    expect(result.success).toBe(true);
    expect(memory.updateMemory).toHaveBeenCalledWith('m1', expect.objectContaining({ confidence: 0.9 }));
  });

  it('tag_memory merges tags', async () => {
    (memory.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'm1', sourceEventIds: ['a'], metadata: {} }]);
    (memory.updateMemory as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'm1' });
    const result = await service.execute(mkCmd('tag_memory', { memoryId: 'm1', tags: ['b'] }));
    expect(result.success).toBe(true);
    expect(memory.updateMemory).toHaveBeenCalledWith('m1', expect.objectContaining({ sourceEventIds: ['a', 'b'] }));
  });

  it('consolidate_memories stores merged summary', async () => {
    (memory.findByEntity as ReturnType<typeof vi.fn>).mockResolvedValue([{ content: 'A' }]);
    (memory.createMemory as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'm2' });
    const result = await service.execute(mkCmd('consolidate_memories', { keys: ['k1'], summaryKey: 'summary' }));
    expect(result.success).toBe(true);
    expect(memory.createMemory).toHaveBeenCalledWith(expect.objectContaining({ entityId: 'summary' }));
  });

  // ── Queries ───────────────────────────────────────────────────────────────

  it('search_memories delegates to searchMemory', async () => {
    (memory.searchMemory as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'm1' }]);
    const result = await service.execute(mkCmd('search_memories', { query: 'hello' }));
    expect(result.success).toBe(true);
    expect(memory.searchMemory).toHaveBeenCalledWith('biz_123', 'hello', 10);
  });

  it('get_timeline uses calendarRange when from/to provided', async () => {
    (flow.calendarRange as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'e1' }]);
    const result = await service.execute(mkCmd('get_timeline', { from: '2026-01-01', to: '2026-01-31' }));
    expect(result.success).toBe(true);
    expect(flow.calendarRange).toHaveBeenCalledWith('biz_123', '2026-01-01', '2026-01-31');
  });

  it('get_memory_stats returns stats', async () => {
    (memory.getStats as ReturnType<typeof vi.fn>).mockResolvedValue({ total: 5, byType: {} });
    const result = await service.execute(mkCmd('get_memory_stats', {}));
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ total: 5, byType: {} });
  });

  it('get_recent_memories returns recent memories', async () => {
    (memory.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'm1' }]);
    const result = await service.execute(mkCmd('get_recent_memories', { limit: 5 }));
    expect(result.success).toBe(true);
    expect(memory.findMany).toHaveBeenCalledWith('biz_123', { limit: 5 });
  });

  it('returns connectorFail for unknown action', async () => {
    const result = await service.execute(mkCmd('nonexistent'));
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown temporal action');
  });
});
