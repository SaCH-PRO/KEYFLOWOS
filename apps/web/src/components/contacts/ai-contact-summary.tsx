"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Sparkles,
  RefreshCw,
  Heart,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle,
  Minus,
  Lightbulb,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { aiContactSummary, type AiContactSummary as AiContactSummaryType } from "@/lib/client";

interface AiContactSummaryProps {
  contactId: string;
}

const SENTIMENT_CONFIG = {
  positive: { icon: CheckCircle, color: "text-emerald-400", bg: "bg-emerald-500/10", label: "Positive" },
  neutral: { icon: Minus, color: "text-blue-400", bg: "bg-blue-500/10", label: "Neutral" },
  negative: { icon: TrendingDown, color: "text-red-400", bg: "bg-red-500/10", label: "Negative" },
  at_risk: { icon: AlertTriangle, color: "text-amber-400", bg: "bg-amber-500/10", label: "At Risk" },
};

const HEALTH_CONFIG = {
  strong: { color: "text-emerald-400", label: "Strong" },
  good: { color: "text-green-400", label: "Good" },
  neutral: { color: "text-blue-400", label: "Neutral" },
  weak: { color: "text-amber-400", label: "Weak" },
  critical: { color: "text-red-400", label: "Critical" },
};

const REVENUE_CONFIG = {
  high: { icon: TrendingUp, color: "text-emerald-400", label: "High Impact" },
  medium: { icon: Minus, color: "text-blue-400", label: "Medium" },
  low: { icon: TrendingDown, color: "text-muted-foreground", label: "Low" },
};

export function AiContactSummaryPanel({ contactId }: AiContactSummaryProps) {
  const [data, setData] = useState<AiContactSummaryType | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const generate = async () => {
    setLoading(true);
    try {
      const result = await aiContactSummary(contactId);
      if (result.data) {
        setData(result.data);
      } else {
        toast.error(result.error ?? "Failed to generate summary");
      }
    } catch {
      toast.error("Failed to generate AI summary");
    } finally {
      setLoading(false);
    }
  };

  if (!data && !loading) {
    return (
      <button
        onClick={generate}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 rounded-xl border border-[hsl(var(--kf-accent1))]/20 bg-[hsl(var(--kf-accent1))]/5 hover:bg-[hsl(var(--kf-accent1))]/10 transition-colors text-left"
      >
        <Sparkles className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
        <span className="text-sm font-medium text-[hsl(var(--kf-accent1))]">Generate AI Briefing</span>
        <span className="text-[10px] text-muted-foreground/60 ml-auto">1 credit</span>
      </button>
    );
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-border/50 bg-card p-3.5 space-y-2">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[hsl(var(--kf-accent1))] animate-pulse" />
          <span className="text-sm font-medium">Generating AI briefing...</span>
        </div>
        <div className="space-y-1.5">
          <div className="h-3 w-full rounded bg-white/5 animate-pulse" />
          <div className="h-3 w-4/5 rounded bg-white/5 animate-pulse" />
          <div className="h-3 w-3/5 rounded bg-white/5 animate-pulse" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  const sentiment = SENTIMENT_CONFIG[data.sentiment] ?? SENTIMENT_CONFIG.neutral;
  const SentimentIcon = sentiment.icon;
  const health = HEALTH_CONFIG[data.relationshipHealth] ?? HEALTH_CONFIG.neutral;
  const revenue = REVENUE_CONFIG[data.revenueImpact] ?? REVENUE_CONFIG.low;
  const RevenueIcon = revenue.icon;

  return (
    <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 hover:bg-white/[0.02] transition-colors"
      >
        <Sparkles className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
        <span className="text-sm font-medium flex-1 text-left">AI Briefing</span>
        <button
          onClick={(e) => { e.stopPropagation(); generate(); }}
          className="p-1 rounded-md hover:bg-white/10 transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-muted-foreground/70 ${loading ? 'animate-spin' : ''}`} />
        </button>
        {expanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/50" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50" />}
      </button>

      {expanded && (
        <div className="px-3.5 pb-3.5 space-y-3">
          <p className="text-sm text-foreground/90 leading-relaxed">{data.summary}</p>

          <div className="flex flex-wrap gap-2">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${sentiment.bg} ${sentiment.color}`}>
              <SentimentIcon className="w-3 h-3" /> {sentiment.label}
            </span>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/5 ${health.color}`}>
              <Heart className="w-3 h-3" /> {health.label}
            </span>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/5 ${revenue.color}`}>
              <RevenueIcon className="w-3 h-3" /> {revenue.label}
            </span>
          </div>

          {data.keyInsights.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider">Key Insights</span>
              {data.keyInsights.map((insight, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <Lightbulb className="w-3.5 h-3.5 text-amber-400/70 mt-0.5 shrink-0" />
                  <span className="text-xs text-foreground/80">{insight}</span>
                </div>
              ))}
            </div>
          )}

          {data.recommendedAction && (
            <div className="rounded-lg bg-[hsl(var(--kf-accent1))]/5 border border-[hsl(var(--kf-accent1))]/10 px-3 py-2">
              <span className="text-[10px] font-medium text-[hsl(var(--kf-accent1))]/70 uppercase tracking-wider">Recommended Action</span>
              <p className="text-xs text-foreground/90 mt-0.5">{data.recommendedAction}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
