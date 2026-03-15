"use client";

import { RefreshCw, TrendingUp, TrendingDown, AlertTriangle, BarChart3 } from "lucide-react";
import type { CashFlowForecast } from "./types";
import { formatCurrency } from "./types";

interface ForecastPanelProps {
  forecast: CashFlowForecast | null;
  loading: boolean;
  onRefresh: () => void;
  disabled: boolean;
}

export function ForecastPanel({ forecast, loading, onRefresh, disabled }: ForecastPanelProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="kf-text-caption font-semibold uppercase tracking-wider text-muted-foreground">Cash Flow Forecast</h3>
        <button
          onClick={onRefresh}
          disabled={loading || disabled}
          className="flex items-center gap-1 px-2.5 py-1 kf-radius-md text-[10px] font-medium transition-colors disabled:opacity-40 bg-muted/30 border border-border hover:bg-muted/50"
        >
          <RefreshCw className={loading ? "w-3 h-3 animate-spin" : "w-3 h-3"} />
          {forecast ? "Refresh" : "Load"}
        </button>
      </div>

      {loading && !forecast ? (
        <div className="space-y-2">
          {[1, 2].map((i) => <div key={i} className="h-10 kf-radius-md bg-muted/20 animate-pulse" />)}
        </div>
      ) : forecast ? (
        <ForecastDetails forecast={forecast} />
      ) : (
        <div className="text-center py-6">
          <BarChart3 className="w-8 h-8 mx-auto mb-2 opacity-20" style={{ color: "hsl(var(--kf-accent2))" }} />
          <p className="text-[11px] text-muted-foreground">Load your cash flow projections</p>
        </div>
      )}
    </div>
  );
}

function ForecastDetails({ forecast }: { forecast: CashFlowForecast }) {
  const balanceColor = forecast.currentBalance >= 0 ? "hsl(var(--kf-success))" : "hsl(var(--kf-error))";
  const projectedColor = forecast.projectedBalance >= 0 ? "hsl(var(--kf-success))" : "hsl(var(--kf-error))";
  const trendUp = forecast.trend === "up" || forecast.trend === "improving";

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-muted/20 kf-radius-md p-3">
          <p className="text-[9px] text-muted-foreground uppercase mb-0.5">Balance</p>
          <p className="text-sm font-bold" style={{ color: balanceColor }}>{formatCurrency(forecast.currentBalance)}</p>
        </div>
        <div className="bg-muted/20 kf-radius-md p-3">
          <p className="text-[9px] text-muted-foreground uppercase mb-0.5">30-Day</p>
          <p className="text-sm font-bold" style={{ color: projectedColor }}>{formatCurrency(forecast.projectedBalance)}</p>
        </div>
      </div>
      {forecast.daysUntilNegative !== null && (
        <div className="kf-radius-md p-3 flex items-center gap-2" style={{ background: "hsl(var(--kf-error) / 0.1)", border: "1px solid hsl(var(--kf-error) / 0.2)" }}>
          <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: "hsl(var(--kf-error))" }} />
          <p className="text-[11px]" style={{ color: "hsl(var(--kf-error))" }}>Balance may go negative in {forecast.daysUntilNegative} days</p>
        </div>
      )}
      <div className="flex items-center gap-2 bg-muted/20 kf-radius-md p-3">
        {trendUp
          ? <TrendingUp className="w-4 h-4" style={{ color: "hsl(var(--kf-success))" }} />
          : <TrendingDown className="w-4 h-4" style={{ color: "hsl(var(--kf-error))" }} />
        }
        <div>
          <p className="text-[9px] text-muted-foreground">Trend</p>
          <p className="text-xs font-medium capitalize">{forecast.trend}</p>
        </div>
      </div>
    </div>
  );
}
