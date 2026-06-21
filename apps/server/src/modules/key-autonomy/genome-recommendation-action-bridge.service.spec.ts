import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GenomeRecommendationActionBridgeService } from './genome-recommendation-action-bridge.service';
import type { GenomeRecommendationData, GenomeExperimentData } from '../business-genome/key-genome/key-genome.types';

function makeRecommendation(overrides: Partial<GenomeRecommendationData> = {}): GenomeRecommendationData {
  return {
    id: 'rec_1',
    businessId: 'biz_1',
    domain: 'VISION_IDENTITY',
    title: 'Provide blocking fact: identity.business_name',
    insight: 'Readiness is low because identity.business_name is missing.',
    diagnosis: 'Missing blocking fact: Business name',
    recommendation: 'Capture the identity.business_name fact in the Business Genome.',
    expectedGain: 'Unlocks key_inbox.',
    expectedGainScore: 85,
    riskLevel: 'HIGH',
    effortLevel: 'LOW',
    confidence: 0.75,
    evidenceIds: ['ev_1'],
    suggestedExperimentId: null,
    status: 'ACCEPTED',
    createdAt: new Date().toISOString(),
    reviewedAt: new Date().toISOString(),
    outcomeTrackedAt: null,
    ...overrides,
  };
}

function makeService() {
  const storedProposals: any[] = [];
  const storedExperiments: any[] = [];
  let nextProposalId = 1;
  let nextExperimentId = 1;

  const prisma = {
    client: {
      keyActionProposal: {
        findMany: vi.fn(async () => storedProposals),
      },
      genomeRecommendation: {
        update: vi.fn(async ({ where, data }: any) => {
          const rec = recommendations.find((r) => r.id === where.id);
          if (!rec) throw new Error('Not found');
          Object.assign(rec, data);
          return rec;
        }),
      },
      genomeExperiment: {
        create: vi.fn(async ({ data }: any) => {
          const row = { id: `exp_${nextExperimentId++}`, ...data, createdAt: new Date(), startedAt: null, endedAt: null, result: null };
          storedExperiments.push(row);
          return row;
        }),
      },
    },
  } as any;

  const recommendations: GenomeRecommendationData[] = [];

  const recommendationService = {
    getRecommendation: vi.fn(async (businessId: string, id: string) => {
      const rec = recommendations.find((r) => r.id === id && r.businessId === businessId);
      if (!rec) throw new Error('Not found');
      return rec;
    }),
    applyRecommendation: vi.fn(async (businessId: string, id: string) => {
      const rec = recommendations.find((r) => r.id === id && r.businessId === businessId);
      if (!rec) throw new Error('Not found');
      rec.status = 'APPLIED';
      rec.outcomeTrackedAt = new Date().toISOString();
      return rec;
    }),
  } as any;

  const experimentService = {
    createExperiment: vi.fn(async (input: any) => {
      const row = {
        id: `exp_${nextExperimentId++}`,
        ...input,
        status: 'PROPOSED',
        createdAt: new Date().toISOString(),
        startedAt: null,
        endedAt: null,
        result: null,
      } as GenomeExperimentData;
      storedExperiments.push(row);
      return row;
    }),
  } as any;

  const proposalService = {
    create: vi.fn(async (businessId: string, input: any) => {
      const row = {
        id: `prop_${nextProposalId++}`,
        businessId,
        ...input,
        status: 'PENDING',
        riskLevel: 'LOW',
        requiresApproval: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      storedProposals.push(row);
      return row;
    }),
  } as any;

  const policyService = {
    requiresApproval: vi.fn((actionType: string) => actionType !== 'OPEN_GENOME'),
    riskLevel: vi.fn(() => 'LOW'),
  } as any;

  const service = new GenomeRecommendationActionBridgeService(
    prisma,
    recommendationService,
    experimentService,
    proposalService,
    policyService,
  );

  return {
    service,
    prisma,
    recommendationService,
    experimentService,
    proposalService,
    policyService,
    recommendations,
    storedProposals,
    storedExperiments,
    addRecommendation: (rec: GenomeRecommendationData) => recommendations.push(rec),
  };
}

describe('GenomeRecommendationActionBridgeService', () => {
  beforeEach(() => {});

  it('preview returns action plan for ACCEPTED recommendation', async () => {
    const { service, addRecommendation } = makeService();
    addRecommendation(makeRecommendation({ status: 'ACCEPTED' }));

    const preview = await service.previewRecommendationAction('biz_1', 'rec_1');

    expect(preview.recommendationId).toBe('rec_1');
    expect(preview.actionKind).toBe('KEY_ACTION_PROPOSAL');
    expect(preview.proposedActionType).toBe('CREATE_TASK');
    expect(preview.requiresApproval).toBe(true);
    expect(preview.evidenceIds).toContain('ev_1');
  });

  it('preview works for ACTIVE recommendation but bridge requires ACCEPTED', async () => {
    const { service, addRecommendation } = makeService();
    addRecommendation(makeRecommendation({ status: 'ACTIVE' }));

    const preview = await service.previewRecommendationAction('biz_1', 'rec_1');
    expect(preview.actionKind).toBe('KEY_ACTION_PROPOSAL');

    await expect(
      service.bridgeRecommendation({ businessId: 'biz_1', recommendationId: 'rec_1', confirmBridge: true }),
    ).rejects.toThrow('ACCEPTED');
  });

  it('DISMISSED recommendation cannot be bridged', async () => {
    const { service, addRecommendation } = makeService();
    addRecommendation(makeRecommendation({ status: 'DISMISSED' }));

    await expect(service.previewRecommendationAction('biz_1', 'rec_1')).rejects.toThrow('ACTIVE or ACCEPTED');
  });

  it('bridge requires confirmBridge=true', async () => {
    const { service, addRecommendation } = makeService();
    addRecommendation(makeRecommendation({ status: 'ACCEPTED' }));

    await expect(
      service.bridgeRecommendation({ businessId: 'biz_1', recommendationId: 'rec_1', confirmBridge: false }),
    ).rejects.toThrow('explicit confirmation');
  });

  it('readiness-gap recommendation becomes CREATE_TASK proposal', async () => {
    const { service, addRecommendation, recommendations, storedProposals } = makeService();
    addRecommendation(makeRecommendation({ title: 'Provide blocking fact: identity.business_name' }));

    const result = await service.bridgeRecommendation({
      businessId: 'biz_1',
      recommendationId: 'rec_1',
      confirmBridge: true,
    });

    expect(result.status).toBe('CREATED');
    expect(result.createdEntityType).toBe('key_action_proposal');
    expect(storedProposals).toHaveLength(1);
    expect(storedProposals[0].actionType).toBe('CREATE_TASK');
    expect(recommendations[0].status).toBe('APPLIED');
  });

  it('customer pattern recommendation becomes experiment', async () => {
    const { service, addRecommendation, recommendations, storedExperiments } = makeService();
    addRecommendation(
      makeRecommendation({
        title: 'Customer pattern in customer',
        domain: 'CUSTOMER_MARKET',
        status: 'ACCEPTED',
      }),
    );

    const result = await service.bridgeRecommendation({
      businessId: 'biz_1',
      recommendationId: 'rec_1',
      confirmBridge: true,
    });

    expect(result.status).toBe('CREATED');
    expect(result.createdEntityType).toBe('genome_experiment');
    expect(storedExperiments).toHaveLength(1);
    expect(recommendations[0].suggestedExperimentId).toBe(storedExperiments[0].id);
    expect(recommendations[0].status).toBe('APPLIED');
  });

  it('existing suggestedExperimentId is reused', async () => {
    const { service, addRecommendation, recommendations, experimentService } = makeService();
    addRecommendation(
      makeRecommendation({
        title: 'Customer pattern in customer',
        domain: 'CUSTOMER_MARKET',
        status: 'ACCEPTED',
        suggestedExperimentId: 'exp_existing',
      }),
    );

    const result = await service.bridgeRecommendation({
      businessId: 'biz_1',
      recommendationId: 'rec_1',
      confirmBridge: true,
    });

    expect(result.status).toBe('ALREADY_EXISTS');
    expect(result.createdEntityId).toBe('exp_existing');
    expect(experimentService.createExperiment).not.toHaveBeenCalled();
    expect(recommendations[0].status).toBe('APPLIED');
  });

  it('bridge is idempotent and does not duplicate proposals', async () => {
    const { service, addRecommendation, storedProposals } = makeService();
    addRecommendation(makeRecommendation({ status: 'ACCEPTED' }));

    const first = await service.bridgeRecommendation({
      businessId: 'biz_1',
      recommendationId: 'rec_1',
      confirmBridge: true,
    });
    const second = await service.bridgeRecommendation({
      businessId: 'biz_1',
      recommendationId: 'rec_1',
      confirmBridge: true,
    });

    expect(first.status).toBe('CREATED');
    expect(second.status).toBe('ALREADY_EXISTS');
    expect(second.createdEntityId).toBe(first.createdEntityId);
    expect(storedProposals).toHaveLength(1);
  });

  it('recommendation is marked APPLIED after successful bridge', async () => {
    const { service, addRecommendation, recommendations } = makeService();
    addRecommendation(makeRecommendation({ status: 'ACCEPTED' }));

    await service.bridgeRecommendation({
      businessId: 'biz_1',
      recommendationId: 'rec_1',
      confirmBridge: true,
    });

    expect(recommendations[0].status).toBe('APPLIED');
  });

  it('recommendation is not marked APPLIED if creation fails', async () => {
    const { service, addRecommendation, recommendations, proposalService } = makeService();
    addRecommendation(makeRecommendation({ status: 'ACCEPTED' }));
    proposalService.create.mockRejectedValue(new Error('DB down'));

    await expect(
      service.bridgeRecommendation({ businessId: 'biz_1', recommendationId: 'rec_1', confirmBridge: true }),
    ).rejects.toThrow('DB down');

    expect(recommendations[0].status).toBe('ACCEPTED');
  });

  it('bridge result includes createdEntityType and createdEntityId', async () => {
    const { service, addRecommendation } = makeService();
    addRecommendation(makeRecommendation({ status: 'ACCEPTED' }));

    const result = await service.bridgeRecommendation({
      businessId: 'biz_1',
      recommendationId: 'rec_1',
      confirmBridge: true,
    });

    expect(result.createdEntityType).toBe('key_action_proposal');
    expect(result.createdEntityId).toMatch(/^prop_/);
    expect(result.actionKind).toBe('KEY_ACTION_PROPOSAL');
  });

  it('created proposal retains recommendationId in payload', async () => {
    const { service, addRecommendation, storedProposals } = makeService();
    addRecommendation(makeRecommendation({ status: 'ACCEPTED' }));

    await service.bridgeRecommendation({
      businessId: 'biz_1',
      recommendationId: 'rec_1',
      confirmBridge: true,
    });

    expect(storedProposals[0].payload).toMatchObject({
      source: 'KEY_GENOME_RECOMMENDATION',
      recommendationId: 'rec_1',
    });
  });

  it('risk pattern recommendation becomes CREATE_TASK proposal', async () => {
    const { service, addRecommendation, storedProposals } = makeService();
    addRecommendation(
      makeRecommendation({
        title: 'Risk pattern in finance',
        domain: 'FINANCIAL',
        status: 'ACCEPTED',
      }),
    );

    await service.bridgeRecommendation({
      businessId: 'biz_1',
      recommendationId: 'rec_1',
      confirmBridge: true,
    });

    expect(storedProposals[0].actionType).toBe('CREATE_TASK');
    expect(storedProposals[0].payload.taskType).toBe('REVIEW_GENOME_SIGNAL_RISK');
  });
});
