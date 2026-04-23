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
  ExternalLink,
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
      link: "/app/commerce",
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
      className="space-y-4"
    >
      <Link
        href="/app/reports?tab=bookings"
        className="kf-card p-2.5 flex items-center justify-between gap-3 transition-all hover:border-[hsl(var(--kf-accent1)_/_0.4)]"
      >
        <div className="flex items-center gap-2">
          <BarChart3 className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
          <span className="text-xs font-medium">Full Bookings Report</span>
          <span className="text-[10px] text-muted-foreground hidden sm:inline">— trends, charts & AI insights</span>
        </div>
        <ArrowUpRight className="w-3 h-3 text-muted-foreground" />
      </Link>

      <motion.div variants={stagger.item} className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {kpiCards.map((card) => {
          const inner = (
            <div className="kf-card rounded-xl px-3 py-2 flex items-center gap-2">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: `hsl(${card.accent} / 0.12)` }}
              >
                <card.icon className="w-3.5 h-3.5" style={{ color: `hsl(${card.accent})` }} />
              </div>
              <div className="min-w-0">
                <p className="text-[9px] text-muted-foreground uppercase tracking-wider leading-none mb-0.5">
                  {card.label}
                </p>
                <p className="text-base font-bold leading-none truncate">{card.value}</p>
              </div>
              {card.link && (
                <ExternalLink className="w-2.5 h-2.5 text-muted-foreground/40 ml-auto shrink-0" />
              )}
            </div>
          );
          return (
            <MetricExplainer key={card.label} label={card.label} explanation={card.explanation} formula={card.formula} goodValue={card.goodValue}>
              {card.link ? (
                <Link href={card.link} className="block transition-all hover:ring-1 hover:ring-[hsl(var(--kf-accent1)/0.2)] rounded-xl">
                  {inner}
                </Link>
              ) : inner}
            </MetricExplainer>
          );
        })}
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <motion.div variants={stagger.item} className="kf-card rounded-xl p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent2))" }} />
              <h3 className="text-xs font-semibold">Weekly Utilization</h3>
            </div>
            {scheduleHealth && (
              <span className="text-[9px] text-muted-foreground">
                Avg {scheduleHealth.utilizationRate}%
              </span>
            )}
          </div>
          {weeklyUtilization.length > 0 ? (
            <div className="flex items-end gap-1.5 h-24">
              {weeklyUtilization.map((day, i) => {
                const rate = day.utilizationRate ?? 0;
                const barColor = rate >= 70 ? "var(--kf-success)" : rate >= 40 ? "var(--kf-warning)" : "var(--kf-error)";
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
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
            <div className="h-24 flex items-center justify-center">
              <p className="text-[11px] text-muted-foreground">No utilization data yet</p>
            </div>
          )}
        </motion.div>

        <motion.div variants={stagger.item} className="kf-card rounded-xl p-3 space-y-2.5">
          <div className="flex items-center gap-2">
            <XCircle className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-error))" }} />
            <h3 className="text-xs font-semibold">Status Breakdown</h3>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center p-2 rounded-lg" style={{ background: "hsl(var(--kf-error) / 0.06)" }}>
              <p className="text-xl font-bold leading-none" style={{ color: "hsl(var(--kf-error))" }}>{cancellationRate}%</p>
              <p className="text-[9px] text-muted-foreground mt-1">Cancelled</p>
            </div>
            <div className="text-center p-2 rounded-lg" style={{ background: "hsl(var(--kf-warning) / 0.06)" }}>
              <p className="text-xl font-bold leading-none" style={{ color: "hsl(var(--kf-warning))" }}>{pendingCount}</p>
              <p className="text-[9px] text-muted-foreground mt-1">Pending</p>
            </div>
            <div className="text-center p-2 rounded-lg" style={{ background: "hsl(var(--kf-success) / 0.06)" }}>
              <p className="text-xl font-bold leading-none" style={{ color: "hsl(var(--kf-success))" }}>{completionRate}%</p>
              <p className="text-[9px] text-muted-foreground mt-1">Completed</p>
            </div>
          </div>
          {cancellationRate > 20 && (
            <div className="flex items-start gap-2 p-2 rounded-lg" style={{ background: "hsl(var(--kf-warning) / 0.06)" }}>
              <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" style={{ color: "hsl(var(--kf-warning))" }} />
              <p className="text-[10px] text-muted-foreground">
                High cancellation rate. Consider sending confirmations closer to appointment time.
              </p>
            </div>
          )}
        </motion.div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <motion.div variants={stagger.item} className="kf-card rounded-xl p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Briefcase className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
              <h3 className="text-xs font-semibold">Service Demand</h3>
              <span className="text-[9px] text-muted-foreground">This month</span>
            </div>
            <Link
              href="/app/store?tab=products"
              className="text-[9px] flex items-center gap-0.5 transition-colors hover:underline"
              style={{ color: "hsl(var(--kf-accent2))" }}
            >
              Store <ExternalLink className="w-2.5 h-2.5" />
            </Link>
          </div>
          {serviceDemand.length > 0 ? (
            <div className="space-y-1.5">
              {serviceDemand.slice(0, 6).map(({ service, count }) => {
                const maxCount = serviceDemand[0]?.count || 1;
                const pct = Math.round((count / maxCount) * 100);
                return (
                  <div key={service.id} className="space-y-0.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium truncate">{service.name}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] text-muted-foreground">{formatAmount(service.price)}</span>
                        <span className="text-[11px] font-semibold tabular-nums" style={{ color: "hsl(var(--kf-accent1))" }}>{count}</span>
                      </div>
                    </div>
                    <div className="h-1 rounded-full overflow-hidden" style={{ background: "hsl(var(--muted) / 0.3)" }}>
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
            <p className="text-[11px] text-muted-foreground py-3 text-center">No bookings this month yet</p>
          )}
        </motion.div>

        <motion.div variants={stagger.item} className="kf-card rounded-xl p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent2))" }} />
              <h3 className="text-xs font-semibold">Staff Load</h3>
              <span className="text-[9px] text-muted-foreground">This week</span>
            </div>
          </div>
          {staffLoad.length > 0 ? (
            <div className="space-y-1">
              {staffLoad.map(({ staff: s, count }) => (
                <div key={s.id} className="flex items-center gap-2.5 p-1.5 rounded-lg hover:bg-muted/10 transition-colors">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0"
                    style={{
                      background: "hsl(var(--kf-accent2) / 0.1)",
                      color: "hsl(var(--kf-accent2))",
                    }}
                  >
                    {s.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-[11px] font-medium truncate flex-1">{s.name}</span>
                  <span className="text-[11px] font-semibold tabular-nums">{count}</span>
                  {count >= 8 && (
                    <span
                      className="text-[9px] px-1 py-0.5 rounded-full font-medium"
                      style={{ background: "hsl(var(--kf-warning) / 0.1)", color: "hsl(var(--kf-warning))" }}
                    >
                      Heavy
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground py-3 text-center">No staff assigned yet</p>
          )}
        </motion.div>
      </div>

      {(promos.length > 0 || rebookings.length > 0 || recommendations.length > 0) && (
        <motion.div variants={stagger.item} className="kf-card rounded-xl p-3 space-y-3">
          <div className="flex items-center gap-2">
            <Zap className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
            <h3 className="text-xs font-semibold">Insights & Actions</h3>
            <AiBadge label="AI" compact />
          </div>

          {promos.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Underbooked Days</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {promos.slice(0, 4).map((p, i) => (
                  <div
                    key={i}
                    className="p-2.5 rounded-lg space-y-1.5"
                    style={{ background: "hsl(var(--kf-info) / 0.04)", borderWidth: 1, borderColor: "hsl(var(--kf-info) / 0.1)" }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold">{p.dayOfWeek}</span>
                      <span className="text-[9px] font-medium" style={{ color: "hsl(var(--kf-warning))" }}>
                        {p.emptySlots} open
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground line-clamp-2">{p.suggestion}</p>
                    <div className="flex items-center gap-2">
                      <button
                        className="text-[9px] px-1.5 py-0.5 rounded-md font-medium transition-colors hover:opacity-80"
                        style={{ background: "hsl(var(--kf-accent1) / 0.1)", color: "hsl(var(--kf-accent1))" }}
                      >
                        Send Offer
                      </button>
                      <span className="text-[9px] text-muted-foreground">{p.targetClientCount} clients</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {rebookings.length > 0 && (
            <div className="space-y-1.5">
              {promos.length > 0 && <div className="border-t border-border/30" />}
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Rebooking Opportunities</p>
              <div className="space-y-1">
                {rebookings.slice(0, 4).map((r, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-muted/10 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium">{r.contactName}</p>
                      <p className="text-[9px] text-muted-foreground">
                        Last: {r.lastServiceName} · {r.averageIntervalDays}d avg
                      </p>
                    </div>
                    <button
                      className="text-[9px] px-1.5 py-0.5 rounded-md font-medium shrink-0 transition-colors hover:opacity-80"
                      style={{ background: "hsl(var(--kf-accent2) / 0.1)", color: "hsl(var(--kf-accent2))" }}
                    >
                      Rebook
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {recommendations.length > 0 && (
            <div className="space-y-1.5">
              {(promos.length > 0 || rebookings.length > 0) && <div className="border-t border-border/30" />}
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">AI Recommendations</p>
              <div className="space-y-1">
                {recommendations.slice(0, 5).map((r, i) => (
                  <div key={i} className="flex items-start gap-2 p-1.5 rounded-lg hover:bg-muted/10 transition-colors">
                    <TrendingUp className="w-3 h-3 shrink-0 mt-0.5" style={{ color: "hsl(var(--kf-accent2))" }} />
                    <p className="text-[11px] text-muted-foreground">{r}</p>
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
