import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { FlowSignalController } from './flow-signal.controller';
import { FlowSignalService } from './flow-signal.service';
import { RoleFlowService } from './role-flow.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { FlowType } from '@prisma/client';

describe('FlowSignalController', () => {
  let controller: FlowSignalController;
  let flowSignalService: FlowSignalService;
  let roleFlowService: RoleFlowService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [FlowSignalController],
      providers: [
        {
          provide: FlowSignalService,
          useValue: {
            list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
            markResolved: vi.fn().mockResolvedValue({ id: 'sig_1', status: 'RESOLVED' }),
            markActionRequired: vi.fn().mockResolvedValue({ id: 'sig_1', status: 'ACTION_REQUIRED' }),
            snooze: vi.fn().mockResolvedValue({ id: 'sig_1', status: 'SNOOZED' }),
          },
        },
        {
          provide: RoleFlowService,
          useValue: {
            getRoleQueue: vi.fn().mockResolvedValue({
              roleKey: 'ACCOUNTS_RECEIVABLE_CLERK',
              flowTypes: [FlowType.FINANCIAL],
              total: 1,
              items: [{ id: 'sig_1', type: 'invoice.overdue' }],
              summary: { critical: 0, high: 1, actionRequired: 0 },
            }),
          },
        },
      ],
    })
      .overrideGuard(AuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(BusinessGuard).useValue({ canActivate: () => true })
      .compile();

    controller = module.get(FlowSignalController);
    flowSignalService = module.get(FlowSignalService);
    roleFlowService = module.get(RoleFlowService);
  });

  it('lists signals with filters', async () => {
    const result = await controller.list('biz_1', FlowType.FINANCIAL, 'invoice.overdue');

    expect(flowSignalService.list).toHaveBeenCalledWith(
      'biz_1',
      expect.objectContaining({ flows: FlowType.FINANCIAL, type: 'invoice.overdue' }),
    );
    expect(result).toEqual({ items: [], total: 0 });
  });

  it('returns role queue', async () => {
    const result = await controller.getRoleQueue('biz_1', 'ACCOUNTS_RECEIVABLE_CLERK');

    expect(roleFlowService.getRoleQueue).toHaveBeenCalledWith('biz_1', 'ACCOUNTS_RECEIVABLE_CLERK');
    expect(result.roleKey).toBe('ACCOUNTS_RECEIVABLE_CLERK');
  });

  it('resolves a signal', async () => {
    const result = await controller.resolve('biz_1', 'sig_1');

    expect(flowSignalService.markResolved).toHaveBeenCalledWith('biz_1', 'sig_1');
    expect(result.status).toBe('RESOLVED');
  });
});
