"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, UserPlus, Send, Mail, Phone } from "lucide-react";

interface ReferralModalProps {
  isOpen: boolean;
  onClose: () => void;
  toBusinessName: string;
  onSubmit: (data: {
    referredToName: string;
    referredToEmail?: string;
    referredToPhone?: string;
    opportunity: string;
    context?: string;
  }) => Promise<void>;
}

export function ReferralModal({ isOpen, onClose, toBusinessName, onSubmit }: ReferralModalProps) {
  const [referredToName, setReferredToName] = useState("");
  const [referredToEmail, setReferredToEmail] = useState("");
  const [referredToPhone, setReferredToPhone] = useState("");
  const [opportunity, setOpportunity] = useState("");
  const [context, setContext] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!referredToName.trim() || !opportunity.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit({
        referredToName: referredToName.trim(),
        referredToEmail: referredToEmail.trim() || undefined,
        referredToPhone: referredToPhone.trim() || undefined,
        opportunity: opportunity.trim(),
        context: context.trim() || undefined,
      });
      setReferredToName("");
      setReferredToEmail("");
      setReferredToPhone("");
      setOpportunity("");
      setContext("");
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
                  <div className="p-1.5 rounded-lg bg-emerald-500/10">
                    <UserPlus className="w-4 h-4 text-emerald-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">Send Referral</h3>
                    <p className="text-[10px] text-muted-foreground">Refer {toBusinessName} to someone</p>
                  </div>
                </div>
                <button onClick={onClose} className="p-1.5 rounded-full hover:bg-muted/50 transition-colors">
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>

              <div className="p-4 space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Referring to (name)</label>
                  <input
                    value={referredToName}
                    onChange={(e) => setReferredToName(e.target.value)}
                    placeholder="Contact or company name"
                    className="w-full px-3 py-2 rounded-lg bg-muted/30 border border-border/30 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                      <Mail className="w-3 h-3" /> Email
                    </label>
                    <input
                      type="email"
                      value={referredToEmail}
                      onChange={(e) => setReferredToEmail(e.target.value)}
                      placeholder="Optional"
                      className="w-full px-3 py-2 rounded-lg bg-muted/30 border border-border/30 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                      <Phone className="w-3 h-3" /> Phone
                    </label>
                    <input
                      value={referredToPhone}
                      onChange={(e) => setReferredToPhone(e.target.value)}
                      placeholder="Optional"
                      className="w-full px-3 py-2 rounded-lg bg-muted/30 border border-border/30 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Opportunity</label>
                  <input
                    value={opportunity}
                    onChange={(e) => setOpportunity(e.target.value)}
                    placeholder="What's the opportunity?"
                    className="w-full px-3 py-2 rounded-lg bg-muted/30 border border-border/30 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Context (optional)</label>
                  <textarea
                    value={context}
                    onChange={(e) => setContext(e.target.value)}
                    placeholder="Any additional context for this referral..."
                    rows={2}
                    className="w-full px-3 py-2 rounded-lg bg-muted/30 border border-border/30 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500/50 resize-none"
                  />
                </div>
              </div>

              <div className="p-4 border-t border-border/30 flex gap-2">
                <button onClick={onClose} className="flex-1 px-4 py-2 rounded-xl bg-muted/30 text-sm font-medium hover:bg-muted/50 transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={!referredToName.trim() || !opportunity.trim() || submitting}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  {submitting ? "Sending..." : "Send Referral"}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
