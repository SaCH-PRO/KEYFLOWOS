"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Target,
  Clock,
  Mail,
  Phone,
  MessageSquare,
  Users,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Loader2,
  Sparkles,
} from "lucide-react";
import { commerceAiCollectionsScore, type CommerceCollectionsScore } from "@/lib/client";

interface CollectionsScoringPanelProps {
  businessId: string | null;
}

const SCORE_COLORS: Record<string, string> = {
  very_likely: "text-emerald-400 bg-emerald-500/15 border-emerald-500/30",
  likely: "text-teal-400 bg-teal-500/15 border-teal-500/30",
  uncertain: "text-amber-400 bg-amber-500/15 border-amber-500/30",
  unlikely: "text-orange-400 bg-orange-500/15 border-orange-500/30",
  very_unlikely: "text-red-400 bg-red-500/15 border-red-500/30",
};

const CHANNEL_ICONS: Record<string, React.ElementType> = {
  email: Mail,
  phone: Phone,
  whatsapp: MessageSquare,
  in_person: Users,
};

export function CollectionsScoringPanel({ businessId }: CollectionsScoringPanelProps) {
  const [data, setData] = useState<CommerceCollectionsScore | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const runScoring = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await commerceAiCollectionsScore(businessId);
      if (res.data) setData(res.data);
    } catch {
      setError("Failed to score overdue invoices. Please try again.");
    }
    setLoading(false);
  }, [businessId]);

  if (!data && !loading) {
    return (
      <div className="rounded-xl border border-border/50 bg-card/80 p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 rounded-lg bg-violet-500/10">
            <Target className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Predictive Collections</h3>
            <p className="text-xs text-muted-foreground">AI-scored recovery likelihood for overdue invoices</p>
          </div>
        </div>
        {error && <p className="text-xs text-red-400 mb-2 flex items-center gap-1.5"><AlertTriangle className="w-3 h-3" />{error}</p>}
        <button
          onClick={runScoring}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all hover:opacity-90"
          style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))", color: "white" }}
        >
          <Sparkles className="w-4 h-4" />
          Score Overdue Invoices
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-border/50 bg-card/80 p-8 flex flex-col items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-violet-400 mb-3" />
        <p className="text-sm text-muted-foreground">Analyzing recovery likelihood...</p>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="rounded-xl border border-border/50 bg-card/80 overflow-hidden">
      <div className="p-4 border-b border-border/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-violet-500/10">
              <Target className="w-5 h-5 text-violet-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Recovery Scoring</h3>
              <p className="text-xs text-muted-foreground">{data.scores.length} overdue invoices scored</p>
            </div>
          </div>
          <button onClick={runScoring} className="text-xs text-muted-foreground hover:text-foreground transition-colors">Refresh</button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          <div className="p-2.5 rounded-lg bg-muted/20 border border-border/30 text-center">
            <p className="text-lg font-bold text-red-400">${data.summary.totalOverdue.toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground">Total Overdue</p>
          </div>
          <div className="p-2.5 rounded-lg bg-muted/20 border border-border/30 text-center">
            <p className="text-lg font-bold text-emerald-400">${data.summary.estimatedRecovery.toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground">Est. Recovery</p>
          </div>
          <div className="p-2.5 rounded-lg bg-muted/20 border border-border/30 text-center">
            <p className="text-lg font-bold">{data.summary.averageRecoveryScore}%</p>
            <p className="text-[10px] text-muted-foreground">Avg Score</p>
          </div>
          <div className="p-2.5 rounded-lg bg-muted/20 border border-border/30 text-center">
            <p className="text-lg font-bold text-amber-400">{data.summary.highPriorityCount}</p>
            <p className="text-[10px] text-muted-foreground">High Priority</p>
          </div>
        </div>
      </div>

      {data.strategy && (
        <div className="px-4 py-3 border-b border-border/30 bg-violet-500/5">
          <p className="text-xs text-violet-300">{data.strategy}</p>
        </div>
      )}

      <div className="divide-y divide-border/20">
        {data.scores.map((score) => {
          const ChannelIcon = CHANNEL_ICONS[score.recommendedChannel] ?? Mail;
          const isExpanded = expanded === score.invoiceId;

          return (
            <div key={score.invoiceId} className="px-4 py-3">
              <button
                type="button"
                onClick={() => setExpanded(isExpanded ? null : score.invoiceId)}
                className="w-full flex items-center gap-3 text-left"
              >
                <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-muted/30 border border-border/30 shrink-0">
                  <span className="text-xs font-bold">{score.recoveryScore}%</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">#{score.invoiceNumber}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${SCORE_COLORS[score.recoveryLabel] ?? SCORE_COLORS.uncertain}`}>
                      {score.recoveryLabel.replace("_", " ")}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{score.contactName} · ${score.amount.toLocaleString()} · {score.daysOverdue}d overdue</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <ChannelIcon className="w-3.5 h-3.5 text-muted-foreground/50" />
                  {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/50" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50" />}
                </div>
              </button>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-3 pl-13 space-y-2">
                      <div className="p-3 rounded-lg bg-muted/20 border border-border/30 space-y-1.5">
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Clock className="w-3 h-3" /> Best follow-up: {score.optimalFollowUpDate ? new Date(score.optimalFollowUpDate).toLocaleDateString() : "ASAP"}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <ChannelIcon className="w-3 h-3" /> Channel: {score.recommendedChannel} · Tone: {score.recommendedTone}
                        </div>
                        <p className="text-xs text-muted-foreground/80 mt-1">{score.reasoning}</p>
                        <p className="text-xs font-medium text-violet-300 mt-1">{score.nextAction}</p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}
