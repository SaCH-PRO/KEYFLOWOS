"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, Clock, Loader2, ChevronRight, Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { Surface } from "@/components/ui-v2/surface";
import { Badge } from "@/components/ui-v2/badge";
import {
  fetchConciergeNudges,
  snoozeConciergeNudge,
  type NudgeItem,
} from "@/lib/api/onboarding-concierge";

interface NudgesWidgetV2Props {
  businessId: string;
}

export function NudgesWidgetV2({ businessId }: NudgesWidgetV2Props) {
  const [nudges, setNudges] = useState<NudgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [snoozing, setSnoozing] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    fetchConciergeNudges(businessId).then(({ data }) => {
      if (cancelled) return;
      setNudges(data ?? []);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  const handleSnooze = async (nudgeId: string) => {
    setSnoozing((prev) => new Set(prev).add(nudgeId));
    const { data } = await snoozeConciergeNudge(businessId, nudgeId, 7);
    if (data?.snoozed) {
      setNudges((prev) => prev.filter((n) => n.id !== nudgeId));
    }
    setSnoozing((prev) => {
      const next = new Set(prev);
      next.delete(nudgeId);
      return next;
    });
  };

  if (loading) {
    return (
      <Surface className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading nudges…
      </Surface>
    );
  }

  if (nudges.length === 0) {
    return null;
  }

  return (
    <Surface className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gold/15">
            <Sparkles className="h-3.5 w-3.5 text-gold-foreground" />
          </div>
          <h3 className="font-display text-sm font-semibold text-foreground">Concierge Nudges</h3>
        </div>
        <Badge color="gold">
          <Bell className="h-3 w-3 mr-1" />
          {nudges.length}
        </Badge>
      </div>

      <div className="space-y-2">
        {nudges.slice(0, 5).map((nudge) => (
          <div
            key={nudge.id}
            className="rounded-xl border border-border/40 bg-surface-muted p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-medium text-foreground">{nudge.title}</h4>
                <p className="text-xs text-muted-foreground mt-0.5">{nudge.body}</p>
                {nudge.ctaHref && (
                  <Link
                    href={nudge.ctaHref}
                    className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-primary hover:underline"
                  >
                    {nudge.ctaLabel} <ChevronRight className="w-3 h-3" />
                  </Link>
                )}
              </div>
              {nudge.snoozable && (
                <button
                  onClick={() => void handleSnooze(nudge.id)}
                  disabled={snoozing.has(nudge.id)}
                  className={cn(
                    "flex-shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-xl text-muted-foreground transition-colors",
                    "hover:bg-muted disabled:opacity-50 focus-ring",
                  )}
                  aria-label="Snooze nudge"
                  title="Snooze for 7 days"
                >
                  {snoozing.has(nudge.id) ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Clock className="w-3.5 h-3.5" />
                  )}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </Surface>
  );
}
