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
} from "lucide-react";
import { formatAmount } from "../../commerce/utils/commerce-utils";
import Link from "next/link";
import type { Booking, Service, BookingStats } from "@/lib/client";
import type { ScheduleHealth } from "@/lib/client";
import { MetricExplainer } from "@/components/ui/metric-explainer";

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
      explanation: "Number of bookings scheduled for the current week.",
      goodValue: "Compare weekly to spot seasonal patterns.",
    },
    {
      label: "Completion",
      value: `${completionRate}%`,
      icon: CheckCircle2,
      accent: "var(--kf-success)",
      explanation: "Percentage of bookings that were completed (not cancelled or no-show).",
      formula: "(Completed Bookings ÷ Total Bookings) × 100",
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
      value: scheduleHealth ? `${scheduleHealth.utilizationRate}%` : "—",
      icon: Activity,
      accent: "var(--kf-info)",
      explanation: "How much of your available schedule is filled with bookings.",
      formula: "(Booked Slots ÷ Available Slots) × 100",
      goodValue: "70-85% is optimal. Above 90% may mean you need more availability.",
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
    </motion.div>
  );
}
