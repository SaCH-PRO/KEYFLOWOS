"use client";

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  MessageSquare,
  Clock,
  Target,
  Zap,
  ShieldAlert,
  AlertTriangle,
  Loader2,
  Sparkles,
  ChevronDown,
  ChevronUp,
  TrendingUp,
} from "lucide-react";
import { commerceAiQuoteFollowUp, type CommerceQuoteFollowUp } from "@/lib/client";

interface QuoteFollowUpPanelProps {
  businessId: string | null;
  quoteId: string;
  quoteNumber: string;
  quoteAmount: number;
  currency: string;
  onClose: () => void;
}

const PROBABILITY_COLORS: Record<string, string> = {
  very_likely: "text-emerald-400",
  likely: "text-teal-400",
  moderate: "text-amber-400",
  unlikely: "text-orange-400",
  very_unlikely: "text-red-400",
};

export function QuoteFollowUpPanel({ businessId, quoteId, quoteNumber, quoteAmount, currency, onClose }: QuoteFollowUpPanelProps) {
  const [data, setData] = useState<CommerceQuoteFollowUp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showObjections, setShowObjections] = useState(false);

  const analyze = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await commerceAiQuoteFollowUp(quoteId, businessId);
      if (res.data) setData(res.data);
    } catch {
      setError("Failed to analyze follow-up strategy. Please try again.");
    }
    setLoading(false);
  }, [businessId, quoteId]);

  if (!data && !loading) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-border/50 bg-card/80 p-5"
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-violet-500/10">
            <MessageSquare className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Smart Follow-Up for #{quoteNumber}</h3>
            <p className="text-xs text-muted-foreground">{currency} {quoteAmount.toLocaleString()}</p>
          </div>
        </div>
        {error && <p className="text-xs text-red-400 mb-2 flex items-center gap-1.5"><AlertTriangle className="w-3 h-3" />{error}</p>}
        <button
          onClick={analyze}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all hover:opacity-90"
          style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))", color: "white" }}
        >
          <Sparkles className="w-4 h-4" />
          Analyze Follow-Up Strategy
        </button>
      </motion.div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-border/50 bg-card/80 p-8 flex flex-col items-center">
        <Loader2 className="w-6 h-6 animate-spin text-violet-400 mb-3" />
        <p className="text-sm text-muted-foreground">Analyzing quote opportunity...</p>
      </div>
    );
  }

  if (!data) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-border/50 bg-card/80 overflow-hidden"
    >
      <div className="p-4 border-b border-border/30 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-violet-500/10">
            <MessageSquare className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Follow-Up Strategy</h3>
            <p className="text-xs text-muted-foreground">Quote #{data.quoteNumber}</p>
          </div>
        </div>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
      </div>

      <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="p-3 rounded-lg bg-muted/20 border border-border/30 text-center">
          <p className={`text-2xl font-bold ${PROBABILITY_COLORS[data.closeProbabilityLabel] ?? "text-foreground"}`}>{data.closeProbability}%</p>
          <p className="text-[10px] text-muted-foreground">Close Probability</p>
        </div>
        <div className="p-3 rounded-lg bg-muted/20 border border-border/30 text-center">
          <p className="text-sm font-semibold">{data.followUpWindow.replace(/_/g, " ")}</p>
          <p className="text-[10px] text-muted-foreground">Follow-Up Window</p>
        </div>
        <div className="p-3 rounded-lg bg-muted/20 border border-border/30 text-center col-span-2 sm:col-span-1">
          <p className="text-sm font-semibold capitalize">{data.messagingApproach.tone.replace(/_/g, " ")}</p>
          <p className="text-[10px] text-muted-foreground">Recommended Tone</p>
        </div>
      </div>

      {data.bestFollowUpTime && (
        <div className="px-4 pb-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" /> Best time: <span className="font-medium text-foreground">{new Date(data.bestFollowUpTime).toLocaleDateString()}</span>
          </div>
        </div>
      )}

      {data.messagingApproach.keyPoints.length > 0 && (
        <div className="px-4 pb-4">
          <p className="text-xs font-medium mb-2 text-muted-foreground">Key Talking Points</p>
          <div className="space-y-1.5">
            {data.messagingApproach.keyPoints.map((point, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <Target className="w-3 h-3 text-violet-400 mt-0.5 shrink-0" />
                <span>{point}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.messagingApproach.openingLine && (
        <div className="px-4 pb-3">
          <div className="p-3 rounded-lg bg-violet-500/5 border border-violet-500/20 space-y-2">
            <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Suggested Opening</p>
            <p className="text-xs italic text-violet-300">"{data.messagingApproach.openingLine}"</p>
            {data.messagingApproach.closingLine && (
              <>
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Suggested Close</p>
                <p className="text-xs italic text-violet-300">"{data.messagingApproach.closingLine}"</p>
              </>
            )}
          </div>
        </div>
      )}

      {data.dealAccelerators && data.dealAccelerators.length > 0 && (
        <div className="px-4 pb-3">
          <p className="text-xs font-medium mb-2 text-muted-foreground">Deal Accelerators</p>
          <div className="flex flex-wrap gap-1.5">
            {data.dealAccelerators.map((acc, i) => (
              <span key={i} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-emerald-300">
                <Zap className="w-2.5 h-2.5" /> {acc}
              </span>
            ))}
          </div>
        </div>
      )}

      {data.objectionHandling && data.objectionHandling.length > 0 && (
        <div className="px-4 pb-4">
          <button
            type="button"
            onClick={() => setShowObjections(!showObjections)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2"
          >
            <ShieldAlert className="w-3 h-3" />
            Objection Handling ({data.objectionHandling.length})
            {showObjections ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {showObjections && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
              {data.objectionHandling.map((obj, i) => (
                <div key={i} className="p-2.5 rounded-lg bg-muted/20 border border-border/30">
                  <p className="text-xs font-medium text-amber-300 mb-1">"{obj.objection}"</p>
                  <p className="text-xs text-muted-foreground">{obj.response}</p>
                </div>
              ))}
            </motion.div>
          )}
        </div>
      )}

      <div className="px-4 py-3 border-t border-border/30 bg-violet-500/5">
        <p className="text-xs text-muted-foreground">{data.reasoning}</p>
      </div>
    </motion.div>
  );
}
