"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { FileText, X, Calendar } from "lucide-react";
import { formatAmount, getContactInitials } from "../utils/commerce-utils";
import { getStatusBadge, BILLING_DOC_THEME, type BillingDocType } from "./commerce-types";

interface BillingDetailModalProps {
  type: BillingDocType;
  number: string;
  status: string;
  contact: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  total: number;
  currency: string;
  items: Array<{
    id?: string;
    description?: string | null;
    quantity?: number;
    unitPrice?: number;
    total?: number;
  }>;
  dateLabel1: string;
  dateValue1: string | null;
  dateLabel2: string;
  dateValue2: string | null;
  dateExtra?: ReactNode;
  taxRate: number;
  discountType?: string | null;
  discountValue?: number | null;
  notes?: string | null;
  alerts?: ReactNode;
  actions: ReactNode;
  onClose: () => void;
}

export function BillingDetailModal({
  type,
  number,
  status,
  contact,
  total,
  currency,
  items,
  dateLabel1,
  dateValue1,
  dateLabel2,
  dateValue2,
  dateExtra,
  taxRate,
  discountType,
  discountValue,
  notes,
  alerts,
  actions,
  onClose,
}: BillingDetailModalProps) {
  const theme = BILLING_DOC_THEME[type];

  const subtotal = items.reduce((sum, item) => sum + Number(item.total || 0), 0);
  const taxAmount = subtotal * ((taxRate || 0) / 100);
  let discountAmount = 0;
  if (discountValue) {
    discountAmount =
      discountType === "PERCENT"
        ? subtotal * (Number(discountValue) / 100)
        : Number(discountValue);
  }

  const contactName = contact
    ? `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || "Unknown"
    : null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-lg bg-card rounded-2xl border border-border shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto"
      >
        <div
          className={`p-5 border-b border-border/60 flex items-center justify-between bg-gradient-to-r ${theme.headerGradient}`}
        >
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <FileText className="w-5 h-5" style={{ color: theme.accentColor }} />
            {theme.label} {number}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          <div className="flex items-center justify-between">
            <span
              className={`inline-flex rounded-full border px-3 py-1 text-sm font-medium ${getStatusBadge(status)}`}
            >
              {status}
            </span>
            <span className="text-2xl font-bold" style={{ color: theme.accentColor }}>
              {formatAmount(total, currency)}
            </span>
          </div>

          {contact && contactName && (
            <div className="flex items-start gap-3 p-3 rounded-xl bg-muted/30 border border-border/40">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold shrink-0"
                style={{ backgroundColor: theme.avatarBg }}
              >
                <span className={theme.avatarText}>{getContactInitials(contact)}</span>
              </div>
              <div>
                <p className="font-medium">{contactName}</p>
                {contact.email && (
                  <p className="text-sm text-muted-foreground">{contact.email}</p>
                )}
                {contact.phone && (
                  <p className="text-xs text-muted-foreground/60">{contact.phone}</p>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="p-3 rounded-xl bg-muted/20 border border-border/40">
              <p className="text-xs text-muted-foreground mb-1">{dateLabel1}</p>
              <p className="font-medium flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" />
                {dateValue1 ? new Date(dateValue1).toLocaleDateString() : "—"}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-muted/20 border border-border/40">
              <p className="text-xs text-muted-foreground mb-1">{dateLabel2}</p>
              <p className="font-medium flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" />
                {dateValue2 ? new Date(dateValue2).toLocaleDateString() : "—"}
              </p>
              {dateExtra}
            </div>
          </div>

          {alerts}

          {items.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">Line Items</h4>
              <div className="rounded-xl border border-border/60 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 border-b border-border/40">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                        Description
                      </th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                        Qty
                      </th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                        Price
                      </th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {items.map((item, idx) => (
                      <tr key={item.id ?? idx}>
                        <td className="px-3 py-2">{item.description}</td>
                        <td className="px-3 py-2 text-right">{item.quantity}</td>
                        <td className="px-3 py-2 text-right">
                          {formatAmount(item.unitPrice ?? 0, currency)}
                        </td>
                        <td className="px-3 py-2 text-right font-medium">
                          {formatAmount(item.total ?? 0, currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="space-y-1.5 pt-2">
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Subtotal</span>
                  <span>{formatAmount(subtotal, currency)}</span>
                </div>
                {(taxRate || 0) > 0 && (
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>Tax ({taxRate}%)</span>
                    <span>{formatAmount(taxAmount, currency)}</span>
                  </div>
                )}
                {discountAmount > 0 && (
                  <div className="flex justify-between text-sm text-emerald-400">
                    <span>
                      Discount{" "}
                      {discountType === "PERCENT" ? `(${discountValue}%)` : ""}
                    </span>
                    <span>-{formatAmount(discountAmount, currency)}</span>
                  </div>
                )}
                <div className="flex justify-between text-base font-bold pt-1.5 border-t border-border/40">
                  <span>Total</span>
                  <span style={{ color: theme.accentColor }}>
                    {formatAmount(total, currency)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {notes && (
            <div className="p-3 rounded-xl bg-muted/20 border border-border/40">
              <p className="text-xs text-muted-foreground mb-1">Notes</p>
              <p className="text-sm">{notes}</p>
            </div>
          )}

          <div className="pt-4 border-t border-border/40 space-y-2">{actions}</div>
        </div>
      </motion.div>
    </motion.div>
  );
}
