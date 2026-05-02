"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Handshake,
  Check,
  X,
  Clock,
  Loader2,
  ArrowUpRight,
  ArrowDownLeft,
} from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import Image from "next/image";
import {
  fetchCollabRequests,
  respondToCollabRequest,
  type CollabRequest,
} from "@/lib/client";

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  PENDING: { label: "Pending", color: "text-amber-400 bg-amber-400/10", icon: Clock },
  ACCEPTED: { label: "Accepted", color: "text-emerald-400 bg-emerald-400/10", icon: Check },
  DECLINED: { label: "Declined", color: "text-red-400 bg-red-400/10", icon: X },
};

const TYPE_LABELS: Record<string, string> = {
  COLLABORATION: "Collaboration",
  REFERRAL: "Referral",
  PARTNERSHIP: "Partnership",
};

interface CollabRequestsProps {
  businessId: string | null;
}

export function CollabRequests({ businessId }: CollabRequestsProps) {
  const [requests, setRequests] = useState<CollabRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [direction, setDirection] = useState<"incoming" | "outgoing">("incoming");
  const [respondingId, setRespondingId] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await fetchCollabRequests(businessId, direction);
      if (res.data) setRequests(res.data);
    } catch {}
    setLoading(false);
  }, [businessId, direction]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrates async/server data into local state
    void loadRequests();
  }, [loadRequests]);

  const handleRespond = useCallback(async (requestId: string, status: "ACCEPTED" | "DECLINED") => {
    if (!businessId) return;
    setRespondingId(requestId);
    try {
      const res = await respondToCollabRequest(businessId, requestId, status);
      if (res.data && !('error' in res.data)) {
        setRequests((prev) => prev.map((r) => r.id === requestId ? { ...r, status, respondedAt: new Date().toISOString() } : r));
      }
    } catch {}
    setRespondingId(null);
  }, [businessId]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 p-0.5 rounded-lg bg-muted/30 border border-border w-fit">
        <button
          onClick={() => setDirection("incoming")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
            direction === "incoming"
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <ArrowDownLeft className="w-3 h-3" />
          Incoming
        </button>
        <button
          onClick={() => setDirection("outgoing")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
            direction === "outgoing"
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <ArrowUpRight className="w-3 h-3" />
          Outgoing
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="kf-card border border-border rounded-xl p-4 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-muted rounded w-1/3" />
                  <div className="h-2.5 bg-muted rounded w-2/3" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : requests.length === 0 ? (
        <EmptyState
          icon={Handshake}
          title={`No ${direction} requests`}
          description={direction === "incoming"
            ? "When other businesses send you collaboration or referral requests, they'll appear here."
            : "Requests you've sent to other businesses will appear here."
          }
        />
      ) : (
        <AnimatePresence mode="popLayout">
          {requests.map((req, i) => {
            const statusCfg = STATUS_CONFIG[req.status] ?? STATUS_CONFIG.PENDING;
            const StatusIcon = statusCfg.icon;
            const business = direction === "incoming" ? req.fromBusiness : req.toBusiness;

            return (
              <motion.div
                key={req.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="kf-card border border-border rounded-xl p-4"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] flex items-center justify-center text-white text-xs font-bold overflow-hidden flex-shrink-0">
                    {business.logoUrl ? (
                      <Image src={business.logoUrl} alt="" className="w-full h-full object-cover"  fill sizes="(max-width: 768px) 100vw, 50vw" unoptimized />
                    ) : (
                      business.name.charAt(0).toUpperCase()
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold truncate">{business.name}</p>
                      <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${statusCfg.color}`}>
                        <StatusIcon className="w-2.5 h-2.5" />
                        {statusCfg.label}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                        {TYPE_LABELS[req.type] ?? req.type}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{timeAgo(req.createdAt)}</span>
                    </div>
                    <p className="text-xs font-medium mt-2">{req.title}</p>
                    {req.message && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-3">{req.message}</p>
                    )}

                    {direction === "incoming" && req.status === "PENDING" && (
                      <div className="flex items-center gap-2 mt-3">
                        <button
                          onClick={() => handleRespond(req.id, "ACCEPTED")}
                          disabled={respondingId === req.id}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 text-xs font-medium transition-all disabled:opacity-50"
                        >
                          {respondingId === req.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                          Accept
                        </button>
                        <button
                          onClick={() => handleRespond(req.id, "DECLINED")}
                          disabled={respondingId === req.id}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs font-medium transition-all disabled:opacity-50"
                        >
                          <X className="w-3 h-3" />
                          Decline
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      )}
    </div>
  );
}
