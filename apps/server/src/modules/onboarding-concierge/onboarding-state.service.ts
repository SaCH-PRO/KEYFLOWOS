import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { BlueprintService } from '../blueprint/blueprint.service';
import { OnboardingConciergeService } from './onboarding-concierge.service';

export type OnboardingStep =
  | 'welcome'
  | 'intake'
  | 'template'
  | 'configure'
  | 'genome'
  | 'complete';

export interface OnboardingState {
  step: OnboardingStep;
  onboardingComplete: boolean;
  onboardingStartedAt: string | null;
  onboardingCompletedAt: string | null;
  threePillarMet: boolean;
  setupStatus: unknown;
  templateId?: string;
}

/**
 * Persists and resolves the user's current position in the first-run onboarding
 * wizard. This is the single source of truth for the `/app/onboarding` page.
 */
@Injectable()
export class OnboardingStateService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BlueprintService) private readonly blueprint: BlueprintService,
    @Inject(OnboardingConciergeService) private readonly concierge: OnboardingConciergeService,
  ) {}

  async getState(businessId: string): Promise<OnboardingState> {
    const [business, conciergeState, genome] = await Promise.all([
      this.prisma.client.business.findUnique({
        where: { id: businessId },
        select: {
          onboardingStep: true,
          onboardingComplete: true,
          onboardingStartedAt: true,
          onboardingCompletedAt: true,
        },
      }),
      this.concierge.getConciergeState(businessId),
      this.blueprint.calculateGenomeIntegrity(businessId).catch(() => null),
    ]);

    const step = this.normalizeStep(business?.onboardingStep);

    return {
      step,
      onboardingComplete: business?.onboardingComplete ?? false,
      onboardingStartedAt: business?.onboardingStartedAt?.toISOString() ?? null,
      onboardingCompletedAt: business?.onboardingCompletedAt?.toISOString() ?? null,
      threePillarMet: genome?.threePillarMinimumMet ?? false,
      setupStatus: conciergeState.setupStatus,
      templateId: conciergeState.templateId,
    };
  }

  async saveStep(businessId: string, step: OnboardingStep): Promise<OnboardingState> {
    await this.prisma.client.business.update({
      where: { id: businessId },
      data: { onboardingStep: step },
    });
    return this.getState(businessId);
  }

  private normalizeStep(raw: string | null | undefined): OnboardingStep {
    const valid: OnboardingStep[] = ['welcome', 'intake', 'template', 'configure', 'genome', 'complete'];
    if (raw && valid.includes(raw as OnboardingStep)) return raw as OnboardingStep;
    return 'welcome';
  }
}
