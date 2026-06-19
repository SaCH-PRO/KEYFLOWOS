import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { KeyExecutiveModeController } from './key-executive-mode.controller';
import { KeyExecutiveModeService } from './key-executive-mode.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';
import { ModuleScopeGuard } from '../../core/auth/module-scope.guard';

describe('KeyExecutiveModeController', () => {
  let controller: KeyExecutiveModeController;
  let service: KeyExecutiveModeService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [KeyExecutiveModeController],
      providers: [
        {
          provide: KeyExecutiveModeService,
          useValue: {
            listModes: () => [
              { mode: 'CFO', label: 'KEY CFO', description: 'Finance' },
            ],
            generateModeBrief: async (businessId: string, mode: string) => ({
              businessId,
              mode,
              generatedAt: new Date().toISOString(),
              title: 'KEY CFO',
              summary: 'summary',
              diagnosis: 'diagnosis',
              findings: [],
              recommendedActions: [],
              risks: [],
              opportunities: [],
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

    controller = moduleRef.get(KeyExecutiveModeController);
    service = moduleRef.get(KeyExecutiveModeService);
  });

  it('lists modes', () => {
    expect(controller.listModes()).toHaveLength(1);
  });

  it('returns a mode brief', async () => {
    const result = await controller.modeBrief('biz_1', 'CFO');
    expect(result.mode).toBe('CFO');
    expect(result.businessId).toBe('biz_1');
  });

  it('delegates invalid mode handling to service', async () => {
    const spy = vi.spyOn(service, 'generateModeBrief').mockRejectedValue(new Error('Invalid executive mode'));
    await expect(controller.modeBrief('biz_1', 'INVALID')).rejects.toThrow('Invalid executive mode');
    spy.mockRestore();
  });
});
