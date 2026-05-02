"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Sparkles, X, RefreshCw, Loader2, AlertTriangle,
  Lightbulb, TrendingUp, Zap, ChevronRight, Brain,
  Shield, Clock,
} from "lucide-react";
import type { UseModuleAiReturn, AiSuggestion } from "@/hooks/use-module-ai";

interface ModuleAiAssistantProps {
  ai: UseModuleAiReturn;
  moduleName: string;
  accentColor?: string;
  onAction?: (actionKey: string) => void;
  autoRefreshInterval?: number;
}

const ICON_MAP: Record<string, typeof Sparkles> = {
  action: Zap,
  insight: Lightbulb,
  warning: AlertTriangle,
  tip: TrendingUp,
};

const PRIORITY_STYLES: Record<string, string> = {
  high: "border-l-amber-500 bg-amber-500/[0.03]",
  medium: "border-l-[hsl(var(--kf-accent1))] bg-[hsl(var(--kf-accent1))]/[0.02]",
  low: "border-l-muted-foreground/30 bg-[hsl(var(--kf-muted)/0.01)]",
};

function SuggestionCard({
  suggestion,
  onExecute,
  onDismiss,
  onAction,
}: {
  suggestion: AiSuggestion;
  onExecute: () => void;
  onDismiss: () => void;
  onAction?: (actionKey: string) => void;
}) {
  const Icon = ICON_MAP[suggestion.type] || Sparkles;

  const handleAction = () => {
    if (suggestion.actionKey?.startsWith("tool:")) {
      onExecute();
    } else if (suggestion.actionKey && onAction) {
      onAction(suggestion.actionKey);
      onDismiss();
    } else {
      onExecute();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      transition={{ duration: 0.2 }}
      className={`rounded-xl border border-border/40 border-l-[3px] p-3 ${PRIORITY_STYLES[suggestion.priority]} transition-colors group`}
    >
      <div className="flex items-start gap-2.5">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
          suggestion.type === "warning"
            ? "bg-amber-500/10"
            : suggestion.type === "action"
            ? "bg-[hsl(var(--kf-accent2))]/10"
            : "bg-[hsl(var(--kf-accent1))]/10"
        }`}>
          <Icon className={`w-3.5 h-3.5 ${
            suggestion.type === "warning"
              ? "text-amber-400"
              : suggestion.type === "action"
              ? "text-[hsl(var(--kf-accent2))]"
              : "text-[hsl(var(--kf-accent1))]"
          }`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-xs font-semibold text-foreground/90">{suggestion.title}</span>
            <button
              onClick={onDismiss}
              className="p-1.5 rounded opacity-0 group-hover:opacity-100 hover:bg-[hsl(var(--kf-muted)/0.1)] transition-all min-w-[32px] min-h-[32px] flex items-center justify-center"
            >
              <X className="w-3 h-3 text-muted-foreground/50" />
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground/70 leading-relaxed mb-1.5">{suggestion.description}</p>
          {suggestion.explanation && (
            <p className="text-[10px] text-muted-foreground/50 leading-relaxed mb-1.5 italic">{suggestion.explanation}</p>
          )}
          {suggestion.actionLabel && (
            <button
              onClick={handleAction}
              className="flex items-center gap-1 text-[11px] font-medium text-[hsl(var(--kf-accent1))] hover:text-[hsl(var(--kf-accent1))]/80 transition-colors mt-1"
            >
              {suggestion.actionLabel}
              <ChevronRight className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export function ModuleAiAssistant({
  ai,
  moduleName,
  onAction,
  autoRefreshInterval = 0,
}: ModuleAiAssistantProps) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (autoRefreshInterval > 0) {
      intervalRef.current = setInterval(() => {
        ai.refreshSuggestions();
      }, autoRefreshInterval);
      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally excludes 'ai' object as a whole; including it would re-create this hook on every AI hub state change. Only the specific method invoked is referenced.
  }, [autoRefreshInterval, ai.refreshSuggestions]);

  if (!ai.panelOpen) return null;

  const timeAgo = ai.lastRefreshed
    ? Math.round((Date.now() - ai.lastRefreshed) / 60000)
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="rounded-xl border border-border/50 bg-card overflow-hidden"
    >
      <div className="px-3.5 py-2.5 border-b border-border/30 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-[hsl(var(--kf-accent1))]/20 to-[hsl(var(--kf-accent2))]/20 flex items-center justify-center">
            <Brain className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
          </div>
          <div>
            <span className="text-xs font-semibold text-foreground/90">AI Assistant</span>
            <span className="text-[10px] text-muted-foreground/50 ml-1.5">{moduleName}</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {timeAgo !== null && (
            <span className="text-[10px] text-muted-foreground/40 flex items-center gap-0.5 mr-1">
              <Clock className="w-2.5 h-2.5" />
              {timeAgo < 1 ? "just now" : `${timeAgo}m ago`}
            </span>
          )}
          <button
            onClick={ai.refreshSuggestions}
            disabled={ai.loading}
            className="p-1.5 rounded-lg hover:bg-[hsl(var(--kf-muted)/0.04)] disabled:opacity-30 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-muted-foreground/50 ${ai.loading ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={ai.togglePanel}
            className="p-1.5 rounded-lg hover:bg-[hsl(var(--kf-muted)/0.04)] transition-colors"
          >
            <X className="w-3.5 h-3.5 text-muted-foreground/50" />
          </button>
        </div>
      </div>

      <div className="p-3 space-y-2 max-h-[500px] overflow-y-auto">
        {ai.loading && ai.activeSuggestions.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="w-5 h-5 text-[hsl(var(--kf-accent1))] animate-spin" />
              <span className="text-xs text-muted-foreground/60">Analyzing your data...</span>
            </div>
          </div>
        )}

        {ai.error && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/5 border border-red-500/20">
            <Shield className="w-3.5 h-3.5 text-red-400 shrink-0" />
            <span className="text-xs text-red-400/80">{ai.error}</span>
          </div>
        )}

        <AnimatePresence mode="popLayout">
          {ai.activeSuggestions.map((s) => (
            <SuggestionCard
              key={s.id}
              suggestion={s}
              onExecute={() => ai.executeSuggestionAction(s)}
              onDismiss={() => ai.dismissSuggestion(s.id)}
              onAction={onAction}
            />
          ))}
        </AnimatePresence>

        {!ai.loading && ai.activeSuggestions.length === 0 && !ai.error && (
          <div className="flex flex-col items-center py-6 gap-2">
            <Sparkles className="w-5 h-5 text-[hsl(var(--kf-accent1))]/30" />
            <span className="text-xs text-muted-foreground/50">All clear — no suggestions right now</span>
            <p className="text-[10px] text-muted-foreground/40 text-center max-w-[200px]">AI will analyze your {moduleName.toLowerCase()} data and surface actionable insights.</p>
            <button
              onClick={ai.refreshSuggestions}
              className="text-[11px] text-[hsl(var(--kf-accent1))] hover:underline mt-1"
            >
              Run analysis
            </button>
          </div>
        )}
      </div>

      {ai.activeSuggestions.length > 0 && (
        <div className="px-3.5 py-2 border-t border-border/20">
          <span className="text-[10px] text-muted-foreground/40">
            {ai.activeSuggestions.length} suggestion{ai.activeSuggestions.length !== 1 ? "s" : ""} · 1 credit per refresh
          </span>
        </div>
      )}
    </motion.div>
  );
}

export function AiAssistantTrigger({
  ai,
  moduleName,
}: {
  ai: UseModuleAiReturn;
  moduleName: string;
}) {
  return (
    <button
      onClick={() => {
        ai.togglePanel();
        if (!ai.panelOpen && ai.activeSuggestions.length === 0) {
          ai.refreshSuggestions();
        }
      }}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all ${
        ai.panelOpen
          ? "border-[hsl(var(--kf-accent1))]/30 bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))]"
          : "border-border/50 bg-card hover:border-[hsl(var(--kf-accent1))]/20 text-muted-foreground/70 hover:text-foreground/80"
      }`}
    >
      <Brain className="w-3.5 h-3.5" />
      <span className="text-xs font-medium">AI {moduleName}</span>
      {ai.hasUrgent && !ai.panelOpen && (
        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
      )}
      {ai.activeSuggestions.length > 0 && !ai.panelOpen && (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))]">
          {ai.activeSuggestions.length}
        </span>
      )}
    </button>
  );
}
