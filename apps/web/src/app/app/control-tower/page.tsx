"use client";

import { useControlTowerData } from "./components/use-control-tower-data";
import { MorningBriefing } from "./components/morning-briefing";
import { HealthOverview } from "./components/health-overview";
import { ModuleHealthGrid } from "./components/module-health-grid";
import { PriorityQueue } from "./components/priority-queue";
import { RiskAlerts } from "./components/risk-alerts";
import { CommandEntry } from "./components/command-entry";
import { ApprovalsQueue } from "./components/approvals-queue";
import { Loader2 } from "lucide-react";

export default function ControlTowerPage() {
  const {
    loading,
    error,
    businessId,
    data,
    priorities,
    refreshSilent,
  } = useControlTowerData();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 text-[hsl(var(--kf-accent1))] animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="text-center py-20">
          <h2 className="text-lg font-semibold text-foreground/70">Control Tower unavailable</h2>
          <p className="text-sm text-muted-foreground/50 mt-1">{error ?? "No data available"}</p>
          <button
            onClick={refreshSilent}
            className="mt-4 px-4 py-2 rounded-lg bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] text-sm font-medium hover:bg-[hsl(var(--kf-accent1))]/20 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-6">
      <MorningBriefing businessId={businessId} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <HealthOverview
            momentumScore={data.snapshot.momentumScore}
            healthIndicators={data.snapshot.healthIndicators}
          />
          <ModuleHealthGrid modules={data.modules} dashboard={data.dashboard} />
        </div>
        <div className="space-y-4">
          <CommandEntry businessId={businessId} onActionExecuted={refreshSilent} />
          <RiskAlerts risks={data.risks} />
        </div>
      </div>

      <PriorityQueue
        priorities={priorities}
        businessId={businessId}
        onActionExecuted={refreshSilent}
      />

      <ApprovalsQueue businessId={businessId} pendingCount={data.pendingApprovals} onResolve={refreshSilent} />
    </div>
  );
}
