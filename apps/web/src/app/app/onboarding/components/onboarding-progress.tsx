"use client";

import type { OnboardingStep } from "@/lib/api/onboarding-concierge";

const STEPS: { id: OnboardingStep; label: string }[] = [
  { id: "welcome", label: "Start" },
  { id: "intake", label: "About you" },
  { id: "template", label: "Template" },
  { id: "configure", label: "Configure" },
  { id: "complete", label: "Done" },
];

interface OnboardingProgressProps {
  step: OnboardingStep;
  onStepClick?: (step: OnboardingStep) => void;
}

export function OnboardingProgress({ step, onStepClick }: OnboardingProgressProps) {
  const currentIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <div className="hidden sm:flex items-center gap-1.5">
      {STEPS.map((s, idx) => {
        const isActive = idx === currentIndex;
        const isCompleted = idx < currentIndex;
        const clickable = isCompleted && onStepClick;

        return (
          <div key={s.id} className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onStepClick(s.id)}
              className={`w-2 h-2 rounded-full transition-colors ${
                isActive
                  ? "bg-[hsl(var(--kf-accent1))]"
                  : isCompleted
                    ? "bg-emerald-500 hover:bg-emerald-400"
                    : "bg-muted"
              } ${clickable ? "cursor-pointer" : "cursor-default"}`}
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
