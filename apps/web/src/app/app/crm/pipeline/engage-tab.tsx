"use client";

import React, { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Sparkles, Filter, ArrowUpDown, History, CheckCircle2,
  MessageSquare, FileText, Phone, Mail, DollarSign, Clock,
  Zap, Bot, ChevronDown, X,
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
  { value: "urgent", label: "Urgent", color: "bg-red-500/20 text-red-400 border-red-500/30" },
  { value: "high", label: "High", color: "bg-[hsl(var(--kf-accent1))]/20 text-[hsl(var(--kf-accent1))] border-[hsl(var(--kf-accent1))]/30" },
  { value: "medium", label: "Medium", color: "bg-[hsl(var(--kf-accent2))]/20 text-[hsl(var(--kf-accent2))] border-[hsl(var(--kf-accent2))]/30" },
  { value: "low", label: "Low", color: "bg-muted text-muted-foreground border-border" },
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
    <div className="space-y-4">
      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-20 rounded-full" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border/50 bg-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Skeleton className="h-5 w-5 rounded" />
              <Skeleton className="h-5 w-32" />
            </div>
            {Array.from({ length: 3 }).map((_, j) => (
              <div key={j} className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02]">
                <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-7 w-16 rounded-lg" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
});

const ProgressIndicator = React.memo(function ProgressIndicator({ actions, completedCount }: { actions: NextAction[]; completedCount: number }) {
  const total = actions.length + completedCount;
  if (total === 0) return null;
  const pct = total > 0 ? Math.round((completedCount / total) * 100) : 0;

  return (
    <motion.div variants={stagger.item} className="rounded-2xl border border-border/50 bg-gradient-to-br from-card to-card/80 backdrop-blur-sm p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Today's Progress</span>
        </div>
        <span className="text-sm font-semibold text-[hsl(var(--kf-accent2))]">{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-white/[0.03] overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="h-full rounded-full bg-gradient-to-r from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))]"
        />
      </div>
      <div className="flex justify-between mt-1.5 text-xs text-muted-foreground">
        <span>{completedCount} completed</span>
        <span>{actions.length} remaining</span>
      </div>
    </motion.div>
  );
});

const CompletionHistory = React.memo(function CompletionHistory({ actions }: { actions: AutopilotAction[] }) {
  const [showAll, setShowAll] = useState(false);
  const completed = actions.filter((a) => a.status === "completed");
  if (completed.length === 0) return null;

  const visible = showAll ? completed : completed.slice(0, 5);

  return (
    <motion.div variants={stagger.item} className="rounded-2xl border border-border/50 bg-gradient-to-br from-card to-card/80 p-4">
      <div className="flex items-center gap-2 mb-3">
        <History className="w-3.5 h-3.5 text-muted-foreground/60" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Completion History</span>
        <span className="ml-auto text-xs text-muted-foreground">{completed.length} actions</span>
      </div>
      <div className="space-y-1.5">
        {visible.map((action) => (
          <div key={action.id} className="flex items-center gap-2 py-1.5 px-2 rounded-lg text-sm hover:bg-white/[0.02] transition-colors">
            <CheckCircle2 className="w-3.5 h-3.5 text-[hsl(var(--kf-accent2))] shrink-0" />
            <span className="flex-1 truncate text-muted-foreground">{action.description}</span>
            <span className="text-xs text-muted-foreground shrink-0">
              {action.completedAt
                ? new Date(action.completedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                : ""}
            </span>
          </div>
        ))}
      </div>
      {completed.length > 5 && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="w-full mt-2 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {showAll ? "Show less" : `Show ${completed.length - 5} more`}
        </button>
      )}
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
  const [showSortMenu, setShowSortMenu] = useState(false);
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

  const handleComplete = async (id: string) => {
    await onComplete(id);
    setCompletedCount((c) => c + 1);
  };

  if (loading) return <EngageSkeleton />;

  return (
    <motion.div
      variants={stagger.container}
      initial="hidden"
      animate="visible"
      className="space-y-4"
    >
      <ProgressIndicator actions={filteredActions} completedCount={completedCount} />

      <motion.div
        variants={stagger.item}
        className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/50 bg-gradient-to-br from-card to-card/80 backdrop-blur-sm p-3"
      >
        <div className="flex items-center gap-1 mr-1">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          {activeFilterCount > 0 && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[hsl(var(--kf-accent1))]/20 text-[hsl(var(--kf-accent1))]">
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
              onClick={() => setTypeFilter(active ? "all" : opt.value)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border transition-all ${
                active
                  ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] border-[hsl(var(--kf-accent1))]/30"
                  : "bg-muted/50 text-muted-foreground border-transparent hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon className="w-3 h-3" />
              {opt.label}
            </button>
          );
        })}

        <div className="h-4 w-px bg-border mx-1" />

        {PRIORITY_OPTIONS.filter((p) => p.value !== "all").map((opt) => {
          const active = priorityFilter === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => setPriorityFilter(active ? "all" : opt.value)}
              className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-all ${
                active
                  ? opt.color
                  : "bg-muted/50 text-muted-foreground border-transparent hover:bg-muted hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          );
        })}

        {activeFilterCount > 0 && (
          <button
            onClick={() => { setTypeFilter("all"); setPriorityFilter("all"); }}
            className="flex items-center gap-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-3 h-3" />
            Clear
          </button>
        )}

        <div className="ml-auto relative">
          <button
            onClick={() => setShowSortMenu(!showSortMenu)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <ArrowUpDown className="w-3 h-3" />
            {SORT_OPTIONS.find((s) => s.value === sortBy)?.label}
            <ChevronDown className="w-3 h-3" />
          </button>
          {showSortMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowSortMenu(false)} />
              <div className="absolute right-0 top-full mt-1 z-50 bg-popover/95 backdrop-blur-xl border border-border/50 rounded-xl shadow-lg py-1 min-w-[140px]">
                {SORT_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => { setSortBy(opt.value); setShowSortMenu(false); }}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors ${
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
      </motion.div>

      <motion.div variants={stagger.item} className="grid gap-6 lg:grid-cols-2">
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

      <CompletionHistory actions={autopilotActions} />

      {filteredActions.length === 0 && autopilotActions.length === 0 && (
        <motion.div variants={stagger.item} className="rounded-2xl border border-border/50 bg-gradient-to-br from-card to-card/80 p-8 text-center">
          <div className="w-10 h-10 rounded-xl bg-white/[0.03] flex items-center justify-center mx-auto mb-3">
            <Sparkles className="w-5 h-5 text-muted-foreground/40" />
          </div>
          <p className="text-lg font-medium mb-1 bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">
            {activeFilterCount > 0 ? "No Matching Actions" : "All Caught Up"}
          </p>
          <p className="text-muted-foreground text-sm">
            {activeFilterCount > 0
              ? "Try adjusting your filters to see more actions."
              : "No pending actions right now. Keep building your pipeline and we'll surface smart next steps."}
          </p>
        </motion.div>
      )}
    </motion.div>
  );
}
