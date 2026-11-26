import { describe, expect, it, vi } from 'vitest';
import { KeyCortexOperationalSelfModelService } from './key-cortex-operational-self-model.service';

function makeContracts() {
  return {
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
}

function makeMetacognition(overrides?: Partial<{
  recommendationAccuracy: number;
  actionSuccessRate: number;
  userApprovalRate: number;
  predictionAccuracy: number;
  knowledgeGaps: string[];
  dataGaps: string[];
}>) {
  return {
    buildSelfModel: vi.fn().mockResolvedValue({
      capabilities: [],
      recommendationAccuracy: 0.8,
      actionSuccessRate: 0.75,
      userApprovalRate: 0.9,
      predictionAccuracy: 0.7,
      confidenceCalibration: { whenKEYSays90: 0.9, whenKEYSays70: 0.7, whenKEYSays50: 0.5 },
      knowledgeGaps: ['tax law'],
      dataGaps: ['bank feed'],
      ...overrides,
    }),
  };
}

describe('KeyCortexOperationalSelfModelService', () => {
  it('projects canonical owners with uppercase goal statuses and riskLevel + byRiskLevel (D-141)', async () => {
    const goalFindMany = vi.fn().mockResolvedValue([
      {
        id: 'goal_1',
        title: 'Grow revenue',
        status: 'ACTIVE',
        priority: 10,
        targetDate: new Date('2026-12-31T00:00:00Z'),
      },
      {
        id: 'goal_2',
        title: 'Launch partner tier',
        status: 'PLANNED',
        priority: 5,
        targetDate: null,
      },
    ]);
    const proposalFindMany = vi.fn().mockResolvedValue([
      {
        id: 'proposal_1',
        status: 'PENDING',
        capabilityName: 'finance_money_moves',
        riskLevel: 'HIGH',
        createdAt: new Date('2026-10-06T00:00:00Z'),
      },
      {
        id: 'proposal_2',
        status: 'PENDING',
        capabilityName: 'commerce_refund_invoice',
        riskLevel: 'HIGH',
        createdAt: new Date('2026-10-05T00:00:00Z'),
      },
      {
        id: 'proposal_3',
        status: 'PENDING',
        capabilityName: 'create_task',
        riskLevel: 'LOW',
        createdAt: new Date('2026-10-04T00:00:00Z'),
      },
    ]);

    const service = new KeyCortexOperationalSelfModelService(
      { client: { aiGoal: { findMany: goalFindMany }, keyActionProposal: { findMany: proposalFindMany } } } as any,
      makeContracts() as any,
      makeMetacognition() as any,
    );
    const model = await service.build('biz_1', 'user_1');

    expect(goalFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          businessId: 'biz_1',
          status: { in: ['ACTIVE', 'PLANNED', 'IN_PROGRESS'] },
        },
      }),
    );
    expect(proposalFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: 'biz_1', status: 'PENDING' },
        select: expect.objectContaining({ riskLevel: true }),
      }),
    );
    expect(proposalFindMany.mock.calls[0][0].select).not.toHaveProperty('riskTier');

    expect(model.identity).toEqual({ agent: 'KEY', stableAcrossProviders: true });
    expect(model.scope).toEqual({ businessId: 'biz_1', userId: 'user_1' });
    expect(model.capabilities.total).toBe(2);
    expect(model.goals).toHaveLength(2);
    expect(model.goals?.[0]).toEqual({
      id: 'goal_1',
      title: 'Grow revenue',
      status: 'ACTIVE',
      priority: 10,
      targetDate: '2026-12-31T00:00:00.000Z',
    });
    expect(model.pendingDecisions?.[0]).toEqual({
      id: 'proposal_1',
      status: 'PENDING',
      capabilityName: 'finance_money_moves',
      riskLevel: 'HIGH',
      createdAt: '2026-10-06T00:00:00.000Z',
    });
    expect(model.pendingDecisions?.[0]).not.toHaveProperty('riskTier');
    expect(model.byRiskLevel).toEqual({ HIGH: 2, LOW: 1 });
    expect(model.sections).toEqual({
      goals: { status: 'available' },
      pendingDecisions: { status: 'available' },
      metacognition: { status: 'available' },
    });
    expect(model.unavailableSections).toEqual([]);
    expect(model.limitations.join(' ')).toContain('health-aware action admission');
    expect(model).not.toHaveProperty('provider');
    expect(model).not.toHaveProperty('authorityGrant');
  });

  it('tenant-scopes every persistent read', async () => {
    const goalFindMany = vi.fn().mockResolvedValue([]);
    const proposalFindMany = vi.fn().mockResolvedValue([]);
    const metacognition = makeMetacognition({ knowledgeGaps: [], dataGaps: [] });

    const service = new KeyCortexOperationalSelfModelService(
      { client: { aiGoal: { findMany: goalFindMany }, keyActionProposal: { findMany: proposalFindMany } } } as any,
      { stats: () => ({ total: 0, byOwner: {}, byFamily: {}, byRiskTier: {} }), list: () => [] } as any,
      metacognition as any,
    );

    const model = await service.build('biz_tenant');

    expect(goalFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ businessId: 'biz_tenant' }),
      }),
    );
    expect(proposalFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ businessId: 'biz_tenant' }),
      }),
    );
    expect(metacognition.buildSelfModel).toHaveBeenCalledWith('biz_tenant');
    expect(model.scope).toEqual({ businessId: 'biz_tenant' });
    expect(model.goals).toEqual([]);
    expect(model.pendingDecisions).toEqual([]);
    expect(model.byRiskLevel).toEqual({});
    expect(model.sections).toEqual({
      goals: { status: 'available' },
      pendingDecisions: { status: 'available' },
      metacognition: { status: 'available' },
    });
  });

  it('surfaces goals failure as unavailable (null, not []) while sibling sections remain available', async () => {
    const prismaError = Object.assign(
      new Error('SELECT * FROM ai_goals password=raw_secret'),
      { code: 'P2024' },
    );
    const service = new KeyCortexOperationalSelfModelService(
      {
        client: {
          aiGoal: { findMany: vi.fn().mockRejectedValue(prismaError) },
          keyActionProposal: {
            findMany: vi.fn().mockResolvedValue([
              {
                id: 'p1',
                status: 'PENDING',
                capabilityName: 'create_task',
                riskLevel: 'MEDIUM',
                createdAt: new Date('2026-10-06T00:00:00Z'),
              },
            ]),
          },
        },
      } as any,
      makeContracts() as any,
      makeMetacognition() as any,
    );

    const model = await service.build('biz_1');

    expect(model.goals).toBeNull();
    expect(model.sections.goals).toEqual({
      status: 'unavailable',
      error: 'goals data source unavailable (Prisma P2024)',
    });
    expect(model.unavailableSections).toEqual(['goals']);
    expect(model.limitations.join(' ')).toContain('goals');
    expect(model.limitations.join(' ')).toContain('unavailable');
    expect(JSON.stringify(model)).not.toContain('raw_secret');
    expect(JSON.stringify(model)).not.toContain('SELECT * FROM ai_goals');

    // Sibling sections remain available
    expect(model.sections.pendingDecisions).toEqual({ status: 'available' });
    expect(model.pendingDecisions).toHaveLength(1);
    expect(model.byRiskLevel).toEqual({ MEDIUM: 1 });
    expect(model.sections.metacognition).toEqual({ status: 'available' });
    expect(model.metacognition).not.toBeNull();
  });

  it('surfaces pendingDecisions failure as unavailable (null, not []) while sibling sections remain available', async () => {
    const service = new KeyCortexOperationalSelfModelService(
      {
        client: {
          aiGoal: {
            findMany: vi.fn().mockResolvedValue([
              { id: 'g1', title: 'Ship v1', status: 'IN_PROGRESS', priority: 9, targetDate: null },
            ]),
          },
          keyActionProposal: {
            findMany: vi.fn().mockRejectedValue(new Error('connection reset host=db.internal')),
          },
        },
      } as any,
      makeContracts() as any,
      makeMetacognition() as any,
    );

    const model = await service.build('biz_1');

    expect(model.pendingDecisions).toBeNull();
    expect(model.byRiskLevel).toBeNull();
    expect(model.sections.pendingDecisions).toEqual({
      status: 'unavailable',
      error: 'pendingDecisions data source unavailable',
    });
    expect(model.unavailableSections).toEqual(['pendingDecisions']);
    expect(model.limitations.join(' ')).toContain('pendingDecisions');
    expect(JSON.stringify(model)).not.toContain('db.internal');

    expect(model.sections.goals).toEqual({ status: 'available' });
    expect(model.goals).toHaveLength(1);
    expect(model.sections.metacognition).toEqual({ status: 'available' });
    expect(model.metacognition).not.toBeNull();
  });

  it('surfaces metacognition failure as unavailable (null) while goals and pendingDecisions remain available', async () => {
    const service = new KeyCortexOperationalSelfModelService(
      {
        client: {
          aiGoal: {
            findMany: vi.fn().mockResolvedValue([
              { id: 'g1', title: 'Ship v1', status: 'ACTIVE', priority: 9, targetDate: null },
            ]),
          },
          keyActionProposal: {
            findMany: vi.fn().mockResolvedValue([
              {
                id: 'p1',
                status: 'PENDING',
                capabilityName: 'create_task',
                riskLevel: 'LOW',
                createdAt: new Date('2026-10-06T00:00:00Z'),
              },
            ]),
          },
        },
      } as any,
      makeContracts() as any,
      { buildSelfModel: vi.fn().mockRejectedValue(new Error('timeout token=secret_meta')) } as any,
    );

    const model = await service.build('biz_1');

    expect(model.metacognition).toBeNull();
    expect(model.sections.metacognition).toEqual({
      status: 'unavailable',
      error: 'metacognition data source unavailable',
    });
    expect(model.unavailableSections).toEqual(['metacognition']);
    expect(model.limitations.join(' ')).toContain('metacognition');
    expect(JSON.stringify(model)).not.toContain('secret_meta');

    expect(model.sections.goals).toEqual({ status: 'available' });
    expect(model.goals).toHaveLength(1);
    expect(model.sections.pendingDecisions).toEqual({ status: 'available' });
    expect(model.byRiskLevel).toEqual({ LOW: 1 });
  });

  it('surfaces all three sections unavailable simultaneously without throwing', async () => {
    const service = new KeyCortexOperationalSelfModelService(
      {
        client: {
          aiGoal: { findMany: vi.fn().mockRejectedValue(new Error('db down')) },
          keyActionProposal: { findMany: vi.fn().mockRejectedValue(new Error('db down')) },
        },
      } as any,
      makeContracts() as any,
      { buildSelfModel: vi.fn().mockRejectedValue(new Error('db down')) } as any,
    );

    const model = await service.build('biz_1');

    expect(model.goals).toBeNull();
    expect(model.pendingDecisions).toBeNull();
    expect(model.byRiskLevel).toBeNull();
    expect(model.metacognition).toBeNull();
    expect(model.unavailableSections).toEqual([
      'goals',
      'pendingDecisions',
      'metacognition',
    ]);
    expect(model.sections.goals.status).toBe('unavailable');
    expect(model.sections.pendingDecisions.status).toBe('unavailable');
    expect(model.sections.metacognition.status).toBe('unavailable');
    expect(model.capabilities.total).toBe(2);
  });
});
