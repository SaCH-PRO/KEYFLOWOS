"use client";

import { useEffect, useState, useCallback } from "react";
import { Sparkles, RefreshCw, ChevronRight, AlertTriangle, AlertCircle, Zap, Info, ChevronDown, ChevronUp, Brain } from "lucide-react";
import { fetchProAutoInsights, type ProAutoInsight } from "@/lib/client";
import { openKey } from "./key-agent";

interface KeyNoticedStreamProps {
  businessId: string;
  limit?: number;
}

const SEVERITY_ICONS: Record<ProAutoInsight["severity"], typeof AlertCircle> = {
  critical: AlertTriangle,
  warning: AlertCircle,
  opportunity: Zap,
  info: Info,
};

const SEVERITY_COLORS: Record<ProAutoInsight["severity"], string> = {
  critical: "hsl(var(--kf-error))",
  warning: "hsl(var(--kf-warning))",
  opportunity: "hsl(var(--kf-success))",
  info: "hsl(var(--kf-info))",
};

/**
 * "What KEY noticed" — the proactive event-bus reactivity stream.
 * Surfaces ProAutoMonitorService insights driven by the module event bus.
 */
export function KeyNoticedStream({ businessId, limit = 6 }: KeyNoticedStreamProps) {
  const [insights, setInsights] = useState<ProAutoInsight[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await fetchProAutoInsights(businessId);
      if (res.data?.insights) setInsights(res.data.insights.slice(0, limit));
    } finally {
      setLoading(false);
    }
  }, [businessId, limit]);

  useEffect(() => {
    load();
    // Re-load when KEY executes anything that affects state
    const handler = () => load();
    window.addEventListener("kf:ai-activity", handler);
    window.addEventListener("kf:action.executed", handler);
    return () => {
      window.removeEventListener("kf:ai-activity", handler);
      window.removeEventListener("kf:action.executed", handler);
    };
  }, [load]);

  return (
    <section
      className="rounded-2xl border border-border/40 bg-card/80 overflow-hidden relative"
      style={{ backdropFilter: "blur(12px)" }}
      aria-label="What KEY noticed"
    >
      {/* Subtle gradient top border */}
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-[hsl(var(--kf-accent1))] via-[hsl(var(--kf-accent2))] to-transparent opacity-40" />
      <header className="flex items-center justify-between px-4 py-3 border-b border-border/30">
        <div className="flex items-center gap-2">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{
              background:
                "linear-gradient(135deg, hsl(var(--kf-accent1)/0.2), hsl(var(--kf-accent2)/0.2))",
            }}
          >
            <Sparkles className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground/90">What KEY noticed</h3>
            <p className="text-[10px] text-muted-foreground/60">
              Proactive signals from across your modules
            </p>
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="p-1.5 rounded-lg text-muted-foreground/60 hover:text-foreground hover:bg-muted/30 disabled:opacity-50"
          aria-label="Refresh insights"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </header>

      <div className="divide-y divide-border/20">
        {insights.length === 0 && !loading && (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground/60">
            All quiet — KEY will surface signals here as they happen.
          </div>
        )}
        {insights.map((insight) => {
          const Icon = SEVERITY_ICONS[insight.severity] || Info;
          const color = SEVERITY_COLORS[insight.severity] || "hsl(var(--kf-info))";
          const isExpanded = expandedId === insight.id;
          return (
            <div key={insight.id} className="border-b border-border/10 last:border-0">
              <button
                onClick={() => setExpandedId((id) => (id === insight.id ? null : insight.id))}
                className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-muted/20 transition-colors group"
              >
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: `${color}15`, boxShadow: `0 0 12px ${color}20` }}
                >
                  <Icon className="w-3.5 h-3.5" style={{ color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-foreground/90 truncate">
                      {insight.title}
                    </span>
                    {insight.module && (
                      <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50">
                        {insight.module}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground/70 leading-relaxed mt-0.5 line-clamp-2">
                    {insight.description}
                  </p>
                </div>
                <div className="flex items-center gap-1 mt-1">
                  {insight.suggestedAction && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openKey({
                          mode: "chat",
                          prompt: insight.suggestedAction,
                        });
                      }}
                      className="text-[10px] px-2 py-0.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                    >
                      Act
                    </button>
                  )}
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-muted-foreground/30" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground/30 group-hover:text-[hsl(var(--kf-accent1))]" />
                  )}
                </div>
              </button>

              {isExpanded && (
                <div className="px-4 pb-3 pl-[52px]">
                  <div className="rounded-lg border border-border/30 bg-muted/20 p-3 space-y-2">
                    <div className="flex items-center gap-1.5">
                      <Brain className="w-3 h-3 text-muted-foreground/60" />
                      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                        Why KEY noticed this
                      </span>
                    </div>
                    <ul className="space-y-1">
                      <li className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                        <span className="text-primary mt-0.5">•</span>
                        {insight.description}
                      </li>
                      {insight.metric && (
                        <li className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                          <span className="text-primary mt-0.5">•</span>
                          Metric: {insight.metric}
                        </li>
                      )}
                      <li className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                        <span className="text-primary mt-0.5">•</span>
                        Risk tier: {insight.riskTier} — {insight.riskTier <= 1 ? "Low risk" : insight.riskTier <= 2 ? "Medium risk" : "High risk"}
                      </li>
                      {insight.suggestedAction && (
                        <li className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                          <span className="text-primary mt-0.5">•</span>
                          Suggested action: {insight.suggestedAction}
                        </li>
                      )}
                    </ul>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
