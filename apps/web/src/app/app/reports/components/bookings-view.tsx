"use client";

import { Calendar, Clock, Users, TrendingUp, AlertTriangle, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { MetricCard, NarrativeSection, CollapsibleSection } from "./shared-components";
import { formatCurrency } from "./report-types";
import type { GeneratedReport } from "@/lib/client";

export function BookingsView({ report }: { report: GeneratedReport }) {
  const d = report.data || {};
  const m = report.metrics;
  const c = report.comparison;
  const totalBookings = d.totalBookings ?? m.bookings.total;
  const completedBookings = d.completedBookings ?? m.bookings.completed;
  const cancelledBookings = d.cancelledBookings ?? m.bookings.cancelled;
  const noShowRate = d.noShowRate ?? 0;
  const avgBookingValue = d.avgBookingValue ?? 0;
  const utilization = d.utilizationRate ?? 0;
  const topServices = d.topServices ?? [];
  const topStaff = d.topStaff ?? [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Link href="/app/bookings">
          <MetricCard
            label="Total Bookings"
            value={String(totalBookings)}
            icon={Calendar}
            color="text-[hsl(var(--kf-info))]"
            subtext={`${completedBookings} completed`}
            trend="up"
            trendPct={c?.bookings.changePct}
            prevValue={c ? c.bookings.total.toString() : undefined}
            explanation="All bookings in this reporting period including confirmed, completed, and cancelled."
          />
        </Link>
        <MetricCard
          label="Utilization Rate"
          value={`${utilization}%`}
          icon={Clock}
          color="text-[hsl(var(--kf-success))]"
          subtext="of available capacity"
          explanation="How much of your available schedule is filled with bookings."
          formula="(Booked Slots / Available Slots) x 100"
          goodValue="70-85% is optimal. Too high means no room for walk-ins."
        />
        <MetricCard
          label="Avg Booking Value"
          value={formatCurrency(avgBookingValue)}
          icon={TrendingUp}
          color="text-[hsl(var(--kf-warning))]"
          explanation="Average revenue per booking based on service pricing."
          formula="Total Booking Revenue / Number of Bookings"
          goodValue="Increasing average shows successful upselling."
        />
        <MetricCard
          label="No-Show Rate"
          value={`${noShowRate}%`}
          icon={AlertTriangle}
          color={noShowRate > 10 ? "text-[hsl(var(--kf-error))]" : "text-[hsl(var(--kf-success))]"}
          subtext={`${cancelledBookings} cancelled`}
          explanation="Percentage of bookings where the client didn't show up."
          formula="(No-Shows / Total Bookings) x 100"
          goodValue="Below 5% is excellent. Above 10% consider reminder automations."
          trend={noShowRate > 10 ? "down" : "up"}
        />
      </div>

      {(report.aiNarrative || report.narrative) && (
        <CollapsibleSection title="AI Booking Analysis" icon={CheckCircle2} defaultOpen>
          <NarrativeSection content={report.aiNarrative} narrative={report.narrative} />
        </CollapsibleSection>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <CollapsibleSection title="Top Services by Bookings" icon={CheckCircle2} defaultOpen>
          {topServices.length > 0 ? (
            <div className="space-y-2">
              {topServices.slice(0, 5).map((svc: { name: string; count: number; revenue: number }, i: number) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-border/20 last:border-0">
                  <div>
                    <span className="text-sm font-medium">{svc.name}</span>
                    <span className="text-xs text-muted-foreground ml-2">{svc.count} bookings</span>
                  </div>
                  <span className="text-sm font-semibold" style={{ color: "hsl(var(--kf-accent1))" }}>
                    {formatCurrency(svc.revenue)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No booking data for this period.</p>
          )}
        </CollapsibleSection>

        <CollapsibleSection title="Staff Performance" icon={Users} defaultOpen>
          {topStaff.length > 0 ? (
            <div className="space-y-2">
              {topStaff.slice(0, 5).map((st: { name: string; bookings: number; completionRate: number }, i: number) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-border/20 last:border-0">
                  <div>
                    <span className="text-sm font-medium">{st.name}</span>
                    <span className="text-xs text-muted-foreground ml-2">{st.bookings} bookings</span>
                  </div>
                  <span className="text-xs font-medium" style={{ color: "hsl(var(--kf-success))" }}>
                    {st.completionRate}% completed
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No staff data for this period.</p>
          )}
        </CollapsibleSection>
      </div>

      <div className="kf-card p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Take Action</h3>
          <Link
            href="/app/bookings"
            className="text-xs font-medium transition-colors hover:opacity-80 min-h-[44px] inline-flex items-center"
            style={{ color: "hsl(var(--kf-accent1))" }}
          >
            Open Bookings →
          </Link>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          View your schedule, manage upcoming bookings, and optimize capacity.
        </p>
      </div>
    </div>
  );
}
