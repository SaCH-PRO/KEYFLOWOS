"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send, Clock, AlertCircle, CheckCircle, XCircle,
  RefreshCw, Loader2, ChevronDown, ChevronRight,
  Mail, MessageSquare, Globe, Layers, RotateCcw, Eye,
} from "lucide-react";
import { toast } from "sonner";
import {
  listOutboundContent, getDeliverySummary,
  retryAllFailedDeliveries,
} from "@/lib/client";
import type { OutboundContent, DeliverySummary, DeliverySummaryDelivery } from "@/lib/client";
import { DeliveryLog } from "./delivery-log";

interface OutboundHistoryProps {
  businessId: string;
  refreshTrigger?: number;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  Draft: { label: "Draft", color: "text-muted-foreground", icon: Clock },
  Queued: { label: "Queued", color: "text-blue-400", icon: Clock },
  Scheduled: { label: "Scheduled", color: "text-amber-400", icon: Clock },
  Sending: { label: "Sending", color: "text-blue-400", icon: Loader2 },
  Sent: { label: "Sent", color: "text-emerald-400", icon: CheckCircle },
  Published: { label: "Published", color: "text-emerald-400", icon: CheckCircle },
  Failed: { label: "Failed", color: "text-red-400", icon: XCircle },
  PartiallyFailed: { label: "Partial", color: "text-amber-400", icon: AlertCircle },
  Cancelled: { label: "Cancelled", color: "text-muted-foreground", icon: XCircle },
};

const CONTENT_TYPE_ICONS: Record<string, React.ElementType> = {
  campaign_email: Mail,
  social_post: Globe,
  whatsapp_message: MessageSquare,
  multi_channel_broadcast: Layers,
};

function ContentStatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.Draft;
  const Icon = config.icon;
  return (
    <span className={`flex items-center gap-1 text-[10px] font-medium ${config.color}`}>
      <Icon className={`w-3 h-3 ${status === "Sending" ? "animate-spin" : ""}`} />
      {config.label}
    </span>
  );
}

function ContentTypeIcon({ contentType }: { contentType: string }) {
  const Icon = CONTENT_TYPE_ICONS[contentType] || Globe;
  return <Icon className="w-3.5 h-3.5 text-muted-foreground" />;
}

function OutboundContentRow({ item, businessId }: { item: OutboundContent; businessId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [summary, setSummary] = useState<DeliverySummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const loadSummary = useCallback(async () => {
    if (summary || loadingSummary) return;
    setLoadingSummary(true);
    const res = await getDeliverySummary(item.id, businessId);
    if (res.data) setSummary(res.data);
    setLoadingSummary(false);
  }, [item.id, businessId, summary, loadingSummary]);

  const handleToggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) void loadSummary();
  };

  const handleRetryAll = async () => {
    const confirmed = window.confirm(`Retry all ${summary?.failed ?? 0} failed deliveries for this content?`);
    if (!confirmed) return;
    setRetrying(true);
    const res = await retryAllFailedDeliveries(item.id, businessId);
    if (res.error) toast.error(res.error);
    else toast.success(`Retrying ${res.data?.retried ?? 0} failed deliveries`);
    setRetrying(false);
    setSummary(null);
    void loadSummary();
  };

  const sentDate = item.publishedAt || item.scheduledAt || item.createdAt;

  return (
    <div className="border border-border/20 rounded-lg overflow-hidden">
      <button
        onClick={handleToggle}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/5 transition-colors text-left"
      >
        {expanded ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
        <ContentTypeIcon contentType={item.contentType} />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium truncate">
            {item.subject || item.body?.slice(0, 60) || "Untitled content"}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {new Date(sentDate).toLocaleDateString("en-TT", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
          </div>
        </div>
        <ContentStatusBadge status={item.status} />
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-3 border-t border-border/10">
              {loadingSummary && (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              )}

              {summary && (
                <div className="space-y-2 pt-2">
                  <div className="grid grid-cols-4 gap-2">
                    <div className="text-center p-2 rounded-lg bg-muted/10">
                      <div className="text-sm font-semibold text-emerald-400">{summary.published}</div>
                      <div className="text-[9px] text-muted-foreground">Delivered</div>
                    </div>
                    <div className="text-center p-2 rounded-lg bg-muted/10">
                      <div className="text-sm font-semibold text-red-400">{summary.failed}</div>
                      <div className="text-[9px] text-muted-foreground">Failed</div>
                    </div>
                    <div className="text-center p-2 rounded-lg bg-muted/10">
                      <div className="text-sm font-semibold text-blue-400">{summary.pending}</div>
                      <div className="text-[9px] text-muted-foreground">Pending</div>
                    </div>
                    <div className="text-center p-2 rounded-lg bg-muted/10">
                      <div className="text-sm font-semibold text-muted-foreground">{summary.cancelled}</div>
                      <div className="text-[9px] text-muted-foreground">Cancelled</div>
                    </div>
                  </div>

                  {summary.failed > 0 && (
                    <button
                      onClick={handleRetryAll}
                      disabled={retrying}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-40"
                    >
                      {retrying ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                      Retry {summary.failed} Failed
                    </button>
                  )}

                  {summary.deliveries && summary.deliveries.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Delivery Breakdown</div>
                      {summary.deliveries.map((d) => {
                        const dConfig = STATUS_CONFIG[d.status] || STATUS_CONFIG.Draft;
                        return (
                          <div key={d.id} className="flex items-center justify-between text-[11px] py-1 px-2 rounded bg-muted/5">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-muted-foreground">{d.platform || "Unknown"}</span>
                              {d.displayName && <span className="text-muted-foreground/50 truncate">({d.displayName})</span>}
                            </div>
                            <div className="flex items-center gap-2">
                              {d.errorMessage && <span className="text-[9px] text-red-400/70 truncate max-w-[120px]">{d.errorMessage}</span>}
                              <span className={`${dConfig.color} font-medium`}>{dConfig.label}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DeliveryStatsStrip({ items }: { items: OutboundContent[] }) {
  const stats = useMemo(() => {
    const sent = items.filter(c => c.status === "Sent" || c.status === "Published").length;
    const failed = items.filter(c => c.status === "Failed" || c.status === "PartiallyFailed").length;
    const pending = items.filter(c => c.status === "Queued" || c.status === "Sending").length;
    const scheduled = items.filter(c => c.status === "Scheduled").length;
    const total = items.length;
    const successRate = total > 0 ? Math.round((sent / total) * 100) : 0;
    return { sent, failed, pending, scheduled, total, successRate };
  }, [items]);

  if (stats.total === 0) return null;

  return (
    <div className="grid grid-cols-5 gap-2">
      <div className="text-center px-2 py-1.5 rounded-lg bg-emerald-500/5 border border-emerald-500/10">
        <div className="text-sm font-semibold text-emerald-400">{stats.sent}</div>
        <div className="text-[9px] text-muted-foreground">Delivered</div>
      </div>
      <div className="text-center px-2 py-1.5 rounded-lg bg-red-500/5 border border-red-500/10">
        <div className="text-sm font-semibold text-red-400">{stats.failed}</div>
        <div className="text-[9px] text-muted-foreground">Failed</div>
      </div>
      <div className="text-center px-2 py-1.5 rounded-lg bg-blue-500/5 border border-blue-500/10">
        <div className="text-sm font-semibold text-blue-400">{stats.pending}</div>
        <div className="text-[9px] text-muted-foreground">Pending</div>
      </div>
      <div className="text-center px-2 py-1.5 rounded-lg bg-amber-500/5 border border-amber-500/10">
        <div className="text-sm font-semibold text-amber-400">{stats.scheduled}</div>
        <div className="text-[9px] text-muted-foreground">Scheduled</div>
      </div>
      <div className="text-center px-2 py-1.5 rounded-lg bg-muted/10 border border-border/20">
        <div className={`text-sm font-semibold ${stats.successRate >= 80 ? "text-emerald-400" : stats.successRate >= 50 ? "text-amber-400" : "text-red-400"}`}>{stats.successRate}%</div>
        <div className="text-[9px] text-muted-foreground">Success</div>
      </div>
    </div>
  );
}

export function OutboundHistory({ businessId, refreshTrigger }: OutboundHistoryProps) {
  const [items, setItems] = useState<OutboundContent[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [showDeliveryLog, setShowDeliveryLog] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await listOutboundContent(businessId, {
      status: statusFilter || undefined,
      limit: 50,
    });
    if (res.data) setItems(res.data.filter(c => c.status !== "Draft"));
    setLoading(false);
  }, [businessId, statusFilter]);

  useEffect(() => { void load(); }, [load, refreshTrigger]);

  const statuses = ["Sent", "Scheduled", "Queued", "Sending", "Failed", "PartiallyFailed", "Cancelled"];

  if (showDeliveryLog) {
    return (
      <div className="space-y-3">
        <button
          onClick={() => setShowDeliveryLog(false)}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <ChevronRight className="w-3 h-3 rotate-180" /> Back to History
        </button>
        <DeliveryLog businessId={businessId} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Send className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
          <h3 className="text-sm font-semibold">Outbound History</h3>
          <span className="text-[10px] text-muted-foreground">({items.length})</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowDeliveryLog(true)}
            className="flex items-center gap-1 text-[10px] font-medium text-[hsl(var(--kf-accent2))] hover:underline"
          >
            <Eye className="w-3 h-3" /> Delivery Log
          </button>
          <button onClick={() => void load()} className="p-1 rounded hover:bg-muted/15" title="Refresh">
            <RefreshCw className={`w-3.5 h-3.5 text-muted-foreground ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <DeliveryStatsStrip items={items} />

      <div className="flex items-center gap-1 flex-wrap">
        <button
          onClick={() => setStatusFilter("")}
          className={`text-[10px] px-2 py-1 rounded-md transition-colors ${!statusFilter ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))]" : "text-muted-foreground hover:text-foreground"}`}
        >
          All
        </button>
        {statuses.map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`text-[10px] px-2 py-1 rounded-md transition-colors ${statusFilter === s ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))]" : "text-muted-foreground hover:text-foreground"}`}
          >
            {STATUS_CONFIG[s]?.label || s}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-8 space-y-2">
          <Send className="w-8 h-8 text-muted-foreground/30 mx-auto" />
          <p className="text-xs text-muted-foreground">No outbound content yet</p>
          <p className="text-[10px] text-muted-foreground/60">Published content will appear here</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {items.map(item => (
            <OutboundContentRow key={item.id} item={item} businessId={businessId} />
          ))}
        </div>
      )}
    </div>
  );
}
