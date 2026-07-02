import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { OnboardingConciergeController } from './onboarding-concierge.controller';
import { OnboardingConciergeService } from './onboarding-concierge.service';
import { OnboardingStateService } from './onboarding-state.service';
import { AuthGuard } from '../../core/auth/auth.guard';
import { BusinessGuard } from '../../core/auth/business.guard';

describe('OnboardingConciergeController', () => {
  let controller: OnboardingConciergeController;
  const conciergeMock = {
    getSetupStatus: vi.fn().mockResolvedValue({ percentage: 0, completedCount: 0, totalSteps: 12 }),
    getConciergeState: vi.fn().mockResolvedValue({ setupStatus: {}, templateId: null, onboardingComplete: false }),
    getWelcomeMessage: vi.fn().mockResolvedValue({ role: 'assistant', content: 'Hi' }),
    getAvailableTemplates: vi.fn().mockReturnValue([{ id: 'salon', label: 'Salon' }]),
    getTemplatePreview: vi.fn().mockReturnValue({ id: 'salon', label: 'Salon', products: [] }),
    generateConciergeResponse: vi.fn().mockResolvedValue({ role: 'assistant', content: 'OK' }),
    autoConfigureFromTemplate: vi.fn().mockResolvedValue({ templateId: 'salon', templateLabel: 'Salon' }),
    detectBusinessType: vi.fn().mockResolvedValue({ template: { id: 'salon', label: 'Salon' }, confidence: 'high' }),
    checkAndGenerateNudges: vi.fn().mockResolvedValue([]),
    snoozeNudge: vi.fn().mockResolvedValue({ snoozed: true }),
    dismissConcierge: vi.fn().mockResolvedValue({ dismissed: true }),
    resumeConcierge: vi.fn().mockResolvedValue({ resumed: true }),
    seedDemoData: vi.fn().mockResolvedValue({ contactId: 'c1', invoiceId: 'i1', invoiceNumber: 'DEMO-001' }),
    markOnboardingComplete: vi.fn().mockResolvedValue({ complete: true, demoData: { contactId: 'c1', invoiceId: 'i1', invoiceNumber: 'DEMO-001' } }),
  };

  const stateMock = {
    getState: vi.fn().mockResolvedValue({
      step: 'welcome',
      onboardingComplete: false,
      onboardingStartedAt: null,
      onboardingCompletedAt: null,
      threePillarMet: false,
      setupStatus: {},
    }),
    saveStep: vi.fn().mockImplementation(async (_businessId: string, step: string) => ({
      step,
      onboardingComplete: false,
      onboardingStartedAt: null,
      onboardingCompletedAt: null,
      threePillarMet: false,
      setupStatus: {},
    })),
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [OnboardingConciergeController],
      providers: [
        { provide: OnboardingConciergeService, useValue: conciergeMock },
        { provide: OnboardingStateService, useValue: stateMock },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(BusinessGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(OnboardingConciergeController);
    vi.clearAllMocks();
  });

  it('GET onboarding-state returns the wizard state', async () => {
    const result = await controller.getOnboardingState('biz_1');
    expect(stateMock.getState).toHaveBeenCalledWith('biz_1');
    expect(result.step).toBe('welcome');
  });

  it('POST onboarding-step persists the next step', async () => {
    const result = await controller.saveOnboardingStep('biz_1', { step: 'template' });
    expect(stateMock.saveStep).toHaveBeenCalledWith('biz_1', 'template');
    expect(result.step).toBe('template');
  });

  it('POST onboarding-step rejects missing step', async () => {
    await expect(controller.saveOnboardingStep('biz_1', { step: '' as any })).rejects.toThrow('step is required');
  });

  it('POST seed-demo triggers demo data seeding', async () => {
    const result = await controller.seedDemoData('biz_1');
    expect(conciergeMock.seedDemoData).toHaveBeenCalledWith('biz_1');
    expect(result.invoiceNumber).toBe('DEMO-001');
  });

  it('POST complete marks onboarding complete and seeds demo data', async () => {
    const result = await controller.markComplete('biz_1');
    expect(conciergeMock.markOnboardingComplete).toHaveBeenCalledWith('biz_1');
    expect(result.complete).toBe(true);
  });

  it('GET templates returns available templates', async () => {
    const result = await controller.getTemplates();
    expect(conciergeMock.getAvailableTemplates).toHaveBeenCalled();
    expect(result).toEqual([{ id: 'salon', label: 'Salon' }]);
  });
});
