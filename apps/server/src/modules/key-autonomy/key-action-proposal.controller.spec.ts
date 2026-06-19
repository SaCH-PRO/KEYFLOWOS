import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { KeyActionProposalController } from './key-action-proposal.controller';
import { KeyActionProposalService } from './key-action-proposal.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard } from '../../core/auth/module-scope.guard';

describe('KeyActionProposalController', () => {
  let controller: KeyActionProposalController;
  let service: KeyActionProposalService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [KeyActionProposalController],
      providers: [
        {
          provide: KeyActionProposalService,
          useValue: {
            list: vi.fn(async () => [{ id: 'prop_1' }]),
            create: vi.fn(async () => ({ id: 'prop_1', status: 'PENDING' })),
            get: vi.fn(async () => ({ id: 'prop_1' })),
            approve: vi.fn(async () => ({ id: 'prop_1', status: 'APPROVED' })),
            reject: vi.fn(async () => ({ id: 'prop_1', status: 'REJECTED' })),
            cancel: vi.fn(async () => ({ id: 'prop_1', status: 'CANCELLED' })),
            execute: vi.fn(async () => ({ id: 'prop_1', status: 'EXECUTED' })),
          },
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(BusinessGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ModuleScopeGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(KeyActionProposalController);
    service = moduleRef.get(KeyActionProposalService);
  });

  it('lists proposals with query filters', async () => {
    const result = await controller.list('biz_1', 'PENDING', 'EXECUTIVE_MODE', 'CREATE_TASK');
    expect(service.list).toHaveBeenCalledWith('biz_1', { status: 'PENDING', sourceType: 'EXECUTIVE_MODE', actionType: 'CREATE_TASK' });
    expect(result).toEqual([{ id: 'prop_1' }]);
  });

  it('creates a proposal', async () => {
    const body = {
      sourceType: 'EXECUTIVE_MODE' as const,
      sourceMode: 'CFO',
      title: 'Complete Financial DNA',
      actionType: 'CREATE_TASK' as const,
    };
    const result = await controller.create('biz_1', body, { user: { id: 'user_1' } });
    expect(service.create).toHaveBeenCalledWith('biz_1', body, 'user_1');
    expect(result.status).toBe('PENDING');
  });

  it('approves a proposal', async () => {
    const result = await controller.approve('biz_1', 'prop_1', { user: { id: 'user_1' } });
    expect(service.approve).toHaveBeenCalledWith('biz_1', 'prop_1', 'user_1');
    expect(result.status).toBe('APPROVED');
  });

  it('rejects a proposal with a reason', async () => {
    const result = await controller.reject('biz_1', 'prop_1', { reason: 'Not now' }, { user: { id: 'user_1' } });
    expect(service.reject).toHaveBeenCalledWith('biz_1', 'prop_1', 'user_1', 'Not now');
    expect(result.status).toBe('REJECTED');
  });

  it('executes a proposal with confirmation', async () => {
    const result = await controller.execute('biz_1', 'prop_1', { confirm: true }, { user: { id: 'user_1' } });
    expect(service.execute).toHaveBeenCalledWith('biz_1', 'prop_1', 'user_1', true);
    expect(result.status).toBe('EXECUTED');
  });
});
