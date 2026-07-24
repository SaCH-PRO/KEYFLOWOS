import * as React from "react";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StatOrbProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value: string | number;
  trend?: "up" | "down" | "neutral";
  trendLabel?: string;
  color?: "orange" | "teal" | "violet" | "gold" | "mint";
}

export function StatOrb({
  label,
  value,
  trend,
  trendLabel,
  color = "orange",
  className,
  ...props
}: StatOrbProps) {
  const TrendIcon = trend === "up" ? ArrowUpRight : trend === "down" ? ArrowDownRight : Minus;
  const trendColor =
    trend === "up" ? "text-mint" : trend === "down" ? "text-rose" : "text-muted-foreground";

  const orbColor =
    color === "orange"
      ? "from-primary/20 to-primary/5 text-primary"
      : color === "teal"
        ? "from-secondary/20 to-secondary/5 text-secondary"
        : color === "violet"
          ? "from-violet/20 to-violet/5 text-violet"
          : color === "mint"
            ? "from-mint/20 to-mint/5 text-mint"
            : "from-gold/25 to-gold/5 text-gold-foreground";

  return (
    <div
      className={cn(
        "surface flex flex-col gap-3 p-5 transition-all hover:shadow-md",
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br shadow-sm",
            orbColor,
          )}
        >
          <span className="font-mono text-lg font-bold">{value}</span>
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="text-caption text-muted-foreground uppercase tracking-wide">{label}</span>
          {trend && (
            <div className={cn("flex items-center gap-1 text-xs font-medium", trendColor)}>
              <TrendIcon className="h-3.5 w-3.5" />
              {trendLabel && <span>{trendLabel}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
