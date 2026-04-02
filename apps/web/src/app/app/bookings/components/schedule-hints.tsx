"use client";

import { Lightbulb, CalendarPlus, Users, TrendingUp, ShieldCheck } from "lucide-react";
import { AiBadge } from "@/components/ui/ai-badge";
import type { ScheduleHealth } from "@/lib/client";

interface ScheduleHintsProps {
  scheduleHealth: ScheduleHealth | null;
}

export function ScheduleHints({ scheduleHealth }: ScheduleHintsProps) {
  if (!scheduleHealth) return null;

  const promos = scheduleHealth.promotionSuggestions ?? [];
  const rebookings = scheduleHealth.rebookingSuggestions ?? [];
  const recommendations = scheduleHealth.recommendations ?? [];

  const hasContent = promos.length > 0 || rebookings.length > 0 || recommendations.length > 0;
  if (!hasContent) return null;

  const utilization = scheduleHealth.weeklyUtilization ?? [];
  const avgUtil = utilization.length > 0
    ? utilization.reduce((s, d) => s + (d.utilizationRate ?? 0), 0) / utilization.length
    : 0;
  const confPct = Math.min(95, Math.max(30, Math.round(50 + avgUtil * 0.5)));
  const confColor = confPct >= 70 ? "--kf-success" : confPct >= 45 ? "--kf-warning" : "--kf-error";
  const confLabel = confPct >= 70 ? "High" : confPct >= 45 ? "Medium" : "Low";

  return (
    <div className="kf-card rounded-xl p-3 space-y-3">
      <div className="flex items-center gap-2">
        <div
          className="w-6 h-6 rounded-lg flex items-center justify-center"
          style={{ background: "hsl(var(--kf-accent2) / 0.1)" }}
        >
          <Lightbulb className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent2))" }} />
        </div>
        <span className="text-xs font-semibold">Schedule Optimisation</span>
        <span
          className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full font-medium"
          style={{ background: `hsl(var(${confColor}) / 0.1)`, color: `hsl(var(${confColor}))` }}
        >
          <ShieldCheck className="w-2.5 h-2.5" />
          {confPct}% {confLabel}
        </span>
      </div>

      {promos.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <CalendarPlus className="w-3 h-3" style={{ color: "hsl(var(--kf-success))" }} />
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              Fill Empty Slots
            </span>
          </div>
          {promos.slice(0, 3).map((p, i) => (
            <div
              key={i}
              className="flex items-start gap-2.5 p-2 rounded-lg transition-colors hover:bg-muted/10"
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium">
                  {p.dayOfWeek} — {p.emptySlots} open slot{p.emptySlots !== 1 ? "s" : ""}
                </p>
                <p className="text-[10px] text-muted-foreground line-clamp-1">{p.suggestion}</p>
              </div>
              <span
                className="text-[9px] px-1.5 py-0.5 rounded-full font-medium shrink-0"
                style={{
                  background: "hsl(var(--kf-info) / 0.1)",
                  color: "hsl(var(--kf-info))",
                }}
              >
                {p.targetClientCount} clients
              </span>
            </div>
          ))}
        </div>
      )}

      {rebookings.length > 0 && (
        <div className="space-y-1.5">
          {promos.length > 0 && <div className="border-t border-border/40" />}
          <div className="flex items-center gap-1.5">
            <Users className="w-3 h-3" style={{ color: "hsl(var(--kf-accent1))" }} />
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              Rebooking Suggestions
            </span>
          </div>
          {rebookings.slice(0, 3).map((r, i) => (
            <div
              key={i}
              className="flex items-start gap-2.5 p-2 rounded-lg transition-colors hover:bg-muted/10"
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium">{r.contactName}</p>
                <p className="text-[10px] text-muted-foreground">
                  Last: {r.lastServiceName} · Avg interval: {r.averageIntervalDays}d
                </p>
              </div>
              <span className="text-[10px] text-muted-foreground shrink-0">{r.reason}</span>
            </div>
          ))}
        </div>
      )}

      {recommendations.length > 0 && (
        <div className="space-y-1.5">
          {(promos.length > 0 || rebookings.length > 0) && <div className="border-t border-border/40" />}
          <div className="flex items-center gap-1.5">
            <TrendingUp className="w-3 h-3" style={{ color: "hsl(var(--kf-warning))" }} />
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              AI Recommendations
            </span>
            <AiBadge label="AI" compact />
          </div>
          <ul className="space-y-1">
            {recommendations.slice(0, 3).map((r, i) => (
              <li key={i} className="text-xs text-muted-foreground flex items-start gap-2 p-1">
                <span className="w-1 h-1 rounded-full shrink-0 mt-1.5" style={{ background: "hsl(var(--kf-accent2))" }} />
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
