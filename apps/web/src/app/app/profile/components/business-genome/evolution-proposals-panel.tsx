"use client";

import { useCallback, useEffect, useState } from "react";
import { Sparkles, Check, X, Pencil, Loader2, RefreshCw, Lightbulb } from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  type GenomeEvolutionProposal,
  type GenomeIntegrityResult,
  type DnaSectionKey,
  getGenomeEvolutionProposals,
  generateGenomeEvolutionProposals,
  approveGenomeEvolutionProposal,
  rejectGenomeEvolutionProposal,
  editGenomeEvolutionProposal,
} from "@/lib/api/business-genome";

const SECTION_LABELS: Record<DnaSectionKey, string> = {
  founder: "Founder DNA",
  vision: "Vision DNA",
  business: "Business DNA",
  market: "Market DNA",
  financial: "Financial DNA",
  legal: "Legal DNA",
  operations: "Operations DNA",
  sales: "Sales DNA",
  marketing: "Marketing DNA",
  growth: "Growth DNA",
  technology: "Technology DNA",
  risk: "Risk DNA",
};

const STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  APPROVED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  REJECTED: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
  EDITED: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
};

interface EvolutionProposalsPanelProps {
  onGenomeUpdate?: (genome: GenomeIntegrityResult) => void;
}

export function EvolutionProposalsPanel({ onGenomeUpdate }: EvolutionProposalsPanelProps) {
  const businessId = getStoredBusinessId();
  const [proposals, setProposals] = useState<GenomeEvolutionProposal[]>([]);
  const [loading, setLoading] = useState(() => !!businessId);
  const [generating, setGenerating] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<GenomeEvolutionProposal | null>(null);
  const [editPatchJson, setEditPatchJson] = useState("");
  const [editReason, setEditReason] = useState("");

  const load = useCallback(async () => {
    if (!businessId) return;
    setError(null);
    const { data, error: apiError } = await getGenomeEvolutionProposals(businessId);
    if (apiError || !data) {
      setError(apiError || "Failed to load proposals");
    } else {
      setProposals(data);
    }
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    Promise.resolve().then(() => load());
  }, [load]);

  const handleGenerate = async () => {
    if (!businessId) return;
    setGenerating(true);
    setError(null);
    const { data, error: apiError } = await generateGenomeEvolutionProposals(businessId);
    if (apiError || !data) {
      setError(apiError || "Failed to generate proposals");
    } else {
      setProposals((prev) => [...data, ...prev]);
    }
    setGenerating(false);
  };

  const handleApprove = async (proposal: GenomeEvolutionProposal) => {
    if (!businessId) return;
    setActionId(proposal.id);
    setError(null);
    const { data, error: apiError } = await approveGenomeEvolutionProposal(businessId, proposal.id);
    if (apiError || !data) {
      setError(apiError || "Failed to approve proposal");
    } else {
      setProposals((prev) =>
        prev.map((p) => (p.id === proposal.id ? data.proposal : p)),
      );
      onGenomeUpdate?.(data.genome);
    }
    setActionId(null);
  };

  const handleReject = async (proposal: GenomeEvolutionProposal) => {
    if (!businessId) return;
    setActionId(proposal.id);
    setError(null);
    const { data, error: apiError } = await rejectGenomeEvolutionProposal(businessId, proposal.id);
    if (apiError || !data) {
      setError(apiError || "Failed to reject proposal");
    } else {
      setProposals((prev) => prev.map((p) => (p.id === proposal.id ? data : p)));
    }
    setActionId(null);
  };

  const openEdit = (proposal: GenomeEvolutionProposal) => {
    setEditing(proposal);
    setEditPatchJson(JSON.stringify(proposal.proposedPatch, null, 2));
    setEditReason(proposal.reason);
  };

  const handleEditSave = async () => {
    if (!businessId || !editing) return;
    let patch: Record<string, unknown>;
    try {
      patch = JSON.parse(editPatchJson) as Record<string, unknown>;
    } catch {
      setError("Proposed patch must be valid JSON");
      return;
    }
    setActionId(editing.id);
    setError(null);
    const { data, error: apiError } = await editGenomeEvolutionProposal(businessId, editing.id, {
      proposedPatch: patch,
      reason: editReason,
    });
    if (apiError || !data) {
      setError(apiError || "Failed to edit proposal");
    } else {
      setProposals((prev) => prev.map((p) => (p.id === editing.id ? data : p)));
      setEditing(null);
    }
    setActionId(null);
  };

  if (loading) {
    return (
      <div className="kf-card p-12 flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading evolution proposals...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Evolution Proposals
          </h3>
          <p className="text-sm text-muted-foreground">
            KEY notices patterns in Temporal Flow and suggests Business Genome updates.
          </p>
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Generate from Temporal Flow
        </button>
      </div>

      {error && (
        <div className="kf-card p-4 text-sm text-destructive bg-destructive/5">
          {error}
        </div>
      )}

      {proposals.length === 0 ? (
        <div className="kf-card p-12 text-center space-y-3">
          <Lightbulb className="w-8 h-8 mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No evolution proposals yet.</p>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="text-sm font-medium text-primary hover:underline"
          >
            Generate from Temporal Flow
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          {proposals.map((proposal) => (
            <div
              key={proposal.id}
              className="kf-card p-4 sm:p-5 space-y-4"
              style={{ borderLeft: "4px solid hsl(var(--kf-primary))" }}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[proposal.status] ?? "bg-muted text-muted-foreground"}`}
                    >
                      {proposal.status}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {SECTION_LABELS[proposal.section] ?? proposal.section}
                    </span>
                  </div>
                  <p className="text-sm font-medium">{proposal.reason}</p>
                </div>
                {proposal.confidence > 0 && (
                  <div className="text-xs text-muted-foreground">
                    Confidence: {Math.round(proposal.confidence * 100)}%
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Proposed update
                </p>
                <pre className="text-xs bg-muted/50 p-3 rounded-lg overflow-x-auto">
                  {JSON.stringify(proposal.proposedPatch, null, 2)}
                </pre>
              </div>

              {proposal.evidence.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Evidence
                  </p>
                  <ul className="text-sm space-y-1">
                    {proposal.evidence.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="w-1 h-1 rounded-full bg-primary mt-2" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {proposal.status === "PENDING" || proposal.status === "EDITED" ? (
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <button
                    onClick={() => handleApprove(proposal)}
                    disabled={actionId === proposal.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {actionId === proposal.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Check className="w-3.5 h-3.5" />
                    )}
                    Approve
                  </button>
                  <button
                    onClick={() => openEdit(proposal)}
                    disabled={actionId === proposal.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-muted text-foreground hover:bg-muted/80 disabled:opacity-50"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    Edit
                  </button>
                  <button
                    onClick={() => handleReject(proposal)}
                    disabled={actionId === proposal.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
                  >
                    <X className="w-3.5 h-3.5" />
                    Reject
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="kf-card w-full max-w-lg max-h-[90vh] overflow-y-auto space-y-4">
            <h4 className="text-base font-semibold">Edit Proposal</h4>
            <div className="space-y-2">
              <label className="text-sm font-medium">Reason</label>
              <input
                type="text"
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Proposed patch (JSON)</label>
              <textarea
                value={editPatchJson}
                onChange={(e) => setEditPatchJson(e.target.value)}
                rows={8}
                className="w-full rounded-lg border bg-background px-3 py-2 text-xs font-mono"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEditing(null)}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-muted hover:bg-muted/80"
              >
                Cancel
              </button>
              <button
                onClick={handleEditSave}
                disabled={actionId === editing.id}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {actionId === editing.id ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
