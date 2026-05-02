"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  Mail,
  MessageSquare,
  Globe,
  RefreshCw,
  Filter,
} from "lucide-react";
import { toast } from "sonner";
import { listDeliveries, retryDelivery, getDeliveryEvents } from "@/lib/client";
import type { DeliveryListItem, DeliveryEventItem } from "@/lib/client";

interface DeliveryLogProps {
  businessId: string;
  contentId?: string;
}

const STATUS_STYLES: Record<string, { color: string; icon: React.ElementType; label: string }> = {
  Published: { color: "text-emerald-400", icon: CheckCircle, label: "Delivered" },
  Sent: { color: "text-emerald-400", icon: CheckCircle, label: "Sent" },
  Failed: { color: "text-red-400", icon: XCircle, label: "Failed" },
  Queued: { color: "text-blue-400", icon: Clock, label: "Queued" },
  Scheduled: { color: "text-amber-400", icon: Clock, label: "Scheduled" },
  Sending: { color: "text-blue-400", icon: Loader2, label: "Sending" },
  RetryPending: { color: "text-amber-400", icon: RotateCcw, label: "Retry Pending" },
  Cancelled: { color: "text-muted-foreground", icon: XCircle, label: "Cancelled" },
};

const PLATFORM_ICONS: Record<string, React.ElementType> = {
  GOOGLE: Mail,
  EMAIL: Mail,
  WHATSAPP: MessageSquare,
  FACEBOOK: Globe,
  INSTAGRAM: Globe,
  META: Globe,
};

function DeliveryRow({ item, businessId }: { item: DeliveryListItem; businessId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [events, setEvents] = useState<DeliveryEventItem[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const style = STATUS_STYLES[item.status] || STATUS_STYLES.Queued;
  const StatusIcon = style.icon;
  const PlatformIcon = PLATFORM_ICONS[item.destination?.platform || ""] || Globe;

  const loadEvents = useCallback(async () => {
    if (events.length > 0 || loadingEvents) return;
    setLoadingEvents(true);
    const res = await getDeliveryEvents(item.id, businessId);
    if (res.data) setEvents(res.data);
    setLoadingEvents(false);
  }, [item.id, businessId, events.length, loadingEvents]);

  const handleToggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) void loadEvents();
  };

  const handleRetry = async () => {
    const confirmed = window.confirm(`Retry delivery to ${item.destination?.displayName || item.destination?.platform || "this destination"}?`);
    if (!confirmed) return;
    setRetrying(true);
    const res = await retryDelivery(item.id, businessId);
    if (res.error) toast.error(res.error);
    else toast.success("Delivery queued for retry");
    setRetrying(false);
  };

  return (
    <div className="border border-border/15 rounded-lg overflow-hidden">
      <button
        onClick={handleToggle}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/5 transition-colors text-left"
      >
        {expanded ? <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" /> : <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />}
        <PlatformIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="text-[11px] font-medium truncate">
            {item.destination?.displayName || item.destination?.label || item.destination?.platform || "Unknown"}
          </span>
          {item.recipientEmail && (
            <span className="text-[10px] text-muted-foreground truncate">{item.recipientEmail}</span>
          )}
          {item.recipientPhone && (
            <span className="text-[10px] text-muted-foreground truncate">{item.recipientPhone}</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {item.retryCount > 0 && (
            <span className="text-[9px] text-amber-400/70">retry #{item.retryCount}</span>
          )}
          <span className={`flex items-center gap-1 text-[10px] font-medium ${style.color}`}>
            <StatusIcon className={`w-3 h-3 ${item.status === "Sending" ? "animate-spin" : ""}`} />
            {style.label}
          </span>
          <span className="text-[9px] text-muted-foreground/50">
            {new Date(item.sentAt || item.createdAt).toLocaleDateString("en-TT", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
          </span>
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-1 space-y-2 border-t border-border/10">
              {item.errorMessage && (
                <div className="flex items-start gap-2 text-[11px] text-red-400/80 bg-red-500/5 rounded-lg p-2">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <div>
                    {item.errorCode && <span className="font-mono text-[10px]">[{item.errorCode}] </span>}
                    {item.errorMessage}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 flex-wrap text-[10px] text-muted-foreground">
                {item.content?.subject && <span>Subject: {item.content.subject}</span>}
                {item.externalPostId && <span>External ID: {item.externalPostId}</span>}
                {item.externalUrl && (
                  <a href={item.externalUrl} target="_blank" rel="noopener noreferrer" className="text-[hsl(var(--kf-accent2))] hover:underline">
                    View
                  </a>
                )}
              </div>

              {item.status === "Failed" && (
                <button
                  onClick={handleRetry}
                  disabled={retrying}
                  className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-40"
                >
                  {retrying ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                  Retry
                </button>
              )}

              {loadingEvents && (
                <div className="flex items-center justify-center py-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                </div>
              )}

              {events.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/40">Event Timeline</div>
                  {events.map(evt => (
                    <div key={evt.id} className="flex items-center gap-2 text-[10px] py-0.5">
                      <span className="text-muted-foreground/50 shrink-0 w-[100px]">
                        {new Date(evt.createdAt).toLocaleTimeString("en-TT", { hour: "numeric", minute: "2-digit", second: "2-digit" })}
                      </span>
                      <span className={`font-medium ${evt.eventType === "success" ? "text-emerald-400" : evt.eventType === "failure" ? "text-red-400" : "text-muted-foreground"}`}>
                        {evt.eventType}
                      </span>
                      <span className="text-muted-foreground/50">{evt.statusBefore} → {evt.statusAfter}</span>
                      {evt.errorMessage && <span className="text-red-400/60 truncate">{evt.errorMessage}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function DeliveryLog({ businessId, contentId }: DeliveryLogProps) {
  const [deliveries, setDeliveries] = useState<DeliveryListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [contentTypeFilter, setContentTypeFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 30;

  const load = useCallback(async () => {
    setLoading(true);
    const res = await listDeliveries(businessId, {
      status: statusFilter || undefined,
      channel: channelFilter || undefined,
      contentId,
      contentType: contentTypeFilter || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      limit,
      offset,
    });
    if (res.data) {
      setDeliveries(res.data.deliveries);
      setTotal(res.data.total);
    }
    setLoading(false);
  }, [businessId, contentId, statusFilter, channelFilter, contentTypeFilter, dateFrom, dateTo, offset]);

  useEffect(() => { void load(); }, [load]);

  const statuses = ["Published", "Failed", "Queued", "Scheduled", "Sending", "RetryPending", "Cancelled"];
  const channels = ["EMAIL", "WHATSAPP", "FACEBOOK", "INSTAGRAM"];
  const hasMore = offset + limit < total;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          <h4 className="text-xs font-semibold">Delivery Log</h4>
          <span className="text-[10px] text-muted-foreground">({total} total)</span>
        </div>
        <button onClick={() => void load()} className="p-1 rounded hover:bg-muted/15" title="Refresh">
          <RefreshCw className={`w-3 h-3 text-muted-foreground ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setOffset(0); }}
          className="text-[10px] bg-transparent border border-border/30 rounded-md px-2 py-1 text-foreground focus:outline-none"
        >
          <option value="">All statuses</option>
          {statuses.map(s => <option key={s} value={s}>{STATUS_STYLES[s]?.label || s}</option>)}
        </select>
        <select
          value={channelFilter}
          onChange={e => { setChannelFilter(e.target.value); setOffset(0); }}
          className="text-[10px] bg-transparent border border-border/30 rounded-md px-2 py-1 text-foreground focus:outline-none"
        >
          <option value="">All channels</option>
          {channels.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={contentTypeFilter}
          onChange={e => { setContentTypeFilter(e.target.value); setOffset(0); }}
          className="text-[10px] bg-transparent border border-border/30 rounded-md px-2 py-1 text-foreground focus:outline-none"
        >
          <option value="">All types</option>
          <option value="campaign_email">Email</option>
          <option value="social_post">Social</option>
          <option value="whatsapp_message">WhatsApp</option>
          <option value="multi_channel_broadcast">Multi-Channel</option>
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={e => { setDateFrom(e.target.value); setOffset(0); }}
          className="text-[10px] bg-transparent border border-border/30 rounded-md px-2 py-1 text-foreground focus:outline-none"
          placeholder="From"
        />
        <input
          type="date"
          value={dateTo}
          onChange={e => { setDateTo(e.target.value); setOffset(0); }}
          className="text-[10px] bg-transparent border border-border/30 rounded-md px-2 py-1 text-foreground focus:outline-none"
          placeholder="To"
        />
        {(statusFilter || channelFilter || contentTypeFilter || dateFrom || dateTo) && (
          <button
            onClick={() => { setStatusFilter(""); setChannelFilter(""); setContentTypeFilter(""); setDateFrom(""); setDateTo(""); setOffset(0); }}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      ) : deliveries.length === 0 ? (
        <div className="text-center py-6">
          <p className="text-xs text-muted-foreground">No deliveries found</p>
        </div>
      ) : (
        <div className="space-y-1">
          {deliveries.map(d => (
            <DeliveryRow key={d.id} item={d} businessId={businessId} />
          ))}
        </div>
      )}

      {(hasMore || offset > 0) && (
        <div className="flex items-center justify-between pt-1">
          <button
            onClick={() => setOffset(Math.max(0, offset - limit))}
            disabled={offset === 0}
            className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-30"
          >
            Previous
          </button>
          <span className="text-[9px] text-muted-foreground">
            {offset + 1}–{Math.min(offset + limit, total)} of {total}
          </span>
          <button
            onClick={() => setOffset(offset + limit)}
            disabled={!hasMore}
            className="text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-30"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
