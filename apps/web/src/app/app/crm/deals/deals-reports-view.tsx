"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, TrendingUp, AlertTriangle, Target, Filter, BarChart3 } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  fetchDealForecast,
  type Deal,
  type DealForecast,
  type DealVelocityReport,
} from "@/lib/client";
import { fmtMoney } from "./deals-shared";

const RECHARTS_TOOLTIP_STYLE = {
  contentStyle: {
    background: "hsl(var(--popover))",
    border: "1px solid hsl(var(--border)/0.5)",
    borderRadius: "0.5rem",
    color: "hsl(var(--foreground))",
    fontSize: "11px",
    padding: "6px 10px",
  },
  cursor: { fill: "hsl(var(--border)/0.1)" },
};

const FUNNEL_COLORS = ["#0ea5e9", "#6366f1", "#a855f7", "#ec4899", "#f97316"];
const SOURCE_COLORS = ["#10b981", "#0ea5e9", "#a855f7", "#f59e0b", "#ef4444", "#14b8a6", "#ec4899", "#8b5cf6"];
const REASON_COLORS = ["#ef4444", "#f97316", "#f59e0b", "#84cc16", "#10b981", "#14b8a6", "#0ea5e9", "#6366f1"];

interface Props {
  businessId: string;
  forecast: DealForecast | null;
  velocity: DealVelocityReport | null;
  closedDeals: Deal[];
  loading: boolean;
}

interface ForecastPoint { label: string; days: number; weighted: number; unweighted: number; }

export function DealsReportsView({ businessId, forecast, velocity, closedDeals, loading }: Props) {
  const [forecastSeries, setForecastSeries] = useState<ForecastPoint[]>([]);
  const [forecastLoading, setForecastLoading] = useState(false);

  // Pull 30/60/90-day forecast snapshots in parallel for the curve.
  useEffect(() => {
    let cancelled = false;
    let didStart = false;
    const startTimer = setTimeout(() => { didStart = true; if (!cancelled) setForecastLoading(true); }, 0);
    Promise.all([30, 60, 90].map((d) => fetchDealForecast({ windowDays: d }, businessId)))
      .then((results) => {
        if (cancelled) return;
        const points: ForecastPoint[] = results.map((r, i) => {
          const days = [30, 60, 90][i];
          const f = r.data;
          return {
            label: `${days}d`,
            days,
            weighted: f?.expectedCloseWeightedValue ?? 0,
            unweighted: f?.expectedCloseValue ?? 0,
          };
        });
        setForecastSeries(points);
      })
      .finally(() => { if (!cancelled && didStart) setForecastLoading(false); });
    return () => { cancelled = true; clearTimeout(startTimer); };
  }, [businessId, closedDeals.length]); // refetch when underlying deal pool changes

  const currency = forecast?.currency ?? "TTD";

  // Funnel: open + closed counts grouped by stage position
  const funnelData = useMemo(() => {
    if (!forecast) return [];
    const stagesSorted = [...forecast.byStage].sort((a, b) => a.position - b.position);
    const rows = stagesSorted.map((s) => ({
      name: s.stageName,
      count: s.openDeals,
      value: s.totalValue,
      color: FUNNEL_COLORS[s.position % FUNNEL_COLORS.length],
    }));
    const wonCount = closedDeals.filter((d) => d.status === "WON").length;
    rows.push({ name: "Won", count: wonCount, value: closedDeals.filter((d) => d.status === "WON").reduce((acc, d) => acc + (d.value ?? 0), 0), color: "#10b981" });
    return rows;
  }, [forecast, closedDeals]);

  const totalEntered = funnelData[0]?.count ?? 0;

  // Velocity (avg days in stage)
  const velocityData = useMemo(() => {
    if (!velocity) return [];
    return velocity.stages
      .filter((s) => s.category === "OPEN")
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        name: s.stageName,
        avg: s.avgDaysInStage,
        median: s.medianDaysInStage,
        p90: s.p90DaysInStage,
        sample: s.sampleSize,
      }));
  }, [velocity]);

  // Win/loss reasons breakdown
  const reasonRows = useMemo(() => {
    const groups = new Map<string, { kind: "WON" | "LOST"; count: number; value: number }>();
    for (const d of closedDeals) {
      if (d.status !== "WON" && d.status !== "LOST") continue;
      const key = d.wonLostReason?.label ?? (d.status === "WON" ? "Unspecified (won)" : "Unspecified (lost)");
      const k = `${d.status}::${key}`;
      const cur = groups.get(k) ?? { kind: d.status, count: 0, value: 0 };
      cur.count += 1;
      cur.value += d.value ?? 0;
      groups.set(k, cur);
    }
    return Array.from(groups.entries()).map(([k, v]) => ({
      key: k,
      label: k.split("::")[1],
      kind: v.kind,
      count: v.count,
      value: v.value,
    })).sort((a, b) => b.count - a.count);
  }, [closedDeals]);

  const wonReasons = reasonRows.filter((r) => r.kind === "WON");
  const lostReasons = reasonRows.filter((r) => r.kind === "LOST");

  // Win-rate by source
  const sourceData = useMemo(() => {
    const groups = new Map<string, { won: number; lost: number; value: number }>();
    for (const d of closedDeals) {
      if (d.status !== "WON" && d.status !== "LOST") continue;
      const src = d.source?.trim() || "Unknown";
      const cur = groups.get(src) ?? { won: 0, lost: 0, value: 0 };
      if (d.status === "WON") cur.won += 1; else cur.lost += 1;
      cur.value += d.value ?? 0;
      groups.set(src, cur);
    }
    return Array.from(groups.entries()).map(([source, v]) => {
      const total = v.won + v.lost;
      const winRate = total > 0 ? Math.round((v.won / total) * 100) : 0;
      return { source, won: v.won, lost: v.lost, total, winRate, value: v.value };
    }).sort((a, b) => b.total - a.total);
  }, [closedDeals]);

  if (loading && !forecast) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Forecast curve */}
      <section className="rounded-xl border border-border bg-card/40 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4 text-[hsl(var(--kf-accent1))]" /> Weighted forecast curve
          </h2>
          <span className="text-[10px] text-muted-foreground">Next 30 / 60 / 90 days</span>
        </div>
        <div style={{ width: "100%", height: 220 }}>
          {forecastLoading && forecastSeries.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ResponsiveContainer>
              <LineChart data={forecastSeries} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.3)" />
                <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10}
                  tickFormatter={(v) => fmtMoney(v as number, currency)} />
                <Tooltip
                  contentStyle={RECHARTS_TOOLTIP_STYLE.contentStyle}
                  formatter={((value: number, name: string) => [fmtMoney(value, currency), name === "weighted" ? "Weighted" : "Unweighted"]) as never}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="unweighted" name="Unweighted" stroke="#64748b" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="weighted" name="Weighted" stroke="#f97316" strokeWidth={2.5} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Funnel */}
        <section className="rounded-xl border border-border bg-card/40 p-4">
          <h2 className="text-sm font-semibold flex items-center gap-1.5 mb-3">
            <Filter className="w-4 h-4 text-[hsl(var(--kf-accent2))]" /> Conversion funnel
          </h2>
          {funnelData.length === 0 ? (
            <p className="text-xs text-muted-foreground">No stages configured.</p>
          ) : (
            <div className="space-y-1.5">
              {funnelData.map((row, i) => {
                const pct = totalEntered > 0 ? Math.round((row.count / totalEntered) * 100) : 0;
                return (
                  <div key={`${row.name}-${i}`} className="space-y-0.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-medium truncate">{row.name}</span>
                      <span className="text-muted-foreground tabular-nums">{row.count} · {pct}%</span>
                    </div>
                    <div className="h-3 rounded-md bg-muted overflow-hidden">
                      <div className="h-full rounded-md transition-all"
                        style={{ width: `${Math.max(2, pct)}%`, background: row.color }} />
                    </div>
                  </div>
                );
              })}
              <div className="pt-2 mt-2 border-t border-border/40 text-[10px] text-muted-foreground">
                Lead→won conversion: {(() => {
                  const won = funnelData[funnelData.length - 1]?.count ?? 0;
                  const lead = funnelData[0]?.count ?? 0;
                  if (lead === 0) return "—";
                  return `${Math.round((won / lead) * 100)}%`;
                })()}
              </div>
            </div>
          )}
        </section>

        {/* Avg days in stage */}
        <section className="rounded-xl border border-border bg-card/40 p-4">
          <h2 className="text-sm font-semibold flex items-center gap-1.5 mb-3">
            <BarChart3 className="w-4 h-4 text-amber-500" /> Avg days in stage
          </h2>
          {velocityData.length === 0 ? (
            <p className="text-xs text-muted-foreground">No stage velocity data yet.</p>
          ) : (
            <div style={{ width: "100%", height: 220 }}>
              <ResponsiveContainer>
                <BarChart data={velocityData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border)/0.3)" />
                  <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={10} interval={0} angle={-15} textAnchor="end" height={50} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} />
                  <Tooltip contentStyle={RECHARTS_TOOLTIP_STYLE.contentStyle}
                    formatter={((value: number, name: string) => [`${value} days`, name === "avg" ? "Average" : name === "median" ? "Median" : "P90"]) as never} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="avg" name="Average" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="median" name="Median" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        {/* Win/loss reasons */}
        <section className="rounded-xl border border-border bg-card/40 p-4">
          <h2 className="text-sm font-semibold flex items-center gap-1.5 mb-3">
            <AlertTriangle className="w-4 h-4 text-red-500" /> Win / loss reasons
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <ReasonList title="Wins" rows={wonReasons} accent="emerald" />
            <ReasonList title="Losses" rows={lostReasons} accent="red" />
          </div>
        </section>

        {/* Win-rate by source */}
        <section className="rounded-xl border border-border bg-card/40 p-4">
          <h2 className="text-sm font-semibold flex items-center gap-1.5 mb-3">
            <Target className="w-4 h-4 text-[hsl(var(--kf-accent1))]" /> Win-rate by source
          </h2>
          {sourceData.length === 0 ? (
            <p className="text-xs text-muted-foreground">No closed deals in the selected range.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div style={{ width: "100%", height: 200 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={sourceData}
                      dataKey="won"
                      nameKey="source"
                      cx="50%"
                      cy="50%"
                      innerRadius={36}
                      outerRadius={72}
                      paddingAngle={2}
                    >
                      {sourceData.map((_, i) => (
                        <Cell key={i} fill={SOURCE_COLORS[i % SOURCE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={RECHARTS_TOOLTIP_STYLE.contentStyle}
                      formatter={((value: number, name: string) => [`${value} won`, name]) as never} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-1.5 max-h-52 overflow-y-auto">
                {sourceData.map((row, i) => (
                  <div key={row.source} className="flex items-center gap-2 text-[11px]">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: SOURCE_COLORS[i % SOURCE_COLORS.length] }} />
                    <span className="font-medium truncate flex-1">{row.source}</span>
                    <span className="tabular-nums text-muted-foreground">{row.won}/{row.total}</span>
                    <span className={`tabular-nums font-semibold ${row.winRate >= 50 ? "text-emerald-500" : "text-muted-foreground"}`}>
                      {row.winRate}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ReasonList({ title, rows, accent }: { title: string; rows: Array<{ key: string; label: string; count: number; value: number }>; accent: "emerald" | "red" }) {
  const total = rows.reduce((acc, r) => acc + r.count, 0);
  const colorClass = accent === "emerald" ? "bg-emerald-500" : "bg-red-500";
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1">{title} ({total})</div>
      {rows.length === 0 ? (
        <p className="text-[11px] text-muted-foreground/70">No data.</p>
      ) : (
        <div className="space-y-1">
          {rows.slice(0, 8).map((r, i) => {
            const pct = total > 0 ? (r.count / total) * 100 : 0;
            return (
              <div key={r.key}>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="truncate flex-1" style={{ color: REASON_COLORS[i % REASON_COLORS.length] }}>{r.label}</span>
                  <span className="tabular-nums text-muted-foreground">{r.count}</span>
                </div>
                <div className="h-1 rounded-full bg-muted overflow-hidden mt-0.5">
                  <div className={`h-full ${colorClass}`} style={{ width: `${Math.max(2, pct)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
