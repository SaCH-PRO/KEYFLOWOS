"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { AnimatePresence } from "framer-motion";
import {
  Loader2,
  RefreshCw,
  Inbox,
  CheckCircle2,
  Clock,
  AlertTriangle,
  FileText,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  fetchAiPendingApprovals,
  fetchAiApprovalHistory,
  resolveAiApproval,
  resolveAiApprovalsBatch,
  sendStaleQuoteFollowUp,
  type AiApprovalItem,
} from "@/lib/client";
import { VerificationCard } from "./verification-card";

type QueueView = "waiting" | "handled" | "all";

interface QueueCategory {
  id: string;
  label: string;
  icon: typeof AlertTriangle;
  color: string;
  filter: (item: AiApprovalItem) => boolean;
}

const QUEUE_CATEGORIES: QueueCategory[] = [
  {
    id: "urgent",
    label: "Urgent / High Risk",
    icon: AlertTriangle,
    color: "text-red-400",
    filter: (item) => item.riskTier >= 3 && item.status === "pending",
  },
  {
    id: "approvals",
    label: "Pending Approvals",
    icon: Clock,
    color: "text-amber-400",
    filter: (item) => item.riskTier < 3 && item.status === "pending",
  },
  {
    id: "deferred",
    label: "Deferred",
    icon: FileText,
    color: "text-blue-400",
    filter: (item) => item.resolution === "deferred",
  },
];

interface ActionQueueProps {
  maxItems?: number;
  showFilters?: boolean;
  onCountChange?: (count: number) => void;
}

export function ActionQueue({ maxItems, showFilters = true, onCountChange }: ActionQueueProps) {
  const [pendingItems, setPendingItems] = useState<AiApprovalItem[]>([]);
  const [handledItems, setHandledItems] = useState<AiApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<string | null>(null);
  const [view, setView] = useState<QueueView>("waiting");

  const loadItems = useCallback(async () => {
    const businessId = getStoredBusinessId();
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [pendingRes, historyRes] = await Promise.all([
        fetchAiPendingApprovals(businessId),
        fetchAiApprovalHistory(businessId, 20),
      ]);
      if (pendingRes.data) {
        setPendingItems(pendingRes.data);
        const pendingCount = pendingRes.data.filter(i => i.status === "pending").length;
        onCountChange?.(pendingCount);
      } else if (pendingRes.error) {
        toast.error(pendingRes.error);
      }
      if (historyRes.data) {
        setHandledItems(historyRes.data.filter(i => i.status !== "pending"));
      }
    } catch {
      toast.error("Failed to load action queue");
    } finally {
      setLoading(false);
    }
  }, [onCountChange]);

  useEffect(() => { loadItems(); }, [loadItems]);

  const handleResolve = useCallback(async (approvalId: string, resolution: 'approved' | 'rejected' | 'deferred') => {
    const businessId = getStoredBusinessId();
    if (!businessId) return;
    setResolving(approvalId);
    try {
      // R3: stale-quote cards have a side-effect on approve — call the
      // commerce follow-up endpoint, which both stamps lastFollowUpAt
      // and resolves the matching approval row server-side.
      const item = pendingItems.find((i) => i.id === approvalId);
      if (resolution === "approved" && item?.toolName === "commerce_send_quote_reminder") {
        const quoteId = (item.inputPayload as Record<string, unknown> | null)?.quoteId;
        if (typeof quoteId === "string") {
          const followRes = await sendStaleQuoteFollowUp({ quoteId, businessId });
          if (followRes.error) {
            toast.error(followRes.error);
            setResolving(null);
            return;
          }
          setPendingItems((prev) => prev.filter((i) => i.id !== approvalId));
          setHandledItems((prev) => [
            { ...item, status: "approved", resolution: "approved", resolvedAt: new Date().toISOString() },
            ...prev,
          ]);
          toast.success("Reminder queued");
          const remaining = pendingItems.filter((i) => i.id !== approvalId && i.status === "pending").length;
          onCountChange?.(remaining);
          setResolving(null);
          return;
        }
      }
      const res = await resolveAiApproval(businessId, approvalId, resolution);
      if (res.data) {
        const resolved = pendingItems.find(i => i.id === approvalId);
        setPendingItems(prev => prev.filter(i => i.id !== approvalId));
        if (resolved && resolution !== "deferred") {
          setHandledItems(prev => [{ ...resolved, status: resolution, resolution, resolvedAt: new Date().toISOString() }, ...prev]);
        } else if (resolved && resolution === "deferred") {
          setPendingItems(prev => [...prev, { ...resolved, status: "deferred", resolution: "deferred" }]);
        }
        toast.success(`Action ${resolution}`);
        const remaining = pendingItems.filter(i => i.id !== approvalId && i.status === "pending").length;
        onCountChange?.(remaining);
      } else {
        toast.error(res.error || "Failed to resolve");
      }
    } catch {
      toast.error("Failed to resolve action");
    } finally {
      setResolving(null);
    }
  }, [pendingItems, onCountChange]);

  const [editingItem, setEditingItem] = useState<AiApprovalItem | null>(null);
  const [batchResolving, setBatchResolving] = useState(false);

  const handleBatchResolve = useCallback(async (resolution: 'approved' | 'rejected') => {
    const businessId = getStoredBusinessId();
    if (!businessId) return;
    const pending = pendingItems.filter(i => i.status === "pending");
    if (pending.length === 0) return;

    setBatchResolving(true);
    try {
      const ids = pending.map(i => i.id);
      const res = await resolveAiApprovalsBatch(businessId, ids, resolution);
      if (res.data) {
        toast.success(`Batch ${resolution}: ${res.data.succeeded} succeeded, ${res.data.failed} failed`);
        loadItems();
      } else {
        toast.error(res.error || "Batch resolve failed");
      }
    } catch {
      toast.error("Batch resolve failed");
    } finally {
      setBatchResolving(false);
    }
  }, [pendingItems, loadItems]);

  const handleApproveAllLowRisk = useCallback(async () => {
    const businessId = getStoredBusinessId();
    if (!businessId) return;
    const lowRisk = pendingItems.filter(i => i.status === "pending" && i.riskTier <= 2);
    if (lowRisk.length === 0) {
      toast.info("No low-risk approvals pending");
      return;
    }

    setBatchResolving(true);
    try {
      const ids = lowRisk.map(i => i.id);
      const res = await resolveAiApprovalsBatch(businessId, ids, "approved");
      if (res.data) {
        toast.success(`Approved ${res.data.succeeded} low-risk items`);
        loadItems();
      } else {
        toast.error(res.error || "Batch approve failed");
      }
    } catch {
      toast.error("Batch approve failed");
    } finally {
      setBatchResolving(false);
    }
  }, [pendingItems, loadItems]);

  const handleEdit = useCallback((approvalId: string) => {
    const item = pendingItems.find(i => i.id === approvalId);
    if (item) {
      setEditingItem(item);
      toast.info("Edit mode: review and modify parameters before approving");
    }
  }, [pendingItems]);

  const queueRef = useRef<HTMLDivElement>(null);

  const handleQueueKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!queueRef.current) return;
    const cards = Array.from(queueRef.current.querySelectorAll<HTMLElement>('[role="article"]'));
    const active = document.activeElement as HTMLElement;
    const idx = cards.indexOf(active);

    if (e.key === "ArrowDown" && idx < cards.length - 1) {
      e.preventDefault();
      cards[idx + 1]?.focus();
    } else if (e.key === "ArrowUp" && idx > 0) {
      e.preventDefault();
      cards[idx - 1]?.focus();
    } else if (e.key === "ArrowDown" && idx === -1 && cards.length > 0) {
      e.preventDefault();
      cards[0]?.focus();
    }
  }, []);

  const pendingCount = pendingItems.filter(i => i.status === "pending").length;
  const handledCount = handledItems.length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 text-[hsl(var(--kf-accent1))] animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {showFilters && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-muted/30 border border-border/30" role="tablist">
            {([
              { id: "waiting" as QueueView, label: `AI Waiting (${pendingCount})`, icon: Clock },
              { id: "handled" as QueueView, label: `AI Handled (${handledCount})`, icon: CheckCircle2 },
              { id: "all" as QueueView, label: "All", icon: Zap },
            ]).map(tab => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={view === tab.id}
                onClick={() => setView(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  view === tab.id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground/60 hover:text-foreground/80"
                }`}
              >
                <tab.icon className="w-3 h-3" />
                {tab.label}
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

      {showFilters && view === "waiting" && pendingCount > 0 && (
        <div className="flex items-center gap-2">
          <button
            onClick={handleApproveAllLowRisk}
            disabled={batchResolving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-500/15 text-emerald-400 text-xs font-medium hover:bg-emerald-500/25 transition-all disabled:opacity-50"
          >
            {batchResolving ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
            Approve All Low-Risk
          </button>
          <button
            onClick={() => handleBatchResolve("approved")}
            disabled={batchResolving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] text-xs font-medium hover:bg-[hsl(var(--kf-accent1))]/25 transition-all disabled:opacity-50"
          >
            {batchResolving ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
            Approve All
          </button>
          <button
            onClick={() => handleBatchResolve("rejected")}
            disabled={batchResolving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-red-500/15 text-red-400 text-xs font-medium hover:bg-red-500/25 transition-all disabled:opacity-50"
          >
            {batchResolving ? <Loader2 className="w-3 h-3 animate-spin" /> : <AlertTriangle className="w-3 h-3" />}
            Reject All
          </button>
        </div>
      )}

      {editingItem && (
        <EditPanel
          item={editingItem}
          onClose={() => setEditingItem(null)}
          onApprove={(id, updatedPayload) => {
            const updated = { ...editingItem, inputPayload: updatedPayload };
            setPendingItems(prev => prev.map(i => i.id === id ? updated : i));
            handleResolve(id, "approved");
            setEditingItem(null);
          }}
          onReject={(id) => { handleResolve(id, "rejected"); setEditingItem(null); }}
        />
      )}

      {view === "waiting" && (
        <div
          ref={queueRef}
          className="space-y-4"
          role="tabpanel"
          aria-label="AI waiting on you"
          onKeyDown={handleQueueKeyDown}
        >
          {QUEUE_CATEGORIES.map(cat => {
            const catItems = pendingItems.filter(cat.filter);
            if (catItems.length === 0) return null;
            const displayed = maxItems ? catItems.slice(0, maxItems) : catItems;
            return (
              <div key={cat.id} className="space-y-2">
                <div className="flex items-center gap-2">
                  <cat.icon className={`w-3.5 h-3.5 ${cat.color}`} />
                  <span className="text-xs font-semibold text-foreground/70">{cat.label}</span>
                  <span className="text-[10px] text-muted-foreground/40">({catItems.length})</span>
                </div>
                <AnimatePresence mode="popLayout">
                  {displayed.map(item => (
                    <VerificationCard
                      key={item.id}
                      item={item}
                      onApprove={(id) => handleResolve(id, "approved")}
                      onReject={(id) => handleResolve(id, "rejected")}
                      onDefer={(id) => handleResolve(id, "deferred")}
                      onEdit={handleEdit}
                      loading={resolving === item.id}
                    />
                  ))}
                </AnimatePresence>
              </div>
            );
          })}
          {pendingItems.filter(i => i.status === "pending").length === 0 && (
            <EmptyState message="All clear — AI has no pending requests" />
          )}
        </div>
      )}

      {view === "handled" && (
        <div className="space-y-2" role="tabpanel" aria-label="AI handled automatically">
          {handledItems.length > 0 ? (
            <AnimatePresence mode="popLayout">
              {handledItems.map(item => (
                <VerificationCard
                  key={item.id}
                  item={item}
                  onApprove={() => {}}
                  onReject={() => {}}
                  onDefer={() => {}}
                  loading={false}
                />
              ))}
            </AnimatePresence>
          ) : (
            <EmptyState message="No recent AI-handled actions" />
          )}
        </div>
      )}

      {view === "all" && (
        <div className="space-y-2" role="tabpanel" aria-label="All actions">
          {[...pendingItems, ...handledItems].length > 0 ? (
            <AnimatePresence mode="popLayout">
              {[...pendingItems, ...handledItems].map(item => (
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
          ) : (
            <EmptyState message="No actions recorded yet" />
          )}
        </div>
      )}
    </div>
  );
}

function EditPanel({
  item,
  onClose,
  onApprove,
  onReject,
}: {
  item: AiApprovalItem;
  onClose: () => void;

  onApprove: (id: string, payload: Record<string, unknown>) => void;
  onReject: (id: string) => void;
}) {

  const [editedPayload, setEditedPayload] = useState<Record<string, unknown>>(

    () => (item.inputPayload && typeof item.inputPayload === "object" ? { ...(item.inputPayload as Record<string, unknown>) } : {})
  );

  const updateField = (key: string, value: string) => {
    setEditedPayload(prev => {

      const original = (item.inputPayload as Record<string, unknown>)?.[key];
      let parsed: unknown = value;
      if (typeof original === "number") {
        const n = Number(value);
        if (!isNaN(n)) parsed = n;
      } else if (typeof original === "boolean") {
        parsed = value === "true";
      }
      return { ...prev, [key]: parsed };
    });
  };

  const hasPayload = Object.keys(editedPayload).length > 0;

  return (
    <div className="p-3 rounded-xl border border-[hsl(var(--kf-accent2))]/30 bg-[hsl(var(--kf-accent2))]/5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-foreground/80">Edit: {item.title}</span>
        <button onClick={onClose} className="text-[10px] text-muted-foreground/50 hover:text-foreground/70" aria-label="Cancel edit">
          Cancel
        </button>
      </div>
      {hasPayload ? (
        <div className="space-y-2">
          {Object.entries(editedPayload).map(([key, val]) => (
            <div key={key} className="space-y-0.5">
              <label className="text-[10px] text-muted-foreground/60 font-medium">{key}</label>
              {typeof val === "string" && val.length > 60 ? (
                <textarea
                  value={String(val)}
                  onChange={(e) => updateField(key, e.target.value)}
                  rows={2}
                  className="w-full px-2 py-1.5 text-xs rounded-lg bg-background/60 border border-border/40 text-foreground/80 focus:outline-none focus:border-[hsl(var(--kf-accent2))]/50 resize-none"
                />
              ) : (
                <input
                  type={typeof val === "number" ? "number" : "text"}
                  value={typeof val === "object" ? JSON.stringify(val) : String(val ?? "")}
                  onChange={(e) => updateField(key, e.target.value)}
                  className="w-full px-2 py-1.5 text-xs rounded-lg bg-background/60 border border-border/40 text-foreground/80 focus:outline-none focus:border-[hsl(var(--kf-accent2))]/50"
                />
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[10px] text-muted-foreground/50">No editable parameters for this action.</p>
      )}
      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={() => onApprove(item.id, editedPayload)}
          className="flex-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 border border-emerald-500/20 transition-all"
        >
          {hasPayload ? "Approve with changes" : "Approve"}
        </button>
        <button
          onClick={() => onReject(item.id)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-all"
        >
          Reject
        </button>
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center py-8 gap-2">
      <Inbox className="w-6 h-6 text-muted-foreground/30" />
      <span className="text-xs text-muted-foreground/50">{message}</span>
      <p className="text-[10px] text-muted-foreground/40 text-center max-w-[200px]">
        Actions requiring your review will appear here
      </p>
    </div>
  );
}
