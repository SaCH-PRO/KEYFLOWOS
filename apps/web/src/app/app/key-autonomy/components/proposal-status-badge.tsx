"use client";

import type { KeyActionProposalStatus, KeyActionRiskLevel } from "@/lib/api/key-autonomy";

const statusStyles: Record<KeyActionProposalStatus, { label: string; color: string; bg: string }> = {
  PENDING: { label: "Pending", color: "hsl(var(--kf-warning))", bg: "hsl(var(--kf-warning) / 0.1)" },
  APPROVED: { label: "Approved", color: "hsl(var(--kf-accent1))", bg: "hsl(var(--kf-accent1) / 0.1)" },
  REJECTED: { label: "Rejected", color: "hsl(var(--kf-danger))", bg: "hsl(var(--kf-danger) / 0.1)" },
  EXECUTING: { label: "Executing", color: "hsl(var(--kf-accent2))", bg: "hsl(var(--kf-accent2) / 0.1)" },
  EXECUTED: { label: "Executed", color: "hsl(var(--kf-success))", bg: "hsl(var(--kf-success) / 0.1)" },
  FAILED: { label: "Failed", color: "hsl(var(--kf-danger))", bg: "hsl(var(--kf-danger) / 0.1)" },
  BLOCKED: { label: "Blocked by Genome", color: "hsl(var(--kf-danger))", bg: "hsl(var(--kf-danger) / 0.1)" },
  CANCELLED: { label: "Cancelled", color: "hsl(var(--kf-muted-foreground))", bg: "hsl(var(--kf-muted) / 0.15)" },
};

const riskStyles: Record<KeyActionRiskLevel, { label: string; color: string; bg: string }> = {
  LOW: { label: "Low", color: "hsl(var(--kf-muted-foreground))", bg: "hsl(var(--kf-muted) / 0.15)" },
  MEDIUM: { label: "Medium", color: "hsl(var(--kf-accent1))", bg: "hsl(var(--kf-accent1) / 0.1)" },
  HIGH: { label: "High", color: "hsl(var(--kf-warning))", bg: "hsl(var(--kf-warning) / 0.1)" },
  CRITICAL: { label: "Critical", color: "hsl(var(--kf-danger))", bg: "hsl(var(--kf-danger) / 0.1)" },
};

interface ProposalStatusBadgeProps {
  status: KeyActionProposalStatus;
}

export function ProposalStatusBadge({ status }: ProposalStatusBadgeProps) {
  const style = statusStyles[status];
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium"
      style={{ color: style.color, background: style.bg }}
    >
      {style.label}
    </span>
  );
}

interface ProposalRiskBadgeProps {
  riskLevel: KeyActionRiskLevel;
}

export function ProposalRiskBadge({ riskLevel }: ProposalRiskBadgeProps) {
  const style = riskStyles[riskLevel];
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium"
      style={{ color: style.color, background: style.bg }}
    >
      {style.label}
    </span>
  );
}
