"use client";

import { useState, useRef, useEffect } from "react";
import {
  DollarSign,
  Calendar,
  CheckCircle2,
  MoreHorizontal,
} from "lucide-react";
import { DashboardSkeleton } from "@/components/ui/skeleton";
import { formatTTD } from "./_command/types";
import { useCommandData } from "./_command/use-command-data";
import { QuickActionBar } from "./_command/quick-action-bar";
import { AiCommandBar } from "./_command/ai-command-bar";
import { BriefingCard } from "./_command/briefing-card";
import { PriorityQueue } from "./_command/priority-queue";
import { SimulationDrawer } from "./_command/simulation-drawer";
import { ProgressDrawer } from "./_command/progress-section";

export default function CommandPage() {
  const d = useCommandData();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const handler = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [moreOpen]);

  if (d.loading) return <DashboardSkeleton />;

  return (
    <div className="flex flex-col gap-5 max-w-3xl mx-auto pb-10" aria-label="Today View">
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

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 order-2 sm:order-1">
        <div>
          <h1 className="kf-text-title font-semibold tracking-tight">
            {d.greeting}
            {d.displayName ? `, ${d.displayName}` : ""}
          </h1>
          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            <MetricPill
              icon={DollarSign}
              color="--kf-accent1"
              value={formatTTD(d.todayRevenue)}
              label="today"
            />
            <MetricPill
              icon={Calendar}
              color="--kf-info"
              value={String(d.todayBookings)}
              label={d.todayBookings === 1 ? "booking" : "bookings"}
            />
            <MetricPill
              icon={CheckCircle2}
              color="--kf-success"
              value={String(d.tasks.length)}
              label={d.tasks.length === 1 ? "task" : "tasks"}
            />
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="relative" ref={moreRef}>
            <button
              onClick={() => setMoreOpen((prev) => !prev)}
              className="flex items-center justify-center min-w-[44px] min-h-[44px] kf-radius-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-all"
              aria-label="More options"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {moreOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} />
                <div
                  className="absolute right-0 top-full mt-1 z-50 py-1.5 kf-radius-md shadow-lg"
                  style={{
                    background: "hsl(var(--kf-card))",
                    border: "1px solid hsl(var(--kf-border) / 0.4)",
                  }}
                >
                  <div className="px-2 py-1 flex flex-col gap-1">
                    <SimulationDrawer businessId={d.businessId} />
                    <ProgressDrawer
                      gamification={d.gamification}
                      momentum={d.momentum}
                    />
                  </div>
                  <div
                    className="mx-2 my-1"
                    style={{ borderTop: "1px solid hsl(var(--kf-border) / 0.2)" }}
                  />
                  <div className="px-2 py-1">
                    <AiCommandBar businessId={d.businessId} />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="order-1 sm:order-2">
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
          onDismissPriority={d.handleDismissPriority}
          completingTask={d.completingTask}
          momentumActionId={d.momentumActionId}
          dismissingNudge={d.dismissingNudge}
        />
      </div>

      <div className="order-3">
        <QuickActionBar />
      </div>

      <div className="order-4">
        <BriefingCard
          businessId={d.businessId}
          initialFinancialPulse={d.financialPulse}
          initialCampaignBriefings={d.campaignBriefings}
        />
      </div>
    </div>
  );
}

function MetricPill({
  icon: Icon,
  color,
  value,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  value: string;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon
        className="w-3.5 h-3.5"
        style={{ color: `hsl(var(${color}))` }}
      />
      <span className="text-sm font-semibold">{value}</span>
      <span className="kf-text-micro text-muted-foreground">{label}</span>
    </div>
  );
}
