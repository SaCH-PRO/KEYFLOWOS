"use client";

import { Users, Clock, AlertTriangle, CalendarPlus, TrendingUp } from "lucide-react";
import type { SmartSegment } from "./pipeline-toolbar";

interface ClientsMetricsStripProps {
  totalClients: number;
  activeClients: number;
  followUpsDue: number;
  atRisk: number;
  newThisWeek: number;
  highValue: number;
  onSegmentClick?: (segment: SmartSegment | null) => void;
}

const metrics = [
  { key: "active", label: "Active", icon: Users, segment: null as SmartSegment | null, color: "hsl(var(--kf-accent2))" },
  { key: "followups", label: "Follow-ups", icon: Clock, segment: "needs-followup" as SmartSegment, color: "hsl(var(--kf-accent1))" },
  { key: "at-risk", label: "At Risk", icon: AlertTriangle, segment: "at-risk" as SmartSegment, color: "hsl(0 70% 55%)" },
  { key: "new", label: "New This Week", icon: CalendarPlus, segment: "new-this-week" as SmartSegment, color: "hsl(var(--kf-accent2))" },
  { key: "high-value", label: "High Value", icon: TrendingUp, segment: "high-value" as SmartSegment, color: "hsl(142 76% 36%)" },
] as const;

export function ClientsMetricsStrip({
  activeClients,
  followUpsDue,
  atRisk,
  newThisWeek,
  highValue,
  onSegmentClick,
}: ClientsMetricsStripProps) {
  const values: Record<string, number> = {
    active: activeClients,
    followups: followUpsDue,
    "at-risk": atRisk,
    new: newThisWeek,
    "high-value": highValue,
  };

  return (
    <div className="flex items-stretch gap-2 overflow-x-auto scrollbar-none pb-1">
      {metrics.map((m) => {
        const Icon = m.icon;
        const value = values[m.key];
        const isClickable = m.segment !== null && onSegmentClick;
        const isAlert = m.key === "at-risk" && value > 0;
        const isUrgent = m.key === "followups" && value > 0;

        return (
          <button
            key={m.key}
            onClick={() => isClickable && onSegmentClick(m.segment)}
            disabled={!isClickable}
            className={`flex items-center gap-2.5 px-3.5 py-2 rounded-xl border transition-all min-w-0 flex-shrink-0 ${
              isClickable ? "cursor-pointer hover:bg-white/[0.03]" : "cursor-default"
            } ${
              isAlert
                ? "border-red-500/30 bg-red-500/[0.04]"
                : isUrgent
                  ? "border-[hsl(var(--kf-accent1))]/30 bg-[hsl(var(--kf-accent1))]/[0.04]"
                  : "border-border/30 bg-card/50"
            }`}
          >
            <Icon
              className="w-3.5 h-3.5 flex-shrink-0"
              style={{ color: m.color }}
            />
            <div className="flex items-baseline gap-1.5 min-w-0">
              <span className="text-base font-bold tabular-nums">{value}</span>
              <span className="text-[10px] text-muted-foreground/70 whitespace-nowrap">{m.label}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
