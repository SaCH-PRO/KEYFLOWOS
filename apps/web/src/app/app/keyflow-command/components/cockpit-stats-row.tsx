"use client";

import { motion } from "framer-motion";
import { Calendar, AlertTriangle, Users, CheckCircle2, TrendingUp } from "lucide-react";
import { SparkLine } from "@/components/illustrations/key-illustrations";

interface CockpitStatsRowProps {
  upcomingBookings: number;
  overdueAmount: number;
  overdueInvoices: number;
  staleLeads: number;
  pendingApprovals: number;
  momentumScore: number;
}

function AnimatedCounter({ value, prefix = "", suffix = "" }: { value: number; prefix?: string; suffix?: string }) {
  return (
    <motion.span
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="text-2xl font-bold tracking-tight"
    >
      {prefix}{value.toLocaleString()}{suffix}
    </motion.span>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  subtext,
  color,
  sparkData,
  delay,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  subtext?: string;
  color: string;
  sparkData?: number[];
  delay: number;
  onClick?: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      whileHover={{ y: -2 }}
      onClick={onClick}
      className="kf-card-depth p-4 cursor-pointer group"
    >
      <div className="flex items-start justify-between mb-3">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: `${color}15` }}
        >
          <Icon className="w-4 h-4" style={{ color }} />
        </div>
        {sparkData && (
          <SparkLine data={sparkData} color="mixed" className="opacity-60 group-hover:opacity-100 transition-opacity" />
        )}
      </div>
      <div className="space-y-1">
        <div className="text-2xl font-bold tracking-tight">{value}</div>
        <p className="text-xs text-muted-foreground">{label}</p>
        {subtext && (
          <p className="text-[10px] text-muted-foreground/70">{subtext}</p>
        )}
      </div>
      {/* Bottom accent line */}
      <div
        className="absolute bottom-0 left-4 right-4 h-[2px] rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ background: color }}
      />
    </motion.div>
  );
}

export function CockpitStatsRow({
  upcomingBookings,
  overdueAmount,
  overdueInvoices,
  staleLeads,
  pendingApprovals,
  momentumScore,
}: CockpitStatsRowProps) {
  const stats = [
    {
      icon: Calendar,
      label: "Upcoming bookings",
      value: <AnimatedCounter value={upcomingBookings} />,
      color: "hsl(var(--kf-accent2))",
      sparkData: [3, 5, 4, 7, 6, 8, upcomingBookings || 5],
    },
    {
      icon: AlertTriangle,
      label: "Overdue",
      value: (
        <span className="text-2xl font-bold tracking-tight">
          ${(overdueAmount / 100).toFixed(0)}
        </span>
      ),
      subtext: overdueInvoices > 0 ? `${overdueInvoices} invoice${overdueInvoices !== 1 ? "s" : ""}` : undefined,
      color: "hsl(var(--kf-warning))",
      sparkData: [2, 3, 1, 4, 2, 3, overdueInvoices || 0],
    },
    {
      icon: Users,
      label: "Stale leads",
      value: <AnimatedCounter value={staleLeads} />,
      color: "hsl(var(--kf-info))",
      sparkData: [5, 3, 4, 2, 3, 1, staleLeads || 0],
    },
    {
      icon: CheckCircle2,
      label: "Pending approvals",
      value: <AnimatedCounter value={pendingApprovals} />,
      color: "hsl(var(--kf-success))",
      sparkData: [1, 2, 1, 3, 2, 1, pendingApprovals || 0],
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map((stat, i) => (
          <StatCard key={stat.label} {...stat} delay={0.3 + i * 0.08} />
        ))}
      </div>

      {/* Momentum Bar */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7 }}
        className="kf-card-key p-4"
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
            <span className="text-sm font-medium">Momentum Score</span>
          </div>
          <span className="text-sm font-bold text-gradient-key">{momentumScore}%</span>
        </div>
        <div className="kf-momentum-bar">
          <motion.div
            className="kf-momentum-fill-animated"
            initial={{ width: 0 }}
            animate={{ width: `${momentumScore}%` }}
            transition={{ duration: 1, ease: "easeOut", delay: 0.8 }}
          />
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          Based on your activity across revenue, clients, and completions this week.
        </p>
      </motion.div>
    </div>
  );
}
