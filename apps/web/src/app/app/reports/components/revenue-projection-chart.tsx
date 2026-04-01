"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { TrendingUp, RefreshCw } from "lucide-react";
import { Card } from "@keyflow/ui";
import { fetchCashFlowForecast, type CashFlowForecast } from "@/lib/client";
import { formatCurrency } from "./report-types";
import { getStoredBusinessId } from "@/lib/workspace";

interface RevenueProjectionChartProps {
  businessId?: string | null;
  currency?: string;
  currentRevenue?: number;
}

interface ProjectionPoint {
  label: string;
  projected: number;
  color: string;
}

export function RevenueProjectionChart({ businessId: propBusinessId, currency = "TTD", currentRevenue = 0 }: RevenueProjectionChartProps) {
  const [forecast, setForecast] = useState<CashFlowForecast | null>(null);
  const [loading, setLoading] = useState(false);

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

  const projections = useMemo<ProjectionPoint[]>(() => {
    if (!forecast) return [];
    const dailyRate = forecast.dailyRevenueRate ?? 0;
    return [
      { label: "30-Day", projected: currentRevenue + dailyRate * 30, color: "--kf-success" },
      { label: "60-Day", projected: currentRevenue + dailyRate * 60, color: "--kf-info" },
      { label: "90-Day", projected: currentRevenue + dailyRate * 90, color: "--kf-accent2" },
    ];
  }, [forecast, currentRevenue]);

  if (!forecast && !loading) return null;

  const maxVal = Math.max(currentRevenue, ...projections.map((p) => p.projected), 1);

  return (
    <Card className="p-4 backdrop-blur border-border/60" style={{ background: "hsl(var(--kf-card) / 0.6)" }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
          <h3 className="text-sm font-semibold">Revenue Projections</h3>
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
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-10 rounded-lg bg-muted/20 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <ProjectionBar
            label="Current"
            value={currentRevenue}
            max={maxVal}
            color="--kf-accent1"
            currency={currency}
          />
          {projections.map((p) => (
            <ProjectionBar
              key={p.label}
              label={p.label}
              value={p.projected}
              max={maxVal}
              color={p.color}
              currency={currency}
            />
          ))}

          {forecast && (
            <div className="pt-2 border-t border-border/30 flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Based on {formatCurrency(forecast.dailyRevenueRate, currency)}/day revenue rate</span>
              {forecast.trend && (
                <span
                  className="px-1.5 py-0.5 rounded-full font-medium"
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
          )}
        </div>
      )}
    </Card>
  );
}

function ProjectionBar({
  label,
  value,
  max,
  color,
  currency,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  currency: string;
}) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground font-medium">{label}</span>
        <span className="font-semibold" style={{ color: `hsl(var(${color}))` }}>
          {formatCurrency(value, currency)}
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted/20 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${pct}%`,
            background: `hsl(var(${color}))`,
          }}
        />
      </div>
    </div>
  );
}
