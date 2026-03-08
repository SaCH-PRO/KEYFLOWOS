"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Lightbulb,
  X,
  Mail,
  Users,
  Sparkles,
  Send,
  FormInput,
  Settings2,
  Share2,
  UserPlus,
  BarChart3,
  MousePointerClick,
  ClipboardList,
  TrendingUp,
  Search,
  Brain,
  PenTool,
  MessageSquare,
  UserCheck,
  Wrench,
  Keyboard,
  Check,
  PartyPopper,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

const STORAGE_KEY = "kf_marketing_guide_state";

interface GuideStep {
  id: string;
  title: string;
  desc: string;
  icon: React.ElementType;
  color: string;
}

interface GuideSection {
  id: string;
  tab: string;
  label: string;
  icon: React.ElementType;
  color: string;
  steps: GuideStep[];
}

const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: "campaigns",
    tab: "campaigns",
    label: "Email Campaigns",
    icon: Mail,
    color: "hsl(var(--kf-accent1))",
    steps: [
      {
        id: "create-campaign",
        title: "Create Campaign",
        desc: "Build email campaigns with a subject line, body content, and save as draft before sending.",
        icon: Mail,
        color: "hsl(var(--kf-accent1))",
      },
      {
        id: "segment-audience",
        title: "Segment Audience",
        desc: "Target specific contacts by tags, status, or custom filters to reach the right audience.",
        icon: Users,
        color: "hsl(var(--kf-accent2))",
      },
      {
        id: "ai-content-generation",
        title: "AI Content Generation",
        desc: "Use AI to generate compelling email copy, subject lines, and calls-to-action in seconds.",
        icon: Sparkles,
        color: "hsl(270 70% 60%)",
      },
      {
        id: "send-and-track",
        title: "Send & Track",
        desc: "Send your campaign and monitor delivery, open rates, and click-through performance.",
        icon: Send,
        color: "hsl(142 76% 36%)",
      },
    ],
  },
  {
    id: "lead-forms",
    tab: "forms",
    label: "Lead Capture",
    icon: FormInput,
    color: "hsl(200 80% 55%)",
    steps: [
      {
        id: "build-forms",
        title: "Build Forms",
        desc: "Create custom lead capture forms with drag-and-drop fields to collect prospect information.",
        icon: FormInput,
        color: "hsl(200 80% 55%)",
      },
      {
        id: "customize-fields",
        title: "Customize Fields",
        desc: "Add text inputs, dropdowns, checkboxes, and phone fields tailored to your business needs.",
        icon: Settings2,
        color: "hsl(var(--kf-accent2))",
      },
      {
        id: "share-and-embed",
        title: "Share & Embed",
        desc: "Get a public URL or embed code to place your forms on any website or landing page.",
        icon: Share2,
        color: "hsl(270 70% 60%)",
      },
      {
        id: "auto-add-to-crm",
        title: "Auto-Add to CRM",
        desc: "Form submissions automatically create contacts in your CRM with all captured data.",
        icon: UserPlus,
        color: "hsl(142 76% 36%)",
      },
    ],
  },
  {
    id: "insights",
    tab: "insights",
    label: "Analytics & Insights",
    icon: BarChart3,
    color: "hsl(142 76% 36%)",
    steps: [
      {
        id: "campaign-performance",
        title: "Campaign Performance",
        desc: "View detailed metrics for each campaign including delivery rates, bounces, and engagement.",
        icon: BarChart3,
        color: "hsl(142 76% 36%)",
      },
      {
        id: "open-click-tracking",
        title: "Open/Click Tracking",
        desc: "Track email open rates and click-through rates to measure content effectiveness.",
        icon: MousePointerClick,
        color: "hsl(var(--kf-accent1))",
      },
      {
        id: "form-submissions",
        title: "Form Submissions",
        desc: "Monitor form submission counts, conversion rates, and identify top-performing forms.",
        icon: ClipboardList,
        color: "hsl(200 80% 55%)",
      },
      {
        id: "audience-growth",
        title: "Audience Growth",
        desc: "Track how your contact list grows over time through campaigns and lead form captures.",
        icon: TrendingUp,
        color: "hsl(var(--kf-accent2))",
      },
    ],
  },
  {
    id: "ai-intelligence",
    tab: "campaigns",
    label: "AI Intelligence",
    icon: Brain,
    color: "hsl(270 70% 60%)",
    steps: [
      {
        id: "ai-search-bar",
        title: "AI Search Bar",
        desc: "Use natural language to control marketing — \"Create a campaign for leads\", \"Show sent campaigns\", or \"What's my open rate?\"",
        icon: Search,
        color: "hsl(270 70% 60%)",
      },
      {
        id: "ai-command-hub",
        title: "AI Command Hub",
        desc: "Access powerful AI tools from the command hub — content generation, audience analysis, and optimization.",
        icon: Sparkles,
        color: "hsl(var(--kf-accent1))",
      },
      {
        id: "content-generator",
        title: "Content Generator",
        desc: "Generate full email campaigns with AI — body text, compelling CTAs, and professional formatting.",
        icon: PenTool,
        color: "hsl(142 76% 36%)",
      },
      {
        id: "subject-line-optimizer",
        title: "Subject Line Optimizer",
        desc: "Get AI-powered subject line suggestions optimized for higher open rates and engagement.",
        icon: MessageSquare,
        color: "hsl(200 80% 55%)",
      },
      {
        id: "audience-advisor",
        title: "Audience Advisor",
        desc: "Get AI recommendations on audience segmentation and targeting for better campaign results.",
        icon: UserCheck,
        color: "hsl(45 93% 47%)",
      },
      {
        id: "form-optimizer",
        title: "Form Optimizer",
        desc: "AI analyzes your lead forms and suggests improvements for higher conversion rates.",
        icon: Wrench,
        color: "hsl(var(--kf-accent2))",
      },
      {
        id: "keyboard-shortcuts",
        title: "Keyboard Shortcuts",
        desc: "Navigate faster with shortcuts — N for new item, F to focus search, 1/2/3 for tabs, Shift+A for AI Hub.",
        icon: Keyboard,
        color: "hsl(0 72% 51%)",
      },
    ],
  },
];

const ALL_STEPS = GUIDE_SECTIONS.flatMap((s) => s.steps);

interface GuideState {
  dismissed: boolean;
  completedSteps: string[];
  collapsedSections: string[];
}

function loadGuideState(): GuideState {
  if (typeof window === "undefined") return { dismissed: false, completedSteps: [], collapsedSections: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { dismissed: false, completedSteps: [], collapsedSections: [] };
    const parsed = JSON.parse(raw);
    return { dismissed: parsed.dismissed ?? false, completedSteps: parsed.completedSteps ?? [], collapsedSections: parsed.collapsedSections ?? [] };
  } catch {
    return { dismissed: false, completedSteps: [], collapsedSections: [] };
  }
}

function saveGuideState(s: GuideState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

interface MarketingGuideProps {
  isOpen: boolean;
  onToggle: () => void;
  onTabChange?: (tab: string) => void;
}

export function MarketingGuide({ isOpen, onToggle, onTabChange }: MarketingGuideProps) {
  const [guideState, setGuideState] = useState<GuideState>(loadGuideState);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const completedCount = guideState.completedSteps.length;
  const totalSteps = ALL_STEPS.length;
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

  const toggleSection = useCallback((sectionId: string) => {
    setGuideState((prev) => {
      const collapsed = prev.collapsedSections.includes(sectionId)
        ? prev.collapsedSections.filter((s) => s !== sectionId)
        : [...prev.collapsedSections, sectionId];
      const next = { ...prev, collapsedSections: collapsed };
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
    const next: GuideState = { dismissed: false, completedSteps: [], collapsedSections: [] };
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
        aria-label="Marketing feature guide"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        title="Marketing feature guide"
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
              aria-label="Marketing feature guide"
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
                  <h3 className="text-sm font-semibold">Marketing Guide</h3>
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
                    <p className="text-[11px] text-emerald-400/70">You know your way around Marketing. Time to grow your audience.</p>
                  </div>
                </motion.div>
              )}

              <div className="space-y-2" role="group" aria-label="Feature guide sections">
                {GUIDE_SECTIONS.map((section) => {
                  const SectionIcon = section.icon;
                  const isCollapsed = guideState.collapsedSections.includes(section.id);
                  const sectionCompleted = section.steps.filter((s) => guideState.completedSteps.includes(s.id)).length;
                  const sectionTotal = section.steps.length;
                  const sectionDone = sectionCompleted === sectionTotal;

                  return (
                    <div key={section.id} className="rounded-xl border border-border/50 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => toggleSection(section.id)}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-white/[0.03] transition-colors focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none rounded-t-xl"
                        aria-expanded={!isCollapsed}
                        aria-controls={`marketing-guide-${section.id}`}
                      >
                        <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${section.color}15` }}>
                          <SectionIcon className="w-3.5 h-3.5" style={{ color: section.color }} />
                        </div>
                        <span className="text-xs font-semibold flex-1 text-left">{section.label}</span>
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md ${sectionDone ? "bg-emerald-500/15 text-emerald-400" : "bg-muted/30 text-muted-foreground"}`}>
                          {sectionCompleted}/{sectionTotal}
                        </span>
                        {isCollapsed ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50" /> : <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/50" />}
                      </button>

                      <AnimatePresence initial={false}>
                        {!isCollapsed && (
                          <motion.div
                            id={`marketing-guide-${section.id}`}
                            role="region"
                            aria-label={`${section.label} features`}
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2, ease: "easeOut" }}
                            className="overflow-hidden"
                          >
                            <div className="px-2 pb-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                              {section.steps.map((item) => {
                                const Icon = item.icon;
                                const isComplete = guideState.completedSteps.includes(item.id);
                                return (
                                  <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => handleStepAction(item.id, section.tab)}
                                    aria-pressed={isComplete}
                                    aria-label={`${item.title}${isComplete ? " (explored)" : ""}`}
                                    className={`flex gap-2.5 p-2.5 rounded-lg transition-colors text-left group w-full focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none ${isComplete ? "bg-muted/20 opacity-70" : "hover:bg-muted/30"}`}
                                  >
                                    <div className="relative flex-shrink-0 mt-0.5">
                                      <div
                                        className={`w-6 h-6 rounded-md flex items-center justify-center transition-all ${isComplete ? "bg-emerald-500/15" : "group-hover:scale-110"}`}
                                        style={!isComplete ? { backgroundColor: `${item.color}15` } : undefined}
                                      >
                                        {isComplete ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Icon className="w-3.5 h-3.5" style={{ color: item.color }} />}
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
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
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
