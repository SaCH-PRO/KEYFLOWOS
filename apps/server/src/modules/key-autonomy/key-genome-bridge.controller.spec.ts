import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { KeyGenomeBridgeController } from './key-genome-bridge.controller';
import { GenomeRecommendationActionBridgeService } from './genome-recommendation-action-bridge.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';

describe('KeyGenomeBridgeController', () => {
  let controller: KeyGenomeBridgeController;
  let bridgeService: GenomeRecommendationActionBridgeService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [KeyGenomeBridgeController],
      providers: [
        {
          provide: GenomeRecommendationActionBridgeService,
          useValue: {
            previewRecommendationAction: vi.fn(async () => ({
              recommendationId: 'rec_1',
              actionKind: 'KEY_ACTION_PROPOSAL',
              title: 'Action plan',
              summary: 'Summary',
              rationale: 'Rationale',
              riskLevel: 'LOW',
              requiresApproval: true,
              evidenceIds: [],
              payload: {},
            })),
            bridgeRecommendation: vi.fn(async () => ({
              recommendationId: 'rec_1',
              actionKind: 'KEY_ACTION_PROPOSAL',
              createdEntityType: 'key_action_proposal',
              createdEntityId: 'prop_1',
              status: 'CREATED',
              message: 'Created',
            })),
          },
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(BusinessGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(KeyGenomeBridgeController);
    bridgeService = moduleRef.get(GenomeRecommendationActionBridgeService);
  });

  it('returns action preview', async () => {
    const result = await controller.previewRecommendationAction('biz_1', 'rec_1');
    expect(bridgeService.previewRecommendationAction).toHaveBeenCalledWith('biz_1', 'rec_1');
    expect(result.recommendationId).toBe('rec_1');
  });

  it('bridges recommendation with confirmation', async () => {
    const result = await controller.bridgeRecommendationAction('biz_1', 'rec_1', {
      actionKind: 'KEY_ACTION_PROPOSAL',
      confirmBridge: true,
    });
    expect(bridgeService.bridgeRecommendation).toHaveBeenCalledWith({
      businessId: 'biz_1',
      recommendationId: 'rec_1',
      actionKind: 'KEY_ACTION_PROPOSAL',
      confirmBridge: true,
    });
    expect(result.status).toBe('CREATED');
  });
});
