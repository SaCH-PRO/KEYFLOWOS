"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Brain, CheckCircle2, XCircle, Minus, Loader2, Calendar, TrendingUp, TrendingDown } from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  listGenomeMemoryEvents,
  getGenomeLearningSummary,
  type GenomeMemoryEventData,
  type GenomeLearningSummary,
  type GenomeOutcome,
} from "@/lib/api/business-genome";
import { Badge } from "@/components/ui-v2/badge";

function outcomeIcon(outcome: GenomeOutcome) {
  switch (outcome) {
    case "SUCCESS":
      return <CheckCircle2 className="w-3.5 h-3.5 text-[hsl(var(--kf-success))]" />;
    case "FAILURE":
      return <XCircle className="w-3.5 h-3.5 text-[hsl(var(--kf-error))]" />;
    case "MIXED":
      return <Minus className="w-3.5 h-3.5 text-[hsl(var(--kf-warning))]" />;
    default:
      return <Brain className="w-3.5 h-3.5 text-muted-foreground" />;
  }
}

function outcomeColor(outcome: GenomeOutcome): "mint" | "rose" | "gold" | "muted" {
  switch (outcome) {
    case "SUCCESS":
      return "mint";
    case "FAILURE":
      return "rose";
    case "MIXED":
      return "gold";
    default:
      return "muted";
  }
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface MemoryStripProps {
  compact?: boolean;
}

export function GenomeMemoryStrip({ compact }: MemoryStripProps) {
  const businessId = getStoredBusinessId();
  const [events, setEvents] = useState<GenomeMemoryEventData[]>([]);
  const [summary, setSummary] = useState<GenomeLearningSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) return;
    Promise.all([
      listGenomeMemoryEvents(businessId, { limit: compact ? 3 : 10 }),
      getGenomeLearningSummary(businessId),
    ]).then(([evts, sum]) => {
      setEvents(evts.data ?? []);
      setSummary(sum.data ?? null);
      setLoading(false);
    });
  }, [businessId, compact]);

  if (loading) {
    return (
      <div className="kf-card p-12 flex flex-col items-center justify-center gap-3 min-h-[200px]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading memory...</p>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="kf-card p-8 text-center">
        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
          <Brain className="w-6 h-6 text-primary" />
        </div>
        <h3 className="text-sm font-semibold">No memory events yet</h3>
        <p className="text-xs text-muted-foreground mt-1">KEY records learning as you accept recommendations and run experiments.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!compact && summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="kf-card p-3 text-center">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</div>
            <div className="text-lg font-bold">{summary.totalMemoryEvents}</div>
          </div>
          <div className="kf-card p-3 text-center">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Wins</div>
            <div className="text-lg font-bold text-[hsl(var(--kf-success))]">{summary.successCount}</div>
          </div>
          <div className="kf-card p-3 text-center">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Lessons</div>
            <div className="text-lg font-bold text-[hsl(var(--kf-warning))]">{summary.failureCount}</div>
          </div>
          <div className="kf-card p-3 text-center">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Avg Impact</div>
            <div className="text-lg font-bold">{Math.round(summary.averageImpactScore)}</div>
          </div>
        </div>
      )}

      <div>
        {!compact && (
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            Recent memory
          </h3>
        )}
        <div className="space-y-3">
          {events.map((event, index) => (
            <motion.div
              key={event.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.05 }}
              className="kf-card p-4 flex items-start gap-3"
            >
              <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
                {outcomeIcon(event.outcome)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="text-sm font-semibold">{event.title}</h4>
                  <Badge color={outcomeColor(event.outcome)}>{event.outcome.toLowerCase()}</Badge>
                  {event.impactScore !== 0 && (
                    <Badge color={event.impactScore > 0 ? "mint" : "rose"} className="gap-1">
                      {event.impactScore > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {Math.abs(event.impactScore)}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{event.summary}</p>
                {event.lessons && event.lessons.length > 0 && (
                  <p className="text-xs mt-2 text-primary/80 line-clamp-2">{event.lessons[0].lesson}</p>
                )}
              </div>
              <div className="text-[10px] text-muted-foreground whitespace-nowrap">{formatDate(event.createdAt)}</div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
