import { describe, expect, it, vi } from 'vitest';
import { KeyCommandService } from './key-command.service';

function makeService(overrides: Record<string, unknown> = {}) {
  const prisma = {
    client: {
      keyCommand: { update: vi.fn().mockResolvedValue({}) },
    },
  };
  const timeline = { recordEvent: vi.fn().mockResolvedValue(undefined) };
  const legacy = { execute: vi.fn() };
  const commands = {};
  const canonical = {
    getTool: vi.fn(),
    execute: vi.fn(),
  };

  const service = new KeyCommandService(
    prisma as any,
    timeline as any,
    legacy as any,
    commands as any,
    canonical as any,
  );

  Object.assign(service as any, overrides);
  return { service, prisma, timeline, legacy, canonical };
}

describe('KeyCommandService canonical capability routing', () => {
  it('plans message intake with the canonical FLOW_TOOLS identity', async () => {
    const { service } = makeService();

    const plan = await service.planActions('cmd_1', {
      domain: 'messages',
      action: 'message_intake',
    });

    expect(plan.steps).toEqual([
      expect.objectContaining({
        tool: 'inbox_list_threads',
        module: 'flow',
        input: { limit: 20 },
      }),
    ]);
  });

  it('prefers a bare canonical FLOW_TOOLS name over the legacy fallback', async () => {
    const { service, canonical, legacy } = makeService();
    canonical.getTool.mockImplementation((name: string) =>
      name === 'inbox_list_threads' ? { name } : undefined,
    );
    canonical.execute.mockResolvedValue({ success: true, data: { threads: [] } });

    await service.executeApprovedPlan(
      'cmd_1',
      {
        summary: 'message intake',
        steps: [{
          tool: 'inbox_list_threads',
          module: 'flow',
          input: { limit: 20 },
          riskTier: 'LOW',
          requiresApproval: false,
        }],
      },
      'biz_1',
      'user_1',
    );

    expect(canonical.execute).toHaveBeenCalledWith(
      'inbox_list_threads',
      expect.objectContaining({ businessId: 'biz_1', userId: 'user_1', commandId: 'cmd_1' }),
      { limit: 20 },
    );
    expect(legacy.execute).not.toHaveBeenCalled();
  });

  it('retains the legacy fallback for capabilities not yet converged', async () => {
    const { service, canonical, legacy } = makeService();
    canonical.getTool.mockReturnValue(undefined);
    legacy.execute.mockResolvedValue({ success: true, data: {} });

    await service.executeApprovedPlan(
      'cmd_2',
      {
        summary: 'legacy island',
        steps: [{
          tool: 'scanDrive',
          module: 'connect',
          input: {},
          riskTier: 'LOW',
          requiresApproval: false,
        }],
      },
      'biz_1',
    );

    expect(legacy.execute).toHaveBeenCalledWith(
      'connect',
      'scanDrive',
      expect.objectContaining({ businessId: 'biz_1', commandId: 'cmd_2' }),
      {},
    );
  });
});
