"use client";

import { useState, useCallback, useRef } from "react";
import { Sparkles, X, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { bookingsAiSearch } from "@/lib/client";
import type { BookingsAiSearchResult } from "@/lib/client";

interface BookingsAiSearchBarProps {
  businessId: string | null;
  onResults?: (results: BookingsAiSearchResult) => void;
}

export default function BookingsAiSearchBar({ businessId, onResults }: BookingsAiSearchBarProps) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BookingsAiSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSearch = useCallback(async () => {
    if (!businessId || !query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await bookingsAiSearch(query.trim(), businessId);
      if (res.error) {
        setError(res.error);
      } else if (res.data) {
        setResult(res.data);
        onResults?.(res.data);
      }
    } catch {
      setError("Search failed. Try again.");
    } finally {
      setLoading(false);
    }
  }, [businessId, query, onResults]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSearch();
      }
      if (e.key === "Escape") {
        setQuery("");
        setResult(null);
        setError(null);
        inputRef.current?.blur();
      }
    },
    [handleSearch],
  );

  const clearSearch = useCallback(() => {
    setQuery("");
    setResult(null);
    setError(null);
    inputRef.current?.focus();
  }, []);

  return (
    <div className="relative">
      <div className="relative flex items-center">
        {loading ? (
          <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground animate-spin" />
        ) : (
          <Sparkles
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
            style={{ color: "hsl(var(--kf-accent1))" }}
          />
        )}
        <input
          ref={inputRef}
          type="text"
          placeholder={'AI Search \u2014 "show this week\'s bookings", "cancelled appointments"...'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          className="kf-input w-full pl-10 pr-20 text-sm"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {query && (
            <button onClick={clearSearch} className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-muted/50 transition-colors">
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          )}
          <button
            onClick={handleSearch}
            disabled={!query.trim() || loading}
            className="px-2 py-1 text-[10px] font-medium rounded-md transition-colors disabled:opacity-40"
            style={{
              background: "hsl(var(--kf-accent1) / 0.15)",
              color: "hsl(var(--kf-accent1))",
            }}
          >
            Search
          </button>
        </div>
      </div>

      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="text-xs text-red-400 mt-1 px-1"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="mt-2 kf-card border border-border/50 rounded-xl p-3 space-y-2"
          >
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">{result.interpretation}</p>
              <button onClick={() => setResult(null)} className="p-0.5 rounded hover:bg-muted/50">
                <X className="w-3 h-3 text-muted-foreground" />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.05] text-muted-foreground">
                {result.type}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {result.results?.length ?? 0} result{(result.results?.length ?? 0) !== 1 ? "s" : ""}
              </span>
              {result.confidence !== undefined && (
                <span className={`text-[10px] font-medium ${
                  result.confidence >= 0.7 ? "text-emerald-400" :
                  result.confidence >= 0.4 ? "text-amber-400" : "text-red-400"
                }`}>
                  {Math.round(result.confidence * 100)}% confidence
                </span>
              )}
            </div>
            {result.results && result.results.length > 0 && (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- LLM/AI tool result payload — shape varies by toolId, pending shared schema contract */}
                {result.results.slice(0, 10).map((r: any, i: number) => {
                  const contactName = r.contact
                    ? [r.contact.firstName, r.contact.lastName].filter(Boolean).join(" ") || "Walk-in"
                    : r.name || "Unknown";
                  const statusBadge: Record<string, string> = {
                    PENDING: "bg-amber-500/15 text-amber-300",
                    CONFIRMED: "bg-blue-500/15 text-blue-300",
                    COMPLETED: "bg-emerald-500/15 text-emerald-300",
                    CANCELLED: "bg-red-500/15 text-red-300",
                  };
                  return (
                    <div key={i} className="flex items-center gap-2 text-xs p-1.5 rounded-lg bg-white/[0.02] border border-border/20">
                      <span className="font-medium truncate flex-1">{contactName}</span>
                      {r.service?.name && <span className="text-muted-foreground truncate">{r.service.name}</span>}
                      {r.status && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${statusBadge[r.status] ?? "bg-slate-500/15 text-slate-300"}`}>
                          {r.status}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
