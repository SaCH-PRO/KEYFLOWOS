"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import { getApiBase } from "@/lib/api-base";
import {
  Activity,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  Clock,
  DollarSign,
  Users,
  CalendarCheck,
  ClipboardList,
  Receipt,
  Bot,
  Loader2,
  AlertCircle,
  ArrowUpRight,
} from "lucide-react";

const API_BASE = getApiBase();

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface HealthMetric {
  key: string;
  label: string;
  value: number;
  previousValue: number;
  format: "currency" | "number" | "percent";
  trend: "up" | "down" | "flat";
  sparkline: number[];
  alert?: string;
}

export interface BusinessContext {
  healthScore: number;
  stage: string;
  metrics: HealthMetric[];
  alerts: HealthAlert[];
}

export interface HealthAlert {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  module: string;
  entityId?: string;
}

export interface KeyBusinessHealthProps {
  businessId?: string;
  className?: string;
  onAskKey?: (metricKey: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const METRIC_ICONS: Record<string, typeof DollarSign> = {
  revenue: DollarSign,
  leads: Users,
  bookings: CalendarCheck,
  tasks: ClipboardList,
  invoices: Receipt,
};

function formatValue(value: number, format: HealthMetric["format"]): string {
  switch (format) {
    case "currency":
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(value);
    case "percent":
      return `${value.toFixed(1)}%`;
    default:
      return value.toLocaleString();
  }
}

function healthColor(score: number): string {
  if (score >= 80) return "text-emerald-400";
  if (score >= 60) return "text-amber-400";
  if (score >= 40) return "text-orange-400";
  return "text-red-400";
}

function healthGradient(score: number): string {
  if (score >= 80) return "from-emerald-500 to-teal-400";
  if (score >= 60) return "from-amber-500 to-yellow-400";
  if (score >= 40) return "from-orange-500 to-amber-400";
  return "from-red-500 to-orange-400";
}

function severityColor(severity: HealthAlert["severity"]): string {
  switch (severity) {
    case "critical":
      return "text-red-400 bg-red-500/10 border-red-500/20";
    case "warning":
      return "text-amber-400 bg-amber-500/10 border-amber-500/20";
    default:
      return "text-blue-400 bg-blue-500/10 border-blue-500/20";
  }
}

/* ------------------------------------------------------------------ */
/*  SVG Sparkline                                                      */
/* ------------------------------------------------------------------ */

function Sparkline({ data, color = "hsl(24_95%_53%)" }: { data: number[]; color?: string }) {
  if (data.length < 2) return null;

  const width = 80;
  const height = 28;
  const padding = 2;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((v, i) => {
    const x = padding + (i / (data.length - 1)) * (width - padding * 2);
    const y = height - padding - ((v - min) / range) * (height - padding * 2);
    return `${x},${y}`;
  });

  const pathD = `M ${points.join(" L ")}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-16 h-6"
      fill="none"
      preserveAspectRatio="none"
    >
      <path d={pathD} stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* Area fill */}
      <path
        d={`${pathD} L ${width - padding},${height} L ${padding},${height} Z`}
        fill={color}
        opacity="0.08"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function KeyBusinessHealth({
  businessId,
  className = "",
  onAskKey,
}: KeyBusinessHealthProps) {
  const [context, setContext] = useState<BusinessContext | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ---------------------------------------------------------------- */
  /*  Fetch context                                                     */
  /* ---------------------------------------------------------------- */
  const fetchContext = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `${API_BASE}/api/v1/cortex/context?businessId=${businessId}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { context?: BusinessContext };
      setContext(data.context || null);
    } catch (err) {
      setError((err as Error).message);
      // Use mock data
      setContext(getMockContext());
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    void fetchContext();
  }, [fetchContext]);

  /* ---------------------------------------------------------------- */
  /*  Health score computation (fallback)                               */
  /* ---------------------------------------------------------------- */
  const computedScore = useMemo(() => {
    if (context?.healthScore !== undefined) return context.healthScore;
    if (!context?.metrics.length) return 0;
    const avg =
      context.metrics.reduce((sum, m) => {
        const change = m.previousValue ? (m.value - m.previousValue) / m.previousValue : 0;
        return sum + Math.min(Math.max(change + 0.5, 0), 1) * 100;
      }, 0) / context.metrics.length;
    return Math.round(avg);
  }, [context]);

  /* ---------------------------------------------------------------- */
  /*  Render                                                            */
  /* ---------------------------------------------------------------- */
  if (loading && !context) {
    return (
      <div className={`flex items-center justify-center py-12 gap-2 text-[hsl(30_10%_50%)] ${className}`}>
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">Analyzing business health...</span>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm bg-red-500/10 text-red-400 border border-red-500/20">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Health Score Card */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5"
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[hsl(30_20%_98%)]">
              Business Health
            </h3>
            <p className="text-[11px] text-[hsl(30_10%_50%)] mt-0.5">
              {context?.stage ? (
                <span className="flex items-center gap-1.5">
                  <Activity className="w-3 h-3" />
                  Genome Stage: <span className="text-[hsl(24_95%_53%)] font-medium">{context.stage}</span>
                </span>
              ) : (
                "Overall business health score"
              )}
            </p>
          </div>

          {/* Score circle */}
          <div className="relative w-16 h-16 flex items-center justify-center">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
              <path
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="white"
                strokeOpacity="0.06"
                strokeWidth="3"
              />
              <motion.path
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                className={healthColor(computedScore)}
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={`${computedScore}, 100`}
                initial={{ strokeDasharray: "0, 100" }}
                animate={{ strokeDasharray: `${computedScore}, 100` }}
                transition={{ duration: 1, ease: "easeOut" }}
              />
            </svg>
            <span className={`absolute text-lg font-bold ${healthColor(computedScore)}`}>
              {computedScore}
            </span>
          </div>
        </div>

        {/* Score bar */}
        <div className="mt-4">
          <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
            <motion.div
              className={`h-full rounded-full bg-gradient-to-r ${healthGradient(computedScore)}`}
              initial={{ width: 0 }}
              animate={{ width: `${computedScore}%` }}
              transition={{ duration: 1, ease: "easeOut" }}
            />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-[10px] text-[hsl(30_10%_40%)]">Needs Attention</span>
            <span className="text-[10px] text-[hsl(30_10%_40%)]">Thriving</span>
          </div>
        </div>
      </motion.div>

      {/* Metrics Grid */}
      {context?.metrics && context.metrics.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5"
        >
          {context.metrics.map((metric, index) => {
            const Icon = METRIC_ICONS[metric.key] || Activity;
            const TrendIcon =
              metric.trend === "up"
                ? TrendingUp
                : metric.trend === "down"
                  ? TrendingDown
                  : Minus;
            const trendColor =
              metric.trend === "up"
                ? "text-emerald-400"
                : metric.trend === "down"
                  ? "text-red-400"
                  : "text-[hsl(30_10%_50%)]";
            const pctChange = metric.previousValue
              ? ((metric.value - metric.previousValue) / metric.previousValue) * 100
              : 0;

            return (
              <motion.div
                key={metric.key}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + index * 0.05 }}
                className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5 hover:bg-white/[0.04] transition-colors group"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-white/[0.06] flex items-center justify-center">
                      <Icon className="w-3.5 h-3.5 text-[hsl(24_95%_53%)]" />
                    </div>
                    <span className="text-[11px] text-[hsl(30_10%_50%)]">{metric.label}</span>
                  </div>
                  <button
                    onClick={() => onAskKey?.(metric.key)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-white/[0.05] text-[hsl(30_10%_50%)]"
                    title={`Ask KEY about ${metric.label}`}
                  >
                    <Bot className="w-3 h-3" />
                  </button>
                </div>

                <div className="mt-2.5 flex items-end justify-between">
                  <div>
                    <p className="text-xl font-bold text-[hsl(30_20%_98%)]">
                      {formatValue(metric.value, metric.format)}
                    </p>
                    <div className={`flex items-center gap-1 mt-0.5 ${trendColor}`}>
                      <TrendIcon className="w-3 h-3" />
                      <span className="text-[10px] font-medium">
                        {pctChange >= 0 ? "+" : ""}
                        {pctChange.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                  <Sparkline data={metric.sparkline} />
                </div>

                {metric.alert && (
                  <div className="mt-2 flex items-center gap-1 text-[10px] text-amber-400">
                    <AlertTriangle className="w-3 h-3" />
                    {metric.alert}
                  </div>
                )}
              </motion.div>
            );
          })}
        </motion.div>
      )}

      {/* Alerts Section */}
      {context?.alerts && context.alerts.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4"
        >
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-[hsl(30_20%_98%)]">
              Alerts & Actions
            </h3>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 font-medium">
              {context.alerts.length}
            </span>
          </div>

          <div className="space-y-2">
            {context.alerts.map((alert) => (
              <div
                key={alert.id}
                className={`flex items-start gap-2.5 px-3 py-2.5 rounded-xl border ${severityColor(alert.severity)}`}
              >
                {alert.severity === "critical" ? (
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                ) : alert.severity === "warning" ? (
                  <Clock className="w-4 h-4 flex-shrink-0 mt-0.5" />
                ) : (
                  <ArrowUpRight className="w-4 h-4 flex-shrink-0 mt-0.5" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium">{alert.title}</p>
                  <p className="text-[11px] opacity-70 mt-0.5">{alert.description}</p>
                </div>
                <button
                  onClick={() => onAskKey?.(alert.module)}
                  className="p-1.5 rounded-lg hover:bg-white/[0.05] flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity"
                  title="Ask KEY about this"
                >
                  <Bot className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* Empty state */}
      {!loading && !context?.metrics?.length && !error && (
        <div className="flex flex-col items-center justify-center py-12 text-[hsl(30_10%_50%)]">
          <Activity className="w-8 h-8 mb-2 opacity-40" />
          <p className="text-sm">Connect your business data</p>
          <p className="text-[11px] mt-1">KEY will analyze your metrics once data is available</p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Mock data                                                          */
/* ------------------------------------------------------------------ */

function getMockContext(): BusinessContext {
  const sparklineRevenue = [4200, 4500, 4100, 4800, 5200, 4900, 5800, 6100, 5900, 6500];
  const sparklineLeads = [12, 15, 11, 18, 22, 19, 25, 28, 24, 32];
  const sparklineBookings = [3, 4, 2, 5, 6, 4, 7, 8, 6, 9];
  const sparklineTasks = [8, 12, 10, 14, 16, 13, 18, 20, 17, 22];
  const sparklineInvoices = [2, 3, 2, 4, 3, 3, 5, 4, 4, 5];

  return {
    healthScore: 74,
    stage: "Growth",
    metrics: [
      {
        key: "revenue",
        label: "Revenue",
        value: 6500,
        previousValue: 5900,
        format: "currency",
        trend: "up",
        sparkline: sparklineRevenue,
      },
      {
        key: "leads",
        label: "Leads",
        value: 32,
        previousValue: 24,
        format: "number",
        trend: "up",
        sparkline: sparklineLeads,
      },
      {
        key: "bookings",
        label: "Bookings",
        value: 9,
        previousValue: 6,
        format: "number",
        trend: "up",
        sparkline: sparklineBookings,
      },
      {
        key: "tasks",
        label: "Open Tasks",
        value: 22,
        previousValue: 17,
        format: "number",
        trend: "up",
        sparkline: sparklineTasks,
        alert: "5 tasks overdue",
      },
      {
        key: "invoices",
        label: "Invoices",
        value: 5,
        previousValue: 4,
        format: "number",
        trend: "up",
        sparkline: sparklineInvoices,
        alert: "3 awaiting payment",
      },
    ],
    alerts: [
      {
        id: "alert-1",
        severity: "warning",
        title: "5 tasks are overdue",
        description: "Tasks assigned to Design team are 2+ days past due. Consider re-prioritizing.",
        module: "tasks",
      },
      {
        id: "alert-2",
        severity: "warning",
        title: "3 invoices awaiting payment",
        description: "Total of $8,450 in outstanding invoices. Send reminders?",
        module: "invoicing",
      },
      {
        id: "alert-3",
        severity: "info",
        title: "Genome Stage: Growth",
        description:
          "Your business is in the Growth stage. KEY recommends focusing on customer retention and process automation.",
        module: "genome",
      },
    ],
  };
}
