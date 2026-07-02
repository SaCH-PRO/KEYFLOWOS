"use client";

import type { OnboardingStep } from "@/lib/api/onboarding-concierge";

const STEPS: { id: OnboardingStep; label: string }[] = [
  { id: "welcome", label: "Start" },
  { id: "intake", label: "About you" },
  { id: "template", label: "Template" },
  { id: "configure", label: "Configure" },
  { id: "genome", label: "Genome" },
  { id: "complete", label: "Done" },
];

interface OnboardingProgressProps {
  step: OnboardingStep;
}

export function OnboardingProgress({ step }: OnboardingProgressProps) {
  const currentIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <div className="hidden sm:flex items-center gap-1.5">
      {STEPS.map((s, idx) => {
        const isActive = idx === currentIndex;
        const isCompleted = idx < currentIndex;

        return (
          <div key={s.id} className="flex items-center gap-1.5">
            <div
              className={`w-2 h-2 rounded-full transition-colors ${
                isActive
                  ? "bg-[hsl(var(--kf-accent1))]"
                  : isCompleted
                    ? "bg-emerald-500"
                    : "bg-muted"
              }`}
              title={s.label}
            />
            {idx < STEPS.length - 1 && (
              <div
                className={`w-6 h-px transition-colors ${
                  isCompleted ? "bg-emerald-500/50" : "bg-border"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
