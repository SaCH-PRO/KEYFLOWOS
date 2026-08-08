"use client";

import { Activity, Dna, TrendingUp, FileCheck, Clock, AlertTriangle, Shield, ScrollText } from "lucide-react";
import { Surface } from "@/components/ui-v2/surface";
import { useAnimatedNumber } from "@/hooks/use-animated-number";
import type { CommandCenterHealth } from "@/lib/api/business-command-center";

interface CommandHealthStripV2Props {
  health: CommandCenterHealth;
}

interface HealthMetric {
  label: string;
  icon: React.ElementType;
  value: string | number;
  score?: number;
  tone: "neutral" | "warning" | "danger" | "success";
}

function toneColor(tone: HealthMetric["tone"]): string {
  switch (tone) {
    case "success":
      return "hsl(var(--kf-success, 160 70% 45%))";
    case "warning":
      return "hsl(var(--kf-warning, 30 90% 55%))";
    case "danger":
      return "hsl(var(--kf-error, 0 80% 60%))";
    default:
      return "hsl(var(--kf-muted-foreground))";
  }
}

function MetricCard({ metric }: { metric: HealthMetric }) {
  const Icon = metric.icon;
  const color = toneColor(metric.tone);
  const hasScore = metric.score !== undefined;
  const animatedScore = useAnimatedNumber(hasScore ? metric.score! : 0, { duration: 900, decimals: 0 });

  return (
    <div
      className="rounded-xl p-3 border transition-colors hover:border-opacity-40"
      style={{
        background: `${color}08`,
        borderColor: `${color}25`,
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <div
          className="flex h-6 w-6 items-center justify-center rounded-lg flex-shrink-0"
          style={{ background: `${color}18` }}
        >
          <Icon className="h-3 w-3" style={{ color }} />
        </div>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground leading-tight">
          {metric.label}
        </span>
      </div>
      <div className="flex items-end gap-2">
        <span className="text-lg font-display font-bold" style={{ color }}>
          {hasScore ? `${animatedScore}%` : metric.value}
        </span>
      </div>
      {hasScore && (
        <div className="mt-2 h-1.5 rounded-full bg-muted/50 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-1000 ease-out"
            style={{ width: `${Math.min(metric.score!, 100)}%`, background: color }}
          />
        </div>
      )}
    </div>
  );
}

export function CommandHealthStripV2({ health }: CommandHealthStripV2Props) {
  const genomeTone = health.genomeIntegrity >= 70 ? "success" : health.genomeIntegrity >= 50 ? "warning" : "danger";
  const readinessTone =
    health.executiveReadinessScore >= 70 ? "success" : health.executiveReadinessScore >= 50 ? "warning" : "danger";

  const metrics: HealthMetric[] = [
    {
      label: "Genome Integrity",
      icon: Dna,
      value: `${health.genomeIntegrity}%`,
      score: health.genomeIntegrity,
      tone: genomeTone,
    },
    {
      label: "Readiness",
      icon: TrendingUp,
      value: `${health.executiveReadinessScore}%`,
      score: health.executiveReadinessScore,
      tone: readinessTone,
    },
    {
      label: "Stage",
      icon: Activity,
      value: health.genomeStage.replace(/_/g, " "),
      tone: "neutral",
    },
    {
      label: "Approvals",
      icon: FileCheck,
      value: health.pendingApprovalCount,
      tone: health.pendingApprovalCount > 0 ? "warning" : "success",
    },
    {
      label: "Urgent",
      icon: Clock,
      value: health.urgentTemporalCount,
      tone: health.urgentTemporalCount > 0 ? "danger" : "success",
    },
    {
      label: "Risks",
      icon: AlertTriangle,
      value: health.criticalCount + health.highPriorityCount,
      tone: health.criticalCount > 0 ? "danger" : health.highPriorityCount > 0 ? "warning" : "success",
    },
    {
      label: "Constitution",
      icon: ScrollText,
      value: health.constitutionStale ? "Stale" : "Current",
      tone: health.constitutionStale ? "warning" : "success",
    },
    {
      label: "Shield",
      icon: Shield,
      value: health.approvedAwaitingExecutionCount,
      tone: health.approvedAwaitingExecutionCount > 0 ? "warning" : "neutral",
    },
  ];

  return (
    <Surface className="p-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {metrics.map((metric) => (
          <MetricCard key={metric.label} metric={metric} />
        ))}
      </div>
    </Surface>
  );
}
