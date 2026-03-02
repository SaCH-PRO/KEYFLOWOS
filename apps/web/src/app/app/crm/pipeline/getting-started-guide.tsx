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
  LayoutGrid,
  Database,
  BarChart3,
  Sparkles,
  GripVertical,
  Eye,
  Brain,
  ListChecks,
  StickyNote,
  Route,
  ChevronDown,
  ChevronUp,
  Search,
  Wand2,
  ScanSearch,
  RefreshCw,
  DollarSign,
  MessageSquare,
  Shield,
  ClipboardCheck,
  Users,
  ListPlus,
} from "lucide-react";

const STORAGE_KEY = "kf_guide_state";

interface GuideStep {
  id: string;
  title: string;
  desc: string;
  icon: typeof Lightbulb;
  color: string;
  actionLabel?: string;
}

interface GuideSection {
  id: string;
  tab: string;
  label: string;
  icon: typeof Lightbulb;
  color: string;
  steps: GuideStep[];
}

const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: "pipeline",
    tab: "pipeline",
    label: "Pipeline",
    icon: LayoutGrid,
    color: "hsl(var(--kf-accent1))",
    steps: [
      {
        id: "add-contacts",
        title: "Add Contacts",
        desc: "Create contacts manually, scan business cards with AI Vision, import CSV/VCF files, paste from a URL, or sync from Google Contacts.",
        icon: UserPlus,
        color: "hsl(var(--kf-accent1))",
        actionLabel: "Add a contact",
      },
      {
        id: "segment-filter",
        title: "Smart Segments",
        desc: "Filter contacts instantly with one-tap segments like High Value, New This Week, At Risk, and more — find who matters most.",
        icon: SlidersHorizontal,
        color: "hsl(var(--kf-accent2))",
        actionLabel: "Try a segment",
      },
      {
        id: "kanban-board",
        title: "Kanban Board",
        desc: "Switch to Kanban view to see contacts in status columns — Lead, Prospect, Client, Lost. Drag and drop cards to update status instantly.",
        icon: GripVertical,
        color: "hsl(45 93% 47%)",
      },
      {
        id: "communicate",
        title: "One-Tap Communication",
        desc: "Reach out via WhatsApp, email, or phone directly from any contact card — no switching apps needed.",
        icon: MessageCircle,
        color: "hsl(200 80% 55%)",
      },
      {
        id: "broadcast",
        title: "Bulk Actions",
        desc: "Select multiple contacts to send bulk WhatsApp or email messages, assign tags, update statuses, or delete — all at once.",
        icon: Send,
        color: "hsl(270 70% 60%)",
        actionLabel: "Select contacts",
      },
      {
        id: "quick-actions",
        title: "Quick Actions",
        desc: "Create invoices, send quotes, book appointments, or add notes directly from a contact — everything in one place.",
        icon: Zap,
        color: "hsl(142 76% 36%)",
      },
      {
        id: "notes-tasks",
        title: "Notes & Tasks",
        desc: "Add categorized notes (call logs, meeting notes, ideas) and create tasks with priorities, due dates, and reminders — all attached to each contact.",
        icon: StickyNote,
        color: "hsl(35 92% 50%)",
      },
    ],
  },
  {
    id: "database",
    tab: "database",
    label: "Database",
    icon: Database,
    color: "hsl(200 80% 55%)",
    steps: [
      {
        id: "database-table",
        title: "Full Contact Database",
        desc: "View all contacts in a searchable, sortable table with inline status badges, lead scores, tags, and revenue indicators.",
        icon: Database,
        color: "hsl(200 80% 55%)",
      },
      {
        id: "saved-views",
        title: "Saved Views",
        desc: "Save your favorite filter, sort, and column combinations as named views. Comes with 4 defaults: All Contacts, Active Leads, Top Clients, and Needs Attention.",
        icon: Eye,
        color: "hsl(var(--kf-accent2))",
      },
      {
        id: "column-toggle",
        title: "Custom Columns",
        desc: "Show or hide table columns to see exactly the data you need. Columns auto-hide on smaller screens and your preferences are remembered.",
        icon: SlidersHorizontal,
        color: "hsl(270 70% 60%)",
      },
      {
        id: "search-keyboard",
        title: "Search & Navigate",
        desc: "Search across name, email, phone, company, and tags — with multi-word matching and highlighted results. Navigate rows with your keyboard.",
        icon: ListChecks,
        color: "hsl(142 76% 36%)",
      },
    ],
  },
  {
    id: "insights",
    tab: "insights",
    label: "Insights",
    icon: BarChart3,
    color: "hsl(142 76% 36%)",
    steps: [
      {
        id: "dashboard-metrics",
        title: "Live Dashboard",
        desc: "See key metrics at a glance — total contacts, conversion rate, revenue, and active pipeline value with sparkline trends.",
        icon: TrendingUp,
        color: "hsl(142 76% 36%)",
      },
      {
        id: "interactive-charts",
        title: "Interactive Charts",
        desc: "Explore your pipeline funnel, revenue breakdown, growth trends, lead scores, and engagement heatmap — all with interactive tooltips.",
        icon: BarChart3,
        color: "hsl(var(--kf-accent1))",
      },
      {
        id: "ai-analyst",
        title: "AI Analyst",
        desc: "Ask your AI copilot to analyze your pipeline, identify at-risk clients, suggest revenue tips, or generate follow-up tasks — using real CRM data.",
        icon: Brain,
        color: "hsl(270 70% 60%)",
      },
      {
        id: "export-report",
        title: "Export Reports",
        desc: "Export your CRM insights as PDF or CSV reports to share with your team or keep for your records.",
        icon: Send,
        color: "hsl(200 80% 55%)",
      },
    ],
  },
  {
    id: "engage",
    tab: "engage",
    label: "Engage",
    icon: Sparkles,
    color: "hsl(var(--kf-accent2))",
    steps: [
      {
        id: "next-actions",
        title: "Next Actions Queue",
        desc: "Your AI generates a prioritized queue of what to do next — follow up on overdue tasks, convert stale prospects, re-engage cold leads, and more.",
        icon: Zap,
        color: "hsl(45 93% 47%)",
      },
      {
        id: "autopilot",
        title: "Autopilot Actions",
        desc: "Let AI handle routine tasks automatically — welcome messages for new leads, payment reminders, post-session follow-ups. Approve or deny each one.",
        icon: Sparkles,
        color: "hsl(var(--kf-accent2))",
      },
      {
        id: "sequences",
        title: "Engagement Sequences",
        desc: "Build multi-step automated sequences — like a 5-step new lead onboarding or a re-engagement drip. Enroll contacts and track progress through each step.",
        icon: Route,
        color: "hsl(var(--kf-accent1))",
      },
      {
        id: "momentum",
        title: "CRM Momentum",
        desc: "Earn XP for completing actions, closing deals, and staying consistent. Track your streaks and level up your CRM game with the built-in gamification system.",
        icon: TrendingUp,
        color: "hsl(142 76% 36%)",
      },
    ],
  },
  {
    id: "ai",
    tab: "pipeline",
    label: "AI Intelligence",
    icon: Brain,
    color: "hsl(270 70% 60%)",
    steps: [
      {
        id: "ai-search",
        title: "Natural Language Commands",
        desc: "Type plain English commands like 'add a note to John' or 'change all cold leads to lost' — the AI interprets and executes CRM actions for you.",
        icon: Search,
        color: "hsl(var(--kf-accent1))",
        actionLabel: "Try the AI bar",
      },
      {
        id: "ai-hub",
        title: "AI Command Hub",
        desc: "Open the floating AI button to access 11 powerful tools — contact briefings, lead scoring, conversation prep, churn detection, pipeline analysis, and more.",
        icon: Wand2,
        color: "hsl(270 70% 60%)",
        actionLabel: "Open AI Hub",
      },
      {
        id: "ai-data-quality",
        title: "Data Quality Scan",
        desc: "AI scans your entire contact database for missing fields, incomplete records, and data issues — with a completeness score and fix recommendations.",
        icon: ClipboardCheck,
        color: "hsl(200 80% 55%)",
      },
      {
        id: "ai-duplicates",
        title: "Duplicate Finder",
        desc: "Automatically detect duplicate contacts by matching emails, phone numbers, and names — with confidence scores for each potential match.",
        icon: ScanSearch,
        color: "hsl(45 93% 47%)",
      },
      {
        id: "ai-reengagement",
        title: "Re-engagement Planner",
        desc: "Find stale contacts who haven't been touched in 30+ days and get AI-crafted re-engagement strategies with urgency levels and suggested sequences.",
        icon: RefreshCw,
        color: "hsl(var(--kf-accent2))",
      },
      {
        id: "ai-revenue",
        title: "Revenue Opportunity Scanner",
        desc: "AI analyzes your pipeline to uncover upsell, repeat business, and hot prospect opportunities — with estimated revenue impact in TTD.",
        icon: DollarSign,
        color: "hsl(142 76% 36%)",
      },
      {
        id: "ai-followup",
        title: "Follow-up Drafter",
        desc: "Select a contact and AI generates personalized follow-up messages in formal and friendly tones — using their history, notes, and outstanding invoices.",
        icon: MessageSquare,
        color: "hsl(var(--kf-accent1))",
      },
      {
        id: "ai-execute",
        title: "Server-Side AI Actions",
        desc: "Commands like 'enroll in sequence', 'create a VIP list', 'add a note', or 'change status' execute instantly on the server — no extra clicks needed.",
        icon: Zap,
        color: "hsl(35 92% 50%)",
      },
      {
        id: "ai-lists",
        title: "AI List Management",
        desc: "Create contact lists, add or remove contacts, and manage groups — all through natural language. Say 'create a Hot Leads list' and it's done.",
        icon: ListPlus,
        color: "hsl(200 80% 55%)",
      },
      {
        id: "ai-churn",
        title: "Churn Risk Detection",
        desc: "AI identifies at-risk contacts with probability scores, warning reasons, and estimated revenue loss — so you can intervene before it's too late.",
        icon: Shield,
        color: "hsl(0 84% 60%)",
      },
      {
        id: "ai-bulk",
        title: "AI Bulk Operations",
        desc: "Tell the AI to 'change all cold prospects to lost' or 'tag everyone from Company X as VIP' — bulk operations handled through natural language.",
        icon: Users,
        color: "hsl(270 70% 60%)",
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
  onTabChange?: (tab: string) => void;
}

export function GettingStartedGuide({
  isOpen,
  onToggle,
  onAddContact,
  onToggleSelectMode,
  onSegmentChange,
  onTabChange,
}: GettingStartedGuideProps) {
  const [guideState, setGuideState] = useState<GuideState>(loadGuideState);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const completedCount = guideState.completedSteps.length;
  const totalSteps = ALL_STEPS.length;
  const allComplete = completedCount === totalSteps;
  const progress = Math.round((completedCount / totalSteps) * 100);

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
    closeAndRestoreFocus();
  }, [closeAndRestoreFocus]);

  const handleReset = useCallback(() => {
    const next: GuideState = { dismissed: false, completedSteps: [], collapsedSections: [] };
    setGuideState(next);
    saveGuideState(next);
  }, []);

  const handleStepAction = useCallback((stepId: string, tab: string) => {
    toggleStep(stepId);
    onTabChange?.(tab);
    if (stepId === "add-contacts") onAddContact?.();
    if (stepId === "segment-filter") onSegmentChange?.("high-value");
    if (stepId === "broadcast") onToggleSelectMode?.();
    closeAndRestoreFocus();
  }, [toggleStep, onAddContact, onToggleSelectMode, onSegmentChange, onTabChange, closeAndRestoreFocus]);

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

  const showBadge = !guideState.dismissed && completedCount < totalSteps;

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
                  <h3 className="text-sm font-semibold">CRM Feature Guide</h3>
                  <p className="text-xs text-muted-foreground">
                    {allComplete
                      ? "You've explored all features!"
                      : `${completedCount} of ${totalSteps} features explored`}
                  </p>
                </div>
                <button
                  onClick={closeAndRestoreFocus}
                  className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none"
                  aria-label="Close guide"
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
                    <p className="text-xs font-semibold text-emerald-300">All explored!</p>
                    <p className="text-[11px] text-emerald-400/70">You know your way around the CRM. Time to grow your business.</p>
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
                        aria-controls={`guide-section-${section.id}`}
                      >
                        <div
                          className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
                          style={{ backgroundColor: `${section.color}15` }}
                        >
                          <SectionIcon className="w-3.5 h-3.5" style={{ color: section.color }} />
                        </div>
                        <span className="text-xs font-semibold flex-1 text-left">{section.label}</span>
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md ${sectionDone ? "bg-emerald-500/15 text-emerald-400" : "bg-muted/30 text-muted-foreground"}`}>
                          {sectionCompleted}/{sectionTotal}
                        </span>
                        {isCollapsed ? (
                          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50" />
                        ) : (
                          <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/50" />
                        )}
                      </button>

                      <AnimatePresence initial={false}>
                        {!isCollapsed && (
                          <motion.div
                            id={`guide-section-${section.id}`}
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
                                    className={`flex gap-2.5 p-2.5 rounded-lg transition-colors text-left group w-full focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none ${
                                      isComplete
                                        ? "bg-muted/20 opacity-70"
                                        : "hover:bg-muted/30"
                                    }`}
                                  >
                                    <div className="relative flex-shrink-0 mt-0.5">
                                      <div
                                        className={`w-6 h-6 rounded-md flex items-center justify-center transition-all ${
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
                                      <p className={`text-[11px] font-medium leading-tight ${isComplete ? "line-through text-muted-foreground" : ""}`}>
                                        {item.title}
                                      </p>
                                      <p className="text-[10px] text-muted-foreground/70 leading-relaxed mt-0.5">
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
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
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
