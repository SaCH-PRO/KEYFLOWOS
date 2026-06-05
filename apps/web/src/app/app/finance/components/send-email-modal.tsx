"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Mail, Send, Loader2 } from "lucide-react";
import { sendInvoiceEmail, sendQuoteEmail } from "@/lib/client";
import { toast } from "sonner";

interface SendEmailModalProps {
  businessId: string | null;
  record: { type: "quote" | "invoice"; id: string; number: string; contact?: { email?: string | null } | null } | null;
  onClose: () => void;
  onSent?: () => void;
}

export function SendEmailModal({ businessId, record, onClose, onSent }: SendEmailModalProps) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (record?.contact?.email) {
      setEmail(record.contact.email);
    } else {
      setEmail("");
    }
    setMessage("");
  }, [record]);

  if (!record) return null;

  const handleSend = async () => {
    if (!email) return;
    setSending(true);
    try {
      if (record.type === "invoice") {
        const bid = businessId ?? "";
        const { error } = await sendInvoiceEmail(bid, record.id, { recipientEmail: email, message: message || undefined });
        if (!error) {
          toast.success("Invoice sent");
          onSent?.();
          onClose();
        } else {
          toast.error(error ?? "Failed to send invoice");
        }
      } else {
        const bid = businessId ?? undefined;
        const { error } = await sendQuoteEmail({ businessId: bid, quoteId: record.id, recipientEmail: email, message: message || undefined });
        if (!error) {
          toast.success("Quote sent");
          onSent?.();
          onClose();
        } else {
          toast.error(error ?? "Failed to send quote");
        }
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <AnimatePresence>
      {record && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-border/60 bg-card shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border/40">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
                <h3 className="text-sm font-semibold text-foreground">
                  Send {record.type === "quote" ? "Quote" : "Invoice"}
                </h3>
              </div>
              <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/[0.05] transition-colors">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Recipient Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="client@example.com"
                  className="w-full px-3 py-2 rounded-xl bg-white/[0.03] border border-border/40 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-[hsl(var(--kf-accent1))]/40"
                />
              </div>

              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Personal Message (optional)</label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={3}
                  placeholder="Hi! Please find attached..."
                  className="w-full px-3 py-2 rounded-xl bg-white/[0.03] border border-border/40 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-[hsl(var(--kf-accent1))]/40 resize-none"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center gap-2 px-5 py-4 border-t border-border/40">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2.5 rounded-xl text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-white/[0.05] transition-colors border border-border/40"
              >
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={sending || !email}
                className="flex-1 px-4 py-2.5 rounded-xl text-xs font-medium bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/20 transition-colors border border-[hsl(var(--kf-accent1))]/30 disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                {sending ? "Sending..." : "Send"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
