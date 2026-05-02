"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  ShieldAlert,
  RefreshCw,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  TrendingDown,
  Lightbulb,
  Users,
} from "lucide-react";
import { aiChurnDetection, type AiChurnRisk } from "@/lib/client";
import { InfoBadge } from "@/components/ui/info-badge";

interface AiChurnDetectionProps {
  onSelectContact?: (contactId: string) => void;
}

const RISK_CONFIG = {
  critical: { color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20" },
  high: { color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20" },
  medium: { color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/20" },
};

export function AiChurnDetectionPanel({ onSelectContact }: AiChurnDetectionProps) {
  const [data, setData] = useState<AiChurnRisk | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const detect = async () => {
    setLoading(true);
    try {
      const result = await aiChurnDetection();
      if (result.data) {
        setData(result.data);
      } else {
        toast.error(result.error ?? "Failed to detect churn risk");
      }
    } catch {
      toast.error("Failed to run churn detection");
    } finally {
      setLoading(false);
    }
  };

  if (!data && !loading) {
    return (
      <button
        onClick={detect}
        className="w-full flex items-center gap-2 px-3.5 py-3 rounded-xl border border-border/50 bg-card hover:bg-white/[0.04] transition-colors text-left"
      >
        <ShieldAlert className="w-4.5 h-4.5 text-amber-400" />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium inline-flex items-center gap-1">Churn Risk Detection <InfoBadge title="Churn Risk" body="AI analyzes engagement patterns — booking gaps, invoice payment delays, and interaction recency — to flag contacts likely to leave. Critical risk means no activity in 60+ days." side="right" iconSize={10} /></span>
          <span className="text-[10px] text-muted-foreground/60">AI-powered analysis of at-risk contacts</span>
        </div>
        <span className="text-[10px] text-muted-foreground/50">2 credits</span>
      </button>
    );
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-border/50 bg-card p-3.5 space-y-2">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-400 animate-pulse" />
          <span className="text-sm font-medium">Analyzing churn risk...</span>
        </div>
        <div className="space-y-1.5">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-10 rounded-lg bg-white/5 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 hover:bg-white/[0.02] transition-colors"
      >
        <ShieldAlert className="w-4 h-4 text-amber-400" />
        <span className="text-sm font-medium flex-1 text-left">Churn Risk</span>
        {data.atRisk.length > 0 && (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/10 text-red-400">
            {data.atRisk.length} at risk
          </span>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); detect(); }}
          className="p-1 rounded-md hover:bg-white/10 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-muted-foreground/70 ${loading ? 'animate-spin' : ''}`} />
        </button>
        {expanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/50" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50" />}
      </button>

      {expanded && (
        <div className="px-3.5 pb-3.5 space-y-3">
          <p className="text-xs text-foreground/70 leading-relaxed">{data.summary}</p>

          {data.atRisk.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg bg-emerald-500/5 border border-emerald-500/10 px-3 py-2.5">
              <Users className="w-4 h-4 text-emerald-400" />
              <span className="text-xs text-emerald-300/90">No contacts at significant churn risk. Your retention is looking good.</span>
            </div>
          ) : (
            <div className="space-y-2">
              {data.atRisk.map((contact, i) => {
                const risk = RISK_CONFIG[contact.riskLevel] ?? RISK_CONFIG.medium;
                return (
                  <div
                    key={i}
                    className={`rounded-lg border ${risk.border} ${risk.bg} p-2.5 space-y-1.5`}
                  >
                    <div className="flex items-center justify-between">
                      <button
                        onClick={() => onSelectContact?.(contact.contactId)}
                        className="text-xs font-medium text-foreground/90 hover:underline text-left"
                      >
                        {contact.contactName}
                      </button>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[10px] font-bold ${risk.color}`}>
                          {Math.round(contact.churnProbability * 100)}% risk
                        </span>
                        <AlertTriangle className={`w-3 h-3 ${risk.color}`} />
                      </div>
                    </div>

                    {contact.reasons.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {contact.reasons.slice(0, 3).map((reason, ri) => (
                          <span key={ri} className="text-[10px] text-foreground/60 bg-white/5 px-1.5 py-0.5 rounded">
                            {reason}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="flex items-start gap-1.5">
                      <Lightbulb className="w-3 h-3 text-amber-400/70 mt-0.5 shrink-0" />
                      <span className="text-[10px] text-foreground/70">{contact.recommendedAction}</span>
                    </div>

                    {contact.estimatedRevenueLoss > 0 && (
                      <div className="flex items-center gap-1">
                        <TrendingDown className="w-3 h-3 text-red-400/70" />
                        <span className="text-[10px] text-red-300/80">
                          Est. revenue loss: TTD {contact.estimatedRevenueLoss.toLocaleString()}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
