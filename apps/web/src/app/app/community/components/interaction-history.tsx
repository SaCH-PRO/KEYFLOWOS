// @keyflow:dormant
"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { FileText, UserPlus, Handshake, MessageSquare, Clock, Star, CheckCircle2, XCircle } from "lucide-react";
import {
  fetchInteractionHistory,
  fetchReviewableTransactions,
  createCommunityReview,
  markReferralOutcome,
  type InteractionHistory as IH,
  type ReviewableTransaction,
} from "@/lib/client";
import { ReviewModal } from "./review-modal";

interface InteractionHistoryProps {
  businessId: string;
  otherBusinessId: string;
  otherBusinessName?: string;
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
  CONVERTED: "bg-emerald-500/10 text-emerald-400",
  NOT_CONVERTED: "bg-red-500/10 text-red-400",
};

export function InteractionHistorySection({ businessId, otherBusinessId, otherBusinessName }: InteractionHistoryProps) {
  const [history, setHistory] = useState<IH | null>(null);
  const [reviewable, setReviewable] = useState<ReviewableTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewTarget, setReviewTarget] = useState<ReviewableTransaction | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    if (!businessId || !otherBusinessId) return;
    const [h, r] = await Promise.all([
      fetchInteractionHistory(businessId, otherBusinessId).catch(() => ({ data: null as IH | null })),
      fetchReviewableTransactions(businessId, otherBusinessId).catch(() => ({ data: [] as ReviewableTransaction[] })),
    ]);
    if (h?.data) setHistory(h.data);
    setReviewable(r?.data ?? []);
    setLoading(false);
  }, [businessId, otherBusinessId]);

  useEffect(() => {
    setLoading(true);
    loadAll();
  }, [loadAll]);

  const submitReview = async (data: {
    rating: number;
    title?: string;
    body?: string;
    qualityRating?: number;
    communicationRating?: number;
    timelinessRating?: number;
    isPublic: boolean;
  }) => {
    if (!reviewTarget) return;
    await createCommunityReview(businessId, {
      revieweeBusinessId: otherBusinessId,
      transactionType: reviewTarget.type,
      transactionId: reviewTarget.id,
      ...data,
    });
    await loadAll();
  };

  const handleReferralOutcome = async (referralId: string, outcome: "CONVERTED" | "NOT_CONVERTED") => {
    setBusyId(referralId);
    try {
      await markReferralOutcome(businessId, referralId, outcome);
      await loadAll();
    } finally {
      setBusyId(null);
    }
  };

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

  const pendingReview = reviewable.filter((r) => !r.alreadyReviewed);
  const hasAny =
    history.quoteRequests.length > 0 ||
    history.referrals.length > 0 ||
    history.collaborations.length > 0 ||
    history.recentMessages.length > 0 ||
    pendingReview.length > 0;
  if (!hasAny) return null;

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="kf-card rounded-xl p-5 border border-border/30 space-y-4"
      >
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Clock className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          Your History
        </h3>

        {pendingReview.length > 0 && (
          <div className="space-y-2 p-3 rounded-lg bg-amber-400/5 border border-amber-400/20">
            <p className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold flex items-center gap-1">
              <Star className="w-3 h-3" /> Ready to review
            </p>
            {pendingReview.map((r) => (
              <div key={`${r.type}-${r.id}`} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs truncate">{r.title}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {r.type.replace("_", " ").toLowerCase()} · {timeAgo(r.createdAt)}
                  </p>
                </div>
                <button
                  onClick={() => setReviewTarget(r)}
                  className="px-2.5 py-1 rounded-lg bg-amber-400 text-black text-[11px] font-semibold hover:bg-amber-300 transition-colors flex-shrink-0"
                >
                  Leave review
                </button>
              </div>
            ))}
          </div>
        )}

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
            {history.referrals.map((r) => {
              const isFromMe = r.fromBusinessId === businessId;
              const canMarkOutcome = isFromMe && r.status === "ACCEPTED";
              return (
                <div key={r.id} className="space-y-1.5 p-2 rounded-lg bg-muted/10">
                  <div className="flex items-center justify-between gap-2">
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
                  {canMarkOutcome && (
                    <div className="flex items-center gap-2 pt-1">
                      <span className="text-[10px] text-muted-foreground">Did this convert?</span>
                      <button
                        onClick={() => handleReferralOutcome(r.id, "CONVERTED")}
                        disabled={busyId === r.id}
                        className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 text-[10px] font-medium hover:bg-emerald-500/20 disabled:opacity-50 flex items-center gap-1"
                      >
                        <CheckCircle2 className="w-3 h-3" /> Converted
                      </button>
                      <button
                        onClick={() => handleReferralOutcome(r.id, "NOT_CONVERTED")}
                        disabled={busyId === r.id}
                        className="px-2 py-0.5 rounded-md bg-red-500/10 text-red-400 text-[10px] font-medium hover:bg-red-500/20 disabled:opacity-50 flex items-center gap-1"
                      >
                        <XCircle className="w-3 h-3" /> Didn&apos;t pan out
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
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

      <ReviewModal
        isOpen={!!reviewTarget}
        onClose={() => setReviewTarget(null)}
        toBusinessName={otherBusinessName ?? "this business"}
        transactionLabel={reviewTarget?.title}
        onSubmit={submitReview}
      />
    </>
  );
}