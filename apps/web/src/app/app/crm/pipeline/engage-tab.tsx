"use client";

import React, { useState, useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Sparkles, Filter, ArrowUpDown, History, CheckCircle2,
  MessageSquare, FileText, Phone, Mail, DollarSign, Clock,
  Zap, Bot, ChevronDown, X, Timer, Target, TrendingUp,
  ArrowUpRight, Activity,
} from "lucide-react";
import { NextActionQueue } from "@/components/contacts";
import { AutopilotActions } from "@/components/contacts";
import { Skeleton } from "@/components/ui/skeleton";
import type { NextAction } from "@/components/contacts/next-action-queue";
import type { AutopilotAction } from "@/components/contacts/autopilot-actions";

type ActionTypeFilter = NextAction["type"] | "all";
type PriorityFilter = NextAction["priority"] | "all";
type SortOption = "priority" | "dueDate" | "value" | "time";

const TYPE_OPTIONS: { value: ActionTypeFilter; label: string; icon: typeof MessageSquare }[] = [
  { value: "all", label: "All", icon: Zap },
  { value: "follow_up", label: "Follow Up", icon: MessageSquare },
  { value: "send_quote", label: "Quote", icon: FileText },
  { value: "call", label: "Call", icon: Phone },
  { value: "email", label: "Email", icon: Mail },
  { value: "payment_reminder", label: "Payment", icon: DollarSign },
  { value: "task", label: "Task", icon: CheckCircle2 },
];

const PRIORITY_OPTIONS: { value: PriorityFilter; label: string; color: string }[] = [
  { value: "all", label: "All Priorities", color: "" },
  { value: "urgent", label: "Urgent", color: "bg-red-500/15 text-red-400 border-red-500/20" },
  { value: "high", label: "High", color: "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] border-[hsl(var(--kf-accent1))]/20" },
  { value: "medium", label: "Medium", color: "bg-[hsl(var(--kf-accent2))]/15 text-[hsl(var(--kf-accent2))] border-[hsl(var(--kf-accent2))]/20" },
  { value: "low", label: "Low", color: "bg-muted/50 text-muted-foreground border-border/50" },
];

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "priority", label: "Priority" },
  { value: "dueDate", label: "Due Date" },
  { value: "value", label: "Value" },
  { value: "time", label: "Est. Time" },
];

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

const stagger = {
  container: { hidden: {}, visible: { transition: { staggerChildren: 0.06 } } },
  item: { hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] as const } } },
};

interface EngageTabProps {
  nextActions: NextAction[];
  autopilotActions: AutopilotAction[];
  autopilotPaused: boolean;
  loading?: boolean;
  onComplete: (id: string) => Promise<void>;
  onViewContact: (id: string) => void;
  onDoAction: (action: NextAction) => void;
  onTogglePause: () => void;
  onApprove: (id: string) => Promise<void>;
  onDeny: (id: string) => Promise<void>;
}

const EngageSkeleton = React.memo(function EngageSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading engagement data">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border/50 bg-card p-4">
            <Skeleton className="h-3 w-16 mb-3" />
            <Skeleton className="h-7 w-12 mb-2" />
            <Skeleton className="h-2 w-full rounded-full" />
          </div>
        ))}
      </div>
      <div className="rounded-2xl border border-border/50 bg-card p-4">
        <div className="flex gap-2 mb-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-16 rounded-full" />
          ))}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border/50 bg-card p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-8 rounded-xl" />
              <div className="space-y-1">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
            {Array.from({ length: 3 }).map((_, j) => (
              <div key={j} className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02]">
                <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-7 w-14 rounded-lg" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
});

const HeroStats = React.memo(function HeroStats({
  nextActions, autopilotActions, completedCount,
}: {
  nextActions: NextAction[];
  autopilotActions: AutopilotAction[];
  completedCount: number;
}) {
  const stats = useMemo(() => {
    const total = nextActions.length + completedCount;
    const completionRate = total > 0 ? Math.round((completedCount / total) * 100) : 0;
    const urgentCount = nextActions.filter((a) => a.priority === "urgent" || a.priority === "high").length;
    const totalValue = nextActions.reduce((sum, a) => sum + (a.value ?? 0), 0);
    const autopilotDone = autopilotActions.filter((a) => a.status === "completed").length;
    const totalTime = nextActions.reduce((sum, a) => sum + a.estimatedTime, 0);

    return [
      {
        label: "Pending",
        value: nextActions.length,
        sub: urgentCount > 0 ? `${urgentCount} high priority` : "No urgent",
        icon: Target,
        accent: "from-[hsl(var(--kf-accent1))]/15 to-[hsl(var(--kf-accent1))]/5",
        iconColor: "text-[hsl(var(--kf-accent1))]",
        highlight: urgentCount > 0,
      },
      {
        label: "Completed",
        value: completedCount,
        sub: `${completionRate}% today`,
        icon: CheckCircle2,
        accent: "from-[hsl(var(--kf-accent2))]/15 to-[hsl(var(--kf-accent2))]/5",
        iconColor: "text-[hsl(var(--kf-accent2))]",
        highlight: false,
      },
      {
        label: "Pipeline Value",
        value: totalValue > 0 ? `TTD ${(totalValue / 1000).toFixed(totalValue >= 1000 ? 1 : 0)}k` : "—",
        sub: totalValue > 0 ? `across ${nextActions.filter((a) => a.value).length} deals` : "No values set",
        icon: TrendingUp,
        accent: "from-emerald-500/15 to-emerald-500/5",
        iconColor: "text-emerald-400",
        highlight: false,
      },
      {
        label: "Autopilot",
        value: autopilotDone,
        sub: `${autopilotActions.filter((a) => a.status === "pending").length} scheduled`,
        icon: Bot,
        accent: "from-blue-500/15 to-blue-500/5",
        iconColor: "text-blue-400",
        highlight: false,
      },
    ];
  }, [nextActions, autopilotActions, completedCount]);

  return (
    <motion.div variants={stagger.item} className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <div
            key={stat.label}
            className="relative rounded-2xl border border-border/50 bg-card p-4 overflow-hidden"
          >
            <div className={`absolute -top-6 -right-6 w-16 h-16 rounded-full bg-gradient-to-br ${stat.accent} blur-xl opacity-60`} aria-hidden="true" />
            <div className="relative">
              <div className="flex items-center gap-2 mb-2">
                <div className={`p-1.5 rounded-lg bg-gradient-to-br ${stat.accent}`}>
                  <Icon className={`w-3.5 h-3.5 ${stat.iconColor}`} />
                </div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">{stat.label}</span>
              </div>
              <p className={`text-2xl font-bold tracking-tight ${stat.highlight ? "text-[hsl(var(--kf-accent1))]" : ""}`}>
                {stat.value}
              </p>
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">{stat.sub}</p>
            </div>
          </div>
        );
      })}
    </motion.div>
  );
});

const ProgressRing = React.memo(function ProgressRing({
  nextActions, completedCount,
}: {
  nextActions: NextAction[];
  completedCount: number;
}) {
  const total = nextActions.length + completedCount;
  if (total === 0) return null;

  const pct = Math.round((completedCount / total) * 100);
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (pct / 100) * circumference;

  const urgentPct = total > 0
    ? Math.round((nextActions.filter((a) => a.priority === "urgent").length / total) * 100)
    : 0;

  return (
    <motion.div
      variants={stagger.item}
      className="rounded-2xl border border-border/50 bg-card p-4"
    >
      <div className="flex items-center gap-4">
        <div className="relative shrink-0">
          <svg width="68" height="68" viewBox="0 0 68 68" className="-rotate-90" aria-hidden="true">
            <circle cx="34" cy="34" r={radius} fill="none" stroke="hsl(var(--kf-border))" strokeWidth="4" opacity="0.3" />
            <motion.circle
              cx="34" cy="34" r={radius}
              fill="none"
              stroke="url(#progressGradient)"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={circumference}
              initial={{ strokeDashoffset: circumference }}
              animate={{ strokeDashoffset }}
              transition={{ duration: 1, ease: [0.25, 0.46, 0.45, 0.94] }}
            />
            <defs>
              <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="hsl(var(--kf-accent1))" />
                <stop offset="100%" stopColor="hsl(var(--kf-accent2))" />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-sm font-bold">{pct}%</span>
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Activity className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Today's Progress</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold">{completedCount}</span>
            <span className="text-xs text-muted-foreground/60">of {total} actions</span>
          </div>

          <div className="flex gap-3 mt-2">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-[hsl(var(--kf-accent2))]" />
              <span className="text-[10px] text-muted-foreground/60">Done {completedCount}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full bg-[hsl(var(--kf-accent1))]" />
              <span className="text-[10px] text-muted-foreground/60">Remaining {nextActions.length}</span>
            </div>
            {urgentPct > 0 && (
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-red-500" />
                <span className="text-[10px] text-muted-foreground/60">Urgent {urgentPct}%</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
});

const FilterToolbar = React.memo(function FilterToolbar({
  typeFilter, priorityFilter, sortBy, activeFilterCount,
  onTypeFilter, onPriorityFilter, onSortBy, onClear,
}: {
  typeFilter: ActionTypeFilter;
  priorityFilter: PriorityFilter;
  sortBy: SortOption;
  activeFilterCount: number;
  onTypeFilter: (v: ActionTypeFilter) => void;
  onPriorityFilter: (v: PriorityFilter) => void;
  onSortBy: (v: SortOption) => void;
  onClear: () => void;
}) {
  const [showSortMenu, setShowSortMenu] = useState(false);

  return (
    <motion.div
      variants={stagger.item}
      className="rounded-2xl border border-border/50 bg-card p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 mr-1">
          <Filter className="w-3.5 h-3.5 text-muted-foreground/60" />
          {activeFilterCount > 0 && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))]">
              {activeFilterCount}
            </span>
          )}
        </div>

        {TYPE_OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const active = typeFilter === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => onTypeFilter(active ? "all" : opt.value)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold rounded-lg border transition-all ${
                active
                  ? "bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] border-[hsl(var(--kf-accent1))]/20"
                  : "bg-white/[0.02] text-muted-foreground/60 border-transparent hover:bg-white/[0.04] hover:text-foreground"
              }`}
            >
              <Icon className="w-3 h-3" />
              {opt.label}
            </button>
          );
        })}

        <div className="h-4 w-px bg-border/50 mx-0.5" />

        {PRIORITY_OPTIONS.filter((p) => p.value !== "all").map((opt) => {
          const active = priorityFilter === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => onPriorityFilter(active ? "all" : opt.value)}
              className={`px-2.5 py-1.5 text-[10px] font-semibold rounded-lg border transition-all ${
                active
                  ? opt.color
                  : "bg-white/[0.02] text-muted-foreground/60 border-transparent hover:bg-white/[0.04] hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          );
        })}

        {activeFilterCount > 0 && (
          <button
            onClick={onClear}
            className="flex items-center gap-1 px-2 py-1.5 text-[10px] font-medium text-muted-foreground/60 hover:text-foreground transition-colors"
          >
            <X className="w-3 h-3" />
            Clear
          </button>
        )}

        <div className="ml-auto relative">
          <button
            onClick={() => setShowSortMenu(!showSortMenu)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold rounded-lg bg-white/[0.03] text-muted-foreground/60 hover:bg-white/[0.05] hover:text-foreground transition-all border border-border/30"
          >
            <ArrowUpDown className="w-3 h-3" />
            {SORT_OPTIONS.find((s) => s.value === sortBy)?.label}
            <ChevronDown className={`w-3 h-3 transition-transform ${showSortMenu ? "rotate-180" : ""}`} />
          </button>
          {showSortMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowSortMenu(false)} />
              <div className="absolute right-0 top-full mt-1 z-50 bg-popover/95 backdrop-blur-xl border border-border/50 rounded-xl shadow-lg py-1 min-w-[140px]">
                {SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => { onSortBy(opt.value); setShowSortMenu(false); }}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-white/[0.04] transition-colors ${
                      sortBy === opt.value ? "text-[hsl(var(--kf-accent1))] font-medium" : "text-foreground"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
});

const CompletionTimeline = React.memo(function CompletionTimeline({ actions }: { actions: AutopilotAction[] }) {
  const [showAll, setShowAll] = useState(false);
  const completed = useMemo(() => actions.filter((a) => a.status === "completed"), [actions]);
  if (completed.length === 0) return null;

  const visible = showAll ? completed : completed.slice(0, 5);

  return (
    <motion.div variants={stagger.item} className="rounded-2xl border border-border/50 bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-1 h-5 rounded-full bg-gradient-to-b from-[hsl(var(--kf-accent2))] to-[hsl(var(--kf-accent2))]/30" />
        <History className="w-3.5 h-3.5 text-muted-foreground/50" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Activity Timeline</span>
        <span className="ml-auto text-[10px] text-muted-foreground/50 font-medium">{completed.length} completed</span>
      </div>

      <div className="relative">
        <div className="absolute left-[15px] top-0 bottom-0 w-px bg-border/30" aria-hidden="true" />

        <div className="space-y-0.5">
          {visible.map((action, i) => (
            <div key={action.id} className="flex items-center gap-3 py-2 px-1 rounded-lg hover:bg-white/[0.02] transition-colors relative">
              <div className="w-[11px] h-[11px] rounded-full border-2 border-[hsl(var(--kf-accent2))]/40 bg-card shrink-0 z-10 ml-[10px]" />
              <CheckCircle2 className="w-3.5 h-3.5 text-[hsl(var(--kf-accent2))]/50 shrink-0" />
              <span className="flex-1 text-xs text-muted-foreground/70 truncate">{action.description}</span>
              <span className="text-[10px] text-muted-foreground/50 shrink-0 font-medium">
                {action.completedAt
                  ? new Date(action.completedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                  : ""}
              </span>
            </div>
          ))}
        </div>
      </div>

      {completed.length > 5 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="w-full mt-2 py-1.5 text-[10px] font-medium text-muted-foreground/50 hover:text-foreground transition-colors rounded-lg hover:bg-white/[0.02]"
        >
          {showAll ? "Show less" : `Show ${completed.length - 5} more`}
        </button>
      )}
    </motion.div>
  );
});

const ActionBreakdown = React.memo(function ActionBreakdown({ actions }: { actions: NextAction[] }) {
  const breakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    actions.forEach((a) => { counts[a.type] = (counts[a.type] || 0) + 1; });
    return TYPE_OPTIONS
      .filter((o) => o.value !== "all" && (counts[o.value] || 0) > 0)
      .map((o) => ({ ...o, count: counts[o.value] || 0 }))
      .sort((a, b) => b.count - a.count);
  }, [actions]);

  if (breakdown.length === 0) return null;
  const maxCount = Math.max(...breakdown.map((b) => b.count));

  return (
    <motion.div variants={stagger.item} className="rounded-2xl border border-border/50 bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-1 h-5 rounded-full bg-gradient-to-b from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent1))]/30" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Action Breakdown</span>
      </div>
      <div className="space-y-2">
        {breakdown.map((item) => {
          const Icon = item.icon;
          const pct = maxCount > 0 ? (item.count / maxCount) * 100 : 0;
          return (
            <div key={item.value} className="flex items-center gap-2.5">
              <Icon className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
              <span className="text-xs text-muted-foreground/70 w-16 shrink-0">{item.label}</span>
              <div className="flex-1 h-5 rounded-md bg-white/[0.03] overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
                  className="h-full rounded-md bg-gradient-to-r from-[hsl(var(--kf-accent1))]/30 to-[hsl(var(--kf-accent1))]/10 flex items-center justify-end pr-2"
                >
                  <span className="text-[10px] font-semibold text-[hsl(var(--kf-accent1))]">{item.count}</span>
                </motion.div>
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
});

export function EngageTab({
  nextActions, autopilotActions, autopilotPaused, loading,
  onComplete, onViewContact, onDoAction,
  onTogglePause, onApprove, onDeny,
}: EngageTabProps) {
  const [typeFilter, setTypeFilter] = useState<ActionTypeFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [sortBy, setSortBy] = useState<SortOption>("priority");
  const [completedCount, setCompletedCount] = useState(0);

  const filteredActions = useMemo(() => {
    let result = [...nextActions];

    if (typeFilter !== "all") {
      result = result.filter((a) => a.type === typeFilter);
    }
    if (priorityFilter !== "all") {
      result = result.filter((a) => a.priority === priorityFilter);
    }

    result.sort((a, b) => {
      switch (sortBy) {
        case "priority":
          return (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3);
        case "dueDate": {
          if (!a.dueDate && !b.dueDate) return 0;
          if (!a.dueDate) return 1;
          if (!b.dueDate) return -1;
          return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
        }
        case "value":
          return (b.value ?? 0) - (a.value ?? 0);
        case "time":
          return a.estimatedTime - b.estimatedTime;
        default:
          return 0;
      }
    });

    return result;
  }, [nextActions, typeFilter, priorityFilter, sortBy]);

  const activeFilterCount = (typeFilter !== "all" ? 1 : 0) + (priorityFilter !== "all" ? 1 : 0);

  const handleComplete = useCallback(async (id: string) => {
    await onComplete(id);
    setCompletedCount((c) => c + 1);
  }, [onComplete]);

  const handleClearFilters = useCallback(() => {
    setTypeFilter("all");
    setPriorityFilter("all");
  }, []);

  if (loading) return <EngageSkeleton />;

  return (
    <motion.div
      variants={stagger.container}
      initial="hidden"
      animate="visible"
      className="space-y-4"
    >
      <HeroStats
        nextActions={nextActions}
        autopilotActions={autopilotActions}
        completedCount={completedCount}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
        <ProgressRing nextActions={filteredActions} completedCount={completedCount} />
        <motion.div
          variants={stagger.item}
          className="rounded-2xl border border-border/50 bg-card p-4 flex items-center gap-3 lg:min-w-[200px]"
        >
          <div className="p-2 rounded-xl bg-gradient-to-br from-[hsl(var(--kf-accent2))]/15 to-[hsl(var(--kf-accent2))]/5">
            <Timer className="w-4 h-4 text-[hsl(var(--kf-accent2))]" />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Est. Time</p>
            <p className="text-lg font-bold">
              {filteredActions.reduce((s, a) => s + a.estimatedTime, 0)}
              <span className="text-xs text-muted-foreground/60 font-normal ml-1">min</span>
            </p>
          </div>
        </motion.div>
      </div>

      <FilterToolbar
        typeFilter={typeFilter}
        priorityFilter={priorityFilter}
        sortBy={sortBy}
        activeFilterCount={activeFilterCount}
        onTypeFilter={setTypeFilter}
        onPriorityFilter={setPriorityFilter}
        onSortBy={setSortBy}
        onClear={handleClearFilters}
      />

      <motion.div variants={stagger.item} className="grid gap-4 lg:grid-cols-2">
        <NextActionQueue
          actions={filteredActions}
          onComplete={handleComplete}
          onViewContact={onViewContact}
          onDoAction={onDoAction}
        />
        <AutopilotActions
          actions={autopilotActions}
          isPaused={autopilotPaused}
          onTogglePause={onTogglePause}
          onApprove={onApprove}
          onDeny={onDeny}
          onViewContact={onViewContact}
        />
      </motion.div>

      <div className="grid gap-4 lg:grid-cols-2">
        <CompletionTimeline actions={autopilotActions} />
        <ActionBreakdown actions={nextActions} />
      </div>

      {filteredActions.length === 0 && autopilotActions.length === 0 && (
        <motion.div variants={stagger.item} className="rounded-2xl border border-border/50 bg-card p-8 text-center">
          <div className="w-12 h-12 rounded-xl bg-white/[0.03] flex items-center justify-center mx-auto mb-3">
            <Sparkles className="w-6 h-6 text-muted-foreground/50" />
          </div>
          <p className="text-base font-semibold mb-1 bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">
            {activeFilterCount > 0 ? "No Matching Actions" : "All Caught Up"}
          </p>
          <p className="text-sm text-muted-foreground/60 max-w-sm mx-auto">
            {activeFilterCount > 0
              ? "Try adjusting your filters to see more actions."
              : "No pending actions right now. Keep building your pipeline and we'll surface smart next steps."}
          </p>
        </motion.div>
      )}
    </motion.div>
  );
}
