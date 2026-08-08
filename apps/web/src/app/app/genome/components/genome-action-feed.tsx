"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Lightbulb,
  Shield,
  Zap,
  CheckCircle2,
  XCircle,
  ArrowRight,
  AlertTriangle,
  Loader2,
  Bot,
} from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  getGenomeRecommendations,
  getKeyGenomeGovernanceSummary,
  acceptGenomeRecommendation,
  dismissGenomeRecommendation,
  applyGenomeRecommendation,
  type GenomeRecommendationData,
  type KeyGenomeGovernanceSummary,
  type KeyGenomeGovernanceItem,
} from "@/lib/api/business-genome";
import { Badge } from "@/components/ui-v2/badge";
import { Button } from "@/components/ui/button";

function riskColor(risk: string): "mint" | "gold" | "orange" | "rose" {
  switch (risk) {
    case "LOW":
      return "mint";
    case "MEDIUM":
      return "gold";
    case "HIGH":
      return "orange";
    case "CRITICAL":
      return "rose";
    default:
      return "gold";
  }
}

function effortColor(effort: string): "mint" | "gold" | "orange" {
  switch (effort) {
    case "LOW":
      return "mint";
    case "MEDIUM":
      return "gold";
    case "HIGH":
      return "orange";
    default:
      return "gold";
  }
}

interface ActionFeedProps {
  compact?: boolean;
}

export function GenomeActionFeed({ compact }: ActionFeedProps) {
  const businessId = getStoredBusinessId();
  const [recommendations, setRecommendations] = useState<GenomeRecommendationData[]>([]);
  const [governance, setGovernance] = useState<KeyGenomeGovernanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!businessId) return;
    Promise.all([
      getGenomeRecommendations(businessId, { status: "ACTIVE", limit: compact ? 3 : 10 }),
      getKeyGenomeGovernanceSummary(businessId),
    ]).then(([recs, gov]) => {
      setRecommendations(recs.data ?? []);
      setGovernance(gov.data ?? null);
      setLoading(false);
    });
  }, [businessId, compact]);

  const handleAccept = async (id: string) => {
    if (!businessId) return;
    setProcessing((p) => ({ ...p, [id]: true }));
    await acceptGenomeRecommendation(businessId, id);
    setRecommendations((prev) => prev.filter((r) => r.id !== id));
    setProcessing((p) => ({ ...p, [id]: false }));
  };

  const handleDismiss = async (id: string) => {
    if (!businessId) return;
    setProcessing((p) => ({ ...p, [id]: true }));
    await dismissGenomeRecommendation(businessId, id);
    setRecommendations((prev) => prev.filter((r) => r.id !== id));
    setProcessing((p) => ({ ...p, [id]: false }));
  };

  const handleApply = async (id: string) => {
    if (!businessId) return;
    setProcessing((p) => ({ ...p, [id]: true }));
    await applyGenomeRecommendation(businessId, id);
    setRecommendations((prev) => prev.filter((r) => r.id !== id));
    setProcessing((p) => ({ ...p, [id]: false }));
  };

  if (loading) {
    return (
      <div className="kf-card p-12 flex flex-col items-center justify-center gap-3 min-h-[200px]">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading actions...</p>
      </div>
    );
  }

  const urgentItems = governance?.urgentReviewItems ?? [];
  const queueItems = governance?.recommendationQueue ?? [];
  const allItems = [...urgentItems, ...queueItems];

  if (recommendations.length === 0 && allItems.length === 0) {
    return (
      <div className="kf-card p-8 text-center">
        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
          <CheckCircle2 className="w-6 h-6 text-primary" />
        </div>
        <h3 className="text-sm font-semibold">No pending actions</h3>
        <p className="text-xs text-muted-foreground mt-1">Your genome queue is clear. KEY will suggest new actions as it learns.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!compact && governance && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="kf-card p-3 text-center">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Active</div>
            <div className="text-lg font-bold">{governance.counts.activeRecommendations}</div>
          </div>
          <div className="kf-card p-3 text-center">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Signals</div>
            <div className="text-lg font-bold">{governance.counts.newSignals}</div>
          </div>
          <div className="kf-card p-3 text-center">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Experiments</div>
            <div className="text-lg font-bold">{governance.counts.runningExperiments}</div>
          </div>
          <div className="kf-card p-3 text-center">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Blockers</div>
            <div className="text-lg font-bold text-[hsl(var(--kf-warning))]">{governance.readinessBlockers.length}</div>
          </div>
        </div>
      )}

      {recommendations.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-muted-foreground" />
            Recommendations
          </h3>
          <div className="space-y-3">
            {recommendations.map((rec, index) => (
              <motion.div
                key={rec.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="kf-card p-4"
                style={{ borderColor: rec.riskLevel === "CRITICAL" ? "hsl(var(--kf-error) / 0.3)" : undefined }}
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Bot className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold">{rec.title}</h4>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <Badge color={riskColor(rec.riskLevel)}>{rec.riskLevel}</Badge>
                        <Badge color={effortColor(rec.effortLevel)}>{rec.effortLevel} effort</Badge>
                        {rec.expectedGainScore > 0 && (
                          <Badge color="sky">+{rec.expectedGainScore} gain</Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mb-3 line-clamp-3">{rec.insight}</p>
                <p className="text-xs mb-3">{rec.recommendation}</p>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => handleApply(rec.id)}
                    disabled={processing[rec.id]}
                    className="h-8 text-xs"
                  >
                    {processing[rec.id] ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                    Apply
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleAccept(rec.id)}
                    disabled={processing[rec.id]}
                    className="h-8 text-xs"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDismiss(rec.id)}
                    disabled={processing[rec.id]}
                    className="h-8 text-xs ml-auto"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Dismiss
                  </Button>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {!compact && allItems.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4 text-muted-foreground" />
            Governance queue
          </h3>
          <div className="space-y-3">
            {allItems.slice(0, 5).map((item, index) => (
              <GovernanceItemCard key={item.id} item={item} index={index} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function GovernanceItemCard({ item, index }: { item: KeyGenomeGovernanceItem; index: number }) {
  const priorityColor =
    item.priority === "CRITICAL" ? "rose" : item.priority === "HIGH" ? "orange" : item.priority === "MEDIUM" ? "gold" : "mint";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="kf-card p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-4 h-4 text-muted-foreground" />
          </div>
          <div>
            <h4 className="text-sm font-semibold">{item.title}</h4>
            <p className="text-xs text-muted-foreground line-clamp-2">{item.summary}</p>
          </div>
        </div>
        <Badge color={priorityColor}>{item.priority}</Badge>
      </div>
      {item.actions.length > 0 && (
        <div className="flex items-center gap-2 mt-3">
          {item.actions.slice(0, 2).map((action) => (
            <Button key={action.actionType} size="sm" variant="outline" className="h-7 text-xs">
              {action.label}
              {action.href && <ArrowRight className="w-3 h-3 ml-1" />}
            </Button>
          ))}
        </div>
      )}
    </motion.div>
  );
}
