/**
 * MEM-CLASS-COLUMNS (P125, D-257) — R1 review regression tests:
 *   - [R1-SEC-01] upsertAiMemoryDroppingStaleCopies monotonic restrictiveness & partial update preservation
 *   - [R1-SEC-02] TemporalFlowMemoryService createMemory (update path) & updateMemory monotonic restrictiveness
 *   - [R1-COR-01] classifyTemporalMemoryWrite fail-closed on unresolved non-opaque sourceEventIds
 *   - [R1-COR-02] TemporalFlowService.updateMemoryIfUnchanged moduleScope normalization
 *   - [R1-SEC-03] classifyEmbeddingWrite always derives metadata provenance even when caller passes weaker class
 *   - [R1-COR-04] classifyTemporalMemoryWrite detects EXPENSE_WORDS in entityId
 */
import { describe, it, expect, vi } from 'vitest';
import {
  classifyEmbeddingWrite,
  classifyTemporalMemoryWrite,
} from './memory-classification';
import { upsertAiMemoryDroppingStaleCopies } from './ai-memory.service';
import { TemporalFlowMemoryService } from '../temporal-flow/temporal-flow-memory.service';
import { TemporalFlowService } from '../temporal-flow/temporal-flow.service';

describe('MEM-CLASS-COLUMNS R1 regressions', () => {
  it('[R1-COR-01] classifyTemporalMemoryWrite fails closed to UNCLASSIFIED on unresolved non-opaque sourceEventIds', () => {
    const result = classifyTemporalMemoryWrite({
      entityType: 'thread',
      entityId: 'thread_1',
      type: 'summary',
      sourceModule: 'key_inbox',
      content: 'Thread activity: 2 events',
      sourceEventIds: ['ev_1', 'ev_2'],
      sourceEvents: [],
    });
    expect(result.dataClass).toBe('UNCLASSIFIED');
    expect(result.moduleScope).toEqual(['operations']);
  });

  it('[R1-COR-04] classifyTemporalMemoryWrite catches EXPENSE_WORDS in entityId', () => {
    const result = classifyTemporalMemoryWrite({
      entityType: 'business',
      entityId: 'rent_policy',
      type: 'insight',
      sourceModule: 'key_cortex',
      content: '{"note":"review every quarter"}',
    });
    expect(result.dataClass).toBe('REVENUE');
    expect(result.moduleScope).toContain('expenses');
  });

  it('[R1-SEC-03] classifyEmbeddingWrite derives REVENUE/SECRET_BEARING from metadata even when caller passes GENERAL', () => {
    const docCopy = classifyEmbeddingWrite({
      sourceType: 'memory',
      content: 'Vendor Acme Corp',
      metadata: { category: 'document_extraction', key: 'doc_1' },
      sourceDataClass: null,
      explicitDataClass: 'GENERAL',
    });
    expect(docCopy.dataClass).toBe('REVENUE');
    expect(docCopy.moduleScope).toContain('revenue');

    const secretCopy = classifyEmbeddingWrite({
      sourceType: 'memory',
      content: '{"byokOpenai":"enc:..."}',
      metadata: { category: 'settings', key: 'ai_preferences' },
      sourceDataClass: null,
      explicitDataClass: 'GENERAL',
    });
    expect(secretCopy.dataClass).toBe('SECRET_BEARING');
    expect(secretCopy.moduleScope).toEqual(['ai', 'settings']);
  });

  it('[R1-SEC-01] upsertAiMemoryDroppingStaleCopies preserves existing REVENUE/scope on partial metadata update and lower-class rewrite, and never lets updateClass shadow stricter createClass', async () => {
    const upsertMock = vi.fn(async (args: any) => ({
      id: 'mem_1',
      businessId: 'biz_1',
      category: args.create.category,
      key: args.create.key,
      value: args.update.value ?? args.create.value,
      dataClass: args.update.dataClass,
      moduleScope: args.update.moduleScope,
      confidence: 1,
      source: 'user',
      expiresAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    const findUniqueMock = vi.fn().mockResolvedValue({
      value: 'Overdue invoice $4,500',
      dataClass: 'REVENUE',
      moduleScope: ['revenue'],
    });
    const tx = {
      aiMemory: {
        findUnique: findUniqueMock,
        upsert: upsertMock,
      },
      $queryRaw: vi.fn().mockResolvedValue([]),
    };
    const prisma = {
      client: {
        $transaction: vi.fn(async (fn: any) => fn(tx)),
      },
    } as any;

    // 1. Partial metadata-only update (omits update.value, e.g. expiresAt refresh)
    await upsertAiMemoryDroppingStaleCopies(
      prisma,
      'biz_1',
      { category: 'suggestion_block', key: 'general_notice' },
      {
        create: { value: 'blocked', source: 'user', expiresAt: new Date() },
        update: { expiresAt: new Date() },
      },
      undefined,
    );
    expect(upsertMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          dataClass: 'REVENUE',
          moduleScope: ['revenue'],
        }),
      }),
    );

    // 2. Lower-class in-place rewrite cannot downgrade existing REVENUE row or drop module_scope
    await upsertAiMemoryDroppingStaleCopies(
      prisma,
      'biz_1',
      { category: 'business_fact', key: 'note_1' },
      {
        create: { value: 'plain text', source: 'user', dataClass: 'GENERAL', moduleScope: [] },
        update: { value: 'plain text', source: 'user', dataClass: 'GENERAL', moduleScope: [] },
      },
      undefined,
    );
    expect(upsertMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          dataClass: 'REVENUE',
          moduleScope: ['revenue'],
        }),
      }),
    );

    // 3. Stricter createClass is never shadowed by a weaker updateClass
    findUniqueMock.mockResolvedValueOnce(null);
    await upsertAiMemoryDroppingStaleCopies(
      prisma,
      'biz_1',
      { category: 'business_fact', key: 'secret_row' },
      {
        create: { value: 'x', source: 'user', dataClass: 'SECRET_BEARING', moduleScope: ['settings'] },
        update: { value: 'x', source: 'user', dataClass: 'GENERAL', moduleScope: [] },
      },
      undefined,
    );
    expect(upsertMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          dataClass: 'SECRET_BEARING',
          moduleScope: ['settings'],
        }),
        update: expect.objectContaining({
          dataClass: 'SECRET_BEARING',
          moduleScope: ['settings'],
        }),
      }),
    );
  });

  it('[R1-SEC-02] TemporalFlowMemoryService createMemory (update path) & updateMemory preserve monotonic restrictiveness and upgrade on new financial content', async () => {
    const existingRow = {
      id: 'tfm_1',
      businessId: 'biz_1',
      entityType: 'thread',
      entityId: 'thread_1',
      type: 'summary',
      content: 'Old summary',
      sourceEventIds: [],
      sourceModule: 'key_inbox',
      metadata: {},
      confidence: 0.85,
      dataClass: 'REVENUE',
      moduleScope: ['operations', 'revenue'],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const updateMock = vi.fn(async (args: any) => ({ ...existingRow, ...args.data }));
    const findFirstMock = vi.fn().mockResolvedValue(existingRow);
    const tx = {
      temporalFlowMemory: {
        findFirst: findFirstMock,
        update: updateMock,
        create: vi.fn(),
      },
      temporalFlowEvent: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    const prisma = {
      client: {
        ...tx,
        $transaction: vi.fn(async (fn: any) => fn(tx)),
      },
    } as any;
    const semanticStoreMock = vi.fn().mockResolvedValue('emb_1');
    const service = new TemporalFlowMemoryService(prisma, { store: semanticStoreMock } as any);

    // 1. Re-summarization with only a booking event (older payment rolled out of window) keeps REVENUE + ['bookings', 'operations', 'revenue']
    await service.createMemory({
      businessId: 'biz_1',
      entityType: 'thread',
      entityId: 'thread_1',
      type: 'summary',
      content: 'Thread activity: 1 booking event',
      sourceModule: 'key_inbox',
      sourceEvents: [
        {
          id: 'ev_bk',
          source: 'calendar',
          type: 'booking.confirmed',
          module: 'bookings',
          entityType: 'booking',
          title: 'Booking confirmed',
        },
      ],
      confidence: 0.85,
    });
    expect(updateMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dataClass: 'REVENUE',
          moduleScope: ['bookings', 'operations', 'revenue'],
        }),
      }),
    );
    expect(semanticStoreMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        dataClass: 'REVENUE',
        moduleScope: ['bookings', 'operations', 'revenue'],
      }),
    );

    // 2. Direct updateMemory on a GENERAL row with financial content upgrades to REVENUE
    findFirstMock.mockResolvedValueOnce({
      ...existingRow,
      dataClass: 'GENERAL',
      moduleScope: ['bookings'],
      content: 'Booking confirmed',
    });
    await service.updateMemory('biz_1', 'tfm_1', {
      content: 'Invoice #88 total $950 due tomorrow',
    });
    expect(updateMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dataClass: 'REVENUE',
          moduleScope: ['bookings', 'operations', 'revenue'],
        }),
      }),
    );

    // 3. Direct updateMemory on a REVENUE row with plain text + explicit GENERAL patch never downgrades
    findFirstMock.mockResolvedValueOnce(existingRow);
    await service.updateMemory('biz_1', 'tfm_1', {
      content: 'Customer thanked us',
      dataClass: 'GENERAL',
      moduleScope: ['crm'],
    });
    expect(updateMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dataClass: 'REVENUE',
          moduleScope: ['crm', 'operations', 'revenue'],
        }),
      }),
    );
  });

  it('[R1-COR-02] TemporalFlowService.updateMemoryIfUnchanged normalizes moduleScope aliases and sorts deterministically', async () => {
    const updateMock = vi.fn(async (args: any) => ({ id: 'tfm_1', ...args.data }));
    const prisma = {
      client: {
        temporalFlowMemory: {
          update: updateMock,
        },
      },
    } as any;
    const flow = new TemporalFlowService(prisma);
    const now = new Date();

    await flow.updateMemoryIfUnchanged(
      'biz_1',
      { id: 'tfm_1', updatedAt: now, content: 'old' },
      { content: 'new', dataClass: 'REVENUE', moduleScope: ['commerce', 'calendar', 'commerce', 'bogus'] },
    );
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          dataClass: 'REVENUE',
          moduleScope: ['bookings', 'revenue'],
        }),
      }),
    );
  });
});
