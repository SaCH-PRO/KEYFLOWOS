"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Brain, RefreshCw, TrendingUp, TrendingDown, Minus,
  ChevronDown, ChevronUp, Lightbulb,
} from "lucide-react";
import { aiLeadScore, type AiLeadScore } from "@/lib/client";

interface AiLeadScoreProps {
  contactId: string;
  currentScore?: number | null;
}

const LABEL_CONFIG: Record<string, { color: string; bg: string }> = {
  Hot: { color: "text-red-400", bg: "bg-red-500/10" },
  Warm: { color: "text-orange-400", bg: "bg-orange-500/10" },
  Neutral: { color: "text-blue-400", bg: "bg-blue-500/10" },
  Cool: { color: "text-cyan-400", bg: "bg-cyan-500/10" },
  Cold: { color: "text-slate-400", bg: "bg-slate-500/10" },
};

const IMPACT_ICON = {
  positive: { icon: TrendingUp, color: "text-emerald-400" },
  neutral: { icon: Minus, color: "text-muted-foreground" },
  negative: { icon: TrendingDown, color: "text-red-400" },
};

export function AiLeadScorePanel({ contactId, currentScore }: AiLeadScoreProps) {
  const [data, setData] = useState<AiLeadScore | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const generate = async () => {
    setLoading(true);
    try {
      const result = await aiLeadScore(contactId);
      if (result.data) {
        setData(result.data);
        setExpanded(true);
      } else {
        toast.error(result.error ?? "Failed to score contact");
      }
    } catch {
      toast.error("Failed to generate AI score");
    } finally {
      setLoading(false);
    }
  };

  if (!data && !loading) {
    return (
      <button
        onClick={generate}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border/50 bg-card hover:bg-white/[0.04] transition-colors text-left"
      >
        <Brain className="w-3.5 h-3.5 text-[hsl(var(--kf-accent2))]" />
        <span className="text-[11px] font-medium text-[hsl(var(--kf-accent2))]">AI Score</span>
        {currentScore != null && (
          <span className="text-[10px] text-muted-foreground/60 ml-1">Current: {currentScore}</span>
        )}
      </button>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border/50 bg-card">
        <Brain className="w-3.5 h-3.5 text-[hsl(var(--kf-accent2))] animate-pulse" />
        <span className="text-[11px] text-muted-foreground">Scoring...</span>
      </div>
    );
  }

  if (!data) return null;

  const labelCfg = LABEL_CONFIG[data.label] ?? LABEL_CONFIG.Neutral;

  return (
    <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 hover:bg-white/[0.02] transition-colors"
      >
        <Brain className="w-4 h-4 text-[hsl(var(--kf-accent2))]" />
        <span className="text-sm font-medium flex-1 text-left">AI Lead Score</span>
        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${labelCfg.bg} ${labelCfg.color}`}>
          {data.score} — {data.label}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); generate(); }}
          className="p-1 rounded-md hover:bg-white/10 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-muted-foreground/70 ${loading ? 'animate-spin' : ''}`} />
        </button>
        {expanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/50" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50" />}
      </button>

      {expanded && (
        <div className="px-3.5 pb-3.5 space-y-3">
          <p className="text-xs text-foreground/80 leading-relaxed">{data.reasoning}</p>

          {data.factors.length > 0 && (
            <div className="space-y-1.5">
              <span className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider">Scoring Factors</span>
              {data.factors.map((f, i) => {
                const imp = IMPACT_ICON[f.impact] ?? IMPACT_ICON.neutral;
                const ImpactIcon = imp.icon;
                return (
                  <div key={i} className="flex items-start gap-2 rounded-lg bg-white/[0.02] px-2.5 py-1.5">
                    <ImpactIcon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${imp.color}`} />
                    <div className="flex-1 min-w-0">
                      <span className="text-[11px] font-medium text-foreground/90">{f.name}</span>
                      <p className="text-[10px] text-muted-foreground/70">{f.detail}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {data.recommendation && (
            <div className="flex gap-2 items-start rounded-lg bg-[hsl(var(--kf-accent2))]/5 border border-[hsl(var(--kf-accent2))]/10 px-3 py-2">
              <Lightbulb className="w-3.5 h-3.5 text-[hsl(var(--kf-accent2))] mt-0.5 shrink-0" />
              <p className="text-xs text-foreground/90">{data.recommendation}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
