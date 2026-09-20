import { describe, expect, it, vi } from 'vitest';
import { FlowRunnerService } from './flow-runner.service';

function makeService() {
  const prisma = {
    client: {
      automationFlow: { findFirst: vi.fn() },
      flowRun: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      flowVersion: { findFirst: vi.fn() },
    },
  };
  const registry = {};
  const realtime = { emit: vi.fn() };
  return {
    service: new FlowRunnerService(prisma as never, registry as never, realtime as never),
    prisma,
  };
}

describe('FlowRunnerService tenant-qualified idempotency', () => {
  it('looks up an idempotent run using businessId + idempotencyKey', async () => {
    const { service, prisma } = makeService();
    prisma.client.automationFlow.findFirst.mockResolvedValue({
      id: 'flow_1',
      businessId: 'biz_a',
      status: 'ACTIVE',
    });
    const existing = {
      id: 'run_existing',
      businessId: 'biz_a',
      idempotencyKey: 'same-key',
      status: 'COMPLETED',
    };
    prisma.client.flowRun.findUnique.mockResolvedValue(existing);

    await expect(
      service.runFlow('biz_a', 'flow_1', { idempotencyKey: 'same-key' }),
    ).resolves.toEqual(existing);

    expect(prisma.client.flowRun.findUnique).toHaveBeenCalledWith({
      where: {
        businessId_idempotencyKey: {
          businessId: 'biz_a',
          idempotencyKey: 'same-key',
        },
      },
    });
    expect(prisma.client.flowRun.create).not.toHaveBeenCalled();
  });

  it('does not use a globally unique idempotency lookup', async () => {
    const { service, prisma } = makeService();
    prisma.client.automationFlow.findFirst.mockResolvedValue({
      id: 'flow_1',
      businessId: 'biz_b',
      status: 'ACTIVE',
    });
    prisma.client.flowRun.findUnique.mockResolvedValue({
      id: 'run_existing_b',
      businessId: 'biz_b',
      idempotencyKey: 'shared-key',
    });

    await service.runFlow('biz_b', 'flow_1', { idempotencyKey: 'shared-key' });

    const args = prisma.client.flowRun.findUnique.mock.calls[0]?.[0];
    expect(args.where).not.toEqual({ idempotencyKey: 'shared-key' });
    expect(args.where.businessId_idempotencyKey.businessId).toBe('biz_b');
  });
});
