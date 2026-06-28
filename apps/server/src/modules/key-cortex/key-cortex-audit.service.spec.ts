import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyCortexAuditService } from './key-cortex-audit.service';

function makeMocks() {
  return {
    businessEventService: {
      emit: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe('KeyCortexAuditService', () => {
  let service: KeyCortexAuditService;
  let mocks: ReturnType<typeof makeMocks>;

  beforeEach(() => {
    mocks = makeMocks();
    service = new KeyCortexAuditService(mocks.businessEventService as any);
  });

  it('emits a business event with identity lineage', async () => {
    await service.emit(
      'GOVERNANCE_DECISION',
      'propose',
      'key_action_proposal',
      'prop_1',
      {
        businessId: 'biz_1',
        actorType: 'ai',
        actorId: 'key_ai',
        source: 'ai',
        proposalId: 'prop_1',
        sessionId: 'sess_1',
        commandId: 'cmd_1',
        correlationId: 'corr_1',
        metadata: { toolName: 'crm.create_contact' },
      },
      { status: 'PENDING' },
      { status: 'PENDING', riskLevel: 'MEDIUM' },
    );

    expect(mocks.businessEventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'biz_1',
        eventType: 'GOVERNANCE_DECISION',
        action: 'propose',
        subjectType: 'key_action_proposal',
        subjectId: 'prop_1',
        actorType: 'ai',
        actorId: 'key_ai',
        source: 'ai',
        approvalId: 'prop_1',
        sessionId: 'sess_1',
        commandId: 'cmd_1',
        correlationId: 'corr_1',
        before: { status: 'PENDING' },
        after: { status: 'PENDING', riskLevel: 'MEDIUM' },
      }),
    );
  });

  it('defaults actor and source to ai when not provided', async () => {
    await service.emit(
      'ACTION_EXECUTED',
      'execute',
      'key_action_proposal',
      'prop_1',
      { businessId: 'biz_1' },
    );

    expect(mocks.businessEventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'ai',
        actorId: 'key_ai',
        source: 'ai',
      }),
    );
  });
});
