"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Activity, Check, Eye, GitMerge, Loader2, Radio, X } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  acceptGenomeSignal,
  getGenomeSignals,
  mergeGenomeSignal,
  rejectGenomeSignal,
  reviewGenomeSignal,
  type GenomeSignal,
} from "@/lib/api/business-genome";

const fade = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2 },
};

function formatConfidence(value: number) {
  return `${Math.round(value * 100)}%`;
}

function signalTypeLabel(type: string) {
  return type
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

interface KeyGenomeSignalsPanelProps {
  onGenomeUpdate?: () => void;
}

export function KeyGenomeSignalsPanel({ onGenomeUpdate }: KeyGenomeSignalsPanelProps) {
  const [signals, setSignals] = useState<GenomeSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);

  const businessId = getStoredBusinessId();

  const refresh = useCallback(async () => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error: apiError } = await getGenomeSignals(businessId, { limit: 50 });
    if (apiError || !data) {
      setError(apiError || "Failed to load Genome signals");
    } else {
      setSignals(data);
      setError(null);
    }
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleAction = async (
    signalId: string,
    action: "review" | "accept" | "reject" | "merge",
  ) => {
    if (!businessId) return;
    setActionId(`${action}-${signalId}`);
    let result;
    switch (action) {
      case "review":
        result = await reviewGenomeSignal(businessId, signalId);
        break;
      case "accept":
        result = await acceptGenomeSignal(businessId, signalId);
        break;
      case "reject":
        result = await rejectGenomeSignal(businessId, signalId);
        break;
      case "merge":
        result = await mergeGenomeSignal(businessId, signalId);
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

  if (loading) {
    return (
      <div className="kf-card p-12 flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading Genome signals...</p>
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

  if (signals.length === 0) {
    return (
      <EmptyState
        icon={Radio}
        title="No Genome signals yet"
        description="KEY will surface observations from Temporal Flow, KEY Inbox, Executive Modes, and modules here when they may update the business truth."
        variant="compact"
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Activity className="w-4 h-4 text-muted-foreground" />
          Genome Signals
        </h3>
        <span className="text-xs text-muted-foreground">{signals.length} observed</span>
      </div>

      <div className="space-y-3">
        {signals.map((signal) => {
          const isBusy = actionId?.endsWith(`-${signal.id}`) ?? false;
          const canMerge = signal.status === "ACCEPTED";
          return (
            <motion.div
              key={signal.id}
              {...fade}
              className="kf-card p-4 space-y-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <StatusBadge status={signal.status.toLowerCase()} size="sm" />
                    <span className="text-xs font-medium text-muted-foreground">
                      {signalTypeLabel(signal.signalType)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatConfidence(signal.confidence)} confidence
                    </span>
                  </div>
                  <p className="text-sm font-medium leading-snug">{signal.reason}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {signal.section} &rarr; {signal.domain}
                    {signal.field ? `.${signal.field}` : ""}
                  </p>
                </div>
              </div>

              {signal.proposedValue !== undefined && signal.proposedValue !== null && (
                <div className="text-xs rounded-lg p-2.5 bg-muted/40 border border-border/50">
                  <span className="text-muted-foreground">Proposed value:</span>{" "}
                  <span className="font-medium">
                    {typeof signal.proposedValue === "string"
                      ? signal.proposedValue
                      : JSON.stringify(signal.proposedValue)}
                  </span>
                </div>
              )}

              {signal.evidence.length > 0 && (
                <div className="space-y-1.5">
                  {signal.evidence.slice(0, 2).map((ev, idx) => (
                    <p key={idx} className="text-xs text-muted-foreground line-clamp-2">
                      &bull; {ev.summary}
                    </p>
                  ))}
                  {signal.evidence.length > 2 && (
                    <p className="text-xs text-muted-foreground">
                      +{signal.evidence.length - 2} more evidence item(s)
                    </p>
                  )}
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                {signal.status === "NEW" && (
                  <>
                    <button
                      onClick={() => handleAction(signal.id, "review")}
                      disabled={isBusy}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-secondary text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50"
                    >
                      {isBusy && actionId === `review-${signal.id}` ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Eye className="w-3 h-3" />
                      )}
                      Review
                    </button>
                    <button
                      onClick={() => handleAction(signal.id, "accept")}
                      disabled={isBusy}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {isBusy && actionId === `accept-${signal.id}` ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Check className="w-3 h-3" />
                      )}
                      Accept
                    </button>
                    <button
                      onClick={() => handleAction(signal.id, "reject")}
                      disabled={isBusy}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
                    >
                      {isBusy && actionId === `reject-${signal.id}` ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <X className="w-3 h-3" />
                      )}
                      Reject
                    </button>
                  </>
                )}
                {signal.status === "REVIEWED" && (
                  <>
                    <button
                      onClick={() => handleAction(signal.id, "accept")}
                      disabled={isBusy}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {isBusy && actionId === `accept-${signal.id}` ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Check className="w-3 h-3" />
                      )}
                      Accept
                    </button>
                    <button
                      onClick={() => handleAction(signal.id, "reject")}
                      disabled={isBusy}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
                    >
                      {isBusy && actionId === `reject-${signal.id}` ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <X className="w-3 h-3" />
                      )}
                      Reject
                    </button>
                  </>
                )}
                {canMerge && (
                  <button
                    onClick={() => handleAction(signal.id, "merge")}
                    disabled={isBusy}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {isBusy && actionId === `merge-${signal.id}` ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <GitMerge className="w-3 h-3" />
                    )}
                    Merge into Genome
                  </button>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
