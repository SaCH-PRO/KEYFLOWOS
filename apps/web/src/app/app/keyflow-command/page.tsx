"use client";

import { useEffect, useMemo, useState } from "react";
import { apiGet } from "@/lib/api";
import { useRouter } from "next/navigation";
import { Sparkles, RefreshCw, Plug, Pencil, Share2 } from "lucide-react";
import { useCompose } from "@/components/email/compose-context";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { WorkspaceMetricStrip, type MetricStripItem } from "@/components/ui/workspace-metric-strip";
import {
  DollarSign,
  Users,
  Calendar,
  FolderKanban,
  ShieldCheck,
  TrendingUp,
  Link2,
} from "lucide-react";
import { ListPageSkeleton } from "@/components/ui/skeleton";
import { useControlTowerData } from "../control-tower/components/use-control-tower-data";
import { useControlTowerAiHub } from "../control-tower/hooks/use-control-tower-ai-hub";
import { CommandEntry } from "../control-tower/components/command-entry";
import { HealthOverview } from "../control-tower/components/health-overview";
import { PriorityQueue } from "../control-tower/components/priority-queue";
import { DailyPlan } from "../control-tower/components/daily-plan";
import { ModuleHealthGrid } from "../control-tower/components/module-health-grid";
import { GrowthOpsPanel } from "../control-tower/components/growth-ops-panel";
import { GrowthIntelligencePanel } from "../control-tower/components/growth-intelligence-panel";
import { ApprovalsQueue } from "../control-tower/components/approvals-queue";
import { RiskAlerts } from "../control-tower/components/risk-alerts";
import { StorefrontIntel } from "../control-tower/components/storefront-intel";
import { ServiceLinkWidget } from "../commerce/components/service-link-widget";
import UnifiedCalendar from "./components/unified-calendar";
import { TodaysPlanCard } from "./components/todays-plan-card";
import { NextActionsWidget } from "../crm/dashboard/next-actions-widget";
import { AskKeyButton, KeyNoticedStream } from "@/components/key";
import {
  KeyflowNotesDrawer,
  type KeyflowNotesTarget,
} from "@/components/keyflow/keyflow-notes-drawer";

function formatTTD(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

export default function KeyflowCommandPage() {
  const d = useControlTowerData();
  const router = useRouter();
  const compose = useCompose();
  const [notesTarget, setNotesTarget] = useState<KeyflowNotesTarget | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [connectorAlertCount, setConnectorAlertCount] = useState(0);

  useEffect(() => {
    if (!d.businessId) return;
    let cancelled = false;
    const load = async () => {
      const res = await apiGet<{ count?: number }>(
        `/connectors/businesses/${d.businessId}/needs-attention`,
      );
      if (!cancelled && res.data && typeof res.data.count === "number") {
        setConnectorAlertCount(res.data.count);
      }
    };
    load();
    const id = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [d.businessId]);

  const aiCustomData = useMemo(
    () => ({
      momentumScore: d.data?.snapshot.momentumScore,
      overdueInvoices: d.data?.dashboard.overdueInvoices,
      staleLeads: d.data?.dashboard.staleLeads,
      pendingApprovals: d.data?.pendingApprovals,
      activeProjects: d.data?.dashboard.activeProjects,
      overdueTaskCount: d.data?.dashboard.overdueTaskCount,
      monthlyRevenue: d.data?.dashboard.monthlyRevenue,
      utilizationRate: d.data?.dashboard.utilizationRate,
    }),
    [d.data],
  );

  const aiHub = useControlTowerAiHub(aiCustomData);

  const handleAiAction = (actionKey: string) => {
    if (actionKey.startsWith("navigate:")) {
      router.push(actionKey.replace("navigate:", ""));
    } else if (actionKey.startsWith("switch_tab:")) {
      const section = actionKey.replace("switch_tab:", "");
      const el = document.getElementById(`keyflow-${section}`);
      if (el) el.scrollIntoView({ behavior: "smooth" });
    }
  };

  const openNotes = (target: KeyflowNotesTarget) => {
    setNotesTarget(target);
    setNotesOpen(true);
  };

  const pageContext = useMemo(() => {
    if (!d.data) return undefined;
    return {
      page: "KEYFLOW",
      summary: "Operator's flagship workspace with priorities, calendar, projections, and module health.",
      data: {
        momentumScore: d.data.snapshot.momentumScore,
        monthlyRevenue: d.data.dashboard.monthlyRevenue,
        upcomingBookings: d.data.dashboard.upcomingBookings,
        overdueInvoices: d.data.dashboard.overdueInvoices,
        overdueTaskCount: d.data.dashboard.overdueTaskCount,
        pendingApprovals: d.data.pendingApprovals,
        activeProjects: d.data.dashboard.activeProjects,
        priorities: d.priorities?.slice(0, 5).map((p: { title: string; severity: string; module: string }) => ({
          title: p.title,
          severity: p.severity,
          module: p.module,
        })),
      },
    };
  }, [d.data, d.priorities]);

  if (d.loading) return <ListPageSkeleton />;

  const db = d.data?.dashboard;
  const mods = d.data?.modules;
  const graphData = d.graph;
  const snap = d.snapshot;

  const metricItems: MetricStripItem[] =
    db && mods
      ? [
          {
            label: "Monthly Revenue",
            value: formatTTD(snap?.revenue?.monthlyRevenue ?? db.monthlyRevenue),
            icon: DollarSign,
            iconColor: "#F97316",
            threshold: {
              status:
                (snap?.revenue?.monthlyRevenue ?? db.monthlyRevenue) > 0
                  ? "good"
                  : "warn",
            },
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
              status:
                (snap?.projects?.overdueTaskCount ?? db.overdueTaskCount) > 0
                  ? "warn"
                  : "good",
            },
          },
          {
            label: "Approvals",
            value: d.data?.pendingApprovals ?? 0,
            icon: ShieldCheck,
            iconColor: "#f59e0b",
            threshold: {
              status: (d.data?.pendingApprovals ?? 0) > 0 ? "warn" : "good",
            },
          },
          {
            label: "Momentum",
            value: `${d.data?.snapshot.momentumScore ?? 0}/100`,
            icon: TrendingUp,
            iconColor: "#14B8A6",
            threshold: {
              status:
                (d.data?.snapshot.momentumScore ?? 0) >= 70
                  ? "good"
                  : (d.data?.snapshot.momentumScore ?? 0) >= 40
                  ? "warn"
                  : "critical",
            },
          },
          ...(graphData
            ? [
                {
                  label: "Entity Links",
                  value: graphData.linkCount ?? 0,
                  icon: Link2,
                  iconColor: "#6366f1",
                },
              ]
            : []),
        ]
      : [];

  return (
    <>
      <WorkspaceShell
        icon={Sparkles}
        title="KEYFLOW"
        subtitle="Operator headquarters · live brain across every module"
        iconColor="#F97316"
        ai={{
          hook: aiHub,
          moduleName: "KEYFLOW",
          onAction: handleAiAction,
        }}
        metricStrip={
          metricItems.length > 0 ? (
            <WorkspaceMetricStrip items={metricItems} columns={6} compact />
          ) : undefined
        }
        headerRight={
          <div className="flex items-center gap-2">
            <AskKeyButton
              variant="primary"
              label="Ask KEY about this"
              module="cockpit"
              context={pageContext as Record<string, unknown> | undefined}
            />
            <button
              onClick={() => compose.open()}
              className="flex items-center gap-1.5 h-9 px-3 kf-radius-md text-xs font-medium min-h-[36px]"
              style={{ background: "hsl(var(--kf-accent1))", color: "hsl(var(--kf-primary-foreground))" }}
              aria-label="Compose new email (Cmd+Shift+M)"
              title="Compose (Cmd+Shift+M)"
            >
              <Pencil className="w-3.5 h-3.5" />
              <span>Compose</span>
            </button>
            <button
              onClick={() => router.push("/app/social")}
              className="flex items-center gap-1.5 h-9 px-3 kf-radius-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-all min-h-[36px]"
              aria-label="Compose social post"
              title="Compose social post"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span className="text-xs font-medium">Compose post</span>
            </button>
            <button
              onClick={() => router.push("/app/connect")}
              className="relative flex items-center gap-1.5 h-9 px-3 kf-radius-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-all min-h-[36px]"
              aria-label={
                connectorAlertCount > 0
                  ? `Connect — ${connectorAlertCount} need attention`
                  : "Connect integrations"
              }
              title="Manage integrations"
            >
              <Plug className="w-3.5 h-3.5" />
              <span className="text-xs font-medium">Connect</span>
              {connectorAlertCount > 0 && (
                <span
                  className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 text-[10px] font-semibold rounded-full flex items-center justify-center"
                  style={{
                    background: "hsl(var(--kf-error))",
                    color: "white",
                  }}
                >
                  {connectorAlertCount > 9 ? "9+" : connectorAlertCount}
                </span>
              )}
            </button>
            <button
              onClick={d.refresh}
              className="flex items-center justify-center w-9 h-9 kf-radius-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-all min-w-[36px] min-h-[36px]"
              aria-label="Refresh data"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
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
            {d.businessId && <KeyNoticedStream businessId={d.businessId} />}
            {d.businessId && <ServiceLinkWidget compact />}

            <CommandEntry
              businessId={d.businessId}
              onActionExecuted={d.refreshSilent}
            />

            <HealthOverview
              momentumScore={d.data.snapshot.momentumScore}
              healthIndicators={d.data.snapshot.healthIndicators}
            />

            <PriorityQueue
              priorities={d.priorities}
              businessId={d.businessId}
              onActionExecuted={d.refreshSilent}
            />

            <NextActionsWidget businessId={d.businessId} windowDays={7} limit={25} />

            <TodaysPlanCard businessId={d.businessId} />

            <div id="keyflow-calendar">
              <UnifiedCalendar
                businessId={d.businessId}
                onOpenNotes={openNotes}
              />
            </div>

            {(d.data.risks?.length ?? 0) > 0 && (
              <RiskAlerts risks={d.data.risks} />
            )}

            {d.data.pendingApprovals > 0 && (
              <div id="keyflow-approvals">
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

            <div id="keyflow-growth-intelligence">
              <GrowthIntelligencePanel businessId={d.businessId} />
            </div>

            <ModuleHealthGrid
              modules={d.data.modules}
              dashboard={d.data.dashboard}
            />
          </div>
        )}
      </WorkspaceShell>

      <KeyflowNotesDrawer
        businessId={d.businessId}
        open={notesOpen}
        target={notesTarget}
        onClose={() => setNotesOpen(false)}
      />
    </>
  );
}
