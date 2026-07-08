import { IsIn } from 'class-validator';

const ONBOARDING_STEPS = [
  'welcome',
  'intake',
  'template',
  'configure',
  'complete',
] as const;

export type OnboardingStepDto = (typeof ONBOARDING_STEPS)[number];

export class SaveOnboardingStepDto {
  @IsIn(ONBOARDING_STEPS)
  step!: OnboardingStepDto;
}
