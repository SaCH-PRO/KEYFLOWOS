"use client";

import { motion } from "framer-motion";
import {
  Zap, Lightbulb, AlertTriangle, TrendingUp, Sparkles,
  X, ChevronRight,
} from "lucide-react";

type RecommendationType = "action" | "insight" | "warning" | "tip";
type RecommendationPriority = "high" | "medium" | "low";

interface AiRecommendationCardProps {
  type: RecommendationType;
  priority: RecommendationPriority;
  title: string;
  description: string;
  explanation?: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
  className?: string;
}

const ICON_MAP: Record<RecommendationType, React.ElementType> = {
  action: Zap,
  insight: Lightbulb,
  warning: AlertTriangle,
  tip: TrendingUp,
};

const TYPE_COLORS: Record<RecommendationType, { bg: string; text: string }> = {
  action: { bg: "hsl(var(--kf-accent2) / 0.1)", text: "hsl(var(--kf-accent2))" },
  insight: { bg: "hsl(var(--kf-accent1) / 0.1)", text: "hsl(var(--kf-accent1))" },
  warning: { bg: "hsl(var(--kf-warning) / 0.1)", text: "hsl(var(--kf-warning))" },
  tip: { bg: "hsl(var(--kf-success) / 0.1)", text: "hsl(var(--kf-success))" },
};

const PRIORITY_BORDER: Record<RecommendationPriority, string> = {
  high: "hsl(var(--kf-warning))",
  medium: "hsl(var(--kf-accent1))",
  low: "hsl(var(--kf-muted-foreground) / 0.3)",
};

const PRIORITY_BG: Record<RecommendationPriority, string> = {
  high: "hsl(var(--kf-warning) / 0.03)",
  medium: "hsl(var(--kf-accent1) / 0.02)",
  low: "transparent",
};

const PRIORITY_LABEL: Record<RecommendationPriority, string> = {
  high: "Urgent",
  medium: "Suggested",
  low: "FYI",
};

export function AiRecommendationCard({
  type,
  priority,
  title,
  description,
  explanation,
  actionLabel,
  onAction,
  onDismiss,
  className = "",
}: AiRecommendationCardProps) {
  const Icon = ICON_MAP[type] ?? Sparkles;
  const typeColor = TYPE_COLORS[type];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      transition={{ duration: 0.2 }}
      className={`kf-radius-lg border overflow-hidden transition-colors group ${className}`}
      style={{
        borderColor: "hsl(var(--kf-border) / 0.4)",
        borderLeftWidth: "3px",
        borderLeftColor: PRIORITY_BORDER[priority],
        background: PRIORITY_BG[priority],
      }}
    >
      <div className="p-3">
        <div className="flex items-start gap-2.5">
          <div
            className="w-7 h-7 kf-radius-md flex items-center justify-center shrink-0 mt-0.5"
            style={{ background: typeColor.bg }}
          >
            <Icon className="w-3.5 h-3.5" style={{ color: typeColor.text }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-0.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="kf-text-caption font-semibold truncate">{title}</span>
                <span
                  className="kf-text-micro px-1.5 py-px kf-radius-sm font-medium flex-shrink-0"
                  style={{
                    background: PRIORITY_BORDER[priority],
                    color: priority === "low" ? "hsl(var(--kf-foreground))" : "hsl(var(--kf-primary-foreground))",
                  }}
                >
                  {PRIORITY_LABEL[priority]}
                </span>
              </div>
              {onDismiss && (
                <button
                  onClick={onDismiss}
                  className="p-0.5 kf-radius-sm opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                  style={{ color: "hsl(var(--kf-muted-foreground) / 0.5)" }}
                  aria-label="Dismiss recommendation"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            <p
              className="kf-text-micro leading-relaxed mb-1"
              style={{ color: "hsl(var(--kf-muted-foreground) / 0.8)" }}
            >
              {description}
            </p>
            {explanation && (
              <p
                className="kf-text-micro leading-relaxed mb-1.5 italic"
                style={{ color: "hsl(var(--kf-muted-foreground) / 0.6)" }}
              >
                {explanation}
              </p>
            )}
            {actionLabel && onAction && (
              <button
                onClick={onAction}
                className="flex items-center gap-1 kf-text-micro font-medium transition-colors"
                style={{ color: "hsl(var(--kf-accent1))" }}
              >
                {actionLabel}
                <ChevronRight className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export type { AiRecommendationCardProps, RecommendationType, RecommendationPriority };
