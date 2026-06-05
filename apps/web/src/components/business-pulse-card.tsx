"use client";

import { Activity, TrendingUp, TrendingDown, Minus } from "lucide-react";

interface PulseDimension {
  label: string;
  score: number;
  trend: "up" | "down" | "flat";
  color: string;
}

interface BusinessPulseCardProps {
  overallScore: number;
  dimensions: PulseDimension[];
  className?: string;
}

function CircularScore({ score, size = 64 }: { score: number; size?: number }) {
  const strokeWidth = 4;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  const color =
    score >= 80
      ? "hsl(var(--kf-success))"
      : score >= 60
      ? "hsl(var(--kf-warning))"
      : "hsl(var(--kf-destructive))";

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--kf-border))"
          strokeWidth={strokeWidth}
          opacity={0.3}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 1s ease-out" }}
        />
      </svg>
      <span className="absolute text-sm font-bold" style={{ color }}>
        {Math.round(score)}
      </span>
    </div>
  );
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

export function BusinessPulseCard({ overallScore, dimensions, className = "" }: BusinessPulseCardProps) {
  const statusLabel =
    overallScore >= 80 ? "Excellent" : overallScore >= 60 ? "Good" : overallScore >= 40 ? "Needs Attention" : "Critical";

  const statusColor =
    overallScore >= 80
      ? "text-emerald-500"
      : overallScore >= 60
      ? "text-amber-500"
      : "text-red-500";

  return (
    <div className={`kf-card kf-radius-lg p-4 ${className}`}>
      <div className="flex items-center gap-3 mb-4">
        <Activity className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
        <h3 className="text-sm font-semibold">Business Pulse</h3>
        <span className={`ml-auto text-xs font-bold ${statusColor}`}>{statusLabel}</span>
      </div>

      <div className="flex items-center gap-4">
        <CircularScore score={overallScore} size={72} />
        <div className="flex-1 space-y-2">
          {dimensions.map((dim) => (
            <DimensionBar key={dim.label} dim={dim} />
          ))}
        </div>
      </div>
    </div>
  );
}
