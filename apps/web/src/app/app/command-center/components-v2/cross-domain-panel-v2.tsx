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
import { cn } from "@/lib/utils";
import { Surface } from "@/components/ui-v2/surface";
import { Badge } from "@/components/ui-v2/badge";
import { StatOrb } from "@/components/ui-v2/stat-orb";
import { MissionCard } from "@/components/ui-v2/mission-card";
import {
  checkGenomeAutonomyGate,
  getGenomeCrossDomainSnapshot,
  getGenomeCrossDomainRankedRecommendations,
  getGenomeCrossDomainOpportunities,
  computeGenomeCrossDomainSnapshot,
  generateAndRankGenomeRecommendations,
  detectGenomeCrossDomainOpportunities,
  type GenomeAutonomyGateResult,
  type GenomeAutonomyGateDecisionValue,
  type GenomeCrossDomainBottleneck,
  type GenomeCrossDomainDomainScore,
  type GenomeCrossDomainOpportunityCandidate,
  type GenomeCrossDomainSnapshot,
  type GenomeOpportunityDetectionResult,
  type GenomeRankedRecommendation,
  type GenomeRecommendationRankingResult,
} from "@/lib/api/business-genome";

interface CrossDomainPanelV2Props {
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

function MiniScore({ label, value }: { label: string; value: number }) {
  const tone = scoreTone(value);
  return (
    <div className="rounded-xl p-2 bg-surface-muted">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div
        className={cn(
          "text-sm font-semibold font-mono",
          tone === "success" && "text-mint",
          tone === "warning" && "text-gold",
          tone === "danger" && "text-rose",
        )}
      >
        {value}%
      </div>
    </div>
  );
}

function PanelEmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border/40 bg-surface-muted p-4 text-center">
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

export function CrossDomainPanelV2({ businessId }: CrossDomainPanelV2Props) {
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
      <Surface className="p-6 flex items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-xs">Loading cross-domain intelligence...</span>
      </Surface>
    );
  }

  const hasAnyData =
    data.snapshot || data.recommendations || data.opportunities || data.autonomy;

  if (error && !hasAnyData) {
    return (
      <Surface className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet/10">
              <Globe className="h-3.5 w-3.5 text-violet" />
            </div>
            <h3 className="font-display text-sm font-semibold text-foreground">
              Cross-Domain KEY Intelligence
            </h3>
          </div>
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:text-primary/80 transition-colors"
          >
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
        </div>
        <p className="text-xs text-rose">{error}</p>
      </Surface>
    );
  }

  const snapshot = data.snapshot;
  const recommendations = data.recommendations?.rankedRecommendations ?? [];
  const opportunities = data.opportunities?.prioritizedOpportunities ?? [];
  const autonomy = data.autonomy;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <Surface className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet/10">
              <Globe className="h-3.5 w-3.5 text-violet" />
            </div>
            <div>
              <h3 className="font-display text-sm font-semibold text-foreground">
                Cross-Domain KEY Intelligence
              </h3>
              <p className="text-[10px] text-muted-foreground">
                Ranked recommendations, opportunities, and autonomy gating across all business domains
              </p>
            </div>
          </div>
          <button
            onClick={() => void generate()}
            disabled={generating}
            className="inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
          >
            {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            {generating ? "Generating..." : "Generate"}
          </button>
        </div>

        {error && (
          <div className="rounded-lg bg-rose/10 border border-rose/20 px-3 py-2 text-xs text-rose">
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
      </Surface>
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

  const riskStatus = riskTone(snapshot.overallRiskLevel);

  return (
    <div className="space-y-3">
      <MissionCard
        icon={BrainCircuit}
        title="Cross-Domain Snapshot"
        description={new Date(snapshot.computedAt).toLocaleString()}
        status={riskStatus === "success" ? "ready" : riskStatus === "warning" ? "attention" : "locked"}
        progress={healthScore}
        badge={`${snapshot.overallRiskLevel} RISK`}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatOrb label="Health" value={`${healthScore}%`} color="teal" />
        <StatOrb label="Readiness" value={`${readinessScore}%`} color="gold" />
        <StatOrb label="Confidence" value={`${confidenceScore}%`} color="violet" />
        <div className="surface flex flex-col gap-1 p-3 justify-center">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Evidence</div>
          <div className="text-lg font-bold font-mono text-foreground">
            {snapshot.evidenceSummary.highConfidenceFacts}/{snapshot.evidenceSummary.totalFacts}
          </div>
        </div>
      </div>

      {(snapshot.readinessSummary.readyDepartments.length > 0 ||
        snapshot.readinessSummary.atRiskDepartments.length > 0) && (
        <div className="space-y-1.5">
          {snapshot.readinessSummary.readyDepartments.length > 0 && (
            <div className="text-[10px] text-mint font-medium uppercase tracking-wide">Ready departments</div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {snapshot.readinessSummary.readyDepartments.map((d) => (
              <Badge key={d} color="mint">
                <CheckCircle2 className="w-3 h-3" />
                {d}
              </Badge>
            ))}
          </div>
          {snapshot.readinessSummary.atRiskDepartments.length > 0 && (
            <div className="text-[10px] text-rose font-medium uppercase tracking-wide mt-2">
              At-risk departments
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {snapshot.readinessSummary.atRiskDepartments.map((d) => (
              <Badge key={d} color="rose">
                <XCircle className="w-3 h-3" />
                {d}
              </Badge>
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
      <Surface className="p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-muted-foreground" />
          <h4 className="font-display text-xs font-semibold text-foreground">Domain Scores</h4>
        </div>
        <PanelEmptyState message="No domain scores available yet." />
      </Surface>
    );
  }

  return (
    <Surface className="p-3 space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-secondary/10">
          <Activity className="h-3.5 w-3.5 text-secondary" />
        </div>
        <h4 className="font-display text-sm font-semibold text-foreground">Domain Scores</h4>
      </div>
      <div className="space-y-2">
        {scores.map((s) => {
          const tone = riskTone(s.riskLevel);
          return (
            <div key={s.domain} className="rounded-xl border border-border/40 bg-surface-muted p-2.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-foreground">{domainLabel(s.domain)}</span>
                <Badge
                  color={tone === "success" ? "mint" : tone === "warning" ? "gold" : tone === "danger" ? "rose" : "muted"}
                >
                  {s.riskLevel}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <MiniScore label="Health" value={s.healthScore} />
                <div className="rounded-xl p-2 bg-surface-muted border border-border/30">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Snapshot</div>
                  <div className="text-sm font-semibold font-mono text-foreground truncate">
                    {s.snapshotId ? "Present" : "None"}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Surface>
  );
}

function decisionTone(decision: GenomeAutonomyGateDecisionValue): "success" | "warning" | "danger" {
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
      <Surface className="p-3 space-y-2">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose/10">
            <ShieldAlert className="h-3.5 w-3.5 text-rose" />
          </div>
          <h4 className="font-display text-sm font-semibold text-foreground">Autonomy Gate</h4>
        </div>
        <PanelEmptyState message="Autonomy gate not evaluated yet." />
      </Surface>
    );
  }

  return (
    <Surface className="p-3 space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose/10">
          <ShieldAlert className="h-3.5 w-3.5 text-rose" />
        </div>
        <h4 className="font-display text-sm font-semibold text-foreground">Autonomy Gate</h4>
      </div>

      {summary && (
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl p-2 bg-mint/10 text-center">
            <div className="text-[10px] text-mint uppercase tracking-wide">Allow</div>
            <div className="text-sm font-semibold font-mono text-mint">{summary.allowCount}</div>
          </div>
          <div className="rounded-xl p-2 bg-gold/10 text-center">
            <div className="text-[10px] text-gold uppercase tracking-wide">Escalate</div>
            <div className="text-sm font-semibold font-mono text-gold">{summary.escalateCount}</div>
          </div>
          <div className="rounded-xl p-2 bg-rose/10 text-center">
            <div className="text-[10px] text-rose uppercase tracking-wide">Block</div>
            <div className="text-sm font-semibold font-mono text-rose">{summary.blockCount}</div>
          </div>
        </div>
      )}

      {summary && summary.primaryBlockers.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] text-rose font-medium uppercase tracking-wide">Primary blockers</div>
          <div className="flex flex-wrap gap-1">
            {summary.primaryBlockers.map((b) => (
              <Badge key={b} color="rose">
                <Lock className="w-3 h-3" />
                {b}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
        {decisions.map((d) => {
          const tone = decisionTone(d.decision);
          return (
            <div key={d.actionType} className="flex items-start gap-2 rounded-xl bg-surface-muted px-2 py-1.5">
              {d.decision === "ALLOW" ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-mint mt-0.5 flex-shrink-0" />
              ) : d.decision === "BLOCK" ? (
                <XCircle className="w-3.5 h-3.5 text-rose mt-0.5 flex-shrink-0" />
              ) : (
                <ShieldAlert className="w-3.5 h-3.5 text-gold mt-0.5 flex-shrink-0" />
              )}
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] font-medium text-foreground">{d.actionType}</span>
                  <Badge
                    color={tone === "success" ? "mint" : tone === "warning" ? "gold" : "rose"}
                  >
                    {d.decision}
                  </Badge>
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
    </Surface>
  );
}

function RankedRecommendationsCard({ recommendations }: { recommendations: GenomeRankedRecommendation[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? recommendations : recommendations.slice(0, 3);

  return (
    <Surface className="p-3 space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
          <TrendingUp className="h-3.5 w-3.5 text-primary" />
        </div>
        <h4 className="font-display text-sm font-semibold text-foreground">
          Ranked Recommendations ({recommendations.length})
        </h4>
      </div>
      <div className="space-y-2">
        {recommendations.length === 0 ? (
          <PanelEmptyState message="No ranked recommendations available yet." />
        ) : (
          <>
            <AnimatePresence>
              {visible.map((r) => (
                <motion.div
                  key={r.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  className="rounded-xl border border-border/40 bg-surface-muted p-2.5 space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h5 className="text-xs font-semibold text-foreground">{r.title}</h5>
                      <p className="text-[10px] text-muted-foreground leading-relaxed">{r.insight}</p>
                    </div>
                    <span className="text-xs font-bold font-mono text-primary">{r.rankScore.toFixed(0)}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge
                      color={
                        riskTone(r.riskLevel) === "success"
                          ? "mint"
                          : riskTone(r.riskLevel) === "warning"
                            ? "gold"
                            : riskTone(r.riskLevel) === "danger"
                              ? "rose"
                              : "muted"
                      }
                    >
                      {r.riskLevel}
                    </Badge>
                    <Badge color="muted">{r.effortLevel}</Badge>
                    {r.affectedDomains.map((d) => (
                      <Badge key={d} color="orange">
                        {domainLabel(d)}
                      </Badge>
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
                className="inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:text-primary/80 transition-colors"
              >
                {expanded ? "Show less" : `Show ${recommendations.length - 3} more`}
                <ChevronRight className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`} />
              </button>
            )}
          </>
        )}
      </div>
    </Surface>
  );
}

function OpportunitiesCard({ opportunities }: { opportunities: GenomeCrossDomainOpportunityCandidate[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? opportunities : opportunities.slice(0, 3);

  return (
    <Surface className="p-3 space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gold/15">
          <Zap className="h-3.5 w-3.5 text-gold-foreground" />
        </div>
        <h4 className="font-display text-sm font-semibold text-foreground">
          Cross-Domain Opportunities ({opportunities.length})
        </h4>
      </div>
      <div className="space-y-2">
        {opportunities.length === 0 ? (
          <PanelEmptyState message="No cross-domain opportunities detected yet." />
        ) : (
          <>
            <AnimatePresence>
              {visible.map((o) => (
                <motion.div
                  key={o.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  className="rounded-xl border border-border/40 bg-surface-muted p-2.5 space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h5 className="text-xs font-semibold text-foreground">{o.label}</h5>
                      <p className="text-[10px] text-muted-foreground leading-relaxed">
                        Impact: {o.potentialImpact}
                      </p>
                    </div>
                    <span className="text-xs font-bold font-mono text-gold">
                      {o.estimatedValueScore.toFixed(0)}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">{o.suggestedAction}</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge color="muted">Conf {Math.round(o.confidence)}%</Badge>
                    {o.affectedDomains.map((d) => (
                      <Badge key={d} color="orange">
                        {domainLabel(d)}
                      </Badge>
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
                className="inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:text-primary/80 transition-colors"
              >
                {expanded ? "Show less" : `Show ${opportunities.length - 3} more`}
                <ChevronRight className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`} />
              </button>
            )}
          </>
        )}
      </div>
    </Surface>
  );
}

function BottlenecksCard({ bottlenecks }: { bottlenecks: GenomeCrossDomainBottleneck[] }) {
  return (
    <Surface className="p-3 space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose/10">
          <AlertCircle className="h-3.5 w-3.5 text-rose" />
        </div>
        <h4 className="font-display text-sm font-semibold text-foreground">
          Bottlenecks ({bottlenecks.length})
        </h4>
      </div>
      <div className="space-y-2">
        {bottlenecks.length === 0 ? (
          <PanelEmptyState message="No cross-domain bottlenecks detected." />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {bottlenecks.map((b, idx) => {
              const tone = riskTone(b.severity);
              return (
                <div
                  key={`${b.domain}-${idx}`}
                  className="rounded-xl border border-border/40 bg-surface-muted p-2.5 space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-foreground">{domainLabel(b.domain)}</span>
                    <Badge
                      color={
                        tone === "success" ? "mint" : tone === "warning" ? "gold" : tone === "danger" ? "rose" : "muted"
                      }
                    >
                      {b.severity}
                    </Badge>
                  </div>
                  <div className="text-[10px] text-foreground font-medium">{b.label}</div>
                  {b.reason && <div className="text-[10px] text-muted-foreground">{b.reason}</div>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Surface>
  );
}
