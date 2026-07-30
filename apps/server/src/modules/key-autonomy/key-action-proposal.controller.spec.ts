import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { KeyActionProposalController } from './key-action-proposal.controller';
import { KeyActionProposalService } from './key-action-proposal.service';
import { KeyCortexApprovalOrchestratorService } from '../key-cortex/key-cortex-approval-orchestrator.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard } from '../../core/auth/module-scope.guard';

describe('KeyActionProposalController', () => {
  let controller: KeyActionProposalController;
  let service: KeyActionProposalService;
  let orchestrator: KeyCortexApprovalOrchestratorService;

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
            cancel: vi.fn(async () => ({ id: 'prop_1', status: 'CANCELLED' })),
          },
        },
        {
          provide: KeyCortexApprovalOrchestratorService,
          useValue: {
            propose: vi.fn(async () => ({ id: 'prop_1', status: 'PENDING' })),
            approve: vi.fn(async () => ({ id: 'prop_1', status: 'APPROVED' })),
            reject: vi.fn(async () => ({ id: 'prop_1', status: 'REJECTED' })),
            executeApproved: vi.fn(async () => ({ id: 'prop_1', status: 'EXECUTED' })),
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
    orchestrator = moduleRef.get(KeyCortexApprovalOrchestratorService);
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
    expect(orchestrator.propose).toHaveBeenCalledWith({
      businessId: 'biz_1',
      userId: 'user_1',
      sourceType: body.sourceType,
      sourceId: undefined,
      sourceMode: body.sourceMode,
      actionType: body.actionType,
      title: body.title,
      summary: undefined,
      rationale: undefined,
      evidence: undefined,
      parameters: undefined,
    });
    expect(result.status).toBe('PENDING');
  });

  it('approves a proposal', async () => {
    const result = await controller.approve('biz_1', 'prop_1', { user: { id: 'user_1' } });
    expect(orchestrator.approve).toHaveBeenCalledWith({ businessId: 'biz_1', proposalId: 'prop_1', userId: 'user_1' });
    expect(result.status).toBe('APPROVED');
  });

  it('rejects a proposal with a reason', async () => {
    const result = await controller.reject('biz_1', 'prop_1', { reason: 'Not now' }, { user: { id: 'user_1' } });
    expect(orchestrator.reject).toHaveBeenCalledWith({ businessId: 'biz_1', proposalId: 'prop_1', userId: 'user_1', reason: 'Not now' });
    expect(result.status).toBe('REJECTED');
  });

  it('executes a proposal with confirmation', async () => {
    const result = await controller.execute('biz_1', 'prop_1', { confirm: true }, { user: { id: 'user_1' } });
    expect(orchestrator.executeApproved).toHaveBeenCalledWith({ businessId: 'biz_1', proposalId: 'prop_1', userId: 'user_1' });
    expect(result.status).toBe('EXECUTED');
  });
});
