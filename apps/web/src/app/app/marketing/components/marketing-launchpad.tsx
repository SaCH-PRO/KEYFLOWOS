"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Rocket,
  Mail,
  Share2,
  ClipboardList,
  Sparkles,
  ChevronRight,
  Check,
  X,
  MailCheck,
  Target,
  TrendingUp,
  Zap,
  ArrowRight,
  RefreshCw,
} from "lucide-react";
import type { EmailCampaign, LeadForm, SocialPost } from "@/lib/client";

const STORAGE_KEY = "kf_marketing_launchpad";

interface LaunchpadState {
  dismissed: boolean;
  completedMissions: string[];
  lastSeen: number;
}

function loadState(): LaunchpadState {
  if (typeof window === "undefined") return { dismissed: false, completedMissions: [], lastSeen: 0 };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { dismissed: false, completedMissions: [], lastSeen: 0 };
    return JSON.parse(raw);
  } catch {
    return { dismissed: false, completedMissions: [], lastSeen: 0 };
  }
}

function saveState(s: LaunchpadState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {}
}

interface Mission {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  color: string;
  bgColor: string;
  actionLabel: string;
  phase: "launch" | "grow" | "optimize";
  dataDetectable: boolean;
}

const MISSIONS: Mission[] = [
  {
    id: "connect-email",
    title: "Connect your email",
    description: "Link Gmail so your campaigns actually reach your audience's inbox.",
    icon: MailCheck,
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    actionLabel: "Connect Gmail",
    phase: "launch",
    dataDetectable: true,
  },
  {
    id: "first-campaign",
    title: "Send your first campaign",
    description: "Create an email campaign, write your message, and hit send to your contacts.",
    icon: Mail,
    color: "text-[hsl(var(--kf-accent1))]",
    bgColor: "bg-[hsl(var(--kf-accent1))]/10",
    actionLabel: "Create Campaign",
    phase: "launch",
    dataDetectable: true,
  },
  {
    id: "first-form",
    title: "Build a lead capture form",
    description: "Create a form to collect leads from your website or social media links.",
    icon: ClipboardList,
    color: "text-sky-400",
    bgColor: "bg-sky-500/10",
    actionLabel: "Create Form",
    phase: "launch",
    dataDetectable: true,
  },
  {
    id: "first-post",
    title: "Publish a social post",
    description: "Create and publish content to keep your audience engaged across platforms.",
    icon: Share2,
    color: "text-violet-400",
    bgColor: "bg-violet-500/10",
    actionLabel: "Create Post",
    phase: "launch",
    dataDetectable: true,
  },
  {
    id: "ai-strategy",
    title: "Get an AI marketing strategy",
    description: "Let AI analyze your business and create a tailored marketing plan for growth.",
    icon: Sparkles,
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    actionLabel: "Generate Strategy",
    phase: "grow",
    dataDetectable: false,
  },
  {
    id: "segment-audience",
    title: "Segment your audience",
    description: "Target specific contacts by tags or status for more effective campaigns.",
    icon: Target,
    color: "text-rose-400",
    bgColor: "bg-rose-500/10",
    actionLabel: "View Campaigns",
    phase: "grow",
    dataDetectable: true,
  },
  {
    id: "track-performance",
    title: "Review your analytics",
    description: "Check open rates, click rates, and form conversions to see what's working.",
    icon: TrendingUp,
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    actionLabel: "View Insights",
    phase: "optimize",
    dataDetectable: false,
  },
  {
    id: "ai-optimize",
    title: "Optimize with AI tools",
    description: "Use the AI Hub for subject line optimization, audience advice, and content ideas.",
    icon: Zap,
    color: "text-[hsl(var(--kf-accent2))]",
    bgColor: "bg-[hsl(var(--kf-accent2))]/10",
    actionLabel: "Open AI Hub",
    phase: "optimize",
    dataDetectable: false,
  },
];

interface MarketingLaunchpadProps {
  campaigns: EmailCampaign[];
  forms: LeadForm[];
  socialPosts: SocialPost[];
  gmailConnected: boolean;
  onTabChange: (tab: string) => void;
  onGmailConnect: () => void;
  onShowStrategy: () => void;
  onOpenAiHub: () => void;
  onNewCampaign: () => void;
  onNewForm: () => void;
  onNewPost: () => void;
}

export function MarketingLaunchpad({
  campaigns,
  forms,
  socialPosts,
  gmailConnected,
  onTabChange,
  onGmailConnect,
  onShowStrategy,
  onOpenAiHub,
  onNewCampaign,
  onNewForm,
  onNewPost,
}: MarketingLaunchpadProps) {
  const [state, setState] = useState<LaunchpadState>(loadState);
  const [showAll, setShowAll] = useState(false);

  const autoCompleted = useMemo(() => {
    const auto: string[] = [];
    if (gmailConnected) auto.push("connect-email");
    if (campaigns.some((c) => c.status === "SENT")) auto.push("first-campaign");
    if (forms.length > 0) auto.push("first-form");
    if (socialPosts.some((p) => p.status === "POSTED" || p.postedAt)) auto.push("first-post");
    if (campaigns.some((c) => c.segmentFilter)) auto.push("segment-audience");
    return auto;
  }, [gmailConnected, campaigns, forms, socialPosts]);

  const allCompleted = useMemo(() => {
    return new Set([...state.completedMissions, ...autoCompleted]);
  }, [state.completedMissions, autoCompleted]);

  const completedCount = allCompleted.size;
  const totalMissions = MISSIONS.length;
  const progress = Math.round((completedCount / totalMissions) * 100);
  const isAllDone = completedCount >= totalMissions;

  useEffect(() => {
    if (autoCompleted.length > 0) {
      setState((prev) => {
        const newCompleted = [...new Set([...prev.completedMissions, ...autoCompleted])];
        if (newCompleted.length !== prev.completedMissions.length) {
          const next = { ...prev, completedMissions: newCompleted };
          saveState(next);
          return next;
        }
        return prev;
      });
    }
  }, [autoCompleted]);

  const markComplete = useCallback((missionId: string) => {
    setState((prev) => {
      if (prev.completedMissions.includes(missionId)) return prev;
      const next = { ...prev, completedMissions: [...prev.completedMissions, missionId] };
      saveState(next);
      return next;
    });
  }, []);

  const handleMissionAction = useCallback(
    (mission: Mission) => {
      if (!mission.dataDetectable) {
        markComplete(mission.id);
      }
      switch (mission.id) {
        case "connect-email":
          onGmailConnect();
          break;
        case "first-campaign":
          onTabChange("campaigns");
          onNewCampaign();
          break;
        case "first-form":
          onTabChange("forms");
          onNewForm();
          break;
        case "first-post":
          onTabChange("social");
          onNewPost();
          break;
        case "ai-strategy":
          onShowStrategy();
          break;
        case "segment-audience":
          onTabChange("campaigns");
          break;
        case "track-performance":
          onTabChange("insights");
          break;
        case "ai-optimize":
          onOpenAiHub();
          break;
      }
    },
    [markComplete, onTabChange, onGmailConnect, onShowStrategy, onOpenAiHub, onNewCampaign, onNewForm, onNewPost],
  );

  const handleDismiss = useCallback(() => {
    setState((prev) => {
      const next = { ...prev, dismissed: true };
      saveState(next);
      return next;
    });
  }, []);

  const handleRestore = useCallback(() => {
    setState((prev) => {
      const next = { ...prev, dismissed: false };
      saveState(next);
      return next;
    });
  }, []);

  const handleReset = useCallback(() => {
    const next: LaunchpadState = { dismissed: false, completedMissions: [], lastSeen: Date.now() };
    setState(next);
    saveState(next);
  }, []);

  const nextMissions = useMemo(() => {
    return MISSIONS.filter((m) => !allCompleted.has(m.id));
  }, [allCompleted]);

  const phases = useMemo(() => {
    const groups = [
      { key: "launch" as const, label: "Launch", icon: Rocket },
      { key: "grow" as const, label: "Grow", icon: TrendingUp },
      { key: "optimize" as const, label: "Optimize", icon: Zap },
    ];
    return groups.map((g) => ({
      ...g,
      missions: MISSIONS.filter((m) => m.phase === g.key),
      completed: MISSIONS.filter((m) => m.phase === g.key && allCompleted.has(m.id)).length,
      total: MISSIONS.filter((m) => m.phase === g.key).length,
    }));
  }, [allCompleted]);

  if (state.dismissed && !isAllDone) {
    return (
      <motion.button
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        onClick={handleRestore}
        className="w-full flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border/40 bg-card/60 backdrop-blur-sm hover:bg-card/80 transition-colors text-left group"
      >
        <Rocket className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
        <span className="text-xs text-muted-foreground flex-1">
          Continue your marketing setup — {completedCount}/{totalMissions} complete
        </span>
        <div className="w-16 h-1.5 rounded-full bg-muted/30 overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{
              width: `${progress}%`,
              background: "linear-gradient(90deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
            }}
          />
        </div>
        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
      </motion.button>
    );
  }

  if (isAllDone && state.dismissed) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm overflow-hidden"
    >
      <div className="px-5 pt-4 pb-3 flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] flex items-center justify-center shrink-0 mt-0.5">
          <Rocket className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="text-sm font-semibold">
              {isAllDone ? "Marketing is set up!" : "Launch your marketing"}
            </h3>
            {isAllDone && (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400">
                Complete
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {isAllDone
              ? "You've completed all setup steps. Keep using these tools to grow your business."
              : "Follow these steps to start reaching your customers and growing your audience."}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {isAllDone && (
            <button
              onClick={handleReset}
              className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors"
              title="Reset progress"
            >
              <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          )}
          <button
            onClick={handleDismiss}
            className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors"
            title={isAllDone ? "Close" : "Minimize"}
          >
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>

      <div className="px-5 pb-2">
        <div className="flex items-center gap-3 mb-1">
          <div className="flex-1 h-1.5 rounded-full bg-muted/30 overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{
                background: isAllDone
                  ? "hsl(142 76% 36%)"
                  : "linear-gradient(90deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
              }}
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.6, ease: "easeOut" }}
            />
          </div>
          <span className="text-[11px] font-medium text-muted-foreground">
            {completedCount}/{totalMissions}
          </span>
        </div>
      </div>

      {!showAll && !isAllDone && nextMissions.length > 0 && (
        <div className="px-5 pb-3">
          <div className="space-y-1.5">
            {nextMissions.slice(0, 3).map((mission, idx) => {
              const Icon = mission.icon;
              return (
                <motion.button
                  key={mission.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  onClick={() => handleMissionAction(mission)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-muted/30 transition-colors text-left group"
                >
                  <div className={`w-8 h-8 rounded-lg ${mission.bgColor} flex items-center justify-center shrink-0`}>
                    <Icon className={`w-4 h-4 ${mission.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium">{mission.title}</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{mission.description}</p>
                  </div>
                  <span className="text-[10px] font-medium text-[hsl(var(--kf-accent1))] opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 shrink-0">
                    {mission.actionLabel}
                    <ArrowRight className="w-3 h-3" />
                  </span>
                </motion.button>
              );
            })}
          </div>
          {nextMissions.length > 3 && (
            <button
              onClick={() => setShowAll(true)}
              className="w-full text-center text-[11px] text-muted-foreground hover:text-foreground transition-colors mt-2 py-1.5"
            >
              Show all {totalMissions - completedCount} remaining steps
            </button>
          )}
        </div>
      )}

      <AnimatePresence>
        {(showAll || isAllDone) && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-4 space-y-3">
              {phases.map((phase) => {
                const PhaseIcon = phase.icon;
                return (
                  <div key={phase.key}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <PhaseIcon className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {phase.label}
                      </span>
                      <span className="text-[10px] text-muted-foreground/70">
                        {phase.completed}/{phase.total}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {phase.missions.map((mission) => {
                        const Icon = mission.icon;
                        const done = allCompleted.has(mission.id);
                        return (
                          <button
                            key={mission.id}
                            onClick={() => !done && handleMissionAction(mission)}
                            disabled={done}
                            className={`w-full flex items-center gap-3 p-2.5 rounded-xl text-left transition-colors ${
                              done
                                ? "opacity-60 cursor-default"
                                : "hover:bg-muted/30 group"
                            }`}
                          >
                            <div
                              className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                                done ? "bg-emerald-500/15" : mission.bgColor
                              }`}
                            >
                              {done ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <Icon className={`w-3.5 h-3.5 ${mission.color}`} />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={`text-xs font-medium ${done ? "line-through text-muted-foreground" : ""}`}>
                                {mission.title}
                              </p>
                              <p className="text-[10px] text-muted-foreground/70">{mission.description}</p>
                            </div>
                            {!done && (
                              <span className="text-[10px] font-medium text-[hsl(var(--kf-accent1))] opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 shrink-0">
                                {mission.actionLabel}
                                <ArrowRight className="w-3 h-3" />
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {showAll && !isAllDone && (
                <button
                  onClick={() => setShowAll(false)}
                  className="w-full text-center text-[11px] text-muted-foreground hover:text-foreground transition-colors py-1"
                >
                  Show less
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
