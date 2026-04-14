"use client";

import { Zap } from "lucide-react";

interface AutomationCoverageIndicatorProps {
  coveragePct: number;
  automatedCount: number;
  totalProcesses: number;
  className?: string;
}

export function AutomationCoverageIndicator({
  coveragePct,
  automatedCount,
  totalProcesses,
  className = "",
}: AutomationCoverageIndicatorProps) {
  const color = coveragePct >= 75
    ? "text-emerald-400"
    : coveragePct >= 25
      ? "text-amber-400"
      : "text-muted-foreground/50";

  const bgColor = coveragePct >= 75
    ? "bg-emerald-400/15"
    : coveragePct >= 25
      ? "bg-amber-400/15"
      : "bg-muted/20";

  const barColor = coveragePct >= 75
    ? "bg-emerald-400"
    : coveragePct >= 25
      ? "bg-amber-400"
      : "bg-muted-foreground/30";

  return (
    <div className={`flex items-center gap-2 ${className}`} title={`${automatedCount}/${totalProcesses} processes automated`}>
      <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg ${bgColor}`}>
        <Zap className={`w-3 h-3 ${color}`} />
        <span className={`text-[10px] font-medium ${color}`}>
          {coveragePct}%
        </span>
        <div className="w-12 h-1 rounded-full bg-muted/20 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${Math.min(coveragePct, 100)}%` }}
          />
        </div>
        <span className="text-[9px] text-muted-foreground/40">auto</span>
      </div>
    </div>
  );
}
