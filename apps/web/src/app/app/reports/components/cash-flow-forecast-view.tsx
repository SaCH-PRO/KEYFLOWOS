"use client";

import { useState, useEffect, useCallback } from "react";
import { TrendingUp, TrendingDown, Minus, AlertTriangle, RefreshCw, ShieldCheck, DollarSign, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Card } from "@keyflow/ui";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { fetchCashFlowForecast, type CashFlowForecast } from "@/lib/client";
import { formatCurrency } from "./report-types";

interface CashFlowForecastViewProps {
  businessId: string | null;
}

/**
 * SWP-FIN-CASH-SOURCES (D-13, D-135; SEC-W10LR-1): a currency is named only when it is a three-letter
 * code, as the server's rule (finance-overview.service.ts namedCashCurrency). The server already omits a
 * free-text business currency and lists only coded other-currency cash; the view applies the same rule
 * so that a label that is not a code is never echoed, whatever answers.
 */
const CURRENCY_CODE = /^[A-Z]{3}$/;

/** The forecast's figures as the view shows them: the server's, with nothing recomputed or added. */
interface CashFigures {
  /** The business currency's code, or null when the server names none (free text): never a default. */
  code: string | null;
  /** Other-currency cash, unconverted, never part of currentBalance (D-135). */
  otherCash: Array<{ currency: string; amount: number }>;
  /** Other-currency amounts held but not listed: the server's count plus any label that is not a code. */
  notListed: number;
}

function cashFigures(forecast: CashFlowForecast): CashFigures {
  const code = typeof forecast.currency === "string" && CURRENCY_CODE.test(forecast.currency) ? forecast.currency : null;
  const served = Array.isArray(forecast.otherCurrencyCash) ? forecast.otherCurrencyCash : [];
  const otherCash = served.filter(
    (o) => typeof o?.currency === "string" && CURRENCY_CODE.test(o.currency) && Number.isFinite(o.amount),
  );
  const servedNotListed = Number.isFinite(forecast.otherCurrencyCashNotListed) ? Number(forecast.otherCurrencyCashNotListed) : 0;
  return { code, otherCash, notListed: servedNotListed + (served.length - otherCash.length) };
}

/**
 * A business-currency figure: report-types formatCurrency with the server's code; with no code, the same
 * number format and no label (the basis line says the figures are in the business currency).
 */
function formatCash(amount: number, code: string | null): string {
  return code
    ? formatCurrency(amount, code)
    : amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

export function CashFlowForecastView({ businessId }: CashFlowForecastViewProps) {
  const [forecast, setForecast] = useState<CashFlowForecast | null>(null);
  const [loading, setLoading] = useState(false);
  // W11-AI-CASHFLOW-REVENUE (D-57, D-100): the forecast needs revenue read; the server answers 403 otherwise.
  const [denied, setDenied] = useState(false);
  // SWP-FIN-CASH-SOURCES review SEC-CFW-2: any other failure (a 5xx, a network error) is said, with Retry,
  // and the earlier figures are cleared, so a failed Refresh never leaves them up as if they were current.
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await fetchCashFlowForecast(businessId, 90);
      if (res.data) {
        setForecast(res.data);
        setDenied(false);
        setFailed(false);
      } else if ((res as { status?: number }).status === 403) {
        setForecast(null);
        setDenied(true);
        setFailed(false);
      } else {
        setForecast(null);
        setFailed(true);
      }
    } catch {
      setForecast(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  // A refusal is final for this member: a notice, no figure and no refresh that asks again (D-57, D-100).
  if (denied) {
    return (
      <div role="status" className="p-4 text-center">
        <p className="text-xs text-muted-foreground">Cash flow forecast needs revenue access.</p>
      </div>
    );
  }

  if (failed && !loading) {
    return (
      <div role="alert" className="p-4 text-center space-y-2">
        <p className="text-xs text-muted-foreground">The cash flow forecast could not be loaded.</p>
        <button
          onClick={load}
          className="text-xs px-3 min-h-[44px] rounded-xl border border-border/60 hover:border-border transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!forecast && !loading) return null;

  const trendKey = forecast?.trend?.toLowerCase() ?? "stable";
  const trend = TREND_CONFIG[trendKey] ?? TREND_CONFIG.stable;
  const TrendIcon = trend.icon;
  const confidence = forecast ? computeConfidence(forecast) : null;
  const figures = forecast ? cashFigures(forecast) : null;
  const code = figures?.code ?? null;
  const money = (amount: number) => formatCash(amount, code);

  // SWP-FIN-CASH-SOURCES: the line runs from the server's currentBalance (ledger cash) to its
  // projectedBalance over the server's projection days. It was recomputed from the rounded daily rates,
  // so its last day disagreed with the "Projected" figure (1349.90 against 1350.00).
  const chartData: ForecastPoint[] = [];
  if (forecast) {
    const start = forecast.currentBalance;
    const end = forecast.projectedBalance;
    const span = forecast.projectionDays && forecast.projectionDays > 0 ? forecast.projectionDays : 90;
    for (let d = 0; d <= 90; d++) {
      chartData.push({
        day: d === 0 ? "Now" : d % 30 === 0 ? `${d}d` : d % 10 === 0 ? `${d}d` : `${d}`,
        balance: Math.round((start + (end - start) * (d / span)) * 100) / 100,
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
          aria-label="Refresh forecast"
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
              value={money(forecast.currentBalance)}
              color="--kf-accent1"
            />
            <MetricCard
              label="Projected (90d)"
              value={money(forecast.projectedBalance)}
              color={forecast.projectedBalance >= forecast.currentBalance ? "--kf-success" : "--kf-error"}
              change={forecast.projectedBalance - forecast.currentBalance}
              formatChange={money}
            />
            <MetricCard
              label="Daily Inflow"
              value={money(forecast.dailyRevenueRate)}
              color="--kf-success"
              icon={ArrowUpRight}
            />
            <MetricCard
              label="Daily Outflow"
              value={money(forecast.dailyExpenseRate)}
              color="--kf-error"
              icon={ArrowDownRight}
            />
          </div>

          {/* SWP-FIN-CASH-SOURCES (D-135): what the balance is, and in which currency. */}
          <p data-testid="cash-basis" className="text-[11px] text-muted-foreground -mt-1">
            {forecast.cashBasis === "ledger"
              ? `Current balance is booked ledger cash in ${code ?? "the business currency"} up to today; future-dated entries are not counted.`
              : `Amounts in ${code ?? "the business currency"}.`}
            {/* Review COR-1 / SEC-CFW-1: no cause is stated. The web cannot tell a business whose currency is
                free text from a forecast the server failed to compute (200, zeros, no currency). */}
            {!code ? " No currency code was given, so amounts carry no code." : ""}
          </p>

          {figures && (figures.otherCash.length > 0 || figures.notListed > 0) && (
            <div
              data-testid="other-currency-cash"
              className="rounded-xl p-3 border border-border/30 text-xs"
              style={{ background: "hsl(var(--kf-info) / 0.04)" }}
            >
              <p className="font-medium">Cash in other currencies</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Not converted, and not included in the balance or the projection above.
              </p>
              {figures.otherCash.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  {figures.otherCash.map((o) => (
                    <li key={o.currency} className="font-mono">{formatCurrency(o.amount, o.currency)}</li>
                  ))}
                </ul>
              )}
              {figures.notListed > 0 && (
                <p className="text-[11px] text-muted-foreground mt-2">
                  {figures.notListed} more {figures.notListed === 1 ? "amount" : "amounts"} held in other currencies, not listed.
                </p>
              )}
            </div>
          )}

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
                    formatter={(value) => [money(Number(value)), "Balance"]}
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
  formatChange,
  icon: Icon,
}: {
  label: string;
  value: string;
  color: string;
  change?: number;
  formatChange?: (amount: number) => string;
  icon?: typeof ArrowUpRight;
}) {
  return (
    <div className="rounded-xl p-3 border border-border/30" style={{ background: `hsl(var(${color}) / 0.04)` }}>
      <div className="flex items-center gap-1.5 mb-1">
        {Icon && <Icon className="w-3 h-3" style={{ color: `hsl(var(${color}))` }} />}
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
      </div>
      <p className="text-sm font-bold" style={{ color: `hsl(var(${color}))` }}>{value}</p>
      {change !== undefined && formatChange && (
        <p className="text-[10px] mt-0.5" style={{ color: change >= 0 ? "hsl(var(--kf-success))" : "hsl(var(--kf-error))" }}>
          {change >= 0 ? "+" : ""}{formatChange(change)}
        </p>
      )}
    </div>
  );
}
