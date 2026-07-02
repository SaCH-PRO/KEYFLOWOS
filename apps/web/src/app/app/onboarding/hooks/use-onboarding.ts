"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  fetchOnboardingState,
  saveOnboardingStep,
  type OnboardingStep,
} from "@/lib/api/onboarding-concierge";
import { getStoredBusinessId } from "@/lib/workspace";

const STEP_ORDER: OnboardingStep[] = [
  "welcome",
  "intake",
  "genesis",
  "template",
  "configure",
  "genome",
  "complete",
];

interface UseOnboardingReturn {
  step: OnboardingStep;
  loading: boolean;
  error: string | null;
  goToStep: (step: OnboardingStep) => Promise<void>;
  nextStep: () => Promise<void>;
  prevStep: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useOnboarding(): UseOnboardingReturn {
  const router = useRouter();
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const businessId = getStoredBusinessId();

  const load = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      setError("No business selected.");
      return;
    }

    setLoading(true);
    setError(null);

    const { data, error: apiError } = await fetchOnboardingState(businessId);
    if (apiError || !data) {
      // Do not fall back to a cached local step — server state is the source of truth.
      setError(apiError || "Failed to load onboarding state.");
    } else {
      setStep(data.step);

      if (data.onboardingComplete && data.threePillarMet) {
        router.replace("/app/command-center");
      }
    }

    setLoading(false);
  }, [businessId, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const goToStep = useCallback(
    async (next: OnboardingStep) => {
      if (!businessId) return;
      setStep(next);

      // Fire-and-forget server persistence; failures are non-blocking.
      const { error: apiError } = await saveOnboardingStep(businessId, next);
      if (apiError) {
        // eslint-disable-next-line no-console
        console.warn("[useOnboarding] failed to persist step:", apiError);
      }
    },
    [businessId],
  );

  const nextStep = useCallback(async () => {
    const idx = STEP_ORDER.indexOf(step);
    if (idx < STEP_ORDER.length - 1) {
      await goToStep(STEP_ORDER[idx + 1]);
    }
  }, [step, goToStep]);

  const prevStep = useCallback(async () => {
    const idx = STEP_ORDER.indexOf(step);
    if (idx > 0) {
      await goToStep(STEP_ORDER[idx - 1]);
    }
  }, [step, goToStep]);

  return { step, loading, error, goToStep, nextStep, prevStep, refresh: load };
}
