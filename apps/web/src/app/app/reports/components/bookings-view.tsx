"use client";

import { useState, useMemo } from "react";
import { Calendar, Clock, Users, TrendingUp, AlertTriangle, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { Card } from "@keyflow/ui";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { MetricCard, NarrativeSection, CollapsibleSection } from "./shared-components";
import { formatCurrency } from "./report-types";
import type { GeneratedReport } from "@/lib/client";

type BookingGranularity = "daily" | "weekly" | "monthly";

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
        <Link href="/app/bookings?view=schedule&status=cancelled">
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
        </Link>
      </div>

      <BookingStatusChart report={report} />

      {(report.aiNarrative || report.narrative) && (
        <CollapsibleSection title="AI Booking Analysis" icon={CheckCircle2} defaultOpen persistKey="bk-ai-analysis">
          <NarrativeSection content={report.aiNarrative} narrative={report.narrative} />
        </CollapsibleSection>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <CollapsibleSection title="Top Services by Bookings" icon={CheckCircle2} defaultOpen persistKey="bk-top-services">
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

        <CollapsibleSection title="Staff Performance" icon={Users} defaultOpen persistKey="bk-staff-perf">
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

function aggregateTimeSeries(
  series: Array<{ date: string; completed: number; missed: number; total: number }>,
  granularity: BookingGranularity,
): Array<{ label: string; completed: number; missed: number; total: number }> {
  if (!series || series.length === 0) return [];

  if (granularity === "daily") {
    return series.map((pt) => ({
      label: new Date(pt.date).toLocaleDateString("en-TT", { month: "short", day: "numeric" }),
      completed: pt.completed,
      missed: pt.missed,
      total: pt.total,
    }));
  }

  if (granularity === "weekly") {
    const weeks: Array<{ label: string; completed: number; missed: number; total: number }> = [];
    for (let i = 0; i < series.length; i += 7) {
      const chunk = series.slice(i, i + 7);
      weeks.push({
        label: `Week ${weeks.length + 1}`,
        completed: chunk.reduce((s, p) => s + p.completed, 0),
        missed: chunk.reduce((s, p) => s + p.missed, 0),
        total: chunk.reduce((s, p) => s + p.total, 0),
      });
    }
    return weeks;
  }

  return [{
    label: "This Period",
    completed: series.reduce((s, p) => s + p.completed, 0),
    missed: series.reduce((s, p) => s + p.missed, 0),
    total: series.reduce((s, p) => s + p.total, 0),
  }];
}

function BookingStatusChart({ report }: { report: GeneratedReport }) {
  const [granularity, setGranularity] = useState<BookingGranularity>("weekly");
  const m = report.metrics;
  const c = report.comparison;
  const d = report.data || {};

  const timeSeries = useMemo(() => d.bookingTimeSeries ?? [], [d.bookingTimeSeries]);
  const prevTimeSeries = useMemo(() => d.prevBookingTimeSeries ?? [], [d.prevBookingTimeSeries]);

  const chartData = useMemo(() => {
    const current = aggregateTimeSeries(timeSeries, granularity);
    if (!c || prevTimeSeries.length === 0) return current;

    const prev = aggregateTimeSeries(prevTimeSeries, granularity);
    return current.map((pt, i) => ({
      ...pt,
      prevPeriod: prev[i]?.total ?? 0,
    }));
  }, [granularity, timeSeries, prevTimeSeries, c]);

  if (m.bookings.total === 0 && timeSeries.length === 0) {
    return (
      <CollapsibleSection title="Booking Volume" icon={Calendar} defaultOpen persistKey="bk-volume-chart">
        <Card className="p-6 border-border/60 flex flex-col items-center justify-center gap-2" style={{ background: "hsl(var(--kf-card) / 0.6)" }}>
          <Calendar className="w-8 h-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No booking data for this period</p>
          <p className="text-xs text-muted-foreground/60">Bookings will appear here once scheduled.</p>
        </Card>
      </CollapsibleSection>
    );
  }

  const granularityOptions: { value: BookingGranularity; label: string }[] = [
    { value: "daily", label: "Daily" },
    { value: "weekly", label: "Weekly" },
    { value: "monthly", label: "Monthly" },
  ];

  return (
    <CollapsibleSection title="Booking Volume" icon={Calendar} defaultOpen persistKey="bk-volume-chart">
      <Card className="p-4 border-border/60" style={{ background: "hsl(var(--kf-card) / 0.6)" }}>
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs text-muted-foreground">
            Completed vs missed bookings
            {c && <span className="ml-1" style={{ color: "hsl(var(--kf-accent2))" }}>· with previous period overlay</span>}
          </p>
          <div className="flex gap-1 rounded-md p-0.5" style={{ background: "hsl(var(--kf-muted) / 0.3)" }}>
            {granularityOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setGranularity(opt.value)}
                className={`text-[11px] px-2.5 py-1 rounded min-h-[44px] font-medium transition-colors ${granularity === opt.value ? "shadow-sm" : "hover:opacity-80"}`}
                style={granularity === opt.value
                  ? { background: "hsl(var(--kf-accent2) / 0.2)", color: "hsl(var(--kf-accent2))" }
                  : { color: "hsl(var(--kf-muted-foreground))" }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        {chartData.length === 0 ? (
          <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground">
            No data available for the selected granularity.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData}>
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--kf-muted-foreground))" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--kf-muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: "hsl(var(--kf-popover))", border: "1px solid hsl(var(--kf-border))", borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: "hsl(var(--kf-foreground))" }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="completed" name="Completed" fill="hsl(var(--kf-success))" radius={[4, 4, 0, 0]} />
              <Bar dataKey="missed" name="Missed/No-show" fill="hsl(var(--kf-error))" radius={[4, 4, 0, 0]} />
              {c && <Bar dataKey="prevPeriod" name="Previous Period" fill="hsl(var(--kf-muted-foreground) / 0.3)" radius={[4, 4, 0, 0]} />}
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>
    </CollapsibleSection>
  );
}
