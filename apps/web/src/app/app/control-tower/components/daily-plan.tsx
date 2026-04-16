"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import {
  CalendarClock, Sparkles, Loader2, ChevronDown, ChevronUp,
  Target, Users, DollarSign, Megaphone, FolderKanban, Zap,
} from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import { apiGet } from "@/lib/api";

type DayBlock = {
  timeSlot: string;
  focus: string;
  description: string;
  category: string;
  actionRoute?: string;
};

type WeeklyPlanData = {
  days: Array<{
    day: string;
    blocks: DayBlock[];
  }>;
  summary?: string;
};

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

  const loadPlan = async () => {
    if (plan || loading) return;
    setLoading(true);
    setError(false);
    try {
      const res = await apiGet<WeeklyPlanData>(
        `/ai/businesses/${encodeURIComponent(businessId)}/ai/strategic/weekly-plan`,
      );
      if (res.data) {
        setPlan(res.data as WeeklyPlanData);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const todayName = getTodayName();
  const todayPlan = plan?.days?.find(
    (d) => d.day.toLowerCase() === todayName.toLowerCase(),
  );
  const blocks = todayPlan?.blocks ?? [];
  const visibleBlocks = expanded ? blocks : blocks.slice(0, 4);

  return (
    <SectionCard
      title="Today's Plan"
      subtitle="AI-generated daily focus areas"
      icon={CalendarClock}
      action={!plan && !loading ? { label: "Generate Plan", onClick: loadPlan, icon: Sparkles } : undefined}
    >
      {!plan && !loading && !error && (
        <div className="text-center py-6">
          <Sparkles className="w-5 h-5 mx-auto mb-2" style={{ color: "hsl(var(--kf-accent1) / 0.4)" }} />
          <p className="text-xs font-medium" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
            Click "Generate Plan" to get your AI daily focus
          </p>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-8 gap-2">
          <Loader2 className="w-4 h-4 animate-spin" style={{ color: "hsl(var(--kf-accent1))" }} />
          <span className="text-xs" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
            Analyzing your business and generating plan...
          </span>
        </div>
      )}

      {error && (
        <div className="text-center py-6">
          <p className="text-xs" style={{ color: "hsl(var(--kf-error))" }}>
            Could not generate plan right now
          </p>
          <button
            onClick={() => { setPlan(null); setError(false); loadPlan(); }}
            className="text-[10px] mt-2 px-3 py-1.5 rounded-lg min-h-[28px]"
            style={{ background: "hsl(var(--kf-muted) / 0.1)", color: "hsl(var(--kf-accent1))" }}
          >
            Try again
          </button>
        </div>
      )}

      {plan && (
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

              return (
                <motion.div
                  key={`${block.timeSlot}-${i}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="flex items-start gap-3 rounded-xl px-3 py-2.5 transition-all group"
                  style={{
                    background: `${color}08`,
                    border: `1px solid ${color}15`,
                    cursor: block.actionRoute ? "pointer" : "default",
                  }}
                  onClick={() => block.actionRoute && router.push(block.actionRoute)}
                  role={block.actionRoute ? "link" : undefined}
                >
                  <div className="flex flex-col items-center gap-1 flex-shrink-0 pt-0.5">
                    <div
                      className="w-7 h-7 rounded-lg flex items-center justify-center"
                      style={{ background: `${color}15` }}
                    >
                      <Icon className="w-3.5 h-3.5" style={{ color }} />
                    </div>
                    {block.timeSlot && (
                      <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color: `${color}90` }}>
                        {block.timeSlot}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold" style={{ color: "hsl(var(--kf-foreground))" }}>
                      {block.focus}
                    </p>
                    <p className="text-[10px] mt-0.5 line-clamp-2" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
                      {block.description}
                    </p>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {blocks.length > 4 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="w-full flex items-center justify-center gap-1.5 mt-1 py-2 text-[10px] font-medium transition-colors hover:opacity-70 min-h-[36px]"
              style={{ color: "hsl(var(--kf-accent1))" }}
            >
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {expanded ? "Show less" : `Show ${blocks.length - 4} more`}
            </button>
          )}
        </div>
      )}
    </SectionCard>
  );
}
