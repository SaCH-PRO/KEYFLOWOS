import { describe, expect, it, vi } from 'vitest';
import { FlowRunnerService } from '../src/modules/flow/flow-runner.service';

function makeService(initialFlowStatus = 'ACTIVE', initialVersionStatus = 'PUBLISHED') {
  let flowMetrics: any = {};
  const runs: any[] = [];
  const steps: any[] = [];
  const flow = {
    id: 'flow_1',
    businessId: 'biz_1',
    status: initialFlowStatus,
    metrics: flowMetrics,
  };
  const version = {
    id: 'version_1',
    flowId: 'flow_1',
    status: initialVersionStatus,
    version: 1,
    nodes: [
      { id: 'trigger_1', type: 'trigger', data: { triggerType: 'new_message' } },
      { id: 'action_1', type: 'action', data: { actionType: 'send_message' } },
    ],
    edges: [{ source: 'trigger_1', target: 'action_1' }],
  };

  const prisma: any = {
    client: {
      automationFlow: {
        findFirst: vi.fn(async () => flow),
        findUnique: vi.fn(async () => ({ ...flow, metrics: flowMetrics })),
        update: vi.fn(async ({ data }: any) => {
          flowMetrics = data.metrics;
          return { ...flow, metrics: flowMetrics };
        }),
      },
      flowVersion: {
        findFirst: vi.fn(async () => version),
      },
      flowRun: {
        create: vi.fn(async ({ data }: any) => {
          const run = { id: `run_${runs.length + 1}`, ...data };
          runs.push(run);
          return run;
        }),
        update: vi.fn(async ({ where, data }: any) => {
          const run = runs.find((r) => r.id === where.id);
          Object.assign(run, data);
          return run;
        }),
        findUnique: vi.fn(async () => undefined),
      },
      flowRunStep: {
        create: vi.fn(async ({ data }: any) => {
          const step = { id: `step_${steps.length + 1}`, ...data };
          steps.push(step);
          return step;
        }),
        update: vi.fn(async ({ where, data }: any) => {
          const step = steps.find((s) => s.id === where.id);
          Object.assign(step, data);
          return step;
        }),
      },
      businessEvent: {
        create: vi.fn(async () => ({})),
      },
    },
  };

  const registry: any = {
    get: vi.fn(() => async (_ctx: any, _data: any) => ({ sent: true })),
  };

  const realtime: any = { emit: vi.fn() };

  const service = new FlowRunnerService(prisma, registry, realtime);
  return { service, prisma, registry, realtime, runs, steps, getMetrics: () => flowMetrics };
}

describe('FlowRunnerService.runFlow', () => {
  it('requires an active flow', async () => {
    const { service } = makeService('DRAFT', 'PUBLISHED');
    await expect(service.runFlow('biz_1', 'flow_1', {})).rejects.toThrow('Flow is not active');
  });

  it('updates AutomationFlow.metrics after a successful run', async () => {
    const { service, prisma, getMetrics } = makeService('ACTIVE', 'PUBLISHED');
    const run = await service.runFlow('biz_1', 'flow_1', { body: 'hello' });

    expect(run.status).toBe('COMPLETED');
    expect(prisma.client.automationFlow.update).toHaveBeenCalled();
    expect(getMetrics()).toMatchObject({
      totalRuns: 1,
      successRuns: 1,
      failedRuns: 0,
      lastRunStatus: 'COMPLETED',
    });
    expect(getMetrics().lastRunAt).toBeDefined();
  });

  it('increments failedRuns when execution throws', async () => {
    const { service, registry, getMetrics } = makeService('ACTIVE', 'PUBLISHED');
    registry.get.mockReturnValueOnce(async () => {
      throw new Error('boom');
    });

    const run = await service.runFlow('biz_1', 'flow_1', {});

    expect(run.status).toBe('FAILED');
    expect(getMetrics()).toMatchObject({
      totalRuns: 1,
      successRuns: 0,
      failedRuns: 1,
      lastRunStatus: 'FAILED',
    });
  });
});

describe('FlowRunnerService.runFlowTest', () => {
  it('runs on a draft/unpublished flow and marks TEST_COMPLETED', async () => {
    const { service, runs } = makeService('DRAFT', 'DRAFT');
    const run = await service.runFlowTest('biz_1', 'flow_1', { body: 'test' });

    expect(run.status).toBe('TEST_COMPLETED');
  });

  it('marks TEST_FAILED when execution throws', async () => {
    const { service, registry } = makeService('DRAFT', 'DRAFT');
    registry.get.mockReturnValueOnce(async () => {
      throw new Error('boom');
    });

    const run = await service.runFlowTest('biz_1', 'flow_1', {});

    expect(run.status).toBe('TEST_FAILED');
  });
});
