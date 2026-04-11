"use client";

import { motion } from "framer-motion";
import { TrendingUp, Activity, ArrowUp, ArrowDown } from "lucide-react";
import { lazy, Suspense } from "react";
import { AssessmentResult, CategoryScores, ProgressSnapshot, DIMENSION_MAP, getDimensionScore, fadeUp } from "./types";

const LazyAreaChart = lazy(() =>
  import("recharts").then((mod) => ({
    default: function AreaChartWrapper({ data }: { data: { date: string; score: number }[] }) {
      const { ResponsiveContainer, AreaChart, XAxis, YAxis, Tooltip, Area } = mod;
      return (
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
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
      );
    },
  }))
);

export function ProgressChart({
  assessment,
  progressHistory,
}: {
  assessment: AssessmentResult;
  progressHistory: ProgressSnapshot[];
}) {
  const chartData = (() => {
    const history = progressHistory
      .slice()
      .reverse()
      .map((s) => ({
        date: new Date(s.snapshotDate).toLocaleDateString("en-TT", { month: "short", day: "numeric" }),
        score: s.overallScore ?? 0,
      }));
    history.push({
      date: new Date(assessment.createdAt).toLocaleDateString("en-TT", { month: "short", day: "numeric" }),
      score: assessment.overallScore ?? 0,
    });
    return history;
  })();

  const hasProgressData = chartData.length > 1;
  const prevSnapshot = progressHistory.length > 0 ? progressHistory[0] : null;
  const prevCatScores = prevSnapshot?.categoryScores as CategoryScores | null;
  const scores = assessment.categoryScores;

  return (
    <motion.div variants={fadeUp} className="kf-card p-6 space-y-4 md:col-span-2">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <TrendingUp className="h-4 w-4" style={{ color: "hsl(var(--kf-accent1))" }} />
        Progress Tracking
      </div>
      {hasProgressData ? (
        <>
          <Suspense fallback={<div className="h-48 bg-muted/10 rounded-xl animate-pulse" />}>
            <LazyAreaChart data={chartData} />
          </Suspense>
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
  );
}
