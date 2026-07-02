"use client";

import { Sparkles, ArrowRight } from "lucide-react";

interface WelcomeStepProps {
  onStart: () => void;
}

export function WelcomeStep({ onStart }: WelcomeStepProps) {
  return (
    <div className="text-center space-y-6">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[hsl(var(--kf-accent1)/0.12)]">
        <Sparkles className="w-8 h-8 text-[hsl(var(--kf-accent1))]" />
      </div>

      <div className="space-y-2">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
          Let&apos;s set up your business, together.
        </h1>
        <p className="text-sm sm:text-base text-muted-foreground max-w-md mx-auto">
          I&apos;m KEY, your AI co-founder. I&apos;ll ask a few questions, configure
          KeyFlowOS for you, and have you ready to operate in minutes.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <button
          onClick={onStart}
          className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm bg-[hsl(var(--kf-accent1))] text-[hsl(var(--kf-accent1-foreground))] hover:brightness-110 transition-all"
        >
          Start talking to KEY
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        You can pause and resume onboarding anytime. We&apos;ll save your progress.
      </p>
    </div>
  );
}
