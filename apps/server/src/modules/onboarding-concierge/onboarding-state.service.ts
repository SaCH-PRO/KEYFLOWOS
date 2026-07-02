import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { BlueprintService } from '../blueprint/blueprint.service';

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
  setupStatus: unknown;
  templateId?: string;
}

const STEP_ORDER: OnboardingStep[] = [
  'welcome',
  'intake',
  'genesis',
  'template',
  'configure',
  'genome',
  'complete',
];

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
  ) {}

  async getState(businessId: string): Promise<OnboardingState> {
    const [business, genome] = await Promise.all([
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
    ]);

    const step = this.normalizeStep(business?.onboardingStep);
    const meta = parseMetaData(business?.metaData as Record<string, unknown> | undefined);

    return {
      step,
      onboardingComplete: business?.onboardingComplete ?? false,
      onboardingStartedAt: business?.onboardingStartedAt?.toISOString() ?? null,
      onboardingCompletedAt: business?.onboardingCompletedAt?.toISOString() ?? null,
      threePillarMet: genome?.threePillarMinimumMet ?? false,
      setupStatus: null,
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

    if (!this.isAllowedTransition(currentStep, step)) {
      throw new BadRequestException(
        `Invalid onboarding step transition from '${currentStep}' to '${step}'.`,
      );
    }

    const data: Record<string, unknown> = { onboardingStep: step };
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
    if (raw && STEP_ORDER.includes(raw as OnboardingStep)) return raw as OnboardingStep;
    return 'welcome';
  }

  private isAllowedTransition(from: OnboardingStep, to: OnboardingStep): boolean {
    if (from === to) return true;

    const fromIndex = STEP_ORDER.indexOf(from);
    const toIndex = STEP_ORDER.indexOf(to);

    // Only allow forward moves by exactly one step. This mirrors the client
    // wizard and prevents skipping or jumping backward via the API.
    return toIndex === fromIndex + 1;
  }
}
