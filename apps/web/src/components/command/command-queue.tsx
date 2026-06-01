"use client";

import { useState } from "react";
import { Filter, RefreshCw, Loader2 } from "lucide-react";
import type { CommandItem } from "@/lib/api/command";
import { CommandCard } from "./command-card";

interface CommandQueueProps {
  items: CommandItem[];
  total: number;
  loading?: boolean;
  onRefresh?: () => void;
  onDismiss?: (id: string) => Promise<void>;
  onApprove?: (id: string) => Promise<void>;
  onExecute?: (id: string) => Promise<void>;
}

const CATEGORIES = ["ALL", "MONEY", "TIME", "PEOPLE", "WORK", "SALES", "MARKETING", "GOVERNANCE", "STRATEGY", "SYSTEM"];

export function CommandQueue({ items, total, loading, onRefresh, onDismiss, onApprove, onExecute }: CommandQueueProps) {
  const [filter, setFilter] = useState("ALL");

  const filtered = filter === "ALL" ? items : items.filter((i) => i.category === filter);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <Filter className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "hsl(var(--kf-muted-foreground))" }} />
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              className={`px-2 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                filter === cat
                  ? "bg-foreground text-background"
                  : "hover:bg-muted"
              }`}
            >
              {cat === "ALL" ? `All (${total})` : cat}
            </button>
          ))}
        </div>
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-1 kf-text-micro font-medium transition-colors disabled:opacity-50"
            style={{ color: "hsl(var(--kf-accent1))" }}
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Refresh
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-8">
          <p className="kf-text-body font-medium">No command items</p>
          <p className="kf-text-caption mt-1" style={{ color: "hsl(var(--kf-muted-foreground))" }}>
            {filter === "ALL" ? "Your queue is clear. Great work!" : `No items in ${filter} category.`}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((item) => (
            <CommandCard
              key={item.id}
              item={item}
              onDismiss={onDismiss}
              onApprove={onApprove}
              onExecute={onExecute}
            />
          ))}
        </div>
      )}
    </div>
  );
}
