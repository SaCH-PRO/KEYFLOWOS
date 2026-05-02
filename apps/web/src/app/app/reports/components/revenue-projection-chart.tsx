"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { TrendingUp, RefreshCw, ShieldCheck } from "lucide-react";
import { InfoBadge } from "@/components/ui/info-badge";
import { Card } from "@keyflow/ui";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Legend } from "recharts";
import { fetchCashFlowForecast, type CashFlowForecast } from "@/lib/client";
import { formatCurrency } from "./report-types";
import { getStoredBusinessId } from "@/lib/workspace";

interface RevenueProjectionChartProps {
  businessId?: string | null;
  currency?: string;
  currentRevenue?: number;
  periodStart?: string;
  periodEnd?: string;
  invoiceCount?: number;
}

interface ChartPoint {
  label: string;
  historical: number | null;
  projected: number | null;
}

function computeConfidence(forecast: CashFlowForecast, historicalDays: number): { level: string; pct: number; color: string } {
  const rate = forecast.dailyRevenueRate ?? 0;
  const alerts = forecast.alerts?.length ?? 0;
  const negDays = forecast.daysUntilNegative;

  let score = 55;
  if (rate > 0) score += 10;
  if (alerts === 0) score += 8;
  if (negDays === null || negDays > 60) score += 7;
  else if (negDays <= 14) score -= 15;
  if (historicalDays >= 30) score += 10;
  else if (historicalDays >= 14) score += 5;

  score = Math.max(20, Math.min(95, score));

  if (score >= 75) return { level: "High", pct: score, color: "--kf-success" };
  if (score >= 50) return { level: "Medium", pct: score, color: "--kf-warning" };
  return { level: "Low", pct: score, color: "--kf-error" };
}

type Granularity = "daily" | "weekly" | "monthly";

export function RevenueProjectionChart({
  businessId: propBusinessId,
  currency = "TTD",
  currentRevenue = 0,
  periodStart,
  periodEnd,
  invoiceCount: _invoiceCount,
}: RevenueProjectionChartProps) {
  const [forecast, setForecast] = useState<CashFlowForecast | null>(null);
  const [loading, setLoading] = useState(false);
  const [granularity, setGranularity] = useState<Granularity>("daily");

  const load = useCallback(async () => {
    const bId = propBusinessId ?? getStoredBusinessId();
    if (!bId) return;
    setLoading(true);
    try {
      const res = await fetchCashFlowForecast(bId, 90);
      if (res.data) setForecast(res.data);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [propBusinessId]);

  useEffect(() => { load(); }, [load]);

  const { chartData, milestones, confidence } = useMemo(() => {
    if (!forecast) return { chartData: [] as ChartPoint[], milestones: [] as { label: string; value: number }[], confidence: null, historicalDays: 0 };

    const dailyRate = forecast.dailyRevenueRate ?? 0;

    let hDays = 30;
    if (periodStart && periodEnd) {
      const start = new Date(periodStart);
      const end = new Date(periodEnd);
      hDays = Math.max(7, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
    }
    hDays = Math.min(hDays, 90);

    const step = granularity === "monthly" ? 30 : granularity === "weekly" ? 7 : 1;
    const historicalDailyRate = hDays > 0 ? currentRevenue / hDays : 0;
    const points: ChartPoint[] = [];

    for (let d = 0; d <= hDays; d += step) {
      const rev = Math.round(historicalDailyRate * d * 100) / 100;
      const dayLabel = d === 0 ? `-${hDays}d` : d >= hDays ? "Today" : `-${hDays - d}d`;
      points.push({
        label: dayLabel,
        historical: rev,
        projected: d >= hDays ? rev : null,
      });
    }
    if (points.length > 0 && points[points.length - 1].label !== "Today") {
      const rev = Math.round(historicalDailyRate * hDays * 100) / 100;
      points.push({ label: "Today", historical: rev, projected: rev });
    }

    for (let d = step; d <= 90; d += step) {
      const projected = currentRevenue + dailyRate * d;
      points.push({
        label: `+${d}d`,
        historical: null,
        projected: Math.round(projected * 100) / 100,
      });
    }

    const ms = [
      { label: "30-Day", value: Math.round(currentRevenue + dailyRate * 30) },
      { label: "60-Day", value: Math.round(currentRevenue + dailyRate * 60) },
      { label: "90-Day", value: Math.round(currentRevenue + dailyRate * 90) },
    ];

    return { chartData: points, milestones: ms, confidence: computeConfidence(forecast, hDays), historicalDays: hDays };
  }, [forecast, currentRevenue, periodStart, periodEnd, granularity]);

  if (!forecast && !loading) return null;

  return (
    <Card className="p-4 backdrop-blur border-border/60" style={{ background: "hsl(var(--kf-card) / 0.6)" }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
          <h3 className="text-sm font-semibold inline-flex items-center gap-1">Revenue Trend & Projections <InfoBadge title="Cash Flow Projections" body="Projections are based on your historical invoice collection rate and upcoming recurring expenses. The confidence score reflects data quality — more history means higher confidence. Dotted lines indicate projected values." side="bottom" iconSize={11} /></h3>
          {confidence && (
            <span
              className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full font-medium"
              style={{ background: `hsl(var(${confidence.color}) / 0.1)`, color: `hsl(var(${confidence.color}))` }}
            >
              <ShieldCheck className="w-2.5 h-2.5" />
              {confidence.pct}% {confidence.level}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg overflow-hidden border border-border/40">
            {(["daily", "weekly", "monthly"] as Granularity[]).map(g => (
              <button
                key={g}
                onClick={() => setGranularity(g)}
                className={`text-[10px] px-2 min-h-[28px] transition-colors capitalize ${
                  granularity === g
                    ? "bg-[hsl(var(--kf-accent1))]/20 text-[hsl(var(--kf-accent1))] font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/20"
                }`}
              >
                {g.charAt(0).toUpperCase() + g.slice(1, 3)}
              </button>
            ))}
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="text-[10px] flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 min-w-[44px] min-h-[44px] justify-center"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {loading && !forecast ? (
        <div className="h-[220px] rounded-lg bg-muted/20 animate-pulse" />
      ) : (
        <>
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <XAxis
                  dataKey="label"
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                  tickLine={false}
                  axisLine={{ stroke: "hsl(var(--border) / 0.3)" }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `${Math.round(v / 1000)}k`}
                  width={45}
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--kf-card))",
                    border: "1px solid hsl(var(--kf-border) / 0.4)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={((value: number, name: string) => [
                    formatCurrency(value, currency),
                    name === "historical" ? "Historical" : "Projected",
                  ]) as any}
                  labelFormatter={(label) => {
                    if (label === "Today") return "Today (current)";
                    if (label.startsWith("-")) return `${label} ago`;
                    if (label.startsWith("+")) return `${label} ahead`;
                    return label;
                  }}
                />
                <Legend
                  formatter={(value: string) => (
                    <span style={{ fontSize: 10, color: "hsl(var(--muted-foreground))" }}>
                      {value === "historical" ? "Historical Revenue" : "Projected Revenue"}
                    </span>
                  )}
                />
                <ReferenceLine y={currentRevenue} stroke="hsl(var(--kf-accent1) / 0.4)" strokeDasharray="4 4" label="" />
                <Line
                  type="monotone"
                  dataKey="historical"
                  stroke="hsl(var(--kf-accent1))"
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                  name="historical"
                />
                <Line
                  type="monotone"
                  dataKey="projected"
                  stroke="hsl(var(--kf-accent2))"
                  strokeWidth={2}
                  strokeDasharray="6 3"
                  dot={false}
                  connectNulls
                  name="projected"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-border/30">
            <div className="flex gap-4">
              {milestones.map((m) => (
                <div key={m.label} className="text-center">
                  <p className="text-[10px] text-muted-foreground">{m.label}</p>
                  <p className="text-xs font-semibold" style={{ color: "hsl(var(--kf-accent2))" }}>
                    {formatCurrency(m.value, currency)}
                  </p>
                </div>
              ))}
            </div>
            {forecast?.trend && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                style={{
                  background: forecast.trend === "growing"
                    ? "hsl(var(--kf-success) / 0.1)"
                    : forecast.trend === "declining"
                      ? "hsl(var(--kf-error) / 0.1)"
                      : "hsl(var(--kf-info) / 0.1)",
                  color: forecast.trend === "growing"
                    ? "hsl(var(--kf-success))"
                    : forecast.trend === "declining"
                      ? "hsl(var(--kf-error))"
                      : "hsl(var(--kf-info))",
                }}
              >
                {forecast.trend}
              </span>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
