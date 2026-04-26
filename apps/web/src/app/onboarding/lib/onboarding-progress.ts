import type { BusinessBlueprint, BlueprintActivationProgress } from "@/types/blueprint";

export type OnboardingStepKey =
  | "business_snapshot"
  | "first_offer"
  | "brand_storefront"
  | "payment_pathway"
  | "publish";

const STEP_ORDER: OnboardingStepKey[] = [
  "business_snapshot",
  "first_offer",
  "brand_storefront",
  "payment_pathway",
  "publish",
];

export function getActivationProgress(blueprint: BusinessBlueprint | null | undefined): BlueprintActivationProgress {
  const activation = blueprint?.activation;
  const completed = [
    activation?.firstOfferCreated,
    activation?.storefrontPublished,
    activation?.paymentPathConfigured,
    activation?.firstTransactionIntentCreated,
    activation?.onboardingCompleted,
  ].filter(Boolean).length;

  return {
    completed,
    total: STEP_ORDER.length,
    percentage: Math.round((completed / STEP_ORDER.length) * 100),
  };
}

export function resolveCurrentOnboardingStep(blueprint: BusinessBlueprint | null | undefined): OnboardingStepKey {
  const activation = blueprint?.activation;
  if (!activation?.firstOfferCreated) return "first_offer";
  if (!activation?.storefrontPublished) return "brand_storefront";
  if (!activation?.paymentPathConfigured) return "payment_pathway";
  if (!activation?.firstTransactionIntentCreated) return "publish";
  return "publish";
}

type LocalOnboardingProgressInput = {
  profileComplete: boolean;
  selectedTemplate: string | null;
  products: Array<{ included: boolean; name: string }>;
  publicUrl: string | null;
  selectedFirstWin: string | null;
};

export type LocalOnboardingProgress = {
  profile: boolean;
  template: boolean;
  firstOffer: boolean;
  storefrontPublished: boolean;
  closePathway: boolean;
};

export function evaluateOnboardingProgress(input: LocalOnboardingProgressInput): LocalOnboardingProgress {
  return {
    profile: input.profileComplete,
    template: Boolean(input.selectedTemplate),
    firstOffer: input.products.some((item) => item.included && item.name.trim().length > 0),
    storefrontPublished: Boolean(input.publicUrl),
    closePathway: Boolean(input.selectedFirstWin),
  };
}
