"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  Loader2,
  Info,
  Pencil,
  Layers,
  TrendingUp,
  AlertCircle,
} from "lucide-react";
import type { AiApprovalItem } from "@/lib/client";

const TIER_CONFIG: Record<number, { label: string; icon: typeof Shield; color: string; bg: string; border: string }> = {
  1: { label: "Auto", icon: ShieldCheck, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
  2: { label: "Quick Confirm", icon: Shield, color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20" },
  3: { label: "Approval Required", icon: ShieldAlert, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20" },
  4: { label: "Admin Only", icon: AlertTriangle, color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20" },
};

const MODULE_LABELS: Record<string, string> = {
  crm: "Clients", commerce: "Revenue", bookings: "Calendar",
  marketing: "Content", social: "Social", automations: "Automations",
  expenses: "Expenses", projects: "Projects",
};

function formatToolName(name: string): string {
  return name
    .replace(/_/g, " ")
    .replace(/^(crm|commerce|bookings|marketing|social|automations)\s/i, "")
    .replace(/^./, (c) => c.toUpperCase());
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function extractModuleFromTool(toolName: string): string | null {
  const prefix = toolName.split("_")[0];
  return MODULE_LABELS[prefix] ? prefix : null;
}

function extractExpectedBenefit(item: AiApprovalItem): string | null {
  const payload = item.inputPayload as Record<string, unknown> | null;
  if (payload?.expectedBenefit && typeof payload.expectedBenefit === "string") return payload.expectedBenefit;
  if (item.riskTier <= 1) return "Low-risk automated action — saves manual effort";
  if (item.riskTier === 2) return "Streamlines workflow with minimal oversight";
  return null;
}

function extractAffectedEntities(item: AiApprovalItem): string[] {
  const entities: string[] = [];
  const moduleName = extractModuleFromTool(item.toolName);
  if (moduleName) entities.push(MODULE_LABELS[moduleName]);
  const payload = item.inputPayload as Record<string, unknown> | null;
  if (payload?.contactId) entities.push("Contact");
  if (payload?.invoiceId) entities.push("Invoice");
  if (payload?.bookingId) entities.push("Booking");
  if (payload?.projectId) entities.push("Project");
  if (payload?.productId) entities.push("Product");
  return entities;
}

function extractRiskNotes(item: AiApprovalItem): string | null {
  if (item.riskTier >= 3) return "This action may have significant business impact. Review carefully before approving.";
  if (item.riskTier === 2) return "Moderate risk — changes are reversible but may affect active workflows.";
  return null;
}

interface VerificationCardProps {
  item: AiApprovalItem;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onDefer: (id: string) => void;
  onEdit?: (id: string) => void;
  loading?: boolean;
}

export function VerificationCard({ item, onApprove, onReject, onDefer, onEdit, loading }: VerificationCardProps) {
  const [expanded, setExpanded] = useState(false);
  const tierCfg = TIER_CONFIG[item.riskTier] || TIER_CONFIG[2];
  const TierIcon = tierCfg.icon;
  const isPending = item.status === "pending";
  const expectedBenefit = extractExpectedBenefit(item);
  const affectedEntities = extractAffectedEntities(item);
  const riskNotes = extractRiskNotes(item);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl border ${tierCfg.border} ${tierCfg.bg} overflow-hidden`}
      role="article"
      aria-label={`${item.title} — ${tierCfg.label}`}
      tabIndex={0}
    >
      <div className="p-3.5">
        <div className="flex items-start gap-3">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${tierCfg.bg}`}>
            <TierIcon className={`w-4.5 h-4.5 ${tierCfg.color}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-sm font-semibold text-foreground/90 truncate">{item.title}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${tierCfg.bg} ${tierCfg.color}`}>
                Tier {item.riskTier}
              </span>
            </div>
            <p className="text-xs text-muted-foreground/70 leading-relaxed">
              {item.description || formatToolName(item.toolName)}
            </p>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="text-[10px] text-muted-foreground/50 flex items-center gap-1">
                <Clock className="w-2.5 h-2.5" />
                {formatTimeAgo(item.createdAt)}
              </span>
              <span className="text-[10px] text-muted-foreground/40">·</span>
              <span className="text-[10px] text-muted-foreground/50">{formatToolName(item.toolName)}</span>
              {affectedEntities.length > 0 && (
                <>
                  <span className="text-[10px] text-muted-foreground/40">·</span>
                  <span className="text-[10px] text-muted-foreground/50 flex items-center gap-1">
                    <Layers className="w-2.5 h-2.5" />
                    {affectedEntities.join(", ")}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {expectedBenefit && (
          <div className="mt-2.5 flex items-start gap-1.5 px-2 py-1.5 rounded-lg bg-emerald-500/5 border border-emerald-500/10">
            <TrendingUp className="w-3 h-3 text-emerald-400 mt-0.5 shrink-0" />
            <span className="text-[11px] text-emerald-400/80 leading-relaxed">{expectedBenefit}</span>
          </div>
        )}

        {riskNotes && isPending && (
          <div className="mt-2 flex items-start gap-1.5 px-2 py-1.5 rounded-lg bg-amber-500/5 border border-amber-500/10">
            <AlertCircle className="w-3 h-3 text-amber-400 mt-0.5 shrink-0" />
            <span className="text-[11px] text-amber-400/80 leading-relaxed">{riskNotes}</span>
          </div>
        )}

        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 mt-2.5 text-[11px] text-muted-foreground/60 hover:text-foreground/70 transition-colors"
          aria-expanded={expanded}
          aria-label={expanded ? "Hide details" : "View details"}
        >
          <Info className="w-3 h-3" />
          <span>{expanded ? "Hide" : "View"} details</span>
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>

        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="mt-2 p-2.5 rounded-lg bg-background/30 border border-border/20"
          >
            {item.rationale && (
              <p className="text-[11px] text-muted-foreground/70 leading-relaxed mb-2">{item.rationale}</p>
            )}
            {item.inputPayload && Object.keys(item.inputPayload).length > 0 && (
              <div className="space-y-0.5">
                <span className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">Parameters</span>
                {Object.entries(item.inputPayload)
                  .filter(([key]) => key !== "expectedBenefit")
                  .map(([key, val]) => (
                  <div key={key} className="flex items-center gap-2 text-[10px]">
                    <span className="text-muted-foreground/50">{key}:</span>
                    <span className="text-foreground/70 truncate">{typeof val === 'string' ? val : JSON.stringify(val)}</span>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {!isPending && (
          <div className="mt-3 flex items-center gap-2">
            {item.resolution === "approved" && (
              <span className="flex items-center gap-1 text-xs text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" /> Approved
              </span>
            )}
            {item.resolution === "rejected" && (
              <span className="flex items-center gap-1 text-xs text-red-400">
                <XCircle className="w-3.5 h-3.5" /> Rejected
              </span>
            )}
            {item.resolution === "deferred" && (
              <span className="flex items-center gap-1 text-xs text-amber-400">
                <Clock className="w-3.5 h-3.5" /> Deferred
              </span>
            )}
            {item.resolvedAt && (
              <span className="text-[10px] text-muted-foreground/40">{formatTimeAgo(item.resolvedAt)}</span>
            )}
          </div>
        )}

        {isPending && (
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => onApprove(item.id)}
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 border border-emerald-500/20 transition-all disabled:opacity-50"
              aria-label="Approve action"
            >
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              Approve
            </button>
            {onEdit && (
              <button
                onClick={() => onEdit(item.id)}
                disabled={loading}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent2))/0.1] text-[hsl(var(--kf-accent2))] hover:bg-[hsl(var(--kf-accent2))/0.2] border border-[hsl(var(--kf-accent2))/0.2] transition-all disabled:opacity-50"
                aria-label="Edit action parameters"
              >
                <Pencil className="w-3.5 h-3.5" />
                Edit
              </button>
            )}
            <button
              onClick={() => onDefer(item.id)}
              disabled={loading}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/20 transition-all disabled:opacity-50"
              aria-label="Defer action"
            >
              <Clock className="w-3.5 h-3.5" />
              Defer
            </button>
            <button
              onClick={() => onReject(item.id)}
              disabled={loading}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-all disabled:opacity-50"
              aria-label="Reject action"
            >
              <XCircle className="w-3.5 h-3.5" />
              Reject
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export function VerificationCardCompact({ item, onApprove, onReject, loading }: Omit<VerificationCardProps, 'onDefer'>) {
  const tierCfg = TIER_CONFIG[item.riskTier] || TIER_CONFIG[2];
  const TierIcon = tierCfg.icon;

  return (
    <div
      className={`flex items-center gap-3 p-2.5 rounded-lg border ${tierCfg.border} ${tierCfg.bg}`}
      role="article"
      aria-label={`${item.title} — ${tierCfg.label}`}
    >
      <TierIcon className={`w-4 h-4 shrink-0 ${tierCfg.color}`} />
      <div className="flex-1 min-w-0">
        <span className="text-xs font-medium text-foreground/90 truncate block">{item.title}</span>
        <span className="text-[10px] text-muted-foreground/50">{formatToolName(item.toolName)}</span>
      </div>
      {item.status === "pending" && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => onApprove(item.id)}
            disabled={loading}
            className="p-1.5 rounded-md bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors disabled:opacity-50"
            aria-label="Approve action"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onReject(item.id)}
            disabled={loading}
            className="p-1.5 rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
            aria-label="Reject action"
          >
            <XCircle className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
