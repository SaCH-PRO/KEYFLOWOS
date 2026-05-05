"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Send, Link as LinkIcon, DollarSign, Bell, Receipt, X, MessageCircle, Mail } from "lucide-react";

interface Action {
  key: string;
  label: string;
  icon: typeof Send;
  tone: string;
  onClick: () => void;
  disabled?: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  invoiceNumber: string;
  status: string;
  hasGmail: boolean;
  onSend?: () => void;
  onCopyPaymentLink: () => void;
  onShareWhatsApp?: () => void;
  onRecordPayment?: () => void;
  onSendReminder?: () => void;
  onResendReceipt?: () => void;
}

/**
 * Bottom-sheet equivalent of the desktop detail-drawer action bar — shown
 * on viewports < sm (640px) where the drawer is hidden. Surfaces the four
 * core invoice actions called out in R2: Send / Payment link / Record
 * payment / Send reminder, plus a Resend-receipt entry for PAID invoices.
 */
export function InvoiceMobileActions({
  open,
  onClose,
  invoiceNumber,
  status,
  hasGmail,
  onSend,
  onCopyPaymentLink,
  onShareWhatsApp,
  onRecordPayment,
  onSendReminder,
  onResendReceipt,
}: Props) {
  const actions: Action[] = [];

  if (status === "DRAFT" && hasGmail && onSend) {
    actions.push({ key: "send", label: "Send invoice", icon: Send, tone: "text-blue-400", onClick: onSend });
  }
  actions.push({ key: "link", label: "Copy payment link", icon: LinkIcon, tone: "text-slate-300", onClick: onCopyPaymentLink });
  if (onShareWhatsApp) {
    actions.push({ key: "wa", label: "Share via WhatsApp", icon: MessageCircle, tone: "text-emerald-400", onClick: onShareWhatsApp });
  }
  if (
    onRecordPayment &&
    (status === "SENT" || status === "OVERDUE" || status === "PARTIALLY_PAID" || status === "DRAFT")
  ) {
    actions.push({ key: "pay", label: "Record payment", icon: DollarSign, tone: "text-amber-400", onClick: onRecordPayment });
  }
  if (
    hasGmail &&
    onSendReminder &&
    (status === "SENT" || status === "OVERDUE" || status === "PARTIALLY_PAID")
  ) {
    actions.push({ key: "remind", label: "Send reminder", icon: Bell, tone: "text-amber-400", onClick: onSendReminder });
  }
  if (hasGmail && onResendReceipt && status === "PAID") {
    actions.push({ key: "receipt", label: "Resend receipt", icon: Receipt, tone: "text-emerald-400", onClick: onResendReceipt });
  }
  if (hasGmail && actions.every((a) => a.key !== "send") && onSend && status !== "PAID" && status !== "VOID") {
    actions.push({ key: "email", label: "Email invoice", icon: Mail, tone: "text-blue-400", onClick: onSend });
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm sm:hidden"
          onClick={(e) => e.target === e.currentTarget && onClose()}
          role="dialog"
          aria-modal="true"
          aria-label={`Actions for invoice ${invoiceNumber}`}
        >
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
            className="absolute bottom-0 left-0 right-0 bg-card border-t border-border/60 rounded-t-2xl pb-[max(env(safe-area-inset-bottom),16px)] pt-2 shadow-2xl"
          >
            <div className="mx-auto mt-1 mb-3 h-1 w-10 rounded-full bg-border/60" />
            <div className="px-4 pb-2 flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Invoice #{invoiceNumber}
                </p>
                <p className="text-sm font-semibold">Quick actions</p>
              </div>
              <button
                onClick={onClose}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl hover:bg-white/[0.06]"
                aria-label="Close"
              >
                <X className="w-5 h-5 text-muted-foreground" />
              </button>
            </div>
            <ul className="px-2">
              {actions.map((a) => {
                const Icon = a.icon;
                return (
                  <li key={a.key}>
                    <button
                      onClick={() => {
                        a.onClick();
                        onClose();
                      }}
                      disabled={a.disabled}
                      className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-white/[0.04] active:bg-white/[0.08] transition-colors text-left disabled:opacity-50"
                    >
                      <span
                        className={`w-9 h-9 rounded-xl bg-white/[0.04] border border-border/40 flex items-center justify-center ${a.tone}`}
                      >
                        <Icon className="w-4.5 h-4.5" />
                      </span>
                      <span className="text-sm font-medium">{a.label}</span>
                    </button>
                  </li>
                );
              })}
              {actions.length === 0 && (
                <li className="px-4 py-6 text-center text-xs text-muted-foreground">
                  No actions available for this invoice.
                </li>
              )}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
