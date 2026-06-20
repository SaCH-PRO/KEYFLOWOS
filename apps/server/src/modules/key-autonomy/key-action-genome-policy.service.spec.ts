import { describe, expect, it, vi } from 'vitest';
import { KeyActionGenomePolicyService } from './key-action-genome-policy.service';
import type { KeyActionProposalData } from './key-action-proposal.types';

function makeReadiness(overrides: Partial<ReturnType<KeyActionGenomePolicyService['evaluateExecution']> extends Promise<infer T> ? T : never> = {}) {
  return {
    businessId: 'biz_1',
    module: 'sop',
    readinessScore: 80,
    requiredFacts: [],
    missingFacts: [],
    optionalFacts: [],
    blockedReasons: [],
    recommendedSetupActions: [],
    automationAllowed: true,
    riskLevel: 'LOW' as const,
    lastComputedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeProposal(actionType: KeyActionProposalData['actionType']): KeyActionProposalData {
  return {
    id: 'prop_1',
    businessId: 'biz_1',
    sourceType: 'EXECUTIVE_MODE',
    sourceMode: 'COO',
    title: 'Action',
    actionType,
    evidence: [],
    payload: {},
    riskLevel: 'LOW',
    status: 'APPROVED',
    requiresApproval: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeService(readiness?: ReturnType<typeof makeReadiness>) {
  const genomeReadiness = {
    getReadiness: vi.fn().mockResolvedValue(readiness ?? null),
  };
  const service = new KeyActionGenomePolicyService(genomeReadiness as any);
  return { service, genomeReadiness };
}

describe('KeyActionGenomePolicyService', () => {
  it('allows actions with no module mapping', async () => {
    const { service } = makeService();
    const decision = await service.evaluateExecution('biz_1', makeProposal('OPEN_GENOME'));
    expect(decision.allowed).toBe(true);
    expect(decision.module).toBeNull();
  });

  it('blocks when readiness is missing', async () => {
    const { service } = makeService();
    const decision = await service.evaluateExecution('biz_1', makeProposal('CREATE_TASK'));
    expect(decision.allowed).toBe(false);
    expect(decision.module).toBe('sop');
  });

  it('blocks when automationAllowed is false', async () => {
    const { service } = makeService(makeReadiness({ automationAllowed: false, readinessScore: 30, riskLevel: 'HIGH' }));
    const decision = await service.evaluateExecution('biz_1', makeProposal('CREATE_TASK'));
    expect(decision.allowed).toBe(false);
    expect(decision.blockedReasons.length).toBe(0);
  });

  it('blocks when risk is critical', async () => {
    const { service } = makeService(makeReadiness({ riskLevel: 'CRITICAL', automationAllowed: true }));
    const decision = await service.evaluateExecution('biz_1', makeProposal('CREATE_TASK'));
    expect(decision.allowed).toBe(false);
  });

  it('blocks when readiness score is below 50', async () => {
    const { service } = makeService(makeReadiness({ readinessScore: 40, automationAllowed: true, riskLevel: 'MEDIUM' }));
    const decision = await service.evaluateExecution('biz_1', makeProposal('CREATE_TASK'));
    expect(decision.allowed).toBe(false);
  });

  it('requires extra confirmation when readiness is below 70', async () => {
    const { service } = makeService(makeReadiness({ readinessScore: 60, automationAllowed: true, riskLevel: 'MEDIUM' }));
    const decision = await service.evaluateExecution('biz_1', makeProposal('CREATE_TASK'));
    expect(decision.allowed).toBe(true);
    expect(decision.requiresExtraConfirmation).toBe(true);
  });

  it('requires extra confirmation when risk is high', async () => {
    const { service } = makeService(makeReadiness({ readinessScore: 80, automationAllowed: true, riskLevel: 'HIGH' }));
    const decision = await service.evaluateExecution('biz_1', makeProposal('CREATE_TASK'));
    expect(decision.allowed).toBe(true);
    expect(decision.requiresExtraConfirmation).toBe(true);
  });

  it('allows execution when readiness is healthy', async () => {
    const { service } = makeService(makeReadiness({ readinessScore: 80, automationAllowed: true, riskLevel: 'LOW' }));
    const decision = await service.evaluateExecution('biz_1', makeProposal('CREATE_TASK'));
    expect(decision.allowed).toBe(true);
    expect(decision.requiresExtraConfirmation).toBe(false);
  });
});
