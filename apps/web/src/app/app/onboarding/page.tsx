"use client";

import { Loader2 } from "lucide-react";
import { useOnboarding } from "./hooks/use-onboarding";
import { OnboardingShell } from "./components/onboarding-shell";
import { KeyOnboardingChatView } from "./components/key-onboarding-chat-view";
import { ManualSetupStep, useManualSetup } from "./components/manual-setup-step";

export default function OnboardingPage() {
  const { step, loading, error, goToStep } = useOnboarding();
  // Held here, above OnboardingShell's per-step container (keyed on the step,
  // so every step change remounts what it wraps): what the owner typed, and
  // any refusal shown, survive a step change (review CR-R006-2).
  const manualSetup = useManualSetup();

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading onboarding…</p>
        </div>
      </div>
    );
  }

  // Owner ruling D-03: onboarding completes without AI. The manual step is
  // always offered, and neither a failed state read nor a failed chat replaces
  // the page: the error shows as a banner above a path that still works.
  return (
    <OnboardingShell step={step} onStepClick={goToStep}>
      <div className="space-y-4">
        {error && (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-destructive/20 bg-destructive/5 p-4">
            <p className="text-sm text-destructive">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="shrink-0 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Retry
            </button>
          </div>
        )}
        <ManualSetupStep setup={manualSetup} />
        <KeyOnboardingChatView step={step} goToStep={goToStep} />
      </div>
    </OnboardingShell>
  );
}
