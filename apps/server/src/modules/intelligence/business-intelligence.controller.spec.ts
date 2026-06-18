import { describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { BusinessIntelligenceController } from './business-intelligence.controller';
import { BusinessIntelligenceService } from './business-intelligence.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard } from '../../core/auth/module-scope.guard';
import type { BusinessExecutiveBrief } from './business-intelligence.types';

describe('BusinessIntelligenceController', () => {
  async function makeController() {
    const brief: BusinessExecutiveBrief = {
      businessId: 'biz_1',
      generatedAt: new Date().toISOString(),
      summary: 'Test summary',
      genomeIntegrity: 60,
      executiveReadinessScore: 55,
      genomeStage: 'OPERATING_BUSINESS',
      insights: [],
      topPriorities: [],
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [BusinessIntelligenceController],
      providers: [
        {
          provide: BusinessIntelligenceService,
          useValue: {
            generateExecutiveBrief: vi.fn().mockResolvedValue(brief),
          },
        },
      ],
    })
      .overrideGuard(AuthGuard).useValue({ canActivate: vi.fn(() => true) })
      .overrideGuard(BusinessGuard).useValue({ canActivate: vi.fn(() => true) })
      .overrideGuard(ModuleScopeGuard).useValue({ canActivate: vi.fn(() => true) })
      .compile();

    const controller = moduleRef.get(BusinessIntelligenceController);
    const service = moduleRef.get(BusinessIntelligenceService);
    return { controller, service, brief };
  }

  it('returns the executive brief for a business', async () => {
    const { controller, service, brief } = await makeController();
    const result = await controller.executiveBrief('biz_1');

    expect(result).toEqual(brief);
    expect(service.generateExecutiveBrief).toHaveBeenCalledWith('biz_1');
  });
});
