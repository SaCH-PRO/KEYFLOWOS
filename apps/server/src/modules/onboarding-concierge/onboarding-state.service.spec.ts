import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { OnboardingStateService, type OnboardingStep } from './onboarding-state.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { BlueprintService } from '../blueprint/blueprint.service';
import { OnboardingConciergeService } from './onboarding-concierge.service';

function makeService(overrides?: {
  business?: Record<string, unknown> | null;
  genome?: Record<string, unknown> | null;
  setupStatus?: Record<string, unknown> | null;
}) {
  const {
    business: initialBusiness = {
      onboardingStep: 'intake',
      onboardingComplete: false,
      onboardingStartedAt: new Date('2026-01-01T00:00:00Z'),
      onboardingCompletedAt: null,
      metaData: { conciergeTemplateId: 'salon' },
    },
    genome = { threePillarMinimumMet: false },
    setupStatus = { percentage: 0, completedCount: 0, totalSteps: 12 },
  } = overrides ?? {};

  let business = initialBusiness;

  const prisma = {
    client: {
      business: {
        findUnique: vi.fn().mockImplementation(() => Promise.resolve(business)),
        update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          business = { ...business, ...data };
          return Promise.resolve(business);
        }),
      },
    },
  } as unknown as PrismaService;

  const blueprint = {
    calculateGenomeIntegrity: vi.fn().mockResolvedValue(genome),
  } as unknown as BlueprintService;

  const concierge = {
    getSetupStatus: vi.fn().mockResolvedValue(setupStatus),
  } as unknown as OnboardingConciergeService;

  const service = new OnboardingStateService(prisma, blueprint, concierge);
  return { service, prisma, blueprint, concierge };
}

describe('OnboardingStateService', () => {
  it('returns normalized step, genome gate flags, and setup status', async () => {
    const { service, blueprint, concierge } = makeService();

    const state = await service.getState('biz_1');

    expect(state.step).toBe('intake');
    expect(state.onboardingComplete).toBe(false);
    expect(state.onboardingStartedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(state.onboardingCompletedAt).toBeNull();
    expect(state.threePillarMet).toBe(false);
    expect(state.setupStatus).toEqual({ percentage: 0, completedCount: 0, totalSteps: 12 });
    expect(state.templateId).toBe('salon');

    expect(blueprint.calculateGenomeIntegrity).toHaveBeenCalledWith('biz_1');
    expect(concierge.getSetupStatus).toHaveBeenCalledWith('biz_1');
  });

  it('falls back to welcome for unknown steps', async () => {
    const { service } = makeService({
      business: {
        onboardingStep: 'unknown',
        onboardingComplete: false,
        onboardingStartedAt: null,
        onboardingCompletedAt: null,
        metaData: {},
      },
    });

    const state = await service.getState('biz_1');
    expect(state.step).toBe('welcome');
  });

  it('reports threePillarMet=true when genome threshold is met', async () => {
    const { service } = makeService({ genome: { threePillarMinimumMet: true } });

    const state = await service.getState('biz_1');
    expect(state.threePillarMet).toBe(true);
  });

  it('persists a valid forward step and returns updated state', async () => {
    const { service, prisma } = makeService();

    const state = await service.saveStep('biz_1', 'intake');

    expect(prisma.client.business.update).toHaveBeenCalledWith({
      where: { id: 'biz_1' },
      data: { onboardingStep: 'intake' },
    });
    expect(state.step).toBe('intake');
  });

  it('maps legacy steps onto the slim funnel', async () => {
    const { service, prisma } = makeService();

    const genesisState = await service.saveStep('biz_1', 'genesis');
    expect(prisma.client.business.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { onboardingStep: 'intake' } }),
    );
    expect(genesisState.step).toBe('intake');

    const genomeState = await service.saveStep('biz_1', 'genome');
    expect(prisma.client.business.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { onboardingStep: 'configure' } }),
    );
    expect(genomeState.step).toBe('configure');
  });

  it('sets onboardingStartedAt when leaving welcome for the first time', async () => {
    const { service, prisma } = makeService({
      business: {
        onboardingStep: 'welcome',
        onboardingComplete: false,
        onboardingStartedAt: null,
        onboardingCompletedAt: null,
        metaData: {},
      },
    });

    await service.saveStep('biz_1', 'intake');

    expect(prisma.client.business.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          onboardingStep: 'intake',
          onboardingStartedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('allows backward step transitions', async () => {
    const { service, prisma } = makeService();

    const state = await service.saveStep('biz_1', 'welcome');

    expect(prisma.client.business.update).toHaveBeenCalledWith({
      where: { id: 'biz_1' },
      data: { onboardingStep: 'welcome' },
    });
    expect(state.step).toBe('welcome');
  });

  it('allows forward step transitions so deep links can reconcile ahead-of-state URLs', async () => {
    const { service, prisma } = makeService();

    const state = await service.saveStep('biz_1', 'template' as OnboardingStep);

    expect(prisma.client.business.update).toHaveBeenCalledWith({
      where: { id: 'biz_1' },
      data: { onboardingStep: 'template' },
    });
    expect(state.step).toBe('template');
  });

  it('rejects saveStep("complete") so only markOnboardingComplete can finish onboarding', async () => {
    const { service, prisma } = makeService();

    await expect(service.saveStep('biz_1', 'complete' as OnboardingStep)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.client.business.update).not.toHaveBeenCalled();
  });
});
