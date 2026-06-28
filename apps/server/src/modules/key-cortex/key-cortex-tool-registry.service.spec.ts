import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  KeyCortexToolRegistryService,
  KeyCortexToolDefinition,
} from './key-cortex-tool-registry.service';

function makeSafety(overrides?: Partial<any>) {
  return {
    check: vi.fn().mockResolvedValue({ allowed: true, profile: { maxDailyAutoActions: 10 } }),
    recordExecution: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makePrisma() {
  return {
    client: {
      cortexActionLog: {
        create: vi.fn().mockResolvedValue(undefined),
      },
    },
  };
}

function makeIdempotency(overrides?: Partial<any>) {
  return {
    check: vi.fn().mockResolvedValue({ status: 'new' }),
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeSaga(overrides?: Partial<any>) {
  return {
    addStep: vi.fn().mockResolvedValue(undefined),
    completeStep: vi.fn().mockResolvedValue(undefined),
    failStep: vi.fn().mockResolvedValue(undefined),
    compensate: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('KeyCortexToolRegistryService — safety gate', () => {
  let registry: KeyCortexToolRegistryService;
  let safety: ReturnType<typeof makeSafety>;
  let prisma: ReturnType<typeof makePrisma>;
  let idempotency: ReturnType<typeof makeIdempotency>;
  let saga: ReturnType<typeof makeSaga>;
  let tool: KeyCortexToolDefinition;

  beforeEach(() => {
    safety = makeSafety();
    prisma = makePrisma();
    idempotency = makeIdempotency();
    saga = makeSaga();
    registry = new KeyCortexToolRegistryService(
      prisma as any,
      safety as any,
      idempotency as any,
      saga as any,
    );
    tool = {
      name: 'crm.create_contact',
      module: 'crm',
      description: 'Create a contact',
      parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      riskTier: 1,
      requiresApproval: false,
      handler: vi.fn().mockResolvedValue({ success: true, data: { id: 'c1' } }),
    };
  });

  it('registers and executes a low-risk tool', async () => {
    registry.register(tool);
    const result = await registry.execute('crm.create_contact', {
      businessId: 'biz_1',
      autonomyLevel: 2,
    }, { name: 'Alice' });

    expect(result.success).toBe(true);
    expect(tool.handler).toHaveBeenCalled();
    expect(safety.check).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: 'biz_1', toolName: 'crm.create_contact', mode: 'auto' }),
    );
    expect(safety.recordExecution).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: 'biz_1', toolName: 'crm.create_contact', mode: 'auto' }),
    );
  });

  it('blocks execution when the safety gate disallows', async () => {
    safety = makeSafety({
      check: vi.fn().mockResolvedValue({ allowed: false, reason: 'Kill switch active' }),
    });
    registry = new KeyCortexToolRegistryService(
      prisma as any,
      safety as any,
      idempotency as any,
      saga as any,
    );
    registry.register(tool);

    const result = await registry.execute('crm.create_contact', {
      businessId: 'biz_1',
      autonomyLevel: 2,
    }, { name: 'Alice' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Kill switch active');
    expect(tool.handler).not.toHaveBeenCalled();
    expect(safety.recordExecution).not.toHaveBeenCalled();
  });

  it('does not record execution when the handler fails', async () => {
    const failingTool: KeyCortexToolDefinition = {
      ...tool,
      name: 'crm.fail',
      handler: vi.fn().mockRejectedValue(new Error('Boom')),
    };
    registry.register(failingTool);

    const result = await registry.execute('crm.fail', { businessId: 'biz_1', autonomyLevel: 2 }, { name: 'Alice' });

    expect(result.success).toBe(false);
    expect(safety.recordExecution).not.toHaveBeenCalled();
  });

  it('treats low autonomy level as manual mode for safety limits', async () => {
    registry.register(tool);
    await registry.execute('crm.create_contact', { businessId: 'biz_1', autonomyLevel: 1 }, { name: 'Alice' });

    expect(safety.check).toHaveBeenCalledWith(expect.objectContaining({ mode: 'manual' }));
  });
});
