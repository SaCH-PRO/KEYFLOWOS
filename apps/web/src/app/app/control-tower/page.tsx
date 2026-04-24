"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Radar, RefreshCw } from "lucide-react";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { WorkspaceMetricStrip, type MetricStripItem } from "@/components/ui/workspace-metric-strip";
import {
  DollarSign, Users, Calendar, FolderKanban, ShieldCheck, TrendingUp, Link2,
} from "lucide-react";
import { ListPageSkeleton } from "@/components/ui/skeleton";
import { useControlTowerData } from "./components/use-control-tower-data";
import { useControlTowerAiHub } from "./hooks/use-control-tower-ai-hub";
import { CommandEntry } from "./components/command-entry";
import { HealthOverview } from "./components/health-overview";
import { PriorityQueue } from "./components/priority-queue";
import { DailyPlan } from "./components/daily-plan";
import { ModuleHealthGrid } from "./components/module-health-grid";
import { GrowthOpsPanel } from "./components/growth-ops-panel";
import { ApprovalsQueue } from "./components/approvals-queue";
import { RiskAlerts } from "./components/risk-alerts";
import { StorefrontIntel } from "./components/storefront-intel";
import { NextBestActionCard, type NextBestAction } from "./components/next-best-action-card";

function formatTTD(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

export default function ControlTowerPage() {
  const d = useControlTowerData();
  const router = useRouter();

  const aiCustomData = useMemo(() => ({
    momentumScore: d.data?.snapshot.momentumScore,
    overdueInvoices: d.data?.dashboard.overdueInvoices,
    staleLeads: d.data?.dashboard.staleLeads,
    pendingApprovals: d.data?.pendingApprovals,
    activeProjects: d.data?.dashboard.activeProjects,
    overdueTaskCount: d.data?.dashboard.overdueTaskCount,
    monthlyRevenue: d.data?.dashboard.monthlyRevenue,
    utilizationRate: d.data?.dashboard.utilizationRate,
  }), [d.data]);

  const aiHub = useControlTowerAiHub(aiCustomData);

  const nextBestAction = useMemo<NextBestAction | null>(() => {
    const topPriority = d.priorities[0];
    if (!topPriority) return null;

    const defaultAction = {
      actionLabel: topPriority.actionLabel ?? "Open task",
      actionRoute: topPriority.actionRoute ?? "/app/control-tower",
    };
    const primaryAction = topPriority.actions.find((action) => action.toolName === "_navigate");

    const confidence: NextBestAction["confidence"] =
      topPriority.severity === "critical" || topPriority.urgency >= 75 ? "high" : "medium";

    return {
      title: topPriority.title,
      reason: topPriority.description,
      impact:
        topPriority.severity === "critical"
          ? "Prevents urgent operational or revenue risk from compounding."
          : topPriority.type === "opportunity"
          ? "Captures near-term upside by acting while conversion intent is high."
          : "Improves today’s execution focus and keeps workflows moving.",
      actionLabel:
        primaryAction?.label ??
        defaultAction.actionLabel,
      actionRoute:
        (primaryAction?.args?.route as string | undefined) ??
        defaultAction.actionRoute,
      confidence,
    };
  }, [d.priorities]);

  const handleAiAction = (actionKey: string) => {
    if (actionKey.startsWith("navigate:")) {
      router.push(actionKey.replace("navigate:", ""));
    } else if (actionKey.startsWith("switch_tab:")) {
      const section = actionKey.replace("switch_tab:", "");
      const el = document.getElementById(`tower-${section}`);
      if (el) el.scrollIntoView({ behavior: "smooth" });
    }
  };

  if (d.loading) return <ListPageSkeleton />;

  const db = d.data?.dashboard;
  const mods = d.data?.modules;
  const graphData = d.graph;
  const snap = d.snapshot;

  const metricItems: MetricStripItem[] = db && mods ? [
    {
      label: "Monthly Revenue",
      value: formatTTD(snap?.revenue?.monthlyRevenue ?? db.monthlyRevenue),
      icon: DollarSign,
      iconColor: "#F97316",
      threshold: { status: (snap?.revenue?.monthlyRevenue ?? db.monthlyRevenue) > 0 ? "good" : "warn" },
    },
    {
      label: "Contacts",
      value: snap?.contacts?.total ?? mods.contacts.total,
      icon: Users,
      iconColor: "#14B8A6",
    },
    {
      label: "Bookings",
      value: snap?.bookings?.upcomingCount ?? db.upcomingBookings,
      icon: Calendar,
      iconColor: "#3b82f6",
    },
    {
      label: "Projects",
      value: snap?.projects?.activeCount ?? db.activeProjects,
      icon: FolderKanban,
      iconColor: "#a78bfa",
      threshold: {
        status: (snap?.projects?.overdueTaskCount ?? db.overdueTaskCount) > 0 ? "warn" : "good",
      },
    },
    {
      label: "Approvals",
      value: d.data?.pendingApprovals ?? 0,
      icon: ShieldCheck,
      iconColor: "#f59e0b",
      threshold: { status: (d.data?.pendingApprovals ?? 0) > 0 ? "warn" : "good" },
    },
    {
      label: "Momentum",
      value: `${d.data?.snapshot.momentumScore ?? 0}/100`,
      icon: TrendingUp,
      iconColor: "#14B8A6",
      threshold: {
        status: (d.data?.snapshot.momentumScore ?? 0) >= 70 ? "good"
          : (d.data?.snapshot.momentumScore ?? 0) >= 40 ? "warn" : "critical",
      },
    },
    ...(graphData ? [{
      label: "Entity Links",
      value: graphData.linkCount ?? 0,
      icon: Link2,
      iconColor: "#6366f1",
    }] : []),
  ] : [];

  return (
    <WorkspaceShell
      icon={Radar}
      title="Command Flow"
      subtitle="Your operational headquarters"
      iconColor="#F97316"
      ai={{
        hook: aiHub,
        moduleName: "Command Flow",
        onAction: handleAiAction,
      }}
      metricStrip={metricItems.length > 0 ? <WorkspaceMetricStrip items={metricItems} columns={6} compact /> : undefined}
      headerRight={
        <button
          onClick={d.refresh}
          className="flex items-center justify-center w-9 h-9 kf-radius-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-all min-w-[36px] min-h-[36px]"
          aria-label="Refresh data"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      }
    >
      {d.error && (
        <div
          className="p-4 kf-radius-lg"
          style={{
            background: "hsl(var(--kf-error) / 0.1)",
            border: "1px solid hsl(var(--kf-error) / 0.2)",
            color: "hsl(var(--kf-error))",
          }}
        >
          {d.error}
        </div>
      )}

      {d.data && (
        <div className="space-y-4">
          <CommandEntry
            businessId={d.businessId}
            onActionExecuted={d.refreshSilent}
          />

          {nextBestAction && (
            <NextBestActionCard
              recommendation={nextBestAction}
              dataHealth={d.dataHealth}
              staleMinutes={d.staleMinutes}
              onOpenAction={(route) => router.push(route)}
            />
          )}

          <HealthOverview
            momentumScore={d.data.snapshot.momentumScore}
            healthIndicators={d.data.snapshot.healthIndicators}
          />

          <PriorityQueue
            priorities={d.priorities}
            businessId={d.businessId}
            onActionExecuted={d.refreshSilent}
          />

          {(d.data.risks?.length ?? 0) > 0 && (
            <RiskAlerts risks={d.data.risks} />
          )}

          {d.data.pendingApprovals > 0 && (
            <div id="tower-approvals">
              <ApprovalsQueue
                businessId={d.businessId}
                pendingCount={d.data.pendingApprovals}
                onResolve={d.refreshSilent}
              />
            </div>
          )}

          <DailyPlan businessId={d.businessId} />

          <StorefrontIntel
            businessId={d.businessId}
            storefront={d.data.modules.storefront}
            monthlyRevenue={d.data.dashboard.monthlyRevenue}
          />

          <GrowthOpsPanel
            businessId={d.businessId}
            dashboard={d.data.dashboard}
            modules={d.data.modules}
          />

          <ModuleHealthGrid
            modules={d.data.modules}
            dashboard={d.data.dashboard}
          />
        </div>
      )}
    </WorkspaceShell>
  );
}
