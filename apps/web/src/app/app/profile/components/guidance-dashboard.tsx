"use client";

import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
  BarChart3, RefreshCw, Edit3, AlertCircle, Activity,
  Compass, Target, FileText,
} from "lucide-react";
import { Button } from "@keyflow/ui";
import { apiGet, apiPostSimple } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  CategoryScores, Metrics, AssessmentResult, Recommendation, RoadmapItem,
  ProgressSnapshot, DashboardData,
  DIMENSION_MAP, getDimensionScore,
  fadeUp,
} from "./dashboard-parts/types";
import { HealthGauge } from "./dashboard-parts/HealthGauge";
import { BusinessSnapshotCard } from "./dashboard-parts/BusinessSnapshotCard";
import { ProfitabilityCard } from "./dashboard-parts/ProfitabilityCard";
import { StrategicFeedbackCard } from "./dashboard-parts/StrategicFeedbackCard";
import { ProgressChart } from "./dashboard-parts/ProgressChart";
import { DimensionScoresGrid } from "./dashboard-parts/DimensionScoresGrid";
import { RiskAlertsCard } from "./dashboard-parts/RiskAlertsCard";
import { RecommendationsCard } from "./dashboard-parts/RecommendationsCard";
import { RoadmapCard } from "./dashboard-parts/RoadmapCard";
import { OpportunitiesCard } from "./dashboard-parts/OpportunitiesCard";

export type {
  CategoryScores, Metrics, AssessmentResult, Recommendation, RoadmapItem,
  ProgressSnapshot, DashboardData,
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

interface GuidanceDashboardProps {
  onEditProfile: () => void;
  onGoToDocuments?: () => void;
}

export default function GuidanceDashboard({ onEditProfile, onGoToDocuments }: GuidanceDashboardProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [reanalyzeError, setReanalyzeError] = useState<string | null>(null);

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
        setError(null);
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
    setReanalyzeError(null);

    const reanalyzeRes = await apiPostSimple(`/business-guidance/${businessId}/reanalyze`, {});
    if (reanalyzeRes.error) {
      setReanalyzeError(`Re-analysis failed: ${reanalyzeRes.error}`);
      setReanalyzing(false);
      return;
    }

    const submitRes = await apiPostSimple(`/business-guidance/${businessId}/submit`, {});
    if (submitRes.error) {
      setReanalyzeError(`Failed to submit re-analysis: ${submitRes.error}`);
      setReanalyzing(false);
      return;
    }

    setLoading(true);
    await fetchDashboard();
    setReanalyzing(false);
  };

  const assessment = data?.latestAssessment;
  const scores = assessment?.categoryScores ?? null;
  const metrics = assessment?.metrics ?? null;

  const strongestDim = useMemo(() => {
    if (!scores) return null;
    let best: { key: string; score: number } | null = null;
    for (const [key, dim] of Object.entries(DIMENSION_MAP)) {
      const val = getDimensionScore(scores, dim.key);
      if (val !== null && (best === null || val > best.score)) {
        best = { key, score: val };
      }
    }
    return best;
  }, [scores]);

  const weakestDim = useMemo(() => {
    if (!scores) return null;
    let worst: { key: string; score: number } | null = null;
    for (const [key, dim] of Object.entries(DIMENSION_MAP)) {
      const val = getDimensionScore(scores, dim.key);
      if (val !== null && (worst === null || val < worst.score)) {
        worst = { key, score: val };
      }
    }
    return worst;
  }, [scores]);

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
        <div className="flex flex-wrap gap-2">
          <Button onClick={onEditProfile} className="min-h-[44px] flex items-center gap-1.5">
            <Edit3 className="w-4 h-4" />
            Edit Profile
          </Button>
          <Button onClick={handleReanalyze} disabled={reanalyzing} className="min-h-[44px] flex items-center gap-1.5">
            <RefreshCw className={`w-4 h-4 ${reanalyzing ? "animate-spin" : ""}`} />
            {reanalyzing ? "Analyzing..." : "Re-analyze"}
          </Button>
          {onGoToDocuments && (
            <Button
              onClick={onGoToDocuments}
              className="min-h-[44px] flex items-center gap-1.5"
              style={{ background: "hsl(var(--kf-accent2))", color: "#fff" }}
            >
              <FileText className="w-4 h-4" />
              Generate Documents
            </Button>
          )}
        </div>
      </motion.div>

      {reanalyzeError && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20">
          <p className="text-xs text-red-400">{reanalyzeError}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <BusinessSnapshotCard data={data} />

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

        <DimensionScoresGrid scores={scores} />

        <ProfitabilityCard metrics={metrics} />

        <RecommendationsCard recommendations={nonCriticalRecs} />

        <RiskAlertsCard assessment={assessment} criticalRecs={criticalRecs} />

        <RoadmapCard items={data.nextRoadmapItems} />

        <StrategicFeedbackCard
          assessment={assessment}
          metrics={metrics}
          topRecommendation={data.topRecommendations[0] ?? null}
        />

        <OpportunitiesCard opportunities={assessment.opportunities} />

        <ProgressChart
          assessment={assessment}
          progressHistory={data.progressHistory}
        />
      </div>
    </motion.div>
  );
}
