"use client";

import { useMemo } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Sparkles, Clock, ArrowRight, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { TemporalFlowEvent } from "@/lib/api/temporal-flow";

interface TemporalFlowBriefingProps {
  events: TemporalFlowEvent[];
}

function isOverdue(event: TemporalFlowEvent) {
  if (event.status === "RESOLVED" || event.status === "DISMISSED") return false;
  const date = event.startsAt ? new Date(event.startsAt) : new Date(event.occurredAt);
  return date.getTime() < Date.now() - 60 * 60 * 1000;
}

function formatWhen(dateStr?: string) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  });
}

export function TemporalFlowBriefing({ events }: TemporalFlowBriefingProps) {
  const { overdue, nextUpcoming } = useMemo(() => {
    const overdue = events.filter((e) => isOverdue(e));
    const upcoming = events
      .filter((e) => e.status !== "RESOLVED" && e.status !== "DISMISSED" && !isOverdue(e))
      .sort((a, b) => {
        const aDate = a.startsAt ? new Date(a.startsAt).getTime() : new Date(a.occurredAt).getTime();
        const bDate = b.startsAt ? new Date(b.startsAt).getTime() : new Date(b.occurredAt).getTime();
        return aDate - bDate;
      });
    return { overdue, nextUpcoming: upcoming.slice(0, 3) };
  }, [events]);

  const allClear = overdue.length === 0 && nextUpcoming.length === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.1 }}
      className="rounded-2xl border border-border/40 p-4 sm:p-5 relative overflow-hidden"
      style={{
        background:
          "linear-gradient(135deg, hsl(var(--kf-card)) 0%, hsl(var(--kf-accent2) / 0.04) 100%)",
      }}
    >
      <div className="relative flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[hsl(var(--kf-accent2))]/10">
          <Sparkles className="h-6 w-6 text-[hsl(var(--kf-accent2))]" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-foreground">KEY Briefing</h3>
          {allClear ? (
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-[hsl(var(--kf-success))]" />
              Timeline is clear. No overdue items and nothing upcoming.
            </p>
          ) : overdue.length > 0 ? (
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-[hsl(var(--kf-warning))]" />
              {overdue.length} overdue item{overdue.length === 1 ? "" : "s"} need attention.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
              {nextUpcoming.length} upcoming event{nextUpcoming.length === 1 ? "" : "s"} on your timeline.
            </p>
          )}

          {nextUpcoming.length > 0 && (
            <div className="mt-3 space-y-2">
              {nextUpcoming.map((event) => (
                <div
                  key={event.id}
                  className="flex items-center justify-between gap-3 rounded-xl bg-card/60 border border-border/30 p-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{event.title}</p>
                    <p className="text-[10px] text-muted-foreground">{formatWhen(event.startsAt)}</p>
                  </div>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-md font-medium shrink-0"
                    style={{
                      background:
                        event.importance === "CRITICAL"
                          ? "hsl(var(--kf-error) / 0.1)"
                          : event.importance === "HIGH"
                            ? "hsl(var(--kf-warning) / 0.1)"
                            : "hsl(var(--kf-muted) / 0.15)",
                      color:
                        event.importance === "CRITICAL"
                          ? "hsl(var(--kf-error))"
                          : event.importance === "HIGH"
                            ? "hsl(var(--kf-warning))"
                            : "hsl(var(--kf-muted-foreground))",
                    }}
                  >
                    {event.importance}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <Link
          href="/app/temporal-flow?tab=analysis"
          className="inline-flex items-center justify-center gap-1.5 shrink-0 rounded-xl px-4 py-2 text-xs font-semibold transition-colors"
          style={{ background: "hsl(var(--kf-accent2))", color: "hsl(var(--kf-accent2-foreground, 0 0% 100%))" }}
        >
          Run KEY Analysis
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </motion.div>
  );
}
