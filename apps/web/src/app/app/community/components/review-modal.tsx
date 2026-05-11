// @keyflow:dormant
"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Star, Send, Sparkles, MessageSquare, Clock } from "lucide-react";

interface ReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  toBusinessName: string;
  transactionLabel?: string;
  onSubmit: (data: {
    rating: number;
    title?: string;
    body?: string;
    qualityRating?: number;
    communicationRating?: number;
    timelinessRating?: number;
    isPublic: boolean;
  }) => Promise<void>;
}

function StarRow({
  value,
  onChange,
  size = 24,
}: {
  value: number;
  onChange: (v: number) => void;
  size?: number;
}) {
  const [hover, setHover] = useState(0);
  const display = hover || value;
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(0)}
          onClick={() => onChange(n)}
          className="transition-transform hover:scale-110"
          aria-label={`Rate ${n} of 5`}
        >
          <Star
            style={{ width: size, height: size }}
            className={
              n <= display
                ? "fill-amber-400 text-amber-400"
                : "text-muted-foreground/40"
            }
          />
        </button>
      ))}
    </div>
  );
}

export function ReviewModal({
  isOpen,
  onClose,
  toBusinessName,
  transactionLabel,
  onSubmit,
}: ReviewModalProps) {
  const [rating, setRating] = useState(0);
  const [quality, setQuality] = useState(0);
  const [communication, setCommunication] = useState(0);
  const [timeliness, setTimeliness] = useState(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (rating < 1) return;
    setSubmitting(true);
    try {
      await onSubmit({
        rating,
        title: title.trim() || undefined,
        body: body.trim() || undefined,
        qualityRating: quality || undefined,
        communicationRating: communication || undefined,
        timelinessRating: timeliness || undefined,
        isPublic,
      });
      setRating(0);
      setQuality(0);
      setCommunication(0);
      setTimeliness(0);
      setTitle("");
      setBody("");
      setIsPublic(true);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed inset-x-4 top-[6%] sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 z-50 w-auto sm:w-full sm:max-w-lg"
          >
            <div className="kf-card border border-border/50 rounded-2xl overflow-hidden shadow-2xl max-h-[88vh] overflow-y-auto">
              <div className="flex items-center justify-between p-4 border-b border-border/30">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-amber-400/10">
                    <Star className="w-4 h-4 text-amber-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">Leave a Review</h3>
                    <p className="text-[10px] text-muted-foreground">
                      for {toBusinessName}
                      {transactionLabel ? ` · ${transactionLabel}` : ""}
                    </p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="p-1.5 rounded-full hover:bg-muted/50 transition-colors"
                >
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>

              <div className="p-4 space-y-4">
                <div className="text-center py-2">
                  <p className="text-xs font-medium text-muted-foreground mb-2">
                    Overall rating
                  </p>
                  <div className="flex justify-center">
                    <StarRow value={rating} onChange={setRating} size={32} />
                  </div>
                  {rating > 0 && (
                    <p className="text-[11px] text-muted-foreground mt-2">
                      {["Poor", "Fair", "Good", "Great", "Excellent"][rating - 1]}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-3 pt-2 border-t border-border/30">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                      <Sparkles className="w-3 h-3" /> Quality of work
                    </label>
                    <StarRow value={quality} onChange={setQuality} size={18} />
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                      <MessageSquare className="w-3 h-3" /> Communication
                    </label>
                    <StarRow
                      value={communication}
                      onChange={setCommunication}
                      size={18}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                      <Clock className="w-3 h-3" /> Timeliness
                    </label>
                    <StarRow value={timeliness} onChange={setTimeliness} size={18} />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">
                    Headline (optional)
                  </label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Sum up your experience"
                    maxLength={120}
                    className="w-full px-3 py-2 rounded-lg bg-muted/30 border border-border/30 text-sm focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]/50"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">
                    Tell others what stood out (optional)
                  </label>
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder="Share details that would help other businesses..."
                    rows={4}
                    maxLength={1500}
                    className="w-full px-3 py-2 rounded-lg bg-muted/30 border border-border/30 text-sm focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]/50 resize-none"
                  />
                </div>

                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isPublic}
                    onChange={(e) => setIsPublic(e.target.checked)}
                    className="rounded border-border/50"
                  />
                  Make this review public on their profile
                </label>
              </div>

              <div className="p-4 border-t border-border/30 flex gap-2">
                <button
                  onClick={onClose}
                  className="flex-1 px-4 py-2 rounded-xl bg-muted/30 text-sm font-medium hover:bg-muted/50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={rating < 1 || submitting}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-[hsl(var(--kf-accent1))] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  {submitting ? "Submitting..." : "Submit review"}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}