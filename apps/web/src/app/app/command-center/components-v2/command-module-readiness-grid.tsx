"use client";

import { ShieldCheck, ShieldAlert, Shield } from "lucide-react";
import type { CommandCenterModuleReadiness } from "@/lib/api/business-command-center";
import { MissionCard } from "@/components/ui-v2/mission-card";
import { EmptyState } from "@/components/ui-v2/empty-state";

interface CommandModuleReadinessGridProps {
  modules: CommandCenterModuleReadiness[];
  onReview?: () => void;
}

function moduleStatus(m: CommandCenterModuleReadiness) {
  if (!m.automationAllowed) return "locked" as const;
  if (m.readinessScore >= 70) return "ready" as const;
  return "attention" as const;
}

export function CommandModuleReadinessGrid({ modules, onReview }: CommandModuleReadinessGridProps) {
  const sorted = [...modules].sort((a, b) => {
    if (a.automationAllowed !== b.automationAllowed) return a.automationAllowed ? 1 : -1;
    if (a.readinessScore !== b.readinessScore) return a.readinessScore - b.readinessScore;
    const riskRank = { CRITICAL: 3, HIGH: 2, MEDIUM: 1, LOW: 0 } as const;
    return riskRank[b.riskLevel] - riskRank[a.riskLevel];
  });

  if (sorted.length === 0) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="No module readiness data yet"
        description="Complete your Business Genome so KEY can score module readiness."
        actionLabel="Populate Genome"
        onAction={onReview}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {sorted.map((m) => {
        const status = moduleStatus(m);
        const badge =
          status === "locked"
            ? "Blocked"
            : status === "ready"
              ? "Ready"
              : `${m.readinessScore}% ready`;

        return (
          <MissionCard
            key={m.module}
            icon={status === "locked" ? ShieldAlert : status === "ready" ? ShieldCheck : Shield}
            title={m.module.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
            description={
              m.blockedReasons[0] ??
              (status === "ready"
                ? "Automation allowed"
                : status === "locked"
                  ? `Risk level: ${m.riskLevel}`
                  : "Needs attention before automation")
            }
            status={status}
            progress={m.automationAllowed ? m.readinessScore : undefined}
            badge={badge}
            onClick={onReview}
          />
        );
      })}
    </div>
  );
}
