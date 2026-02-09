"use client";

import { BarChart3, Eye, Heart, Share, TrendingUp, Lock } from "lucide-react";

const MOCK_STATS = [
  { label: "Impressions", value: "--", icon: Eye },
  { label: "Engagement", value: "--", icon: Heart },
  { label: "Shares", value: "--", icon: Share },
  { label: "Growth", value: "--", icon: TrendingUp },
];

export function AnalyticsStub() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <Lock className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
        <span className="text-[10px] px-2 py-0.5 rounded-full border" style={{ color: "hsl(var(--kf-accent1))", borderColor: "hsl(var(--kf-accent1) / 0.3)", background: "hsl(var(--kf-accent1) / 0.1)" }}>
          Coming Soon
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {MOCK_STATS.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="kf-card p-4 text-center space-y-2 opacity-50">
              <Icon className="w-5 h-5 text-muted-foreground mx-auto" />
              <p className="text-lg font-bold text-muted-foreground/40">{stat.value}</p>
              <p className="text-[10px] text-muted-foreground">{stat.label}</p>
            </div>
          );
        })}
      </div>

      <div className="kf-card p-8 text-center space-y-2 opacity-50" style={{ borderStyle: "dashed" }}>
        <BarChart3 className="w-10 h-10 text-muted-foreground/30 mx-auto" />
        <p className="text-sm text-muted-foreground">
          Post analytics and engagement tracking will appear here once you connect your channels.
        </p>
      </div>
    </div>
  );
}
