"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, X, Lightbulb, RotateCcw } from "lucide-react";

export interface WalkthroughStep {
  target?: string;
  title: string;
  description: string;
  icon?: React.ElementType;
}

interface ModuleWalkthroughProps {
  moduleKey: string;
  steps: WalkthroughStep[];
  onComplete?: () => void;
}

function getStorageKey(moduleKey: string) {
  return `kf_walkthrough_${moduleKey}`;
}

export function useWalkthrough(moduleKey: string) {
  const [hasSeenTour, setHasSeenTour] = useState(true);

  useEffect(() => {
    const seen = localStorage.getItem(getStorageKey(moduleKey));
    setHasSeenTour(seen === "true");
  }, [moduleKey]);

  const resetTour = useCallback(() => {
    localStorage.removeItem(getStorageKey(moduleKey));
    setHasSeenTour(false);
  }, [moduleKey]);

  const markSeen = useCallback(() => {
    localStorage.setItem(getStorageKey(moduleKey), "true");
    setHasSeenTour(true);
  }, [moduleKey]);

  return { hasSeenTour, resetTour, markSeen };
}

export function WalkthroughTrigger({
  moduleKey,
  label = "Take a tour",
  onStart,
}: {
  moduleKey: string;
  label?: string;
  onStart?: () => void;
}) {
  const { resetTour } = useWalkthrough(moduleKey);
  return (
    <button
      onClick={() => {
        resetTour();
        window.dispatchEvent(new CustomEvent("kf-walkthrough-restart", { detail: moduleKey }));
        onStart?.();
      }}
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5 rounded-lg min-h-[32px]"
      style={{ background: "hsl(var(--kf-muted) / 0.3)" }}
    >
      <RotateCcw className="w-3 h-3" />
      {label}
    </button>
  );
}

export function ModuleWalkthrough({ moduleKey, steps, onComplete }: ModuleWalkthroughProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [active, setActive] = useState(false);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const seen = localStorage.getItem(getStorageKey(moduleKey));
    if (seen !== "true") {
      const timer = setTimeout(() => setActive(true), 800);
      return () => clearTimeout(timer);
    }
  }, [moduleKey]);

  useEffect(() => {
    const handler = (e: CustomEvent) => {
      if (e.detail === moduleKey) {
        setCurrentStep(0);
        setActive(true);
      }
    };
    window.addEventListener("kf-walkthrough-restart" as any, handler as EventListener);
    return () => window.removeEventListener("kf-walkthrough-restart" as any, handler as EventListener);
  }, [moduleKey]);

  useEffect(() => {
    if (!active || !steps[currentStep]?.target) {
      setTargetRect(null);
      return;
    }
    const el = document.querySelector(steps[currentStep].target!);
    if (el) {
      const rect = el.getBoundingClientRect();
      setTargetRect(rect);
    } else {
      setTargetRect(null);
    }
  }, [active, currentStep, steps]);

  const handleNext = useCallback(() => {
    if (currentStep < steps.length - 1) {
      setCurrentStep((s) => s + 1);
    } else {
      setActive(false);
      localStorage.setItem(getStorageKey(moduleKey), "true");
      onComplete?.();
    }
  }, [currentStep, steps.length, moduleKey, onComplete]);

  const handleSkip = useCallback(() => {
    setActive(false);
    localStorage.setItem(getStorageKey(moduleKey), "true");
    onComplete?.();
  }, [moduleKey, onComplete]);

  if (!active) return null;

  const step = steps[currentStep];
  const StepIcon = step.icon ?? Lightbulb;
  const isLast = currentStep === steps.length - 1;

  const spotlightStyle = targetRect
    ? {
        clipPath: `polygon(
          0% 0%, 0% 100%, 
          ${targetRect.left - 8}px 100%, 
          ${targetRect.left - 8}px ${targetRect.top - 8}px, 
          ${targetRect.right + 8}px ${targetRect.top - 8}px, 
          ${targetRect.right + 8}px ${targetRect.bottom + 8}px, 
          ${targetRect.left - 8}px ${targetRect.bottom + 8}px, 
          ${targetRect.left - 8}px 100%, 
          100% 100%, 100% 0%
        )`,
      }
    : {};

  const cardTop = targetRect
    ? targetRect.bottom + 16
    : undefined;
  const cardLeft = targetRect
    ? Math.max(16, Math.min(targetRect.left, window.innerWidth - 340))
    : undefined;

  return (
    <AnimatePresence>
      <motion.div
        ref={overlayRef}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100]"
      >
        <div
          className="absolute inset-0 bg-black/60 transition-all duration-300"
          style={spotlightStyle}
          onClick={handleSkip}
        />

        {targetRect && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute rounded-xl pointer-events-none"
            style={{
              top: targetRect.top - 8,
              left: targetRect.left - 8,
              width: targetRect.width + 16,
              height: targetRect.height + 16,
              border: "2px solid hsl(var(--kf-accent1))",
              boxShadow: "0 0 0 4px hsl(var(--kf-accent1) / 0.2), 0 0 20px hsl(var(--kf-accent1) / 0.15)",
            }}
          />
        )}

        <motion.div
          key={currentStep}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.2 }}
          className="absolute z-[101] w-[320px]"
          style={{
            top: cardTop ?? "50%",
            left: cardLeft ?? "50%",
            transform: !targetRect ? "translate(-50%, -50%)" : undefined,
          }}
        >
          <div
            className="rounded-xl p-4 shadow-2xl"
            style={{
              background: "hsl(var(--kf-bg))",
              border: "1px solid hsl(var(--kf-accent1) / 0.25)",
              boxShadow: "0 16px 48px hsl(0 0% 0% / 0.4)",
            }}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: "hsl(var(--kf-accent1) / 0.12)" }}
                >
                  <StepIcon className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
                </div>
                <div>
                  <span className="text-[9px] text-muted-foreground font-medium uppercase tracking-wider">
                    Step {currentStep + 1} of {steps.length}
                  </span>
                  <h4 className="text-sm font-semibold leading-tight">{step.title}</h4>
                </div>
              </div>
              <button
                onClick={handleSkip}
                className="p-1 rounded-lg hover:bg-muted/40 transition-colors shrink-0"
              >
                <X className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed mb-3 pl-9">
              {step.description}
            </p>

            <div className="flex items-center justify-between pl-9">
              <div className="flex gap-1">
                {steps.map((_, i) => (
                  <div
                    key={i}
                    className="h-1 rounded-full transition-all duration-200"
                    style={{
                      width: i === currentStep ? 16 : 6,
                      background:
                        i <= currentStep
                          ? "hsl(var(--kf-accent1))"
                          : "hsl(var(--kf-muted) / 0.4)",
                    }}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSkip}
                  className="text-[11px] text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
                >
                  Skip tour
                </button>
                <button
                  onClick={handleNext}
                  className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg transition-all hover:opacity-90"
                  style={{
                    background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
                    color: "white",
                  }}
                >
                  {isLast ? "Got it!" : "Next"}
                  {!isLast && <ChevronRight className="w-3 h-3" />}
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
