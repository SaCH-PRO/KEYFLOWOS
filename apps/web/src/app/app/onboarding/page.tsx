"use client";

import { Loader2 } from "lucide-react";
import { useOnboarding } from "./hooks/use-onboarding";
import { OnboardingShell } from "./components/onboarding-shell";
import { KeyOnboardingChatView } from "./components/key-onboarding-chat-view";

export default function OnboardingPage() {
  const { step, loading, error, goToStep } = useOnboarding();

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

  if (error) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background p-6">
        <div className="max-w-md w-full rounded-2xl border border-destructive/20 bg-destructive/5 p-6 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <OnboardingShell step={step} onStepClick={goToStep}>
      <KeyOnboardingChatView step={step} goToStep={goToStep} />
    </OnboardingShell>
  );
}
