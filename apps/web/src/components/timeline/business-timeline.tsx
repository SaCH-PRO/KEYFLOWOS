"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
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
  Lock,
} from "lucide-react";
import { getContactEventLabel } from "@keyflow/shared";
import { apiGet } from "@/lib/api";
import type { CommandCenterResults } from "@/lib/api/business-command-center";
import { cn } from "@/lib/utils";

/**
 * One Activity row as GET /timeline/businesses/:id/events returns it (D-08:
 * Activity rows power the user feed; BusinessEvent is the audit trail).
 */
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
  revenueImpact?: number | null;
  occurredAt?: string | null;
  createdAt: string;
}

/**
 * V1-25-EVT-BUSINESS-FEED: the business feed reads the tenant-guarded timeline
 * (AuthGuard + BusinessGuard, proven on a real database by
 * evidence-feed.integration.test.ts), not the legacy /api/flows activity route.
 * The read is tenant-guarded only, not scope-filtered: the cockpit mounts it
 * through BusinessActivityFeed (below), which gates it on the caller's access.
 * The server refuses a page larger than TIMELINE_MAX_LIMIT
 * (apps/server/src/modules/timeline/dto/query-timeline.dto.ts), so the limit
 * sent is clamped to it: a caller asking for more gets the largest page, never
 * a 400.
 */
const TIMELINE_MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

function boundedLimit(limit: number): number {
  const n = Number.isFinite(limit) ? Math.trunc(limit) : DEFAULT_LIMIT;
  return Math.min(TIMELINE_MAX_LIMIT, Math.max(1, n));
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * The money figure a row carries: a payment row's `data.amount`, else an
 * invoice row's `data.total`, in `data.currency`. A figure without a currency
 * is not shown (a bare number is not an amount). Formatted from integer cents
 * (D-13), so float noise such as 0.1 + 0.2 never reaches the screen.
 */
function formatAmount(item: ActivityItem): string | null {
  const data = item.data ?? {};
  const value = toNumber(data.amount) ?? toNumber(data.total);
  const currency = typeof data.currency === "string" ? data.currency.trim() : "";
  if (value === null || !currency) return null;
  const cents = Math.round(value * 100);
  return `${currency} ${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Writers spell the module differently ("commerce", "FINANCE"); filter and style on one spelling. */
function moduleKey(item: ActivityItem): string {
  return (item.module ?? "").toLowerCase();
}

/** The feed is ordered by occurredAt; older rows without it fall back to createdAt. */
function occurredAt(item: ActivityItem): string {
  return item.occurredAt ?? item.createdAt;
}

/**
 * CR-V125-1: one domain event, two Activity rows. flow.module.ts registers both
 * ActivityEventListener and AutomationExecutorService, and each writes a feed
 * row (same module, action and entity) for each of these events: invoice.paid,
 * invoice.sent, invoice.overdue, booking.created, booking.confirmed,
 * contact.created, contact.updated. Until the writers are deduplicated at the
 * source (V1-55 / D-08), the feed shows such a pair once: the first row of it
 * in feed order (newest first).
 */
const DOUBLE_WRITTEN = new Set([
  "commerce:paid:invoice",
  "commerce:sent:invoice",
  "commerce:overdue:invoice",
  "bookings:created:booking",
  "bookings:confirmed:booking",
  "crm:created:contact",
  "crm:updated:contact",
]);
/** The two listeners handle the same emit, so their rows land milliseconds apart; a genuine repeat (a re-send) is minutes or days later. */
const DOUBLE_WRITE_WINDOW_MS = 10_000;

/**
 * CR-V125-2: CrmTimelineService mirrors every contact event into Activity
 * (module 'crm', entityType 'contact') with the raw event name as the title
 * ('invoice.payment_recorded') and JSON.stringify(data) as the detail.
 */
function isContactEventMirror(item: ActivityItem): boolean {
  return moduleKey(item) === "crm" && item.entityType === "contact" && item.title === item.action && /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(item.action);
}

/**
 * Contact events the business feed already shows as their own row: every
 * payment has its FINANCE payment_recorded row (written with it, R0-19
 * EF-01/EF-02), so its contact mirror is a second copy of the same payment.
 */
const MIRRORED_AS_OWN_ROW = new Set(["invoice.payment_recorded"]);

/**
 * The rows the business feed shows: contact mirrors of events that have their
 * own row are left out, and a double-written pair is shown once.
 */
function feedRows(items: ActivityItem[]): ActivityItem[] {
  const kept: ActivityItem[] = [];
  const seen = new Map<string, number[]>();
  for (const item of items) {
    if (isContactEventMirror(item) && MIRRORED_AS_OWN_ROW.has(item.action)) continue;
    const kind = `${moduleKey(item)}:${item.action}:${item.entityType}`;
    if (DOUBLE_WRITTEN.has(kind) && item.entityId) {
      const key = `${kind}:${item.entityId}`;
      const at = new Date(occurredAt(item)).getTime();
      const times = seen.get(key) ?? [];
      if (Number.isFinite(at) && times.some((t) => Math.abs(t - at) <= DOUBLE_WRITE_WINDOW_MS)) continue;
      seen.set(key, [...times, at]);
    }
    kept.push(item);
  }
  return kept;
}

/** A contact mirror's title is its event name; it shows the event's label instead ('Payment recorded', not 'invoice.payment_recorded'). */
function displayTitle(item: ActivityItem): string {
  if (!isContactEventMirror(item)) return item.title;
  const label = getContactEventLabel(item.action);
  if (label && label !== item.action) return label;
  const words = item.action.replace(/[._]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * A detail that is a serialized object (a contact mirror's JSON.stringify(data),
 * carrying references and user ids) is data, not a sentence: it is not shown.
 */
function displayDetail(item: ActivityItem): string | null {
  const detail = typeof item.detail === "string" ? item.detail.trim() : "";
  if (!detail) return null;
  if (detail.startsWith("{") || detail.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(detail);
      if (parsed !== null && typeof parsed === "object") return null;
    } catch {
      // Not JSON: an ordinary sentence that starts with a bracket.
    }
  }
  return detail;
}

type ModuleFilter = "all" | "commerce" | "finance" | "bookings" | "crm";

const MODULE_PILLS: { key: ModuleFilter; label: string; icon: typeof Circle }[] = [
  { key: "all", label: "All", icon: Filter },
  { key: "commerce", label: "Commerce", icon: DollarSign },
  { key: "finance", label: "Finance", icon: DollarSign },
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
  finance: { color: "hsl(var(--kf-success, 160 70% 45%))", bg: "hsl(var(--kf-success, 160 70% 45%) / 0.15)" },
  bookings: { color: "hsl(var(--kf-accent2))", bg: "hsl(var(--kf-accent2) / 0.15)" },
  crm: { color: "hsl(var(--kf-accent1))", bg: "hsl(var(--kf-accent1) / 0.15)" },
};

function getIcon(item: ActivityItem): typeof Circle {
  if (item.icon && ICON_MAP[item.icon]) return ICON_MAP[item.icon];
  const mod = moduleKey(item);
  if (mod === "commerce" || mod === "finance") return DollarSign;
  if (mod === "bookings") return Calendar;
  if (mod === "crm") return Users;
  return Circle;
}

function getToneStyle(item: ActivityItem): { color: string; bg: string } {
  if (item.tone && TONE_COLORS[item.tone]) return TONE_COLORS[item.tone];
  const mod = moduleKey(item);
  if (mod && MODULE_COLORS[mod]) return MODULE_COLORS[mod];
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
    const d = new Date(occurredAt(item));
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

/** The settled result of one read, tagged with the request it answers. */
interface FeedState {
  key: string;
  items: ActivityItem[];
  /** A read that failed is not an empty feed: it says so instead of "No activity yet". */
  failed: boolean;
}

const NO_ITEMS: ActivityItem[] = [];

export function BusinessTimeline({ businessId, compact = false, limit = DEFAULT_LIMIT }: BusinessTimelineProps) {
  const [feed, setFeed] = useState<FeedState | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [filter, setFilter] = useState<ModuleFilter>("all");
  const [expanded, setExpanded] = useState(!compact);
  const pageSize = boundedLimit(limit);
  const requestKey = `${businessId}|${pageSize}|${reloadKey}`;

  useEffect(() => {
    let cancelled = false;
    const key = `${businessId}|${pageSize}|${reloadKey}`;
    apiGet<ActivityItem[]>(`/timeline/businesses/${encodeURIComponent(businessId)}/events?limit=${pageSize}`)
      .then((res) => {
        if (cancelled) return;
        const ok = !res.error && Array.isArray(res.data);
        setFeed({ key, items: ok && res.data ? res.data : [], failed: !ok });
      })
      .catch(() => {
        if (!cancelled) setFeed({ key, items: [], failed: true });
      });
    return () => { cancelled = true; };
  }, [businessId, pageSize, reloadKey]);

  // Loading until the read for the current business, page size and retry has settled.
  const loading = feed?.key !== requestKey;
  const failed = !loading && feed !== null && feed.failed;
  const items = useMemo(() => (!loading && feed !== null ? feedRows(feed.items) : NO_ITEMS), [loading, feed]);

  const filtered = useMemo(
    () => (filter === "all" ? items : items.filter((i) => moduleKey(i) === filter)),
    [items, filter]
  );

  let body: ReactNode;
  if (loading) {
    body = (
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
  } else if (failed) {
    body = (
      <div data-testid="business-timeline-unavailable" role="status" className="text-center py-8 space-y-2">
        <div className="mx-auto w-10 h-10 rounded-full bg-muted/30 flex items-center justify-center">
          <AlertTriangle className="w-5 h-5 text-muted-foreground/60" />
        </div>
        <p className="text-sm text-muted-foreground">Activity unavailable</p>
        <p className="text-xs text-muted-foreground/60">The activity feed could not be loaded; this is not an empty feed.</p>
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          className="text-[10px] px-2 py-1 rounded-md bg-muted text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" /> Retry
        </button>
      </div>
    );
  } else if (items.length === 0) {
    body = (
      <div className="text-center py-8 space-y-2">
        <div className="mx-auto w-10 h-10 rounded-full bg-muted/30 flex items-center justify-center">
          <History className="w-5 h-5 text-muted-foreground/40" />
        </div>
        <p className="text-sm text-muted-foreground">No activity yet</p>
        <p className="text-xs text-muted-foreground/60">Events will appear here as your business grows.</p>
      </div>
    );
  } else {
    const visibleItems = expanded ? filtered : filtered.slice(0, 5);
    const visibleGroups = groupByDate(visibleItems);

    body = (
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
            const cnt = p.key === "all" ? items.length : items.filter((i) => moduleKey(i) === p.key).length;
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
                    const amount = formatAmount(item);
                    const detail = displayDetail(item);
                    return (
                      <motion.div
                        key={item.id}
                        data-testid="business-timeline-row"
                        data-action={item.action}
                        data-entity-id={item.entityId ?? ""}
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
                              <span className="text-xs font-medium truncate">{displayTitle(item)}</span>
                              <span
                                className="text-[9px] px-1.5 py-0.5 rounded-full whitespace-nowrap"
                                style={{ background: style.bg, color: style.color }}
                              >
                                {moduleKey(item)}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {amount && (
                                <span data-testid="business-timeline-amount" className="text-xs font-semibold tabular-nums whitespace-nowrap">
                                  {amount}
                                </span>
                              )}
                              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                {formatRelativeTime(occurredAt(item))}
                              </span>
                            </div>
                          </div>
                          {detail && (
                            <p data-testid="business-timeline-detail" className="text-[11px] text-muted-foreground mt-0.5">{detail}</p>
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

  return <div data-testid="business-timeline">{body}</div>;
}

/**
 * Whether the cockpit may show the business feed to this caller.
 *
 * SEC-V125-1 / SEC-V125-2: GET /timeline/businesses/:id/events is guarded by
 * AuthGuard + BusinessGuard only. It answers every Activity row of the business
 * to any member, with no module scope and no contact visibility: payment
 * amounts, invoice totals and numbers, and contact names. The server-side row
 * filter belongs to the timeline controller and service, outside this packet
 * (recorded as it.todo in evidence-feed.integration.test.ts). Until it lands,
 * the cockpit shows the feed only to a caller whom the V1-47 snapshot, which
 * resolves module scopes on the server (ModuleScopeGuard's rule), reports able
 * to read both revenue (open invoices, payments) and CRM (contacts). A tile
 * that says RESTRICTED means no feed; a snapshot that cannot say (no results,
 * or a tile that FAILED) means no feed either: never a guess.
 */
export type BusinessFeedAccess = "allowed" | "restricted" | "unknown";

export function businessFeedAccess(results: Partial<CommandCenterResults> | null | undefined): BusinessFeedAccess {
  if (!results) return "unknown";
  const tiles = [results.contacts, results.openInvoices, results.payments];
  if (tiles.some((tile) => tile?.status === "RESTRICTED")) return "restricted";
  if (tiles.every((tile) => tile?.status === "OK")) return "allowed";
  return "unknown";
}

interface BusinessActivityFeedProps extends BusinessTimelineProps {
  /** The V1-47 snapshot's result tiles for this caller (absent from a server that predates V1-47). */
  results: Partial<CommandCenterResults> | null | undefined;
}

/** The cockpit's business feed: BusinessTimeline behind the access gate above. The feed is not read unless access is confirmed. */
export function BusinessActivityFeed({ results, ...timeline }: BusinessActivityFeedProps) {
  const access = businessFeedAccess(results);
  if (access === "allowed") return <BusinessTimeline {...timeline} />;
  const restricted = access === "restricted";
  return (
    <div
      data-testid={restricted ? "business-timeline-restricted" : "business-timeline-unavailable"}
      role="status"
      className="text-center py-8 space-y-2"
    >
      <div className="mx-auto w-10 h-10 rounded-full bg-muted/30 flex items-center justify-center">
        {restricted ? <Lock className="w-5 h-5 text-muted-foreground/60" /> : <AlertTriangle className="w-5 h-5 text-muted-foreground/60" />}
      </div>
      <p className="text-sm text-muted-foreground">{restricted ? "No access" : "Activity unavailable"}</p>
      <p className="text-xs text-muted-foreground/60">
        {restricted
          ? "Business activity includes payments and contacts; it needs read access to revenue and CRM."
          : "Access to business activity could not be confirmed; this is not an empty feed."}
      </p>
    </div>
  );
}
