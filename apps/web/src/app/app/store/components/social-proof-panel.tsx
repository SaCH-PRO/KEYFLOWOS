"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageSquareQuote, Save, Loader2, Plus, Trash2, Star } from "lucide-react";
import type { StorefrontConfig } from "@/lib/client";
import type { Testimonial } from "./store-types";

interface SocialProofPanelProps {
  storefrontConfig: StorefrontConfig;
  configSaving: boolean;
  onConfigChange: (section: string, updates: Record<string, any>) => void;
  onSaveConfig: () => void;
}

export function SocialProofPanel({ storefrontConfig, configSaving, onConfigChange, onSaveConfig }: SocialProofPanelProps) {
  const [showTestimonialForm, setShowTestimonialForm] = useState(false);
  const [newTestimonial, setNewTestimonial] = useState({ name: "", text: "", rating: 5 });

  const testimonials: Testimonial[] = storefrontConfig.socialProof?.testimonials ?? [];

  function addTestimonial() {
    if (!newTestimonial.name.trim() || !newTestimonial.text.trim()) return;
    const testimonial: Testimonial = {
      id: `t_${Date.now()}`,
      name: newTestimonial.name.trim(),
      text: newTestimonial.text.trim(),
      rating: newTestimonial.rating,
      date: new Date().toISOString().split("T")[0],
    };
    const current = storefrontConfig.socialProof?.testimonials ?? [];
    onConfigChange("socialProof", { testimonials: [...current, testimonial] });
    setNewTestimonial({ name: "", text: "", rating: 5 });
    setShowTestimonialForm(false);
  }

  function deleteTestimonial(id: string) {
    const current = storefrontConfig.socialProof?.testimonials ?? [];
    onConfigChange("socialProof", { testimonials: current.filter((t: Testimonial) => t.id !== id) });
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="rounded-2xl overflow-hidden"
      style={{
        background: "hsl(var(--kf-background) / 0.6)",
        backdropFilter: "blur(20px)",
        border: "1px solid hsl(var(--kf-accent2) / 0.15)",
        boxShadow: "0 4px 24px hsl(var(--kf-accent2) / 0.05)",
      }}
    >
      <div
        className="flex items-center justify-between px-5 py-4"
        style={{
          borderBottom: "1px solid hsl(var(--kf-accent2) / 0.1)",
          background: "linear-gradient(135deg, hsl(var(--kf-accent2) / 0.06), transparent)",
        }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="h-10 w-10 rounded-xl flex items-center justify-center"
            style={{ background: "hsl(var(--kf-accent2) / 0.15)" }}
          >
            <MessageSquareQuote className="w-5 h-5" style={{ color: "hsl(var(--kf-accent2))" }} />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Social Proof</h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">Testimonials and trust signals</p>
          </div>
        </div>
        <button
          onClick={onSaveConfig}
          disabled={configSaving}
          className="kf-btn-primary text-xs inline-flex items-center gap-1.5"
          style={{ opacity: configSaving ? 0.6 : 1 }}
        >
          {configSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {configSaving ? "Saving..." : "Save"}
        </button>
      </div>

      <div className="p-5 space-y-5">
        <div
          className="rounded-xl p-3 space-y-1"
          style={{ background: "hsl(var(--kf-muted) / 0.2)", border: "1px solid hsl(var(--kf-border) / 0.3)" }}
        >
          <button
            type="button"
            onClick={() => onConfigChange("socialProof", { showBookingCount: !(storefrontConfig.socialProof?.showBookingCount ?? false) })}
            className="flex items-center justify-between w-full py-2 group"
          >
            <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">Show Booking Count</span>
            <div
              className="w-10 h-5 rounded-full transition-colors relative flex-shrink-0"
              style={{ background: storefrontConfig.socialProof?.showBookingCount ? "hsl(var(--kf-accent2))" : "hsl(var(--kf-muted-foreground) / 0.3)" }}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${storefrontConfig.socialProof?.showBookingCount ? "left-[22px]" : "left-0.5"}`} />
            </div>
          </button>
          <button
            type="button"
            onClick={() => onConfigChange("socialProof", { showRating: !(storefrontConfig.socialProof?.showRating ?? false) })}
            className="flex items-center justify-between w-full py-2 group"
          >
            <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">Show Rating</span>
            <div
              className="w-10 h-5 rounded-full transition-colors relative flex-shrink-0"
              style={{ background: storefrontConfig.socialProof?.showRating ? "hsl(var(--kf-accent2))" : "hsl(var(--kf-muted-foreground) / 0.3)" }}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${storefrontConfig.socialProof?.showRating ? "left-[22px]" : "left-0.5"}`} />
            </div>
          </button>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Guarantee Text</label>
          <input
            type="text"
            value={storefrontConfig.socialProof?.guaranteeText ?? ""}
            onChange={(e) => onConfigChange("socialProof", { guaranteeText: e.target.value })}
            placeholder="e.g. 100% satisfaction guaranteed"
            className="kf-input w-full text-sm"
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">Testimonials</h4>
            <button
              onClick={() => setShowTestimonialForm(true)}
              className="kf-btn-secondary text-xs inline-flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Testimonial
            </button>
          </div>

          <AnimatePresence>
            {showTestimonialForm && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div
                  className="rounded-xl p-4 space-y-3"
                  style={{ background: "hsl(var(--kf-accent2) / 0.06)", border: "1px solid hsl(var(--kf-accent2) / 0.15)" }}
                >
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Name</label>
                    <input
                      type="text"
                      value={newTestimonial.name}
                      onChange={(e) => setNewTestimonial((p) => ({ ...p, name: e.target.value }))}
                      placeholder="Customer name"
                      className="kf-input w-full text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Rating</label>
                    <div className="flex gap-1">
                      {[1, 2, 3, 4, 5].map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setNewTestimonial((p) => ({ ...p, rating: r }))}
                          className="p-0.5"
                        >
                          <Star
                            className="w-5 h-5 transition-colors"
                            style={{
                              color: r <= newTestimonial.rating ? "hsl(45 93% 55%)" : "hsl(var(--kf-muted-foreground) / 0.3)",
                              fill: r <= newTestimonial.rating ? "hsl(45 93% 55%)" : "transparent",
                            }}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Testimonial</label>
                    <textarea
                      value={newTestimonial.text}
                      onChange={(e) => setNewTestimonial((p) => ({ ...p, text: e.target.value }))}
                      placeholder="What did the customer say?"
                      className="kf-input w-full text-sm min-h-[60px] resize-none"
                      rows={2}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={addTestimonial}
                      disabled={!newTestimonial.name.trim() || !newTestimonial.text.trim()}
                      className="kf-btn-primary text-xs"
                      style={{ opacity: !newTestimonial.name.trim() || !newTestimonial.text.trim() ? 0.5 : 1 }}
                    >
                      Add
                    </button>
                    <button
                      onClick={() => { setShowTestimonialForm(false); setNewTestimonial({ name: "", text: "", rating: 5 }); }}
                      className="kf-btn-secondary text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {testimonials.length === 0 ? (
            <div
              className="text-center py-6 rounded-xl"
              style={{ background: "hsl(var(--kf-muted) / 0.2)", border: "1px dashed hsl(var(--kf-border) / 0.5)" }}
            >
              <MessageSquareQuote className="w-8 h-8 mx-auto mb-2" style={{ color: "hsl(var(--kf-muted-foreground) / 0.3)" }} />
              <p className="text-xs text-muted-foreground">No testimonials yet. Add one to build trust.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {testimonials.map((t) => (
                <motion.div
                  key={t.id}
                  layout
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="rounded-xl px-4 py-3"
                  style={{
                    background: "hsl(var(--kf-accent2) / 0.04)",
                    border: "1px solid hsl(var(--kf-accent2) / 0.12)",
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium truncate">{t.name}</span>
                        <div className="flex gap-0.5">
                          {[1, 2, 3, 4, 5].map((r) => (
                            <Star
                              key={r}
                              className="w-3 h-3"
                              style={{
                                color: r <= t.rating ? "hsl(45 93% 55%)" : "hsl(var(--kf-muted-foreground) / 0.2)",
                                fill: r <= t.rating ? "hsl(45 93% 55%)" : "transparent",
                              }}
                            />
                          ))}
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-2">{t.text}</p>
                    </div>
                    <button
                      onClick={() => deleteTestimonial(t.id)}
                      className="p-1.5 rounded-lg hover:bg-red-500/20 transition-colors flex-shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-red-400" />
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
