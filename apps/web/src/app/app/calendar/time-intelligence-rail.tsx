"use client";

import { useEffect, useState } from "react";
import {
  Sparkles,
  AlertTriangle,
  TrendingUp,
  Clock,
  CalendarRange,
  CheckCircle2,
  RefreshCw,
  BarChart3,
} from "lucide-react";
import {
  fetchCalendarConflicts,
  fetchCalendarDailyPlan,
  fetchCalendarInsights,
  fetchCalendarWeeklyCapacity,
  type CalendarConflictResponse,
  type CalendarDailyPlan,
  type CalendarInsightsResponse,
  type CalendarWeeklyCapacity,
} from "@/lib/client";
import { fmtMoney } from "./calendar-utils";

interface Props {
  businessId: string;
  rangeFrom: Date;
  rangeTo: Date;
  reloadKey: number;
}

const SEVERITY_COLOR: Record<string, string> = {
  high: "text-rose-400",
  medium: "text-amber-400",
  low: "text-yellow-400",
};

export function TimeIntelligenceRail({ businessId, rangeFrom, rangeTo, reloadKey }: Props) {
  const [insights, setInsights] = useState<CalendarInsightsResponse | null>(null);
  const [conflicts, setConflicts] = useState<CalendarConflictResponse | null>(null);
  const [dailyPlan, setDailyPlan] = useState<CalendarDailyPlan | null>(null);
  const [weekly, setWeekly] = useState<CalendarWeeklyCapacity | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchCalendarInsights(businessId, rangeFrom.toISOString(), rangeTo.toISOString()),
      fetchCalendarConflicts(businessId, rangeFrom.toISOString(), rangeTo.toISOString()),
      fetchCalendarDailyPlan(businessId),
      fetchCalendarWeeklyCapacity(businessId),
    ])
      .then(([insightsRes, conflictsRes, planRes, weeklyRes]) => {
        if (cancelled) return;
        setInsights(insightsRes.data ?? null);
        setConflicts(conflictsRes.data ?? null);
        setDailyPlan(planRes.data ?? null);
        setWeekly(weeklyRes.data ?? null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [businessId, rangeFrom, rangeTo, reloadKey]);

  const refreshAi = async () => {
    setRefreshing(true);
    try {
      const [planRes, weeklyRes] = await Promise.all([
        fetchCalendarDailyPlan(businessId, undefined, { refresh: true }),
        fetchCalendarWeeklyCapacity(businessId, undefined, { refresh: true }),
      ]);
      if (planRes.data) setDailyPlan(planRes.data);
      if (weeklyRes.data) setWeekly(weeklyRes.data);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <aside className="kf-card p-3 space-y-3 text-xs">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
        <h4 className="text-xs font-semibold">Time Intelligence</h4>
        <button
          type="button"
          onClick={refreshAi}
          disabled={refreshing}
          className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
          aria-label="Refresh AI insights"
        >
          <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Refreshing" : "Refresh"}
        </button>
      </div>

      <div className="rounded-lg border border-border/40 p-2.5 space-y-1.5">
        <div className="flex items-center gap-1.5 text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
          <Sparkles className="w-3 h-3" />
          Today's plan
        </div>
        {loading && !dailyPlan ? (
          <div className="text-muted-foreground">Generating…</div>
        ) : dailyPlan ? (
          <div className="space-y-1.5">
            <div className="text-foreground font-medium">{dailyPlan.greeting}</div>
            <div className="text-muted-foreground leading-snug">{dailyPlan.summary}</div>
            {dailyPlan.topPriorities.length > 0 && (
              <ul className="space-y-1 mt-1">
                {dailyPlan.topPriorities.slice(0, 3).map((p, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <CheckCircle2 className="w-3 h-3 mt-0.5 text-emerald-400/80 flex-shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium truncate">{p.title}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{p.why}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {dailyPlan.warnings.length > 0 && (
              <div className="mt-1.5 text-[10px] text-amber-400">
                ⚠ {dailyPlan.warnings[0]}
              </div>
            )}
          </div>
        ) : (
          <div className="text-muted-foreground italic">No plan available.</div>
        )}
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
                {fmtMoney(insights.totalRevenue, "TTD")}
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
          {conflicts && conflicts.conflicts.length > 0 && (
            <span className="ml-auto text-rose-400 font-semibold">
              {conflicts.conflicts.length}
            </span>
          )}
        </div>
        {loading ? (
          <div className="text-muted-foreground">Scanning…</div>
        ) : conflicts && conflicts.conflicts.length > 0 ? (
          <div className="space-y-1.5">
            {conflicts.conflicts.slice(0, 5).map((c, idx) => (
              <div key={idx} className="text-[11px] leading-snug">
                <div className="flex items-center gap-1">
                  <span
                    className={`text-[9px] uppercase tracking-wide font-semibold ${
                      SEVERITY_COLOR[c.severity] ?? "text-amber-400"
                    }`}
                  >
                    {c.severity}
                  </span>
                  <span className="text-[9px] text-muted-foreground">· {c.kind}</span>
                </div>
                <div className="text-muted-foreground">{c.message}</div>
              </div>
            ))}
            {conflicts.conflicts.length > 5 && (
              <div className="text-[10px] text-muted-foreground">
                +{conflicts.conflicts.length - 5} more
              </div>
            )}
          </div>
        ) : (
          <div className="text-muted-foreground italic">All clear.</div>
        )}
      </div>

      <div className="rounded-lg border border-border/40 p-2.5 space-y-1.5">
        <div className="flex items-center gap-1.5 text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
          <BarChart3 className="w-3 h-3" />
          Weekly capacity
        </div>
        {weekly ? (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Scheduled</span>
              <span className="font-medium">{weekly.totalScheduledHours.toFixed(1)}h</span>
            </div>
            <div className="grid grid-cols-7 gap-0.5 mt-1">
              {weekly.byDay.map((d) => {
                const pct = Math.min(100, Math.max(2, d.capacityPct));
                const overloaded = weekly.overloadedDays.includes(d.date);
                const color = overloaded
                  ? "bg-rose-500/70"
                  : d.capacityPct > 60
                    ? "bg-emerald-500/60"
                    : "bg-blue-500/40";
                const label = new Date(d.date).toLocaleDateString("en-US", {
                  weekday: "narrow",
                });
                return (
                  <div key={d.date} className="flex flex-col items-center gap-0.5">
                    <div className="h-12 w-full bg-muted/30 rounded-sm flex items-end overflow-hidden">
                      <div className={`w-full ${color}`} style={{ height: `${pct}%` }} />
                    </div>
                    <span className="text-[8px] text-muted-foreground">{label}</span>
                  </div>
                );
              })}
            </div>
            {weekly.recommendations.length > 0 && (
              <div className="text-[10px] text-muted-foreground mt-1.5">
                💡 {weekly.recommendations[0]}
              </div>
            )}
          </div>
        ) : (
          <div className="text-muted-foreground italic">Calculating…</div>
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
                  {row.count} · {fmtMoney(row.revenue, "TTD")}
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
          <div className="text-muted-foreground italic">No hints.</div>
        )}
      </div>
    </aside>
  );
}
