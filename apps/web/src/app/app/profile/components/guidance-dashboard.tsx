"use client";

import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  BarChart3, TrendingUp, TrendingDown, AlertTriangle, Shield,
  Target, Lightbulb, Clock, ChevronRight, RefreshCw, Edit3,
  Building2, Users, DollarSign, Briefcase, Award, Activity,
  CheckCircle2, XCircle, AlertCircle, ArrowUp, ArrowDown,
  Compass, Zap, Flag, Star,
} from "lucide-react";
import { Button } from "@keyflow/ui";
import { apiGet, apiPostSimple } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { loadGuidanceDraft } from "./guidance-storage";
import {
  XAxis, YAxis, Tooltip, ResponsiveContainer, Area, AreaChart,
} from "recharts";

interface CategoryScores {
  clarity?: number;
  readiness?: number;
  profitability?: number;
  operations?: number;
  growth?: number;
  risk?: number;
  safety?: number;
  [key: string]: number | undefined;
}

interface Metrics {
  monthlyRevenueEstimate?: number;
  revenueSource?: string;
  grossProfit?: number;
  totalMonthlyOperatingCosts?: number;
  netOperatingProfit?: number;
  taxAdjustedProfit?: number;
  contributionMarginPerUnit?: number;
  contributionMarginPct?: number;
  breakEvenVolume?: number | null;
  breakEvenRevenue?: number | null;
  runwayMonths?: number | null;
  runwayLabel?: string;
  profitMarginPct?: number;
  monthlyTargetVolume?: number | null;
  repeatCustomerPct?: number | null;
  leadCount?: number | null;
  conversionRate?: number | null;
  [key: string]: number | string | null | undefined;
}

interface AssessmentResult {
  id: string;
  overallScore: number | null;
  categoryScores: CategoryScores | null;
  strengths: string[];
  weaknesses: string[];
  risks: string[];
  opportunities: string[];
  metrics: Metrics | null;
  flags: string[];
  version: number;
  createdAt: string;
}

interface Recommendation {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: string;
  urgency?: string;
  impact?: string;
  effort?: string;
  status: string;
  rationale?: string;
  suggestedAction?: string;
  impactLevel?: string;
  estimatedDifficulty?: string;
  actionUrl?: string | null;
  triggerScoreKey?: string;
}

interface RoadmapItem {
  id: string;
  title?: string;
  description?: string;
  category?: string;
  sequenceOrder?: number;
  orderIndex?: number;
  actionTitle?: string;
  whyItMatters?: string;
  expectedOutcome?: string;
  linkedScoreArea?: string;
  estimatedDays?: number;
  status: string;
}

interface ProgressSnapshot {
  id: string;
  overallScore: number | null;
  categoryScores: CategoryScores | null;
  completedRecommendations: number;
  totalRecommendations: number;
  completedRoadmapItems: number;
  totalRoadmapItems: number;
  snapshotDate: string;
}

interface DashboardData {
  status: string;
  latestAssessment: AssessmentResult | null;
  topRecommendations: Recommendation[];
  nextRoadmapItems: RoadmapItem[];
  progressHistory: ProgressSnapshot[];
}

const DIMENSION_MAP: Record<string, { label: string; key: string }> = {
  clarity: { label: "Business Clarity", key: "clarity" },
  readiness: { label: "Readiness", key: "readiness" },
  profitability: { label: "Profitability", key: "profitability" },
  operations: { label: "Operational Maturity", key: "operations" },
  growth: { label: "Growth", key: "growth" },
  risk: { label: "Risk & Safety", key: "risk" },
  safety: { label: "Safety & Compliance", key: "safety" },
};

function getDimensionScore(scores: CategoryScores | null, key: string): number | null {
  if (!scores) return null;
  const val = scores[key];
  return val !== undefined && val !== null ? Math.round(val) : null;
}

function scoreColor(score: number | null): string {
  if (score === null) return "text-muted-foreground";
  if (score < 40) return "text-red-400";
  if (score < 70) return "text-amber-400";
  return "text-emerald-400";
}

function scoreBg(score: number | null): string {
  if (score === null) return "bg-muted/20";
  if (score < 40) return "bg-red-500/15";
  if (score < 70) return "bg-amber-500/15";
  return "bg-emerald-500/15";
}

function scoreBarColor(score: number | null): string {
  if (score === null) return "hsl(var(--muted))";
  if (score < 40) return "hsl(var(--kf-error))";
  if (score < 70) return "hsl(var(--kf-warning))";
  return "hsl(var(--kf-success))";
}

function scoreLabel(score: number | null): string {
  if (score === null) return "No data";
  if (score < 40) return "Needs attention";
  if (score < 70) return "On track";
  return "Strong";
}

function formatTTD(value: number | undefined | null): string {
  if (value === undefined || value === null) return "N/A";
  return `TTD $${value.toLocaleString("en-TT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function severityBadge(severity: string) {
  const s = severity.toLowerCase();
  if (s === "critical") return { bg: "bg-red-500/20", text: "text-red-400", label: "Critical" };
  if (s === "high") return { bg: "bg-orange-500/20", text: "text-orange-400", label: "High" };
  if (s === "medium") return { bg: "bg-amber-500/20", text: "text-amber-400", label: "Medium" };
  return { bg: "bg-muted/30", text: "text-muted-foreground", label: "Low" };
}

function priorityToSeverity(priority: string): string {
  const p = priority.toUpperCase();
  if (p === "CRITICAL") return "critical";
  if (p === "HIGH") return "high";
  if (p === "MEDIUM") return "medium";
  return "low";
}

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

const stagger = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-6 w-48 bg-muted/40 rounded-lg" />
          <div className="h-3 w-72 bg-muted/30 rounded-lg" />
        </div>
        <div className="flex gap-2">
          <div className="h-10 w-28 bg-muted/30 rounded-xl" />
          <div className="h-10 w-28 bg-muted/30 rounded-xl" />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="kf-card p-6 space-y-3">
            <div className="h-4 w-32 bg-muted/40 rounded" />
            <div className="h-20 bg-muted/20 rounded-xl" />
            <div className="h-3 w-48 bg-muted/30 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

function HealthGauge({ score, size = 120 }: { score: number | null; size?: number }) {
  const value = score ?? 0;
  const radius = (size / 2) - 10;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;
  const color = value >= 70 ? "hsl(var(--kf-success))" : value >= 40 ? "hsl(var(--kf-warning))" : "hsl(var(--kf-error))";

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg className="-rotate-90" viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke="hsl(var(--muted))" strokeWidth="8" opacity="0.2"
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold" style={{ color }}>{score ?? "—"}</span>
        <span className="text-[10px] text-muted-foreground font-medium">/ 100</span>
      </div>
    </div>
  );
}

interface GuidanceDashboardProps {
  onEditProfile: () => void;
}

export default function GuidanceDashboard({ onEditProfile }: GuidanceDashboardProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reanalyzing, setReanalyzing] = useState(false);

  const businessId = getStoredBusinessId();

  const fetchDashboard = async () => {
    if (!businessId) {
      setError("No business found");
      setLoading(false);
      return;
    }
    try {
      const { data: result, error: err } = await apiGet<DashboardData>(
        `/business-guidance/${businessId}/dashboard`
      );
      if (err) {
        setError(err);
      } else if (result) {
        setData(result);
      }
    } catch {
      setError("Failed to load dashboard");
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchDashboard();
  }, []);

  const handleReanalyze = async () => {
    if (!businessId || reanalyzing) return;
    setReanalyzing(true);
    try {
      await apiPostSimple(`/business-guidance/${businessId}/reanalyze`, {});
      await apiPostSimple(`/business-guidance/${businessId}/submit`, {});
      await fetchDashboard();
    } catch {
      setError("Re-analysis failed. Please try again.");
    }
    setReanalyzing(false);
  };

  const assessment = data?.latestAssessment;
  const scores = assessment?.categoryScores;
  const metrics = assessment?.metrics;

  const dimensionScores = useMemo(() => {
    if (!scores) return {};
    const result: Record<string, number | null> = {};
    for (const [key, dim] of Object.entries(DIMENSION_MAP)) {
      result[key] = getDimensionScore(scores, dim.key);
    }
    return result;
  }, [scores]);

  const strongestDim = useMemo(() => {
    let best: { key: string; score: number } | null = null;
    for (const [key, val] of Object.entries(dimensionScores)) {
      if (val !== null && (best === null || val > best.score)) {
        best = { key, score: val };
      }
    }
    return best;
  }, [dimensionScores]);

  const weakestDim = useMemo(() => {
    let worst: { key: string; score: number } | null = null;
    for (const [key, val] of Object.entries(dimensionScores)) {
      if (val !== null && (worst === null || val < worst.score)) {
        worst = { key, score: val };
      }
    }
    return worst;
  }, [dimensionScores]);

  const criticalRecs = useMemo(() => {
    if (!data) return [];
    return data.topRecommendations.filter(
      (r) => r.priority.toUpperCase() === "CRITICAL" || r.urgency === "immediate"
    );
  }, [data]);

  const nonCriticalRecs = useMemo(() => {
    if (!data) return [];
    return data.topRecommendations.filter(
      (r) => r.priority.toUpperCase() !== "CRITICAL" && r.urgency !== "immediate"
    );
  }, [data]);

  if (loading) return <DashboardSkeleton />;

  if (error || !data) {
    return (
      <div className="kf-card p-8 text-center space-y-3">
        <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto" />
        <p className="text-sm text-muted-foreground">{error || "No dashboard data available"}</p>
        <Button onClick={fetchDashboard}>Retry</Button>
      </div>
    );
  }

  if (!assessment) {
    return (
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.06), hsl(var(--kf-accent2) / 0.04))",
          border: "1px solid hsl(var(--kf-border) / 0.4)",
        }}
      >
        <div className="p-8 flex flex-col items-center text-center space-y-4">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{ background: "hsl(var(--kf-accent1) / 0.12)" }}
          >
            <Compass className="w-8 h-8" style={{ color: "hsl(var(--kf-accent1))" }} />
          </div>
          <div className="space-y-1.5">
            <h3 className="text-lg font-bold" style={{ color: "hsl(var(--kf-foreground))" }}>
              Your Business Command Center
            </h3>
            <p className="text-sm max-w-sm" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
              Complete the Business Guidance assessment to unlock your personalized dashboard
              with health scores, financial insights, and growth roadmap.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 justify-center">
            {["Health Score", "Risk Analysis", "Financial Insights", "Growth Roadmap"].map((tag) => (
              <span
                key={tag}
                className="px-2.5 py-1 rounded-lg text-[11px] font-medium"
                style={{
                  background: "hsl(var(--kf-accent1) / 0.1)",
                  color: "hsl(var(--kf-accent1))",
                }}
              >
                {tag}
              </span>
            ))}
          </div>
          <Button onClick={onEditProfile} className="min-h-[44px]">
            <span className="flex items-center gap-2">
              <Target className="w-4 h-4" />
              Start Assessment
            </span>
          </Button>
        </div>
      </div>
    );
  }

  const chartData = (() => {
    const history = data.progressHistory
      .slice()
      .reverse()
      .map((s) => ({
        date: new Date(s.snapshotDate).toLocaleDateString("en-TT", { month: "short", day: "numeric" }),
        score: s.overallScore ?? 0,
      }));
    if (assessment) {
      history.push({
        date: new Date(assessment.createdAt).toLocaleDateString("en-TT", { month: "short", day: "numeric" }),
        score: assessment.overallScore ?? 0,
      });
    }
    return history;
  })();

  const hasProgressData = chartData.length > 1;
  const prevSnapshot = data.progressHistory.length > 0 ? data.progressHistory[0] : null;
  const prevCatScores = prevSnapshot?.categoryScores as CategoryScores | null;

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={fadeUp} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] flex items-center justify-center text-white shadow-lg">
            <BarChart3 className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Business Command Center</h1>
            <p className="text-sm text-muted-foreground">
              Assessment v{assessment.version} &middot; {new Date(assessment.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={onEditProfile} className="min-h-[44px] flex items-center gap-1.5">
            <Edit3 className="w-4 h-4" />
            Edit Profile
          </Button>
          <Button onClick={handleReanalyze} disabled={reanalyzing} className="min-h-[44px] flex items-center gap-1.5">
            <RefreshCw className={`w-4 h-4 ${reanalyzing ? "animate-spin" : ""}`} />
            {reanalyzing ? "Analyzing..." : "Re-analyze"}
          </Button>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <BusinessSnapshotCard />

        <motion.div variants={fadeUp} className="kf-card p-6 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Activity className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            Overall Health
          </div>
          <div className="flex items-center gap-6">
            <HealthGauge score={assessment.overallScore} />
            <div className="flex-1 space-y-3">
              {strongestDim && (
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="text-xs text-muted-foreground">Strongest:</span>
                  <span className="text-xs font-medium text-emerald-400">
                    {DIMENSION_MAP[strongestDim.key]?.label} ({strongestDim.score})
                  </span>
                </div>
              )}
              {weakestDim && (
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-red-400" />
                  <span className="text-xs text-muted-foreground">Weakest:</span>
                  <span className="text-xs font-medium text-red-400">
                    {DIMENSION_MAP[weakestDim.key]?.label} ({weakestDim.score})
                  </span>
                </div>
              )}
            </div>
          </div>
        </motion.div>

        {Object.entries(DIMENSION_MAP).map(([key, dim]) => {
          const dimScore = dimensionScores[key] ?? null;
          return (
            <motion.div key={key} variants={fadeUp} className="kf-card p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">{dim.label}</span>
                <span className={`text-lg font-bold ${scoreColor(dimScore)}`}>
                  {dimScore ?? "—"}
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-muted/20 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${dimScore ?? 0}%`,
                    backgroundColor: scoreBarColor(dimScore),
                  }}
                />
              </div>
              <p className={`text-[11px] font-medium ${scoreColor(dimScore)}`}>
                {scoreLabel(dimScore)}
              </p>
            </motion.div>
          );
        })}

        <ProfitabilityCard metrics={metrics ?? null} />

        <motion.div variants={fadeUp} className="kf-card p-6 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Flag className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            Missing Essentials
          </div>
          {nonCriticalRecs.length > 0 ? (
            <div className="space-y-2">
              {nonCriticalRecs.map((rec) => {
                const sev = severityBadge(priorityToSeverity(rec.priority));
                return (
                  <div key={rec.id} className="p-3 rounded-xl bg-muted/10 border border-border/20 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${sev.bg} ${sev.text}`}>
                        {sev.label}
                      </span>
                      <span className="text-xs font-medium flex-1">{rec.title}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{rec.description}</p>
                    {rec.suggestedAction && (
                      rec.actionUrl ? (
                        <a
                          href={rec.actionUrl}
                          className="text-[11px] text-[hsl(var(--kf-accent1))] flex items-center gap-1 hover:underline min-h-[44px] py-2"
                        >
                          <Lightbulb className="w-3 h-3 flex-shrink-0" />
                          {rec.suggestedAction}
                          <ChevronRight className="w-3 h-3 flex-shrink-0" />
                        </a>
                      ) : (
                        <p className="text-[11px] text-[hsl(var(--kf-accent1))] flex items-center gap-1">
                          <Lightbulb className="w-3 h-3 flex-shrink-0" />
                          {rec.suggestedAction}
                        </p>
                      )
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/10">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <p className="text-[11px] text-muted-foreground">No missing essentials identified. You're on track.</p>
            </div>
          )}
        </motion.div>

        <motion.div variants={fadeUp} className="kf-card p-6 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-400">
            <AlertTriangle className="h-4 w-4" />
            Risk Alerts
          </div>
          {criticalRecs.length > 0 ? (
            <div className="space-y-2">
              {criticalRecs.map((rec) => (
                <div key={rec.id} className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 space-y-1">
                  <div className="flex items-center gap-2">
                    <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                    <span className="text-xs font-medium text-red-400">{rec.title}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">{rec.description}</p>
                  {rec.suggestedAction && (
                    <p className="text-[11px] text-red-400 flex items-center gap-1">
                      <Zap className="w-3 h-3" />
                      {rec.suggestedAction}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : assessment.risks.length > 0 ? (
            <div className="space-y-2">
              {assessment.risks.map((risk, i) => (
                <div key={i} className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-2">
                  <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-[11px] text-muted-foreground leading-relaxed">{risk}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/10">
              <Shield className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <p className="text-[11px] text-muted-foreground">No critical risks detected. Keep monitoring as you grow.</p>
            </div>
          )}
        </motion.div>

        <motion.div variants={fadeUp} className="kf-card p-6 space-y-4 md:col-span-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Target className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            Priority Roadmap
          </div>
          {data.nextRoadmapItems.length > 0 ? (
            <div className="relative pl-6 space-y-0">
              {data.nextRoadmapItems.map((item, index) => {
                const isFirst = index === 0;
                const isLast = index === data.nextRoadmapItems.length - 1;
                const title = item.actionTitle || item.title || "Untitled Step";
                return (
                  <div key={item.id} className="relative pb-6 last:pb-0">
                    {!isLast && (
                      <div
                        className="absolute left-[-16px] top-6 w-px h-[calc(100%-6px)]"
                        style={{ background: "hsl(var(--border) / 0.4)" }}
                      />
                    )}
                    <div className="absolute left-[-22px] top-1">
                      <div
                        className="w-[13px] h-[13px] rounded-full border-2 flex items-center justify-center text-[7px] font-bold"
                        style={{
                          borderColor: isFirst ? "hsl(var(--kf-accent1))" : "hsl(var(--border) / 0.6)",
                          background: isFirst ? "hsl(var(--kf-accent1))" : "transparent",
                          color: isFirst ? "white" : "hsl(var(--muted-foreground))",
                        }}
                      >
                        {index + 1}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold">{title}</span>
                        {isFirst && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))]">
                            Start Here
                          </span>
                        )}
                        {item.linkedScoreArea && (
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-muted/30 text-muted-foreground">
                            {item.linkedScoreArea}
                          </span>
                        )}
                      </div>
                      {item.whyItMatters && (
                        <p className="text-[11px] text-muted-foreground leading-relaxed">{item.whyItMatters}</p>
                      )}
                      {item.expectedOutcome && (
                        <p className="text-[11px] text-emerald-400 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          {item.expectedOutcome}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">No roadmap items available yet. Re-analyze to generate your roadmap.</p>
          )}
        </motion.div>

        <StrategicFeedbackCard
          assessment={assessment}
          metrics={metrics ?? null}
          topRecommendation={data.topRecommendations[0] ?? null}
        />

        <motion.div variants={fadeUp} className="kf-card p-6 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Lightbulb className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            Opportunities
          </div>
          {assessment.opportunities.length > 0 ? (
            <div className="space-y-2">
              {assessment.opportunities.map((opp, i) => {
                const impact = i === 0 ? "high" : i <= 2 ? "medium" : "low";
                const impactBadge = impact === "high"
                  ? { bg: "bg-emerald-500/20", text: "text-emerald-400", label: "High Impact" }
                  : impact === "medium"
                    ? { bg: "bg-amber-500/20", text: "text-amber-400", label: "Medium Impact" }
                    : { bg: "bg-muted/30", text: "text-muted-foreground", label: "Explore" };
                return (
                  <div key={i} className="p-3 rounded-xl bg-[hsl(var(--kf-accent1))]/5 border border-[hsl(var(--kf-accent1))]/10 space-y-1">
                    <div className="flex items-center gap-2">
                      <Star className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))] flex-shrink-0" />
                      <span className="text-[11px] text-foreground/80 leading-relaxed flex-1">{opp}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold flex-shrink-0 ${impactBadge.bg} ${impactBadge.text}`}>
                        {impactBadge.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">Opportunities will appear after deeper analysis. Try re-analyzing with more profile data.</p>
          )}
        </motion.div>

        <motion.div variants={fadeUp} className="kf-card p-6 space-y-4 md:col-span-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <TrendingUp className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            Progress Tracking
          </div>
          {hasProgressData ? (
            <>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="scoreGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--kf-accent1))" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(var(--kf-accent1))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      axisLine={false}
                      tickLine={false}
                      width={30}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="score"
                      stroke="hsl(var(--kf-accent1))"
                      fill="url(#scoreGradient)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              {prevCatScores && scores && (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(DIMENSION_MAP).map(([key, dim]) => {
                    const current = getDimensionScore(scores, dim.key);
                    const previous = getDimensionScore(prevCatScores, dim.key);
                    if (current === null || previous === null) return null;
                    const delta = current - previous;
                    if (delta === 0) return null;
                    return (
                      <span
                        key={key}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium ${
                          delta > 0 ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
                        }`}
                      >
                        {delta > 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                        {delta > 0 ? "+" : ""}{delta} {dim.label}
                      </span>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <Activity className="w-8 h-8 text-muted-foreground/30 mb-2" />
              <p className="text-xs text-muted-foreground">Progress trends will appear after your next re-analysis.</p>
              <p className="text-[10px] text-muted-foreground/60 mt-1">
                Current score: {assessment.overallScore ?? "—"}/100
              </p>
            </div>
          )}
        </motion.div>
      </div>
    </motion.div>
  );
}

function BusinessSnapshotCard() {
  const draft = loadGuidanceDraft();
  const stageLabel = draft.businessStage || "Unknown Stage";
  const bType = draft.businessType || "Business";

  return (
    <motion.div variants={fadeUp} className="kf-card p-6 space-y-3 relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
        }}
      />
      <div className="relative">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Building2 className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          Business Snapshot
        </div>
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold">{draft.businessName || "Your Business"}</h3>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))]">
              {stageLabel}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
            <div>
              <span className="text-muted-foreground">Type:</span>{" "}
              <span className="font-medium">{bType}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Industry:</span>{" "}
              <span className="font-medium">{draft.industry || "—"}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Revenue Model:</span>{" "}
              <span className="font-medium">{draft.revenueModelType || "—"}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Goal:</span>{" "}
              <span className="font-medium">{draft.primaryGoal || "—"}</span>
            </div>
          </div>
          {draft.idealCustomer && (
            <p className="text-[11px] text-muted-foreground mt-1">
              <Users className="w-3 h-3 inline mr-1" />
              Target: {draft.idealCustomer}
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function ProfitabilityCard({ metrics }: { metrics: Metrics | null }) {
  return (
    <motion.div variants={fadeUp} className="kf-card p-6 space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <DollarSign className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
        Profitability
      </div>
      {metrics ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <MetricItem label="Monthly Revenue" value={formatTTD(metrics.monthlyRevenueEstimate as number)} trend={undefined} />
            <MetricItem label="Gross Profit" value={formatTTD(metrics.grossProfit as number)} trend={undefined} />
            <MetricItem label="Operating Costs" value={formatTTD(metrics.totalMonthlyOperatingCosts as number)} trend={undefined} />
            <MetricItem
              label="Net Profit"
              value={formatTTD(metrics.netOperatingProfit as number)}
              isNegative={typeof metrics.netOperatingProfit === "number" && metrics.netOperatingProfit < 0}
              trend={undefined}
            />
            <MetricItem label="Break-even Volume" value={metrics.breakEvenVolume != null ? `${metrics.breakEvenVolume} units` : "N/A"} trend={undefined} />
            <MetricItem label="Break-even Revenue" value={formatTTD(metrics.breakEvenRevenue as number)} trend={undefined} />
          </div>
          {metrics.contributionMarginPct != null && (
            <div className="pt-2 border-t border-border/20">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">Contribution Margin:</span>
                <span className={`text-xs font-semibold ${
                  (metrics.contributionMarginPct ?? 0) >= 50 ? "text-emerald-400" : (metrics.contributionMarginPct ?? 0) >= 20 ? "text-amber-400" : "text-red-400"
                }`}>
                  {metrics.contributionMarginPct?.toFixed(1)}%
                </span>
              </div>
            </div>
          )}
          {metrics.runwayMonths != null && (
            <div className={`pt-2 ${metrics.contributionMarginPct == null ? "border-t border-border/20" : ""}`}>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">Runway:</span>
                <span className={`text-xs font-semibold ${
                  (metrics.runwayMonths ?? 0) > 12 ? "text-emerald-400" : (metrics.runwayMonths ?? 0) > 6 ? "text-amber-400" : "text-red-400"
                }`}>
                  {metrics.runwayLabel || `${metrics.runwayMonths} months`}
                </span>
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="text-[11px] text-muted-foreground">Financial metrics will appear once cost and revenue data is provided in your profile.</p>
      )}
    </motion.div>
  );
}

function MetricItem({
  label, value, isNegative, trend,
}: {
  label: string;
  value: string;
  isNegative?: boolean;
  trend: "up" | "down" | undefined;
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <div className="flex items-center gap-1">
        <span className={`text-sm font-semibold ${isNegative ? "text-red-400" : ""}`}>{value}</span>
        {trend === "up" && <TrendingUp className="w-3 h-3 text-emerald-400" />}
        {trend === "down" && <TrendingDown className="w-3 h-3 text-red-400" />}
      </div>
    </div>
  );
}

function StrategicFeedbackCard({
  assessment,
  metrics,
  topRecommendation,
}: {
  assessment: AssessmentResult;
  metrics: Metrics | null;
  topRecommendation: Recommendation | null;
}) {
  const catScores = assessment.categoryScores;
  const hasScores = catScores && Object.values(catScores).some((v) => v !== undefined && v !== null);

  const characterization = hasScores
    ? (() => {
        const overall = assessment.overallScore ?? 0;
        if (overall >= 70) return "Your business shows strong fundamentals with solid scores across key dimensions.";
        if (overall >= 40) return "Your business has a developing foundation with room for improvement in several areas.";
        return "Your business is in its early stages. Focus on strengthening core areas to build a resilient foundation.";
      })()
    : null;

  const financialInsight = (() => {
    if (!metrics) return null;
    const net = metrics.netOperatingProfit;
    const margin = metrics.contributionMarginPct;
    if (typeof net === "number" && net < 0) {
      return `Currently operating at a loss (TTD $${Math.abs(net).toLocaleString("en-TT", { minimumFractionDigits: 2 })} monthly). Review pricing and cost structure to improve margins.`;
    }
    if (typeof margin === "number" && margin < 20) {
      return `Contribution margin is ${margin.toFixed(1)}%, which is thin. Consider adjusting pricing or reducing variable costs.`;
    }
    if (typeof net === "number" && net > 0) {
      return `Generating positive cash flow of TTD $${net.toLocaleString("en-TT", { minimumFractionDigits: 2 })} monthly. Focus on scaling revenue channels.`;
    }
    return null;
  })();

  const riskInsight = (() => {
    if (assessment.risks.length > 0) {
      return `${assessment.risks.length} risk${assessment.risks.length > 1 ? "s" : ""} identified: ${assessment.risks.join("; ")}`;
    }
    if (catScores?.risk !== undefined && catScores.risk < 40) {
      return "Risk & safety score is below threshold. Review compliance, data protection, and operational dependencies.";
    }
    return null;
  })();

  const hasFeedback = characterization || assessment.strengths.length > 0 || assessment.weaknesses.length > 0 || topRecommendation || financialInsight || riskInsight;

  return (
    <motion.div variants={fadeUp} className="kf-card p-6 space-y-4 md:col-span-2">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Award className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
        Strategic Feedback
      </div>
      {hasFeedback ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {characterization && (
            <div className="space-y-2 md:col-span-2">
              <p className="text-xs font-semibold text-[hsl(var(--kf-accent1))] flex items-center gap-1">
                <Compass className="w-3.5 h-3.5" />
                Business Characterization
              </p>
              <p className="text-[11px] text-foreground/80 leading-relaxed p-3 rounded-xl bg-[hsl(var(--kf-accent1))]/5 border border-[hsl(var(--kf-accent1))]/10">
                {characterization}
              </p>
            </div>
          )}

          {assessment.strengths.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Strengths
              </p>
              <ul className="space-y-1">
                {assessment.strengths.map((s, i) => (
                  <li key={i} className="text-[11px] text-foreground/80 leading-relaxed pl-3 relative before:content-[''] before:absolute before:left-0 before:top-[7px] before:w-1.5 before:h-1.5 before:rounded-full before:bg-emerald-400/40">
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {assessment.weaknesses.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-amber-400 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" />
                Areas for Improvement
              </p>
              <ul className="space-y-1">
                {assessment.weaknesses.map((w, i) => (
                  <li key={i} className="text-[11px] text-foreground/80 leading-relaxed pl-3 relative before:content-[''] before:absolute before:left-0 before:top-[7px] before:w-1.5 before:h-1.5 before:rounded-full before:bg-amber-400/40">
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {topRecommendation && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-[hsl(var(--kf-accent2))] flex items-center gap-1">
                <Zap className="w-3.5 h-3.5" />
                Next Move
              </p>
              <div className="p-3 rounded-xl bg-[hsl(var(--kf-accent2))]/5 border border-[hsl(var(--kf-accent2))]/10">
                <p className="text-[11px] font-medium text-foreground/90">{topRecommendation.title}</p>
                <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">{topRecommendation.description}</p>
              </div>
            </div>
          )}

          {financialInsight && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-emerald-400 flex items-center gap-1">
                <DollarSign className="w-3.5 h-3.5" />
                Financial Insight
              </p>
              <p className="text-[11px] text-foreground/80 leading-relaxed p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/10">
                {financialInsight}
              </p>
            </div>
          )}

          {riskInsight && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-red-400 flex items-center gap-1">
                <Shield className="w-3.5 h-3.5" />
                Risk Insight
              </p>
              <p className="text-[11px] text-foreground/80 leading-relaxed p-3 rounded-xl bg-red-500/5 border border-red-500/10">
                {riskInsight}
              </p>
            </div>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">Strategic insights will be generated after a full analysis. Provide more profile data for deeper feedback.</p>
      )}
    </motion.div>
  );
}
