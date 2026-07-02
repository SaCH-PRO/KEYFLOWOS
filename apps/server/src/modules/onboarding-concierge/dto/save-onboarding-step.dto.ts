import { IsIn } from 'class-validator';

const ONBOARDING_STEPS = [
  'welcome',
  'intake',
  'genesis',
  'template',
  'configure',
  'genome',
  'complete',
] as const;

export type OnboardingStepDto = (typeof ONBOARDING_STEPS)[number];

export class SaveOnboardingStepDto {
  @IsIn(ONBOARDING_STEPS)
  step!: OnboardingStepDto;
}
