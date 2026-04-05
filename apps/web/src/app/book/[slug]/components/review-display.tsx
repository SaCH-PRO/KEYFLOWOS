"use client";

import { useState, useEffect } from "react";
import { Star, MessageSquare, Send, Loader2, CheckCircle2 } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";

type Review = {
  id: string;
  customerName: string;
  rating: number;
  reviewText: string | null;
  sellerResponse: string | null;
  createdAt: string;
};

type ReviewData = {
  reviews: Review[];
  averageRating: number;
  totalCount: number;
};

type Props = {
  slug: string;
  productId: string;
  productName: string;
  primaryColor: string;
};

function StarRating({ rating, size = 14, interactive = false, onChange }: {
  rating: number;
  size?: number;
  interactive?: boolean;
  onChange?: (r: number) => void;
}) {
  const [hover, setHover] = useState(0);

  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={!interactive}
          onClick={() => onChange?.(star)}
          onMouseEnter={() => interactive && setHover(star)}
          onMouseLeave={() => interactive && setHover(0)}
          className={interactive ? "cursor-pointer transition-transform hover:scale-110" : "cursor-default"}
        >
          <Star
            style={{ width: size, height: size }}
            className={`${(hover || rating) >= star ? "text-amber-400 fill-amber-400" : "text-white/15"} transition-colors`}
          />
        </button>
      ))}
    </div>
  );
}

export function StarRatingDisplay({ rating, count, size = 12 }: { rating: number; count: number; size?: number }) {
  if (count === 0) return null;
  return (
    <div className="flex items-center gap-1.5">
      <StarRating rating={Math.round(rating)} size={size} />
      <span className="text-[11px] text-white/40 tabular-nums">
        {rating.toFixed(1)} ({count})
      </span>
    </div>
  );
}

export function ReviewSection({ slug, productId, productName, primaryColor }: Props) {
  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [formData, setFormData] = useState({
    customerName: "",
    customerEmail: "",
    rating: 0,
    reviewText: "",
    orderReference: "",
  });

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const res = await apiGet<ReviewData>(`/site/storefront/public/${encodeURIComponent(slug)}/products/${productId}/reviews`);
      if (res.data) setData(res.data);
      setLoading(false);
    };
    load();
  }, [slug, productId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.rating === 0 || !formData.customerName.trim()) return;
    setSubmitting(true);
    try {
      await apiPost({
        path: `/site/storefront/public/${encodeURIComponent(slug)}/reviews`,
        body: {
          productId,
          customerName: formData.customerName,
          customerEmail: formData.customerEmail || undefined,
          rating: formData.rating,
          reviewText: formData.reviewText || undefined,
          orderReference: formData.orderReference || undefined,
        },
      });
      setSubmitted(true);
      setShowForm(false);
      setFormData({ customerName: "", customerEmail: "", rating: 0, reviewText: "", orderReference: "" });
    } catch {}
    setSubmitting(false);
  };

  const formatDate = (d: string) => {
    try {
      return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    } catch {
      return d;
    }
  };

  if (loading) {
    return (
      <div className="py-6 flex justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-white/20" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-white">Reviews</h3>
          {data && data.totalCount > 0 && (
            <div className="flex items-center gap-1.5">
              <StarRating rating={Math.round(data.averageRating)} size={14} />
              <span className="text-xs text-white/50 tabular-nums">
                {data.averageRating.toFixed(1)} ({data.totalCount})
              </span>
            </div>
          )}
        </div>
        {!submitted && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ backgroundColor: `${primaryColor}15`, color: primaryColor }}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Write a Review
          </button>
        )}
      </div>

      {submitted && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <p className="text-xs text-emerald-300">Thank you! Your review has been submitted and will appear once approved.</p>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="space-y-3 p-4 rounded-xl border border-white/10 bg-white/[0.02]">
          <div>
            <label className="text-xs text-white/50 mb-1 block">Your Rating *</label>
            <StarRating rating={formData.rating} size={24} interactive onChange={(r) => setFormData((prev) => ({ ...prev, rating: r }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-white/50 mb-1 block">Name *</label>
              <input
                type="text"
                value={formData.customerName}
                onChange={(e) => setFormData((prev) => ({ ...prev, customerName: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/20"
                placeholder="Your name"
                required
              />
            </div>
            <div>
              <label className="text-xs text-white/50 mb-1 block">Email</label>
              <input
                type="email"
                value={formData.customerEmail}
                onChange={(e) => setFormData((prev) => ({ ...prev, customerEmail: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/20"
                placeholder="email@example.com"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-white/50 mb-1 block">Order Reference</label>
            <input
              type="text"
              value={formData.orderReference}
              onChange={(e) => setFormData((prev) => ({ ...prev, orderReference: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/20"
              placeholder="Your order or booking ID"
            />
          </div>
          <div>
            <label className="text-xs text-white/50 mb-1 block">Review</label>
            <textarea
              value={formData.reviewText}
              onChange={(e) => setFormData((prev) => ({ ...prev, reviewText: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/20 resize-none"
              rows={3}
              placeholder={`Share your experience with ${productName}...`}
            />
          </div>
          <button
            type="submit"
            disabled={submitting || formData.rating === 0 || !formData.customerName.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white transition-all disabled:opacity-40"
            style={{ backgroundColor: primaryColor }}
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Submit Review
          </button>
        </form>
      )}

      {(!data || data.totalCount === 0) && !showForm && !submitted && (
        <div className="text-center py-6 space-y-2">
          <Star className="w-8 h-8 text-white/10 mx-auto" />
          <p className="text-sm text-white/30">No reviews yet — be the first!</p>
        </div>
      )}

      {data && data.reviews.length > 0 && (
        <div className="space-y-3">
          {data.reviews.map((review) => (
            <div key={review.id} className="p-3 rounded-xl border border-white/[0.06] bg-white/[0.02] space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-xs font-semibold text-white/60">
                    {review.customerName.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <span className="text-xs font-medium text-white/70">{review.customerName}</span>
                    <span className="text-[10px] text-white/30 ml-2">{formatDate(review.createdAt)}</span>
                  </div>
                </div>
                <StarRating rating={review.rating} size={12} />
              </div>
              {review.reviewText && <p className="text-xs text-white/50 leading-relaxed">{review.reviewText}</p>}
              {review.sellerResponse && (
                <div className="ml-4 p-2.5 rounded-lg bg-white/[0.03] border-l-2" style={{ borderColor: `${primaryColor}40` }}>
                  <p className="text-[10px] font-medium text-white/40 mb-1">Seller Response</p>
                  <p className="text-xs text-white/50">{review.sellerResponse}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
