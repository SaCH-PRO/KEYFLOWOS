"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Beaker,
  Check,
  Lightbulb,
  Loader2,
  Play,
  RotateCcw,
  X,
} from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  acceptGenomeRecommendation,
  applyGenomeRecommendation,
  closeGenomeRecommendationObservation,
  dismissGenomeRecommendation,
  escalateGenomeRecommendation,
  generateGenomeRecommendations,
  getGenomeExperiments,
  getGenomeRecommendations,
  getGenomeRecommendationExecutionStatus,
  getGenomeRecommendationOutcome,
  ignoreGenomeRecommendation,
  startGenomeExperiment,
  completeGenomeExperiment,
  cancelGenomeExperiment,
  type GenomeRecommendationExecutionStatus,
  type GenomeRecommendationOutcome,
  type GenomeExperimentData,
  type GenomeRecommendationData,
} from "@/lib/api/business-genome";
import { RecommendationBridgeModal } from "./recommendation-bridge-modal";

const fade = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2 },
};

function formatConfidence(value: number) {
  return `${Math.round(value * 100)}%`;
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

interface KeyGenomeRecommendationsPanelProps {
  onGenomeUpdate?: () => void;
}

export function KeyGenomeRecommendationsPanel({
  onGenomeUpdate,
}: KeyGenomeRecommendationsPanelProps) {
  const [recommendations, setRecommendations] = useState<GenomeRecommendationData[]>([]);
  const [experiments, setExperiments] = useState<GenomeExperimentData[]>([]);
  const [loading, setLoading] = useState(() => !!getStoredBusinessId());
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [bridgeRecommendation, setBridgeRecommendation] = useState<GenomeRecommendationData | null>(null);
  const [reasoning, setReasoning] = useState<{ recommendationId: string; action: "dismiss" | "ignore" } | null>(null);
  const [reasonText, setReasonText] = useState("");
  const [executionStatuses, setExecutionStatuses] = useState<Record<string, GenomeRecommendationExecutionStatus>>({});
  const [outcomes, setOutcomes] = useState<Record<string, GenomeRecommendationOutcome>>({});
  const [closingObservationId, setClosingObservationId] = useState<string | null>(null);

  const businessId = getStoredBusinessId();

  const refresh = useCallback(async () => {
    if (!businessId) return;
    const [recs, exps] = await Promise.all([
      getGenomeRecommendations(businessId, { limit: 50 }),
      getGenomeExperiments(businessId, { limit: 50 }),
    ]);
    if (recs.error || !recs.data) {
      setError(recs.error || "Failed to load Genome recommendations");
    } else {
      setRecommendations(recs.data);
      setExperiments(exps.data ?? []);
      setError(null);

      const actionable = recs.data.filter((r) =>
        ["ACCEPTED", "APPLIED", "ESCALATED"].includes(r.status),
      );
      const statusResults = await Promise.all(
        actionable.map((r) => getGenomeRecommendationExecutionStatus(businessId, r.id)),
      );
      const outcomeResults = await Promise.all(
        actionable.map((r) => getGenomeRecommendationOutcome(businessId, r.id)),
      );
      const statusMap: Record<string, GenomeRecommendationExecutionStatus> = {};
      const outcomeMap: Record<string, GenomeRecommendationOutcome> = {};
      actionable.forEach((r, idx) => {
        const s = statusResults[idx].data;
        const o = outcomeResults[idx].data;
        if (s) statusMap[r.id] = s;
        if (o) outcomeMap[r.id] = o;
      });
      setExecutionStatuses(statusMap);
      setOutcomes(outcomeMap);
    }
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    Promise.resolve().then(() => refresh());
  }, [refresh]);

  const handleGenerate = async () => {
    if (!businessId) return;
    setGenerating(true);
    const result = await generateGenomeRecommendations(businessId);
    if (result.error) {
      setError(result.error);
    } else {
      await refresh();
      onGenomeUpdate?.();
    }
    setGenerating(false);
  };

  const handleRecommendationAction = async (
    recommendationId: string,
    action: "accept" | "dismiss" | "apply" | "ignore" | "escalate",
    reason?: string,
  ) => {
    if (!businessId) return;
    setActionId(`${action}-${recommendationId}`);
    let result;
    switch (action) {
      case "accept":
        result = await acceptGenomeRecommendation(businessId, recommendationId);
        break;
      case "dismiss":
        result = await dismissGenomeRecommendation(businessId, recommendationId, reason);
        break;
      case "apply":
        result = await applyGenomeRecommendation(businessId, recommendationId);
        break;
      case "ignore":
        result = await ignoreGenomeRecommendation(businessId, recommendationId, reason);
        break;
      case "escalate":
        result = await escalateGenomeRecommendation(businessId, recommendationId);
        break;
    }
    if (result.error) {
      setError(result.error);
    } else {
      setReasoning(null);
      setReasonText("");
      await refresh();
      onGenomeUpdate?.();
    }
    setActionId(null);
  };

  const startReasoning = (recommendationId: string, action: "dismiss" | "ignore") => {
    setReasoning({ recommendationId, action });
    setReasonText("");
  };

  const cancelReasoning = () => {
    setReasoning(null);
    setReasonText("");
  };

  const handleCloseObservation = async (outcomeId: string) => {
    if (!businessId) return;
    setClosingObservationId(outcomeId);
    const result = await closeGenomeRecommendationObservation(businessId, outcomeId);
    if (result.error) {
      setError(result.error);
    } else {
      await refresh();
    }
    setClosingObservationId(null);
  };

  const handleExperimentAction = async (
    experimentId: string,
    action: "start" | "complete" | "cancel",
  ) => {
    if (!businessId) return;
    setActionId(`${action}-${experimentId}`);
    let result;
    switch (action) {
      case "start":
        result = await startGenomeExperiment(businessId, experimentId);
        break;
      case "complete":
        result = await completeGenomeExperiment(businessId, experimentId);
        break;
      case "cancel":
        result = await cancelGenomeExperiment(businessId, experimentId);
        break;
    }
    if (result.error) {
      setError(result.error);
    } else {
      await refresh();
    }
    setActionId(null);
  };

  if (loading) {
    return (
      <div className="kf-card p-12 flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading Genome recommendations...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="kf-card p-8 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <button
          onClick={refresh}
          className="mt-4 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-muted-foreground" />
          Genome Recommendations
        </h3>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
          Generate
        </button>
      </div>

      {recommendations.length === 0 ? (
        <EmptyState
          icon={Lightbulb}
          title="No recommendations yet"
          description="Generate recommendations to turn readiness gaps, Genome signals, and weak sections into ranked, evidence-backed actions."
          actionLabel="Generate recommendations"
          onAction={handleGenerate}
          variant="compact"
        />
      ) : (
        <div className="space-y-3">
          {recommendations.map((rec) => {
            const experiment = rec.suggestedExperimentId
              ? experiments.find((e) => e.id === rec.suggestedExperimentId)
              : undefined;
            const isBusy = actionId?.endsWith(`-${rec.id}`) ?? false;
            return (
              <motion.div key={rec.id} {...fade} className="kf-card p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <StatusBadge status={rec.status.toLowerCase()} size="sm" />
                      <span className="text-xs font-medium text-muted-foreground">
                        {titleCase(rec.domain)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatConfidence(rec.confidence)} confidence
                      </span>
                    </div>
                    <p className="text-sm font-medium leading-snug">{rec.title}</p>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{rec.insight}</p>
                  </div>
                </div>

                <div className="text-xs space-y-1">
                  <p className="text-muted-foreground">
                    <span className="font-medium text-foreground">Diagnosis:</span> {rec.diagnosis}
                  </p>
                  <p className="text-muted-foreground">
                    <span className="font-medium text-foreground">Recommendation:</span>{" "}
                    {rec.recommendation}
                  </p>
                  {rec.expectedGain && (
                    <p className="text-muted-foreground">
                      <span className="font-medium text-foreground">Expected gain:</span>{" "}
                      {rec.expectedGain}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="px-2 py-1 rounded-md bg-muted/40 border border-border/50">
                    Gain score: {rec.expectedGainScore}
                  </span>
                  <span className="px-2 py-1 rounded-md bg-muted/40 border border-border/50">
                    Risk: {titleCase(rec.riskLevel)}
                  </span>
                  <span className="px-2 py-1 rounded-md bg-muted/40 border border-border/50">
                    Effort: {titleCase(rec.effortLevel)}
                  </span>
                  {rec.evidenceIds.length > 0 && (
                    <span className="px-2 py-1 rounded-md bg-muted/40 border border-border/50">
                      {rec.evidenceIds.length} evidence item(s)
                    </span>
                  )}
                  {executionStatuses[rec.id] && (
                    <span className="px-2 py-1 rounded-md bg-[hsl(var(--kf-accent1))]/10 border border-[hsl(var(--kf-accent1))]/20 text-[hsl(var(--kf-accent1))]">
                      Action: {executionStatuses[rec.id].status.replace(/_/g, " ").toLowerCase()}
                      {executionStatuses[rec.id].executedAt &&
                        ` • ${new Date(executionStatuses[rec.id].executedAt!).toLocaleDateString()}`}
                    </span>
                  )}
                </div>

                {outcomes[rec.id] && (
                  <div className="rounded-lg border border-border/40 bg-muted/20 p-2.5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-medium text-foreground">Outcome Snapshot</span>
                      {outcomes[rec.id].impactScore !== null && outcomes[rec.id].impactScore !== undefined && (
                        <span
                          className={`text-[10px] font-semibold ${
                            (outcomes[rec.id].impactScore ?? 0) > 0
                              ? "text-[hsl(var(--kf-success))]"
                              : (outcomes[rec.id].impactScore ?? 0) < 0
                                ? "text-destructive"
                                : "text-muted-foreground"
                          }`}
                        >
                          Impact {(outcomes[rec.id].impactScore! * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-md bg-muted/40 p-1.5">
                        <div className="text-[10px] text-muted-foreground">Health</div>
                        <div className="text-xs font-semibold text-foreground">
                          {outcomes[rec.id].preHealthScore ?? "-"} → {outcomes[rec.id].postHealthScore ?? "?"}
                        </div>
                      </div>
                      <div className="rounded-md bg-muted/40 p-1.5">
                        <div className="text-[10px] text-muted-foreground">Readiness</div>
                        <div className="text-xs font-semibold text-foreground">
                          {outcomes[rec.id].preReadinessScore ?? "-"} → {outcomes[rec.id].postReadinessScore ?? "?"}
                        </div>
                      </div>
                      <div className="rounded-md bg-muted/40 p-1.5">
                        <div className="text-[10px] text-muted-foreground">Confidence</div>
                        <div className="text-xs font-semibold text-foreground">
                          {outcomes[rec.id].preConfidence ?? "-"} → {outcomes[rec.id].postConfidence ?? "?"}
                        </div>
                      </div>
                    </div>
                    {rec.status === "APPLIED" && !outcomes[rec.id].observedAt && (
                      <button
                        onClick={() => handleCloseObservation(outcomes[rec.id].id)}
                        disabled={closingObservationId === outcomes[rec.id].id}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                      >
                        {closingObservationId === outcomes[rec.id].id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Check className="w-3 h-3" />
                        )}
                        Close observation window
                      </button>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-2 pt-1 flex-wrap">
                  {rec.status === "ACTIVE" && (
                    <>
                      <button
                        onClick={() => handleRecommendationAction(rec.id, "accept")}
                        disabled={isBusy}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {isBusy && actionId === `accept-${rec.id}` ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Check className="w-3 h-3" />
                        )}
                        Accept
                      </button>
                      {reasoning?.recommendationId === rec.id ? (
                        <div className="flex items-center gap-2 w-full">
                          <input
                            type="text"
                            value={reasonText}
                            onChange={(e) => setReasonText(e.target.value)}
                            placeholder={`Why are you ${reasoning.action}ing this?`}
                            className="flex-1 min-w-0 px-2 py-1.5 rounded-md border border-border bg-background text-xs"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                void handleRecommendationAction(rec.id, reasoning.action, reasonText);
                              }
                              if (e.key === "Escape") {
                                cancelReasoning();
                              }
                            }}
                          />
                          <button
                            onClick={() => handleRecommendationAction(rec.id, reasoning.action, reasonText)}
                            disabled={isBusy}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={cancelReasoning}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-muted text-muted-foreground hover:bg-muted/80"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => startReasoning(rec.id, "dismiss")}
                            disabled={isBusy}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
                          >
                            {isBusy && actionId === `dismiss-${rec.id}` ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <X className="w-3 h-3" />
                            )}
                            Dismiss
                          </button>
                          <button
                            onClick={() => startReasoning(rec.id, "ignore")}
                            disabled={isBusy}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-muted text-muted-foreground hover:bg-muted/80 disabled:opacity-50"
                          >
                            Ignore
                          </button>
                          <button
                            onClick={() => handleRecommendationAction(rec.id, "escalate")}
                            disabled={isBusy}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-[hsl(var(--kf-warning))] text-white hover:bg-[hsl(var(--kf-warning))]/90 disabled:opacity-50"
                          >
                            {isBusy && actionId === `escalate-${rec.id}` ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Check className="w-3 h-3" />
                            )}
                            Escalate
                          </button>
                        </>
                      )}
                    </>
                  )}
                  {rec.status === "ACCEPTED" && (
                    <button
                      onClick={() => setBridgeRecommendation(rec)}
                      disabled={isBusy}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      <Check className="w-3 h-3" />
                      Create action plan
                    </button>
                  )}
                  {rec.suggestedExperimentId && (
                    <div className="flex items-center gap-2">
                      {!experiment || experiment.status === "PROPOSED" ? (
                        <button
                          onClick={() => handleExperimentAction(rec.suggestedExperimentId!, "start")}
                          disabled={isBusy}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50"
                        >
                          {isBusy && actionId === `start-${rec.suggestedExperimentId}` ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Play className="w-3 h-3" />
                          )}
                          Start experiment
                        </button>
                      ) : experiment.status === "RUNNING" ? (
                        <>
                          <button
                            onClick={() => handleExperimentAction(rec.suggestedExperimentId!, "complete")}
                            disabled={isBusy}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            {isBusy && actionId === `complete-${rec.suggestedExperimentId}` ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Check className="w-3 h-3" />
                            )}
                            Complete
                          </button>
                          <button
                            onClick={() => handleExperimentAction(rec.suggestedExperimentId!, "cancel")}
                            disabled={isBusy}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
                          >
                            {isBusy && actionId === `cancel-${rec.suggestedExperimentId}` ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <X className="w-3 h-3" />
                            )}
                            Cancel
                          </button>
                        </>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-muted/40 border border-border/50">
                          <Beaker className="w-3 h-3" />
                          Experiment {titleCase(experiment.status)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      <RecommendationBridgeModal
        key={bridgeRecommendation?.id ?? "none"}
        businessId={businessId ?? ""}
        recommendation={bridgeRecommendation}
        open={!!bridgeRecommendation}
        onClose={() => setBridgeRecommendation(null)}
        onBridged={() => {
          void refresh();
          onGenomeUpdate?.();
        }}
      />
    </div>
  );
}
