"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ThumbsUp, ThumbsDown, Send, X, MessageSquare } from "lucide-react";
import { createUserFeedback, createAiQualitySignal } from "@/lib/api/product-analytics";
import { getStoredBusinessId } from "@/lib/workspace";

export type FeedbackTarget = "key_response" | "command_item" | "page" | "feature" | "recommendation";

interface FeedbackWidgetProps {
  target: FeedbackTarget;
  targetId?: string;
  module?: string;
  page?: string;
  context?: Record<string, unknown>;
  compact?: boolean;
  onSubmitted?: () => void;
}

export function FeedbackWidget({
  target,
  targetId,
  module,
  page,
  context,
  compact = false,
  onSubmitted,
}: FeedbackWidgetProps) {
  const businessId = getStoredBusinessId() ?? "";
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!businessId) return;
    setSubmitting(true);
    setError(null);
    try {
      if (target === "key_response" || target === "command_item") {
        await createAiQualitySignal(businessId, {
          commandId: targetId,
          module: module ?? target,
          signalType: rating === "up" ? "helpful" : "unhelpful",
          rating: rating === "up" ? 5 : 1,
          comment: comment || undefined,
          context: {
            target,
            targetId,
            ...context,
          },
        });
      } else {
        await createUserFeedback(businessId, {
          module: module ?? undefined,
          page: page ?? undefined,
          feedbackType: rating === "up" ? "praise" : "confusion",
          rating: rating === "up" ? 5 : 1,
          message: comment || undefined,
          context: {
            target,
            targetId,
            ...context,
          },
        });
      }
      setSubmitted(true);
      onSubmitted?.();
    } catch {
      setError("Failed to send feedback");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <motion.span
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="inline-flex items-center gap-1 text-xs text-emerald-500"
      >
        <Send className="w-3 h-3" />
        Thanks for your feedback
      </motion.span>
    );
  }

  if (compact && !rating) {
    return (
      <div className="inline-flex items-center gap-1">
        <span className="text-[10px] text-muted-foreground">Helpful?</span>
        <button
          onClick={() => setRating("up")}
          className="p-1 rounded hover:bg-emerald-500/10 transition-colors"
          aria-label="Thumbs up"
        >
          <ThumbsUp className="w-3 h-3 text-muted-foreground hover:text-emerald-500" />
        </button>
        <button
          onClick={() => setRating("down")}
          className="p-1 rounded hover:bg-red-500/10 transition-colors"
          aria-label="Thumbs down"
        >
          <ThumbsDown className="w-3 h-3 text-muted-foreground hover:text-red-500" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {!rating ? (
        <div className="inline-flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Was this helpful?</span>
          <button
            onClick={() => setRating("up")}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs border hover:bg-emerald-500/10 hover:border-emerald-500/30 transition-colors"
          >
            <ThumbsUp className="w-3 h-3" />
            Yes
          </button>
          <button
            onClick={() => setRating("down")}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs border hover:bg-red-500/10 hover:border-red-500/30 transition-colors"
          >
            <ThumbsDown className="w-3 h-3" />
            No
          </button>
        </div>
      ) : (
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-2"
          >
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {rating === "up" ? "What did you like?" : "What could be better?"}
              </span>
              <button
                onClick={() => { setRating(null); setComment(""); }}
                className="p-0.5 rounded hover:bg-muted transition-colors"
              >
                <X className="w-3 h-3 text-muted-foreground" />
              </button>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Optional comment..."
                className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border text-xs bg-background focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]/30"
                style={{ borderColor: "hsl(var(--kf-border))" }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !submitting) handleSubmit();
                }}
              />
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                <Send className="w-3 h-3" />
                {submitting ? "..." : "Send"}
              </button>
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}

export function FeedbackButton({
  target,
  targetId,
  module,
  page,
  context,
}: Omit<FeedbackWidgetProps, "compact" | "onSubmitted">) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] text-muted-foreground border hover:text-foreground hover:border-[hsl(var(--kf-accent1))]/30 transition-colors"
        style={{ borderColor: "hsl(var(--kf-border))" }}
      >
        <MessageSquare className="w-3 h-3" />
        Feedback
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.95 }}
            className="absolute z-50 mt-1 right-0 w-64 p-3 rounded-xl border bg-card shadow-lg"
            style={{ borderColor: "hsl(var(--kf-border))" }}
          >
            <FeedbackWidget
              target={target}
              targetId={targetId}
              module={module}
              page={page}
              context={context}
              onSubmitted={() => setTimeout(() => setOpen(false), 1200)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
