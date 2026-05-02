"use client";

import { useState, useEffect, useCallback } from "react";
import { TrendingUp, TrendingDown, Minus, AlertTriangle, RefreshCw, ShieldCheck, DollarSign, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Card } from "@keyflow/ui";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { fetchCashFlowForecast, type CashFlowForecast } from "@/lib/client";
import { formatCurrency } from "./report-types";

interface CashFlowForecastViewProps {
  businessId: string | null;
  currency?: string;
}

interface ForecastPoint {
  day: string;
  balance: number;
}

function computeConfidence(forecast: CashFlowForecast): { level: string; pct: number; color: string } {
  const rate = forecast.dailyRevenueRate ?? 0;
  const alerts = forecast.alerts?.length ?? 0;
  const negDays = forecast.daysUntilNegative;

  let score = 70;
  if (rate > 0) score += 10;
  if (alerts === 0) score += 10;
  if (negDays === null || negDays > 60) score += 10;
  else if (negDays <= 14) score -= 20;

  score = Math.max(20, Math.min(95, score));

  if (score >= 75) return { level: "High", pct: score, color: "--kf-success" };
  if (score >= 50) return { level: "Medium", pct: score, color: "--kf-warning" };
  return { level: "Low", pct: score, color: "--kf-error" };
}

const TREND_CONFIG: Record<string, { icon: typeof TrendingUp; color: string; label: string }> = {
  growing: { icon: TrendingUp, color: "--kf-success", label: "Growing" },
  declining: { icon: TrendingDown, color: "--kf-error", label: "Declining" },
  stable: { icon: Minus, color: "--kf-info", label: "Stable" },
};

export function CashFlowForecastView({ businessId, currency = "TTD" }: CashFlowForecastViewProps) {
  const [forecast, setForecast] = useState<CashFlowForecast | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await fetchCashFlowForecast(businessId, 90);
      if (res.data) setForecast(res.data);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  if (!forecast && !loading) return null;

  const trendKey = forecast?.trend?.toLowerCase() ?? "stable";
  const trend = TREND_CONFIG[trendKey] ?? TREND_CONFIG.stable;
  const TrendIcon = trend.icon;
  const confidence = forecast ? computeConfidence(forecast) : null;
  const netDaily = (forecast?.dailyRevenueRate ?? 0) - (forecast?.dailyExpenseRate ?? 0);

  const chartData: ForecastPoint[] = [];
  if (forecast) {
    const start = forecast.currentBalance;
    for (let d = 0; d <= 90; d++) {
      chartData.push({
        day: d === 0 ? "Now" : d % 30 === 0 ? `${d}d` : d % 10 === 0 ? `${d}d` : `${d}`,
        balance: Math.round((start + netDaily * d) * 100) / 100,
      });
    }
  }

  const negativeDay = forecast?.daysUntilNegative;
  const hasWarning = negativeDay !== null && negativeDay !== undefined && negativeDay <= 90;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DollarSign className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          <h3 className="text-sm font-semibold">Cash Flow Forecast</h3>
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
        <button
          onClick={load}
          disabled={loading}
          className="text-[10px] flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 min-w-[44px] min-h-[44px] justify-center"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {loading && !forecast ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 rounded-xl bg-muted/20 animate-pulse" />
          ))}
        </div>
      ) : forecast ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricCard
              label="Current Balance"
              value={formatCurrency(forecast.currentBalance, currency)}
              color="--kf-accent1"
            />
            <MetricCard
              label="Projected (90d)"
              value={formatCurrency(forecast.projectedBalance, currency)}
              color={forecast.projectedBalance >= forecast.currentBalance ? "--kf-success" : "--kf-error"}
              change={forecast.projectedBalance - forecast.currentBalance}
              currency={currency}
            />
            <MetricCard
              label="Daily Inflow"
              value={formatCurrency(forecast.dailyRevenueRate, currency)}
              color="--kf-success"
              icon={ArrowUpRight}
            />
            <MetricCard
              label="Daily Outflow"
              value={formatCurrency(forecast.dailyExpenseRate, currency)}
              color="--kf-error"
              icon={ArrowDownRight}
            />
          </div>

          <Card className="p-4 backdrop-blur border-border/60" style={{ background: "hsl(var(--kf-card) / 0.6)" }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <TrendIcon className="w-3.5 h-3.5" style={{ color: `hsl(var(${trend.color}))` }} />
                <span className="text-xs font-medium">90-Day Balance Projection</span>
              </div>
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                style={{
                  background: `hsl(var(${trend.color}) / 0.1)`,
                  color: `hsl(var(${trend.color}))`,
                }}
              >
                {trend.label}
              </span>
            </div>
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                  <defs>
                    <linearGradient id="cashFlowGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--kf-accent2))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--kf-accent2))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="day"
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
                    width={50}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--kf-card))",
                      border: "1px solid hsl(var(--kf-border) / 0.4)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reports payload — pending typed reporting schema
                    formatter={((value: number) => [formatCurrency(value, currency), "Balance"]) as any}
                    labelFormatter={(label) => `Day: ${label}`}
                  />
                  <ReferenceLine y={0} stroke="hsl(var(--kf-error) / 0.5)" strokeDasharray="4 4" />
                  <Area
                    type="monotone"
                    dataKey="balance"
                    stroke="hsl(var(--kf-accent2))"
                    strokeWidth={2}
                    fill="url(#cashFlowGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {hasWarning && (
            <div
              className="flex items-center gap-2.5 p-3 rounded-xl text-xs"
              style={{
                background: "hsl(var(--kf-error) / 0.08)",
                border: "1px solid hsl(var(--kf-error) / 0.2)",
                color: "hsl(var(--kf-error))",
              }}
            >
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <div>
                <p className="font-medium">Cash flow turns negative in approximately {negativeDay} day{negativeDay !== 1 ? "s" : ""}</p>
                <p className="text-[10px] opacity-80 mt-0.5">Consider accelerating collections or reducing expenses to avoid a shortfall.</p>
              </div>
            </div>
          )}

          {forecast.alerts.length > 0 && (
            <Card className="p-4 backdrop-blur border-border/60" style={{ background: "hsl(var(--kf-card) / 0.6)" }}>
              <h4 className="text-xs font-semibold mb-2 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-warning))" }} />
                Alerts
              </h4>
              <ul className="space-y-1.5">
                {forecast.alerts.map((alert, i) => (
                  <li key={i} className="text-xs text-muted-foreground flex items-start gap-2">
                    <span className="w-1 h-1 rounded-full shrink-0 mt-1.5" style={{ background: "hsl(var(--kf-warning))" }} />
                    {alert}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}

function MetricCard({
  label,
  value,
  color,
  change,
  currency,
  icon: Icon,
}: {
  label: string;
  value: string;
  color: string;
  change?: number;
  currency?: string;
  icon?: typeof ArrowUpRight;
}) {
  return (
    <div className="rounded-xl p-3 border border-border/30" style={{ background: `hsl(var(${color}) / 0.04)` }}>
      <div className="flex items-center gap-1.5 mb-1">
        {Icon && <Icon className="w-3 h-3" style={{ color: `hsl(var(${color}))` }} />}
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
      </div>
      <p className="text-sm font-bold" style={{ color: `hsl(var(${color}))` }}>{value}</p>
      {change !== undefined && currency && (
        <p className="text-[10px] mt-0.5" style={{ color: change >= 0 ? "hsl(var(--kf-success))" : "hsl(var(--kf-error))" }}>
          {change >= 0 ? "+" : ""}{formatCurrency(change, currency)}
        </p>
      )}
    </div>
  );
}
