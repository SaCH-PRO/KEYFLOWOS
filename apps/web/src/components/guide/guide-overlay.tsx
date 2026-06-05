"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronRight, ChevronLeft, Footprints } from "lucide-react";
import { useGuide } from "@/contexts/guide-context";

function Spotlight({ rect }: { rect: DOMRect | null }) {
  if (!rect) return null;
  const padding = 8;
  return (
    <>
      {/* Top shade */}
      <div
        className="fixed inset-x-0 top-0 bg-black/60 backdrop-blur-sm z-[90] transition-all duration-500"
        style={{ height: Math.max(0, rect.top - padding) }}
      />
      {/* Bottom shade */}
      <div
        className="fixed inset-x-0 bottom-0 bg-black/60 backdrop-blur-sm z-[90] transition-all duration-500"
        style={{ top: rect.bottom + padding }}
      />
      {/* Left shade */}
      <div
        className="fixed left-0 bg-black/60 backdrop-blur-sm z-[90] transition-all duration-500"
        style={{ top: Math.max(0, rect.top - padding), height: rect.height + padding * 2, width: Math.max(0, rect.left - padding) }}
      />
      {/* Right shade */}
      <div
        className="fixed right-0 bg-black/60 backdrop-blur-sm z-[90] transition-all duration-500"
        style={{ top: Math.max(0, rect.top - padding), height: rect.height + padding * 2, width: `calc(100% - ${rect.right + padding}px)` }}
      />
      {/* Highlight ring */}
      <motion.div
        layoutId="guide-spotlight-ring"
        className="fixed rounded-xl border-2 border-[hsl(var(--kf-accent1))] z-[91] pointer-events-none shadow-[0_0_30px_hsl(var(--kf-accent1))/0.3]"
        style={{
          left: rect.left - padding,
          top: rect.top - padding,
          width: rect.width + padding * 2,
          height: rect.height + padding * 2,
        }}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      />
      {/* Pulsing dot */}
      <motion.div
        className="fixed z-[92] w-3 h-3 rounded-full bg-[hsl(var(--kf-accent1))]"
        style={{
          left: rect.left + rect.width / 2 - 6,
          top: rect.top + rect.height / 2 - 6,
        }}
        animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
        transition={{ repeat: Infinity, duration: 2 }}
      />
    </>
  );
}

function GuideTooltip({
  step,
  index,
  total,
  onNext,
  onPrev,
  onEnd,
}: {
  step: { title: string; content: string; position?: string };
  index: number;
  total: number;
  onNext: () => void;
  onPrev: () => void;
  onEnd: () => void;
}) {
  const isLast = index >= total - 1;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[95] w-[90vw] max-w-md"
    >
      <div className="bg-card border border-border/40 rounded-2xl shadow-2xl p-5 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[hsl(var(--kf-accent1))]/15 flex items-center justify-center">
              <Footprints className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
            </div>
            <span className="text-xs font-semibold text-foreground/80">KEY Guide</span>
          </div>
          <button
            onClick={onEnd}
            className="w-6 h-6 rounded-md hover:bg-muted/50 flex items-center justify-center text-muted-foreground/50 hover:text-foreground/70 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-1.5">
          <h4 className="text-sm font-semibold text-foreground">{step.title}</h4>
          <p className="text-xs text-muted-foreground leading-relaxed">{step.content}</p>
        </div>

        {/* Progress + Actions */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-1.5">
            {Array.from({ length: total }).map((_, i) => (
              <div
                key={i}
                className={`h-1 rounded-full transition-all duration-300 ${
                  i === index ? "w-4 bg-[hsl(var(--kf-accent1))]" : i < index ? "w-1.5 bg-[hsl(var(--kf-accent1))]/40" : "w-1.5 bg-muted-foreground/15"
                }`}
              />
            ))}
            <span className="text-[10px] text-muted-foreground/40 ml-1">
              {index + 1} / {total}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {index > 0 && (
              <button
                onClick={onPrev}
                className="px-2.5 py-1.5 rounded-lg bg-muted/30 text-muted-foreground/60 text-[11px] font-medium hover:bg-muted/50 transition-colors flex items-center gap-1"
              >
                <ChevronLeft className="w-3 h-3" />
                Back
              </button>
            )}
            <button
              onClick={onNext}
              className="px-3 py-1.5 rounded-lg bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] text-[11px] font-medium hover:bg-[hsl(var(--kf-accent1))]/25 transition-colors flex items-center gap-1"
            >
              {isLast ? "Finish" : "Next"}
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export function GuideOverlay() {
  const { isActive, currentStep, targetRect, steps, currentIndex, nextStep, prevStep, endGuide } = useGuide();

  // Keyboard navigation
  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") endGuide();
      if (e.key === "ArrowRight" || e.key === "Enter") nextStep();
      if (e.key === "ArrowLeft") prevStep();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isActive, endGuide, nextStep, prevStep]);

  // Auto-advance if configured
  useEffect(() => {
    if (!isActive || !currentStep?.autoAdvance) return;
    const timer = setTimeout(() => nextStep(), currentStep.autoAdvance);
    return () => clearTimeout(timer);
  }, [isActive, currentStep, nextStep]);

  // Execute step actions
  useEffect(() => {
    if (!isActive || !currentStep) return;

    const { action, actionTarget, actionValue } = currentStep;
    if (!action || !actionTarget) return;

    const el = document.querySelector(actionTarget);
    if (!el) return;

    if (action === "click") {
      (el as HTMLElement).click();
    } else if (action === "scroll") {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (action === "navigate" && actionValue) {
      window.location.href = actionValue;
    }
    // "highlight" is handled by spotlight rect
  }, [isActive, currentStep]);

  return (
    <AnimatePresence>
      {isActive && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[90]"
        >
          <Spotlight rect={targetRect} />
          {currentStep && (
            <GuideTooltip
              step={currentStep}
              index={currentIndex}
              total={steps.length}
              onNext={nextStep}
              onPrev={prevStep}
              onEnd={endGuide}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
