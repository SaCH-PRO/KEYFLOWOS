"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle2,
  Lightbulb,
  MessageCircle,
  XOctagon,
  ListChecks,
  FileText,
  Loader2,
  Sparkles,
  TrendingUp,
  Heart,
  Shield,
  Clock,
} from "lucide-react";
import { aiPrepBrief, type AiPrepBrief } from "@/lib/client";

const healthColors: Record<string, string> = {
  strong: "text-emerald-400",
  good: "text-green-400",
  neutral: "text-yellow-400",
  weak: "text-orange-400",
  critical: "text-red-400",
};

const sentimentIcons: Record<string, typeof Heart> = {
  positive: Heart,
  neutral: Shield,
  negative: AlertTriangle,
  at_risk: XOctagon,
};

const urgencyColors: Record<string, string> = {
  high: "border-red-500/30 bg-red-500/5",
  medium: "border-yellow-500/30 bg-yellow-500/5",
  low: "border-white/10 bg-white/[0.02]",
};

export function AiPrepBriefPanel({ contactId }: { contactId: string }) {
  const [brief, setBrief] = useState<AiPrepBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await aiPrepBrief(contactId);
      if (res.error) {
        setError(res.error);
      } else if (res.data) {
        setBrief(res.data);
        setExpanded(true);
      }
    } catch {
      setError("Failed to generate prep brief");
    } finally {
      setLoading(false);
    }
  };

  if (!brief) {
    return (
      <button
        onClick={generate}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-violet-600/20 to-purple-600/20 border border-violet-500/30 text-violet-300 hover:from-violet-600/30 hover:to-purple-600/30 transition-all text-sm font-medium disabled:opacity-50"
      >
        {loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Preparing brief...
          </>
        ) : (
          <>
            <Brain className="w-4 h-4" />
            Prepare for Conversation
            <Sparkles className="w-3 h-3 text-violet-400" />
          </>
        )}
      </button>
    );
  }

  const SentimentIcon = sentimentIcons[brief.keyInfo?.sentiment ?? "neutral"] ?? Shield;
  const healthClass = healthColors[brief.keyInfo?.relationshipHealth ?? "neutral"] ?? "text-yellow-400";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-violet-500/20 bg-gradient-to-br from-violet-500/[0.04] to-purple-500/[0.04] overflow-hidden"
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-violet-400" />
          <span className="text-sm font-medium text-violet-300">Conversation Prep Brief</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-400">AI</span>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-4">
              <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                  <FileText className="w-3.5 h-3.5" />
                  Key Info
                </div>
                <p className="text-sm text-foreground/90">{brief.keyInfo?.summary}</p>
                <div className="flex items-center gap-3 text-xs mt-2">
                  <span className="flex items-center gap-1">
                    <SentimentIcon className="w-3 h-3" />
                    {brief.keyInfo?.sentiment}
                  </span>
                  <span className={`flex items-center gap-1 ${healthClass}`}>
                    <TrendingUp className="w-3 h-3" />
                    {brief.keyInfo?.relationshipHealth}
                  </span>
                </div>
                {brief.keyInfo?.lastContactSummary && (
                  <p className="text-xs text-muted-foreground mt-1">
                    <Clock className="w-3 h-3 inline mr-1" />
                    {brief.keyInfo.lastContactSummary}
                  </p>
                )}
              </div>

              {brief.openItems?.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <ListChecks className="w-3.5 h-3.5" />
                    Open Items ({brief.openItems.length})
                  </div>
                  <div className="space-y-1.5">
                    {brief.openItems.map((item, i) => (
                      <div key={i} className={`rounded-lg border p-2.5 ${urgencyColors[item.urgency] ?? urgencyColors.low}`}>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] uppercase font-medium text-muted-foreground">{item.type}</span>
                          {item.urgency === "high" && <AlertTriangle className="w-3 h-3 text-red-400" />}
                        </div>
                        <p className="text-sm mt-0.5">{item.title}</p>
                        {item.detail && <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {brief.suggestedTopics?.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Lightbulb className="w-3.5 h-3.5" />
                    Suggested Topics
                  </div>
                  <div className="space-y-1.5">
                    {brief.suggestedTopics.map((t, i) => (
                      <div key={i} className="rounded-lg border border-white/10 bg-white/[0.02] p-2.5">
                        <p className="text-sm font-medium">{t.topic}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{t.reason}</p>
                        <p className="text-xs text-violet-400 mt-0.5 italic">{t.approach}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(brief.relationshipSignals?.positive?.length > 0 || brief.relationshipSignals?.concerns?.length > 0 || brief.relationshipSignals?.opportunities?.length > 0) && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <TrendingUp className="w-3.5 h-3.5" />
                    Relationship Signals
                  </div>
                  <div className="grid gap-2">
                    {brief.relationshipSignals?.positive?.length > 0 && (
                      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5">
                        <p className="text-xs font-medium text-emerald-400 mb-1 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Positive</p>
                        <ul className="space-y-0.5">
                          {brief.relationshipSignals.positive.map((s, i) => <li key={i} className="text-xs text-foreground/80">• {s}</li>)}
                        </ul>
                      </div>
                    )}
                    {brief.relationshipSignals?.concerns?.length > 0 && (
                      <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-2.5">
                        <p className="text-xs font-medium text-orange-400 mb-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Concerns</p>
                        <ul className="space-y-0.5">
                          {brief.relationshipSignals.concerns.map((s, i) => <li key={i} className="text-xs text-foreground/80">• {s}</li>)}
                        </ul>
                      </div>
                    )}
                    {brief.relationshipSignals?.opportunities?.length > 0 && (
                      <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-2.5">
                        <p className="text-xs font-medium text-blue-400 mb-1 flex items-center gap-1"><Sparkles className="w-3 h-3" /> Opportunities</p>
                        <ul className="space-y-0.5">
                          {brief.relationshipSignals.opportunities.map((s, i) => <li key={i} className="text-xs text-foreground/80">• {s}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {brief.icebreakers?.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <MessageCircle className="w-3.5 h-3.5" />
                    Icebreakers
                  </div>
                  <div className="space-y-1">
                    {brief.icebreakers.map((ib, i) => (
                      <p key={i} className="text-xs text-foreground/80 pl-3 border-l-2 border-violet-500/30 py-0.5">&quot;{ib}&quot;</p>
                    ))}
                  </div>
                </div>
              )}

              {brief.talkingPoints?.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Talking Points
                  </div>
                  <ul className="space-y-0.5">
                    {brief.talkingPoints.map((tp, i) => <li key={i} className="text-xs text-foreground/80">• {tp}</li>)}
                  </ul>
                </div>
              )}

              {brief.thingsToAvoid?.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <XOctagon className="w-3.5 h-3.5 text-red-400" />
                    Things to Avoid
                  </div>
                  <ul className="space-y-0.5">
                    {brief.thingsToAvoid.map((ta, i) => <li key={i} className="text-xs text-red-300/80">• {ta}</li>)}
                  </ul>
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-white/5">
                <span className="text-[10px] text-muted-foreground">
                  {brief.creditsUsed} AI credit{brief.creditsUsed !== 1 ? "s" : ""} used
                </span>
                <button
                  onClick={generate}
                  disabled={loading}
                  className="text-[10px] text-violet-400 hover:text-violet-300 flex items-center gap-1"
                >
                  {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  Regenerate
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <div className="px-4 pb-3">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}
    </motion.div>
  );
}
