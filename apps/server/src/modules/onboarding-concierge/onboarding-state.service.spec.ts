import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { OnboardingStateService, type OnboardingStep } from './onboarding-state.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { BlueprintService } from '../blueprint/blueprint.service';

function makeService(overrides?: {
  business?: Record<string, unknown> | null;
  genome?: Record<string, unknown> | null;
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

  const service = new OnboardingStateService(prisma, blueprint);
  return { service, prisma, blueprint };
}

describe('OnboardingStateService', () => {
  it('returns normalized step and genome gate flags', async () => {
    const { service, blueprint } = makeService();

    const state = await service.getState('biz_1');

    expect(state.step).toBe('intake');
    expect(state.onboardingComplete).toBe(false);
    expect(state.onboardingStartedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(state.onboardingCompletedAt).toBeNull();
    expect(state.threePillarMet).toBe(false);
    expect(state.setupStatus).toBeNull();
    expect(state.templateId).toBe('salon');

    expect(blueprint.calculateGenomeIntegrity).toHaveBeenCalledWith('biz_1');
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

    const state = await service.saveStep('biz_1', 'genesis');

    expect(prisma.client.business.update).toHaveBeenCalledWith({
      where: { id: 'biz_1' },
      data: { onboardingStep: 'genesis' },
    });
    expect(state.step).toBe('genesis');
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

  it('rejects invalid step transitions', async () => {
    const { service } = makeService();

    await expect(service.saveStep('biz_1', 'template' as OnboardingStep)).rejects.toThrow(BadRequestException);
    await expect(service.saveStep('biz_1', 'welcome' as OnboardingStep)).rejects.toThrow(BadRequestException);
  });
});
