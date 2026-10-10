import { describe, expect, it, vi } from 'vitest';
import { KeyCortexOperationalSelfModelService } from './key-cortex-operational-self-model.service';

describe('KeyCortexOperationalSelfModelService', () => {
  it('projects canonical owners without making provider identity or granting authority', async () => {
    const prisma = {
      client: {
        aiGoal: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'goal_1',
              title: 'Grow revenue',
              status: 'active',
              priority: 2,
              targetDate: null,
            },
          ]),
        },
        keyActionProposal: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'proposal_1',
              status: 'PENDING',
              capabilityName: 'finance_money_moves',
              riskTier: 1,
              createdAt: new Date('2026-10-06T00:00:00Z'),
            },
          ]),
        },
      },
    };
    const contracts = {
      stats: vi.fn().mockReturnValue({
        total: 2,
        byOwner: { money: 2 },
        byFamily: { read: 2 },
        byRiskTier: { '1': 2 },
      }),
      list: vi.fn().mockReturnValue([
        { name: 'finance_safe_to_spend', ownerModule: 'money', family: 'read', riskTier: 1 },
        { name: 'finance_money_moves', ownerModule: 'money', family: 'read', riskTier: 1 },
      ]),
    };
    const metacognition = {
      buildSelfModel: vi.fn().mockResolvedValue({
        capabilities: [],
        recommendationAccuracy: 0.8,
        actionSuccessRate: 0.75,
        userApprovalRate: 0.9,
        predictionAccuracy: 0.7,
        confidenceCalibration: { whenKEYSays90: 0.9, whenKEYSays70: 0.7, whenKEYSays50: 0.5 },
        knowledgeGaps: ['tax law'],
        dataGaps: ['bank feed'],
      }),
    };

    const service = new KeyCortexOperationalSelfModelService(
      prisma as any,
      contracts as any,
      metacognition as any,
    );
    const model = await service.build('biz_1', 'user_1');

    expect(model.identity).toEqual({ agent: 'KEY', stableAcrossProviders: true });
    expect(model.scope).toEqual({ businessId: 'biz_1', userId: 'user_1' });
    expect(model.capabilities.total).toBe(2);
    expect(model.goals[0]?.id).toBe('goal_1');
    expect(model.pendingDecisions[0]?.id).toBe('proposal_1');
    expect(model.limitations.join(' ')).toContain('health-aware action admission');
    expect(model).not.toHaveProperty('provider');
    expect(model).not.toHaveProperty('authorityGrant');
  });

  it('tenant-scopes every persistent read', async () => {
    const goalFindMany = vi.fn().mockResolvedValue([]);
    const proposalFindMany = vi.fn().mockResolvedValue([]);
    const service = new KeyCortexOperationalSelfModelService(
      { client: { aiGoal: { findMany: goalFindMany }, keyActionProposal: { findMany: proposalFindMany } } } as any,
      { stats: () => ({ total: 0, byOwner: {}, byFamily: {}, byRiskTier: {} }), list: () => [] } as any,
      { buildSelfModel: vi.fn().mockResolvedValue({
        capabilities: [], recommendationAccuracy: 0, actionSuccessRate: 0,
        userApprovalRate: 0, predictionAccuracy: 0,
        confidenceCalibration: { whenKEYSays90: 0, whenKEYSays70: 0, whenKEYSays50: 0 },
        knowledgeGaps: [], dataGaps: [],
      }) } as any,
    );

    await service.build('biz_tenant');

    expect(goalFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ businessId: 'biz_tenant' }),
    }));
    expect(proposalFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ businessId: 'biz_tenant' }),
    }));
  });
});
