import { describe, expect, it, vi } from 'vitest';
import { OnboardingStateService, type OnboardingStep } from './onboarding-state.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { BlueprintService } from '../blueprint/blueprint.service';
import { OnboardingConciergeService } from './onboarding-concierge.service';

function makeService(overrides?: {
  business?: Record<string, unknown> | null;
  conciergeState?: Record<string, unknown>;
  genome?: Record<string, unknown> | null;
}) {
  const {
    business: initialBusiness = {
      onboardingStep: 'intake',
      onboardingComplete: false,
      onboardingStartedAt: new Date('2026-01-01T00:00:00Z'),
      onboardingCompletedAt: null,
    },
    conciergeState = { setupStatus: {}, templateId: 'salon', onboardingComplete: false },
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

  const concierge = {
    getConciergeState: vi.fn().mockResolvedValue(conciergeState),
  } as unknown as OnboardingConciergeService;

  const service = new OnboardingStateService(prisma, blueprint, concierge);
  return { service, prisma, blueprint, concierge };
}

describe('OnboardingStateService', () => {
  it('returns normalized step and genome gate flags', async () => {
    const { service, concierge, blueprint } = makeService();

    const state = await service.getState('biz_1');

    expect(state.step).toBe('intake');
    expect(state.onboardingComplete).toBe(false);
    expect(state.onboardingStartedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(state.onboardingCompletedAt).toBeNull();
    expect(state.threePillarMet).toBe(false);
    expect(state.setupStatus).toEqual({});
    expect(state.templateId).toBe('salon');

    expect(concierge.getConciergeState).toHaveBeenCalledWith('biz_1');
    expect(blueprint.calculateGenomeIntegrity).toHaveBeenCalledWith('biz_1');
  });

  it('falls back to welcome for unknown steps', async () => {
    const { service } = makeService({
      business: { onboardingStep: 'unknown', onboardingComplete: false, onboardingStartedAt: null, onboardingCompletedAt: null },
    });

    const state = await service.getState('biz_1');
    expect(state.step).toBe('welcome');
  });

  it('reports threePillarMet=true when genome threshold is met', async () => {
    const { service } = makeService({ genome: { threePillarMinimumMet: true } });

    const state = await service.getState('biz_1');
    expect(state.threePillarMet).toBe(true);
  });

  it('persists the step and returns updated state', async () => {
    const { service, prisma } = makeService();

    const state = await service.saveStep('biz_1', 'template');

    expect(prisma.client.business.update).toHaveBeenCalledWith({
      where: { id: 'biz_1' },
      data: { onboardingStep: 'template' },
    });
    expect(state.step).toBe('template');
  });
});
