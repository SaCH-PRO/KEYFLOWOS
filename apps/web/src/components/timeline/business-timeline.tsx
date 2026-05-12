"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Calendar,
  DollarSign,
  Users,
  FileText,
  Mail,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Star,
  Clock,
  RefreshCw,
  UserPlus,
  Sparkles,
  GitMerge,
  Download,
  Filter,
  ChevronDown,
  ChevronUp,
  History,
  Circle,
} from "lucide-react";
import { apiGet } from "@/lib/api";
import { cn } from "@/lib/utils";

interface ActivityItem {
  id: string;
  module: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  title: string;
  detail?: string | null;
  icon?: string | null;
  tone?: string | null;
  data?: Record<string, unknown> | null;
  contactId?: string | null;
  createdAt: string;
}

type ModuleFilter = "all" | "commerce" | "bookings" | "crm";

const MODULE_PILLS: { key: ModuleFilter; label: string; icon: typeof Circle }[] = [
  { key: "all", label: "All", icon: Filter },
  { key: "commerce", label: "Commerce", icon: DollarSign },
  { key: "bookings", label: "Bookings", icon: Calendar },
  { key: "crm", label: "CRM", icon: Users },
];

const ICON_MAP: Record<string, typeof Circle> = {
  "file-text": FileText,
  "dollar-sign": DollarSign,
  mail: Mail,
  "check-circle": CheckCircle,
  "x-circle": XCircle,
  "alert-triangle": AlertTriangle,
  star: Star,
  clock: Clock,
  "refresh-cw": RefreshCw,
  "user-plus": UserPlus,
  sparkles: Sparkles,
  "git-merge": GitMerge,
  download: Download,
  calendar: Calendar,
  users: Users,
};

const TONE_COLORS: Record<string, { color: string; bg: string }> = {
  success: { color: "hsl(var(--kf-success, 160 70% 45%))", bg: "hsl(var(--kf-success, 160 70% 45%) / 0.15)" },
  info: { color: "hsl(var(--kf-info, 210 90% 55%))", bg: "hsl(var(--kf-info, 210 90% 55%) / 0.15)" },
  warning: { color: "hsl(var(--kf-warning, 30 90% 50%))", bg: "hsl(var(--kf-warning, 30 90% 50%) / 0.15)" },
  danger: { color: "hsl(var(--kf-error, 0 70% 55%))", bg: "hsl(var(--kf-error, 0 70% 55%) / 0.15)" },
};

const MODULE_COLORS: Record<string, { color: string; bg: string }> = {
  commerce: { color: "hsl(var(--kf-info, 210 90% 55%))", bg: "hsl(var(--kf-info, 210 90% 55%) / 0.15)" },
  bookings: { color: "hsl(var(--kf-accent2))", bg: "hsl(var(--kf-accent2) / 0.15)" },
  crm: { color: "hsl(var(--kf-accent1))", bg: "hsl(var(--kf-accent1) / 0.15)" },
};

function getIcon(item: ActivityItem): typeof Circle {
  if (item.icon && ICON_MAP[item.icon]) return ICON_MAP[item.icon];
  if (item.module === "commerce") return DollarSign;
  if (item.module === "bookings") return Calendar;
  if (item.module === "crm") return Users;
  return Circle;
}

function getToneStyle(item: ActivityItem): { color: string; bg: string } {
  if (item.tone && TONE_COLORS[item.tone]) return TONE_COLORS[item.tone];
  if (item.module && MODULE_COLORS[item.module]) return MODULE_COLORS[item.module];
  return { color: "hsl(var(--kf-muted-foreground))", bg: "hsl(var(--kf-muted-foreground) / 0.1)" };
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function groupByDate(items: ActivityItem[]) {
  const groups: { label: string; items: ActivityItem[] }[] = [];
  let cur = "";
  for (const item of items) {
    const d = new Date(item.createdAt);
    const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
    let label: string;
    if (diff <= 0) label = "Today";
    else if (diff === 1) label = "Yesterday";
    else if (diff < 7) label = "This Week";
    else if (diff < 30) label = "This Month";
    else if (diff < 90) label = "Last 3 Months";
    else label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    if (label !== cur) {
      groups.push({ label, items: [] });
      cur = label;
    }
    groups[groups.length - 1].items.push(item);
  }
  return groups;
}

interface BusinessTimelineProps {
  businessId: string;
  compact?: boolean;
  limit?: number;
}

export function BusinessTimeline({ businessId, compact = false, limit = 50 }: BusinessTimelineProps) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ModuleFilter>("all");
  const [expanded, setExpanded] = useState(!compact);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiGet<ActivityItem[]>(`/flow/businesses/${businessId}/activity?limit=${limit}`)
      .then((res) => {
        if (!cancelled && Array.isArray(res.data)) {
          setItems(res.data);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [businessId, limit]);

  const filtered = useMemo(
    () => (filter === "all" ? items : items.filter((i) => i.module === filter)),
    [items, filter]
  );

  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-3 bg-muted rounded w-3/4" />
              <div className="h-2 bg-muted rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-8 space-y-2">
        <div className="mx-auto w-10 h-10 rounded-full bg-muted/30 flex items-center justify-center">
          <History className="w-5 h-5 text-muted-foreground/40" />
        </div>
        <p className="text-sm text-muted-foreground">No activity yet</p>
        <p className="text-xs text-muted-foreground/60">Events will appear here as your business grows.</p>
      </div>
    );
  }

  const visibleItems = expanded ? filtered : filtered.slice(0, 5);
  const visibleGroups = groupByDate(visibleItems);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <History className="w-3.5 h-3.5 text-[hsl(var(--kf-accent1))]" />
          Activity Timeline
        </div>
        {compact && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-[10px] px-2 py-1 rounded-md bg-muted text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            {expanded ? <><ChevronUp className="w-3 h-3" /> Show less</> : <><ChevronDown className="w-3 h-3" /> Expand</>}
          </button>
        )}
      </div>

      <div className="flex items-center gap-1 flex-wrap">
        {MODULE_PILLS.map((p) => {
          const cnt = p.key === "all" ? items.length : items.filter((i) => i.module === p.key).length;
          const active = filter === p.key;
          if (p.key !== "all" && cnt === 0) return null;
          return (
            <button
              key={p.key}
              onClick={() => setFilter(p.key)}
              className={cn(
                "text-[10px] px-2 py-1 rounded-md transition-colors flex items-center gap-1",
                active ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))]" : "bg-muted text-muted-foreground hover:text-foreground"
              )}
            >
              <p.icon className="w-3 h-3" />
              {p.label}
              {cnt > 0 && <span className="text-[9px] opacity-70">({cnt})</span>}
            </button>
          );
        })}
      </div>

      {visibleGroups.length === 0 ? (
        <div className="text-center py-4 text-xs text-muted-foreground">No entries for this filter</div>
      ) : (
        <div className="space-y-4">
          {visibleGroups.map((group) => (
            <div key={group.label}>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 pl-1">
                {group.label}
              </div>
              <div className="relative pl-5 space-y-2">
                <div className="absolute left-[7px] top-1 bottom-1 w-0.5 bg-gradient-to-b from-[hsl(var(--kf-accent1))] via-[hsl(var(--kf-accent2))] to-muted/30" />
                {group.items.map((item, idx) => {
                  const Icon = getIcon(item);
                  const style = getToneStyle(item);
                  return (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.02, duration: 0.18 }}
                      className="relative flex gap-2.5 group"
                    >
                      <div
                        className="absolute left-[-14px] p-1 rounded-full bg-background border-2 z-10"
                        style={{ borderColor: style.color }}
                      >
                        <Icon className="w-2.5 h-2.5" style={{ color: style.color }} />
                      </div>
                      <div className="flex-1 ml-2 p-2 rounded-xl bg-muted/20 border border-border/40 hover:border-border/60 transition-colors">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-xs font-medium truncate">{item.title}</span>
                            <span
                              className="text-[9px] px-1.5 py-0.5 rounded-full whitespace-nowrap"
                              style={{ background: style.bg, color: style.color }}
                            >
                              {item.module}
                            </span>
                          </div>
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
                            {formatRelativeTime(item.createdAt)}
                          </span>
                        </div>
                        {item.detail && (
                          <p className="text-[11px] text-muted-foreground mt-0.5">{item.detail}</p>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {!expanded && filtered.length > 5 && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full text-center text-xs text-muted-foreground hover:text-foreground py-2 flex items-center justify-center gap-1"
        >
          <ChevronDown className="w-3 h-3" /> Show more ({filtered.length - 5} remaining)
        </button>
      )}
    </div>
  );
}
