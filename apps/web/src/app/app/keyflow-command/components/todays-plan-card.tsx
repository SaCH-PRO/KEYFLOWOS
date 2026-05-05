"use client";

import { useEffect, useState } from "react";
import { Sparkles, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import {
  fetchCalendarDailyPlan,
  type CalendarDailyPlan,
} from "@/lib/client";

interface Props {
  businessId: string;
}

export function TodaysPlanCard({ businessId }: Props) {
  const [plan, setPlan] = useState<CalendarDailyPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (refresh = false) => {
    if (!businessId) return;
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fetchCalendarDailyPlan(businessId, undefined, { refresh });
      if (res.data) setPlan(res.data);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  if (!businessId) return null;

  return (
    <div className="kf-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
        <h3 className="text-sm font-semibold">Today's Plan</h3>
        <span className="text-[10px] text-muted-foreground">AI · refreshes hourly</span>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={refreshing}
          className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
          aria-label="Refresh today's plan"
        >
          <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Refreshing" : "Refresh"}
        </button>
      </div>

      {loading && !plan ? (
        <div className="text-xs text-muted-foreground">Generating your plan…</div>
      ) : plan ? (
        <div className="space-y-2.5 text-xs">
          <div>
            <div className="text-sm font-medium">{plan.greeting}</div>
            <div className="text-muted-foreground mt-0.5 leading-snug">{plan.summary}</div>
          </div>

          {plan.topPriorities.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
                Top priorities
              </div>
              <ul className="space-y-1.5">
                {plan.topPriorities.slice(0, 5).map((p, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-emerald-400/80 flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium">{p.title}</div>
                      <div className="text-[11px] text-muted-foreground">{p.why}</div>
                      {p.suggestedTime && (
                        <div className="text-[10px] text-amber-400 mt-0.5">
                          Suggested: {p.suggestedTime}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {plan.focusBlocks.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
                Focus blocks
              </div>
              <div className="flex flex-wrap gap-1.5">
                {plan.focusBlocks.map((b, i) => {
                  const start = new Date(b.startAt).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  });
                  const end = new Date(b.endAt).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  });
                  return (
                    <span
                      key={i}
                      className="text-[10px] px-2 py-0.5 rounded-full border border-border/50"
                    >
                      {b.label} · {start}–{end}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {plan.warnings.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] uppercase font-semibold text-amber-400 tracking-wider inline-flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Watch outs
              </div>
              <ul className="space-y-0.5 text-[11px] text-amber-400/90">
                {plan.warnings.slice(0, 3).map((w, i) => (
                  <li key={i}>• {w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground italic">No plan available.</div>
      )}
    </div>
  );
}
