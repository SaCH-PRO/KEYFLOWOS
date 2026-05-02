"use client";

import { useState } from "react";
import { motion, AnimatePresence, type PanInfo } from "framer-motion";
import { X, MessageCircle, Mail, Send, Copy, Check, AlertCircle } from "lucide-react";
import { buildWhatsAppLink, getContactPhone } from "@/lib/whatsapp";
import type { ContactCardData } from "./contact-card";

const BROADCAST_TEMPLATES = [
  { label: "Promotion", message: "Hi {name}, we have an exciting offer just for you! Check out our latest deals." },
  { label: "Thank you", message: "Hi {name}, we truly appreciate your continued support. Thank you for being a valued customer!" },
  { label: "Holiday", message: "Hi {name}, wishing you a wonderful holiday season from our team! We look forward to serving you again." },
  { label: "Reminder", message: "Hi {name}, this is a friendly reminder about your upcoming appointment/payment. Please reach out if you have any questions." },
  { label: "New Service", message: "Hi {name}, we're excited to announce a new service/product! Reply to learn more or visit our store." },
  { label: "Feedback", message: "Hi {name}, we'd love to hear your feedback! How was your experience with us? Your input helps us improve." },
];

interface BroadcastDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  selectedContacts: ContactCardData[];
  onDeselectAll: () => void;
}

export function BroadcastDrawer({ isOpen, onClose, selectedContacts, onDeselectAll: _onDeselectAll }: BroadcastDrawerProps) {
  const [message, setMessage] = useState("");
  const [channel, setChannel] = useState<"whatsapp" | "email">("whatsapp");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);

  const contactsWithWhatsApp = selectedContacts.filter((c) => getContactPhone(c));
  const contactsWithEmail = selectedContacts.filter((c) => c.email);
  const eligibleCount = channel === "whatsapp" ? contactsWithWhatsApp.length : contactsWithEmail.length;
  const ineligibleCount = selectedContacts.length - eligibleCount;

  const handleSendBroadcast = async () => {
    if (!message.trim() || eligibleCount === 0) return;
    setSending(true);

    if (channel === "whatsapp") {
      for (const contact of contactsWithWhatsApp) {
        const phone = getContactPhone(contact);
        if (!phone) continue;
        const personalMessage = message.replace(/\{name\}/g, contact.firstName || "there");
        window.open(buildWhatsAppLink(phone, personalMessage), "_blank");
        await new Promise((r) => setTimeout(r, 800));
      }
    } else {
      const emails = contactsWithEmail.map((c) => c.email).filter(Boolean).join(",");
      const subject = encodeURIComponent("Message from your service provider");
      const body = encodeURIComponent(message.replace(/\{name\}/g, "Valued Customer"));
      window.open(`mailto:${emails}?subject=${subject}&body=${body}`, "_blank");
    }

    setSending(false);
    setSent(true);
    setTimeout(() => setSent(false), 3000);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(message);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 z-50 flex items-end md:items-center justify-center"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 25 }}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.6 }}
          onDragEnd={(_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
            if (info.offset.y > 100 || info.velocity.y > 500) onClose();
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-full md:max-w-lg md:mx-4 max-h-[85vh] overflow-y-auto rounded-t-2xl md:rounded-2xl kf-card border-t md:border border-border"
        >
          <button
            onClick={onClose}
            className="w-full flex items-center justify-center py-2 cursor-pointer active:bg-muted/30 transition-colors md:hidden"
            aria-label="Close drawer"
          >
            <div className="w-12 h-1 bg-muted-foreground/40 rounded-full" />
          </button>
          <div className="sticky top-0 z-10 flex items-center justify-between p-4 border-b border-border" style={{ background: "hsl(var(--kf-sidebar-bg))" }}>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}>
                <Send className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-semibold">Broadcast Message</h3>
                <p className="text-xs text-muted-foreground">{selectedContacts.length} contacts selected</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-muted rounded-lg transition-colors">
              <X className="w-5 h-5 text-muted-foreground" />
            </button>
          </div>

          <div className="p-4 space-y-4">
            <div className="flex gap-2">
              <button
                onClick={() => setChannel("whatsapp")}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition-all ${
                  channel === "whatsapp"
                    ? "bg-emerald-600 text-white"
                    : "bg-muted hover:bg-muted/80 text-muted-foreground"
                }`}
              >
                <MessageCircle className="w-4 h-4" />
                WhatsApp ({contactsWithWhatsApp.length})
              </button>
              <button
                onClick={() => setChannel("email")}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition-all ${
                  channel === "email"
                    ? "bg-blue-600 text-white"
                    : "bg-muted hover:bg-muted/80 text-muted-foreground"
                }`}
              >
                <Mail className="w-4 h-4" />
                Email ({contactsWithEmail.length})
              </button>
            </div>

            {ineligibleCount > 0 && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-sm">
                <AlertCircle className="w-4 h-4 text-yellow-500 flex-shrink-0" />
                <span className="text-yellow-400">
                  {ineligibleCount} contact{ineligibleCount > 1 ? "s" : ""} missing {channel === "whatsapp" ? "phone number" : "email address"}
                </span>
              </div>
            )}

            <div>
              <p className="text-xs text-muted-foreground mb-2 font-medium">Quick Templates</p>
              <div className="flex flex-wrap gap-1.5">
                {BROADCAST_TEMPLATES.map((t) => (
                  <button
                    key={t.label}
                    onClick={() => setMessage(t.message)}
                    className="text-xs px-2.5 py-1.5 rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs text-muted-foreground mb-2 font-medium">
                Message <span className="text-[10px] opacity-60">(use {"{name}"} for personalization)</span>
              </p>
              <textarea
                placeholder="Type your broadcast message..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="kf-input w-full min-h-[120px] resize-none"
              />
              <p className="text-[10px] text-muted-foreground mt-1">{message.length} characters</p>
            </div>

            {message.trim() && (
              <div className="p-3 rounded-xl bg-muted/30 border border-border/50">
                <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">Preview</p>
                <p className="text-sm">
                  {message.replace(/\{name\}/g, selectedContacts[0]?.firstName || "Customer")}
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={handleSendBroadcast}
                disabled={!message.trim() || eligibleCount === 0 || sending}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition-all disabled:opacity-50 ${
                  channel === "whatsapp"
                    ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                    : "bg-blue-600 hover:bg-blue-700 text-white"
                }`}
              >
                {sending ? (
                  <>Sending...</>
                ) : sent ? (
                  <>
                    <Check className="w-4 h-4" />
                    Sent!
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    Send to {eligibleCount} contact{eligibleCount !== 1 ? "s" : ""}
                  </>
                )}
              </button>
              <button
                onClick={handleCopy}
                disabled={!message.trim()}
                className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-muted hover:bg-muted/80 text-sm transition-colors disabled:opacity-50"
              >
                <Copy className="w-4 h-4" />
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>

            <div className="pt-2 border-t border-border">
              <p className="text-[10px] text-muted-foreground mb-2">Sending to:</p>
              <div className="flex flex-wrap gap-1.5 max-h-[100px] overflow-y-auto">
                {(channel === "whatsapp" ? contactsWithWhatsApp : contactsWithEmail).map((c) => (
                  <span key={c.id} className="text-[10px] px-2 py-1 rounded-full bg-muted text-muted-foreground">
                    {c.firstName || c.lastName || c.email || "Unknown"}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
