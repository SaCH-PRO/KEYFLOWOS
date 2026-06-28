import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyCortexApprovalOrchestratorService } from './key-cortex-approval-orchestrator.service';

function makeProposal(overrides?: Partial<any>) {
  return {
    id: 'prop_1',
    businessId: 'biz_1',
    status: 'PENDING',
    riskLevel: 'MEDIUM',
    actionType: 'EXECUTE_TOOL',
    sourceType: 'KEY_CORTEX',
    title: 'Execute crm.create_contact',
    payload: { toolName: 'crm.create_contact' },
    correlationId: 'corr_1',
    commandId: 'cmd_1',
    sessionId: 'sess_1',
    ...overrides,
  };
}

function makeMocks() {
  return {
    proposalService: {
      create: vi.fn().mockResolvedValue(makeProposal()),
      get: vi.fn().mockResolvedValue(makeProposal()),
      getById: vi.fn().mockResolvedValue(makeProposal()),
      approve: vi.fn().mockResolvedValue(makeProposal({ status: 'APPROVED', approvedBy: 'user_1' })),
      reject: vi.fn().mockResolvedValue(makeProposal({ status: 'REJECTED', rejectedBy: 'user_1' })),
      execute: vi.fn().mockResolvedValue(makeProposal({ status: 'EXECUTED', executedBy: 'key_ai' })),
    },
    audit: {
      emit: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe('KeyCortexApprovalOrchestratorService', () => {
  let service: KeyCortexApprovalOrchestratorService;
  let mocks: ReturnType<typeof makeMocks>;

  beforeEach(() => {
    mocks = makeMocks();
    service = new KeyCortexApprovalOrchestratorService(
      mocks.proposalService as any,
      mocks.audit as any,
    );
  });

  describe('propose', () => {
    it('creates a KeyActionProposal with tool details and lineage', async () => {
      const result = await service.propose({
        businessId: 'biz_1',
        userId: 'user_1',
        module: 'crm',
        toolName: 'create_contact',
        rationale: 'New lead from website',
        parameters: { name: 'Alice' },
        correlationId: 'corr_1',
        commandId: 'cmd_1',
        sessionId: 'sess_1',
      });

      expect(mocks.proposalService.create).toHaveBeenCalledWith(
        'biz_1',
        expect.objectContaining({
          sourceType: 'KEY_CORTEX',
          actionType: 'EXECUTE_TOOL',
          module: 'crm',
          toolName: 'create_contact',
          title: 'Execute crm.create_contact',
          rationale: 'New lead from website',
          inputPayload: { name: 'Alice' },
          correlationId: 'corr_1',
          commandId: 'cmd_1',
          sessionId: 'sess_1',
        }),
        'user_1',
      );
      expect(result.id).toBe('prop_1');
    });

    it('emits a GOVERNANCE_DECISION business event', async () => {
      await service.propose({
        businessId: 'biz_1',
        module: 'crm',
        toolName: 'create_contact',
      });

      expect(mocks.audit.emit).toHaveBeenCalledWith(
        'GOVERNANCE_DECISION',
        'propose',
        'key_action_proposal',
        'prop_1',
        expect.objectContaining({ businessId: 'biz_1', proposalId: 'prop_1' }),
        undefined,
        expect.objectContaining({ status: 'PENDING' }),
      );
    });
  });

  describe('approve', () => {
    it('approves and emits an audit event', async () => {
      const result = await service.approve({
        proposalId: 'prop_1',
        userId: 'user_1',
        businessId: 'biz_1',
      });

      expect(mocks.proposalService.approve).toHaveBeenCalledWith('biz_1', 'prop_1', 'user_1');
      expect(mocks.audit.emit).toHaveBeenCalledWith(
        'GOVERNANCE_DECISION',
        'approve',
        'key_action_proposal',
        'prop_1',
        expect.objectContaining({ actorType: 'human', actorId: 'user_1', source: 'web' }),
        { status: 'PENDING' },
        expect.objectContaining({ status: 'APPROVED' }),
      );
      expect(result.status).toBe('APPROVED');
    });

    it('auto-executes when autoExecute is true', async () => {
      const result = await service.approve({
        proposalId: 'prop_1',
        userId: 'user_1',
        businessId: 'biz_1',
        autoExecute: true,
      });

      expect(mocks.proposalService.execute).toHaveBeenCalledWith(
        'biz_1',
        'prop_1',
        'user_1',
        true,
        true,
      );
      expect(result.status).toBe('EXECUTED');
    });
  });

  describe('reject', () => {
    it('rejects and emits an audit event', async () => {
      const result = await service.reject({
        proposalId: 'prop_1',
        userId: 'user_1',
        businessId: 'biz_1',
        reason: 'Too risky',
      });

      expect(mocks.proposalService.reject).toHaveBeenCalledWith('biz_1', 'prop_1', 'user_1', 'Too risky');
      expect(mocks.audit.emit).toHaveBeenCalledWith(
        'GOVERNANCE_DECISION',
        'reject',
        'key_action_proposal',
        'prop_1',
        expect.objectContaining({ metadata: { reason: 'Too risky' } }),
        { status: 'PENDING' },
        expect.objectContaining({ status: 'REJECTED' }),
      );
      expect(result.status).toBe('REJECTED');
    });
  });

  describe('executeApproved', () => {
    it('executes an approved proposal and emits audit', async () => {
      mocks.proposalService.getById.mockResolvedValue(makeProposal({ status: 'APPROVED' }));

      const result = await service.executeApproved({
        proposalId: 'prop_1',
        businessId: 'biz_1',
      });

      expect(mocks.proposalService.execute).toHaveBeenCalledWith(
        'biz_1',
        'prop_1',
        'key_ai',
        true,
        true,
      );
      expect(mocks.audit.emit).toHaveBeenCalledWith(
        'ACTION_EXECUTED',
        'execute',
        'key_action_proposal',
        'prop_1',
        expect.anything(),
        { status: 'APPROVED' },
        expect.objectContaining({ status: 'EXECUTED' }),
      );
      expect(result.status).toBe('EXECUTED');
    });
  });
});
