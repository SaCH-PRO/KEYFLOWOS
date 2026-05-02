"use client";

import {
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Clock,
  CalendarDays,
  Zap,
  BarChart3,
  Target,
  Minus,
} from "lucide-react";
import type {
  BookingsScheduleOptimizerResult,
  BookingsNoShowResult,
  BookingsRevenueInsightsResult,
  BookingsAiSearchResult,
} from "@/lib/client";

function ScoreRing({ score, label, size = 56 }: { score: number; label: string; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color =
    score >= 70 ? "hsl(var(--kf-accent1))" :
    score >= 40 ? "#f59e0b" : "#ef4444";

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--border)/0.3)" strokeWidth={4} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color}
          strokeWidth={4} strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round" className="transition-all duration-700"
        />
        <text
          x={size / 2} y={size / 2}
          textAnchor="middle" dominantBaseline="central"
          fill="hsl(var(--foreground))" fontSize={14} fontWeight={700}
          className="rotate-90" style={{ transformOrigin: `${size / 2}px ${size / 2}px` }}
        >
          {score}
        </text>
      </svg>
      <span className="text-[10px] text-muted-foreground font-medium">{label}</span>
    </div>
  );
}

function ImpactBadge({ impact }: { impact: string }) {
  const styles: Record<string, string> = {
    high: "bg-red-500/15 text-red-400 border-red-500/30",
    medium: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    low: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${styles[impact] ?? styles.medium}`}>
      {impact}
    </span>
  );
}

function ScheduleOptimizerRenderer({ data }: { data: BookingsScheduleOptimizerResult }) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <ScoreRing score={data.utilizationScore ?? 50} label={data.utilizationLabel ?? "Utilization"} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold mb-1">Schedule Analysis</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{data.summary}</p>
        </div>
      </div>

      {data.peakHours?.length > 0 && (
        <div>
          <p className="text-xs font-semibold mb-2 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
            Peak Hours
          </p>
          <div className="flex flex-wrap gap-1.5">
            {data.peakHours.slice(0, 6).map((h, i) => (
              <span key={i} className="text-[10px] px-2 py-1 rounded-lg bg-[hsl(var(--kf-accent1)/0.1)] border border-[hsl(var(--kf-accent1)/0.2)] text-[hsl(var(--kf-accent1))]">
                {h.label} ({h.bookings})
              </span>
            ))}
          </div>
        </div>
      )}

      {data.gaps?.length > 0 && (
        <div>
          <p className="text-xs font-semibold mb-2 flex items-center gap-1.5">
            <Target className="w-3.5 h-3.5 text-amber-400" />
            Scheduling Gaps
          </p>
          <div className="space-y-1.5">
            {data.gaps.map((g, i) => (
              <div key={i} className="text-xs p-2 rounded-lg bg-amber-500/5 border border-amber-500/20">
                <p className="font-medium text-amber-300">{g.description}</p>
                <p className="text-muted-foreground mt-0.5">{g.suggestion}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.recommendations?.length > 0 && (
        <div>
          <p className="text-xs font-semibold mb-2 flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-emerald-400" />
            Recommendations
          </p>
          <div className="space-y-1.5">
            {data.recommendations.map((r, i) => (
              <div key={i} className="text-xs p-2 rounded-lg bg-white/[0.02] border border-border/40">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="font-medium">{r.title}</span>
                  <ImpactBadge impact={r.impact} />
                </div>
                <p className="text-muted-foreground">{r.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NoShowPredictorRenderer({ data }: { data: BookingsNoShowResult }) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <ScoreRing score={Math.round(100 - (data.overallCancellationRate ?? 0))} label="Reliability" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold mb-1">No-Show Analysis</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{data.summary}</p>
          <p className="text-xs mt-1">
            <span className="text-amber-400 font-medium">{data.overallCancellationRate?.toFixed(1)}%</span>
            <span className="text-muted-foreground"> cancellation rate</span>
          </p>
        </div>
      </div>

      {data.atRiskBookings?.length > 0 && (
        <div>
          <p className="text-xs font-semibold mb-2 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
            At-Risk Bookings ({data.atRiskBookings.length})
          </p>
          <div className="space-y-1.5">
            {data.atRiskBookings.slice(0, 5).map((b, i) => {
              const riskColor =
                b.riskLevel === "high" ? "border-red-500/40 bg-red-500/5" :
                b.riskLevel === "medium" ? "border-amber-500/40 bg-amber-500/5" :
                "border-border/40 bg-white/[0.02]";
              return (
                <div key={i} className={`text-xs p-2 rounded-lg border ${riskColor}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium">{b.clientName}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-muted-foreground">{b.serviceName}</span>
                      <span className={`text-[10px] font-bold ${
                        b.riskScore >= 70 ? "text-red-400" : b.riskScore >= 40 ? "text-amber-400" : "text-emerald-400"
                      }`}>
                        {b.riskScore}%
                      </span>
                    </div>
                  </div>
                  <p className="text-muted-foreground">{b.suggestedAction}</p>
                  {b.reasons?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {b.reasons.map((r, ri) => (
                        <span key={ri} className="text-[9px] px-1.5 py-0.5 rounded bg-white/[0.05] text-muted-foreground">
                          {r}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {data.patterns?.length > 0 && (
        <div>
          <p className="text-xs font-semibold mb-2">Patterns Detected</p>
          <div className="space-y-1">
            {data.patterns.map((p, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <ImpactBadge impact={p.impact} />
                <span className="text-muted-foreground">{p.pattern}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.recommendations?.length > 0 && (
        <div>
          <p className="text-xs font-semibold mb-2 flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-emerald-400" />
            Recommendations
          </p>
          <div className="space-y-1.5">
            {data.recommendations.map((r, i) => (
              <div key={i} className="text-xs p-2 rounded-lg bg-white/[0.02] border border-border/40">
                <span className="font-medium">{r.title}</span>
                <p className="text-muted-foreground mt-0.5">{r.description}</p>
                <p className="text-emerald-400/80 text-[10px] mt-0.5">{r.expectedImpact}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RevenueInsightsRenderer({ data }: { data: BookingsRevenueInsightsResult }) {
  const DirectionIcon = data.revenueGrowth >= 0 ? TrendingUp :
    data.revenueGrowth < 0 ? TrendingDown : Minus;
  const growthColor = data.revenueGrowth >= 0 ? "text-emerald-400" : "text-red-400";

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <ScoreRing score={data.revenueHealthScore ?? 50} label={data.revenueHealthLabel ?? "Revenue"} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold mb-1">Revenue Insights</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{data.summary}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="text-center p-2 rounded-lg bg-white/[0.02] border border-border/30">
          <p className="text-lg font-bold" style={{ color: "hsl(var(--kf-accent1))" }}>
            ${data.totalRevenue?.toLocaleString() ?? 0}
          </p>
          <p className="text-[10px] text-muted-foreground">Revenue</p>
        </div>
        <div className="text-center p-2 rounded-lg bg-white/[0.02] border border-border/30">
          <p className={`text-lg font-bold flex items-center justify-center gap-0.5 ${growthColor}`}>
            <DirectionIcon className="w-4 h-4" />
            {Math.abs(data.revenueGrowth ?? 0).toFixed(1)}%
          </p>
          <p className="text-[10px] text-muted-foreground">Growth</p>
        </div>
        <div className="text-center p-2 rounded-lg bg-white/[0.02] border border-border/30">
          <p className="text-lg font-bold">${data.averageBookingValue?.toLocaleString() ?? 0}</p>
          <p className="text-[10px] text-muted-foreground">Avg Value</p>
        </div>
      </div>

      {data.topServices?.length > 0 && (
        <div>
          <p className="text-xs font-semibold mb-2 flex items-center gap-1.5">
            <BarChart3 className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent1))" }} />
            Top Services
          </p>
          <div className="space-y-1.5">
            {data.topServices.slice(0, 5).map((s, i) => {
              const maxRev = data.topServices[0].revenue || 1;
              return (
                <div key={i} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">{s.name}</span>
                    <span className="text-emerald-400">${s.revenue.toLocaleString()}</span>
                  </div>
                  <div className="h-1 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${(s.revenue / maxRev) * 100}%`,
                        background: "linear-gradient(90deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {data.trends?.length > 0 && (
        <div>
          <p className="text-xs font-semibold mb-2">Trends</p>
          <div className="space-y-1">
            {data.trends.map((t, i) => {
              const Icon = t.direction === "up" ? TrendingUp : t.direction === "down" ? TrendingDown : Minus;
              const tColor = t.direction === "up" ? "text-emerald-400" : t.direction === "down" ? "text-red-400" : "text-muted-foreground";
              return (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <Icon className={`w-3 h-3 ${tColor}`} />
                  <span className="text-muted-foreground flex-1">{t.trend}</span>
                  <ImpactBadge impact={t.impact} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {data.recommendations?.length > 0 && (
        <div>
          <p className="text-xs font-semibold mb-2 flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-emerald-400" />
            Recommendations
          </p>
          <div className="space-y-1.5">
            {data.recommendations.map((r, i) => (
              <div key={i} className="text-xs p-2 rounded-lg bg-white/[0.02] border border-border/40">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="font-medium">{r.title}</span>
                  <ImpactBadge impact={r.priority} />
                </div>
                <p className="text-muted-foreground">{r.description}</p>
                <p className="text-emerald-400/80 text-[10px] mt-0.5">{r.expectedImpact}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NlSearchRenderer({ data }: { data: BookingsAiSearchResult }) {
  const results = data.results ?? [];

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs text-muted-foreground">{data.interpretation}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.05] text-muted-foreground">
            {data.type}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {results.length} result{results.length !== 1 ? "s" : ""}
          </span>
          {data.confidence !== undefined && (
            <span className={`text-[10px] font-medium ${
              data.confidence >= 0.7 ? "text-emerald-400" :
              data.confidence >= 0.4 ? "text-amber-400" : "text-red-400"
            }`}>
              {Math.round(data.confidence * 100)}% confidence
            </span>
          )}
        </div>
      </div>

      {results.length > 0 ? (
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {(results as Array<{
            contact?: { firstName?: string; lastName?: string; email?: string };
            service?: { name?: string };
            name?: string;
            status?: string;
            startTime?: string;
            price?: number | string;
          }>).slice(0, 20).map((r, i) => {
            const contactName = r.contact
              ? [r.contact.firstName, r.contact.lastName].filter(Boolean).join(" ") || r.contact.email || "Walk-in"
              : r.name || "Unknown";
            const serviceName = r.service?.name ?? r.name ?? "";
            const statusBadge: Record<string, string> = {
              PENDING: "bg-amber-500/15 text-amber-300",
              CONFIRMED: "bg-blue-500/15 text-blue-300",
              COMPLETED: "bg-emerald-500/15 text-emerald-300",
              CANCELLED: "bg-red-500/15 text-red-300",
            };

            return (
              <div key={i} className="text-xs p-2 rounded-lg bg-white/[0.02] border border-border/30 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{contactName}</span>
                  {serviceName && <span className="text-muted-foreground ml-1">· {serviceName}</span>}
                  {r.startTime && (
                    <span className="text-muted-foreground block text-[10px] mt-0.5">
                      {new Date(r.startTime).toLocaleDateString("en-TT", { weekday: "short", month: "short", day: "numeric" })}
                      {" "}
                      {new Date(r.startTime).toLocaleTimeString("en-TT", { hour: "numeric", minute: "2-digit", hour12: true })}
                    </span>
                  )}
                </div>
                {r.status && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${statusBadge[r.status] ?? "bg-slate-500/15 text-slate-300"}`}>
                    {r.status}
                  </span>
                )}
                {r.price !== undefined && (
                  <span className="text-[10px] font-medium" style={{ color: "hsl(var(--kf-accent1))" }}>
                    ${r.price}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-4">
          <CalendarDays className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-xs text-muted-foreground">No results found</p>
        </div>
      )}
    </div>
  );
}

export function renderBookingsToolResult(toolId: string, result: unknown): React.ReactNode {
  if (!result) return null;

  switch (toolId) {
    case "schedule-optimizer":
      return <ScheduleOptimizerRenderer data={result as BookingsScheduleOptimizerResult} />;
    case "no-show-predictor":
      return <NoShowPredictorRenderer data={result as BookingsNoShowResult} />;
    case "revenue-insights":
      return <RevenueInsightsRenderer data={result as BookingsRevenueInsightsResult} />;
    case "bookings-nl-search":
      return <NlSearchRenderer data={result as BookingsAiSearchResult} />;
    default:
      return (
        <pre className="text-xs text-muted-foreground whitespace-pre-wrap max-h-64 overflow-y-auto">
          {JSON.stringify(result, null, 2)}
        </pre>
      );
  }
}
