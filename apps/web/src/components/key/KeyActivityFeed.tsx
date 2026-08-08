"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { format, isToday, isYesterday, startOfDay } from "date-fns";
import { getApiBase } from "@/lib/api-base";
import {
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Filter,
  ChevronDown,
  ChevronRight,
  Bot,
  Zap,
  BrainCircuit,
  Bell,
  Workflow,
} from "lucide-react";

const API_BASE = getApiBase();

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type ActivityStatus = "success" | "pending" | "error" | "warning" | "info";

export type ActivityType = "execution" | "insight" | "alert" | "automation" | "system";

export interface ActivityItem {
  id: string;
  type: ActivityType;
  status: ActivityStatus;
  title: string;
  description: string;
  timestamp: string;
  details?: Record<string, unknown>;
  actionable?: boolean;
  actionTaken?: "approved" | "rejected" | null;
  metadata?: {
    module?: string;
    entityId?: string;
    entityType?: string;
  };
  read?: boolean;
}

export interface KeyActivityFeedProps {
  businessId?: string;
  className?: string;
  maxItems?: number;
  showFilters?: boolean;
  onActivityClick?: (item: ActivityItem) => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const TYPE_CONFIG: Record<
  ActivityType,
  { icon: typeof Zap; label: string; color: string }
> = {
  execution: { icon: Zap, label: "Execution", color: "text-cyan-400" },
  insight: { icon: BrainCircuit, label: "Insight", color: "text-violet-400" },
  alert: { icon: Bell, label: "Alert", color: "text-amber-400" },
  automation: { icon: Workflow, label: "Automation", color: "text-emerald-400" },
  system: { icon: Bot, label: "System", color: "text-slate-400" },
};

const STATUS_CONFIG: Record<
  ActivityStatus,
  { icon: typeof CheckCircle2; color: string; bg: string; label: string }
> = {
  success: {
    icon: CheckCircle2,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    label: "Success",
  },
  pending: {
    icon: Clock,
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    label: "Pending",
  },
  error: {
    icon: XCircle,
    color: "text-red-400",
    bg: "bg-red-500/10",
    label: "Error",
  },
  warning: {
    icon: AlertTriangle,
    color: "text-orange-400",
    bg: "bg-orange-500/10",
    label: "Warning",
  },
  info: {
    icon: Bot,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    label: "Info",
  },
};

function groupByDay(items: ActivityItem[]): Map<string, ActivityItem[]> {
  const groups = new Map<string, ActivityItem[]>();
  const sorted = [...items].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  for (const item of sorted) {
    const date = startOfDay(new Date(item.timestamp));
    const key = date.toISOString();
    const existing = groups.get(key) || [];
    existing.push(item);
    groups.set(key, existing);
  }
  return groups;
}

function formatDayLabel(dateStr: string): string {
  const date = new Date(dateStr);
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "EEEE, MMM d");
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function KeyActivityFeed({
  businessId,
  className = "",
  maxItems = 100,
  showFilters = true,
  onActivityClick,
}: KeyActivityFeedProps) {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<ActivityType | "all">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  /* ---------------------------------------------------------------- */
  /*  Fetch activities                                                  */
  /* ---------------------------------------------------------------- */
  const fetchActivities = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `${API_BASE}/api/v1/cortex/activity?businessId=${businessId}&limit=${maxItems}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { activities?: ActivityItem[] };
      setActivities(data.activities || []);
      setLastUpdated(new Date());
    } catch (err) {
      setError((err as Error).message);
      // Load mock data for demo/development
      setActivities(getMockActivities());
    } finally {
      setLoading(false);
    }
  }, [businessId, maxItems]);

  /* Initial fetch */
  useEffect(() => {
    void fetchActivities();
  }, [fetchActivities]);

  /* Polling for real-time updates (paused while the tab is hidden) */
  useEffect(() => {
    if (!autoRefresh || !businessId) return;
    const interval = setInterval(() => {
      if (document.hidden) return;
      fetchActivities();
    }, 15000);
    return () => clearInterval(interval);
  }, [autoRefresh, businessId, fetchActivities]);

  /* ---------------------------------------------------------------- */
  /*  Approve / Reject                                                  */
  /* ---------------------------------------------------------------- */
  const handleAction = useCallback(
    async (item: ActivityItem, action: "approved" | "rejected") => {
      if (!businessId) return;

      setActivities((prev) =>
        prev.map((a) => (a.id === item.id ? { ...a, actionTaken: action } : a))
      );

      try {
        await fetch(`${API_BASE}/api/v1/cortex/activity/${item.id}/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ businessId, action }),
        });
      } catch {
        // Revert on error
        setActivities((prev) =>
          prev.map((a) => (a.id === item.id ? { ...a, actionTaken: null } : a))
        );
      }
    },
    [businessId]
  );

  /* ---------------------------------------------------------------- */
  /*  Filtered activities                                               */
  /* ---------------------------------------------------------------- */
  const filteredActivities = useMemo(() => {
    if (filterType === "all") return activities;
    return activities.filter((a) => a.type === filterType);
  }, [activities, filterType]);

  const grouped = useMemo(() => groupByDay(filteredActivities), [filteredActivities]);

  const unreadCount = useMemo(
    () => activities.filter((a) => !a.read).length,
    [activities]
  );

  /* ---------------------------------------------------------------- */
  /*  Render                                                            */
  /* ---------------------------------------------------------------- */
  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06] shrink-0">
        <div className="flex items-center gap-2.5">
          <h3 className="text-sm font-semibold text-[hsl(30_20%_98%)]">Activity Feed</h3>
          {unreadCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-[hsl(24_95%_53%)] text-white text-[10px] font-bold">
              {unreadCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setAutoRefresh((a) => !a)}
            className={`p-1.5 rounded-lg transition-colors ${
              autoRefresh
                ? "text-emerald-400 bg-emerald-500/10"
                : "text-[hsl(30_10%_50%)] hover:bg-white/[0.05]"
            }`}
            title={autoRefresh ? "Auto-refresh on" : "Auto-refresh off"}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${autoRefresh ? "animate-spin" : ""}`} style={{ animationDuration: "3s" }} />
          </button>
          <button
            onClick={fetchActivities}
            disabled={loading}
            className="p-1.5 rounded-lg hover:bg-white/[0.05] text-[hsl(30_10%_50%)] transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="shrink-0 px-4 py-2.5 border-b border-white/[0.04] flex items-center gap-1.5 overflow-x-auto">
          <Filter className="w-3.5 h-3.5 text-[hsl(30_10%_50%)] flex-shrink-0" />
          {(["all", "execution", "insight", "alert", "automation"] as const).map(
            (type) => (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className={`text-[11px] px-2.5 py-1 rounded-lg transition-colors whitespace-nowrap ${
                  filterType === type
                    ? "bg-white/[0.08] text-[hsl(30_20%_98%)] font-medium"
                    : "text-[hsl(30_10%_50%)] hover:bg-white/[0.04] hover:text-[hsl(30_20%_98%)]"
                }`}
              >
                {type === "all" ? "All" : TYPE_CONFIG[type].label}
                {type !== "all" && (
                  <span className="ml-1 text-[10px] text-[hsl(30_10%_40%)]">
                    {activities.filter((a) => a.type === type).length}
                  </span>
                )}
              </button>
            )
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 min-h-0">
        {error && (
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm bg-red-500/10 text-red-400 border border-red-500/20">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading && activities.length === 0 ? (
          <div className="flex items-center justify-center py-12 gap-2 text-[hsl(30_10%_50%)]">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Loading activity...</span>
          </div>
        ) : filteredActivities.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-[hsl(30_10%_50%)]">
            <Bot className="w-8 h-8 mb-2 opacity-40" />
            <p className="text-sm">No activity yet</p>
            <p className="text-[11px] mt-1">KEY will surface actions here</p>
          </div>
        ) : (
          <AnimatePresence>
            {Array.from(grouped.entries()).map(([dateKey, dayItems]) => (
              <motion.div
                key={dateKey}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-1"
              >
                {/* Day header */}
                <div className="flex items-center gap-2 py-1 sticky top-0 bg-[hsl(20_14%_6%)] z-10">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(30_10%_50%)]">
                    {formatDayLabel(dateKey)}
                  </span>
                  <div className="flex-1 h-px bg-white/[0.04]" />
                  <span className="text-[10px] text-[hsl(30_10%_40%)]">
                    {dayItems.length}
                  </span>
                </div>

                {/* Items */}
                {dayItems.map((item) => (
                  <ActivityRow
                    key={item.id}
                    item={item}
                    isExpanded={expandedId === item.id}
                    onToggle={() =>
                      setExpandedId((id) => (id === item.id ? null : item.id))
                    }
                    onAction={handleAction}
                    onClick={onActivityClick}
                  />
                ))}
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* Footer */}
      {lastUpdated && (
        <div className="shrink-0 px-4 py-2 border-t border-white/[0.04] text-center">
          <span className="text-[10px] text-[hsl(30_10%_40%)]">
            Last updated {format(lastUpdated, "h:mm:ss a")}
          </span>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ActivityRow sub-component                                          */
/* ------------------------------------------------------------------ */

function ActivityRow({
  item,
  isExpanded,
  onToggle,
  onAction,
  onClick,
}: {
  item: ActivityItem;
  isExpanded: boolean;
  onToggle: () => void;
  onAction: (item: ActivityItem, action: "approved" | "rejected") => void;
  onClick?: (item: ActivityItem) => void;
}) {
  const typeConfig = TYPE_CONFIG[item.type];
  const statusConfig = STATUS_CONFIG[item.status];
  const TypeIcon = typeConfig.icon;
  const StatusIcon = statusConfig.icon;

  return (
    <motion.div
      layout
      className={`rounded-xl border transition-all ${
        item.read
          ? "border-white/[0.04] bg-white/[0.02]"
          : "border-white/[0.08] bg-white/[0.03]"
      } ${onClick ? "cursor-pointer hover:bg-white/[0.05]" : ""}`}
      onClick={() => onClick?.(item)}
    >
      {/* Main row */}
      <div className="flex items-start gap-2.5 px-3 py-2.5" onClick={onToggle}>
        {/* Type icon */}
        <div
          className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${statusConfig.bg}`}
        >
          <TypeIcon className={`w-3.5 h-3.5 ${typeConfig.color}`} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[13px] text-[hsl(30_20%_98%)] leading-snug truncate">
              {item.title}
            </p>
            <StatusIcon className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${statusConfig.color}`} />
          </div>
          <p className="text-[11px] text-[hsl(30_10%_50%)] mt-0.5 line-clamp-2">
            {item.description}
          </p>

          {/* Meta row */}
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-[10px] text-[hsl(30_10%_40%)]">
              {format(new Date(item.timestamp), "h:mm a")}
            </span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded ${statusConfig.bg} ${statusConfig.color}`}
            >
              {statusConfig.label}
            </span>
            {item.metadata?.module && (
              <span className="text-[10px] text-[hsl(30_10%_40%)] bg-white/[0.04] px-1.5 py-0.5 rounded">
                {item.metadata.module}
              </span>
            )}
            <button className="ml-auto text-[hsl(30_10%_40%)] hover:text-[hsl(30_20%_98%)] transition-colors">
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Expanded details */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-1 border-t border-white/[0.04]">
              {item.details && (
                <pre className="text-[11px] text-[hsl(30_10%_55%)] bg-white/[0.02] rounded-lg p-2.5 overflow-x-auto mb-3">
                  {JSON.stringify(item.details, null, 2)}
                </pre>
              )}

              {/* Action buttons for pending actionable items */}
              {item.actionable && item.status === "pending" && !item.actionTaken && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onAction(item, "approved");
                    }}
                    className="flex-1 py-2 rounded-lg text-[11px] font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors flex items-center justify-center gap-1.5"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Approve
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onAction(item, "rejected");
                    }}
                    className="flex-1 py-2 rounded-lg text-[11px] font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors flex items-center justify-center gap-1.5"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Reject
                  </button>
                </div>
              )}

              {/* Action taken badge */}
              {item.actionTaken && (
                <div
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium ${
                    item.actionTaken === "approved"
                      ? "bg-emerald-500/10 text-emerald-400"
                      : "bg-red-500/10 text-red-400"
                  }`}
                >
                  {item.actionTaken === "approved" ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Approved
                    </>
                  ) : (
                    <>
                      <XCircle className="w-3.5 h-3.5" />
                      Rejected
                    </>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Mock data for development                                          */
/* ------------------------------------------------------------------ */

function getMockActivities(): ActivityItem[] {
  const now = new Date();
  return [
    {
      id: "act-1",
      type: "insight",
      status: "success",
      title: "Revenue up 12% this week",
      description:
        "Your revenue increased by 12% compared to last week. Top contributor: Enterprise plan upgrades.",
      timestamp: now.toISOString(),
      read: false,
      metadata: { module: "finance" },
    },
    {
      id: "act-2",
      type: "execution",
      status: "success",
      title: "Invoice #1042 sent to Acme Corp",
      description: "Automatically generated and sent invoice for $3,200.00 to Acme Corp.",
      timestamp: new Date(now.getTime() - 1000 * 60 * 15).toISOString(),
      read: false,
      metadata: { module: "invoicing", entityId: "inv-1042", entityType: "invoice" },
    },
    {
      id: "act-3",
      type: "alert",
      status: "warning",
      title: "3 leads haven't been followed up",
      description:
        "Leads from Sarah Chen, Mike Ross, and Emma Wilson are overdue for follow-up by 2+ days.",
      timestamp: new Date(now.getTime() - 1000 * 60 * 45).toISOString(),
      read: false,
      actionable: true,
      metadata: { module: "crm" },
    },
    {
      id: "act-4",
      type: "automation",
      status: "success",
      title: "Welcome email sequence triggered",
      description: "New contact James Bond was added. Welcome email sequence activated (3 emails over 7 days).",
      timestamp: new Date(now.getTime() - 1000 * 60 * 60).toISOString(),
      read: true,
      metadata: { module: "flows" },
    },
    {
      id: "act-5",
      type: "insight",
      status: "info",
      title: "Best time to post: Tuesdays 10am",
      description:
        "Based on your engagement data, Tuesday mornings see 34% higher open rates.",
      timestamp: new Date(now.getTime() - 1000 * 60 * 60 * 2).toISOString(),
      read: true,
      metadata: { module: "analytics" },
    },
    {
      id: "act-6",
      type: "execution",
      status: "error",
      title: "Payment retry failed for Invoice #1038",
      description: "Automatic payment collection failed for Invoice #1038 ($850). Customer card expired.",
      timestamp: new Date(now.getTime() - 1000 * 60 * 60 * 3).toISOString(),
      read: true,
      metadata: { module: "invoicing" },
    },
    {
      id: "act-7",
      type: "alert",
      status: "pending",
      title: "Approve: $500 ad spend increase",
      description: "KEY recommends increasing Meta ad spend by $500/week based on current ROAS of 4.2x.",
      timestamp: new Date(now.getTime() - 1000 * 60 * 60 * 5).toISOString(),
      read: false,
      actionable: true,
      metadata: { module: "marketing" },
    },
    {
      id: "act-8",
      type: "system",
      status: "success",
      title: "Daily backup completed",
      description: "All business data backed up successfully. Size: 24.3 MB.",
      timestamp: new Date(now.getTime() - 1000 * 60 * 60 * 6).toISOString(),
      read: true,
    },
  ];
}
