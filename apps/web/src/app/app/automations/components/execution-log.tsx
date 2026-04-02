"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Clock, Zap, RefreshCw, AlertTriangle, CheckCircle, Info, Search, SkipForward, ChevronDown, ChevronRight, FileText } from "lucide-react";
import { fetchActivityFeed, ActivityItem } from "@/lib/client";

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

type StatusFilterKey = (typeof STATUS_FILTERS)[number]["key"];

const AUTOMATION_MODULES = ["automation", "agent"];

interface ExecutionLogProps {
  businessId: string | null;
}

export function ExecutionLog({ businessId }: ExecutionLogProps) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilterKey>("all");
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!businessId) return;
    const results = await Promise.all(
      AUTOMATION_MODULES.map((mod) => fetchActivityFeed(businessId, { module: mod, limit: 30 }))
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
    setItems(allItems.slice(0, 50));
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
  }, [items, statusFilter, searchQuery]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Execution history for playbooks and cross-module workflows.
        </p>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors min-w-[44px] min-h-[44px] justify-center"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
          <input
            type="text"
            placeholder="Search by playbook name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-border/60 bg-input pl-9 pr-3 py-2 text-sm placeholder:text-muted-foreground/50 min-h-[44px]"
          />
        </div>
        <div className="flex items-center gap-1.5">
          {STATUS_FILTERS.map((sf) => {
            const isActive = statusFilter === sf.key;
            return (
              <button
                key={sf.key}
                onClick={() => setStatusFilter(sf.key)}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors min-h-[44px]"
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
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Loading execution log...</div>
      ) : filteredItems.length === 0 ? (
        <div className="rounded-2xl border border-border/60 bg-card p-8 text-center">
          <div className="w-10 h-10 rounded-xl mx-auto mb-3 flex items-center justify-center" style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}>
            <Clock className="w-5 h-5" style={{ color: "hsl(var(--kf-accent1))" }} />
          </div>
          <p className="text-sm font-medium mb-1">
            {items.length === 0 ? "No execution history yet" : "No matching results"}
          </p>
          <p className="text-xs text-muted-foreground">
            {items.length === 0
              ? "When your automations run, their execution details will appear here."
              : "Try adjusting your search or filters."}
          </p>
        </div>
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
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{item.title}</span>
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded-md font-medium"
                          style={{ background: toneStyle.bg, color: toneStyle.color }}
                        >
                          {toneStyle.label}
                        </span>
                      </div>
                      {item.detail && (
                        <p className="text-[12px] text-muted-foreground mt-0.5">{item.detail}</p>
                      )}
                      <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground/60">
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
                            value={item.detail || (item.tone === "error" ? "Execution failed" : "Completed successfully")}
                            status={item.tone === "error" ? "failed" : "completed"}
                          />
                        </div>
                      </div>
                      <div
                        className="rounded-lg p-3 text-[11px] space-y-1"
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
                          <span className="text-muted-foreground">Status</span>
                          <span
                            className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                            style={{ background: toneStyle.bg, color: toneStyle.color }}
                          >
                            {toneStyle.label}
                          </span>
                        </div>
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
