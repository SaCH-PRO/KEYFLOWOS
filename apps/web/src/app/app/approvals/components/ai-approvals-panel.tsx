"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Bot,
  Check,
  Clock,
  Filter,
  Loader2,
  Search,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionCard } from "@/components/ui/section-card";
import { SideSheet } from "@/components/ui/side-sheet";
import { Skeleton, SkeletonList } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  type AiApprovalItem,
  type AiApprovalStats,
  type AiApprovalFilters,
  fetchAiApprovalStats,
  fetchAiApprovals,
  resolveAiApproval,
} from "@/lib/api/ai-approvals";

const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "escalated", label: "Escalated" },
  { value: "deferred", label: "Deferred" },
];

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function prettyJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function riskLabel(tier: number) {
  if (tier >= 5) return { label: "Critical", status: "error" as const };
  if (tier === 4) return { label: "High", status: "error" as const };
  if (tier === 3) return { label: "Elevated", status: "warning" as const };
  if (tier === 2) return { label: "Moderate", status: "warning" as const };
  return { label: "Low", status: "info" as const };
}

export function AiApprovalsPanel() {
  const [items, setItems] = useState<AiApprovalItem[]>([]);
  const [stats, setStats] = useState<AiApprovalStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [selectedItem, setSelectedItem] = useState<AiApprovalItem | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    open: boolean;
    item: AiApprovalItem | null;
    resolution: "approved" | "rejected" | "deferred";
  }>({ open: false, item: null, resolution: "approved" });

  const businessId = useMemo(() => getStoredBusinessId(), []);

  const loadStats = useCallback(async () => {
    if (!businessId) return;
    const { data, error } = await fetchAiApprovalStats(businessId);
    if (error || !data) {
      console.error("Failed to load AI approval stats:", error);
      return;
    }
    setStats(data);
  }, [businessId]);

  const loadItems = useCallback(
    async (nextCursor?: string) => {
      if (!businessId) return;
      setLoading(true);
      setError(null);
      const { data, error: err } = await fetchAiApprovals(businessId, {
        status: statusFilter as AiApprovalFilters["status"],
        module: moduleFilter || undefined,
        search: search || undefined,
        cursor: nextCursor,
        limit: 20,
      });
      setLoading(false);
      if (err || !data) {
        setError(err ?? "Failed to load approvals");
        return;
      }
      if (nextCursor) {
        setItems((prev) => [...prev, ...data.items]);
      } else {
        setItems(data.items);
      }
      setCursor(data.nextCursor);
      setHasMore(data.hasMore);
    },
    [businessId, statusFilter, moduleFilter, search],
  );

  useEffect(() => {
    loadStats();
    loadItems();
  }, [loadStats, loadItems]);

  const moduleOptions = useMemo(() => {
    const modules = Array.from(new Set(items.map((i) => i.module).filter(Boolean)));
    return modules as string[];
  }, [items]);

  const handleResolve = async (item: AiApprovalItem, resolution: "approved" | "rejected" | "deferred") => {
    if (!businessId) return;
    setProcessingId(item.id);
    const { data, error: err } = await resolveAiApproval(businessId, item.id, resolution);
    setProcessingId(null);
    if (err || !data) {
      setError(err ?? "Resolution failed");
      return;
    }
    setItems((prev) => prev.map((i) => (i.id === item.id ? data : i)));
    if (selectedItem?.id === item.id) {
      setSelectedItem(data);
    }
    await loadStats();
  };

  const confirmResolve = (item: AiApprovalItem, resolution: "approved" | "rejected" | "deferred") => {
    setConfirmAction({ open: true, item, resolution });
  };

  const executeConfirmed = () => {
    if (!confirmAction.item) return;
    handleResolve(confirmAction.item, confirmAction.resolution);
    setConfirmAction({ open: false, item: null, resolution: "approved" });
  };

  const openDetail = async (item: AiApprovalItem) => {
    setSelectedItem(item);
  };

  const filteredItems = useMemo(() => {
    return items;
  }, [items]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {stats ? (
          <>
            <SectionCard compact title="Pending" icon={Clock}>
              <div className="text-2xl font-bold">{stats.pending}</div>
            </SectionCard>
            <SectionCard compact title="Approved today" icon={ShieldCheck}>
              <div className="text-2xl font-bold">{stats.approvedToday}</div>
            </SectionCard>
            <SectionCard compact title="Rejected today" icon={X}>
              <div className="text-2xl font-bold">{stats.rejectedToday}</div>
            </SectionCard>
            <SectionCard compact title="Escalated" icon={ShieldAlert}>
              <div className="text-2xl font-bold">{stats.escalated}</div>
            </SectionCard>
          </>
        ) : (
          <>
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </>
        )}
      </div>

      <SectionCard
        title="KEY Action Queue"
        subtitle="AI-initiated actions awaiting your review"
        icon={Bot}
        headerRight={
          <div className="flex items-center gap-2">
            <div className="relative hidden sm:block">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search actions..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadItems()}
                className="pl-8 pr-3 h-8 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring w-48"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-8 rounded-md border border-input bg-background text-sm px-2"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            {moduleOptions.length > 0 && (
              <select
                value={moduleFilter}
                onChange={(e) => setModuleFilter(e.target.value)}
                className="h-8 rounded-md border border-input bg-background text-sm px-2"
              >
                <option value="">All modules</option>
                {moduleOptions.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            )}
            <Button variant="outline" size="sm" onClick={() => loadItems()}>
              <Filter className="w-3.5 h-3.5 mr-1" />
              Refresh
            </Button>
          </div>
        }
      >
        {error && (
          <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        )}

        {loading && items.length === 0 ? (
          <SkeletonList rows={5} cols={4} />
        ) : filteredItems.length === 0 ? (
          <EmptyState
            icon={Bot}
            title="No KEY actions waiting"
            description={`No ${statusFilter} AI approvals found. KEY will queue actions here when it needs oversight.`}
            variant="compact"
          />
        ) : (
          <div className="space-y-2">
            {filteredItems.map((item) => {
              const risk = riskLabel(item.riskTier);
              const isProcessing = processingId === item.id;
              return (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openDetail(item)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") openDetail(item); }}
                  className="w-full text-left kf-card kf-radius-lg p-3 flex flex-col sm:flex-row sm:items-center gap-3 hover:border-[hsl(var(--kf-accent1)/0.4)] transition-colors cursor-pointer"
                  style={{ borderColor: "hsl(var(--kf-border))" }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">{item.title}</span>
                      <StatusBadge status={item.status} />
                      <StatusBadge status={risk.status} label={risk.label} />
                      {item.module && (
                        <span className="kf-text-micro text-muted-foreground">{item.module}</span>
                      )}
                    </div>
                    <p className="kf-text-caption text-muted-foreground truncate mt-0.5">
                      {item.description || item.toolName}
                    </p>
                  </div>
                  <div
                    className="flex items-center gap-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {item.status === "pending" && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-emerald-600 border-emerald-200 hover:bg-emerald-50"
                          disabled={isProcessing}
                          onClick={() => confirmResolve(item, "approved")}
                        >
                          {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-red-600 border-red-200 hover:bg-red-50"
                          disabled={isProcessing}
                          onClick={() => confirmResolve(item, "rejected")}
                        >
                          {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                          Reject
                        </Button>
                      </>
                    )}
                    <span className="kf-text-micro text-muted-foreground whitespace-nowrap">
                      {formatDate(item.createdAt)}
                    </span>
                  </div>
                </div>
              );
            })}
            {hasMore && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => loadItems(cursor ?? undefined)}
                  disabled={loading}
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Load more"}
                </Button>
              </div>
            )}
          </div>
        )}
      </SectionCard>

      <SideSheet
        open={!!selectedItem}
        onClose={() => setSelectedItem(null)}
        title={selectedItem?.title ?? "Action details"}
        subtitle={selectedItem ? `Requested by KEY • ${formatDate(selectedItem.createdAt)}` : undefined}
        width="lg"
        footer={
          selectedItem && selectedItem.status === "pending" ? (
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setSelectedItem(null)}
              >
                Close
              </Button>
              <Button
                variant="outline"
                className="text-red-600 border-red-200 hover:bg-red-50"
                disabled={processingId === selectedItem.id}
                onClick={() => confirmResolve(selectedItem, "rejected")}
              >
                Reject
              </Button>
              <Button
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                disabled={processingId === selectedItem.id}
                onClick={() => confirmResolve(selectedItem, "approved")}
              >
                {processingId === selectedItem.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                Approve
              </Button>
            </div>
          ) : undefined
        }
      >
        {selectedItem && (
          <div className="space-y-5">
            <div className="flex items-center gap-2 flex-wrap">
              <StatusBadge status={selectedItem.status} />
              <StatusBadge status={riskLabel(selectedItem.riskTier).status} label={riskLabel(selectedItem.riskTier).label} />
              {selectedItem.module && (
                <span className="kf-text-caption text-muted-foreground">{selectedItem.module}</span>
              )}
            </div>

            {selectedItem.description && (
              <p className="text-sm text-muted-foreground">{selectedItem.description}</p>
            )}

            {selectedItem.rationale && (
              <div className="space-y-1">
                <h4 className="text-sm font-semibold">Rationale</h4>
                <p className="text-sm text-muted-foreground">{selectedItem.rationale}</p>
              </div>
            )}

            {selectedItem.expectedBenefit && (
              <div className="space-y-1">
                <h4 className="text-sm font-semibold">Expected benefit</h4>
                <p className="text-sm text-muted-foreground">{selectedItem.expectedBenefit}</p>
              </div>
            )}

            {selectedItem.risks && (
              <div className="space-y-1">
                <h4 className="text-sm font-semibold">Risks</h4>
                <p className="text-sm text-red-600/90">{selectedItem.risks}</p>
              </div>
            )}

            {Object.keys(selectedItem.inputPayload).length > 0 && (
              <div className="space-y-1">
                <h4 className="text-sm font-semibold">Input payload</h4>
                <pre className="text-xs overflow-auto max-h-60 p-3 rounded-md bg-muted/50 border">
                  {prettyJson(selectedItem.inputPayload)}
                </pre>
              </div>
            )}

            {selectedItem.affectedEntities.length > 0 && (
              <div className="space-y-1">
                <h4 className="text-sm font-semibold">Affected entities</h4>
                <pre className="text-xs overflow-auto max-h-60 p-3 rounded-md bg-muted/50 border">
                  {prettyJson(selectedItem.affectedEntities)}
                </pre>
              </div>
            )}

            {selectedItem.resolvedAt && (
              <div className="space-y-1">
                <h4 className="text-sm font-semibold">Resolution</h4>
                <p className="text-sm text-muted-foreground">
                  {selectedItem.resolution} on {formatDate(selectedItem.resolvedAt)} by {selectedItem.resolvedBy ?? "unknown"}
                </p>
              </div>
            )}
          </div>
        )}
      </SideSheet>

      <ConfirmDialog
        open={confirmAction.open}
        title={
          confirmAction.resolution === "approved"
            ? "Approve KEY action?"
            : confirmAction.resolution === "rejected"
              ? "Reject KEY action?"
              : "Defer KEY action?"
        }
        message={
          confirmAction.item
            ? `You are about to ${confirmAction.resolution} "${confirmAction.item.title}". This will apply immediately.`
            : ""
        }
        confirmLabel={confirmAction.resolution === "approved" ? "Approve" : confirmAction.resolution === "rejected" ? "Reject" : "Defer"}
        variant={confirmAction.resolution === "rejected" ? "danger" : "default"}
        onConfirm={executeConfirmed}
        onCancel={() => setConfirmAction({ open: false, item: null, resolution: "approved" })}
      />
    </div>
  );
}
