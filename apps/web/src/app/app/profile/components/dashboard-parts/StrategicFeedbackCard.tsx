"use client";

import { motion } from "framer-motion";
import { Award, CheckCircle2, AlertCircle, Shield, DollarSign, Compass, Zap } from "lucide-react";
import { AssessmentResult, Metrics, Recommendation, fadeUp } from "./types";

export function StrategicFeedbackCard({
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
