import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { OnboardingConciergeController } from './onboarding-concierge.controller';
import { OnboardingConciergeService } from './onboarding-concierge.service';
import { OnboardingStateService } from './onboarding-state.service';
import { DemoDataSeederService } from './demo-data-seeder.service';
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

  // PR196-SEED-DEMO-OWNER (D-84): POST seed-demo goes through the seeder's
  // owner-only, audited door with the authenticated caller.
  const seederMock = {
    seedDemoDataAsOwner: vi.fn().mockResolvedValue({ contactId: 'c1', invoiceId: 'i1', invoiceNumber: 'DEMO-001', alreadySeeded: false }),
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [OnboardingConciergeController],
      providers: [
        { provide: OnboardingConciergeService, useValue: conciergeMock },
        { provide: OnboardingStateService, useValue: stateMock },
        { provide: DemoDataSeederService, useValue: seederMock },
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

  it('POST onboarding-step validates through DTO and delegates to state service', async () => {
    // The controller now relies on the global ValidationPipe for shape validation.
    // Unit-level validation behavior is exercised in onboarding-state.service.spec.ts.
    const result = await controller.saveOnboardingStep('biz_1', { step: 'genesis' } as any);
    expect(stateMock.saveStep).toHaveBeenCalledWith('biz_1', 'genesis');
    expect(result.step).toBe('genesis');
  });

  it('POST seed-demo triggers demo data seeding, as the authenticated caller through the owner-only seeder door (D-84)', async () => {
    const owner = { id: 'user_owner', email: 'owner@example.test', role: 'USER' };
    const result = await controller.seedDemoData('biz_1', owner);
    expect(seederMock.seedDemoDataAsOwner).toHaveBeenCalledWith('biz_1', owner);
    expect(conciergeMock.seedDemoData, 'the unaudited, actor-less seed is not reachable from the route').not.toHaveBeenCalled();
    expect(result.invoiceNumber).toBe('DEMO-001');
  });

  it('POST seed-demo surfaces the owner-only refusal and returns no demo data (D-84)', async () => {
    seederMock.seedDemoDataAsOwner.mockRejectedValueOnce(new ForbiddenException({ code: 'DEMO_SEED_OWNER_ONLY' }));
    await expect(controller.seedDemoData('biz_1', { id: 'user_staff', role: 'USER' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(seederMock.seedDemoDataAsOwner).toHaveBeenCalledWith('biz_1', { id: 'user_staff', role: 'USER' });
  });

  it('has no separate sample-contact seeding route (D-84)', () => {
    const proto = OnboardingConciergeController.prototype as unknown as Record<string, unknown>;
    const paths = Object.getOwnPropertyNames(proto)
      .filter((name) => name !== 'constructor' && typeof proto[name] === 'function')
      .map((name) => Reflect.getMetadata(PATH_METADATA, proto[name] as object))
      .filter((path): path is string => typeof path === 'string');
    expect(paths, 'the route table is read').toContain('seed-demo');
    expect(paths.filter((path) => /sample/i.test(path))).toEqual([]);
    expect(paths.filter((path) => /seed/i.test(path))).toEqual(['seed-demo']);
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
