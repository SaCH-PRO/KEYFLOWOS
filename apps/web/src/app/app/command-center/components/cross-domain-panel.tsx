"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  AlertCircle,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  Globe,
  Loader2,
  Lock,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
  XCircle,
  Zap,
} from "lucide-react";
import { SectionCard } from "@/components/ui/section-card";
import {
  checkGenomeAutonomyGate,
  computeGenomeCrossDomainSnapshot,
  detectGenomeCrossDomainOpportunities,
  generateAndRankGenomeRecommendations,
  getGenomeCrossDomainOpportunities,
  getGenomeCrossDomainRankedRecommendations,
  getGenomeCrossDomainSnapshot,
  type GenomeAutonomyGateDecisionValue,
  type GenomeAutonomyGateResult,
  type GenomeCrossDomainBottleneck,
  type GenomeCrossDomainDomainScore,
  type GenomeCrossDomainOpportunityCandidate,
  type GenomeCrossDomainSnapshot,
  type GenomeOpportunityDetectionResult,
  type GenomeRankedRecommendation,
  type GenomeRecommendationRankingResult,
} from "@/lib/api/business-genome";

interface CrossDomainPanelProps {
  businessId: string;
}

interface PanelAutonomy {
  decisions: GenomeAutonomyGateResult[];
  summary: {
    allowCount: number;
    escalateCount: number;
    blockCount: number;
    overallDecision: "ALLOW" | "BLOCK" | "ESCALATE";
    primaryBlockers: string[];
  };
}

interface PanelData {
  snapshot: GenomeCrossDomainSnapshot | null;
  recommendations: GenomeRecommendationRankingResult | null;
  opportunities: GenomeOpportunityDetectionResult | null;
  autonomy: PanelAutonomy | null;
}

const DOMAIN_LABELS: Record<string, string> = {
  finance: "Finance",
  customer_sales_revenue: "Sales & Revenue",
  operations_delivery: "Operations & Delivery",
  marketing_growth: "Marketing & Growth",
};

function domainLabel(domain: string) {
  return DOMAIN_LABELS[domain] ?? domain.replace(/_/g, " ");
}

function riskTone(risk?: string | null): "success" | "warning" | "danger" | "neutral" {
  const level = risk?.toUpperCase() ?? "";
  if (level === "CRITICAL" || level === "HIGH") return "danger";
  if (level === "MEDIUM") return "warning";
  if (level === "LOW") return "success";
  return "neutral";
}

function scoreTone(value: number): "success" | "warning" | "danger" {
  if (value >= 70) return "success";
  if (value >= 40) return "warning";
  return "danger";
}

function toneClass(tone: string) {
  switch (tone) {
    case "success":
      return "text-[hsl(var(--kf-success))]";
    case "warning":
      return "text-[hsl(var(--kf-warning))]";
    case "danger":
      return "text-destructive";
    default:
      return "text-muted-foreground";
  }
}

function badgeClass(tone: string) {
  switch (tone) {
    case "success":
      return "bg-[hsl(var(--kf-success))]/10 text-[hsl(var(--kf-success))]";
    case "warning":
      return "bg-[hsl(var(--kf-warning))]/10 text-[hsl(var(--kf-warning))]";
    case "danger":
      return "bg-destructive/10 text-destructive";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function MiniScore({ label, value }: { label: string; value: number }) {
  const tone = scoreTone(value);
  return (
    <div className="rounded-xl p-2 bg-muted/30">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold ${toneClass(tone)}`}>{value}%</div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border/40 bg-muted/20 p-4 text-center">
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

function buildAutonomySummary(decisions: GenomeAutonomyGateResult[]): PanelAutonomy["summary"] {
  let allowCount = 0;
  let escalateCount = 0;
  let blockCount = 0;
  const blockers = new Set<string>();

  for (const d of decisions) {
    if (d.decision === "ALLOW") {
      allowCount++;
    } else if (d.decision === "ALLOW_WITH_APPROVAL") {
      escalateCount++;
    } else if (d.decision === "BLOCK") {
      blockCount++;
      d.blockingReasons.forEach((r) => blockers.add(r));
    } else {
      escalateCount++;
      d.blockingReasons.forEach((r) => blockers.add(r));
    }
  }

  const overallDecision: PanelAutonomy["summary"]["overallDecision"] =
    blockCount > 0 ? "BLOCK" : escalateCount > 0 ? "ESCALATE" : "ALLOW";

  return {
    allowCount,
    escalateCount,
    blockCount,
    overallDecision,
    primaryBlockers: Array.from(blockers).slice(0, 5),
  };
}

export function CrossDomainPanel({ businessId }: CrossDomainPanelProps) {
  const [data, setData] = useState<PanelData>({
    snapshot: null,
    recommendations: null,
    opportunities: null,
    autonomy: null,
  });
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const evaluateAutonomy = async (
    recommendations: GenomeRecommendationRankingResult | null,
  ): Promise<PanelAutonomy | null> => {
    const candidates = recommendations?.rankedRecommendations.slice(0, 5) ?? [];
    if (candidates.length === 0) return null;

    const results = await Promise.all(
      candidates.map((rec) =>
        checkGenomeAutonomyGate(businessId, {
          actionType: rec.title,
          affectedDomains: rec.affectedDomains,
          payload: { recommendationId: rec.id },
        }).catch(() => ({ data: null, error: "check failed" })),
      ),
    );

    const decisions = results
      .map((r) => r.data)
      .filter((d): d is GenomeAutonomyGateResult => !!d);
    if (decisions.length === 0) return null;

    return { decisions, summary: buildAutonomySummary(decisions) };
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    const [snapshotRes, recommendationsRes, opportunitiesRes] = await Promise.all([
      getGenomeCrossDomainSnapshot(businessId, { includeOpportunities: true }),
      getGenomeCrossDomainRankedRecommendations(businessId),
      getGenomeCrossDomainOpportunities(businessId),
    ]);

    const snapshot = snapshotRes.error ? null : snapshotRes.data;
    const recommendations = recommendationsRes.error ? null : recommendationsRes.data;
    const opportunities = opportunitiesRes.error ? null : opportunitiesRes.data;

    const autonomy = await evaluateAutonomy(recommendations);

    setData({ snapshot, recommendations, opportunities, autonomy });

    const firstError = snapshotRes.error ?? recommendationsRes.error ?? opportunitiesRes.error;
    if (firstError) {
      setError(firstError);
    }
    setLoading(false);
  };

  const generate = async () => {
    setGenerating(true);
    setError(null);
    const [snapshotRes, recommendationsRes, opportunitiesRes] = await Promise.all([
      computeGenomeCrossDomainSnapshot(businessId),
      generateAndRankGenomeRecommendations(businessId),
      detectGenomeCrossDomainOpportunities(businessId),
    ]);

    const snapshot = snapshotRes.error ? data.snapshot : snapshotRes.data;
    const recommendations = recommendationsRes.error ? data.recommendations : recommendationsRes.data;
    const opportunities = opportunitiesRes.error ? data.opportunities : opportunitiesRes.data;
    const autonomy = await evaluateAutonomy(recommendations);

    setData({ snapshot, recommendations, opportunities, autonomy });

    const firstError = snapshotRes.error ?? recommendationsRes.error ?? opportunitiesRes.error;
    if (firstError) {
      setError(firstError);
    }
    setGenerating(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  if (loading) {
    return (
      <SectionCard title="Cross-Domain KEY Intelligence" icon={Globe} noPadding compact>
        <div className="p-6 flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-xs">Loading cross-domain intelligence...</span>
        </div>
      </SectionCard>
    );
  }

  const hasAnyData =
    data.snapshot || data.recommendations || data.opportunities || data.autonomy;

  if (error && !hasAnyData) {
    return (
      <SectionCard
        title="Cross-Domain KEY Intelligence"
        icon={Globe}
        action={{ label: "Retry", onClick: load, icon: RefreshCw }}
        noPadding
        compact
      >
        <div className="p-4 text-center">
          <p className="text-xs text-destructive">{error}</p>
        </div>
      </SectionCard>
    );
  }

  const snapshot = data.snapshot;
  const recommendations = data.recommendations?.rankedRecommendations ?? [];
  const opportunities = data.opportunities?.prioritizedOpportunities ?? [];
  const autonomy = data.autonomy;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <SectionCard
        title="Cross-Domain KEY Intelligence"
        subtitle="Ranked recommendations, opportunities, and autonomy gating across all business domains"
        icon={Globe}
        action={{
          label: generating ? "Generating..." : "Generate",
          onClick: generate,
          icon: generating ? Loader2 : RefreshCw,
        }}
        noPadding
        compact
      >
        <div className="p-3 space-y-4">
          {error && (
            <div className="rounded-lg bg-destructive/5 border border-destructive/20 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {snapshot && <SnapshotSummary snapshot={snapshot} />}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <DomainScoresCard scores={snapshot?.domainScores ?? []} />
            <AutonomyGateCard autonomy={autonomy} />
          </div>

          <RankedRecommendationsCard recommendations={recommendations} />
          <OpportunitiesCard opportunities={opportunities} />
          <BottlenecksCard bottlenecks={snapshot?.bottlenecks ?? []} />
        </div>
      </SectionCard>
    </motion.div>
  );
}

function SnapshotSummary({ snapshot }: { snapshot: GenomeCrossDomainSnapshot }) {
  const healthScore = snapshot.overallHealthScore;
  const readinessScore = snapshot.readinessSummary.averageReadinessScore;
  const confidenceScore =
    snapshot.evidenceSummary.totalFacts > 0
      ? Math.round(
          (snapshot.evidenceSummary.highConfidenceFacts / snapshot.evidenceSummary.totalFacts) * 100,
        )
      : 0;

  return (
    <div className="rounded-xl border border-border/30 bg-card/40 p-3 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[hsl(var(--kf-accent1))]/10 flex items-center justify-center">
            <BrainCircuit className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-foreground">Cross-Domain Snapshot</h4>
            <p className="text-[10px] text-muted-foreground">
              {new Date(snapshot.computedAt).toLocaleString()}
            </p>
          </div>
        </div>
        <span
          className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${badgeClass(
            riskTone(snapshot.overallRiskLevel),
          )}`}
        >
          {snapshot.overallRiskLevel} RISK
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <MiniScore label="Health" value={healthScore} />
        <MiniScore label="Readiness" value={readinessScore} />
        <MiniScore label="Confidence" value={confidenceScore} />
        <div className="rounded-xl p-2 bg-muted/30">
          <div className="text-[10px] text-muted-foreground">Evidence</div>
          <div className="text-sm font-semibold text-foreground">
            {snapshot.evidenceSummary.highConfidenceFacts}/{snapshot.evidenceSummary.totalFacts}
          </div>
        </div>
      </div>

      {(snapshot.readinessSummary.readyDepartments.length > 0 ||
        snapshot.readinessSummary.atRiskDepartments.length > 0) && (
        <div className="space-y-1.5">
          {snapshot.readinessSummary.readyDepartments.length > 0 && (
            <div className="text-[10px] text-[hsl(var(--kf-success))] font-medium">Ready departments</div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {snapshot.readinessSummary.readyDepartments.map((d) => (
              <span
                key={d}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[hsl(var(--kf-success))]/10 text-[hsl(var(--kf-success))] text-[10px]"
              >
                <CheckCircle2 className="w-3 h-3" />
                {d}
              </span>
            ))}
          </div>
          {snapshot.readinessSummary.atRiskDepartments.length > 0 && (
            <div className="text-[10px] text-destructive font-medium mt-2">At-risk departments</div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {snapshot.readinessSummary.atRiskDepartments.map((d) => (
              <span
                key={d}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-destructive/10 text-destructive text-[10px]"
              >
                <XCircle className="w-3 h-3" />
                {d}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DomainScoresCard({ scores }: { scores: GenomeCrossDomainDomainScore[] }) {
  if (scores.length === 0) {
    return (
      <SectionCard title="Domain Scores" icon={Activity} compact noPadding>
        <div className="p-3">
          <EmptyState message="No domain scores available yet." />
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Domain Scores" icon={Activity} compact noPadding>
      <div className="p-3 space-y-2">
        {scores.map((s) => {
          const tone = riskTone(s.riskLevel);
          return (
            <div
              key={s.domain}
              className="rounded-lg border border-border/30 bg-muted/20 p-2.5 space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-foreground">{domainLabel(s.domain)}</span>
                <span className={`text-[10px] font-medium ${toneClass(tone)}`}>{s.riskLevel}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <MiniScore label="Health" value={s.healthScore} />
                <div className="rounded-xl p-2 bg-muted/30">
                  <div className="text-[10px] text-muted-foreground">Snapshot</div>
                  <div className="text-sm font-semibold text-foreground truncate">
                    {s.snapshotId ? "Present" : "None"}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}

function decisionTone(decision: GenomeAutonomyGateDecisionValue) {
  if (decision === "ALLOW") return "success";
  if (decision === "ALLOW_WITH_APPROVAL") return "warning";
  if (decision === "BLOCK") return "danger";
  return "warning";
}

function AutonomyGateCard({ autonomy }: { autonomy: PanelAutonomy | null }) {
  const decisions = autonomy?.decisions ?? [];
  const summary = autonomy?.summary;

  if (!autonomy || decisions.length === 0) {
    return (
      <SectionCard title="Autonomy Gate" icon={ShieldAlert} compact noPadding>
        <div className="p-3">
          <EmptyState message="Autonomy gate not evaluated yet." />
        </div>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Autonomy Gate" icon={ShieldAlert} compact noPadding>
      <div className="p-3 space-y-3">
        {summary && (
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl p-2 bg-[hsl(var(--kf-success))]/10 text-center">
              <div className="text-[10px] text-[hsl(var(--kf-success))]">Allow</div>
              <div className="text-sm font-semibold text-[hsl(var(--kf-success))]">{summary.allowCount}</div>
            </div>
            <div className="rounded-xl p-2 bg-[hsl(var(--kf-warning))]/10 text-center">
              <div className="text-[10px] text-[hsl(var(--kf-warning))]">Escalate</div>
              <div className="text-sm font-semibold text-[hsl(var(--kf-warning))]">{summary.escalateCount}</div>
            </div>
            <div className="rounded-xl p-2 bg-destructive/10 text-center">
              <div className="text-[10px] text-destructive">Block</div>
              <div className="text-sm font-semibold text-destructive">{summary.blockCount}</div>
            </div>
          </div>
        )}

        {summary && summary.primaryBlockers.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] text-destructive font-medium">Primary blockers</div>
            <div className="flex flex-wrap gap-1">
              {summary.primaryBlockers.map((b) => (
                <span
                  key={b}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-destructive/10 text-destructive text-[10px]"
                >
                  <Lock className="w-3 h-3" />
                  {b}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
          {decisions.map((d) => {
            const tone = decisionTone(d.decision);
            return (
              <div
                key={d.actionType}
                className="flex items-start gap-2 rounded-lg bg-muted/30 px-2 py-1.5"
              >
                {d.decision === "ALLOW" ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-[hsl(var(--kf-success))] mt-0.5 flex-shrink-0" />
                ) : d.decision === "BLOCK" ? (
                  <XCircle className="w-3.5 h-3.5 text-destructive mt-0.5 flex-shrink-0" />
                ) : (
                  <ShieldAlert className="w-3.5 h-3.5 text-[hsl(var(--kf-warning))] mt-0.5 flex-shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-medium text-foreground">{d.actionType}</span>
                    <span className={`text-[10px] font-semibold ${toneClass(tone)}`}>{d.decision}</span>
                  </div>
                  {d.blockingReasons.length > 0 && (
                    <p className="text-[10px] text-muted-foreground truncate">
                      {d.blockingReasons.join(" • ")}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </SectionCard>
  );
}

function RankedRecommendationsCard({ recommendations }: { recommendations: GenomeRankedRecommendation[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? recommendations : recommendations.slice(0, 3);

  return (
    <SectionCard title={`Ranked Recommendations (${recommendations.length})`} icon={TrendingUp} compact noPadding>
      <div className="p-3 space-y-2">
        {recommendations.length === 0 ? (
          <EmptyState message="No ranked recommendations available yet." />
        ) : (
          <>
            <AnimatePresence>
              {visible.map((r) => (
                <motion.div
                  key={r.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  className="rounded-lg border border-border/30 bg-muted/20 p-2.5 space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h5 className="text-xs font-semibold text-foreground">{r.title}</h5>
                      <p className="text-[10px] text-muted-foreground leading-relaxed">{r.insight}</p>
                    </div>
                    <span className="text-xs font-bold text-[hsl(var(--kf-accent1))]">{r.rankScore.toFixed(0)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-md ${badgeClass(riskTone(r.riskLevel))}`}>
                      {r.riskLevel}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
                      {r.effortLevel}
                    </span>
                    {r.affectedDomains.map((d) => (
                      <span
                        key={d}
                        className="text-[10px] px-1.5 py-0.5 rounded-md bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))]"
                      >
                        {domainLabel(d)}
                      </span>
                    ))}
                  </div>
                  {r.rankReason && (
                    <p className="text-[10px] text-muted-foreground italic">{r.rankReason}</p>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
            {recommendations.length > 3 && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="inline-flex items-center gap-1 text-[10px] font-medium text-[hsl(var(--kf-accent1))] hover:text-[hsl(var(--kf-accent1))]/80 transition-colors"
              >
                {expanded ? "Show less" : `Show ${recommendations.length - 3} more`}
                <ChevronRight className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`} />
              </button>
            )}
          </>
        )}
      </div>
    </SectionCard>
  );
}

function OpportunitiesCard({ opportunities }: { opportunities: GenomeCrossDomainOpportunityCandidate[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? opportunities : opportunities.slice(0, 3);

  return (
    <SectionCard title={`Cross-Domain Opportunities (${opportunities.length})`} icon={Zap} compact noPadding>
      <div className="p-3 space-y-2">
        {opportunities.length === 0 ? (
          <EmptyState message="No cross-domain opportunities detected yet." />
        ) : (
          <>
            <AnimatePresence>
              {visible.map((o) => (
                <motion.div
                  key={o.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  className="rounded-lg border border-border/30 bg-muted/20 p-2.5 space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h5 className="text-xs font-semibold text-foreground">{o.label}</h5>
                      <p className="text-[10px] text-muted-foreground leading-relaxed">
                        Impact: {o.potentialImpact}
                      </p>
                    </div>
                    <span className="text-xs font-bold text-[hsl(var(--kf-accent1))]">
                      {o.estimatedValueScore.toFixed(0)}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">{o.suggestedAction}</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground">
                      Conf {Math.round(o.confidence)}%
                    </span>
                    {o.affectedDomains.map((d) => (
                      <span
                        key={d}
                        className="text-[10px] px-1.5 py-0.5 rounded-md bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))]"
                      >
                        {domainLabel(d)}
                      </span>
                    ))}
                  </div>
                  {o.requiredConditions.length > 0 && (
                    <p className="text-[10px] text-muted-foreground truncate">
                      Needs: {o.requiredConditions.join(" • ")}
                    </p>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
            {opportunities.length > 3 && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="inline-flex items-center gap-1 text-[10px] font-medium text-[hsl(var(--kf-accent1))] hover:text-[hsl(var(--kf-accent1))]/80 transition-colors"
              >
                {expanded ? "Show less" : `Show ${opportunities.length - 3} more`}
                <ChevronRight className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`} />
              </button>
            )}
          </>
        )}
      </div>
    </SectionCard>
  );
}

function BottlenecksCard({ bottlenecks }: { bottlenecks: GenomeCrossDomainBottleneck[] }) {
  return (
    <SectionCard title={`Bottlenecks (${bottlenecks.length})`} icon={AlertCircle} compact noPadding>
      <div className="p-3 space-y-2">
        {bottlenecks.length === 0 ? (
          <EmptyState message="No cross-domain bottlenecks detected." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {bottlenecks.map((b, idx) => {
              const tone = riskTone(b.severity);
              return (
                <div
                  key={`${b.domain}-${idx}`}
                  className="rounded-lg border border-border/30 bg-muted/20 p-2.5 space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-foreground">{domainLabel(b.domain)}</span>
                    <span className={`text-[10px] font-semibold ${toneClass(tone)}`}>{b.severity}</span>
                  </div>
                  <div className="text-[10px] text-foreground font-medium">{b.label}</div>
                  {b.reason && <div className="text-[10px] text-muted-foreground">{b.reason}</div>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </SectionCard>
  );
}
