import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FlowAdapterService } from './flow-adapter.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ConnectorCommand } from '../key-cortex-connector.types';

const mkCmd = (action: string, parameters: Record<string, unknown> = {}): ConnectorCommand => ({
  module: 'flow',
  action,
  parameters,
  businessId: 'biz_123',
  userId: 'user_456',
  source: 'key_cortex',
  timestamp: new Date(),
  correlationId: 'corr_001',
});

describe('FlowAdapterService', () => {
  let service: FlowAdapterService;
  let prisma: { client: any };

  beforeEach(() => {
    prisma = {
      client: {
        automation: {
          create: vi.fn(),
          update: vi.fn(),
          findFirst: vi.fn(),
          findMany: vi.fn(),
        },
      },
    };
    service = new FlowAdapterService(prisma as unknown as PrismaService);
  });

  // ── Actions ───────────────────────────────────────────────────────────────

  it('create_automation creates an automation row', async () => {
    (prisma.client.automation.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'f1' });
    const result = await service.execute(mkCmd('create_automation', { name: 'Welcome', trigger: 'signup', actions: [] }));
    expect(result.success).toBe(true);
    expect(prisma.client.automation.create).toHaveBeenCalled();
  });

  it('enable_automation updates enabled true', async () => {
    (prisma.client.automation.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'f1', enabled: true });
    const result = await service.execute(mkCmd('enable_automation', { flowId: 'f1' }));
    expect(result.success).toBe(true);
    expect(prisma.client.automation.update).toHaveBeenCalledWith(expect.objectContaining({ data: { enabled: true } }));
  });

  it('disable_automation updates enabled false', async () => {
    (prisma.client.automation.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'f1', enabled: false });
    const result = await service.execute(mkCmd('disable_automation', { flowId: 'f1' }));
    expect(result.success).toBe(true);
    expect(prisma.client.automation.update).toHaveBeenCalledWith(expect.objectContaining({ data: { enabled: false } }));
  });

  it('trigger_flow updates lastRunAt and runCount', async () => {
    (prisma.client.automation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'f1' });
    (prisma.client.automation.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'f1', runCount: 1 });
    const result = await service.execute(mkCmd('trigger_flow', { flowId: 'f1', contactId: 'c1' }));
    expect(result.success).toBe(true);
    expect(prisma.client.automation.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ runCount: { increment: 1 } }) }));
  });

  it('delete_automation soft-deletes', async () => {
    (prisma.client.automation.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'f1', deletedAt: new Date() });
    const result = await service.execute(mkCmd('delete_automation', { flowId: 'f1' }));
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ deleted: true });
  });

  it('update_automation updates fields', async () => {
    (prisma.client.automation.update as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'f1', name: 'Updated' });
    const result = await service.execute(mkCmd('update_automation', { flowId: 'f1', name: 'Updated' }));
    expect(result.success).toBe(true);
    expect(prisma.client.automation.update).toHaveBeenCalled();
  });

  it('clone_automation clones source', async () => {
    (prisma.client.automation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'f1', trigger: 'signup', actionData: [], condition: null });
    (prisma.client.automation.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'f2' });
    const result = await service.execute(mkCmd('clone_automation', { flowId: 'f1', newName: 'Copy' }));
    expect(result.success).toBe(true);
    expect(prisma.client.automation.create).toHaveBeenCalled();
  });

  it('run_test returns simulation summary', async () => {
    (prisma.client.automation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'f1', actionData: [{}, {}] });
    const result = await service.execute(mkCmd('run_test', { flowId: 'f1', contactId: 'c1' }));
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ success: true, actionsSimulated: 2 });
  });

  // ── Queries ───────────────────────────────────────────────────────────────

  it('get_flow_status returns automation', async () => {
    (prisma.client.automation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'f1' });
    const result = await service.execute(mkCmd('get_flow_status', { flowId: 'f1' }));
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ id: 'f1' });
  });

  it('list_automations returns automations', async () => {
    (prisma.client.automation.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'f1' }]);
    const result = await service.execute(mkCmd('list_automations', { active: true }));
    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ id: 'f1' }]);
  });

  it('get_flow_runs returns run summary', async () => {
    (prisma.client.automation.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'f1', runCount: 5 });
    const result = await service.execute(mkCmd('get_flow_runs', { flowId: 'f1' }));
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ flowId: 'f1', runCount: 5, runs: [] });
  });

  it('get_flow_analytics returns aggregate stats', async () => {
    (prisma.client.automation.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'f1', enabled: true, runCount: 5 },
      { id: 'f2', enabled: false, runCount: 1 },
    ]);
    const result = await service.execute(mkCmd('get_flow_analytics', {}));
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ total: 2, active: 1, inactive: 1, totalRuns: 6 });
  });

  it('returns connectorFail for unknown action', async () => {
    const result = await service.execute(mkCmd('nonexistent'));
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown flow action');
  });
});
