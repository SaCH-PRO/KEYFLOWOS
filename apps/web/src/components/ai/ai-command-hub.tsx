"use client";

import { useEffect, useRef, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Sparkles, X, RefreshCw, Loader2, AlertTriangle,
  Lightbulb, TrendingUp, Zap, ChevronRight, Brain,
  Shield, Clock, ChevronLeft, Search, BarChart3,
  Wand2, Radar, Settings2, ArrowRight,
  FileText, Tags, ShieldAlert, MessageSquare,
  Target, Activity, DollarSign, GitBranch, Bell,
  Terminal,
} from "lucide-react";
import type { UseModuleAiReturn, AiSuggestion, AiTool, AiToolCategory } from "@/hooks/use-module-ai";

const SUGGESTION_ICON_MAP: Record<string, typeof Sparkles> = {
  action: Zap,
  insight: Lightbulb,
  warning: AlertTriangle,
  tip: TrendingUp,
};

const PRIORITY_STYLES: Record<string, string> = {
  high: "border-l-amber-500 bg-amber-500/[0.03]",
  medium: "border-l-[hsl(var(--kf-accent1))] bg-[hsl(var(--kf-accent1))]/[0.02]",
  low: "border-l-muted-foreground/30 bg-white/[0.01]",
};

const CATEGORY_META: Record<AiToolCategory, { icon: typeof Sparkles; label: string; color: string }> = {
  analyze: { icon: BarChart3, label: "Analyze", color: "text-blue-400" },
  generate: { icon: Wand2, label: "Generate", color: "text-purple-400" },
  detect: { icon: Radar, label: "Detect", color: "text-amber-400" },
  optimize: { icon: Settings2, label: "Optimize", color: "text-emerald-400" },
  automate: { icon: Zap, label: "Automate", color: "text-cyan-400" },
};

const TOOL_ICON_MAP: Record<string, typeof Sparkles> = {
  summary: FileText,
  score: Target,
  prep: MessageSquare,
  tags: Tags,
  churn: ShieldAlert,
  analysis: BarChart3,
  notes: Lightbulb,
  generate: Wand2,
  detect: Radar,
  revenue: TrendingUp,
  calendar: Clock,
  search: Search,
  "alert-triangle": AlertTriangle,
  "trending-up": TrendingUp,
  quality: Shield,
  duplicates: Search,
  reengage: MessageSquare,
  followup: MessageSquare,
  plan: FileText,
  prioritize: Target,
  risk: ShieldAlert,
  bottleneck: Radar,
  update: MessageSquare,
  automate: Zap,
  categorize: Tags,
  anomaly: Radar,
  forecast: BarChart3,
  optimize: Settings2,
  margin: TrendingUp,
  vendor: Activity,
  cashflow: DollarSign,
  pipeline: GitBranch,
  reminder: Bell,
  pricing: DollarSign,
  overdue: AlertTriangle,
  terminal: Terminal,
  lightbulb: Lightbulb,
  sparkles: Sparkles,
  default: Sparkles,
};

function getToolIcon(iconName: string) {
  return TOOL_ICON_MAP[iconName] || TOOL_ICON_MAP.default;
}

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
  const Icon = SUGGESTION_ICON_MAP[suggestion.type] || Sparkles;

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
              className="p-1.5 rounded opacity-0 group-hover:opacity-100 hover:bg-white/10 transition-all min-w-[32px] min-h-[32px] flex items-center justify-center"
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

function ToolCard({
  tool,
  onExecute,
  disabled,
  showSelectionHint,
}: {
  tool: AiTool;
  onExecute: () => void;
  disabled: boolean;
  showSelectionHint?: boolean;
}) {
  const Icon = getToolIcon(tool.icon);
  const catMeta = CATEGORY_META[tool.category];

  return (
    <button
      onClick={onExecute}
      disabled={disabled}
      className={`w-full text-left p-3 rounded-xl border border-border/40 hover:border-[hsl(var(--kf-accent1))]/30 bg-white/[0.02] hover:bg-white/[0.04] transition-all group ${
        disabled ? "opacity-40 cursor-not-allowed" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-gradient-to-br from-[hsl(var(--kf-accent1))]/10 to-[hsl(var(--kf-accent2))]/10 group-hover:from-[hsl(var(--kf-accent1))]/20 group-hover:to-[hsl(var(--kf-accent2))]/20 transition-colors`}>
          <Icon className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-xs font-semibold text-foreground/90">{tool.name}</span>
            <ArrowRight className="w-3 h-3 text-muted-foreground/30 group-hover:text-[hsl(var(--kf-accent1))]/60 transition-colors" />
          </div>
          <p className="text-[11px] text-muted-foreground/60 leading-relaxed line-clamp-2">{tool.description}</p>
          <div className="flex items-center gap-2 mt-1.5">
            <span className={`text-[10px] font-medium ${catMeta.color}`}>{catMeta.label}</span>
            <span className="text-[10px] text-muted-foreground/40">·</span>
            <span className="text-[10px] text-muted-foreground/40">{tool.creditCost} credit{tool.creditCost !== 1 ? "s" : ""}</span>
            {tool.requiresSelection && (
              <>
                <span className="text-[10px] text-muted-foreground/40">·</span>
                <span className="text-[10px] text-muted-foreground/40">Requires selection</span>
              </>
            )}
          </div>
        </div>
      </div>
      {showSelectionHint && (
        <p className="text-[11px] text-amber-400/80 mt-1.5 ml-12">Select a contact to use this tool</p>
      )}
    </button>
  );
}

interface AiCommandHubProps {
  ai: UseModuleAiReturn;
  moduleName: string;
  onAction?: (actionKey: string) => void;
  toolResultRenderer?: (toolId: string, result: unknown) => React.ReactNode;
}

export function AiCommandHub({
  ai,
  moduleName,
  onAction,
  toolResultRenderer,
}: AiCommandHubProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (ai.panelOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
      requestAnimationFrame(() => {
        if (panelRef.current) {
          const focusable = panelRef.current.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          );
          if (focusable.length > 0) focusable[0].focus();
        }
      });
    } else {
      if (previousFocusRef.current && typeof previousFocusRef.current.focus === "function") {
        previousFocusRef.current.focus();
        previousFocusRef.current = null;
      }
    }
  }, [ai.panelOpen]);

  useEffect(() => {
    if (!ai.panelOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (ai.hubMode === "tool-result") {
          ai.clearToolResult();
        } else {
          ai.setOpen(false);
        }
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally excludes 'ai' object as a whole; including it would re-create this hook on every AI hub state change. Only the specific method invoked is referenced.
  }, [ai.panelOpen, ai.hubMode, ai.clearToolResult, ai.setOpen]);

  const handleToolExecute = useCallback((toolId: string) => {
    ai.executeTool(toolId);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally excludes 'ai' object as a whole; including it would re-create this hook on every AI hub state change. Only the specific method invoked is referenced.
  }, [ai.executeTool]);

  if (!ai.panelOpen) return null;

  const timeAgo = ai.lastRefreshed
    ? Math.round((Date.now() - ai.lastRefreshed) / 60000)
    : null;

  const toolsByCategory = ai.tools.reduce<Record<string, AiTool[]>>((acc, tool) => {
    if (!acc[tool.category]) acc[tool.category] = [];
    acc[tool.category].push(tool);
    return acc;
  }, {});

  return (
    <motion.div
      ref={panelRef}
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.97 }}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
      className="fixed right-4 bottom-20 w-[380px] max-h-[calc(100vh-140px)] rounded-2xl border border-border/50 bg-card/95 backdrop-blur-xl shadow-2xl shadow-black/40 overflow-hidden flex flex-col z-50"
    >
      <div className="px-4 py-3 border-b border-border/30 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          {ai.hubMode === "tool-result" && (
            <button
              onClick={ai.clearToolResult}
              className="p-1.5 -ml-1 rounded-lg hover:bg-white/[0.06] transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            >
              <ChevronLeft className="w-4 h-4 text-muted-foreground/70" />
            </button>
          )}
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[hsl(var(--kf-accent1))]/20 to-[hsl(var(--kf-accent2))]/20 flex items-center justify-center">
            <Brain className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
          </div>
          <div>
            <span className="text-sm font-semibold text-foreground/90">AI Hub</span>
            <span className="text-[11px] text-muted-foreground/50 ml-1.5">{moduleName}</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {ai.hubMode === "suggestions" && timeAgo !== null && (
            <span className="text-[10px] text-muted-foreground/40 flex items-center gap-0.5 mr-1">
              <Clock className="w-2.5 h-2.5" />
              {timeAgo < 1 ? "just now" : `${timeAgo}m ago`}
            </span>
          )}
          <button
            onClick={() => ai.setOpen(false)}
            className="p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
          >
            <X className="w-4 h-4 text-muted-foreground/50" />
          </button>
        </div>
      </div>

      {ai.hubMode !== "tool-result" && (
        <div className="flex border-b border-border/20 shrink-0">
          <button
            onClick={() => ai.setHubMode("tools")}
            className={`flex-1 py-2.5 text-xs font-medium transition-colors relative ${
              ai.hubMode === "tools"
                ? "text-[hsl(var(--kf-accent1))]"
                : "text-muted-foreground/60 hover:text-foreground/80"
            }`}
          >
            <div className="flex items-center justify-center gap-1.5">
              <Wand2 className="w-3.5 h-3.5" />
              Tools
              {ai.tools.length > 0 && (
                <span className="text-[10px] px-1 py-0.5 rounded-full bg-white/[0.06]">{ai.tools.length}</span>
              )}
            </div>
            {ai.hubMode === "tools" && (
              <motion.div layoutId="hub-tab" className="absolute bottom-0 inset-x-4 h-[2px] rounded-full bg-[hsl(var(--kf-accent1))]" />
            )}
          </button>
          <button
            onClick={() => {
              ai.setHubMode("suggestions");
              if (ai.activeSuggestions.length === 0 && !ai.loading) {
                ai.refreshSuggestions();
              }
            }}
            className={`flex-1 py-2.5 text-xs font-medium transition-colors relative ${
              ai.hubMode === "suggestions"
                ? "text-[hsl(var(--kf-accent1))]"
                : "text-muted-foreground/60 hover:text-foreground/80"
            }`}
          >
            <div className="flex items-center justify-center gap-1.5">
              <Lightbulb className="w-3.5 h-3.5" />
              Insights
              {ai.activeSuggestions.length > 0 && (
                <span className="text-[10px] px-1 py-0.5 rounded-full bg-amber-500/10 text-amber-400">
                  {ai.activeSuggestions.length}
                </span>
              )}
            </div>
            {ai.hubMode === "suggestions" && (
              <motion.div layoutId="hub-tab" className="absolute bottom-0 inset-x-4 h-[2px] rounded-full bg-[hsl(var(--kf-accent1))]" />
            )}
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto min-h-0">
        <AnimatePresence mode="wait">
          {ai.hubMode === "tools" && (
            <motion.div
              key="tools"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="p-3 space-y-4"
            >
              {Object.entries(toolsByCategory).map(([category, categoryTools]) => {
                const catMeta = CATEGORY_META[category as AiToolCategory];
                const CatIcon = catMeta?.icon || Sparkles;
                return (
                  <div key={category}>
                    <div className="flex items-center gap-1.5 mb-2 px-1">
                      <CatIcon className={`w-3 h-3 ${catMeta?.color || "text-muted-foreground"}`} />
                      <span className="text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wider">
                        {catMeta?.label || category}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {categoryTools.map(tool => {
                        const isDisabledBySelection = tool.requiresSelection && !ai.availableTools.some(t => t.id === tool.id);
                        return (
                          <ToolCard
                            key={tool.id}
                            tool={tool}
                            onExecute={() => handleToolExecute(tool.id)}
                            disabled={isDisabledBySelection}
                            showSelectionHint={isDisabledBySelection}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {ai.tools.length === 0 && (
                <div className="flex flex-col items-center py-8 gap-2">
                  <Wand2 className="w-5 h-5 text-muted-foreground/30" />
                  <span className="text-xs text-muted-foreground/50">No AI tools configured</span>
                </div>
              )}
            </motion.div>
          )}

          {ai.hubMode === "suggestions" && (
            <motion.div
              key="suggestions"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="p-3 space-y-2"
            >
              <div className="flex items-center justify-end mb-1">
                <button
                  onClick={ai.refreshSuggestions}
                  disabled={ai.loading}
                  className="flex items-center gap-1 text-[11px] text-muted-foreground/50 hover:text-[hsl(var(--kf-accent1))] disabled:opacity-30 transition-colors min-h-[44px] px-2"
                >
                  <RefreshCw className={`w-3 h-3 ${ai.loading ? "animate-spin" : ""}`} />
                  Refresh
                </button>
              </div>

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
                  <span className="text-xs text-muted-foreground/50">All clear — no insights right now</span>
                  <p className="text-[10px] text-muted-foreground/40 text-center max-w-[200px]">AI will analyze your {moduleName.toLowerCase()} data and surface actionable insights.</p>
                  <button
                    onClick={ai.refreshSuggestions}
                    className="text-[11px] text-[hsl(var(--kf-accent1))] hover:underline mt-1"
                  >
                    Run analysis
                  </button>
                </div>
              )}
            </motion.div>
          )}

          {ai.hubMode === "tool-result" && (
            <motion.div
              key="tool-result"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="p-3"
            >
              {ai.activeTool && (
                <div className="flex items-center gap-2 mb-3 pb-2 border-b border-border/20">
                  {(() => { const I = getToolIcon(ai.activeTool.icon); return <I className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />; })()}
                  <span className="text-xs font-semibold text-foreground/90">{ai.activeTool.name}</span>
                </div>
              )}

              {ai.toolLoading && (
                <div className="flex items-center justify-center py-10">
                  <div className="flex flex-col items-center gap-3">
                    <div className="relative">
                      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[hsl(var(--kf-accent1))]/20 to-[hsl(var(--kf-accent2))]/20 flex items-center justify-center">
                        <Loader2 className="w-5 h-5 text-[hsl(var(--kf-accent1))] animate-spin" />
                      </div>
                      <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-[hsl(var(--kf-accent1))] animate-pulse" />
                    </div>
                    <span className="text-xs text-muted-foreground/60">Processing...</span>
                  </div>
                </div>
              )}

              {ai.toolError && (
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-red-500/5 border border-red-500/20">
                  <Shield className="w-4 h-4 text-red-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs text-red-400">{ai.toolError}</span>
                  </div>
                </div>
              )}

              {!ai.toolLoading && !ai.toolError && !!ai.toolResult && ai.activeTool && (
                <div>
                  {toolResultRenderer && ai.activeToolId
                    ? (toolResultRenderer(ai.activeToolId, ai.toolResult) as React.ReactNode)
                    : (
                      <div className="rounded-xl border border-border/40 p-3 bg-white/[0.02]">
                        <pre className="text-[11px] text-muted-foreground/70 whitespace-pre-wrap overflow-auto max-h-[300px]">
                          {JSON.stringify(ai.toolResult, null, 2)}
                        </pre>
                      </div>
                    )
                  }
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="px-4 py-2.5 border-t border-border/20 shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground/40 flex items-center gap-1">
            <Activity className="w-2.5 h-2.5" />
            {ai.tools.length} tool{ai.tools.length !== 1 ? "s" : ""} · {ai.activeSuggestions.length} insight{ai.activeSuggestions.length !== 1 ? "s" : ""}
          </span>
          <span className="text-[10px] text-muted-foreground/30">
            Esc to close
          </span>
        </div>
      </div>
    </motion.div>
  );
}

export function AiHubTrigger({
  ai,
  moduleName,
}: {
  ai: UseModuleAiReturn;
  moduleName: string;
}) {
  const totalBadge = ai.activeSuggestions.length;

  return (
    <button
      onClick={() => {
        ai.togglePanel();
        if (!ai.panelOpen && ai.activeSuggestions.length === 0 && ai.tools.length === 0) {
          ai.refreshSuggestions();
        }
      }}
      className={`fixed right-4 bottom-4 z-50 flex items-center gap-2 pl-3.5 pr-4 py-2.5 rounded-2xl border shadow-lg shadow-black/30 transition-all ${
        ai.panelOpen
          ? "border-[hsl(var(--kf-accent1))]/40 bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] shadow-[hsl(var(--kf-accent1))]/10"
          : "border-border/50 bg-card/90 backdrop-blur-xl hover:border-[hsl(var(--kf-accent1))]/30 text-foreground/80 hover:text-foreground hover:shadow-xl"
      }`}
    >
      <div className="relative">
        <Brain className="w-5 h-5" />
        {ai.hasUrgent && !ai.panelOpen && (
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse ring-2 ring-card" />
        )}
      </div>
      <span className="text-sm font-medium">AI {moduleName}</span>
      {totalBadge > 0 && !ai.panelOpen && (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] font-semibold">
          {totalBadge}
        </span>
      )}
    </button>
  );
}
