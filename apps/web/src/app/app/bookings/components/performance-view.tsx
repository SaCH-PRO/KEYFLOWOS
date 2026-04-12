"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  BarChart3,
  CalendarDays,
  CheckCircle2,
  DollarSign,
  Activity,
  ArrowUpRight,
  TrendingUp,
  Users,
  XCircle,
  Zap,
  Briefcase,
  AlertTriangle,
} from "lucide-react";
import { formatAmount } from "../../commerce/utils/commerce-utils";
import Link from "next/link";
import type { Booking, Service, BookingStats, StaffMember } from "@/lib/client";
import type { ScheduleHealth } from "@/lib/client";
import { MetricExplainer } from "@/components/ui/metric-explainer";
import { AiBadge } from "@/components/ui/ai-badge";

interface PerformanceViewProps {
  bookings: Booking[];
  services: Service[];
  staff: StaffMember[];
  stats: BookingStats | null;
  scheduleHealth?: ScheduleHealth | null;
}

const stagger = {
  container: { hidden: {}, visible: { transition: { staggerChildren: 0.05 } } },
  item: {
    hidden: { opacity: 0, y: 8 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
  },
};

export default function PerformanceView({
  bookings,
  services,
  staff,
  stats,
  scheduleHealth,
}: PerformanceViewProps) {
  const completionRate = useMemo(() => {
    const completed = bookings.filter((b) => b.status === "COMPLETED").length;
    return bookings.length > 0 ? Math.round((completed / bookings.length) * 100) : 0;
  }, [bookings]);

  const cancellationRate = useMemo(() => {
    const cancelled = bookings.filter((b) => b.status === "CANCELLED").length;
    return bookings.length > 0 ? Math.round((cancelled / bookings.length) * 100) : 0;
  }, [bookings]);

  const totalRevenue = useMemo(() => {
    return bookings
      .filter((b) => b.status === "CONFIRMED" || b.status === "COMPLETED")
      .reduce((sum, b) => sum + (b.service?.price ?? 0), 0);
  }, [bookings]);

  const pendingCount = useMemo(() => bookings.filter((b) => b.status === "PENDING").length, [bookings]);

  const kpiCards = [
    {
      label: "This Week",
      value: stats?.weekCount ?? 0,
      icon: CalendarDays,
      accent: "var(--kf-accent1)",
      explanation: "Number of bookings scheduled for the current week.",
      goodValue: "Compare weekly to spot seasonal patterns.",
    },
    {
      label: "Completion",
      value: `${completionRate}%`,
      icon: CheckCircle2,
      accent: "var(--kf-success)",
      explanation: "Percentage of bookings that were completed (not cancelled or no-show).",
      formula: "(Completed Bookings / Total Bookings) x 100",
      goodValue: "Above 85% is excellent; below 70% may indicate overbooking or scheduling issues.",
    },
    {
      label: "Revenue",
      value: formatAmount(totalRevenue),
      icon: DollarSign,
      accent: "var(--kf-accent2)",
      explanation: "Total revenue from confirmed and completed bookings based on service pricing.",
      formula: "Sum of service prices for confirmed + completed bookings",
      goodValue: "Track month-over-month to gauge growth.",
    },
    {
      label: "Utilization",
      value: scheduleHealth ? `${scheduleHealth.utilizationRate}%` : "\u2014",
      icon: Activity,
      accent: "var(--kf-info)",
      explanation: "How much of your available schedule is filled with bookings.",
      formula: "(Booked Slots / Available Slots) x 100",
      goodValue: "70-85% is optimal. Above 90% may mean you need more availability.",
    },
  ];

  const weeklyUtilization = scheduleHealth?.weeklyUtilization ?? [];
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const serviceDemand = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const map = new Map<string, number>();
    bookings.forEach((b) => {
      if (b.serviceId && new Date(b.startTime) >= monthStart) {
        map.set(b.serviceId, (map.get(b.serviceId) ?? 0) + 1);
      }
    });
    return services
      .map((s) => ({ service: s, count: map.get(s.id) ?? 0 }))
      .sort((a, b) => b.count - a.count);
  }, [bookings, services]);

  const staffLoad = useMemo(() => {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const map = new Map<string, number>();
    bookings.forEach((b) => {
      const bDate = new Date(b.startTime);
      if (b.staff?.id && bDate >= weekStart && bDate < weekEnd && b.status !== "CANCELLED") {
        map.set(b.staff.id, (map.get(b.staff.id) ?? 0) + 1);
      }
    });
    return staff
      .map((s) => ({ staff: s, count: map.get(s.id) ?? 0 }))
      .sort((a, b) => b.count - a.count);
  }, [bookings, staff]);

  const promos = scheduleHealth?.promotionSuggestions ?? [];
  const rebookings = scheduleHealth?.rebookingSuggestions ?? [];
  const recommendations = scheduleHealth?.recommendations ?? [];

  return (
    <motion.div
      variants={stagger.container}
      initial="hidden"
      animate="visible"
      className="space-y-5"
    >
      <Link
        href="/app/reports?tab=bookings"
        className="kf-card p-3 flex items-center justify-between gap-3 transition-all hover:border-[hsl(var(--kf-accent1)_/_0.4)]"
      >
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          <span className="text-xs font-medium">View Full Bookings Report</span>
          <span className="text-xs text-muted-foreground">\u2014 trends, charts &amp; AI insights</span>
        </div>
        <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground" />
      </Link>

      <motion.div variants={stagger.item} className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {kpiCards.map((card) => (
          <MetricExplainer key={card.label} label={card.label} explanation={card.explanation} formula={card.formula} goodValue={card.goodValue}>
            <div className="kf-card rounded-xl px-3 py-2.5 flex items-center gap-2.5">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: `hsl(${card.accent} / 0.12)` }}
              >
                <card.icon className="w-4 h-4" style={{ color: `hsl(${card.accent})` }} />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  {card.label}
                </p>
                <p className="text-lg font-bold truncate">{card.value}</p>
              </div>
            </div>
          </MetricExplainer>
        ))}
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <motion.div variants={stagger.item} className="kf-card rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
              <h3 className="text-sm font-semibold">Weekly Utilization</h3>
            </div>
            {scheduleHealth && (
              <span className="text-[10px] text-muted-foreground">
                Avg {scheduleHealth.utilizationRate}%
              </span>
            )}
          </div>
          {weeklyUtilization.length > 0 ? (
            <div className="flex items-end gap-1.5 h-28">
              {weeklyUtilization.map((day, i) => {
                const rate = day.utilizationRate ?? 0;
                const barColor = rate >= 70 ? "var(--kf-success)" : rate >= 40 ? "var(--kf-warning)" : "var(--kf-error)";
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full relative rounded-t-md overflow-hidden" style={{ height: "100%" }}>
                      <div
                        className="absolute bottom-0 left-0 right-0 rounded-t-md transition-all duration-500"
                        style={{
                          height: `${Math.max(rate, 4)}%`,
                          background: `hsl(${barColor} / 0.6)`,
                          borderWidth: 1,
                          borderColor: `hsl(${barColor} / 0.3)`,
                          borderBottom: "none",
                        }}
                      />
                    </div>
                    <span className="text-[9px] text-muted-foreground font-medium">{dayNames[i]}</span>
                    <span className="text-[9px] font-semibold" style={{ color: `hsl(${barColor})` }}>{rate}%</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="h-28 flex items-center justify-center">
              <p className="text-xs text-muted-foreground">No utilization data available yet</p>
            </div>
          )}
        </motion.div>

        <motion.div variants={stagger.item} className="kf-card rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <XCircle className="w-4 h-4" style={{ color: "hsl(var(--kf-error))" }} />
            <h3 className="text-sm font-semibold">Cancellation & Status</h3>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center p-3 rounded-lg" style={{ background: "hsl(var(--kf-error) / 0.06)" }}>
              <p className="text-2xl font-bold" style={{ color: "hsl(var(--kf-error))" }}>{cancellationRate}%</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Cancelled</p>
            </div>
            <div className="text-center p-3 rounded-lg" style={{ background: "hsl(var(--kf-warning) / 0.06)" }}>
              <p className="text-2xl font-bold" style={{ color: "hsl(var(--kf-warning))" }}>{pendingCount}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Pending</p>
            </div>
            <div className="text-center p-3 rounded-lg" style={{ background: "hsl(var(--kf-success) / 0.06)" }}>
              <p className="text-2xl font-bold" style={{ color: "hsl(var(--kf-success))" }}>{completionRate}%</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Completed</p>
            </div>
          </div>
          {cancellationRate > 20 && (
            <div className="flex items-start gap-2 p-2 rounded-lg" style={{ background: "hsl(var(--kf-warning) / 0.06)" }}>
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "hsl(var(--kf-warning))" }} />
              <p className="text-[11px] text-muted-foreground">
                Cancellation rate is above 20%. Consider sending confirmations closer to appointment time.
              </p>
            </div>
          )}
        </motion.div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <motion.div variants={stagger.item} className="kf-card rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Briefcase className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            <h3 className="text-sm font-semibold">Service Demand</h3>
            <span className="text-[10px] text-muted-foreground">This month</span>
          </div>
          {serviceDemand.length > 0 ? (
            <div className="space-y-2">
              {serviceDemand.slice(0, 6).map(({ service, count }) => {
                const maxCount = serviceDemand[0]?.count || 1;
                const pct = Math.round((count / maxCount) * 100);
                return (
                  <div key={service.id} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium truncate">{service.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground">{formatAmount(service.price)}</span>
                        <span className="text-xs font-semibold" style={{ color: "hsl(var(--kf-accent1))" }}>{count}</span>
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "hsl(var(--muted) / 0.3)" }}>
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, background: "hsl(var(--kf-accent1) / 0.6)" }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground py-4 text-center">No bookings this month yet</p>
          )}
        </motion.div>

        <motion.div variants={stagger.item} className="kf-card rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
            <h3 className="text-sm font-semibold">Staff Load</h3>
            <span className="text-[10px] text-muted-foreground">This week</span>
          </div>
          {staffLoad.length > 0 ? (
            <div className="space-y-2">
              {staffLoad.map(({ staff: s, count }) => (
                <div key={s.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/10 transition-colors">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                    style={{
                      background: "hsl(var(--kf-accent2) / 0.1)",
                      color: "hsl(var(--kf-accent2))",
                    }}
                  >
                    {s.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{s.name}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold">{count}</span>
                    <span className="text-[10px] text-muted-foreground">bookings</span>
                    {count >= 8 && (
                      <span
                        className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
                        style={{ background: "hsl(var(--kf-warning) / 0.1)", color: "hsl(var(--kf-warning))" }}
                      >
                        Heavy
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground py-4 text-center">No staff assigned to bookings yet</p>
          )}
        </motion.div>
      </div>

      {(promos.length > 0 || rebookings.length > 0 || recommendations.length > 0) && (
        <motion.div variants={stagger.item} className="kf-card rounded-xl p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            <h3 className="text-sm font-semibold">Insights & Actions</h3>
            <AiBadge label="AI" compact />
          </div>

          {promos.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Underbooked Days</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {promos.slice(0, 4).map((p, i) => (
                  <div
                    key={i}
                    className="p-3 rounded-lg space-y-2"
                    style={{ background: "hsl(var(--kf-info) / 0.04)", borderWidth: 1, borderColor: "hsl(var(--kf-info) / 0.1)" }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold">{p.dayOfWeek}</span>
                      <span className="text-[10px] font-medium" style={{ color: "hsl(var(--kf-warning))" }}>
                        {p.emptySlots} open slot{p.emptySlots !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground line-clamp-2">{p.suggestion}</p>
                    <div className="flex items-center gap-2">
                      <span
                        className="text-[9px] px-2 py-1 rounded-md font-medium cursor-pointer transition-colors hover:opacity-80"
                        style={{ background: "hsl(var(--kf-accent1) / 0.1)", color: "hsl(var(--kf-accent1))" }}
                      >
                        Send Offer
                      </span>
                      <span className="text-[9px] text-muted-foreground">{p.targetClientCount} potential clients</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {rebookings.length > 0 && (
            <div className="space-y-2">
              {promos.length > 0 && <div className="border-t border-border/30" />}
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Rebooking Opportunities</p>
              <div className="space-y-1.5">
                {rebookings.slice(0, 4).map((r, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/10 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium">{r.contactName}</p>
                      <p className="text-[10px] text-muted-foreground">
                        Last: {r.lastServiceName} \u00b7 Avg interval: {r.averageIntervalDays}d
                      </p>
                    </div>
                    <span
                      className="text-[10px] px-2 py-1 rounded-md font-medium cursor-pointer shrink-0 transition-colors hover:opacity-80"
                      style={{ background: "hsl(var(--kf-accent2) / 0.1)", color: "hsl(var(--kf-accent2))" }}
                    >
                      Rebook
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {recommendations.length > 0 && (
            <div className="space-y-2">
              {(promos.length > 0 || rebookings.length > 0) && <div className="border-t border-border/30" />}
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">AI Recommendations</p>
              <div className="space-y-1.5">
                {recommendations.slice(0, 5).map((r, i) => (
                  <div key={i} className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-muted/10 transition-colors">
                    <TrendingUp className="w-3 h-3 shrink-0 mt-0.5" style={{ color: "hsl(var(--kf-accent2))" }} />
                    <p className="text-xs text-muted-foreground">{r}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}
