"use client";

import { useEffect, useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  TrendingUp,
  Target,
  Zap,
  Award,
  Brain,
  Sparkles,
  BarChart3,
  LineChart as LineChartIcon,
  Radar,
  ChevronRight,
  RefreshCw,
  AlertTriangle,
  Lightbulb,
  CheckCircle2,
  X,
} from "lucide-react";
import {
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar as RechartsRadar,
  BarChart,
  Bar,
} from "recharts";
import {
  fetchAnalyticsOverview,
  fetchAnalyticsSnapshots,
  fetchLatestMaturity,
  fetchProjections,
  fetchInsights,
  assessMaturity,
  generateInsights,
  generateRevenueProjection,
  dismissInsight,
} from "@/lib/client";

interface GrowthTrajectoryPanelProps {
  businessId: string | null;
}

interface MetricCardProps {
  label: string;
  value: string | number;
  change?: number;
  icon: React.ReactNode;
  delay?: number;
}

function MetricCard({ label, value, change, icon, delay = 0 }: MetricCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3 }}
      className="rounded-xl border border-border/40 bg-card/50 backdrop-blur-sm p-4"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] text-muted-foreground font-medium">{label}</span>
        <div className="text-muted-foreground">{icon}</div>
      </div>
      <div className="text-lg font-bold text-foreground">{value}</div>
      {change !== undefined && (
        <div className={`text-[10px] mt-1 font-medium ${change >= 0 ? "text-emerald-500" : "text-red-500"}`}>
          {change >= 0 ? "+" : ""}{change.toFixed(1)}% vs last period
        </div>
      )}
    </motion.div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const styles: Record<string, string> = {
    critical: "bg-red-500/10 text-red-500 border-red-500/20",
    warning: "bg-amber-500/10 text-amber-500 border-amber-500/20",
    opportunity: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    info: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  };
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${styles[severity] ?? styles.info}`}>
      {severity}
    </span>
  );
}

export function GrowthTrajectoryPanel({ businessId }: GrowthTrajectoryPanelProps) {
  const [overview, setOverview] = useState<Awaited<ReturnType<typeof fetchAnalyticsOverview>>["data"] | null>(null);
  const [snapshots, setSnapshots] = useState<Awaited<ReturnType<typeof fetchAnalyticsSnapshots>>["data"]>([]);
  const [maturity, setMaturity] = useState<Awaited<ReturnType<typeof fetchLatestMaturity>>["data"]>(null);
  const [projections, setProjections] = useState<Awaited<ReturnType<typeof fetchProjections>>["data"]>({});
  const [insights, setInsights] = useState<{ items: Array<{ id: string; title: string; description: string | null; severity: string; suggestedAction: string | null }>; total: number }>({ items: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  const loadData = async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const [ov, sn, mat, proj, ins] = await Promise.all([
        fetchAnalyticsOverview(businessId, 30),
        fetchAnalyticsSnapshots(businessId, "daily", 30),
        fetchLatestMaturity(businessId),
        fetchProjections(businessId),
        fetchInsights(businessId, { limit: 10 }),
      ]);
      setOverview(ov.data);
      setSnapshots(sn.data ?? []);
      setMaturity(mat.data);
      setProjections(proj.data ?? {});
      setInsights(ins.data ?? { items: [], total: 0 });
    } catch (e) {
      console.error("Failed to load analytics", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [businessId]);

  const handleAssessMaturity = async () => {
    if (!businessId) return;
    setGenerating(true);
    try {
      await assessMaturity(businessId);
      await generateInsights(businessId);
      await generateRevenueProjection(businessId);
      await loadData();
    } catch (e) {
      console.error("Failed to generate analytics", e);
    } finally {
      setGenerating(false);
    }
  };

  const handleDismissInsight = async (id: string) => {
    try {
      await dismissInsight(id);
      setInsights((prev) => ({
        ...prev,
        items: prev?.items.filter((i) => i.id !== id) ?? [],
        total: (prev?.total ?? 0) - 1,
      }));
    } catch (e) {
      console.error("Failed to dismiss insight", e);
    }
  };

  const snapshot = overview?.snapshot;

  const revenueTrend = useMemo(() => {
    return (snapshots ?? [])
      .filter((s) => s.totalRevenue !== null)
      .map((s) => ({
        date: new Date(s.snapshotDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        revenue: Number(s.totalRevenue ?? 0),
      }));
  }, [snapshots]);

  const contactTrend = useMemo(() => {
    return (snapshots ?? [])
      .filter((s) => s.totalContacts !== null)
      .map((s) => ({
        date: new Date(s.snapshotDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        contacts: s.totalContacts ?? 0,
      }));
  }, [snapshots]);

  const radarData = useMemo(() => {
    if (!maturity) return [];
    return [
      { dimension: "Revenue", score: maturity.revenueMaturity, fullMark: 100 },
      { dimension: "Customer", score: maturity.customerMaturity, fullMark: 100 },
      { dimension: "Operations", score: maturity.operationsMaturity, fullMark: 100 },
      { dimension: "Marketing", score: maturity.marketingMaturity, fullMark: 100 },
      { dimension: "Automation", score: maturity.automationMaturity, fullMark: 100 },
      { dimension: "Financial", score: maturity.financialMaturity, fullMark: 100 },
      { dimension: "Team", score: maturity.teamMaturity, fullMark: 100 },
      { dimension: "Data", score: maturity.dataMaturity, fullMark: 100 },
    ];
  }, [maturity]);

  const projectionData = useMemo(() => {
    const rev = projections?.revenue;
    if (!rev?.projectedValues) return [];
    const values = rev.projectedValues as Array<{ period: string; projected: number; lowerBound: number; upperBound: number }>;
    return values.map((v) => ({
      period: v.period,
      projected: v.projected,
      lower: v.lowerBound,
      upper: v.upperBound,
    }));
  }, [projections]);

  const _healthColor = snapshot?.healthScore && snapshot.healthScore >= 70
    ? "text-emerald-500"
    : snapshot?.healthScore && snapshot.healthScore >= 50
      ? "text-amber-500"
      : "text-red-500";

  return (
    <div className="space-y-6">
      {/* Header Actions */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
          Business Intelligence
        </h2>
        <button
          onClick={handleAssessMaturity}
          disabled={generating || !businessId}
          className="text-[11px] flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/20 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${generating ? "animate-spin" : ""}`} />
          {generating ? "Analyzing..." : "Run Assessment"}
        </button>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          label="Health Score"
          value={snapshot?.healthScore ?? "—"}
          change={snapshot?.growthRate ?? undefined}
          icon={<BarChart3 className="w-3.5 h-3.5" />}
          delay={0}
        />
        <MetricCard
          label="Momentum"
          value={snapshot?.momentumScore ?? "—"}
          icon={<Zap className="w-3.5 h-3.5" />}
          delay={0.05}
        />
        <MetricCard
          label="Collection Rate"
          value={snapshot?.collectionRate ? `${snapshot.collectionRate.toFixed(0)}%` : "—"}
          icon={<Target className="w-3.5 h-3.5" />}
          delay={0.1}
        />
        <MetricCard
          label="Active Flows"
          value={snapshot?.activeFlows ?? "—"}
          icon={<Award className="w-3.5 h-3.5" />}
          delay={0.15}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Revenue Trend */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="rounded-2xl border border-border/40 bg-card/40 backdrop-blur-sm p-5"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-semibold text-foreground flex items-center gap-2">
              <LineChartIcon className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
              Revenue Trend (30d)
            </h3>
          </div>
          {revenueTrend.length > 1 ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={revenueTrend}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--kf-accent1))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--kf-accent1))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="rgba(0,0,0,0.2)" />
                <YAxis tick={{ fontSize: 10 }} stroke="rgba(0,0,0,0.2)" />
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid hsl(var(--border))" }}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="hsl(var(--kf-accent1))"
                  fillOpacity={1}
                  fill="url(#revGrad)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-muted-foreground text-xs">
              {loading ? "Loading..." : "No revenue data yet. Run an assessment to generate snapshots."}
            </div>
          )}
        </motion.div>

        {/* Maturity Radar */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="rounded-2xl border border-border/40 bg-card/40 backdrop-blur-sm p-5"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-semibold text-foreground flex items-center gap-2">
              <Radar className="w-3.5 h-3.5 text-[hsl(var(--kf-accent2))]" />
              Maturity Assessment
              {maturity && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[hsl(var(--kf-accent2))]/10 text-[hsl(var(--kf-accent2))]">
                  {maturity.stage}
                </span>
              )}
            </h3>
          </div>
          {radarData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="rgba(0,0,0,0.08)" />
                <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 9 }} />
                <RechartsRadar
                  name="Score"
                  dataKey="score"
                  stroke="hsl(var(--kf-accent2))"
                  fill="hsl(var(--kf-accent2))"
                  fillOpacity={0.2}
                  strokeWidth={2}
                />
              </RadarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-muted-foreground text-xs">
              {loading ? "Loading..." : "No maturity data yet. Click Run Assessment to compute."}
            </div>
          )}
        </motion.div>
      </div>

      {/* Projection Chart */}
      {projectionData.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="rounded-2xl border border-border/40 bg-card/40 backdrop-blur-sm p-5"
        >
          <h3 className="text-xs font-semibold text-foreground mb-4 flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
            Revenue Projection (3 months)
          </h3>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={projectionData}>
              <defs>
                <linearGradient id="projGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(var(--kf-accent1))" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="hsl(var(--kf-accent1))" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" />
              <XAxis dataKey="period" tick={{ fontSize: 10 }} stroke="rgba(0,0,0,0.2)" />
              <YAxis tick={{ fontSize: 10 }} stroke="rgba(0,0,0,0.2)" />
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
              <Area type="monotone" dataKey="upper" stroke="none" fill="hsl(var(--kf-accent1))" fillOpacity={0.08} />
              <Area type="monotone" dataKey="lower" stroke="none" fill="#fff" fillOpacity={1} />
              <Line type="monotone" dataKey="projected" stroke="hsl(var(--kf-accent1))" strokeWidth={2} dot={{ r: 3 }} />
            </AreaChart>
          </ResponsiveContainer>
        </motion.div>
      )}

      {/* Growth Insights */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
        className="rounded-2xl border border-border/40 bg-card/40 backdrop-blur-sm p-5"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-semibold text-foreground flex items-center gap-2">
            <Brain className="w-3.5 h-3.5 text-[hsl(var(--kf-accent2))]" />
            Growth Insights
            {insights.total > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                {insights.total}
              </span>
            )}
          </h3>
        </div>

        {(insights?.items?.length ?? 0) > 0 ? (
          <div className="space-y-2.5">
            {(insights?.items ?? []).map((insight, i) => (
              <motion.div
                key={insight.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="group relative rounded-xl border border-border/30 bg-card/30 p-3.5 hover:bg-card/60 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5">
                    {insight.severity === "critical" ? (
                      <AlertTriangle className="w-4 h-4 text-red-500" />
                    ) : insight.severity === "warning" ? (
                      <Lightbulb className="w-4 h-4 text-amber-500" />
                    ) : insight.severity === "opportunity" ? (
                      <Sparkles className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4 text-blue-500" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold text-foreground">{insight.title}</span>
                      <SeverityBadge severity={insight.severity} />
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{insight.description}</p>
                    {insight.suggestedAction && (
                      <div className="mt-2 flex items-center gap-1 text-[10px] text-[hsl(var(--kf-accent1))]">
                        <ChevronRight className="w-3 h-3" />
                        {insight.suggestedAction}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleDismissInsight(insight.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground text-xs">
            {loading ? "Loading insights..." : "No insights yet. Click Run Assessment to generate."}
          </div>
        )}
      </motion.div>

      {/* Contact Growth */}
      {contactTrend.length > 1 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="rounded-2xl border border-border/40 bg-card/40 backdrop-blur-sm p-5"
        >
          <h3 className="text-xs font-semibold text-foreground mb-4 flex items-center gap-2">
            <BarChart3 className="w-3.5 h-3.5 text-[hsl(var(--kf-accent2))]" />
            Contact Growth (30d)
          </h3>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={contactTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="rgba(0,0,0,0.2)" />
              <YAxis tick={{ fontSize: 10 }} stroke="rgba(0,0,0,0.2)" />
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8 }} />
              <Bar dataKey="contacts" fill="hsl(var(--kf-accent2))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>
      )}
    </div>
  );
}
