"use client";

import type { CommandCenterHealth } from "@/lib/api/business-command-center";

interface CommandHealthStripProps {
  health: CommandCenterHealth;
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone?: "neutral" | "warning" | "danger" | "success" }) {
  const color = {
    neutral: "text-muted-foreground",
    warning: "text-[hsl(var(--kf-warning))]",
    danger: "text-destructive",
    success: "text-[hsl(var(--kf-success))]",
  }[tone ?? "neutral"];

  return (
    <div className="flex flex-col">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</span>
      <span className={`text-sm font-semibold ${color}`}>{value}</span>
    </div>
  );
}

export function CommandHealthStrip({ health }: CommandHealthStripProps) {
  const genomeTone = health.genomeIntegrity >= 70 ? "success" : health.genomeIntegrity >= 50 ? "warning" : "danger";
  const readinessTone = health.executiveReadinessScore >= 70 ? "success" : health.executiveReadinessScore >= 50 ? "warning" : "danger";

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 p-4 rounded-2xl border border-border/30 bg-card/40">
      <Metric label="Genome Integrity" value={`${health.genomeIntegrity}%`} tone={genomeTone} />
      <Metric label="Readiness" value={`${health.executiveReadinessScore}%`} tone={readinessTone} />
      <Metric label="Stage" value={health.genomeStage.replace(/_/g, " ")} />
      <Metric label="Approvals" value={health.pendingApprovalCount} tone={health.pendingApprovalCount > 0 ? "warning" : "success"} />
      <Metric label="Approved" value={health.approvedAwaitingExecutionCount} tone={health.approvedAwaitingExecutionCount > 0 ? "warning" : "neutral"} />
      <Metric label="Urgent" value={health.urgentTemporalCount} tone={health.urgentTemporalCount > 0 ? "danger" : "success"} />
      <Metric label="Risks" value={health.criticalCount + health.highPriorityCount} tone={health.criticalCount > 0 ? "danger" : health.highPriorityCount > 0 ? "warning" : "success"} />
      <Metric label="Constitution" value={health.constitutionStale ? "Stale" : "Current"} tone={health.constitutionStale ? "warning" : "success"} />
    </div>
  );
}
