"use client";

import { useState, useMemo } from "react";
import {
  Zap,
  CalendarPlus,
  Users,
  TrendingUp,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  Send,
  RotateCw,
  X,
  Sparkles,
} from "lucide-react";
import { AiBadge } from "@/components/ui/ai-badge";
import type { ScheduleHealth } from "@/lib/client";

interface ScheduleHintsProps {
  scheduleHealth: ScheduleHealth | null;
  onSendOffer?: (dayOfWeek: string, clientCount: number) => void;
  onRebook?: (contactName: string) => void;
}

interface ActionItem {
  id: string;
  type: "fill_slot" | "rebook" | "recommendation";
  title: string;
  detail: string;
  urgency: "high" | "medium" | "low";
  ctaLabel: string;
  ctaIcon: React.ElementType;
  onAction?: () => void;
  meta?: string;
}

export function ScheduleHints({ scheduleHealth, onSendOffer, onRebook }: ScheduleHintsProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState(true);

  const utilization = scheduleHealth?.weeklyUtilization ?? [];
  const avgUtil = utilization.length > 0
    ? utilization.reduce((s, d) => s + (d.utilizationRate ?? 0), 0) / utilization.length
    : 0;
  const confPct = Math.min(95, Math.max(30, Math.round(50 + avgUtil * 0.5)));
  const confColor = confPct >= 70 ? "--kf-success" : confPct >= 45 ? "--kf-warning" : "--kf-error";
  const confLabel = confPct >= 70 ? "Healthy" : confPct >= 45 ? "Needs Attention" : "Action Required";

  const actions = useMemo(() => {
    if (!scheduleHealth) return [];
    const items: ActionItem[] = [];

    const promos = scheduleHealth.promotionSuggestions ?? [];
    promos.slice(0, 3).forEach((p, i) => {
      items.push({
        id: `fill-${i}`,
        type: "fill_slot",
        title: `${p.dayOfWeek} — ${p.emptySlots} open slot${p.emptySlots !== 1 ? "s" : ""}`,
        detail: p.suggestion,
        urgency: p.emptySlots >= 4 ? "high" : p.emptySlots >= 2 ? "medium" : "low",
        ctaLabel: "Send Offer",
        ctaIcon: Send,
        onAction: () => onSendOffer?.(p.dayOfWeek, p.targetClientCount),
        meta: `${p.targetClientCount} client${p.targetClientCount !== 1 ? "s" : ""}`,
      });
    });

    const rebookings = scheduleHealth.rebookingSuggestions ?? [];
    rebookings.slice(0, 3).forEach((r, i) => {
      items.push({
        id: `rebook-${i}`,
        type: "rebook",
        title: r.contactName,
        detail: `Last: ${r.lastServiceName} · Avg interval: ${r.averageIntervalDays}d`,
        urgency: "medium",
        ctaLabel: "Rebook",
        ctaIcon: RotateCw,
        onAction: () => onRebook?.(r.contactName),
        meta: r.reason,
      });
    });

    const recs = scheduleHealth.recommendations ?? [];
    recs.slice(0, 3).forEach((r, i) => {
      items.push({
        id: `rec-${i}`,
        type: "recommendation",
        title: r,
        detail: "",
        urgency: "low",
        ctaLabel: "",
        ctaIcon: TrendingUp,
      });
    });

    return items;
  }, [scheduleHealth, onSendOffer, onRebook]);

  const visibleActions = actions.filter((a) => !dismissed.has(a.id));
  if (visibleActions.length === 0 && !scheduleHealth) return null;

  const urgencyDot: Record<string, string> = {
    high: "--kf-error",
    medium: "--kf-warning",
    low: "--kf-accent2",
  };

  const typeIcon: Record<string, React.ElementType> = {
    fill_slot: CalendarPlus,
    rebook: Users,
    recommendation: Sparkles,
  };

  const queueCount = visibleActions.filter((a) => a.type !== "recommendation").length;
  const recCount = visibleActions.filter((a) => a.type === "recommendation").length;

  return (
    <div className="kf-card rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-muted/10 transition-colors"
      >
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: "hsl(var(--kf-accent2) / 0.1)" }}
        >
          <Zap className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent2))" }} />
        </div>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-xs font-semibold">Action Queue</span>
          {queueCount > 0 && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold tabular-nums"
              style={{
                background: "hsl(var(--kf-accent1) / 0.12)",
                color: "hsl(var(--kf-accent1))",
              }}
            >
              {queueCount}
            </span>
          )}
          <AiBadge label="AI" compact />
        </div>
        <span
          className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full font-medium shrink-0"
          style={{ background: `hsl(var(${confColor}) / 0.1)`, color: `hsl(var(${confColor}))` }}
        >
          <ShieldCheck className="w-2.5 h-2.5" />
          {confPct}% {confLabel}
        </span>
        {expanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
      </button>

      {expanded && visibleActions.length > 0 && (
        <div className="px-3 pb-3 space-y-1">
          {visibleActions.filter((a) => a.type !== "recommendation").map((action) => {
            const Icon = typeIcon[action.type];
            return (
              <div
                key={action.id}
                className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-muted/10 transition-colors group"
              >
                <div
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: `hsl(var(${urgencyDot[action.urgency]}))` }}
                />
                <Icon
                  className="w-3.5 h-3.5 shrink-0"
                  style={{ color: `hsl(var(${urgencyDot[action.urgency]}))` }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{action.title}</p>
                  {action.detail && (
                    <p className="text-[10px] text-muted-foreground truncate">{action.detail}</p>
                  )}
                </div>
                {action.meta && (
                  <span className="text-[9px] text-muted-foreground shrink-0 hidden sm:inline">
                    {action.meta}
                  </span>
                )}
                {action.ctaLabel && (
                  <button
                    onClick={(e) => { e.stopPropagation(); action.onAction?.(); }}
                    className="px-2 py-1 rounded-lg text-[10px] font-medium shrink-0 transition-all opacity-70 group-hover:opacity-100"
                    style={{
                      background: "hsl(var(--kf-accent1) / 0.1)",
                      color: "hsl(var(--kf-accent1))",
                      borderWidth: 1,
                      borderColor: "hsl(var(--kf-accent1) / 0.2)",
                    }}
                  >
                    <span className="flex items-center gap-1">
                      <action.ctaIcon className="w-2.5 h-2.5" />
                      {action.ctaLabel}
                    </span>
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); setDismissed((prev) => new Set(prev).add(action.id)); }}
                  className="p-0.5 rounded opacity-0 group-hover:opacity-50 hover:!opacity-100 transition-opacity shrink-0"
                  title="Dismiss"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}

          {recCount > 0 && (
            <>
              <div className="border-t border-border/30 my-1" />
              <div className="flex items-center gap-1.5 px-2 pt-1">
                <Sparkles className="w-3 h-3" style={{ color: "hsl(var(--kf-accent2))" }} />
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Insights
                </span>
              </div>
              {visibleActions.filter((a) => a.type === "recommendation").map((action) => (
                <div
                  key={action.id}
                  className="flex items-start gap-2.5 px-2 py-1.5 group"
                >
                  <span
                    className="w-1 h-1 rounded-full shrink-0 mt-1.5"
                    style={{ background: "hsl(var(--kf-accent2))" }}
                  />
                  <p className="text-xs text-muted-foreground flex-1">{action.title}</p>
                  <button
                    onClick={() => setDismissed((prev) => new Set(prev).add(action.id))}
                    className="p-0.5 rounded opacity-0 group-hover:opacity-50 hover:!opacity-100 transition-opacity shrink-0"
                    title="Dismiss"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {expanded && visibleActions.length === 0 && scheduleHealth && (
        <div className="px-3 pb-3">
          <p className="text-[11px] text-muted-foreground/60 text-center py-2">
            All clear — no actions needed right now
          </p>
        </div>
      )}
    </div>
  );
}
