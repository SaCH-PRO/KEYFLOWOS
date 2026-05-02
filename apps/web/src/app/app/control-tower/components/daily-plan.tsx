"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CalendarClock,
  Loader2,
  ChevronDown,
  ChevronUp,
  Target,
  Users,
  DollarSign,
  Megaphone,
  FolderKanban,
  Zap,
  Play,
  Check,
  Bot,
} from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import { apiGet } from "@/lib/api";
import { executeAction } from "@/lib/client";

type DayBlock = {
  timeSlot: string;
  focus: string;
  description: string;
  category: string;
  actionRoute?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
};

type WeeklyPlanData = {
  days: Array<{
    day: string;
    blocks: DayBlock[];
  }>;
  summary?: string;
};

type RawPlanResponse = {
  summary?: string;
  weeklyGoal?: string;
  dailyFocus?: Array<{ day: string; theme: string; tasks: string[] }>;
  topPriorities?: Array<{ priority: string; reason?: string; deadline?: string }>;
  days?: Array<{ day: string; blocks: DayBlock[] }>;
};

function normalizePlan(raw: RawPlanResponse): WeeklyPlanData {
  if (raw.days && Array.isArray(raw.days) && raw.days.length > 0 && raw.days[0].blocks) {
    return { days: raw.days, summary: raw.summary || raw.weeklyGoal };
  }

  const themeToCategory: Record<string, string> = {
    revenue: "revenue", recovery: "revenue", collection: "revenue", invoic: "revenue",
    client: "clients", engagement: "clients", outreach: "clients", crm: "crm",
    content: "content", marketing: "content", social: "content",
    deliver: "projects", project: "projects", milestone: "projects",
    review: "operations", planning: "operations", operation: "operations", expense: "operations",
  };

  function inferCategory(theme: string): string {
    const lower = theme.toLowerCase();
    for (const [key, cat] of Object.entries(themeToCategory)) {
      if (lower.includes(key)) return cat;
    }
    return "growth";
  }

  const days: WeeklyPlanData["days"] = [];

  if (raw.dailyFocus && Array.isArray(raw.dailyFocus)) {
    for (const df of raw.dailyFocus) {
      const category = inferCategory(df.theme || "");
      const blocks: DayBlock[] = (df.tasks || []).map((task, _i) => ({
        timeSlot: "",
        focus: df.theme || "Focus",
        description: task,
        category,
      }));
      days.push({ day: df.day, blocks });
    }
  }

  return {
    days,
    summary: raw.summary || raw.weeklyGoal || "",
  };
}

const CATEGORY_ICONS: Record<string, typeof Target> = {
  revenue: DollarSign,
  clients: Users,
  crm: Users,
  content: Megaphone,
  projects: FolderKanban,
  operations: Zap,
  growth: Target,
};

const CATEGORY_COLORS: Record<string, string> = {
  revenue: "hsl(var(--kf-accent1))",
  clients: "hsl(var(--kf-accent2))",
  crm: "hsl(var(--kf-accent2))",
  content: "hsl(var(--kf-info))",
  projects: "#a78bfa",
  operations: "hsl(var(--kf-warning))",
  growth: "hsl(var(--kf-success))",
};

function getTodayName(): string {
  return new Date().toLocaleDateString("en-US", { weekday: "long" });
}

export function DailyPlan({ businessId }: { businessId: string }) {
  const router = useRouter();
  const [plan, setPlan] = useState<WeeklyPlanData | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState(false);
  const [executingBlock, setExecutingBlock] = useState<number | null>(null);
  const [completedBlocks, setCompletedBlocks] = useState<Set<number>>(new Set());
  const [hasAutoLoaded, setHasAutoLoaded] = useState(false);

  const loadPlan = useCallback(async () => {
    if (plan || loading) return;
    setLoading(true);
    setError(false);
    try {
      const res = await apiGet<RawPlanResponse>(
        `/ai/businesses/${encodeURIComponent(businessId)}/ai/strategic/weekly-plan`,
      );
      if (res.data) {
        setPlan(normalizePlan(res.data as RawPlanResponse));
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [plan, loading, businessId]);

  useEffect(() => {
    if (!hasAutoLoaded && businessId) {
      setHasAutoLoaded(true);
      loadPlan();
    }
  }, [hasAutoLoaded, businessId, loadPlan]);

  const handleExecuteBlock = async (block: DayBlock, index: number) => {
    if (block.toolName && businessId) {
      setExecutingBlock(index);
      try {
        const res = await executeAction(
          businessId,
          block.toolName,
          block.toolArgs ?? {},
        );
        if (res.data?.success) {
          toast.success(`${block.focus} completed`);
          setCompletedBlocks((prev) => new Set(prev).add(index));
          window.dispatchEvent(new CustomEvent("kf:action.executed"));
        } else if (res.data?.blocked) {
          toast.info(res.data.requiresApproval
            ? "Queued for approval"
            : "Blocked by governance");
        } else {
          toast.error("Action failed");
        }
      } catch {
        toast.error("Failed to execute");
      } finally {
        setExecutingBlock(null);
      }
    } else if (block.actionRoute) {
      router.push(block.actionRoute);
    }
  };

  const todayName = getTodayName();
  const todayPlan = plan?.days?.find(
    (d) => d.day.toLowerCase() === todayName.toLowerCase(),
  );
  const blocks = todayPlan?.blocks ?? [];
  const visibleBlocks = expanded ? blocks : blocks.slice(0, 5);
  const completedCount = blocks.filter((_, i) => completedBlocks.has(i)).length;

  return (
    <SectionCard
      title="Today's Plan"
      subtitle={plan ? `${completedCount}/${blocks.length} completed` : "AI-generated daily focus areas"}
      icon={CalendarClock}
    >
      {loading && (
        <div className="flex items-center justify-center py-8 gap-2">
          <Loader2 className="w-4 h-4 animate-spin" style={{ color: "hsl(var(--kf-accent1))" }} />
          <span className="text-xs" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
            Generating your daily plan...
          </span>
        </div>
      )}

      {error && !loading && (
        <div className="text-center py-6">
          <p className="text-xs" style={{ color: "hsl(var(--kf-error))" }}>
            Could not generate plan right now
          </p>
          <button
            onClick={() => { setPlan(null); setError(false); setHasAutoLoaded(false); }}
            className="text-[10px] mt-2 px-3 py-1.5 rounded-lg min-h-[28px]"
            style={{ background: "hsl(var(--kf-muted) / 0.1)", color: "hsl(var(--kf-accent1))" }}
          >
            Try again
          </button>
        </div>
      )}

      {plan && !loading && (
        <div className="space-y-2">
          {plan.summary && (
            <p className="text-[11px] px-1 mb-2" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
              {plan.summary}
            </p>
          )}

          {blocks.length === 0 && (
            <p className="text-xs text-center py-4" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
              No focus blocks for today
            </p>
          )}

          <AnimatePresence initial={false}>
            {visibleBlocks.map((block, i) => {
              const catKey = block.category?.toLowerCase() ?? "growth";
              const Icon = CATEGORY_ICONS[catKey] ?? Target;
              const color = CATEGORY_COLORS[catKey] ?? "hsl(var(--kf-accent1))";
              const isCompleted = completedBlocks.has(i);
              const isExecuting = executingBlock === i;
              const hasAction = !!block.toolName || !!block.actionRoute;

              return (
                <motion.div
                  key={`${block.timeSlot}-${i}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: isCompleted ? 0.5 : 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="flex items-start gap-3 rounded-xl px-3 py-2.5 transition-all group"
                  style={{
                    background: isCompleted ? "hsl(var(--kf-success) / 0.04)" : `${color}08`,
                    border: isCompleted ? "1px solid hsl(var(--kf-success) / 0.15)" : `1px solid ${color}15`,
                  }}
                >
                  <div className="flex flex-col items-center gap-1 flex-shrink-0 pt-0.5">
                    <div
                      className="w-7 h-7 rounded-lg flex items-center justify-center"
                      style={{ background: isCompleted ? "hsl(var(--kf-success) / 0.15)" : `${color}15` }}
                    >
                      {isCompleted ? (
                        <Check className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-success))" }} />
                      ) : (
                        <Icon className="w-3.5 h-3.5" style={{ color }} />
                      )}
                    </div>
                    {block.timeSlot && (
                      <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color: `${color}90` }}>
                        {block.timeSlot}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-xs font-semibold"
                      style={{
                        color: "hsl(var(--kf-foreground))",
                        textDecoration: isCompleted ? "line-through" : undefined,
                      }}
                    >
                      {block.focus}
                    </p>
                    <p className="text-[10px] mt-0.5 line-clamp-2" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                      {block.description}
                    </p>
                  </div>
                  {hasAction && !isCompleted && (
                    <button
                      onClick={() => handleExecuteBlock(block, i)}
                      disabled={isExecuting}
                      className="flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-semibold transition-all hover:opacity-80 opacity-0 group-hover:opacity-100 min-h-[24px] flex-shrink-0 mt-0.5"
                      style={{ background: `${color}15`, color }}
                      title={block.toolName ? "Execute with AI" : "Go to"}
                    >
                      {isExecuting ? (
                        <Loader2 className="w-2.5 h-2.5 animate-spin" />
                      ) : block.toolName ? (
                        <Bot className="w-2.5 h-2.5" />
                      ) : (
                        <Play className="w-2.5 h-2.5" />
                      )}
                      {block.toolName ? "Execute" : "Go"}
                    </button>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>

          {blocks.length > 5 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="w-full flex items-center justify-center gap-1.5 mt-1 py-2 text-[10px] font-medium transition-colors hover:opacity-70 min-h-[36px]"
              style={{ color: "hsl(var(--kf-accent1))" }}
            >
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {expanded ? "Show less" : `Show ${blocks.length - 5} more`}
            </button>
          )}
        </div>
      )}
    </SectionCard>
  );
}
