"use client";

import {
  DollarSign,
  Calendar,
  TrendingUp,
  CheckCircle2,
} from "lucide-react";
import { DashboardSkeleton } from "@/components/ui/skeleton";
import { formatTTD } from "./_command/types";
import { useCommandData } from "./_command/use-command-data";
import { QuickActionBar } from "./_command/quick-action-bar";
import { AiCommandBar } from "./_command/ai-command-bar";
import { BriefingCard } from "./_command/briefing-card";
import { PriorityQueue } from "./_command/priority-queue";
import { SimulationDrawer } from "./_command/simulation-drawer";
import { ProgressSection } from "./_command/progress-section";

export default function CommandPage() {
  const d = useCommandData();

  if (d.loading) return <DashboardSkeleton />;

  return (
    <div className="space-y-5 max-w-3xl mx-auto pb-10" aria-label="Command Center">
      {d.error && (
        <div className="p-4 kf-radius-lg" style={{ background: "hsl(var(--kf-error) / 0.1)", border: "1px solid hsl(var(--kf-error) / 0.2)", color: "hsl(var(--kf-error))" }}>
          {d.error}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="kf-text-title font-semibold tracking-tight">
            {d.greeting}{d.displayName ? `, ${d.displayName}` : ""}
          </h1>
          <p className="text-muted-foreground kf-text-body mt-0.5 flex items-center gap-2">
            {d.tasks.length > 0
              ? <span>{d.tasks.length} task{d.tasks.length > 1 ? "s" : ""} today</span>
              : <span>All caught up!</span>}
            <span className="text-border">·</span>
            <span style={{ color: "hsl(var(--kf-accent1))" }}>{formatTTD(d.todayRevenue)}</span>
            <span className="text-border">·</span>
            <span>{d.todayBookings} booking{d.todayBookings !== 1 ? "s" : ""}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <QuickActionBar />
          <SimulationDrawer businessId={d.businessId} />
        </div>
      </div>

      <AiCommandBar businessId={d.businessId} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricTile icon={DollarSign} color="--kf-accent1" label="Today" value={formatTTD(d.todayRevenue)} sub={d.pendingInvoices > 0 ? `${d.pendingInvoices} pending` : undefined} />
        <div className="kf-card-metric">
          <div className="flex items-center gap-1.5 text-muted-foreground mb-2">
            <TrendingUp className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent2))" }} />
            <span className="kf-text-micro font-medium">This Month</span>
          </div>
          <div className="text-lg font-semibold">{formatTTD(d.monthlyRevenue)}</div>
          <div className="mt-2">
            <div className="kf-momentum-bar">
              <div className="kf-momentum-fill" style={{ width: `${d.momentum * 100}%` }} />
            </div>
          </div>
        </div>
        <MetricTile icon={Calendar} color="--kf-info" label="Bookings" value={String(d.todayBookings)} sub={`${d.completedBookingsToday} completed`} />
        <MetricTile icon={CheckCircle2} color="--kf-success" label="Tasks Done" value={String(d.completedToday)} sub={`${d.tasks.length} remaining`} />
      </div>

      <BriefingCard
        businessId={d.businessId}
        initialFinancialPulse={d.financialPulse}
        initialCampaignBriefings={d.campaignBriefings}
      />

      <ProgressSection gamification={d.gamification} momentum={d.momentum} />

      <PriorityQueue
        priorities={d.priorities}
        tasks={d.tasks}
        momentumRecs={d.momentumRecs}
        nudges={d.nudges}
        financialAlerts={d.financialAlerts}
        completedToday={d.completedToday}
        businessId={d.businessId}
        onCompleteTask={d.handleCompleteTask}
        onApproveTask={d.handleApproveTask}
        onDenyTask={d.handleDenyTask}
        onMomentumAction={d.handleMomentumAction}
        onMomentumSnooze={d.handleMomentumSnooze}
        onMomentumDismiss={d.handleMomentumDismiss}
        onNudgeSnooze={d.handleNudgeSnooze}
        onDismissTask={d.handleDismissTask}
        onDismissAlert={d.handleDismissAlert}
        completingTask={d.completingTask}
        momentumActionId={d.momentumActionId}
        dismissingNudge={d.dismissingNudge}
      />
    </div>
  );
}

function MetricTile({ icon: Icon, color, label, value, sub }: {
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="kf-card-metric">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-2">
        <Icon className="w-3.5 h-3.5" style={{ color: `hsl(var(${color}))` }} />
        <span className="kf-text-micro font-medium">{label}</span>
      </div>
      <div className="text-lg font-semibold">{value}</div>
      {sub && <p className="kf-text-micro text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}
