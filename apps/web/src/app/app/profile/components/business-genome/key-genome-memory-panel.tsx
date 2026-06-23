"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Brain, Loader2, TrendingUp, TrendingDown, Minus, AlertTriangle, BookOpen } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  getGenomeLearningSummary,
  listGenomeMemoryEvents,
  type GenomeLearningSummary,
  type GenomeMemoryEventData,
} from "@/lib/api/business-genome";

const fade = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2 },
};

function formatDelta(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(0)}%`;
}

function eventTypeLabel(type: string) {
  return type
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function outcomeBadge(outcome: string) {
  switch (outcome) {
    case "SUCCESS":
      return <StatusBadge status="success" label="Success" />;
    case "FAILURE":
      return <StatusBadge status="error" label="Failure" />;
    case "MIXED":
      return <StatusBadge status="warning" label="Mixed" />;
    default:
      return <StatusBadge status="neutral" label="Unknown" />;
  }
}

interface KeyGenomeMemoryPanelProps {
  onGenomeUpdate?: () => void;
}

export function KeyGenomeMemoryPanel({ onGenomeUpdate }: KeyGenomeMemoryPanelProps) {
  const [summary, setSummary] = useState<GenomeLearningSummary | null>(null);
  const [events, setEvents] = useState<GenomeMemoryEventData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const businessId = getStoredBusinessId();

  const refresh = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [summaryResult, eventsResult] = await Promise.all([
      getGenomeLearningSummary(businessId),
      listGenomeMemoryEvents(businessId, { limit: 50 }),
    ]);
    if (summaryResult.error || !summaryResult.data) {
      setError(summaryResult.error || "Failed to load memory summary");
    } else if (eventsResult.error || !eventsResult.data) {
      setError(eventsResult.error || "Failed to load memory events");
    } else {
      setSummary(summaryResult.data);
      setEvents(eventsResult.data);
      setError(null);
    }
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (loading) {
    return (
      <div className="kf-card p-12 flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading Business Memory...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="kf-card p-8 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <button
          onClick={() => void refresh()}
          className="mt-4 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!summary || events.length === 0) {
    return (
      <EmptyState
        icon={Brain}
        title="No business memory yet"
        description="KEY will record outcomes from recommendations, experiments, signals, and actions here as durable learning."
        variant="compact"
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Brain className="w-4 h-4 text-muted-foreground" />
          Business Memory
        </h3>
        <span className="text-xs text-muted-foreground">{summary.totalMemoryEvents} recorded</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="kf-card p-3 space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
            Successes
          </div>
          <p className="text-2xl font-semibold">{summary.successCount}</p>
        </div>
        <div className="kf-card p-3 space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <TrendingDown className="w-3.5 h-3.5 text-rose-500" />
            Failures
          </div>
          <p className="text-2xl font-semibold">{summary.failureCount}</p>
        </div>
        <div className="kf-card p-3 space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Minus className="w-3.5 h-3.5 text-amber-500" />
            Mixed
          </div>
          <p className="text-2xl font-semibold">{summary.mixedCount}</p>
        </div>
        <div className="kf-card p-3 space-y-1">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <AlertTriangle className="w-3.5 h-3.5 text-neutral-500" />
            Unknown
          </div>
          <p className="text-2xl font-semibold">{summary.unknownCount}</p>
        </div>
      </div>

      {(summary.topLessons?.length ?? 0) > 0 && (
        <div className="kf-card p-4 space-y-3">
          <h4 className="text-xs font-medium flex items-center gap-2">
            <BookOpen className="w-3.5 h-3.5 text-muted-foreground" />
            Top Lessons
          </h4>
          <ul className="space-y-2">
            {summary.topLessons.slice(0, 5).map((lesson, idx) => (
              <li key={idx} className="text-sm flex items-start gap-2">
                <span className="text-muted-foreground">&bull;</span>
                <span>{lesson.lesson}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-3">
        {events.map((event) => (
          <motion.div key={event.id} {...fade} className="kf-card p-4 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  {outcomeBadge(event.outcome)}
                  <span className="text-xs font-medium text-muted-foreground">
                    {eventTypeLabel(event.eventType)}
                  </span>
                  {event.domain && (
                    <span className="text-xs text-muted-foreground">{event.domain}</span>
                  )}
                </div>
                <p className="text-sm font-medium leading-snug">{event.title}</p>
                <p className="text-xs text-muted-foreground mt-1">{event.summary}</p>
              </div>
            </div>
            {(event.impactScore !== 0 || event.confidenceDelta !== 0) && (
              <div className="flex items-center gap-3 text-xs">
                <span className="text-muted-foreground">
                  Impact: <span className="font-medium">{Math.round(event.impactScore * 100)}%</span>
                </span>
                <span className="text-muted-foreground">
                  Confidence:{" "}
                  <span
                    className={`font-medium ${
                      event.confidenceDelta > 0
                        ? "text-emerald-600"
                        : event.confidenceDelta < 0
                          ? "text-rose-600"
                          : "text-muted-foreground"
                    }`}
                  >
                    {formatDelta(event.confidenceDelta)}
                  </span>
                </span>
              </div>
            )}
            {(event.lessons?.length ?? 0) > 0 && (
              <div className="text-xs text-muted-foreground space-y-1">
                {event.lessons?.slice(0, 2).map((lesson, idx) => (
                  <p key={idx}>&bull; {lesson.lesson}</p>
                ))}
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
}
