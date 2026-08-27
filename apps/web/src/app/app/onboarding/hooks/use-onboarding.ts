"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  fetchOnboardingState,
  saveOnboardingStep,
  type OnboardingStep,
} from "@/lib/api/onboarding-concierge";
import { getStoredBusinessId } from "@/lib/workspace";

const STEP_ORDER: OnboardingStep[] = [
  "welcome",
  "intake",
  "template",
  "configure",
  "complete",
];

// Legacy steps from the old dense wizard are still accepted in URLs/DB rows
// and mapped onto the slim funnel.
const LEGACY_STEP_MAP: Record<string, OnboardingStep> = {
  genesis: "intake",
  genome: "configure",
};

const VALID_STEPS = new Set([...STEP_ORDER, ...Object.keys(LEGACY_STEP_MAP)]);

// Legacy nudge CTAs used setup-status names (products, hours, storefront).
// Map them to the onboarding step where that work is done.
const SETUP_STATUS_TO_STEP: Record<string, OnboardingStep> = {
  products: "template",
  hours: "configure",
  storefront: "configure",
  payments: "configure",
  contacts: "configure",
};

function parseStepQueryParam(raw: string | null): OnboardingStep | null {
  if (!raw) return null;
  const mapped = SETUP_STATUS_TO_STEP[raw] ?? LEGACY_STEP_MAP[raw] ?? raw;
  if (VALID_STEPS.has(mapped)) {
    return mapped as OnboardingStep;
  }
  return null;
}

function stepIndex(step: OnboardingStep): number {
  return STEP_ORDER.indexOf(step);
}

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
  const searchParams = useSearchParams();
  const requestedStep = parseStepQueryParam(searchParams.get("step"));

  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const businessId = getStoredBusinessId();

  // Refs coordinate navigation so rapid clicks never corrupt the UI or server.
  const transitioningRef = useRef(false);
  const pendingStepRef = useRef<OnboardingStep | null>(null);
  const requestIdRef = useRef(0);
  const loadedRef = useRef(false);

  const syncUrl = useCallback(
    (next: OnboardingStep) => {
      const current = parseStepQueryParam(searchParams.get("step"));
      if (current !== next) {
        router.replace(`/app/onboarding?step=${next}`, { scroll: false });
      }
    },
    [router, searchParams],
  );

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
      setError(apiError || "Failed to load onboarding state.");
      setLoading(false);
      return;
    }

    const initial = requestedStep;
    const serverStep = data.step;

    if (!initial || stepIndex(initial) <= stepIndex(serverStep)) {
      // No deep link, or the deep link is at/behind the server state. The
      // server step is authoritative.
      setStep(serverStep);
      syncUrl(serverStep);
    } else if (data.onboardingComplete) {
      // Business is already complete; ignore ahead-of-state deep links.
      setStep(serverStep);
      syncUrl(serverStep);
    } else {
      // The URL is ahead of the server state. Try to advance the server once
      // so refreshes land on the same step instead of bouncing back.
      setStep(initial);
      syncUrl(initial);
      const { error: saveError } = await saveOnboardingStep(businessId, initial);
      if (saveError) {
        // Server rejected the jump (sequential transition rule). Fall back to
        // the server state and update the URL to match.
        setStep(serverStep);
        syncUrl(serverStep);
      }
    }

    // Onboarding done is enough to leave — a returning user with an incomplete
    // genome belongs in their workspace (nudged by the banner), not held here.
    // Requiring threePillarMet too kept completed users pinned to onboarding.
    if (data.onboardingComplete) {
      router.replace("/app/command-center");
    }

    setLoading(false);
    loadedRef.current = true;
  }, [businessId, router, syncUrl, requestedStep]);

  useEffect(() => {
    if (!loadedRef.current) {
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const goToStep = useCallback(
    async (next: OnboardingStep) => {
      if (!businessId) return;

      // Queue the request if another navigation is still in flight.
      if (transitioningRef.current) {
        pendingStepRef.current = next;
        return;
      }

      transitioningRef.current = true;
      setIsTransitioning(true);
      setError(null);

      const requestId = ++requestIdRef.current;
      let startStep = step;

      // Optimistically advance the UI and URL, but capture the step we came
      // from so we can roll back precisely if this request is the latest one.
      setStep((prev) => {
        startStep = prev;
        return next;
      });
      syncUrl(next);

      const { error: apiError } = await saveOnboardingStep(businessId, next);

      // Ignore stale responses from out-of-order API calls.
      if (requestId !== requestIdRef.current) {
        transitioningRef.current = false;
        setIsTransitioning(false);
        return;
      }

      if (apiError) {
        setError(`Couldn’t save progress: ${apiError}. Please try again.`);
        // Roll back to the step that was active when this request started.
        setStep(startStep);
        syncUrl(startStep);
      }

      transitioningRef.current = false;
      setIsTransitioning(false);

      // Process any navigation that was queued while we were busy.
      const pending = pendingStepRef.current;
      pendingStepRef.current = null;
      if (pending && pending !== next) {
        void goToStep(pending);
      }
    },
    [businessId, step, syncUrl],
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
