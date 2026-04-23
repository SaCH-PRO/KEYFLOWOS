"use client";

import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

type TrendDirection = "up" | "down" | "stable";

interface MetricStripItem {
  label: string;
  value: string | number;
  sub?: React.ReactNode;
  icon?: React.ElementType;
  iconColor?: string;
  trend?: {
    direction: TrendDirection;
    value: string;
  };
  threshold?: {
    status: "good" | "warn" | "critical";
  };
  onClick?: () => void;
}

interface WorkspaceMetricStripProps {
  items: MetricStripItem[];
  columns?: 2 | 3 | 4 | 5 | 6 | 7;
  compact?: boolean;
  className?: string;
}

const TREND_CONFIG: Record<TrendDirection, { icon: React.ElementType; color: string }> = {
  up: { icon: TrendingUp, color: "var(--kf-success)" },
  down: { icon: TrendingDown, color: "var(--kf-error)" },
  stable: { icon: Minus, color: "var(--kf-neutral)" },
};

const THRESHOLD_RING: Record<string, string> = {
  good: "var(--kf-success)",
  warn: "var(--kf-warning)",
  critical: "var(--kf-error)",
};

const stagger = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 340, damping: 26 } },
};

const COL_MAP: Record<number, string> = {
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 md:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5",
  6: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6",
  7: "grid-cols-2 sm:grid-cols-4 xl:grid-cols-7",
};

export function WorkspaceMetricStrip({
  items,
  columns,
  compact = false,
  className = "",
}: WorkspaceMetricStripProps) {
  const cols = columns ?? Math.min(items.length, 7) as 2 | 3 | 4 | 5 | 6 | 7;
  const gridCls = COL_MAP[cols] ?? COL_MAP[4];

  return (
    <motion.div
      role="region"
      aria-label="Key metrics"
      variants={stagger}
      initial="hidden"
      animate="show"
      className={`grid gap-3 ${gridCls} ${className}`}
    >
      {items.map((m) => (
        <motion.div key={m.label} variants={fadeUp}>
          <StripCard metric={m} compact={compact} />
        </motion.div>
      ))}
    </motion.div>
  );
}

function StripCard({ metric, compact }: { metric: MetricStripItem; compact: boolean }) {
  const { label, value, sub, icon: Icon, iconColor, trend, threshold, onClick } = metric;
  const Component = onClick ? "button" : "div";
  const trendInfo = trend ? TREND_CONFIG[trend.direction] : null;
  const TrendIcon = trendInfo?.icon;
  const thresholdColor = threshold ? THRESHOLD_RING[threshold.status] : null;

  return (
    <Component
      onClick={onClick}
      className={`kf-card-metric text-left w-full transition-all duration-150 ${
        onClick ? "cursor-pointer hover:translate-y-[-1px] hover:shadow-md" : "cursor-default"
      }`}
      style={
        thresholdColor
          ? { borderLeft: `3px solid hsl(${thresholdColor})` }
          : undefined
      }
    >
      <div className={`flex items-start justify-between ${compact ? "gap-2" : "gap-3"}`}>
        <div className={`space-y-0.5 flex-1 min-w-0 ${compact ? "" : "space-y-1"}`}>
          <p
            className="kf-text-micro uppercase tracking-widest font-medium truncate"
            style={{ color: "hsl(var(--kf-muted-foreground))" }}
          >
            {label}
          </p>
          <p className={`${compact ? "text-lg" : "text-xl"} font-bold truncate`}>{value}</p>
          {sub && (
            <p className="kf-text-caption truncate" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
              {sub}
            </p>
          )}
          {trend && TrendIcon && (
            <div
              className="flex items-center gap-1 kf-text-micro font-medium"
              style={{ color: `hsl(${trendInfo!.color})` }}
            >
              <TrendIcon className="w-3 h-3" />
              <span>{trend.value}</span>
            </div>
          )}
        </div>
        {Icon && (
          <div
            className={`${compact ? "w-8 h-8" : "w-9 h-9"} kf-radius-lg flex items-center justify-center flex-shrink-0`}
            style={{
              background: `color-mix(in srgb, ${iconColor || "hsl(var(--kf-accent1))"} 12%, transparent)`,
            }}
          >
            <Icon
              className="flex-shrink-0"
              style={{
                color: iconColor || "hsl(var(--kf-accent1))",
                width: compact ? "14px" : "18px",
                height: compact ? "14px" : "18px",
              }}
            />
          </div>
        )}
      </div>
    </Component>
  );
}

export type { MetricStripItem, WorkspaceMetricStripProps };
