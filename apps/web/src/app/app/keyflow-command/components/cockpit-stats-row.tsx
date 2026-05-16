"use client";

import {
  Calendar,
  DollarSign,
  Users,
  ShieldCheck,
  Activity,
} from "lucide-react";
import { motion } from "framer-motion";

function formatTTD(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}

function MiniSparkline({ color }: { color: string }) {
  const heights = [40, 65, 45, 80, 55];
  return (
    <div className="flex items-end gap-[3px] h-8">
      {heights.map((h, i) => (
        <div
          key={i}
          className="w-1 rounded-sm opacity-30"
          style={{ height: `${h}%`, background: color }}
        />
      ))}
    </div>
  );
}

interface StatCardProps {
  icon: React.ElementType;
  label: string;
  value: string;
  detail: string;
  accentColor: string;
  delay?: number;
}

function StatCard({
  icon: Icon,
  label,
  value,
  detail,
  accentColor,
  delay = 0,
}: StatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: "easeOut" }}
      className="kf-card p-4 flex items-start justify-between hover:border-[hsl(var(--kf-border)/1.5)] transition-colors cursor-default"
    >
      <div className="space-y-2.5 min-w-0">
        <div className="flex items-center gap-2">
          <div
            className="p-1.5 rounded-md"
            style={{ background: `${accentColor}15` }}
          >
            <Icon className="w-3.5 h-3.5" style={{ color: accentColor }} />
          </div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
            {label}
          </span>
        </div>
        <div>
          <p className="text-2xl font-bold tracking-tight">{value}</p>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {detail}
          </p>
        </div>
      </div>
      <MiniSparkline color={accentColor} />
    </motion.div>
  );
}

interface CockpitStatsRowProps {
  upcomingBookings: number;
  overdueAmount: number;
  overdueInvoices: number;
  staleLeads: number;
  pendingApprovals: number;
  momentumScore: number;
}

export function CockpitStatsRow({
  upcomingBookings,
  overdueAmount,
  overdueInvoices,
  staleLeads,
  pendingApprovals,
  momentumScore,
}: CockpitStatsRowProps) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      <StatCard
        icon={Calendar}
        label="Today's Schedule"
        value={String(upcomingBookings)}
        detail={
          upcomingBookings === 0
            ? "Nothing scheduled"
            : upcomingBookings === 1
              ? "1 booking"
              : `${upcomingBookings} bookings`
        }
        accentColor="hsl(var(--kf-accent2))"
        delay={0.05}
      />
      <StatCard
        icon={DollarSign}
        label="Revenue Waiting"
        value={formatTTD(overdueAmount)}
        detail={`${overdueInvoices} invoice${overdueInvoices !== 1 ? "s" : ""} overdue`}
        accentColor="hsl(var(--kf-warning))"
        delay={0.1}
      />
      <StatCard
        icon={Users}
        label="Client Follow-ups"
        value={String(staleLeads)}
        detail={
          staleLeads === 0
            ? "All caught up"
            : staleLeads === 1
              ? "1 person to reach out"
              : `${staleLeads} people to reach out`
        }
        accentColor="hsl(var(--kf-info))"
        delay={0.15}
      />
      <StatCard
        icon={ShieldCheck}
        label="Approvals"
        value={String(pendingApprovals)}
        detail={
          pendingApprovals === 0
            ? "Nothing pending"
            : pendingApprovals === 1
              ? "1 waiting for you"
              : `${pendingApprovals} waiting for you`
        }
        accentColor="hsl(var(--kf-accent1))"
        delay={0.2}
      />
      <StatCard
        icon={Activity}
        label="Business Health"
        value={`${momentumScore}`}
        detail={
          momentumScore >= 80
            ? "Strong — Keep it going!"
            : momentumScore >= 50
              ? "Steady"
              : momentumScore >= 30
                ? "Needs attention"
                : "Critical — act now"
        }
        accentColor="hsl(var(--kf-success))"
        delay={0.25}
      />
    </div>
  );
}
