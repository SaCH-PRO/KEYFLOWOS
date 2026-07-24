"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Dna, ArrowRight, Sparkles, Brain, AlertTriangle, Grid3X3, Trophy, Medal } from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import { getGenomeRecommendations, type GenomeIntegrityResult, type DnaSectionKey } from "@/lib/api/business-genome";
import { getExecutiveBrief, type BusinessExecutiveBrief } from "@/lib/api/intelligence";
import { ProgressRing } from "@/components/ui-v2/progress-ring";
import { Badge } from "@/components/ui-v2/badge";
import { useAnimatedNumber } from "@/hooks/use-animated-number";
import { GenomeMilestone } from "./genome-milestone";

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
  risk: "hsl(0 75% 55%)",
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

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: "teal" | "orange" | "rose" | "sky" | "mint" | "gold";
}) {
  const colorMap: Record<typeof color, string> = {
    teal: "hsl(var(--kf-success, 160 70% 45%))",
    orange: "hsl(var(--kf-accent1))",
    rose: "hsl(var(--kf-warning, 30 90% 55%))",
    sky: "hsl(210 80% 60%)",
    mint: "hsl(var(--kf-success, 160 70% 45%))",
    gold: "hsl(var(--kf-accent1))",
  };
  return (
    <div
      className="rounded-xl p-3 text-center border"
      style={{
        background: `${colorMap[color]}08`,
        borderColor: `${colorMap[color]}25`,
      }}
    >
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-lg font-bold mt-0.5" style={{ color: colorMap[color] }}>
        {value}
      </div>
    </div>
  );
}

function SectionScoreCard({
  section,
  onClick,
}: {
  section: GenomeIntegrityResult["dnaSections"][number];
  onClick: () => void;
}) {
  return (
    <button
      key={section.key}
      onClick={onClick}
      className="text-left rounded-xl p-3 transition-all hover:scale-[1.02] hover:shadow-sm bg-card border border-border/20"
    >
      <div className="flex items-center gap-2 mb-2">
        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: DNA_COLORS[section.key] }} />
        <span className="text-xs font-medium truncate">{section.label}</span>
      </div>
      <div className="text-xl font-bold" style={{ color: scoreColor(section.integrity) }}>
        {section.integrity}%
      </div>
      <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(section.integrity, 100)}%`, background: scoreColor(section.integrity) }}
        />
      </div>
      <div className="text-[10px] text-muted-foreground mt-1.5">
        {section.fieldsCaptured}/{section.fieldsTotal} fields
      </div>
    </button>
  );
}

export function GenomeOverview({ genome, onSectionClick }: GenomeOverviewProps) {
  const router = useRouter();
  const businessId = getStoredBusinessId();
  const [recommendation, setRecommendation] = useState<string | null>(null);
  const [brief, setBrief] = useState<BusinessExecutiveBrief | null>(null);

  useEffect(() => {
    if (!businessId) return;
    getGenomeRecommendations(businessId).then(({ data }) => {
      if (data?.length) {
        setRecommendation(data[0].title + ". " + data[0].insight);
      }
    });
    getExecutiveBrief(businessId).then(({ data }) => {
      if (data) setBrief(data);
    });
  }, [businessId, genome.genomeIntegrity]);

  const totalFields = genome.dnaSections.reduce((sum, s) => sum + s.fieldsTotal, 0);
  const capturedFields = genome.dnaSections.reduce((sum, s) => sum + s.fieldsCaptured, 0);
  const strongCount = genome.dnaSections.filter((s) => s.integrity >= 80).length;

  const weakestSections = [...genome.dnaSections]
    .filter((s) => s.integrity < 100)
    .sort((a, b) => a.integrity - b.integrity)
    .slice(0, 3);

  const strongSections = [...genome.dnaSections]
    .filter((s) => s.integrity >= 50)
    .sort((a, b) => b.integrity - a.integrity)
    .slice(0, 3);

  const integrityRingColor = genome.genomeIntegrity >= 80 ? "teal" : genome.genomeIntegrity >= 50 ? "orange" : "rose";

  const animatedIntegrity = useAnimatedNumber(genome.genomeIntegrity, { duration: 1000, decimals: 0 });
  const animatedReadiness = useAnimatedNumber(genome.executiveReadinessScore, { duration: 1000, decimals: 0 });

  return (
    <div className="space-y-5">
      <GenomeMilestone businessId={businessId} integrity={genome.genomeIntegrity} />
      {/* Hero — single integrity ring + key stats */}
      <div
        className="rounded-2xl p-6 relative overflow-hidden"
        style={{
          background: "linear-gradient(135deg, hsl(var(--kf-card)) 0%, hsl(var(--kf-muted) / 0.1) 100%)",
          border: "1px solid hsl(var(--kf-border) / 0.2)",
        }}
      >
        <div className="relative flex flex-col lg:flex-row items-center lg:items-center gap-6">
          <div className="flex items-center gap-5">
            <div className="relative">
              <ProgressRing
                value={genome.genomeIntegrity}
                size={96}
                thickness={10}
                segments={12}
                color={integrityRingColor}
              />
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <Dna className="w-5 h-5 mb-0.5" style={{ color: scoreColor(genome.genomeIntegrity) }} />
                <span className="text-2xl font-bold">{animatedIntegrity}%</span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Integrity</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Badge color={genome.genomeIntegrity >= 80 ? "mint" : genome.genomeIntegrity >= 50 ? "gold" : "rose"}>
                {genome.genomeStage.replace(/_/g, " ")}
              </Badge>
              <h2 className="text-xl font-semibold">Business Genome</h2>
              <p className="text-xs text-muted-foreground">
                {strongCount}/{genome.dnaSections.length} sections strong · {capturedFields}/{totalFields} fields captured
              </p>
            </div>
          </div>

          <div className="flex-1 grid grid-cols-3 gap-3 w-full lg:w-auto">
            <StatCard
              label="Readiness"
              value={`${animatedReadiness}%`}
              color={genome.executiveReadinessScore >= 80 ? "teal" : genome.executiveReadinessScore >= 50 ? "orange" : "rose"}
            />
            <StatCard label="Fields" value={`${capturedFields}/${totalFields}`} color="sky" />
            <StatCard
              label="Status"
              value={genome.threePillarMinimumMet ? "Ready" : "Building"}
              color={genome.threePillarMinimumMet ? "mint" : "gold"}
            />
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

      {/* Executive Brief mini-card */}
      {brief && (
        <div
          className="rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-4 cursor-pointer group transition-colors hover:bg-card/80"
          style={{
            background: "linear-gradient(90deg, hsl(var(--kf-accent2) / 0.08), hsl(var(--kf-accent1) / 0.04))",
            border: "1px solid hsl(var(--kf-accent2) / 0.15)",
          }}
          onClick={() => router.push("/app/intelligence")}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter") router.push("/app/intelligence");
          }}
        >
          <div className="flex-shrink-0">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ background: "hsl(var(--kf-accent2) / 0.12)" }}
            >
              <Brain className="w-5 h-5" style={{ color: "hsl(var(--kf-accent2))" }} />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <h3 className="text-sm font-semibold">KEY Executive Brief</h3>
              {brief.topPriorities.some((p) => p.priority === "CRITICAL" || p.priority === "HIGH") && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  {brief.topPriorities.filter((p) => p.priority === "CRITICAL" || p.priority === "HIGH").length} urgent
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground line-clamp-2">
              Executive Readiness: {brief.executiveReadinessScore}% · {brief.topPriorities.length} top-priority
              insight{brief.topPriorities.length === 1 ? "" : "s"}
              {brief.topPriorities.find((i) => i.id === "pending-evolution-proposals")
                ? ` · ${brief.topPriorities.find((i) => i.id === "pending-evolution-proposals")?.title}`
                : ""}
            </p>
          </div>
          <button
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-colors shrink-0"
            style={{ background: "hsl(var(--kf-accent2))", color: "hsl(var(--kf-accent2-foreground, 0 0% 100%))" }}
          >
            Open Intelligence
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* DNA Bento grid */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Grid3X3 className="w-4 h-4 text-muted-foreground" />
            DNA Sections
          </h3>
          <button
            onClick={onSectionClick}
            className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
          >
            View all
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
          {genome.dnaSections.map((section) => (
            <SectionScoreCard key={section.key} section={section} onClick={onSectionClick} />
          ))}
        </div>
      </div>

      {/* Quick insight */}
      {(weakestSections.length > 0 || strongSections.length > 0) && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="kf-card p-4" style={{ borderColor: "hsl(var(--kf-warning) / 0.2)" }}>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-[hsl(var(--kf-warning))]" />
              Needs attention
            </h4>
            <div className="space-y-2.5">
              {weakestSections.map((s, idx) => (
                <div key={s.key} className="flex items-center gap-3 text-sm">
                  <span
                    className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold"
                    style={{ background: scoreBg(s.integrity), color: scoreColor(s.integrity) }}
                  >
                    {idx + 1}
                  </span>
                  <span className="flex-1 truncate">{s.label}</span>
                  <span className="font-medium tabular-nums" style={{ color: scoreColor(s.integrity) }}>
                    {s.integrity}%
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="kf-card p-4" style={{ borderColor: "hsl(var(--kf-success) / 0.2)" }}>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
              <Trophy className="w-3.5 h-3.5 text-[hsl(var(--kf-success))]" />
              Strongest
            </h4>
            <div className="space-y-2.5">
              {strongSections.map((s, idx) => (
                <div key={s.key} className="flex items-center gap-3 text-sm">
                  <Medal className="w-4 h-4 flex-shrink-0" style={{ color: idx === 0 ? "hsl(45 90% 50%)" : scoreColor(s.integrity) }} />
                  <span className="flex-1 truncate">{s.label}</span>
                  <span className="font-medium tabular-nums" style={{ color: scoreColor(s.integrity) }}>
                    {s.integrity}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
