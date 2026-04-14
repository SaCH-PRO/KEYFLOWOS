"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Shield, ShieldAlert, ShieldCheck, AlertTriangle,
  CheckCircle2, XCircle, Clock, ChevronDown, ChevronUp,
  Loader2, Info,
} from "lucide-react";
import type { AiApprovalItem } from "@/lib/client";

const TIER_CONFIG: Record<number, { label: string; icon: typeof Shield; color: string; bg: string; border: string }> = {
  1: { label: "Auto", icon: ShieldCheck, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20" },
  2: { label: "Quick Confirm", icon: Shield, color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20" },
  3: { label: "Approval Required", icon: ShieldAlert, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20" },
  4: { label: "Admin Only", icon: AlertTriangle, color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20" },
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

interface VerificationCardProps {
  item: AiApprovalItem;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onDefer: (id: string) => void;
  loading?: boolean;
}

export function VerificationCard({ item, onApprove, onReject, onDefer, loading }: VerificationCardProps) {
  const [expanded, setExpanded] = useState(false);
  const tierCfg = TIER_CONFIG[item.riskTier] || TIER_CONFIG[2];
  const TierIcon = tierCfg.icon;
  const isPending = item.status === "pending";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl border ${tierCfg.border} ${tierCfg.bg} overflow-hidden`}
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
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-[10px] text-muted-foreground/50 flex items-center gap-1">
                <Clock className="w-2.5 h-2.5" />
                {formatTimeAgo(item.createdAt)}
              </span>
              <span className="text-[10px] text-muted-foreground/40">·</span>
              <span className="text-[10px] text-muted-foreground/50">{formatToolName(item.toolName)}</span>
            </div>
          </div>
        </div>

        {item.rationale && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 mt-2.5 text-[11px] text-muted-foreground/60 hover:text-foreground/70 transition-colors"
          >
            <Info className="w-3 h-3" />
            <span>{expanded ? "Hide" : "View"} rationale</span>
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        )}

        {expanded && item.rationale && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="mt-2 p-2.5 rounded-lg bg-background/30 border border-border/20"
          >
            <p className="text-[11px] text-muted-foreground/70 leading-relaxed">{item.rationale}</p>
            {item.inputPayload && Object.keys(item.inputPayload).length > 0 && (
              <div className="mt-2 space-y-0.5">
                <span className="text-[10px] font-medium text-muted-foreground/50 uppercase tracking-wider">Parameters</span>
                {Object.entries(item.inputPayload).map(([key, val]) => (
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
            >
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              Approve
            </button>
            <button
              onClick={() => onDefer(item.id)}
              disabled={loading}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/20 transition-all disabled:opacity-50"
            >
              <Clock className="w-3.5 h-3.5" />
              Defer
            </button>
            <button
              onClick={() => onReject(item.id)}
              disabled={loading}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-all disabled:opacity-50"
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
    <div className={`flex items-center gap-3 p-2.5 rounded-lg border ${tierCfg.border} ${tierCfg.bg}`}>
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
