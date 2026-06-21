"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, Beaker, Check, FileText, FlaskConical, Gavel, Loader2, Shield, Target, X } from "lucide-react";
import { Button } from "@keyflow/ui";
import {
  bridgeRecommendationAction,
  previewRecommendationAction,
  type GenomeRecommendationActionKind,
  type GenomeRecommendationActionPreview,
  type GenomeRecommendationData,
} from "@/lib/api/business-genome";

interface RecommendationBridgeModalProps {
  businessId: string;
  recommendation: GenomeRecommendationData | null;
  open: boolean;
  onClose: () => void;
  onBridged: () => void;
}

function actionKindIcon(kind: GenomeRecommendationActionKind) {
  switch (kind) {
    case "EXPERIMENT":
      return <Beaker className="w-5 h-5" />;
    case "KEY_ACTION_PROPOSAL":
      return <Gavel className="w-5 h-5" />;
    case "CONSTITUTION_UPDATE":
      return <FileText className="w-5 h-5" />;
    case "DOCUMENT_REQUEST":
      return <FileText className="w-5 h-5" />;
    case "GENOME_REVIEW":
      return <Target className="w-5 h-5" />;
    default:
      return <Shield className="w-5 h-5" />;
  }
}

function actionKindLabel(kind: GenomeRecommendationActionKind) {
  switch (kind) {
    case "EXPERIMENT":
      return "Controlled experiment";
    case "KEY_ACTION_PROPOSAL":
      return "KEY action proposal";
    case "CONSTITUTION_UPDATE":
      return "Constitution update proposal";
    case "DOCUMENT_REQUEST":
      return "Document export request";
    case "GENOME_REVIEW":
      return "Genome review task";
    case "MANUAL_TASK":
      return "Manual task";
    default:
      return kind;
  }
}

export function RecommendationBridgeModal({
  businessId,
  recommendation,
  open,
  onClose,
  onBridged,
}: RecommendationBridgeModalProps) {
  const [preview, setPreview] = useState<GenomeRecommendationActionPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ status: string; message: string; entityId?: string; entityType?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadPreview = useCallback(async () => {
    if (!recommendation) return;
    setLoading(true);
    setError(null);
    setResult(null);
    const { data, error: apiError } = await previewRecommendationAction(businessId, recommendation.id);
    if (apiError || !data) {
      setError(apiError || "Failed to load action preview");
      setPreview(null);
    } else {
      setPreview(data);
    }
    setLoading(false);
  }, [businessId, recommendation]);

  useEffect(() => {
    if (open) {
      void loadPreview();
    } else {
      setPreview(null);
      setResult(null);
      setError(null);
    }
  }, [open, loadPreview]);

  const handleConfirm = async () => {
    if (!recommendation || !preview) return;
    setSubmitting(true);
    setError(null);
    const { data, error: apiError } = await bridgeRecommendationAction(businessId, recommendation.id, {
      actionKind: preview.actionKind,
      confirmBridge: true,
    });
    if (apiError || !data) {
      setError(apiError || "Failed to create action plan");
    } else {
      setResult({
        status: data.status,
        message: data.message,
        entityId: data.createdEntityId,
        entityType: data.createdEntityType,
      });
    }
    setSubmitting(false);
  };

  const handleDone = () => {
    if (result?.status === "CREATED" || result?.status === "ALREADY_EXISTS") {
      onBridged();
    }
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            className="relative z-10 w-full max-w-lg rounded-xl border border-border/60 bg-slate-900/95 backdrop-blur-xl p-6 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <FlaskConical className="w-5 h-5 text-primary" />
                <h3 className="text-lg font-semibold">Create action plan</h3>
              </div>
              <button
                onClick={onClose}
                className="p-1 rounded-md hover:bg-muted/60 text-muted-foreground"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {recommendation && (
              <p className="text-sm text-muted-foreground mb-4">
                Turn this accepted recommendation into a safe, reviewable next action.
              </p>
            )}

            {loading && (
              <div className="flex flex-col items-center justify-center gap-3 py-10">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Building action preview...</p>
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive mb-4">
                {error}
              </div>
            )}

            {!loading && preview && !result && (
              <div className="space-y-4">
                <div className="rounded-lg border border-border/50 bg-muted/30 p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-md bg-primary/10 text-primary">
                      {actionKindIcon(preview.actionKind)}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{actionKindLabel(preview.actionKind)}</p>
                      <p className="text-xs text-muted-foreground">
                        {preview.proposedActionType
                          ? `Action type: ${preview.proposedActionType}`
                          : "Review-only conversion"}
                      </p>
                    </div>
                  </div>

                  <div>
                    <p className="text-sm font-medium">{preview.title}</p>
                    <p className="text-xs text-muted-foreground mt-1">{preview.summary}</p>
                  </div>

                  {preview.rationale && (
                    <div className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Rationale:</span> {preview.rationale}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="px-2 py-1 rounded-md bg-muted/50 border border-border/40">
                      Risk: {preview.riskLevel}
                    </span>
                    <span className="px-2 py-1 rounded-md bg-muted/50 border border-border/40">
                      {preview.requiresApproval ? "Requires approval" : "No approval required"}
                    </span>
                    {preview.targetModule && (
                      <span className="px-2 py-1 rounded-md bg-muted/50 border border-border/40">
                        Module: {preview.targetModule}
                      </span>
                    )}
                  </div>

                  {preview.readinessWarning && (
                    <div className="flex items-start gap-2 rounded-md bg-amber-500/10 border border-amber-500/20 p-2 text-xs text-amber-200">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      {preview.readinessWarning}
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-2">
                  <Button variant="subtle" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button onClick={handleConfirm} disabled={submitting}>
                    {submitting ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-1" />
                    ) : (
                      <Check className="w-4 h-4 mr-1" />
                    )}
                    Confirm action plan
                  </Button>
                </div>
              </div>
            )}

            {result && (
              <div className="space-y-4">
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span className="font-medium text-emerald-100">
                      {result.status === "CREATED" ? "Action plan created" : "Action plan already exists"}
                    </span>
                  </div>
                  <p className="text-emerald-200/80">{result.message}</p>
                  {result.entityId && (
                    <p className="text-xs text-emerald-200/60 mt-2">
                      {result.entityType}: {result.entityId}
                    </p>
                  )}
                </div>
                <div className="flex justify-end">
                  <Button onClick={handleDone}>Done</Button>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
