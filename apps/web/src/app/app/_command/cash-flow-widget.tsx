"use client";

import { useState, useEffect, useCallback } from "react";
import { TrendingUp, TrendingDown, Minus, AlertTriangle, RefreshCw } from "lucide-react";
import { fetchCashFlowForecast, type CashFlowForecast } from "@/lib/client";
import { formatTTD } from "./types";

interface CashFlowWidgetProps {
  businessId: string | null;
}

const TREND_CONFIG: Record<string, { icon: typeof TrendingUp; color: string; label: string }> = {
  growing: { icon: TrendingUp, color: "--kf-success", label: "Growing" },
  declining: { icon: TrendingDown, color: "--kf-error", label: "Declining" },
  stable: { icon: Minus, color: "--kf-info", label: "Stable" },
};

export function CashFlowWidget({ businessId }: CashFlowWidgetProps) {
  const [forecast, setForecast] = useState<CashFlowForecast | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await fetchCashFlowForecast(businessId, 30);
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
  const hasWarning = forecast?.daysUntilNegative !== null && forecast?.daysUntilNegative !== undefined && forecast.daysUntilNegative <= 30;
  const alertCount = forecast?.alerts?.length ?? 0;

  return (
    <div className="kf-card rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: `hsl(var(${trend.color}) / 0.1)` }}
          >
            <TrendIcon className="w-3.5 h-3.5" style={{ color: `hsl(var(${trend.color}))` }} />
          </div>
          <div>
            <h3 className="text-sm font-semibold">30-Day Cash Flow</h3>
            <p className="text-[10px] text-muted-foreground">Projected from invoices & expenses</p>
          </div>
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
        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-muted/20 animate-pulse" />
          ))}
        </div>
      ) : forecast ? (
        <>
          <div className="grid grid-cols-3 gap-3">
            <ForecastMetric
              label="Current"
              value={formatTTD(forecast.currentBalance)}
              color="--kf-accent1"
            />
            <ForecastMetric
              label="Projected"
              value={formatTTD(forecast.projectedBalance)}
              color={forecast.projectedBalance >= forecast.currentBalance ? "--kf-success" : "--kf-warning"}
            />
            <ForecastMetric
              label="Trend"
              value={trend.label}
              color={trend.color}
            />
          </div>

          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <span>Daily in: {formatTTD(forecast.dailyRevenueRate)}</span>
            <span className="text-muted-foreground/30">·</span>
            <span>Daily out: {formatTTD(forecast.dailyExpenseRate)}</span>
          </div>

          {hasWarning && (
            <div
              className="flex items-center gap-2 p-2.5 rounded-lg text-xs"
              style={{
                background: "hsl(var(--kf-error) / 0.08)",
                border: "1px solid hsl(var(--kf-error) / 0.2)",
                color: "hsl(var(--kf-error))",
              }}
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>
                Cash flow turns negative in ~{forecast.daysUntilNegative} day{forecast.daysUntilNegative !== 1 ? "s" : ""}
              </span>
            </div>
          )}

          {alertCount > 0 && !hasWarning && (
            <div className="space-y-1">
              {forecast.alerts.slice(0, 2).map((alert, i) => (
                <p key={i} className="text-[10px] text-muted-foreground flex items-start gap-1.5">
                  <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" style={{ color: "hsl(var(--kf-warning))" }} />
                  {alert}
                </p>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

function ForecastMetric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl p-3" style={{ background: `hsl(var(${color}) / 0.05)` }}>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
      <p className="text-sm font-bold truncate" style={{ color: `hsl(var(${color}))` }}>
        {value}
      </p>
    </div>
  );
}
