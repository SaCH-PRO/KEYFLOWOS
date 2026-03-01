"use client";

import { useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import {
  Sparkles, Search, X, Loader2, User, Building2,
  Tag, ArrowRight, Brain,
} from "lucide-react";
import { aiNaturalLanguageSearch, type AiSearchResult } from "@/lib/client";

interface AiSearchBarProps {
  onSelectContact?: (contactId: string) => void;
  onApplyFilters?: (filters: Record<string, unknown>) => void;
}

const EXAMPLE_QUERIES = [
  "Show me clients who haven't been active in 30 days",
  "Find leads from this week",
  "Who has unpaid invoices?",
  "High-scoring prospects ready to convert",
];

export function AiSearchBar({ onSelectContact, onApplyFilters }: AiSearchBarProps) {
  const [query, setQuery] = useState("");
  const [data, setData] = useState<AiSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const search = useCallback(async (searchQuery?: string) => {
    const q = (searchQuery ?? query).trim();
    if (!q) return;
    setLoading(true);
    try {
      const result = await aiNaturalLanguageSearch(q);
      if (result.data) {
        setData(result.data);
      } else {
        toast.error(result.error ?? "Search failed");
      }
    } catch {
      toast.error("AI search failed");
    } finally {
      setLoading(false);
    }
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      search();
    }
    if (e.key === "Escape") {
      clear();
    }
  };

  const clear = () => {
    setQuery("");
    setData(null);
    setFocused(false);
  };

  const handleExampleClick = (example: string) => {
    setQuery(example);
    search(example);
  };

  const contactName = (c: AiSearchResult["contacts"][0]) => {
    const name = `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim();
    return name || c.email || "Unnamed";
  };

  return (
    <div className="relative">
      <div className={`flex items-center gap-2 rounded-xl border ${focused ? 'border-[hsl(var(--kf-accent1))]/40 bg-[hsl(var(--kf-accent1))]/[0.03]' : 'border-border/50 bg-card'} px-3 py-2 transition-colors`}>
        {loading ? (
          <Loader2 className="w-4 h-4 text-[hsl(var(--kf-accent1))] animate-spin shrink-0" />
        ) : (
          <Brain className="w-4 h-4 text-[hsl(var(--kf-accent1))]/70 shrink-0" />
        )}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 200)}
          placeholder="Ask AI: &quot;Find clients in Port of Spain&quot; or &quot;Who needs follow-up?&quot;"
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none"
        />
        {query && (
          <button onClick={clear} className="p-0.5 rounded hover:bg-white/10">
            <X className="w-3.5 h-3.5 text-muted-foreground/50" />
          </button>
        )}
        <button
          onClick={() => search()}
          disabled={!query.trim() || loading}
          className="p-1 rounded-lg bg-[hsl(var(--kf-accent1))]/10 hover:bg-[hsl(var(--kf-accent1))]/20 disabled:opacity-30 transition-colors"
        >
          <Search className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
        </button>
      </div>

      {focused && !data && !loading && !query && (
        <div className="absolute top-full left-0 right-0 mt-1 rounded-xl border border-border/50 bg-card p-3 shadow-xl z-50">
          <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider mb-2 block">Try asking</span>
          <div className="space-y-1">
            {EXAMPLE_QUERIES.map((ex, i) => (
              <button
                key={i}
                onClick={() => handleExampleClick(ex)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors text-left"
              >
                <Sparkles className="w-3 h-3 text-[hsl(var(--kf-accent1))]/50 shrink-0" />
                <span className="text-xs text-foreground/70">{ex}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {data && (
        <div className="absolute top-full left-0 right-0 mt-1 rounded-xl border border-border/50 bg-card shadow-xl z-50 max-h-[400px] overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b border-border/30 shrink-0">
            <div className="flex items-center justify-between">
              <span className="text-xs text-foreground/80">{data.interpretation}</span>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground/50">{data.totalResults} results</span>
                {onApplyFilters && Object.keys(data.filters).length > 0 && (
                  <button
                    onClick={() => { onApplyFilters(data.filters); clear(); }}
                    className="text-[10px] font-medium text-[hsl(var(--kf-accent1))] hover:underline"
                  >
                    Apply filters
                  </button>
                )}
                <button onClick={clear} className="p-0.5 rounded hover:bg-white/10">
                  <X className="w-3 h-3 text-muted-foreground/50" />
                </button>
              </div>
            </div>
            {data.confidence < 0.7 && (
              <span className="text-[10px] text-amber-400/70 block mt-0.5">Low confidence — try rephrasing your question</span>
            )}
          </div>

          <div className="overflow-y-auto flex-1">
            {data.contacts.length === 0 ? (
              <div className="p-6 text-center">
                <span className="text-sm text-muted-foreground/60">No contacts match this query</span>
              </div>
            ) : (
              <div className="p-1.5 space-y-0.5">
                {data.contacts.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => { onSelectContact?.(c.id); clear(); }}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-white/[0.04] transition-colors text-left group"
                  >
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[hsl(var(--kf-accent1))]/20 to-[hsl(var(--kf-accent2))]/20 flex items-center justify-center shrink-0">
                      <User className="w-4 h-4 text-foreground/50" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-foreground/90 truncate">{contactName(c)}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                          c.status === 'CLIENT' ? 'bg-emerald-500/10 text-emerald-400' :
                          c.status === 'PROSPECT' ? 'bg-blue-500/10 text-blue-400' :
                          c.status === 'LEAD' ? 'bg-purple-500/10 text-purple-400' :
                          'bg-muted text-muted-foreground'
                        }`}>
                          {c.status}
                        </span>
                        {c.leadScore != null && (
                          <span className="text-[9px] text-muted-foreground/60">Score: {c.leadScore}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60">
                        {c.companyName && (
                          <span className="flex items-center gap-0.5 truncate">
                            <Building2 className="w-2.5 h-2.5" /> {c.companyName}
                          </span>
                        )}
                        {c.email && <span className="truncate">{c.email}</span>}
                      </div>
                      {c.tags.length > 0 && (
                        <div className="flex gap-1 mt-0.5">
                          {c.tags.slice(0, 3).map((tag, ti) => (
                            <span key={ti} className="text-[9px] px-1 py-0.5 rounded bg-white/5 text-muted-foreground/60">
                              <Tag className="w-2 h-2 inline mr-0.5" />{tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/30 group-hover:text-[hsl(var(--kf-accent1))] transition-colors shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
