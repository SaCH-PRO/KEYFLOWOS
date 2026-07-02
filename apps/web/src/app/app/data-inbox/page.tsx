"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Inbox,
  HardDrive,
  Mail,
  MessageCircle,
  Smartphone,
  Instagram,
  Facebook,
  RefreshCw,
  Search,
  X,
  CheckCircle2,
  XCircle,
  Edit3,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Loader2,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import { getStoredBusinessId } from "@/lib/workspace";
import { StandardModuleLayout } from "@/components/ui/standard-module-layout";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonList } from "@/components/ui/skeleton";
import { Button } from "@keyflow/ui";
import { Input } from "@keyflow/ui";
import {
  fetchIngestionItems,
  fetchIngestionItem,
  approveIngestionItem,
  rejectIngestionItem,
  correctIngestionItem,
  type IngestionItem,
  type IngestionItemFilters,
} from "@/lib/api/data-inbox";

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "reviewing", label: "Reviewing" },
  { value: "approved", label: "Approved" },
  { value: "auto_executed", label: "Auto-executed" },
  { value: "rejected", label: "Rejected" },
  { value: "error", label: "Error" },
];

const SOURCE_OPTIONS = [
  { value: "", label: "All sources" },
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "sms", label: "SMS" },
  { value: "instagram", label: "Instagram" },
  { value: "messenger", label: "Messenger" },
  { value: "google_drive", label: "Google Drive" },
  { value: "manual", label: "Manual" },
];

const SORT_OPTIONS = [
  { value: "createdAt:desc", label: "Newest first" },
  { value: "createdAt:asc", label: "Oldest first" },
  { value: "confidence:desc", label: "Highest confidence" },
  { value: "confidence:asc", label: "Lowest confidence" },
];

const SOURCE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  email: Mail,
  whatsapp: MessageCircle,
  sms: Smartphone,
  instagram: Instagram,
  messenger: Facebook,
  google_drive: HardDrive,
  manual: FileText,
};

function getSourceIcon(sourceType: string) {
  return SOURCE_ICONS[sourceType] ?? FileText;
}

function getSourceLabel(sourceType: string) {
  return SOURCE_OPTIONS.find((s) => s.value === sourceType)?.label ?? sourceType;
}

function relativeTime(dateStr?: string | null) {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function formatConfidence(value?: number | null) {
  if (value == null) return "—";
  return `${Math.round(value * 100)}%`;
}

function prettyJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export default function DataInboxPage() {
  const businessId = getStoredBusinessId();

  const [items, setItems] = useState<IngestionItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<IngestionItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [correctModalOpen, setCorrectModalOpen] = useState(false);
  const [correctJson, setCorrectJson] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);

  const [filters, setFilters] = useState<IngestionItemFilters>({
    status: "reviewing",
    sourceType: "",
    search: "",
    sortBy: "createdAt",
    sortOrder: "desc",
    limit: 25,
  });

  const loadItems = useCallback(
    async (cursor?: string) => {
      if (!businessId) return;
      setLoading(true);
      const { data, error } = await fetchIngestionItems(businessId, { ...filters, cursor });
      if (error) {
        toast.error(error);
      } else if (data) {
        setItems((prev) => (cursor ? [...prev, ...data.items] : data.items));
        setHasMore(data.hasMore);
        setNextCursor(data.nextCursor);
      }
      setLoading(false);
    },
    [businessId, filters],
  );

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useEffect(() => {
    const timer = setTimeout(() => loadItems(), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search]);

  const selectItem = async (item: IngestionItem) => {
    if (!businessId) return;
    setDetailLoading(true);
    const { data, error } = await fetchIngestionItem(businessId, item.id);
    if (error || !data) {
      toast.error(error ?? "Failed to load item");
    } else {
      setSelectedItem(data);
      setShowRaw(false);
      setShowRejectInput(false);
      setCorrectJson(prettyJson(data.proposedActions));
    }
    setDetailLoading(false);
  };

  const closeDetail = () => {
    setSelectedItem(null);
    setShowRejectInput(false);
    setCorrectModalOpen(false);
  };

  const handleApprove = async () => {
    if (!businessId || !selectedItem) return;
    setActionLoading("approve");
    const { data, error } = await approveIngestionItem(businessId, selectedItem.id);
    if (error || !data) {
      toast.error(error ?? "Approval failed");
    } else {
      toast.success("Item approved and executed");
      setSelectedItem(data);
      updateItemInList(data);
    }
    setActionLoading(null);
  };

  const handleReject = async () => {
    if (!businessId || !selectedItem) return;
    setActionLoading("reject");
    const { data, error } = await rejectIngestionItem(businessId, selectedItem.id, rejectReason);
    if (error || !data) {
      toast.error(error ?? "Rejection failed");
    } else {
      toast.success("Item rejected");
      setSelectedItem(data);
      updateItemInList(data);
      setShowRejectInput(false);
      setRejectReason("");
    }
    setActionLoading(null);
  };

  const openCorrectModal = () => {
    if (!selectedItem) return;
    setCorrectJson(prettyJson(selectedItem.proposedActions));
    setCorrectModalOpen(true);
  };

  const handleCorrect = async () => {
    if (!businessId || !selectedItem) return;
    let correctedActions: Record<string, unknown>[];
    try {
      correctedActions = JSON.parse(correctJson);
      if (!Array.isArray(correctedActions)) throw new Error("Actions must be an array");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid JSON");
      return;
    }
    setActionLoading("correct");
    const { data, error } = await correctIngestionItem(businessId, selectedItem.id, correctedActions);
    if (error || !data) {
      toast.error(error ?? "Correction failed");
    } else {
      toast.success("Actions corrected");
      setSelectedItem(data);
      updateItemInList(data);
      setCorrectModalOpen(false);
    }
    setActionLoading(null);
  };

  const updateItemInList = (updated: IngestionItem) => {
    setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
  };

  const handleLoadMore = () => {
    if (nextCursor) loadItems(nextCursor);
  };

  const sortValue = useMemo(() => `${filters.sortBy}:${filters.sortOrder}`, [filters.sortBy, filters.sortOrder]);

  const metricStrip = useMemo(() => {
    const counts = items.reduce(
      (acc, item) => {
        acc[item.status] = (acc[item.status] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    const total = items.length;
    return (
      <div className="flex flex-wrap gap-3">
        <MetricPill label="Visible" value={total} />
        <MetricPill label="Reviewing" value={counts["reviewing"] ?? 0} color="warning" />
        <MetricPill label="Approved" value={(counts["approved"] ?? 0) + (counts["auto_executed"] ?? 0)} color="success" />
        <MetricPill label="Rejected" value={counts["rejected"] ?? 0} color="neutral" />
        <MetricPill label="Errors" value={counts["error"] ?? 0} color="error" />
      </div>
    );
  }, [items]);

  const headerRight = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search items..."
          value={filters.search}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          className="pl-8 w-40 sm:w-56"
        />
      </div>
      <SelectNative
        value={filters.status ?? ""}
        onChange={(value) => setFilters((f) => ({ ...f, status: value }))}
        options={STATUS_OPTIONS}
      />
      <SelectNative
        value={filters.sourceType ?? ""}
        onChange={(value) => setFilters((f) => ({ ...f, sourceType: value }))}
        options={SOURCE_OPTIONS}
      />
      <SelectNative
        value={sortValue}
        onChange={(value) => {
          const [sortBy, sortOrder] = value.split(":") as ["createdAt" | "confidence", "asc" | "desc"];
          setFilters((f) => ({ ...f, sortBy, sortOrder }));
        }}
        options={SORT_OPTIONS}
      />
      <Button
        variant="outline"
        size="sm"
        onClick={() => loadItems()}
        disabled={loading}
        className="gap-1"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        Refresh
      </Button>
    </div>
  );

  return (
    <StandardModuleLayout
      workspace="inbox"
      icon={Inbox}
      title="Data Inbox"
      subtitle="Review, edit, and approve everything KEY ingests from your connected channels."
      headerRight={headerRight}
      metricStrip={metricStrip}
    >
      <div className="space-y-3">
        {loading && items.length === 0 ? (
          <SkeletonList rows={6} cols={4} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="No items in your Data Inbox"
            description="Connect a channel in Key Connect or send a test message to see ingestion items here."
            variant="compact"
          />
        ) : (
          <>
            {items.map((item) => (
              <IngestionItemCard
                key={item.id}
                item={item}
                selected={selectedItem?.id === item.id}
                onClick={() => selectItem(item)}
              />
            ))}
            {hasMore && (
              <div className="flex justify-center pt-2">
                <Button variant="outline" size="sm" onClick={handleLoadMore} disabled={loading}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Load more"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="absolute inset-0 bg-black/50" onClick={closeDetail} />
          <div className="relative w-full sm:max-w-3xl sm:max-h-[85vh] bg-[hsl(var(--kf-background))] rounded-t-2xl sm:rounded-2xl border shadow-xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div className="flex items-center gap-2 min-w-0">
                {(() => {
                  const Icon = getSourceIcon(selectedItem.sourceType);
                  return <Icon className="w-5 h-5 text-[hsl(var(--kf-muted-foreground))] flex-shrink-0" />;
                })()}
                <h2 className="font-semibold truncate">{selectedItem.summary ?? "Ingestion item"}</h2>
              </div>
              <button onClick={closeDetail} className="p-1 rounded-md hover:bg-muted">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto p-4 space-y-4">
              {detailLoading ? (
                <SkeletonList rows={4} cols={2} />
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={selectedItem.status} />
                    <Badge variant="secondary">{getSourceLabel(selectedItem.sourceType)}</Badge>
                    {selectedItem.intentType && <Badge variant="outline">{selectedItem.intentType}</Badge>}
                    <span className="text-xs text-[hsl(var(--kf-muted-foreground))]">
                      Confidence {formatConfidence(selectedItem.confidence)}
                    </span>
                    <span className="text-xs text-[hsl(var(--kf-muted-foreground))]">
                      {relativeTime(selectedItem.createdAt)}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <Field label="From" value={selectedItem.fromName ?? selectedItem.fromEmail ?? "Unknown"} />
                    <Field label="Email" value={selectedItem.fromEmail} />
                    <Field label="Phone" value={selectedItem.fromPhone} />
                    <Field label="Received" value={selectedItem.receivedAt ? new Date(selectedItem.receivedAt).toLocaleString() : "—"} />
                  </div>

                  {selectedItem.errorMessage && (
                    <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 flex gap-2 text-sm">
                      <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                      {selectedItem.errorMessage}
                    </div>
                  )}

                  <Section title="Extracted data">
                    <pre className="text-xs bg-muted/50 p-3 rounded-lg overflow-auto max-h-48">
                      {prettyJson(selectedItem.extractedData)}
                    </pre>
                  </Section>

                  <Section title="Proposed actions">
                    {selectedItem.proposedActions.length === 0 ? (
                      <p className="text-sm text-[hsl(var(--kf-muted-foreground))]">No actions proposed.</p>
                    ) : (
                      <ul className="space-y-2">
                        {selectedItem.proposedActions.map((action, idx) => (
                          <li key={idx} className="rounded-lg border p-3 text-sm">
                            <div className="font-medium">{(action.type as string) ?? "Action"}</div>
                            <pre className="text-xs bg-muted/30 p-2 mt-1 rounded overflow-auto max-h-32">
                              {prettyJson(action)}
                            </pre>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Section>

                  <Section title="Raw payload">
                    <button
                      onClick={() => setShowRaw((s) => !s)}
                      className="text-xs flex items-center gap-1 text-[hsl(var(--kf-muted-foreground))] hover:text-foreground"
                    >
                      {showRaw ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      {showRaw ? "Hide raw payload" : "Show raw payload"}
                    </button>
                    {showRaw && (
                      <pre className="text-xs bg-muted/50 p-3 rounded-lg overflow-auto max-h-64 mt-2">
                        {prettyJson(selectedItem.rawPayload)}
                      </pre>
                    )}
                  </Section>
                </>
              )}
            </div>

            <div className="border-t p-4 space-y-3">
              {showRejectInput ? (
                <div className="space-y-2">
                  <Input
                    placeholder="Reason for rejection (optional)"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <Button variant="destructive" size="sm" onClick={handleReject} disabled={!!actionLoading}>
                      {actionLoading === "reject" ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />}
                      Confirm reject
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setShowRejectInput(false)} disabled={!!actionLoading}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {selectedItem.status === "reviewing" || selectedItem.status === "error" ? (
                    <>
                      <Button size="sm" onClick={handleApprove} disabled={!!actionLoading}>
                        {actionLoading === "approve" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                        Approve
                      </Button>
                      <Button variant="outline" size="sm" onClick={openCorrectModal} disabled={!!actionLoading}>
                        <Edit3 className="w-4 h-4" />
                        Correct
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => setShowRejectInput(true)} disabled={!!actionLoading}>
                        <XCircle className="w-4 h-4" />
                        Reject
                      </Button>
                    </>
                  ) : (
                    <span className="text-sm text-[hsl(var(--kf-muted-foreground))]">
                      This item is {selectedItem.status.replace(/_/g, " ")}.
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {correctModalOpen && selectedItem && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setCorrectModalOpen(false)} />
          <div className="relative w-full max-w-2xl bg-[hsl(var(--kf-background))] rounded-2xl border shadow-xl p-4 space-y-3">
            <h3 className="font-semibold">Correct proposed actions</h3>
            <p className="text-xs text-[hsl(var(--kf-muted-foreground))]">
              Edit the JSON array of actions below, then submit. KEY will execute the corrected actions when approved.
            </p>
            <textarea
              value={correctJson}
              onChange={(e) => setCorrectJson(e.target.value)}
              className="w-full h-64 rounded-lg bg-[var(--kf-glass)] border border-[var(--kf-border)] px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[var(--kf-electric)]"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setCorrectModalOpen(false)} disabled={!!actionLoading}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleCorrect} disabled={!!actionLoading}>
                {actionLoading === "correct" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Save correction
              </Button>
            </div>
          </div>
        </div>
      )}
    </StandardModuleLayout>
  );
}

function IngestionItemCard({
  item,
  selected,
  onClick,
}: {
  item: IngestionItem;
  selected: boolean;
  onClick: () => void;
}) {
  const Icon = getSourceIcon(item.sourceType);
  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-xl border p-3 transition-colors hover:bg-muted/50 ${
        selected ? "ring-2 ring-[hsl(var(--kf-accent1))]/50 bg-muted/30" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
          <Icon className="w-5 h-5 text-[hsl(var(--kf-muted-foreground))]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium truncate">{item.summary ?? "Untitled item"}</span>
            <StatusBadge status={item.status} size="sm" />
            {item.intentType && <Badge variant="outline" className="text-xs">{item.intentType}</Badge>}
          </div>
          <div className="text-xs text-[hsl(var(--kf-muted-foreground))] mt-0.5">
            {item.fromName ?? item.fromEmail ?? "Unknown sender"} · {getSourceLabel(item.sourceType)} ·{" "}
            {relativeTime(item.createdAt)}
          </div>
          {item.body && (
            <p className="text-sm text-[hsl(var(--kf-muted-foreground))] mt-1 line-clamp-2">{item.body}</p>
          )}
        </div>
        <div className="text-xs text-[hsl(var(--kf-muted-foreground))] flex-shrink-0">
          {formatConfidence(item.confidence)}
        </div>
      </div>
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="text-xs text-[hsl(var(--kf-muted-foreground))]">{label}</div>
      <div className="font-medium truncate">{value ?? "—"}</div>
    </div>
  );
}

function SelectNative({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-lg bg-[var(--kf-glass)] border border-[var(--kf-border)] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--kf-electric)]"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function MetricPill({
  label,
  value,
  color = "neutral",
}: {
  label: string;
  value: number;
  color?: "neutral" | "success" | "warning" | "error" | "info";
}) {
  const colorVar =
    color === "success"
      ? "var(--kf-success)"
      : color === "warning"
      ? "var(--kf-warning)"
      : color === "error"
      ? "var(--kf-error)"
      : color === "info"
      ? "var(--kf-info)"
      : "var(--kf-neutral)";
  return (
    <div
      className="px-2.5 py-1 rounded-full text-xs font-medium border"
      style={{
        background: `hsl(${colorVar} / 0.1)`,
        color: `hsl(${colorVar})`,
        borderColor: `hsl(${colorVar} / 0.25)`,
      }}
    >
      {label}: {value}
    </div>
  );
}
