"use client";

import { Activity, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Surface } from "@/components/ui-v2/surface";
import { ProgressRing } from "@/components/ui-v2/progress-ring";

interface PulseDimension {
  label: string;
  score: number;
  trend: "up" | "down" | "flat";
  color: string;
}

interface BusinessPulseCardV2Props {
  overallScore: number;
  dimensions: PulseDimension[];
  className?: string;
}

function DimensionBar({ dim }: { dim: PulseDimension }) {
  const TrendIcon = dim.trend === "up" ? TrendingUp : dim.trend === "down" ? TrendingDown : Minus;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-muted-foreground">{dim.label}</span>
        <span className="flex items-center gap-1 font-semibold" style={{ color: dim.color }}>
          {Math.round(dim.score)}
          <TrendIcon className="w-3 h-3" />
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-1000 ease-out"
          style={{ width: `${dim.score}%`, background: dim.color }}
        />
      </div>
    </div>
  );
}

export function BusinessPulseCardV2({ overallScore, dimensions, className }: BusinessPulseCardV2Props) {
  const statusLabel =
    overallScore >= 80 ? "Excellent" : overallScore >= 60 ? "Good" : overallScore >= 40 ? "Needs Attention" : "Critical";
  const ringColor = overallScore >= 80 ? "teal" : overallScore >= 60 ? "gold" : "rose";

  return (
    <Surface className={cn("p-5", className)}>
      <div className="flex items-center gap-3 mb-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
          <Activity className="h-3.5 w-3.5 text-primary" />
        </div>
        <h3 className="font-display text-sm font-semibold text-foreground">Business Pulse</h3>
        <span className={cn("ml-auto text-xs font-bold", `text-${ringColor}`)}>{statusLabel}</span>
      </div>

      <div className="flex items-center gap-5">
        <ProgressRing value={overallScore} size={72} thickness={5} color={ringColor}>
          <span className="font-display text-base font-bold text-foreground">{Math.round(overallScore)}</span>
        </ProgressRing>
        <div className="flex-1 space-y-2">
          {dimensions.map((dim) => (
            <DimensionBar key={dim.label} dim={dim} />
          ))}
        </div>
      </div>
    </Surface>
  );
}
