import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyCortexSafeDatabaseService } from '../key-cortex-safe-database.service';
import { KeyCortexEventBusService } from '../key-cortex-event-bus.service';

function makeService() {
  const rows: Record<string, any[]> = {
    Contact: [
      { id: 'c1', businessId: 'biz_1', firstName: 'Alice', status: 'active' },
      { id: 'c2', businessId: 'biz_2', firstName: 'Bob', status: 'active' },
    ],
  };

  const mockPrisma = {
    client: {
      contact: {
        findMany: vi.fn(async (args: any) => {
          const businessId = args.where?.businessId;
          return rows.Contact.filter((r) => r.businessId === businessId);
        }),
        findFirst: vi.fn(async (args: any) => {
          const businessId = args.where?.businessId;
          const id = args.where?.id;
          return rows.Contact.find((r) => r.businessId === businessId && r.id === id) ?? null;
        }),
        update: vi.fn(async (args: any) => {
          const existing = rows.Contact.find((r) => r.id === args.where.id);
          if (!existing) return null;
          Object.assign(existing, args.data);
          return existing;
        }),
      },
    },
  } as any;

  const emitted: any[] = [];
  const mockEventBus = {
    emit: vi.fn((e: any) => emitted.push(e)),
  } as any;

  const service = new KeyCortexSafeDatabaseService(mockPrisma, mockEventBus);
  return { service, mockPrisma, emitted, rows };
}

describe('KeyCortexSafeDatabaseService', () => {
  let setup: ReturnType<typeof makeService>;

  beforeEach(() => {
    setup = makeService();
  });

  it('queries an allow-listed model scoped to the business', async () => {
    const { service } = setup;
    const result = await service.safeQuery(
      { businessId: 'biz_1', autonomyLevel: 2 },
      { model: 'Contact' },
    );

    expect(result.success).toBe(true);
    expect((result.data as any).count).toBe(1);
    expect((result.data as any).rows[0].firstName).toBe('Alice');
  });

  it('rejects queries against non-allow-listed models', async () => {
    const { service } = setup;
    const result = await service.safeQuery(
      { businessId: 'biz_1', autonomyLevel: 2 },
      { model: 'BusinessSecret' },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('not queryable');
  });

  it('caps take at MAX_QUERY_LIMIT', async () => {
    const { service, mockPrisma } = setup;
    await service.safeQuery(
      { businessId: 'biz_1', autonomyLevel: 2 },
      { model: 'Contact', take: 500 },
    );

    const callArgs = mockPrisma.client.contact.findMany.mock.calls[0][0];
    expect(callArgs.take).toBe(100);
  });

  it('updates a record with an allowed field', async () => {
    const { service, rows } = setup;
    const result = await service.safeUpdate(
      { businessId: 'biz_1', autonomyLevel: 2 },
      { model: 'Contact', id: 'c1', data: { firstName: 'Alicia' } },
    );

    expect(result.success).toBe(true);
    expect((result.data as any).updated.firstName).toBe('Alicia');
    expect(rows.Contact[0].firstName).toBe('Alicia');
  });

  it('rejects updates to prohibited fields', async () => {
    const { service } = setup;
    const result = await service.safeUpdate(
      { businessId: 'biz_1', autonomyLevel: 2 },
      { model: 'Contact', id: 'c1', data: { businessId: 'biz_3' } },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('cannot be updated');
  });

  it('rejects updates to fields not allowed for the model', async () => {
    const { service } = setup;
    const result = await service.safeUpdate(
      { businessId: 'biz_1', autonomyLevel: 2 },
      { model: 'Contact', id: 'c1', data: { unknownField: 'x' } },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('not allowed');
  });

  it('registers canonical tool definitions', () => {
    const { service } = setup;
    const queryTool = service.getQueryToolDefinition();
    expect(queryTool.name).toBe('cortex.query_database');
    expect(queryTool.riskTier).toBe(2);

    const updateTool = service.getUpdateToolDefinition();
    expect(updateTool.name).toBe('cortex.update_record');
    expect(updateTool.riskTier).toBe(3);
    expect(updateTool.requiresApproval).toBe(true);
  });
});
