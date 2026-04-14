"use client";

import { Zap, PauseCircle, AlertTriangle, TrendingUp, Shield, Activity, CheckCircle } from "lucide-react";

export interface FlowHealthStats {
  active: number;
  paused: number;
  total: number;
  recentlyTriggered: number;
  mostTriggered: string | null;
  maxRuns: number;
  neverRun: number;
  totalRuns: number;
  coveragePct: number;
  successRate: number;
  errorCount: number;
}

interface FlowHealthStripProps {
  stats: FlowHealthStats;
}

export function FlowHealthStrip({ stats }: FlowHealthStripProps) {
  const metrics = [
    {
      label: "Active Flows",
      value: stats.active,
      icon: Zap,
      color: "hsl(var(--kf-success))",
    },
    {
      label: "Triggered (7d)",
      value: stats.recentlyTriggered,
      icon: TrendingUp,
      color: "hsl(var(--kf-accent1))",
    },
    {
      label: "Total Runs",
      value: stats.totalRuns,
      icon: Activity,
      color: stats.totalRuns > 0 ? "hsl(var(--kf-info))" : "hsl(var(--muted-foreground))",
    },
    {
      label: "Success Rate",
      value: stats.totalRuns > 0 ? `${stats.successRate}%` : "—",
      icon: CheckCircle,
      color: stats.successRate >= 80 ? "hsl(var(--kf-success))" : stats.successRate >= 50 ? "hsl(var(--kf-warning))" : stats.totalRuns > 0 ? "hsl(var(--kf-error))" : "hsl(var(--muted-foreground))",
    },
    {
      label: "Coverage",
      value: `${stats.coveragePct}%`,
      icon: Shield,
      color: stats.coveragePct >= 50 ? "hsl(var(--kf-success))" : stats.coveragePct >= 25 ? "hsl(var(--kf-warning))" : "hsl(var(--muted-foreground))",
    },
    {
      label: "Paused",
      value: stats.paused,
      icon: PauseCircle,
      color: "hsl(var(--muted-foreground))",
    },
    {
      label: "Needs Attention",
      value: stats.neverRun + stats.errorCount,
      icon: AlertTriangle,
      color: (stats.neverRun + stats.errorCount) > 0 ? "hsl(var(--kf-warning))" : "hsl(var(--muted-foreground))",
    },
  ];

  return (
    <div className="grid grid-cols-4 sm:grid-cols-7 gap-px rounded-xl overflow-hidden border border-border/40 bg-border/40">
      {metrics.map((m) => (
        <div
          key={m.label}
          className="bg-card px-3 py-2.5 flex items-center gap-2.5"
        >
          <m.icon className="w-4 h-4 shrink-0" style={{ color: m.color }} />
          <div className="min-w-0">
            <div className="text-base font-bold leading-tight" style={{ color: m.color }}>
              {m.value}
            </div>
            <div className="text-[10px] text-muted-foreground truncate">{m.label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
