"use client";

import { motion } from "framer-motion";
import { Sparkles, ChevronRight, Loader2, RotateCw } from "lucide-react";

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
  if (!aiInsight && !loading) {
    if (!onGenerate) return null;
    return (
      <button
        onClick={onGenerate}
        className="w-full flex items-center gap-2.5 p-3 rounded-xl border border-dashed border-border/40 hover:border-[hsl(var(--kf-accent2)_/_0.4)] hover:bg-[hsl(var(--kf-accent2)_/_0.04)] transition-all text-left group"
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: "hsl(var(--kf-accent2) / 0.08)" }}
        >
          <Sparkles className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium">Get AI Recommendation</p>
          <p className="text-[10px] text-muted-foreground">Analyse this contact and suggest next steps</p>
        </div>
        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-foreground transition-colors shrink-0" />
      </button>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-3 p-3 rounded-xl border border-border/20">
        <Loader2 className="w-4 h-4 animate-spin" style={{ color: "hsl(var(--kf-accent2))" }} />
        <span className="text-xs text-muted-foreground">Analysing contact…</span>
      </div>
    );
  }

  if (!aiInsight) return null;

  const conf = getConfidenceLevel(aiInsight.confidence);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl p-3 space-y-2"
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
            <span className="text-xs font-semibold">Next Best Action</span>
            <span
              className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
              style={{ background: conf.bg, color: conf.text }}
            >
              {Math.round(aiInsight.confidence * 100)}% {conf.label}
            </span>
          </div>
          <p className="text-xs font-medium" style={{ color: "hsl(var(--kf-accent2))" }}>
            {aiInsight.nextBestAction}
          </p>
          {aiInsight.reasoning && (
            <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">
              {aiInsight.reasoning}
            </p>
          )}
        </div>
      </div>

      {aiInsight.suggestedMessage && (
        <div className="ml-9 rounded-lg p-2" style={{ background: "hsl(var(--kf-card) / 0.5)" }}>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Suggested Message</p>
          <p className="text-xs text-foreground/80 line-clamp-2">{aiInsight.suggestedMessage}</p>
        </div>
      )}

      <div className="flex items-center gap-2 ml-9">
        {onAction && (
          <button
            onClick={onAction}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors min-w-[44px] min-h-[44px]"
            style={{
              background: "hsl(var(--kf-accent2) / 0.1)",
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
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] text-muted-foreground hover:text-foreground transition-colors min-w-[44px] min-h-[44px]"
          >
            <RotateCw className="w-3 h-3" />
            Refresh
          </button>
        )}
      </div>
    </motion.div>
  );
}
