"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, FileText, Send, DollarSign, Clock, Sparkles, Loader2, ArrowRight } from "lucide-react";
import { fetchProvidersForNeed, type NeedMatchProvider } from "@/lib/client";

interface QuoteRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  toBusinessName: string;
  onSubmit: (data: {
    title: string;
    description: string;
    budgetMin?: number;
    budgetMax?: number;
    timeline?: string;
  }) => Promise<void>;
  myBusinessId?: string;
  toBusinessId?: string;
  onViewProvider?: (providerId: string) => void;
}

export function QuoteRequestModal({
  isOpen,
  onClose,
  toBusinessName,
  onSubmit,
  myBusinessId,
  toBusinessId,
  onViewProvider,
}: QuoteRequestModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [budgetMin, setBudgetMin] = useState("");
  const [budgetMax, setBudgetMax] = useState("");
  const [timeline, setTimeline] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [suggestions, setSuggestions] = useState<NeedMatchProvider[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const suggestionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isOpen || !myBusinessId) return;
    const desc = description.trim();
    if (desc.length < 15) {
      setSuggestions([]);
      return;
    }
    if (suggestionTimer.current) clearTimeout(suggestionTimer.current);
    suggestionTimer.current = setTimeout(async () => {
      setLoadingSuggestions(true);
      try {
        const res = await fetchProvidersForNeed(myBusinessId, {
          title: title.trim() || undefined,
          description: desc,
          budgetMin: budgetMin ? parseFloat(budgetMin) : undefined,
          budgetMax: budgetMax ? parseFloat(budgetMax) : undefined,
          timeline: timeline.trim() || undefined,
          limit: 4,
        });
        if (res.data && Array.isArray(res.data)) {
          setSuggestions(res.data.filter((s) => s.businessId !== toBusinessId));
        }
      } catch {}
      setLoadingSuggestions(false);
    }, 800);
    return () => {
      if (suggestionTimer.current) clearTimeout(suggestionTimer.current);
    };
  }, [isOpen, myBusinessId, title, description, budgetMin, budgetMax, timeline, toBusinessId]);

  const handleSubmit = async () => {
    if (!title.trim() || !description.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim(),
        budgetMin: budgetMin ? parseFloat(budgetMin) : undefined,
        budgetMax: budgetMax ? parseFloat(budgetMax) : undefined,
        timeline: timeline.trim() || undefined,
      });
      setTitle("");
      setDescription("");
      setBudgetMin("");
      setBudgetMax("");
      setTimeline("");
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
            className="fixed inset-x-4 top-[8%] sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 z-50 w-auto sm:w-full sm:max-w-lg"
          >
            <div className="kf-card border border-border/50 rounded-2xl overflow-hidden shadow-2xl max-h-[80vh] overflow-y-auto">
              <div className="flex items-center justify-between p-4 border-b border-border/30">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-[hsl(var(--kf-accent1))]/10">
                    <FileText className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">Request Quote</h3>
                    <p className="text-[10px] text-muted-foreground">from {toBusinessName}</p>
                  </div>
                </div>
                <button onClick={onClose} className="p-1.5 rounded-full hover:bg-muted/50 transition-colors">
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>

              <div className="p-4 space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">What do you need?</label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g., Logo design, Website development"
                    className="w-full px-3 py-2 rounded-lg bg-muted/30 border border-border/30 text-sm focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]/50"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Description</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe what you're looking for in detail..."
                    rows={3}
                    className="w-full px-3 py-2 rounded-lg bg-muted/30 border border-border/30 text-sm focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]/50 resize-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                      <DollarSign className="w-3 h-3" /> Budget Min
                    </label>
                    <input
                      type="number"
                      value={budgetMin}
                      onChange={(e) => setBudgetMin(e.target.value)}
                      placeholder="0"
                      className="w-full px-3 py-2 rounded-lg bg-muted/30 border border-border/30 text-sm focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]/50"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                      <DollarSign className="w-3 h-3" /> Budget Max
                    </label>
                    <input
                      type="number"
                      value={budgetMax}
                      onChange={(e) => setBudgetMax(e.target.value)}
                      placeholder="0"
                      className="w-full px-3 py-2 rounded-lg bg-muted/30 border border-border/30 text-sm focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]/50"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Timeline
                  </label>
                  <input
                    value={timeline}
                    onChange={(e) => setTimeline(e.target.value)}
                    placeholder="e.g., 2 weeks, 1 month, ASAP"
                    className="w-full px-3 py-2 rounded-lg bg-muted/30 border border-border/30 text-sm focus:outline-none focus:ring-1 focus:ring-[hsl(var(--kf-accent1))]/50"
                  />
                </div>

                {myBusinessId && showSuggestions && (suggestions.length > 0 || loadingSuggestions) && (
                  <div className="rounded-lg border border-[hsl(var(--kf-accent1))]/20 bg-[hsl(var(--kf-accent1))]/5 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5">
                        <Sparkles className="w-3 h-3 text-[hsl(var(--kf-accent1))]" />
                        <span className="text-[11px] font-semibold text-[hsl(var(--kf-accent1))]">
                          {loadingSuggestions ? "Finding alternatives…" : "Other providers worth considering"}
                        </span>
                      </div>
                      <button
                        onClick={() => setShowSuggestions(false)}
                        className="p-0.5 rounded hover:bg-muted/50"
                        title="Hide suggestions"
                      >
                        <X className="w-3 h-3 text-muted-foreground" />
                      </button>
                    </div>
                    {loadingSuggestions ? (
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground py-1">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Matching your need to providers…
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {suggestions.map((s) => (
                          <button
                            key={s.businessId}
                            onClick={() => onViewProvider?.(s.businessId)}
                            disabled={!onViewProvider}
                            className="w-full flex items-start gap-2 p-2 rounded-md bg-background/40 hover:bg-background/80 transition-colors text-left disabled:cursor-default"
                          >
                            <div className="w-7 h-7 shrink-0 rounded-md bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] flex items-center justify-center text-white text-[10px] font-bold overflow-hidden">
                              {s.business.logoUrl ? (
                                <img src={s.business.logoUrl} alt="" className="w-full h-full object-cover" />
                              ) : (
                                s.business.name.charAt(0).toUpperCase()
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className="text-xs font-medium truncate">{s.business.name}</p>
                                <span className="text-[9px] px-1 py-px rounded bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] font-semibold">
                                  {s.score}
                                </span>
                              </div>
                              <p className="text-[10px] text-muted-foreground line-clamp-2">{s.relevanceReason}</p>
                            </div>
                            {onViewProvider && <ArrowRight className="w-3 h-3 shrink-0 text-muted-foreground self-center" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
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
                  disabled={!title.trim() || !description.trim() || submitting}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-[hsl(var(--kf-accent1))] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  {submitting ? "Sending..." : "Send Request"}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
