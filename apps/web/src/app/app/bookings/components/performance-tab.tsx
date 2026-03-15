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
  Activity,
  ShieldAlert,
  Lightbulb,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
  Megaphone,
  Users,
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
import type { Booking, Service, BookingStats } from "@/lib/client";
import type { ScheduleHealth } from "@/lib/client";

interface PerformanceTabProps {
  bookings: Booking[];
  services: Service[];
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

const PIE_COLORS: Record<string, string> = {
  PENDING: "hsl(var(--kf-warning))",
  CONFIRMED: "hsl(var(--kf-info))",
  COMPLETED: "hsl(var(--kf-success))",
  CANCELLED: "hsl(var(--kf-error))",
};

const PIE_LABELS: Record<string, string> = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export default function PerformanceTab({
  bookings,
  services,
  stats,
  scheduleHealth,
}: PerformanceTabProps) {
  const completionRate = useMemo(() => {
    const completed = bookings.filter((b) => b.status === "COMPLETED").length;
    return bookings.length > 0 ? Math.round((completed / bookings.length) * 100) : 0;
  }, [bookings]);

  const totalRevenue = useMemo(() => {
    return bookings
      .filter((b) => b.status === "CONFIRMED" || b.status === "COMPLETED")
      .reduce((sum, b) => sum + (b.service?.price ?? 0), 0);
  }, [bookings]);

  const kpiCards = [
    {
      label: "This Week",
      value: stats?.weekCount ?? 0,
      icon: CalendarDays,
      accent: "var(--kf-accent1)",
    },
    {
      label: "Completion",
      value: `${completionRate}%`,
      icon: CheckCircle2,
      accent: "var(--kf-success)",
    },
    {
      label: "Revenue",
      value: formatAmount(totalRevenue),
      icon: DollarSign,
      accent: "var(--kf-accent2)",
    },
    {
      label: "Utilization",
      value: scheduleHealth ? `${scheduleHealth.utilizationRate}%` : "—",
      icon: Activity,
      accent: "var(--kf-info)",
    },
  ];

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

  const statusBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    bookings.forEach((b) => {
      counts[b.status] = (counts[b.status] ?? 0) + 1;
    });
    return Object.entries(counts).map(([status, value]) => ({
      name: PIE_LABELS[status] ?? status,
      value,
      color: PIE_COLORS[status] ?? "hsl(var(--muted-foreground))",
    }));
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
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 6);
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

  return (
    <motion.div
      variants={stagger.container}
      initial="hidden"
      animate="visible"
      className="space-y-4"
    >
      <motion.div variants={stagger.item} className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {kpiCards.map((card) => (
          <div
            key={card.label}
            className="kf-card rounded-xl px-3 py-2.5 flex items-center gap-2.5"
          >
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
        ))}
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <motion.div variants={stagger.item} className="lg:col-span-3 kf-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            <h3 className="text-sm font-semibold">Booking Volume (7 Days)</h3>
          </div>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyVolume} barSize={24}>
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip {...RECHARTS_TOOLTIP_STYLE} />
                <Bar dataKey="count" fill="hsl(var(--kf-accent1))" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        <motion.div variants={stagger.item} className="lg:col-span-2 kf-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Status Breakdown</h3>
          </div>
          {statusBreakdown.length > 0 ? (
            <>
              <div className="h-32 flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusBreakdown} cx="50%" cy="50%" innerRadius={30} outerRadius={50} paddingAngle={3} dataKey="value">
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
            <div className="h-32 flex items-center justify-center text-xs text-muted-foreground">
              No booking data yet
            </div>
          )}
        </motion.div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <motion.div variants={stagger.item} className="kf-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4" style={{ color: "hsl(var(--kf-success))" }} />
            <h3 className="text-sm font-semibold">Top Services</h3>
          </div>
          {topServices.length > 0 ? (
            <div className="space-y-2">
              {topServices.map((svc, i) => {
                const maxRev = topServices[0]?.revenue || 1;
                return (
                  <div key={i} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium truncate">{svc.name}</span>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{svc.count} bookings</span>
                        <span className="font-medium" style={{ color: "hsl(var(--kf-success))" }}>
                          {formatAmount(svc.revenue)}
                        </span>
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${(svc.revenue / maxRev) * 100}%` }}
                        transition={{ duration: 0.5, delay: i * 0.1 }}
                        className="h-full rounded-full"
                        style={{ background: "hsl(var(--kf-success))" }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-6 text-center text-xs text-muted-foreground">No service data</div>
          )}
        </motion.div>

        <motion.div variants={stagger.item} className="kf-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4" style={{ color: "hsl(var(--kf-warning))" }} />
            <h3 className="text-sm font-semibold">Peak Hours</h3>
          </div>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={peakHours} barSize={16}>
                <XAxis dataKey="hour" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip {...RECHARTS_TOOLTIP_STYLE} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {peakHours.map((entry, i) => (
                    <Cell key={i} fill={entry.count > 0 ? "hsl(var(--kf-accent2))" : "hsl(var(--border)/0.3)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>
      </div>

      {scheduleHealth && (
        <>
          <motion.div variants={stagger.item}>
            <div className="flex items-center gap-2 mt-1 mb-2">
              <Activity className="w-4 h-4" style={{ color: "hsl(var(--kf-info))" }} />
              <h3 className="text-sm font-semibold">Schedule Health</h3>
            </div>
          </motion.div>

          <motion.div variants={stagger.item} className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {[
              { label: "Utilization", value: `${scheduleHealth.utilizationRate}%`, accent: "var(--kf-info)", icon: Activity },
              {
                label: "Cancellation",
                value: `${scheduleHealth.noShowRate}%`,
                accent: "var(--kf-error)",
                icon: ShieldAlert,
                trend: scheduleHealth.noShowTrend,
              },
              { label: "Avg Rev/Slot", value: formatAmount(scheduleHealth.avgRevenuePerSlot), accent: "var(--kf-success)", icon: DollarSign },
              { label: "Peak Day", value: scheduleHealth.peakDay, accent: "var(--kf-accent2)", icon: TrendingUp },
            ].map((card) => (
              <div key={card.label} className="kf-card rounded-xl px-3 py-2.5 flex items-center gap-2.5">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: `hsl(${card.accent} / 0.12)` }}
                >
                  <card.icon className="w-4 h-4" style={{ color: `hsl(${card.accent})` }} />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{card.label}</p>
                  <div className="flex items-center gap-1">
                    <p className="text-lg font-bold truncate">{card.value}</p>
                    {"trend" in card && card.trend !== 0 && (
                      <span className="flex items-center text-[10px]" style={{ color: (card.trend ?? 0) > 0 ? "hsl(var(--kf-error))" : "hsl(var(--kf-success))" }}>
                        {(card.trend ?? 0) > 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                        {Math.abs(card.trend ?? 0)}%
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </motion.div>

          {scheduleHealth.weeklyUtilization && (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
              <motion.div variants={stagger.item} className="lg:col-span-3 kf-card p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-4 h-4" style={{ color: "hsl(var(--kf-info))" }} />
                  <h3 className="text-sm font-semibold">7-Day Utilization</h3>
                </div>
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={scheduleHealth.weeklyUtilization} barSize={24}>
                      <XAxis dataKey="dayOfWeek" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(v) => v.slice(0, 3)} />
                      <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                      <Tooltip {...RECHARTS_TOOLTIP_STYLE} formatter={((value: number | string) => [`${value}%`, "Utilization"]) as never} />
                      <Bar dataKey="utilizationRate" radius={[6, 6, 0, 0]}>
                        {scheduleHealth.weeklyUtilization.map((entry, i) => (
                          <Cell key={i} fill={entry.utilizationRate >= 70 ? "hsl(var(--kf-success))" : entry.utilizationRate >= 40 ? "hsl(var(--kf-warning))" : entry.totalSlots === 0 ? "hsl(var(--border)/0.3)" : "hsl(var(--kf-error))"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex items-center gap-4 justify-center text-[10px] text-muted-foreground">
                  <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full" style={{ background: "hsl(var(--kf-success))" }} /><span>Good (70%+)</span></div>
                  <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full" style={{ background: "hsl(var(--kf-warning))" }} /><span>Fair (40-69%)</span></div>
                  <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full" style={{ background: "hsl(var(--kf-error))" }} /><span>Low (&lt;40%)</span></div>
                </div>
              </motion.div>

              <motion.div variants={stagger.item} className="lg:col-span-2 kf-card p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Lightbulb className="w-4 h-4" style={{ color: "hsl(var(--kf-warning))" }} />
                  <h3 className="text-sm font-semibold">Recommendations</h3>
                </div>
                {scheduleHealth.recommendations.length > 0 ? (
                  <div className="space-y-2">
                    {scheduleHealth.recommendations.map((rec, i) => (
                      <div key={i} className="flex gap-2 p-2 rounded-lg bg-white/[0.02]">
                        <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ background: "hsl(var(--kf-warning) / 0.12)", color: "hsl(var(--kf-warning))" }}>
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
          )}

          {scheduleHealth.promotionSuggestions.length > 0 && (
            <motion.div variants={stagger.item} className="kf-card p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Megaphone className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                <h3 className="text-sm font-semibold">Promotion Opportunities</h3>
              </div>
              <div className="space-y-2">
                {scheduleHealth.promotionSuggestions.map((promo, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-xl border border-border/40 bg-white/[0.02]">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}>
                      <CalendarDays className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
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
                <ShieldAlert className="w-4 h-4" style={{ color: "hsl(var(--kf-error))" }} />
                <h3 className="text-sm font-semibold">No-Show Risk Alerts</h3>
              </div>
              <div className="space-y-1.5">
                {scheduleHealth.noShowRisks.slice(0, 5).map((risk) => (
                  <div key={risk.bookingId} className="flex items-center gap-3 p-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: risk.riskLevel === "HIGH" ? "hsl(var(--kf-error))" : risk.riskLevel === "MEDIUM" ? "hsl(var(--kf-warning))" : "hsl(var(--kf-success))" }} />
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium">{risk.contactName}</span>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {risk.factors.map((f, i) => (
                          <span key={i} className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: "hsl(var(--kf-error) / 0.08)", color: "hsl(var(--kf-error))" }}>{f}</span>
                        ))}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-xs font-bold" style={{ color: risk.riskLevel === "HIGH" ? "hsl(var(--kf-error))" : risk.riskLevel === "MEDIUM" ? "hsl(var(--kf-warning))" : "hsl(var(--kf-success))" }}>{Math.round(risk.riskScore * 100)}%</span>
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
                <RefreshCw className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
                <h3 className="text-sm font-semibold">Rebooking Suggestions</h3>
              </div>
              <div className="space-y-1.5">
                {scheduleHealth.rebookingSuggestions.map((sug, i) => (
                  <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "hsl(var(--kf-accent2) / 0.1)" }}>
                      <RefreshCw className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent2))" }} />
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
