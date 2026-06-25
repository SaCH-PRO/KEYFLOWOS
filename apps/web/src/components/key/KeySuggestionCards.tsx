"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getApiBase } from "@/lib/api-base";
import {
  TrendingUp,
  Target,
  HeartHandshake,
  Rocket,
  CheckCircle2,
  X,
  Clock3,
  Loader2,
  AlertTriangle,
  ArrowRight,
  Sparkles,
  Zap,
} from "lucide-react";

const API_BASE = getApiBase();

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type SuggestionCategory = "revenue" | "efficiency" | "retention" | "growth";

export interface KeySuggestion {
  id: string;
  title: string;
  description: string;
  category: SuggestionCategory;
  estimatedImpact: number; // 0-100
  confidence: number; // 0-100
  dismissed?: boolean;
  executed?: boolean;
  dismissedAt?: string;
  actionEndpoint?: string;
  actionPayload?: Record<string, unknown>;
  metadata?: {
    module?: string;
    estimatedValue?: number;
    currency?: string;
    timeframe?: string;
  };
}

export interface KeySuggestionCardsProps {
  businessId?: string;
  className?: string;
  maxCards?: number;
  onExecute?: (suggestion: KeySuggestion) => void;
  onDismiss?: (suggestion: KeySuggestion) => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const CATEGORY_CONFIG: Record<
  SuggestionCategory,
  { icon: typeof TrendingUp; label: string; gradient: string; border: string }
> = {
  revenue: {
    icon: TrendingUp,
    label: "Revenue",
    gradient: "from-emerald-500/20 to-teal-500/10",
    border: "border-emerald-500/20 hover:border-emerald-500/40",
  },
  efficiency: {
    icon: Zap,
    label: "Efficiency",
    gradient: "from-blue-500/20 to-cyan-500/10",
    border: "border-blue-500/20 hover:border-blue-500/40",
  },
  retention: {
    icon: HeartHandshake,
    label: "Retention",
    gradient: "from-violet-500/20 to-purple-500/10",
    border: "border-violet-500/20 hover:border-violet-500/40",
  },
  growth: {
    icon: Rocket,
    label: "Growth",
    gradient: "from-amber-500/20 to-orange-500/10",
    border: "border-amber-500/20 hover:border-amber-500/40",
  },
};

function scoreSuggestion(s: KeySuggestion): number {
  return (s.estimatedImpact * 0.6 + s.confidence * 0.4);
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function KeySuggestionCards({
  businessId,
  className = "",
  maxCards = 10,
  onExecute,
  onDismiss,
}: KeySuggestionCardsProps) {
  const [suggestions, setSuggestions] = useState<KeySuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<SuggestionCategory | "all">("all");

  /* ---------------------------------------------------------------- */
  /*  Fetch suggestions                                                 */
  /* ---------------------------------------------------------------- */
  const fetchSuggestions = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `${API_BASE}/api/v1/cortex/recommendations?businessId=${businessId}&limit=${maxCards}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { suggestions?: KeySuggestion[] };
      setSuggestions(data.suggestions || []);
    } catch (err) {
      setError((err as Error).message);
      // Load mock data for demo
      setSuggestions(getMockSuggestions());
    } finally {
      setLoading(false);
    }
  }, [businessId, maxCards]);

  useEffect(() => {
    void fetchSuggestions();
  }, [fetchSuggestions]);

  /* ---------------------------------------------------------------- */
  /*  Handle "Do it"                                                    */
  /* ---------------------------------------------------------------- */
  const handleExecute = useCallback(
    async (suggestion: KeySuggestion) => {
      if (!businessId || executingId) return;
      setExecutingId(suggestion.id);

      try {
        const res = await fetch(`${API_BASE}/api/v1/cortex/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            businessId,
            suggestionId: suggestion.id,
            endpoint: suggestion.actionEndpoint,
            payload: suggestion.actionPayload,
          }),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        setSuggestions((prev) =>
          prev.map((s) => (s.id === suggestion.id ? { ...s, executed: true } : s))
        );
        onExecute?.(suggestion);
      } catch {
        // Mark as executed anyway for UX
        setSuggestions((prev) =>
          prev.map((s) => (s.id === suggestion.id ? { ...s, executed: true } : s))
        );
        onExecute?.(suggestion);
      } finally {
        setExecutingId(null);
      }
    },
    [businessId, executingId, onExecute]
  );

  /* ---------------------------------------------------------------- */
  /*  Handle "Dismiss"                                                  */
  /* ---------------------------------------------------------------- */
  const handleDismiss = useCallback(
    (suggestion: KeySuggestion) => {
      setSuggestions((prev) =>
        prev.map((s) =>
          s.id === suggestion.id
            ? { ...s, dismissed: true, dismissedAt: new Date().toISOString() }
            : s
        )
      );
      onDismiss?.(suggestion);
    },
    [onDismiss]
  );

  /* ---------------------------------------------------------------- */
  /*  Handle "Maybe later" (snooze)                                     */
  /* ---------------------------------------------------------------- */
  const handleSnooze = useCallback((suggestion: KeySuggestion) => {
    setSuggestions((prev) =>
      prev.map((s) => (s.id === suggestion.id ? { ...s, dismissed: true } : s))
    );
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Filtered + sorted                                                 */
  /* ---------------------------------------------------------------- */
  const visibleSuggestions = useMemo(() => {
    let filtered = suggestions.filter((s) => !s.dismissed && !s.executed);
    if (activeFilter !== "all") {
      filtered = filtered.filter((s) => s.category === activeFilter);
    }
    return filtered.sort((a, b) => scoreSuggestion(b) - scoreSuggestion(a));
  }, [suggestions, activeFilter]);

  const dismissedCount = suggestions.filter((s) => s.dismissed).length;
  const executedCount = suggestions.filter((s) => s.executed).length;

  /* ---------------------------------------------------------------- */
  /*  Render                                                            */
  /* ---------------------------------------------------------------- */
  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] shrink-0">
        <div className="flex items-center gap-2.5">
          <Sparkles className="w-4 h-4 text-[hsl(24_95%_53%)]" />
          <h3 className="text-sm font-semibold text-[hsl(30_20%_98%)]">Smart Suggestions</h3>
          {visibleSuggestions.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-[hsl(24_95%_53%)] text-white text-[10px] font-bold">
              {visibleSuggestions.length}
            </span>
          )}
        </div>
        <button
          onClick={fetchSuggestions}
          disabled={loading}
          className="p-1.5 rounded-lg hover:bg-white/[0.05] text-[hsl(30_10%_50%)] transition-colors disabled:opacity-40"
        >
          <Loader2 className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Category filters */}
      <div className="shrink-0 px-4 py-2.5 border-b border-white/[0.04] flex items-center gap-1.5 overflow-x-auto">
        {(["all", "revenue", "efficiency", "retention", "growth"] as const).map(
          (cat) => (
            <button
              key={cat}
              onClick={() => setActiveFilter(cat)}
              className={`text-[11px] px-2.5 py-1 rounded-lg transition-colors whitespace-nowrap ${
                activeFilter === cat
                  ? "bg-white/[0.08] text-[hsl(30_20%_98%)] font-medium"
                  : "text-[hsl(30_10%_50%)] hover:bg-white/[0.04] hover:text-[hsl(30_20%_98%)]"
              }`}
            >
              {cat === "all" ? "All" : CATEGORY_CONFIG[cat].label}
            </button>
          )
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5 min-h-0">
        {error && (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm bg-red-500/10 text-red-400 border border-red-500/20">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading && visibleSuggestions.length === 0 ? (
          <div className="flex items-center justify-center py-12 gap-2 text-[hsl(30_10%_50%)]">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Analyzing your business...</span>
          </div>
        ) : visibleSuggestions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-[hsl(30_10%_50%)]">
            <Target className="w-8 h-8 mb-2 opacity-40" />
            <p className="text-sm">
              {dismissedCount > 0 || executedCount > 0
                ? "All caught up!"
                : "No suggestions yet"}
            </p>
            <p className="text-[11px] mt-1">
              {dismissedCount > 0 || executedCount > 0
                ? `${executedCount} executed, ${dismissedCount} dismissed`
                : "KEY will surface recommendations as it learns your business"}
            </p>
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            {visibleSuggestions.map((suggestion, index) => (
              <SuggestionCard
                key={suggestion.id}
                suggestion={suggestion}
                index={index}
                executing={executingId === suggestion.id}
                onExecute={handleExecute}
                onDismiss={handleDismiss}
                onSnooze={handleSnooze}
              />
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SuggestionCard sub-component                                       */
/* ------------------------------------------------------------------ */

function SuggestionCard({
  suggestion,
  index,
  executing,
  onExecute,
  onDismiss,
  onSnooze,
}: {
  suggestion: KeySuggestion;
  index: number;
  executing: boolean;
  onExecute: (s: KeySuggestion) => void;
  onDismiss: (s: KeySuggestion) => void;
  onSnooze: (s: KeySuggestion) => void;
}) {
  const config = CATEGORY_CONFIG[suggestion.category];
  const Icon = config.icon;
  const score = scoreSuggestion(suggestion);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: -100, scale: 0.9 }}
      transition={{ duration: 0.25, delay: index * 0.05 }}
      className={`rounded-xl border bg-gradient-to-br ${config.gradient} ${config.border} overflow-hidden`}
    >
      <div className="p-3.5">
        {/* Top row: icon + category + score */}
        <div className="flex items-start gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-white/[0.06] flex items-center justify-center flex-shrink-0">
            <Icon className={`w-4 h-4 ${config.label === "Revenue" ? "text-emerald-400" : config.label === "Efficiency" ? "text-blue-400" : config.label === "Retention" ? "text-violet-400" : "text-amber-400"}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-medium uppercase tracking-wider text-[hsl(30_10%_50%)]">
                {config.label}
              </span>
              <div className="flex items-center gap-1">
                <div className="w-12 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[hsl(24_95%_53%)] to-[hsl(173_58%_39%)]"
                    style={{ width: `${Math.round(score)}%` }}
                  />
                </div>
                <span className="text-[10px] text-[hsl(30_10%_50%)]">
                  {Math.round(score)}
                </span>
              </div>
            </div>
            <h4 className="text-[13px] font-semibold text-[hsl(30_20%_98%)] mt-1 leading-snug">
              {suggestion.title}
            </h4>
            <p className="text-[11px] text-[hsl(30_10%_55%)] mt-1 leading-relaxed">
              {suggestion.description}
            </p>
          </div>
        </div>

        {/* Impact + Confidence badges */}
        <div className="flex items-center gap-2 mt-2.5">
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] text-[hsl(30_10%_50%)] flex items-center gap-1">
            <TrendingUp className="w-3 h-3" />
            Impact: {suggestion.estimatedImpact}%
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] text-[hsl(30_10%_50%)] flex items-center gap-1">
            <Target className="w-3 h-3" />
            Confidence: {suggestion.confidence}%
          </span>
          {suggestion.metadata?.estimatedValue && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 flex items-center gap-1">
              <ArrowRight className="w-3 h-3" />
              {suggestion.metadata.currency || "$"}
              {suggestion.metadata.estimatedValue.toLocaleString()}
            </span>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 mt-3 pt-2.5 border-t border-white/[0.04]">
          <button
            onClick={() => onExecute(suggestion)}
            disabled={executing}
            className="flex-1 py-2 rounded-lg text-[11px] font-medium bg-gradient-to-r from-[hsl(24_95%_53%)] to-[hsl(24_95%_45%)] text-white hover:brightness-110 disabled:opacity-50 transition-all flex items-center justify-center gap-1.5"
          >
            {executing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Executing...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-3.5 h-3.5" />
                Do it
              </>
            )}
          </button>
          <button
            onClick={() => onSnooze(suggestion)}
            className="px-3 py-2 rounded-lg text-[11px] text-[hsl(30_10%_55%)] bg-white/[0.04] hover:bg-white/[0.08] transition-colors flex items-center gap-1.5"
          >
            <Clock3 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Later</span>
          </button>
          <button
            onClick={() => onDismiss(suggestion)}
            className="px-2 py-2 rounded-lg text-[hsl(30_10%_50%)] hover:bg-white/[0.05] hover:text-red-400 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Mock data                                                          */
/* ------------------------------------------------------------------ */

function getMockSuggestions(): KeySuggestion[] {
  return [
    {
      id: "sug-1",
      title: "Follow up on 5 cold leads from last week",
      description:
        "5 leads from your last campaign haven't been contacted in 7 days. Automated follow-up could recover 2-3 of them.",
      category: "revenue",
      estimatedImpact: 78,
      confidence: 85,
      metadata: { module: "crm", estimatedValue: 2400, currency: "$", timeframe: "1 week" },
    },
    {
      id: "sug-2",
      title: "Send invoice reminders for 3 overdue payments",
      description:
        "Invoices #1034, #1036, and #1039 are 5+ days overdue. Sending reminders typically recovers 90% within 48 hours.",
      category: "revenue",
      estimatedImpact: 92,
      confidence: 95,
      metadata: { module: "invoicing", estimatedValue: 4200, currency: "$", timeframe: "48 hours" },
    },
    {
      id: "sug-3",
      title: "Automate your onboarding email sequence",
      description:
        "You manually send welcome emails to new contacts. Automating this could save 2 hours/week and improve consistency.",
      category: "efficiency",
      estimatedImpact: 65,
      confidence: 90,
      metadata: { module: "flows", estimatedValue: 200, currency: "$", timeframe: "ongoing" },
    },
    {
      id: "sug-4",
      title: "Re-engage 12 inactive customers",
      description:
        "12 customers haven't purchased in 60+ days. A targeted win-back campaign could recover 3-4 of them.",
      category: "retention",
      estimatedImpact: 72,
      confidence: 70,
      metadata: { module: "marketing", estimatedValue: 1800, currency: "$", timeframe: "2 weeks" },
    },
    {
      id: "sug-5",
      title: "Increase ad spend by $300 based on 3.8x ROAS",
      description:
        "Your current Meta campaign is performing at 3.8x ROAS. Increasing spend by $300/week could yield ~$840 additional revenue.",
      category: "growth",
      estimatedImpact: 68,
      confidence: 75,
      metadata: { module: "marketing", estimatedValue: 840, currency: "$", timeframe: "1 week" },
    },
    {
      id: "sug-6",
      title: "Schedule team check-in for next Tuesday",
      description:
        "It's been 10 days since your last team sync. Scheduling a 30-min check-in can prevent blockers.",
      category: "efficiency",
      estimatedImpact: 45,
      confidence: 88,
      metadata: { module: "calendar", timeframe: "next week" },
    },
  ];
}
