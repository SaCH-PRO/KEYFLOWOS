"use client";

import { useState, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Sparkles, Filter } from "lucide-react";
import { AiRecommendationCard, type RecommendationType } from "@/components/ui/ai-recommendation-card";
import type { WorkspaceRecommendation } from "@/lib/client";

interface WorkspaceInsightsPanelProps {
  recommendations: WorkspaceRecommendation[];
  loading: boolean;
  onDismiss: (id: string) => void;
  onNavigate?: (route: string) => void;
  className?: string;
}

const FILTER_OPTIONS: { key: RecommendationType | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "action", label: "Actions" },
  { key: "risk", label: "Risks" },
  { key: "insight", label: "Insights" },
  { key: "opportunity", label: "Opportunities" },
];

export function WorkspaceInsightsPanel({
  recommendations,
  loading,
  onDismiss,
  onNavigate,
  className = "",
}: WorkspaceInsightsPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [filter, setFilter] = useState<RecommendationType | "all">("all");

  const filtered = useMemo(() => {
    if (filter === "all") return recommendations;
    return recommendations.filter((r) => r.type === filter);
  }, [recommendations, filter]);

  if (loading && recommendations.length === 0) {
    return (
      <div className={`rounded-xl border border-border/30 bg-card/50 p-3 ${className}`}>
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))] animate-pulse" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Loading intelligence...</span>
        </div>
      </div>
    );
  }

  if (recommendations.length === 0) return null;

  const urgentCount = recommendations.filter((r) => r.priority === "high").length;

  return (
    <div className={`rounded-xl border border-border/30 bg-card/50 overflow-hidden ${className}`}>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 hover:bg-muted/10 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
            Cross-Module Intelligence
          </span>
          {urgentCount > 0 && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400">
              {urgentCount} urgent
            </span>
          )}
          <span className="text-[9px] text-muted-foreground/40">
            {recommendations.length} insight{recommendations.length !== 1 ? "s" : ""}
          </span>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/40 transition-transform ${collapsed ? "-rotate-90" : ""}`} />
      </button>

      <AnimatePresence>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="px-3 pb-3 space-y-2">
              {recommendations.length > 2 && (
                <div className="flex items-center gap-1">
                  <Filter className="w-3 h-3 text-muted-foreground/30" />
                  {FILTER_OPTIONS.map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => setFilter(opt.key)}
                      className={`text-[9px] px-2 py-0.5 rounded-full transition-colors ${
                        filter === opt.key
                          ? "bg-[hsl(var(--kf-accent1)/0.15)] text-[hsl(var(--kf-accent1))] font-medium"
                          : "text-muted-foreground/50 hover:text-muted-foreground/80"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}

              <div className="space-y-1.5">
                <AnimatePresence mode="popLayout">
                  {filtered.map((rec) => (
                    <AiRecommendationCard
                      key={rec.id}
                      type={rec.type}
                      priority={rec.priority}
                      title={rec.title}
                      description={rec.description}
                      explanation={rec.explanation}
                      actionLabel={rec.actionLabel}
                      sourceModule={rec.sourceModule}
                      targetModule={rec.targetModule}
                      severity={rec.severity}
                      onAction={rec.actionRoute && onNavigate ? () => onNavigate(rec.actionRoute!) : undefined}
                      onDismiss={() => onDismiss(rec.id)}
                    />
                  ))}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
