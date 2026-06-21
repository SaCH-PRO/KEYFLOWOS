"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  Beaker,
  Check,
  Eye,
  GitMerge,
  Loader2,
  Play,
  Shield,
  Target,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  acceptGenomeRecommendation,
  acceptGenomeSignal,
  applyGenomeRecommendation,
  cancelGenomeExperiment,
  completeGenomeExperiment,
  dismissGenomeRecommendation,
  getKeyGenomeGovernanceSummary,
  mergeGenomeSignal,
  rejectGenomeSignal,
  reviewGenomeSignal,
  startGenomeExperiment,
  type GenomeRecommendationData,
  type KeyGenomeGovernanceItem,
  type KeyGenomeGovernanceItemAction,
  type KeyGenomeGovernanceSummary,
} from "@/lib/api/business-genome";
import { RecommendationBridgeModal } from "./recommendation-bridge-modal";

const fade = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2 },
};

function titleCase(value: string) {
  return value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function priorityStatus(priority: string) {
  switch (priority) {
    case "CRITICAL":
      return "error";
    case "HIGH":
      return "warning";
    case "MEDIUM":
      return "info";
    default:
      return "neutral";
  }
}

function typeIcon(type: KeyGenomeGovernanceItem["type"]) {
  switch (type) {
    case "SIGNAL":
      return Activity;
    case "RECOMMENDATION":
      return Target;
    case "EXPERIMENT":
      return Beaker;
    case "READINESS_BLOCKER":
      return AlertTriangle;
    case "AUTONOMY_BLOCK":
      return Shield;
    case "WEAK_SECTION":
      return Activity;
    default:
      return Shield;
  }
}

interface KeyGenomeGovernanceConsoleProps {
  onGenomeUpdate?: () => void;
}

export function KeyGenomeGovernanceConsole({ onGenomeUpdate }: KeyGenomeGovernanceConsoleProps) {
  const router = useRouter();
  const [summary, setSummary] = useState<KeyGenomeGovernanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bridgeRecommendation, setBridgeRecommendation] = useState<GenomeRecommendationData | null>(null);

  const businessId = getStoredBusinessId();

  const refresh = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error: apiError } = await getKeyGenomeGovernanceSummary(businessId);
    if (apiError || !data) {
      setError(apiError || "Failed to load Genome governance summary");
    } else {
      setSummary(data);
      setError(null);
    }
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleAction = async (item: KeyGenomeGovernanceItem, action: KeyGenomeGovernanceItemAction) => {
    if (!businessId) return;

    if (action.actionType === "OPEN") {
      if (action.href) {
        router.push(action.href);
      } else {
        router.push(`/app/profile?tab=business-genome&section=governance`);
      }
      return;
    }

    if (action.actionType === "BRIDGE") {
      if (!item.sourceId) return;
      setBridgeRecommendation({
        id: item.sourceId,
        businessId: businessId ?? "",
        domain: item.source,
        title: item.title,
        insight: item.summary,
        diagnosis: "",
        recommendation: item.summary,
        expectedGainScore: 0,
        riskLevel: "MEDIUM",
        effortLevel: "MEDIUM",
        confidence: 0.5,
        evidenceIds: [],
        status: "ACCEPTED",
        createdAt: item.createdAt ?? new Date().toISOString(),
      });
      return;
    }

    if (!item.sourceId) return;
    setBusyId(`${action.actionType}-${item.id}`);

    let result: { error?: string | null } = {};
    try {
      switch (item.type) {
        case "SIGNAL": {
          const signalId = item.sourceId;
          switch (action.actionType) {
            case "REVIEW":
              result = await reviewGenomeSignal(businessId, signalId);
              break;
            case "ACCEPT":
              result = await acceptGenomeSignal(businessId, signalId);
              break;
            case "REJECT":
              result = await rejectGenomeSignal(businessId, signalId);
              break;
            case "MERGE":
              result = await mergeGenomeSignal(businessId, signalId);
              break;
          }
          break;
        }
        case "RECOMMENDATION": {
          const recommendationId = item.sourceId;
          switch (action.actionType) {
            case "ACCEPT":
              result = await acceptGenomeRecommendation(businessId, recommendationId);
              break;
            case "DISMISS":
              result = await dismissGenomeRecommendation(businessId, recommendationId);
              break;
            case "APPLY":
              result = await applyGenomeRecommendation(businessId, recommendationId);
              break;
          }
          break;
        }
        case "EXPERIMENT": {
          const experimentId = item.sourceId;
          switch (action.actionType) {
            case "START":
              result = await startGenomeExperiment(businessId, experimentId);
              break;
            case "COMPLETE":
              result = await completeGenomeExperiment(businessId, experimentId);
              break;
            case "CANCEL":
              result = await cancelGenomeExperiment(businessId, experimentId);
              break;
          }
          break;
        }
      }
    } catch (err) {
      result = { error: err instanceof Error ? err.message : "Action failed" };
    }

    if (result.error) {
      setError(result.error);
    } else {
      await refresh();
      onGenomeUpdate?.();
    }
    setBusyId(null);
  };

  if (loading) {
    return (
      <div className="kf-card p-12 flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading Genome governance...</p>
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

  if (!summary) {
    return (
      <EmptyState
        icon={Shield}
        title="Governance summary unavailable"
        description="Unable to load the governance console."
        variant="compact"
      />
    );
  }

  const hasWork =
    summary.urgentReviewItems.length > 0 ||
    summary.signalReviewQueue.length > 0 ||
    summary.recommendationQueue.length > 0 ||
    summary.experimentQueue.length > 0 ||
    summary.readinessBlockers.length > 0 ||
    summary.autonomyBlocks.length > 0 ||
    summary.genomeHealth.weakestSections.length > 0;

  return (
    <div className="space-y-6">
      <GovernanceHealthStrip counts={summary.counts} health={summary.genomeHealth} />

      {summary.urgentReviewItems.length > 0 && (
        <GovernanceQueue
          title="Urgent review queue"
          icon={AlertTriangle}
          items={summary.urgentReviewItems}
          busyId={busyId}
          onAction={handleAction}
        />
      )}

      {!hasWork && (
        <EmptyState
          icon={Shield}
          title="Governance queue is clear"
          description="No signals, recommendations, experiments, or readiness blockers need founder review right now."
          variant="compact"
        />
      )}

      {summary.signalReviewQueue.length > 0 && (
        <GovernanceQueue
          title="Signals"
          icon={Activity}
          items={summary.signalReviewQueue}
          busyId={busyId}
          onAction={handleAction}
        />
      )}

      {summary.recommendationQueue.length > 0 && (
        <GovernanceQueue
          title="Recommendations"
          icon={Target}
          items={summary.recommendationQueue}
          busyId={busyId}
          onAction={handleAction}
        />
      )}

      {summary.experimentQueue.length > 0 && (
        <GovernanceQueue
          title="Experiments"
          icon={Beaker}
          items={summary.experimentQueue}
          busyId={busyId}
          onAction={handleAction}
        />
      )}

      {summary.readinessBlockers.length > 0 && (
        <GovernanceQueue
          title="Readiness blockers"
          icon={AlertTriangle}
          items={summary.readinessBlockers}
          busyId={busyId}
          onAction={handleAction}
        />
      )}

      {summary.autonomyBlocks.length > 0 && (
        <GovernanceQueue
          title="Autonomy blocks"
          icon={Shield}
          items={summary.autonomyBlocks}
          busyId={busyId}
          onAction={handleAction}
        />
      )}

      <RecommendationBridgeModal
        businessId={businessId ?? ""}
        recommendation={bridgeRecommendation}
        open={!!bridgeRecommendation}
        onClose={() => setBridgeRecommendation(null)}
        onBridged={() => {
          void refresh();
          onGenomeUpdate?.();
        }}
      />

      {summary.genomeHealth.weakestSections.length > 0 && (
        <div className="kf-card p-4 space-y-3">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Activity className="w-4 h-4 text-muted-foreground" />
            Weak Genome sections
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {summary.genomeHealth.weakestSections.map((section) => (
              <div
                key={section.section}
                className="rounded-lg p-3 border border-border/50 bg-muted/30"
              >
                <p className="text-xs font-medium">{titleCase(section.section)}</p>
                <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Overall {section.overall}%</span>
                  <span>·</span>
                  <span>Confidence {section.confidence}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function GovernanceHealthStrip({
  counts,
  health,
}: {
  counts: KeyGenomeGovernanceSummary["counts"];
  health: KeyGenomeGovernanceSummary["genomeHealth"];
}) {
  const cards = [
    { label: "New signals", value: counts.newSignals },
    { label: "Accepted signals", value: counts.acceptedSignals },
    { label: "Active recommendations", value: counts.activeRecommendations },
    { label: "Running experiments", value: counts.runningExperiments },
    { label: "Blocked modules", value: counts.blockedModules },
    { label: "Autonomy blocks", value: counts.autonomyBlockedActions },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {cards.map((card) => (
        <div
          key={card.label}
          className="kf-card p-3 text-center"
        >
          <p className="text-2xl font-semibold">{card.value}</p>
          <p className="text-xs text-muted-foreground">{card.label}</p>
        </div>
      ))}
      <div className="kf-card p-3 text-center">
        <p className="text-2xl font-semibold">{health.overall}%</p>
        <p className="text-xs text-muted-foreground">Genome overall</p>
      </div>
      <div className="kf-card p-3 text-center">
        <p className="text-2xl font-semibold">{health.confidence}%</p>
        <p className="text-xs text-muted-foreground">Confidence</p>
      </div>
      <div className="kf-card p-3 text-center">
        <p className="text-2xl font-semibold">{health.readiness}%</p>
        <p className="text-xs text-muted-foreground">Readiness</p>
      </div>
    </div>
  );
}

function GovernanceQueue({
  title,
  icon: Icon,
  items,
  busyId,
  onAction,
}: {
  title: string;
  icon: React.ElementType;
  items: KeyGenomeGovernanceItem[];
  busyId: string | null;
  onAction: (item: KeyGenomeGovernanceItem, action: KeyGenomeGovernanceItemAction) => void;
}) {
  return (
    <div className="kf-card p-4 space-y-3">
      <h3 className="text-sm font-medium flex items-center gap-2">
        <Icon className="w-4 h-4 text-muted-foreground" />
        {title}
        <span className="text-xs text-muted-foreground ml-auto">{items.length}</span>
      </h3>

      <div className="space-y-3">
        {items.map((item) => {
          const TypeIcon = typeIcon(item.type);
          const isBusy = busyId?.endsWith(`-${item.id}`) ?? false;
          return (
            <motion.div key={item.id} {...fade} className="rounded-lg p-3 border border-border/50 bg-muted/20">
              <div className="flex items-start gap-3">
                <div className="mt-0.5">
                  <TypeIcon className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusBadge status={priorityStatus(item.priority)} size="sm" />
                    <span className="text-xs font-medium text-muted-foreground">{titleCase(item.type)}</span>
                    {item.source && (
                      <span className="text-xs text-muted-foreground">from {item.source}</span>
                    )}
                  </div>
                  <p className="text-sm font-medium leading-snug">{item.title}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2">{item.summary}</p>

                  {item.actions.length > 0 && (
                    <div className="flex items-center gap-2 pt-2 flex-wrap">
                      {item.actions.map((action) => {
                        const busy = isBusy && busyId === `${action.actionType}-${item.id}`;
                        return (
                          <button
                            key={action.actionType}
                            onClick={() => onAction(item, action)}
                            disabled={isBusy}
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium disabled:opacity-50 ${buttonClasses(
                              action.actionType,
                            )}`}
                          >
                            {busy ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              actionIcon(action.actionType)
                            )}
                            {action.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function buttonClasses(actionType: KeyGenomeGovernanceItemAction["actionType"]): string {
  switch (actionType) {
    case "ACCEPT":
    case "APPLY":
    case "MERGE":
    case "COMPLETE":
      return "bg-emerald-600 text-white hover:bg-emerald-700";
    case "REJECT":
    case "DISMISS":
    case "CANCEL":
      return "bg-rose-600 text-white hover:bg-rose-700";
    case "START":
      return "bg-primary text-primary-foreground hover:bg-primary/90";
    case "REVIEW":
      return "bg-secondary text-secondary-foreground hover:bg-secondary/80";
    default:
      return "bg-muted/40 border border-border/50 hover:bg-muted/60";
  }
}

function actionIcon(actionType: KeyGenomeGovernanceItemAction["actionType"]) {
  switch (actionType) {
    case "ACCEPT":
    case "APPLY":
    case "MERGE":
    case "COMPLETE":
      return <Check className="w-3 h-3" />;
    case "REJECT":
    case "DISMISS":
    case "CANCEL":
      return <X className="w-3 h-3" />;
    case "START":
      return <Play className="w-3 h-3" />;
    case "REVIEW":
      return <Eye className="w-3 h-3" />;
    default:
      return <Shield className="w-3 h-3" />;
  }
}
