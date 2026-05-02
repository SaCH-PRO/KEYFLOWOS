"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  BarChart3,
  Clock,
  TrendingUp,
  CalendarDays,
  CheckCircle2,
  DollarSign,
  Users,
  AlertCircle,
  Activity,
  ShieldAlert,
  Lightbulb,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
  Megaphone,
} from "lucide-react";
import { formatAmount } from "../../commerce/utils/commerce-utils";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import type { Booking, Service, BookingStats, ScheduleHealth } from "@/lib/client";

interface BookingsInsightsTabProps {
  bookings: Booking[];
  services: Service[];
  stats: BookingStats | null;
  scheduleHealth?: ScheduleHealth | null;
}

const stagger = {
  container: { hidden: {}, visible: { transition: { staggerChildren: 0.06 } } },
  item: {
    hidden: { opacity: 0, y: 8 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.35 } },
  },
};

const RECHARTS_TOOLTIP_STYLE = {
  contentStyle: {
    background: "hsl(var(--popover))",
    border: "1px solid hsl(var(--border)/0.5)",
    borderRadius: "0.75rem",
    color: "hsl(var(--foreground))",
    fontSize: "11px",
    padding: "6px 10px",
  },
  cursor: { fill: "hsl(var(--border)/0.1)" },
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: "#f59e0b",
  CONFIRMED: "#3b82f6",
  COMPLETED: "#10b981",
  CANCELLED: "#ef4444",
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export default function BookingsInsightsTab({ bookings, services, stats, scheduleHealth }: BookingsInsightsTabProps) {
  const dailyVolume = useMemo(() => {
    const map = new Map<string, number>();
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
      map.set(key, 0);
    }
    bookings.forEach((b) => {
      const d = new Date(b.startTime);
      const key = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
      if (map.has(key)) map.set(key, (map.get(key) ?? 0) + 1);
    });
    return Array.from(map, ([day, count]) => ({ day, count }));
  }, [bookings]);

  const topServices = useMemo(() => {
    const map = new Map<string, { name: string; count: number; revenue: number }>();
    bookings.forEach((b) => {
      if (!b.service) return;
      const existing = map.get(b.service.id) ?? { name: b.service.name, count: 0, revenue: 0 };
      existing.count += 1;
      existing.revenue += b.service.price ?? 0;
      map.set(b.service.id, existing);
    });
    return Array.from(map.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 6);
  }, [bookings]);

  const peakHours = useMemo(() => {
    const hours = Array.from({ length: 12 }, (_, i) => ({
      hour: `${(i + 8) % 12 || 12}${i + 8 < 12 ? "am" : "pm"}`,
      count: 0,
    }));
    bookings.forEach((b) => {
      const h = new Date(b.startTime).getHours();
      const idx = h - 8;
      if (idx >= 0 && idx < 12) hours[idx].count += 1;
    });
    return hours;
  }, [bookings]);

  const statusBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    bookings.forEach((b) => {
      counts[b.status] = (counts[b.status] ?? 0) + 1;
    });
    return Object.entries(counts).map(([status, value]) => ({
      name: STATUS_LABELS[status] ?? status,
      value,
      color: STATUS_COLORS[status] ?? "#6b7280",
    }));
  }, [bookings]);

  const upcomingCount = useMemo(() => {
    const now = new Date();
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() + 7);
    return bookings.filter((b) => {
      const d = new Date(b.startTime);
      return d >= now && d <= weekEnd && (b.status === "PENDING" || b.status === "CONFIRMED");
    }).length;
  }, [bookings]);

  const totalRevenue = useMemo(() => {
    return bookings
      .filter((b) => b.status === "CONFIRMED" || b.status === "COMPLETED")
      .reduce((sum, b) => sum + (b.service?.price ?? 0), 0);
  }, [bookings]);

  const completionRate = useMemo(() => {
    const completed = bookings.filter((b) => b.status === "COMPLETED").length;
    return bookings.length > 0 ? Math.round((completed / bookings.length) * 100) : 0;
  }, [bookings]);

  const kpiCards = [
    {
      label: "This Week",
      value: stats?.weekCount ?? upcomingCount,
      icon: CalendarDays,
      color: "from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent1))]",
      bg: "from-[hsl(var(--kf-accent1)/0.15)] to-[hsl(var(--kf-accent1)/0.05)]",
    },
    {
      label: "Completion Rate",
      value: `${completionRate}%`,
      icon: CheckCircle2,
      color: "from-emerald-500 to-green-600",
      bg: "from-emerald-500/15 to-emerald-600/5",
    },
    {
      label: "Revenue",
      value: formatAmount(totalRevenue),
      icon: DollarSign,
      color: "from-[hsl(var(--kf-accent2))] to-[hsl(var(--kf-accent2))]",
      bg: "from-[hsl(var(--kf-accent2)/0.15)] to-[hsl(var(--kf-accent2)/0.05)]",
    },
    {
      label: "Pending",
      value: stats?.pendingCount ?? bookings.filter((b) => b.status === "PENDING").length,
      icon: AlertCircle,
      color: "from-amber-500 to-orange-600",
      bg: "from-amber-500/15 to-amber-600/5",
    },
  ];

  return (
    <motion.div
      variants={stagger.container}
      initial="hidden"
      animate="visible"
      className="space-y-5"
    >
      <motion.div variants={stagger.item} className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpiCards.map((card) => (
          <div
            key={card.label}
            className={`rounded-2xl border border-border/60 bg-card/80 backdrop-blur-sm bg-gradient-to-br ${card.bg} p-4 flex items-start gap-3`}
          >
            <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${card.color} flex items-center justify-center shrink-0`}>
              <card.icon className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">{card.label}</p>
              <p className="text-xl font-bold truncate">{card.value}</p>
            </div>
          </div>
        ))}
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <motion.div
          variants={stagger.item}
          className="lg:col-span-3 kf-card p-4 space-y-3"
        >
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            <h3 className="text-sm font-semibold">Booking Volume (7 Days)</h3>
          </div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyVolume} barSize={24}>
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip {...RECHARTS_TOOLTIP_STYLE} />
                <Bar dataKey="count" fill="hsl(var(--kf-accent1))" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        <motion.div
          variants={stagger.item}
          className="lg:col-span-2 kf-card p-4 space-y-3"
        >
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Status Breakdown</h3>
          </div>
          {statusBreakdown.length > 0 ? (
            <>
              <div className="h-36 flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusBreakdown}
                      cx="50%"
                      cy="50%"
                      innerRadius={35}
                      outerRadius={55}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {statusBreakdown.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip {...RECHARTS_TOOLTIP_STYLE} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center">
                {statusBreakdown.map((s) => (
                  <div key={s.name} className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                    <span className="text-[10px] text-muted-foreground">{s.name} ({s.value})</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-36 flex items-center justify-center text-xs text-muted-foreground">
              No booking data yet
            </div>
          )}
        </motion.div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <motion.div variants={stagger.item} className="kf-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold">Top Services by Revenue</h3>
          </div>
          {topServices.length > 0 ? (
            <div className="space-y-2">
              {topServices.map((svc, i) => {
                const maxRevenue = topServices[0]?.revenue || 1;
                return (
                  <div key={i} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium truncate">{svc.name}</span>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{svc.count} bookings</span>
                        <span className="font-medium text-emerald-400">
                          {formatAmount(svc.revenue)}
                        </span>
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${(svc.revenue / maxRevenue) * 100}%` }}
                        transition={{ duration: 0.5, delay: i * 0.1 }}
                        className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-green-400"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-6 text-center text-xs text-muted-foreground">
              No service data yet
            </div>
          )}
        </motion.div>

        <motion.div variants={stagger.item} className="kf-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-semibold">Peak Hours</h3>
          </div>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={peakHours} barSize={16}>
                <XAxis
                  dataKey="hour"
                  tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip {...RECHARTS_TOOLTIP_STYLE} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {peakHours.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={entry.count > 0 ? `hsl(var(--kf-accent2))` : "hsl(var(--border)/0.3)"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      </div>

      <motion.div variants={stagger.item} className="kf-card p-4">
        <div className="flex items-center gap-2 mb-3">
          <CalendarDays className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          <h3 className="text-sm font-semibold">Upcoming Schedule Summary</h3>
        </div>
        {(() => {
          const now = new Date();
          const upcoming = bookings
            .filter((b) => new Date(b.startTime) >= now && (b.status === "PENDING" || b.status === "CONFIRMED"))
            .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
            .slice(0, 8);

          if (upcoming.length === 0) {
            return (
              <p className="text-xs text-muted-foreground text-center py-4">
                No upcoming bookings scheduled
              </p>
            );
          }

          return (
            <div className="space-y-1.5">
              {upcoming.map((b) => {
                const start = new Date(b.startTime);
                return (
                  <div
                    key={b.id}
                    className="flex items-center gap-3 p-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] transition-colors"
                  >
                    <div
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        b.status === "CONFIRMED" ? "bg-blue-400" : "bg-amber-400"
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium truncate block">
                        {b.service?.name ?? "Service"}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {b.staff?.name ?? "Unassigned"}
                        {b.contact
                          ? ` · ${[b.contact.firstName, b.contact.lastName].filter(Boolean).join(" ") || "Walk-in"}`
                          : ""}
                      </span>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-[11px] font-medium block">
                        {start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </motion.div>

      {scheduleHealth && (
        <>
          <motion.div variants={stagger.item}>
            <div className="flex items-center gap-2 mt-2 mb-3">
              <Activity className="w-4 h-4 text-violet-400" />
              <h3 className="text-base font-semibold">Schedule Health</h3>
            </div>
          </motion.div>

          <motion.div variants={stagger.item} className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-2xl border border-border/60 bg-card/80 backdrop-blur-sm bg-gradient-to-br from-violet-500/15 to-violet-600/5 p-4 flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shrink-0">
                <Activity className="w-4 h-4 text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Utilization</p>
                <p className="text-xl font-bold">{scheduleHealth.utilizationRate}%</p>
              </div>
            </div>
            <div className="rounded-2xl border border-border/60 bg-card/80 backdrop-blur-sm bg-gradient-to-br from-red-500/15 to-red-600/5 p-4 flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-4 h-4 text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Cancellation Rate</p>
                <div className="flex items-center gap-1.5">
                  <p className="text-xl font-bold">{scheduleHealth.noShowRate}%</p>
                  {scheduleHealth.noShowTrend !== 0 && (
                    <span className={`flex items-center text-[10px] ${scheduleHealth.noShowTrend > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                      {scheduleHealth.noShowTrend > 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                      {Math.abs(scheduleHealth.noShowTrend)}%
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-border/60 bg-card/80 backdrop-blur-sm bg-gradient-to-br from-emerald-500/15 to-emerald-600/5 p-4 flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center shrink-0">
                <DollarSign className="w-4 h-4 text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Avg Revenue/Slot</p>
                <p className="text-xl font-bold">{formatAmount(scheduleHealth.avgRevenuePerSlot)}</p>
              </div>
            </div>
            <div className="rounded-2xl border border-border/60 bg-card/80 backdrop-blur-sm bg-gradient-to-br from-blue-500/15 to-blue-600/5 p-4 flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shrink-0">
                <TrendingUp className="w-4 h-4 text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Peak Day</p>
                <p className="text-xl font-bold truncate">{scheduleHealth.peakDay}</p>
              </div>
            </div>
          </motion.div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <motion.div variants={stagger.item} className="lg:col-span-3 kf-card p-4 space-y-3">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-violet-400" />
                <h3 className="text-sm font-semibold">7-Day Utilization</h3>
              </div>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={scheduleHealth.weeklyUtilization} barSize={24}>
                    <XAxis
                      dataKey="dayOfWeek"
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => v.slice(0, 3)}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      axisLine={false}
                      tickLine={false}
                      domain={[0, 100]}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <Tooltip
                      {...RECHARTS_TOOLTIP_STYLE}
                      formatter={((value: number | string) => [`${value}%`, "Utilization"]) as never}
                    />
                    <Bar dataKey="utilizationRate" radius={[6, 6, 0, 0]}>
                      {scheduleHealth.weeklyUtilization.map((entry, i) => (
                        <Cell
                          key={i}
                          fill={
                            entry.utilizationRate >= 70
                              ? "#10b981"
                              : entry.utilizationRate >= 40
                              ? "#f59e0b"
                              : entry.totalSlots === 0
                              ? "hsl(var(--border)/0.3)"
                              : "#ef4444"
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center gap-4 justify-center text-[10px] text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span>Good (70%+)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-amber-500" />
                  <span>Fair (40-69%)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-red-500" />
                  <span>Low (&lt;40%)</span>
                </div>
              </div>
            </motion.div>

            <motion.div variants={stagger.item} className="lg:col-span-2 kf-card p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-semibold">Recommendations</h3>
              </div>
              {scheduleHealth.recommendations.length > 0 ? (
                <div className="space-y-2">
                  {scheduleHealth.recommendations.map((rec, i) => (
                    <div key={i} className="flex gap-2 p-2 rounded-lg bg-white/[0.02]">
                      <div className="w-5 h-5 rounded-full bg-amber-400/15 text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="text-[9px] font-bold">{i + 1}</span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{rec}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-4">No recommendations at this time</p>
              )}
            </motion.div>
          </div>

          {scheduleHealth.promotionSuggestions.length > 0 && (
            <motion.div variants={stagger.item} className="kf-card p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Megaphone className="w-4 h-4 text-orange-400" />
                <h3 className="text-sm font-semibold">Promotion Opportunities</h3>
              </div>
              <div className="space-y-2">
                {scheduleHealth.promotionSuggestions.map((promo, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-orange-500/5 border border-orange-500/20">
                    <div className="w-8 h-8 rounded-lg bg-orange-500/15 flex items-center justify-center shrink-0">
                      <CalendarDays className="w-4 h-4 text-orange-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium">{promo.dayOfWeek} — {promo.emptySlots} empty slots</p>
                      <p className="text-[10px] text-muted-foreground">{promo.suggestion}</p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {scheduleHealth.noShowRisks.length > 0 && (
            <motion.div variants={stagger.item} className="kf-card p-4 space-y-3">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-red-400" />
                <h3 className="text-sm font-semibold">No-Show Risk Alerts</h3>
              </div>
              <div className="space-y-1.5">
                {scheduleHealth.noShowRisks.slice(0, 5).map((risk) => (
                  <div key={risk.bookingId} className="flex items-center gap-3 p-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${
                      risk.riskLevel === 'HIGH' ? 'bg-red-500' :
                      risk.riskLevel === 'MEDIUM' ? 'bg-amber-500' : 'bg-emerald-500'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium">{risk.contactName}</span>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {risk.factors.map((f, i) => (
                          <span key={i} className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-400">{f}</span>
                        ))}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className={`text-xs font-bold ${
                        risk.riskLevel === 'HIGH' ? 'text-red-400' :
                        risk.riskLevel === 'MEDIUM' ? 'text-amber-400' : 'text-emerald-400'
                      }`}>{risk.riskScore}%</span>
                      <p className="text-[9px] text-muted-foreground">{risk.riskLevel} risk</p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {scheduleHealth.rebookingSuggestions.length > 0 && (
            <motion.div variants={stagger.item} className="kf-card p-4 space-y-3">
              <div className="flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-blue-400" />
                <h3 className="text-sm font-semibold">Rebooking Suggestions</h3>
              </div>
              <div className="space-y-1.5">
                {scheduleHealth.rebookingSuggestions.map((sug, i) => (
                  <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
                    <div className="w-8 h-8 rounded-lg bg-blue-500/15 flex items-center justify-center shrink-0">
                      <RefreshCw className="w-3.5 h-3.5 text-blue-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium">{sug.contactName}</span>
                      <p className="text-[10px] text-muted-foreground">{sug.lastServiceName} — {sug.reason}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-[11px] font-medium block">
                        {new Date(sug.suggestedDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                      <p className="text-[9px] text-muted-foreground">Suggested</p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </>
      )}
    </motion.div>
  );
}
