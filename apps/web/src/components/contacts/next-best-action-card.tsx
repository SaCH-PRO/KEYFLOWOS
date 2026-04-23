"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, ChevronRight, ChevronDown, Loader2, RotateCw, Copy, Check } from "lucide-react";

interface NextBestActionCardProps {
  aiInsight: {
    summary: string;
    nextBestAction: string;
    reasoning?: string;
    confidence: number;
    suggestedMessage?: string;
    tags?: string[];
  } | null | undefined;
  loading?: boolean;
  onGenerate?: () => Promise<void>;
  onAction?: () => void;
}

const CONFIDENCE_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  high: { bg: "hsl(var(--kf-success) / 0.1)", text: "hsl(var(--kf-success))", label: "High" },
  medium: { bg: "hsl(var(--kf-warning) / 0.1)", text: "hsl(var(--kf-warning))", label: "Medium" },
  low: { bg: "hsl(var(--kf-info) / 0.1)", text: "hsl(var(--kf-info))", label: "Low" },
};

function getConfidenceLevel(confidence: number) {
  if (confidence >= 0.75) return CONFIDENCE_COLORS.high;
  if (confidence >= 0.45) return CONFIDENCE_COLORS.medium;
  return CONFIDENCE_COLORS.low;
}

export function NextBestActionCard({ aiInsight, loading, onGenerate, onAction }: NextBestActionCardProps) {
  const [showReasoning, setShowReasoning] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyMessage = async (message: string) => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  if (!aiInsight && !loading) {
    if (!onGenerate) return null;
    return (
      <button
        onClick={onGenerate}
        className="w-full flex items-center gap-2.5 p-3 rounded-xl border border-dashed border-[hsl(var(--kf-accent2))]/30 hover:border-[hsl(var(--kf-accent2))]/50 hover:bg-[hsl(var(--kf-accent2))]/[0.04] transition-all text-left group"
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: "hsl(var(--kf-accent2) / 0.08)" }}
        >
          <Sparkles className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold">Recommended Next Action</p>
          <p className="text-[10px] text-muted-foreground">Get a smart suggestion based on this client&apos;s activity and status</p>
        </div>
        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-foreground transition-colors shrink-0" />
      </button>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-3 p-3 rounded-xl border border-[hsl(var(--kf-accent2))]/15 bg-[hsl(var(--kf-accent2))]/[0.02]">
        <Loader2 className="w-4 h-4 animate-spin" style={{ color: "hsl(var(--kf-accent2))" }} />
        <span className="text-xs text-muted-foreground">Analysing client data…</span>
      </div>
    );
  }

  if (!aiInsight) return null;

  const conf = getConfidenceLevel(aiInsight.confidence);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl p-3 space-y-2.5"
      style={{
        background: "hsl(var(--kf-accent2) / 0.04)",
        border: "1px solid hsl(var(--kf-accent2) / 0.15)",
      }}
    >
      <div className="flex items-start gap-2.5">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
          style={{ background: "hsl(var(--kf-accent2) / 0.1)" }}
        >
          <Sparkles className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent2))" }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Recommended Action</span>
            <span
              className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
              style={{ background: conf.bg, color: conf.text }}
            >
              {conf.label}
            </span>
          </div>
          <p className="text-sm font-semibold" style={{ color: "hsl(var(--kf-accent2))" }}>
            {aiInsight.nextBestAction}
          </p>
        </div>
      </div>

      {aiInsight.reasoning && (
        <div className="ml-9">
          <button
            onClick={() => setShowReasoning(!showReasoning)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          >
            <ChevronDown className={`w-3 h-3 transition-transform ${showReasoning ? "rotate-180" : ""}`} />
            {showReasoning ? "Hide reasoning" : "Why this action?"}
          </button>
          <AnimatePresence>
            {showReasoning && (
              <motion.p
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="text-[11px] text-muted-foreground mt-1 overflow-hidden"
              >
                {aiInsight.reasoning}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      )}

      {aiInsight.suggestedMessage && (
        <div className="ml-9 rounded-lg p-2.5 relative group/msg" style={{ background: "hsl(var(--kf-card) / 0.5)" }}>
          <div className="flex items-center justify-between mb-1">
            <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wider font-medium">Draft Message</p>
            <button
              onClick={() => handleCopyMessage(aiInsight.suggestedMessage!)}
              className="opacity-0 group-hover/msg:opacity-100 transition-opacity text-muted-foreground/40 hover:text-foreground"
              title="Copy message"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            </button>
          </div>
          <p className="text-xs text-foreground/80">{aiInsight.suggestedMessage}</p>
        </div>
      )}

      <div className="flex items-center gap-2 ml-9">
        {onAction && (
          <button
            onClick={onAction}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors"
            style={{
              background: "hsl(var(--kf-accent2) / 0.15)",
              color: "hsl(var(--kf-accent2))",
              borderWidth: 1,
              borderColor: "hsl(var(--kf-accent2) / 0.25)",
            }}
          >
            Take Action
            <ChevronRight className="w-3 h-3" />
          </button>
        )}
        {onGenerate && (
          <button
            onClick={onGenerate}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <RotateCw className="w-3 h-3" />
            Refresh
          </button>
        )}
      </div>
    </motion.div>
  );
}
