"use client";

import { useEffect, useState, useCallback } from "react";
import { Sparkles, RefreshCw, ChevronRight, AlertTriangle, AlertCircle, Zap, Info } from "lucide-react";
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
      className="rounded-2xl border border-border/40 bg-card overflow-hidden"
      aria-label="What KEY noticed"
    >
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
          return (
            <button
              key={insight.id}
              onClick={() =>
                openKey({
                  mode: "chat",
                  prompt: insight.suggestedAction || `Tell me about: ${insight.title}`,
                })
              }
              className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-muted/20 transition-colors group"
            >
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: `${color}15` }}
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
              <ChevronRight className="w-4 h-4 text-muted-foreground/30 group-hover:text-[hsl(var(--kf-accent1))] mt-1" />
            </button>
          );
        })}
      </div>
    </section>
  );
}
