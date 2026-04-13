"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronRight, X, Lightbulb, BookOpen } from "lucide-react";
import type { WalkthroughStep } from "./module-walkthrough";
import { PAGE_OVERVIEWS, type PageOverview } from "@/lib/walkthrough-definitions";

export type { PageOverview as PageGuideOverview };

export interface PageGuideProps {
  moduleKey: string;
  overview?: PageOverview;
  walkthroughSteps: WalkthroughStep[];
  onComplete?: () => void;
}

function getStorageKey(moduleKey: string) {
  return `kf_guide_${moduleKey}`;
}

type Phase = "overview" | "walkthrough";

function computeCardPosition(targetRect: DOMRect | null, viewportWidth: number) {
  if (!targetRect) return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  return {
    top: `${targetRect.bottom + 16}px`,
    left: `${Math.max(16, Math.min(targetRect.left, viewportWidth - 340))}px`,
    transform: undefined,
  };
}

export function PageGuide({ moduleKey, overview: overrideProp, walkthroughSteps, onComplete }: PageGuideProps) {
  const overview = overrideProp ?? PAGE_OVERVIEWS[moduleKey] ?? { title: moduleKey, description: "", concepts: [] };
  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState<Phase>("overview");
  const [currentStep, setCurrentStep] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setViewportWidth(window.innerWidth);
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const seen = localStorage.getItem(getStorageKey(moduleKey));
    if (seen !== "true") {
      const timer = setTimeout(() => { setActive(true); setPhase("overview"); }, 800);
      return () => clearTimeout(timer);
    }
  }, [moduleKey]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (detail === moduleKey) {
        setCurrentStep(0);
        setPhase("overview");
        setActive(true);
      }
    };
    window.addEventListener("kf-guide-restart", handler);
    return () => window.removeEventListener("kf-guide-restart", handler);
  }, [moduleKey]);

  useEffect(() => {
    if (!active || phase !== "walkthrough" || !walkthroughSteps[currentStep]?.target) {
      setTargetRect(null);
      return;
    }
    const el = document.querySelector(walkthroughSteps[currentStep].target!);
    if (el) setTargetRect(el.getBoundingClientRect());
    else setTargetRect(null);
  }, [active, phase, currentStep, walkthroughSteps]);

  const dismiss = useCallback(() => {
    setActive(false);
    localStorage.setItem(getStorageKey(moduleKey), "true");
    onComplete?.();
  }, [moduleKey, onComplete]);

  const startWalkthrough = useCallback(() => {
    setPhase("walkthrough");
    setCurrentStep(0);
  }, []);

  const handleNext = useCallback(() => {
    if (currentStep < walkthroughSteps.length - 1) {
      setCurrentStep((s) => s + 1);
    } else {
      dismiss();
    }
  }, [currentStep, walkthroughSteps.length, dismiss]);

  if (!active) return null;

  if (phase === "overview") {
    return (
      <AnimatePresence>
        <motion.div
          className="fixed inset-0 flex items-center justify-center p-4"
          style={{ zIndex: "var(--kf-z-guide)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={dismiss}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ duration: 0.2 }}
            className="kf-glass relative w-full max-w-[520px] rounded-2xl p-5 shadow-2xl"
            style={{
              position: "relative",
              zIndex: 1,
              border: "1px solid hsl(var(--kf-accent1) / 0.2)",
              boxShadow: "0 24px 64px hsl(0 0% 0% / 0.45)",
            }}
          >
            <div className="flex items-start justify-between gap-2 mb-4">
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: "hsl(var(--kf-accent1) / 0.12)" }}
                >
                  <BookOpen className="w-4.5 h-4.5" style={{ color: "hsl(var(--kf-accent1))" }} />
                </div>
                <div>
                  <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
                    Step 1 of {walkthroughSteps.length > 0 ? walkthroughSteps.length + 1 : 1}
                  </span>
                  <h3 className="text-sm font-bold leading-tight">{overview.title}</h3>
                </div>
              </div>
              <button
                onClick={dismiss}
                className="p-1.5 rounded-lg hover:bg-muted/40 transition-colors shrink-0"
              >
                <X className="w-3.5 h-3.5 text-muted-foreground" />
              </button>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed mb-4">
              {overview.description}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-5">
              {overview.concepts.map((c) => (
                <div
                  key={c.step}
                  className="flex gap-2.5 p-2.5 rounded-xl"
                  style={{
                    background: "hsl(var(--kf-muted) / 0.3)",
                    border: "1px solid hsl(var(--kf-border) / 0.3)",
                  }}
                >
                  <span
                    className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5"
                    style={{
                      background: "hsl(var(--kf-accent1) / 0.15)",
                      color: "hsl(var(--kf-accent1))",
                    }}
                  >
                    {c.step}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-medium leading-tight">{c.title}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{c.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                {/* Overview = step 0; walkthrough steps = 1..N */}
                {[null, ...walkthroughSteps].map((_, i) => (
                  <div
                    key={i}
                    className="h-1 rounded-full transition-all duration-200"
                    style={{
                      width: i === 0 ? 16 : 6,
                      background: i === 0 ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-muted) / 0.4)",
                    }}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={dismiss}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-lg"
                  style={{ background: "hsl(var(--kf-muted) / 0.4)" }}
                >
                  Skip
                </button>
                {walkthroughSteps.length > 0 && (
                  <button
                    onClick={startWalkthrough}
                    className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg transition-all hover:opacity-90"
                    style={{
                      background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
                      color: "white",
                    }}
                  >
                    Start walkthrough
                    <ChevronRight className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    );
  }

  const step = walkthroughSteps[currentStep];
  const StepIcon = step.icon ?? Lightbulb;
  const isLast = currentStep === walkthroughSteps.length - 1;

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

  const cardPos = computeCardPosition(targetRect, viewportWidth);

  const totalSteps = walkthroughSteps.length;
  // Overview is step 1; walkthrough steps are 2..N+1 in the unified progress model
  const overallStep = currentStep + 2;
  const overallTotal = totalSteps + 1;

  return (
    <AnimatePresence>
      <motion.div
        ref={overlayRef}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0"
        style={{ zIndex: "var(--kf-z-guide)" }}
      >
        <div
          className="absolute inset-0 bg-black/60 transition-all duration-300"
          style={spotlightStyle}
          onClick={dismiss}
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
          className="absolute w-[320px]"
          style={{
            zIndex: 1,
            top: cardPos.top,
            left: cardPos.left,
            transform: cardPos.transform,
          }}
        >
          <div
            className="kf-glass rounded-xl p-4 shadow-2xl"
            style={{
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
                    Step {overallStep} of {overallTotal}
                  </span>
                  <h4 className="text-sm font-semibold leading-tight">{step.title}</h4>
                </div>
              </div>
              <button
                onClick={dismiss}
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
                {/* Unified progress: overview (i=0) + walkthrough steps (i=1..N) */}
                {Array.from({ length: overallTotal }).map((_, i) => (
                  <div
                    key={i}
                    className="h-1 rounded-full transition-all duration-200"
                    style={{
                      width: i === overallStep - 1 ? 16 : 6,
                      background:
                        i < overallStep
                          ? "hsl(var(--kf-accent1))"
                          : "hsl(var(--kf-muted) / 0.4)",
                    }}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={dismiss}
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

export function PageGuideTrigger({
  moduleKey,
  label = "Guide me",
}: {
  moduleKey: string;
  label?: string;
}) {
  return (
    <button
      onClick={() => {
        localStorage.removeItem(getStorageKey(moduleKey));
        window.dispatchEvent(new CustomEvent("kf-guide-restart", { detail: moduleKey }));
      }}
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5 rounded-lg min-h-[32px]"
      style={{ background: "hsl(var(--kf-muted) / 0.3)" }}
    >
      <Lightbulb className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
      {label}
    </button>
  );
}
