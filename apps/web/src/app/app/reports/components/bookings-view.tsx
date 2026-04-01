"use client";

import { Calendar, Clock, Users, TrendingUp, AlertTriangle, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { MetricCard, NarrativeSection } from "./shared-components";
import { formatCurrency } from "./report-types";
import type { GeneratedReport } from "@/lib/client";

interface BookingsViewProps {
  report: GeneratedReport;
}

export function BookingsView({ report }: BookingsViewProps) {
  const d = report.data || {};
  const totalBookings = d.totalBookings ?? 0;
  const completedBookings = d.completedBookings ?? 0;
  const cancelledBookings = d.cancelledBookings ?? 0;
  const noShowRate = d.noShowRate ?? 0;
  const avgBookingValue = d.avgBookingValue ?? 0;
  const utilization = d.utilizationRate ?? 0;
  const topServices = d.topServices ?? [];
  const topStaff = d.topStaff ?? [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard
          label="Total Bookings"
          value={String(totalBookings)}
          icon={Calendar}
          color="text-blue-400"
          subtext={`${completedBookings} completed`}
          trend="up"
        />
        <MetricCard
          label="Utilization Rate"
          value={`${utilization}%`}
          icon={Clock}
          color="text-emerald-400"
          subtext="of available capacity"
        />
        <MetricCard
          label="Avg Booking Value"
          value={formatCurrency(avgBookingValue)}
          icon={TrendingUp}
          color="text-amber-400"
        />
        <MetricCard
          label="No-Show Rate"
          value={`${noShowRate}%`}
          icon={AlertTriangle}
          color={noShowRate > 10 ? "text-red-400" : "text-emerald-400"}
          subtext={`${cancelledBookings} cancelled`}
          trend={noShowRate > 10 ? "down" : "up"}
        />
      </div>

      {report.narrative && (
        <NarrativeSection title="AI Booking Analysis" narrative={report.narrative} />
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="kf-card p-4 space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            Top Services by Bookings
          </h3>
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
        </div>

        <div className="kf-card p-4 space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Users className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
            Staff Performance
          </h3>
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
        </div>
      </div>

      <div className="kf-card p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Take Action</h3>
          <Link
            href="/app/bookings"
            className="text-xs font-medium transition-colors hover:opacity-80"
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
