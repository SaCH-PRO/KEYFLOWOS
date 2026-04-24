"use client";

import { AlertTriangle, ArrowRight, CheckCircle2, ShieldAlert } from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import type { ControlTowerState } from "./use-control-tower-data";

export type NextBestAction = {
  title: string;
  reason: string;
  impact: string;
  actionLabel: string;
  actionRoute: string;
  confidence: "high" | "medium";
};

export function NextBestActionCard({
  recommendation,
  dataHealth,
  staleMinutes,
  onOpenAction,
}: {
  recommendation: NextBestAction;
  dataHealth: ControlTowerState["dataHealth"];
  staleMinutes: number | null;
  onOpenAction: (route: string) => void;
}) {
  const healthLabel =
    dataHealth === "connected"
      ? "Fully connected"
      : dataHealth === "partial"
      ? "Partially connected"
      : dataHealth === "stale"
      ? "Data is stale"
      : "Data sync failed";

  const healthColor =
    dataHealth === "connected"
      ? "hsl(var(--kf-success))"
      : dataHealth === "partial"
      ? "hsl(var(--kf-warning))"
      : dataHealth === "stale"
      ? "hsl(var(--kf-warning))"
      : "hsl(var(--kf-error))";

  const confidenceColor =
    recommendation.confidence === "high"
      ? "hsl(var(--kf-success))"
      : "hsl(var(--kf-warning))";

  return (
    <SectionCard
      title="Next best action"
      subtitle="One recommendation for maximum immediate impact"
      icon={recommendation.confidence === "high" ? CheckCircle2 : AlertTriangle}
    >
      <div
        className="rounded-xl p-4 space-y-3"
        style={{
          background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.08), hsl(var(--kf-accent2) / 0.06))",
          border: "1px solid hsl(var(--kf-accent1) / 0.2)",
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">{recommendation.title}</p>
            <p className="text-xs text-muted-foreground mt-1">{recommendation.reason}</p>
          </div>
          <span
            className="px-2 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider"
            style={{
              background: `${confidenceColor}20`,
              color: confidenceColor,
            }}
          >
            {recommendation.confidence} confidence
          </span>
        </div>

        <div
          className="rounded-lg px-3 py-2 text-xs"
          style={{
            background: "hsl(var(--kf-background) / 0.45)",
            border: "1px solid hsl(var(--kf-border) / 0.28)",
          }}
        >
          <p className="font-medium">Expected impact</p>
          <p className="text-muted-foreground mt-0.5">{recommendation.impact}</p>
        </div>

        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full"
            style={{
              background: `${healthColor}18`,
              color: healthColor,
            }}
          >
            {dataHealth === "failed" ? <ShieldAlert className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
            {healthLabel}
          </span>
          {staleMinutes !== null && dataHealth === "stale" && (
            <span className="text-muted-foreground">Last sync: {staleMinutes}m ago</span>
          )}
        </div>

        <button
          onClick={() => onOpenAction(recommendation.actionRoute)}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all hover:opacity-90"
          style={{
            background: "hsl(var(--kf-accent1))",
            color: "hsl(var(--kf-foreground))",
          }}
        >
          {recommendation.actionLabel}
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </SectionCard>
  );
}
