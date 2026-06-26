"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, Play, X, Loader2, AlertCircle, ChevronDown, ChevronUp, ShieldAlert, Target } from "lucide-react";
import Link from "next/link";
import {
  approveKeyActionProposal,
  cancelKeyActionProposal,
  executeKeyActionProposal,
  rejectKeyActionProposal,
  type KeyActionProposal,
} from "@/lib/api/key-autonomy";
import { ProposalStatusBadge, ProposalRiskBadge } from "./proposal-status-badge";

interface ProposalCardProps {
  businessId: string;
  proposal: KeyActionProposal;
  onUpdated: () => void;
}

export function ProposalCard({ businessId, proposal, onUpdated }: ProposalCardProps) {
  const [loading, setLoading] = useState<"approve" | "reject" | "execute" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [needsGenomeConfirm, setNeedsGenomeConfirm] = useState(false);

  const handleAction = async (
    action: "approve" | "reject" | "execute" | "cancel",
  ) => {
    setLoading(action);
    setError(null);
    let res;
    switch (action) {
      case "approve":
        res = await approveKeyActionProposal(businessId, proposal.id);
        break;
      case "reject":
        res = await rejectKeyActionProposal(businessId, proposal.id);
        break;
      case "execute":
        res = await executeKeyActionProposal(
          businessId,
          proposal.id,
          proposal.riskLevel === "HIGH" || proposal.riskLevel === "CRITICAL",
          needsGenomeConfirm,
        );
        break;
      case "cancel":
        res = await cancelKeyActionProposal(businessId, proposal.id);
        break;
    }
    setLoading(null);
    if (res.error || !res.data) {
      const msg = res.error || "Action failed";
      setError(msg);
      if (typeof msg === "string" && msg.toLowerCase().includes("requires confirmation")) {
        setNeedsGenomeConfirm(true);
      }
      return;
    }
    setNeedsGenomeConfirm(false);
    onUpdated();
  };

  const actionButtons = (
    <div className="flex flex-wrap items-center gap-2">
      {proposal.status === "PENDING" && proposal.requiresApproval && (
        <>
          <ActionButton
            label="Approve"
            icon={Check}
            onClick={() => handleAction("approve")}
            loading={loading === "approve"}
            variant="accent"
          />
          <ActionButton
            label="Reject"
            icon={X}
            onClick={() => handleAction("reject")}
            loading={loading === "reject"}
            variant="danger"
          />
        </>
      )}
      {proposal.status === "APPROVED" && (
        <ActionButton
          label={
            needsGenomeConfirm
              ? "Confirm Genome risk & Execute"
              : proposal.riskLevel === "HIGH" || proposal.riskLevel === "CRITICAL"
                ? "Confirm & Execute"
                : "Execute"
          }
          icon={needsGenomeConfirm ? ShieldAlert : Play}
          onClick={() => handleAction("execute")}
          loading={loading === "execute"}
          variant={needsGenomeConfirm ? "danger" : "accent"}
        />
      )}
      {(proposal.status === "PENDING" || proposal.status === "APPROVED") && (
        <ActionButton
          label="Cancel"
          icon={X}
          onClick={() => handleAction("cancel")}
          loading={loading === "cancel"}
          variant="muted"
        />
      )}
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-border/30 bg-card/40 overflow-hidden"
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <ProposalStatusBadge status={proposal.status} />
              <ProposalRiskBadge riskLevel={proposal.riskLevel} />
              <span className="text-[10px] text-muted-foreground">{proposal.actionType.replace(/_/g, " ")}</span>
            </div>
            <h3 className="text-sm font-semibold text-foreground">{proposal.title}</h3>
            {proposal.summary && (
              <p className="text-xs text-muted-foreground line-clamp-2">{proposal.summary}</p>
            )}
          </div>
          <div className="flex-shrink-0">{actionButtons}</div>
        </div>

        {error && (
          <div className="mt-3 flex items-start gap-2 text-xs text-destructive bg-destructive/5 rounded-lg p-2">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            {error}
          </div>
        )}

        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {expanded ? "Hide details" : "Show details"}
        </button>
      </div>

      {expanded && (
        <div className="px-4 pb-4 border-t border-border/20 pt-3 space-y-2">
          {proposal.rationale && (
            <div>
              <span className="text-[10px] font-medium text-muted-foreground uppercase">Rationale</span>
              <p className="text-xs text-foreground mt-0.5">{proposal.rationale}</p>
            </div>
          )}
          {proposal.evidence.length > 0 && (
            <div>
              <span className="text-[10px] font-medium text-muted-foreground uppercase">Evidence</span>
              <ul className="mt-1 space-y-0.5">
                {proposal.evidence.map((e, i) => (
                  <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                    <span className="w-1 h-1 rounded-full bg-muted-foreground/50 mt-1.5 shrink-0" />
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {Object.keys(proposal.payload).length > 0 && (
            <div>
              <span className="text-[10px] font-medium text-muted-foreground uppercase">Payload</span>
              <pre className="mt-1 text-[10px] text-muted-foreground bg-muted/30 rounded-lg p-2 overflow-auto">
                {JSON.stringify(proposal.payload, null, 2)}
              </pre>
            </div>
          )}
          {proposal.executionResult && (
            <div>
              <span className="text-[10px] font-medium text-muted-foreground uppercase">Result</span>
              <pre className="mt-1 text-[10px] text-muted-foreground bg-muted/30 rounded-lg p-2 overflow-auto">
                {JSON.stringify(proposal.executionResult, null, 2)}
              </pre>
            </div>
          )}
          {proposal.failureReason && (
            <div className="text-xs text-destructive">{proposal.failureReason}</div>
          )}
          {proposal.status === "BLOCKED" && (
            <div className="rounded-lg bg-destructive/5 p-2.5 space-y-2">
              <div className="flex items-start gap-2 text-xs text-destructive">
                <ShieldAlert className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span>Execution was blocked by KEY Genome readiness.</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/app/command-center"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted/50 text-[10px] font-medium text-foreground hover:bg-muted/80 transition-colors"
                >
                  <Target className="w-3 h-3" /> Open Command Center
                </Link>
                <Link
                  href="/app/profile?tab=business-genome"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted/50 text-[10px] font-medium text-foreground hover:bg-muted/80 transition-colors"
                >
                  Update Business Genome
                </Link>
              </div>
            </div>
          )}
          <div className="text-[10px] text-muted-foreground">
            Created {new Date(proposal.createdAt).toLocaleString()}
          </div>
        </div>
      )}
    </motion.div>
  );
}

interface ActionButtonProps {
  label: string;
  icon: React.ElementType;
  onClick: () => void;
  loading?: boolean;
  variant: "accent" | "danger" | "muted";
}

function ActionButton({ label, icon: Icon, onClick, loading, variant }: ActionButtonProps) {
  const base = "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-colors";
  const styles = {
    accent: "bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/20",
    danger: "bg-destructive/10 text-destructive hover:bg-destructive/20",
    muted: "bg-muted/40 text-muted-foreground hover:bg-muted/60",
  };
  return (
    <button onClick={onClick} disabled={loading} className={`${base} ${styles[variant]}`}>
      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Icon className="w-3 h-3" />}
      {label}
    </button>
  );
}
