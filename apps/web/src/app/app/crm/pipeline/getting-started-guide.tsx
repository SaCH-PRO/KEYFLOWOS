"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Lightbulb,
  X,
  UserPlus,
  SlidersHorizontal,
  TrendingUp,
  MessageCircle,
  Send,
  Zap,
  Check,
  PartyPopper,
} from "lucide-react";

const STORAGE_KEY = "kf_guide_state";

interface GuideStep {
  id: string;
  step: string;
  title: string;
  desc: string;
  icon: typeof Lightbulb;
  color: string;
  actionLabel?: string;
}

const GUIDE_STEPS: GuideStep[] = [
  {
    id: "add-contacts",
    step: "1",
    title: "Add Contacts",
    desc: "Create contacts manually, scan business cards, import CSV/VCF files, or sync from Google Contacts.",
    icon: UserPlus,
    color: "hsl(var(--kf-accent1))",
    actionLabel: "Add a contact",
  },
  {
    id: "segment-filter",
    step: "2",
    title: "Segment & Filter",
    desc: "Use smart segments like High Value, New This Week, and At Risk to zero in on the contacts that matter most.",
    icon: SlidersHorizontal,
    color: "hsl(var(--kf-accent2))",
    actionLabel: "Try a segment",
  },
  {
    id: "track-revenue",
    step: "3",
    title: "Track Revenue",
    desc: "See total revenue, invoice count, and booking history on every contact card — no spreadsheets needed.",
    icon: TrendingUp,
    color: "hsl(142 76% 36%)",
  },
  {
    id: "communicate",
    step: "4",
    title: "Communicate",
    desc: "Reach out via WhatsApp, email, or phone directly from any contact card with a single tap.",
    icon: MessageCircle,
    color: "hsl(200 80% 55%)",
  },
  {
    id: "broadcast",
    step: "5",
    title: "Broadcast Messages",
    desc: "Select multiple contacts and send bulk WhatsApp or email messages in one go.",
    icon: Send,
    color: "hsl(270 70% 60%)",
    actionLabel: "Select contacts",
  },
  {
    id: "quick-actions",
    step: "6",
    title: "Quick Actions",
    desc: "Create invoices, send quotes, or book appointments directly from a contact — everything in one place.",
    icon: Zap,
    color: "hsl(45 93% 47%)",
  },
];

interface GuideState {
  dismissed: boolean;
  completedSteps: string[];
}

function loadGuideState(): GuideState {
  if (typeof window === "undefined") return { dismissed: false, completedSteps: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { dismissed: false, completedSteps: [] };
    return JSON.parse(raw);
  } catch {
    return { dismissed: false, completedSteps: [] };
  }
}

function saveGuideState(state: GuideState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

interface GettingStartedGuideProps {
  isOpen: boolean;
  onToggle: () => void;
  onAddContact?: () => void;
  onToggleSelectMode?: () => void;
  onSegmentChange?: (segment: string) => void;
}

export function GettingStartedGuide({
  isOpen,
  onToggle,
  onAddContact,
  onToggleSelectMode,
  onSegmentChange,
}: GettingStartedGuideProps) {
  const [guideState, setGuideState] = useState<GuideState>(loadGuideState);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const completedCount = guideState.completedSteps.length;
  const allComplete = completedCount === GUIDE_STEPS.length;
  const progress = Math.round((completedCount / GUIDE_STEPS.length) * 100);

  const closeAndRestoreFocus = useCallback(() => {
    onToggle();
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, [onToggle]);

  const toggleStep = useCallback((stepId: string) => {
    setGuideState((prev) => {
      const completed = prev.completedSteps.includes(stepId)
        ? prev.completedSteps.filter((s) => s !== stepId)
        : [...prev.completedSteps, stepId];
      const next = { ...prev, completedSteps: completed };
      saveGuideState(next);
      return next;
    });
  }, []);

  const handleDismiss = useCallback(() => {
    setGuideState((prev) => {
      const next = { ...prev, dismissed: true };
      saveGuideState(next);
      return next;
    });
    closeAndRestoreFocus();
  }, [closeAndRestoreFocus]);

  const handleReset = useCallback(() => {
    const next: GuideState = { dismissed: false, completedSteps: [] };
    setGuideState(next);
    saveGuideState(next);
  }, []);

  const handleStepAction = useCallback((stepId: string) => {
    toggleStep(stepId);
    switch (stepId) {
      case "add-contacts":
        onAddContact?.();
        closeAndRestoreFocus();
        break;
      case "segment-filter":
        onSegmentChange?.("high-value");
        closeAndRestoreFocus();
        break;
      case "broadcast":
        onToggleSelectMode?.();
        closeAndRestoreFocus();
        break;
    }
  }, [toggleStep, onAddContact, onToggleSelectMode, onSegmentChange, closeAndRestoreFocus]);

  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      dialogRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeAndRestoreFocus();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first || document.activeElement === dialogRef.current) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, closeAndRestoreFocus]);

  const showBadge = !guideState.dismissed && completedCount < GUIDE_STEPS.length;

  const handleTriggerClick = useCallback(() => {
    if (guideState.dismissed && !isOpen) {
      setGuideState((prev) => {
        const next = { ...prev, dismissed: false };
        saveGuideState(next);
        return next;
      });
    }
    onToggle();
  }, [guideState.dismissed, isOpen, onToggle]);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={handleTriggerClick}
        className={`w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200 relative ${
          isOpen
            ? "bg-amber-400 text-white shadow-md shadow-amber-400/40 scale-110"
            : "bg-amber-400/15 text-amber-400 hover:bg-amber-400/25 hover:shadow-sm hover:shadow-amber-400/20 hover:scale-105"
        }`}
        aria-label="Getting started guide"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        title="Getting started guide"
      >
        <Lightbulb className="w-3.5 h-3.5" />
        {showBadge && (
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={closeAndRestoreFocus}
              aria-hidden="true"
            />
            <motion.div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-label="Getting started guide"
              tabIndex={-1}
              initial={{ opacity: 0, y: -8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.97 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="fixed left-2 right-2 top-20 sm:absolute sm:left-0 sm:right-auto sm:top-full sm:mt-2 z-50 kf-card border border-border shadow-2xl rounded-2xl sm:w-[90vw] sm:max-w-[700px] max-h-[80vh] overflow-y-auto p-5 outline-none"
            >
              <div className="flex items-center gap-2.5 mb-4">
                <div className="p-1.5 rounded-lg bg-amber-400/10">
                  <Lightbulb className="w-4 h-4 text-amber-400" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold">Getting Started</h3>
                  <p className="text-xs text-muted-foreground">
                    {allComplete
                      ? "You've completed all steps!"
                      : `${completedCount} of ${GUIDE_STEPS.length} steps complete`}
                  </p>
                </div>
                <button
                  onClick={closeAndRestoreFocus}
                  className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none"
                  aria-label="Close getting started guide"
                >
                  <X className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>

              <div className="mb-4">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] text-muted-foreground font-medium">Progress</span>
                  <span className="text-[11px] font-semibold" style={{ color: "hsl(var(--kf-accent1))" }}>
                    {progress}%
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: "linear-gradient(90deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                  />
                </div>
              </div>

              {allComplete && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex items-center gap-2.5 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 mb-4"
                >
                  <PartyPopper className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-emerald-300">All done!</p>
                    <p className="text-[11px] text-emerald-400/70">You're ready to manage your contacts like a pro.</p>
                  </div>
                </motion.div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="group" aria-label="Guide steps">
                {GUIDE_STEPS.map((item) => {
                  const Icon = item.icon;
                  const isComplete = guideState.completedSteps.includes(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleStepAction(item.id)}
                      aria-pressed={isComplete}
                      aria-label={`Step ${item.step}: ${item.title}${isComplete ? " (completed)" : ""}`}
                      className={`flex gap-2.5 p-2.5 rounded-xl transition-colors text-left group w-full focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none ${
                        isComplete
                          ? "bg-muted/20 opacity-70"
                          : "hover:bg-muted/30"
                      }`}
                    >
                      <div className="relative flex-shrink-0 mt-0.5">
                        <div
                          className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                            isComplete
                              ? "bg-emerald-500/15"
                              : "group-hover:scale-110"
                          }`}
                          style={!isComplete ? { backgroundColor: `${item.color}15` } : undefined}
                        >
                          {isComplete ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Icon className="w-3.5 h-3.5" style={{ color: item.color }} />
                          )}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-medium leading-tight ${isComplete ? "line-through text-muted-foreground" : ""}`}>
                          {item.title}
                        </p>
                        <p className="text-[11px] text-muted-foreground leading-relaxed mt-0.5">
                          {item.desc}
                        </p>
                        {item.actionLabel && !isComplete && (
                          <span
                            className="inline-block text-[10px] font-medium mt-1 opacity-0 group-hover:opacity-100 transition-opacity"
                            style={{ color: item.color }}
                          >
                            {item.actionLabel} →
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/40">
                {allComplete ? (
                  <button
                    onClick={handleReset}
                    className="text-[11px] text-muted-foreground hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none rounded px-1"
                  >
                    Reset progress
                  </button>
                ) : (
                  <button
                    onClick={handleDismiss}
                    className="text-[11px] text-muted-foreground hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none rounded px-1"
                  >
                    Don't show again
                  </button>
                )}
                <button
                  onClick={closeAndRestoreFocus}
                  className="px-4 py-1.5 text-xs font-medium rounded-lg transition-all hover:opacity-90 focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
                  style={{
                    background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
                    color: "white",
                  }}
                >
                  {allComplete ? "Close" : "Got it"}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
