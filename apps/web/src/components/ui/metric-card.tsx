"use client";

import { TrendingUp, TrendingDown, Minus } from "lucide-react";

type TrendDirection = "up" | "down" | "stable";

interface MetricCardProps {
  label: string;
  value: string | number;
  trend?: {
    direction: TrendDirection;
    value: string;
  };
  icon?: React.ElementType;
  iconColor?: string;
  onClick?: () => void;
  className?: string;
}

const TREND_CONFIG: Record<TrendDirection, { icon: React.ElementType; color: string }> = {
  up: { icon: TrendingUp, color: "var(--kf-success)" },
  down: { icon: TrendingDown, color: "var(--kf-error)" },
  stable: { icon: Minus, color: "var(--kf-neutral)" },
};

export function MetricCard({
  label,
  value,
  trend,
  icon: Icon,
  iconColor,
  onClick,
  className = "",
}: MetricCardProps) {
  const Component = onClick ? "button" : "div";
  const trendInfo = trend ? TREND_CONFIG[trend.direction] : null;
  const TrendIcon = trendInfo?.icon;

  return (
    <Component
      onClick={onClick}
      className={`kf-card-metric text-left w-full ${onClick ? "cursor-pointer" : "cursor-default"} ${className}`}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-1 flex-1 min-w-0">
          <p
            className="kf-text-micro uppercase tracking-widest font-medium"
            style={{ color: "hsl(var(--kf-muted-foreground))" }}
          >
            {label}
          </p>
          <p className="text-xl font-bold truncate">{value}</p>
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
            className="w-9 h-9 kf-radius-lg flex items-center justify-center flex-shrink-0"
            style={{
              background: iconColor
                ? `${iconColor}20`
                : "hsl(var(--kf-accent1) / 0.1)",
            }}
          >
            <Icon
              className="flex-shrink-0"
              style={{
                color: iconColor || "hsl(var(--kf-accent1))",
                width: "18px",
                height: "18px",
              }}
            />
          </div>
        )}
      </div>
    </Component>
  );
}

export type { MetricCardProps, TrendDirection };
