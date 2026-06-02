"use client";

import { useEffect, useState, useCallback } from "react";
import { apiGet } from "@/lib/api";
import { useRouter } from "next/navigation";
import { Zap, RefreshCw, Rocket, TrendingUp, Building2, X, Terminal } from "lucide-react";
import { CommandQueue } from "@/components/command/command-queue";
import {
  fetchCommandItems,
  dismissCommandItem,
  approveCommandItem,
  executeCommandItem,
  type CommandItem,
} from "@/lib/api/command";
import { useControlTowerData } from "../control-tower/components/use-control-tower-data";
import { CommandEntry } from "../control-tower/components/command-entry";
import { DoItForMePanel } from "../control-tower/components/do-it-for-me-panel";
import { MorningBriefing } from "../control-tower/components/morning-briefing";
import { ListPageSkeleton } from "@/components/ui/skeleton";
import { GettingStartedChecklist } from "@/components/ui/getting-started-checklist";
import { CockpitHero } from "./components/cockpit-hero";
import { CockpitStatsRow } from "./components/cockpit-stats-row";
import { CockpitFlowVisual } from "./components/cockpit-flow-visual";
import { CockpitKeyPanel } from "./components/cockpit-key-panel";
import { CockpitPriorities } from "./components/cockpit-priorities";
import { CockpitBottomSection } from "./components/cockpit-bottom-section";
import { TodaysPlanCard } from "./components/todays-plan-card";
import {
  hasChosenMode,
  setDisclosureMode,
  MODE_LABELS,
  type DisclosureMode,
} from "@/lib/disclosure-mode";

export default function KeyflowCommandPage() {
  const d = useControlTowerData();
  const router = useRouter();
  const [connectorAlertCount, setConnectorAlertCount] = useState(0);
  const [showModePrompt, setShowModePrompt] = useState(() => !hasChosenMode());

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

  const db = d.data?.dashboard;
  const snap = d.snapshot;
  const pendingApprovals = d.data?.pendingApprovals ?? 0;

  // Command Queue — universal spine
  const [commands, setCommands] = useState<CommandItem[]>([]);
  const [commandTotal, setCommandTotal] = useState(0);
  const [commandLoading, setCommandLoading] = useState(false);

  const loadCommands = useCallback(async () => {
    if (!d.businessId) return;
    setCommandLoading(true);
    try {
      const res = await fetchCommandItems(d.businessId, { status: "OPEN", limit: 10 });
      setCommands(res.data?.items ?? []);
      setCommandTotal(res.data?.total ?? 0);
    } catch (e) {
      // silent fail — command queue is additive, not blocking
    } finally {
      setCommandLoading(false);
    }
  }, [d.businessId]);

  useEffect(() => {
    loadCommands();
  }, [loadCommands]);

  const handleDismiss = async (id: string) => {
    if (!d.businessId) return;
    await dismissCommandItem(d.businessId, id);
    await loadCommands();
    d.refreshSilent();
  };
  const handleApprove = async (id: string) => {
    if (!d.businessId) return;
    await approveCommandItem(d.businessId, id);
    await loadCommands();
    d.refreshSilent();
  };
  const handleExecute = async (id: string) => {
    if (!d.businessId) return;
    await executeCommandItem(d.businessId, id);
    await loadCommands();
    d.refreshSilent();
  };

  if (d.loading) return <ListPageSkeleton />;

  const momentumScore =
    d.data?.snapshot.momentumScore ?? db?.momentumScore ?? 0;

  return (
    <div className="flex flex-col xl:flex-row gap-6 pb-12">
      {/* ─── MAIN COLUMN ─── */}
      <div className="flex-1 min-w-0 space-y-6">
        {/* Header row */}
        <div className="flex items-center justify-between">
          <CockpitHero preparedCount={Math.min(d.priorities.length, 5)} />
          <div className="flex items-center gap-2 shrink-0">
            {connectorAlertCount > 0 && (
              <button
                onClick={() => router.push("/app/connect")}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/15 transition-colors"
              >
                <Zap className="w-3.5 h-3.5" />
                {connectorAlertCount} connector{connectorAlertCount > 1 ? "s" : ""} need attention
              </button>
            )}
            <button
              onClick={d.refresh}
              className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* First-time mode selection prompt */}
        {showModePrompt && (
          <div className="rounded-xl border border-border/60 bg-card/80 backdrop-blur-sm p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Welcome to KeyflowOS</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Pick a workspace mode so we only show what you need. You can change this anytime.
                </p>
              </div>
              <button
                onClick={() => setShowModePrompt(false)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {([
                { mode: "startup" as DisclosureMode, icon: Rocket, border: "border-emerald-500/20", bg: "bg-emerald-500/5", bgHover: "hover:bg-emerald-500/10", text: "text-emerald-400" },
                { mode: "growth" as DisclosureMode, icon: TrendingUp, border: "border-amber-500/20", bg: "bg-amber-500/5", bgHover: "hover:bg-amber-500/10", text: "text-amber-400" },
                { mode: "enterprise" as DisclosureMode, icon: Building2, border: "border-violet-500/20", bg: "bg-violet-500/5", bgHover: "hover:bg-violet-500/10", text: "text-violet-400" },
              ]).map(({ mode, icon: Icon, border, bg, bgHover, text }) => (
                <button
                  key={mode}
                  onClick={() => {
                    setDisclosureMode(mode);
                    setShowModePrompt(false);
                  }}
                  className={`text-left rounded-lg border ${border} ${bg} ${bgHover} px-3 py-2.5 transition-colors group`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className={`w-3.5 h-3.5 ${text}`} />
                    <span className="text-sm font-medium text-foreground">{MODE_LABELS[mode].title}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-snug">{MODE_LABELS[mode].subtitle}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Morning Briefing */}
        {d.businessId && <MorningBriefing businessId={d.businessId} />}

        {/* Getting Started (new users) */}
        <GettingStartedChecklist
          businessName={d.data?.snapshot?.business?.name}
          hasBookings={(db?.upcomingBookings ?? 0) > 0}
        />

        {/* Business Flow Visual */}
        <CockpitFlowVisual />

        {/* Today's AI Plan */}
        {d.businessId && <TodaysPlanCard businessId={d.businessId} />}

        {/* Stats Row */}
        <CockpitStatsRow
          upcomingBookings={db?.upcomingBookings ?? 0}
          overdueAmount={db?.overdueAmount ?? snap?.revenue?.overdueAmount ?? 0}
          overdueInvoices={db?.overdueInvoices ?? snap?.revenue?.overdueCount ?? 0}
          staleLeads={db?.staleLeads ?? snap?.contacts?.staleLeadCount ?? 0}
          pendingApprovals={pendingApprovals}
          momentumScore={momentumScore}
        />

        {/* Command Queue — universal business spine */}
        <section className="rounded-xl border border-border/60 bg-card/80 backdrop-blur-sm p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold">Command Queue</h3>
              {commandTotal > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                  {commandTotal}
                </span>
              )}
            </div>
            <button
              onClick={() => router.push("/app/command-center")}
              className="text-xs font-medium text-primary hover:underline"
            >
              Open Command Center →
            </button>
          </div>
          <CommandQueue
            items={commands}
            total={commandTotal}
            loading={commandLoading}
            onRefresh={loadCommands}
            onDismiss={handleDismiss}
            onApprove={handleApprove}
            onExecute={handleExecute}
          />
        </section>

        {/* Today's Priorities */}
        <CockpitPriorities
          priorities={d.priorities}
          businessId={d.businessId}
          onActionExecuted={d.refreshSilent}
        />

        {/* Bottom Section: Wins / Upcoming / Insight */}
        <CockpitBottomSection
          priorities={d.priorities}
          upcomingBookings={db?.upcomingBookings ?? 0}
          momentumScore={momentumScore}
          staleLeads={db?.staleLeads ?? snap?.contacts?.staleLeadCount ?? 0}
          overdueAmount={db?.overdueAmount ?? snap?.revenue?.overdueAmount ?? 0}
        />

        {/* Legacy KEY panels (preserved for functionality) */}
        {d.businessId && (
          <div className="space-y-4 pt-4 border-t border-[hsl(var(--kf-border))]">
            <CommandEntry businessId={d.businessId} onActionExecuted={d.refreshSilent} />
          </div>
        )}

        {/* Error */}
        {d.error && (
          <div
            className="p-4 rounded-xl text-sm"
            style={{
              background: "hsl(var(--kf-error) / 0.1)",
              border: "1px solid hsl(var(--kf-error) / 0.2)",
              color: "hsl(var(--kf-error))",
            }}
          >
            {d.error}
          </div>
        )}
      </div>

      {/* ─── RIGHT SIDEBAR (KEY Panel) ─── */}
      <aside className="w-full xl:w-80 shrink-0 space-y-4">
        <div className="xl:sticky xl:top-4 space-y-4">
          <CockpitKeyPanel
            businessId={d.businessId}
            priorities={d.priorities}
            pendingApprovals={pendingApprovals}
            onActionExecuted={d.refreshSilent}
          />

          {/* Legacy Do It For Me Panel — tucked below KEY panel on desktop */}
          {d.businessId && (
            <div className="hidden xl:block">
              <DoItForMePanel businessId={d.businessId} />
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
