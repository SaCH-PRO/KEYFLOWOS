"use client";

import { useState, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Sparkles, Filter, AlertTriangle, ArrowRight, Zap, Eye } from "lucide-react";
import { AiRecommendationCard, type RecommendationType } from "@/components/ui/ai-recommendation-card";
import type { WorkspaceRecommendation } from "@/lib/client";

interface GraphInsightsPanelProps {
  recommendations: WorkspaceRecommendation[];
  loading: boolean;
  onDismiss: (id: string) => void;
  onNavigate?: (route: string) => void;
  className?: string;
}

type QuadrantKey = "matters_now" | "whats_next" | "ai_can_do" | "inaction_risk";

const QUADRANTS: { key: QuadrantKey; label: string; icon: React.ElementType; color: string }[] = [
  { key: "matters_now", label: "What Matters Now", icon: AlertTriangle, color: "text-amber-400" },
  { key: "whats_next", label: "What's Next", icon: ArrowRight, color: "text-[hsl(var(--kf-accent2))]" },
  { key: "ai_can_do", label: "AI Can Handle", icon: Zap, color: "text-[hsl(var(--kf-accent1))]" },
  { key: "inaction_risk", label: "Inaction Risk", icon: Eye, color: "text-red-400" },
];

function classifyRecommendation(rec: WorkspaceRecommendation): QuadrantKey {
  if (rec.severity >= 80 || rec.priority === "high") return "matters_now";
  if (rec.type === "risk") return "inaction_risk";
  if (rec.type === "opportunity" || rec.type === "action") return "ai_can_do";
  return "whats_next";
}

const FILTER_OPTIONS: { key: RecommendationType | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "action", label: "Actions" },
  { key: "risk", label: "Risks" },
  { key: "insight", label: "Insights" },
  { key: "opportunity", label: "Opportunities" },
];

export function GraphInsightsPanel({
  recommendations,
  loading,
  onDismiss,
  onNavigate,
  className = "",
}: GraphInsightsPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [filter, setFilter] = useState<RecommendationType | "all">("all");

  const filtered = useMemo(() => {
    if (filter === "all") return recommendations;
    return recommendations.filter((r) => r.type === filter);
  }, [recommendations, filter]);

  const quadrantGroups = useMemo(() => {
    const groups: Record<QuadrantKey, WorkspaceRecommendation[]> = {
      matters_now: [],
      whats_next: [],
      ai_can_do: [],
      inaction_risk: [],
    };
    for (const rec of filtered) {
      groups[classifyRecommendation(rec)].push(rec);
    }
    return groups;
  }, [filtered]);

  const activeQuadrants = QUADRANTS.filter((q) => quadrantGroups[q.key].length > 0);

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
            Graph Intelligence
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

              {activeQuadrants.length > 0 ? (
                <div className="space-y-3">
                  {activeQuadrants.map((quadrant) => {
                    const QIcon = quadrant.icon;
                    const items = quadrantGroups[quadrant.key];
                    return (
                      <div key={quadrant.key}>
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <QIcon className={`w-3 h-3 ${quadrant.color}`} />
                          <span className={`text-[9px] font-semibold uppercase tracking-wider ${quadrant.color}`}>
                            {quadrant.label}
                          </span>
                          <span className="text-[9px] text-muted-foreground/30">{items.length}</span>
                        </div>
                        <div className="space-y-1.5">
                          <AnimatePresence mode="popLayout">
                            {items.map((rec) => (
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
                    );
                  })}
                </div>
              ) : (
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
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
