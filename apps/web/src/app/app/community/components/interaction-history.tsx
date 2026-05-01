"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { FileText, UserPlus, Handshake, MessageSquare, Clock } from "lucide-react";
import { fetchInteractionHistory, type InteractionHistory as IH } from "@/lib/client";

interface InteractionHistoryProps {
  businessId: string;
  otherBusinessId: string;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-yellow-500/10 text-yellow-400",
  SENT: "bg-blue-500/10 text-blue-400",
  RESPONDED: "bg-emerald-500/10 text-emerald-400",
  ACCEPTED: "bg-emerald-500/10 text-emerald-400",
  DECLINED: "bg-red-500/10 text-red-400",
  COMPLETED: "bg-emerald-500/10 text-emerald-400",
  PROPOSED: "bg-blue-500/10 text-blue-400",
  IN_PROGRESS: "bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))]",
  VIEWED: "bg-blue-500/10 text-blue-400",
  EXPIRED: "bg-muted/50 text-muted-foreground",
};

export function InteractionHistorySection({ businessId, otherBusinessId }: InteractionHistoryProps) {
  const [history, setHistory] = useState<IH | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId || !otherBusinessId) return;
    fetchInteractionHistory(businessId, otherBusinessId)
      .then((res) => {
        if (res.data) setHistory(res.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [businessId, otherBusinessId]);

  if (loading) {
    return (
      <div className="kf-card rounded-xl p-5 border border-border/30 space-y-3 animate-pulse">
        <div className="h-4 w-32 bg-muted/40 rounded" />
        <div className="h-12 bg-muted/20 rounded" />
        <div className="h-12 bg-muted/20 rounded" />
      </div>
    );
  }

  if (!history) return null;

  const hasAny = history.quoteRequests.length > 0 || history.referrals.length > 0 || history.collaborations.length > 0 || history.recentMessages.length > 0;
  if (!hasAny) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="kf-card rounded-xl p-5 border border-border/30 space-y-4"
    >
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <Clock className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
        Your History
      </h3>

      {history.quoteRequests.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Quote Requests</p>
          {history.quoteRequests.map((qr) => (
            <div key={qr.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/10">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <span className="text-xs truncate">{qr.title}</span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLORS[qr.status] || "bg-muted/30 text-muted-foreground"}`}>
                  {qr.status}
                </span>
                <span className="text-[9px] text-muted-foreground">{timeAgo(qr.createdAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {history.referrals.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Referrals</p>
          {history.referrals.map((r) => (
            <div key={r.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/10">
              <div className="flex items-center gap-2 min-w-0">
                <UserPlus className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <span className="text-xs truncate">{r.opportunity}</span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLORS[r.status] || "bg-muted/30 text-muted-foreground"}`}>
                  {r.status}
                </span>
                <span className="text-[9px] text-muted-foreground">{timeAgo(r.createdAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {history.collaborations.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Collaborations</p>
          {history.collaborations.map((c) => (
            <div key={c.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/10">
              <div className="flex items-center gap-2 min-w-0">
                <Handshake className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <span className="text-xs truncate">{c.title}</span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLORS[c.status] || "bg-muted/30 text-muted-foreground"}`}>
                  {c.status}
                </span>
                <span className="text-[9px] text-muted-foreground">{timeAgo(c.createdAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {history.recentMessages.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Recent Messages</p>
          {history.recentMessages.map((m) => (
            <div key={m.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/10">
              <div className="flex items-center gap-2 min-w-0">
                <MessageSquare className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <span className="text-xs truncate">{m.content}</span>
              </div>
              <span className="text-[9px] text-muted-foreground flex-shrink-0">{timeAgo(m.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
