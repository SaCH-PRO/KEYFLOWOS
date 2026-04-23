"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Lightbulb,
  X,
  ToggleRight,
  ShoppingBag,
  Palette,
  Clock,
  Share2,
  BarChart3,
  Check,
  PartyPopper,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

const STORAGE_KEY = "kf_store_guide_state";

interface GuideStep {
  id: string;
  title: string;
  desc: string;
  icon: React.ElementType;
  color: string;
  tab: string;
}

const GUIDE_STEPS: GuideStep[] = [
  {
    id: "toggle-store-live",
    title: "Toggle Store Live",
    desc: "Use the ON/Live switch at the top to make your store visible to customers.",
    icon: ToggleRight,
    color: "hsl(142 76% 36%)",
    tab: "operations",
  },
  {
    id: "add-services-products",
    title: "Add Services & Products",
    desc: "Go to the Catalog tab to add your bookable services and products with prices.",
    icon: ShoppingBag,
    color: "hsl(var(--kf-accent1))",
    tab: "catalog",
  },
  {
    id: "customize-appearance",
    title: "Customize Appearance",
    desc: "Choose a theme, set your brand colors, hero image, and layout style in the Design tab.",
    icon: Palette,
    color: "hsl(270 70% 60%)",
    tab: "design",
  },
  {
    id: "set-business-hours",
    title: "Set Business Hours",
    desc: "Configure your operating hours so customers know when you're available.",
    icon: Clock,
    color: "hsl(200 80% 55%)",
    tab: "operations",
  },
  {
    id: "share-your-link",
    title: "Share Your Link",
    desc: "Copy your public store URL and share it on WhatsApp, social media, or your website.",
    icon: Share2,
    color: "hsl(var(--kf-accent2))",
    tab: "launch",
  },
  {
    id: "track-performance",
    title: "Track Performance",
    desc: "Monitor page views, popular items, and store health scores in the Overview.",
    icon: BarChart3,
    color: "hsl(45 93% 47%)",
    tab: "overview",
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
    const parsed = JSON.parse(raw);
    return { dismissed: parsed.dismissed ?? false, completedSteps: parsed.completedSteps ?? [] };
  } catch {
    return { dismissed: false, completedSteps: [] };
  }
}

function saveGuideState(s: GuideState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

interface StoreGuideProps {
  isOpen: boolean;
  onToggle: () => void;
  onTabChange?: (tab: string) => void;
}

export function StoreGuide({ isOpen, onToggle, onTabChange }: StoreGuideProps) {
  const [guideState, setGuideState] = useState<GuideState>(loadGuideState);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const completedCount = guideState.completedSteps.length;
  const totalSteps = GUIDE_STEPS.length;
  const allComplete = completedCount === totalSteps;
  const progress = Math.round((completedCount / totalSteps) * 100);

  const closeAndRestore = useCallback(() => {
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
    closeAndRestore();
  }, [closeAndRestore]);

  const handleReset = useCallback(() => {
    const next: GuideState = { dismissed: false, completedSteps: [] };
    setGuideState(next);
    saveGuideState(next);
  }, []);

  const handleStepAction = useCallback((stepId: string, tab: string) => {
    toggleStep(stepId);
    onTabChange?.(tab);
    closeAndRestore();
  }, [toggleStep, onTabChange, closeAndRestore]);

  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => dialogRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); closeAndRestore(); return; }
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first || document.activeElement === dialogRef.current) { e.preventDefault(); last.focus(); }
        } else {
          if (document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, closeAndRestore]);

  const showBadge = !guideState.dismissed && completedCount < totalSteps;

  const handleTriggerClick = useCallback(() => {
    if (guideState.dismissed && !isOpen) {
      setGuideState((prev) => { const next = { ...prev, dismissed: false }; saveGuideState(next); return next; });
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
        aria-label="Store feature guide"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        title="Store feature guide"
      >
        <Lightbulb className="w-3.5 h-3.5" />
        {showBadge && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-400 animate-pulse" />}
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={closeAndRestore} aria-hidden="true" />
            <motion.div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-label="Store feature guide"
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
                  <h3 className="text-sm font-semibold">Store Guide</h3>
                  <p className="text-xs text-muted-foreground">
                    {allComplete ? "You've explored all features!" : `${completedCount} of ${totalSteps} features explored`}
                  </p>
                </div>
                <button onClick={closeAndRestore} className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none" aria-label="Close guide">
                  <X className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>

              <div className="mb-4">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] text-muted-foreground font-medium">Progress</span>
                  <span className="text-[11px] font-semibold" style={{ color: "hsl(var(--kf-accent1))" }}>{progress}%</span>
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
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex items-center gap-2.5 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 mb-4">
                  <PartyPopper className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-semibold text-emerald-300">All explored!</p>
                    <p className="text-[11px] text-emerald-400/70">You know your way around the Store. Time to start selling.</p>
                  </div>
                </motion.div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5" role="group" aria-label="Store guide steps">
                {GUIDE_STEPS.map((item, idx) => {
                  const Icon = item.icon;
                  const isComplete = guideState.completedSteps.includes(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleStepAction(item.id, item.tab)}
                      aria-pressed={isComplete}
                      aria-label={`${item.title}${isComplete ? " (explored)" : ""}`}
                      className={`flex gap-2.5 p-2.5 rounded-lg transition-colors text-left group w-full focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none ${isComplete ? "bg-muted/20 opacity-70" : "hover:bg-muted/30"}`}
                    >
                      <div className="relative flex-shrink-0 mt-0.5">
                        <div
                          className={`w-6 h-6 rounded-md flex items-center justify-center transition-all ${isComplete ? "bg-emerald-500/15" : "group-hover:scale-110"}`}
                          style={!isComplete ? { backgroundColor: `${item.color}15` } : undefined}
                        >
                          {isComplete ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <span className="text-[10px] font-bold" style={{ color: item.color }}>{idx + 1}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-[11px] font-medium leading-tight ${isComplete ? "line-through text-muted-foreground" : ""}`}>{item.title}</p>
                        <p className="text-[10px] text-muted-foreground/70 leading-relaxed mt-0.5">{item.desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/40">
                {allComplete ? (
                  <button onClick={handleReset} className="text-[11px] text-muted-foreground hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none rounded px-1">Reset progress</button>
                ) : (
                  <button onClick={handleDismiss} className="text-[11px] text-muted-foreground hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none rounded px-1">Don't show again</button>
                )}
                <button
                  onClick={closeAndRestore}
                  className="px-4 py-1.5 text-xs font-medium rounded-lg transition-all hover:opacity-90 focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
                  style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))", color: "white" }}
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
