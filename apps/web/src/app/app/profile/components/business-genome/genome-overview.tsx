"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Dna, ArrowRight, Sparkles, TrendingUp } from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import { getGenomeRecommendations, type GenomeIntegrityResult, type DnaSectionKey } from "@/lib/api/business-genome";

interface GenomeOverviewProps {
  genome: GenomeIntegrityResult;
  onSectionClick: () => void;
}

const DNA_COLORS: Record<DnaSectionKey, string> = {
  founder: "hsl(var(--kf-accent1))",
  vision: "hsl(var(--kf-violet-accent))",
  business: "hsl(var(--kf-accent2))",
  market: "hsl(210 80% 60%)",
  financial: "hsl(145 70% 45%)",
  legal: "hsl(260 70% 60%)",
  operations: "hsl(35 90% 55%)",
  sales: "hsl(0 80% 60%)",
  marketing: "hsl(320 80% 60%)",
  growth: "hsl(170 80% 40%)",
  technology: "hsl(190 90% 55%)",
};

function scoreColor(score: number): string {
  if (score >= 80) return "hsl(var(--kf-success, 160 70% 45%))";
  if (score >= 50) return "hsl(var(--kf-accent1))";
  return "hsl(var(--kf-warning, 30 90% 55%))";
}

function scoreBg(score: number): string {
  if (score >= 80) return "hsl(var(--kf-success, 160 70% 45%) / 0.08)";
  if (score >= 50) return "hsl(var(--kf-accent1) / 0.08)";
  return "hsl(var(--kf-warning, 30 90% 55%) / 0.08)";
}

export function GenomeOverview({ genome, onSectionClick }: GenomeOverviewProps) {
  const businessId = getStoredBusinessId();
  const [recommendation, setRecommendation] = useState<string | null>(null);

  useEffect(() => {
    if (!businessId) return;
    getGenomeRecommendations(businessId).then(({ data }) => {
      if (data?.recommendations?.length) {
        setRecommendation(data.recommendations[0].title + ". " + data.recommendations[0].reason);
      }
    });
  }, [businessId, genome.genomeIntegrity]);

  const circumference = 2 * Math.PI * 52;
  const strokeDashoffset = circumference * (1 - genome.genomeIntegrity / 100);

  const weakestSections = [...genome.dnaSections]
    .filter((s) => s.integrity < 100)
    .sort((a, b) => a.integrity - b.integrity)
    .slice(0, 3);

  const strongSections = [...genome.dnaSections]
    .filter((s) => s.integrity >= 50)
    .sort((a, b) => b.integrity - a.integrity)
    .slice(0, 3);

  return (
    <div className="space-y-4">
      {/* Header card */}
      <div
        className="rounded-2xl p-6 relative overflow-hidden"
        style={{
          background: "linear-gradient(135deg, hsl(var(--kf-card)) 0%, hsl(var(--kf-muted) / 0.1) 100%)",
          border: "1px solid hsl(var(--kf-border) / 0.2)",
        }}
      >
        <div className="flex flex-col md:flex-row md:items-center gap-6">
          <div className="relative flex-shrink-0 mx-auto md:mx-0">
            <svg width="120" height="120" viewBox="0 0 120 120" className="-rotate-90">
              <circle cx="60" cy="60" r="52" fill="none" stroke="hsl(var(--kf-muted) / 0.2)" strokeWidth="10" />
              <motion.circle
                cx="60"
                cy="60"
                r="52"
                fill="none"
                stroke={scoreColor(genome.genomeIntegrity)}
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={circumference}
                initial={{ strokeDashoffset: circumference }}
                animate={{ strokeDashoffset }}
                transition={{ duration: 0.8, ease: "easeOut" }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <Dna className="w-5 h-5 mb-0.5" style={{ color: scoreColor(genome.genomeIntegrity) }} />
              <span className="text-2xl font-bold">{genome.genomeIntegrity}%</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Integrity</span>
            </div>
          </div>

          <div className="flex-1 text-center md:text-left">
            <h2 className="text-xl font-semibold">Business Genome</h2>
            <p className="text-sm text-muted-foreground mt-1">
              The living DNA of your business. Complete each section so KEY can operate with full context.
            </p>
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-3 mt-4">
              <div
                className="px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{ background: "hsl(var(--kf-muted) / 0.15)" }}
              >
                Stage: <span className="font-semibold">{genome.genomeStage.replace(/_/g, " ")}</span>
              </div>
              <div
                className="px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{ background: "hsl(var(--kf-muted) / 0.15)" }}
              >
                {genome.threePillarMinimumMet ? (
                  <span style={{ color: "hsl(var(--kf-success))" }}>Three-Pillar Minimum met</span>
                ) : (
                  <span style={{ color: "hsl(var(--kf-warning))" }}>Three-Pillar Minimum pending</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Next action */}
      <div
        className="rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-4"
        style={{
          background: "linear-gradient(90deg, hsl(var(--kf-accent1) / 0.08), hsl(var(--kf-accent2) / 0.04))",
          border: "1px solid hsl(var(--kf-accent1) / 0.15)",
        }}
      >
        <div className="flex-shrink-0">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ background: "hsl(var(--kf-accent1) / 0.12)" }}
          >
            <Sparkles className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold">KEY recommends</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            {recommendation ||
              (weakestSections.length
                ? `Strengthen ${weakestSections[0].label} next (${weakestSections[0].integrity}% complete).`
                : "Your Genome is complete. Keep it updated as your business evolves.")}
          </p>
        </div>
        <button
          onClick={onSectionClick}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-colors"
          style={{ background: "hsl(var(--kf-accent1))", color: "hsl(var(--kf-accent1-foreground, 0 0% 100%))" }}
        >
          Review DNA
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Strength grid */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">DNA Strength</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
          {genome.dnaSections.map((section) => (
            <button
              key={section.key}
              onClick={onSectionClick}
              className="text-left rounded-xl p-3 transition-transform hover:scale-[1.02]"
              style={{
                background: scoreBg(section.integrity),
                border: `1px solid ${scoreColor(section.integrity).replace(")", " / 0.25)")}`,
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ background: DNA_COLORS[section.key] }}
                />
                <span className="text-xs font-medium truncate">{section.label}</span>
              </div>
              <div className="text-xl font-bold" style={{ color: scoreColor(section.integrity) }}>
                {section.integrity}%
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {section.fieldsCaptured}/{section.fieldsTotal} fields
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Quick insight */}
      {(weakestSections.length > 0 || strongSections.length > 0) && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="kf-card p-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Needs attention</h4>
            <div className="space-y-2">
              {weakestSections.map((s) => (
                <div key={s.key} className="flex items-center justify-between text-sm">
                  <span>{s.label}</span>
                  <span className="font-medium" style={{ color: scoreColor(s.integrity) }}>{s.integrity}%</span>
                </div>
              ))}
            </div>
          </div>
          <div className="kf-card p-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Strongest</h4>
            <div className="space-y-2">
              {strongSections.map((s) => (
                <div key={s.key} className="flex items-center justify-between text-sm">
                  <span>{s.label}</span>
                  <span className="font-medium" style={{ color: scoreColor(s.integrity) }}>{s.integrity}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
