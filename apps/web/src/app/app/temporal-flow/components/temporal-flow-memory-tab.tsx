"use client";

import { useEffect, useState } from "react";
import { Search, RefreshCw, Brain, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TemporalFlowMemory,
  getTemporalFlowMemory,
  searchTemporalFlowMemory,
  compactTemporalFlowMemory,
  detectTemporalFlowPatterns,
} from "@/lib/api/temporal-flow";
import { getStoredBusinessId } from "@/lib/workspace";

export function TemporalFlowMemoryTab() {
  const businessId = getStoredBusinessId() ?? "";
  const [memory, setMemory] = useState<TemporalFlowMemory[]>([]);
  const [searchResults, setSearchResults] = useState<
    Array<{ id: string; content: string; similarity: number }>
  >([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [actioning, setActioning] = useState<string | null>(null);

  const fetchMemory = async () => {
    if (!businessId) return;
    setLoading(true);
    const { data } = await getTemporalFlowMemory(businessId, { limit: 50 });
    setMemory(data ?? []);
    setLoading(false);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId || !query.trim()) return;
    setLoading(true);
    const { data } = await searchTemporalFlowMemory(businessId, query.trim());
    setSearchResults(
      (data ?? []).map((r) => ({
        id: r.id,
        content: r.content,
        similarity: r.similarity,
      })),
    );
    setLoading(false);
  };

  const handleCompact = async () => {
    if (!businessId) return;
    setActioning("compact");
    await compactTemporalFlowMemory(businessId);
    setActioning(null);
    await fetchMemory();
  };

  const handleDetectPatterns = async () => {
    if (!businessId) return;
    setActioning("patterns");
    await detectTemporalFlowPatterns(businessId);
    setActioning(null);
  };

  useEffect(() => {
    fetchMemory();
  }, [businessId]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between">
        <form onSubmit={handleSearch} className="flex items-center gap-2 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search operational memory..."
              className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !query.trim()}
            className="px-3 py-2 rounded-lg text-xs font-semibold bg-primary text-primary-foreground disabled:opacity-50"
          >
            Search
          </button>
        </form>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCompact}
            disabled={actioning === "compact"}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-border hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", actioning === "compact" && "animate-spin")} />
            Compact
          </button>
          <button
            onClick={handleDetectPatterns}
            disabled={actioning === "patterns"}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-border hover:bg-muted disabled:opacity-50"
          >
            <Zap className="w-3.5 h-3.5" />
            Detect patterns
          </button>
        </div>
      </div>

      {query && searchResults.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Semantic recall
          </h4>
          {searchResults.map((result) => (
            <div
              key={result.id}
              className="rounded-xl border border-border bg-card p-3 text-sm"
            >
              <p>{result.content}</p>
              <p className="text-xs text-muted-foreground mt-1">
                similarity {(result.similarity * 100).toFixed(0)}%
              </p>
            </div>
          ))}
        </div>
      )}

      {loading && memory.length === 0 ? (
        <div className="text-sm text-muted-foreground">Loading memory...</div>
      ) : memory.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          <Brain className="w-8 h-8 mx-auto mb-2 opacity-50" />
          No operational memory yet. Memory is built automatically as KEYInbox events flow in.
        </div>
      ) : (
        <div className="grid gap-3">
          {memory.map((item) => (
            <div
              key={item.id}
              className="rounded-xl border border-border bg-card p-4 shadow-sm"
            >
              <div className="flex items-center justify-between gap-3 mb-1">
                <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                  {item.entityType}
                  {item.entityId ? ` · ${item.entityId.slice(0, 8)}` : ""}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(item.updatedAt).toLocaleDateString()}
                </span>
              </div>
              <p className="text-sm leading-relaxed">{item.content}</p>
              <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                <span>type: {item.type}</span>
                <span>confidence: {Math.round(item.confidence * 100)}%</span>
                <span>sources: {item.sourceEventIds.length}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
