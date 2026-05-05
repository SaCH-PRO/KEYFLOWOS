"use client";

import { useEffect, useState } from "react";
import {
  Sparkles,
  AlertTriangle,
  TrendingUp,
  Clock,
  CalendarRange,
} from "lucide-react";
import {
  fetchCalendarConflicts,
  fetchCalendarInsights,
  type CalendarConflictResponse,
  type CalendarInsightsResponse,
} from "@/lib/client";
import { fmtMoney } from "./calendar-utils";

interface Props {
  businessId: string;
  rangeFrom: Date;
  rangeTo: Date;
  reloadKey: number;
}

export function TimeIntelligenceRail({ businessId, rangeFrom, rangeTo, reloadKey }: Props) {
  const [insights, setInsights] = useState<CalendarInsightsResponse | null>(null);
  const [conflicts, setConflicts] = useState<CalendarConflictResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading flag tied to async fetch
    setLoading(true);
    Promise.all([
      fetchCalendarInsights(businessId, rangeFrom.toISOString(), rangeTo.toISOString()),
      fetchCalendarConflicts(businessId, rangeFrom.toISOString(), rangeTo.toISOString()),
    ])
      .then(([insightsRes, conflictsRes]) => {
        if (cancelled) return;
        setInsights(insightsRes.data ?? null);
        setConflicts(conflictsRes.data ?? null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [businessId, rangeFrom, rangeTo, reloadKey]);

  return (
    <aside className="kf-card p-3 space-y-3 text-xs">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
        <h4 className="text-xs font-semibold">Time Intelligence</h4>
        <span className="ml-auto text-[10px] text-muted-foreground">Beta</span>
      </div>

      <div className="rounded-lg border border-border/40 p-2.5 space-y-1">
        <div className="flex items-center gap-1.5 text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
          <CalendarRange className="w-3 h-3" />
          Range summary
        </div>
        {loading ? (
          <div className="text-muted-foreground">Loading…</div>
        ) : insights ? (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Events</span>
              <span className="font-medium">{insights.totalEvents}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Expected revenue</span>
              <span className="font-medium text-emerald-400">
                {fmtMoney(insights.totalRevenue, "USD")}
              </span>
            </div>
          </div>
        ) : (
          <div className="text-muted-foreground italic">No data yet.</div>
        )}
      </div>

      <div className="rounded-lg border border-border/40 p-2.5 space-y-1.5">
        <div className="flex items-center gap-1.5 text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
          <AlertTriangle className="w-3 h-3" />
          Conflicts
        </div>
        {loading ? (
          <div className="text-muted-foreground">Scanning…</div>
        ) : conflicts && conflicts.conflicts.length > 0 ? (
          <div className="space-y-1.5">
            {conflicts.conflicts.slice(0, 4).map((c, idx) => (
              <div key={idx} className="text-[11px] leading-snug">
                <div className="font-medium truncate">{c.left.title}</div>
                <div className="text-muted-foreground truncate">↔ {c.right.title}</div>
                <div className="text-[9px] text-amber-400">{c.reason}</div>
              </div>
            ))}
            {conflicts.conflicts.length > 4 && (
              <div className="text-[10px] text-muted-foreground">
                +{conflicts.conflicts.length - 4} more
              </div>
            )}
          </div>
        ) : (
          <div className="text-muted-foreground italic">No overlaps detected.</div>
        )}
      </div>

      <div className="rounded-lg border border-border/40 p-2.5 space-y-1.5">
        <div className="flex items-center gap-1.5 text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
          <TrendingUp className="w-3 h-3" />
          Top modules
        </div>
        {insights && insights.byModule.length > 0 ? (
          <div className="space-y-1">
            {insights.byModule.slice(0, 5).map((row) => (
              <div key={row.key} className="flex items-center justify-between">
                <span className="capitalize">{row.key}</span>
                <span className="text-muted-foreground">
                  {row.count} · {fmtMoney(row.revenue, "USD")}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-muted-foreground italic">No activity.</div>
        )}
      </div>

      <div className="rounded-lg border border-border/40 p-2.5 space-y-1">
        <div className="flex items-center gap-1.5 text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
          <Clock className="w-3 h-3" />
          Hints
        </div>
        {insights && insights.hints.length > 0 ? (
          <ul className="space-y-1 list-disc list-inside text-muted-foreground">
            {insights.hints.slice(0, 4).map((h, i) => (
              <li key={i}>{h.message}</li>
            ))}
          </ul>
        ) : (
          <div className="text-muted-foreground italic">
            AI insights, daily plan, and reschedule suggestions land here in C7.
          </div>
        )}
      </div>
    </aside>
  );
}
