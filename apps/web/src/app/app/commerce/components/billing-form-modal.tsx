"use client";

import React, { useState, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, FileText, CreditCard, User, Calendar, ChevronDown,
  Plus, Minus, MessageSquare, Percent, Tag, Loader2, Receipt,
} from "lucide-react";
import { SideSheet } from "./side-sheet";
import { ContactSelect } from "@/components/contacts";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TaskContinuityHeader } from "@/components/ui/task-continuity-header";
import type { Contact, Product } from "@/lib/client";
import {
  InvoiceLineItem,
  PAYMENT_TERMS,
  CATEGORIES,
  generateItemId,
  getDueDateFromTerms,
} from "./commerce-types";
import { formatAmount } from "../utils/commerce-utils";

type DocType = "invoice" | "quote";

interface BillingFormModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: () => void;
  docType: DocType;
  isEditing: boolean;
  saving?: boolean;
  formError?: string | null;
  contacts: Contact[];
  products: Product[];
  currency?: string;
  contactId: string;
  onContactChange: (id: string) => void;
  dateValue: string;
  onDateChange: (v: string) => void;
  items: InvoiceLineItem[];
  onAddItem: () => void;
  onRemoveItem: (id: string) => void;
  onUpdateItem: (id: string, field: keyof InvoiceLineItem, value: string | boolean) => void;
  onSelectProduct: (itemId: string, productId: string) => void;
  taxRate: string;
  onTaxRateChange: (v: string) => void;
  discountType: "PERCENT" | "FIXED";
  onDiscountTypeChange: (v: "PERCENT" | "FIXED") => void;
  discountValue: string;
  onDiscountValueChange: (v: string) => void;
  notes: string;
  onNotesChange: (v: string) => void;
  onPaymentTermsChange?: (termKey: string) => void;
  originLabel?: string | null;
  originRoute?: string | null;
  onReturn?: () => void;
}

const THEME = {
  invoice: {
    accent: "rgb(6,182,212)",
    accentLight: "rgba(6,182,212,0.15)",
    accentBorder: "rgba(6,182,212,0.3)",
    label: "Invoice",
    icon: CreditCard,
    dateLabel: "Due Date",
  },
  quote: {
    accent: "rgb(139,92,246)",
    accentLight: "rgba(139,92,246,0.15)",
    accentBorder: "rgba(139,92,246,0.3)",
    label: "Quote",
    icon: Receipt,
    dateLabel: "Expiry Date",
  },
};

function SectionHeader({ label, icon: Icon, open, onToggle, accentColor }: {
  label: string;
  icon: React.ElementType;
  open: boolean;
  onToggle: () => void;
  accentColor: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center gap-2 min-h-[44px] text-xs font-semibold uppercase tracking-wider hover:text-foreground transition-colors text-muted-foreground"
    >
      <Icon className="w-3.5 h-3.5" style={{ color: accentColor }} />
      {label}
      <ChevronDown className={`w-3.5 h-3.5 ml-auto transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
    </button>
  );
}

export const BillingFormModal = React.memo(function BillingFormModal({
  open,
  onClose,
  onSubmit,
  docType,
  isEditing,
  saving,
  formError,
  contacts,
  products,
  currency = "TTD",
  contactId,
  onContactChange,
  dateValue,
  onDateChange,
  items,
  onAddItem,
  onRemoveItem,
  onUpdateItem,
  onSelectProduct,
  taxRate,
  onTaxRateChange,
  discountType,
  onDiscountTypeChange,
  discountValue,
  onDiscountValueChange,
  notes,
  onNotesChange,
  onPaymentTermsChange,
  originLabel,
  originRoute,
  onReturn,
}: BillingFormModalProps) {
  const theme = THEME[docType];
  const ThemeIcon = theme.icon;

  const [sections, setSections] = useState({
    details: true,
    items: true,
    financials: false,
    notes: false,
  });
  const toggle = (key: keyof typeof sections) =>
    setSections((s) => ({ ...s, [key]: !s[key] }));

  const [showDiscardDialog, setShowDiscardDialog] = useState(false);

  const isDirty = useMemo(() => {
    return contactId !== "" || dateValue !== "" || notes !== "" ||
      items.some((i) => i.description !== "" || i.unitPrice !== "");
  }, [contactId, dateValue, notes, items]);

  const handleClose = useCallback(() => {
    if (isDirty && !isEditing) {
      setShowDiscardDialog(true);
      return;
    }
    onClose();
  }, [isDirty, isEditing, onClose]);

  const totals = useMemo(() => {
    const subtotal = items.reduce((sum, item) => {
      const qty = parseFloat(item.quantity) || 0;
      const price = parseFloat(item.unitPrice) || 0;
      return sum + qty * price;
    }, 0);
    const tax = taxRate ? subtotal * (parseFloat(taxRate) / 100) : 0;
    let discount = 0;
    if (discountValue) {
      const dv = parseFloat(discountValue);
      discount = discountType === "PERCENT" ? subtotal * (dv / 100) : dv;
    }
    const total = subtotal + tax - discount;
    return { subtotal, tax, discount, total };
  }, [items, taxRate, discountType, discountValue]);

  const activeProducts = useMemo(
    () => products.filter((p) => p.isActive !== false),
    [products],
  );

  if (!open) return null;

  return (
    <>
      <SideSheet
        open={open}
        onClose={handleClose}
        title={isEditing ? `Edit ${theme.label}` : `New ${theme.label}`}
        subtitle={isEditing ? `Update ${theme.label.toLowerCase()} details` : `Create a new ${theme.label.toLowerCase()} for your client`}
        icon={
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: theme.accentLight }}
          >
            <ThemeIcon className="w-4.5 h-4.5" style={{ color: theme.accent }} />
          </div>
        }
        footer={
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <div className="space-y-1 text-muted-foreground">
                <div className="flex justify-between gap-8">
                  <span>Subtotal</span>
                  <span className="text-foreground">{formatAmount(totals.subtotal, currency)}</span>
                </div>
                {totals.tax > 0 && (
                  <div className="flex justify-between gap-8 text-xs">
                    <span>Tax ({taxRate}%)</span>
                    <span className="text-foreground/80">+{formatAmount(totals.tax, currency)}</span>
                  </div>
                )}
                {totals.discount > 0 && (
                  <div className="flex justify-between gap-8 text-xs">
                    <span>Discount</span>
                    <span className="text-green-400">-{formatAmount(totals.discount, currency)}</span>
                  </div>
                )}
              </div>
              <div className="text-right">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Total</p>
                <p className="text-xl font-bold" style={{ color: theme.accent }}>
                  {formatAmount(totals.total, currency)}
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2.5 text-sm font-medium rounded-xl border border-border/50 bg-white/[0.03] hover:bg-white/[0.06] text-muted-foreground hover:text-foreground transition-all"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onSubmit}
                disabled={saving}
                className="px-5 py-2.5 text-sm font-semibold rounded-xl text-white transition-all flex items-center gap-2 disabled:opacity-50"
                style={{ backgroundColor: theme.accent }}
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ThemeIcon className="w-4 h-4" />
                )}
                {saving
                  ? "Saving..."
                  : isEditing
                    ? `Update ${theme.label}`
                    : `Create ${theme.label}`}
              </button>
            </div>
          </div>
        }
      >
        <div className="space-y-1">
                {originLabel && (onReturn || originRoute) && (
                  <TaskContinuityHeader
                    taskLabel={isEditing ? `Edit ${theme.label}` : `New ${theme.label}`}
                    returnLabel={`Back to ${originLabel}`}
                    returnHref={originRoute ?? undefined}
                    onBack={onReturn}
                    className="mb-3"
                  />
                )}
                {formError && (
                  <motion.div
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-200 mb-3"
                  >
                    {formError}
                  </motion.div>
                )}

                <SectionHeader
                  label={`${theme.label} Details`}
                  icon={User}
                  open={sections.details}
                  onToggle={() => toggle("details")}
                  accentColor={theme.accent}
                />
                {sections.details && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="space-y-4 pb-3"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <ContactSelect
                        value={contactId}
                        onChange={onContactChange}
                        contacts={contacts}
                        label={docType === "invoice" ? "Client (optional)" : "Client"}
                        required={docType === "quote"}
                      />
                      <div className="space-y-1.5">
                        <label className="text-xs text-muted-foreground flex items-center gap-1">
                          <Calendar className="w-3 h-3" /> {theme.dateLabel}
                        </label>
                        <input
                          type="date"
                          value={dateValue}
                          onChange={(e) => onDateChange(e.target.value)}
                          className="kf-input w-full"
                        />
                      </div>
                    </div>

                    {docType === "invoice" && onPaymentTermsChange && (
                      <div className="space-y-1.5">
                        <label className="text-xs text-muted-foreground flex items-center gap-1">
                          <Calendar className="w-3 h-3" /> Payment Terms
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {PAYMENT_TERMS.map((t) => (
                            <button
                              key={t.value}
                              type="button"
                              onClick={() => onPaymentTermsChange(t.value)}
                              className="px-3 min-h-[44px] text-xs rounded-lg border border-border/50 bg-white/[0.03] hover:bg-white/[0.08] text-muted-foreground hover:text-foreground transition-all"
                            >
                              {t.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </motion.div>
                )}

                <SectionHeader
                  label="Line Items"
                  icon={FileText}
                  open={sections.items}
                  onToggle={() => toggle("items")}
                  accentColor={theme.accent}
                />
                {sections.items && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="space-y-3 pb-3"
                  >
                    {items.map((lineItem, idx) => (
                      <div
                        key={lineItem.id}
                        className="rounded-xl border border-border/40 bg-white/[0.02] p-3.5 space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-muted-foreground/60 font-medium">
                            Item {idx + 1}
                          </span>
                          {items.length > 1 && (
                            <button
                              type="button"
                              onClick={() => onRemoveItem(lineItem.id)}
                              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                            >
                              <Minus className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_80px_90px] gap-3">
                          <div className="space-y-1">
                            <label className="text-[11px] text-muted-foreground">Product</label>
                            <select
                              value={lineItem.productId}
                              onChange={(e) => onSelectProduct(lineItem.id, e.target.value)}
                              className="kf-input w-full text-sm"
                            >
                              <option value="">Select product...</option>
                              {activeProducts.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name} — {formatAmount(p.price, currency)}
                                </option>
                              ))}
                              <option value="__NEW__">+ New Item</option>
                            </select>
                          </div>

                          <div className="space-y-1">
                            <label className="text-[11px] text-muted-foreground">Description</label>
                            <input
                              type="text"
                              value={lineItem.description}
                              onChange={(e) => onUpdateItem(lineItem.id, "description", e.target.value)}
                              placeholder="Item description"
                              className="kf-input w-full text-sm"
                            />
                          </div>

                          <div className="space-y-1">
                            <label className="text-[11px] text-muted-foreground">Qty</label>
                            <input
                              type="number"
                              min="1"
                              value={lineItem.quantity}
                              onChange={(e) => onUpdateItem(lineItem.id, "quantity", e.target.value)}
                              className="kf-input w-full text-sm text-center"
                            />
                          </div>

                          <div className="space-y-1">
                            <label className="text-[11px] text-muted-foreground">Unit Price</label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={lineItem.unitPrice}
                              onChange={(e) => onUpdateItem(lineItem.id, "unitPrice", e.target.value)}
                              placeholder="0.00"
                              className="kf-input w-full text-sm"
                            />
                          </div>
                        </div>

                        {lineItem.isNewItem && (
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 border-t border-border/20">
                            <div className="space-y-1">
                              <label className="text-[11px] text-muted-foreground">Item Name</label>
                              <input
                                type="text"
                                value={lineItem.newItemName || ""}
                                onChange={(e) => onUpdateItem(lineItem.id, "newItemName", e.target.value)}
                                placeholder="New item name"
                                className="kf-input w-full text-sm"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[11px] text-muted-foreground">Category</label>
                              <select
                                value={lineItem.newItemCategory || "SERVICE"}
                                onChange={(e) => onUpdateItem(lineItem.id, "newItemCategory", e.target.value)}
                                className="kf-input w-full text-sm"
                              >
                                {CATEGORIES.map((c) => (
                                  <option key={c.value} value={c.value}>{c.label}</option>
                                ))}
                              </select>
                            </div>
                            <div className="flex items-end pb-0.5">
                              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={lineItem.addToCatalog || false}
                                  onChange={(e) => onUpdateItem(lineItem.id, "addToCatalog", e.target.checked)}
                                  className="rounded border-border"
                                />
                                Add to catalog
                              </label>
                            </div>
                          </div>
                        )}

                        {lineItem.unitPrice && lineItem.quantity && (
                          <div className="text-right">
                            <span className="text-xs text-muted-foreground">
                              Subtotal:{" "}
                              <span className="text-foreground font-medium">
                                {formatAmount(
                                  (parseFloat(lineItem.quantity) || 0) * (parseFloat(lineItem.unitPrice) || 0),
                                  currency,
                                )}
                              </span>
                            </span>
                          </div>
                        )}
                      </div>
                    ))}

                    <button
                      type="button"
                      onClick={onAddItem}
                      className="w-full min-h-[44px] rounded-xl border border-dashed border-border/50 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-border hover:bg-white/[0.03] transition-all flex items-center justify-center gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add Line Item
                    </button>
                  </motion.div>
                )}

                <SectionHeader
                  label="Tax & Discount"
                  icon={Percent}
                  open={sections.financials}
                  onToggle={() => toggle("financials")}
                  accentColor={theme.accent}
                />
                {sections.financials && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="space-y-4 pb-3"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs text-muted-foreground flex items-center gap-1">
                          <Percent className="w-3 h-3" /> Tax Rate (%)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          value={taxRate}
                          onChange={(e) => onTaxRateChange(e.target.value)}
                          placeholder="12.5"
                          className="kf-input w-full"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs text-muted-foreground flex items-center gap-1">
                          <Tag className="w-3 h-3" /> Discount Type
                        </label>
                        <div className="flex rounded-lg border border-border/50 overflow-hidden">
                          <button
                            type="button"
                            onClick={() => onDiscountTypeChange("PERCENT")}
                            className={`flex-1 min-h-[44px] text-xs font-medium transition-all ${
                              discountType === "PERCENT"
                                ? "bg-white/[0.1] text-foreground"
                                : "text-muted-foreground hover:bg-white/[0.04]"
                            }`}
                          >
                            Percent
                          </button>
                          <button
                            type="button"
                            onClick={() => onDiscountTypeChange("FIXED")}
                            className={`flex-1 min-h-[44px] text-xs font-medium transition-all ${
                              discountType === "FIXED"
                                ? "bg-white/[0.1] text-foreground"
                                : "text-muted-foreground hover:bg-white/[0.04]"
                            }`}
                          >
                            Fixed
                          </button>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs text-muted-foreground flex items-center gap-1">
                          <Tag className="w-3 h-3" /> Discount Value
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={discountValue}
                          onChange={(e) => onDiscountValueChange(e.target.value)}
                          placeholder={discountType === "PERCENT" ? "10" : "50.00"}
                          className="kf-input w-full"
                        />
                      </div>
                    </div>
                  </motion.div>
                )}

                <SectionHeader
                  label="Notes"
                  icon={MessageSquare}
                  open={sections.notes}
                  onToggle={() => toggle("notes")}
                  accentColor={theme.accent}
                />
                {sections.notes && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="pb-3"
                  >
                    <textarea
                      value={notes}
                      onChange={(e) => onNotesChange(e.target.value)}
                      placeholder={`Add notes to this ${theme.label.toLowerCase()}...`}
                      rows={3}
                      className="kf-input w-full resize-none text-sm"
                    />
                  </motion.div>
                )}
              </div>
      </SideSheet>

      <ConfirmDialog
        open={showDiscardDialog}
        title="Discard changes?"
        message={`You have unsaved changes on this ${theme.label.toLowerCase()}. Are you sure you want to discard them?`}
        confirmLabel="Discard"
        cancelLabel="Keep Editing"
        onConfirm={() => { setShowDiscardDialog(false); onClose(); }}
        onCancel={() => setShowDiscardDialog(false)}
        variant="danger"
      />
    </>
  );
});
