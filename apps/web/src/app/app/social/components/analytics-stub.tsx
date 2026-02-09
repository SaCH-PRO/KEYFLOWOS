"use client";

import { BarChart3, Eye, Heart, Share, TrendingUp, Lock } from "lucide-react";

const MOCK_STATS = [
  { label: "Impressions", value: "--", icon: Eye, change: null },
  { label: "Engagement", value: "--", icon: Heart, change: null },
  { label: "Shares", value: "--", icon: Share, change: null },
  { label: "Growth", value: "--", icon: TrendingUp, change: null },
];

export function AnalyticsStub() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <Lock className="w-3.5 h-3.5 text-amber-400" />
        <span className="text-[10px] text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full border border-amber-400/20">Coming Soon</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {MOCK_STATS.map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className="rounded-2xl border border-border/40 bg-slate-900/50 p-4 text-center space-y-2 opacity-50"
            >
              <Icon className="w-5 h-5 text-muted-foreground mx-auto" />
              <p className="text-lg font-bold text-foreground/40">{stat.value}</p>
              <p className="text-[10px] text-muted-foreground">{stat.label}</p>
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl border border-dashed border-border/40 bg-slate-900/30 p-8 text-center space-y-2 opacity-50">
        <BarChart3 className="w-10 h-10 text-muted-foreground/30 mx-auto" />
        <p className="text-sm text-muted-foreground">
          Post analytics and engagement tracking will appear here once you connect your channels.
        </p>
      </div>
    </div>
  );
}
