"use client";

import { motion } from "framer-motion";
import {
  CalendarDays,
  Calendar,
  AlertCircle,
  Users,
  DollarSign,
} from "lucide-react";
import type { BookingStats, Booking } from "./bookings-types";

interface BookingsDashboardProps {
  stats: BookingStats | null;
  bookings: Booking[];
}

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.07 },
  },
};

const item = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35 } },
};

export default function BookingsDashboard({ stats, bookings }: BookingsDashboardProps) {
  if (!stats) return null;

  const confirmedRevenue = bookings
    .filter((b) => b.status === "CONFIRMED" || b.status === "COMPLETED")
    .reduce((sum, b) => sum + (b.service?.price ?? 0), 0);

  const kpiCards = [
    {
      label: "Today",
      value: stats.todayCount,
      icon: CalendarDays,
      gradient: "from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent1))]",
      bg: "from-[hsl(var(--kf-accent1)/0.15)] to-[hsl(var(--kf-accent1)/0.05)]",
    },
    {
      label: "This Week",
      value: stats.weekCount,
      icon: Calendar,
      gradient: "from-[hsl(var(--kf-accent2))] to-[hsl(var(--kf-accent2))]",
      bg: "from-[hsl(var(--kf-accent2)/0.15)] to-[hsl(var(--kf-accent2)/0.05)]",
    },
    {
      label: "Pending",
      value: stats.pendingCount,
      icon: AlertCircle,
      gradient: "from-amber-500 to-orange-600",
      bg: "from-amber-500/15 to-amber-600/5",
    },
    {
      label: "Total",
      value: stats.totalBookings,
      icon: Users,
      gradient: "from-[hsl(var(--kf-accent2))] to-[hsl(var(--kf-accent2))]",
      bg: "from-[hsl(var(--kf-accent2)/0.15)] to-[hsl(var(--kf-accent2)/0.05)]",
    },
    {
      label: "Revenue",
      value: `$${confirmedRevenue.toLocaleString("en-US", { minimumFractionDigits: 0 })}`,
      icon: DollarSign,
      gradient: "from-emerald-500 to-green-600",
      bg: "from-emerald-500/15 to-emerald-600/5",
    },
  ];

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="grid grid-cols-2 md:grid-cols-5 gap-3"
    >
      {kpiCards.map((card) => (
        <motion.div
          key={card.label}
          variants={item}
          className={`rounded-2xl border border-border/60 bg-card/80 backdrop-blur-sm bg-gradient-to-br ${card.bg} p-5 flex items-start gap-4`}
        >
          <div
            className={`w-10 h-10 rounded-xl bg-gradient-to-br ${card.gradient} flex items-center justify-center shrink-0`}
          >
            <card.icon className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
              {card.label}
            </p>
            <p className="text-2xl font-bold truncate">{card.value}</p>
          </div>
        </motion.div>
      ))}
    </motion.div>
  );
}
