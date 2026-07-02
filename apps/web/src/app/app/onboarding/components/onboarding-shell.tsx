"use client";

import { motion } from "framer-motion";
import { Layers } from "lucide-react";
import { OnboardingProgress } from "./onboarding-progress";
import type { OnboardingStep } from "@/lib/api/onboarding-concierge";

interface OnboardingShellProps {
  step: OnboardingStep;
  children: React.ReactNode;
}

export function OnboardingShell({ step, children }: OnboardingShellProps) {
  return (
    <div className="min-h-dvh bg-background text-foreground flex flex-col">
      {/* Background gradient */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute -top-40 -right-40 w-[500px] h-[500px] rounded-full bg-[radial-gradient(circle,hsl(var(--kf-accent1)/0.08),transparent_65%)]" />
        <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] rounded-full bg-[radial-gradient(circle,hsl(var(--kf-accent2)/0.05),transparent_65%)]" />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))]">
              <Layers className="w-4.5 h-4.5 text-white" />
            </div>
            <span className="text-lg font-bold tracking-tight">KeyFlowOS</span>
          </div>
          <OnboardingProgress step={step} />
        </div>
      </header>

      {/* Main content */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center p-4 sm:p-6">
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="w-full max-w-2xl"
        >
          {children}
        </motion.div>
      </main>
    </div>
  );
}
