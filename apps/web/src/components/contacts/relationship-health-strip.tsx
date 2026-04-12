"use client";

import { Heart, TrendingUp, DollarSign, Calendar, UserCheck } from "lucide-react";

interface RelationshipHealthStripProps {
  healthMetrics?: { engagement: number; payment: number; responsiveness: number; relationship: number } | null;
  outstandingBalance?: number | null;
  totalRevenue?: number | null;
  nextBooking?: string | null;
  bookingCount?: number;
  profileCompleteness?: number;
  lastInteraction?: string | null;
}

function getHealthLabel(score: number): { label: string; color: string } {
  if (score >= 75) return { label: "Strong", color: "text-emerald-400" };
  if (score >= 50) return { label: "Good", color: "text-blue-400" };
  if (score >= 25) return { label: "Fair", color: "text-amber-400" };
  return { label: "At Risk", color: "text-red-400" };
}

function getMomentum(lastInteraction?: string | null): { label: string; color: string } {
  if (!lastInteraction) return { label: "New", color: "text-muted-foreground" };
  const daysSince = Math.floor((Date.now() - new Date(lastInteraction).getTime()) / (1000 * 60 * 60 * 24));
  if (daysSince <= 3) return { label: "Hot", color: "text-emerald-400" };
  if (daysSince <= 7) return { label: "Warming", color: "text-blue-400" };
  if (daysSince <= 14) return { label: "Cooling", color: "text-amber-400" };
  return { label: "Cold", color: "text-red-400" };
}

function getRevenueStatus(outstanding?: number | null, total?: number | null): { label: string; color: string } {
  if (outstanding && outstanding > 0) return { label: `$${outstanding.toFixed(0)} due`, color: "text-red-400" };
  if (total && total > 0) return { label: "Paid up", color: "text-emerald-400" };
  return { label: "No revenue", color: "text-muted-foreground" };
}

function getBookingStatus(nextBooking?: string | null, count?: number): { label: string; color: string } {
  if (nextBooking) {
    const d = new Date(nextBooking);
    const diff = Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (diff <= 0) return { label: "Today", color: "text-emerald-400" };
    if (diff === 1) return { label: "Tomorrow", color: "text-blue-400" };
    return { label: `In ${diff}d`, color: "text-blue-400" };
  }
  if (count && count > 0) return { label: `${count} past`, color: "text-muted-foreground" };
  return { label: "None", color: "text-muted-foreground" };
}

export function RelationshipHealthStrip({
  healthMetrics,
  outstandingBalance,
  totalRevenue,
  nextBooking,
  bookingCount,
  profileCompleteness,
  lastInteraction,
}: RelationshipHealthStripProps) {
  const overallHealth = healthMetrics
    ? Math.round((healthMetrics.engagement + healthMetrics.payment + healthMetrics.responsiveness + healthMetrics.relationship) / 4)
    : null;

  const health = overallHealth !== null ? getHealthLabel(overallHealth) : null;
  const momentum = getMomentum(lastInteraction);
  const revenue = getRevenueStatus(outstandingBalance, totalRevenue);
  const booking = getBookingStatus(nextBooking, bookingCount);
  const completeness = profileCompleteness != null ? `${profileCompleteness}%` : null;

  const items = [
    health ? { icon: Heart, label: "Health", value: health.label, color: health.color } : null,
    { icon: TrendingUp, label: "Momentum", value: momentum.label, color: momentum.color },
    { icon: DollarSign, label: "Revenue", value: revenue.label, color: revenue.color },
    { icon: Calendar, label: "Booking", value: booking.label, color: booking.color },
    completeness ? { icon: UserCheck, label: "Profile", value: completeness, color: (profileCompleteness ?? 0) >= 70 ? "text-emerald-400" : "text-amber-400" } : null,
  ].filter(Boolean) as Array<{ icon: typeof Heart; label: string; value: string; color: string }>;

  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div
            key={item.label}
            className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/[0.03] border border-border/20"
          >
            <Icon className="w-3 h-3 text-muted-foreground/50" />
            <span className="text-[9px] text-muted-foreground/60 uppercase tracking-wider">{item.label}</span>
            <span className={`text-[10px] font-medium ${item.color}`}>{item.value}</span>
          </div>
        );
      })}
    </div>
  );
}
