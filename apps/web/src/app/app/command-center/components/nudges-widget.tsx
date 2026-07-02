"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, Clock, Loader2, ChevronRight } from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import {
  fetchConciergeNudges,
  snoozeConciergeNudge,
  type NudgeItem,
} from "@/lib/api/onboarding-concierge";

interface NudgesWidgetProps {
  businessId: string;
}

export function NudgesWidget({ businessId }: NudgesWidgetProps) {
  const [nudges, setNudges] = useState<NudgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [snoozing, setSnoozing] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
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
      <SectionCard title="Concierge Nudges" icon={Sparkles} compact>
        <div className="p-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading nudges…
        </div>
      </SectionCard>
    );
  }

  if (nudges.length === 0) {
    return null;
  }

  return (
    <SectionCard title="Concierge Nudges" icon={Sparkles} compact>
      <div className="p-3 space-y-2">
        {nudges.slice(0, 5).map((nudge) => (
          <div
            key={nudge.id}
            className="rounded-xl border border-border/30 bg-card/40 p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-medium">{nudge.title}</h4>
                <p className="text-xs text-muted-foreground mt-0.5">{nudge.body}</p>
                {nudge.ctaHref && (
                  <Link
                    href={nudge.ctaHref}
                    className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-[hsl(var(--kf-accent1))] hover:underline"
                  >
                    {nudge.ctaLabel} <ChevronRight className="w-3 h-3" />
                  </Link>
                )}
              </div>
              {nudge.snoozable && (
                <button
                  onClick={() => void handleSnooze(nudge.id)}
                  disabled={snoozing.has(nudge.id)}
                  className="flex-shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-50 transition-colors"
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
    </SectionCard>
  );
}
