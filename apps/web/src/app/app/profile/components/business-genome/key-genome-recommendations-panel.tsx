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
  dismissGenomeRecommendation,
  generateGenomeRecommendations,
  getGenomeExperiments,
  getGenomeRecommendations,
  startGenomeExperiment,
  completeGenomeExperiment,
  cancelGenomeExperiment,
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
    action: "accept" | "dismiss" | "apply",
  ) => {
    if (!businessId) return;
    setActionId(`${action}-${recommendationId}`);
    let result;
    switch (action) {
      case "accept":
        result = await acceptGenomeRecommendation(businessId, recommendationId);
        break;
      case "dismiss":
        result = await dismissGenomeRecommendation(businessId, recommendationId);
        break;
      case "apply":
        result = await applyGenomeRecommendation(businessId, recommendationId);
        break;
    }
    if (result.error) {
      setError(result.error);
    } else {
      await refresh();
      onGenomeUpdate?.();
    }
    setActionId(null);
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
                </div>

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
                      <button
                        onClick={() => handleRecommendationAction(rec.id, "dismiss")}
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
