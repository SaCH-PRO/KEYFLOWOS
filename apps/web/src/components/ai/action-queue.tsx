"use client";

import { useState, useEffect, useCallback } from "react";
import { AnimatePresence } from "framer-motion";
import {
  Loader2, RefreshCw, Inbox,
} from "lucide-react";
import { toast } from "sonner";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  fetchAiPendingApprovals,
  resolveAiApproval,
  type AiApprovalItem,
} from "@/lib/client";
import { VerificationCard } from "./verification-card";

type QueueFilter = "all" | "pending" | "resolved";

interface ActionQueueProps {
  compact?: boolean;
  maxItems?: number;
  showFilters?: boolean;
  onCountChange?: (count: number) => void;
}

export function ActionQueue({ compact = false, maxItems, showFilters = true, onCountChange }: ActionQueueProps) {
  const [items, setItems] = useState<AiApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<string | null>(null);
  const [filter, setFilter] = useState<QueueFilter>("pending");

  const loadItems = useCallback(async () => {
    const businessId = getStoredBusinessId();
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    const res = await fetchAiPendingApprovals(businessId);
    if (res.data) {
      setItems(res.data);
      const pendingCount = res.data.filter(i => i.status === "pending").length;
      onCountChange?.(pendingCount);
    } else if (res.error) {
      toast.error(res.error);
    }
    setLoading(false);
  }, [onCountChange]);

  useEffect(() => { loadItems(); }, [loadItems]);

  const handleResolve = useCallback(async (approvalId: string, resolution: 'approved' | 'rejected' | 'deferred') => {
    const businessId = getStoredBusinessId();
    if (!businessId) return;
    setResolving(approvalId);
    const res = await resolveAiApproval(businessId, approvalId, resolution);
    if (res.data) {
      setItems(prev => prev.map(i => i.id === approvalId ? { ...i, status: resolution, resolution, resolvedAt: new Date().toISOString() } : i));
      toast.success(`Action ${resolution}`);
      const remaining = items.filter(i => i.id !== approvalId && i.status === "pending").length;
      onCountChange?.(remaining);
    } else {
      toast.error(res.error || "Failed to resolve");
    }
    setResolving(null);
  }, [items, onCountChange]);

  const filtered = items.filter(item => {
    if (filter === "pending") return item.status === "pending";
    if (filter === "resolved") return item.status !== "pending";
    return true;
  });

  const displayed = maxItems ? filtered.slice(0, maxItems) : filtered;
  const pendingCount = items.filter(i => i.status === "pending").length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 text-[hsl(var(--kf-accent1))] animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {showFilters && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-muted/30 border border-border/30">
            {(["pending", "resolved", "all"] as QueueFilter[]).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  filter === f
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground/60 hover:text-foreground/80"
                }`}
              >
                {f === "pending" ? `Pending (${pendingCount})` : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          <button
            onClick={loadItems}
            disabled={loading}
            className="p-2 rounded-lg text-muted-foreground/50 hover:text-foreground/70 hover:bg-muted/30 transition-colors"
            aria-label="Refresh queue"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      )}

      <AnimatePresence mode="popLayout">
        {displayed.map(item => (
          <VerificationCard
            key={item.id}
            item={item}
            onApprove={(id) => handleResolve(id, "approved")}
            onReject={(id) => handleResolve(id, "rejected")}
            onDefer={(id) => handleResolve(id, "deferred")}
            loading={resolving === item.id}
          />
        ))}
      </AnimatePresence>

      {displayed.length === 0 && (
        <div className="flex flex-col items-center py-8 gap-2">
          <Inbox className="w-6 h-6 text-muted-foreground/30" />
          <span className="text-xs text-muted-foreground/50">
            {filter === "pending" ? "No pending actions" : "No actions found"}
          </span>
          <p className="text-[10px] text-muted-foreground/40 text-center max-w-[200px]">
            Actions requiring your review will appear here
          </p>
        </div>
      )}

      {maxItems && filtered.length > maxItems && (
        <p className="text-[10px] text-center text-muted-foreground/40">
          +{filtered.length - maxItems} more items
        </p>
      )}
    </div>
  );
}
