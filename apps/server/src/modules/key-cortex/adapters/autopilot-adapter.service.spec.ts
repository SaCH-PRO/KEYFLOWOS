import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AutopilotAdapterService } from './autopilot-adapter.service';
import { AutopilotService } from '../../autopilot/autopilot.service';
import { DelegationLoopService } from '../../autopilot/delegation-loop.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ConnectorCommand } from '../key-cortex-connector.types';

const mkCmd = (action: string, parameters: Record<string, unknown> = {}): ConnectorCommand => ({
  module: 'autopilot',
  action,
  parameters,
  businessId: 'biz_123',
  userId: 'user_456',
  source: 'key_cortex',
  timestamp: new Date(),
  correlationId: 'corr_001',
});

describe('AutopilotAdapterService', () => {
  let service: AutopilotAdapterService;
  let autopilot: AutopilotService;
  let loops: DelegationLoopService;
  let prisma: { client: any };

  beforeEach(() => {
    autopilot = {
      getAllTasks: vi.fn(),
      createTask: vi.fn(),
      approveTask: vi.fn(),
      denyTask: vi.fn(),
      updateTaskStatus: vi.fn(),
      getTaskStats: vi.fn(),
      getCriticalAlerts: vi.fn(),
    } as unknown as AutopilotService;

    loops = {
      updateLoop: vi.fn(),
      getLoops: vi.fn(),
    } as unknown as DelegationLoopService;

    prisma = {
      client: {
        delegationLoop: { create: vi.fn(), findFirst: vi.fn() },
        autopilotTask: { findMany: vi.fn() },
      },
    };

    service = new AutopilotAdapterService(autopilot, loops, prisma as unknown as PrismaService);
  });

  // ── Actions ───────────────────────────────────────────────────────────────

  it('get_tasks delegates to getAllTasks', async () => {
    (autopilot.getAllTasks as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 't1' }]);
    const result = await service.execute(mkCmd('get_tasks', { status: 'PENDING' }));
    expect(result.success).toBe(true);
    expect(autopilot.getAllTasks).toHaveBeenCalledWith('biz_123', 'PENDING');
  });

  it('create_task delegates to createTask', async () => {
    (autopilot.createTask as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 't1' });
    const result = await service.execute(mkCmd('create_task', { title: 'Follow up' }));
    expect(result.success).toBe(true);
    expect(autopilot.createTask).toHaveBeenCalled();
  });

  it('approve_task delegates to approveTask', async () => {
    (autopilot.approveTask as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 't1', status: 'APPROVED' });
    const result = await service.execute(mkCmd('approve_task', { taskId: 't1' }));
    expect(result.success).toBe(true);
    expect(autopilot.approveTask).toHaveBeenCalledWith('t1', 'biz_123', 'key-cortex');
  });

  it('reject_task delegates to denyTask', async () => {
    (autopilot.denyTask as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 't1', status: 'SKIPPED' });
    const result = await service.execute(mkCmd('reject_task', { taskId: 't1' }));
    expect(result.success).toBe(true);
    expect(autopilot.denyTask).toHaveBeenCalledWith('t1', 'biz_123');
  });

  it('complete_task delegates to updateTaskStatus COMPLETED', async () => {
    (autopilot.updateTaskStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 't1', status: 'COMPLETED' });
    const result = await service.execute(mkCmd('complete_task', { taskId: 't1' }));
    expect(result.success).toBe(true);
    expect(autopilot.updateTaskStatus).toHaveBeenCalledWith('t1', 'biz_123', 'COMPLETED', 'key-cortex');
  });

  it('enable_loop delegates to updateLoop enabled true', async () => {
    (loops.updateLoop as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'l1', enabled: true });
    const result = await service.execute(mkCmd('enable_loop', { loopId: 'l1' }));
    expect(result.success).toBe(true);
    expect(loops.updateLoop).toHaveBeenCalledWith('biz_123', 'l1', { enabled: true });
  });

  it('disable_loop delegates to updateLoop enabled false', async () => {
    (loops.updateLoop as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'l1', enabled: false });
    const result = await service.execute(mkCmd('disable_loop', { loopId: 'l1' }));
    expect(result.success).toBe(true);
    expect(loops.updateLoop).toHaveBeenCalledWith('biz_123', 'l1', { enabled: false });
  });

  it('create_loop creates a custom delegation loop', async () => {
    (prisma.client.delegationLoop.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'l1' });
    const result = await service.execute(mkCmd('create_loop', { name: 'Custom', frequency: 'daily', active: true }));
    expect(result.success).toBe(true);
    expect(prisma.client.delegationLoop.create).toHaveBeenCalled();
  });

  // ── Queries ───────────────────────────────────────────────────────────────

  it('list_loops delegates to getLoops', async () => {
    (loops.getLoops as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'l1', enabled: true }]);
    const result = await service.execute(mkCmd('list_loops', { active: true }));
    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ id: 'l1', enabled: true }]);
  });

  it('get_loop_status returns loop with runs', async () => {
    (prisma.client.delegationLoop.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'l1' });
    const result = await service.execute(mkCmd('get_loop_status', { loopId: 'l1' }));
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ id: 'l1' });
  });

  it('get_task_history returns tasks', async () => {
    (prisma.client.autopilotTask.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 't1' }]);
    const result = await service.execute(mkCmd('get_task_history', { limit: 10 }));
    expect(result.success).toBe(true);
    expect(result.data).toEqual([{ id: 't1' }]);
  });

  it('get_governance_report returns stats and alerts', async () => {
    (autopilot.getTaskStats as ReturnType<typeof vi.fn>).mockResolvedValue({ total: 5 });
    (autopilot.getCriticalAlerts as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'a1' }]);
    const result = await service.execute(mkCmd('get_governance_report', {}));
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ stats: { total: 5 }, alerts: [{ id: 'a1' }] });
  });

  it('returns connectorFail for unknown action', async () => {
    const result = await service.execute(mkCmd('nonexistent'));
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown autopilot action');
  });
});
