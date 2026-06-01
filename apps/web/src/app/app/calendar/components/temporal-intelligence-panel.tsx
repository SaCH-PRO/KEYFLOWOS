"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  Brain,
  Clock,
  AlertTriangle,
  Zap,
  CalendarDays,
  TrendingUp,
  Users,
  Sparkles,
  ChevronRight,
} from "lucide-react";

interface TimeInsight {
  id: string;
  type: "optimization" | "conflict" | "pattern" | "suggestion";
  title: string;
  description: string;
  time?: string;
  impact: string;
}

interface DayPattern {
  day: string;
  utilization: number;
  bookings: number;
  revenue: number;
  optimal: boolean;
}

export function TemporalIntelligencePanel() {
  const insights: TimeInsight[] = useMemo(() => [
    { id: "1", type: "optimization", title: "Peak Conversion Window", description: "Friday 2-4pm shows 3.2x higher booking conversion. Consider promotions during this window.", time: "Fri 2-4pm", impact: "+18% revenue" },
    { id: "2", type: "conflict", title: "Buffer Time Risk", description: "You have 3 back-to-back meetings Tuesday with no buffer. Risk of cascading delays.", time: "Tue 10am-1pm", impact: "High risk" },
    { id: "3", type: "pattern", title: "Quiet Tuesday Pattern", description: "Tuesdays consistently show 40% lower bookings. A targeted campaign could fill 3-4 slots.", time: "Tuesdays", impact: "+3 slots" },
    { id: "4", type: "suggestion", title: "Optimal Follow-up Time", description: "Clients contacted within 2 hours of inquiry book at 78% rate. Current average: 6 hours.", time: "Within 2hrs", impact: "+31% bookings" },
  ], []);

  const weekPattern: DayPattern[] = useMemo(() => [
    { day: "Mon", utilization: 72, bookings: 5, revenue: 450, optimal: false },
    { day: "Tue", utilization: 45, bookings: 3, revenue: 280, optimal: false },
    { day: "Wed", utilization: 85, bookings: 6, revenue: 620, optimal: true },
    { day: "Thu", utilization: 78, bookings: 5, revenue: 510, optimal: false },
    { day: "Fri", utilization: 92, bookings: 7, revenue: 780, optimal: true },
    { day: "Sat", utilization: 65, bookings: 4, revenue: 420, optimal: false },
    { day: "Sun", utilization: 30, bookings: 1, revenue: 150, optimal: false },
  ], []);

  return (
    <div className="space-y-4">
      {/* Weekly Pattern */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-border/40 bg-card/40 backdrop-blur-sm p-5"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[hsl(var(--kf-accent2))]" />
            Weekly Utilization Pattern
          </h3>
          <span className="text-[10px] text-muted-foreground">Based on last 4 weeks</span>
        </div>
        <div className="flex items-end gap-2 h-24">
          {weekPattern.map((day) => (
            <div key={day.day} className="flex-1 flex flex-col items-center gap-1">
              <div className="text-[10px] text-muted-foreground">{day.utilization}%</div>
              <div className="w-full relative">
                <div
                  className="w-full rounded-t-md transition-all duration-500"
                  style={{
                    height: `${day.utilization * 0.8}px`,
                    backgroundColor: day.optimal
                      ? "hsl(var(--kf-accent1))"
                      : day.utilization > 60
                        ? "hsl(var(--kf-accent2))"
                        : "hsl(var(--kf-muted))",
                    opacity: day.optimal ? 1 : 0.6,
                  }}
                />
              </div>
              <span className={`text-[10px] font-medium ${day.optimal ? "text-[hsl(var(--kf-accent1))]" : "text-muted-foreground"}`}>
                {day.day}
              </span>
            </div>
          ))}
        </div>
      </motion.div>

      {/* AI Insights */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Brain className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
            Temporal Intelligence
          </h3>
        </div>
        <div className="space-y-2">
          {insights.map((insight, i) => {
            const config = {
              optimization: { bg: "bg-emerald-500/5", border: "border-emerald-500/20", icon: Zap },
              conflict: { bg: "bg-rose-500/5", border: "border-rose-500/20", icon: AlertTriangle },
              pattern: { bg: "bg-amber-500/5", border: "border-amber-500/20", icon: TrendingUp },
              suggestion: { bg: "bg-[hsl(var(--kf-accent2))]/5", border: "border-[hsl(var(--kf-accent2))]/20", icon: Sparkles },
            }[insight.type];
            const Icon = config.icon;
            return (
              <motion.div
                key={insight.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.06, duration: 0.3 }}
                className={`rounded-xl border ${config.border} ${config.bg} p-3.5`}
              >
                <div className="flex items-start gap-2.5">
                  <div className="mt-0.5">
                    <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs font-semibold text-foreground">{insight.title}</span>
                      {insight.time && (
                        <span className="text-[10px] text-muted-foreground shrink-0">{insight.time}</span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{insight.description}</p>
                    <div className="flex items-center gap-1 mt-1.5">
                      <span className="text-[10px] font-medium text-[hsl(var(--kf-accent1))]">Impact: {insight.impact}</span>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
