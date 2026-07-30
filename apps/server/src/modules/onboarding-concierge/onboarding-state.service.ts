import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { BlueprintService } from '../blueprint/blueprint.service';
import {
  OnboardingConciergeService,
  type SetupStatus,
} from './onboarding-concierge.service';

export type OnboardingStep =
  | 'welcome'
  | 'intake'
  | 'genesis'
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
  setupStatus: SetupStatus | null;
  templateId?: string;
}

const STEP_ORDER: OnboardingStep[] = [
  'welcome',
  'intake',
  'template',
  'configure',
  'complete',
];

// Legacy steps from the old 14-card wizard are mapped onto the slim funnel.
const LEGACY_STEP_MAP: Record<string, OnboardingStep> = {
  genesis: 'intake',
  genome: 'configure',
};

function parseMetaData(raw: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
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
    @Inject(OnboardingConciergeService)
    private readonly concierge: OnboardingConciergeService,
  ) {}

  async getState(businessId: string): Promise<OnboardingState> {
    const [business, genome, setupStatus] = await Promise.all([
      this.prisma.client.business.findUnique({
        where: { id: businessId },
        select: {
          onboardingStep: true,
          onboardingComplete: true,
          onboardingStartedAt: true,
          onboardingCompletedAt: true,
          metaData: true,
        },
      }),
      this.blueprint.calculateGenomeIntegrity(businessId).catch(() => null),
      this.concierge.getSetupStatus(businessId).catch(() => null),
    ]);

    const step = this.normalizeStep(business?.onboardingStep);
    const meta = parseMetaData(business?.metaData as Record<string, unknown> | undefined);

    return {
      step,
      onboardingComplete: business?.onboardingComplete ?? false,
      onboardingStartedAt: business?.onboardingStartedAt?.toISOString() ?? null,
      onboardingCompletedAt: business?.onboardingCompletedAt?.toISOString() ?? null,
      threePillarMet: genome?.threePillarMinimumMet ?? false,
      setupStatus,
      templateId: (meta.conciergeTemplateId as string) ?? undefined,
    };
  }

  async saveStep(businessId: string, step: OnboardingStep): Promise<OnboardingState> {
    const business = await this.prisma.client.business.findUnique({
      where: { id: businessId },
      select: {
        onboardingStep: true,
        onboardingStartedAt: true,
      },
    });

    const currentStep = this.normalizeStep(business?.onboardingStep);
    const targetStep = this.normalizeStep(step);

    if (targetStep === 'complete') {
      throw new BadRequestException(
        `Step 'complete' must be reached through markOnboardingComplete, not saveStep.`,
      );
    }

    if (!this.isAllowedTransition(currentStep, targetStep)) {
      throw new BadRequestException(
        `Invalid onboarding step transition from '${currentStep}' to '${targetStep}'.`,
      );
    }

    const data: Record<string, unknown> = { onboardingStep: targetStep };
    if (currentStep === 'welcome' && step !== 'welcome' && !business?.onboardingStartedAt) {
      data.onboardingStartedAt = new Date();
    }

    await this.prisma.client.business.update({
      where: { id: businessId },
      data,
    });

    return this.getState(businessId);
  }

  private normalizeStep(raw: string | null | undefined): OnboardingStep {
    if (!raw) return 'welcome';
    if (LEGACY_STEP_MAP[raw]) return LEGACY_STEP_MAP[raw];
    if (STEP_ORDER.includes(raw as OnboardingStep)) return raw as OnboardingStep;
    return 'welcome';
  }

  private isAllowedTransition(from: OnboardingStep, to: OnboardingStep): boolean {
    if (from === to) return true;

    const fromIndex = STEP_ORDER.indexOf(from);
    const toIndex = STEP_ORDER.indexOf(to);

    // Allow any forward or backward move. Deep links from nudges may land
    // ahead of the persisted step, and the wizard itself only advances one
    // step at a time, so this keeps the URL and server state reconciled
    // without blocking legitimate navigation.
    return toIndex !== fromIndex;
  }
}
