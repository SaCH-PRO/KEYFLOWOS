import { describe, it, expect, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { BusinessCommandCenterController } from './business-command-center.controller';
import { BusinessCommandCenterService } from './business-command-center.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard } from '../../core/auth/module-scope.guard';

describe('BusinessCommandCenterController', () => {
  let controller: BusinessCommandCenterController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [BusinessCommandCenterController],
      providers: [
        {
          provide: BusinessCommandCenterService,
          useValue: {
            snapshot: async (businessId: string) => ({
              businessId,
              generatedAt: new Date().toISOString(),
              health: {},
              summary: '',
              topPriorities: [],
              pendingApprovals: [],
              approvedAwaitingExecution: [],
              urgentItems: [],
              risks: [],
              opportunities: [],
              genome: { integrity: 0, readiness: 0, stage: '', pendingProposals: [], weakestSections: [] },
              constitution: { latestVersion: null, stale: false, href: '' },
              executiveModes: [],
              recommendedActions: [],
            }),
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

    controller = moduleRef.get(BusinessCommandCenterController);
  });

  it('exposes GET snapshot', async () => {
    const result = await controller.snapshot('biz_1');
    expect(result.businessId).toBe('biz_1');
    expect(result.generatedAt).toBeDefined();
  });
});
