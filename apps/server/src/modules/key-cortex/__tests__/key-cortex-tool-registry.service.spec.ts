import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  KeyCortexToolRegistryService,
  KeyCortexToolDefinition,
} from '../key-cortex-tool-registry.service';

const mockPrisma = {
  client: {
    cortexActionLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
};

const mockSafety = {
  check: vi.fn().mockResolvedValue({ allowed: true }),
  recordExecution: vi.fn().mockResolvedValue(undefined),
};

function createRegistry(): KeyCortexToolRegistryService {
  return new KeyCortexToolRegistryService(mockPrisma as any, mockSafety as any);
}

describe('KeyCortexToolRegistryService', () => {
  let registry: KeyCortexToolRegistryService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSafety.check.mockResolvedValue({ allowed: true });
    registry = createRegistry();
  });

  const sampleTool: KeyCortexToolDefinition = {
    name: 'test.greet',
    module: 'test',
    description: 'Greet someone',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    },
    riskTier: 1,
    requiresApproval: false,
    handler: async (_ctx, input) => ({
      success: true,
      data: { message: `Hello ${input.name}` },
    }),
  };

  it('registers and retrieves a tool', () => {
    registry.register(sampleTool);
    expect(registry.getTool('test.greet')).toBe(sampleTool);
  });

  it('lists tools with metadata', () => {
    registry.register(sampleTool);
    const tools = registry.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('test.greet');
    expect(tools[0].description).toBe('Greet someone');
    expect((tools[0] as any).handler).toBeUndefined();
  });

  it('filters tools by module', () => {
    registry.register(sampleTool);
    registry.register({ ...sampleTool, name: 'other.greet', module: 'other' });
    expect(registry.listTools({ module: 'test' })).toHaveLength(1);
  });

  it('filters tools by tags', () => {
    registry.register({ ...sampleTool, tags: ['sales'] });
    registry.register({ ...sampleTool, name: 'test.bye', tags: ['ops'] });
    expect(registry.listTools({ tags: ['sales'] })).toHaveLength(1);
  });

  it('executes a tool and audits the result', async () => {
    registry.register(sampleTool);
    const result = await registry.execute('test.greet', { businessId: 'biz_1', autonomyLevel: 2 }, { name: 'KEY' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ message: 'Hello KEY' });
    expect(mockPrisma.client.cortexActionLog.create).toHaveBeenCalled();
  });

  it('returns error for unknown tool', async () => {
    const result = await registry.execute('unknown.tool', { businessId: 'biz_1' }, {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('returns error for missing required parameters', async () => {
    registry.register(sampleTool);
    const result = await registry.execute('test.greet', { businessId: 'biz_1' }, {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Missing required parameters');
  });

  it('blocks critical risk tools', async () => {
    registry.register({ ...sampleTool, name: 'test.danger', riskTier: 4 });
    const result = await registry.execute('test.danger', { businessId: 'biz_1' }, { name: 'x' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('blocked');
  });

  it('blocks high risk tools without approval', async () => {
    registry.register({ ...sampleTool, name: 'test.risky', riskTier: 3 });
    const result = await registry.execute('test.risky', { businessId: 'biz_1', autonomyLevel: 4 }, { name: 'x' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('requires explicit user approval');
  });

  it('allows low risk tools with sufficient autonomy', async () => {
    registry.register(sampleTool);
    const result = await registry.execute('test.greet', { businessId: 'biz_1', autonomyLevel: 2 }, { name: 'x' });
    expect(result.success).toBe(true);
  });

  it('blocks low risk tools with insufficient autonomy', async () => {
    registry.register(sampleTool);
    const result = await registry.execute('test.greet', { businessId: 'biz_1', autonomyLevel: 0 }, { name: 'x' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('INTERNAL_EXEC');
  });

  it('builds OpenAI-compatible gateway definitions', () => {
    registry.register(sampleTool);
    const defs = registry.buildGatewayDefinitions();
    expect(defs[0]).toEqual({
      type: 'function',
      function: {
        name: 'test.greet',
        description: 'Greet someone',
        parameters: sampleTool.parameters,
      },
    });
  });

  it('provides statistics', () => {
    registry.register(sampleTool);
    registry.register({ ...sampleTool, name: 'test.risky', riskTier: 3, module: 'other' });
    const stats = registry.getStats();
    expect(stats.total).toBe(2);
    expect(stats.byModule.test).toBe(1);
    expect(stats.byModule.other).toBe(1);
    expect(stats.byRiskTier['1']).toBe(1);
    expect(stats.byRiskTier['3']).toBe(1);
  });

  it('catches handler exceptions and returns error result', async () => {
    registry.register({
      ...sampleTool,
      handler: async () => {
        throw new Error('Boom');
      },
    });
    const result = await registry.execute('test.greet', { businessId: 'biz_1', autonomyLevel: 2 }, { name: 'x' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Boom');
  });
});
