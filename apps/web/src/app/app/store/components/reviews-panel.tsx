"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Star, MessageSquare, Check, EyeOff, Filter, Send, Loader2, ChevronDown } from "lucide-react";
import { apiGet, apiPatch } from "@/lib/api";

type Review = {
  id: string;
  productId: string;
  customerName: string;
  customerEmail: string | null;
  rating: number;
  reviewText: string | null;
  status: string;
  sellerResponse: string | null;
  orderReference: string | null;
  createdAt: string;
};

type ReviewStats = {
  total: number;
  pending: number;
  approved: number;
  hidden: number;
  averageRating: number;
};

type Props = {
  businessId: string;
  products?: { id: string; name: string }[];
};

export function ReviewsPanel({ businessId, products = [] }: Props) {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [stats, setStats] = useState<ReviewStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  const productNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of products) map[p.id] = p.name;
    return map;
  }, [products]);

  const loadReviews = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ reviews: Review[]; stats: ReviewStats }>(
        `/site/businesses/${businessId}/reviews${statusFilter !== "all" ? `?status=${statusFilter}` : ""}`
      );
      if (res.data) {
        setReviews(res.data.reviews);
        setStats(res.data.stats);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, [businessId, statusFilter]);

  useEffect(() => {
    if (businessId) loadReviews();
  }, [businessId, loadReviews]);

  const handleModerate = async (reviewId: string, status: string) => {
    setSaving((prev) => ({ ...prev, [reviewId]: true }));
    try {
      await apiPatch(`/site/businesses/${businessId}/reviews/${reviewId}`, { status });
      await loadReviews();
    } catch {
    } finally {
      setSaving((prev) => ({ ...prev, [reviewId]: false }));
    }
  };

  const handleReply = async (reviewId: string) => {
    const text = replyText[reviewId]?.trim();
    if (!text) return;
    setSaving((prev) => ({ ...prev, [reviewId]: true }));
    try {
      await apiPatch(`/site/businesses/${businessId}/reviews/${reviewId}`, { sellerResponse: text });
      setReplyText((prev) => ({ ...prev, [reviewId]: "" }));
      await loadReviews();
    } catch {
    } finally {
      setSaving((prev) => ({ ...prev, [reviewId]: false }));
    }
  };

  const formatDate = (d: string) => {
    try {
      return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    } catch {
      return d;
    }
  };

  const statusColors: Record<string, { bg: string; text: string; label: string }> = {
    PENDING: { bg: "bg-amber-500/10", text: "text-amber-400", label: "Pending" },
    APPROVED: { bg: "bg-emerald-500/10", text: "text-emerald-400", label: "Approved" },
    HIDDEN: { bg: "bg-red-500/10", text: "text-red-400", label: "Hidden" },
  };

  const filteredReviews = statusFilter === "all"
    ? reviews
    : reviews.filter((r) => r.status === statusFilter);

  return (
    <div className="space-y-6">
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 space-y-1">
            <p className="text-xs text-zinc-500">Total Reviews</p>
            <p className="text-2xl font-bold text-white tabular-nums">{stats.total}</p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 space-y-1">
            <p className="text-xs text-zinc-500">Average Rating</p>
            <div className="flex items-center gap-2">
              <p className="text-2xl font-bold text-white tabular-nums">{stats.averageRating.toFixed(1)}</p>
              <Star className="w-5 h-5 text-amber-400 fill-amber-400" />
            </div>
          </div>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 space-y-1">
            <p className="text-xs text-amber-400/60">Pending</p>
            <p className="text-2xl font-bold text-amber-400 tabular-nums">{stats.pending}</p>
          </div>
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-1">
            <p className="text-xs text-emerald-400/60">Approved</p>
            <p className="text-2xl font-bold text-emerald-400 tabular-nums">{stats.approved}</p>
          </div>
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 space-y-1">
            <p className="text-xs text-red-400/60">Hidden</p>
            <p className="text-2xl font-bold text-red-400 tabular-nums">{stats.hidden}</p>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Filter className="w-4 h-4 text-zinc-500" />
        {[
          { key: "all", label: "All" },
          { key: "PENDING", label: "Pending" },
          { key: "APPROVED", label: "Approved" },
          { key: "HIDDEN", label: "Hidden" },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setStatusFilter(key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              statusFilter === key
                ? "bg-white/10 text-white"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-white/5"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-zinc-600" />
        </div>
      ) : filteredReviews.length === 0 ? (
        <div className="text-center py-12 space-y-3">
          <MessageSquare className="w-10 h-10 text-zinc-700 mx-auto" />
          <p className="text-sm text-zinc-500">No reviews yet</p>
          <p className="text-xs text-zinc-600">Reviews from your customers will appear here</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredReviews.map((review) => {
            const sc = statusColors[review.status] || statusColors.PENDING;
            const isExpanded = expandedId === review.id;
            const productName = productNameMap[review.productId] || review.productId;
            const isSaving = saving[review.id];

            return (
              <div
                key={review.id}
                className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden transition-colors hover:border-zinc-700"
              >
                <button
                  onClick={() => setExpandedId(isExpanded ? null : review.id)}
                  className="w-full p-4 flex items-center gap-4 text-left"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium text-white">{review.customerName}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${sc.bg} ${sc.text}`}>
                        {sc.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-zinc-500">
                      <span className="truncate">{productName}</span>
                      <span>{formatDate(review.createdAt)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <Star
                        key={s}
                        className={`w-3.5 h-3.5 ${s <= review.rating ? "text-amber-400 fill-amber-400" : "text-zinc-700"}`}
                      />
                    ))}
                  </div>
                  <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 space-y-3 border-t border-zinc-800 pt-3">
                    {review.reviewText && (
                      <p className="text-sm text-zinc-300 leading-relaxed">{review.reviewText}</p>
                    )}
                    {review.orderReference && (
                      <p className="text-xs text-zinc-500">Order: {review.orderReference}</p>
                    )}
                    {review.customerEmail && (
                      <p className="text-xs text-zinc-500">Email: {review.customerEmail}</p>
                    )}

                    {review.sellerResponse && (
                      <div className="p-3 rounded-lg bg-zinc-800/50 border-l-2 border-blue-500/40">
                        <p className="text-[10px] font-medium text-blue-400/60 mb-1">Your Response</p>
                        <p className="text-sm text-zinc-300">{review.sellerResponse}</p>
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      {review.status !== "APPROVED" && (
                        <button
                          onClick={() => handleModerate(review.id, "APPROVED")}
                          disabled={isSaving}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                        >
                          <Check className="w-3 h-3" /> Approve
                        </button>
                      )}
                      {review.status !== "HIDDEN" && (
                        <button
                          onClick={() => handleModerate(review.id, "HIDDEN")}
                          disabled={isSaving}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                        >
                          <EyeOff className="w-3 h-3" /> Hide
                        </button>
                      )}
                    </div>

                    {!review.sellerResponse && (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={replyText[review.id] || ""}
                          onChange={(e) => setReplyText((prev) => ({ ...prev, [review.id]: e.target.value }))}
                          placeholder="Write a reply..."
                          className="flex-1 px-3 py-2 rounded-lg border border-zinc-700 bg-zinc-800/50 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
                        />
                        <button
                          onClick={() => handleReply(review.id)}
                          disabled={isSaving || !replyText[review.id]?.trim()}
                          className="px-3 py-2 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors disabled:opacity-40"
                        >
                          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
