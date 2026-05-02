"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Clock,
  Zap,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  Info,
  Search,
  SkipForward,
  ChevronDown,
  ChevronRight,
  FileText,
  ExternalLink,
  Workflow,
  RotateCcw,
} from "lucide-react";
import { fetchActivityFeed, testRunPlaybook, ActivityItem } from "@/lib/client";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonList } from "@/components/ui/skeleton";

const TONE_STYLES: Record<string, { icon: typeof Zap; color: string; bg: string; label: string }> = {
  success: { icon: CheckCircle, color: "hsl(var(--kf-success))", bg: "hsl(var(--kf-success) / 0.15)", label: "Success" },
  warning: { icon: AlertTriangle, color: "hsl(var(--kf-warning))", bg: "hsl(var(--kf-warning) / 0.15)", label: "Warning" },
  error: { icon: AlertTriangle, color: "hsl(var(--kf-error))", bg: "hsl(var(--kf-error) / 0.15)", label: "Failed" },
  info: { icon: Info, color: "hsl(var(--kf-info))", bg: "hsl(var(--kf-info) / 0.15)", label: "Info" },
};

const STATUS_FILTERS = [
  { key: "all", label: "All", icon: null },
  { key: "success", label: "Success", icon: CheckCircle },
  { key: "error", label: "Failed", icon: AlertTriangle },
  { key: "skipped", label: "Skipped", icon: SkipForward },
] as const;

const TIME_FILTERS = [
  { key: "all", label: "All Time" },
  { key: "today", label: "Today" },
  { key: "week", label: "This Week" },
  { key: "month", label: "This Month" },
] as const;

type StatusFilterKey = (typeof STATUS_FILTERS)[number]["key"];
type TimeFilterKey = (typeof TIME_FILTERS)[number]["key"];

const AUTOMATION_MODULES = ["automation", "agent"];

interface ExecutionLogProps {
  businessId: string | null;
  onExecutionStatsChange?: (stats: { total: number; success: number; failed: number; skipped: number; successRate: number }) => void;
}

export function ExecutionLog({ businessId, onExecutionStatsChange }: ExecutionLogProps) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilterKey>("all");
  const [timeFilter, setTimeFilter] = useState<TimeFilterKey>("all");
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!businessId) return;
    const results = await Promise.all(
      AUTOMATION_MODULES.map((mod) => fetchActivityFeed(businessId, { module: mod, limit: 50 }))
    );
    const executionActions = new Set(["executed", "failed", "skipped"]);
    const allItems: ActivityItem[] = [];
    for (const r of results) {
      if (r.data) {
        for (const item of r.data) {
          if (executionActions.has(item.action)) allItems.push(item);
        }
      }
    }
    allItems.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    setItems(allItems.slice(0, 100));
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const stats = useMemo(() => {
    const total = items.length;
    const success = items.filter((i) => i.tone === "success" || i.action === "executed").length;
    const failed = items.filter((i) => i.tone === "error" || i.action === "failed").length;
    const skipped = items.filter((i) => i.action === "skipped").length;
    const successRate = total > 0 ? Math.round((success / total) * 100) : 0;
    return { total, success, failed, skipped, successRate };
  }, [items]);

  useEffect(() => {
    if (!loading && onExecutionStatsChange) {
      onExecutionStatsChange(stats);
    }
  }, [stats, loading, onExecutionStatsChange]);

  async function handleRetry(item: ActivityItem) {
    if (!businessId || !item.entityId) return;
    setRetryingId(item.id);
    const res = await testRunPlaybook({ businessId, playbookId: item.entityId });
    setRetryingId(null);
    if (res.data?.success) {
      await load();
    }
  }

  const filteredItems = useMemo(() => {
    let result = items;

    if (statusFilter !== "all") {
      if (statusFilter === "skipped") {
        result = result.filter((item) => item.action === "skipped");
      } else if (statusFilter === "success") {
        result = result.filter((item) => item.tone === "success" || item.action === "executed");
      } else if (statusFilter === "error") {
        result = result.filter((item) => item.tone === "error" || item.action === "failed");
      }
    }

    if (timeFilter !== "all") {
      const now = Date.now();
      let cutoff = 0;
      if (timeFilter === "today") cutoff = now - 24 * 60 * 60 * 1000;
      else if (timeFilter === "week") cutoff = now - 7 * 24 * 60 * 60 * 1000;
      else if (timeFilter === "month") cutoff = now - 30 * 24 * 60 * 60 * 1000;
      result = result.filter((item) => new Date(item.createdAt).getTime() > cutoff);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (item) =>
          (item.title && item.title.toLowerCase().includes(q)) ||
          (item.detail && item.detail.toLowerCase().includes(q)) ||
          (item.entityType && item.entityType.toLowerCase().includes(q))
      );
    }
    return result;
  }, [items, statusFilter, timeFilter, searchQuery]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Workflow className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          <p className="text-sm font-medium">Execution Diagnostics</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors min-w-[44px] min-h-[44px] justify-center"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {!loading && items.length > 0 && (
        <div className="grid grid-cols-5 gap-2">
          <MiniStat label="Total Runs" value={stats.total} color="hsl(var(--foreground))" />
          <MiniStat label="Success" value={stats.success} color="hsl(var(--kf-success))" />
          <MiniStat label="Failed" value={stats.failed} color="hsl(var(--kf-error))" />
          <MiniStat label="Skipped" value={stats.skipped} color="hsl(var(--kf-warning))" />
          <MiniStat label="Success Rate" value={`${stats.successRate}%`} color={stats.successRate >= 80 ? "hsl(var(--kf-success))" : stats.successRate >= 50 ? "hsl(var(--kf-warning))" : "hsl(var(--kf-error))"} />
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
          <input
            type="text"
            placeholder="Search executions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-border/60 bg-input pl-9 pr-3 py-2 text-sm placeholder:text-muted-foreground/50 min-h-[36px]"
          />
        </div>
        <div className="flex items-center gap-1.5">
          {STATUS_FILTERS.map((sf) => {
            const isActive = statusFilter === sf.key;
            return (
              <button
                key={sf.key}
                onClick={() => setStatusFilter(sf.key)}
                className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg transition-colors min-h-[32px]"
                style={{
                  background: isActive
                    ? sf.key === "error"
                      ? "hsl(var(--kf-error) / 0.15)"
                      : sf.key === "success"
                        ? "hsl(var(--kf-success) / 0.15)"
                        : sf.key === "skipped"
                          ? "hsl(var(--kf-warning) / 0.15)"
                          : "hsl(var(--kf-accent1) / 0.15)"
                    : "transparent",
                  color: isActive
                    ? sf.key === "error"
                      ? "hsl(var(--kf-error))"
                      : sf.key === "success"
                        ? "hsl(var(--kf-success))"
                        : sf.key === "skipped"
                          ? "hsl(var(--kf-warning))"
                          : "hsl(var(--kf-accent1))"
                    : undefined,
                }}
              >
                {sf.icon && <sf.icon className="w-3 h-3" />}
                {sf.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1">
          {TIME_FILTERS.map((tf) => (
            <button
              key={tf.key}
              onClick={() => setTimeFilter(tf.key)}
              className="text-[11px] font-medium px-2 py-1 rounded-lg transition-colors min-h-[32px]"
              style={{
                background: timeFilter === tf.key ? "hsl(var(--kf-info) / 0.15)" : "transparent",
                color: timeFilter === tf.key ? "hsl(var(--kf-info))" : undefined,
              }}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <SkeletonList rows={4} cols={3} />
      ) : filteredItems.length === 0 ? (
        <EmptyState
          icon={Clock}
          title={items.length === 0 ? "No execution history yet" : "No matching results"}
          description={
            items.length === 0
              ? "Once your flows run, you'll be able to inspect every execution, failure, and skipped condition here."
              : "Try adjusting your search, status, or time filters."
          }
          variant="compact"
          iconColor="hsl(var(--kf-accent1))"
        />
      ) : (
        <div className="rounded-2xl border border-border/60 bg-card overflow-hidden">
          <div className="divide-y divide-border/40">
            {filteredItems.map((item) => {
              const toneStyle = TONE_STYLES[item.tone ?? "info"] ?? TONE_STYLES.info;
              const ToneIcon = toneStyle.icon;
              const isExpanded = expandedItem === item.id;
              return (
                <div key={item.id}>
                  <button
                    onClick={() => setExpandedItem(isExpanded ? null : item.id)}
                    className="w-full px-4 py-3 flex items-start gap-3 hover:bg-muted/20 transition-colors text-left min-h-[44px]"
                  >
                    <div
                      className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                      style={{ background: toneStyle.bg }}
                    >
                      <ToneIcon className="w-3.5 h-3.5" style={{ color: toneStyle.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{item.title}</span>
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded-md font-medium"
                          style={{ background: toneStyle.bg, color: toneStyle.color }}
                        >
                          {toneStyle.label}
                        </span>
                      </div>
                      {item.detail && (
                        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{item.detail}</p>
                      )}
                      <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground/60">
                        <span className="inline-flex items-center gap-1">
                          <Zap className="w-3 h-3" />
                          {item.entityType}
                        </span>
                        <span>{item.action}</span>
                        <span>{new Date(item.createdAt).toLocaleString()}</span>
                      </div>
                    </div>
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 shrink-0 mt-1 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="w-4 h-4 shrink-0 mt-1 text-muted-foreground" />
                    )}
                  </button>
                  {isExpanded && (
                    <div
                      className="px-4 pb-3 ml-10 space-y-3"
                      style={{ borderTop: "1px solid hsl(var(--kf-border) / 0.3)" }}
                    >
                      <div className="pt-3 space-y-2">
                        <div className="flex items-center gap-2 text-xs font-medium" style={{ color: "hsl(var(--kf-accent1))" }}>
                          <FileText className="w-3.5 h-3.5" />
                          Execution Trace
                        </div>
                        <div className="space-y-1.5">
                          <TraceStep
                            label="Trigger"
                            value={item.entityType || "Unknown trigger"}
                            status="completed"
                          />
                          <TraceConnector />
                          <TraceStep
                            label="Action"
                            value={item.action}
                            status={item.tone === "error" ? "failed" : item.action === "skipped" ? "skipped" : "completed"}
                          />
                          <TraceConnector />
                          <TraceStep
                            label="Result"
                            value={item.detail || (item.tone === "error" ? "Execution failed" : item.action === "skipped" ? "Condition not met — flow skipped" : "Completed successfully")}
                            status={item.tone === "error" ? "failed" : item.action === "skipped" ? "skipped" : "completed"}
                          />
                        </div>
                      </div>

                      <div
                        className="rounded-lg p-3 text-[11px] space-y-1.5"
                        style={{ background: "hsl(var(--kf-muted) / 0.2)", border: "1px solid hsl(var(--kf-border) / 0.3)" }}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Run ID</span>
                          <span className="font-mono">{item.id.slice(0, 12)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Timestamp</span>
                          <span>{new Date(item.createdAt).toLocaleString()}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Module</span>
                          <span>{item.module || "automation"}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Entity Type</span>
                          <span>{item.entityType || "—"}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Status</span>
                          <span
                            className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                            style={{ background: toneStyle.bg, color: toneStyle.color }}
                          >
                            {toneStyle.label}
                          </span>
                        </div>
                      </div>

                      {(item.tone === "error" || item.action === "failed") && item.detail && (
                        <div className="rounded-lg p-3 text-[11px] font-mono whitespace-pre-wrap leading-relaxed" style={{ background: "hsl(var(--kf-error) / 0.06)", border: "1px solid hsl(var(--kf-error) / 0.15)", color: "hsl(var(--kf-error))" }}>
                          <div className="flex items-center gap-1.5 mb-1 text-[10px] font-sans font-medium uppercase tracking-wider">
                            <AlertTriangle className="w-3 h-3" />
                            Error Details
                          </div>
                          {item.detail}
                        </div>
                      )}

                      <div className="flex items-center gap-2 flex-wrap">
                        {(item.tone === "error" || item.action === "failed") && item.entityId && (
                          <button
                            className="inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors min-h-[32px]"
                            style={{ background: "hsl(var(--kf-accent1) / 0.15)", color: "hsl(var(--kf-accent1))" }}
                            onClick={() => handleRetry(item)}
                            disabled={retryingId === item.id}
                          >
                            <RotateCcw className={`w-3 h-3 ${retryingId === item.id ? "animate-spin" : ""}`} />
                            {retryingId === item.id ? "Running..." : "Test Run"}
                          </button>
                        )}
                        {item.entityId && (
                          <button
                            className="inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors min-h-[32px]"
                            style={{ background: "hsl(var(--kf-accent1) / 0.1)", color: "hsl(var(--kf-accent1))" }}
                            onClick={() => {
                              const routeMap: Record<string, string> = {
                                invoice: "/app/invoices",
                                client: "/app/clients",
                                booking: "/app/calendar",
                                quote: "/app/quotes",
                                project: "/app/projects",
                              };
                              const entityType = item.entityType?.toLowerCase() || "";
                              const base = routeMap[entityType] || "/app";
                              window.location.href = `${base}/${item.entityId}`;
                            }}
                          >
                            <ExternalLink className="w-3 h-3" />
                            Open Related Record
                          </button>
                        )}
                        <button
                          className="inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors min-h-[32px]"
                          style={{ background: "hsl(var(--muted) / 0.5)", color: "hsl(var(--muted-foreground))" }}
                          onClick={() => {
                            navigator.clipboard.writeText(item.id).catch(() => {});
                          }}
                          title="Copy execution run ID for debugging"
                        >
                          <FileText className="w-3 h-3" />
                          Copy Run ID
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="rounded-lg px-3 py-2 text-center" style={{ background: `${color}08`, border: `1px solid ${color}15` }}>
      <div className="text-lg font-bold" style={{ color }}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

function TraceStep({ label, value, status }: { label: string; value: string; status: "completed" | "failed" | "skipped" }) {
  const statusColors = {
    completed: { bg: "hsl(var(--kf-success) / 0.15)", color: "hsl(var(--kf-success))", dot: "hsl(var(--kf-success))" },
    failed: { bg: "hsl(var(--kf-error) / 0.15)", color: "hsl(var(--kf-error))", dot: "hsl(var(--kf-error))" },
    skipped: { bg: "hsl(var(--kf-warning) / 0.15)", color: "hsl(var(--kf-warning))", dot: "hsl(var(--kf-warning))" },
  };
  const s = statusColors[status];
  return (
    <div
      className="flex items-center gap-3 rounded-lg px-3 py-2"
      style={{ background: s.bg, border: `1px solid ${s.color}20` }}
    >
      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: s.dot }} />
      <div className="flex-1 min-w-0">
        <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: s.color }}>{label}</span>
        <p className="text-xs truncate">{value}</p>
      </div>
    </div>
  );
}

function TraceConnector() {
  return (
    <div className="flex justify-center">
      <div className="w-px h-3" style={{ background: "hsl(var(--kf-border) / 0.5)" }} />
    </div>
  );
}
