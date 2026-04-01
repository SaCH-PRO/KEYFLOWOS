"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  BarChart3,
  Clock,
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
} from "lucide-react";
import { formatAmount } from "../../commerce/utils/commerce-utils";
import Link from "next/link";
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

  return (
    <motion.div
      variants={stagger.container}
      initial="hidden"
      animate="visible"
      className="space-y-4"
    >
      <Link
        href="/app/reports?tab=bookings"
        className="kf-card p-3 flex items-center justify-between gap-3 transition-all hover:border-[hsl(var(--kf-accent1)_/_0.4)]"
      >
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          <span className="text-xs font-medium">View Full Bookings Report</span>
          <span className="text-xs text-muted-foreground">— trends, charts &amp; AI insights</span>
        </div>
        <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground" />
      </Link>

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

      {scheduleHealth && (
        <>
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
              { label: "Peak Day", value: scheduleHealth.peakDay, accent: "var(--kf-accent2)", icon: Clock },
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

          {scheduleHealth.recommendations.length > 0 && (
            <motion.div variants={stagger.item} className="kf-card p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Lightbulb className="w-4 h-4" style={{ color: "hsl(var(--kf-warning))" }} />
                <h3 className="text-sm font-semibold">Recommendations</h3>
              </div>
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
            </motion.div>
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
