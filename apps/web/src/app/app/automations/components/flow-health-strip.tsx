"use client";

import { Zap, PauseCircle, AlertTriangle, TrendingUp, Clock, Sparkles } from "lucide-react";

interface FlowHealthStats {
  active: number;
  paused: number;
  total: number;
  recentlyTriggered: number;
  mostTriggered: string | null;
  maxRuns: number;
  neverRun: number;
}

interface FlowHealthStripProps {
  stats: FlowHealthStats;
}

export function FlowHealthStrip({ stats }: FlowHealthStripProps) {
  if (stats.total === 0) return null;

  const metrics = [
    {
      label: "Active",
      value: stats.active,
      icon: Zap,
      color: "hsl(var(--kf-success))",
      bg: "hsl(var(--kf-success) / 0.1)",
    },
    {
      label: "Paused",
      value: stats.paused,
      icon: PauseCircle,
      color: "hsl(var(--muted-foreground))",
      bg: "hsl(var(--muted) / 0.3)",
    },
    {
      label: "Triggered This Week",
      value: stats.recentlyTriggered,
      icon: TrendingUp,
      color: "hsl(var(--kf-accent1))",
      bg: "hsl(var(--kf-accent1) / 0.1)",
    },
    ...(stats.neverRun > 0
      ? [
          {
            label: "Needs Attention",
            value: stats.neverRun,
            icon: AlertTriangle,
            color: "hsl(var(--kf-warning))",
            bg: "hsl(var(--kf-warning) / 0.1)",
          },
        ]
      : []),
  ];

  return (
    <div className="rounded-xl border border-border/60 bg-card p-3">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: "hsl(var(--kf-accent1) / 0.15)" }}>
          <Sparkles className="w-3 h-3" style={{ color: "hsl(var(--kf-accent1))" }} />
        </div>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Flow Health</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {metrics.map((m) => (
          <div
            key={m.label}
            className="rounded-lg px-3 py-2 flex items-center gap-2.5"
            style={{ background: m.bg }}
          >
            <m.icon className="w-4 h-4 shrink-0" style={{ color: m.color }} />
            <div className="min-w-0">
              <div className="text-lg font-bold leading-tight" style={{ color: m.color }}>{m.value}</div>
              <div className="text-[10px] text-muted-foreground truncate">{m.label}</div>
            </div>
          </div>
        ))}
      </div>
      {stats.mostTriggered && stats.maxRuns > 0 && (
        <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground px-1">
          <Clock className="w-3 h-3 shrink-0" />
          <span>Most triggered: <strong className="text-foreground">{stats.mostTriggered}</strong> ({stats.maxRuns} runs)</span>
        </div>
      )}
    </div>
  );
}
