import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyCortexToolLoopService } from './key-cortex-tool-loop.service';
import { CortexQuery } from './key-cortex.types';

describe('KeyCortexToolLoopService', () => {
  let service: KeyCortexToolLoopService;
  let toolRegistry: any;
  let autonomyOrchestrator: any;
  let safety: any;
  let autonomyLevel: any;
  let modelGateway: any;

  const businessId = 'biz_123';
  const userId = 'user_123';
  const query: CortexQuery = {
    text: 'do something',
    businessId,
    userId,
  };

  beforeEach(() => {
    toolRegistry = {
      getTool: vi.fn().mockReturnValue({
        name: 'crm.create_contact',
        module: 'crm',
        riskTier: 2,
        requiresApproval: false,
      }),
      execute: vi.fn().mockResolvedValue({ success: true, data: { id: 'contact_1' } }),
    };

    autonomyOrchestrator = {
      evaluate: vi.fn().mockResolvedValue({
        allowed: true,
        requiresApproval: false,
        tier: 'full',
        confidence: 1,
        reason: 'ok',
        ruleTrace: [],
        createdAt: new Date(),
      }),
    };

    safety = {
      check: vi.fn().mockResolvedValue({ allowed: true }),
      recordExecution: vi.fn().mockResolvedValue(undefined),
    };

    autonomyLevel = {
      resolve: vi.fn().mockResolvedValue({ level: 3, mode: 'pro_auto', maxAutoRiskTier: 3, label: 'test' }),
    };

    modelGateway = {
      complete: vi.fn().mockResolvedValue({ content: 'Done' } as any),
    };

    service = new KeyCortexToolLoopService(
      modelGateway,
      { client: {} } as any,
      toolRegistry,
      undefined,
      autonomyOrchestrator,
      safety,
      autonomyLevel,
    );
  });

  it('executes a tool when safety and autonomy both allow', async () => {
    const result = await service.handleToolCalls(
      {
        toolCalls: [
          {
            id: 'tc1',
            type: 'function',
            function: { name: 'crm.create_contact', arguments: JSON.stringify({ name: 'Ada' }) },
          },
        ],
      },
      [],
      query,
      {} as any,
      { temperature: 0.5 },
      'action_execution',
      { correlationId: 'c1', sessionId: 's1', commandId: 'cmd1', businessId, userId },
    );

    expect(toolRegistry.execute).toHaveBeenCalledWith(
      'crm.create_contact',
      expect.objectContaining({ businessId, userId, autonomyLevel: 3 }),
      { name: 'Ada' },
    );
    expect(result?.content).toBe('Done');
    expect(safety.recordExecution).toHaveBeenCalled();
  });

  it('blocks execution when safety gate disallows', async () => {
    (safety.check as ReturnType<typeof vi.fn>).mockResolvedValue({ allowed: false, reason: 'kill switch active' });

    const result = await service.handleToolCalls(
      {
        toolCalls: [
          {
            id: 'tc1',
            type: 'function',
            function: { name: 'crm.create_contact', arguments: '{}' },
          },
        ],
      },
      [],
      query,
      {} as any,
      { temperature: 0.5 },
      'action_execution',
      { correlationId: 'c1', sessionId: 's1', commandId: 'cmd1', businessId, userId },
    );

    expect(toolRegistry.execute).not.toHaveBeenCalled();
    expect(result?.actions[0].status).toBe('error');
    expect(result?.actions[0].error).toContain('kill switch active');
  });

  it('requires approval when autonomy orchestrator returns requiresApproval', async () => {
    (autonomyOrchestrator.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue({
      allowed: true,
      requiresApproval: true,
      proposalId: 'prop_123',
      reason: 'risk tier exceeds autonomy level',
    });

    const result = await service.handleToolCalls(
      {
        toolCalls: [
          {
            id: 'tc1',
            type: 'function',
            function: { name: 'crm.create_contact', arguments: '{}' },
          },
        ],
      },
      [],
      query,
      {} as any,
      { temperature: 0.5 },
      'action_execution',
      { correlationId: 'c1', sessionId: 's1', commandId: 'cmd1', businessId, userId },
    );

    expect(toolRegistry.execute).not.toHaveBeenCalled();
    expect(result?.actions[0].status).toBe('pending_approval');
    expect(result?.actions[0].approvalRequestId).toBe('prop_123');
  });

  it('blocks execution when autonomy orchestrator disallows', async () => {
    (autonomyOrchestrator.evaluate as ReturnType<typeof vi.fn>).mockResolvedValue({
      allowed: false,
      requiresApproval: false,
      reason: 'policy rule blocked',
    });

    const result = await service.handleToolCalls(
      {
        toolCalls: [
          {
            id: 'tc1',
            type: 'function',
            function: { name: 'crm.create_contact', arguments: '{}' },
          },
        ],
      },
      [],
      query,
      {} as any,
      { temperature: 0.5 },
      'action_execution',
      { correlationId: 'c1', sessionId: 's1', commandId: 'cmd1', businessId, userId },
    );

    expect(toolRegistry.execute).not.toHaveBeenCalled();
    expect(result?.actions[0].status).toBe('error');
    expect(result?.actions[0].error).toContain('policy rule blocked');
  });

  it('uses autonomy level from AutonomyLevelService, not BusinessSettings', async () => {
    autonomyLevel.resolve.mockResolvedValue({ level: 4, mode: 'pro_auto', maxAutoRiskTier: 4, label: 'test' });

    await service.handleToolCalls(
      {
        toolCalls: [
          {
            id: 'tc1',
            type: 'function',
            function: { name: 'crm.create_contact', arguments: '{}' },
          },
        ],
      },
      [],
      query,
      {} as any,
      { temperature: 0.5 },
      'action_execution',
      { correlationId: 'c1', sessionId: 's1', commandId: 'cmd1', businessId, userId },
    );

    expect(toolRegistry.execute).toHaveBeenCalledWith(
      'crm.create_contact',
      expect.objectContaining({ autonomyLevel: 4 }),
      {},
    );
  });
});
