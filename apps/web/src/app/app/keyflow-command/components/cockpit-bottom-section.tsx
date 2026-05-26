"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Trophy,
  CalendarDays,
  Lightbulb,
  CheckCircle2,
  ArrowRight,
  Clock,
  Users,
  TrendingUp,
} from "lucide-react";
import type { EnrichedPriority } from "../../control-tower/components/use-control-tower-data";

interface CockpitBottomSectionProps {
  priorities: EnrichedPriority[];
  upcomingBookings: number;
  momentumScore: number;
  staleLeads: number;
  overdueAmount: number;
}

export function CockpitBottomSection({
  priorities,
  upcomingBookings,
  momentumScore,
  staleLeads,
  overdueAmount,
}: CockpitBottomSectionProps) {
  const router = useRouter();

  // Derive "recent wins" from resolved/completed-looking priorities
  const wins = priorities
    .filter((p) => p.type === "opportunity" || p.severity === "info")
    .slice(0, 3)
    .map((p) => ({
      title: p.title,
      detail:
        p.module === "revenue"
          ? "Revenue opportunity identified"
          : p.module === "bookings"
            ? "Capacity available"
            : "Positive signal",
      time: "Today",
    }));

  // Derive upcoming items
  const upcomingItems = [
    {
      day: "Wed",
      date: 15,
      title: upcomingBookings > 0 ? `${upcomingBookings} Booking${upcomingBookings !== 1 ? "s" : ""}` : "No bookings",
      time: upcomingBookings > 0 ? "10:00 AM" : "—",
      hasAvatars: upcomingBookings > 0,
    },
    {
      day: "Thu",
      date: 16,
      title: staleLeads > 0 ? `${staleLeads} Follow-ups` : "Team Sync",
      time: staleLeads > 0 ? "11:00 AM" : "2:00 PM",
      hasAvatars: staleLeads > 0,
    },
    {
      day: "Fri",
      date: 17,
      title: "Review weekly revenue",
      time: "2:00 PM",
      hasAvatars: false,
    },
  ];

  // Generate an insight based on data
  const insight = (() => {
    if (overdueAmount > 5000) {
      return {
        text: `You have ${formatTTD(overdueAmount)} in outstanding revenue. Consider sending reminders to improve cash flow.`,
        cta: "Send reminders",
        route: "/app/commerce?tab=invoices",
      };
    }
    if (staleLeads > 5) {
      return {
        text: `${staleLeads} leads are cooling down. Thursday afternoon has historically high response rates for outreach.`,
        cta: "Reach out",
        route: "/app/network/contacts",
      };
    }
    if (upcomingBookings < 3) {
      return {
        text: "Your calendar has open slots this week. Consider running a promotion to fill capacity.",
        cta: "Open slots",
        route: "/app/bookings",
      };
    }
    return {
      text: momentumScore >= 70
        ? "Your business momentum is strong. Keep nurturing your active leads to maintain the trajectory."
        : "Small consistent actions compound. Focus on one priority at a time to rebuild momentum.",
      cta: "View pipeline",
      route: "/app/network/contacts",
    };
  })();

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.45 }}
      className="grid grid-cols-1 md:grid-cols-3 gap-4"
    >
      {/* Recent Wins */}
      <div className="kf-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="w-4 h-4 text-[hsl(var(--kf-warning))]" />
            <h3 className="text-xs font-semibold">Recent Wins</h3>
          </div>
          <span className="text-[10px] text-muted-foreground">Today</span>
        </div>
        <div className="space-y-2.5">
          {wins.length > 0 ? (
            wins.map((win, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <div className="w-6 h-6 rounded-full bg-[hsl(var(--kf-success))]/10 flex items-center justify-center shrink-0 mt-0.5">
                  <CheckCircle2 className="w-3 h-3 text-[hsl(var(--kf-success))]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{win.title}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {win.detail}
                  </p>
                </div>
              </div>
            ))
          ) : (
            <div className="py-4 text-center">
              <p className="text-xs text-muted-foreground">No wins yet today</p>
            </div>
          )}
        </div>
        <button
          onClick={() => router.push("/app/commerce")}
          className="w-full text-center text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center gap-1"
        >
          View all wins <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      {/* Upcoming This Week */}
      <div className="kf-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-[hsl(var(--kf-accent2))]" />
            <h3 className="text-xs font-semibold">Upcoming This Week</h3>
          </div>
          <button
            onClick={() => router.push("/app/calendar")}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5"
          >
            View calendar <ArrowRight className="w-3 h-3" />
          </button>
        </div>
        <div className="space-y-2.5">
          {upcomingItems.map((item, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-8 h-10 rounded-lg bg-[hsl(var(--kf-muted))] flex flex-col items-center justify-center shrink-0">
                <span className="text-[9px] text-muted-foreground uppercase leading-none">
                  {item.day}
                </span>
                <span className="text-xs font-bold leading-none mt-0.5">
                  {item.date}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{item.title}</p>
                <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5" />
                  {item.time}
                </p>
              </div>
              {item.hasAvatars && (
                <div className="flex -space-x-1.5">
                  {[0, 1, 2].map((j) => (
                    <div
                      key={j}
                      className="w-5 h-5 rounded-full border-2 border-[hsl(var(--kf-card))] bg-[hsl(var(--kf-muted))] flex items-center justify-center"
                    >
                      <Users className="w-2.5 h-2.5 text-muted-foreground" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Insight from KEY */}
      <div className="kf-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
          <h3 className="text-xs font-semibold">Insight from KEY</h3>
        </div>
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <p className="text-sm leading-relaxed">{insight.text}</p>
            <button
              onClick={() => router.push(insight.route)}
              className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/15 transition-colors"
            >
              {insight.cta}
            </button>
          </div>
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[hsl(var(--kf-accent1))]/10 to-[hsl(var(--kf-accent2))]/10 flex items-center justify-center shrink-0">
            <TrendingUp className="w-5 h-5 text-[hsl(var(--kf-accent1))]" />
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function formatTTD(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
}
