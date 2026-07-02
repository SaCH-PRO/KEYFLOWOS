import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KeyCortexSagaExecutorService } from './key-cortex-saga-executor.service';
import { KeyCortexExecutorService, BatchResult } from './key-cortex-executor.service';
import { KeyCortexSagaService } from './key-cortex-saga.service';
import { KeyCortexCompensationService } from './key-cortex-compensation.service';
import { BlueprintService } from '../blueprint/blueprint.service';

describe('KeyCortexSagaExecutorService', () => {
  let service: KeyCortexSagaExecutorService;
  let executor: { executeBatch: ReturnType<typeof vi.fn> };
  let saga: {
    start: ReturnType<typeof vi.fn>;
    addStep: ReturnType<typeof vi.fn>;
    completeStep: ReturnType<typeof vi.fn>;
    failStep: ReturnType<typeof vi.fn>;
    completeSaga: ReturnType<typeof vi.fn>;
    failSaga: ReturnType<typeof vi.fn>;
    compensate: ReturnType<typeof vi.fn>;
  };
  let compensation: { getCompensatingAction: ReturnType<typeof vi.fn> };
  let blueprint: { getBlueprint: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    executor = { executeBatch: vi.fn() };
    saga = {
      start: vi.fn(),
      addStep: vi.fn(),
      completeStep: vi.fn(),
      failStep: vi.fn(),
      completeSaga: vi.fn(),
      failSaga: vi.fn(),
      compensate: vi.fn(),
    };
    compensation = { getCompensatingAction: vi.fn() };
    blueprint = { getBlueprint: vi.fn() };

    service = new KeyCortexSagaExecutorService(
      executor as unknown as KeyCortexExecutorService,
      saga as unknown as KeyCortexSagaService,
      compensation as unknown as KeyCortexCompensationService,
      blueprint as unknown as BlueprintService,
    );

    saga.start.mockResolvedValue({ id: 'saga1' });
    compensation.getCompensatingAction.mockReturnValue(undefined);
  });

  it('starts a saga and returns its id', async () => {
    const batchResult: BatchResult = {
      results: [],
      totalCommands: 0,
      succeededCount: 0,
      failedCount: 0,
      rolledBackCount: 0,
      durationMs: 0,
      traceId: 't1',
      stoppedEarly: false,
      summary: 'Empty',
    };
    executor.executeBatch.mockResolvedValue(batchResult);

    const result = await service.executeSagaBatch('b1', []);

    expect(saga.start).toHaveBeenCalled();
    expect(result.sagaId).toBe('saga1');
    expect(result.batchResult).toBe(batchResult);
  });

  it('records steps, completes saga, and skips compensation when all succeed', async () => {
    const commands = [
      { module: 'crm', action: 'create_contact', businessId: 'b1', parameters: { name: 'A' }, userId: 'u1', source: 'key_cortex', timestamp: new Date() },
    ];

    compensation.getCompensatingAction.mockReturnValue('crm.delete_contact');
    const batchResult: BatchResult = {
      results: [
        {
          id: 'r1',
          command: commands[0] as any,
          result: { success: true, data: { id: 'c1' }, executionTimeMs: 10 },
          startedAt: new Date(),
          finishedAt: new Date(),
          durationMs: 10,
          traceId: 't1',
          rolledBack: false,
        },
      ],
      totalCommands: 1,
      succeededCount: 1,
      failedCount: 0,
      rolledBackCount: 0,
      durationMs: 10,
      traceId: 't1',
      stoppedEarly: false,
      summary: 'Done',
    };
    executor.executeBatch.mockResolvedValue(batchResult);

    const result = await service.executeSagaBatch('b1', commands as any);

    expect(saga.addStep).toHaveBeenCalledWith(
      'saga1',
      0,
      'crm.create_contact',
      { name: 'A' },
      expect.objectContaining({ action: 'crm.delete_contact' }),
    );
    expect(saga.completeStep).toHaveBeenCalledWith('saga1', 0, { id: 'c1' });
    expect(saga.completeSaga).toHaveBeenCalledWith('saga1');
    expect(saga.compensate).not.toHaveBeenCalled();
    expect(result.compensationResults).toBeUndefined();
  });

  it('compensates in reverse order when a step fails', async () => {
    const commands = [
      { module: 'crm', action: 'create_contact', businessId: 'b1', parameters: { name: 'A' }, userId: 'u1', source: 'key_cortex', timestamp: new Date() },
      { module: 'commerce', action: 'create_invoice', businessId: 'b1', parameters: { total: 100 }, userId: 'u1', source: 'key_cortex', timestamp: new Date() },
    ];

    compensation.getCompensatingAction
      .mockReturnValueOnce('crm.delete_contact')
      .mockReturnValueOnce('commerce.void_invoice');

    const batchResult: BatchResult = {
      results: [
        {
          id: 'r1',
          command: commands[0] as any,
          result: { success: true, data: { id: 'c1' }, executionTimeMs: 10 },
          startedAt: new Date(),
          finishedAt: new Date(),
          durationMs: 10,
          traceId: 't1',
          rolledBack: false,
        },
        {
          id: 'r2',
          command: commands[1] as any,
          result: { success: false, error: 'Invoice failed', executionTimeMs: 10 },
          startedAt: new Date(),
          finishedAt: new Date(),
          durationMs: 10,
          traceId: 't1',
          rolledBack: false,
        },
      ],
      totalCommands: 2,
      succeededCount: 1,
      failedCount: 1,
      rolledBackCount: 0,
      durationMs: 20,
      traceId: 't1',
      stoppedEarly: true,
      summary: '1 failed',
    };
    executor.executeBatch.mockResolvedValue(batchResult);
    saga.compensate.mockResolvedValue([{ success: true }]);

    const result = await service.executeSagaBatch('b1', commands as any);

    expect(saga.failStep).toHaveBeenCalledWith('saga1', 1, 'Invoice failed');
    expect(saga.compensate).toHaveBeenCalledWith('saga1');
    expect(result.compensationResults).toEqual([{ success: true }]);
  });

  it('captures previous blueprint value for key_genome.dna_update compensation', async () => {
    const commands = [
      { module: 'key_genome', action: 'dna_update', businessId: 'b1', parameters: { section: 'identity', field: 'name', value: 'New' }, userId: 'u1', source: 'key_cortex', timestamp: new Date() },
    ];

    compensation.getCompensatingAction.mockReturnValue('key_genome.revert_blueprint_field');
    blueprint.getBlueprint.mockResolvedValue({ identity: { name: 'Old' } } as any);

    const batchResult: BatchResult = {
      results: [
        {
          id: 'r1',
          command: commands[0] as any,
          result: { success: true, data: {}, executionTimeMs: 10 },
          startedAt: new Date(),
          finishedAt: new Date(),
          durationMs: 10,
          traceId: 't1',
          rolledBack: false,
        },
      ],
      totalCommands: 1,
      succeededCount: 1,
      failedCount: 0,
      rolledBackCount: 0,
      durationMs: 10,
      traceId: 't1',
      stoppedEarly: false,
      summary: 'Done',
    };
    executor.executeBatch.mockResolvedValue(batchResult);

    await service.executeSagaBatch('b1', commands as any);

    expect(saga.addStep).toHaveBeenCalledWith(
      'saga1',
      0,
      'key_genome.dna_update',
      { section: 'identity', field: 'name', value: 'New' },
      expect.objectContaining({
        action: 'key_genome.revert_blueprint_field',
        payload: expect.objectContaining({ previousValue: 'Old' }),
      }),
    );
  });
});
