"use client";

import { useState } from "react";
import { Filter, RefreshCw, Loader2, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui-v2/button";
import type { CommandItem } from "@/lib/api/command";
import { CommandCardV2 } from "./command-card-v2";

interface CommandQueueProps {
  items: CommandItem[];
  total: number;
  loading?: boolean;
  onRefresh?: () => void;
  selectedIds?: Set<string>;
  onSelect?: (id: string, selected: boolean) => void;
  onDismiss?: (id: string) => Promise<void>;
  onApprove?: (id: string) => Promise<void>;
  onExecute?: (id: string) => Promise<void>;
  onComplete?: (id: string) => Promise<void>;
  onAssign?: (id: string) => Promise<void>;
  onSnooze?: (id: string) => Promise<void>;
  onReopen?: (id: string) => Promise<void>;
}

const CATEGORIES = [
  "ALL",
  "MONEY",
  "TIME",
  "PEOPLE",
  "WORK",
  "SALES",
  "MARKETING",
  "GOVERNANCE",
  "STRATEGY",
  "SYSTEM",
];
const STATUSES = [
  "ALL",
  "OPEN",
  "IN_PROGRESS",
  "WAITING_APPROVAL",
  "SNOOZED",
  "COMPLETED",
  "DISMISSED",
];

export function CommandQueueV2({
  items,
  total,
  loading,
  onRefresh,
  selectedIds,
  onSelect,
  onDismiss,
  onApprove,
  onExecute,
  onComplete,
  onAssign,
  onSnooze,
  onReopen,
}: CommandQueueProps) {
  const [filter, setFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const filtered = items
    .filter((i) => (filter === "ALL" ? true : i.category === filter))
    .filter((i) => (statusFilter === "ALL" ? true : i.status === statusFilter));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="space-y-2">
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <Filter className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setFilter(cat)}
                className={cn(
                  "px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide transition-colors whitespace-nowrap",
                  filter === cat
                    ? "bg-foreground text-background"
                    : "bg-surface-muted text-muted-foreground hover:bg-muted",
                )}
              >
                {cat === "ALL" ? `All (${total})` : cat}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {STATUSES.map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={cn(
                  "px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide transition-colors whitespace-nowrap",
                  statusFilter === status
                    ? "bg-mint/15 text-mint"
                    : "bg-surface-muted text-muted-foreground hover:bg-muted",
                )}
              >
                {status === "ALL" ? "Any status" : status.toLowerCase().replace("_", " ")}
              </button>
            ))}
          </div>
        </div>
        {onRefresh && (
          <Button
            onClick={onRefresh}
            isLoading={loading}
            disabled={loading}
            variant="ghost"
            className="h-8 px-2 text-xs text-primary"
            leftIcon={loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          >
            Refresh
          </Button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No command items"
          description={
            filter === "ALL" && statusFilter === "ALL"
              ? "Your queue is clear. Great work!"
              : "No items match the current filters."
          }
          actionLabel={onRefresh ? "Refresh queue" : undefined}
          actionIcon={RefreshCw}
          onAction={onRefresh}
          secondaryAction={
            filter !== "ALL" || statusFilter !== "ALL"
              ? {
                  label: "Clear filters",
                  onClick: () => {
                    setFilter("ALL");
                    setStatusFilter("ALL");
                  },
                }
              : undefined
          }
          variant="inline"
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((item) => (
            <CommandCardV2
              key={item.id}
              item={item}
              selected={selectedIds?.has(item.id)}
              onSelect={onSelect}
              onDismiss={onDismiss}
              onApprove={onApprove}
              onExecute={onExecute}
              onComplete={onComplete}
              onAssign={onAssign}
              onSnooze={onSnooze}
              onReopen={onReopen}
            />
          ))}
        </div>
      )}
    </div>
  );
}
