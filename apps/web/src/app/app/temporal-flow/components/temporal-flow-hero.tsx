"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { Clock, Calendar, Zap, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { TemporalFlowEvent } from "@/lib/api/temporal-flow";
import { useAnimatedNumber } from "@/hooks/use-animated-number";

interface TemporalFlowHeroProps {
  events: TemporalFlowEvent[];
}

function isWithin(days: number, dateStr?: string) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  return diffMs >= -24 * 60 * 60 * 1000 && diffMs <= days * 24 * 60 * 60 * 1000;
}

function isToday(dateStr?: string) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return (
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  );
}

function isOverdue(event: TemporalFlowEvent) {
  if (event.status === "RESOLVED" || event.status === "DISMISSED") return false;
  const date = event.startsAt ? new Date(event.startsAt) : new Date(event.occurredAt);
  return date.getTime() < Date.now() - 60 * 60 * 1000;
}

interface MetricCardProps {
  icon: React.ElementType;
  label: string;
  value: number;
  color: string;
}

function MetricCard({ icon: Icon, label, value, color }: MetricCardProps) {
  const animated = useAnimatedNumber(value, { duration: 800, decimals: 0 });
  return (
    <div
      className="rounded-xl p-3 border transition-colors"
      style={{ background: `${color}08`, borderColor: `${color}25` }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <div
          className="flex h-6 w-6 items-center justify-center rounded-lg flex-shrink-0"
          style={{ background: `${color}18` }}
        >
          <Icon className="h-3 w-3" style={{ color }} />
        </div>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      </div>
      <div className="text-xl font-display font-bold" style={{ color }}>
        {animated}
      </div>
    </div>
  );
}

export function TemporalFlowHero({ events }: TemporalFlowHeroProps) {
  const stats = useMemo(() => {
    const today = events.filter((e) => isToday(e.startsAt) || isToday(e.occurredAt)).length;
    const thisWeek = events.filter((e) => isWithin(7, e.startsAt) || isWithin(7, e.occurredAt)).length;
    const thisMonth = events.filter((e) => isWithin(30, e.startsAt) || isWithin(30, e.occurredAt)).length;
    const overdue = events.filter((e) => isOverdue(e)).length;
    const resolved = events.filter((e) => e.status === "RESOLVED" || e.status === "DISMISSED").length;
    const total = events.length;
    return { today, thisWeek, thisMonth, overdue, resolved, total };
  }, [events]);

  const completionRate = stats.total > 0 ? Math.round((stats.resolved / stats.total) * 100) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="rounded-2xl border border-border/40 p-4 sm:p-5 relative overflow-hidden"
      style={{
        background:
          "linear-gradient(135deg, hsl(var(--kf-card)) 0%, hsl(var(--kf-accent1) / 0.04) 50%, hsl(var(--kf-secondary) / 0.03) 100%)",
      }}
    >
      <div className="relative flex flex-col lg:flex-row lg:items-center gap-5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Temporal Flow
            </span>
          </div>
          <h2 className="text-xl font-semibold text-foreground">Your business timeline</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {stats.today} today · {stats.thisWeek} this week · {stats.overdue > 0 ? `${stats.overdue} overdue` : "No overdue items"}
          </p>

          <div className="mt-4">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
              <span>Flow completion</span>
              <span>{completionRate}%</span>
            </div>
            <div className="h-2 rounded-full bg-muted/50 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${completionRate}%` }}
                transition={{ duration: 800, ease: "easeOut" }}
                className="h-full rounded-full bg-gradient-to-r from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-success))]"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 lg:w-[440px] flex-shrink-0">
          <MetricCard icon={Zap} label="Today" value={stats.today} color="hsl(var(--kf-accent1))" />
          <MetricCard icon={Calendar} label="This Week" value={stats.thisWeek} color="hsl(var(--kf-accent2))" />
          <MetricCard icon={Clock} label="This Month" value={stats.thisMonth} color="hsl(210 80% 60%)" />
          <MetricCard
            icon={stats.overdue > 0 ? AlertTriangle : CheckCircle2}
            label="Overdue"
            value={stats.overdue}
            color={stats.overdue > 0 ? "hsl(var(--kf-warning))" : "hsl(var(--kf-success))"}
          />
        </div>
      </div>
    </motion.div>
  );
}
