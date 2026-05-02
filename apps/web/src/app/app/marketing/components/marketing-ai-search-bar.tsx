"use client";

import { useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import {
  Sparkles,
  Search,
  X,
  Loader2,
  Brain,
  Zap,
  ArrowRight,
  Mail,
  ClipboardList,
  BarChart3,
  CheckCircle2,
  AlertTriangle,
  Play,
} from "lucide-react";
import { marketingAiSearch, type MarketingAiSearchResult } from "@/lib/client";

interface MarketingAiSearchBarProps {
  businessId: string | null;
  onResults?: (results: MarketingAiSearchResult) => void;

  onApplyFilters?: (filters: Record<string, unknown>) => void;
}

const EXAMPLE_QUERIES = [
  "Show sent campaigns",
  "Forms with most submissions",
  "Draft campaigns from last month",
  "Campaigns with low open rates",
  "Active lead forms",
  "Show all scheduled campaigns",
];

const COMMAND_EXAMPLES = [
  "Create a new campaign for leads",
  "Activate all inactive forms",
  "Draft a follow-up campaign",
];

const RESULT_TYPE_ICONS: Record<string, typeof Mail> = {
  campaigns: Mail,
  forms: ClipboardList,
  campaign: Mail,
  form: ClipboardList,
};

const RESULT_TYPE_COLORS: Record<string, string> = {
  campaigns: "bg-blue-500/10 text-blue-400",
  forms: "bg-emerald-500/10 text-emerald-400",
  campaign: "bg-blue-500/10 text-blue-400",
  form: "bg-emerald-500/10 text-emerald-400",
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  SENT: "bg-blue-500/10 text-blue-400",
  SCHEDULED: "bg-amber-500/10 text-amber-400",
  ACTIVE: "bg-emerald-500/10 text-emerald-400",
  INACTIVE: "bg-muted text-muted-foreground",
};

const ACTION_ICONS: Record<string, typeof Zap> = {
  create_campaign: Mail,
  activate_forms: CheckCircle2,
  draft_campaign: Mail,
  default: Zap,
};

interface ActionData {
  action: string;
  description?: string;
  confirmation?: string;
  confidence?: number;

  params?: Record<string, unknown>;
}

function MarketingAiSearchBarInner({ businessId, onResults, onApplyFilters }: MarketingAiSearchBarProps) {
  const [query, setQuery] = useState("");
  const [searchData, setSearchData] = useState<MarketingAiSearchResult | null>(null);
  const [actionData, setActionData] = useState<ActionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processInput = useCallback(async (searchQuery?: string) => {
    const q = (searchQuery ?? query).trim();
    if (!q || !businessId) return;
    setLoading(true);
    setSearchData(null);
    setActionData(null);

    try {
      const result = await marketingAiSearch(q, businessId);
      if (result.data) {

        const data = result.data as unknown as Record<string, unknown>;
        if (data.action && typeof data.action === "string") {
          setActionData({
            action: data.action as string,
            description: (data.description as string) || (data.confirmation as string) || q,
            confirmation: (data.confirmation as string) || `Execute: ${data.action}`,
            confidence: (data.confidence as number) ?? 0.8,

            params: (data.params as Record<string, unknown>) ?? {},
          });
        } else {
          setSearchData(result.data);
          onResults?.(result.data);
        }
      } else {
        toast.error(result.error ?? "Search failed");
      }
    } catch {
      toast.error("AI processing failed");
    } finally {
      setLoading(false);
    }
  }, [query, businessId, onResults]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      processInput();
    }
    if (e.key === "Escape") {
      clear();
    }
  };

  const clear = () => {
    setQuery("");
    setSearchData(null);
    setActionData(null);
    setFocused(false);
  };

  const handleExampleClick = (example: string) => {
    setQuery(example);
    processInput(example);
  };

  const handleRunAction = useCallback(() => {
    if (!actionData) return;
    toast.success(`Action "${actionData.action}" triggered`);
    clear();
  }, [actionData]);

  const ActionIcon = actionData ? (ACTION_ICONS[actionData.action] ?? ACTION_ICONS.default) : Zap;

  return (
    <div className="relative">
      <div className={`flex items-center gap-2 rounded-xl border ${focused ? "border-[hsl(var(--kf-accent1))]/40 bg-[hsl(var(--kf-accent1))]/[0.03]" : "border-border/50 bg-card"} px-3 py-2 transition-colors`}>
        {loading ? (
          <Loader2 className="w-4 h-4 text-[hsl(var(--kf-accent1))] animate-spin shrink-0" />
        ) : (
          <Brain className="w-4 h-4 text-[hsl(var(--kf-accent1))]/70 shrink-0" />
        )}
        <input
          ref={inputRef}
          data-marketing-ai-search
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 300)}
          placeholder='AI Marketing: "Show sent campaigns", "Create a new campaign for leads"'
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none"
          aria-label="AI marketing search"
        />
        {query && (
          <button onClick={clear} className="p-0.5 rounded hover:bg-muted/50" aria-label="Clear search">
            <X className="w-3.5 h-3.5 text-muted-foreground/50" />
          </button>
        )}
        <button
          onClick={() => processInput()}
          disabled={!query.trim() || loading}
          className="p-1 rounded-lg bg-[hsl(var(--kf-accent1))]/10 hover:bg-[hsl(var(--kf-accent1))]/20 disabled:opacity-30 transition-colors"
          aria-label="Search"
        >
          <Search className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
        </button>
      </div>

      {focused && !searchData && !actionData && !loading && !query && (
        <div className="absolute top-full left-0 right-0 mt-1 rounded-xl border border-border/50 bg-card p-3 shadow-xl z-50">
          <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider mb-2 block">Try saying</span>
          <div className="space-y-1">
            {EXAMPLE_QUERIES.map((ex, i) => (
              <button
                key={i}
                onClick={() => handleExampleClick(ex)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-muted/30 transition-colors text-left"
              >
                {i < 2 ? (
                  <Search className="w-3 h-3 text-[hsl(var(--kf-accent2))]/60 shrink-0" />
                ) : i < 4 ? (
                  <Zap className="w-3 h-3 text-[hsl(var(--kf-accent2))]/60 shrink-0" />
                ) : (
                  <Sparkles className="w-3 h-3 text-[hsl(var(--kf-accent1))]/50 shrink-0" />
                )}
                <span className="text-xs text-foreground/70">{ex}</span>
              </button>
            ))}
          </div>
          <div className="mt-2 pt-2 border-t border-border/20">
            <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider mb-2 block">Commands</span>
            <div className="space-y-1">
              {COMMAND_EXAMPLES.map((ex, i) => (
                <button
                  key={`cmd-${i}`}
                  onClick={() => handleExampleClick(ex)}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-muted/30 transition-colors text-left"
                >
                  <Zap className="w-3 h-3 text-[hsl(var(--kf-accent1))]/60 shrink-0" />
                  <span className="text-xs text-foreground/70">{ex}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="mt-2 pt-2 border-t border-border/20">
            <span className="text-[10px] text-muted-foreground/50">
              Search campaigns and lead forms or give commands using natural language
            </span>
          </div>
        </div>
      )}

      {searchData && (() => {
        const results = searchData.results || [];
        return (
          <div className="absolute top-full left-0 right-0 mt-1 rounded-xl border border-border/50 bg-card shadow-xl z-50 max-h-[400px] overflow-hidden flex flex-col">
            <div className="px-3 py-2 border-b border-border/30 shrink-0">
              <div className="flex items-center justify-between">
                <span className="text-xs text-foreground/80">{searchData.interpretation}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground/50">{results.length} results</span>
                  {searchData.confidence > 0 && (
                    <span className="text-[10px] text-muted-foreground/40">{Math.round(searchData.confidence * 100)}%</span>
                  )}
                  {onApplyFilters && Object.keys(searchData.filters || {}).length > 0 && (
                    <button
                      onClick={() => { onApplyFilters(searchData.filters); clear(); }}
                      className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/20 transition-colors"
                    >
                      Apply Filters
                    </button>
                  )}
                  <button onClick={clear} className="p-0.5 rounded hover:bg-muted/50" aria-label="Close results">
                    <X className="w-3 h-3 text-muted-foreground/50" />
                  </button>
                </div>
              </div>
            </div>

            <div className="overflow-y-auto flex-1">
              {results.length === 0 ? (
                <div className="p-6 text-center">
                  <span className="text-sm text-muted-foreground/60">No results match this query</span>
                </div>
              ) : (
                <div className="p-1.5 space-y-0.5">
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- LLM/AI tool result payload — shape varies by toolId, pending shared schema contract */}
                  {results.map((r: Record<string, any>, i: number) => {
                    const name = r.name || r.subject || "Untitled";
                    const status = r.status || (r.isActive !== undefined ? (r.isActive ? "ACTIVE" : "INACTIVE") : undefined);
                    const TypeIcon = RESULT_TYPE_ICONS[searchData.type] ?? BarChart3;
                    const typeColor = RESULT_TYPE_COLORS[searchData.type] ?? "bg-muted text-muted-foreground";
                    const statusColor = STATUS_COLORS[status ?? ""] ?? "bg-muted text-muted-foreground";

                    return (
                      <button
                        key={r.id || i}
                        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-muted/30 transition-colors text-left group"
                      >
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[hsl(var(--kf-accent1))]/20 to-[hsl(var(--kf-accent2))]/20 flex items-center justify-center shrink-0">
                          <TypeIcon className="w-4 h-4 text-foreground/50" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-medium text-foreground/90 truncate">{name}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${typeColor}`}>
                              {searchData.type}
                            </span>
                            {status && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${statusColor}`}>
                                {status}
                              </span>
                            )}
                          </div>
                          {r.createdAt && (
                            <span className="text-[10px] text-muted-foreground/60">
                              {new Date(r.createdAt).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                        <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/30 group-hover:text-[hsl(var(--kf-accent1))] transition-colors shrink-0" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {actionData && (
        <div className="absolute top-full left-0 right-0 mt-1 rounded-xl border border-[hsl(var(--kf-accent2))]/30 bg-card shadow-xl z-50 overflow-hidden">
          <div className="p-3 space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[hsl(var(--kf-accent1))]/20 to-[hsl(var(--kf-accent2))]/20 flex items-center justify-center shrink-0">
                <ActionIcon className="w-4.5 h-4.5 text-[hsl(var(--kf-accent1))]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-semibold text-foreground/90">AI Marketing Action</span>
                  {actionData.confidence != null && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                      actionData.confidence >= 0.8
                        ? "bg-emerald-500/10 text-emerald-400"
                        : actionData.confidence >= 0.6
                        ? "bg-amber-500/10 text-amber-400"
                        : "bg-red-500/10 text-red-400"
                    }`}>
                      {Math.round(actionData.confidence * 100)}% confident
                    </span>
                  )}
                </div>
                <p className="text-sm text-foreground/80 leading-relaxed">{actionData.description || actionData.confirmation}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 ml-12">
              <button
                onClick={handleRunAction}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[hsl(var(--kf-accent1))]/15 hover:bg-[hsl(var(--kf-accent1))]/25 text-[hsl(var(--kf-accent1))] text-xs font-medium transition-colors"
              >
                <Play className="w-3.5 h-3.5" />
                Run
              </button>
              <button
                onClick={clear}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-muted/30 text-muted-foreground/70 text-xs transition-colors"
              >
                Cancel
              </button>
              {actionData.confidence != null && actionData.confidence < 0.7 && (
                <span className="flex items-center gap-1 text-[10px] text-amber-400/70 ml-auto">
                  <AlertTriangle className="w-3 h-3" />
                  Low confidence — verify action
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export const MarketingAiSearchBar = MarketingAiSearchBarInner;
